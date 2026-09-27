// Montar com IA (spec 3.1, 6.4): a IA propoe perguntas por etapa e desvios a partir do
// briefing do agente, das conversas de quem comprou e das etapas do funil. Vira rascunho;
// nada e publicado sozinho. Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { RoteiroError, getRoteiro, saveDraft, newKey } from './repo.js'
import { BANT_QUESTIONS } from './bantTemplate.js'
import { toolInput } from './aiCall.js'

const BANT_KEYS = ['budget', 'authority', 'need', 'timeline']
const MAX_INSIGHTS = 20
const MAX_QUESTIONS = 40
const MAX_DEVIATIONS = 20
const AI_FAILED_MESSAGE = 'A IA não respondeu agora. Monte à mão ou tente de novo.'

const SYSTEM_PROMPT = `Você monta roteiros de qualificação de vendas pelo WhatsApp para pequenas empresas brasileiras.
Regras:
- Perguntas curtas, simpáticas, em português do Brasil, uma coisa por vez. Pode usar {nome} para o primeiro nome do cliente.
- Distribua as perguntas nas etapas informadas (use o stage_id de cada etapa).
- Sempre inclua as 4 perguntas BANT como perguntas de opções com pontos: need (necessidade), budget (orçamento), authority (quem decide), timeline (prazo). Marque o campo bant.
- Perguntas de opções têm de 2 a 10 opções; points vai de -50 a 50 (mais pontos = cliente mais perto de comprar).
- required = true só para o que é indispensável para avançar de etapa.
- ai_hint é uma dica curta de como reconhecer a resposta na conversa.
- deviations são perguntas comuns do cliente fora da ordem (ex.: preço, parcelamento): triggers são palavras separadas por vírgula; reply_text é a resposta pronta; return_question_index é o índice (0 = primeira) da pergunta para voltar ao roteiro.
Use sempre a ferramenta propose_roteiro.`

const PROPOSE_TOOL = {
  name: 'propose_roteiro',
  description: 'Propõe as perguntas do roteiro por etapa e os desvios comuns.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stage_id: { type: 'integer' },
            text: { type: 'string' },
            kind: { type: 'string', enum: ['text', 'options'] },
            required: { type: 'boolean' },
            bant: { type: 'string', enum: BANT_KEYS },
            ai_hint: { type: 'string' },
            options: {
              type: 'array',
              items: { type: 'object', properties: { label: { type: 'string' }, points: { type: 'integer' } }, required: ['label', 'points'] },
            },
          },
          required: ['stage_id', 'text', 'kind'],
        },
      },
      deviations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            triggers: { type: 'string' },
            reply_text: { type: 'string' },
            return_question_index: { type: 'integer' },
          },
          required: ['triggers', 'reply_text'],
        },
      },
    },
    required: ['questions', 'deviations'],
  },
}

const str = v => (typeof v === 'string' ? v.trim() : '')
const clampPoints = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0 }

function loadBriefing(db, accountId) {
  let row
  try {
    row = db.prepare(`
      SELECT compiled_json FROM agent_briefings
      WHERE account_id = ? AND status IN ('compilado','ativo') AND compiled_json IS NOT NULL
      ORDER BY updated_at DESC, id DESC LIMIT 1
    `).get(accountId)
  } catch { return null }
  if (!row) return null
  try {
    const c = JSON.parse(row.compiled_json) || {}
    return {
      o_que_descubro: Array.isArray(c.resumo?.o_que_descubro) ? c.resumo.o_que_descubro : [],
      qualification_criteria: str(c.qualification_criteria),
      required_fields: Array.isArray(c.required_fields) ? c.required_fields : [],
    }
  } catch { return null }
}

// Resumos da IA de leads que compraram (venda registrada ou entrada em etapa de conversao).
function loadBuyerSummaries(db, accountId) {
  return db.prepare(`
    SELECT ci.summary FROM conversation_insights ci JOIN leads l ON l.id = ci.lead_id
    WHERE l.account_id = ? AND ci.summary IS NOT NULL AND TRIM(ci.summary) <> ''
      AND (EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = l.id AND s.account_id = l.account_id)
        OR EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages fs ON fs.id = h.to_stage_id WHERE h.lead_id = l.id AND fs.is_conversion = 1))
    ORDER BY ci.analyzed_at DESC, ci.id DESC LIMIT ?
  `).all(accountId, MAX_INSIGHTS).map(r => r.summary.trim())
}

function buildUserContent({ briefing, summaries, stages }) {
  const parts = ['Etapas do funil (onde colocar perguntas):']
  for (const s of stages) parts.push(`- stage_id ${s.id}: ${s.name}`)
  parts.push('')
  if (briefing) {
    parts.push('Sobre o negócio (briefing do agente):')
    if (briefing.o_que_descubro.length) parts.push(`- O que descobrir do cliente: ${briefing.o_que_descubro.join('; ')}`)
    if (briefing.qualification_criteria) parts.push(`- Cliente qualificado quando: ${briefing.qualification_criteria}`)
    if (briefing.required_fields.length) parts.push(`- Dados obrigatórios: ${briefing.required_fields.join(', ')}`)
  } else {
    parts.push('Não há briefing do negócio. Monte um roteiro geral de vendas.')
  }
  parts.push('')
  if (summaries.length) {
    parts.push(`Resumo de conversas de clientes que compraram (${summaries.length}):`)
    for (const s of summaries) parts.push(`- ${s}`)
  }
  return parts.join('\n')
}

function sanitizeQuestion(raw, { stageIds, fallbackStageId, usedBant }) {
  const text = str(raw?.text).slice(0, 500)
  if (!text) return null
  let options = []
  let kind = raw.kind === 'options' ? 'options' : 'text'
  if (kind === 'options') {
    options = (Array.isArray(raw.options) ? raw.options : [])
      .map(o => ({ label: str(o?.label).slice(0, 200), points: clampPoints(o?.points) }))
      .filter(o => o.label)
      .slice(0, 10)
    if (options.length < 2) { kind = 'text'; options = [] }
  }
  // BANT so vale em pergunta de opcoes; senao o modelo BANT completa depois.
  let bant = kind === 'options' && BANT_KEYS.includes(raw.bant) ? raw.bant : null
  if (bant && usedBant.has(bant)) bant = null
  if (bant) usedBant.add(bant)
  return {
    question_key: newKey(),
    stage_id: stageIds.has(Number(raw.stage_id)) ? Number(raw.stage_id) : fallbackStageId,
    text,
    kind,
    required: raw.required === true,
    bant,
    ai_hint: str(raw.ai_hint).slice(0, 300) || null,
    options: options.map((o, idx) => ({ ...o, position: idx })),
  }
}

export async function buildAiDraft(db, { accountId, funnelId, ai }) {
  const { stages } = getRoteiro(db, accountId, funnelId) // 404 se o funil nao e da conta
  const open = stages.filter(s => !s.is_terminal).sort((a, b) => a.position - b.position)
  if (!open.length) throw new RoteiroError('invalid', 400, 'Este funil não tem etapas para perguntas.')

  let input
  try {
    const result = await ai.call({
      accountId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent({ briefing: loadBriefing(db, accountId), summaries: loadBuyerSummaries(db, accountId), stages: open }) }],
      tools: [PROPOSE_TOOL],
      toolChoice: { type: 'tool', name: 'propose_roteiro' },
      maxTokens: 4000,
      source: 'roteiro_draft',
    })
    input = toolInput(result, 'propose_roteiro')
  } catch (e) {
    console.error('[Roteiro] montar com IA:', e && e.message)
    input = null
  }
  if (!input) throw new RoteiroError('ai_failed', 502, AI_FAILED_MESSAGE)

  // Perguntas: etapa invalida/final vai para a 1a nao final; indice original -> question_key.
  const stageIds = new Set(open.map(s => s.id))
  const firstStageId = open[0].id
  const usedBant = new Set()
  const keyByIndex = new Map()
  const questions = []
  const rawQuestions = Array.isArray(input.questions) ? input.questions.slice(0, MAX_QUESTIONS) : []
  rawQuestions.forEach((raw, idx) => {
    const q = sanitizeQuestion(raw, { stageIds, fallbackStageId: firstStageId, usedBant })
    if (!q) return
    keyByIndex.set(idx, q.question_key)
    questions.push(q)
  })

  // Garante as 4 BANT: as que faltaram entram do modelo na 1a etapa nao final.
  for (const bq of BANT_QUESTIONS) {
    if (usedBant.has(bq.bant)) continue
    questions.push({
      question_key: newKey(), stage_id: firstStageId, text: bq.text, kind: bq.kind, required: bq.required, bant: bq.bant, ai_hint: null,
      options: bq.options.map((o, idx) => ({ label: o.label, points: o.points, position: idx })),
    })
  }

  const nextPos = new Map()
  for (const q of questions) {
    const p = nextPos.get(q.stage_id) || 0
    q.position = p
    nextPos.set(q.stage_id, p + 1)
  }

  const deviations = (Array.isArray(input.deviations) ? input.deviations : [])
    .map(d => ({
      triggers: str(d?.triggers).slice(0, 300),
      reply_text: str(d?.reply_text).slice(0, 1000),
      return_question_key: Number.isInteger(d?.return_question_index) ? (keyByIndex.get(d.return_question_index) || null) : null,
    }))
    .filter(d => d.triggers && d.reply_text)
    .slice(0, MAX_DEVIATIONS)
    .map((d, idx) => ({ ...d, position: idx }))

  return saveDraft(db, accountId, funnelId, { questions, deviations })
}

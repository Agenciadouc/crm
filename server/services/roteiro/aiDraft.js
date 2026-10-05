// Montar com IA (spec 3.1, 6.4; SPIN por perfil: spec 2026-10-02 §8): a IA propoe perguntas SPIN
// por etapa de conversa e por perfil de cliente ideal, a partir das conversas reais da conta, do
// objetivo/perfis e do briefing do agente. Vira rascunho; nada e publicado sozinho.
// Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { RoteiroError, getRoteiro, saveDraft, newKey } from './repo.js'
import { SPIN_KEYS, SPIN_ORDER, missingSpinQuestions } from './spinTemplate.js'
import { isContactStage, conversationStages } from './stageKind.js'
import { getBusiness } from './profiles.js'
import { sampleConversations } from './conversationSample.js'
import { toolInput } from './aiCall.js'

const MAX_INSIGHTS = 20
const MAX_QUESTIONS = 60
const MAX_DEVIATIONS = 20
const MAX_KNOWLEDGE = 4000
const AI_FAILED_MESSAGE = 'A IA não respondeu agora. Monte à mão ou tente de novo.'

const SYSTEM_PROMPT = `Você monta roteiros de qualificação de vendas pelo WhatsApp em SPIN Selling para pequenas empresas brasileiras.
Regras:
- SPIN: situation (fatos do cliente hoje), problem (onde dói), implication (o que o problema custa se continuar), need_payoff (o cliente fala o ganho de resolver). Marque o campo spin.
- Só coloque perguntas em etapas "em conversa". Etapas "tentativa de contato" não recebem perguntas.
- Em cada etapa de conversa, para cada perfil: poucas de situation, mais de problem, mais de implication, 1 ou 2 de need_payoff, nessa ordem. Pergunta que vale para todos os perfis fica sem profile_key.
- Se houver 2 ou mais perfis: no começo da 1ª etapa de conversa, 1 pergunta de situation sem profile_key que descobre o perfil, com sets_profile_key em cada opção.
- Opções e palavras tiradas das falas reais dos clientes nas conversas. Perguntas curtas, simpáticas, objetivas, uma coisa por vez, em português do Brasil. Pode usar {nome} para o primeiro nome do cliente.
- Perguntas de opções têm de 2 a 10 opções; points vai de -50 a 50 (mais pontos = cliente mais perto de comprar). Prefira perguntas de opções.
- required = true só para o que é indispensável para avançar de etapa.
- ai_hint é uma dica curta de como reconhecer a resposta na conversa.
- deviations são perguntas comuns do cliente fora da ordem (ex.: preço, parcelamento): triggers são palavras separadas por vírgula; reply_text é a resposta pronta; return_question_index é o índice (0 = primeira) da pergunta para voltar ao roteiro.
Use sempre a ferramenta propose_roteiro.`

const PROPOSE_TOOL = {
  name: 'propose_roteiro',
  description: 'Propõe as perguntas SPIN do roteiro por etapa e por perfil, e os desvios comuns.',
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
            spin: { type: 'string', enum: SPIN_KEYS },
            profile_key: { type: 'string', description: 'Perfil para o qual a pergunta vale; vazio = todos.' },
            ai_hint: { type: 'string' },
            options: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  points: { type: 'integer' },
                  sets_profile_key: { type: 'string', description: 'Só na pergunta de descoberta: quem escolhe esta opção é deste perfil.' },
                },
                required: ['label', 'points'],
              },
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

export function loadBriefing(db, accountId) {
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
      knowledge_base: str(c.knowledge_base).slice(0, MAX_KNOWLEDGE),
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

function buildUserContent({ briefing, business, summaries, sample, stages }) {
  const parts = ['Etapas do funil:']
  for (const s of stages) parts.push(`- stage_id ${s.id}: ${s.name} (${isContactStage(s) ? 'tentativa de contato — sem perguntas' : 'em conversa — perguntas SPIN'})`)
  parts.push('')
  if (business.business_objective) parts.push(`Objetivo do negócio: ${business.business_objective}`)
  if (business.profiles.length) {
    parts.push('Perfis de cliente ideal (use o profile_key):')
    for (const p of business.profiles) parts.push(`- profile_key ${p.profile_key}: ${p.name}${p.description ? ` — como reconhecer: ${p.description}` : ''}`)
  } else {
    parts.push('A conta não cadastrou perfis: todas as perguntas valem para todos (sem profile_key).')
  }
  parts.push('')
  if (briefing) {
    parts.push('Sobre o negócio (briefing do agente):')
    if (briefing.o_que_descubro.length) parts.push(`- O que descobrir do cliente: ${briefing.o_que_descubro.join('; ')}`)
    if (briefing.qualification_criteria) parts.push(`- Cliente qualificado quando: ${briefing.qualification_criteria}`)
    if (briefing.required_fields.length) parts.push(`- Dados obrigatórios: ${briefing.required_fields.join(', ')}`)
    if (briefing.knowledge_base) parts.push(`- Base de conhecimento: ${briefing.knowledge_base}`)
    parts.push('')
  }
  if (summaries.length) {
    parts.push(`Resumo de conversas de clientes que compraram (${summaries.length}):`)
    for (const s of summaries) parts.push(`- ${s}`)
    parts.push('')
  }
  if (sample.text) parts.push(`Conversas reais da conta (${sample.count}):`, sample.text)
  if (!briefing && !sample.text) parts.push('Não há briefing nem conversas. Monte um roteiro SPIN geral de vendas.')
  return parts.join('\n')
}

function sanitizeQuestion(raw, { stageIds, fallbackStageId, profileKeys }) {
  const text = str(raw?.text).slice(0, 500)
  if (!text) return null
  let options = []
  let kind = raw.kind === 'options' ? 'options' : 'text'
  if (kind === 'options') {
    options = (Array.isArray(raw.options) ? raw.options : [])
      .map(o => ({
        label: str(o?.label).slice(0, 200),
        points: clampPoints(o?.points),
        sets_profile_key: o?.sets_profile_key && profileKeys.has(o.sets_profile_key) ? o.sets_profile_key : null,
      }))
      .filter(o => o.label)
      .slice(0, 10)
    if (options.length < 2) { kind = 'text'; options = [] }
  }
  // Fase SPIN so vale em pergunta de opcoes (pode repetir); fase que faltar o modelo completa.
  const spin = kind === 'options' && SPIN_KEYS.includes(raw.spin) ? raw.spin : null
  return {
    question_key: newKey(),
    stage_id: stageIds.has(Number(raw.stage_id)) ? Number(raw.stage_id) : fallbackStageId,
    text,
    kind,
    required: raw.required === true,
    spin,
    profile_key: raw.profile_key && profileKeys.has(raw.profile_key) ? raw.profile_key : null,
    ai_hint: str(raw.ai_hint).slice(0, 300) || null,
    options: options.map((o, idx) => ({ ...o, position: idx })),
  }
}

// Ordem na etapa: descoberta de perfil (Todos com sets_profile_key) primeiro; depois Todos,
// depois cada perfil na ordem cadastrada; dentro de cada grupo pela ordem SPIN (sem fase no
// fim); empate fica na ordem original.
export function orderStageQuestions(questions, profiles) {
  const rankProfile = new Map(profiles.map((p, i) => [p.profile_key, i + 1]))
  const isDiscovery = q => !q.profile_key && (q.options || []).some(o => o.sets_profile_key)
  const key = (q, i) => [
    isDiscovery(q) ? 0 : 1,
    q.profile_key ? (rankProfile.get(q.profile_key) ?? 99) : 0,
    q.spin ? SPIN_ORDER[q.spin] : SPIN_KEYS.length,
    i,
  ]
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0 }
  return questions.map((q, i) => ({ q, k: key(q, i) })).sort((a, b) => cmp(a.k, b.k)).map(x => x.q)
}

export async function buildAiDraft(db, { accountId, funnelId, ai }) {
  const { stages } = getRoteiro(db, accountId, funnelId) // 404 se o funil nao e da conta
  const open = stages.filter(s => !s.is_terminal).sort((a, b) => a.position - b.position)
  if (!open.length) throw new RoteiroError('invalid', 400, 'Este funil não tem etapas para perguntas.')
  const conversation = conversationStages(open)
  const business = getBusiness(db, accountId)
  const profileKeys = new Set(business.profiles.map(p => p.profile_key))

  let input
  try {
    const content = buildUserContent({
      briefing: loadBriefing(db, accountId),
      business,
      summaries: loadBuyerSummaries(db, accountId),
      sample: sampleConversations(db, { accountId }),
      stages: open,
    })
    const result = await ai.call({
      accountId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      tools: [PROPOSE_TOOL],
      toolChoice: { type: 'tool', name: 'propose_roteiro' },
      maxTokens: 8000,
      source: 'roteiro_draft',
    })
    input = toolInput(result, 'propose_roteiro')
  } catch (e) {
    console.error('[Roteiro] montar com IA:', e && e.message)
    input = null
  }
  if (!input) throw new RoteiroError('ai_failed', 502, AI_FAILED_MESSAGE)

  // Pergunta em etapa de contato/final/invalida vai para a 1a etapa de conversa;
  // indice original -> question_key (para os desvios).
  const stageIds = new Set(conversation.map(s => s.id))
  const firstConvId = conversation[0].id
  const keyByIndex = new Map()
  let questions = []
  const rawQuestions = Array.isArray(input.questions) ? input.questions.slice(0, MAX_QUESTIONS) : []
  rawQuestions.forEach((raw, idx) => {
    const q = sanitizeQuestion(raw, { stageIds, fallbackStageId: firstConvId, profileKeys })
    if (!q) return
    keyByIndex.set(idx, q.question_key)
    questions.push(q)
  })

  // Fase SPIN que faltou no roteiro todo entra do modelo, para todos, na 1a etapa de conversa.
  for (const mq of missingSpinQuestions(questions)) {
    questions.push({
      question_key: newKey(), stage_id: firstConvId, text: mq.text, kind: mq.kind, required: mq.required, spin: mq.spin, profile_key: null, ai_hint: null,
      options: mq.options.map((o, idx) => ({ label: o.label, points: o.points, position: idx, sets_profile_key: null })),
    })
  }

  // Ordem final por etapa, posicoes 0..n.
  const byStage = new Map()
  for (const q of questions) {
    if (!byStage.has(q.stage_id)) byStage.set(q.stage_id, [])
    byStage.get(q.stage_id).push(q)
  }
  questions = []
  for (const list of byStage.values()) {
    orderStageQuestions(list, business.profiles).forEach((q, i) => { q.position = i; questions.push(q) })
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

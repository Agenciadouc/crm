// Extracao de respostas por IA (spec 6.4): depois da mensagem do cliente, a IA le a
// conversa e responde as perguntas pendentes da etapa atual. Nunca sobrescreve resposta
// manual. Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { RoteiroError, getPublishedDeviations } from './repo.js'
import { getLeadRoteiro, safeGetPublishedQuestions, saveAnswer } from './leadRoteiro.js'
import { markAnswered } from './asks.js'
import { maybeAutoAdvance } from './autoAdvance.js'
import { matchDeviation } from './deviations.js'
import { normalizeText } from './recognize.js'
import { AI_UNAVAILABLE, toolInput } from './aiCall.js'
import { listProfiles, setLeadProfile } from './profiles.js'

export const EXTRACT_DELAY_MS = 120000
const MAX_MESSAGES = 20
const MAX_EVIDENCE = 300
const MAX_TEXT = 1000
const MAX_OFFSCRIPT = 500
const OFFSCRIPT_REPEAT_DAYS = 7

const SYSTEM_PROMPT = `Você lê conversas de WhatsApp entre um vendedor e um cliente e anota as respostas do cliente para as perguntas do roteiro de qualificação.
Regras:
- Só registre uma resposta quando o CLIENTE disse isso claramente na conversa. Na dúvida, não registre.
- Para pergunta de opções, escolha o option_key da opção que melhor representa o que o cliente disse.
- Para pergunta de texto, escreva a resposta do cliente curta, em português.
- evidence é o trecho exato da mensagem do cliente que prova a resposta (até 300 caracteres).
- off_script: só se o cliente fez uma pergunta que não está no roteiro e ainda não foi respondida pelo vendedor. Traga a pergunta dele e uma sugestão curta e simpática de resposta para o vendedor.
- profile_key: só quando a lista de perfis vier na mensagem e o CLIENTE deixou claro que tipo de cliente ele é. profile_evidence é o trecho exato dele. Na dúvida, não marque.
Use sempre a ferramenta record_answers.`

const RECORD_ANSWERS_TOOL = {
  name: 'record_answers',
  description: 'Registra as respostas do cliente às perguntas pendentes e, se houver, a pergunta dele fora do roteiro.',
  input_schema: {
    type: 'object',
    properties: {
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_key: { type: 'string' },
            option_key: { type: 'string', description: 'Só para pergunta de opções.' },
            text: { type: 'string', description: 'Só para pergunta de texto.' },
            evidence: { type: 'string', description: 'Trecho exato da mensagem do cliente (até 300 caracteres).' },
          },
          required: ['question_key', 'evidence'],
        },
      },
      off_script: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          suggested_reply: { type: 'string' },
        },
        required: ['question', 'suggested_reply'],
      },
    },
    required: ['answers'],
  },
}

const str = v => (typeof v === 'string' ? v.trim() : '')

// Com perfis a identificar, a ferramenta ganha profile_key (so as chaves da conta) e a evidencia.
function buildTool(profiles) {
  if (!profiles.length) return RECORD_ANSWERS_TOOL
  const schema = RECORD_ANSWERS_TOOL.input_schema
  return {
    ...RECORD_ANSWERS_TOOL,
    input_schema: {
      ...schema,
      properties: {
        ...schema.properties,
        profile_key: { type: 'string', enum: profiles.map(p => p.profile_key), description: 'Perfil do cliente, só com evidência clara.' },
        profile_evidence: { type: 'string', description: 'Trecho exato da mensagem do cliente que mostra o perfil (até 300 caracteres).' },
      },
    },
  }
}

function lastMessages(db, leadId) {
  const rows = db.prepare(`
    SELECT direction, content, media_type FROM messages WHERE lead_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(leadId, MAX_MESSAGES).reverse()
  return rows.map(m => {
    const who = m.direction === 'inbound' ? 'Cliente' : 'Vendedor'
    const content = str(m.content) || `[${m.media_type || 'mídia'}]`
    return `${who}: ${content}`
  })
}

function describeQuestion(q, hint) {
  const lines = [`- question_key: ${q.question_key} | ${q.kind === 'options' ? 'opções' : 'texto'} | "${q.text}"`]
  if (hint) lines.push(`  dica: ${hint}`)
  for (const o of q.options || []) lines.push(`  option_key: ${o.option_key} = "${o.label}"`)
  return lines.join('\n')
}

// Responde as pendentes da etapa atual e, se o lead ainda nao tem perfil (conta com 2+ perfis),
// identifica o perfil na mesma chamada; devolve { saved, offscript, advanced, profile_set }.
export async function extractAnswers(db, { accountId, leadId, ai }) {
  const empty = { saved: [], offscript: null, advanced: null, profile_set: null }
  if (!ai) return empty

  const roteiro = getLeadRoteiro(db, { accountId, leadId }) // 404 se o lead nao e da conta
  if (!roteiro.has_roteiro) return empty
  const current = roteiro.stages.find(s => s.is_current)
  const pending = current ? current.questions.filter(q => !q.answer) : []
  const leadRow = db.prepare('SELECT roteiro_profile_key FROM leads WHERE id = ?').get(leadId)
  const allProfiles = leadRow.roteiro_profile_key ? [] : listProfiles(db, accountId)
  const profiles = allProfiles.length >= 2 ? allProfiles : []
  if (!pending.length && !profiles.length) return empty

  const messages = lastMessages(db, leadId)
  if (!messages.length) return empty
  // Orcamento (teto mensal do roteiro) so depois dos filtros baratos.
  if (typeof ai.isAvailable === 'function' && !ai.isAvailable(accountId)) return empty

  const lead = db.prepare('SELECT funnel_id FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  const hints = new Map(safeGetPublishedQuestions(db, accountId, lead.funnel_id).map(q => [q.question_key, q.ai_hint]))
  const profileLines = profiles.length ? [
    'Perfis de cliente (marque profile_key só com evidência clara nas mensagens do CLIENTE; na dúvida, não marque):',
    profiles.map(p => `- profile_key: ${p.profile_key} = "${p.name}"${p.description ? ` — como reconhecer: ${p.description}` : ''}`).join('\n'),
    '',
  ] : []
  const userContent = [
    ...profileLines,
    'Perguntas pendentes:',
    pending.length ? pending.map(q => describeQuestion(q, hints.get(q.question_key))).join('\n') : '(nenhuma)',
    '',
    `Últimas mensagens (${messages.length}):`,
    messages.join('\n'),
  ].join('\n')

  const result = await ai.call({
    accountId, leadId,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    tools: [buildTool(profiles)],
    toolChoice: { type: 'tool', name: 'record_answers' },
    maxTokens: 800,
    source: 'roteiro_extraction',
  })
  const input = toolInput(result, 'record_answers') || {}

  const pendingByKey = new Map(pending.map(q => [q.question_key, q]))
  const saved = []
  for (const a of Array.isArray(input.answers) ? input.answers : []) {
    const question = a && pendingByKey.get(a.question_key)
    if (!question || saved.includes(question.question_key)) continue
    const evidence = str(a.evidence).slice(0, MAX_EVIDENCE)
    if (!evidence) continue
    let optionKey = null
    let answerText = null
    if (question.kind === 'options') {
      if (!(question.options || []).some(o => o.option_key === a.option_key)) continue
      optionKey = a.option_key
    } else {
      answerText = str(a.text).slice(0, MAX_TEXT)
      if (!answerText) continue
    }
    try {
      const r = saveAnswer(db, { accountId, leadId, questionKey: question.question_key, optionKey, answerText, origin: 'ia', evidence })
      if (r.skipped) continue
      markAnswered(db, { leadId, questionKey: question.question_key })
      saved.push(question.question_key)
    } catch (e) {
      if (!(e instanceof RoteiroError)) throw e
    }
  }

  let profileSet = null
  if (profiles.length && profiles.some(p => p.profile_key === input.profile_key) && str(input.profile_evidence)) {
    if (setLeadProfile(db, { accountId, leadId, profileKey: input.profile_key, origin: 'ia' }).changed) profileSet = input.profile_key
  }

  const advanced = saved.length || profileSet ? maybeAutoAdvance(db, { accountId, leadId }) : null
  return { saved, offscript: handleOffscript(db, { accountId, leadId, funnelId: lead.funnel_id, raw: input.off_script }), advanced, profile_set: profileSet }
}

// Pergunta fora do roteiro: se casar um desvio cadastrado, o cartao ja mostra o desvio
// (nada a fazer); senao grava em roteiro_offscript e devolve a sugestao da IA.
// A mesma pergunta do mesmo lead nos ultimos 7 dias nao repete (o prompt reenvia as
// ultimas 20 mensagens, entao a IA reporta de novo a pergunta ainda sem resposta).
function handleOffscript(db, { accountId, leadId, funnelId, raw }) {
  const question = str(raw?.question).slice(0, MAX_OFFSCRIPT)
  const suggestedReply = str(raw?.suggested_reply).slice(0, MAX_TEXT)
  if (!question) return null

  let deviations = []
  try { deviations = getPublishedDeviations(db, accountId, funnelId) } catch (e) { if (!(e instanceof RoteiroError)) throw e }
  if (deviations.length) {
    const lastInbound = db.prepare("SELECT content FROM messages WHERE lead_id = ? AND direction = 'inbound' ORDER BY created_at DESC, id DESC LIMIT 1").get(leadId)
    if (matchDeviation(question, deviations) || (lastInbound && matchDeviation(lastInbound.content, deviations))) return null
  }

  const normQuestion = normalizeText(question)
  const recent = db.prepare(`
    SELECT text FROM roteiro_offscript WHERE account_id = ? AND lead_id = ? AND detected_at >= datetime('now', ?)
  `).all(accountId, leadId, `-${OFFSCRIPT_REPEAT_DAYS} days`)
  if (recent.some(r => normalizeText(r.text) === normQuestion)) return null

  db.prepare("INSERT INTO roteiro_offscript (account_id, lead_id, text, detected_at) VALUES (?, ?, ?, datetime('now'))").run(accountId, leadId, question)
  return { question, suggested_reply: suggestedReply }
}

// Fila com coalescencia (mesmo padrao do createScoreScheduler): no maximo 1 extracao por
// lead por janela; mensagens novas no meio da janela so trocam o payload pelo mais novo.
export function createExtractQueue({ run, delayMs = EXTRACT_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map() // leadId -> { handle, payload }

  async function runOne(leadId) {
    const entry = pending.get(leadId)
    if (!entry) return
    pending.delete(leadId)
    try {
      await run(entry.payload)
    } catch (e) {
      if (e && e.code === AI_UNAVAILABLE) return
      console.error('[Roteiro] extracao IA lead', leadId, e && e.message)
    }
  }

  function enqueue(payload) {
    const leadId = payload?.lead?.id
    if (leadId == null) return
    const entry = pending.get(leadId)
    if (entry) { entry.payload = payload; return }
    const handle = setTimer(() => runOne(leadId), delayMs)
    if (handle && typeof handle.unref === 'function') handle.unref()
    pending.set(leadId, { handle, payload })
  }

  function flushAll() {
    const ids = [...pending.keys()]
    for (const id of ids) {
      const handle = pending.get(id)?.handle
      if (handle != null) { try { clearTimer(handle) } catch {} }
    }
    return Promise.all(ids.map(runOne))
  }

  return { enqueue, flushAll }
}

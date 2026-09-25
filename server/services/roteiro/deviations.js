// Desvios (perguntas fora do roteiro) sem IA: casa palavra-gatilho e acha o desvio ativo do lead (spec 4.1, 6.4).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { normalizeText } from './recognize.js'
import { RoteiroError, getPublishedDeviations, getPublishedQuestions } from './repo.js'
import { resolveNow, shiftFromNow } from './time.js'

// Algum gatilho (normalizado) contido no texto normalizado, em fronteira de palavra
// (com espacos nas pontas) -> devolve o desvio; senao null. Fronteira de palavra evita que
// um gatilho curto como "pix" case dentro de outra palavra, tipo "pixel".
export function matchDeviation(text, deviations) {
  const normText = normalizeText(text)
  if (!normText) return null
  const paddedText = ` ${normText} `

  for (const dev of deviations || []) {
    const triggers = String(dev.triggers || '')
      .split(',')
      .map(t => normalizeText(t))
      .filter(Boolean)
    if (triggers.some(t => paddedText.includes(` ${t} `))) return dev
  }
  return null
}

// Desvio casado com o ultimo inbound do lead nas ultimas 24h, so se nao houve outbound depois.
// Lead sem funnel/sem roteiro publicado -> null.
export function activeDeviationForLead(db, { accountId, lead, now }) {
  if (!lead || !lead.funnel_id) return null

  let deviations
  try {
    deviations = getPublishedDeviations(db, accountId, lead.funnel_id)
  } catch (e) {
    if (e instanceof RoteiroError) return null
    throw e
  }
  if (!deviations.length) return null

  const nowStr = resolveNow(db, now)
  const cutoff = shiftFromNow(db, nowStr, '-24 hours')

  const lastInbound = db.prepare(`
    SELECT id, content, created_at FROM messages
    WHERE lead_id = ? AND direction = 'inbound' AND created_at >= ?
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(lead.id, cutoff)
  if (!lastInbound) return null

  // Compara por id (nao por created_at): mensagens no mesmo segundo tem o mesmo timestamp,
  // mas o outbound sempre tem id maior por ter sido inserido depois.
  const outboundAfter = db.prepare(`
    SELECT id FROM messages
    WHERE lead_id = ? AND direction = 'outbound' AND id > ?
    LIMIT 1
  `).get(lead.id, lastInbound.id)
  if (outboundAfter) return null

  const matched = matchDeviation(lastInbound.content, deviations)
  if (!matched) return null

  let returnQuestionText = null
  if (matched.return_question_key) {
    const questions = getPublishedQuestions(db, accountId, lead.funnel_id)
    const found = questions.find(q => q.question_key === matched.return_question_key)
    returnQuestionText = found ? found.text : null
  }

  return { ...matched, return_question_text: returnQuestionText }
}

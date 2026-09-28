// Metrica por passo da cadencia (spec 3.5): mensagem enviada pelo botao do passo vira um
// ask 'step-<id>' e ganha "respondem X%" pelo mesmo calculo das perguntas; ligacao/visita/
// reuniao/e-mail = "feitas X de Y leads". Recebe db.
import { recordAsk } from '../roteiro/asks.js'
import { questionMetrics, pct, accountMinReplyRate, MIN_SAMPLE } from '../roteiro/metrics.js'
import { resolveNow, shiftFromNow } from '../roteiro/time.js'
import { markStepDone } from './leadCadence.js'
import { CadenceError } from './errors.js'

const MESSAGE_TYPES = ['mensagem', 'whatsapp']

export const stepAskKey = attemptId => `step-${attemptId}`

export function recordStepSend(db, { lead, attemptId, userId = null, messageId = null, content = null }) {
  const id = Number(attemptId)
  if (!Number.isInteger(id) || id <= 0) return null
  const row = db.prepare(`
    SELECT ca.id, ca.action_type FROM cadence_attempts ca
    JOIN lead_cadences lc ON lc.cadence_id = ca.cadence_id
    JOIN cadences c ON c.id = ca.cadence_id
    WHERE ca.id = ? AND lc.lead_id = ? AND lc.status = 'active' AND c.account_id = ?
  `).get(id, lead.id, lead.account_id)
  if (!row || !MESSAGE_TYPES.includes(row.action_type)) return null
  let askId
  db.transaction(() => {
    askId = recordAsk(db, { accountId: lead.account_id, leadId: lead.id, questionKey: stepAskKey(id), textSent: content, messageId, userId, source: 'button' })
    db.prepare('UPDATE roteiro_asks SET attempt_id = ? WHERE id = ?').run(id, askId)
    markStepDone(db, { accountId: lead.account_id, leadId: lead.id, attemptId: id, how: 'enviado', userId })
  })()
  return askId
}

export function stepMetrics(db, { accountId, cadenceId, days = 90, now } = {}) {
  const c = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ?').get(cadenceId, accountId)
  if (!c) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  const until = resolveNow(db, now)
  const since = shiftFromNow(db, until, `-${days} days`)
  const min = accountMinReplyRate(db, accountId)
  const steps = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(c.id)
  const byQuestion = c.funnel_id && steps.some(s => s.action_type === 'pergunta')
    ? new Map(questionMetrics(db, { accountId, funnelId: c.funnel_id, days, now }).map(m => [m.question_key, m]))
    : new Map()
  const totals = db.prepare(`
    SELECT COUNT(*) AS sent,
      SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN advanced_at IS NOT NULL THEN 1 ELSE 0 END) AS advanced,
      SUM(CASE WHEN bought_at IS NOT NULL THEN 1 ELSE 0 END) AS bought
    FROM roteiro_asks WHERE account_id = ? AND question_key = ? AND asked_at >= ? AND asked_at <= ?
  `)
  const doneStmt = db.prepare("SELECT COUNT(DISTINCT lead_id) AS n FROM lead_cadence_steps WHERE attempt_id = ? AND how IN ('feito','enviado') AND done_at >= ? AND done_at <= ?")
  const reached = db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM lead_cadences WHERE cadence_id = ? AND started_at >= ? AND started_at <= ?').get(c.id, since, until).n
  return steps.map(s => {
    if (s.action_type === 'pergunta') {
      const m = byQuestion.get(s.question_key)
      return {
        attempt_id: s.id, kind: 'resposta', sent: m ? m.sent : 0, reply_rate: m ? m.reply_rate : null,
        advanced_rate: m ? m.advanced_rate : null, bought_rate: m ? m.bought_rate : null,
        status: m ? m.status : 'amostra_pequena', by_seller: m ? m.by_seller : [],
      }
    }
    if (MESSAGE_TYPES.includes(s.action_type)) {
      const t = totals.get(accountId, stepAskKey(s.id), since, until)
      const sent = t.sent || 0
      const replyRate = pct(t.replied || 0, sent)
      const status = sent < MIN_SAMPLE ? 'amostra_pequena' : (replyRate < min ? 'fraca' : 'ok')
      return {
        attempt_id: s.id, kind: 'resposta', sent, reply_rate: replyRate,
        advanced_rate: pct(t.advanced || 0, sent), bought_rate: pct(t.bought || 0, sent), status, by_seller: [],
      }
    }
    return { attempt_id: s.id, kind: 'feitas', done: doneStmt.get(s.id, since, until).n, reached }
  })
}

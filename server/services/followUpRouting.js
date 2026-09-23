// Decisao pura do envio de follow-up (spec secoes 5, 9 e 10): numero padrao, descadastro e rodape.
import { resolveSendInstance } from './whatsapp/resolveSendInstance.js'
import { isOptedOut, DEFAULT_OPTOUT_FOOTER } from './antiban.js'

// Motivos de conectividade (falta/queda de numero) — retomados pra conta toda quando o numero padrao conecta.
export const RESUMABLE_REASONS = ['no_send_number', 'send_number_offline', 'instance_offline', 'instance_removed']
// Motivos antigos (antes do numero padrao, por numero do follow-up): so voltam se pausados ha no maximo 7 dias,
// senao um numero de disparo conectando ressuscitaria pausas velhas esquecidas da conta toda.
export const LEGACY_REASONS = ['instance_offline', 'instance_removed']
export const LEGACY_MAX_AGE = '-7 days'
// Falhas de envio (numero invalido, erro da API) — só retomadas quando o numero que reconectou
// é o numero padrao atual da conta (nao retoma so por "algum numero de disparo conectou").
export const SEND_FAILURE_REASONS = ['send_failed', 'send_error']

// Follow-up de inatividade em modo 'rotation': cada step É uma variacao unica da mesma mensagem
// (o proprio scanner exige >=3 steps — server/services/inactivityScanner.js:29-32), entao
// a checagem de variedade por step nao se aplica. Todo o resto (sequence, non-inactivity) exige variacao.
export function needsVarietyCheck({ type, inactivityMode }) {
  return !(type === 'inactivity' && inactivityMode === 'rotation')
}

export function planFollowUpSend(db, { lead, followUp }) {
  if (isOptedOut(lead)) return { ok: false, pause: 'lead_opted_out' }
  const r = resolveSendInstance(db, { accountId: lead.account_id, kind: 'automatico' })
  if (!r.ok) return { ok: false, pause: r.reason }
  let footer = null
  if (followUp && followUp.optout_footer_enabled) {
    const acc = db.prepare('SELECT optout_footer_text FROM accounts WHERE id = ?').get(lead.account_id)
    footer = (acc && acc.optout_footer_text && acc.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER
  }
  return { ok: true, instance: r.instance, footer }
}

export function resumeAutomaticFollowUps(db, accountId, { includeSendFailures = false } = {}) {
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  if (!r.ok) return 0
  const current = RESUMABLE_REASONS.filter(r => !LEGACY_REASONS.includes(r))
  const reasons = includeSendFailures ? [...current, ...SEND_FAILURE_REASONS] : current
  const ph = (arr) => arr.map(() => '?').join(', ')
  const res = db.prepare(`
    UPDATE lead_follow_ups SET status = 'active', paused_at = NULL, paused_reason = NULL,
      next_run_at = datetime('now'), updated_at = datetime('now')
    WHERE status = 'paused'
      AND (paused_reason IN (${ph(reasons)})
        OR (paused_reason IN (${ph(LEGACY_REASONS)}) AND paused_at >= datetime('now', ?)))
      AND lead_id IN (SELECT id FROM leads WHERE account_id = ?)
  `).run(...reasons, ...LEGACY_REASONS, LEGACY_MAX_AGE, accountId)
  return res.changes
}

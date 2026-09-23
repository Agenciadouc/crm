// Decisao pura do envio de follow-up (spec secoes 5, 9 e 10): numero padrao, descadastro e rodape.
import { resolveSendInstance } from './whatsapp/resolveSendInstance.js'
import { isOptedOut, DEFAULT_OPTOUT_FOOTER } from './antiban.js'

export const RESUMABLE_REASONS = ['no_send_number', 'send_number_offline', 'instance_offline', 'instance_removed', 'send_failed', 'send_error']

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

export function resumeAutomaticFollowUps(db, accountId) {
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  if (!r.ok) return 0
  const ph = RESUMABLE_REASONS.map(() => '?').join(', ')
  const res = db.prepare(`
    UPDATE lead_follow_ups SET status = 'active', paused_at = NULL, paused_reason = NULL,
      next_run_at = datetime('now'), updated_at = datetime('now')
    WHERE status = 'paused' AND paused_reason IN (${ph})
      AND lead_id IN (SELECT id FROM leads WHERE account_id = ?)
  `).run(...RESUMABLE_REASONS, accountId)
  return res.changes
}

// Disparos em massa: rodape SAIR e textos de pausa (spec secoes 9 e 10.3).
import { DEFAULT_OPTOUT_FOOTER, isOptedOut } from './antiban.js'
import { resolveSendInstance } from './whatsapp/resolveSendInstance.js'

const REASON_TEXT = {
  no_send_number: 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar',
  send_number_offline: 'O número de disparos está desconectado — os envios automáticos estão parados',
}

export const NO_SEND_REASONS = [REASON_TEXT.no_send_number, REASON_TEXT.send_number_offline]

export function pauseReasonText(reason) {
  return REASON_TEXT[reason] || String(reason || '')
}

export function broadcastFooter(db, accountId) {
  const acc = db.prepare('SELECT optout_footer_enabled, optout_footer_text FROM accounts WHERE id = ?').get(accountId)
  if (!acc || !acc.optout_footer_enabled) return null
  return (acc.optout_footer_text && acc.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER
}

// Decide se um disparo pode COMECAR agora (send imediato, agendado vencendo, ou retomar
// manualmente) pelo numero padrao de disparos da conta — nunca pelo instance_id gravado
// no broadcast, que e so historico (spec secao 5).
export function canStartBroadcast(db, accountId) {
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  if (!r.ok) return { ok: false, reasonText: pauseReasonText(r.reason), instance: null }
  return { ok: true, reasonText: null, instance: r.instance }
}

// Motivo gravado pela pausa manual (POST /api/broadcasts/:id/pause).
export const MANUAL_PAUSE_REASON = 'manual_user'

// Disparos pausados que podem voltar quando um numero conecta: os pausados neste numero (menos
// os pausados a mao pelo usuario) e os parados por falta/queda do numero padrao na conta.
export function pausedBroadcastsToResume(db, accountId, instanceId) {
  return db.prepare(`SELECT * FROM broadcasts WHERE account_id = ? AND status = 'sending' AND paused_at IS NOT NULL
    AND ((instance_id = ? AND COALESCE(paused_reason, '') <> ?) OR paused_reason IN (?, ?))`)
    .all(accountId, instanceId, MANUAL_PAUSE_REASON, ...NO_SEND_REASONS)
}

// Lead que mandou SAIR com o disparo ja na fila (spec 10.1): nao envia; conta como falha lead_opted_out.
export function skipOptedOutRecipient(db, { broadcastId, recipientId, lead }) {
  if (!isOptedOut(lead)) return false
  db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = 'lead_opted_out' WHERE id = ?").run(recipientId)
  db.prepare('UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = ?').run(broadcastId)
  return true
}

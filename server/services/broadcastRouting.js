// Disparos em massa: rodape SAIR e textos de pausa (spec secoes 9 e 10.3).
import { DEFAULT_OPTOUT_FOOTER } from './antiban.js'

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

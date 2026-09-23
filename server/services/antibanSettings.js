// Ajustes anti-ban da conta e dados extras da lista de numeros (spec secoes 4, 10 e 11).
import { numberRole } from './whatsapp/numberRole.js'
import { getDefaultSendInstance } from './whatsapp/resolveSendInstance.js'
import { computeReplyRate } from './replyRate.js'
import { DEFAULT_OPTOUT_FOOTER, DEFAULT_OPTOUT_CONFIRM } from './antiban.js'

const MAX_TEXT = 200

export function getAntibanSettings(db, accountId) {
  const a = db.prepare(`SELECT optout_footer_enabled, optout_footer_text, optout_confirm_text, reply_rate_alert_pct
    FROM accounts WHERE id = ?`).get(accountId) || {}
  return {
    optout_footer_enabled: a.optout_footer_enabled == null ? true : !!a.optout_footer_enabled,
    optout_footer_text: (a.optout_footer_text && a.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER,
    optout_confirm_text: (a.optout_confirm_text && a.optout_confirm_text.trim()) || DEFAULT_OPTOUT_CONFIRM,
    reply_rate_alert_pct: a.reply_rate_alert_pct == null ? 10 : a.reply_rate_alert_pct,
  }
}

export function saveAntibanSettings(db, accountId, body = {}) {
  const cur = getAntibanSettings(db, accountId)
  const footer = body.optout_footer_text === undefined ? cur.optout_footer_text : String(body.optout_footer_text || '').trim()
  const confirm = body.optout_confirm_text === undefined ? cur.optout_confirm_text : String(body.optout_confirm_text || '').trim()
  const pct = body.reply_rate_alert_pct === undefined ? cur.reply_rate_alert_pct : Number(body.reply_rate_alert_pct)
  if (footer.length > MAX_TEXT || confirm.length > MAX_TEXT) return { ok: false, error: `Textos com no máximo ${MAX_TEXT} caracteres` }
  if (!Number.isInteger(pct) || pct < 1 || pct > 50) return { ok: false, error: 'O limite da taxa de resposta deve ficar entre 1% e 50%' }
  const enabled = body.optout_footer_enabled === undefined ? cur.optout_footer_enabled : !!body.optout_footer_enabled
  db.prepare(`UPDATE accounts SET optout_footer_enabled = ?, optout_footer_text = ?, optout_confirm_text = ?, reply_rate_alert_pct = ?
    WHERE id = ?`).run(enabled ? 1 : 0, footer || null, confirm || null, pct, accountId)
  return { ok: true, settings: getAntibanSettings(db, accountId) }
}

export function decorateInstances(db, accountId, rows) {
  const def = getDefaultSendInstance(db, accountId)
  return rows.map(r => {
    const role = numberRole(r)
    return {
      ...r,
      role,
      is_default_send: !!def && def.id === r.id,
      reply_rate: role === 'disparo' ? computeReplyRate(db, r.id) : null,
    }
  })
}

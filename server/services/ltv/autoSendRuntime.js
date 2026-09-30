// Envio de producao da recompra: catraca anti-ban + sendViaInstance + grava em messages + SSE (igual followUpSender).
import db from '../../db.js'
import { sendViaInstance } from '../leadHandoff.js'
import { followUpPacer } from '../whatsapp/sendPacer.js'
import { broadcastSSE } from '../../sse.js'

export function productionSendFor() {
  return async ({ instance, lead, text }) => {
    await followUpPacer.wait(instance.id)
    const r = await sendViaInstance(instance, lead.phone, text, { leadId: lead.id, origin: 'auto' })
    if (!r.ok) return { ok: false, reason: r.validationFailed ? 'number_not_on_whatsapp' : (r.reason || 'send_failed') }
    const msgId = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, delivery_status)
      VALUES (?, ?, 'outbound', ?, 'text', 'Recompra auto', ?, datetime('now'), ?, 'sent')
    `).run(lead.id, lead.account_id, text, r.wamsgId, instance.id).lastInsertRowid
    try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
    return { ok: true }
  }
}

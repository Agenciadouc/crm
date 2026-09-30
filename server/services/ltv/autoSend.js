// Envio automatico do lembrete (spec §8). `send` e `availability` injetados; producao em autoSendRuntime.js.
import { localDate, addDays } from './compute.js'
import { completeTask } from './cycles.js'
import { stageIdByKey, ensureRepurchaseFunnel } from './funnel.js'
import { moveLeadToStage } from '../stageMove.js'
import { isOptedOut, appendOptOutFooter } from '../antiban.js'
import { broadcastFooter } from '../broadcastRouting.js'
import { resolveSendInstance } from '../whatsapp/resolveSendInstance.js'

export function autoSendAvailability(db, accountId, { ai }) {
  if (!ai || !ai.isAvailable(accountId)) return { ok: false, reason: 'no_ai' }
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  return r.ok ? { ok: true, instance: r.instance } : { ok: false, reason: r.reason }
}

const fail = (db, id, reason) => db.prepare("UPDATE repurchase_cycles SET auto_failed_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id)

export async function processAutoSends(db, { accountId, ai, send, now = new Date(), availability = (d, a, o) => autoSendAvailability(d, a, o) }) {
  const out = { sent: 0, failed: 0, waiting: 0 }
  const cycles = db.prepare(`
    SELECT * FROM repurchase_cycles
    WHERE account_id = ? AND status = 'a_contatar' AND auto_sent_at IS NULL AND auto_failed_reason IS NULL
    ORDER BY remind_at, id
  `).all(accountId)
  for (const c of cycles) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(c.lead_id)
    if (!lead || lead.is_active === 0 || lead.repurchase_opt_out || isOptedOut(lead)) { fail(db, c.id, 'opted_out'); out.failed++; continue }
    const avail = availability(db, accountId, { ai })
    if (!avail.ok) { fail(db, c.id, avail.reason); out.failed++; continue }
    const message = c.ai_suggestion ? JSON.parse(c.ai_suggestion).message : null
    if (!message) { fail(db, c.id, 'no_message'); out.failed++; continue }
    let footer = null
    try { footer = broadcastFooter(db, accountId) } catch { footer = null }
    const text = footer ? appendOptOutFooter(message, footer) : message
    let r
    try { r = await send({ instance: avail.instance, lead, text }) } catch (e) { r = { ok: false, reason: 'send_error' } }
    if (!r.ok) {
      if (r.reason === 'outside_business_hours') { out.waiting++; continue }
      fail(db, c.id, r.reason || 'send_failed'); out.failed++; continue
    }
    const ts = now.toISOString().slice(0, 19).replace('T', ' ')
    db.transaction(() => {
      db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa', auto_sent_at = ?, updated_at = datetime('now') WHERE id = ?").run(ts, c.id)
      db.prepare('UPDATE repurchase_attempts SET auto = 1, contacted_at = COALESCE(contacted_at, ?) WHERE cycle_id = ? AND attempt = ?').run(ts, c.id, c.attempt)
      completeTask(db, c.task_id, 'Mensagem automática enviada.')
      const follow = Number(db.prepare(`
        INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, repurchase_cycle_id)
        SELECT account_id, lead_id, assigned_to, ?, ?, ?, 'pending', repurchase_cycle_id FROM standalone_tasks WHERE id = ?
      `).run(`Acompanhar resposta de ${lead.name || 'cliente'}`, `Mensagem automática enviada:\n${message}`, `${addDays(localDate(now), 2)}T12:00:00.000Z`, c.task_id).lastInsertRowid)
      db.prepare('UPDATE repurchase_cycles SET task_id = ? WHERE id = ?').run(follow, c.id)
      if (lead.funnel_id === ensureRepurchaseFunnel(db, accountId)) {
        moveLeadToStage(db, { lead: { id: lead.id }, toStageId: stageIdByKey(db, accountId, 'em_conversa'), trigger: 'recompra', gate: false })
      }
    })()
    out.sent++
  }
  return out
}

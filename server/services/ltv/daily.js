// Rotina da recompra (spec §9): 1x por dia por conta a partir das 9h de Brasilia + envio automatico a cada tick.
import { localDate } from './compute.js'
import { recalcAccountCustomers } from './customer.js'
import { activateCycle } from './reminder.js'
import { processAutoSends } from './autoSend.js'

const brtHour = now => new Date(now.getTime() - 3 * 3600000).getUTCHours()

export function shouldRunDaily(account, now = new Date()) {
  return brtHour(now) >= 9 && account.ltv_daily_on !== localDate(now)
}

export async function runLtvForAccount(db, { accountId, ai = null, now = new Date() }) {
  const today = localDate(now)
  const due = db.prepare("SELECT id FROM repurchase_cycles WHERE account_id = ? AND status = 'aguardando' AND exhausted = 0 AND remind_at <= ? ORDER BY remind_at, id").all(accountId, today)
  let activated = 0, exhausted = 0
  for (const { id } of due) {
    const r = await activateCycle(db, { cycleId: id, ai, now })
    if (r.taskId) activated++
    if (r.exhausted) exhausted++
  }
  recalcAccountCustomers(db, accountId, { now })
  db.prepare('UPDATE accounts SET ltv_daily_on = ? WHERE id = ?').run(today, accountId)
  return { activated, exhausted }
}

export async function runLtvTick(db, { now = new Date(), aiForAccount = () => null, sendFor = () => null, broadcast = () => {} }) {
  const accounts = db.prepare('SELECT * FROM accounts').all().filter(a => a.is_active !== 0)
  for (const a of accounts) {
    try {
      const ai = aiForAccount(a.id)
      if (shouldRunDaily(a, now)) {
        await runLtvForAccount(db, { accountId: a.id, ai, now })
        broadcast(a.id, 'customers:updated', {})
      }
      const send = a.repurchase_auto_send ? sendFor(a.id) : null
      if (send) await processAutoSends(db, { accountId: a.id, ai, send, now })
    } catch (e) {
      console.error(`[Recompra] conta ${a.id}:`, e.message)
    }
  }
}

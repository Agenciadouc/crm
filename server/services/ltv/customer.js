// Cache do cliente no lead (spec §4.9): LTV, compras, ultima compra, intervalo medio, curva e selo.
import { customerStats, tierFor, localDate } from './compute.js'

export function curveConfig(db, accountId) {
  const a = db.prepare('SELECT curve_a_days, curve_b_days, curve_c_days FROM accounts WHERE id = ?').get(accountId) || {}
  return { a: a.curve_a_days ?? 30, b: a.curve_b_days ?? 45, c: a.curve_c_days ?? 60 }
}

export function recalcCustomer(db, leadId, { now = new Date() } = {}) {
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return null
  const sales = db.prepare('SELECT value, sale_date FROM lead_sales WHERE lead_id = ? ORDER BY sale_date').all(leadId)
  const st = customerStats(sales, { today: localDate(now), curve: curveConfig(db, lead.account_id) })
  const tiers = db.prepare('SELECT id, min_ltv FROM customer_tiers WHERE account_id = ?').all(lead.account_id)
  const tierId = st.purchases ? tierFor(st.ltv, tiers) : null
  db.prepare(`
    UPDATE leads SET ltv = ?, purchases = ?, last_purchase_at = ?, avg_interval_days = ?, curve = ?, tier_id = ?
    WHERE id = ?
  `).run(st.ltv, st.purchases, st.lastPurchaseAt, st.avgIntervalDays, st.curve, tierId, leadId)
  return { ...st, tierId }
}

export function recalcAccountCustomers(db, accountId, { now = new Date() } = {}) {
  const ids = db.prepare(`
    SELECT DISTINCT lead_id AS id FROM lead_sales WHERE account_id = ?
    UNION SELECT id FROM leads WHERE account_id = ? AND purchases > 0
  `).all(accountId, accountId)
  db.transaction(() => { for (const { id } of ids) recalcCustomer(db, id, { now }) })()
  return db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM lead_sales WHERE account_id = ?').get(accountId).n
}

export function backfillAllCustomers(db, { now = new Date() } = {}) {
  let n = 0
  for (const { account_id } of db.prepare('SELECT DISTINCT account_id FROM lead_sales').all()) {
    n += recalcAccountCustomers(db, account_id, { now })
  }
  return n
}

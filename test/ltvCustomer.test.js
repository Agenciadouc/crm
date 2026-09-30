import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { recalcCustomer, recalcAccountCustomers, backfillAllCustomers, curveConfig } from '../server/services/ltv/customer.js'

const NOW = new Date('2026-09-29T15:00:00Z')

test('recalcCustomer grava LTV, compras, curva e selo no lead', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addSale(db, { accountId: s.accountId, leadId, value: 3000, saleDate: '2026-09-01 10:00:00' })
  addSale(db, { accountId: s.accountId, leadId, value: 2500, saleDate: '2026-09-21 10:00:00' })
  db.prepare("INSERT INTO customer_tiers (account_id, name, min_ltv) VALUES (?, 'Diamante', 5000), (?, 'Premium', 2000)").run(s.accountId, s.accountId)
  const r = recalcCustomer(db, leadId, { now: NOW })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.ltv, 5500); assert.equal(lead.purchases, 2); assert.equal(lead.last_purchase_at, '2026-09-21')
  assert.equal(lead.avg_interval_days, 20); assert.equal(lead.curve, 'A')
  const diamante = db.prepare("SELECT id FROM customer_tiers WHERE name = 'Diamante'").get().id
  assert.equal(lead.tier_id, diamante); assert.equal(r.tierId, diamante)
})

test('sem vendas zera o cache', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  db.prepare("UPDATE leads SET ltv = 10, purchases = 1, curve = 'A' WHERE id = ?").run(leadId)
  recalcCustomer(db, leadId, { now: NOW })
  const lead = db.prepare('SELECT ltv, purchases, curve, tier_id FROM leads WHERE id = ?').get(leadId)
  assert.deepEqual({ ...lead }, { ltv: 0, purchases: 0, curve: null, tier_id: null })
})

test('curva usa a configuração da conta', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  db.prepare('UPDATE accounts SET curve_a_days = 10, curve_b_days = 15, curve_c_days = 20 WHERE id = ?').run(s.accountId)
  assert.deepEqual(curveConfig(db, s.accountId), { a: 10, b: 15, c: 20 })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addSale(db, { accountId: s.accountId, leadId, saleDate: '2026-09-01' })
  addSale(db, { accountId: s.accountId, leadId, saleDate: '2026-09-21' })
  assert.equal(recalcCustomer(db, leadId, { now: new Date('2026-09-22T15:00:00Z') }).curve, 'C')
})

test('recalcAccountCustomers e backfill só tocam clientes com venda', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const a = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  addSale(db, { accountId: s.accountId, leadId: a, value: 80 })
  assert.equal(recalcAccountCustomers(db, s.accountId, { now: NOW }), 1)
  db.prepare('UPDATE leads SET ltv = 0 WHERE id = ?').run(a)
  assert.equal(backfillAllCustomers(db, { now: NOW }), 1)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(a).ltv, 80)
})

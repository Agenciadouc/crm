import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { applyLtvSchema } from '../server/services/ltv/schema.js'

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)

test('applyLtvSchema cria colunas e tabelas e é idempotente', () => {
  const db = createLtvTestDb()
  applyLtvSchema(db) // 2a vez não quebra
  for (const c of ['product', 'sale_kind', 'remind_days', 'cross_sell', 'cross_sell_offer']) assert.ok(cols(db, 'lead_sales').includes(c), c)
  for (const c of ['ltv', 'purchases', 'last_purchase_at', 'avg_interval_days', 'curve', 'tier_id', 'repurchase_opt_out']) assert.ok(cols(db, 'leads').includes(c), c)
  for (const c of ['repurchase_funnel_id', 'repurchase_max_attempts', 'repurchase_auto_send', 'curve_a_days', 'curve_b_days', 'curve_c_days', 'ltv_daily_on']) assert.ok(cols(db, 'accounts').includes(c), c)
  assert.ok(cols(db, 'funnels').includes('kind'))
  assert.ok(cols(db, 'funnel_stages').includes('system_key'))
  assert.ok(cols(db, 'standalone_tasks').includes('repurchase_cycle_id'))
  for (const t of ['repurchase_cycles', 'repurchase_attempts', 'repurchase_reasons', 'customer_tiers']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), t)
  }
})

test('só um ciclo aberto por lead', () => {
  const db = createLtvTestDb()
  const ins = db.prepare("INSERT INTO repurchase_cycles (account_id, lead_id, kind, status, remind_at, remind_days) VALUES (1, 1, 'recompra', ?, '2026-10-01', 30)")
  ins.run('aguardando')
  assert.throws(() => ins.run('a_contatar'), /UNIQUE/)
  ins.run('comprou') // fechado não conta
})

test('defaults da conta', () => {
  const db = createLtvTestDb()
  db.prepare("INSERT INTO accounts (id, name) VALUES (99, 'X')").run()
  const a = db.prepare('SELECT * FROM accounts WHERE id = 99').get()
  assert.equal(a.repurchase_max_attempts, 5)
  assert.equal(a.repurchase_auto_send, 0)
  assert.deepEqual([a.curve_a_days, a.curve_b_days, a.curve_c_days], [30, 45, 60])
})

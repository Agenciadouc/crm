import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { computeAttendantDay, ensureFunnelMetricsTable, upsertFunnelDay, backfillFunnelMetrics } from '../server/services/attendantMetricsCompute.js'

function tryExec(db, sql) { try { db.exec(sql) } catch {} }

function setup() {
  const db = createLtvTestDb(); const s = seedMaria(db)
  tryExec(db, 'ALTER TABLE messages ADD COLUMN ai_agent_id INTEGER')
  for (const c of ['qualified_at', 'proposal_sent_at']) tryExec(db, `ALTER TABLE leads ADD COLUMN ${c} TEXT`)
  tryExec(db, 'ALTER TABLE accounts ADD COLUMN attendant_analytics_enabled INTEGER NOT NULL DEFAULT 0')
  db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(s.atendenteId, s.maria)
  const msg = (dir, at) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, ?, 'x', ?)").run(s.maria, s.accountId, dir, at)
  msg('inbound', '2026-10-05 10:00:00'); msg('outbound', '2026-10-05 10:03:00')
  msg('inbound', '2026-10-26 10:00:00'); msg('outbound', '2026-10-26 10:10:00')
  ensureFunnelMetricsTable(db)
  return { db, s }
}

test('respondidos contam no funil em que o lead estava no inicio do dia', () => {
  const { db, s } = setup()
  const day = (d, k) => computeAttendantDay(db, s.accountId, s.atendenteId, d, k).leads_responded
  assert.equal(day('2026-10-05', 'vendas'), 1)
  assert.equal(day('2026-10-05', 'recompra'), 0)
  assert.equal(day('2026-10-26', 'recompra'), 1)
  assert.equal(day('2026-10-26', 'vendas'), 0)
  assert.equal(day('2026-10-26', null), 1)
})

test('lead novo do dia conta no funil em que nasceu', () => {
  const { db, s } = setup()
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-02', 'vendas').leads_assigned, 1)
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-02', 'recompra').leads_assigned, 0)
})

test('conversoes da recompra = quem recomprou no dia', () => {
  const { db, s } = setup()
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-25', 'recompra').leads_converted, 1)
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-10', 'recompra').leads_converted, 0)
})

test('upsert por funil e preenchimento unico', () => {
  const { db, s } = setup()
  const m = computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra')
  upsertFunnelDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra', m)
  upsertFunnelDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra', m)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM attendant_metrics_daily_funnel').get().c, 1)
  db.exec('UPDATE accounts SET attendant_analytics_enabled = 1')
  assert.equal(backfillFunnelMetrics(db, 3, new Date('2026-10-27T12:00:00Z')).done, true)
  assert.ok(db.prepare("SELECT COUNT(*) c FROM attendant_metrics_daily_funnel WHERE date = '2026-10-26'").get().c >= 2)
  assert.equal(backfillFunnelMetrics(db, 3, new Date('2026-10-27T12:00:00Z')).done, false) // ja feito
})

test('data invalida e recusada', () => {
  const { db, s } = setup()
  assert.throws(() => computeAttendantDay(db, s.accountId, s.atendenteId, "2026-10-26'; --", 'vendas'))
})

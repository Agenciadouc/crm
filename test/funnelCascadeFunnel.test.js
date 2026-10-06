import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { cascadeFor } from '../server/services/funnelCascade.js'

function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('cascata de outubro nos tres modos', () => {
  const { db, s } = setup()
  const c = f => cascadeFor(db, s.accountId, '2026-10', null, f)
  assert.equal(c('todos').total, 3)
  assert.equal(c('todos').real_revenue, 2300)
  assert.equal(c('todos').won, 1)
  assert.equal(c('vendas').total, 3)
  assert.equal(c('vendas').real_revenue, 1500)
  assert.equal(c('vendas').won, 1)
  assert.equal(c('recompra').total, 2)
  assert.equal(c('recompra').won, 1)
  assert.equal(c('recompra').real_revenue, 800)
  assert.equal(c('recompra').qualified, null)
  assert.equal(c('recompra').overall_conversion, 50)
  assert.equal(c('recompra').funnel, 'recompra')
})

test('cascata: sem funil = todos e mes invalido = null', () => {
  const { db, s } = setup()
  assert.deepEqual(cascadeFor(db, s.accountId, '2026-10'), cascadeFor(db, s.accountId, '2026-10', null, 'todos'))
  assert.equal(cascadeFor(db, s.accountId, 'x'), null)
})

test('recompra no funil mensal e da turma: recompra de quem entrou antes nao infla o mes', () => {
  const { db, s } = setup()
  // Set: entrou na recompra em setembro e recomprou em outubro
  const set = db.prepare("INSERT INTO leads (account_id, funnel_id, stage_id, name, phone, created_at) VALUES (?, ?, ?, 'Set', '5548999990002', '2026-08-01 09:00:00')").run(s.accountId, s.recompraFunnelId, s.r.aguardando).lastInsertRowid
  db.prepare("INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, NULL, ?, '2026-08-01 09:00:00')").run(set, s.stages.novo)
  db.prepare("INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, ?, ?, '2026-09-15 10:00:00')").run(set, s.stages.novo, s.r.aguardando)
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 100, '2026-09-15 10:00:00')").run(s.accountId, set)
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 200, '2026-10-05 10:00:00')").run(s.accountId, set)
  const c = cascadeFor(db, s.accountId, '2026-10', null, 'recompra')
  assert.equal(c.total, 2)       // Maria e Volta entraram em outubro
  assert.equal(c.won, 1)         // so a Maria (da turma) recomprou
  assert.equal(c.overall_conversion, 50)
  assert.equal(c.real_revenue, 1000) // faturamento do mes continua com todas as recompras (800 + 200)
})

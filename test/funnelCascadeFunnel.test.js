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

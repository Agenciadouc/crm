import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import {
  parseFunnelFilter, kindAtSql, firstKindSql, kindAtWhere, currentFunnelWhere,
  leadListFunnelWhere, periodLeadsSql, salesWhere, amdSource, hasRepurchaseFunnel,
} from '../server/services/funnelFilter.js'

function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('parseFunnelFilter: valores validos e o resto vira todos', () => {
  assert.equal(parseFunnelFilter({ funnel: 'vendas' }), 'vendas')
  assert.equal(parseFunnelFilter({ funnel: 'RECOMPRA' }), 'recompra')
  assert.equal(parseFunnelFilter({ funnel: 'x' }), 'todos')
  assert.equal(parseFunnelFilter({}), 'todos')
  assert.equal(parseFunnelFilter(undefined), 'todos')
})

test('kindAtSql: funil do lead em cada instante', () => {
  const { db, s } = setup()
  const at = (id, t) => db.prepare(`SELECT ${kindAtSql(String(id), `'${t}'`)} k`).get().k
  assert.equal(at(s.maria, '2026-10-05 00:00:00'), 'vendas')
  assert.equal(at(s.maria, '2026-10-11 00:00:00'), 'recompra')
  assert.equal(at(s.volta, '2026-10-10 00:00:00'), 'recompra')
  assert.equal(at(s.volta, '2026-10-21 00:00:00'), 'vendas')
  assert.equal(at(s.antigo, '2026-10-21 00:00:00'), 'vendas') // sem historico: funil atual
})

test('firstKindSql: funil em que o lead nasceu', () => {
  const { db, s } = setup()
  const k = id => db.prepare(`SELECT ${firstKindSql(String(id))} k`).get().k
  assert.equal(k(s.maria), 'vendas')
  assert.equal(k(s.volta), 'vendas')
  assert.equal(k(s.antigo), 'vendas')
})

test('currentFunnelWhere e leadListFunnelWhere: listas pelo funil atual; funnel_id manda', () => {
  const { db, s } = setup()
  const names = f => db.prepare(`SELECT name FROM leads l WHERE l.account_id = ?${currentFunnelWhere('l', f)} ORDER BY name`).all(s.accountId).map(r => r.name)
  assert.deepEqual(names('vendas'), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(names('recompra'), ['Maria'])
  assert.deepEqual(names('todos'), ['Antigo', 'Joao', 'Maria', 'Volta'])
  assert.equal(leadListFunnelWhere('l', { funnel: 'recompra', funnel_id: '3' }), '')
  assert.equal(leadListFunnelWhere('l', { funnel: 'recompra' }), currentFunnelWhere('l', 'recompra'))
})

test('periodLeadsSql: leads do periodo pela historia', () => {
  const { db, s } = setup()
  const count = f => db.prepare(`
    SELECT COUNT(DISTINCT l.id) c FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id
    WHERE l.account_id = ? AND p.period_at >= '2026-10-01' AND p.period_at < '2026-11-01'`).get(s.accountId).c
  assert.equal(count('vendas'), 3)   // Maria, Joao, Antigo (Volta nasceu em setembro)
  assert.equal(count('recompra'), 2) // Maria (dia 10) e Volta (dia 3), uma vez cada
  assert.equal(count('todos'), 3)    // igual hoje: criados em outubro
})

test('salesWhere: 1a compra e nova, 2a em diante e recompra (desempate por id)', () => {
  const { db, s } = setup()
  const sum = f => db.prepare(`SELECT COALESCE(SUM(ls.value),0) v FROM lead_sales ls WHERE ls.account_id = ?${salesWhere('ls', f)}`).get(s.accountId).v
  assert.equal(sum('vendas'), 1500)
  assert.equal(sum('recompra'), 800)
  assert.equal(sum('todos'), 2300)
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 100, '2026-10-10 10:00:00')").run(s.accountId, s.maria)
  assert.equal(sum('vendas'), 1500) // mesma data: so a de menor id e a 1a
})

test('kindAtWhere: vazio em todos', () => {
  assert.equal(kindAtWhere('l.id', 'x', 'todos'), '')
  assert.match(kindAtWhere('l.id', 'x', 'vendas'), /= 'vendas'/)
})

test('amdSource: tabela antiga em todos, nova filtrada nos outros', () => {
  assert.equal(amdSource('todos'), 'attendant_metrics_daily')
  assert.match(amdSource('recompra'), /attendant_metrics_daily_funnel WHERE funnel_kind = 'recompra'/)
})

test('hasRepurchaseFunnel por conta', () => {
  const { db, s } = setup()
  assert.equal(hasRepurchaseFunnel(db, s.accountId), true)
  assert.equal(hasRepurchaseFunnel(db, s.otherAccountId), false)
})

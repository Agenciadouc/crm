import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { insightFunnelWhere } from '../server/services/funnelFilter.js'

test('insightFunnelWhere: insight conta no funil do lead na data da analise', () => {
  const db = createLtvTestDb(); const s = seedMaria(db)
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, analyzed_at) VALUES (?, ?, '2026-10-26 00:00:00')").run(s.accountId, s.maria)
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, analyzed_at) VALUES (?, ?, '2026-10-06 00:00:00')").run(s.accountId, s.joao)
  const n = f => db.prepare(`SELECT COUNT(*) c FROM conversation_insights ci WHERE ci.account_id = ?${insightFunnelWhere('ci.lead_id', 'ci.analyzed_at', f)}`).get(s.accountId).c
  assert.equal(n('recompra'), 1)
  assert.equal(n('vendas'), 1)
  assert.equal(n('todos'), 2)
})

test('insightFunnelWhere: alerta sem lead so entra em todos', () => {
  const db = createLtvTestDb(); const s = seedMaria(db)
  db.prepare("INSERT INTO analyst_alerts (account_id, lead_id, type, created_at) VALUES (?, NULL, 'x', '2026-10-06 00:00:00')").run(s.accountId)
  const n = f => db.prepare(`SELECT COUNT(*) c FROM analyst_alerts a WHERE a.account_id = ?${insightFunnelWhere('a.lead_id', 'a.created_at', f)}`).get(s.accountId).c
  assert.equal(n('todos'), 1)
  assert.equal(n('vendas'), 0)
  assert.equal(n('recompra'), 0)
})

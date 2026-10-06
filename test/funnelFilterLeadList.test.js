import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { leadListWhere } from '../server/services/funnelFilter.js'

test('leadListWhere: ?funnel filtra pelo funil atual; funnel_id manda', () => {
  const db = createLtvTestDb(); const s = seedMaria(db)
  const run = q => {
    const w = leadListWhere('l', q)
    return db.prepare(`SELECT name FROM leads l WHERE l.account_id = ?${w.sql} ORDER BY name`).all(s.accountId, ...w.params).map(r => r.name)
  }
  assert.deepEqual(run({ funnel: 'recompra' }), ['Maria'])
  assert.deepEqual(run({ funnel: 'vendas' }), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(run({ funnel: 'recompra', funnel_id: String(s.vendasFunnelId) }), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(run({}), ['Antigo', 'Joao', 'Maria', 'Volta'])
})

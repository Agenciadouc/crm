// Tipo de contato (spec 2026-10-05 crm simples §2): quem nao e cliente em potencial sai dos
// numeros e das automacoes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { CONTACT_TYPES, contactTypeOf, canAutomate, countsInMetrics, parseContactType } from '../server/services/contacts/scope.js'
import { applyContactSchema } from '../server/services/contacts/schema.js'

test('tipos e regras', () => {
  assert.deepEqual(CONTACT_TYPES, ['lead', 'cliente', 'revendedor', 'interno'])
  assert.equal(contactTypeOf({}), 'lead')
  assert.equal(contactTypeOf({ contact_type: 'interno' }), 'interno')
  assert.equal(canAutomate({}), true)
  assert.equal(canAutomate({ contact_type: 'cliente' }), true)
  assert.equal(canAutomate({ contact_type: 'revendedor' }), false)
  assert.equal(canAutomate({ contact_type: 'interno' }), false)
  assert.equal(canAutomate(null), false)
  assert.equal(parseContactType('cliente'), 'cliente')
  assert.throws(() => parseContactType('xx'), /Tipo de contato inválido/)
})

test('schema idempotente e filtro de metricas conta lead e cliente (sem tipo = lead)', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  applyContactSchema(db); applyContactSchema(db)
  const mk = t => { const id = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo }); if (t) db.prepare('UPDATE leads SET contact_type = ? WHERE id = ?').run(t, id); return id }
  mk(null); mk('cliente'); mk('revendedor'); mk('interno')
  const n = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE l.account_id = ? AND ${countsInMetrics('l')}`).get(s.accountId).n
  assert.equal(n, 2)
  const n2 = db.prepare(`SELECT COUNT(*) n FROM leads WHERE account_id = ? AND ${countsInMetrics()}`).get(s.accountId).n
  assert.equal(n2, 2)
})

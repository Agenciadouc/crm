import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canManageInstance, HOLD_SENDS_FORBIDDEN_MSG } from '../server/services/instanceOwnership.js'

// Regra do middleware allowInstanceOwner (server/routes/integrations.js), separada da
// consulta ao banco: gerente/admin alcancam qualquer numero da conta; atendente so o dele.
// PUT /whatsapp/:id/auto-messages aceita atendente (mensagem e ausencia do proprio numero),
// mas hold_sends_outside_hours mexe na trava de envios do numero — ai vale a mesma regra.

test('gerente e super_admin alcancam qualquer numero da conta', () => {
  assert.equal(canManageInstance('gerente', null, 7), true)
  assert.equal(canManageInstance('super_admin', null, 7), true)
})

test('atendente alcanca o proprio numero', () => {
  assert.equal(canManageInstance('atendente', 7, 7), true)
  assert.equal(canManageInstance('atendente', 7, '7'), true, 'req.params.id chega como texto')
})

test('atendente NAO alcanca numero de outro atendente', () => {
  assert.equal(canManageInstance('atendente', 7, 8), false)
})

test('atendente sem numero proprio nao alcanca nada', () => {
  assert.equal(canManageInstance('atendente', null, 8), false)
  assert.equal(canManageInstance('atendente', 0, 0), false)
})

test('o 403 explica em portugues quem pode mexer na trava', () => {
  assert.match(HOLD_SENDS_FORBIDDEN_MSG, /gerente/)
  assert.match(HOLD_SENDS_FORBIDDEN_MSG, /horário/)
})

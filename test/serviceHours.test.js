import { test } from 'node:test'
import assert from 'node:assert/strict'
import { businessHoursUpdate } from '../server/services/serviceHours.js'

const H = '{"mon":[{"start":"09:00","end":"18:00"}],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'

test('sem o campo no corpo, nao mexe na trava (chamadas antigas)', () => {
  assert.deepEqual(businessHoursUpdate({ away_text: 'x' }, H), { touch: false, value: null })
})

test('corpo nulo nao mexe na trava', () => {
  assert.deepEqual(businessHoursUpdate(null, null), { touch: false, value: null })
})

test('segurar envios grava o mesmo horario da ausencia', () => {
  assert.deepEqual(businessHoursUpdate({ hold_sends_outside_hours: true }, H), { touch: true, value: H })
})

test('desligado volta a trava para 24 horas (NULL)', () => {
  assert.deepEqual(businessHoursUpdate({ hold_sends_outside_hours: false }, H), { touch: true, value: null })
})

test('segurar sem horario e recusado', () => {
  const r = businessHoursUpdate({ hold_sends_outside_hours: true }, null)
  assert.equal(r.touch, false)
  assert.match(r.error, /horário de atendimento/)
})

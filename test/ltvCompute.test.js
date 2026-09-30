import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDate, addDays, daysBetween, customerStats, curveFor, tierFor, median, suggestRemindDays, staleBand, validateCurve, dueIso } from '../server/services/ltv/compute.js'

const CURVE = { a: 30, b: 45, c: 60 }

test('localDate usa horário de Brasília', () => {
  assert.equal(localDate(new Date('2026-09-30T02:00:00Z')), '2026-09-29') // 23h de 29/09 em Brasília
  assert.equal(localDate(new Date('2026-09-30T03:00:00Z')), '2026-09-30')
})

test('addDays e daysBetween', () => {
  assert.equal(addDays('2026-09-20 14:00:00', 15), '2026-10-05')
  assert.equal(daysBetween('2026-09-01', '2026-10-01'), 30)
})

test('customerStats sem vendas', () => {
  assert.deepEqual(customerStats([], { today: '2026-09-29', curve: CURVE }), { ltv: 0, purchases: 0, lastPurchaseAt: null, avgIntervalDays: null, curve: null })
})

test('uma compra = 1a', () => {
  const r = customerStats([{ value: 100, sale_date: '2026-09-01 10:00:00' }], { today: '2026-09-10', curve: CURVE })
  assert.equal(r.curve, '1a'); assert.equal(r.ltv, 100); assert.equal(r.purchases, 1); assert.equal(r.lastPurchaseAt, '2026-09-01')
})

test('duas vendas no mesmo dia não criam intervalo', () => {
  const r = customerStats([{ value: 50, sale_date: '2026-09-01 10:00:00' }, { value: 70, sale_date: '2026-09-01 18:00:00' }], { today: '2026-09-02', curve: CURVE })
  assert.equal(r.purchases, 2); assert.equal(r.avgIntervalDays, null); assert.equal(r.curve, '1a'); assert.equal(r.ltv, 120)
})

test('ritmo de 20 dias = A; parado 50 dias cai para C; parado 70 = D', () => {
  const sales = [{ value: 100, sale_date: '2026-07-01' }, { value: 100, sale_date: '2026-07-21' }, { value: 100, sale_date: '2026-08-10' }]
  assert.equal(customerStats(sales, { today: '2026-08-20', curve: CURVE }).curve, 'A')
  assert.equal(customerStats(sales, { today: '2026-09-29', curve: CURVE }).curve, 'C') // 50 dias
  assert.equal(customerStats(sales, { today: '2026-10-19', curve: CURVE }).curve, 'D') // 70 dias
  assert.equal(customerStats(sales, { today: '2026-08-20', curve: CURVE }).avgIntervalDays, 20)
})

test('curveFor limites inclusivos', () => {
  assert.equal(curveFor({ avgIntervalDays: 30, daysSinceLast: 0 }, CURVE), 'A')
  assert.equal(curveFor({ avgIntervalDays: 31, daysSinceLast: 0 }, CURVE), 'B')
  assert.equal(curveFor({ avgIntervalDays: 45, daysSinceLast: 0 }, CURVE), 'B')
  assert.equal(curveFor({ avgIntervalDays: 60, daysSinceLast: 0 }, CURVE), 'C')
  assert.equal(curveFor({ avgIntervalDays: 61, daysSinceLast: 0 }, CURVE), 'D')
  assert.equal(curveFor({ avgIntervalDays: null, daysSinceLast: 5 }, CURVE), '1a')
})

test('tierFor pega o maior alcançado', () => {
  const tiers = [{ id: 1, min_ltv: 2000 }, { id: 2, min_ltv: 5000 }]
  assert.equal(tierFor(1999.99, tiers), null)
  assert.equal(tierFor(2000, tiers), 1)
  assert.equal(tierFor(8000, tiers), 2)
  assert.equal(tierFor(8000, []), null)
})

test('median', () => {
  assert.equal(median([]), null)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([1, 2, 3, 4]), 2.5)
})

test('suggestRemindDays só com 10+ casos e 20% acima', () => {
  assert.equal(suggestRemindDays({ medianDays: 41, markedDays: 30, cases: 9 }), null)
  assert.equal(suggestRemindDays({ medianDays: 35, markedDays: 30, cases: 20 }), null) // 16,7% acima
  assert.equal(suggestRemindDays({ medianDays: 41, markedDays: 30, cases: 20 }), 45)
})

test('staleBand', () => {
  assert.equal(staleBand(29), null); assert.equal(staleBand(30), '30-60'); assert.equal(staleBand(60), '30-60')
  assert.equal(staleBand(61), '61-90'); assert.equal(staleBand(180), '91-180'); assert.equal(staleBand(181), '181+')
})

test('validateCurve', () => {
  assert.deepEqual(validateCurve({ a: 30, b: 45, c: 60 }), { ok: true })
  assert.equal(validateCurve({ a: 45, b: 45, c: 60 }).ok, false)
  assert.equal(validateCurve({ a: 0, b: 45, c: 60 }).ok, false)
  assert.equal(validateCurve({ a: 30, b: 45, c: 400 }).ok, false)
  assert.equal(validateCurve({ a: 1.5, b: 45, c: 60 }).ok, false)
})

test('dueIso: 09h de Brasília no dia, ou agora se já passou', () => {
  assert.equal(dueIso('2026-10-10', new Date('2026-09-29T15:00:00Z')), '2026-10-10T12:00:00.000Z')
  assert.equal(dueIso('2026-09-20', new Date('2026-09-29T15:00:00Z')), '2026-09-29T15:00:00.000Z')
})

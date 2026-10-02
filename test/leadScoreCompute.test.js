import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLeadScore, bandFor, fitGrade, quadrantFor } from '../server/services/leadScore/compute.js'
import { computeHalfLife, accountCycleDays } from '../server/services/leadScore/halfLife.js'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'

const base = () => ({
  fit: { obtained: 0, max: 0, answeredCount: 0, totalCount: 0, reasons: [] },
  engagement: { daysSinceLastInbound: null, halfLifeDays: 7, replyDelaysMin: [], lastOutboundReplied: [], advancedLast7d: false, strongSignalLast7d: false, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false },
  ai: { temperatura: null, chance: null, analyzedDaysAgo: null },
})

test('faixas, letra e matriz', () => {
  assert.deepEqual([0, 30, 31, 60, 61, 85, 86, 100].map(bandFor), ['frio', 'frio', 'morno', 'morno', 'quente', 'quente', 'pronto', 'pronto'])
  assert.deepEqual([50, 38, 37, 25, 24, 13, 12, 0].map(fitGrade), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'])
  assert.equal(quadrantFor('A', 25), 'atender_agora')
  assert.equal(quadrantFor('B', 24), 'reaquecer')
  assert.equal(quadrantFor('C', 30), 'qualificar')
  assert.equal(quadrantFor('D', 0), 'baixa')
})

test('lead sem nada: nota 0, frio, perfil D desconhecido', () => {
  const r = computeLeadScore(base())
  assert.equal(r.score, 0); assert.equal(r.band, 'frio'); assert.equal(r.fitGrade, 'D')
  assert.ok(r.reasons.some(x => x.grupo === 'perfil' && /desconhecido/.test(x.texto)))
})

test('perfil proporcional, com pontos negativos e sem passar de 0..50', () => {
  const i = base(); i.fit = { obtained: 36, max: 60, answeredCount: 3, totalCount: 4, reasons: [{ texto: 'Orçamento: acima de R$20 mil', pontos: 30 }] }
  assert.equal(computeLeadScore(i).fit, 30)
  i.fit.obtained = -10
  assert.equal(computeLeadScore(i).fit, 0)
  i.fit.obtained = 80
  assert.equal(computeLeadScore(i).fit, 50)
})

test('engajamento: recencia com meia-vida, rapidez, reciprocidade, intensidade', () => {
  const i = base()
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [5, 3, 8], lastOutboundReplied: [true, true, true, false, true], advancedLast7d: true, strongSignalLast7d: true, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false }
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 20 + 10 + 8 + 10) // 48
  i.engagement.daysSinceLastInbound = 7 // uma meia-vida: 10
  i.engagement.replyDelaysMin = [120] // < 6h: 4
  i.engagement.advancedLast7d = false
  i.engagement.strongSignalLast7d = false
  i.engagement.weakSignalConfirmedLast7d = true // fraco confirmado: 5
  assert.equal(computeLeadScore(i).engagement, 10 + 4 + 8 + 5)
  i.engagement.replyDelaysMin = []
  i.engagement.daysSinceLastInbound = null
  assert.equal(computeLeadScore(i).engagement, 0 + 0 + 8 + 5)
})

test('rapidez usa a mediana', () => {
  const i = base(); i.engagement.replyDelaysMin = [2, 500, 30] // mediana 30 min -> 7
  assert.equal(computeLeadScore(i).engagement, 7)
})

test('ajuste da IA so com analise de ate 7 dias', () => {
  const i = base(); i.ai = { temperatura: 'quente', chance: 80, analyzedDaysAgo: 2 }
  assert.equal(computeLeadScore(i).aiAdjust, 15)
  i.ai = { temperatura: 'frio', chance: 10, analyzedDaysAgo: 1 }
  assert.equal(computeLeadScore(i).aiAdjust, -15)
  i.ai.analyzedDaysAgo = 8
  assert.equal(computeLeadScore(i).aiAdjust, 0)
})

test('nota final limitada a 0..100 e porque ordenado por grupo', () => {
  const i = base()
  i.fit = { obtained: 60, max: 60, answeredCount: 4, totalCount: 4, reasons: [{ texto: 'Orçamento: acima de R$20 mil', pontos: 30 }] }
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [1], lastOutboundReplied: [true, true, true, true, true], advancedLast7d: true, strongSignalLast7d: false, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false }
  i.ai = { temperatura: 'quente', chance: 90, analyzedDaysAgo: 0 }
  const r = computeLeadScore(i)
  assert.equal(r.score, 100); assert.equal(r.band, 'pronto'); assert.equal(r.quadrant, 'atender_agora')
  assert.deepEqual([...new Set(r.reasons.map(x => x.grupo))], ['perfil', 'engajamento', 'ia'])
})

test('meia-vida: menos de 5 vendas = 7; 30% da mediana; limites 2..30', () => {
  assert.equal(computeHalfLife([10, 20]), 7)
  assert.equal(computeHalfLife([10, 20, 30, 40, 50]), 9) // mediana 30 -> 9
  assert.equal(computeHalfLife([1, 1, 1, 2, 3]), 2)
  assert.equal(computeHalfLife([200, 200, 300, 300, 400]), 30)
})

test('accountCycleDays: ciclos de 10 e 20 dias', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)

  // Criar 2 leads: o primeiro criado 40 dias atrás, com venda 10 dias depois
  const lead1Id = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo.id })
  db.prepare(`UPDATE leads SET created_at = datetime('now', '-40 days', 'start of day') WHERE id = ?`).run(lead1Id)
  db.prepare(`INSERT INTO lead_sales (account_id, lead_id, sale_date) VALUES (?, ?, datetime('now', '-40 days', 'start of day', '+10 days'))`).run(accountId, lead1Id)

  // Segundo lead: criado 30 dias atrás, com venda 20 dias depois (total)
  const lead2Id = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo.id })
  db.prepare(`UPDATE leads SET created_at = datetime('now', '-30 days', 'start of day') WHERE id = ?`).run(lead2Id)
  db.prepare(`INSERT INTO lead_sales (account_id, lead_id, sale_date) VALUES (?, ?, datetime('now', '-30 days', 'start of day', '+20 days'))`).run(accountId, lead2Id)

  const cycles = accountCycleDays(db, accountId).sort((a, b) => a - b)
  assert.deepEqual(cycles.map(c => Math.round(c)), [10, 20])
})

test('intensity: forte sozinho vale 10 (sem avanco de etapa)', () => {
  const i = base()
  i.engagement.strongSignalLast7d = true
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 10)
})

test('intensity: fraco confirmado sozinho vale 5', () => {
  const i = base()
  i.engagement.weakSignalConfirmedLast7d = true
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 5)
})

test('intensity: negativo desconta 10, mesmo com forte confirmado (nao se cancelam escondido, o negativo domina quando e maior)', () => {
  const i = base()
  i.engagement.strongSignalLast7d = true
  i.engagement.negativeSignalLast7d = true
  const r = computeLeadScore(i)
  // forte (+10) com negativo (-10) juntos: intensity liquida 0, engagement so com os outros fatores (0 aqui)
  assert.equal(r.engagement, 0)
})

test('engagement nunca fica negativo mesmo com negativo isolado (piso 0)', () => {
  const i = base()
  i.engagement.negativeSignalLast7d = true
  const r = computeLeadScore(i)
  assert.ok(r.engagement >= 0, `engagement nao pode ser negativo, veio ${r.engagement}`)
  assert.equal(r.engagement, 0)
})

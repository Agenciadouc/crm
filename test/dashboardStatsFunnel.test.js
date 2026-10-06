import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { computeDashboardStats, computeAgentStats } from '../server/services/dashboardStats.js'

const NOW = new Date('2026-10-31T12:00:00Z')
function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('stats nos tres modos (30 dias ate 31/10)', () => {
  const { db, s } = setup()
  const st = f => computeDashboardStats(db, s.accountId, { days: '30', funnel: f }, NOW)
  assert.equal(st('todos').totalLeads, 3)
  assert.equal(st('vendas').totalLeads, 3)
  assert.equal(st('recompra').totalLeads, 2)
  assert.equal(st('vendas').conversionRate, (1 / 3) * 100)   // 1 primeira venda / 3 leads
  assert.equal(st('recompra').conversionRate, (1 / 2) * 100) // 1 recompra / 2 entradas
  assert.deepEqual(st('recompra').byStage.map(x => x.name), ['Aguardando', 'Em conversa'])
  assert.deepEqual(st('vendas').byStage.map(x => x.name), ['Novo', 'Qualificando', 'Proposta', 'Venda', 'Perdido'])
  assert.equal(st('recompra').funnel, 'recompra')
  assert.deepEqual(st('recompra').bySource.map(x => x.count).reduce((a, b) => a + b, 0), 2)
})

test('conversao e da turma do periodo: venda de lead antigo nao passa de 100%', () => {
  const { db, s } = setup()
  // Volta nasceu em setembro (fora da turma de vendas de outubro) e faz a 1a compra em outubro
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 50, '2026-10-15 10:00:00')").run(s.accountId, s.volta)
  const st = computeDashboardStats(db, s.accountId, { days: '30', funnel: 'vendas' }, NOW)
  assert.equal(st.conversionRate, (1 / 3) * 100) // so a Maria, da turma de outubro, comprou
  assert.ok(st.conversionRate <= 100)
})

test('stats: outra conta nao vaza e sem ?funnel = todos', () => {
  const { db, s } = setup()
  const a = computeDashboardStats(db, s.accountId, { days: '30' }, NOW)
  const b = computeDashboardStats(db, s.accountId, { days: '30', funnel: 'todos' }, NOW)
  assert.deepEqual(a, b)
  assert.equal(computeDashboardStats(db, s.otherAccountId, { days: '30', funnel: 'vendas' }, NOW).totalLeads, 1)
})

test('agents: periodo e conversoes de recompra por atendente', () => {
  const { db, s } = setup()
  db.prepare('UPDATE leads SET attendant_id = ? WHERE id IN (?, ?)').run(s.atendenteId, s.maria, s.joao)
  const ana = f => computeAgentStats(db, s.accountId, { days: '30', funnel: f }, NOW).agents.find(a => a.id === s.atendenteId)
  assert.equal(ana('vendas').leads_period, 2)
  assert.equal(ana('recompra').leads_period, 1)
  assert.equal(ana('recompra').leads_total, 1)
  assert.equal(ana('recompra').conversions, 1)
})

test('venda no mesmo dia em que o lead chegou conta na conversao (horario da venda antes da chegada)', () => {
  const { db, s } = setup()
  const hoje = db.prepare("INSERT INTO leads (account_id, funnel_id, stage_id, name, phone, created_at) VALUES (?, ?, ?, 'Hoje', '5548999990001', '2026-10-20 14:00:00')").run(s.accountId, s.vendasFunnelId, s.stages.novo).lastInsertRowid
  db.prepare("INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, NULL, ?, '2026-10-20 14:00:00')").run(hoje, s.stages.novo)
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 300, '2026-10-20 12:00:00')").run(s.accountId, hoje)
  const st = computeDashboardStats(db, s.accountId, { days: '30', funnel: 'vendas' }, NOW)
  assert.equal(st.totalLeads, 4)
  assert.equal(st.conversionRate, (2 / 4) * 100) // Maria e Hoje
})

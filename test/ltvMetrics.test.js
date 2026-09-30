import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { recalcAccountCustomers } from '../server/services/ltv/customer.js'
import { onSaleCreated, recordOutcome, openCycleForLead } from '../server/services/ltv/cycles.js'
import { overview, listCustomers, repurchaseStats, staleStats, createStaleTasks } from '../server/services/ltv/metrics.js'
import { customerWhere } from '../server/services/ltv/filters.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function world() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const lead = (name, attendant = s.atendenteId) => addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name, attendant_id: attendant })
  const ana = lead('Ana'); const bia = lead('Bia'); const caio = lead('Caio', s.gerenteId)
  addSale(db, { accountId: s.accountId, leadId: ana, value: 100, saleDate: '2026-08-01', kind: 'recompra', remindDays: 30 })
  addSale(db, { accountId: s.accountId, leadId: ana, value: 300, saleDate: '2026-09-15', kind: 'recompra', remindDays: 30 }) // voltou em 45 dias
  addSale(db, { accountId: s.accountId, leadId: bia, value: 1000, saleDate: '2026-05-01' }) // 1 compra, 151 dias parada
  addSale(db, { accountId: s.accountId, leadId: caio, value: 50, saleDate: '2026-09-20' })
  db.prepare("INSERT INTO customer_tiers (account_id, name, min_ltv) VALUES (?, 'Diamante', 900)").run(s.accountId)
  recalcAccountCustomers(db, s.accountId, { now: NOW })
  return { db, s, ana, bia, caio, scope: { accountId: s.accountId } }
}

test('overview', () => {
  const { db, scope } = world()
  const o = overview(db, scope, { now: NOW })
  assert.equal(o.clients, 3)
  assert.equal(o.ltvAvg, 483.33)
  assert.equal(o.ticketAvg, 362.5)
  assert.equal(o.repeatPct, 33.3)
  assert.equal(o.byCurve['1a'].count, 2)
  assert.equal(o.byTier[0].count, 1)
  assert.equal(o.repurchase.cases, 1); assert.equal(o.repurchase.medianDays, 45); assert.equal(o.repurchase.markedDays, 30)
})

test('vendedor só vê os seus', () => {
  const { db, s } = world()
  assert.equal(overview(db, { accountId: s.accountId, attendantId: s.atendenteId }, { now: NOW }).clients, 2)
  assert.equal(listCustomers(db, { accountId: s.accountId, attendantId: s.atendenteId }, { now: NOW }).total, 2)
})

test('listCustomers filtra por curva e selo e ordena por LTV', () => {
  const { db, scope, bia } = world()
  const all = listCustomers(db, scope, { now: NOW })
  assert.equal(all.rows[0].id, bia)
  assert.equal(listCustomers(db, scope, { curve: '1a', now: NOW }).total, 2)
  const diamante = db.prepare("SELECT id FROM customer_tiers WHERE name = 'Diamante'").get().id
  assert.equal(listCustomers(db, scope, { tierId: diamante, now: NOW }).total, 1)
})

test('repurchaseStats conta desfechos, motivos e tentativa', () => {
  const { db, s, ana, scope } = world()
  const saleId = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC').get(ana).id
  onSaleCreated(db, { saleId, now: NOW })
  const reasonId = db.prepare("SELECT id FROM repurchase_reasons WHERE grp = 'nao_agora' AND account_id = ? ORDER BY position").get(s.accountId).id
  recordOutcome(db, { leadId: ana, outcome: 'nao_agora', reasonId, now: NOW })
  const r = repurchaseStats(db, scope, {})
  assert.equal(r.naoAgora, 1)
  assert.equal(r.reasons.nao_agora.find(x => x.id === reasonId).count, 1)
  assert.equal(r.byKind.recompra.total, 1)
})

test('staleStats: faixas e atrasados', () => {
  const { db, s, ana, scope } = world()
  const st = staleStats(db, scope, { now: NOW })
  const biaBand = st.bands.find(b => b.band === '91-180')
  assert.equal(biaBand.count, 1)
  const saleId = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC').get(ana).id
  onSaleCreated(db, { saleId, now: NOW })
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar', remind_at = '2026-09-20' WHERE lead_id = ?").run(ana)
  const st2 = staleStats(db, scope, { now: NOW })
  assert.equal(st2.late.count, 1); assert.equal(st2.late.value, 200)
  const w = customerWhere('l', { repurchase_late: '1' }, NOW)
  const n = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE l.account_id = ? ${w.sql}`).get(s.accountId, ...w.params).n
  assert.equal(n, 1)
})

test('createStaleTasks cria no máximo 200 e ignora lead de outra conta', () => {
  const { db, s, bia } = world()
  const other = addLead(db, { account_id: s.otherAccountId, name: 'X' })
  const r = createStaleTasks(db, { accountId: s.accountId, leadIds: [bia, other], userId: s.gerenteId, now: NOW })
  assert.equal(r.created, 1)
  assert.match(db.prepare('SELECT title FROM standalone_tasks WHERE lead_id = ?').get(bia).title, /Reativar Bia/)
  const many = Array.from({ length: 250 }, () => bia)
  assert.equal(createStaleTasks(db, { accountId: s.accountId, leadIds: many, userId: s.gerenteId, now: NOW }).created, 1) // dedup por lead
})

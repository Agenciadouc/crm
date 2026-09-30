import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { openCycleForLead } from '../server/services/ltv/cycles.js'
import { validateSaleInput, registerSale, patchSale, deleteSale, outcomeStageBlocked } from '../server/services/ltv/sales.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function base() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.proposta, name: 'Ana' })
  return { db, s, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) }
}

test('validateSaleInput', () => {
  assert.equal(validateSaleInput({ value: 0, sale_kind: 'unica' }).ok, false)
  assert.equal(validateSaleInput({ value: 10 }).ok, false) // tipo obrigatório
  assert.equal(validateSaleInput({ value: 10 }, { requireKind: false }).ok, true)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'recompra' }).ok, false) // sem prazo
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'recompra', remind_days: 20 }).ok, false)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'unica', cross_sell: true }).ok, false) // sem prazo
  const ok = validateSaleInput({ value: '99.9', sale_kind: 'unica', cross_sell: true, remind_days: 15, cross_sell_offer: 'espetos', product: 'x'.repeat(300) })
  assert.equal(ok.ok, true); assert.equal(ok.fields.product.length, 200); assert.equal(ok.fields.value, 99.9); assert.equal(ok.fields.crossSell, 1)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'unica', remind_days: 30 }).fields.remindDays, null) // única sem oferta ignora prazo
})

test('registerSale grava, recalcula e leva para Aguardando', async () => {
  const { db, s, lead } = base()
  const r = await registerSale(db, { lead, body: { value: 450, sale_kind: 'recompra', remind_days: 30, product: 'Pilates' }, userId: s.atendenteId, now: NOW })
  assert.equal(r.ok, true); assert.equal(r.total, 450); assert.ok(r.cycleId)
  const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(l.value_estimated, 450); assert.equal(l.ltv, 450); assert.equal(l.stage_id, stageIdByKey(db, s.accountId, 'aguardando'))
  assert.equal(r.sale.product, 'Pilates'); assert.equal(r.sale.sale_kind, 'recompra')
})

test('venda retroativa já vencida cria a tarefa na hora', async () => {
  const { db, s, lead } = base()
  await registerSale(db, { lead, body: { value: 100, sale_kind: 'recompra', remind_days: 30, sale_date: '2026-08-01' }, userId: s.atendenteId, now: NOW })
  assert.equal(openCycleForLead(db, lead.id).status, 'a_contatar')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks WHERE lead_id = ?').get(lead.id).n, 1)
})

test('patchSale marca tipo em venda antiga e abre ciclo', async () => {
  const { db, s, lead } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId: lead.id, saleDate: '2026-09-20 10:00:00' })
  const r = await patchSale(db, { lead, saleId, body: { sale_kind: 'recompra', remind_days: 30 }, userId: s.gerenteId, now: NOW })
  assert.equal(r.ok, true)
  assert.equal(openCycleForLead(db, lead.id).remind_at, '2026-10-20')
  const again = await patchSale(db, { lead, saleId, body: { sale_kind: 'unica' }, userId: s.gerenteId, now: NOW })
  assert.equal(again.ok, false); assert.equal(again.status, 409) // tipo já marcado
})

test('deleteSale recalcula e encerra ciclo', async () => {
  const { db, s, lead } = base()
  const r = await registerSale(db, { lead, body: { value: 100, sale_kind: 'recompra', remind_days: 30 }, userId: s.atendenteId, now: NOW })
  const d = deleteSale(db, { lead, saleId: r.sale.id, now: NOW })
  assert.equal(d.total, 0)
  assert.equal(openCycleForLead(db, lead.id), null)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(lead.id).ltv, 0)
})

test('outcomeStageBlocked', () => {
  const { db, s } = base()
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'nao_agora')), true)
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'nao_quer')), true)
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'comprou')), false)
  assert.equal(outcomeStageBlocked(db, s.stages.novo), false)
})

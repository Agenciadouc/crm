import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { onSaleCreated, onSaleDeleted, recordOutcome, undoOptOut, onMessageExchanged, openCycleForLead, syncCycleWithStage } from '../server/services/ltv/cycles.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function base() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, attendant_id: s.atendenteId })
  return { db, s, leadId }
}
const stageOf = (db, id) => db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(id).stage_id
const reason = (db, accountId, grp) => db.prepare('SELECT id FROM repurchase_reasons WHERE account_id = ? AND grp = ? ORDER BY position LIMIT 1').get(accountId, grp).id

test('venda "pode recomprar" abre ciclo e leva o lead para Aguardando', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-09-29 10:00:00' })
  const r = onSaleCreated(db, { saleId, now: NOW })
  assert.equal(r.dueNow, false)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'aguardando'); assert.equal(c.remind_at, '2026-10-29'); assert.equal(c.kind, 'recompra'); assert.equal(c.attempt, 1)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'aguardando'))
})

test('compra única com oferta abre ciclo "cruzada"; sem oferta não mexe', () => {
  const { db, s, leadId } = base()
  const s1 = addSale(db, { accountId: s.accountId, leadId, kind: 'unica' })
  assert.equal(onSaleCreated(db, { saleId: s1, now: NOW }).cycleId, null)
  assert.equal(stageOf(db, leadId), s.stages.venda)
  const s2 = addSale(db, { accountId: s.accountId, leadId, kind: 'unica', crossSell: 1, remindDays: 15, offer: 'espetos', saleDate: '2026-09-29' })
  onSaleCreated(db, { saleId: s2, now: NOW })
  const c = openCycleForLead(db, leadId)
  assert.equal(c.kind, 'cruzada'); assert.equal(c.offer_text, 'espetos'); assert.equal(c.remind_at, '2026-10-14')
})

test('venda retroativa já vencida volta dueNow', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-10 10:00:00' })
  assert.equal(onSaleCreated(db, { saleId, now: NOW }).dueNow, true)
})

test('nova venda fecha o ciclo aberto como comprou e abre outro', () => {
  const { db, s, leadId } = base()
  const a = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-01' })
  onSaleCreated(db, { saleId: a, now: NOW })
  const first = openCycleForLead(db, leadId)
  db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa' WHERE id = ?").run(first.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, first.id, leadId)
  const b = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 45, saleDate: '2026-09-29' })
  onSaleCreated(db, { saleId: b, now: NOW })
  assert.equal(db.prepare('SELECT status FROM repurchase_cycles WHERE id = ?').get(first.id).status, 'comprou')
  assert.equal(db.prepare('SELECT outcome FROM repurchase_attempts WHERE cycle_id = ?').get(first.id).outcome, 'comprou')
  const now2 = openCycleForLead(db, leadId)
  assert.equal(now2.attempt, 1); assert.equal(now2.remind_days, 45)
})

test('cliente com "não quer mais" compra: soma, mas não abre ciclo', () => {
  const { db, s, leadId } = base()
  db.prepare('UPDATE leads SET repurchase_opt_out = 1 WHERE id = ?').run(leadId)
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  const r = onSaleCreated(db, { saleId, now: NOW })
  assert.equal(r.cycleId, null); assert.equal(r.optOut, true)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(leadId).ltv, 100)
})

test('apagar a venda do ciclo encerra o ciclo e preserva tentativas', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  const c = openCycleForLead(db, leadId)
  const taskId = db.prepare("INSERT INTO standalone_tasks (account_id, lead_id, title, due_datetime) VALUES (?, ?, 'x', '2026-10-01')").run(s.accountId, leadId).lastInsertRowid
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar', task_id = ? WHERE id = ?").run(taskId, c.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, c.id, leadId)
  onSaleDeleted(db, { leadId, saleId, now: NOW })
  db.prepare('DELETE FROM lead_sales WHERE id = ?').run(saleId)
  const after = db.prepare('SELECT status, sale_id FROM repurchase_cycles WHERE id = ?').get(c.id)
  assert.equal(after.status, 'encerrado'); assert.equal(after.sale_id, null)
  assert.equal(db.prepare('SELECT status FROM standalone_tasks WHERE id = ?').get(taskId).status, 'completed')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).n, 1)
})

test('não comprou agora: motivo obrigatório, nova tentativa e volta para Aguardando', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-01' })
  onSaleCreated(db, { saleId, now: NOW })
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: null, now: NOW }).ok, false)
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_quer'), now: NOW }).ok, false) // motivo do grupo errado
  const r = recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_agora'), nextDays: 15, userId: s.atendenteId, now: NOW })
  assert.equal(r.ok, true)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.attempt, 2); assert.equal(c.remind_at, '2026-10-14'); assert.equal(c.remind_days, 15); assert.equal(c.status, 'aguardando')
  const att = db.prepare('SELECT * FROM repurchase_attempts WHERE cycle_id = ? AND attempt = 1').get(c.id)
  assert.equal(att.outcome, 'nao_agora'); assert.equal(att.next_remind_days, 15)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'aguardando'))
})

test('não comprou agora sem dias usa o prazo anterior', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 45 })
  onSaleCreated(db, { saleId, now: NOW })
  recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_agora'), now: NOW })
  assert.equal(openCycleForLead(db, leadId).remind_days, 45)
})

test('não quer mais: fecha, marca opt-out; desfazer reabre em 7 dias', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_quer', reasonId: reason(db, s.accountId, 'nao_quer'), userId: s.gerenteId, now: NOW }).ok, true)
  assert.equal(openCycleForLead(db, leadId), null)
  assert.equal(db.prepare('SELECT repurchase_opt_out FROM leads WHERE id = ?').get(leadId).repurchase_opt_out, 1)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'nao_quer'))
  undoOptOut(db, { leadId, userId: s.gerenteId, now: NOW })
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'aguardando'); assert.equal(c.remind_at, '2026-10-06'); assert.equal(c.attempt, 2)
  assert.equal(db.prepare('SELECT repurchase_opt_out FROM leads WHERE id = ?').get(leadId).repurchase_opt_out, 0)
})

test('sem ciclo aberto recordOutcome devolve 409', () => {
  const { db, leadId } = base()
  const r = recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: 1, now: NOW })
  assert.equal(r.ok, false); assert.equal(r.status, 409)
})

test('mensagem trocada em A contatar vai para Em conversa', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  const c = openCycleForLead(db, leadId)
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar' WHERE id = ?").run(c.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, c.id, leadId)
  db.prepare('UPDATE leads SET stage_id = ? WHERE id = ?').run(stageIdByKey(db, s.accountId, 'a_contatar'), leadId)
  onMessageExchanged(db, { leadId, now: NOW })
  assert.equal(openCycleForLead(db, leadId).status, 'em_conversa')
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'em_conversa'))
  assert.ok(db.prepare('SELECT contacted_at FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).contacted_at)
  onMessageExchanged(db, { leadId, now: NOW }) // 2a vez não quebra
})

test('arrastar manual para Em conversa acompanha no ciclo', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  syncCycleWithStage(db, { leadId, toStageId: stageIdByKey(db, s.accountId, 'em_conversa') })
  assert.equal(openCycleForLead(db, leadId).status, 'em_conversa')
})

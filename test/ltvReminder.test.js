import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { onSaleCreated, openCycleForLead } from '../server/services/ltv/cycles.js'
import { activateCycle, reminderTitle, taskAssignee } from '../server/services/ltv/reminder.js'

const NOW = new Date('2026-10-29T15:00:00Z')
function setup({ kind = 'recompra', crossSell = 0, offer = null, attendant = true } = {}) {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Maria', attendant_id: attendant ? s.atendenteId : null })
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind, crossSell, offer, remindDays: 30, product: 'Pacote pilates', value: 450, saleDate: '2026-09-29 10:00:00', createdBy: s.gerenteId })
  onSaleCreated(db, { saleId, now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, leadId, cycle: openCycleForLead(db, leadId) }
}
const fakeAi = (input, calls = []) => ({
  isAvailable: () => true,
  call: async (opts) => { calls.push(opts); return { toolUses: [{ name: 'suggest_offer', input }] } },
})

test('reminderTitle', () => {
  assert.equal(reminderTitle({ kind: 'recompra', leadName: 'Maria', product: 'Pilates', remindDays: 30 }), 'Lembrar Maria da recompra (Pilates, 30 dias)')
  assert.equal(reminderTitle({ kind: 'cruzada', leadName: 'João', product: 'Churrasqueira', remindDays: 15 }), 'Oferecer relacionados a João (comprou Churrasqueira)')
  assert.equal(reminderTitle({ kind: 'recompra', leadName: null, product: null, remindDays: 7 }), 'Lembrar cliente da recompra (7 dias)')
})

test('activateCycle cria tarefa, tentativa e move para A contatar', async () => {
  const { db, s, leadId, cycle } = setup()
  const r = await activateCycle(db, { cycleId: cycle.id, now: NOW })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(r.taskId)
  assert.equal(task.title, 'Lembrar Maria da recompra (Pacote pilates, 30 dias)')
  assert.equal(task.assigned_to, s.atendenteId); assert.equal(task.lead_id, leadId); assert.equal(task.repurchase_cycle_id, cycle.id)
  assert.equal(task.due_datetime, '2026-10-29T15:00:00.000Z') // 09h BRT já passou -> agora
  assert.match(task.description, /Tentativa 1 de 5/)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'a_contatar'); assert.equal(c.task_id, r.taskId)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repurchase_attempts WHERE cycle_id = ?').get(cycle.id).n, 1)
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId).stage_id, stageIdByKey(db, s.accountId, 'a_contatar'))
})

test('activateCycle é idempotente', async () => {
  const { db, cycle } = setup()
  await activateCycle(db, { cycleId: cycle.id, now: NOW })
  assert.deepEqual(await activateCycle(db, { cycleId: cycle.id, now: NOW }), { skipped: true })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks').get().n, 1)
})

test('sem atendente, responsável = quem vendeu', () => {
  const { db, s, cycle } = setup({ attendant: false })
  assert.equal(taskAssignee(db, cycle), s.gerenteId)
})

test('tentativas esgotadas não criam tarefa', async () => {
  const { db, cycle } = setup()
  db.prepare('UPDATE repurchase_cycles SET attempt = 6 WHERE id = ?').run(cycle.id)
  assert.deepEqual(await activateCycle(db, { cycleId: cycle.id, now: NOW }), { exhausted: true })
  assert.equal(db.prepare('SELECT exhausted FROM repurchase_cycles WHERE id = ?').get(cycle.id).exhausted, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks').get().n, 0)
})

test('cruzada sem "o que oferecer" usa sugestão da IA e guarda em ai_suggestion', async () => {
  const { db, cycle } = setup({ kind: 'unica', crossSell: 1 })
  const calls = []
  const r = await activateCycle(db, { cycleId: cycle.id, ai: fakeAi({ products: ['Espetos', 'Tábua'], message: 'Oi Maria!' }, calls), now: NOW })
  assert.equal(calls[0].source, 'repurchase_offer')
  const task = db.prepare('SELECT description FROM standalone_tasks WHERE id = ?').get(r.taskId)
  assert.match(task.description, /Espetos, Tábua/); assert.match(task.description, /Oi Maria!/)
  assert.deepEqual(JSON.parse(db.prepare('SELECT ai_suggestion FROM repurchase_cycles WHERE id = ?').get(cycle.id).ai_suggestion), { products: ['Espetos', 'Tábua'], message: 'Oi Maria!' })
})

test('IA com erro não bloqueia a tarefa', async () => {
  const { db, cycle } = setup({ kind: 'unica', crossSell: 1, offer: 'espetos' })
  const ai = { isAvailable: () => true, call: async () => { throw new Error('boom') } }
  const r = await activateCycle(db, { cycleId: cycle.id, ai, now: NOW })
  assert.ok(r.taskId)
  assert.match(db.prepare('SELECT description FROM standalone_tasks WHERE id = ?').get(r.taskId).description, /espetos/)
})

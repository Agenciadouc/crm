import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { onSaleCreated, openCycleForLead } from '../server/services/ltv/cycles.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { shouldRunDaily, runLtvForAccount, runLtvTick } from '../server/services/ltv/daily.js'
import { processAutoSends } from '../server/services/ltv/autoSend.js'

const DUE = new Date('2026-10-29T13:00:00Z') // 10h BRT
function setup() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Maria', attendant_id: s.atendenteId })
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, product: 'Pilates', saleDate: '2026-09-29 10:00:00' })
  onSaleCreated(db, { saleId, now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, leadId }
}
const aiOk = { isAvailable: () => true, call: async () => ({ toolUses: [{ name: 'suggest_offer', input: { products: ['Pilates'], message: 'Oi Maria, bora renovar?' } }] }) }

test('shouldRunDaily: a partir das 9h de Brasília, uma vez por dia', () => {
  assert.equal(shouldRunDaily({ ltv_daily_on: null }, new Date('2026-10-29T11:59:00Z')), false) // 8h59
  assert.equal(shouldRunDaily({ ltv_daily_on: null }, new Date('2026-10-29T12:00:00Z')), true)
  assert.equal(shouldRunDaily({ ltv_daily_on: '2026-10-29' }, new Date('2026-10-29T15:00:00Z')), false)
})

test('rotina ativa o ciclo vencido e não duplica ao rodar de novo', async () => {
  const { db, s, leadId } = setup()
  const r1 = await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: DUE })
  assert.equal(r1.activated, 1)
  db.prepare('UPDATE accounts SET ltv_daily_on = NULL').run()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: DUE })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks WHERE lead_id = ?').get(leadId).n, 1)
  assert.equal(db.prepare('SELECT ltv_daily_on FROM accounts WHERE id = ?').get(s.accountId).ltv_daily_on, '2026-10-29')
})

test('ciclo ainda não vencido fica aguardando', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: new Date('2026-10-20T13:00:00Z') })
  assert.equal(openCycleForLead(db, leadId).status, 'aguardando')
})

test('servidor desligado vários dias: recupera o atrasado', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: new Date('2026-11-15T13:00:00Z') })
  assert.equal(openCycleForLead(db, leadId).status, 'a_contatar')
})

test('runLtvTick respeita horário, dispara SSE e envio automático só com a chave ligada', async () => {
  const { db, s } = setup()
  const events = []; const sends = []
  const sendFor = () => async ({ text }) => { sends.push(text); return { ok: true } }
  await runLtvTick(db, { now: DUE, aiForAccount: () => aiOk, sendFor, broadcast: (acc, ev) => events.push([acc, ev]) })
  assert.ok(events.some(([acc, ev]) => acc === s.accountId && ev === 'customers:updated'))
  assert.equal(sends.length, 0) // chave desligada
})

test('envio automático: envia, move para Em conversa e troca a tarefa', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(s.instanceId)
  const sent = []
  const r = await processAutoSends(db, {
    accountId: s.accountId, ai: aiOk, now: DUE,
    availability: () => ({ ok: true, instance: { id: s.instanceId } }),
    send: async ({ text }) => { sent.push(text); return { ok: true } },
  })
  assert.equal(r.sent, 1)
  assert.match(sent[0], /bora renovar/)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'em_conversa'); assert.ok(c.auto_sent_at)
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId).stage_id, stageIdByKey(db, s.accountId, 'em_conversa'))
  const tasks = db.prepare('SELECT title, status FROM standalone_tasks WHERE lead_id = ? ORDER BY id').all(leadId)
  assert.equal(tasks[0].status, 'completed'); assert.match(tasks[1].title, /Acompanhar resposta de Maria/)
  assert.equal(db.prepare('SELECT auto FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).auto, 1)
  const again = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: () => ({ ok: true, instance: { id: 1 } }), send: async () => { throw new Error('não devia') } })
  assert.equal(again.sent, 0)
})

test('envio automático nunca vai para quem mandou SAIR; fora do horário espera', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  const avail = () => ({ ok: true, instance: { id: s.instanceId } })
  const off = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: avail, send: async () => ({ ok: false, reason: 'outside_business_hours' }) })
  assert.equal(off.waiting, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, null)
  db.prepare("UPDATE leads SET opted_out_at = datetime('now') WHERE id = ?").run(leadId)
  const r = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: avail, send: async () => { throw new Error('não devia') } })
  assert.equal(r.failed, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, 'opted_out')
  assert.equal(openCycleForLead(db, leadId).status, 'a_contatar') // tarefa manual continua
})

test('sem número de disparo não envia e registra o motivo', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  const r = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: () => ({ ok: false, reason: 'no_send_number' }), send: async () => { throw new Error('não devia') } })
  assert.equal(r.failed, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, 'no_send_number')
})

test('envio automatico de recompra: contato interno nao recebe', async () => {
  const { applyContactSchema } = await import('../server/services/contacts/schema.js')
  const { db, s, leadId } = setup()
  applyContactSchema(db)
  db.prepare("UPDATE leads SET contact_type = 'interno' WHERE id = ?").run(leadId)
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(s.instanceId)
  const sent = []
  const r = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE,
    availability: () => ({ ok: true, instance: { id: s.instanceId } }), send: async ({ text }) => { sent.push(text); return { ok: true } } })
  assert.deepEqual([r.sent, sent.length], [0, 0])
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, 'contact_type')
})

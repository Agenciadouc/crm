import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { createInboundHandler } from '../server/services/inboundHandler.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede') } })
const tick = () => new Promise(r => setImmediate(r))

function setup(seedOpts = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, seedOpts)
  const calls = { sse: [], capi: [], ai: [], handoff: [], profilePic: [], autoMsg: [], roulette: 0, optout: [] }
  const intake = createLeadIntake({ db, pickFromRoulette: () => null, notifyAndOpenLead: () => Promise.resolve(), triggerCapiForStageChange: () => {} })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
    getInstanceConfig: () => { throw new Error('polling nao deve ler auto-mensagens') },
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: (...a) => { calls.autoMsg.push(a); return Promise.resolve() },
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    scheduleAiForInbound: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => { calls.roulette++; return 99 },
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: (...a) => { calls.profilePic.push(a); return Promise.resolve() },
    sendOptOutConfirmation: (...a) => { calls.optout.push(a); return Promise.resolve() },
  })
  const poll = (record, instance = seed.instance) => {
    const list = adapter.parsePolledRecord(instance, record)
    return list.map(n => handler.handleInboundMessage(seed.account, instance, n, { source: 'polling' }))
  }
  return { db, seed, calls, poll }
}

test('lead novo pelo polling: atendente padrao da instancia, historico polling, sem IA/handoff/foto/contador', async () => {
  const { db, seed, calls, poll } = setup({ defaultAttendantId: 5 })
  assert.deepEqual(poll(P.polledRecordText), [{ ok: true, imported: true }])
  const lead = db.prepare('SELECT * FROM leads').get()
  assert.equal(lead.name, 'Lia Polling')
  assert.equal(lead.phone, '5547966665555')
  assert.equal(lead.source, 'whatsapp')
  assert.equal(lead.attendant_id, 5)
  assert.equal(lead.wa_remote_jid, '5547966665555@s.whatsapp.net')
  assert.equal(lead.instance_id, seed.instance.id)
  assert.equal(lead.last_instance_id, seed.instance.id)
  assert.equal(lead.unread_count, 0)
  assert.equal(db.prepare('SELECT trigger_type FROM stage_history WHERE lead_id = ?').get(lead.id).trigger_type, 'polling')
  const m = db.prepare('SELECT * FROM messages').get()
  assert.deepEqual(
    { direction: m.direction, content: m.content, media_type: m.media_type, media_url: m.media_url, sender_name: m.sender_name, wa_msg_id: m.wa_msg_id, wa_timestamp: m.wa_timestamp },
    { direction: 'inbound', content: 'Mensagem perdida', media_type: 'text', media_url: null, sender_name: 'Lia Polling', wa_msg_id: '3EB0POLL00000001', wa_timestamp: P.TS_ISO },
  )
  assert.deepEqual(calls.sse.map(s => s[1]), ['lead:created', 'lead:message'])
  assert.deepEqual(calls.sse[1][2], { lead_id: lead.id })
  assert.equal(calls.capi.length, 1)
  assert.equal(calls.roulette, 0)
  await tick()
  assert.equal(calls.ai.length + calls.handoff.length + calls.profilePic.length + calls.autoMsg.length, 0)
})

test('sem atendente padrao usa round-robin de distribution_rules', () => {
  const { db, seed, poll } = setup()
  db.prepare("INSERT INTO distribution_rules (account_id, funnel_id, type, last_assigned_index, active_attendants) VALUES (?, ?, 'round_robin', 1, '[7,8]')").run(seed.account.id, seed.funnelId)
  poll(P.polledRecordText)
  assert.equal(db.prepare('SELECT attendant_id FROM leads').get().attendant_id, 8)
  assert.equal(db.prepare('SELECT last_assigned_index FROM distribution_rules').get().last_assigned_index, 2)
})

test('lead arquivado e desarquivado pelo polling (comportamento atual)', () => {
  const { db, seed, poll } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547966665555', name: 'Lia', source: 'whatsapp', is_archived: 1, archived_at: '2026-09-01 10:00:00' })
  poll(P.polledRecordText)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.is_archived, 0)
  assert.equal(row.archived_at, null)
  assert.equal(row.has_new_after_archive, 1)
  assert.equal(row.stage_id, seed.stage1)
  assert.equal(row.name, 'Lia')
})

test('reacao e mensagem ja gravada sao ignoradas', () => {
  const { db, poll } = setup()
  assert.deepEqual(poll(P.reaction.data), [{ ok: true, skipped: 'type_reaction' }])
  poll(P.polledRecordText)
  assert.deepEqual(poll(P.polledRecordText), [{ ok: true, skipped: 'exists' }])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 1)
})

test('grupo nem chega ao handler; modo restrito e lead bloqueado nao gravam', () => {
  const a = setup()
  assert.deepEqual(a.poll(P.groupMessage.data), [])
  const b = setup({ intakeMode: 'restricted' })
  assert.deepEqual(b.poll(P.polledRecordText), [{ ok: true, restricted: true }])
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM leads').get().n, 0)
  const c = setup()
  insertLead(c.db, { account_id: c.seed.account.id, funnel_id: c.seed.funnelId, stage_id: c.seed.stage1, phone: '5547966665555', is_blocked: 1 })
  assert.deepEqual(c.poll(P.polledRecordText), [{ ok: true, blocked: true }])
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM messages').get().n, 0)
})

test('@lid com pushName liga ao lead de mesmo nome', () => {
  const { db, seed, poll } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547955554444', name: 'Joao Lid', source: 'whatsapp' })
  poll(P.lidWithPushName.data)
  assert.equal(db.prepare('SELECT wa_remote_jid FROM leads WHERE id = ?').get(lead.id).wa_remote_jid, '123456789012345@lid')
  assert.equal(db.prepare('SELECT lead_id FROM messages').get().lead_id, lead.id)
})

test('imagem: legenda vira conteudo e media_url nao e gravada no polling', () => {
  const { db, poll } = setup()
  poll(P.imageWithCaption.data)
  const m = db.prepare('SELECT media_type, content, media_url FROM messages').get()
  assert.deepEqual({ ...m }, { media_type: 'image', content: 'Esse modelo', media_url: null })
})

test('SAIR recuperado pelo polling: descadastra, cancela follow-up, sem confirmacao (Task 6 fix round 1)', () => {
  const { db, seed, calls, poll } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547966665555', name: 'Lia', source: 'whatsapp' })
  const fu = db.prepare('INSERT INTO follow_ups (account_id, instance_id) VALUES (?, ?)').run(seed.account.id, seed.instance.id).lastInsertRowid
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status) VALUES (?, ?, 'active')").run(lead.id, fu)
  const record = JSON.parse(JSON.stringify(P.polledRecordText))
  record.key.id = '3EB0POLLOPTOUT001'
  record.message.conversation = 'SAIR'
  poll(record)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.ok(row.opted_out_at)
  assert.deepEqual(
    db.prepare('SELECT status, paused_reason FROM lead_follow_ups WHERE lead_id = ?').get(lead.id),
    { status: 'cancelled', paused_reason: 'lead_opted_out' },
  )
  assert.equal(calls.optout.length, 0)
})

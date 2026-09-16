import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { createInboundHandler, detectAdSource } from '../server/services/inboundHandler.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede nos testes') } })
const tick = () => new Promise(r => setImmediate(r))

function setup(seedOpts = {}, depOverrides = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, seedOpts)
  const calls = { sse: [], capi: [], ai: [], handoff: [], profilePic: [], autoMsg: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: () => null,
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
  })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: (...a) => { calls.autoMsg.push(a); return Promise.resolve() },
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    scheduleAiForInbound: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => null,
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: (...a) => { calls.profilePic.push(a); return Promise.resolve() },
    ...depOverrides,
  })
  const receive = (payload, opts = {}) => {
    const { messages } = adapter.parseWebhook(seed.instance, payload, {})
    assert.equal(messages.length, 1)
    return handler.handleInboundMessage(seed.account, seed.instance, messages[0], { source: 'webhook', ...opts })
  }
  return { db, seed, calls, handler, receive }
}

const leads = (db) => db.prepare('SELECT * FROM leads ORDER BY id').all()
const msgs = (db) => db.prepare('SELECT * FROM messages ORDER BY id').all()

test('texto de lead novo: lead, mensagem, contadores, atribuicao, SSE, CAPI, IA e foto', async () => {
  const { db, seed, calls, receive } = setup()
  const r = receive(P.textConversation, { req: { headers: { 'x-forwarded-for': '127.0.0.1' }, ip: '127.0.0.1' } })
  assert.deepEqual(r, { ok: true })
  const [lead] = leads(db)
  assert.equal(lead.name, 'Maria Silva')
  assert.equal(lead.phone, '5547991351835')
  assert.equal(lead.source, 'whatsapp')
  assert.equal(lead.wa_remote_jid, '5547991351835@s.whatsapp.net')
  assert.equal(lead.instance_id, seed.instance.id)
  assert.equal(lead.last_instance_id, seed.instance.id)
  assert.equal(lead.stage_id, seed.stage1)
  assert.equal(lead.unread_count, 1)
  assert.ok(lead.last_inbound_at)
  assert.equal(lead.client_ip_address, null)
  const [m] = msgs(db)
  assert.deepEqual(
    { direction: m.direction, content: m.content, media_type: m.media_type, media_url: m.media_url, sender_name: m.sender_name, wa_msg_id: m.wa_msg_id, wa_timestamp: m.wa_timestamp, instance_id: m.instance_id, account_id: m.account_id },
    { direction: 'inbound', content: 'Oi, quero saber o preco', media_type: 'text', media_url: null, sender_name: 'Maria Silva', wa_msg_id: '3EB0A1B2C3D4E5F60001', wa_timestamp: P.TS_ISO, instance_id: seed.instance.id, account_id: seed.account.id },
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lead_instance_assignments WHERE lead_id = ? AND instance_id = ?').get(lead.id, seed.instance.id).n, 1)
  assert.deepEqual(calls.capi, [[lead.id, seed.stage1, null]])
  assert.equal(calls.sse[0][1], 'lead:created')
  assert.deepEqual(calls.profilePic, [[seed.instance, '5547991351835', lead.id]])
  await tick()
  assert.equal(calls.ai.length, 1)
  assert.equal(calls.ai[0][0].id, lead.id)
  assert.equal(calls.ai[0][1], 'Oi, quero saber o preco')
  assert.equal(calls.ai[0][2], 'text')
  assert.equal(calls.ai[0][3], seed.instance.id)
})

test('mesma mensagem duas vezes: nao duplica, mas a segunda conta como resposta (avanca etapa) como hoje', () => {
  const { db, seed, receive } = setup()
  receive(P.textConversation)
  receive(P.textConversation)
  assert.equal(msgs(db).length, 1)
  const [lead] = leads(db)
  assert.equal(lead.stage_id, seed.stage2)
  assert.equal(lead.unread_count, 1)
})

test('lead existente responde: sai de Novo Lead para Em Atendimento com CAPI', () => {
  const { db, seed, calls, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', name: '5547991351835', source: 'whatsapp' })
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.stage_id, seed.stage2)
  assert.equal(row.name, 'Maria Silva')
  const h = db.prepare("SELECT * FROM stage_history WHERE lead_id = ? AND trigger_type = 'webhook'").get(lead.id)
  assert.deepEqual(calls.capi.at(-1), [lead.id, seed.stage2, h.id])
})

test('audio: media_type audio, conteudo [Audio], media_url e IA com mediaType audio', async () => {
  const { db, calls, receive } = setup()
  receive(P.audioPtt)
  const [m] = msgs(db)
  assert.equal(m.media_type, 'audio')
  assert.equal(m.content, '[Audio]')
  assert.equal(m.media_url, 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc')
  await tick()
  assert.equal(calls.ai[0][2], 'audio')
})

test('imagem, documento, reacao e apagada gravam o mesmo que o webhook atual', () => {
  const { db, receive } = setup()
  receive(P.imageWithCaption)
  receive(P.documentPdf)
  receive(P.reaction)
  receive(P.revoke)
  assert.deepEqual(msgs(db).map(m => [m.media_type, m.content]), [
    ['image', 'Esse modelo'],
    ['document', 'orcamento.pdf'],
    ['reaction', '\u{1F44D} (reacao)'],
    ['system', '\u{1F6AB} Mensagem apagada'],
  ])
})

test('mensagem enviada pelo celular (fromMe): outbound, sem contador, sem IA, palavra-chave avanca etapa', async () => {
  const { db, seed, calls, receive } = setup({ stage2Keywords: JSON.stringify(['proposta']) })
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', name: 'Maria', source: 'whatsapp' })
  receive(P.outboundFromMe)
  const [m] = msgs(db)
  assert.equal(m.direction, 'outbound')
  assert.equal(m.sender_name, '')
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.unread_count, 0)
  assert.equal(row.name, 'Maria')
  assert.equal(row.stage_id, seed.stage2)
  await tick()
  assert.equal(calls.ai.length, 0)
})

test('anuncio CTWA em lead novo: fonte Facebook Pago, ctwa_clid, trabalha_anuncio; sem source_detail', () => {
  const { db, receive } = setup()
  receive(P.ctwaAd)
  const [lead] = leads(db)
  assert.equal(lead.source, 'Facebook Pago')
  assert.equal(lead.ctwa_clid, 'Afc123XYZ')
  assert.equal(lead.trabalha_anuncio, 1)
  assert.equal(lead.source_detail, null)
})

test('anuncio CTWA em lead existente com fonte whatsapp: atualiza fonte e detalhe', () => {
  const { db, seed, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547977776666', name: 'Carla', source: 'whatsapp' })
  receive(P.ctwaAd)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.source, 'Facebook Pago')
  assert.equal(row.source_detail, 'Pilates experimental — Agende sua aula')
})

test('detectAdSource', () => {
  assert.equal(detectAdSource(null), null)
  assert.equal(detectAdSource({ sourceUrl: 'https://www.instagram.com/p/x' }), 'Instagram')
  assert.equal(detectAdSource({ sourceType: 'ad', sourceUrl: 'https://fb.me/x' }), 'Facebook Pago')
  assert.equal(detectAdSource({ ctwaClid: 'abc' }), 'Meta Pago')
  assert.equal(detectAdSource({ sourceUrl: 'https://google.com' }), null)
})

test('@lid com pushName cria lead sem telefone; lead existente com mesmo nome recebe o LID', () => {
  const a = setup()
  a.receive(P.lidWithPushName)
  const [novo] = leads(a.db)
  assert.equal(novo.phone, null)
  assert.equal(novo.wa_remote_jid, '123456789012345@lid')
  assert.equal(novo.name, 'Joao Lid')

  const b = setup()
  const existente = insertLead(b.db, { account_id: b.seed.account.id, funnel_id: b.seed.funnelId, stage_id: b.seed.stage1, phone: '5547955554444', name: 'Joao Lid', source: 'whatsapp' })
  b.receive(P.lidWithPushName)
  assert.equal(leads(b.db).length, 1)
  assert.equal(b.db.prepare('SELECT wa_remote_jid FROM leads WHERE id = ?').get(existente.id).wa_remote_jid, '123456789012345@lid')
})

test('lead bloqueado e instancia restrita nao gravam nada', () => {
  const a = setup()
  insertLead(a.db, { account_id: a.seed.account.id, funnel_id: a.seed.funnelId, stage_id: a.seed.stage1, phone: '5547991351835', is_blocked: 1 })
  assert.deepEqual(a.receive(P.textConversation), { ok: true, blocked: true })
  assert.equal(msgs(a.db).length, 0)

  const b = setup({ intakeMode: 'restricted' })
  assert.deepEqual(b.receive(P.textConversation), { ok: true, restricted: true })
  assert.equal(leads(b.db).length, 0)
})

test('lead arquivado: grava, nao desarquiva, nao soma contador, SSE de atividade arquivada', () => {
  const { db, seed, calls, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage2, phone: '5547991351835', name: 'Maria', source: 'whatsapp', is_archived: 1 })
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.is_archived, 1)
  assert.equal(row.has_new_after_archive, 1)
  assert.equal(row.unread_count, 0)
  assert.ok(row.last_inbound_at)
  assert.equal(msgs(db).length, 1)
  assert.equal(calls.sse.at(-1)[1], 'lead:archived-activity')
})

test('resposta do lead cancela follow-up com stop_on_reply', () => {
  const { db, seed, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage2, phone: '5547991351835', name: 'Maria', source: 'whatsapp' })
  const fu = db.prepare('INSERT INTO follow_ups (account_id, instance_id, stop_on_reply) VALUES (?, ?, 1)').run(seed.account.id, seed.instance.id).lastInsertRowid
  const lfu = db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, next_run_at) VALUES (?, ?, 'active', datetime('now'))").run(lead.id, fu).lastInsertRowid
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM lead_follow_ups WHERE id = ?').get(lfu)
  assert.equal(row.status, 'cancelled')
  assert.equal(row.paused_reason, 'lead_replied')
  assert.equal(row.next_run_at, null)
})

test('handleStatusUpdate: promove, nunca regride e respeita a conta', () => {
  const { db, seed, calls, handler } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id, delivery_status) VALUES (?, ?, 'outbound', 'x', ?, 'sent')")
  const own = ins.run(lead.id, seed.account.id, 'BAE5OUTBOUND0001').lastInsertRowid
  const alheia = ins.run(lead.id, 999, 'BAE5OUTBOUND0009').lastInsertRowid

  const parsed = adapter.parseWebhook(seed.instance, P.statusUpdateRead, {})
  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, parsed.statuses), 1)
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(own)
  assert.equal(row.delivery_status, 'read')
  assert.ok(row.read_at)
  assert.deepEqual(calls.sse.at(-1), [seed.account.id, 'message:status', { message_id: own, lead_id: lead.id, status: 'read' }])

  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, [{ messageId: 'BAE5OUTBOUND0001', status: 'delivered', timestamp: 'x' }]), 0)
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(own).delivery_status, 'read')

  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, [{ messageId: 'BAE5OUTBOUND0009', status: 'read', timestamp: 'x' }]), 0)
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(alheia).delivery_status, 'sent')
})

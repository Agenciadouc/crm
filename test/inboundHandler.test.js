import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { createInboundHandler, detectAdSource } from '../server/services/inboundHandler.js'
import { isOptedOut } from '../server/services/antiban.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede nos testes') } })
const tick = () => new Promise(r => setImmediate(r))

// Numero de disparo (UzAPI): o agente e as auto-mensagens so rodam nele (spec secao 6).
function asSendNumber(db, seed) {
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(seed.instance.id)
  seed.instance.provider = 'uzapi'
}
// Mesmo payload de texto da Evolution com outro conteudo e outro id.
let seq = 0
function textPayload(text) {
  const p = JSON.parse(JSON.stringify(P.textConversation))
  p.data.message.conversation = text
  p.data.key.id = `3EB0OPTOUT${String(++seq).padStart(6, '0')}`
  return p
}

function setup(seedOpts = {}, depOverrides = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, seedOpts)
  const calls = { sse: [], capi: [], ai: [], handoff: [], profilePic: [], autoMsg: [], optout: [] }
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
    sendOptOutConfirmation: (...a) => { calls.optout.push(a); return Promise.resolve() },
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
  asSendNumber(db, seed)
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
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
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

test('handleStatusUpdate: erro dentro do loop e engolido (rota segue respondendo 200)', () => {
  const { db, seed, handler } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const own = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id, delivery_status) VALUES (?, ?, 'outbound', 'x', ?, 'sent')")
    .run(lead.id, seed.account.id, 'BAE5OUTBOUND0001').lastInsertRowid

  // messageId malformado (objeto no lugar de string) faz o bind do better-sqlite3 lancar
  // no meio do loop. Como no webhook de hoje, o erro e logado e nao propaga.
  let changed
  assert.doesNotThrow(() => {
    changed = handler.handleStatusUpdate(seed.account, seed.instance, [
      { messageId: 'BAE5OUTBOUND0001', status: 'delivered', timestamp: 'x' },
      { messageId: { id: 'BAE5OUTBOUND0002' }, status: 'read', timestamp: 'x' },
    ])
  })
  // o que ja tinha sido aplicado antes do erro permanece gravado
  assert.equal(changed, 1)
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(own).delivery_status, 'delivered')

  // lista nao iteravel (provedor devolvendo formato inesperado) tambem nao derruba a rota
  let semLista
  assert.doesNotThrow(() => { semLista = handler.handleStatusUpdate(seed.account, seed.instance, {}) })
  assert.equal(semLista, 0)
})

test('status com outboundOnly (UzAPI) nao mexe em mensagem RECEBIDA; sem o campo (Evolution) segue igual', () => {
  const { db, seed, handler } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = (id, direction) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id, delivery_status) VALUES (?, ?, ?, 'x', ?, 'sent')").run(lead.id, seed.account.id, direction, id)
  ins('IN1', 'inbound')
  ins('OUT1', 'outbound')
  ins('IN2', 'inbound')
  const changed = handler.handleStatusUpdate(seed.account, seed.instance, [
    { messageId: 'IN1', status: 'read', outboundOnly: true },
    { messageId: 'OUT1', status: 'read', outboundOnly: true },
    { messageId: 'IN2', status: 'read' },
  ])
  const st = (id) => db.prepare('SELECT delivery_status FROM messages WHERE wa_msg_id = ?').get(id).delivery_status
  assert.equal(changed, 2)
  assert.equal(st('IN1'), 'sent')
  assert.equal(st('OUT1'), 'read')
  assert.equal(st('IN2'), 'read')
})

// Dono (24/09/2026): na Evolution a IA roda so como Copiloto (sugestao). Quem filtra o agente e forca
// o modo sugestao e o agendador (findAgentForLead + resolveEffectiveMode); aqui so entregamos a mensagem.
test('numero de leitura (Evolution): grava a mensagem e entrega ao agendador (so Copiloto roda la)', async () => {
  const { db, calls, receive } = setup()
  receive(P.textConversation)
  await tick()
  assert.equal(calls.ai.length, 1)
  assert.equal(msgs(db)[0].content, 'Oi, quero saber o preco')
})

test('numero de leitura: nao agenda boas-vindas nem ausencia', async () => {
  const cfg = { greeting_enabled: 1, greeting_text: 'Ola', away_text: 'Fechado' }
  const { calls, receive } = setup({}, { getInstanceConfig: () => cfg, shouldSendAway: () => true })
  receive(P.textConversation)
  await new Promise(r => setTimeout(r, 2100))
  assert.equal(calls.autoMsg.length, 0)
})

test('numero de disparo: agenda boas-vindas e ausencia como antes', async () => {
  const cfg = { greeting_enabled: 1, greeting_text: 'Ola', away_text: 'Fechado' }
  const { db, seed, calls, receive } = setup({}, { getInstanceConfig: () => cfg, shouldSendAway: () => true })
  asSendNumber(db, seed)
  receive(P.textConversation)
  await new Promise(r => setTimeout(r, 2100))
  assert.deepEqual(calls.autoMsg.map(c => c[0].type).sort(), ['away', 'greeting'])
})

test('lead manda "Sair." no numero de disparo: descadastra, cancela follow-ups, confirma e nao chama o agente', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  receive(P.textConversation)
  await tick()
  const [lead] = leads(db)
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status) VALUES (?, 1, 'active')").run(lead.id)
  calls.ai.length = 0
  const r = receive(textPayload('Sair.'))
  assert.deepEqual(r, { ok: true, optedOut: true })
  assert.ok(db.prepare('SELECT opted_out_at FROM leads WHERE id = ?').get(lead.id).opted_out_at)
  assert.deepEqual(
    db.prepare('SELECT status, paused_reason FROM lead_follow_ups WHERE lead_id = ?').get(lead.id),
    { status: 'cancelled', paused_reason: 'lead_opted_out' },
  )
  assert.equal(calls.optout.length, 1)
  assert.equal(calls.optout[0][0].text, 'Pronto! Você não vai mais receber nossas mensagens automáticas.')
  assert.equal(calls.optout[0][0].instance.id, seed.instance.id)
  await tick()
  assert.equal(calls.ai.length, 0)
})

test('SAIR no numero de leitura: descadastra mas nao responde nada', async () => {
  const { db, calls, receive } = setup()
  receive(textPayload('SAIR'))
  assert.ok(leads(db)[0].opted_out_at)
  assert.equal(calls.optout.length, 0)
})

test('"vou sair agora" nao descadastra', async () => {
  const { db, receive } = setup()
  receive(textPayload('vou sair agora'))
  assert.equal(leads(db)[0].opted_out_at, null)
})

test('confirmacao usa o texto da conta quando existe', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  db.prepare("UPDATE accounts SET optout_confirm_text = 'Ok, removido.' WHERE id = ?").run(seed.account.id)
  receive(textPayload('parar'))
  assert.equal(calls.optout[0][0].text, 'Ok, removido.')
})

test('SAIR repetido no numero de disparo: nao manda a confirmacao de novo', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  receive(P.textConversation)
  await tick()
  // opt-in da criacao do lead no passado (mesmo segundo do SAIR empataria o carimbo)
  db.prepare("UPDATE leads SET opted_in_at = datetime('now', '-1 day')").run()
  receive(textPayload('SAIR'))
  assert.equal(calls.optout.length, 1)
  const r = receive(textPayload('sair'))
  assert.deepEqual(r, { ok: true, optedOut: true })
  assert.ok(leads(db)[0].opted_out_at)
  assert.equal(calls.optout.length, 1)
})

test('SAIR depois de voltar a aceitar mensagens (opt-in mais novo): confirma de novo', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  receive(textPayload('SAIR'))
  db.prepare("UPDATE leads SET opted_out_at = datetime('now', '-1 day'), opted_in_at = datetime('now', '-1 hour')").run()
  receive(textPayload('SAIR'))
  assert.equal(calls.optout.length, 2)
})

test('lead novo cuja primeira mensagem e SAIR fica descadastrado (isOptedOut)', async () => {
  const { db, seed, receive } = setup()
  asSendNumber(db, seed)
  const r = receive(textPayload('SAIR'))
  assert.deepEqual(r, { ok: true, optedOut: true })
  const lead = db.prepare('SELECT opted_in_at, opted_out_at FROM leads').get()
  assert.ok(lead.opted_out_at)
  assert.equal(isOptedOut(lead), true)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, TEST_TOKEN } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook, webhookErrorStatus, webhookJsonErrorHandler } from '../server/services/whatsapp/webhookFlow.js'
import { createTestInboundHandler } from './helpers/inboundSetup.js'
import { createUzapiAdapter } from '../server/services/whatsapp/uzapi.js'
import { insertUzapiInstance, loadUzapiFixture, LEAD_PHONE, UZAPI_TEST_ENV, quietLog } from './helpers/uzapiFixtures.js'

test('token valido resolve instancia e conta', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const r = resolveInstanceByToken(db, TEST_TOKEN)
  assert.equal(r.instance.id, instance.id)
  assert.equal(r.account.id, account.id)
})

test('token com formato invalido ou inexistente devolve 401', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveInstanceByToken(db, 'abc'), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, 'b'.repeat(32)), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, undefined), { status: 401, error: 'Invalid webhook token' })
})

test('conta inativa devolve 404', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare('UPDATE accounts SET is_active = 0').run()
  assert.deepEqual(resolveInstanceByToken(db, TEST_TOKEN), { status: 404, error: 'Account not found' })
})

test('rota antiga: resolve pelo nome da instancia no corpo', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instanceName: 'inst-teste' }, {}).instance.id, instance.id)
})

test('rota antiga: sem fallback para a primeira instancia da conta', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'nao-existe' }, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', {}, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'outra-conta', { instance: 'inst-teste' }, {}), { status: 404, error: 'Account not found' })
})

test('rota antiga: nome casa com caixa diferente e com espaco nas pontas', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'INST-TESTE' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'Inst-Teste' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: '  inst-teste  ' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instanceName: ' INST-Teste ' }, {}).instance.id, instance.id)
  // nome realmente diferente continua 401
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste-2' }, {}), { status: 401, error: 'Unknown instance' })
})

test('rota antiga: nome ambiguo na conta devolve 401 em vez de adivinhar', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key) VALUES (?, 'INST-TESTE', 'http://evo.local', 'KEY')").run(account.id)
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'INST-TESTE' }, {}), { status: 401, error: 'Unknown instance' })
})

test('rota antiga: nome tolerante nao vaza para outra conta', () => {
  const db = createTestDb()
  seedBasic(db)
  const other = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Outra', 'outra-conta')").run().lastInsertRowid
  db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key) VALUES (?, 'inst-outra', 'http://evo.local', 'KEY')").run(other)
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'INST-OUTRA' }, {}), { status: 401, error: 'Unknown instance' })
})

test('rota antiga: webhook_secret e provedor', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = 's3cr3t'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Invalid webhook secret' })
  assert.ok(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, { 'x-webhook-secret': 's3cr3t' }).instance)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = NULL, provider = 'custom'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Unknown instance' })
})

function flowDeps() {
  const calls = { inbound: [], status: [] }
  const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede') } })
  return {
    calls,
    deps: {
      getProvider: () => adapter,
      handleInboundMessage: (account, instance, normalized, opts) => { calls.inbound.push({ normalized, opts }); return { ok: true } },
      handleStatusUpdate: (account, instance, statuses) => { calls.status.push(statuses); return statuses.length },
    },
  }
}

test('processWebhook: upsert chama o handler com source webhook e o req', () => {
  const { calls, deps } = flowDeps()
  const req = { body: P.textConversation, headers: { a: 1 }, ip: '1.2.3.4' }
  const r = processWebhook(deps, { id: 1 }, { id: 2 }, req)
  assert.deepEqual(r, { ok: true })
  assert.equal(calls.inbound.length, 1)
  assert.equal(calls.inbound[0].normalized.messageId, '3EB0A1B2C3D4E5F60001')
  assert.equal(calls.inbound[0].opts.source, 'webhook')
  assert.equal(calls.inbound[0].opts.req, req)
  assert.equal(calls.status.length, 0)
})

test('processWebhook: update chama so o status; grupo nao chama nada', () => {
  const a = flowDeps()
  assert.deepEqual(processWebhook(a.deps, { id: 1 }, { id: 2 }, { body: P.statusUpdateRead, headers: {} }), { ok: true })
  assert.equal(a.calls.status.length, 1)
  assert.equal(a.calls.inbound.length, 0)
  const b = flowDeps()
  assert.deepEqual(processWebhook(b.deps, { id: 1 }, { id: 2 }, { body: P.groupMessage, headers: {} }), { ok: true })
  assert.equal(b.calls.inbound.length + b.calls.status.length, 0)
})

test('processWebhook: devolve o resultado do handler (blocked/restricted)', () => {
  const { deps } = flowDeps()
  deps.handleInboundMessage = () => ({ ok: true, blocked: true })
  assert.deepEqual(processWebhook(deps, { id: 1 }, { id: 2 }, { body: P.textConversation, headers: {} }), { ok: true, blocked: true })
})

test('processWebhook: conexao/QR vao para handleConnection; ecos vao para resolveEchoes sem travar a resposta', async () => {
  const provider = { parseWebhook: () => ({ messages: [], statuses: [], echoes: [{ messageId: 'E1', phone: '5548990000002' }], connection: 'connected', qr: null }) }
  const conn = []
  const echoes = []
  const r = processWebhook({
    getProvider: () => provider,
    handleInboundMessage: () => ({ ok: true }),
    handleStatusUpdate: () => 0,
    handleConnection: (inst, info) => { conn.push([inst.id, info]) },
    resolveEchoes: async (acc, inst, list) => { echoes.push(list) },
  }, { id: 1 }, { id: 9 }, { body: {} })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(conn, [[9, { connection: 'connected', qr: null }]])
  await new Promise(res => setImmediate(res))
  assert.deepEqual(echoes, [[{ messageId: 'E1', phone: '5548990000002' }]])
})

test('UzAPI ponta a ponta: texto real cria lead e mensagem; leitura do proprio numero nao mexe na recebida; outro phone_number_id nao grava', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const adapter = createUzapiAdapter({ fetch: async () => { throw new Error('sem rede nos testes') }, env: UZAPI_TEST_ENV, log: quietLog })
  const { handler } = createTestInboundHandler(db)
  const deps = { getProvider: () => adapter, handleInboundMessage: handler.handleInboundMessage, handleStatusUpdate: handler.handleStatusUpdate }

  processWebhook(deps, seed.account, instance, { body: loadUzapiFixture('message-text.json'), headers: {} })
  const lead = db.prepare('SELECT * FROM leads WHERE phone = ?').get(LEAD_PHONE)
  assert.equal(lead.name, 'Contato 02')
  const msg = db.prepare('SELECT * FROM messages WHERE wa_msg_id = ?').get('2A2ACD4E776A27C10B00')
  assert.equal(msg.direction, 'inbound')
  assert.equal(msg.content, 'Teste 1')
  assert.equal(msg.instance_id, instance.id)

  processWebhook(deps, seed.account, instance, { body: loadUzapiFixture('status-read-by-self.json'), headers: {} })
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(msg.id).delivery_status, msg.delivery_status)

  const body = loadUzapiFixture('message-audio.json')
  body.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999'
  processWebhook(deps, seed.account, instance, { body, headers: {} })
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE wa_msg_id = '2AF1064222DEF32AAEBA'").get().n, 0)
})

test('UzAPI ponta a ponta: audio real grava o id da midia em media_url', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const adapter = createUzapiAdapter({ fetch: async () => { throw new Error('sem rede nos testes') }, env: UZAPI_TEST_ENV, log: quietLog })
  const { handler } = createTestInboundHandler(db)
  processWebhook({ getProvider: () => adapter, handleInboundMessage: handler.handleInboundMessage, handleStatusUpdate: handler.handleStatusUpdate },
    seed.account, instance, { body: loadUzapiFixture('message-audio.json'), headers: {} })
  const msg = db.prepare("SELECT * FROM messages WHERE wa_msg_id = '2AF1064222DEF32AAEBA'").get()
  assert.deepEqual([msg.media_type, msg.media_url], ['audio', '582578164494741'])
})

test('webhookErrorStatus: UzAPI recebe 200 em erro interno (evita reenvio em laco); Evolution segue 500', () => {
  assert.equal(webhookErrorStatus({ provider: 'uzapi' }), 200)
  assert.equal(webhookErrorStatus({ provider: 'evolution' }), 500)
  assert.equal(webhookErrorStatus(null), 500)
})

test('webhookJsonErrorHandler: JSON invalido no webhook de WhatsApp vira 200; outros erros seguem', () => {
  const res = { code: null, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  let passed = null
  const parseErr = Object.assign(new Error('Unexpected token'), { type: 'entity.parse.failed' })
  webhookJsonErrorHandler(parseErr, { originalUrl: '/crm/api/webhooks/whatsapp/' + 'a'.repeat(32) }, res, (e) => { passed = e })
  assert.deepEqual([res.code, res.body, passed], [200, { ok: false, error: 'invalid_json' }, null])
  webhookJsonErrorHandler(parseErr, { originalUrl: '/api/leads' }, res, (e) => { passed = e })
  assert.equal(passed, parseErr)
})

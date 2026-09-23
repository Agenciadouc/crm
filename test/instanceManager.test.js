import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { createInstanceManager, listAvailableProviders, sanitizeInstance, ProviderError, UZAPI_ACCOUNT_AUTH_MESSAGE, UZAPI_INSTANCE_AUTH_MESSAGE } from '../server/services/whatsapp/instanceManager.js'
import { readUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { UZAPI_TEST_ENV, quietLog, insertUzapiInstance } from './helpers/uzapiFixtures.js'

function fakeUzapi(overrides = {}) {
  const calls = { createInstance: [], status: [], disconnect: [], restart: [], remove: [] }
  const adapter = {
    name: 'uzapi',
    async createInstance(args) {
      calls.createInstance.push(args)
      if (overrides.createInstance) return overrides.createInstance(args)
      return { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null, qr: null }
    },
    async status(i) { calls.status.push(i.id); return overrides.status ? overrides.status(i) : { ok: true, status: 'connecting', phoneNumber: null, qr: null } },
    async disconnect(i) { calls.disconnect.push(i.id); return { ok: true } },
    async restart(i) { calls.restart.push(i.id); return overrides.restart ? overrides.restart(i) : { ok: true } },
    async remove(i) { calls.remove.push(i.id); return overrides.remove ? overrides.remove(i) : { ok: true } },
  }
  return { adapter, calls }
}

function setup(overrides = {}, env = UZAPI_TEST_ENV, log = quietLog) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const { adapter, calls } = fakeUzapi(overrides)
  const manager = createInstanceManager({ db, getProvider: () => adapter, env, log, removeTimeoutMs: 50 })
  return { db, seed, manager, calls }
}
const row = (db, id) => db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
const logs = (db) => db.prepare('SELECT instance_id, provider, event FROM whatsapp_connection_log ORDER BY id').all()

// Log falso que guarda as mensagens de erro (junta os argumentos numa string) para conferir o que foi logado.
function capturingLog() {
  const errors = []
  return { log: { error: (...args) => errors.push(args.join(' ')), warn() {}, log() {} }, errors }
}

// Faz o INSERT de criacao do numero UzAPI (o unico com provider_config na lista de colunas) falhar,
// simulando SQLITE_BUSY/colisao de indice/etc depois que o numero ja existe na UzAPI.
function breakUzapiInsert(db) {
  const real = db.prepare.bind(db)
  db.prepare = (sql) => {
    if (sql.includes('INSERT INTO whatsapp_instances') && sql.includes('provider_config')) {
      return { run: () => { throw new Error('SQLITE_BUSY: database is locked') } }
    }
    return real(sql)
  }
}

test('criar numero UzAPI: cria na UzAPI com o webhook do numero, grava provider/config cifrada, aquecimento e registro', async () => {
  const { db, seed, manager, calls } = setup()
  const inst = await manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Loja Centro', leadIntakeMode: 'open' })
  assert.equal(calls.createInstance.length, 1)
  assert.equal(calls.createInstance[0].name, 'Loja Centro')
  assert.equal(calls.createInstance[0].webhookUrl, `https://crm.test/api/webhooks/whatsapp/${inst.webhook_token}`)
  assert.match(inst.webhook_token, /^[a-f0-9]{32}$/)
  assert.equal(inst.provider, 'uzapi')
  assert.equal(inst.api_url, '')
  assert.equal(inst.api_key, '')
  assert.equal(inst.status, 'connecting')
  assert.ok(inst.warmup_until)
  assert.ok(!inst.provider_config.includes('TOKEN-NOVO'))
  assert.deepEqual(readUzapiConfig(inst, UZAPI_TEST_ENV), { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null })
  assert.deepEqual(logs(db), [{ instance_id: inst.id, provider: 'uzapi', event: 'created' }])
})

test('criar numero UzAPI: sem credenciais da Dros, sem WA_ENC_KEY, nome repetido ou falha na UzAPI -> ProviderError e nada gravado', async () => {
  const cases = [
    [{ ...UZAPI_TEST_ENV, UZAPI_ACCOUNT_TOKEN: '' }, {}, 'uzapi_not_configured', 400],
    [{ ...UZAPI_TEST_ENV, WA_ENC_KEY: '' }, {}, 'wa_enc_key_missing', 400],
    [UZAPI_TEST_ENV, { createInstance: () => { const e = new Error('x'); e.code = 'uzapi_create_failed'; throw e } }, 'uzapi_create_failed', 502],
  ]
  for (const [env, overrides, code, status] of cases) {
    const { db, seed, manager } = setup(overrides, env)
    await assert.rejects(() => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Nova' }), (e) => e instanceof ProviderError && e.code === code && e.status === status)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_instances WHERE provider = 'uzapi'").get().n, 0)
  }
  const { seed, manager, calls } = setup()
  await assert.rejects(() => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'inst-teste' }), (e) => e.code === 'instance_name_taken' && e.status === 409)
  assert.equal(calls.createInstance.length, 0)
})

test('criar numero UzAPI: falha ao gravar no CRM depois de criado na UzAPI -> exclui na UzAPI (best-effort) e ProviderError uzapi_create_failed', async () => {
  const { db, seed, manager, calls } = setup()
  breakUzapiInsert(db)
  await assert.rejects(
    () => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Nova' }),
    (e) => e instanceof ProviderError && e.code === 'uzapi_create_failed' && e.status === 502
  )
  assert.equal(calls.remove.length, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_instances WHERE instance_name = 'Nova'").get().n, 0)
})

test('criar numero UzAPI: uzapi_create_incomplete registra o phoneNumberId para limpeza manual, nunca o token', async () => {
  const { errors, log } = capturingLog()
  const { seed, manager } = setup({ createInstance: () => { const e = new Error('uzapi_create_incomplete'); e.code = 'uzapi_create_incomplete'; e.phoneNumberId = '100000000000009'; throw e } }, UZAPI_TEST_ENV, log)
  await assert.rejects(() => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Nova' }), (e) => e.code === 'uzapi_create_incomplete')
  const joined = errors.join(' | ')
  assert.match(joined, /100000000000009/)
  assert.doesNotMatch(joined, /TOKEN/)
})

test('applyConnection: connected limpa QR, grava connected_at e telefone e registra uma vez; disconnected registra', () => {
  const { db, seed, manager } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  db.prepare("UPDATE whatsapp_instances SET qr_code = 'QR' WHERE id = ?").run(inst.id)
  const a = manager.applyConnection(inst, { connection: 'connected', phoneNumber: '554890000001' })
  assert.equal(a.status, 'connected')
  assert.equal(a.qr_code, null)
  assert.equal(a.phone_number, '554890000001')
  assert.ok(a.connected_at)
  const b = manager.applyConnection(a, { connection: 'connected' })
  assert.equal(b.connected_at, a.connected_at)
  assert.equal(b.phone_number, '554890000001')
  manager.applyConnection(b, { connection: 'disconnected' })
  assert.deepEqual(logs(db).map(l => l.event), ['connected', 'disconnected'])
  assert.equal(row(db, inst.id).status, 'disconnected')
})

test('applyConnection com QR: grava o QR e fica connecting', () => {
  const { db, seed, manager } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'disconnected' })
  const r = manager.applyConnection(inst, { qr: '2@QR-DE-TESTE-NAO-E-REAL,abcdefghij' })
  assert.equal(r.qr_code, '2@QR-DE-TESTE-NAO-E-REAL,abcdefghij')
  assert.equal(r.status, 'connecting')
})

test('refreshQr: conectado, com QR (com panel_url de alternativa), sem QR (plano B com panel_url) e UzAPI fora do ar', async () => {
  let st = { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null }
  const { db, seed, manager } = setup({ status: () => { if (st instanceof Error) throw st; return st } })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  const connected = await manager.refreshQr(inst)
  assert.deepEqual([connected.qr_code, connected.status, connected.panel_url], [null, 'connected', undefined])

  db.prepare("UPDATE whatsapp_instances SET status = 'connecting' WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' }
  const withQr = await manager.refreshQr(row(db, inst.id))
  assert.equal(withQr.qr_code, 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE')
  assert.equal(withQr.panel_url, 'https://painel.uzapi.test')

  // QR em texto cru do WhatsApp (nao da para desenhar na tela): o painel vai junto
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: '2@QR-DE-TESTE-NAO-E-REAL,abcdefghij' }
  const rawQr = await manager.refreshQr(row(db, inst.id))
  assert.deepEqual([rawQr.qr_code, rawQr.status, rawQr.panel_url], ['2@QR-DE-TESTE-NAO-E-REAL,abcdefghij', 'connecting', 'https://painel.uzapi.test'])

  db.prepare("UPDATE whatsapp_instances SET qr_code = NULL WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: null }
  const planB = await manager.refreshQr(row(db, inst.id))
  assert.deepEqual([planB.qr_code, planB.status, planB.panel_url], [null, 'connecting', 'https://painel.uzapi.test'])

  st = new Error('ECONNREFUSED')
  const down = await manager.refreshQr(row(db, inst.id))
  assert.equal(down.panel_url, 'https://painel.uzapi.test')
})

test('refreshQr: numero apagado durante a chamada nao lanca (cai para disconnected)', async () => {
  const { db, seed, manager } = setup({
    status: async (i) => { db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(i.id); return { ok: true, status: 'connecting', phoneNumber: null, qr: null } },
  })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  const r = await manager.refreshQr(inst)
  assert.deepEqual(r, { instance: null, qr_code: null, status: 'disconnected' })
})

test('checkStatus: aplica o status da UzAPI; erro da UzAPI nao derruba o numero', async () => {
  let st = { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null }
  const { db, seed, manager } = setup({ status: () => st })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  const a = await manager.checkStatus(inst)
  assert.deepEqual([a.state, a.instance.status], ['connected', 'connected'])
  st = { ok: false, status: null, reason: 'provider_error' }
  const b = await manager.checkStatus(row(db, inst.id))
  assert.deepEqual([b.state, b.error, b.instance.status], [null, 'provider_error', 'connected'])
})

test('disconnect: logout na UzAPI e numero desconectado', async () => {
  const { db, seed, manager, calls } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connected' })
  const r = await manager.disconnect(inst)
  assert.deepEqual(calls.disconnect, [inst.id])
  assert.equal(r.instance.status, 'disconnected')
})

test('remove: exclui na UzAPI (best-effort, com tempo limite), registra removed e apaga a linha', async () => {
  const { db, seed, manager, calls } = setup({ remove: () => new Promise(() => {}) })
  const inst = insertUzapiInstance(db, seed.account.id)
  const r = await manager.remove(inst)
  assert.deepEqual(r, { ok: true, providerOk: false })
  assert.deepEqual(calls.remove, [inst.id])
  assert.equal(row(db, inst.id), undefined)
  assert.deepEqual(logs(db).map(l => l.event), ['removed'])
})

test('remove: quando a exclusao na UzAPI falha, o log traz o phoneNumberId (nunca o token)', async () => {
  const { errors, log } = capturingLog()
  const { db, seed, manager } = setup({ remove: () => ({ ok: false, reason: 'provider_error' }) }, UZAPI_TEST_ENV, log)
  const inst = insertUzapiInstance(db, seed.account.id)
  const r = await manager.remove(inst)
  assert.deepEqual(r, { ok: true, providerOk: false })
  const joined = errors.join(' | ')
  assert.match(joined, /100000000000001/)
  assert.doesNotMatch(joined, /TOKEN-INSTANCIA/)
})

test('listAvailableProviders: UzAPI so com usuario e token da conta', () => {
  assert.deepEqual(listAvailableProviders({}), [{ id: 'evolution', label: 'Evolution' }])
  assert.deepEqual(listAvailableProviders(UZAPI_TEST_ENV), [{ id: 'evolution', label: 'Evolution' }, { id: 'uzapi', label: 'UzAPI (estável)' }])
})

test('sanitizeInstance: nunca provider_config; atendente tambem sem api_url/api_key/webhook_secret; provider sempre presente', () => {
  const r = { id: 1, provider: 'uzapi', provider_config: '{"x":1}', api_url: '', api_key: '', webhook_secret: null, status: 'connected' }
  assert.deepEqual(sanitizeInstance(r, 'gerente'), { id: 1, provider: 'uzapi', api_url: '', api_key: '', webhook_secret: null, status: 'connected' })
  assert.deepEqual(sanitizeInstance(r, 'atendente'), { id: 1, provider: 'uzapi', status: 'connected' })
  assert.equal(sanitizeInstance({ id: 2, provider: null }, 'gerente').provider, 'evolution')
  assert.equal(sanitizeInstance(null, 'gerente'), null)
})

test('refreshQr: UzAPI falhou com o numero conectado -> devolve conectado com o erro e nao mexe no banco', async () => {
  for (const st of [new Error('ECONNREFUSED'), { ok: false, status: null, reason: 'provider_error' }]) {
    const { db, seed, manager } = setup({ status: () => { if (st instanceof Error) throw st; return st } })
    const inst = insertUzapiInstance(db, seed.account.id, { status: 'connected' })
    const before = row(db, inst.id)
    const r = await manager.refreshQr(inst)
    assert.deepEqual([r.status, r.qr_code, r.instance.status, r.panel_url], ['connected', null, 'connected', undefined])
    assert.ok(r.error)
    assert.deepEqual(row(db, inst.id), before)
  }
})

test('applyStatus: conectado so e rebaixado quando a UzAPI diz disconnected (connecting nao rebaixa)', () => {
  const { db, seed, manager } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connected' })
  manager.applyStatus(inst, { ok: true, status: 'connecting', phoneNumber: null })
  assert.equal(row(db, inst.id).status, 'connected')
  manager.applyStatus(inst, { ok: true, status: 'disconnected', phoneNumber: null })
  assert.equal(row(db, inst.id).status, 'disconnected')
  manager.applyStatus(inst, { ok: true, status: 'connecting', phoneNumber: null })
  assert.equal(row(db, inst.id).status, 'connecting')
})

test('applyConnection: ao voltar para connected retoma disparos e follow-ups pausados (uma vez; erro nao derruba)', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const resumed = []
  const manager = createInstanceManager({
    db, getProvider: () => ({}), env: UZAPI_TEST_ENV, log: quietLog,
    resumeBroadcastIfPaused: (id) => { resumed.push(['broadcast', id]); throw new Error('boom') },
    resumeFollowUpsIfPaused: (id) => { resumed.push(['followup', id]) },
  })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'disconnected' })
  const a = manager.applyConnection(inst, { connection: 'connected' })
  assert.equal(a.status, 'connected')
  manager.applyConnection(a, { connection: 'connected' })
  assert.deepEqual(resumed, [['broadcast', inst.id], ['followup', inst.id]])
})

test('criar numero UzAPI: dois cliques ao mesmo tempo com o mesmo nome -> o segundo recebe instance_name_taken 409', async () => {
  let open
  const gate = new Promise(r => { open = r })
  const { db, seed, manager, calls } = setup({
    createInstance: async () => { await gate; return { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null, qr: null } },
  })
  const p1 = manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Loja Centro' })
  await assert.rejects(
    manager.createUzapiInstance({ accountId: seed.account.id, instanceName: '  loja centro ' }),
    (e) => e instanceof ProviderError && e.code === 'instance_name_taken' && e.status === 409,
  )
  open()
  await p1
  assert.equal(calls.createInstance.length, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_instances WHERE provider = 'uzapi'").get().n, 1)
  // terminou: a trava sai (outra conta ou outro nome segue livre)
  await manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Loja Norte' })
})

test('criar numero UzAPI: UzAPI recusou a credencial da conta (provider_auth) -> mensagem que manda conferir o .env; outros erros pedem para tentar de novo', async () => {
  const fail = (code) => () => { const e = new Error(code); e.code = code; throw e }
  const auth = setup({ createInstance: fail('provider_auth') })
  await assert.rejects(
    () => auth.manager.createUzapiInstance({ accountId: auth.seed.account.id, instanceName: 'Nova' }),
    (e) => e instanceof ProviderError && e.code === 'provider_auth' && e.status === 502 && e.message === UZAPI_ACCOUNT_AUTH_MESSAGE,
  )
  assert.equal(UZAPI_ACCOUNT_AUTH_MESSAGE, 'A UzAPI recusou a credencial da conta Dros. Confira UZAPI_USERNAME e UZAPI_ACCOUNT_TOKEN no servidor.')
  const other = setup({ createInstance: fail('uzapi_create_failed') })
  await assert.rejects(
    () => other.manager.createUzapiInstance({ accountId: other.seed.account.id, instanceName: 'Nova' }),
    (e) => e.code === 'uzapi_create_failed' && /Tente de novo em instantes/.test(e.message),
  )
})

test('restart: falha da UzAPI vira ProviderError 502 (provider_auth com mensagem propria; resto pede para tentar de novo)', async () => {
  let r = { ok: true }
  const { db, seed, manager } = setup({ restart: () => r })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connected' })
  assert.deepEqual(await manager.restart(inst), { ok: true })
  r = { ok: false, reason: 'provider_auth' }
  await assert.rejects(() => manager.restart(inst), (e) => e instanceof ProviderError && e.code === 'provider_auth' && e.status === 502 && e.message === UZAPI_INSTANCE_AUTH_MESSAGE)
  r = { ok: false, reason: 'provider_error' }
  await assert.rejects(() => manager.restart(inst), (e) => e instanceof ProviderError && e.code === 'provider_error' && e.status === 502 && e.message === 'A UzAPI não conseguiu reiniciar o número. Tente de novo em instantes.')
})

test('refreshQr: UzAPI recusou a credencial (provider_auth) -> devolve o erro e a mensagem, mantendo o painel como alternativa', async () => {
  const { db, seed, manager } = setup({ status: () => ({ ok: false, status: null, phoneNumber: null, qr: null, reason: 'provider_auth' }) })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  const r = await manager.refreshQr(inst)
  assert.deepEqual([r.error, r.error_message, r.panel_url], ['provider_auth', UZAPI_INSTANCE_AUTH_MESSAGE, 'https://painel.uzapi.test'])
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { createInstanceManager, listAvailableProviders, sanitizeInstance, ProviderError } from '../server/services/whatsapp/instanceManager.js'
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
    async restart(i) { calls.restart.push(i.id); return { ok: true } },
    async remove(i) { calls.remove.push(i.id); return overrides.remove ? overrides.remove(i) : { ok: true } },
  }
  return { adapter, calls }
}

function setup(overrides = {}, env = UZAPI_TEST_ENV) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const { adapter, calls } = fakeUzapi(overrides)
  const manager = createInstanceManager({ db, getProvider: () => adapter, env, log: quietLog, removeTimeoutMs: 50 })
  return { db, seed, manager, calls }
}
const row = (db, id) => db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
const logs = (db) => db.prepare('SELECT instance_id, provider, event FROM whatsapp_connection_log ORDER BY id').all()

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

test('refreshQr: conectado, com QR, sem QR (plano B com panel_url) e UzAPI fora do ar', async () => {
  let st = { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null }
  const { db, seed, manager } = setup({ status: () => { if (st instanceof Error) throw st; return st } })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  assert.deepEqual((({ qr_code, status }) => ({ qr_code, status }))(await manager.refreshQr(inst)), { qr_code: null, status: 'connected' })

  db.prepare("UPDATE whatsapp_instances SET status = 'connecting' WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' }
  const withQr = await manager.refreshQr(row(db, inst.id))
  assert.equal(withQr.qr_code, 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE')
  assert.equal(withQr.panel_url, undefined)

  db.prepare("UPDATE whatsapp_instances SET qr_code = NULL WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: null }
  const planB = await manager.refreshQr(row(db, inst.id))
  assert.deepEqual([planB.qr_code, planB.status, planB.panel_url], [null, 'connecting', 'https://painel.uzapi.test'])

  st = new Error('ECONNREFUSED')
  const down = await manager.refreshQr(row(db, inst.id))
  assert.equal(down.panel_url, 'https://painel.uzapi.test')
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

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, TEST_TOKEN } from './helpers/db.js'
import { createWebhookRegistrar } from '../server/services/whatsapp/webhookRegistration.js'
import { apiUrlKey, checkApiUrlsAlive } from '../server/services/whatsapp/evolutionHealth.js'

const env = { PUBLIC_BASE_URL: 'https://crm.exemplo.com/crm' }

test('registra a URL por token no provedor', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  const calls = []
  const provider = { registerWebhook: async (i, url) => { calls.push([i.id, url]) } }
  const r = await createWebhookRegistrar({ db, getProvider: () => provider, env }).registerInstanceWebhook(instance)
  assert.deepEqual(r, { ok: true, url: `https://crm.exemplo.com/crm/api/webhooks/whatsapp/${TEST_TOKEN}` })
  assert.deepEqual(calls, [[instance.id, r.url]])
})

test('gera token antes de registrar quando a instancia nao tem', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  db.prepare('UPDATE whatsapp_instances SET webhook_token = NULL WHERE id = ?').run(instance.id)
  const semToken = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
  const provider = { registerWebhook: async () => {} }
  const r = await createWebhookRegistrar({ db, getProvider: () => provider, env }).registerInstanceWebhook(semToken)
  const salvo = db.prepare('SELECT webhook_token FROM whatsapp_instances WHERE id = ?').get(instance.id).webhook_token
  assert.match(salvo, /^[a-f0-9]{32}$/)
  assert.equal(r.url, `https://crm.exemplo.com/crm/api/webhooks/whatsapp/${salvo}`)
})

test('provedor sem registerWebhook ou erro de rede nao lanca', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  const a = await createWebhookRegistrar({ db, getProvider: () => ({}), env }).registerInstanceWebhook(instance)
  assert.deepEqual(a, { ok: false, url: null, reason: 'provider_without_webhook_registration' })
  const b = await createWebhookRegistrar({ db, getProvider: () => ({ registerWebhook: async () => { throw new Error('ECONNREFUSED') } }), env }).registerInstanceWebhook(instance)
  assert.equal(b.ok, false)
  assert.equal(b.reason, 'ECONNREFUSED')
  assert.match(b.url, /\/api\/webhooks\/whatsapp\//)
})

test('apiUrlKey tira barras finais', () => {
  assert.equal(apiUrlKey('http://evo:8080///'), 'http://evo:8080')
  assert.equal(apiUrlKey(null), '')
})

test('checkApiUrlsAlive: uma chamada por URL; 2xx/401/404 no ar, excecao fora do ar', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    if (url.startsWith('http://caiu')) throw new Error('ECONNREFUSED')
    if (url.startsWith('http://sem-chave')) return { ok: false, status: 401 }
    if (url.startsWith('http://sem-rota')) return { ok: false, status: 404 }
    return { ok: true, status: 200 }
  }
  const instances = [
    { api_url: 'http://evo-a:8080/' },
    { api_url: 'http://evo-a:8080' },
    { api_url: 'http://sem-chave:8080' },
    { api_url: 'http://sem-rota:8080' },
    { api_url: 'http://caiu:8080' },
    { api_url: '' },
  ]
  const alive = await checkApiUrlsAlive(instances, fakeFetch)
  assert.deepEqual(calls, ['http://evo-a:8080/', 'http://sem-chave:8080/', 'http://sem-rota:8080/', 'http://caiu:8080/'])
  assert.equal(alive.get('http://evo-a:8080'), true)
  assert.equal(alive.get('http://sem-chave:8080'), true)
  assert.equal(alive.get('http://sem-rota:8080'), true)
  assert.equal(alive.get('http://caiu:8080'), false)
  assert.equal(alive.has(''), false)
})

// Evolution reiniciando responde 502/503 em GET /. Se isso contar como "no ar", o tick segue,
// o r.json() do connectionState lanca e o catch marca toda instancia connected como disconnected
// (estado terminal: polling e reregistro so olham 'connected').
test('checkApiUrlsAlive: 5xx de restart da Evolution conta como fora do ar', async () => {
  const porUrl = { 'http://evo-502:8080/': 502, 'http://evo-503:8080/': 503, 'http://evo-500:8080/': 500 }
  const fakeFetch = async (url) => ({ ok: false, status: porUrl[url] })
  const instances = [
    { api_url: 'http://evo-502:8080' },
    { api_url: 'http://evo-503:8080' },
    { api_url: 'http://evo-500:8080' },
  ]
  const alive = await checkApiUrlsAlive(instances, fakeFetch)
  assert.equal(alive.get('http://evo-502:8080'), false)
  assert.equal(alive.get('http://evo-503:8080'), false)
  assert.equal(alive.get('http://evo-500:8080'), false)
})

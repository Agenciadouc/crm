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

test('checkApiUrlsAlive: uma chamada por URL; so excecao marca como fora do ar', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    if (url.startsWith('http://caiu')) throw new Error('ECONNREFUSED')
    return { ok: false, status: 500 }
  }
  const instances = [
    { api_url: 'http://evo-a:8080/' },
    { api_url: 'http://evo-a:8080' },
    { api_url: 'http://caiu:8080' },
    { api_url: '' },
  ]
  const alive = await checkApiUrlsAlive(instances, fakeFetch)
  assert.deepEqual(calls, ['http://evo-a:8080/', 'http://caiu:8080/'])
  assert.equal(alive.get('http://evo-a:8080'), true)
  assert.equal(alive.get('http://caiu:8080'), false)
  assert.equal(alive.has(''), false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUzapiAdapter } from '../server/services/whatsapp/uzapi.js'
import { mapDeploymentStatus, extractInstanceCredentials, UZAPI_WEBHOOK_EVENTS } from '../server/services/whatsapp/uzapiSession.js'
import { buildUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { fakeFetch, quietLog, UZAPI_TEST_ENV, UZAPI_PNID } from './helpers/uzapiFixtures.js'

const BASE = 'https://uzapi.test/dros/v1'
const inst = { id: 7, provider: 'uzapi', instance_name: 'Loja', provider_config: buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV) }
const make = (f, env = UZAPI_TEST_ENV) => createUzapiAdapter({ fetch: f, env, log: quietLog })
const WEBHOOK = 'https://crm.test/api/webhooks/whatsapp/' + 'c'.repeat(32)

test('eventos do webhook: sem grupos e sem historico', () => {
  assert.deepEqual({ ...UZAPI_WEBHOOK_EVENTS }, { authentication: true, connection: true, message_status: true, group_messages: false, group_events: false, history: false })
})

test('createInstance: POST /instance/add com o token da CONTA, QRCode e o webhook do numero', async () => {
  const f = fakeFetch(() => ({ status: 201, json: { phone_number_id: '100000000000009', token: 'TOKEN-NOVO' } }))
  const r = await make(f).createInstance({ name: 'Loja Centro', webhookUrl: WEBHOOK })
  assert.equal(f.calls[0].url, `${BASE}/instance/add`)
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer CONTA-TESTE')
  assert.deepEqual(f.calls[0].body, { name: 'Loja Centro', authenticationMethod: 'QRCode', webhook: WEBHOOK, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } })
  assert.deepEqual(r, { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null, qr: null })
})

test('createInstance: resposta embrulhada em data e sem token -> busca o token em GET /{pnid}/instance com o token da conta', async () => {
  const f = fakeFetch((url) => url.endsWith('/instance/add')
    ? { status: 201, json: { data: { phoneNumberId: 100000000000009, name: 'Loja Centro' } } }
    : { json: { deploymentStatus: 'pending', token: 'TOKEN-BUSCADO' } })
  const r = await make(f).createInstance({ name: 'Loja Centro', webhookUrl: WEBHOOK })
  assert.equal(f.calls[1].url, `${BASE}/100000000000009/instance`)
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer CONTA-TESTE')
  assert.deepEqual(r, { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-BUSCADO', uzapiInstanceId: 'Loja Centro', qr: null })
})

test('createInstance: erros com codigo', async () => {
  await assert.rejects(() => make(fakeFetch(() => ({ json: {} })), { ...UZAPI_TEST_ENV, UZAPI_ACCOUNT_TOKEN: '' }).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_not_configured')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 401, json: {} }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'provider_auth')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 409, json: { message: 'ja existe' } }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_create_failed')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 201, json: { ok: true } }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_create_incomplete')
})

test('extractInstanceCredentials aceita os nomes de campo provaveis', () => {
  assert.deepEqual(extractInstanceCredentials({ phone_number_id: '1', token: 't' }), { phoneNumberId: '1', instanceToken: 't', uzapiInstanceId: null })
  assert.deepEqual(extractInstanceCredentials({ data: { phoneNumberId: 2, accessToken: 'a', name: 'n' } }), { phoneNumberId: '2', instanceToken: 'a', uzapiInstanceId: 'n' })
  assert.deepEqual(extractInstanceCredentials(null), { phoneNumberId: null, instanceToken: null, uzapiInstanceId: null })
})

test('mapDeploymentStatus', () => {
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'connected', isAuthenticated: true }), 'connected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'running', isAuthenticated: true }), 'connected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'desconnected', isAuthenticated: true }), 'disconnected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'stopped' }), 'disconnected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'pending', isAuthenticated: false }), 'connecting')
  assert.equal(mapDeploymentStatus({}), 'connecting')
})

test('status: GET /{pnid}/instance com o token do numero; devolve status, telefone e QR (se vier)', async () => {
  const f = fakeFetch(() => ({ json: { deploymentStatus: 'connected', isAuthenticated: true, phoneNumber: '554890000001', token: 'NAO-USAR' } }))
  const r = await make(f).status(inst)
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/instance`)
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.deepEqual(r, { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null })
  const q = await make(fakeFetch(() => ({ json: { deploymentStatus: 'pending', qrcode: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' } }))).getQr(inst)
  assert.deepEqual(q, { ok: true, qr: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE', status: 'connecting', reason: undefined })
})

test('status: erro da UzAPI ou numero sem config nao lanca', async () => {
  assert.deepEqual(await make(fakeFetch(() => ({ status: 500, json: {} }))).status(inst), { ok: false, status: null, phoneNumber: null, qr: null, reason: 'provider_error' })
  assert.equal((await make(fakeFetch(() => ({ json: {} }))).status({ id: 1, provider_config: null })).reason, 'uzapi_config_missing')
})

test('registerWebhook: le a instancia e faz PUT /instance/update mantendo os demais campos', async () => {
  const f = fakeFetch((url, init) => init.method === 'GET'
    ? { json: { name: 'Loja', authenticationMethod: 'QRCode', autoRejectCall: true, answerMissedCall: 'Ligo depois', webhook: 'https://antigo' } }
    : { status: 201, json: {} })
  await make(f).registerWebhook(inst, WEBHOOK)
  assert.equal(f.calls[1].url, `${BASE}/${UZAPI_PNID}/instance/update`)
  assert.equal(f.calls[1].init.method, 'PUT')
  assert.deepEqual(f.calls[1].body, { authenticationMethod: 'QRCode', webhook: WEBHOOK, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS }, name: 'Loja', autoRejectCall: true, answerMissedCall: 'Ligo depois' })
  await assert.rejects(() => make(fakeFetch((u, i) => i.method === 'GET' ? { json: {} } : { status: 500, json: {} })).registerWebhook(inst, WEBHOOK), /uzapi_update_failed/)
})

test('disconnect, restart e remove: rotas e metodos certos; falha vira ok:false', async () => {
  const f = fakeFetch(() => ({ status: 201, json: {} }))
  const a = make(f)
  assert.deepEqual(await a.disconnect(inst), { ok: true })
  assert.deepEqual(await a.restart(inst), { ok: true })
  assert.deepEqual(await a.remove(inst), { ok: true })
  assert.deepEqual(f.calls.map(c => [c.init.method, c.url]), [
    ['POST', `${BASE}/${UZAPI_PNID}/instance/logout`],
    ['POST', `${BASE}/${UZAPI_PNID}/instance/restart`],
    ['DELETE', `${BASE}/${UZAPI_PNID}/instance/delete`],
  ])
  assert.deepEqual(await make(fakeFetch(() => ({ status: 409, json: { message: 'instancia nao existe' } }))).remove(inst), { ok: false, reason: 'instancia nao existe' })
})

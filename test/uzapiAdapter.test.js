import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FormData } from 'node-fetch'
import { createUzapiAdapter, createPendingSends, parseChatMessage, UZAPI_CAPABILITIES } from '../server/services/whatsapp/uzapi.js'
import { reasonFromResponse, getUzapiEnv, isUzapiConfigured } from '../server/services/whatsapp/uzapiClient.js'
import { buildUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { getProvider, listProviders } from '../server/services/whatsapp/index.js'
import { fakeFetch, quietLog, loadUzapiFixture, UZAPI_TEST_ENV, UZAPI_PNID, LEAD_PHONE } from './helpers/uzapiFixtures.js'

const BASE = 'https://uzapi.test/dros/v1'
const inst = { id: 7, account_id: 1, provider: 'uzapi', instance_name: 'Loja', provider_config: buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV) }
const make = (f, extra = {}) => createUzapiAdapter({ fetch: f, env: UZAPI_TEST_ENV, log: quietLog, ...extra })
const ok201 = (messageId = '3EB0AAA111') => ({ status: 201, json: { status: 'success', queueId: 'q1', messageId, messages: [{ id: 'wamid.x' }] } })

test('capabilities: sem presenca, sem checagem de numero, sem polling; com digitando embutido', () => {
  assert.deepEqual(UZAPI_CAPABILITIES, { qr: true, presence: false, readReceipts: false, numberCheck: false, templates: false, window24h: false, polling: false, typingDelay: true })
})

test('tomada: uzapi registrado ao lado da evolution', () => {
  assert.equal(getProvider({ provider: 'uzapi' }).name, 'uzapi')
  assert.deepEqual(listProviders(), ['evolution', 'uzapi'])
})

test('env: URL base padrao e "configurado" so com usuario e token da conta', () => {
  assert.equal(getUzapiEnv({}).baseUrl, 'https://api.uzapi.com.br')
  assert.equal(getUzapiEnv({ UZAPI_BASE_URL: 'https://x.test/' }).baseUrl, 'https://x.test')
  assert.equal(isUzapiConfigured({ UZAPI_USERNAME: 'u' }), false)
  assert.equal(isUzapiConfigured(UZAPI_TEST_ENV), true)
})

test('sendText: POST /{usuario}/v1/{pnid}/messages com Bearer do numero; 201 devolve o messageId (o id que volta nos status)', async () => {
  const f = fakeFetch(() => ok201())
  const r = await make(f).sendText(inst, '5548990000002', 'Ola')
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/messages`)
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json')
  assert.ok(f.calls[0].init.signal)
  assert.deepEqual(f.calls[0].body, { to: '5548990000002', type: 'text', text: { body: 'Ola' } })
  assert.equal(r.ok, true)
  assert.equal(r.messageId, '3EB0AAA111')
})

test('sendText: delayTyping vai no corpo quando pedido', async () => {
  const f = fakeFetch(() => ok201())
  await make(f).sendText(inst, '5548990000002', 'Ola', { delayTyping: 3 })
  assert.equal(f.calls[0].body.delayTyping, 3)
})

test('sendText: erros viram reason (401 provider_auth, 5xx e rede provider_error, 400 com mensagem) e nunca lancam', async () => {
  const cases = [
    [() => ({ status: 401, json: { message: 'Unauthorized' } }), 'provider_auth'],
    [() => ({ status: 502, bodyText: '<html>' }), 'provider_error'],
    [() => new Error('ECONNRESET'), 'provider_error'],
    [() => ({ status: 400, json: { message: ['to invalido'] } }), 'to invalido'],
    [() => ({ status: 201, json: { status: 'success' } }), 'provider_no_message_id'],
  ]
  for (const [responder, reason] of cases) {
    const r = await make(fakeFetch(responder)).sendText(inst, '1', 'x')
    assert.equal(r.ok, false)
    assert.equal(r.reason, reason)
  }
  const semConfig = await make(fakeFetch(() => ok201())).sendText({ id: 9, provider: 'uzapi', provider_config: null }, '1', 'x')
  assert.deepEqual(semConfig, { ok: false, messageId: null, reason: 'uzapi_config_missing' })
})

test('reasonFromResponse', () => {
  assert.equal(reasonFromResponse({ status: 403, data: null }), 'provider_auth')
  assert.equal(reasonFromResponse({ status: 0, data: null, error: 'timeout' }), 'provider_error')
  assert.equal(reasonFromResponse({ status: 404, data: null }), 'http_404')
})

test('sendMedia com url: envia por link', async () => {
  const f = fakeFetch(() => ok201('3EBIMG'))
  const r = await make(f).sendMedia(inst, '5548990000002', { type: 'image', url: 'https://x.test/a.jpg', caption: 'Veja' })
  assert.deepEqual(f.calls[0].body, { to: '5548990000002', type: 'image', image: { link: 'https://x.test/a.jpg', caption: 'Veja' } })
  assert.equal(r.messageId, '3EBIMG')
})

test('sendMedia com base64: sobe em /media (multipart) e envia pelo id; documento leva filename e legenda', async () => {
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 201, json: { id: 'MEDIA123' } } : ok201('3EBDOC'))
  const r = await make(f).sendMedia(inst, '5548990000002', { type: 'document', base64: Buffer.from('%PDF').toString('base64'), mimetype: 'application/pdf', fileName: 'proposta.pdf', caption: 'Segue' })
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/media`)
  assert.ok(f.calls[0].body instanceof FormData)
  assert.equal(f.calls[0].body.get('messaging_product'), 'whatsapp')
  assert.equal(f.calls[0].body.get('file').name, 'proposta.pdf')
  assert.equal(f.calls[0].body.get('file').type, 'application/pdf')
  assert.equal(f.calls[0].init.headers['Content-Type'], undefined, 'o multipart define o proprio Content-Type')
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'document', document: { id: 'MEDIA123', caption: 'Segue', filename: 'proposta.pdf' } })
  assert.equal(r.messageId, '3EBDOC')
})

test('sendMedia de audio: sem legenda (chega como mensagem de voz)', async () => {
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 201, json: { id: 'AUD9' } } : ok201('3EBAUD'))
  await make(f).sendMedia(inst, '5548990000002', { type: 'audio', base64: 'T2dnUw==', mimetype: 'audio/ogg', fileName: 'a.ogg', caption: 'nao vai' })
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'audio', audio: { id: 'AUD9' } })
})

test('sendMedia: subida falhou -> link temporario do CRM; sem link temporario -> erro', async () => {
  const put = []
  const mediaTemp = { put: (buf, mime) => { put.push([buf.toString(), mime]); return 'https://crm.test/api/media-temp/' + 'f'.repeat(32) } }
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 500, json: {} } : ok201('3EBLINK'))
  const r = await make(f, { getMediaTemp: () => mediaTemp }).sendMedia(inst, '5548990000002', { type: 'image', base64: Buffer.from('JPG').toString('base64'), mimetype: 'image/jpeg' })
  assert.deepEqual(put, [['JPG', 'image/jpeg']])
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'image', image: { link: 'https://crm.test/api/media-temp/' + 'f'.repeat(32) } })
  assert.equal(r.messageId, '3EBLINK')
  const semReserva = await make(fakeFetch(() => ({ status: 500, json: {} }))).sendMedia(inst, '1', { type: 'image', base64: 'QQ==' })
  assert.deepEqual(semReserva, { ok: false, messageId: null, reason: 'provider_error' })
})

test('fetchMedia: pega a url pelo media id (media_url da mensagem) e baixa o arquivo sem mandar token para a url', async () => {
  const f = fakeFetch((url) => url === `${BASE}/582578164494741`
    ? { json: { url: 'https://uzapi.test/v1/100000000000001/arquivo.ogg', mime_type: 'audio/ogg; codecs=opus' } }
    : { buffer: Buffer.from('OGGDATA'), headers: { 'content-type': 'audio/ogg' } })
  const r = await make(f).fetchMedia(inst, { wa_msg_id: '2AF1064222DEF32AAEBA', media_url: '582578164494741' })
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.equal(f.calls[1].url, 'https://uzapi.test/v1/100000000000001/arquivo.ogg')
  assert.equal(f.calls[1].init.headers, undefined)
  assert.equal(r.buffer.toString(), 'OGGDATA')
  assert.equal(r.mimetype, 'audio/ogg; codecs=opus')
})

test('fetchMedia: sem media id ou midia inexistente lanca media_not_found', async () => {
  const a = make(fakeFetch(() => ({ status: 404, json: {} })))
  await assert.rejects(() => a.fetchMedia(inst, { wa_msg_id: 'X' }), (e) => e.code === 'media_not_found')
  await assert.rejects(() => a.fetchMedia(inst, { wa_msg_id: 'X', media_url: 'M1' }), (e) => e.code === 'media_not_found')
})

test('parseWebhook: confere o phone_number_id do numero', () => {
  const a = make(fakeFetch(() => ok201()))
  assert.equal(a.parseWebhook(inst, loadUzapiFixture('message-text.json'), {}).messages.length, 1)
  const outro = { ...inst, provider_config: buildUzapiConfig({ phoneNumberId: '999999999999999', instanceToken: 'T' }, UZAPI_TEST_ENV) }
  assert.equal(a.parseWebhook(outro, loadUzapiFixture('message-text.json'), {}).messages.length, 0)
  assert.deepEqual(a.parseWebhook({ id: 1, provider_config: null }, loadUzapiFixture('message-text.json'), {}).messages, [])
})

test('fetchMessageById: POST /chats action get e devolve a mensagem como enviada (fromMe) no telefone dado', async () => {
  const f = fakeFetch(() => ({ json: loadUzapiFixture('chats-get-echo.synthetic.json') }))
  const r = await make(f).fetchMessageById(inst, '2A286AC5064891EF4DE7', { phone: LEAD_PHONE })
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/chats`)
  assert.deepEqual(f.calls[0].body, { type: 'chats', action: 'get', chats: { message_id: '2A286AC5064891EF4DE7' } })
  assert.deepEqual(r, {
    phone: LEAD_PHONE, remoteId: `${LEAD_PHONE}@s.whatsapp.net`, fromMe: true, messageId: '2A286AC5064891EF4DE7',
    pushName: '', timestamp: '2026-09-21T20:27:57.000Z', type: 'text', text: 'Resposta pelo celular', mediaRef: null,
  })
  assert.equal(await make(fakeFetch(() => ({ status: 401, json: {} }))).fetchMessageById(inst, 'X', { phone: LEAD_PHONE }), null)
})

test('parseChatMessage: Conversation, imagem sem texto e mensagem que nao e do numero', () => {
  const conv = parseChatMessage({ data: { Info: { ID: 'A1', IsFromMe: true }, Message: { Conversation: 'oi' } } }, { phone: LEAD_PHONE, messageId: 'A1' })
  assert.equal(conv.text, 'oi')
  const img = parseChatMessage({ data: { data: { Info: { IsFromMe: true }, Message: { imageMessage: { caption: '' } } } } }, { phone: LEAD_PHONE, messageId: 'A2' })
  assert.deepEqual([img.type, img.text, img.messageId], ['image', '[Imagem]', 'A2'])
  assert.equal(parseChatMessage({ data: { data: { Info: { IsFromMe: false }, Message: { Conversation: 'x' } } } }, { phone: LEAD_PHONE, messageId: 'A3' }), null)
  assert.equal(parseChatMessage({}, { phone: LEAD_PHONE, messageId: 'A4' }), null)
})

test('sendText: com delayTyping o timeout do POST cresce (15 s + digitando + 5 s); sem ele fica o padrao', async () => {
  const seen = []
  const client = { async request(method, path, opts) { seen.push(opts.timeout); return { ok: true, status: 201, data: { messageId: 'M1' } } } }
  const a = make(fakeFetch(() => ok201()), { client })
  await a.sendText(inst, '5548990000002', 'Ola', { delayTyping: 10 })
  await a.sendText(inst, '5548990000002', 'Ola')
  assert.deepEqual(seen, [30000, undefined])
})

test('envios em andamento: marcado durante o POST (texto e midia) e desmarcado ao terminar, mesmo com erro', async () => {
  const pendingSends = createPendingSends()
  let release
  const f = fakeFetch(() => new Promise(r => { release = () => r(ok201()) }))
  const a = make(f, { pendingSends })
  assert.equal(pendingSends.isSending(inst.id, LEAD_PHONE), false)
  const p = a.sendText(inst, '554890000002', 'Ola')
  await new Promise(r => setImmediate(r))
  // mesma pessoa com e sem o 9 do celular
  assert.equal(pendingSends.isSending(inst.id, LEAD_PHONE), true)
  assert.equal(pendingSends.isSending(inst.id + 1, LEAD_PHONE), false)
  release()
  await p
  assert.equal(pendingSends.isSending(inst.id, LEAD_PHONE), false)
  const falha = make(fakeFetch(() => new Error('rede')), { pendingSends })
  await falha.sendMedia(inst, LEAD_PHONE, { type: 'image', url: 'https://x.test/a.png' })
  assert.equal(pendingSends.isSending(inst.id, LEAD_PHONE), false)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvolutionAdapter, EVOLUTION_WEBHOOK_EVENTS } from '../server/services/whatsapp/evolution.js'

const inst = { id: 1, instance_name: 'inst-teste', api_url: 'http://evo.local', api_key: 'KEY' }

function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const r = await responder(url, init, calls.length)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (r.bodyText !== undefined) return JSON.parse(r.bodyText); return r.json },
    }
  }
  fn.calls = calls
  return fn
}

test('sendText: rota, headers e corpo iguais ao codigo atual; sucesso devolve messageId', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'WAMSG1' }, status: 'PENDING' } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendText(inst, '5547991351835', 'Ola')
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendText/inst-teste')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.deepEqual(f.calls[0].init.headers, { 'Content-Type': 'application/json', apikey: 'KEY' })
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', text: 'Ola' })
  assert.equal(r.ok, true)
  assert.equal(r.messageId, 'WAMSG1')
  assert.deepEqual(r.raw, { key: { id: 'WAMSG1' }, status: 'PENDING' })
})

test('sendText: recusa com exists=false vira number_not_on_whatsapp', async () => {
  const f = fakeFetch(() => ({ status: 400, json: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: 'x', number: '5547' }] } } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendText(inst, '5547', 'Ola')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'number_not_on_whatsapp')
  assert.ok(r.raw)
})

test('sendText: erro sem corpo JSON vira http_<status>; excecao vira mensagem', async () => {
  const f1 = fakeFetch(() => ({ status: 502, bodyText: '<html>' }))
  const r1 = await createEvolutionAdapter({ fetch: f1 }).sendText(inst, '1', 'x')
  assert.equal(r1.reason, 'http_502')
  const f2 = fakeFetch(() => new Error('ECONNREFUSED'))
  const r2 = await createEvolutionAdapter({ fetch: f2 }).sendText(inst, '1', 'x')
  assert.deepEqual(r2, { ok: false, messageId: null, reason: 'ECONNREFUSED' })
})

test('sendMedia: audio usa sendWhatsAppAudio com encoding', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'AUD1' } } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendMedia({ ...inst, instance_name: 'inst teste' }, '5547991351835', { type: 'audio', base64: 'QUJD', mimetype: 'audio/ogg', fileName: 'a.ogg' })
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendWhatsAppAudio/inst%20teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', audio: 'QUJD', encoding: true })
  assert.equal(r.messageId, 'AUD1')
})

test('sendMedia: imagem usa sendMedia; caption vazia nao vai no corpo', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'IMG1' } } }))
  await createEvolutionAdapter({ fetch: f }).sendMedia(inst, '5547991351835', { type: 'image', base64: 'QUJD', mimetype: 'image/png', fileName: 'foto.png', caption: '' })
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendMedia/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', mediatype: 'image', media: 'QUJD', mimetype: 'image/png', fileName: 'foto.png' })
})

test('sendPresence', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  const r = await createEvolutionAdapter({ fetch: f }).sendPresence(inst, '5547991351835', 'composing')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/sendPresence/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', presence: 'composing', delay: 100 })
  assert.ok(f.calls[0].init.signal)
  assert.deepEqual(r, { ok: true })
  const r2 = await createEvolutionAdapter({ fetch: fakeFetch(() => new Error('x')) }).sendPresence(inst, '1', 'paused')
  assert.deepEqual(r2, { ok: false })
})

test('checkNumber: numero unico usa data[0].exists', async () => {
  const f = fakeFetch(() => ({ json: [{ exists: false, jid: '5547@s.whatsapp.net', number: '9999' }] }))
  const r = await createEvolutionAdapter({ fetch: f }).checkNumber(inst, ['5547991351835'])
  assert.equal(f.calls[0].url, 'http://evo.local/chat/whatsappNumbers/inst-teste')
  assert.deepEqual(f.calls[0].body, { numbers: ['5547991351835'] })
  assert.deepEqual(r, { '5547991351835': false })
})

test('checkNumber: lista casa por number; ausente fica null', async () => {
  const f = fakeFetch(() => ({ json: [{ exists: true, number: '5547991351835' }, { exists: false, number: '+55 47 98888-7777' }] }))
  const r = await createEvolutionAdapter({ fetch: f }).checkNumber(inst, ['5547991351835', '5547988887777', '5547900000000'], { matchByNumber: true })
  assert.deepEqual(r, { '5547991351835': true, '5547988887777': false, '5547900000000': null })
})

test('checkNumber: http erro ou corpo nao-array -> tudo null; erro de rede lanca', async () => {
  const a = createEvolutionAdapter({ fetch: fakeFetch(() => ({ status: 500, json: {} })) })
  assert.deepEqual(await a.checkNumber(inst, ['1', '2'], { matchByNumber: true }), { 1: null, 2: null })
  const b = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { error: 'x' } })) })
  assert.deepEqual(await b.checkNumber(inst, ['1']), { 1: null })
  const c = createEvolutionAdapter({ fetch: fakeFetch(() => new Error('timeout')) })
  await assert.rejects(() => c.checkNumber(inst, ['1']), /timeout/)
})

test('markRead usa leads.wa_remote_jid (corrige coluna inexistente em messages)', async () => {
  const f = fakeFetch(() => ({ json: { message: 'Read messages', read: 'success' } }))
  const r = await createEvolutionAdapter({ fetch: f }).markRead(inst, { id: 9, phone: '5547991351835', wa_remote_jid: '123456789012345@lid' }, 'MSG9')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/markMessageAsRead/inst-teste')
  assert.deepEqual(f.calls[0].body, { read_messages: [{ remoteJid: '123456789012345@lid', fromMe: false, id: 'MSG9' }] })
  assert.deepEqual(r, { ok: true })
})

test('markRead sem wa_remote_jid monta o JID pelo telefone; sem nada nao chama', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  const a = createEvolutionAdapter({ fetch: f })
  await a.markRead(inst, { phone: '47991351835', wa_remote_jid: null }, 'M1')
  assert.equal(f.calls[0].body.read_messages[0].remoteJid, '5547991351835@s.whatsapp.net')
  assert.deepEqual(await a.markRead(inst, { phone: null, wa_remote_jid: null }, 'M2'), { ok: false })
  assert.equal(f.calls.length, 1)
})

test('fetchMedia devolve buffer e mimetype; sem base64 lanca media_not_found', async () => {
  const f = fakeFetch(() => ({ json: { base64: Buffer.from('ola').toString('base64'), mimetype: 'audio/ogg; codecs=opus' } }))
  const r = await createEvolutionAdapter({ fetch: f }).fetchMedia(inst, { wa_msg_id: 'AUD9' })
  assert.equal(f.calls[0].url, 'http://evo.local/chat/getBase64FromMediaMessage/inst-teste')
  assert.deepEqual(f.calls[0].body, { message: { key: { id: 'AUD9' } }, convertToMp4: false })
  assert.equal(r.buffer.toString(), 'ola')
  assert.equal(r.mimetype, 'audio/ogg; codecs=opus')
  const g = fakeFetch(() => ({ status: 404, json: { error: 'not found' } }))
  await assert.rejects(() => createEvolutionAdapter({ fetch: g }).fetchMedia(inst, { wa_msg_id: 'X' }), (e) => e.code === 'media_not_found' && /evolution_no_base64 \(status=404\)/.test(e.message))
})

test('fetchProfilePictureUrl', async () => {
  const f = fakeFetch(() => ({ json: { wuid: 'x', profilePictureUrl: 'https://pps.whatsapp.net/p.jpg' } }))
  const url = await createEvolutionAdapter({ fetch: f }).fetchProfilePictureUrl(inst, '5547991351835')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/fetchProfilePictureUrl/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835' })
  assert.equal(url, 'https://pps.whatsapp.net/p.jpg')
  const g = fakeFetch(() => ({ json: {} }))
  assert.equal(await createEvolutionAdapter({ fetch: g }).fetchProfilePictureUrl(inst, '1'), null)
})

test('registerWebhook assina MESSAGES_UPSERT e MESSAGES_UPDATE', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  await createEvolutionAdapter({ fetch: f }).registerWebhook({ ...inst, instance_name: 'inst teste' }, 'https://x/crm/api/webhooks/whatsapp/tok')
  assert.deepEqual(EVOLUTION_WEBHOOK_EVENTS, ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'])
  assert.equal(f.calls[0].url, 'http://evo.local/webhook/set/inst%20teste')
  assert.deepEqual(f.calls[0].body, { webhook: { url: 'https://x/crm/api/webhooks/whatsapp/tok', enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
})

test('fetchRecentMessages aceita os 3 formatos de resposta', async () => {
  const rec = { key: { id: 'A', remoteJid: '1@s.whatsapp.net' } }
  const a = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { messages: { total: 1, records: [rec] } } })) })
  assert.deepEqual(await a.fetchRecentMessages(inst), [rec])
  const b = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { messages: [rec] } })) })
  assert.deepEqual(await b.fetchRecentMessages(inst), [rec])
  const f = fakeFetch(() => ({ json: [rec] }))
  assert.deepEqual(await createEvolutionAdapter({ fetch: f }).fetchRecentMessages(inst, { limit: 200 }), [rec])
  assert.equal(f.calls[0].url, 'http://evo.local/chat/findMessages/inst-teste')
  assert.deepEqual(f.calls[0].body, { where: {}, limit: 200 })
  const c = createEvolutionAdapter({ fetch: fakeFetch(() => ({ status: 500, json: {} })) })
  assert.equal(await c.fetchRecentMessages(inst), null)
})

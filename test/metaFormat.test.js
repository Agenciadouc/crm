import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMetaWebhook, extractQr } from '../server/services/whatsapp/metaFormat.js'
import { loadUzapiFixture as F, UZAPI_PNID, DROS_NUMBER, LEAD_WA_ID, LEAD_PHONE } from './helpers/uzapiFixtures.js'

const parse = (body) => parseMetaWebhook(body, { phoneNumberId: UZAPI_PNID, log: null })

const wrap = (message, contacts = [{ profile: { name: 'Contato 02' }, wa_id: LEAD_WA_ID }]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: DROS_NUMBER, phone_number_id: UZAPI_PNID },
    contacts,
    messages: [{ from: LEAD_WA_ID, id: 'SYN1', isGroup: false, timestamp: '1790022408', ...message }],
  } }] }],
})

test('texto recebido (aviso real): telefone normalizado, nome, id e hora', () => {
  const r = parse(F('message-text.json'))
  assert.deepEqual(r.messages, [{
    phone: LEAD_PHONE, remoteId: `${LEAD_PHONE}@s.whatsapp.net`, fromMe: false,
    messageId: '2A2ACD4E776A27C10B00', pushName: 'Contato 02', timestamp: '2026-09-21T20:26:48.000Z',
    mediaRef: null, type: 'text', text: 'Teste 1',
  }])
  assert.deepEqual(r.statuses, [])
  assert.deepEqual(r.echoes, [])
  assert.equal(r.connection, null)
})

test('audio, foto e documento reais: mediaRef = id da midia; foto sem legenda vira [Imagem]; documento usa o nome', () => {
  const audio = parse(F('message-audio.json')).messages[0]
  assert.equal(audio.type, 'audio')
  assert.equal(audio.text, '[Audio]')
  assert.equal(audio.mediaRef, '582578164494741')
  assert.equal(audio.timestamp, '2026-09-21T20:27:04.000Z')
  const img = parse(F('message-image.json')).messages[0]
  assert.equal(img.type, 'image')
  assert.equal(img.text, '[Imagem]')
  assert.equal(img.mediaRef, '004874887872726')
  const doc = parse(F('message-document.json')).messages[0]
  assert.equal(doc.type, 'document')
  assert.equal(doc.text, 'documento.pdf')
  assert.equal(doc.mediaRef, '946384130837237')
  assert.equal(doc.fileName, 'documento.pdf')
})

test('mensagens de grupo sao descartadas', () => {
  assert.deepEqual(parse(F('group-image.json')).messages, [])
  assert.deepEqual(parse(F('group-text.json')).messages, [])
  assert.deepEqual(parse(wrap({ from: '120363000000000001@g.us', type: 'text', text: { body: 'x' } })).messages, [])
})

test('status delivered/read de mensagem enviada: vira NormalizedStatus e tambem candidato a eco (recipient_id vazio)', () => {
  const r = parse(F('status-sent-delivered.json'))
  assert.deepEqual(r.statuses, [{ messageId: '3EB03F3FB62BE08FFAA771', status: 'delivered', timestamp: '2026-09-21T20:28:54.000Z', recipientId: '', outboundOnly: true }])
  assert.deepEqual(r.echoes, [{ messageId: '3EB03F3FB62BE08FFAA771', phone: LEAD_PHONE, timestamp: '2026-09-21T20:28:54.000Z' }])
})

test('resposta dada pelo celular (so status, recipient_id vazio): eco com o telefone do lead', () => {
  for (const f of ['status-echo-delivered.json', 'status-echo-read.json']) {
    const r = parse(F(f))
    assert.equal(r.echoes.length, 1, f)
    assert.equal(r.echoes[0].messageId, '2A286AC5064891EF4DE7')
    assert.equal(r.echoes[0].phone, LEAD_PHONE)
  }
  assert.equal(parse(F('status-echo-read-by-lead.json')).echoes[0].messageId, '3B612B564A8E2CFE7929')
})

test('leitura feita pelo proprio numero (recipient_id preenchido): status outboundOnly, sem eco; played vira read', () => {
  const read = parse(F('status-read-by-self.json'))
  assert.deepEqual(read.statuses, [{ messageId: '2A2ACD4E776A27C10B00', status: 'read', timestamp: '2026-09-21T20:27:36.000Z', recipientId: LEAD_WA_ID, outboundOnly: true }])
  assert.deepEqual(read.echoes, [])
  const played = parse(F('status-played-by-self.json'))
  assert.equal(played.statuses[0].status, 'read')
  assert.deepEqual(played.echoes, [])
})

test('connection: connected (real) e desconnected (grafia da UzAPI) viram connected/disconnected', () => {
  assert.equal(parse(F('connection-connected.json')).connection, 'connected')
  assert.equal(parse(F('connection-desconnected.synthetic.json')).connection, 'disconnected')
  assert.equal(parse(F('connection-connected.json')).qr, null)
})

test('authentication: QR achado pelo nome do campo (hipotese)', () => {
  assert.equal(parse(F('authentication-qr.synthetic.json')).qr, '2@QR-DE-TESTE-NAO-E-REAL,abcdefghijklmnopqrstuvwxyz')
  assert.equal(extractQr({ data: { qrCode: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' } }), 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE')
  assert.equal(extractQr({ code: 123 }), null)
  assert.equal(extractQr({ qr: 'curto' }), null)
})

test('phone_number_id diferente do numero: aviso inteiro descartado', () => {
  const body = F('message-text.json')
  body.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999'
  const r = parse(body)
  assert.deepEqual(r.messages, [])
  assert.equal(r.ignored, 1)
})

test('lote com varios entry: percorre todos', () => {
  const body = { object: 'whatsapp_business_account', entry: [
    ...F('message-text.json').entry, ...F('status-echo-delivered.json').entry, ...F('connection-connected.json').entry,
  ] }
  const r = parse(body)
  assert.equal(r.messages.length, 1)
  assert.equal(r.statuses.length, 1)
  assert.equal(r.echoes.length, 1)
  assert.equal(r.connection, 'connected')
})

test('tipos sinteticos: video, sticker, localizacao, contato, reacao, botao, lista e desconhecido', () => {
  const one = (m) => parse(wrap(m)).messages[0]
  assert.deepEqual([one({ type: 'video', video: { caption: '', id: 'V1' } }).text, one({ type: 'video', video: { id: 'V1' } }).mediaRef], ['[Video]', 'V1'])
  assert.deepEqual([one({ type: 'sticker', sticker: { id: 'S1' } }).type, one({ type: 'sticker', sticker: { id: 'S1' } }).text], ['sticker', '[Sticker]'])
  assert.equal(one({ type: 'location', location: { latitude: -23.3194284, longitude: -51.1185137, name: '' } }).text, '\u{1F4CD} Localizacao: -23.3194284, -51.1185137')
  assert.equal(one({ type: 'location', location: { name: 'Clinica' } }).text, '\u{1F4CD} Clinica')
  const contact = one({ type: 'contacts', contacts: [{ name: { formatted_name: 'Fulano' }, phones: [{ phone: '+55 11 3000-0000' }] }] })
  assert.deepEqual([contact.type, contact.text, contact.mediaRef], ['contact', '\u{1F464} Fulano — 551130000000', '551130000000'])
  assert.equal(one({ type: 'reaction', reaction: { emoji: '😮', message_id: 'X' } }).text, '😮 (reacao)')
  assert.deepEqual([one({ type: 'button_reply', interactive: { button_reply: { id: 'b1', title: 'Sim' } } }).type, one({ type: 'button_reply', interactive: { button_reply: { id: 'b1', title: 'Sim' } } }).text], ['text', 'Sim'])
  assert.equal(one({ type: 'button_reply', interactive: { type: 'list_reply', list_reply: { id: 'r2', title: 'Opcao 2' } } }).text, 'Opcao 2')
  assert.deepEqual([one({ type: 'order' }).type, one({ type: 'order' }).text], ['unknown', '[order]'])
})

test('corpo invalido nao lanca', () => {
  for (const b of [
    null, undefined, 'x', {}, { entry: 'x' },
    { entry: [{ changes: [{ field: 'messages', value: null }] }] },
    { entry: [null] },
    { entry: [{ changes: [null] }] },
  ]) {
    assert.deepEqual(parseMetaWebhook(b, { log: null }).messages, [])
  }
})

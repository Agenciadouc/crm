import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import {
  createEvolutionAdapter, parseEvolutionRecord, parseEvolutionStatuses, EVOLUTION_CAPABILITIES,
} from '../server/services/whatsapp/evolution.js'
import { getProvider, listProviders } from '../server/services/whatsapp/index.js'

const inst = { id: 1, instance_name: 'inst-teste', api_url: 'http://evo.local', api_key: 'KEY', provider: 'evolution' }
const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('fetch nao deveria ser chamado') } })
const quiet = { log: null }
const one = (payload) => {
  const r = adapter.parseWebhook(inst, payload, {})
  assert.equal(r.statuses.length, 0)
  assert.equal(r.messages.length, 1)
  return r.messages[0]
}

test('texto (conversation)', () => {
  assert.deepEqual(one(P.textConversation), {
    phone: '5547991351835', remoteId: '5547991351835@s.whatsapp.net', fromMe: false,
    messageId: '3EB0A1B2C3D4E5F60001', pushName: 'Maria Silva', timestamp: P.TS_ISO,
    type: 'text', text: 'Oi, quero saber o preco', mediaRef: null,
  })
})

test('extendedText com numero de 12 digitos ganha o 9', () => {
  const m = one(P.extendedText12Digits)
  assert.equal(m.phone, '5547991351835')
  assert.equal(m.remoteId, '5547991351835@s.whatsapp.net')
  assert.equal(m.type, 'text')
  assert.equal(m.text, 'Vi o site de voces')
  assert.equal(m.adReferral, undefined)
})

test('audio', () => {
  const m = one(P.audioPtt)
  assert.equal(m.type, 'audio')
  assert.equal(m.text, '[Audio]')
  assert.equal(m.mediaRef, 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc')
})

test('imagem com legenda', () => {
  const m = one(P.imageWithCaption)
  assert.equal(m.type, 'image')
  assert.equal(m.text, 'Esse modelo')
  assert.equal(m.mediaRef, 'https://mmg.whatsapp.net/o1/v/t62.7118-24/image-0004.enc')
})

test('documento usa o nome do arquivo', () => {
  const m = one(P.documentPdf)
  assert.equal(m.type, 'document')
  assert.equal(m.text, 'orcamento.pdf')
})

test('reacao', () => {
  const m = one(P.reaction)
  assert.equal(m.type, 'reaction')
  assert.equal(m.text, '\u{1F44D} (reacao)')
  assert.equal(m.mediaRef, null)
})

test('protocolMessage REVOKE vira system', () => {
  const m = one(P.revoke)
  assert.equal(m.type, 'system')
  assert.equal(m.text, '\u{1F6AB} Mensagem apagada')
})

test('anuncio CTWA traz o externalAdReply do nivel root', () => {
  const m = one(P.ctwaAd)
  assert.equal(m.text, 'P9 Ola, vi o anuncio e quero agendar')
  assert.equal(m.adReferral.ctwaClid, 'Afc123XYZ')
  assert.equal(m.adReferral.sourceType, 'ad')
  assert.equal(m.adReferral.sourceUrl, 'https://fb.me/abc123')
  assert.equal(m.adReferral.title, 'Pilates experimental')
})

test('@lid com pushName usa o LID como identificador', () => {
  const m = one(P.lidWithPushName)
  assert.equal(m.phone, '123456789012345')
  assert.equal(m.remoteId, '123456789012345@lid')
  assert.equal(m.pushName, 'Joao Lid')
})

test('@lid sem pushName e ignorado', () => {
  assert.deepEqual(adapter.parseWebhook(inst, P.lidWithoutPushName, {}), { messages: [], statuses: [] })
})

test('@lid com senderPn usa o telefone real', () => {
  const m = one(P.lidWithSenderPn)
  assert.equal(m.phone, '5547988887777')
  assert.equal(m.remoteId, '5547988887777@s.whatsapp.net')
})

test('grupo e status@broadcast sao filtrados', () => {
  assert.deepEqual(adapter.parseWebhook(inst, P.groupMessage, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, P.statusBroadcast, {}), { messages: [], statuses: [] })
})

test('fromMe', () => {
  const m = one(P.outboundFromMe)
  assert.equal(m.fromMe, true)
  assert.equal(m.pushName, 'Atendente Loja')
})

test('status update (objeto com keyId e string READ)', () => {
  const r = adapter.parseWebhook(inst, P.statusUpdateRead, {})
  assert.equal(r.messages.length, 0)
  assert.equal(r.statuses.length, 1)
  assert.equal(r.statuses[0].messageId, 'BAE5OUTBOUND0001')
  assert.equal(r.statuses[0].status, 'read')
  assert.match(r.statuses[0].timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('status update (array numerico, evento maiusculo): 0 e ignorado', () => {
  const r = parseEvolutionStatuses(P.statusUpdateArrayNumeric.data)
  assert.deepEqual(r.map(s => [s.messageId, s.status]), [['BAE5OUTBOUND0001', 'delivered'], ['BAE5OUTBOUND0003', 'sent']])
  assert.equal(adapter.parseWebhook(inst, P.statusUpdateArrayNumeric, {}).statuses.length, 2)
})

test('evento desconhecido ou sem data nao gera nada', () => {
  assert.deepEqual(adapter.parseWebhook(inst, { event: 'connection.update', data: { state: 'open' } }, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, { event: 'messages.upsert' }, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, {}, {}), { messages: [], statuses: [] })
})

test('tipos extras: localizacao, contato, enquete, visualizacao unica, desconhecido', () => {
  const rec = (message) => parseEvolutionRecord({ key: { remoteJid: '5547991351835@s.whatsapp.net', id: 'X' }, pushName: 'M', message, messageTimestamp: P.TS }, quiet)[0]
  assert.equal(rec({ locationMessage: { degreesLatitude: -26.9, degreesLongitude: -48.6 } }).type, 'location')
  const c = rec({ contactMessage: { displayName: 'Ana', vcard: 'BEGIN:VCARD\nFN:Ana\nTEL;type=CELL;waid=5547911112222:+55 47 91111-2222\nEND:VCARD' } })
  assert.equal(c.type, 'contact')
  assert.equal(c.mediaRef, '5547911112222')
  assert.equal(rec({ pollCreationMessageV3: { name: 'Horario' } }).type, 'poll')
  assert.equal(rec({ viewOnceMessageV2: { message: {} } }).type, 'view_once')
  const u = rec({ newsletterAdminInviteMessage: { newsletterJid: 'x' } })
  assert.equal(u.type, 'unknown')
  assert.equal(u.text, '[newsletterAdminInviteMessage]')
})

test('parsePolledRecord usa o mesmo parse sem log', () => {
  const [m] = adapter.parsePolledRecord(inst, P.polledRecordText)
  assert.equal(m.phone, '5547966665555')
  assert.equal(m.messageId, '3EB0POLL00000001')
  assert.equal(m.text, 'Mensagem perdida')
})

test('capabilities e getProvider', () => {
  assert.deepEqual(adapter.capabilities, EVOLUTION_CAPABILITIES)
  assert.equal(EVOLUTION_CAPABILITIES.polling, true)
  assert.equal(getProvider({ provider: 'evolution' }).name, 'evolution')
  assert.equal(getProvider({}).name, 'evolution')
  assert.equal(getProvider({ provider: null }).name, 'evolution')
  assert.throws(() => getProvider({ provider: 'cloud_api' }), /unknown_whatsapp_provider:cloud_api/)
  assert.deepEqual(listProviders(), ['evolution'])
})

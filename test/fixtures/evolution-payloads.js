// Payloads no formato enviado pela Evolution API v2 (webhook global/instancia), derivados do parse atual.
const base = (data, event = 'messages.upsert') => ({
  event,
  instance: 'inst-teste',
  data,
  destination: 'https://drosagencia.com.br/crm/api/webhooks/evolution/conta-teste',
  date_time: '2025-09-15T08:00:00.000Z',
  sender: '5547900000000@s.whatsapp.net',
  server_url: 'http://127.0.0.1:8080',
  apikey: 'KEY',
})

export const TS = 1757934000 // 2025-09-15T11:00:00.000Z
export const TS_ISO = '2025-09-15T11:00:00.000Z'

export const textConversation = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60001' },
  pushName: 'Maria Silva',
  status: 'DELIVERY_ACK',
  message: { conversation: 'Oi, quero saber o preco', messageContextInfo: { deviceListMetadataVersion: 2 } },
  messageType: 'conversation',
  messageTimestamp: TS,
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  source: 'android',
})

export const extendedText12Digits = base({
  key: { remoteJid: '554791351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60002' },
  pushName: 'Maria Silva',
  message: { extendedTextMessage: { text: 'Vi o site de voces', previewType: 0, contextInfo: { entryPointConversionSource: 'global_search_new_chat' } } },
  messageType: 'extendedTextMessage',
  messageTimestamp: TS,
  source: 'ios',
})

export const audioPtt = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60003' },
  pushName: 'Maria Silva',
  message: {
    audioMessage: {
      url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc',
      mimetype: 'audio/ogg; codecs=opus', fileLength: '12345', seconds: 7, ptt: true,
      mediaKey: 'bWVkaWFrZXk=', fileSha256: 'c2hh', fileEncSha256: 'ZW5j', directPath: '/v/t62.7117-24/audio-0003.enc',
    },
  },
  messageType: 'audioMessage',
  messageTimestamp: TS,
})

export const imageWithCaption = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60004' },
  pushName: 'Maria Silva',
  message: {
    imageMessage: {
      url: 'https://mmg.whatsapp.net/o1/v/t62.7118-24/image-0004.enc',
      mimetype: 'image/jpeg', caption: 'Esse modelo', width: 1080, height: 1350, fileLength: '98765',
    },
  },
  messageType: 'imageMessage',
  messageTimestamp: TS,
})

export const documentPdf = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60005' },
  pushName: 'Maria Silva',
  message: {
    documentMessage: {
      url: 'https://mmg.whatsapp.net/v/t62.7119-24/doc-0005.enc',
      mimetype: 'application/pdf', title: 'orcamento', fileName: 'orcamento.pdf', pageCount: 2, fileLength: '45678',
    },
  },
  messageType: 'documentMessage',
  messageTimestamp: TS,
})

export const reaction = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60006' },
  pushName: 'Maria Silva',
  message: {
    reactionMessage: {
      key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0001' },
      text: '\u{1F44D}', senderTimestampMs: '1757934000123',
    },
  },
  messageType: 'reactionMessage',
  messageTimestamp: TS,
})

export const revoke = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60007' },
  pushName: 'Maria Silva',
  message: { protocolMessage: { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60001' }, type: 'REVOKE' } },
  messageType: 'protocolMessage',
  messageTimestamp: TS,
})

export const ctwaAd = base({
  key: { remoteJid: '5547977776666@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60008' },
  pushName: 'Carla Anuncio',
  message: { extendedTextMessage: { text: 'P9 Ola, vi o anuncio e quero agendar' } },
  contextInfo: {
    externalAdReply: {
      title: 'Pilates experimental', body: 'Agende sua aula', mediaType: 1,
      thumbnailUrl: 'https://scontent.xx.fbcdn.net/thumb.jpg', sourceType: 'ad', sourceId: '120210000000000000',
      sourceUrl: 'https://fb.me/abc123', containsAutoReply: false, renderLargerThumbnail: true,
      showAdAttribution: true, ctwaClid: 'Afc123XYZ',
    },
  },
  messageType: 'extendedTextMessage',
  messageTimestamp: TS,
})

export const lidWithPushName = base({
  key: { remoteJid: '123456789012345@lid', fromMe: false, id: '3EB0A1B2C3D4E5F60009' },
  pushName: 'Joao Lid',
  message: { conversation: 'Bom dia' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const lidWithoutPushName = base({
  key: { remoteJid: '123456789012345@lid', fromMe: false, id: '3EB0A1B2C3D4E5F60010' },
  pushName: '',
  message: { conversation: 'Bom dia' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const lidWithSenderPn = base({
  key: { remoteJid: '987654321098765@lid', senderPn: '5547988887777@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60011' },
  pushName: 'Pedro Pn',
  message: { conversation: 'Tudo bem?' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const groupMessage = base({
  key: { remoteJid: '120363025246125486@g.us', participant: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60012' },
  pushName: 'Maria Silva',
  message: { conversation: 'Mensagem no grupo' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const statusBroadcast = base({
  key: { remoteJid: 'status@broadcast', participant: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60013' },
  pushName: 'Maria Silva',
  message: { imageMessage: { url: 'https://mmg.whatsapp.net/status.enc', mimetype: 'image/jpeg' } },
  messageType: 'imageMessage',
  messageTimestamp: TS,
})

export const outboundFromMe = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0002' },
  pushName: 'Atendente Loja',
  message: { conversation: 'Segue a proposta' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const statusUpdateRead = base({
  keyId: 'BAE5OUTBOUND0001',
  remoteJid: '5547991351835@s.whatsapp.net',
  fromMe: true,
  participant: '5547991351835@s.whatsapp.net',
  status: 'READ',
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  messageId: 'cmf0000000000000000000001',
}, 'messages.update')

export const statusUpdateArrayNumeric = base([
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0001' }, update: { status: 2 } },
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0003' }, update: { status: 1 } },
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0004' }, update: { status: 0 } },
], 'MESSAGES_UPDATE')

// Registro devolvido por POST /chat/findMessages (polling): mesmo formato do data do upsert.
export const polledRecordText = {
  id: 'cmf0000000000000000000099',
  key: { id: '3EB0POLL00000001', fromMe: false, remoteJid: '5547966665555@s.whatsapp.net' },
  pushName: 'Lia Polling',
  messageType: 'conversation',
  message: { conversation: 'Mensagem perdida' },
  messageTimestamp: TS,
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  source: 'android',
}

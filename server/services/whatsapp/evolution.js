// Adaptador Evolution API (Baileys). Codigo movido de webhooks.js, leadHandoff.js, messages.js,
// deepgramClient.js, leads.js e scheduler.js SEM mudar as requisicoes nem a interpretacao.
import nodeFetch from 'node-fetch'
import { normalizePhone } from './normalize.js'

export const EVOLUTION_CAPABILITIES = Object.freeze({
  qr: true, presence: true, readReceipts: true, numberCheck: true, templates: false, window24h: false, polling: true,
})

export const EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE']

// Evolution v2+ coloca contextInfo.externalAdReply no nivel root (data.contextInfo);
// versoes antigas colocavam dentro de message.<tipo>.contextInfo. Cobre os 2 formatos.
function getCtwaInfo(message, dataRoot) {
  const ctxs = [
    dataRoot?.contextInfo,
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.audioMessage?.contextInfo,
    message.documentMessage?.contextInfo,
    message.stickerMessage?.contextInfo,
    message.contextInfo,
  ].filter(Boolean)
  for (const ctx of ctxs) {
    const ad = ctx.externalAdReply
    if (ad) return ad
  }
  return null
}

// Um registro Baileys (data do messages.upsert ou item do findMessages) -> 0 ou 1 NormalizedMessage.
// Copia de webhooks.js:229-416.
export function parseEvolutionRecord(data, opts = {}) {
  const log = opts.log === undefined ? console.log : opts.log
  if (!data || typeof data !== 'object') return []

  const remoteJid = data.key?.remoteJid || ''
  const senderPn = data.key?.senderPn || data.senderPn || ''
  const fromMe = data.key?.fromMe || false
  const msgId = data.key?.id || ''
  const pushName = data.pushName || ''
  const timestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString()

  const msg = data.message || {}
  let content = ''
  let mediaType = 'text'
  let mediaUrl = null
  let mediaCaption = ''
  if (msg.conversation) {
    content = msg.conversation
  } else if (msg.extendedTextMessage?.text) {
    content = msg.extendedTextMessage.text
  } else if (msg.imageMessage) {
    mediaType = 'image'; mediaUrl = msg.imageMessage.url || null; mediaCaption = msg.imageMessage.caption || ''; content = mediaCaption || '[Imagem]'
  } else if (msg.videoMessage) {
    mediaType = 'video'; mediaUrl = msg.videoMessage.url || null; mediaCaption = msg.videoMessage.caption || ''; content = mediaCaption || '[Video]'
  } else if (msg.audioMessage) {
    mediaType = 'audio'; mediaUrl = msg.audioMessage.url || null; content = '[Audio]'
  } else if (msg.documentMessage) {
    mediaType = 'document'; mediaUrl = msg.documentMessage.url || null; content = msg.documentMessage.fileName || '[Documento]'
  } else if (msg.stickerMessage) {
    mediaType = 'sticker'; mediaUrl = msg.stickerMessage.url || null; content = '[Sticker]'
  } else if (msg.reactionMessage) {
    // Lead reagiu a uma mensagem com emoji
    const emoji = msg.reactionMessage.text || '❤️'
    content = `${emoji} (reacao)`
    mediaType = 'reaction'
  } else if (msg.locationMessage || msg.liveLocationMessage) {
    // Localizacao compartilhada
    const loc = msg.locationMessage || msg.liveLocationMessage
    const lat = loc.degreesLatitude
    const lng = loc.degreesLongitude
    const name = loc.name || ''
    content = name ? `\u{1F4CD} ${name}` : (lat && lng ? `\u{1F4CD} Localizacao: ${lat}, ${lng}` : '\u{1F4CD} Localizacao compartilhada')
    mediaType = 'location'
  } else if (msg.contactMessage || msg.contactsArrayMessage) {
    // Contato(s) compartilhado(s): nome + telefones do vCard (prefere waid=)
    const contactsRaw = msg.contactsArrayMessage?.contacts?.length
      ? msg.contactsArrayMessage.contacts
      : (msg.contactMessage ? [msg.contactMessage] : [])
    const parsed = contactsRaw.map(c => {
      const name = c?.displayName || ''
      const vcard = c?.vcard || ''
      const phones = []
      vcard.split(/\r?\n/).forEach(line => {
        if (!/^TEL/i.test(line)) return
        const waidMatch = line.match(/waid=(\d+)/i)
        if (waidMatch) { phones.push(waidMatch[1]); return }
        const afterColon = line.split(':').slice(1).join(':').trim()
        const digits = afterColon.replace(/\D/g, '')
        if (digits) phones.push(digits)
      })
      return { name, phones: [...new Set(phones)] }
    }).filter(p => p.name || p.phones.length > 0)

    mediaType = 'contact'
    if (parsed.length === 0) {
      content = '\u{1F464} Contato compartilhado'
    } else if (parsed.length === 1) {
      const c = parsed[0]
      const phoneStr = c.phones[0] || ''
      content = phoneStr
        ? `\u{1F464} ${c.name || 'Contato'} — ${phoneStr}`
        : `\u{1F464} Contato: ${c.name}`
      mediaUrl = phoneStr || null
    } else {
      const parts = parsed.map(c => c.phones[0] ? `${c.name || 'Contato'} (${c.phones[0]})` : (c.name || 'Contato'))
      content = `\u{1F464} ${parsed.length} contatos: ${parts.join(' | ')}`
      mediaUrl = parsed.find(p => p.phones[0])?.phones[0] || null
    }
  } else if (msg.protocolMessage?.type === 0 || msg.protocolMessage?.type === 'REVOKE') {
    content = '\u{1F6AB} Mensagem apagada'
    mediaType = 'system'
  } else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) {
    const poll = msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3
    content = poll?.name ? `\u{1F4CA} Enquete: ${poll.name}` : '\u{1F4CA} Enquete'
    mediaType = 'poll'
  } else if (msg.pollUpdateMessage) {
    content = '\u{1F4CA} Voto em enquete'
    mediaType = 'poll'
  } else if (msg.editedMessage || msg.protocolMessage?.editedMessage) {
    const edited = msg.editedMessage || msg.protocolMessage?.editedMessage
    const newText = edited?.message?.conversation || edited?.message?.extendedTextMessage?.text || ''
    content = newText ? `✏️ ${newText}` : '✏️ Mensagem editada'
  } else if (msg.buttonsResponseMessage) {
    content = msg.buttonsResponseMessage.selectedDisplayText || msg.buttonsResponseMessage.selectedButtonId || '[Botao clicado]'
  } else if (msg.listResponseMessage) {
    content = msg.listResponseMessage.title || msg.listResponseMessage.singleSelectReply?.selectedRowId || '[Opcao selecionada]'
  } else if (msg.templateButtonReplyMessage) {
    content = msg.templateButtonReplyMessage.selectedDisplayText || '[Botao de template]'
  } else if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) {
    content = '\u{1F441}️ Mensagem de visualizacao unica'
    mediaType = 'view_once'
  } else if (msg.ephemeralMessage) {
    const inner = msg.ephemeralMessage.message || {}
    if (inner.conversation) content = inner.conversation
    else if (inner.extendedTextMessage?.text) content = inner.extendedTextMessage.text
    else content = '⏱️ Mensagem temporaria'
  }
  if (!content && Object.keys(msg).length > 0) {
    const tipo = Object.keys(msg).filter(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage')[0] || 'desconhecido'
    if (log) log(`[Webhook] Tipo de mensagem nao tratado: ${tipo}`, JSON.stringify(msg).substring(0, 200))
    content = `[${tipo}]`
    mediaType = 'unknown'
  }

  const adInfo = getCtwaInfo(msg, data)

  // DEBUG TEMPORARIO herdado de webhooks.js:387-391 (agora identifica a instancia em vez do slug)
  if (log && !fromMe && (adInfo || (content && content.startsWith('P9')))) {
    log(`[CTWA DEBUG] instance=${opts.instanceName || '?'} content="${(content || '').substring(0, 60)}" adInfo=${JSON.stringify(adInfo)} dataContextInfo=${JSON.stringify(data.contextInfo || null)} msgKeys=${Object.keys(msg).slice(0, 8).join(',')}`)
  }

  // Ignora grupos, status e listas de transmissao
  if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('status@')) {
    return []
  }

  // Prefere senderPn (telefone real) ao remoteJid (pode ser @lid)
  const realJid = senderPn || remoteJid
  let phone = ''
  let dedupJid = ''
  if (senderPn) {
    phone = normalizePhone(senderPn.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
    dedupJid = `${phone}@s.whatsapp.net`
  } else if (realJid.endsWith('@lid')) {
    if (!pushName) return []
    phone = realJid.replace('@lid', '')
    dedupJid = realJid
  } else {
    phone = normalizePhone(realJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
    dedupJid = `${phone}@s.whatsapp.net`
  }
  if (!phone) return []

  const normalized = {
    phone,
    remoteId: dedupJid,
    fromMe: !!fromMe,
    messageId: msgId,
    pushName,
    timestamp,
    type: mediaType,
    text: content,
    mediaRef: mediaUrl,
  }
  if (adInfo) normalized.adReferral = adInfo
  return [normalized]
}

// messages.update: 1=SERVER_ACK(sent), 2=DELIVERY_ACK(delivered), 3=READ, 4=PLAYED. Copia de webhooks.js:199-210.
export function parseEvolutionStatuses(data) {
  const rawUpdates = data ? (Array.isArray(data) ? data : [data]) : []
  const out = []
  for (const upd of rawUpdates) {
    const waMsgId = upd?.key?.id || upd?.keyId
    if (!waMsgId) continue
    const statusRaw = upd.status ?? upd.update?.status
    let status = null
    if (statusRaw === 'DELIVERY_ACK' || statusRaw === 2) status = 'delivered'
    else if (statusRaw === 'READ' || statusRaw === 'PLAYED' || statusRaw === 3 || statusRaw === 4) status = 'read'
    else if (statusRaw === 'SERVER_ACK' || statusRaw === 1) status = 'sent'
    if (!status) continue
    out.push({ messageId: waMsgId, status, timestamp: new Date().toISOString() })
  }
  return out
}

export function createEvolutionAdapter({ fetch }) {
  return {
    name: 'evolution',
    capabilities: EVOLUTION_CAPABILITIES,

    parseWebhook(instance, body) {
      const event = body?.event
      const data = body?.data
      if (event === 'messages.update' || event === 'MESSAGES_UPDATE') {
        return { messages: [], statuses: parseEvolutionStatuses(data) }
      }
      if (event !== 'messages.upsert' || !data) return { messages: [], statuses: [] }
      return { messages: parseEvolutionRecord(data, { instanceName: instance?.instance_name }), statuses: [] }
    },

    parsePolledRecord(instance, record) {
      return parseEvolutionRecord(record, { log: null })
    },
  }
}

export const evolutionAdapter = createEvolutionAdapter({ fetch: nodeFetch })

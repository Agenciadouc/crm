// Leitura de avisos no formato da Cloud API da Meta (object/entry/changes/value).
// Puro (sem rede, sem banco): serve a UzAPI agora e a API Oficial (fase 3 do spec de provedores) depois.
import { normalizePhone } from './normalize.js'

const STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', played: 'read', failed: 'failed', deleted: 'deleted' }
// "desconnected" e a grafia da UzAPI
const CONNECTION_MAP = { connected: 'connected', desconnected: 'disconnected', disconnected: 'disconnected' }
const QR_KEYS = ['qrcode', 'qrCode', 'qr_code', 'qr', 'base64', 'code']

function toIso(ts) {
  const n = parseInt(ts, 10)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString()
}

function isGroupMessage(m) {
  const from = String(m.from || '')
  return m.isGroup === true || !!m.group_id || from.includes('@g.us') || from.includes('broadcast')
}

// Procura um QR (texto do WhatsApp ou imagem base64) por nome de campo, ate 4 niveis.
export function extractQr(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null
  for (const k of QR_KEYS) {
    const v = obj[k]
    if (typeof v === 'string' && v.length >= 20) return v
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = extractQr(v, depth + 1)
      if (found) return found
    }
  }
  return null
}

function contactText(m) {
  const list = Array.isArray(m.contacts) ? m.contacts : []
  const parsed = list.map(c => ({
    name: c?.name?.formatted_name || c?.name?.first_name || '',
    phone: String(c?.phones?.[0]?.wa_id || c?.phones?.[0]?.phone || '').replace(/[^\d]/g, ''),
  })).filter(c => c.name || c.phone)
  if (parsed.length === 0) return { text: '\u{1F464} Contato compartilhado', mediaRef: null }
  if (parsed.length === 1) {
    const c = parsed[0]
    return { text: c.phone ? `\u{1F464} ${c.name || 'Contato'} — ${c.phone}` : `\u{1F464} Contato: ${c.name}`, mediaRef: c.phone || null }
  }
  const parts = parsed.map(c => c.phone ? `${c.name || 'Contato'} (${c.phone})` : (c.name || 'Contato'))
  return { text: `\u{1F464} ${parsed.length} contatos: ${parts.join(' | ')}`, mediaRef: parsed.find(c => c.phone)?.phone || null }
}

// value.messages[i] -> NormalizedMessage (mesmos textos de placeholder da Evolution) ou null (grupo/sem remetente).
export function parseMetaMessage(m, contacts = []) {
  if (!m || typeof m !== 'object' || isGroupMessage(m)) return null
  const digits = String(m.from || '').replace(/[^\d]/g, '')
  if (!digits || !m.id) return null
  const phone = normalizePhone(digits)
  const contact = (contacts || []).find(c => String(c?.wa_id || '') === String(m.from)) || null
  const base = {
    phone,
    remoteId: `${phone}@s.whatsapp.net`,
    fromMe: false,
    messageId: String(m.id),
    pushName: contact?.profile?.name || '',
    timestamp: toIso(m.timestamp),
    mediaRef: null,
  }
  switch (m.type) {
    case 'text': return { ...base, type: 'text', text: m.text?.body || '' }
    case 'image': return { ...base, type: 'image', text: m.image?.caption || '[Imagem]', mediaRef: m.image?.id || null }
    case 'video': return { ...base, type: 'video', text: m.video?.caption || '[Video]', mediaRef: m.video?.id || null }
    case 'audio': return { ...base, type: 'audio', text: '[Audio]', mediaRef: m.audio?.id || null }
    case 'document': return {
      ...base, type: 'document', text: m.document?.caption || m.document?.filename || '[Documento]',
      mediaRef: m.document?.id || null, fileName: m.document?.filename || null,
    }
    case 'sticker': return { ...base, type: 'sticker', text: '[Sticker]', mediaRef: m.sticker?.id || null }
    case 'location': {
      const l = m.location || {}
      const text = l.name
        ? `\u{1F4CD} ${l.name}`
        : (l.latitude && l.longitude ? `\u{1F4CD} Localizacao: ${l.latitude}, ${l.longitude}` : '\u{1F4CD} Localizacao compartilhada')
      return { ...base, type: 'location', text }
    }
    case 'contacts': return { ...base, type: 'contact', ...contactText(m) }
    case 'reaction': return { ...base, type: 'reaction', text: `${m.reaction?.emoji || '❤️'} (reacao)` }
    case 'button': return { ...base, type: 'text', text: m.button?.text || '[Botao clicado]' }
    case 'interactive':
    case 'button_reply':
    case 'list_reply': {
      const r = m.interactive?.button_reply || m.interactive?.list_reply
      return { ...base, type: 'text', text: r?.title || '[Opcao selecionada]' }
    }
    default: return { ...base, type: 'unknown', text: `[${m.type || 'desconhecido'}]` }
  }
}

// outboundOnly: o handleStatusUpdate so aplica em mensagem ENVIADA pelo CRM
// (a UzAPI manda tambem a leitura que o proprio numero faz das recebidas).
export function parseMetaStatus(s) {
  const status = STATUS_MAP[s?.status]
  if (!s?.id || !status) return null
  return { messageId: String(s.id), status, timestamp: toIso(s.timestamp), recipientId: String(s.recipient_id || ''), outboundOnly: true }
}

export function parseMetaWebhook(body, opts = {}) {
  const log = opts.log === undefined ? console.warn : opts.log
  const out = { messages: [], statuses: [], echoes: [], connection: null, qr: null, ignored: 0 }
  if (!body || typeof body !== 'object' || !Array.isArray(body.entry)) return out
  for (const entry of body.entry) {
    for (const change of (entry?.changes || [])) {
      const value = change?.value || {}
      const pnid = String(value.metadata?.phone_number_id || '')
      if (opts.phoneNumberId && pnid !== String(opts.phoneNumberId)) {
        out.ignored++
        if (log) log(`[metaFormat] phone_number_id "${pnid}" nao e o do numero — aviso descartado`)
        continue
      }
      if (change?.field === 'connection') {
        const raw = Array.isArray(value.status) ? value.status[0]?.connection : value.status?.connection
        if (CONNECTION_MAP[raw]) out.connection = CONNECTION_MAP[raw]
        const qr = extractQr(value)
        if (qr) out.qr = qr
        continue
      }
      if (change?.field === 'authentication') {
        const qr = extractQr(value)
        if (qr) out.qr = qr
        continue
      }
      if (change?.field !== 'messages') continue
      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      for (const m of (Array.isArray(value.messages) ? value.messages : [])) {
        const n = parseMetaMessage(m, contacts)
        if (n) out.messages.push(n)
      }
      const ownNumber = String(value.metadata?.display_phone_number || '')
      for (const s of (Array.isArray(value.statuses) ? value.statuses : [])) {
        const n = parseMetaStatus(s)
        if (!n) continue
        out.statuses.push(n)
        // recipient_id vazio = mensagem que SAIU do numero (pela API ou pelo celular). O eco filtra as que o CRM ja tem.
        if (n.recipientId !== '') continue
        const waId = String(contacts[0]?.wa_id || '').replace(/[^\d]/g, '')
        if (waId && waId !== ownNumber) out.echoes.push({ messageId: n.messageId, phone: normalizePhone(waId), timestamp: n.timestamp })
      }
    }
  }
  return out
}

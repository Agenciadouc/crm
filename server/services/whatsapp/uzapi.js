// Adaptador UzAPI. A UzAPI imita a Cloud API da Meta (envio /{pnid}/messages, avisos entry/changes/value),
// mas por baixo e WhatsApp Web. A leitura dos avisos fica em metaFormat.js (reaproveitavel pela API Oficial).
// Envio nunca lanca: devolve { ok:false, reason } como o adaptador da Evolution.
import nodeFetch, { FormData as NodeFormData, Blob as NodeBlob } from 'node-fetch'
import { createUzapiClient, phonePath, reasonFromResponse } from './uzapiClient.js'
import { tryReadUzapiConfig, readUzapiPhoneNumberId } from './providerConfig.js'
import { parseMetaWebhook } from './metaFormat.js'

export const UZAPI_CAPABILITIES = Object.freeze({
  qr: true, presence: false, readReceipts: false, numberCheck: false, templates: false, window24h: false, polling: false, typingDelay: true,
})

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker']
const PLACEHOLDER = { image: '[Imagem]', video: '[Video]', audio: '[Audio]', document: '[Documento]', sticker: '[Sticker]' }

// Resposta de POST /{pnid}/chats { action:'get' } (formato whatsmeow) -> NormalizedMessage fromMe.
// O Chat vem como @lid, por isso o telefone vem de fora (contacts[0].wa_id do aviso de status).
export function parseChatMessage(data, { phone, messageId }) {
  const d = data?.data?.data || data?.data || data || {}
  const info = d.Info || d.info || {}
  const msg = d.Message || d.message || {}
  if (info.IsFromMe === false) return null
  const pick = (k) => msg[k] || msg[k.charAt(0).toLowerCase() + k.slice(1)]
  let type = 'text'
  let text = pick('Conversation') || pick('ExtendedTextMessage')?.text || ''
  if (!text) {
    const found = [['ImageMessage', 'image'], ['VideoMessage', 'video'], ['AudioMessage', 'audio'], ['DocumentMessage', 'document'], ['StickerMessage', 'sticker']]
      .find(([k]) => pick(k))
    if (!found) return null
    type = found[1]
    const inner = pick(found[0])
    text = inner.caption || inner.fileName || PLACEHOLDER[type]
  }
  const ts = info.Timestamp ? new Date(info.Timestamp) : null
  return {
    phone,
    remoteId: `${phone}@s.whatsapp.net`,
    fromMe: true,
    messageId: String(info.ID || info.Id || messageId),
    pushName: '',
    timestamp: ts && !isNaN(ts.getTime()) ? ts.toISOString() : new Date().toISOString(),
    type,
    text,
    mediaRef: null,
  }
}

export function createUzapiAdapter({ fetch, env = process.env, FormData = NodeFormData, Blob = NodeBlob, getMediaTemp = () => null, log = console }) {
  const client = createUzapiClient({ fetch, env })
  const config = (instance) => tryReadUzapiConfig(instance, env)

  async function postMessage(instance, payload) {
    const { cfg, error } = config(instance)
    if (error) return { ok: false, messageId: null, reason: error }
    const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'messages'), { token: cfg.instanceToken, json: payload })
    if (r.ok && r.data?.messageId) return { ok: true, messageId: String(r.data.messageId), raw: r.data }
    const reason = r.ok ? 'provider_no_message_id' : reasonFromResponse(r)
    if (reason === 'provider_auth') log.error(`[UzAPI] envio recusado com 401/403 (instancia ${instance.id}) — token do numero revogado?`)
    return r.data == null ? { ok: false, messageId: null, reason } : { ok: false, messageId: null, reason, raw: r.data }
  }

  async function uploadMedia(instance, buffer, mimetype, fileName) {
    const { cfg, error } = config(instance)
    if (error) return { id: null, reason: error }
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('file', new Blob([buffer], { type: mimetype || 'application/octet-stream' }), fileName || 'arquivo')
    const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'media'), { token: cfg.instanceToken, form, timeout: 60000 })
    const id = r.ok ? (r.data?.id || r.data?.media_id || r.data?.mediaId || null) : null
    return id ? { id: String(id) } : { id: null, reason: r.ok ? 'provider_no_media_id' : reasonFromResponse(r) }
  }

  return {
    name: 'uzapi',
    capabilities: UZAPI_CAPABILITIES,

    async sendText(instance, phone, text, opts = {}) {
      const payload = { to: phone, type: 'text', text: { body: text } }
      if (opts && opts.delayTyping) payload.delayTyping = opts.delayTyping
      return postMessage(instance, payload)
    },

    // base64 -> sobe em /media e envia por id; se a subida falhar, envia por link temporario do CRM (spec 4.5).
    async sendMedia(instance, phone, media = {}) {
      const { type, base64, url, mimetype, fileName, caption } = media
      const waType = MEDIA_TYPES.includes(type) ? type : 'document'
      const extra = {}
      if (caption && waType !== 'audio' && waType !== 'sticker') extra.caption = caption
      if (waType === 'document' && fileName) extra.filename = fileName
      if (url && !base64) return postMessage(instance, { to: phone, type: waType, [waType]: { link: url, ...extra } })
      if (!base64) return { ok: false, messageId: null, reason: 'media_empty' }
      const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64')
      const up = await uploadMedia(instance, buffer, mimetype, fileName)
      if (up.id) return postMessage(instance, { to: phone, type: waType, [waType]: { id: up.id, ...extra } })
      const mediaTemp = getMediaTemp()
      if (!mediaTemp) return { ok: false, messageId: null, reason: up.reason || 'media_upload_failed' }
      log.warn(`[UzAPI] subida de midia falhou (${up.reason}); enviando por link temporario`)
      const link = mediaTemp.put(buffer, mimetype || 'application/octet-stream')
      return postMessage(instance, { to: phone, type: waType, [waType]: { link, ...extra } })
    },

    // message.media_url guarda o id da midia gravado na chegada (mediaRef).
    async fetchMedia(instance, message) {
      const notFound = (why) => { const e = new Error(`uzapi_media_not_found (${why})`); e.code = 'media_not_found'; return e }
      const mediaId = message?.media_url
      if (!mediaId) throw notFound('sem id da midia')
      const { cfg, error } = config(instance)
      if (error) throw notFound(error)
      const meta = await client.request('GET', encodeURIComponent(mediaId), { token: cfg.instanceToken })
      if (!meta.ok || !meta.data?.url) throw notFound(`status=${meta.status}`)
      const file = await client.download(meta.data.url)
      if (!file.ok) throw notFound(`download status=${file.status}`)
      return { buffer: file.buffer, mimetype: meta.data.mime_type || file.contentType || null }
    },

    // headers: a UzAPI nao assina; a protecao e o token na URL + a conferencia do phone_number_id.
    parseWebhook(instance, body, headers) {
      const phoneNumberId = readUzapiPhoneNumberId(instance)
      if (!phoneNumberId) {
        log.warn(`[UzAPI] instancia ${instance?.id} sem phone_number_id — aviso descartado`)
        return { messages: [], statuses: [], echoes: [], connection: null, qr: null, ignored: 0 }
      }
      return parseMetaWebhook(body, { phoneNumberId, log: (m) => log.warn(m) })
    },

    // Resposta dada pelo celular: a UzAPI so manda o status; o conteudo vem daqui.
    async fetchMessageById(instance, messageId, { phone } = {}) {
      const { cfg, error } = config(instance)
      if (error || !messageId || !phone) return null
      const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'chats'), {
        token: cfg.instanceToken,
        json: { type: 'chats', action: 'get', chats: { message_id: messageId } },
      })
      if (!r.ok) {
        log.warn(`[UzAPI] busca da mensagem ${messageId} falhou: ${reasonFromResponse(r)}`)
        return null
      }
      return parseChatMessage(r.data, { phone, messageId })
    },
  }
}

let mediaTempRef = null
// Chamado no boot (server/index.js): liga a reserva de envio de midia por link temporario.
export function configureUzapiMediaTemp(mediaTemp) {
  mediaTempRef = mediaTemp
}

export const uzapiAdapter = createUzapiAdapter({ fetch: nodeFetch, getMediaTemp: () => mediaTempRef })

// Adapter uzapi.com.br - MESMAS assinaturas do evolutionAdapter.
// Docs: https://api.uzapi.com.br/docs
//
// Auth: Bearer token por instancia. Token vem gravado em instance.api_key
// (setado ao criar/switch pra uzapi). Se o token vencer, a UI da uzapi
// gera um novo - dev precisa reeditar.
//
// Endpoints principais:
//   POST /{version}/{phone_number_id}/messages       -> envio (texto/midia/audio/etc)
//   POST /{version}/{phone_number_id}/contacts       -> gerenciar contatos
//   POST /{version}/{phone_number_id}/chats          -> gerenciar chats
//   GET  /{version}/{phone_number_id}/instance       -> info da inst
//   PUT  /{version}/{phone_number_id}/instance/update -> update (webhook, config)
//   POST /{version}/{phone_number_id}/instance/logout -> logout
//   DELETE /{version}/{phone_number_id}/instance/delete -> delete
//   POST /{version}/{phone_number_id}/instance/restart -> restart
//   POST /{version}/{phone_number_id}/instance/resume  -> reativar pausada
//   POST /{version}/instance/add                     -> criar nova inst
//   GET  /{version}/{mediaId}                        -> retrieve media URL
//   POST /{version}/{phone_number_id}/media          -> upload media
import fetch from 'node-fetch'

const API_BASE = process.env.UZAPI_API_BASE || 'https://api.uzapi.com.br'
const API_VERSION = process.env.UZAPI_VERSION || 'v1'

// ─── Helpers ─────────────────────────────────────────────────────────

// Base URL da inst (usa phone_number_id como identificador)
function instBase(instance) {
  const phoneNumberId = instance.uzapi_session || instance.phone_number_id || instance.instance_name
  return `${API_BASE}/${API_VERSION}/${phoneNumberId}`
}

function authHeader(instance) {
  const token = instance.api_key || process.env.UZAPI_ADMIN_TOKEN || ''
  return { Authorization: `Bearer ${token}` }
}

function jsonHeaders(instance) {
  return { 'Content-Type': 'application/json', ...authHeader(instance) }
}

async function _fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, opts)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, error: e.message, data: {} }
  }
}

// ─── Envio ───────────────────────────────────────────────────────────

export async function sendText(instance, { number, text }) {
  const body = {
    to: String(number).replace(/[^\d]/g, ''),
    delayMessage: 0,
    type: 'text',
    text: { preview_url: false, body: text },
  }
  const r = await _fetchJson(`${instBase(instance)}/messages`, {
    method: 'POST', headers: jsonHeaders(instance), body: JSON.stringify(body),
  })
  if (r.ok && r.data?.messageId) {
    return { ok: true, wamsgId: r.data.messageId, raw: r.data }
  }
  const reason = r.data?.message || r.error || `http_${r.status}`
  return { ok: false, reason: String(reason).substring(0, 200), raw: r.data || {} }
}

// mediatype: 'image' | 'video' | 'document'
// media pode ser: base64 puro (sem prefixo) OU URL http/https OU media_id retornado pelo /media
export async function sendMedia(instance, { number, mediatype, media, mimetype, fileName, caption, delay }) {
  const to = String(number).replace(/[^\d]/g, '')
  const body = { to, delayMessage: delay || 0, type: mediatype }
  const mediaObj = { caption: caption || '' }

  // Detecta se e URL/base64/id: base64 detectado por tamanho grande e sem prefixo http
  if (typeof media === 'string' && (media.startsWith('http://') || media.startsWith('https://'))) {
    mediaObj.link = media
  } else if (typeof media === 'string' && media.length < 100 && /^[a-zA-Z0-9]+$/.test(media)) {
    mediaObj.id = media  // media_id da uzapi
  } else {
    // Base64 - remove prefixo data: se veio
    const base64 = String(media).replace(/^data:[^;]+;base64,/, '')
    mediaObj.base64 = base64
    if (mimetype) mediaObj.mime_type = mimetype
    if (fileName) mediaObj.filename = fileName
  }

  if (mediatype === 'document' && fileName) mediaObj.filename = fileName
  body[mediatype] = mediaObj

  const r = await _fetchJson(`${instBase(instance)}/messages`, {
    method: 'POST', headers: jsonHeaders(instance), body: JSON.stringify(body),
  })
  if (r.ok && r.data?.messageId) return { ok: true, wamsgId: r.data.messageId, raw: r.data }
  const reason = r.data?.message || r.error || `http_${r.status}`
  return { ok: false, reason: String(reason).substring(0, 200), raw: r.data || {} }
}

export async function sendAudio(instance, { number, audio, delay }) {
  // audio: base64 puro (formato ogg/opus preferencial pra WhatsApp voz)
  return sendMedia(instance, { number, mediatype: 'audio', media: audio, mimetype: 'audio/ogg', delay })
}

// Presence (typing indicator) - uzapi tem delayTyping no proprio /messages
// Aqui exportamos como no-op silencioso pra compat. A "digitando" e configurada por msg.
export async function sendPresence(instance, { number, presence, delay = 100, signal }) {
  // no-op - uzapi nao tem endpoint separado de presence.
  // O typing e configurado via delayTyping no envio da propria msg.
  return
}

// markAsRead nao existe na doc uzapi - no-op.
export async function markAsRead(instance, { readMessages, signal }) {
  return
}

// checkNumbers - retorna null (uzapi nao tem endpoint dedicado pra isso)
// leadHandoff aceita null como "nao consegui validar, assume valido".
export async function checkNumbers(instance, numbers, { signal } = {}) {
  return null
}

export async function fetchProfilePicture(instance, number) {
  const body = {
    type: 'contacts',
    action: 'getPicture',
    contacts: { phone: String(number).replace(/[^\d]/g, '') },
  }
  const r = await _fetchJson(`${instBase(instance)}/contacts`, {
    method: 'POST', headers: jsonHeaders(instance), body: JSON.stringify(body),
  })
  if (r.ok && r.data?.pictureUrl) return { url: r.data.pictureUrl }
  if (r.ok && r.data?.url) return { url: r.data.url }
  return null
}

// getMediaBase64: uzapi retorna URL da midia via GET /{version}/{mediaId}
// que retorna { id, url }. Cliente precisa baixar essa URL pra pegar bytes.
export async function getMediaBase64(instance, { message, convertToMp4 = false }) {
  try {
    // Pega o media_id do payload Baileys-shape (que traduzimos do webhook uzapi)
    const mediaId =
      message?.imageMessage?.mediaId ||
      message?.videoMessage?.mediaId ||
      message?.audioMessage?.mediaId ||
      message?.documentMessage?.mediaId ||
      message?.stickerMessage?.mediaId ||
      message?.mediaId
    if (!mediaId) return null
    // GET pra pegar URL
    const r = await _fetchJson(`${API_BASE}/${API_VERSION}/${mediaId}`, {
      headers: authHeader(instance),
    })
    const url = r.data?.url
    if (!url) return null
    // Baixa a URL (autenticada com o mesmo Bearer)
    const mediaRes = await fetch(url, { headers: authHeader(instance) })
    if (!mediaRes.ok) return null
    const arrayBuf = await mediaRes.arrayBuffer()
    const base64 = Buffer.from(arrayBuf).toString('base64')
    const mimetype = mediaRes.headers.get('content-type') || null
    return { base64, mimetype }
  } catch {
    return null
  }
}

export async function findMessages(instance, { where = {}, page = 1, offset = 20 } = {}) {
  const body = {
    type: 'chats',
    action: 'list',
    chats: {
      page,
      pageSize: offset || 20,
      sendForMe: false,
      onlyGroups: false,
    },
  }
  const r = await _fetchJson(`${instBase(instance)}/chats`, {
    method: 'POST', headers: jsonHeaders(instance), body: JSON.stringify(body),
  })
  // Response format e async (colocado na fila). O CRM usa pollMissedMessages
  // - se uzapi entregar via webhook em tempo real, pollMissedMessages e opcional.
  return { records: r.data?.messages || r.data?.records || [] }
}

// ─── Instancia (ciclo de vida) ───────────────────────────────────────

// Cria uma instancia nova. Uzapi endpoint: POST /{v}/instance/add
// Retorna { qrcode, phoneNumberId, token, raw }
// - phoneNumberId: id gerado pela uzapi (guardar em whatsapp_instances.uzapi_session)
// - token: JWT novo da instancia criada (guardar em whatsapp_instances.api_key)
// - qrcode: sempre null aqui — QR vem depois via webhook 'authentication'
export async function createInstance({ baseUrl: url, apiKey, instanceName, integration = 'WHATSAPP-BAILEYS', webhook, phoneNumber }) {
  const token = apiKey || process.env.UZAPI_ADMIN_TOKEN || ''
  const body = {
    name: instanceName,
    appVersion: 'latest',
    authenticationMethod: phoneNumber ? 'PairingCode' : 'QRCode',
    autoRejectCall: false,
    ...(phoneNumber ? { phoneNumber: String(phoneNumber).replace(/[^\d]/g, '') } : {}),
    ...(webhook ? { webhook } : {}),
    webhookEvents: {
      authentication: true,
      connection: true,
      group_messages: true,
      message_status: true,
      group_events: true,
      history: false,
    },
  }
  try {
    const res = await fetch(`${API_BASE}/${API_VERSION}/instance/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    // Response esperada da uzapi (baseado no GET /instance que testamos):
    //   { id, name, phoneNumberId, businessAccountId, token, ... }
    const phoneNumberId = data?.phoneNumberId || data?.phone_number_id || null
    const newToken = data?.token || null
    return {
      qrcode: null,
      phoneNumberId,
      token: newToken,
      raw: data,
      status: res.status,
      ok: res.ok,
    }
  } catch (e) {
    return { qrcode: null, phoneNumberId: null, token: null, raw: {}, error: e.message }
  }
}

// Pra uzapi, "connect" = consultar estado atual. Se estiver esperando QR,
// o QR chega via webhook (nao ha /connect que retorna QR sob demanda).
export async function connectInstance(instance) {
  const r = await _fetchJson(`${instBase(instance)}/instance`, {
    headers: authHeader(instance),
  })
  // QR fica em qrcode se pendente
  const qrcode = r.data?.qrcode?.base64 || r.data?.qrcode || null
  return { qrcode, raw: r.data || {} }
}

// Retorna { state: 'open'|'connecting'|'close', raw }
export async function connectionState(instance) {
  const r = await _fetchJson(`${instBase(instance)}/instance`, {
    headers: authHeader(instance),
  })
  const status = r.data?.status || r.data?.state || 'close'
  let state = 'close'
  if (status === 'connected' || status === 'open') state = 'open'
  else if (status === 'connecting' || status === 'authenticating') state = 'connecting'
  return { state, raw: r.data || {} }
}

export async function logout(instance) {
  try {
    await fetch(`${instBase(instance)}/instance/logout`, {
      method: 'POST', headers: authHeader(instance),
    })
    return { ok: true, raw: {} }
  } catch (e) {
    return { ok: false, raw: {}, error: e.message }
  }
}

export async function deleteInstance(instance, { timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(`${instBase(instance)}/instance/delete`, {
      method: 'DELETE', headers: authHeader(instance),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: res.ok, status: res.status, raw: {} }
  } catch (e) {
    return { ok: false, raw: {}, error: e.name === 'TimeoutError' ? 'timeout' : e.message }
  }
}

export async function restartInstance(instance) {
  try {
    const res = await fetch(`${instBase(instance)}/instance/restart`, {
      method: 'POST', headers: authHeader(instance),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, raw: data }
  } catch (e) {
    return { ok: false, raw: {}, error: e.message }
  }
}

// Registra webhook via PUT /instance/update
export async function setWebhook(instance, webhookUrl, events = ['MESSAGES_UPSERT']) {
  try {
    await fetch(`${instBase(instance)}/instance/update`, {
      method: 'PUT',
      headers: jsonHeaders(instance),
      body: JSON.stringify({
        authenticationMethod: 'QRCode',
        webhook: webhookUrl,
        webhookEvents: {
          authentication: true,
          connection: true,
          group_messages: true,
          message_status: true,
          group_events: true,
          history: false,
        },
      }),
    })
    return { ok: true, raw: {} }
  } catch (e) {
    return { ok: false, raw: {}, error: e.message }
  }
}

export async function fetchInstanceInfo(instance) {
  const r = await _fetchJson(`${instBase(instance)}/instance`, {
    headers: authHeader(instance),
  })
  return r.data || null
}

// ─── Config info (usado pra UI mostrar status da conta agencia) ──────

export function isConfigured() {
  return !!process.env.UZAPI_ADMIN_TOKEN
}

export function getPublicConfig() {
  return {
    apiBase: API_BASE,
    apiVersion: API_VERSION,
    hasAdminToken: !!process.env.UZAPI_ADMIN_TOKEN,
  }
}

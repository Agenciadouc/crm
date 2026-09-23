// Adapter Evolution API - encapsula todas as chamadas HTTP que hoje estao
// espalhadas em leadHandoff.js, messages.js, integrations.js, scheduler.js, etc.
// Assinaturas identicas ao uzapiAdapter pra o dispatcher poder trocar transparente.
// NENHUMA mudanca de comportamento vs codigo atual — so muda o LUGAR de onde a chamada sai.

function baseUrl(instance) {
  return String(instance.api_url || '').replace(/\/+$/, '')
}

function name(instance) {
  return encodeURIComponent(instance.instance_name || '')
}

function authHeader(instance) {
  return { apikey: instance.api_key }
}

function jsonHeaders(instance) {
  return { 'Content-Type': 'application/json', apikey: instance.api_key }
}

// ─── Envio ───────────────────────────────────────────────────────────

export async function sendText(instance, { number, text }) {
  try {
    const res = await fetch(`${baseUrl(instance)}/message/sendText/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ number, text }),
    })
    const data = await res.json().catch(() => ({}))
    if (!data.key?.id) {
      const reason = data?.response?.message?.[0]?.exists === false
        ? 'number_not_on_whatsapp'
        : (data?.error || data?.message || `http_${res.status}`)
      return { ok: false, reason: String(reason).substring(0, 200), raw: data }
    }
    return { ok: true, wamsgId: data.key.id, raw: data }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// mediatype: 'image' | 'video' | 'document'
export async function sendMedia(instance, { number, mediatype, media, mimetype, fileName, caption, delay }) {
  const body = { number, mediatype, media, mimetype, fileName }
  if (caption) body.caption = caption
  if (delay != null) body.delay = delay
  try {
    const res = await fetch(`${baseUrl(instance)}/message/sendMedia/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, reason: data?.error || data?.message || `http_${res.status}`, raw: data }
    if (data.key?.id) return { ok: true, wamsgId: data.key.id, raw: data }
    return { ok: true, wamsgId: null, raw: data }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

export async function sendAudio(instance, { number, audio, delay }) {
  const body = { number, audio }
  if (delay != null) body.delay = delay
  try {
    const res = await fetch(`${baseUrl(instance)}/message/sendWhatsAppAudio/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, reason: data?.error || data?.message || `http_${res.status}`, raw: data }
    if (data.key?.id) return { ok: true, wamsgId: data.key.id, raw: data }
    return { ok: true, wamsgId: null, raw: data }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// presence: 'available' | 'composing' | 'recording' | 'paused'
export async function sendPresence(instance, { number, presence, delay = 100, signal }) {
  try {
    await fetch(`${baseUrl(instance)}/chat/sendPresence/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ number, presence, delay }),
      signal,
    })
  } catch { /* best-effort */ }
}

// readMessages: [{ remoteJid, fromMe, id }]
export async function markAsRead(instance, { readMessages, signal }) {
  try {
    await fetch(`${baseUrl(instance)}/chat/markMessageAsRead/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ read_messages: readMessages }),
      signal,
    })
  } catch { /* best-effort */ }
}

// numbers: array de strings. Retorna array [{ number, exists, jid }] ou null se falhou.
export async function checkNumbers(instance, numbers, { signal } = {}) {
  try {
    const res = await fetch(`${baseUrl(instance)}/chat/whatsappNumbers/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ numbers }),
      signal,
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    return Array.isArray(data) ? data : null
  } catch {
    return null
  }
}

// number: string. Retorna { url } | null
export async function fetchProfilePicture(instance, number) {
  try {
    const res = await fetch(`${baseUrl(instance)}/chat/fetchProfilePictureUrl/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ number }),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (data?.profilePictureUrl) return { url: data.profilePictureUrl }
    return null
  } catch {
    return null
  }
}

// message: objeto Baileys-shape ({ key: {id, remoteJid, fromMe}, ... })
export async function getMediaBase64(instance, { message, convertToMp4 = false }) {
  try {
    const res = await fetch(`${baseUrl(instance)}/chat/getBase64FromMediaMessage/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ message, convertToMp4 }),
    })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    if (data?.base64) return { base64: data.base64, mimetype: data.mimetype || null }
    return null
  } catch {
    return null
  }
}

export async function findMessages(instance, { where = {}, page = 1, offset = 20 } = {}) {
  try {
    const res = await fetch(`${baseUrl(instance)}/chat/findMessages/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ where, page, offset }),
    })
    if (!res.ok) return { records: [] }
    const data = await res.json().catch(() => ({}))
    // Evolution retorna { messages: { records: [] } } ou { records: [] } dependendo da versao
    return { records: data?.messages?.records || data?.records || [] }
  } catch {
    return { records: [] }
  }
}

// ─── Instancia (ciclo de vida) ───────────────────────────────────────

// Cria uma instancia nova. `opts` = { baseUrl, apiKey, instanceName }.
// Retorna { qrcode: base64 | null, raw }.
export async function createInstance({ baseUrl: url, apiKey, instanceName, integration = 'WHATSAPP-BAILEYS' }) {
  try {
    const res = await fetch(`${String(url).replace(/\/+$/, '')}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ instanceName, qrcode: true, integration }),
    })
    const data = await res.json().catch(() => ({}))
    const qrcode = data?.qrcode?.base64 || data?.base64 || null
    return { qrcode, raw: data }
  } catch (e) {
    return { qrcode: null, error: e.message }
  }
}

// Retorna { qrcode: base64 | null, raw }
export async function connectInstance(instance) {
  try {
    const res = await fetch(`${baseUrl(instance)}/instance/connect/${name(instance)}`, {
      headers: authHeader(instance),
    })
    const data = await res.json().catch(() => ({}))
    const qrcode = data?.qrcode?.base64 || data?.base64 || null
    return { qrcode, raw: data }
  } catch (e) {
    return { qrcode: null, error: e.message }
  }
}

// Retorna { state: 'open'|'connecting'|'close', raw }
export async function connectionState(instance) {
  try {
    const res = await fetch(`${baseUrl(instance)}/instance/connectionState/${name(instance)}`, {
      headers: authHeader(instance),
    })
    const data = await res.json().catch(() => ({}))
    const state = data?.instance?.state || data?.state || 'close'
    return { state, raw: data }
  } catch (e) {
    return { state: 'close', error: e.message }
  }
}

// Logout (mantem sessao no servidor, mas desconecta o WhatsApp)
export async function logout(instance) {
  try {
    await fetch(`${baseUrl(instance)}/instance/logout/${name(instance)}`, {
      method: 'DELETE',
      headers: authHeader(instance),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Delete permanente. `timeoutMs`: timeout do fetch (default 8s).
export async function deleteInstance(instance, { timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(`${baseUrl(instance)}/instance/delete/${name(instance)}`, {
      method: 'DELETE',
      headers: authHeader(instance),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: res.ok || res.status === 404, status: res.status }
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message }
  }
}

// Restart Baileys session (mais agressivo que connect — refaz do zero)
export async function restartInstance(instance) {
  try {
    const res = await fetch(`${baseUrl(instance)}/instance/restart/${name(instance)}`, {
      method: 'POST',
      headers: authHeader(instance),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, raw: data }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Configura webhook inbound. Evolution v2.3 shape.
export async function setWebhook(instance, webhookUrl, events = ['MESSAGES_UPSERT']) {
  try {
    await fetch(`${baseUrl(instance)}/webhook/set/${name(instance)}`, {
      method: 'POST',
      headers: jsonHeaders(instance),
      body: JSON.stringify({ webhook: { url: webhookUrl, enabled: true, events } }),
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// Retorna info de uma instancia (usado pra pegar ownerJid/phone_number).
export async function fetchInstanceInfo(instance) {
  try {
    const res = await fetch(`${baseUrl(instance)}/instance/fetchInstances?instanceName=${name(instance)}`, {
      headers: authHeader(instance),
    })
    const data = await res.json().catch(() => null)
    const arr = Array.isArray(data) ? data : (data?.instance ? [data.instance] : [])
    return arr[0] || null
  } catch {
    return null
  }
}

// HTTP da UzAPI: https://api.uzapi.com.br/{usuario}/v1/<caminho>, Authorization: Bearer.
// Le o env na hora da chamada (em ESM os imports rodam antes do dotenv.config do server/index.js).
export const DEFAULT_UZAPI_BASE_URL = 'https://api.uzapi.com.br'
export const DEFAULT_UZAPI_PANEL_URL = 'https://uzapi.com.br'
export const UZAPI_API_VERSION = 'v1'

export function getUzapiEnv(env = process.env) {
  return {
    baseUrl: String(env.UZAPI_BASE_URL || DEFAULT_UZAPI_BASE_URL).trim().replace(/\/+$/, ''),
    username: String(env.UZAPI_USERNAME || '').trim(),
    accountToken: String(env.UZAPI_ACCOUNT_TOKEN || '').trim(),
    panelUrl: String(env.UZAPI_PANEL_URL || DEFAULT_UZAPI_PANEL_URL).trim(),
  }
}

export function isUzapiConfigured(env = process.env) {
  const e = getUzapiEnv(env)
  return !!(e.username && e.accountToken)
}

export function phonePath(phoneNumberId, suffix) {
  return `${encodeURIComponent(phoneNumberId)}/${suffix}`
}

// { ok, status, data } -> reason curto para o chamador (mesma ideia do adaptador da Evolution)
export function reasonFromResponse(r) {
  if (r.status === 401 || r.status === 403) return 'provider_auth'
  if (!r.status || r.status >= 500) return 'provider_error'
  const msg = r.data?.message || r.data?.error
  if (msg) return String(Array.isArray(msg) ? msg.join('; ') : msg).substring(0, 200)
  return `http_${r.status}`
}

export function createUzapiClient({ fetch, env = process.env, timeoutMs = 15000 }) {
  // path relativo a /{usuario}/v1/ (sem barra inicial)
  async function request(method, path, { token, json, form, timeout = timeoutMs } = {}) {
    const e = getUzapiEnv(env)
    const url = `${e.baseUrl}/${encodeURIComponent(e.username)}/${UZAPI_API_VERSION}/${path}`
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let body
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json) } else if (form) body = form
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal })
      const text = await res.text().catch(() => '')
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }
      return { ok: !!res.ok, status: res.status, data }
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err.name === 'AbortError' ? 'timeout' : err.message }
    } finally {
      clearTimeout(timer)
    }
  }

  // A url de midia da UzAPI e publica e ja vem decifrada: baixa SEM token (nunca mandar o Bearer para fora).
  async function download(url, { timeout = 30000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal })
      if (!res.ok) return { ok: false, status: res.status }
      const buffer = Buffer.from(await res.arrayBuffer())
      return { ok: true, status: res.status, buffer, contentType: res.headers?.get?.('content-type') || null }
    } catch (err) {
      return { ok: false, status: 0, error: err.message }
    } finally {
      clearTimeout(timer)
    }
  }

  return { request, download }
}

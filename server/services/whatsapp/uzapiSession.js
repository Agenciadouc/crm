// Sessao do numero na UzAPI: criar, status/QR, webhook, logout, reiniciar, excluir.
// Criar usa o token da CONTA da Dros (.env); o resto usa o token do NUMERO (cifrado no provider_config).
// GET /{pnid}/instance devolve o token do numero: nunca logar a resposta crua.
import { getUzapiEnv, phonePath, reasonFromResponse } from './uzapiClient.js'
import { tryReadUzapiConfig } from './providerConfig.js'
import { extractQr } from './metaFormat.js'

export const UZAPI_WEBHOOK_EVENTS = Object.freeze({
  authentication: true, connection: true, message_status: true, group_messages: false, group_events: false, history: false,
})

const DISCONNECTED_STATES = ['desconnected', 'disconnected', 'logout', 'loggedout', 'stopped', 'deleted', 'failed', 'error']

export function mapDeploymentStatus(d) {
  const s = String(d?.deploymentStatus || '').toLowerCase()
  if (DISCONNECTED_STATES.includes(s)) return 'disconnected'
  if (d?.isAuthenticated === true) return 'connected'
  // Teste real (24/09): "connected" com isAuthenticated false = sessao de pe esperando o QR
  if (d?.isAuthenticated === false) return 'connecting'
  return s === 'connected' ? 'connected' : 'connecting'
}

// Algumas respostas vem embrulhadas em { data: {...} }
function unwrap(data) {
  if (data && typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data)) return { ...data, ...data.data }
  return data && typeof data === 'object' ? data : {}
}

// Formato da resposta de /instance/add ainda nao confirmado (spec 9): aceita os nomes provaveis.
export function extractInstanceCredentials(data) {
  const d = unwrap(data)
  const phoneNumberId = d.phone_number_id ?? d.phoneNumberId ?? d.instanceId ?? d.id ?? null
  const instanceToken = d.token ?? d.accessToken ?? d.access_token ?? d.apiKey ?? d.jwt ?? null
  return {
    phoneNumberId: phoneNumberId == null ? null : String(phoneNumberId),
    instanceToken: instanceToken == null ? null : String(instanceToken),
    uzapiInstanceId: d.name ? String(d.name) : null,
  }
}

function codedError(code, message = code) {
  const e = new Error(message)
  e.code = code
  return e
}

export function createUzapiSession({ client, env = process.env, log = console }) {
  async function status(instance) {
    const { cfg, error } = tryReadUzapiConfig(instance, env)
    if (error) return { ok: false, status: null, phoneNumber: null, qr: null, reason: error }
    const r = await client.request('GET', phonePath(cfg.phoneNumberId, 'instance'), { token: cfg.instanceToken })
    if (!r.ok) return { ok: false, status: null, phoneNumber: null, qr: null, reason: reasonFromResponse(r) }
    const d = unwrap(r.data)
    return { ok: true, status: mapDeploymentStatus(d), phoneNumber: String(d.phoneNumber || '').replace(/[^\d]/g, '') || null, qr: extractQr(d) }
  }

  async function simple(instance, method, suffix) {
    const { cfg, error } = tryReadUzapiConfig(instance, env)
    if (error) return { ok: false, reason: error }
    const r = await client.request(method, phonePath(cfg.phoneNumberId, suffix), { token: cfg.instanceToken })
    return r.ok ? { ok: true } : { ok: false, reason: reasonFromResponse(r) }
  }

  return {
    async createInstance({ name, webhookUrl }) {
      const e = getUzapiEnv(env)
      if (!e.username || !e.accountToken) throw codedError('uzapi_not_configured')
      const body = { name, authenticationMethod: 'QRCode', webhook: webhookUrl, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } }
      const r = await client.request('POST', 'instance/add', { token: e.accountToken, json: body, timeout: 30000 })
      if (!r.ok) {
        const reason = reasonFromResponse(r)
        throw codedError(reason === 'provider_auth' ? 'provider_auth' : 'uzapi_create_failed', `uzapi_create_failed: ${reason}`)
      }
      let creds = extractInstanceCredentials(r.data)
      if (creds.phoneNumberId && !creds.instanceToken) {
        const more = await client.request('GET', phonePath(creds.phoneNumberId, 'instance'), { token: e.accountToken })
        creds = { ...creds, instanceToken: extractInstanceCredentials(more.data).instanceToken }
      }
      if (!creds.phoneNumberId || !creds.instanceToken) {
        log.error(`[UzAPI] /instance/add sem phone_number_id ou token; campos recebidos: ${Object.keys(unwrap(r.data)).join(',')}`)
        const err = codedError('uzapi_create_incomplete')
        err.phoneNumberId = creds.phoneNumberId || null
        throw err
      }
      return { ...creds, qr: extractQr(unwrap(r.data)) }
    },

    status,

    async getQr(instance) {
      const st = await status(instance)
      return { ok: st.ok, qr: st.qr, status: st.status, reason: st.reason }
    },

    async registerWebhook(instance, url) {
      const { cfg, error } = tryReadUzapiConfig(instance, env)
      if (error) throw codedError(error)
      const cur = await client.request('GET', phonePath(cfg.phoneNumberId, 'instance'), { token: cfg.instanceToken })
      if (!cur.ok) throw codedError('uzapi_update_failed', `uzapi_update_failed: ${reasonFromResponse(cur)}`)
      const d = unwrap(cur.data)
      const body = { authenticationMethod: d.authenticationMethod || 'QRCode', webhook: url, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } }
      for (const k of ['name', 'appVersion', 'autoRejectCall', 'answerMissedCall']) {
        if (d[k] !== undefined && d[k] !== null) body[k] = d[k]
      }
      const r = await client.request('PUT', phonePath(cfg.phoneNumberId, 'instance/update'), { token: cfg.instanceToken, json: body })
      if (!r.ok) throw codedError('uzapi_update_failed', `uzapi_update_failed: ${reasonFromResponse(r)}`)
    },

    disconnect: (instance) => simple(instance, 'POST', 'instance/logout'),
    restart: (instance) => simple(instance, 'POST', 'instance/restart'),
    remove: (instance) => simple(instance, 'DELETE', 'instance/delete'),
  }
}

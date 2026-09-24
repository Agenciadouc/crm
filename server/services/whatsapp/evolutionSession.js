// Sessao da Evolution: criar instancia, QR, estado, logout, apagar, reiniciar, info.
// Reescrito aqui a partir do adapter do GitHub (João, 23/09 — whatsappProvider/evolutionAdapter.js).
// Mensagens, midia e webhook ficam no adaptador evolution.js; UzAPI tem sessao propria (uzapiSession.js).
// Nenhuma funcao lanca erro: falha de rede/HTTP volta no resultado (campo `error`).
import nodeFetch from 'node-fetch'

function baseUrl(instance) {
  return String(instance.api_url || '').replace(/\/+$/, '')
}

function name(instance) {
  return encodeURIComponent(instance.instance_name || '')
}

function qrFrom(data) {
  // Evolution v2.3 pode retornar QR aninhado (data.qrcode.base64) ou direto (data.base64)
  return data?.qrcode?.base64 || data?.base64 || null
}

export function createEvolutionSession({ fetch }) {
  return {
    // Retorna { qrcode, raw } — `opts` = { baseUrl, apiKey, instanceName } (ainda nao existe linha no banco)
    async createInstance({ baseUrl: url, apiKey, instanceName, integration = 'WHATSAPP-BAILEYS' }) {
      try {
        const res = await fetch(`${String(url).replace(/\/+$/, '')}/instance/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: apiKey },
          body: JSON.stringify({ instanceName, qrcode: true, integration }),
        })
        const data = await res.json().catch(() => ({}))
        return { qrcode: qrFrom(data), raw: data }
      } catch (e) {
        return { qrcode: null, raw: {}, error: e.message }
      }
    },

    // Retorna { qrcode, raw }
    async connectInstance(instance) {
      try {
        const res = await fetch(`${baseUrl(instance)}/instance/connect/${name(instance)}`, {
          headers: { apikey: instance.api_key },
        })
        const data = await res.json().catch(() => ({}))
        return { qrcode: qrFrom(data), raw: data }
      } catch (e) {
        return { qrcode: null, raw: {}, error: e.message }
      }
    },

    // Retorna { state: 'open'|'connecting'|'close', raw }. Erro de rede: state 'close' + error —
    // quem chama deve tratar `error` como "checagem falhou", nao como sessao fechada.
    async connectionState(instance) {
      try {
        const res = await fetch(`${baseUrl(instance)}/instance/connectionState/${name(instance)}`, {
          headers: { apikey: instance.api_key },
        })
        const data = await res.json().catch(() => ({}))
        return { state: data?.instance?.state || data?.state || 'close', raw: data }
      } catch (e) {
        return { state: 'close', raw: {}, error: e.message }
      }
    },

    // Desconecta o WhatsApp mas mantem a sessao no servidor
    async logout(instance) {
      try {
        await fetch(`${baseUrl(instance)}/instance/logout/${name(instance)}`, {
          method: 'DELETE',
          headers: { apikey: instance.api_key },
        })
        return { ok: true }
      } catch (e) {
        return { ok: false, raw: {}, error: e.message }
      }
    },

    // Apaga de vez. 404 conta como sucesso (ja nao existe). Timeout padrao 8s.
    async deleteInstance(instance, { timeoutMs = 8000 } = {}) {
      try {
        const res = await fetch(`${baseUrl(instance)}/instance/delete/${name(instance)}`, {
          method: 'DELETE',
          headers: { apikey: instance.api_key },
          signal: AbortSignal.timeout(timeoutMs),
        })
        return { ok: res.ok || res.status === 404, status: res.status }
      } catch (e) {
        return { ok: false, raw: {}, error: e.name === 'TimeoutError' ? 'timeout' : e.message }
      }
    },

    // Refaz a sessao Baileys do zero (mais agressivo que connect)
    async restartInstance(instance) {
      try {
        const res = await fetch(`${baseUrl(instance)}/instance/restart/${name(instance)}`, {
          method: 'POST',
          headers: { apikey: instance.api_key },
        })
        const data = await res.json().catch(() => ({}))
        return { ok: res.ok, raw: data }
      } catch (e) {
        return { ok: false, raw: {}, error: e.message }
      }
    },

    // Info da instancia (ownerJid/phone_number) ou null
    async fetchInstanceInfo(instance) {
      try {
        const res = await fetch(`${baseUrl(instance)}/instance/fetchInstances?instanceName=${name(instance)}`, {
          headers: { apikey: instance.api_key },
        })
        const data = await res.json().catch(() => null)
        const arr = Array.isArray(data) ? data : (data?.instance ? [data.instance] : [])
        return arr[0] || null
      } catch {
        return null
      }
    },
  }
}

export const evolutionSession = createEvolutionSession({ fetch: nodeFetch })

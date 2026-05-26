// Integracao com HUB (porta 3003) — cria cliente quando contrato eh aprovado no CRM.
//
// Auth: login com HUB_API_EMAIL/HUB_API_PASSWORD do .env (cache de token 25min).
// Best-effort: se HUB cair ou env nao configurado, log + retorna { ok: false } sem quebrar o CRM.

import fetch from 'node-fetch'

const HUB_URL_DEFAULT = 'http://127.0.0.1:3003'

let tokenCache = { token: null, expiresAt: 0 }

async function getHubToken() {
  // Cache 25min (HUB JWT expira em 30+ min)
  if (tokenCache.token && tokenCache.expiresAt > Date.now()) return tokenCache.token

  const url = process.env.HUB_API_URL || HUB_URL_DEFAULT
  const email = process.env.HUB_API_EMAIL
  const password = process.env.HUB_API_PASSWORD
  if (!email || !password) {
    console.warn('[HUB] HUB_API_EMAIL/HUB_API_PASSWORD nao configurados no .env — integracao desabilitada')
    return null
  }

  try {
    const res = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.token) {
      console.error('[HUB] Login falhou:', res.status, JSON.stringify(data).substring(0, 200))
      return null
    }
    tokenCache = { token: data.token, expiresAt: Date.now() + 25 * 60 * 1000 }
    return data.token
  } catch (e) {
    console.error('[HUB] Login exception:', e.message)
    return null
  }
}

/**
 * Cria cliente no HUB a partir dos dados de um contrato CRM aprovado.
 *
 * @param {Object} contract - row da tabela contracts
 * @param {string} email - email gerado (mesmo do CRM gerente)
 * @param {string} password - senha gerada (mesma do CRM, ex: 'dros2026')
 * @returns {Promise<{ ok: boolean, client?: any, reason?: string }>}
 */
export async function createHubClient(contract, email, password) {
  const url = process.env.HUB_API_URL || HUB_URL_DEFAULT
  const token = await getHubToken()
  if (!token) return { ok: false, reason: 'sem_credenciais_hub' }

  // Map: contract fields → HUB client fields
  // HUB tem: name, contact_name, contact_email, contact_phone, password,
  //          cnpj, razao_social, segmento, website, instagram, cidade, estado, observacoes,
  //          monthly_fee, payment_day, contrato_inicio
  const payload = {
    name: String(contract.razao_social || '').trim(),
    contact_name: String(contract.razao_social || '').trim(),
    contact_email: email,
    contact_phone: contract.contact_phone || null,
    password: password,
    cnpj: contract.cnpj || null,
    razao_social: contract.razao_social || null,
    cidade: contract.endereco_cidade || null,
    estado: contract.endereco_estado || null,
    monthly_fee: contract.fee_mensal != null ? Number(contract.fee_mensal) : null,
    contrato_inicio: contract.data_inicio || null,
  }

  try {
    const res = await fetch(`${url}/api/clients`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[HUB] Criar cliente falhou:', res.status, JSON.stringify(data).substring(0, 300))
      return { ok: false, reason: data.error || `HTTP ${res.status}` }
    }
    console.log(`[HUB] Cliente criado: id=${data.client?.id} (${data.client?.name || payload.name})`)
    return { ok: true, client: data.client }
  } catch (e) {
    console.error('[HUB] Criar cliente exception:', e.message)
    return { ok: false, reason: e.message }
  }
}

import crypto from 'crypto'
import fetch from 'node-fetch'
import db from '../db.js'

// Hash padrao Meta: SHA256 lowercase trim
function sha256(s) {
  if (!s) return null
  return crypto.createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex')
}

// Normaliza telefone pra E.164 sem +
function normalizePhoneForHash(p) {
  if (!p) return null
  const digits = String(p).replace(/[^\d]/g, '')
  if (!digits) return null
  return sha256(digits)
}

// Constroi fbc no formato Meta (fb.1.{ms}.{fbclid_ou_ctwa_clid})
function buildFbc(clid, eventTimeSec) {
  if (!clid) return null
  if (String(clid).startsWith('fb.')) return String(clid) // ja vem montado
  return `fb.1.${eventTimeSec * 1000}.${clid}`
}

function splitName(fullName) {
  if (!fullName) return { fn: null, ln: null }
  const parts = String(fullName).trim().split(/\s+/)
  if (parts.length === 0) return { fn: null, ln: null }
  if (parts.length === 1) return { fn: parts[0], ln: null }
  return { fn: parts[0], ln: parts.slice(1).join(' ') }
}

// Normaliza cidade pra hash: lowercase, sem acento, sem espacos extras
function normalizeCityForHash(s) {
  if (!s) return null
  const normalized = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, '')
  return normalized ? sha256(normalized) : null
}

// ─── Envia evento pro Meta CAPI ──────────────────────────────────────
// opts: { accountId, lead, eventName, stageId, historyId, request? }
// request opcional: req do express (extrai IP/UA)
// retorna: { ok, skipped, reason, event_id, response, error }
export async function sendCapiEvent({ accountId, lead, eventName, stageId, historyId, request }) {
  if (!accountId || !lead || !eventName) return { skipped: true, reason: 'missing_params' }

  const account = db.prepare(`
    SELECT meta_pixel_id, meta_capi_token, meta_capi_test_event_code, meta_capi_enabled, meta_page_id
    FROM accounts WHERE id = ?
  `).get(accountId)

  if (!account?.meta_capi_enabled || !account.meta_pixel_id || !account.meta_capi_token) {
    if (historyId) {
      try { db.prepare('UPDATE stage_history SET capi_status = ? WHERE id = ?').run('skipped_not_configured', historyId) } catch {}
    }
    return { skipped: true, reason: 'capi_not_configured' }
  }

  // CTWA (click-to-WhatsApp) → caminho business_messaging. O Meta exige page_id (ou WABA)
  // associado ao dataset; sem o page_id na conta o evento eh rejeitado (2804116/2804131).
  const isCtwa = !!(lead.ctwa_clid || lead.fbc?.includes('ctwa'))
  const isLeadForm = !!(lead.lead_form_lead_id || lead.meta_form_id)
  if (isCtwa && !account.meta_page_id) {
    if (historyId) {
      try { db.prepare('UPDATE stage_history SET capi_status = ? WHERE id = ?').run('skipped_no_page_id', historyId) } catch {}
    }
    console.warn(`[CAPI] lead=${lead.id} CTWA sem page_id na conta ${accountId} — configure o Page ID em Integracoes. Evento nao enviado.`)
    return { skipped: true, reason: 'ctwa_no_page_id' }
  }

  const eventTime = Math.floor(Date.now() / 1000)
  const eventId = `lead_${lead.id}_stage_${stageId || 0}_${eventTime}`

  const { fn, ln } = splitName(lead.name)

  // user_data — Meta requer SHA256 lowercase trim em PII, plaintext em IDs/IP/UA
  const userData = {}

  const phHash = normalizePhoneForHash(lead.phone)
  if (phHash) userData.ph = [phHash]
  if (lead.email) userData.em = [sha256(lead.email)]
  if (fn) userData.fn = [sha256(fn)]
  if (ln) userData.ln = [sha256(ln)]

  // external_id — Meta aceita plaintext (preferido) ou hash. Usamos plaintext pra max EMQ.
  userData.external_id = [`crm_lead_${lead.id}`]

  // Localizacao (hash) — eleva EMQ
  const ctHash = normalizeCityForHash(lead.city)
  if (ctHash) userData.ct = [ctHash]
  if (lead.state) userData.st = [sha256(lead.state)]
  if (lead.zip) userData.zp = [sha256(String(lead.zip).replace(/\D/g, ''))]
  userData.country = [sha256('br')] // default Brasil

  // Data nascimento + genero (se tiver — hash)
  if (lead.birthdate) {
    const dbDate = String(lead.birthdate).replace(/\D/g, '').slice(0, 8) // YYYYMMDD
    if (dbDate.length === 8) userData.db = [sha256(dbDate)]
  }
  if (lead.gender) {
    const g = String(lead.gender).trim().toLowerCase().charAt(0)
    if (g === 'f' || g === 'm') userData.ge = [sha256(g)]
  }

  // fbp/fbc — PLAINTEXT (nao hash!)
  if (lead.fbp) userData.fbp = lead.fbp
  // fbc: usa lead.fbc real se existir. Pra CTWA NAO fabricamos fbc do ctwa_clid —
  // o proprio ctwa_clid eh o identificador no business_messaging (ver abaixo).
  const fbc = lead.fbc || (isCtwa ? null : buildFbc(lead.ctwa_clid, eventTime))
  if (fbc) userData.fbc = fbc

  // CTWA: identificadores exigidos no user_data pra business_messaging
  if (isCtwa) {
    userData.ctwa_clid = lead.ctwa_clid
    userData.page_id = String(account.meta_page_id)
  }

  // lead_id Meta Lead Form — plaintext, obrigatorio pra Conversion Leads
  if (lead.lead_form_lead_id) userData.lead_id = lead.lead_form_lead_id

  // IP/UA — extrai do request quando disponivel, senao usa o salvo no lead
  const ip = request?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || request?.headers?.['x-real-ip']
    || request?.ip
    || lead.client_ip_address
  if (ip && ip !== '::1' && ip !== '127.0.0.1') userData.client_ip_address = ip
  const ua = request?.headers?.['user-agent'] || lead.client_user_agent
  if (ua) userData.client_user_agent = ua

  // action_source conforme o canal (isCtwa/isLeadForm computados la em cima)
  let actionSource = 'system_generated'
  if (isCtwa) actionSource = 'business_messaging'
  else if (isLeadForm) actionSource = 'system_generated' // CRM agindo sobre lead do form

  // CTWA (business_messaging) so aceita um conjunto fixo de eventos: Purchase ou LeadSubmitted.
  // Os nomes padrao de pixel (Lead, Contact, Schedule, InitiateCheckout...) sao rejeitados (2804066).
  // Traduz o evento configurado na etapa pro vocabulario valido de mensagens.
  let finalEventName = eventName
  if (isCtwa) finalEventName = eventName === 'Purchase' ? 'Purchase' : 'LeadSubmitted'

  const customData = {
    lead_source: lead.source || 'crm',
    stage_id: stageId || null,
    currency: 'BRL',
  }
  if (lead.meta_ad_id) customData.ad_id = lead.meta_ad_id
  if (lead.meta_campaign_id) customData.campaign_id = lead.meta_campaign_id
  if (lead.meta_form_id) customData.lead_form_id = lead.meta_form_id
  if (lead.lead_form_lead_id) customData.lead_id = lead.lead_form_lead_id
  // Purchase via business_messaging exige value (alem de currency). Sem valor de negocio, default 0.
  if (isCtwa && finalEventName === 'Purchase' && customData.value == null) customData.value = 0

  const eventData = {
    event_name: finalEventName,
    event_time: eventTime,
    event_id: eventId,
    action_source: actionSource,
    user_data: userData,
    custom_data: customData,
  }
  // messaging_channel: campo de NIVEL RAIZ do evento (nao custom_data) — obrigatorio quando action_source=business_messaging
  if (isCtwa) eventData.messaging_channel = 'whatsapp'

  const payload = {
    data: [eventData],
  }
  if (account.meta_capi_test_event_code) {
    payload.test_event_code = account.meta_capi_test_event_code
  }

  // Log do que esta sendo enviado (preview, sem dados sensiveis no claro)
  const sentKeys = Object.keys(userData).sort().join(',')
  console.log(`[CAPI→Meta] account=${accountId} lead=${lead.id} event=${finalEventName}${finalEventName !== eventName ? ` (orig:${eventName})` : ''} action_source=${actionSource} user_data_keys=[${sentKeys}] custom_data_keys=[${Object.keys(customData).join(',')}]`)

  try {
    const url = `https://graph.facebook.com/v21.0/${account.meta_pixel_id}/events?access_token=${encodeURIComponent(account.meta_capi_token)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000,
    })
    const responseData = await r.json().catch(() => ({}))
    const ok = r.ok && !responseData.error

    let status = 'failed'
    if (ok) status = 'sent'
    else if (responseData.error?.code === 100) status = 'failed_invalid_param'
    else if (r.status === 400) status = 'failed_400'
    else if (r.status === 401) status = 'failed_auth'
    else if (r.status === 429) status = 'failed_rate_limit'

    if (historyId) {
      try {
        db.prepare('UPDATE stage_history SET capi_event_id = ?, capi_status = ? WHERE id = ?')
          .run(eventId, status, historyId)
      } catch {}
    }

    if (ok) {
      console.log(`[CAPI✓] lead=${lead.id} event=${eventName} event_id=${eventId} events_received=${responseData.events_received || '?'} fbtrace=${responseData.fbtrace_id || '?'}`)
    } else {
      console.error(`[CAPI✗] lead=${lead.id} event=${eventName} HTTP ${r.status} status=${status} response=${JSON.stringify(responseData).substring(0, 400)}`)
    }

    return { ok, event_id: eventId, status, response: responseData }
  } catch (err) {
    console.error(`[CAPI✗] erro fatal lead=${lead.id} event=${eventName}:`, err.message)
    if (historyId) {
      try { db.prepare('UPDATE stage_history SET capi_status = ? WHERE id = ?').run('failed_network', historyId) } catch {}
    }
    return { ok: false, error: err.message }
  }
}

// Helper: pega lead completo pelo id (com todos campos relevantes pra CAPI)
export function loadLeadForCapi(leadId) {
  return db.prepare(`
    SELECT id, account_id, name, phone, email, city, state, zip, birthdate, gender,
           ctwa_clid, meta_ad_id, meta_campaign_id, meta_form_id, lead_form_lead_id,
           fbp, fbc, client_ip_address, client_user_agent, source
    FROM leads WHERE id = ?
  `).get(leadId)
}

// Helper: dispara CAPI se stage tem meta_event_name configurado
// Fire-and-forget — nunca bloqueia caller
export function triggerCapiForStageChange(leadOrId, newStageId, historyId = null, request = null) {
  try {
    const lead = typeof leadOrId === 'number' ? loadLeadForCapi(leadOrId) : leadOrId
    if (!lead || !newStageId) return
    const stage = db.prepare('SELECT meta_event_name FROM funnel_stages WHERE id = ?').get(newStageId)
    if (!stage?.meta_event_name) return
    // Recarrega lead completo se objeto veio "leve" (sem todos campos)
    let leadFull = lead
    if (!('client_ip_address' in lead)) leadFull = loadLeadForCapi(lead.id)
    sendCapiEvent({
      accountId: leadFull.account_id,
      lead: leadFull,
      eventName: stage.meta_event_name,
      stageId: newStageId,
      historyId,
      request,
    }).catch(e => console.error('[CAPI] async error:', e.message))
  } catch (e) {
    console.error('[CAPI] triggerCapiForStageChange error:', e.message)
  }
}

// Teste manual — envia evento Lead REAL pra producao (sem test_event_code)
export async function testCapi(accountId) {
  const account = db.prepare(`
    SELECT meta_pixel_id, meta_capi_token
    FROM accounts WHERE id = ?
  `).get(accountId)
  if (!account?.meta_pixel_id || !account?.meta_capi_token) {
    return { ok: false, error: 'Pixel ID ou Access Token nao configurado' }
  }
  const eventTime = Math.floor(Date.now() / 1000)
  const payload = {
    data: [{
      event_name: 'Lead',
      event_time: eventTime,
      event_id: `crm_validation_${eventTime}`,
      action_source: 'system_generated',
      user_data: {
        external_id: [`crm_validation_${accountId}_${eventTime}`],
        country: [sha256('br')],
      },
      custom_data: { source: 'crm_validation' },
    }],
  }
  console.log(`[CAPI TEST] account ${accountId} enviando evento Lead REAL pixel ${account.meta_pixel_id}`)
  try {
    const url = `https://graph.facebook.com/v21.0/${account.meta_pixel_id}/events?access_token=${encodeURIComponent(account.meta_capi_token)}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      timeout: 10000,
    })
    const responseData = await r.json().catch(() => ({}))
    console.log(`[CAPI TEST] account ${accountId} HTTP ${r.status}:`, JSON.stringify(responseData).substring(0, 400))
    if (!r.ok || responseData.error) {
      return { ok: false, error: responseData.error?.message || `HTTP ${r.status}`, response: responseData }
    }
    return { ok: true, response: responseData }
  } catch (err) {
    console.error(`[CAPI TEST] account ${accountId} erro fatal:`, err.message)
    return { ok: false, error: err.message }
  }
}

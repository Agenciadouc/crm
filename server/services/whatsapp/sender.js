// Envio de WhatsApp com protecoes anti-ban, independente do provedor.
// Movido de leadHandoff.js. Dependencias injetadas para testar com better-sqlite3 :memory:.
import { normalizeForSend } from './normalize.js'

export const LEAD_DAILY_CAP_DEFAULT = 50

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 2000
const QUOTA_DEFAULT_PER_HOUR = 100
const QUOTA_DEFAULT_PER_DAY = 800
// Dia 1 = 5% do quota, dia 2 = 20%, dia 3 = 50%. Dia 4+ = 100%.
const WARMUP_MULTIPLIERS = [0.05, 0.20, 0.50]
const TYPING_MIN_MS = 1200
const TYPING_MAX_MS = 5000

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function createSender({ db, getProvider, sleep = defaultSleep, random = Math.random, now = () => new Date(), nowMs = () => Date.now() }) {
  // Cache do pre-flight: Map<"instId:numero", { exists, expires }>
  const numberCache = new Map()

  function cachePut(key, exists) {
    if (numberCache.size > CACHE_MAX) {
      const half = Math.floor(CACHE_MAX / 2)
      const keys = Array.from(numberCache.keys()).slice(0, half)
      for (const k of keys) numberCache.delete(k)
    }
    numberCache.set(key, { exists, expires: nowMs() + CACHE_TTL_MS })
  }

  function cacheGet(key) {
    const v = numberCache.get(key)
    if (!v) return undefined
    if (nowMs() > v.expires) { numberCache.delete(key); return undefined }
    return v.exists
  }

  // business_hours_json: {sun:[{start:"08:00",end:"21:00"}], mon:[...], ...}; null = 24/7; dia sem slots = fechado.
  function isInBusinessHours(instance, at = now()) {
    if (!instance.business_hours_json) return true
    let schedule = null
    try { schedule = JSON.parse(instance.business_hours_json) } catch { return true }
    if (!schedule || typeof schedule !== 'object') return true
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const slots = schedule[dayKeys[at.getDay()]]
    if (!Array.isArray(slots) || slots.length === 0) return false
    const cur = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    return slots.some(s => s?.start && s?.end && cur >= s.start && cur <= s.end)
  }

  function checkLeadCap(instance, leadId) {
    if (!leadId) return { ok: true }
    const cap = instance.lead_daily_msg_cap || LEAD_DAILY_CAP_DEFAULT
    const count = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE lead_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 day')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(leadId)?.n || 0
    if (count >= cap) return { ok: false, reason: `lead_daily_cap_${cap}`, count, cap }
    return { ok: true, count, cap }
  }

  // Metrica: (total - failed) / total na janela; <70% auto-pausa. Minimo 20 msgs.
  function checkInstanceHealth(instance) {
    if (instance.paused_at && instance.paused_reason === 'manual') {
      return { ok: false, reason: 'manually_paused' }
    }
    const windowMin = instance.health_check_window_min || 120
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-${windowMin} minutes')
        AND delivery_status IN ('sent','delivered','read','failed')
    `).get(instance.id)
    if ((stats?.total || 0) < 20) return { ok: true, total: stats?.total || 0 }
    const failedRate = (stats.failed || 0) / stats.total
    const okRate = 1 - failedRate
    if (okRate < 0.70) {
      db.prepare("UPDATE whatsapp_instances SET paused_at = datetime('now'), paused_reason = 'delivered_rate_low' WHERE id = ?").run(instance.id)
      console.warn(`[Health] inst=${instance.instance_name} AUTO-PAUSED ok_rate=${(okRate * 100).toFixed(0)}% (failed=${stats.failed}/${stats.total})`)
      return { ok: false, reason: 'auto_paused_low_delivery', rate: okRate, failed: stats.failed, total: stats.total }
    }
    return { ok: true, rate: okRate, total: stats.total }
  }

  // Marca a ultima inbound do lead como lida (humano abre a conversa antes de responder). Best-effort.
  async function markMessageAsRead(instance, lead) {
    if (!lead || !instance) return
    let provider
    try { provider = getProvider(instance) } catch { return }
    if (!provider.markRead) return
    const lastMsg = db.prepare(`
      SELECT wa_msg_id FROM messages
      WHERE lead_id = ? AND direction = 'inbound' AND wa_msg_id IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(lead.id)
    if (!lastMsg?.wa_msg_id) return
    try { await provider.markRead(instance, lead, lastMsg.wa_msg_id) } catch {}
  }

  function checkSendQuota(instance) {
    const hourlyLimit = instance.hourly_send_limit || QUOTA_DEFAULT_PER_HOUR
    const dailyLimit = instance.daily_send_limit || QUOTA_DEFAULT_PER_DAY
    let effectiveHourly = hourlyLimit
    let effectiveDaily = dailyLimit
    if (instance.warmup_until) {
      const warmupEndMs = new Date(instance.warmup_until.replace(' ', 'T') + 'Z').getTime()
      if (warmupEndMs > nowMs()) {
        const refDate = instance.created_at || instance.warmup_until
        const createdMs = new Date(String(refDate).replace(' ', 'T') + 'Z').getTime()
        const daysIn = Math.max(0, Math.floor((nowMs() - createdMs) / 86400000))
        const mult = WARMUP_MULTIPLIERS[Math.min(daysIn, WARMUP_MULTIPLIERS.length - 1)]
        effectiveHourly = Math.max(1, Math.floor(hourlyLimit * mult))
        effectiveDaily = Math.max(1, Math.floor(dailyLimit * mult))
      }
    }
    const hourCount = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 hour')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(instance.id)?.n || 0
    if (hourCount >= effectiveHourly) {
      return { ok: false, reason: `quota_hourly_${effectiveHourly}`, hourCount, limit: effectiveHourly }
    }
    const dayCount = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 day')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(instance.id)?.n || 0
    if (dayCount >= effectiveDaily) {
      return { ok: false, reason: `quota_daily_${effectiveDaily}`, dayCount, limit: effectiveDaily }
    }
    return { ok: true, effectiveHourly, effectiveDaily, hourCount, dayCount }
  }

  // Sequencia humana: online -> digitando (tempo proporcional ao texto, jitter +-25%) -> parou -> envia.
  async function simulateTyping(instance, provider, phone, text) {
    const number = normalizeForSend(phone)
    if (!number) return
    const baseRaw = 800 + (text || '').length * 25
    const base = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, baseRaw))
    const jitter = 0.75 + random() * 0.5
    const ms = Math.round(base * jitter)
    const presence = (state) => Promise.resolve().then(() => provider.sendPresence(instance, number, state)).catch(() => {})
    await presence('available')
    await sleep(300 + random() * 200)
    await presence('composing')
    await sleep(ms)
    await presence('paused')
    await sleep(100 + random() * 100)
  }

  // true (existe), false (nao existe), null (erro/timeout ou provedor sem checagem). Cache 5 min.
  async function checkWhatsAppNumber(instance, phone) {
    const number = normalizeForSend(phone)
    if (!number) return false
    const cacheKey = `${instance.id}:${number}`
    const cached = cacheGet(cacheKey)
    if (cached !== undefined) return cached
    let provider
    try { provider = getProvider(instance) } catch { return null }
    if (!provider.checkNumber) return null
    try {
      const map = await provider.checkNumber(instance, [number], { timeoutMs: 3000 })
      const exists = map[number] === undefined ? null : map[number]
      cachePut(cacheKey, exists)
      return exists
    } catch {
      return null
    }
  }

  async function checkWhatsAppNumbersBulk(instance, phones) {
    const result = new Map()
    if (!phones || phones.length === 0) return result
    const normalizedToOriginal = new Map()
    for (const p of phones) {
      const n = normalizeForSend(p)
      if (n && !normalizedToOriginal.has(n)) normalizedToOriginal.set(n, p)
    }
    const toQuery = []
    for (const n of normalizedToOriginal.keys()) {
      const cached = cacheGet(`${instance.id}:${n}`)
      if (cached !== undefined) result.set(normalizedToOriginal.get(n), cached)
      else toQuery.push(n)
    }
    if (toQuery.length === 0) return result
    let provider
    try { provider = getProvider(instance) } catch { provider = null }
    if (!provider || !provider.checkNumber) {
      for (const n of toQuery) result.set(normalizedToOriginal.get(n), null)
      return result
    }
    try {
      const map = await provider.checkNumber(instance, toQuery, { timeoutMs: 15000, matchByNumber: true })
      for (const n of toQuery) {
        const exists = map[n] === undefined ? null : map[n]
        cachePut(`${instance.id}:${n}`, exists)
        result.set(normalizedToOriginal.get(n), exists)
      }
      return result
    } catch {
      for (const n of toQuery) result.set(normalizedToOriginal.get(n), null)
      return result
    }
  }

  // Checagens comuns a texto e midia. Devolve { ok:false, result } ou { ok:true, number, provider }.
  async function runSendGuards(instance, phone, typingText, opts) {
    const number = normalizeForSend(phone)
    if (!number) return { ok: false, result: { ok: false, reason: 'phone vazio' } }
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, result: { ok: false, reason: e.message } } }

    if (instance.paused_at && !opts.skipHealthCheck) {
      return { ok: false, result: { ok: false, reason: `instance_paused_${instance.paused_reason || 'unknown'}` } }
    }
    if (!opts.skipBusinessHours && !isInBusinessHours(instance)) {
      return { ok: false, result: { ok: false, reason: 'outside_business_hours' } }
    }
    if (!opts.skipLeadCap && opts.leadId) {
      const c = checkLeadCap(instance, opts.leadId)
      if (!c.ok) {
        console.warn(`[LeadCap] inst=${instance.instance_name} lead=${opts.leadId} bloqueado: ${c.reason} (count=${c.count}/${c.cap})`)
        return { ok: false, result: { ok: false, reason: c.reason } }
      }
    }
    if (!opts.skipHealthCheck) {
      const h = checkInstanceHealth(instance)
      if (!h.ok) return { ok: false, result: { ok: false, reason: h.reason } }
    }
    if (!opts.skipValidation && provider.capabilities?.numberCheck) {
      const exists = await checkWhatsAppNumber(instance, phone)
      if (exists === false) {
        console.log(`[Pre-flight] phone=${number} inst=${instance.instance_name} exists=false — bloqueando envio`)
        return { ok: false, result: { ok: false, reason: 'number_not_on_whatsapp', validationFailed: true } }
      }
    }
    if (!opts.skipQuota) {
      const q = checkSendQuota(instance)
      if (!q.ok) {
        console.warn(`[Quota] inst=${instance.instance_name} bloqueado: ${q.reason} (count=${q.hourCount ?? q.dayCount}/${q.limit})`)
        return { ok: false, result: { ok: false, reason: q.reason } }
      }
    }
    if (!opts.skipTyping && provider.capabilities?.presence && provider.sendPresence) {
      await simulateTyping(instance, provider, phone, typingText)
    }
    return { ok: true, number, provider }
  }

  function mapProviderResult(r) {
    if (!r.ok) return r.raw !== undefined ? { ok: false, reason: r.reason, raw: r.raw } : { ok: false, reason: r.reason }
    return { ok: true, wamsgId: r.messageId, raw: r.raw }
  }

  async function sendViaInstance(instance, phone, text, opts = {}) {
    const guard = await runSendGuards(instance, phone, text, opts)
    if (!guard.ok) return guard.result
    return mapProviderResult(await guard.provider.sendText(instance, guard.number, text))
  }

  async function sendMediaViaInstance(instance, phone, media, opts = {}) {
    const guard = await runSendGuards(instance, phone, media?.caption || '', opts)
    if (!guard.ok) return guard.result
    if (!guard.provider.sendMedia) return { ok: false, reason: 'media_not_supported' }
    return mapProviderResult(await guard.provider.sendMedia(instance, guard.number, media))
  }

  return {
    sendViaInstance, sendMediaViaInstance, checkWhatsAppNumber, checkWhatsAppNumbersBulk, markMessageAsRead,
    isInBusinessHours, checkLeadCap, checkInstanceHealth, checkSendQuota,
  }
}

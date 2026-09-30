// Calculos puros do LTV/recompra (spec §3). Datas de calendario em horario de Brasilia (UTC-3).
import { REMIND_DAYS } from './schema.js'

const DAY_MS = 86400000
const BRT_OFFSET_MS = 3 * 3600000
const round2 = n => Math.round(n * 100) / 100
const round1 = n => Math.round(n * 10) / 10
const dayOnly = s => String(s).slice(0, 10)
const toUtcMidnight = d => Date.parse(dayOnly(d) + 'T00:00:00Z')

export function localDate(now = new Date()) {
  return new Date(now.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date, days) {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(a, b) {
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / DAY_MS)
}

export function curveFor({ avgIntervalDays, daysSinceLast }, { a, b, c }) {
  if (avgIntervalDays == null) return '1a'
  const rhythm = Math.max(avgIntervalDays, daysSinceLast || 0)
  if (rhythm <= a) return 'A'
  if (rhythm <= b) return 'B'
  if (rhythm <= c) return 'C'
  return 'D'
}

export function customerStats(sales, { today, curve }) {
  if (!sales || !sales.length) return { ltv: 0, purchases: 0, lastPurchaseAt: null, avgIntervalDays: null, curve: null }
  const ltv = round2(sales.reduce((s, x) => s + Number(x.value || 0), 0))
  const days = [...new Set(sales.map(s => dayOnly(s.sale_date)))].sort()
  const last = days[days.length - 1]
  let avg = null
  if (days.length >= 2) {
    let total = 0
    for (let i = 1; i < days.length; i++) total += daysBetween(days[i - 1], days[i])
    avg = round1(total / (days.length - 1))
  }
  return {
    ltv,
    purchases: sales.length,
    lastPurchaseAt: last,
    avgIntervalDays: avg,
    curve: curveFor({ avgIntervalDays: avg, daysSinceLast: daysBetween(last, today) }, curve),
  }
}

export function tierFor(ltv, tiers) {
  let best = null
  for (const t of tiers || []) {
    if (ltv >= Number(t.min_ltv) && (!best || Number(t.min_ltv) > Number(best.min_ltv))) best = t
  }
  return best ? best.id : null
}

export function median(nums) {
  if (!nums || !nums.length) return null
  const s = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function suggestRemindDays({ medianDays, markedDays, cases }) {
  if (medianDays == null || !markedDays || cases < 10) return null
  if (medianDays <= markedDays * 1.2) return null
  return REMIND_DAYS.reduce((best, d) => (Math.abs(d - medianDays) < Math.abs(best - medianDays) ? d : best), REMIND_DAYS[0])
}

export function staleBand(daysSinceLast) {
  if (daysSinceLast == null || daysSinceLast < 30) return null
  if (daysSinceLast <= 60) return '30-60'
  if (daysSinceLast <= 90) return '61-90'
  if (daysSinceLast <= 180) return '91-180'
  return '181+'
}

export function validateCurve({ a, b, c }) {
  const ok = [a, b, c].every(n => Number.isInteger(n) && n >= 1 && n <= 365)
  if (!ok) return { ok: false, error: 'Use dias inteiros entre 1 e 365.' }
  if (!(a < b && b < c)) return { ok: false, error: 'A precisa ser menor que B, e B menor que C.' }
  return { ok: true }
}

export function dueIso(remindAt, now = new Date()) {
  const due = new Date(dayOnly(remindAt) + 'T12:00:00.000Z')
  return (due.getTime() < now.getTime() ? now : due).toISOString()
}

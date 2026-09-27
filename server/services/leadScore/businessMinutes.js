// Minutos dentro do horario de atendimento entre duas datas (spec 5.5). Pura.
// Horario no formato de instance_auto_messages.away_schedule_json: { mon: [{start:'08:00', end:'18:00'}], ... } (chaves sun..sat).
const DAY_BY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MAX_MINUTES = 7 * 24 * 60
const DAY_MS = 86400000
const formatters = new Map()

function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }))
  }
  return formatters.get(tz)
}

function toMs(d) {
  if (d instanceof Date) return d.getTime()
  if (typeof d === 'number') return d
  if (typeof d === 'string') return Date.parse(d.includes('T') ? d : d.replace(' ', 'T') + 'Z')
  return NaN
}

// Data/hora local do instante como se fosse UTC (y, m, d, h, mi, s).
function localParts(fmt, ms) {
  const out = {}
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

// Deslocamento do fuso no instante (local - UTC), em ms. Pega horario de verao se houver.
function offsetAt(fmt, ms) {
  const p = localParts(fmt, ms)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(ms / 1000) * 1000
}

// Instante UTC de "dia local (dayUtc = meia-noite do dia como UTC) + minutos".
function localToUtc(fmt, dayUtc, minutes) {
  const wall = dayUtc + minutes * 60000
  const guess = wall - offsetAt(fmt, wall)
  return wall - offsetAt(fmt, guess)
}

function parseHM(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

// Horario valido = objeto com pelo menos uma faixa start/end em algum dia; senao null.
// Faixas viram minutos do dia [ini, fim); faixa invalida ou invertida e ignorada.
function parseSchedule(scheduleJson) {
  let raw = scheduleJson
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  let any = false
  for (const key of DAY_BY_INDEX) {
    const slots = Array.isArray(raw[key]) ? raw[key].filter(s => s && typeof s.start === 'string' && typeof s.end === 'string') : []
    if (slots.length) any = true
    out[key] = slots.map(s => [parseHM(s.start), parseHM(s.end)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
  }
  return any ? out : null
}

// Anda dia a dia (no fuso) somando a intersecao das faixas do dia com [from, to].
// Conta no maximo 7 dias corridos. `cap`: para cedo e devolve no maximo cap.
export function businessMinutesBetween(scheduleJson, fromDate, toDate, tz = 'America/Sao_Paulo', { cap = null } = {}) {
  const from = toMs(fromDate)
  const to = toMs(toDate)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  const limit = Number.isFinite(cap) && cap > 0 ? cap : Infinity
  const schedule = parseSchedule(scheduleJson)
  if (!schedule) return Math.min(Math.floor((to - from) / 60000), limit)

  let fmt
  try { fmt = formatterFor(tz) } catch { fmt = formatterFor('America/Sao_Paulo') }
  const end = Math.min(to, from + MAX_MINUTES * 60000)
  const start = localParts(fmt, from)
  let day = Date.UTC(start.year, start.month - 1, start.day)
  let totalMs = 0
  while (localToUtc(fmt, day, 0) < end) {
    for (const [a, b] of schedule[DAY_BY_INDEX[new Date(day).getUTCDay()]]) {
      const lo = Math.max(localToUtc(fmt, day, a), from)
      const hi = Math.min(localToUtc(fmt, day, b), end)
      if (hi > lo) totalMs += hi - lo
      if (totalMs >= limit * 60000) return limit
    }
    day += DAY_MS
  }
  return Math.min(Math.floor(totalMs / 60000), limit)
}

// Minutos dentro do horario de atendimento entre duas datas (spec 5.5). Pura.
// Horario no formato de instance_auto_messages.away_schedule_json: { mon: [{start:'08:00', end:'18:00'}], ... } (chaves sun..sat).
const DAY_KEYS = { Sun: 'sun', Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat' }
const MAX_MINUTES = 7 * 24 * 60
const formatters = new Map()

function formatterFor(tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
  }
  return formatters.get(tz)
}

function toMs(d) {
  if (d instanceof Date) return d.getTime()
  if (typeof d === 'number') return d
  if (typeof d === 'string') return Date.parse(d.includes('T') ? d : d.replace(' ', 'T') + 'Z')
  return NaN
}

// Horario valido = objeto com pelo menos uma faixa start/end em algum dia; senao null.
function parseSchedule(scheduleJson) {
  let raw = scheduleJson
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw) } catch { return null }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out = {}
  let any = false
  for (const key of Object.values(DAY_KEYS)) {
    const slots = Array.isArray(raw[key]) ? raw[key].filter(s => s && typeof s.start === 'string' && typeof s.end === 'string') : []
    out[key] = slots
    if (slots.length) any = true
  }
  return any ? out : null
}

export function businessMinutesBetween(scheduleJson, fromDate, toDate, tz = 'America/Sao_Paulo') {
  const from = toMs(fromDate)
  const to = toMs(toDate)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0
  const schedule = parseSchedule(scheduleJson)
  if (!schedule) return Math.floor((to - from) / 60000)

  let fmt
  try { fmt = formatterFor(tz) } catch { fmt = formatterFor('America/Sao_Paulo') }
  const total = Math.min(Math.floor((to - from) / 60000), MAX_MINUTES)
  let count = 0
  for (let i = 0; i < total; i++) {
    const parts = fmt.formatToParts(new Date(from + i * 60000))
    let wd = ''
    let hh = ''
    let mm = ''
    for (const p of parts) {
      if (p.type === 'weekday') wd = p.value
      else if (p.type === 'hour') hh = p.value === '24' ? '00' : p.value
      else if (p.type === 'minute') mm = p.value
    }
    const slots = schedule[DAY_KEYS[wd]]
    if (!slots || !slots.length) continue
    const cur = `${hh}:${mm}`
    if (slots.some(s => cur >= s.start && cur < s.end)) count++
  }
  return count
}

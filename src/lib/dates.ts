// parseSqlDate mora em sqlDate.js (um helper so, usado tambem pela logica pura .js)
import { parseSqlDate } from './sqlDate.js'
export { parseSqlDate }

export function formatTime(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' }): string {
  const d = parseSqlDate(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', opts)
}

export function formatDate(s: string | null | undefined): string {
  const d = parseSqlDate(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR')
}

export function formatDateTime(s: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }): string {
  const d = parseSqlDate(s)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', opts)
}

// Label de dia estilo WhatsApp: "Hoje", "Ontem", "quarta-feira" ou "DD/MM/YYYY".
// Comparacao em hora LOCAL do navegador (nao UTC) — "Hoje" = hoje pra mim.
export function formatDayLabel(s: string | null | undefined, now: Date = new Date()): string {
  const d = parseSqlDate(s)
  if (isNaN(d.getTime())) return ''
  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())
  const msgDay = startOfDay(d).getTime()
  const todayDay = startOfDay(now).getTime()
  const diffDays = Math.round((todayDay - msgDay) / 86400000)
  if (diffDays === 0) return 'Hoje'
  if (diffDays === 1) return 'Ontem'
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' })
  return d.toLocaleDateString('pt-BR')
}

// Chave de agrupamento "YYYY-MM-DD" em hora local — pra comparar dia atual vs dia anterior.
export function localDayKey(s: string | null | undefined): string {
  const d = parseSqlDate(s)
  if (isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

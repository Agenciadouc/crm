// Parser de timestamps do SQLite que sao gravados em UTC mas sem marcador de timezone.
// Sem este helper, "2026-05-07 14:00:00" e parseado como hora LOCAL pelo JS,
// dando offset de +3h pra usuarios no fuso de Brasilia.
export function parseSqlDate(s: string | null | undefined): Date {
  if (!s) return new Date(NaN)
  // Ja em formato ISO com Z (UTC explicito)
  if (/Z$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  // SQLite: "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD HH:MM:SS.fff" — tratar como UTC
  return new Date(s.replace(' ', 'T') + 'Z')
}

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

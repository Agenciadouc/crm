// Parser de timestamps do SQLite que sao gravados em UTC mas sem marcador de timezone.
// Sem este helper, "2026-05-07 14:00:00" e parseado como hora LOCAL pelo JS,
// dando offset de +3h pra usuarios no fuso de Brasilia. JS puro (usado tambem pelos testes node:test).
export function parseSqlDate(s) {
  if (!s) return new Date(NaN)
  // Ja em formato ISO com Z (UTC explicito)
  if (/Z$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s)
  // SQLite: "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD HH:MM:SS.fff" — tratar como UTC
  return new Date(String(s).replace(' ', 'T') + 'Z')
}

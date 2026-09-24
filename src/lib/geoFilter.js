// Filtro de estado/cidade das telas, guardado num texto so: "UF|Cidade" ("RS|Porto Alegre", "SC|" = so estado,
// "" = todos). Texto sem "|" (escolha antiga, so cidade) continua valendo como cidade.
// JS puro com .d.ts ao lado para rodar no `node --test`.

export function parseGeo(value) {
  if (!value) return { uf: '', city: '' }
  const s = String(value)
  const i = s.indexOf('|')
  if (i < 0) return { uf: '', city: s.trim() }
  return { uf: s.slice(0, i).trim().toUpperCase(), city: s.slice(i + 1).trim() }
}

export function encodeGeo(uf, city) {
  const u = (uf || '').trim().toUpperCase()
  const c = (city || '').trim()
  return u || c ? `${u}|${c}` : ''
}

// Parametros de busca (para fetchLeads e afins): so os que existem
export function geoParams(value) {
  const g = parseGeo(value)
  const out = {}
  if (g.city) out.city = g.city
  if (g.uf) out.uf = g.uf
  return out
}

// Pedaco de query string: "&city=...&uf=..."
export function geoQuery(value) {
  const g = parseGeo(value)
  return (g.city ? `&city=${encodeURIComponent(g.city)}` : '') + (g.uf ? `&uf=${encodeURIComponent(g.uf)}` : '')
}

// Texto para avisos: "Porto Alegre - RS", "RS", "Torres"
export function geoLabel(value) {
  const g = parseGeo(value)
  if (g.city && g.uf) return `${g.city} - ${g.uf}`
  return g.city || g.uf
}

// Lead bate com o filtro? (Chat: leads que chegam em tempo real). Compara cidade sem acento/maiuscula.
function key(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
export function leadMatchesGeo(lead, value) {
  const g = parseGeo(value)
  if (g.uf && (lead?.uf || '') !== g.uf) return false
  if (g.city && key(lead?.city) !== key(g.city)) return false
  return true
}

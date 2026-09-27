// Filtro do termometro (faixa, nota minima, perfil A/B, engajamento alto). JS puro: testavel no node.
// Fica guardado no navegador por conta (scoreFilter:<accountId>) como JSON; '' = sem filtro.
const BANDS = ['frio', 'morno', 'quente', 'pronto']
// Nomes curtos para o resumo do filtro (ex.: "Quente, Pronto · nota ≥ 70")
const SHORT_LABEL = { frio: 'Frio', morno: 'Morno', quente: 'Quente', pronto: 'Pronto' }

export const EMPTY_SCORE_FILTER = Object.freeze({ bands: [], min: null, fit: false, engagement: false })

function normalize(raw) {
  const f = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const bands = Array.isArray(f.bands) ? BANDS.filter(b => f.bands.includes(b)) : []
  let min = null
  if (f.min !== null && f.min !== undefined && f.min !== '') {
    const n = Number(f.min)
    if (Number.isFinite(n) && n >= 0 && n <= 100) min = Math.round(n)
  }
  return { bands, min, fit: f.fit === true, engagement: f.engagement === true }
}

export function isScoreFilterActive(filter) {
  const f = normalize(filter)
  return f.bands.length > 0 || f.min !== null || f.fit || f.engagement
}

// Quantos filtros do termometro estao ligados (faixas contam como 1)
export function countScoreFilters(filter) {
  const f = normalize(filter)
  return (f.bands.length > 0 ? 1 : 0) + (f.min !== null ? 1 : 0) + (f.fit ? 1 : 0) + (f.engagement ? 1 : 0)
}

export function encodeScoreFilter(filter) {
  if (!isScoreFilterActive(filter)) return ''
  return JSON.stringify(normalize(filter))
}

export function parseScoreFilter(str) {
  if (!str) return { ...EMPTY_SCORE_FILTER, bands: [] }
  try { return normalize(JSON.parse(str)) } catch { return { ...EMPTY_SCORE_FILTER, bands: [] } }
}

// Parametros da API de leads (server/services/leadScore/filters.js)
export function scoreParams(filter) {
  const f = normalize(filter)
  const out = {}
  if (f.bands.length > 0) out.score_bands = f.bands.join(',')
  if (f.min !== null) out.score_min = f.min
  if (f.fit) out.fit = 'AB'
  if (f.engagement) out.engagement = 'high'
  return out
}

export function scoreFilterLabel(filter) {
  const f = normalize(filter)
  const parts = []
  if (f.bands.length > 0) parts.push(f.bands.map(b => SHORT_LABEL[b]).join(', '))
  if (f.min !== null) parts.push(`nota ≥ ${f.min}`)
  if (f.fit) parts.push('perfil A/B')
  if (f.engagement) parts.push('engajamento alto')
  return parts.join(' · ')
}

// Mesmo corte do servidor, para lead que chega/atualiza em tempo real na lista
export function leadMatchesScore(lead, filter) {
  const f = normalize(filter)
  if (!isScoreFilterActive(f)) return true
  const l = lead || {}
  if (f.bands.length > 0 && !f.bands.includes(l.score_band)) return false
  if (f.min !== null && !(l.score != null && l.score >= f.min)) return false
  if (f.fit && !(l.score_fit_grade === 'A' || l.score_fit_grade === 'B')) return false
  if (f.engagement && !(l.score_engagement != null && l.score_engagement >= 25)) return false
  return true
}

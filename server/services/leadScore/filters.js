// Filtros e ordem do termometro na lista/export de leads (spec 5.4). Pura: recebe alias/query, nao importa db.
import { BANDS, ENGAGEMENT_HIGH } from './compute.js'

// Pedaco de WHERE pro termometro (score_bands, score_min, fit=AB, engagement=high). Espelha cityWhere: mesmo shape { sql, params }.
export function scoreWhere(alias, query) {
  const q = query || {}
  let sql = ''
  const params = []

  const bands = String(q.score_bands || '').split(',').map(s => s.trim()).filter(b => BANDS.includes(b))
  if (bands.length > 0) {
    sql += ` AND ${alias}.score_band IN (${bands.map(() => '?').join(',')})`
    params.push(...bands)
  }

  const min = Number(q.score_min)
  if (q.score_min !== undefined && q.score_min !== '' && Number.isFinite(min) && min >= 0 && min <= 100) {
    sql += ` AND ${alias}.score >= ?`
    params.push(min)
  }

  if (q.fit === 'AB') {
    sql += ` AND ${alias}.score_fit_grade IN ('A','B')`
  }

  if (q.engagement === 'high') {
    sql += ` AND ${alias}.score_engagement >= ?`
    params.push(ENGAGEMENT_HIGH)
  }

  return { sql, params }
}

// Ordem por nota quando sort=score (seletor "Ordenar: Mais recentes | Termometro"); senao null (mantem ordem padrao do caller).
export function scoreOrder(alias, query) {
  const q = query || {}
  if (q.sort !== 'score') return null
  return `${alias}.score IS NULL, ${alias}.score DESC, COALESCE(${alias}.last_inbound_at, ${alias}.updated_at) DESC`
}

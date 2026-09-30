// Filtros de cliente em GET /api/leads (spec §10.5): curva, selo e atrasado na recompra.
import { localDate, addDays } from './compute.js'

export function lateSql(alias, today) {
  return {
    sql: `EXISTS (SELECT 1 FROM repurchase_cycles rc WHERE rc.lead_id = ${alias}.id AND (
      (rc.status IN ('a_contatar','em_conversa') AND rc.remind_at <= ?) OR (rc.status = 'aguardando' AND rc.exhausted = 1)))`,
    params: [addDays(today, -3)],
  }
}

export function customerWhere(alias, query = {}, now = new Date()) {
  const parts = []; const params = []
  if (['A', 'B', 'C', 'D', '1a'].includes(query.curve)) { parts.push(`${alias}.curve = ?`); params.push(query.curve) }
  if (query.tier_id && Number(query.tier_id)) { parts.push(`${alias}.tier_id = ?`); params.push(Number(query.tier_id)) }
  if (query.repurchase_late === '1' || query.repurchase_late === 1 || query.repurchase_late === true) {
    const l = lateSql(alias, localDate(now)); parts.push(l.sql); params.push(...l.params)
  }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params }
}

// Numeros do Dashboard (/api/dashboard/stats e /agents), separados por funil (spec 2026-10-05 filtro de
// funil §3). Recebe a conexao (nao importa server/db.js) para rodar em teste com SQLite de memoria.
import { cityWhere } from './city.js'
import { countsInMetrics } from './contacts/scope.js'
import { parseFunnelFilter, periodLeadsSql, currentFunnelWhere, salesWhere } from './funnelFilter.js'

// Filtro de cidade/estado + so contatos que contam nos numeros (lead e cliente).
function leadsWhere(alias, geo) {
  const cw = cityWhere(alias, geo)
  return { sql: `${cw.sql} AND ${countsInMetrics(alias)}`, params: cw.params }
}
const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ')

function windowOf(query, now) {
  const d = parseInt(query.days || '7')
  const since = new Date(now); since.setDate(since.getDate() - d)
  const prevSince = new Date(since); prevSince.setDate(prevSince.getDate() - d)
  return { sinceStr: fmt(since), prevSinceStr: fmt(prevSince), nowStr: fmt(now) }
}

export function computeDashboardStats(conn, accountId, query = {}, now = new Date()) {
  const f = parseFunnelFilter(query)
  const { sinceStr, prevSinceStr, nowStr } = windowOf(query, now)
  const cwl = leadsWhere('l', query)
  // Quem "conta no periodo": criados (vendas/todos) ou que entraram na recompra (recompra)
  const P = `FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id WHERE l.account_id = ? AND l.is_archived = 0 AND l.is_blocked = 0`

  const totalLeads = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND p.period_at >= ?${cwl.sql}`).get(accountId, sinceStr, ...cwl.params).c
  const prevTotalLeads = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND p.period_at >= ? AND p.period_at < ?${cwl.sql}`).get(accountId, prevSinceStr, sinceStr, ...cwl.params).c
  const leadsToday = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND date(p.period_at) = date(?)${cwl.sql}`).get(accountId, nowStr, ...cwl.params).c

  let conversionRate
  if (f === 'todos') {
    // Igual a antes: leads ativos em etapa de conversao do funil de vendas
    const conv = conn.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN fs.is_conversion = 1 THEN 1 ELSE 0 END) as converted
      FROM leads l JOIN funnel_stages fs ON l.stage_id = fs.id JOIN funnels fk ON fk.id = fs.funnel_id AND fk.kind = 'vendas'
      WHERE l.account_id = ? AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${cwl.sql}
    `).get(accountId, ...cwl.params)
    conversionRate = conv.total > 0 ? (conv.converted / conv.total) * 100 : 0
  } else {
    // 1as vendas / leads novos (vendas) ou recompras / entradas na recompra (recompra)
    const sales = conn.prepare(`
      SELECT COUNT(DISTINCT ls.id) c FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id
      WHERE l.account_id = ? AND l.is_blocked = 0 AND ls.sale_date >= ?${salesWhere('ls', f)}${cwl.sql}
    `).get(accountId, sinceStr, ...cwl.params).c
    conversionRate = totalLeads > 0 ? (sales / totalLeads) * 100 : 0
  }

  const unassigned = conn.prepare(`SELECT COUNT(*) c FROM leads l WHERE l.account_id = ? AND l.attendant_id IS NULL AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${currentFunnelWhere('l', f)}${cwl.sql}`).get(accountId, ...cwl.params).c

  // Funil por etapa: funil de vendas padrao; na Recompra, o funil de recompra
  const funnelPick = f === 'recompra' ? "f.kind = 'recompra'" : 'f.is_default = 1'
  const byStage = conn.prepare(`
    SELECT fs.id, fs.name, fs.color, fs.position, fs.is_conversion, COUNT(l.id) as count
    FROM funnel_stages fs
    JOIN funnels f ON fs.funnel_id = f.id
    LEFT JOIN leads l ON l.stage_id = fs.id AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${cwl.sql}
    WHERE f.account_id = ? AND ${funnelPick}
    GROUP BY fs.id ORDER BY fs.position
  `).all(...cwl.params, accountId)

  const bySource = conn.prepare(`
    SELECT COALESCE(l.source, 'manual') as source, COUNT(DISTINCT l.id) as count
    ${P} AND p.period_at >= ?${cwl.sql}
    GROUP BY COALESCE(l.source, 'manual') ORDER BY count DESC
  `).all(accountId, sinceStr, ...cwl.params)

  const daily = conn.prepare(`
    SELECT date(p.period_at) as date, COUNT(DISTINCT l.id) as count
    ${P} AND p.period_at >= ?${cwl.sql}
    GROUP BY date(p.period_at) ORDER BY date
  `).all(accountId, sinceStr, ...cwl.params)

  return { totalLeads, prevTotalLeads, leadsToday, conversionRate, unassigned, byStage, bySource, daily, funnel: f }
}

export function computeAgentStats(conn, accountId, query = {}, now = new Date()) {
  const f = parseFunnelFilter(query)
  const { sinceStr } = windowOf(query, now)
  const cw = leadsWhere('l2', query)
  const cwl = leadsWhere('l', query)
  const conversions = f === 'recompra'
    ? `(SELECT COUNT(DISTINCT ls.lead_id) FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id WHERE l.attendant_id = u.id AND l.is_blocked = 0 AND ls.sale_date >= ?${salesWhere('ls', 'recompra')}${cwl.sql})`
    : `(SELECT COUNT(*) FROM leads l JOIN funnel_stages fs ON l.stage_id = fs.id JOIN funnels fk ON fk.id = fs.funnel_id AND fk.kind = 'vendas' WHERE l.attendant_id = u.id AND fs.is_conversion = 1 AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${cwl.sql})`
  const convParams = f === 'recompra' ? [sinceStr, ...cwl.params] : [...cwl.params]
  const agents = conn.prepare(`
    SELECT u.id, u.name, u.is_active,
      (SELECT COUNT(DISTINCT l2.id) FROM (${periodLeadsSql(f)}) p2 JOIN leads l2 ON l2.id = p2.lead_id WHERE l2.attendant_id = u.id AND l2.is_archived = 0 AND l2.is_blocked = 0 AND p2.period_at >= ?${cw.sql}) as leads_period,
      (SELECT COUNT(*) FROM leads l2 WHERE l2.attendant_id = u.id AND l2.is_active = 1 AND l2.is_archived = 0 AND l2.is_blocked = 0${currentFunnelWhere('l2', f)}${cw.sql}) as leads_total,
      ${conversions} as conversions
    FROM users u WHERE u.account_id = ? AND u.role IN ('atendente', 'gerente')
    ORDER BY leads_total DESC
  `).all(sinceStr, ...cw.params, ...cw.params, ...convParams, accountId)
  return { agents }
}

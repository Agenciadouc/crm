// Cascata do funil mensal (leads -> qualificados -> reunioes -> vendas + faturamento), por funil
// (spec 2026-10-05 filtro de funil §3). Recebe a conexao; server/routes/dashboard.js expoe o wrapper
// computeFunnelCascade(accountId, month, city, funnel) usado pelo Dashboard, Projecao e Core (embed).
import { cityWhere } from './city.js'
import { countsInMetrics } from './contacts/scope.js'
import { periodLeadsSql, salesWhere, FUNNEL_FILTERS } from './funnelFilter.js'

function leadsWhere(alias, geo) {
  const cw = cityWhere(alias, geo)
  return { sql: `${cw.sql} AND ${countsInMetrics(alias)}`, params: cw.params }
}

// Primeiro dia (inclusive) e primeiro dia do mes seguinte (exclusive), 'YYYY-MM-DD HH:MM:SS'.
export function monthBounds(yearMonth) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(yearMonth || ''))
  if (!m) return null
  const y = parseInt(m[1]), mo = parseInt(m[2])
  const start = `${m[1]}-${m[2]}-01 00:00:00`
  const nextY = mo === 12 ? y + 1 : y
  const nextM = mo === 12 ? 1 : mo + 1
  const end = `${nextY}-${String(nextM).padStart(2, '0')}-01 00:00:00`
  return { start, end, yearMonth }
}

// Um lead conta como "qualificado" se JA passou por stage is_qualified/is_meeting/is_conversion (marco
// acumulativo); "reuniao" em is_meeting/is_conversion; "won" em is_conversion. Na Recompra nao ha essas
// etapas: base = quem entrou na recompra no mes, won = quem recomprou no mes.
export function cascadeFor(conn, accountId, yearMonth, city = null, funnel = 'todos') {
  const b = monthBounds(yearMonth)
  if (!b) return null
  const f = FUNNEL_FILTERS.includes(funnel) ? funnel : 'todos'
  const cwl = leadsWhere('l', city)
  const base = `FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id
    WHERE l.account_id = ? AND l.is_active = 1 AND l.is_blocked = 0 AND p.period_at >= ? AND p.period_at < ?${cwl.sql}`

  const total = conn.prepare(`SELECT COUNT(DISTINCT l.id) as c ${base}`).get(accountId, b.start, b.end, ...cwl.params).c

  const salesSum = () => conn.prepare(`
    SELECT COALESCE(SUM(ls.value), 0) as v FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id
    WHERE l.account_id = ? AND l.is_active = 1 AND l.is_blocked = 0
      AND ls.sale_date >= ? AND ls.sale_date < ?${salesWhere('ls', f)}${cwl.sql}
  `).get(accountId, b.start, b.end, ...cwl.params).v || 0

  if (f === 'recompra') {
    const won = conn.prepare(`
      SELECT COUNT(DISTINCT ls.lead_id) as c FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id
      WHERE l.account_id = ? AND l.is_active = 1 AND l.is_blocked = 0
        AND ls.sale_date >= ? AND ls.sale_date < ?${salesWhere('ls', 'recompra')}${cwl.sql}
    `).get(accountId, b.start, b.end, ...cwl.params).c
    return {
      total, qualified: null, meeting: null, won,
      qualified_rate: null, meeting_rate: null, won_rate: null,
      overall_conversion: total > 0 ? (won / total) * 100 : null,
      real_revenue: salesSum(),
      config_missing: { qualified: false, meeting: false, won: false },
      funnel: f,
    }
  }

  // IDs de stages classificados na conta (funil padrao)
  const stages = conn.prepare(`
    SELECT fs.id, fs.is_qualified, fs.is_meeting, fs.is_conversion
    FROM funnel_stages fs JOIN funnels fu ON fu.id = fs.funnel_id
    WHERE fu.account_id = ? AND fu.is_default = 1
  `).all(accountId)
  const qualIds = stages.filter(s => s.is_qualified || s.is_meeting || s.is_conversion).map(s => s.id)
  const meetIds = stages.filter(s => s.is_meeting || s.is_conversion).map(s => s.id)
  const wonIds = stages.filter(s => s.is_conversion).map(s => s.id)
  const configMissing = { qualified: qualIds.length === 0, meeting: meetIds.length === 0, won: wonIds.length === 0 }

  function countPassed(stageIds) {
    if (stageIds.length === 0) return 0
    const ph = stageIds.map(() => '?').join(',')
    return conn.prepare(`
      SELECT COUNT(DISTINCT l.id) as c ${base}
        AND EXISTS (SELECT 1 FROM stage_history sh WHERE sh.lead_id = l.id AND sh.to_stage_id IN (${ph}))
    `).get(accountId, b.start, b.end, ...cwl.params, ...stageIds).c
  }
  const qualified = countPassed(qualIds)
  const meeting = countPassed(meetIds)
  const won = countPassed(wonIds)

  // Faturamento = vendas com sale_date no mes (vendas: so a 1a de cada lead). Fallback legado: leads WON
  // criados no mes sem entrada em lead_sales contam pelo value_estimated.
  let realRevenue = salesSum()
  if (wonIds.length > 0) {
    const ph = wonIds.map(() => '?').join(',')
    const legacy = conn.prepare(`
      SELECT COALESCE(SUM(l.value_estimated), 0) as v
      FROM leads l
      WHERE l.account_id = ? AND l.is_active = 1 AND l.is_blocked = 0
        AND l.created_at >= ? AND l.created_at < ?
        AND l.value_estimated > 0
        AND EXISTS (SELECT 1 FROM stage_history sh WHERE sh.lead_id = l.id AND sh.to_stage_id IN (${ph}))
        AND NOT EXISTS (SELECT 1 FROM lead_sales ls2 WHERE ls2.lead_id = l.id)${cwl.sql}
    `).get(accountId, b.start, b.end, ...wonIds, ...cwl.params)
    realRevenue += legacy.v || 0
  }

  return {
    total, qualified, meeting, won,
    qualified_rate: total > 0 ? (qualified / total) * 100 : null,
    meeting_rate: qualified > 0 ? (meeting / qualified) * 100 : null,
    won_rate: meeting > 0 ? (won / meeting) * 100 : null,
    overall_conversion: total > 0 ? (won / total) * 100 : null,
    real_revenue: realRevenue,
    config_missing: configMissing,
    funnel: f,
  }
}

// Filtro de funil dos relatorios e listas: 'vendas' (venda nova) | 'recompra' | 'todos'.
// Unico lugar com a regra (spec 2026-10-05 filtro de funil §3): listas pelo funil ATUAL do lead;
// numeros pela HISTORIA (1a compra = nova; lead conta onde estava no momento).
// Nao importa server/db.js: so devolve trechos SQL; quem precisa do banco recebe a conexao.

export const FUNNEL_FILTERS = ['vendas', 'recompra', 'todos']

export function parseFunnelFilter(query) {
  const v = String((query && query.funnel) || '').trim().toLowerCase()
  return FUNNEL_FILTERS.includes(v) ? v : 'todos'
}

const stageKind = expr => `(SELECT fk.kind FROM funnel_stages s JOIN funnels fk ON fk.id = s.funnel_id WHERE s.id = ${expr})`
const currentKind = leadIdExpr => `(SELECT fk.kind FROM leads lk JOIN funnels fk ON fk.id = lk.funnel_id WHERE lk.id = ${leadIdExpr})`

// Funil do lead no instante: ultima troca ate o instante; se a 1a troca e depois, o funil de onde ela saiu;
// sem historico, o funil atual.
export function kindAtSql(leadIdExpr, timeExpr) {
  return `COALESCE(
    (SELECT ${stageKind('sh.to_stage_id')} FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} AND sh.created_at <= ${timeExpr} ORDER BY sh.created_at DESC, sh.id DESC LIMIT 1),
    (SELECT ${stageKind('sh.from_stage_id')} FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} ORDER BY sh.created_at ASC, sh.id ASC LIMIT 1),
    ${currentKind(leadIdExpr)}, 'vendas')`
}

// Funil em que o lead nasceu (1a linha do historico; sem historico, o funil atual).
export function firstKindSql(leadIdExpr) {
  return `COALESCE(
    (SELECT COALESCE(${stageKind('sh.from_stage_id')}, ${stageKind('sh.to_stage_id')}) FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} ORDER BY sh.created_at ASC, sh.id ASC LIMIT 1),
    ${currentKind(leadIdExpr)}, 'vendas')`
}

export function kindAtWhere(leadIdExpr, timeExpr, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  return ` AND ${kindAtSql(leadIdExpr, timeExpr)} = '${filter}'`
}

// Insights/erros/alertas da IA: contam no funil em que o lead estava na data (sem lead: so em 'todos').
export function insightFunnelWhere(leadIdExpr, timeExpr, filter) {
  const k = kindAtWhere(leadIdExpr, timeExpr, filter)
  return k ? ` AND ${leadIdExpr} IS NOT NULL${k}` : ''
}

export function currentFunnelWhere(alias, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  return ` AND ${alias}.funnel_id IN (SELECT id FROM funnels WHERE kind = '${filter}')`
}

// Listas (Chat/Leads/export): funnel_id (Pipeline) tem prioridade e e tratado pela rota.
export function leadListFunnelWhere(alias, query) {
  if (query && query.funnel_id) return ''
  return currentFunnelWhere(alias, parseFunnelFilter(query))
}

// WHERE completo de funil para listas: funnel_id (Pipeline) ou ?funnel (Chat/Leads/export).
export function leadListWhere(alias, query) {
  if (query && query.funnel_id) return { sql: ` AND ${alias}.funnel_id = ?`, params: [query.funnel_id] }
  return { sql: currentFunnelWhere(alias, parseFunnelFilter(query)), params: [] }
}

const RECOMPRA_ENTRIES = `
  SELECT sh.lead_id AS lead_id, sh.created_at AS period_at
  FROM stage_history sh
  JOIN funnel_stages ts ON ts.id = sh.to_stage_id
  JOIN funnels tf ON tf.id = ts.funnel_id AND tf.kind = 'recompra'
  WHERE sh.from_stage_id IS NULL OR COALESCE(${stageKind('sh.from_stage_id')}, '') <> 'recompra'`

// Subquery (lead_id, period_at): quem "conta no periodo". Uso:
// FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id ... COUNT(DISTINCT l.id)
export function periodLeadsSql(filter) {
  if (filter === 'recompra') return RECOMPRA_ENTRIES
  if (filter === 'vendas') return `SELECT lv.id AS lead_id, lv.created_at AS period_at FROM leads lv WHERE ${firstKindSql('lv.id')} = 'vendas'`
  return 'SELECT id AS lead_id, created_at AS period_at FROM leads'
}

// Vendas: 1a do lead = nova; 2a em diante = recompra (ordem por sale_date, desempate por id).
export function salesWhere(alias, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  const prior = `SELECT 1 FROM lead_sales sp WHERE sp.lead_id = ${alias}.lead_id AND (sp.sale_date < ${alias}.sale_date OR (sp.sale_date = ${alias}.sale_date AND sp.id < ${alias}.id))`
  return filter === 'vendas' ? ` AND NOT EXISTS (${prior})` : ` AND EXISTS (${prior})`
}

// Agregado diario de atendimentos: tabela antiga em 'todos'; tabela por funil nos outros (spec §5b).
export function amdSource(filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return 'attendant_metrics_daily'
  return `(SELECT * FROM attendant_metrics_daily_funnel WHERE funnel_kind = '${filter}')`
}

export function hasRepurchaseFunnel(conn, accountId) {
  return !!conn.prepare("SELECT 1 FROM funnels WHERE account_id = ? AND kind = 'recompra' AND is_active = 1 LIMIT 1").get(accountId)
}

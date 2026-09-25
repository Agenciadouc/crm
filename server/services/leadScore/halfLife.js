// Meia-vida do esfriamento (spec 5.1): 30% do ciclo mediano de venda da conta, entre 2 e 30 dias; <5 vendas = 7.
export function computeHalfLife(cycleDays) {
  const xs = (cycleDays || []).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
  if (xs.length < 5) return 7
  const m = Math.floor(xs.length / 2)
  const med = xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
  return Math.max(2, Math.min(30, Math.round(0.3 * med)))
}

// Ciclos (dias) dos ultimos 180 dias: criacao do lead -> primeira venda (lead_sales ou entrada em etapa de conversao).
export function accountCycleDays(db, accountId) {
  const rows = db.prepare(`
    SELECT l.id, l.created_at,
      MIN(COALESCE(
        (SELECT MIN(s.sale_date) FROM lead_sales s WHERE s.lead_id = l.id),
        (SELECT MIN(h.created_at) FROM stage_history h JOIN funnel_stages fs ON fs.id = h.to_stage_id WHERE h.lead_id = l.id AND fs.is_conversion = 1)
      )) AS won_at
    FROM leads l WHERE l.account_id = ? GROUP BY l.id
  `).all(accountId)
  const now = Date.now()
  const out = []
  for (const r of rows) {
    if (!r.won_at || !r.created_at) continue
    const won = Date.parse(r.won_at.replace(' ', 'T') + (r.won_at.length <= 10 ? 'T00:00:00Z' : 'Z'))
    const created = Date.parse(r.created_at.replace(' ', 'T') + 'Z')
    if (!Number.isFinite(won) || !Number.isFinite(created)) continue
    if (now - won > 180 * 86400000) continue
    out.push(Math.max(0, (won - created) / 86400000))
  }
  return out
}

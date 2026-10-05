// Selo do funil do lead (spec 2026-10-05 crm simples §3): todo lead mostra se esta em Vendas ou Recompra.
const COLORS = { Recompra: '#7C3AED', Vendas: '#2563EB' }

export function funnelLabel(funnel) {
  if (!funnel) return null
  return funnel.kind === 'recompra' ? 'Recompra' : 'Vendas'
}

export function funnelBadgeStyle(label) {
  const color = COLORS[label] || '#6B7280'
  return { color, background: `${color}20` }
}

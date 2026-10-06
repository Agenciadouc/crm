// Filtro de funil das telas: 'vendas' (Vendas novas) | 'recompra' | 'todos'. Padrao: vendas.
// JS puro com .d.ts ao lado para rodar no `node --test` (mesmo padrao de geoFilter.js).

export const FUNNEL_OPTIONS = [
  { value: 'vendas', label: 'Vendas novas' },
  { value: 'recompra', label: 'Recompra' },
  { value: 'todos', label: 'Todos' },
]

export function normalizeFunnel(v) {
  return FUNNEL_OPTIONS.some(o => o.value === v) ? v : 'vendas'
}

// Filtro efetivo da tela: null enquanto nao se sabe se a conta tem funil Recompra (a tela espera para
// nao buscar duas vezes); conta sem Recompra = 'todos' (nada muda nos numeros).
export function effectiveFunnel(value, available, ready) {
  if (!ready) return null
  if (!available) return 'todos'
  return normalizeFunnel(value)
}

// Pedaco de query string: "&funnel=vendas"
export function funnelQuery(v) {
  return `&funnel=${normalizeFunnel(v)}`
}

// Parametros de busca (para fetchLeads e afins)
export function funnelParams(v) {
  return { funnel: normalizeFunnel(v) }
}

const kindOf = f => (f && f.kind) || 'vendas'

// Lead bate com o filtro? (Chat: leads que chegam em tempo real). Pelo funil ATUAL do lead.
export function leadMatchesFunnel(lead, v, funnels) {
  const want = normalizeFunnel(v)
  if (want === 'todos') return true
  const f = (funnels || []).find(x => x.id === lead?.funnel_id)
  return kindOf(f) === want
}

// Etapas para o seletor de etapas: so as dos funis do filtro escolhido.
export function stagesForFunnel(funnels, v) {
  const want = normalizeFunnel(v)
  return (funnels || []).filter(f => want === 'todos' || kindOf(f) === want).flatMap(f => f.stages || [])
}

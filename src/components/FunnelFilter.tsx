import { useEffect, useState } from 'react'
import { fetchFunnels } from '../lib/api'
import { FUNNEL_OPTIONS, normalizeFunnel, effectiveFunnel, type FunnelValue } from '../lib/funnelFilter.js'

// Filtro de funil das telas (Vendas novas | Recompra | Todos) — spec 2026-10-05 filtro de funil.
// A escolha vale para todas as telas da conta (guardada no navegador, igual ao filtro de cidade).
// Conta sem funil Recompra: available = false, o seletor some e o valor efetivo e 'todos'.
const storageKey = (accountId: number) => `dros_funnel_filter_${accountId}`

// Valor = null enquanto carrega (a tela nao busca ainda, para nao pedir 'todos' e depois 'vendas').
export function useFunnelFilter(accountId: number | null | undefined): [FunnelValue | null, (v: FunnelValue) => void, boolean] {
  const [value, setValueState] = useState<FunnelValue>('vendas')
  const [available, setAvailable] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(false)
    setAvailable(false)
    if (!accountId) return
    let alive = true
    try { setValueState(normalizeFunnel(localStorage.getItem(storageKey(accountId)))) } catch { setValueState('vendas') }
    fetchFunnels(accountId)
      .then(fs => { if (alive) { setAvailable(fs.some(f => f.kind === 'recompra')); setReady(true) } })
      .catch(() => { if (alive) { setAvailable(false); setReady(true) } })
    return () => { alive = false }
  }, [accountId])
  const setValue = (v: FunnelValue) => {
    setValueState(v)
    if (!accountId) return
    try { localStorage.setItem(storageKey(accountId), v) } catch {}
  }
  return [effectiveFunnel(value, available, ready), setValue, available]
}

export default function FunnelFilter({ value, onChange, available }: { value: FunnelValue | null; onChange: (v: FunnelValue) => void; available: boolean }) {
  if (!available || !value) return null
  return (
    <div role="radiogroup" aria-label="Funil" style={{ display: 'inline-flex', gap: 4 }}>
      {FUNNEL_OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`btn btn-sm ${value === o.value ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onChange(o.value)}
          title={o.value === 'vendas' ? 'Leads novos e a 1ª compra de cada cliente' : o.value === 'recompra' ? 'Clientes que já compraram e as compras seguintes' : 'Vendas novas e recompra juntas'}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Aviso nas telas de custo: investimento/meta sao de venda nova, entao na Recompra aparecem como "—".
export function FunnelCostNotice({ funnel }: { funnel: FunnelValue | null }) {
  if (funnel !== 'recompra') return null
  return (
    <div className="text-muted" style={{ fontSize: 13, margin: '4px 0 12px' }}>
      Investimento é para venda nova: custo por lead, CAC, ROAS e meta aparecem como "—" na Recompra.
    </div>
  )
}

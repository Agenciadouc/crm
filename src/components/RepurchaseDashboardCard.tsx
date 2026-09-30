import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RotateCcw, ArrowRight } from 'lucide-react'
import {
  fetchCustomersOverview, fetchStaleStats, fetchRepurchaseStats, formatBRL, formatNumber,
  type CustomerOverview, type StaleStats, type RepurchaseStats,
} from '../lib/api'
import HelpTip from './HelpTip'

function monthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(now) }
}

// Quadro "Recompra" (spec LTV/Recompra §10.4): mora no Dashboard, no padrao de ConversionByBandCard.
// Nao renderiza nada se a conta ainda nao tem cliente (nenhuma venda com "pode recomprar" registrada).
export default function RepurchaseDashboardCard({ accountId }: { accountId: number }) {
  const [overview, setOverview] = useState<CustomerOverview | null>(null)
  const [stale, setStale] = useState<StaleStats | null>(null)
  const [rep, setRep] = useState<RepurchaseStats | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setError(false)
    const { from, to } = monthRange()
    Promise.all([
      fetchCustomersOverview(accountId),
      fetchStaleStats(accountId),
      fetchRepurchaseStats(accountId, { from, to }),
    ]).then(([o, s, r]) => { setOverview(o); setStale(s); setRep(r) }).catch(() => setError(true))
  }, [accountId])
  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <RotateCcw size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Recompra</h3>
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Não deu para carregar agora. <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Tentar de novo</button>
        </p>
      </div>
    )
  }

  // Ainda carregando, ou conta sem nenhum cliente: nada a mostrar (evita quadro vazio/enganoso)
  if (!overview || overview.clients === 0) return null

  const rate = rep && rep.contacted > 0 ? Math.round((rep.comprou / rep.contacted) * 100) : null

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <RotateCcw size={15} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Recompra</h3>
        <HelpTip title="Recompra" width={300}>
          Clientes atrasados na recompra, quantos voltaram a comprar depois do lembrete este mês e quantos já compraram 2 vezes ou mais.
        </HelpTip>
      </div>
      <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
        <div>
          <strong>{formatNumber(stale?.late.count || 0)}</strong> atrasado{(stale?.late.count || 0) === 1 ? '' : 's'} na recompra
          {stale && stale.late.count > 0 && <span style={{ color: 'var(--text-muted)' }}> · {formatBRL(stale.late.value)} parados</span>}
        </div>
        <div>
          Taxa de recompra do mês: <strong>{rate == null ? '—' : `${rate}%`}</strong>
          {rep && rep.contacted > 0 && <span style={{ color: 'var(--text-muted)' }}> ({rep.comprou} de {rep.contacted})</span>}
        </div>
        <div>
          <strong>{overview.repeatPct}%</strong> dos clientes já compraram 2 vezes ou mais
        </div>
        <div style={{ marginTop: 4 }}>
          <Link to="/clientes" className="btn btn-secondary btn-sm">Ver clientes <ArrowRight size={12} /></Link>
        </div>
      </div>
    </div>
  )
}

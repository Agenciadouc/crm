// Pagina "Projeção" — tabela tipo planilha de meta smart com hist + meses futuros projetados.
// Meses passados = dados reais do CRM. Meses futuros = projecao usando taxas medias historicas
// + investimento configurado pra o mes (editavel inline).
import { useEffect, useState } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import AccountSelector from '../components/AccountSelector'
import {
  fetchProjecao, updateMonthlyMetrics,
  type ProjecaoResponse, type ProjecaoRow,
} from '../lib/api'
import { TrendingUp, RefreshCw, Info } from 'lucide-react'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function labelMes(ym: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return ym
  return `${MESES[parseInt(m[2]) - 1]}/${m[1]}`
}
function fmtBRL(v: number | null | undefined) {
  if (v == null || v === 0) return '-'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtPct(v: number | null | undefined) {
  if (v == null) return '-'
  return `${v.toFixed(0)}%`
}
function fmtInt(v: number | null | undefined) {
  if (v == null || v === 0) return '-'
  return v.toLocaleString('pt-BR')
}
function fmtRoas(v: number | null | undefined) {
  if (v == null) return '-'
  return `${v.toFixed(1)}x`
}

export default function Projecao() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'gerente'
  const [past, setPast] = useState(3)
  const [future, setFuture] = useState(3)
  const [data, setData] = useState<ProjecaoResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    if (!accountId) return
    setLoading(true)
    fetchProjecao(accountId, past, future)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [accountId, past, future])

  if (!accountId) return <div className="empty-state"><h3>Selecione uma conta</h3></div>

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1><TrendingUp size={20} style={{ marginRight: 8, verticalAlign: -3 }} /> Projeção</h1>
          <AccountSelector />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#9B96B0' }}>Passado:
            <select value={past} onChange={e => setPast(parseInt(e.target.value))} className="select" style={{ marginLeft: 6, display: 'inline-block', width: 'auto' }}>
              {[3, 6, 12].map(n => <option key={n} value={n}>{n}m</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#9B96B0' }}>Futuro:
            <select value={future} onChange={e => setFuture(parseInt(e.target.value))} className="select" style={{ marginLeft: 6, display: 'inline-block', width: 'auto' }}>
              {[3, 6, 12].map(n => <option key={n} value={n}>{n}m</option>)}
            </select>
          </label>
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading} title="Recarregar" style={{ padding: '4px 8px' }}>
            <RefreshCw size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : !data ? (
        <div className="empty-state"><h3>Sem dados</h3></div>
      ) : (
        <>
          <div className="card" style={{ padding: 10, marginBottom: 12, background: 'rgba(93,173,226,0.05)', border: '1px solid rgba(93,173,226,0.2)', fontSize: 12, color: '#9B96B0', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Info size={14} style={{ color: '#5DADE2', flexShrink: 0, marginTop: 2 }} />
            <div>
              Meses passados mostram <strong>dados reais</strong>. Meses futuros sao <strong>projecao</strong>
              {data.assumptions.months_used_for_avg > 0
                ? ` usando media de ${data.assumptions.months_used_for_avg} mes(es) historicos: ${data.assumptions.avg_qualified_rate.toFixed(0)}% qualif., ${data.assumptions.avg_meeting_rate.toFixed(0)}% reun., ${data.assumptions.avg_won_rate.toFixed(0)}% venda, CPL medio ${fmtBRL(data.assumptions.avg_cpl)}.`
                : ' com taxas padrao (sem historico suficiente): 20% qualif., 30% reun., 30% venda, CPL R$ 20.'}
              {canEdit && ' Pra editar investimento de mes futuro, va no Dashboard, navegue pro mes, clique "Configurar mes".'}
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="campaign-table" style={{ width: '100%', minWidth: 900 }}>
                <thead>
                  <tr>
                    <th>Mes</th>
                    <th style={{ textAlign: 'right' }}>Investim.</th>
                    <th style={{ textAlign: 'right' }}>Leads</th>
                    <th style={{ textAlign: 'right' }}>CPL</th>
                    <th style={{ textAlign: 'right' }}>Qualif.</th>
                    <th style={{ textAlign: 'right' }}>Reunioes</th>
                    <th style={{ textAlign: 'right' }}>Vendas</th>
                    <th style={{ textAlign: 'right' }}>Meta</th>
                    <th style={{ textAlign: 'right' }}>Ticket</th>
                    <th style={{ textAlign: 'right' }}>Faturam.</th>
                    <th style={{ textAlign: 'right' }}>CAC</th>
                    <th style={{ textAlign: 'right' }}>ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={r.year_month} style={{ background: r.projected ? 'rgba(155,89,182,0.06)' : undefined, opacity: r.projected ? 0.9 : 1 }}>
                      <td style={{ fontWeight: 600 }}>
                        {labelMes(r.year_month)}
                        {r.projected && <span style={{ marginLeft: 6, fontSize: 10, color: '#9B59B6', fontWeight: 500 }}>proj.</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(r.investment)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(r.total_leads)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(r.cpl)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {fmtInt(r.qualified)}
                        {r.qualified_rate != null && r.total_leads > 0 && <div style={{ fontSize: 10, color: '#6B6580' }}>{fmtPct(r.qualified_rate)}</div>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {fmtInt(r.meeting)}
                        {r.meeting_rate != null && r.qualified > 0 && <div style={{ fontSize: 10, color: '#6B6580' }}>{fmtPct(r.meeting_rate)}</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: r.won > 0 ? '#34C759' : undefined }}>
                        {fmtInt(r.won)}
                        {r.won_rate != null && r.meeting > 0 && <div style={{ fontSize: 10, color: '#6B6580', fontWeight: 400 }}>{fmtPct(r.won_rate)}</div>}
                      </td>
                      <td style={{ textAlign: 'right', color: '#FF6B8A' }}>{r.target || '-'}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(r.ticket)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, color: r.revenue > 0 ? '#34C759' : undefined }}>{fmtBRL(r.revenue)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtBRL(r.cac)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: r.roas != null && r.roas >= 3 ? '#34C759' : r.roas != null && r.roas < 1 ? '#FF6B6B' : undefined }}>{fmtRoas(r.roas)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 11, color: '#6B6580', marginTop: 10 }}>
            Vendas = leads que passaram por etapa marcada como Conversao. Qualificados = passaram por Qual./Reun./Conv. Reunioes = passaram por Reun./Conv.
            Faturamento = soma real de <em>value_estimated</em> das vendas ganhas, ou (vendas x ticket medio) como fallback.
          </div>
        </>
      )}
    </div>
  )
}

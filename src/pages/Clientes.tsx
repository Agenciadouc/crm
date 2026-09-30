import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { useSSE } from '../context/SSEContext'
import AccountSelector from '../components/AccountSelector'
import { useCityFilter } from '../components/CityFilter'
import MoreFilters from '../components/MoreFilters'
import HelpTip from '../components/HelpTip'
import { geoParams } from '../lib/geoFilter.js'
import {
  fetchCustomersOverview, fetchCustomersList, fetchRepurchaseStats, fetchStaleStats, createStaleTasks, fetchTiers, fetchUsers,
  formatBRL, formatNumber,
  type CustomerOverview, type CustomerRow, type CustomerTier, type RepurchaseStats, type StaleStats, type StaleBand, type User as UserType,
} from '../lib/api'
import {
  Crown, LayoutGrid, Users, RotateCcw, AlertTriangle, CheckSquare, Square, ArrowRight,
} from 'lucide-react'

// Tela Clientes (spec LTV/Recompra §10.2/§12): visao geral, lista filtravel, funil de recompra
// e clientes parados. 4 abas; todo mundo ve (vendedor so os seus, via scopeToAccount no backend).

type Aba = 'visao' | 'clientes' | 'recompra' | 'parados'
const TABS: { key: Aba; label: string; icon: typeof Users }[] = [
  { key: 'visao', label: 'Visão geral', icon: LayoutGrid },
  { key: 'clientes', label: 'Clientes', icon: Users },
  { key: 'recompra', label: 'Recompra', icon: RotateCcw },
  { key: 'parados', label: 'Parados', icon: AlertTriangle },
]

type PeriodKey = '30' | '90' | '365' | 'all'
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: '30', label: '30 dias', days: 30 },
  { key: '90', label: '90 dias', days: 90 },
  { key: '365', label: '12 meses', days: 365 },
  { key: 'all', label: 'Tudo', days: null },
]
function periodRange(period: PeriodKey): { from?: string; to?: string } {
  const p = PERIODS.find(x => x.key === period)
  if (!p || p.days == null) return {}
  const to = new Date()
  const from = new Date(to.getTime() - p.days * 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { from: fmt(from), to: fmt(to) }
}

const CURVE_COLOR: Record<string, string> = { A: '#34C759', B: '#5DADE2', C: '#FFB300', D: '#FF6B6B', '1a': '#9B59B6' }
const curveLabel = (c: string | null | undefined) => (c === '1a' ? '1ª compra' : c ? `Curva ${c}` : '—')
const curveColor = (c: string | null | undefined) => CURVE_COLOR[c || ''] || 'var(--text-muted)'
const fmtDateBR = (iso: string | null | undefined) => (iso ? new Date(iso + 'T12:00:00Z').toLocaleDateString('pt-BR') : '—')
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

const BAND_LABEL: Record<string, string> = { '30-60': '30–60 dias', '61-90': '61–90 dias', '91-180': '91–180 dias', '181+': '181+ dias' }
const BAND_ORDER = ['30-60', '61-90', '91-180', '181+']
const bandKey = (b: StaleBand) => `${b.band}|${b.curve || ''}|${b.tierId ?? ''}`

// Barra horizontal simples (funil, motivos, tentativas) — mesmo padrao das barras de
// "Funil por Etapa" do Dashboard: rotulo a esquerda, barra com valor dentro, % a direita.
function HBar({ label, value, max, pctLabel, color = 'var(--accent)' }: { label: string; value: number; max: number; pctLabel?: string; color?: string }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 4 : 0) : 0
  return (
    <div className="funnel-bar">
      <div className="funnel-bar-label">{label}</div>
      <div className="funnel-bar-track"><div className="funnel-bar-fill" style={{ width: `${width}%`, background: color }}>{value > 0 ? formatNumber(value) : ''}</div></div>
      <span className="funnel-bar-pct">{pctLabel ?? ''}</span>
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="empty-state" style={{ minHeight: 160 }}>
      <p style={{ maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>{children}</p>
    </div>
  )
}

export default function Clientes() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const navigate = useNavigate()
  const isManager = user?.role === 'gerente' || user?.role === 'super_admin'

  const [tab, setTab] = useState<Aba>('visao')
  const [period, setPeriod] = useState<PeriodKey>('all')
  const [attendantFilter, setAttendantFilter] = useState('')
  const [cityFilter, setCityFilter] = useCityFilter(accountId)
  const [users, setUsers] = useState<UserType[]>([])
  const [tiers, setTiers] = useState<CustomerTier[]>([])
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => { if (accountId && isManager) fetchUsers(accountId).then(setUsers).catch(() => {}) }, [accountId, isManager])
  useEffect(() => { if (accountId) fetchTiers(accountId).then(setTiers).catch(() => {}) }, [accountId, reloadTick])

  // Recarrega a aba aberta quando algo mudar (venda, desfecho, selo, config da curva...)
  useSSE('customers:updated', useCallback(() => setReloadTick(t => t + 1), []))

  const commonParams = useMemo(() => ({
    ...geoParams(cityFilter),
    ...(isManager && attendantFilter ? { attendant_id: attendantFilter } : {}),
  }), [cityFilter, isManager, attendantFilter])

  const tierName = (id: number | null | undefined) => tiers.find(t => t.id === id)

  // =============== Visao geral ===============
  const [overview, setOverview] = useState<CustomerOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  useEffect(() => {
    if (!accountId || tab !== 'visao') return
    setOverviewLoading(true)
    fetchCustomersOverview(accountId, { ...commonParams, ...periodRange(period) })
      .then(setOverview).catch(() => setOverview(null)).finally(() => setOverviewLoading(false))
  }, [accountId, tab, commonParams, period, reloadTick])

  // =============== Clientes (lista) ===============
  const [rows, setRows] = useState<CustomerRow[]>([])
  const [rowsTotal, setRowsTotal] = useState(0)
  const [rowsLoading, setRowsLoading] = useState(true)
  const [curveF, setCurveF] = useState('')
  const [tierF, setTierF] = useState('')
  const [lateF, setLateF] = useState(false)
  const [optOutF, setOptOutF] = useState(false)
  const [order, setOrder] = useState<'ltv' | 'last_purchase'>('ltv')
  const [listPage, setListPage] = useState(1)
  const LIST_LIMIT = 50
  useEffect(() => { setListPage(1) }, [curveF, tierF, lateF, optOutF, order, commonParams])
  useEffect(() => {
    if (!accountId || tab !== 'clientes') return
    setRowsLoading(true)
    fetchCustomersList(accountId, {
      ...commonParams,
      curve: curveF || undefined, tier_id: tierF || undefined, late: lateF ? '1' : undefined, opt_out: optOutF ? '1' : undefined,
      order, limit: LIST_LIMIT, offset: (listPage - 1) * LIST_LIMIT,
    }).then(d => { setRows(d.rows); setRowsTotal(d.total) }).catch(() => { setRows([]); setRowsTotal(0) }).finally(() => setRowsLoading(false))
  }, [accountId, tab, commonParams, curveF, tierF, lateF, optOutF, order, listPage, reloadTick])

  const statusLabel = (row: CustomerRow) => {
    if (optOutF) return 'Não quer mais'
    if (!row.cycle_status) return '—'
    if (row.cycle_status === 'aguardando') return row.exhausted ? 'Tentativas esgotadas' : (row.remind_at ? `Próxima em ${fmtDateBR(row.remind_at)}` : 'Aguardando')
    if (row.cycle_status === 'a_contatar') return `A contatar (tent. ${row.attempt})`
    if (row.cycle_status === 'em_conversa') return `Em conversa (tent. ${row.attempt})`
    return row.cycle_status
  }

  // =============== Recompra ===============
  const [rep, setRep] = useState<RepurchaseStats | null>(null)
  const [repLoading, setRepLoading] = useState(true)
  useEffect(() => {
    if (!accountId || tab !== 'recompra') return
    setRepLoading(true)
    fetchRepurchaseStats(accountId, { ...commonParams, ...periodRange(period) })
      .then(setRep).catch(() => setRep(null)).finally(() => setRepLoading(false))
  }, [accountId, tab, commonParams, period, reloadTick])

  // =============== Parados ===============
  const [stale, setStale] = useState<StaleStats | null>(null)
  const [staleLoading, setStaleLoading] = useState(true)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [createdMsg, setCreatedMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!accountId || tab !== 'parados') return
    setStaleLoading(true)
    fetchStaleStats(accountId, commonParams)
      .then(d => { setStale(d); setSelectedKeys(new Set()); setCreatedMsg(null) }).catch(() => setStale(null)).finally(() => setStaleLoading(false))
  }, [accountId, tab, commonParams, reloadTick])

  const toggleBandRow = (b: StaleBand) => setSelectedKeys(prev => {
    const n = new Set(prev); const k = bandKey(b); n.has(k) ? n.delete(k) : n.add(k); return n
  })
  const toggleWholeBand = (bandName: string) => {
    if (!stale) return
    const keys = stale.bands.filter(b => b.band === bandName).map(bandKey)
    const allOn = keys.every(k => selectedKeys.has(k))
    setSelectedKeys(prev => {
      const n = new Set(prev)
      keys.forEach(k => (allOn ? n.delete(k) : n.add(k)))
      return n
    })
  }
  const selectedLeadIds = useMemo(() => {
    if (!stale) return [] as number[]
    const ids = new Set<number>()
    stale.bands.forEach(b => { if (selectedKeys.has(bandKey(b))) b.leadIds.forEach(id => ids.add(id)) })
    return [...ids]
  }, [stale, selectedKeys])
  const handleCreateTasks = async () => {
    if (!accountId || selectedLeadIds.length === 0) return
    setCreating(true)
    try {
      const r = await createStaleTasks(accountId, selectedLeadIds)
      setCreatedMsg(`${r.created} tarefa${r.created === 1 ? '' : 's'} criada${r.created === 1 ? '' : 's'}`)
      setSelectedKeys(new Set())
      const d = await fetchStaleStats(accountId, commonParams)
      setStale(d)
    } catch {} finally { setCreating(false) }
  }

  if (!accountId) return <div className="empty-state"><h3>Selecione uma conta</h3></div>

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1><Crown size={20} style={{ verticalAlign: -4, marginRight: 6 }} />Clientes</h1>
          <AccountSelector />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="date-selector">
            {PERIODS.map(p => <button key={p.key} className={`date-btn ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
          </div>
          {isManager && (
            <select className="select" value={attendantFilter} onChange={e => setAttendantFilter(e.target.value)} style={{ minWidth: 150 }}>
              <option value="">Todos atendentes</option>
              {users.filter(u => u.role === 'atendente' || u.role === 'gerente').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <MoreFilters accountId={accountId} city={cityFilter} onCityChange={setCityFilter} />
        </div>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 18, borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => {
          const active = tab === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              className="btn btn-sm"
              style={{ background: active ? 'var(--accent)' : 'transparent', color: active ? '#0A0118' : 'var(--text-secondary)', border: 'none', borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent', borderRadius: 0, fontWeight: 600 }}
              onClick={() => setTab(t.key)}
            >
              <Icon size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> {t.label}
            </button>
          )
        })}
      </div>

      {/* ============ Visao geral ============ */}
      {tab === 'visao' && (
        overviewLoading && !overview ? <div className="loading-container"><div className="spinner" /></div> : (
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 14px', marginBottom: 18, lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text-primary)' }}>Curva A</strong> = compra a cada até 30 dias (configurável em Configurações). Ex.: quem compra a cada 20 dias é A; se parar 50 dias, vira C até comprar de novo.
            </div>

            {!overview || overview.clients === 0 ? (
              <EmptyNote>Nenhum cliente com compra ainda. Ao registrar uma venda para um lead (na ficha ou no Pipeline), ele vira cliente aqui e passa a contar no LTV, na curva e no selo.</EmptyNote>
            ) : (
              <>
                <div className="metrics-grid" style={{ marginBottom: 20 }}>
                  <div className="metric-card">
                    <div className="metric-header"><span className="metric-label">LTV médio</span></div>
                    <div className="metric-value">{formatBRL(overview.ltvAvg)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-header"><span className="metric-label">Ticket médio</span></div>
                    <div className="metric-value">{formatBRL(overview.ticketAvg)}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-header"><span className="metric-label">Compras por cliente</span></div>
                    <div className="metric-value">{overview.purchasesAvg.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</div>
                  </div>
                  <div className="metric-card">
                    <div className="metric-header"><span className="metric-label">% que recompraram</span></div>
                    <div className="metric-value">{overview.repeatPct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</div>
                  </div>
                </div>

                <div className="charts-grid" style={{ marginBottom: 20 }}>
                  <div className="chart-card">
                    <h3>Tempo real de recompra <HelpTip title="Tempo real de recompra">Compara o prazo que você marca ao vender (ex.: "volta em 30 dias") com o prazo real observado nos clientes que já voltaram a comprar.</HelpTip></h3>
                    {overview.repurchase.cases === 0 ? (
                      <EmptyNote>Nenhuma venda com recompra ainda. Ao registrar uma venda, marque "Pode recomprar".</EmptyNote>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}>
                          Marcaram <strong>{overview.repurchase.markedDays ?? '—'}</strong> dias; os clientes voltam em <strong>{overview.repurchase.medianDays ?? '—'}</strong> dias.
                        </div>
                        {overview.repurchase.suggestion != null && (
                          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)' }}>
                            Sugestão: marcar {overview.repurchase.suggestion} dias no lembrete de recompra (ajuste em Configurações).
                          </div>
                        )}
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>Baseado em {overview.repurchase.cases} recompra{overview.repurchase.cases === 1 ? '' : 's'} concluída{overview.repurchase.cases === 1 ? '' : 's'}.</div>
                      </>
                    )}
                  </div>

                  <div className="chart-card">
                    <h3>Distribuição por curva</h3>
                    {(['A', 'B', 'C', 'D', '1a'] as const).map(c => {
                      const d = overview.byCurve[c] || { count: 0, ltv: 0 }
                      const max = Math.max(...Object.values(overview.byCurve).map(x => x.count), 1)
                      return <HBar key={c} label={curveLabel(c)} value={d.count} max={max} color={curveColor(c)} pctLabel={d.count > 0 ? formatBRL(d.ltv) : ''} />
                    })}
                  </div>
                </div>

                {overview.byTier.length > 0 && (
                  <div className="chart-card full-width" style={{ marginBottom: 20 }}>
                    <h3>Distribuição por selo</h3>
                    {overview.byTier.map(t => {
                      const max = Math.max(...overview.byTier.map(x => x.count), 1)
                      return <HBar key={t.id} label={`${t.icon ? `${t.icon} ` : ''}${t.name}`} value={t.count} max={max} color={t.color} pctLabel={t.count > 0 ? formatBRL(t.ltv) : ''} />
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )
      )}

      {/* ============ Clientes ============ */}
      {tab === 'clientes' && (
        <div>
          <div className="filter-bar">
            <select className="select" value={curveF} onChange={e => setCurveF(e.target.value)}>
              <option value="">Todas curvas</option>
              <option value="A">Curva A</option>
              <option value="B">Curva B</option>
              <option value="C">Curva C</option>
              <option value="D">Curva D</option>
              <option value="1a">1ª compra</option>
            </select>
            <select className="select" value={tierF} onChange={e => setTierF(e.target.value)}>
              <option value="">Todos selos</option>
              {tiers.map(t => <option key={t.id} value={t.id}>{t.icon ? `${t.icon} ` : ''}{t.name}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={lateF} onChange={e => { setLateF(e.target.checked); if (e.target.checked) setOptOutF(false) }} style={{ accentColor: 'var(--accent)' }} /> Atrasado
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={optOutF} onChange={e => { setOptOutF(e.target.checked); if (e.target.checked) setLateF(false) }} style={{ accentColor: 'var(--accent)' }} /> Não quer mais
            </label>
            <select className="select" value={order} onChange={e => setOrder(e.target.value as 'ltv' | 'last_purchase')}>
              <option value="ltv">Ordenar por LTV</option>
              <option value="last_purchase">Ordenar por última compra</option>
            </select>
          </div>

          {rowsLoading && rows.length === 0 ? <div className="loading-container"><div className="spinner" /></div> : rows.length === 0 ? (
            <EmptyNote>Nenhum cliente encontrado com esses filtros. Ex.: tire o filtro "Atrasado" para ver todos os clientes, ou registre uma venda para um lead para ele aparecer aqui.</EmptyNote>
          ) : (
            <div className="table-card">
              <table>
                <thead><tr>
                  <th>Nome</th><th>Curva</th><th>Selo</th><th className="right">LTV</th><th className="right">Compras</th>
                  <th>Última compra</th><th>Próxima recompra/status</th><th>Atendente</th>
                </tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/chat?lead=${r.id}`)}>
                      <td className="name">{r.name || 'Sem nome'}</td>
                      <td><span style={{ color: curveColor(r.curve), fontWeight: 600 }}>{curveLabel(r.curve)}</span></td>
                      <td>{r.tier_name ? <span style={{ color: r.tier_color || undefined }}>{r.tier_icon ? `${r.tier_icon} ` : ''}{r.tier_name}</span> : '—'}</td>
                      <td className="right">{formatBRL(r.ltv)}</td>
                      <td className="right">{r.purchases}</td>
                      <td>{fmtDateBR(r.last_purchase_at)}</td>
                      <td>{statusLabel(r)}</td>
                      <td>{r.attendant_name || <span style={{ color: '#FF6B6B', fontSize: 11 }}>Sem atendente</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rowsTotal > LIST_LIMIT && (
                <div style={{ padding: 12, display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
                  <button className="btn btn-secondary btn-sm" disabled={listPage <= 1} onClick={() => setListPage(p => p - 1)}>Anterior</button>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 12px' }}>Página {listPage} de {Math.ceil(rowsTotal / LIST_LIMIT)} ({formatNumber(rowsTotal)})</span>
                  <button className="btn btn-secondary btn-sm" disabled={listPage >= Math.ceil(rowsTotal / LIST_LIMIT)} onClick={() => setListPage(p => p + 1)}>Próxima</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ Recompra ============ */}
      {tab === 'recompra' && (
        repLoading && !rep ? <div className="loading-container"><div className="spinner" /></div> : !rep || rep.contacted === 0 ? (
          <EmptyNote>Nenhuma venda com recompra ainda. Ao registrar uma venda, marque "Pode recomprar".</EmptyNote>
        ) : (
          <div>
            <div className="chart-card full-width" style={{ marginBottom: 20 }}>
              <h3>Funil de recompra <HelpTip title="Funil de recompra">Lembretes enviados/a enviar → quantos entraram em conversa → o desfecho: comprou, não comprou agora ou não quer mais.</HelpTip></h3>
              <HBar label="Lembretes" value={rep.contacted} max={rep.contacted} color="var(--accent)" pctLabel="100%" />
              <HBar label="Em conversa" value={rep.conversa} max={rep.contacted} color="#5DADE2" pctLabel={`${pct(rep.conversa, rep.contacted)}%`} />
              <HBar label="Comprou" value={rep.comprou} max={rep.contacted} color="#34C759" pctLabel={`${pct(rep.comprou, rep.contacted)}%`} />
              <HBar label="Não comprou agora" value={rep.naoAgora} max={rep.contacted} color="#FFB300" pctLabel={`${pct(rep.naoAgora, rep.contacted)}%`} />
              <HBar label="Não quer mais" value={rep.naoQuer} max={rep.contacted} color="#FF6B6B" pctLabel={`${pct(rep.naoQuer, rep.contacted)}%`} />
            </div>

            <div className="charts-grid" style={{ marginBottom: 20 }}>
              <div className="chart-card">
                <h3>Motivos — não comprou agora</h3>
                {rep.reasons.nao_agora.every(r => r.count === 0) ? <EmptyNote>Nenhum motivo registrado ainda. Ex.: ao marcar "Não comprou agora" num lead, escolha um motivo (preço, sem estoque...) para ele aparecer aqui.</EmptyNote> : (
                  rep.reasons.nao_agora.filter(r => r.count > 0).sort((a, b) => b.count - a.count).map(r => (
                    <HBar key={r.id} label={r.label} value={r.count} max={Math.max(...rep.reasons.nao_agora.map(x => x.count), 1)} color="#FFB300" />
                  ))
                )}
              </div>
              <div className="chart-card">
                <h3>Motivos — não quer mais</h3>
                {rep.reasons.nao_quer.every(r => r.count === 0) ? <EmptyNote>Nenhum motivo registrado ainda. Ex.: ao marcar "Não quer mais" num lead, escolha um motivo para ele aparecer aqui.</EmptyNote> : (
                  rep.reasons.nao_quer.filter(r => r.count > 0).sort((a, b) => b.count - a.count).map(r => (
                    <HBar key={r.id} label={r.label} value={r.count} max={Math.max(...rep.reasons.nao_quer.map(x => x.count), 1)} color="#FF6B6B" />
                  ))
                )}
              </div>
            </div>

            <div className="charts-grid" style={{ marginBottom: 20 }}>
              <div className="chart-card">
                <h3>Voltou a comprar em qual tentativa</h3>
                {(['1', '2', '3', '4+'] as const).map(k => (
                  <HBar key={k} label={`${k}ª tentativa`} value={rep.byAttempt[k]} max={Math.max(rep.byAttempt['1'], rep.byAttempt['2'], rep.byAttempt['3'], rep.byAttempt['4+'], 1)} color="#34C759" />
                ))}
              </div>
              <div className="chart-card">
                <h3>Recompra × venda cruzada</h3>
                <HBar label="Recompra" value={rep.byKind.recompra.comprou} max={Math.max(rep.byKind.recompra.total, rep.byKind.cruzada.total, 1)} color="var(--accent)" pctLabel={`${rep.byKind.recompra.comprou}/${rep.byKind.recompra.total}`} />
                <HBar label="Venda cruzada" value={rep.byKind.cruzada.comprou} max={Math.max(rep.byKind.recompra.total, rep.byKind.cruzada.total, 1)} color="#9B59B6" pctLabel={`${rep.byKind.cruzada.comprou}/${rep.byKind.cruzada.total}`} />
                {rep.byAuto.auto.total > 0 && (
                  <>
                    <h3 style={{ marginTop: 16 }}>Automático × manual</h3>
                    <HBar label="Automático" value={rep.byAuto.auto.comprou} max={Math.max(rep.byAuto.auto.total, rep.byAuto.manual.total, 1)} color="#5DADE2" pctLabel={`${rep.byAuto.auto.comprou}/${rep.byAuto.auto.total}`} />
                    <HBar label="Manual" value={rep.byAuto.manual.comprou} max={Math.max(rep.byAuto.auto.total, rep.byAuto.manual.total, 1)} color="#FFAA83" pctLabel={`${rep.byAuto.manual.comprou}/${rep.byAuto.manual.total}`} />
                  </>
                )}
              </div>
            </div>
          </div>
        )
      )}

      {/* ============ Parados ============ */}
      {tab === 'parados' && (
        staleLoading && !stale ? <div className="loading-container"><div className="spinner" /></div> : !stale || (stale.late.count === 0 && stale.bands.length === 0) ? (
          <EmptyNote>Nenhum cliente atrasado. Um cliente aparece aqui quando passa do prazo de recompra sem registrar nova venda. Ex.: cliente Curva A (recompra a cada 30 dias) que não comprou em 33 dias entra na lista.</EmptyNote>
        ) : (
          <div>
            <div className="metric-card" style={{ marginBottom: 20, maxWidth: 420 }}>
              <div className="metric-header">
                <span className="metric-label">Atrasados na recompra</span>
                <HelpTip title="Atrasados na recompra">Clientes que passaram do prazo esperado de recompra (3 dias após o lembrete) e ainda não voltaram a comprar, ou que esgotaram as tentativas.</HelpTip>
              </div>
              <div className="metric-value">{formatNumber(stale.late.count)} cliente{stale.late.count === 1 ? '' : 's'}</div>
              <div className="metric-sub">{formatBRL(stale.late.value)} parados</div>
            </div>

            {createdMsg && (
              <div style={{ fontSize: 12, color: 'var(--positive)', background: 'var(--positive-bg)', border: '1px solid var(--positive)', borderRadius: 8, padding: '8px 12px', marginBottom: 14 }}>{createdMsg}</div>
            )}

            {stale.bands.length > 0 && (
              <div className="table-card" style={{ marginBottom: 20 }}>
                <div className="table-header">
                  <h3>Faixa × curva × selo</h3>
                  <button className="btn btn-primary btn-sm" disabled={selectedLeadIds.length === 0 || creating} onClick={handleCreateTasks}>
                    {creating ? 'Criando...' : `Criar tarefas (${selectedLeadIds.length})`}
                  </button>
                </div>
                <table>
                  <thead><tr><th style={{ width: 32 }}></th><th>Faixa</th><th>Curva</th><th>Selo</th><th className="right">Clientes</th><th className="right">LTV parado</th></tr></thead>
                  <tbody>
                    {BAND_ORDER.filter(bn => stale.bands.some(b => b.band === bn)).map(bandName => {
                      const rowsInBand = stale.bands.filter(b => b.band === bandName)
                      const allOn = rowsInBand.every(b => selectedKeys.has(bandKey(b)))
                      return (
                        <Fragment key={bandName}>
                          <tr style={{ background: 'var(--bg-hover)' }}>
                            <td onClick={() => toggleWholeBand(bandName)} style={{ cursor: 'pointer' }}>
                              {allOn ? <CheckSquare size={14} style={{ color: 'var(--accent)' }} /> : <Square size={14} style={{ color: 'var(--text-muted)' }} />}
                            </td>
                            <td colSpan={5} style={{ fontWeight: 700, cursor: 'pointer' }} onClick={() => toggleWholeBand(bandName)}>
                              {BAND_LABEL[bandName] || bandName} — selecionar todos da faixa
                            </td>
                          </tr>
                          {rowsInBand.map(b => (
                            <tr key={bandKey(b)} style={{ cursor: 'pointer' }} onClick={() => toggleBandRow(b)}>
                              <td>{selectedKeys.has(bandKey(b)) ? <CheckSquare size={14} style={{ color: 'var(--accent)' }} /> : <Square size={14} style={{ color: 'var(--text-muted)' }} />}</td>
                              <td>{BAND_LABEL[b.band] || b.band}</td>
                              <td><span style={{ color: curveColor(b.curve) }}>{curveLabel(b.curve)}</span></td>
                              <td>{tierName(b.tierId)?.name || (b.tierId ? '—' : 'Sem selo')}</td>
                              <td className="right">{b.count}</td>
                              <td className="right">{formatBRL(b.ltv)}</td>
                            </tr>
                          ))}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {stale.late.rows.length > 0 && (
              <div className="table-card">
                <div className="table-header"><h3>Lista de atrasados</h3></div>
                <table>
                  <thead><tr><th>Nome</th><th>Curva</th><th className="right">LTV</th><th className="right">Compras</th><th>Última compra</th><th style={{ width: 32 }}></th></tr></thead>
                  <tbody>
                    {stale.late.rows.map(r => (
                      <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/chat?lead=${r.id}`)}>
                        <td className="name">{r.name || 'Sem nome'}</td>
                        <td><span style={{ color: curveColor(r.curve) }}>{curveLabel(r.curve)}</span></td>
                        <td className="right">{formatBRL(r.ltv)}</td>
                        <td className="right">{r.purchases}</td>
                        <td>{fmtDateBR(r.last_purchase_at)}</td>
                        <td style={{ textAlign: 'right' }}><ArrowRight size={12} style={{ color: 'var(--text-muted)' }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}
    </div>
  )
}

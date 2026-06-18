import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import {
  fetchAttendants, fetchAttendantDetail, fetchConversationInsights, triggerAnalysisNow,
  fetchOverviewV2, fetchRankingV2, fetchCriticalConversations, fetchAlerts,
  fetchCoaching, generateCoachingNow, fetchMarketIntel, fetchAnalyzeEstimate,
  resolveAlert,
  type AttendantMetrics, type AttendantDetail, type ConversationInsight,
  type OverviewV2, type RankingRowV2, type CriticalConversation,
  type AnalystAlert, type CoachingWeekly, type MarketIntel, type AnalyzeEstimate,
} from '../lib/api'
import {
  BarChart3, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, Award, Clock,
  Users, Eye, Bell, BookOpen, Globe, X, CheckCircle, MessageSquare,
} from 'lucide-react'
import ConversationDetailModal from '../components/ConversationDetailModal'

type TabKey = 'overview' | 'ranking' | 'critical' | 'coaching' | 'market' | 'alerts'

function formatSeconds(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${(s / 3600).toFixed(1)}h`
}

function score100Color(s: number | null): string {
  if (s == null) return 'var(--text-muted)'
  if (s >= 80) return 'var(--positive)'
  if (s >= 60) return 'var(--accent)'
  if (s >= 40) return 'var(--warning)'
  return 'var(--negative)'
}

function tempBadge(temp: string | null) {
  if (!temp) return null
  const map: Record<string, { color: string; label: string }> = {
    quente: { color: 'var(--negative)', label: '🔥 Quente' },
    morno: { color: 'var(--accent)', label: '☀️ Morno' },
    frio: { color: 'var(--info)', label: '❄️ Frio' },
  }
  const m = map[temp] || { color: 'var(--text-muted)', label: temp }
  return <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${m.color}20`, color: m.color, fontWeight: 600 }}>{m.label}</span>
}

function severityColor(s: string): string {
  if (s === 'critica') return 'var(--negative)'
  if (s === 'alta') return 'var(--warning)'
  return 'var(--accent)'
}

function formatBRL(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

// Modal de confirmação de custo
function AnalyzeNowConfirmModal({
  open, estimate, loading, onCancel, onConfirm, onResetAll, isSuperAdmin,
}: {
  open: boolean
  estimate: AnalyzeEstimate | null
  loading: boolean
  onCancel: () => void
  onConfirm: (maxLeads: number) => void
  onResetAll?: () => void
  isSuperAdmin?: boolean
}) {
  if (!open) return null
  const total = estimate?.leads_pending_total ?? 0
  const hasMore = total > (estimate?.leads_to_analyze ?? 0)
  const skipped = estimate?.leads_skipped ?? 0
  const incr = estimate?.leads_incremental ?? 0
  const full = estimate?.leads_full ?? 0
  const incrCost = estimate?.estimated_cost_incremental_usd ?? 0
  const fullCost = estimate?.estimated_cost_full_usd ?? 0
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onCancel}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 24, width: 520, maxWidth: '90vw', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>⚠ Confirmar análise IA</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        {loading || !estimate ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Calculando estimativa...</div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Conversas pendentes</span>
                <strong>{total} {total === 1 ? 'conversa' : 'conversas'}</strong>
              </div>
              {(incr > 0 || full > 0 || skipped > 0) && (
                <div style={{ display: 'grid', gap: 4, padding: '8px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 12 }}>
                  {full > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                      <span>• {full} análise{full > 1 ? 's' : ''} completa{full > 1 ? 's' : ''} <span style={{ opacity: 0.6 }}>(novas / re-baseline)</span></span>
                      <span>~${fullCost.toFixed(2)}</span>
                    </div>
                  )}
                  {incr > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}>
                      <span>• {incr} atualizaç{incr > 1 ? 'ões' : 'ão'} incremental{incr > 1 ? 'is' : ''} <span style={{ opacity: 0.6 }}>(só msgs novas)</span></span>
                      <span>~${incrCost.toFixed(2)}</span>
                    </div>
                  )}
                  {skipped > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)', opacity: 0.7 }}>
                      <span>• {skipped} já em dia (pulada{skipped > 1 ? 's' : ''})</span>
                      <span>$0.00</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Gasto este mês</span>
                <strong>${estimate.month_spent_usd.toFixed(2)} / ${estimate.month_limit_usd.toFixed(2)}</strong>
              </div>
            </div>

            {estimate.is_super_admin_bypass && (
              <div style={{ padding: 10, background: 'rgba(255,179,0,0.1)', borderLeft: '3px solid var(--warning)', fontSize: 12, color: 'var(--warning)', marginBottom: 16, borderRadius: 4 }}>
                ⚠ Conta não tem análise automática ativada. Esta execução manual vai consumir tokens do limite mesmo assim.
              </div>
            )}

            {total === 0 ? (
              <div style={{ padding: 10, background: 'rgba(0,150,255,0.1)', borderLeft: '3px solid var(--info)', fontSize: 12, color: 'var(--info)', marginBottom: 16, borderRadius: 4 }}>
                Nenhuma conversa nova pra analisar. Todas já estão atualizadas.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
                <button
                  className="btn-analyze-option"
                  onClick={() => onConfirm(Math.min(50, total))}
                  style={{
                    padding: 14, background: 'var(--bg-hover)', borderRadius: 6,
                    border: '1px solid var(--border-subtle)', cursor: 'pointer', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    color: 'var(--text-primary)',
                  }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Analisar {Math.min(50, total)} conversas{hasMore && ' (mais antigas/relevantes)'}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Tempo estimado: ~{Math.ceil(Math.min(50, total) * 2 / 60) + 1}min</div>
                  </div>
                  <strong style={{ color: 'var(--accent)' }}>~${Math.min(estimate.estimated_cost_usd, estimate.estimated_cost_all_usd).toFixed(2)}</strong>
                </button>

                {hasMore && (
                  <button
                    className="btn-analyze-option"
                    onClick={() => onConfirm(Math.min(500, total))}
                    style={{
                      padding: 14, background: 'var(--bg-hover)', borderRadius: 6,
                      border: '1px solid var(--accent)', cursor: 'pointer', textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      color: 'var(--text-primary)',
                    }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>Analisar todas ({Math.min(500, total)})</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        Tempo estimado: ~{Math.ceil(Math.min(500, total) * 2 / 60) + 1}min · Custo mais alto
                      </div>
                    </div>
                    <strong style={{ color: 'var(--accent)' }}>~${estimate.estimated_cost_all_usd.toFixed(2)}</strong>
                  </button>
                )}

                {total > 500 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 6 }}>
                    Limite por execução: 500. O restante roda no próximo clique ou no cron noturno.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              {isSuperAdmin && onResetAll ? (
                <button
                  className="btn btn-sm"
                  style={{ background: 'transparent', color: 'var(--danger, #f87171)', border: '1px solid var(--danger, #f87171)', fontSize: 11 }}
                  onClick={() => {
                    if (!confirm('Re-analisar TUDO do zero?\n\nIsso vai zerar os checkpoints incrementais da conta e reanalisar cada conversa como FULL no proximo batch — custo alto.')) return
                    if (!confirm('Confirma de novo? Operacao irreversivel.')) return
                    onResetAll()
                  }}
                  title="Super admin: zera last_message_id de toda a conta. Proximo batch trata tudo como FULL."
                >
                  ↻ Re-analisar tudo do zero
                </button>
              ) : <span />}
              <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function AttendantAnalytics() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('overview')
  const [days, setDays] = useState(30)
  const [analyzing, setAnalyzing] = useState(false)
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [estimate, setEstimate] = useState<AnalyzeEstimate | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)

  // Dados por tab
  const [overview, setOverview] = useState<OverviewV2 | null>(null)
  const [rankingV2, setRankingV2] = useState<RankingRowV2[]>([])
  const [attendantsV1, setAttendantsV1] = useState<AttendantMetrics[]>([])
  const [critical, setCritical] = useState<CriticalConversation[]>([])
  const [alerts, setAlerts] = useState<AnalystAlert[]>([])
  const [marketIntel, setMarketIntel] = useState<MarketIntel | null>(null)
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AttendantDetail | null>(null)
  const [coaching, setCoaching] = useState<CoachingWeekly[]>([])
  const [coachingUserId, setCoachingUserId] = useState<number | null>(null)
  const [coachingLoading, setCoachingLoading] = useState(false)
  const [generatingCoaching, setGeneratingCoaching] = useState(false)
  const [detailLeadId, setDetailLeadId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Modal de progresso "Analisando..."
  const [analyzeProgress, setAnalyzeProgress] = useState<{
    open: boolean
    status: 'running' | 'done' | 'error' | 'rate_limited'
    leadsCount: number
    message: string
    retryAfter?: number
  } | null>(null)
  const [analyzeElapsedSec, setAnalyzeElapsedSec] = useState(0)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Loaders por tab
  const loadOverview = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchOverviewV2(accountId, days).catch(() => null),
      fetchAttendants(accountId, days).catch(() => ({ days, attendants: [] as AttendantMetrics[] })),
    ]).then(([o, v1]) => {
      setOverview(o)
      setAttendantsV1(v1.attendants)
    }).finally(() => setLoading(false))
  }

  const loadRanking = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchRankingV2(accountId, days).catch(() => ({ days, attendants: [] as RankingRowV2[] })),
      fetchAttendants(accountId, days).catch(() => ({ days, attendants: [] as AttendantMetrics[] })),
    ]).then(([v2, v1]) => {
      setRankingV2(v2.attendants)
      setAttendantsV1(v1.attendants)
    }).finally(() => setLoading(false))
  }

  const loadCritical = () => {
    if (!accountId) return
    setLoading(true)
    fetchCriticalConversations(accountId, days, 50).then(setCritical).catch(() => setCritical([])).finally(() => setLoading(false))
  }

  const loadAlerts = () => {
    if (!accountId) return
    setLoading(true)
    fetchAlerts(accountId, 'open').then(setAlerts).catch(() => setAlerts([])).finally(() => setLoading(false))
  }

  const loadMarket = () => {
    if (!accountId) return
    setLoading(true)
    fetchMarketIntel(accountId, days).then(setMarketIntel).catch(() => setMarketIntel(null)).finally(() => setLoading(false))
  }

  const loadCoaching = (userId: number) => {
    if (!accountId || !userId) return
    setCoachingLoading(true)
    fetchCoaching(userId, accountId, 8).then(setCoaching).catch(() => setCoaching([])).finally(() => setCoachingLoading(false))
  }

  // Switch loader on tab/days
  useEffect(() => {
    if (!accountId) return
    if (tab === 'overview') loadOverview()
    else if (tab === 'ranking') loadRanking()
    else if (tab === 'critical') loadCritical()
    else if (tab === 'alerts') loadAlerts()
    else if (tab === 'market') loadMarket()
    else if (tab === 'coaching' && coachingUserId) loadCoaching(coachingUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, tab, days])

  // Quando troca o user do coaching
  useEffect(() => {
    if (tab === 'coaching' && coachingUserId) loadCoaching(coachingUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachingUserId])

  // Cronômetro do modal de análise
  useEffect(() => {
    if (!analyzeProgress || analyzeProgress.status !== 'running') return
    const id = setInterval(() => setAnalyzeElapsedSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [analyzeProgress])

  // Auto-dismiss do toast
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(id)
  }, [toast])

  // Pra coaching tab, precisa do ranking V2 carregado pro seletor
  useEffect(() => {
    if (tab === 'coaching' && rankingV2.length === 0 && accountId) {
      fetchRankingV2(accountId, days).then(r => {
        setRankingV2(r.attendants)
        if (r.attendants.length && !coachingUserId) setCoachingUserId(r.attendants[0].user_id)
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const toggleExpand = async (userId: number) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null)
      setDetail(null)
      return
    }
    setExpandedUserId(userId)
    try {
      const d = await fetchAttendantDetail(userId, accountId!, days)
      setDetail(d)
    } catch { setDetail(null) }
  }

  const handleAnalyzeNowClick = async () => {
    if (!accountId) return
    setShowConfirmModal(true)
    setEstimateLoading(true)
    try {
      const est = await fetchAnalyzeEstimate(accountId, Math.min(7, days))
      setEstimate(est)
    } catch (e: any) {
      setToast({ message: e?.message || 'Erro carregando estimativa', type: 'error' })
      setShowConfirmModal(false)
    } finally {
      setEstimateLoading(false)
    }
  }

  const handleConfirmAnalyze = async (maxLeads: number, opts: { resetAll?: boolean } = {}) => {
    if (!accountId || !estimate) return
    setAnalyzing(true)
    setShowConfirmModal(false)
    // Em reset_all, contagem real e desconhecida ate o batch rodar — mostra teto razoavel
    const leadsCount = opts.resetAll
      ? Math.min(maxLeads, (estimate.leads_skipped ?? 0) + estimate.leads_pending_total)
      : Math.min(maxLeads, estimate.leads_pending_total)
    setAnalyzeElapsedSec(0)
    setAnalyzeProgress({
      open: true,
      status: 'running',
      leadsCount,
      message: opts.resetAll ? 'Reset disparado — analisando tudo do zero...' : '',
    })
    try {
      const r = await triggerAnalysisNow(accountId, maxLeads, opts)
      if (r.ok) {
        // Backend disparou fire-and-forget. Mantém modal aberto com cronômetro.
        setAnalyzeProgress(p => p ? { ...p, message: r.message || '' } : null)
      } else if (r.retry_after_min) {
        setAnalyzeProgress({
          open: true,
          status: 'rate_limited',
          leadsCount,
          message: r.error || `Rate limit ativo.`,
          retryAfter: r.retry_after_min,
        })
      } else {
        setAnalyzeProgress({
          open: true,
          status: 'error',
          leadsCount,
          message: r.error || 'Erro ao iniciar análise',
        })
      }
    } catch (e: any) {
      setAnalyzeProgress({
        open: true,
        status: 'error',
        leadsCount,
        message: e?.message || 'Erro de rede',
      })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleRefreshAndClose = () => {
    setAnalyzeProgress(null)
    // Re-carrega tab ativa
    if (tab === 'overview') loadOverview()
    else if (tab === 'ranking') loadRanking()
    else if (tab === 'critical') loadCritical()
    else if (tab === 'alerts') loadAlerts()
    else if (tab === 'market') loadMarket()
  }

  const handleResolveAlert = async (id: number, status: 'resolved' | 'dismissed') => {
    if (!accountId) return
    try {
      await resolveAlert(id, accountId, status)
      setAlerts(prev => prev.filter(a => a.id !== id))
      setToast({ message: status === 'resolved' ? 'Alerta resolvido' : 'Alerta dispensado', type: 'success' })
    } catch (e: any) {
      setToast({ message: e?.message || 'Erro', type: 'error' })
    }
  }

  const handleGenerateCoaching = async (userId: number) => {
    if (!accountId || generatingCoaching) return
    setGeneratingCoaching(true)
    try {
      const r = await generateCoachingNow(userId, accountId)
      if (r.ok) {
        setToast({ message: 'Coaching sendo gerado em background. Atualizando em 30s...', type: 'info' })
        setTimeout(() => loadCoaching(userId), 30000)
      }
    } catch (e: any) {
      setToast({ message: e?.message || 'Erro', type: 'error' })
    } finally {
      setGeneratingCoaching(false)
    }
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

  const alertsCount = alerts.length
  const tabs: Array<{ key: TabKey; label: string; icon: any; badge?: number }> = [
    { key: 'overview', label: 'Visão Geral', icon: BarChart3 },
    { key: 'ranking', label: 'Ranking', icon: Award },
    { key: 'critical', label: 'Conversas Críticas', icon: AlertTriangle },
    { key: 'coaching', label: 'Coaching', icon: BookOpen },
    { key: 'market', label: 'Inteligência de Mercado', icon: Globe },
    { key: 'alerts', label: 'Alertas', icon: Bell, badge: alertsCount },
  ]

  return (
    <div>
      <div className="page-header">
        <h1><BarChart3 size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />Análise de Atendimentos</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="date-selector">
            {[7, 30, 90].map(d => (
              <button key={d} className={`date-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAnalyzeNowClick} disabled={analyzing}>
            <RefreshCw size={14} className={analyzing ? 'spinning' : ''} /> {analyzing ? 'Iniciando...' : 'Analisar agora'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border-subtle)', marginBottom: 16, overflowX: 'auto' }}>
        {tabs.map(t => {
          const Icon = t.icon
          const active = tab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: active ? 'var(--bg-card)' : 'none',
                border: 'none',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                padding: '10px 16px',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}>
              <Icon size={14} /> {t.label}
              {t.badge != null && t.badge > 0 && (
                <span style={{ background: 'var(--negative)', color: 'white', fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>
                  {t.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {loading && <div className="loading-container"><div className="spinner" /><span>Carregando...</span></div>}

      {/* ── TAB: Visão Geral ── */}
      {!loading && tab === 'overview' && (
        <section className="dash-section">
          <div className="metrics-grid">
            <OverviewCard label="Conversas analisadas" value={overview?.cards.conversas_analisadas ?? attendantsV1.reduce((s,a)=>s+a.leads_assigned,0)} sub={`em ${days}d`} icon={MessageSquare} color="var(--info)" />
            <OverviewCard label="Score comercial médio" value={overview?.cards.score_medio ?? '—'} sub="/ 100" icon={Award} color={score100Color(overview?.cards.score_medio ?? null)} />
            <OverviewCard label="% SLA <5min (humano)" value={overview?.cards.sla_humano_pct != null ? `${overview.cards.sla_humano_pct}%` : '—'} sub="resposta humana rápida" icon={Clock} color="var(--positive)" />
            <OverviewCard label="Leads quentes em risco" value={overview?.cards.leads_quentes_em_risco ?? 0} sub="sem resposta >24h" icon={AlertTriangle} color="var(--negative)" />
            <OverviewCard label="Vendas perdidas" value={overview?.cards.vendas_perdidas ?? 0} sub="detectadas pela IA" icon={TrendingUp} color="var(--negative)" />
            <OverviewCard label="Receita em risco" value={formatBRL(overview?.cards.receita_em_risco)} sub="leads quentes parados" icon={TrendingUp} color="var(--warning)" />
            <OverviewCard label="Erros críticos" value={overview?.cards.erros_criticos_count ?? 0} sub="alta gravidade" icon={AlertTriangle} color="var(--negative)" />
            <OverviewCard label="Próximas ações" value={overview?.cards.proximas_acoes_pendentes ?? 0} sub="alertas em aberto" icon={Bell} color="var(--accent)" />
            <OverviewCard label="Bot: taxa de resolução" value={overview?.cards.bot_taxa_resolucao != null ? `${overview.cards.bot_taxa_resolucao}%` : '—'} sub="respondeu corretamente" icon={CheckCircle} color="var(--info)" />
            <OverviewCard label="Follow-ups atrasados" value={overview?.cards.follow_ups_atrasados ?? 0} sub="cadências em atraso" icon={Clock} color="var(--warning)" />
          </div>
          {(!overview || overview.cards.conversas_analisadas === 0) && (
            <div style={{ marginTop: 16, padding: 16, background: 'var(--bg-hover)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
              Nenhuma análise V2 ainda nesta janela. Clique "Analisar agora" pra começar a popular os cards.
            </div>
          )}
        </section>
      )}

      {/* ── TAB: Ranking ── */}
      {!loading && tab === 'ranking' && (
        <section className="dash-section">
          <div className="section-title"><Award size={14} /> Ranking de Atendentes (V2 — score 0-100)</div>
          <div className="table-card" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 30 }}>#</th>
                  <th>Nome</th>
                  <th>Role</th>
                  <th className="right">Score</th>
                  <th className="right">Leads</th>
                  <th className="right">Conv%</th>
                  <th className="right">TTFR (h)</th>
                  <th className="right">TMR (h)</th>
                  <th className="right">SLA &lt;5m</th>
                  <th className="right">Quentes</th>
                  <th className="right">Idle 24h</th>
                  <th className="right">Perdas</th>
                  <th>Principal erro</th>
                  <th style={{ width: 30 }}></th>
                </tr>
              </thead>
              <tbody>
                {rankingV2.length === 0 && (
                  <tr><td colSpan={14} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Nenhuma análise V2 ainda.</td></tr>
                )}
                {rankingV2.map((a, idx) => {
                  const expanded = expandedUserId === a.user_id
                  return (
                    <>
                      <tr key={a.user_id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(a.user_id)}>
                        <td>{idx + 1}</td>
                        <td className="name">{a.user_name}</td>
                        <td><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: a.role === 'gerente' ? 'rgba(255,179,0,0.15)' : 'var(--bg-hover)', color: a.role === 'gerente' ? 'var(--accent)' : 'var(--text-muted)' }}>{a.role}</span></td>
                        <td className="right" style={{ fontWeight: 700, color: score100Color(a.score_v2) }}>{a.score_v2 ?? '—'}</td>
                        <td className="right">{a.leads_assigned}</td>
                        <td className="right">{a.conversion_pct != null ? `${a.conversion_pct}%` : '—'}</td>
                        <td className="right">{formatSeconds(a.ttfr_human)}</td>
                        <td className="right">{formatSeconds(a.tmr_human)}</td>
                        <td className="right">{a.sla_5min_pct != null ? `${a.sla_5min_pct}%` : '—'}</td>
                        <td className="right">{a.quentes}</td>
                        <td className="right" style={{ color: a.idle24 > 0 ? 'var(--warning)' : undefined }}>{a.idle24}</td>
                        <td className="right" style={{ color: a.lost_sales > 0 ? 'var(--negative)' : undefined }}>{a.lost_sales}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{a.principal_erro || '—'}</td>
                        <td>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                      </tr>
                      {expanded && detail && detail.user.id === a.user_id && (
                        <tr key={`${a.user_id}-d`}>
                          <td colSpan={14} style={{ background: 'var(--bg-hover)', padding: 16 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                              <div>
                                <strong style={{ fontSize: 13 }}>Top erros</strong>
                                {detail.top_errors.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhum ✓</p> : (
                                  <ul style={{ marginTop: 8, listStyle: 'none', padding: 0 }}>
                                    {detail.top_errors.slice(0, 5).map((e, i) => (
                                      <li key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between' }}>
                                        <span>{e.error}</span><strong style={{ color: 'var(--negative)' }}>{e.count}x</strong>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div>
                                <strong style={{ fontSize: 13 }}>Últimas conversas analisadas</strong>
                                <ul style={{ marginTop: 8, listStyle: 'none', padding: 0, maxHeight: 220, overflowY: 'auto' }}>
                                  {detail.recent_insights.slice(0, 6).map(ci => (
                                    <li key={ci.lead_id} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }} onClick={() => setDetailLeadId(ci.lead_id)}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <strong style={{ color: 'var(--accent)' }}>{ci.lead_name}</strong>
                                        <span style={{ color: score100Color((ci.attendant_score || 0) * 10) }}>{ci.attendant_score}/10</span>
                                      </div>
                                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{ci.summary}</div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── TAB: Conversas Críticas ── */}
      {!loading && tab === 'critical' && (
        <section className="dash-section">
          <div className="section-title"><AlertTriangle size={14} /> Conversas Críticas (prioridade alta/crítica)</div>
          {critical.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma conversa crítica detectada. ✓</div>
          ) : (
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th>Lead</th><th>Atendente</th><th>Temp.</th><th>Score</th><th>Prio</th>
                    <th>Resumo / erro crítico</th><th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {critical.map(c => (
                    <tr key={c.lead_id} style={{ cursor: 'pointer' }} onClick={() => setDetailLeadId(c.lead_id)}>
                      <td className="name">{c.lead_name}</td>
                      <td>{c.attendant_name || '—'}</td>
                      <td>{tempBadge(c.temperatura_lead)}</td>
                      <td style={{ fontWeight: 700, color: score100Color(c.conversation_score) }}>{c.conversation_score ?? '—'}</td>
                      <td><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${severityColor(c.prioridade_revisao || 'media')}20`, color: severityColor(c.prioridade_revisao || 'media'), fontWeight: 600 }}>{c.prioridade_revisao}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {c.erro_critico ? <span style={{ color: 'var(--negative)' }}>⚠ {c.erro_critico}</span> : c.summary}
                      </td>
                      <td><Eye size={14} style={{ color: 'var(--accent)' }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── TAB: Coaching ── */}
      {!loading && tab === 'coaching' && (
        <section className="dash-section">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Atendente:</label>
            <select value={coachingUserId || ''} onChange={e => setCoachingUserId(Number(e.target.value))} style={{ padding: '6px 10px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
              <option value="">— escolha —</option>
              {rankingV2.map(a => <option key={a.user_id} value={a.user_id}>{a.user_name} ({a.role})</option>)}
            </select>
            {coachingUserId && (
              <button className="btn btn-secondary btn-sm" onClick={() => handleGenerateCoaching(coachingUserId)} disabled={generatingCoaching}>
                <RefreshCw size={12} className={generatingCoaching ? 'spinning' : ''} /> Gerar novo coaching
              </button>
            )}
          </div>
          {coachingLoading ? <div className="loading-container"><div className="spinner" /></div> : null}
          {!coachingLoading && coachingUserId && coaching.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum coaching gerado ainda. Clique "Gerar novo coaching".</div>
          )}
          {coaching.map(w => (
            <div key={w.id} style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 16, marginBottom: 12, borderLeft: '3px solid var(--accent)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>Semana de {w.week_start}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Score médio: <strong style={{ color: score100Color(w.ai_score_avg_week) }}>{w.ai_score_avg_week != null ? Math.round(w.ai_score_avg_week) : '—'}</strong></span>
              </div>
              <p style={{ margin: '8px 0', fontSize: 13 }}>{w.summary}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12 }}>
                <div>
                  <strong style={{ color: 'var(--positive)', fontSize: 12 }}>✓ Pontos fortes</strong>
                  <ul style={{ paddingLeft: 18, marginTop: 6, fontSize: 12 }}>
                    {w.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
                <div>
                  <strong style={{ color: 'var(--warning)', fontSize: 12 }}>↑ A melhorar</strong>
                  <ul style={{ paddingLeft: 18, marginTop: 6, fontSize: 12 }}>
                    {w.improvements.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              </div>
              <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-hover)', borderRadius: 4, fontSize: 12 }}>
                <strong>Treino recomendado:</strong> {w.training_recommended}
              </div>
              {w.suggested_script && (
                <div style={{ marginTop: 8, padding: 10, background: 'var(--bg-hover)', borderRadius: 4, fontSize: 12, fontStyle: 'italic' }}>
                  <strong>Script sugerido:</strong> "{w.suggested_script}"
                </div>
              )}
              <div style={{ marginTop: 8, padding: 10, background: 'rgba(76, 175, 80, 0.1)', borderRadius: 4, fontSize: 12 }}>
                <strong style={{ color: 'var(--positive)' }}>🎯 Meta semana:</strong> {w.goal_next_week}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── TAB: Inteligência de Mercado ── */}
      {!loading && tab === 'market' && marketIntel && (
        <section className="dash-section">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
            <MarketBlock title="Top objeções" items={marketIntel.objecoes_top} color="var(--warning)" />
            <MarketBlock title="Motivos de perda" items={marketIntel.motivos_perda_top} color="var(--negative)" />
            <MarketBlock title="Riscos detectados" items={marketIntel.riscos_top} color="var(--accent)" />
          </div>
          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
            Baseado em {marketIntel.sample_size} conversas analisadas nos últimos {marketIntel.days} dias.
          </div>
        </section>
      )}

      {/* ── TAB: Alertas ── */}
      {!loading && tab === 'alerts' && (
        <section className="dash-section">
          <div className="section-title"><Bell size={14} /> Alertas operacionais ({alerts.length} abertos)</div>
          {alerts.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum alerta aberto. ✓</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {alerts.map(a => (
                <div key={a.id} style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 12, borderLeft: `3px solid ${severityColor(a.severity)}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${severityColor(a.severity)}20`, color: severityColor(a.severity), fontWeight: 600 }}>{a.severity}</span>
                        <strong>{a.title}</strong>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{a.description}</div>
                      {a.suggested_action && <div style={{ fontSize: 12, marginTop: 4 }}><strong>Sugestão:</strong> {a.suggested_action}</div>}
                      {a.lead_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Lead: <a href={`/crm/chat?lead_id=${a.lead_id}`} style={{ color: 'var(--accent)' }}>{a.lead_name}</a></div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleResolveAlert(a.id, 'dismissed')}>Dispensar</button>
                      <button className="btn btn-primary btn-sm" onClick={() => handleResolveAlert(a.id, 'resolved')}>Resolver</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <AnalyzeNowConfirmModal
        open={showConfirmModal}
        estimate={estimate}
        loading={estimateLoading}
        onCancel={() => { setShowConfirmModal(false); setEstimate(null) }}
        onConfirm={handleConfirmAnalyze}
        isSuperAdmin={user?.role === 'super_admin'}
        onResetAll={() => {
          // Reset-all: dispara analise com flag resetAll=true (zera checkpoints e trata tudo como FULL)
          handleConfirmAnalyze(500, { resetAll: true })
        }}
      />

      {analyzeProgress?.open && (
        <AnalyzeProgressModal
          status={analyzeProgress.status}
          leadsCount={analyzeProgress.leadsCount}
          message={analyzeProgress.message}
          retryAfter={analyzeProgress.retryAfter}
          elapsedSec={analyzeElapsedSec}
          onClose={() => setAnalyzeProgress(null)}
          onRefresh={handleRefreshAndClose}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          background: 'var(--bg-card)',
          borderLeft: `3px solid ${toast.type === 'success' ? 'var(--positive)' : toast.type === 'error' ? 'var(--negative)' : 'var(--info)'}`,
          borderRadius: 6, padding: '12px 16px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          fontSize: 13, maxWidth: 360,
          color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.message}
          <button onClick={() => setToast(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={14} /></button>
        </div>
      )}

      {detailLeadId != null && accountId && (
        <ConversationDetailModal leadId={detailLeadId} accountId={accountId} onClose={() => setDetailLeadId(null)} />
      )}
    </div>
  )
}

// ─── Modal "Analisando conversas..." ───
function AnalyzeProgressModal({
  status, leadsCount, message, retryAfter, elapsedSec, onClose, onRefresh,
}: {
  status: 'running' | 'done' | 'error' | 'rate_limited'
  leadsCount: number
  message: string
  retryAfter?: number
  elapsedSec: number
  onClose: () => void
  onRefresh: () => void
}) {
  // Estimativa ~2s por conversa + overhead
  const estimatedTotalSec = Math.max(60, leadsCount * 2 + 30)
  const progressPct = Math.min(95, Math.round((elapsedSec / estimatedTotalSec) * 100))
  const minutesElapsed = Math.floor(elapsedSec / 60)
  const secsElapsed = elapsedSec % 60
  const elapsedLabel = `${minutesElapsed}m ${secsElapsed.toString().padStart(2, '0')}s`
  const readyToRefresh = elapsedSec >= Math.min(120, estimatedTotalSec)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 8,
        padding: 28,
        width: 480,
        maxWidth: '92vw',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {status === 'running' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56,
                margin: '0 auto 12px',
                border: '3px solid var(--border-subtle)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Analisando conversas</h3>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                {leadsCount} {leadsCount === 1 ? 'conversa em análise' : 'conversas em análise'} via Claude Haiku
              </p>
            </div>

            {/* Barra de progresso estimado */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>Tempo decorrido</span>
                <strong style={{ color: 'var(--text-primary)' }}>{elapsedLabel}</strong>
              </div>
              <div style={{ height: 8, background: 'var(--bg-hover)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${progressPct}%`, height: '100%',
                  background: 'linear-gradient(90deg, var(--accent), var(--positive))',
                  transition: 'width 0.4s ease',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>
                Estimativa: ~{Math.ceil(estimatedTotalSec / 60)} min total · IA processando em background
              </div>
            </div>

            {/* Status steps */}
            <div style={{ background: 'var(--bg-hover)', borderRadius: 6, padding: 12, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
              <Step done label="Estimativa de custo calculada" />
              <Step done label="Lote de conversas selecionado" />
              <Step active={!readyToRefresh} done={readyToRefresh} label="Analisando conversas (Haiku)" />
              <Step active={readyToRefresh} label="Persistindo insights + alertas" muted={!readyToRefresh} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>
                Fechar e continuar em segundo plano
              </button>
              <button className="btn btn-primary btn-sm" onClick={onRefresh} disabled={!readyToRefresh}>
                {readyToRefresh ? 'Atualizar dashboard' : `Aguardando (${Math.max(0, Math.min(120, estimatedTotalSec) - elapsedSec)}s)`}
              </button>
            </div>
          </>
        )}

        {status === 'rate_limited' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>⏱️</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Rate limit ativo</h3>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Aguarde <strong>{retryAfter} min</strong> antes da próxima análise manual.
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                Limite: 1 análise on-demand a cada 30 min por conta.
              </p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Entendi</button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 8, color: 'var(--negative)' }}>⚠</div>
              <h3 style={{ margin: 0, fontSize: 16 }}>Erro ao iniciar análise</h3>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>{message}</p>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Fechar</button>
            </div>
          </>
        )}
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function Step({ done, active, muted, label }: { done?: boolean; active?: boolean; muted?: boolean; label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0',
      opacity: muted ? 0.4 : 1,
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: '50%',
        background: done ? 'var(--positive)' : active ? 'var(--accent)' : 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'white', fontSize: 10, fontWeight: 700,
      }}>
        {done ? '✓' : active ? '·' : ''}
      </span>
      <span>{label}</span>
    </div>
  )
}

// ─── Auxiliares ───

function OverviewCard({ label, value, sub, icon: Icon, color }: { label: string; value: any; sub: string; icon: any; color: string }) {
  return (
    <div className="metric-card">
      <div className="metric-header">
        <span className="metric-label">{label}</span>
        <div className="metric-icon" style={{ background: `${color}20`, color }}><Icon size={16} /></div>
      </div>
      <div className="metric-value" style={{ color }}>{value}</div>
      <div className="metric-sub">{sub}</div>
    </div>
  )
}

function MarketBlock({ title, items, color }: { title: string; items: Array<{ label: string; count: number }>; color: string }) {
  const max = items.length ? Math.max(...items.map(i => i.count)) : 1
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 6, padding: 12 }}>
      <strong style={{ fontSize: 13, color }}>{title}</strong>
      {items.length === 0 ? <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Nenhum dado ainda.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
          {items.map((it, i) => (
            <li key={i} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                <span style={{ textTransform: 'capitalize' }}>{it.label}</span>
                <strong>{it.count}</strong>
              </div>
              <div style={{ height: 4, background: 'var(--bg-hover)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(it.count / max) * 100}%`, height: '100%', background: color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import {
  fetchAttendants, fetchAttendantDetail, fetchConversationInsights, triggerAnalysisNow,
  type AttendantMetrics, type AttendantDetail, type ConversationInsight,
} from '../lib/api'
import { BarChart3, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, TrendingUp, Award, Clock, Users, Eye } from 'lucide-react'

function formatSeconds(s: number | null): string {
  if (s == null || !Number.isFinite(s)) return '—'
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}min`
  return `${(s / 3600).toFixed(1)}h`
}

function scoreColor(s: number | null): string {
  if (s == null) return 'var(--text-muted)'
  if (s >= 8) return 'var(--positive)'
  if (s >= 6) return 'var(--accent)'
  if (s >= 4) return 'var(--warning)'
  return 'var(--negative)'
}

function intentBadge(intent: string) {
  const map: Record<string, { color: string; label: string }> = {
    hot: { color: 'var(--negative)', label: '🔥 Quente' },
    warm: { color: 'var(--accent)', label: '☀️ Morno' },
    cold: { color: 'var(--info)', label: '❄️ Frio' },
    not_qualified: { color: 'var(--text-muted)', label: 'Não qualif.' },
  }
  const m = map[intent] || { color: 'var(--text-muted)', label: intent }
  return <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: `${m.color}20`, color: m.color, fontWeight: 600 }}>{m.label}</span>
}

export default function AttendantAnalytics() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(true)
  const [attendants, setAttendants] = useState<AttendantMetrics[]>([])
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AttendantDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [lostSales, setLostSales] = useState<ConversationInsight[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [filter, setFilter] = useState<'all' | 'lost_sales' | 'low_score' | 'errors'>('all')

  const load = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchAttendants(accountId, days).catch(() => ({ days, attendants: [] as AttendantMetrics[] })),
      fetchConversationInsights(accountId, { days, filter: 'lost_sales', limit: 10 }).catch(() => ({ insights: [] as ConversationInsight[] })),
    ]).then(([a, ls]) => {
      setAttendants(a.attendants)
      setLostSales(ls.insights)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [accountId, days])

  const toggleExpand = async (userId: number) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null)
      setDetail(null)
      return
    }
    setExpandedUserId(userId)
    setDetailLoading(true)
    try {
      const d = await fetchAttendantDetail(userId, accountId!, days)
      setDetail(d)
    } catch {
      setDetail(null)
    }
    setDetailLoading(false)
  }

  const handleAnalyzeNow = async () => {
    if (!accountId || analyzing) return
    setAnalyzing(true)
    try {
      const r = await triggerAnalysisNow(accountId)
      if (r.ok) {
        alert(r.message || 'Análise iniciada. Aguarde 2 minutos e atualize.')
      } else if (r.retry_after_min) {
        alert(`Aguarde ${r.retry_after_min}min antes de re-analisar (rate limit).`)
      } else {
        alert(r.error || 'Erro ao iniciar análise')
      }
    } catch (e: any) {
      alert('Erro: ' + (e?.message || ''))
    }
    setAnalyzing(false)
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

  // Métricas agregadas no topo
  const totalLeads = attendants.reduce((s, a) => s + a.leads_assigned, 0)
  const totalResponded = attendants.reduce((s, a) => s + a.leads_responded, 0)
  const totalConverted = attendants.reduce((s, a) => s + a.leads_converted, 0)
  const totalUnder5 = attendants.reduce((s, a) => s + a.leads_under_5min, 0)
  const pctUnder5 = totalLeads > 0 ? Math.round((totalUnder5 / totalLeads) * 100) : 0
  const scoresValid = attendants.filter(a => a.ai_score_avg != null)
  const avgScore = scoresValid.length > 0 ? scoresValid.reduce((s, a) => s + (a.ai_score_avg || 0), 0) / scoresValid.length : null
  const totalLostSales = attendants.reduce((s, a) => s + a.lost_sales_detected, 0)

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
          <button className="btn btn-primary btn-sm" onClick={handleAnalyzeNow} disabled={analyzing}>
            <RefreshCw size={14} className={analyzing ? 'spinning' : ''} /> {analyzing ? 'Iniciando...' : 'Analisar agora'}
          </button>
        </div>
      </div>

      {loading && <div className="loading-container"><div className="spinner" /><span>Carregando análise...</span></div>}

      {!loading && (
        <>
          {/* Cards topo */}
          <section className="dash-section">
            <div className="metrics-grid">
              <div className="metric-card">
                <div className="metric-header"><span className="metric-label">Leads atendidos</span><div className="metric-icon" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}><Users size={16} /></div></div>
                <div className="metric-value">{totalLeads}</div>
                <div className="metric-sub">{totalResponded} responderam</div>
              </div>
              <div className="metric-card">
                <div className="metric-header"><span className="metric-label">% em &lt;5min</span><div className="metric-icon" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}><Clock size={16} /></div></div>
                <div className="metric-value">{pctUnder5}%</div>
                <div className="metric-sub">{totalUnder5} de {totalLeads} leads</div>
              </div>
              <div className="metric-card">
                <div className="metric-header"><span className="metric-label">Score IA médio</span><div className="metric-icon" style={{ background: 'rgba(255,179,0,0.15)', color: 'var(--accent)' }}><Award size={16} /></div></div>
                <div className="metric-value" style={{ color: scoreColor(avgScore) }}>{avgScore != null ? avgScore.toFixed(1) : '—'}<span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/10</span></div>
                <div className="metric-sub">{scoresValid.length} atendentes analisados</div>
              </div>
              <div className="metric-card">
                <div className="metric-header"><span className="metric-label">Vendas perdidas</span><div className="metric-icon" style={{ background: 'var(--negative-bg)', color: 'var(--negative)' }}><AlertTriangle size={16} /></div></div>
                <div className="metric-value">{totalLostSales}</div>
                <div className="metric-sub">detectadas pela IA</div>
              </div>
              <div className="metric-card">
                <div className="metric-header"><span className="metric-label">Conversões</span><div className="metric-icon" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}><TrendingUp size={16} /></div></div>
                <div className="metric-value">{totalConverted}</div>
                <div className="metric-sub">{totalLeads > 0 ? ((totalConverted / totalLeads) * 100).toFixed(1) : 0}% do total</div>
              </div>
            </div>
          </section>

          {/* Ranking */}
          <section className="dash-section">
            <div className="section-title"><Award size={14} /> Ranking de Atendentes</div>
            <div className="table-card">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 30 }}>#</th>
                    <th>Nome</th>
                    <th>Role</th>
                    <th className="right">Score IA</th>
                    <th className="right">Leads</th>
                    <th className="right">TTFR</th>
                    <th className="right">TMR</th>
                    <th className="right">&lt;5min</th>
                    <th className="right">Conv.</th>
                    <th className="right">Perdidas</th>
                    <th className="right">Abandon.</th>
                    <th style={{ width: 30 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {attendants.length === 0 && (
                    <tr><td colSpan={12} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                      Nenhuma análise ainda. Clica "Analisar agora" pra começar.
                    </td></tr>
                  )}
                  {attendants.map((a, idx) => {
                    const expanded = expandedUserId === a.user_id
                    return (
                      <>
                        <tr key={a.user_id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(a.user_id)}>
                          <td>{idx + 1}</td>
                          <td className="name">{a.user_name}</td>
                          <td><span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: a.role === 'gerente' ? 'rgba(255,179,0,0.15)' : 'var(--bg-hover)', color: a.role === 'gerente' ? 'var(--accent)' : 'var(--text-muted)' }}>{a.role}</span></td>
                          <td className="right" style={{ fontWeight: 700, color: scoreColor(a.ai_score_avg) }}>{a.ai_score_avg != null ? a.ai_score_avg.toFixed(1) : '—'}</td>
                          <td className="right">{a.leads_assigned}</td>
                          <td className="right">{formatSeconds(a.ttfr_avg_seconds)}</td>
                          <td className="right">{formatSeconds(a.tmr_avg_seconds)}</td>
                          <td className="right">{a.leads_under_5min}</td>
                          <td className="right">{a.leads_converted}</td>
                          <td className="right" style={{ color: a.lost_sales_detected > 0 ? 'var(--negative)' : undefined }}>{a.lost_sales_detected}</td>
                          <td className="right" style={{ color: a.abandoned_leads > 0 ? 'var(--warning)' : undefined }}>{a.abandoned_leads}</td>
                          <td>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                        </tr>
                        {expanded && (
                          <tr key={`${a.user_id}-detail`}>
                            <td colSpan={12} style={{ background: 'var(--bg-hover)', padding: 16 }}>
                              {detailLoading && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Carregando detalhes...</div>}
                              {!detailLoading && detail && detail.user.id === a.user_id && (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                  {/* Top erros */}
                                  <div>
                                    <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Top erros detectados pela IA</strong>
                                    {detail.top_errors.length === 0 ? (
                                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Nenhum erro registrado ✓</p>
                                    ) : (
                                      <ul style={{ marginTop: 8, marginLeft: 0, listStyle: 'none' }}>
                                        {detail.top_errors.slice(0, 5).map((e, i) => (
                                          <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>
                                            <span>{e.error}</span>
                                            <strong style={{ color: 'var(--negative)' }}>{e.count}x</strong>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  {/* Conversas recentes analisadas */}
                                  <div>
                                    <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>Últimas conversas analisadas</strong>
                                    {detail.recent_insights.length === 0 ? (
                                      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Nenhuma conversa analisada ainda.</p>
                                    ) : (
                                      <ul style={{ marginTop: 8, marginLeft: 0, listStyle: 'none', maxHeight: 220, overflowY: 'auto' }}>
                                        {detail.recent_insights.slice(0, 6).map(ci => (
                                          <li key={ci.lead_id} style={{ padding: '6px 0', fontSize: 12, borderBottom: '1px solid var(--border-subtle)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                                              <a href={`#/leads/${ci.lead_id}`} style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>{ci.lead_name}</a>
                                              <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(ci.attendant_score) }}>{ci.attendant_score}/10</span>
                                            </div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{ci.summary}</div>
                                            {ci.lost_sale_signals && (
                                              <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 2 }}>⚠️ {ci.lost_sale_signals}</div>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              )}
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

          {/* Vendas perdidas detectadas */}
          {lostSales.length > 0 && (
            <section className="dash-section">
              <div className="section-title" style={{ color: 'var(--negative)' }}><AlertTriangle size={14} /> Vendas perdidas detectadas</div>
              <div className="table-card">
                <table>
                  <thead><tr><th>Lead</th><th>Atendente</th><th>Sinal detectado</th><th>Sugestão IA</th><th style={{ width: 30 }}></th></tr></thead>
                  <tbody>
                    {lostSales.map(ci => (
                      <tr key={ci.id}>
                        <td className="name">{ci.lead_name}</td>
                        <td>{ci.attendant_name || '—'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ci.lost_sale_signals}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{ci.suggested_next_step}</td>
                        <td><a href={`/crm/chat?lead_id=${ci.lead_id}`} title="Abrir conversa"><Eye size={14} style={{ color: 'var(--accent)' }} /></a></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

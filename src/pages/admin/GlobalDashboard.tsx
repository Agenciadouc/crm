import { useState, useEffect } from 'react'
import { fetchGlobalDashboard, fetchAiUsageGlobal, formatNumber, type AiUsageData } from '../../lib/api'
import { Building2, Users, Calendar, Bot, Headphones, DollarSign } from 'lucide-react'

export default function GlobalDashboard() {
  const [data, setData] = useState<any>(null)
  const [aiUsage, setAiUsage] = useState<AiUsageData | null>(null)
  const [aiPeriod, setAiPeriod] = useState<number | undefined>(undefined) // undefined = mês corrente
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchGlobalDashboard().catch(() => null),
      fetchAiUsageGlobal(aiPeriod).catch(() => null),
    ]).then(([dash, ai]) => {
      setData(dash)
      setAiUsage(ai)
    }).finally(() => setLoading(false))
  }, [aiPeriod])

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!data) return <div className="empty-state"><h3>Sem dados</h3></div>

  return (
    <div>
      <div className="page-header"><h1>Dashboard Global</h1></div>

      <section className="dash-section">
        <div className="metrics-grid">
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Contas Ativas</span><div className="metric-icon" style={{ background: 'rgba(255,179,0,0.15)', color: 'var(--accent)' }}><Building2 size={16} /></div></div><div className="metric-value">{data.accounts.length}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Total Leads</span><div className="metric-icon" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}><Users size={16} /></div></div><div className="metric-value">{formatNumber(data.totalLeads)}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Leads Hoje</span><div className="metric-icon" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}><Calendar size={16} /></div></div><div className="metric-value">{formatNumber(data.leadsToday)}</div></div>
        </div>
      </section>

      <section className="dash-section">
        <div className="section-title">Contas</div>
        <div className="table-card"><table>
          <thead><tr><th>Cliente</th><th className="right">Total Leads</th><th className="right">Leads Hoje</th><th className="right">Atendentes</th></tr></thead>
          <tbody>
            {data.accounts.map((a: any) => (
              <tr key={a.id}><td className="name">{a.name}</td><td className="right" style={{ fontWeight: 600 }}>{formatNumber(a.total_leads)}</td><td className="right">{a.leads_today}</td><td className="right">{a.attendants}</td></tr>
            ))}
          </tbody>
        </table></div>
      </section>

      {/* ─── Uso de IA + STT (super_admin only) ─── */}
      {aiUsage && (
        <section className="dash-section">
          <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><Bot size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Uso de IA — {aiUsage.period}</span>
            <div className="date-selector">
              <button className={`date-btn ${aiPeriod === undefined ? 'active' : ''}`} onClick={() => setAiPeriod(undefined)}>Mês</button>
              <button className={`date-btn ${aiPeriod === 7 ? 'active' : ''}`} onClick={() => setAiPeriod(7)}>7d</button>
              <button className={`date-btn ${aiPeriod === 30 ? 'active' : ''}`} onClick={() => setAiPeriod(30)}>30d</button>
              <button className={`date-btn ${aiPeriod === 90 ? 'active' : ''}`} onClick={() => setAiPeriod(90)}>90d</button>
            </div>
          </div>

          <div className="metrics-grid" style={{ marginBottom: 16 }}>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Custo Total</span><div className="metric-icon" style={{ background: 'rgba(255,179,0,0.15)', color: 'var(--accent)' }}><DollarSign size={16} /></div></div>
              <div className="metric-value">US$ {(aiUsage.total.total_cost_usd || 0).toFixed(4)}</div>
              <div className="metric-sub">Haiku + Deepgram</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Tokens (Haiku)</span><div className="metric-icon" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}><Bot size={16} /></div></div>
              <div className="metric-value">{formatNumber(aiUsage.total.total_tokens || 0)}</div>
              <div className="metric-sub">US$ {(aiUsage.total.haiku_cost_usd || 0).toFixed(4)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Áudios Transcritos</span><div className="metric-icon" style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}><Headphones size={16} /></div></div>
              <div className="metric-value">{formatNumber(aiUsage.total.audio_count || 0)}</div>
              <div className="metric-sub">{(aiUsage.total.stt_seconds || 0).toFixed(0)}s · US$ {(aiUsage.total.stt_cost_usd || 0).toFixed(4)}</div>
            </div>
            <div className="metric-card">
              <div className="metric-header"><span className="metric-label">Mensagens Processadas</span><div className="metric-icon" style={{ background: 'var(--positive-bg)', color: 'var(--positive)' }}><Users size={16} /></div></div>
              <div className="metric-value">{formatNumber(aiUsage.total.message_count || 0)}</div>
            </div>
          </div>

          {aiUsage.byAccount.length > 0 && (
            <div className="table-card" style={{ marginBottom: 16 }}>
              <div className="table-header"><h3>Por conta</h3></div>
              <table>
                <thead><tr><th>Conta</th><th className="right">Msgs</th><th className="right">Tokens</th><th className="right">Áudios</th><th className="right">Custo Haiku</th><th className="right">Custo STT</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {aiUsage.byAccount.map(a => (
                    <tr key={a.id}>
                      <td className="name">{a.name}</td>
                      <td className="right">{formatNumber(a.message_count)}</td>
                      <td className="right">{formatNumber(a.total_tokens)}</td>
                      <td className="right">{a.audio_count}</td>
                      <td className="right">US$ {a.haiku_cost_usd.toFixed(4)}</td>
                      <td className="right">US$ {a.stt_cost_usd.toFixed(4)}</td>
                      <td className="right" style={{ fontWeight: 700, color: 'var(--accent)' }}>US$ {a.total_cost_usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {aiUsage.byAgent.length > 0 && (
            <div className="table-card">
              <div className="table-header"><h3>Por agente</h3></div>
              <table>
                <thead><tr><th>Agente</th><th>Conta</th><th className="right">Msgs</th><th className="right">Tokens</th><th className="right">Áudios</th><th className="right">Custo Haiku</th><th className="right">Custo STT</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {aiUsage.byAgent.map(ag => (
                    <tr key={ag.id}>
                      <td className="name">{ag.agent_name}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{ag.account_name}</td>
                      <td className="right">{formatNumber(ag.message_count)}</td>
                      <td className="right">{formatNumber(ag.total_tokens)}</td>
                      <td className="right">{ag.audio_count}</td>
                      <td className="right">US$ {ag.haiku_cost_usd.toFixed(4)}</td>
                      <td className="right">US$ {ag.stt_cost_usd.toFixed(4)}</td>
                      <td className="right" style={{ fontWeight: 700, color: 'var(--accent)' }}>US$ {ag.total_cost_usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {aiUsage.byAccount.length === 0 && (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <h3>Sem uso de IA no período</h3>
              <p>Nenhuma conta usou bot ou transcrição de áudio em {aiUsage.period}.</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

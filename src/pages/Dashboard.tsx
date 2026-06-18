import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import AccountSelector from '../components/AccountSelector'
import { fetchDashboardStats, fetchAgentStats, formatNumber, pctChange, type DashboardStats, type AgentStat } from '../lib/api'
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { Users, Target, TrendingUp, TrendingDown, Calendar, UserX, Zap } from 'lucide-react'

const DAYS_OPTIONS = [{ label: '7d', value: 7 }, { label: '14d', value: 14 }, { label: '30d', value: 30 }, { label: '90d', value: 90 }]
const COLORS = ['#FFB300', '#34C759', '#5DADE2', '#FF6B8A', '#9B59B6', '#FFAA83', '#EA4335', '#2ECC71']

function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#130A24', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: '#9B96B0', marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => <p key={p.name} style={{ color: p.color || '#fff', fontWeight: 600 }}>{p.name}: {p.value}</p>)}
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [loading, setLoading] = useState(true)
  const { accountId } = useAccount()

  useEffect(() => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchDashboardStats(accountId, days).catch(() => null),
      fetchAgentStats(accountId, days).catch(() => []),
    ]).then(([s, a]) => { setStats(s); setAgents(a as AgentStat[]) }).finally(() => setLoading(false))
  }, [accountId, days])

  if (!accountId) return <div className="empty-state"><h3>Selecione uma conta</h3></div>
  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!stats) return <div className="empty-state"><h3>Sem dados</h3></div>

  const ch = pctChange(stats.totalLeads, stats.prevTotalLeads)
  const dailyData = stats.daily.map(d => ({ day: d.date.slice(5), Leads: d.count }))
  const sourceData = stats.bySource.map((s, i) => ({ name: s.source, value: s.count, fill: COLORS[i % COLORS.length] }))

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1>Dashboard</h1>
          <AccountSelector />
        </div>
        <div className="date-selector">
          {DAYS_OPTIONS.map(o => <button key={o.value} className={`date-btn ${days === o.value ? 'active' : ''}`} onClick={() => setDays(o.value)}>{o.label}</button>)}
        </div>
      </div>

      {/* KPIs */}
      <section className="dash-section">
        <div className="metrics-grid">
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Total Leads</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><Users size={16} /></div></div>
            <div className="metric-value">{formatNumber(stats.totalLeads)}</div>
            <div className="metric-sub">{ch !== null && <span style={{ color: ch >= 0 ? '#34C759' : '#FF6B6B', fontSize: 11, fontWeight: 600 }}>{ch >= 0 ? '+' : ''}{ch.toFixed(1)}% vs anterior</span>}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Leads Hoje</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><Calendar size={16} /></div></div>
            <div className="metric-value">{formatNumber(stats.leadsToday)}</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Taxa Conversao</span><div className="metric-icon" style={{ background: '#5DADE220', color: '#5DADE2' }}><Target size={16} /></div></div>
            <div className="metric-value">{stats.conversionRate.toFixed(1)}%</div></div>
          <div className="metric-card"><div className="metric-header"><span className="metric-label">Sem Atendente</span><div className="metric-icon" style={{ background: stats.unassigned > 0 ? '#FF6B6B20' : '#34C75920', color: stats.unassigned > 0 ? '#FF6B6B' : '#34C759' }}><UserX size={16} /></div></div>
            <div className="metric-value">{stats.unassigned}</div>
            {stats.unassigned > 5 && <div className="metric-sub" style={{ color: '#FF6B6B' }}>Distribuir leads!</div>}</div>
        </div>
      </section>

      {/* Funnel by stage */}
      {stats.byStage.length > 0 && (
        <section className="dash-section">
          <div className="section-title">Funil por Etapa</div>
          <div className="card">
            {stats.byStage.map((s, i) => {
              const maxCount = Math.max(...stats.byStage.map(x => x.count), 1)
              const pct = (s.count / maxCount) * 100
              return (
                <div className="funnel-bar" key={s.id}>
                  <div className="funnel-bar-label">{s.name}</div>
                  <div className="funnel-bar-track"><div className="funnel-bar-fill" style={{ width: `${Math.max(pct, 5)}%`, background: s.color }}>{s.count}</div></div>
                  {s.is_conversion ? <span className="funnel-bar-pct" style={{ color: '#34C759' }}>Conv.</span> : <span className="funnel-bar-pct"></span>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Charts */}
      <section className="dash-section">
        <div className="charts-grid">
          {dailyData.length > 0 && (
            <div className="chart-card">
              <h3>Leads por Dia</h3>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={dailyData}>
                  <defs><linearGradient id="leadG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFB300" stopOpacity={0.3} /><stop offset="100%" stopColor="#FFB300" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" tick={{ fill: '#9B96B0', fontSize: 10 }} /><YAxis tick={{ fill: '#9B96B0', fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<Tip />} /><Area type="monotone" dataKey="Leads" stroke="#FFB300" fill="url(#leadG)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {sourceData.length > 0 && (
            <div className="chart-card">
              <h3>Leads por Fonte</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart><Pie data={sourceData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={35} paddingAngle={2}>
                  {sourceData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie><Tooltip content={<Tip />} /></PieChart>
              </ResponsiveContainer>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                {sourceData.map((s, i) => <span key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: s.fill, display: 'inline-block' }} />{s.name}: {s.value}</span>)}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Agent performance */}
      {agents.length > 0 && (
        <section className="dash-section">
          <div className="section-title">Performance Equipe</div>
          <div className="table-card">
            <table>
              <thead><tr><th>Atendente</th><th className="right">Leads (periodo)</th><th className="right">Leads (total)</th><th className="right">Conversoes</th><th className="right">Taxa Conv.</th></tr></thead>
              <tbody>
                {agents.map(a => (
                  <tr key={a.id}>
                    <td className="name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: a.is_active ? '#34C759' : '#9B96B0' }} />{a.name}</td>
                    <td className="right" style={{ fontWeight: 600, color: '#fff' }}>{a.leads_period}</td>
                    <td className="right">{a.leads_total}</td>
                    <td className="right" style={{ color: a.conversions > 0 ? '#34C759' : undefined }}>{a.conversions}</td>
                    <td className="right">{a.leads_period > 0 ? ((a.conversions / a.leads_period) * 100).toFixed(1) + '%' : '0%'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

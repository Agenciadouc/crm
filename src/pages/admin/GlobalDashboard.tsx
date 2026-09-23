import { useState, useEffect } from 'react'
import { fetchGlobalDashboard, fetchAiUsageGlobal, formatNumber, type AiUsageData, sendSystemNotice, clearSystemNotice, fetchSystemNotice, type SystemNotice } from '../../lib/api'
import { Building2, Users, Calendar, Bot, Headphones, DollarSign, Megaphone, X } from 'lucide-react'

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

  // ─── System Notice (aviso global pra todos) ───
  const [noticeModal, setNoticeModal] = useState(false)
  const [noticeTitle, setNoticeTitle] = useState('Atualização em andamento')
  const [noticeMessage, setNoticeMessage] = useState('Estamos fazendo uma atualização no CRM nesse momento. Pode ter uma instabilidade durante alguns minutos na conexão do WhatsApp mas já deve voltar ao normal.')
  const [noticeType, setNoticeType] = useState<'info' | 'warning' | 'success'>('warning')
  const [noticeDuration, setNoticeDuration] = useState(15)
  const [noticeSending, setNoticeSending] = useState(false)
  const [activeNotice, setActiveNotice] = useState<SystemNotice | null>(null)

  useEffect(() => {
    fetchSystemNotice().then(r => setActiveNotice(r.notice)).catch(() => {})
  }, [])

  const handleSendNotice = async () => {
    if (!noticeMessage.trim()) return
    setNoticeSending(true)
    try {
      const r = await sendSystemNotice({
        title: noticeTitle.trim() || undefined,
        message: noticeMessage.trim(),
        type: noticeType,
        durationMinutes: noticeDuration,
      })
      setActiveNotice(r.notice)
      setNoticeModal(false)
    } catch (e: any) {
      alert('Erro ao enviar aviso: ' + e.message)
    }
    setNoticeSending(false)
  }

  const handleClearNotice = async () => {
    if (!confirm('Cancelar o aviso agora?')) return
    try {
      await clearSystemNotice()
      setActiveNotice(null)
    } catch (e: any) {
      alert('Erro: ' + e.message)
    }
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!data) return <div className="empty-state"><h3>Sem dados</h3></div>

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1>Dashboard Global</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {activeNotice && (
            <button className="btn btn-secondary btn-sm" onClick={handleClearNotice} style={{ color: '#ef4444' }}>
              <X size={14} /> Cancelar aviso ativo
            </button>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => setNoticeModal(true)}>
            <Megaphone size={14} /> Disparar aviso global
          </button>
        </div>
      </div>

      {/* Modal: disparar aviso */}
      {noticeModal && (
        <div className="modal-overlay" onClick={() => !noticeSending && setNoticeModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Megaphone size={20} style={{ color: '#FFB300' }} />
              Disparar aviso global
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
              Vai aparecer como banner no topo pra <strong>todos os usuários logados</strong> em tempo real (e pra quem entrar depois, até expirar).
            </p>

            <div className="form-group">
              <label>Título (opcional)</label>
              <input className="input" value={noticeTitle} onChange={e => setNoticeTitle(e.target.value)} placeholder="Ex: Atualização em andamento" maxLength={100} />
            </div>

            <div className="form-group">
              <label>Mensagem *</label>
              <textarea className="input" value={noticeMessage} onChange={e => setNoticeMessage(e.target.value)} rows={3} maxLength={500} style={{ resize: 'vertical', minHeight: 60 }} />
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{noticeMessage.length}/500</div>
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Tipo</label>
                <select className="select" value={noticeType} onChange={e => setNoticeType(e.target.value as any)}>
                  <option value="info">🔵 Info (azul)</option>
                  <option value="warning">🟡 Alerta (amarelo)</option>
                  <option value="success">🟢 Sucesso (verde)</option>
                </select>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Duração (min)</label>
                <input className="input" type="number" min={1} max={1440} value={noticeDuration} onChange={e => setNoticeDuration(Math.max(1, Math.min(1440, Number(e.target.value) || 5)))} />
              </div>
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setNoticeModal(false)} disabled={noticeSending}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSendNotice} disabled={noticeSending || !noticeMessage.trim()}>
                {noticeSending ? 'Enviando...' : <><Megaphone size={12} /> Disparar agora</>}
              </button>
            </div>
          </div>
        </div>
      )}

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

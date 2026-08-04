// Painel Funil Mensal + ROAS.
// Mostra cascata Leads -> Qualificados -> Reunioes -> Vendas do mes selecionado,
// mais cards de CPL/CAC/ROAS/Faturamento/Meta. Editor inline pra configurar
// investimento/meta/ticket do mes (super_admin e gerente).
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchFunilMensal, updateMonthlyMetrics, type FunilMensal,
} from '../lib/api'
import { Settings, ChevronLeft, ChevronRight, DollarSign, Target, TrendingUp, AlertTriangle, X } from 'lucide-react'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function currentYearMonth() {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function labelMes(ym: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return ym
  return `${MESES[parseInt(m[2]) - 1]}/${m[1].slice(2)}`
}
function shiftMonth(ym: string, delta: number) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return ym
  const d = new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
function fmtBRL(v: number | null | undefined) {
  if (v == null) return '-'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 2 })
}
function fmtPct(v: number | null | undefined, digits = 1) {
  if (v == null) return '-'
  return `${v.toFixed(digits)}%`
}
function fmtInt(v: number | null | undefined) {
  if (v == null) return '-'
  return v.toLocaleString('pt-BR')
}

interface Props { accountId: number }

export default function FunilMensalPanel({ accountId }: Props) {
  const { user } = useAuth()
  const canEdit = user?.role === 'super_admin' || user?.role === 'gerente'
  const [month, setMonth] = useState(currentYearMonth())
  const [data, setData] = useState<FunilMensal | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = () => {
    setLoading(true)
    fetchFunilMensal(accountId, month)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [accountId, month])

  if (loading) return <section className="dash-section"><div className="card" style={{ padding: 24, textAlign: 'center', color: '#6B6580' }}>Carregando funil...</div></section>
  if (!data) return null

  const c = data.cascade
  const cfg = data.config
  const calc = data.calc
  const missing = c.config_missing

  // Passos da cascata (labels + valores + taxas) — usado pra renderizar bars visualmente
  const steps = [
    { key: 'total',     label: 'Leads',        count: c.total,     rate: null,             color: '#5DADE2' },
    { key: 'qualified', label: 'Qualificados', count: c.qualified, rate: c.qualified_rate, color: '#FFB300' },
    { key: 'meeting',   label: 'Reunioes',     count: c.meeting,   rate: c.meeting_rate,   color: '#9B59B6' },
    { key: 'won',       label: 'Vendas',       count: c.won,       rate: c.won_rate,       color: '#34C759' },
  ]
  const maxCount = Math.max(...steps.map(s => s.count), 1)

  return (
    <section className="dash-section">
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>Funil & ROI Mensal</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" title="Mes anterior" onClick={() => setMonth(shiftMonth(month, -1))} style={{ padding: '4px 8px' }}><ChevronLeft size={12} /></button>
          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 72, textAlign: 'center' }}>{labelMes(month)}</span>
          <button className="btn btn-secondary btn-sm" title="Proximo mes" onClick={() => setMonth(shiftMonth(month, 1))} style={{ padding: '4px 8px' }}><ChevronRight size={12} /></button>
          {month !== currentYearMonth() && <button className="btn btn-secondary btn-sm" onClick={() => setMonth(currentYearMonth())} style={{ padding: '4px 8px', fontSize: 11 }}>Hoje</button>}
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} style={{ padding: '4px 10px' }}><Settings size={12} /> Configurar mes</button>}
        </div>
      </div>

      {/* Aviso de config faltando */}
      {(missing.qualified || missing.meeting) && (
        <div className="card" style={{ padding: 12, background: 'rgba(255,179,0,0.08)', border: '1px solid rgba(255,179,0,0.3)', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertTriangle size={14} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: '#c4a575' }}>
            Pra o funil calcular certo, va em <strong>Funis</strong> e marque quais etapas sao "Qualificado" e "Reuniao/Visita".
            {missing.qualified && ' Nenhuma etapa marcada como Qualificado.'}
            {missing.meeting && ' Nenhuma etapa marcada como Reuniao.'}
          </div>
        </div>
      )}

      {/* Cascata visual */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        {steps.map((s, i) => {
          const pct = (s.count / maxCount) * 100
          return (
            <div key={s.key} className="funnel-bar" style={{ marginBottom: i === steps.length - 1 ? 0 : 10 }}>
              <div className="funnel-bar-label" style={{ minWidth: 110 }}>{s.label}</div>
              <div className="funnel-bar-track" style={{ flex: 1 }}>
                <div className="funnel-bar-fill" style={{ width: `${Math.max(pct, 5)}%`, background: s.color }}>{fmtInt(s.count)}</div>
              </div>
              <span className="funnel-bar-pct" style={{ minWidth: 68, textAlign: 'right', color: s.rate != null ? '#9B96B0' : 'transparent' }}>
                {s.rate != null ? fmtPct(s.rate) : '-'}
              </span>
            </div>
          )
        })}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: '#6B6580' }}>
          Conversao geral (Lead {'->'} Venda): <strong style={{ color: '#34C759' }}>{fmtPct(c.overall_conversion)}</strong>
        </div>
      </div>

      {/* Cards de ROAS */}
      <div className="metrics-grid" style={{ marginBottom: 0 }}>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Investimento</span><div className="metric-icon" style={{ background: '#5DADE220', color: '#5DADE2' }}><DollarSign size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20 }}>{fmtBRL(cfg.ad_investment)}</div>
          {cfg.ad_investment === 0 && canEdit && <div className="metric-sub" style={{ color: '#FFB300', fontSize: 11 }}>Configure pra ver CAC e ROAS</div>}
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">CPL (custo/lead)</span><div className="metric-icon" style={{ background: '#FFB30020', color: '#FFB300' }}><Target size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20 }}>{fmtBRL(calc.cpl)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">CAC (custo/venda)</span><div className="metric-icon" style={{ background: '#9B59B620', color: '#9B59B6' }}><Target size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20 }}>{fmtBRL(calc.cac)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Faturamento</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><DollarSign size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20 }}>{fmtBRL(calc.estimated_revenue)}</div>
          {c.real_revenue > 0
            ? <div className="metric-sub" style={{ fontSize: 11, color: '#34C759' }}>Soma real de valores</div>
            : cfg.avg_ticket > 0 && c.won > 0
              ? <div className="metric-sub" style={{ fontSize: 11, color: '#6B6580' }}>Estimado (vendas x ticket)</div>
              : null}
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">ROAS</span><div className="metric-icon" style={{ background: '#34C75920', color: '#34C759' }}><TrendingUp size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20, color: calc.roas != null && calc.roas >= 3 ? '#34C759' : calc.roas != null && calc.roas < 1 ? '#FF6B6B' : undefined }}>
            {calc.roas != null ? `${calc.roas.toFixed(2)}x` : '-'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-header"><span className="metric-label">Meta de Vendas</span><div className="metric-icon" style={{ background: '#FF6B8A20', color: '#FF6B8A' }}><Target size={16} /></div></div>
          <div className="metric-value" style={{ fontSize: 20 }}>{c.won} / {cfg.sales_target || '-'}</div>
          {calc.target_progress != null && (
            <div className="metric-sub" style={{ fontSize: 11, color: calc.target_progress >= 100 ? '#34C759' : calc.target_progress >= 70 ? '#FFB300' : '#FF6B6B' }}>
              {calc.target_progress.toFixed(0)}% da meta {calc.target_remaining > 0 ? `(faltam ${calc.target_remaining})` : '(batida!)'}
            </div>
          )}
        </div>
      </div>

      {editing && canEdit && (
        <ConfigModal
          accountId={accountId}
          month={month}
          initial={cfg}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load() }}
        />
      )}
    </section>
  )
}

// ─── Modal de configuracao mensal ────────────────────────────────────────────
interface ConfigModalProps {
  accountId: number
  month: string
  initial: { ad_investment: number; sales_target: number; avg_ticket: number; notes: string }
  onClose: () => void
  onSaved: () => void
}
function ConfigModal({ accountId, month, initial, onClose, onSaved }: ConfigModalProps) {
  const [investment, setInvestment] = useState(String(initial.ad_investment || ''))
  const [target, setTarget] = useState(String(initial.sales_target || ''))
  const [ticket, setTicket] = useState(String(initial.avg_ticket || ''))
  const [notes, setNotes] = useState(initial.notes || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true); setErr(null)
    try {
      await updateMonthlyMetrics(accountId, month, {
        ad_investment: parseFloat(investment) || 0,
        sales_target: parseInt(target) || 0,
        avg_ticket: ticket ? parseFloat(ticket) : null,
        notes,
      })
      onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div className="modal-body" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card, #1a1030)', borderRadius: 10, padding: 20, minWidth: 380, maxWidth: 460, border: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Configurar {labelMes(month)}</h3>
          <button className="btn btn-secondary btn-sm" onClick={onClose} style={{ padding: 4 }}><X size={14} /></button>
        </div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Investimento em ads (R$)</label>
          <input className="input" type="number" min="0" step="0.01" value={investment} onChange={e => setInvestment(e.target.value)} placeholder="Ex: 2500" />
        </div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Meta de vendas (numero)</label>
          <input className="input" type="number" min="0" value={target} onChange={e => setTarget(e.target.value)} placeholder="Ex: 4" />
        </div>
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Ticket medio (R$) <span style={{ color: '#6B6580', fontWeight: 400 }}>opcional, sobrescreve o default da conta</span></label>
          <input className="input" type="number" min="0" step="0.01" value={ticket} onChange={e => setTicket(e.target.value)} placeholder="Ex: 20000" />
        </div>
        <div className="form-group" style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>Notas (opcional)</label>
          <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Ex: aumentei orcamento pra black friday" />
        </div>
        {err && <div style={{ color: '#FF6B6B', fontSize: 12, marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

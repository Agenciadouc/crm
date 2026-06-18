import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchAgents, deleteAgent, toggleAgentActive,
  type Agent,
} from '../lib/api'
import { Bot, Plus, Edit3, Trash2, Activity, AlertCircle, Power, PowerOff, X } from 'lucide-react'
import AgentEditorModal from '../components/AgentEditorModal'

export default function Agents() {
  const { accountId } = useAccount()
  const [agents, setAgents] = useState<Agent[]>([])
  const [featureEnabled, setFeatureEnabled] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(true)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<'new' | number | null>(null)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' } | null>(null)

  // Auto-dismiss do toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const load = () => {
    if (!accountId) return
    setLoading(true)
    fetchAgents(accountId)
      .then(d => { setAgents(d.agents); setFeatureEnabled(d.feature_enabled); setHasApiKey(d.has_api_key !== false) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [accountId])

  const handleDelete = async (a: Agent) => {
    if (!accountId) return
    if (!confirm(`Apagar agente "${a.name}"? Os leads atendidos por ele ficam com o histórico, mas o bot não responde mais.`)) return
    try { await deleteAgent(a.id, accountId); load() }
    catch (e: any) { alert('Erro: ' + (e?.message || '')) }
  }

  const handleToggle = async (a: Agent) => {
    if (!accountId || togglingId === a.id) return
    if (a.is_active) {
      if (!confirm(`Pausar "${a.name}"?\n\nO bot vai parar de responder mensagens. Quando você reativar, ele responde a última msg de cada lead que ficou pendente.`)) return
    }
    setTogglingId(a.id)
    try {
      const r = await toggleAgentActive(a.id, accountId)
      setAgents(prev => prev.map(x => x.id === a.id ? { ...x, is_active: r.is_active } : x))
      if (r.is_active === 1) {
        if (r.replay && r.replay.total > 0) {
          const skipped = r.replay.total - r.replay.will_replay
          const skipMsg = skipped > 0 ? ` ${skipped} ultrapassaram o limite (30/clique) e ficarão pro atendente.` : ''
          setToast({ type: 'info', message: `${a.name} reativado. Bot vai responder a última msg de ${r.replay.will_replay} leads pendentes em background.${skipMsg}` })
        } else {
          setToast({ type: 'success', message: `${a.name} reativado` })
        }
      } else {
        setToast({ type: 'success', message: `${a.name} pausado` })
      }
    } catch (e: any) {
      alert('Erro: ' + (e?.message || ''))
    } finally {
      setTogglingId(null)
    }
  }

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>

  return (
    <div>
      <div className="page-header">
        <h1><Bot size={22} style={{ verticalAlign: -4, marginRight: 6 }} />Agentes de IA</h1>
        {featureEnabled && (
          <button className="btn btn-primary" onClick={() => setEditingId('new')}>
            <Plus size={14} /> Novo Agente
          </button>
        )}
      </div>

      {featureEnabled && !hasApiKey && (
        <div className="card" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, marginBottom: 16, background: 'rgba(255,179,0,0.07)', border: '1px solid rgba(255,179,0,0.3)' }}>
          <AlertCircle size={20} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: '#FFCB45' }}>Falta cadastrar a API Anthropic.</strong> Os agentes de IA estão habilitados, mas <strong>não respondem</strong> até você cadastrar sua chave Anthropic em <strong>Integrações → Agentes de IA — API Anthropic</strong>. Toda a IA desta conta usa a sua própria conta Anthropic.
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : !featureEnabled ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)' }}>
          <AlertCircle size={36} style={{ color: '#FFB300', marginBottom: 12 }} />
          <h3 style={{ color: '#FFCB45', marginBottom: 8 }}>Recurso não incluído no seu plano</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
            Os Agentes de IA são uma feature premium que automatiza o atendimento de leads via WhatsApp usando Claude Haiku 4.5.
            Pra liberar pro seu cliente, fale com a equipe da agência (super admin).
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
            Configure agentes de IA pra atender leads automaticamente no WhatsApp. Cada agente tem persona/conhecimento próprios, decide quando transferir pra humano e respeita limite mensal de tokens.
          </p>

          {agents.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
              <Bot size={32} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p>Nenhum agente criado. Clica em <strong>+ Novo Agente</strong> pra começar.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 12 }}>
              {agents.map(a => {
                const pctTokens = a.monthly_token_limit > 0 ? Math.min(100, (a.tokens_used_this_month / a.monthly_token_limit) * 100) : 0
                const tokensColor = pctTokens >= 90 ? '#FF6B6B' : pctTokens >= 70 ? '#FBBC04' : '#34C759'
                return (
                  <div key={a.id} className="card" style={{ padding: 14, opacity: a.is_active ? 1 : 0.55 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Bot size={16} style={{ color: '#FFB300' }} />
                          <strong style={{ fontSize: 14 }}>{a.name}</strong>
                          {!a.is_active && (
                            <span style={{
                              fontSize: 10, padding: '2px 6px', borderRadius: 3,
                              background: 'rgba(255,107,107,0.15)', color: '#FF6B6B',
                              fontWeight: 700, letterSpacing: 0.4,
                            }}>⏸ PAUSADO</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          <Activity size={9} style={{ verticalAlign: -1 }} /> {a.activation_mode}
                          {' · '}{a.stages_count} etapa(s) · {a.instances_count} instância(s)
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm btn-icon"
                          style={{
                            background: a.is_active ? 'rgba(52,199,89,0.15)' : 'rgba(255,107,107,0.15)',
                            border: `1px solid ${a.is_active ? 'rgba(52,199,89,0.4)' : 'rgba(255,107,107,0.4)'}`,
                            color: a.is_active ? '#34C759' : '#FF6B6B',
                            cursor: togglingId === a.id ? 'wait' : 'pointer',
                            opacity: togglingId === a.id ? 0.6 : 1,
                          }}
                          title={a.is_active
                            ? 'Pausar bot (vai parar de responder)'
                            : 'Reativar bot (responde a última msg dos leads que mandaram durante a pausa)'}
                          onClick={() => handleToggle(a)}
                          disabled={togglingId === a.id}
                        >
                          {a.is_active ? <Power size={11} /> : <PowerOff size={11} />}
                        </button>
                        <button className="btn btn-secondary btn-sm btn-icon" onClick={() => setEditingId(a.id)} title="Editar"><Edit3 size={11} /></button>
                        <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(a)} title="Apagar"><Trash2 size={11} /></button>
                      </div>
                    </div>

                    {a.persona && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontStyle: 'italic' }}>
                        "{a.persona.substring(0, 80)}{a.persona.length > 80 ? '...' : ''}"
                      </div>
                    )}

                    {/* Token usage bar */}
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                        <span>Tokens este mês</span>
                        <span style={{ color: tokensColor }}>{a.tokens_used_this_month.toLocaleString()} / {a.monthly_token_limit.toLocaleString()}</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pctTokens}%`, background: tokensColor, transition: 'width 0.3s' }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {editingId !== null && featureEnabled && (
        <AgentEditorModal
          agentId={editingId}
          accountId={accountId}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); load() }}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          background: 'var(--bg-card)',
          borderLeft: `3px solid ${toast.type === 'success' ? '#34C759' : 'var(--info, #2196F3)'}`,
          borderRadius: 6, padding: '12px 16px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          fontSize: 13, maxWidth: 400,
          color: 'var(--text-primary)',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ flex: 1, lineHeight: 1.45 }}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', flexShrink: 0 }}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchFunnels, fetchUsers, apiFetch, fetchAppSettings, updateAppSetting, fetchAllInstancesAdmin, type Funnel, type User as UserType } from '../lib/api'
import { Settings as SettingsIcon, RotateCw, Users, Save, Check, Bell } from 'lucide-react'

interface DistRule { id?: number; funnel_id: number; type: 'round_robin' | 'manual'; active_attendants: number[] }

export default function SettingsPage() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [rules, setRules] = useState<Map<number, DistRule>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  // Super_admin: notifier instance global
  const isSuperAdmin = user?.role === 'super_admin'
  const [allInstances, setAllInstances] = useState<Array<{ id: number; instance_name: string; phone_number: string | null; status: string; account_name: string | null }>>([])
  const [notifierInstanceId, setNotifierInstanceId] = useState<string>('')
  const [savingNotifier, setSavingNotifier] = useState(false)

  useEffect(() => {
    if (!isSuperAdmin) return
    fetchAppSettings().then(s => setNotifierInstanceId(s.notifier_instance_id || '')).catch(() => {})
    fetchAllInstancesAdmin().then(setAllInstances).catch(() => {})
  }, [isSuperAdmin])

  useEffect(() => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchFunnels(accountId),
      fetchUsers(accountId),
      apiFetch<{ rules: any[] }>(`/api/settings/distribution?account_id=${accountId}`).catch(() => ({ rules: [] })),
    ]).then(([f, u, r]) => {
      setFunnels(f); setUsers(u)
      const ruleMap = new Map<number, DistRule>()
      for (const rule of (r.rules || [])) {
        ruleMap.set(rule.funnel_id, {
          id: rule.id, funnel_id: rule.funnel_id, type: rule.type,
          active_attendants: rule.active_attendants ? JSON.parse(rule.active_attendants) : [],
        })
      }
      // Ensure every funnel has a rule entry
      for (const funnel of f) {
        if (!ruleMap.has(funnel.id)) ruleMap.set(funnel.id, { funnel_id: funnel.id, type: 'manual', active_attendants: [] })
      }
      setRules(ruleMap)
    }).finally(() => setLoading(false))
  }, [accountId])

  const attendants = users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active)

  const updateRule = (funnelId: number, field: string, value: any) => {
    setRules(prev => {
      const next = new Map(prev)
      const rule = { ...(next.get(funnelId) || { funnel_id: funnelId, type: 'manual' as const, active_attendants: [] }), [field]: value }
      next.set(funnelId, rule)
      return next
    })
    setSaved(false)
  }

  const toggleAttendant = (funnelId: number, userId: number) => {
    const rule = rules.get(funnelId)
    if (!rule) return
    const atts = rule.active_attendants.includes(userId)
      ? rule.active_attendants.filter(id => id !== userId)
      : [...rule.active_attendants, userId]
    updateRule(funnelId, 'active_attendants', atts)
  }

  const saveRules = async () => {
    if (!accountId) return
    for (const [funnelId, rule] of rules) {
      await apiFetch(`/api/settings/distribution?account_id=${accountId}`, {
        method: 'POST',
        body: JSON.stringify({ funnel_id: funnelId, type: rule.type, active_attendants: rule.active_attendants }),
      })
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <h1><SettingsIcon size={20} style={{ marginRight: 8 }} /> Configuracoes</h1>
        <button className="btn btn-primary btn-sm" onClick={saveRules}>
          {saved ? <><Check size={14} /> Salvo!</> : <><Save size={14} /> Salvar</>}
        </button>
      </div>

      {/* Notifier Instance (super_admin only) */}
      {isSuperAdmin && (
        <section className="dash-section" style={{ marginBottom: 16 }}>
          <div className="section-title"><Bell size={12} style={{ marginRight: 6 }} /> Notificacao Global de Novo Lead</div>
          <div className="card">
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12, lineHeight: 1.5 }}>
              Quando um lead é atribuído pra um vendedor (em qualquer conta), uma notificação automatica vai pra inst de notif do vendedor.
              <br /><strong>Quem envia essa notif</strong> é a instância escolhida abaixo (geralmente o número "Comercial Dros" da agência).
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>Instancia notifier</label>
                <select className="select" value={notifierInstanceId} onChange={e => setNotifierInstanceId(e.target.value)}>
                  <option value="">— Nenhuma (desativa notificacoes) —</option>
                  {allInstances.map(i => (
                    <option key={i.id} value={i.id}>
                      [{i.account_name || 'sem conta'}] {i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}{i.status === 'connected' ? ' ✓' : ' ✗'}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn btn-primary"
                disabled={savingNotifier}
                onClick={async () => {
                  setSavingNotifier(true)
                  try {
                    await updateAppSetting('notifier_instance_id', notifierInstanceId || null)
                    alert('Notifier atualizado.')
                  } catch (e: any) {
                    alert('Erro: ' + (e?.message || 'desconhecido'))
                  }
                  setSavingNotifier(false)
                }}
              >
                {savingNotifier ? 'Salvando...' : 'Salvar notifier'}
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Distribution Rules */}
      <section className="dash-section">
        <div className="section-title"><RotateCw size={12} style={{ marginRight: 6 }} /> Distribuicao de Leads (Roleta)</div>
        <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 16 }}>Configure como os leads sao distribuidos automaticamente quando chegam via WhatsApp, formularios ou site.</p>

        {funnels.map(funnel => {
          const rule = rules.get(funnel.id)
          if (!rule) return null
          return (
            <div key={funnel.id} className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 600 }}>{funnel.name}</h3>
                  {funnel.is_default ? <span style={{ fontSize: 10, color: '#FFB300' }}>FUNIL PADRAO</span> : null}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={`btn btn-sm ${rule.type === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateRule(funnel.id, 'type', 'manual')}>
                    Manual
                  </button>
                  <button className={`btn btn-sm ${rule.type === 'round_robin' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateRule(funnel.id, 'type', 'round_robin')}>
                    <RotateCw size={12} /> Roleta
                  </button>
                </div>
              </div>

              {rule.type === 'manual' && (
                <div style={{ fontSize: 12, color: '#9B96B0', padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 6 }}>
                  Leads chegam sem atendente. O gerente distribui manualmente.
                </div>
              )}

              {rule.type === 'round_robin' && (
                <div>
                  <div style={{ fontSize: 12, color: '#9B96B0', marginBottom: 8 }}>
                    Selecione os atendentes que participam da roleta:
                  </div>
                  {attendants.length === 0 ? (
                    <div style={{ fontSize: 12, color: '#FF6B6B' }}>Nenhum atendente ativo. Cadastre na pagina Equipe.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {attendants.map(att => (
                        <label key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer',
                          background: rule.active_attendants.includes(att.id) ? 'rgba(52,199,89,0.08)' : 'transparent' }}>
                          <input type="checkbox" checked={rule.active_attendants.includes(att.id)} onChange={() => toggleAttendant(funnel.id, att.id)} />
                          <Users size={12} />
                          <span style={{ fontSize: 13, fontWeight: 500 }}>{att.name}</span>
                          <span style={{ fontSize: 11, color: '#9B96B0' }}>{att.email}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {rule.active_attendants.length > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#34C759' }}>
                      Roleta ativa com {rule.active_attendants.length} atendentes
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

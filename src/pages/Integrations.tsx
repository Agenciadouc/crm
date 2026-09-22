import { useState, useEffect, useRef, useCallback } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import {
  fetchWhatsAppInstances, createWhatsAppInstance, connectWhatsAppInstance,
  checkWhatsAppStatus, refreshWhatsAppQR, disconnectWhatsApp, deleteWhatsAppInstance,
  fetchEvolutionConfig, saveEvolutionConfig, setupWhatsAppWebhook, restartWhatsAppInstance, syncWhatsAppNow, setInstanceAttendant, setInstanceMode, fetchUsers, apiFetch,
  type WhatsAppInstance, type User as UserType, type Account,
} from '../lib/api'
import { Plug, Plus, Wifi, WifiOff, Loader, Trash2, QrCode, Power, PowerOff, RefreshCw, Smartphone, Save, Check, Settings, FileSpreadsheet, Copy, Webhook, RotateCw, Download, User, Eye, EyeOff, Activity, AlertTriangle, MessageSquare, Link as LinkIcon, GitBranch } from 'lucide-react'
import NumberSettingsModal from '../components/NumberSettingsModal'
import { BlockedBanner } from '../components/BlockedBanner'
import LeadIntakeCard from './integrations/LeadIntakeCard'
import MetaCard from './integrations/MetaCard'
import AiCard from './integrations/AiCard'

export default function Integrations() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const isAtendente = user?.role === 'atendente'
  const isGerenteOuAdmin = user?.role === 'gerente' || user?.role === 'super_admin'
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'open' | 'restricted'>('open')
  const [creating, setCreating] = useState(false)
  const [activeQR, setActiveQR] = useState<number | null>(null)
  const pollRef = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  // Evolution config
  const [evoUrl, setEvoUrl] = useState('')
  const [evoKey, setEvoKey] = useState('')
  const [evoSaved, setEvoSaved] = useState(false)
  const [evoConfigured, setEvoConfigured] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  // Meta CAPI
  const [account, setAccount] = useState<Account | null>(null)
  const [users, setUsers] = useState<UserType[]>([])

  useEffect(() => {
    if (!accountId) return
    fetchUsers(accountId).then(setUsers).catch(() => {})
  }, [accountId])

  const handleAttendantChange = async (inst: WhatsAppInstance, attendantId: number | null) => {
    if (!accountId) return
    try {
      const { instance } = await setInstanceAttendant(inst.id, accountId, attendantId)
      setInstances(prev => prev.map(i => i.id === instance.id ? instance : i))
    } catch (e: any) {
      alert('Erro: ' + e.message)
    }
  }

  const handleModeChange = async (inst: WhatsAppInstance, mode: 'open' | 'restricted') => {
    if (!accountId) return
    if (mode === 'restricted') {
      const ok = confirm(
        'Trocar pra modo RESTRITO?\n\n' +
        'Mensagens de numeros desconhecidos serao IGNORADAS — so processa leads ja cadastrados no CRM (form, planilha, ou Novo chat).\n\n' +
        'Conversas atuais continuam normais. Pra reverter, clica no badge de novo.'
      )
      if (!ok) return
    }
    try {
      const { instance } = await setInstanceMode(inst.id, accountId, mode)
      setInstances(prev => prev.map(i => i.id === instance.id ? instance : i))
    } catch (e: any) {
      alert('Erro: ' + e.message)
    }
  }

  const load = useCallback(() => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      fetchWhatsAppInstances(accountId),
      fetchEvolutionConfig(accountId),
    ]).then(([insts, config]) => {
      setInstances(insts)
      setEvoUrl(config.api_url || '')
      setEvoKey(config.api_key || '')
      // Prefere a flag `configured` do back (sanitizada pra atendente); fallback pro check antigo.
      setEvoConfigured(typeof config.configured === 'boolean' ? config.configured : !!(config.api_url && config.api_key))
    }).finally(() => setLoading(false))
    apiFetch(`/api/accounts/${accountId}`).then((d: any) => {
      setAccount(d.account || null)
    }).catch(() => {})
  }, [accountId])

  useEffect(() => { load() }, [load])

  // Auto-poll status for connecting instances
  useEffect(() => {
    Object.values(pollRef.current).forEach(clearInterval)
    pollRef.current = {}

    instances.forEach(inst => {
      if (inst.status === 'connecting' && accountId) {
        pollRef.current[inst.id] = setInterval(async () => {
          try {
            const { instance: updated } = await checkWhatsAppStatus(inst.id, accountId)
            setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
            if (updated.status === 'connected') {
              clearInterval(pollRef.current[updated.id])
              delete pollRef.current[updated.id]
              setActiveQR(null)
            }
          } catch {}
        }, 5000)
      }
    })

    return () => { Object.values(pollRef.current).forEach(clearInterval); pollRef.current = {} }
  }, [instances.map(i => `${i.id}:${i.status}`).join(','), accountId])

  const handleSaveConfig = async () => {
    if (!accountId || !evoUrl || !evoKey) return
    setSavingConfig(true)
    try {
      await saveEvolutionConfig(accountId, { api_url: evoUrl, api_key: evoKey })
      setEvoConfigured(true)
      setEvoSaved(true)
      setTimeout(() => setEvoSaved(false), 2000)
    } catch (e: any) { alert('Erro: ' + e.message) }
    setSavingConfig(false)
  }

  const handleCreate = async () => {
    if (!accountId || !newName.trim()) return
    setCreating(true)
    try {
      const inst = await createWhatsAppInstance(accountId, { instance_name: newName.trim(), lead_intake_mode: newMode })
      setShowNew(false)
      setNewName('')
      setNewMode('open')
      if (inst.qr_code) setActiveQR(inst.id)
      load()
    } catch (e: any) { alert('Erro: ' + e.message) }
    setCreating(false)
  }

  const handleConnect = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    try {
      const updated = await connectWhatsAppInstance(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === updated.id ? updated : i))
      if (updated.qr_code) setActiveQR(updated.id)
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleRefreshQR = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    try {
      const r = await refreshWhatsAppQR(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, qr_code: r.qr_code, status: r.status } : i))
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleDisconnect = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    await disconnectWhatsApp(inst.id, accountId)
    setActiveQR(null)
    load()
  }

  const [deleteTarget, setDeleteTarget] = useState<WhatsAppInstance | null>(null)
  const [deleting, setDeleting] = useState(false)
  const handleDelete = (inst: WhatsAppInstance) => setDeleteTarget(inst)
  const confirmDelete = async () => {
    if (!accountId || !deleteTarget) return
    setDeleting(true)
    try {
      await deleteWhatsAppInstance(deleteTarget.id, accountId)
      setActiveQR(null)
      setDeleteTarget(null)
      load()
    } catch (e: any) {
      alert('Erro ao deletar: ' + e.message)
    }
    setDeleting(false)
  }

  const [reconfiguring, setReconfiguring] = useState<number | null>(null)
  const handleReconfigureWebhook = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    setReconfiguring(inst.id)
    try {
      await setupWhatsAppWebhook(inst.id, accountId)
      alert('Webhook reconfigurado com sucesso. Os leads voltarao a entrar em tempo real.')
    } catch (e: any) {
      alert('Erro ao reconfigurar webhook: ' + e.message)
    }
    setReconfiguring(null)
  }

  const [restarting, setRestarting] = useState<number | null>(null)
  const [settingsInstance, setSettingsInstance] = useState<WhatsAppInstance | null>(null)

  const handleRestart = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    if (!confirm(`Reiniciar a sessao do WhatsApp "${inst.instance_name}"? Use isso quando a instancia parecer conectada mas nao receber mensagens.`)) return
    setRestarting(inst.id)
    try {
      await restartWhatsAppInstance(inst.id, accountId)
      alert('Sessao reiniciada. Aguarde 10s e teste enviando uma mensagem.')
      load()
    } catch (e: any) {
      alert('Erro ao reiniciar: ' + e.message)
    }
    setRestarting(null)
  }

  const [syncing, setSyncing] = useState(false)
  const handleSyncNow = async () => {
    if (!accountId) return
    setSyncing(true)
    try {
      await syncWhatsAppNow(accountId)
      alert('Sincronizacao executada. Verifique a aba Chat — leads novos devem aparecer.')
    } catch (e: any) {
      alert('Erro ao sincronizar: ' + e.message)
    }
    setSyncing(false)
  }

  const getStatusIcon = (status: string) => {
    if (status === 'connected') return <Wifi size={14} />
    if (status === 'connecting') return <Loader size={14} className="spinning" />
    return <WifiOff size={14} />
  }
  const getStatusColor = (status: string) => status === 'connected' ? '#34C759' : status === 'connecting' ? '#FBBC04' : '#FF6B6B'
  const getStatusLabel = (status: string) => status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Aguardando QR...' : 'Desconectado'

  const qrInstance = instances.find(i => i.id === activeQR)

  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <h1><Plug size={20} style={{ marginRight: 8 }} />Integracoes</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          {evoConfigured && instances.some(i => i.status === 'connected') && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleSyncNow}
              disabled={syncing}
              title="Forca uma busca imediata por mensagens perdidas em todas as instancias conectadas."
            >
              {syncing ? <Loader size={14} className="spinning" /> : <Download size={14} />} Sincronizar agora
            </button>
          )}
          {evoConfigured && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Conectar WhatsApp</button>
          )}
        </div>
      </div>

      {isAtendente && !user?.primary_instance_id && (
        <BlockedBanner message="Voce ainda nao tem WhatsApp atribuido. Peca pro gerente atribuir em Equipe > Editar, ou conecte um novo WhatsApp acima (voce vira dono automaticamente)." />
      )}

      {/* Evolution API Config — gerente/admin only */}
      {isGerenteOuAdmin && (
      <section className="dash-section">
        <div className="section-title"><Settings size={14} /> Configuracao Evolution API</div>
        <div className="card">
          <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>Configure uma vez a URL e API Key do seu servidor Evolution API. Todos os numeros WhatsApp desta conta usarao estas credenciais.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>URL da API</label>
              <input className="input" value={evoUrl} onChange={e => setEvoUrl(e.target.value)} placeholder="https://evo.exemplo.com.br" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: '#9B96B0', display: 'block', marginBottom: 4 }}>API Key</label>
              <input className="input" type="password" value={evoKey} onChange={e => setEvoKey(e.target.value)} placeholder="sua-api-key" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={savingConfig || !evoUrl || !evoKey} style={{ height: 38 }}>
                {evoSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            </div>
          </div>
          {evoConfigured && <div style={{ fontSize: 11, color: '#34C759', marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Evolution API configurada</div>}
        </div>
      </section>
      )}

      {/* QR Code Panel */}
      {qrInstance && qrInstance.qr_code && qrInstance.status === 'connecting' && (
        <div className="card" style={{ marginBottom: 20, textAlign: 'center', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            <QrCode size={20} style={{ color: '#FFB300' }} />
            <h2 style={{ fontSize: 18, margin: 0 }}>Escaneie o QR Code — {qrInstance.instance_name}</h2>
          </div>
          <div style={{ background: '#fff', display: 'inline-block', padding: 16, borderRadius: 12, marginBottom: 16 }}>
            <img
              src={qrInstance.qr_code.startsWith('data:') ? qrInstance.qr_code : `data:image/png;base64,${qrInstance.qr_code}`}
              alt="QR Code WhatsApp"
              style={{ width: 280, height: 280, display: 'block' }}
            />
          </div>
          <div style={{ fontSize: 13, color: '#9B96B0', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
            <p><strong>1.</strong> Abra o WhatsApp no celular</p>
            <p><strong>2.</strong> Toque em <strong>Configuracoes → Aparelhos Conectados → Conectar Aparelho</strong></p>
            <p><strong>3.</strong> Aponte a camera para este QR Code</p>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => handleRefreshQR(qrInstance)}><RefreshCw size={12} /> Atualizar QR</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(null)}>Fechar</button>
          </div>
        </div>
      )}

      {/* Instances List */}
      {evoConfigured && (
        <section className="dash-section">
          <div className="section-title"><Smartphone size={14} /> Numeros WhatsApp</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {instances.map(inst => (
              <div key={inst.id} className="card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${getStatusColor(inst.status)}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Smartphone size={18} style={{ color: getStatusColor(inst.status) }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{inst.instance_name}</div>
                      {inst.phone_number && <div style={{ fontSize: 12, color: '#C8C4D4' }}>{inst.phone_number}</div>}
                      {(
                        <>
                          <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <User size={11} /> Leads novos vao para:
                            <select
                              className="select"
                              value={inst.default_attendant_id ?? ''}
                              onChange={e => handleAttendantChange(inst, e.target.value ? parseInt(e.target.value) : null)}
                              style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180 }}
                              title="Quando uma mensagem chega nesse numero, o lead criado e atribuido a este atendente. Em branco = usa a roleta do funil."
                            >
                              <option value="">Roleta do funil</option>
                              {users.filter(u => u.is_active && (u.role === 'atendente' || u.role === 'gerente')).map(u => (
                                <option key={u.id} value={u.id}>{u.name}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                            Modo:
                            <select
                              className="select"
                              value={inst.lead_intake_mode || 'open'}
                              onChange={e => handleModeChange(inst, e.target.value as 'open' | 'restricted')}
                              style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180, color: inst.lead_intake_mode === 'restricted' ? '#FBBC04' : undefined }}
                              title={inst.lead_intake_mode === 'restricted' ? 'Restrito: só processa msgs de leads ja cadastrados (form, planilha, Novo chat). Numeros novos sao ignorados.' : 'Aberto: qualquer mensagem cria lead novo automaticamente.'}
                            >
                              <option value="open">📥 Aberto (recebe todos)</option>
                              <option value="restricted">🔒 Restrito (so leads cadastrados)</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: getStatusColor(inst.status) }}>
                      {getStatusIcon(inst.status)} {getStatusLabel(inst.status)}
                    </span>
                    {inst.status === 'disconnected' && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleConnect(inst)}><Power size={12} /> Conectar</button>
                    )}
                    {inst.status === 'connecting' && (
                      <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(activeQR === inst.id ? null : inst.id)}>
                        <QrCode size={12} /> {activeQR === inst.id ? 'Ocultar QR' : 'Ver QR'}
                      </button>
                    )}
                    {inst.status === 'connected' && (
                      <>
                        {(
                          <>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleReconfigureWebhook(inst)}
                              disabled={reconfiguring === inst.id}
                              title="Reenvia o webhook pra Evolution. Use se os leads pararem de entrar em tempo real."
                            >
                              {reconfiguring === inst.id ? <Loader size={12} className="spinning" /> : <Webhook size={12} />} Webhook
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleRestart(inst)}
                              disabled={restarting === inst.id}
                              title="Reinicia a sessao Baileys da Evolution. Use quando a instancia mostra Conectada mas nao recebe nem envia mensagens."
                            >
                              {restarting === inst.id ? <Loader size={12} className="spinning" /> : <RotateCw size={12} />} Reiniciar sessao
                            </button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleDisconnect(inst)}><PowerOff size={12} /> Desconectar</button>
                          </>
                        )}
                      </>
                    )}
                    {(isGerenteOuAdmin || user?.primary_instance_id === inst.id) && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSettingsInstance(inst)}
                        title="Primeira mensagem, horário de atendimento e ausência deste número"
                      >
                        <MessageSquare size={12} /> Mensagens do número
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(inst)} title="Excluir"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            ))}
            {instances.length === 0 && (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <h3>Nenhum numero conectado</h3>
                <p>Clique em "Conectar WhatsApp" para adicionar um numero.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {!evoConfigured && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <Smartphone size={32} style={{ color: '#6B6580', marginBottom: 8 }} />
          <h3>Configure a Evolution API acima</h3>
          <p style={{ color: '#9B96B0', fontSize: 13 }}>Salve a URL e API Key do servidor Evolution para comecar a conectar numeros de WhatsApp.</p>
        </div>
      )}

      {isGerenteOuAdmin && accountId && account && (
        <LeadIntakeCard accountId={accountId} account={account} instances={instances} users={users} />
      )}

      {isGerenteOuAdmin && accountId && account && (
        <MetaCard accountId={accountId} account={account} onAccountUpdated={p => setAccount(a => a ? { ...a, ...p } : a)} />
      )}

      {isGerenteOuAdmin && accountId && account && !!account.ai_agents_enabled && (
        <AiCard accountId={accountId} account={account} isSuperAdmin={user?.role === 'super_admin'} onAccountUpdated={p => setAccount(a => a ? { ...a, ...p } : a)} />
      )}

      {/* New Instance Modal */}
      {showNew && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2>Conectar WhatsApp</h2>
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 16 }}>De um nome para identificar este numero (ex: Comercial, Suporte, Vendas).</p>
            <div className="form-group">
              <label>Nome do numero</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Comercial" autoFocus onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>

            {/* Modo de recebimento */}
            <div className="form-group" style={{ marginTop: 16 }}>
              <label style={{ display: 'block', marginBottom: 8 }}>Modo de recebimento de leads</label>

              <div
                onClick={() => setNewMode('open')}
                style={{
                  padding: 12,
                  marginBottom: 8,
                  border: `1px solid ${newMode === 'open' ? '#FFB300' : 'rgba(255,255,255,0.08)'}`,
                  background: newMode === 'open' ? 'rgba(255,179,0,0.08)' : 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="radio" checked={newMode === 'open'} onChange={() => setNewMode('open')} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: newMode === 'open' ? '#FFCB45' : '#fff' }}>Aberto (recomendado)</div>
                    <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 4 }}>
                      Recebe leads de TODO mundo que mandar mensagem pra esse WhatsApp. Atendimento comercial padrao.
                    </div>
                  </div>
                </div>
              </div>

              <div
                onClick={() => setNewMode('restricted')}
                style={{
                  padding: 12,
                  border: `1px solid ${newMode === 'restricted' ? '#FBBC04' : 'rgba(255,255,255,0.08)'}`,
                  background: newMode === 'restricted' ? 'rgba(251,188,4,0.08)' : 'rgba(255,255,255,0.02)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <input type="radio" checked={newMode === 'restricted'} onChange={() => setNewMode('restricted')} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: newMode === 'restricted' ? '#FBBC04' : '#fff' }}>Restrito</div>
                    <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 4 }}>
                      Recebe APENAS msgs de leads ja cadastrados no CRM (via formulario, planilha, ou "Novo chat" pelo atendente). Numeros desconhecidos sao ignorados.
                      <br /><strong style={{ color: '#FBBC04' }}>Ideal pra quem usa WhatsApp pessoal + comercial.</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim()}>{creating ? 'Criando...' : 'Gerar QR Code'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Mensagens do numero: primeira mensagem, horario de atendimento e ausencia */}
      {settingsInstance && accountId && (
        <NumberSettingsModal
          instance={settingsInstance}
          accountId={accountId}
          canEditFirstMessage={isGerenteOuAdmin || user?.primary_instance_id === settingsInstance.id}
          canManageFunnels={isGerenteOuAdmin}
          onClose={() => setSettingsInstance(null)}
          onSaved={updated => { setInstances(prev => prev.map(i => i.id === updated.id ? updated : i)); setSettingsInstance(null) }}
        />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Trash2 size={20} style={{ color: '#ef4444' }} />
              Deletar instância
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
              Tem certeza que quer deletar a instância <strong style={{ color: 'var(--text)' }}>"{deleteTarget.instance_name}"</strong>?
              <br /><br />
              Isso vai remover ela do CRM e da Evolution API. Mensagens antigas continuam no histórico do lead, mas <strong>não vai mais receber nem enviar mensagens por este número</strong>. Essa ação não pode ser desfeita.
            </p>

            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</button>
              <button
                className="btn"
                disabled={deleting}
                onClick={confirmDelete}
                style={{ background: '#ef4444', color: 'white', border: 'none' }}
              >
                {deleting ? 'Deletando...' : 'Sim, deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

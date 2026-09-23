import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  createWhatsAppInstance, connectWhatsAppInstance, checkWhatsAppStatus, refreshWhatsAppQR,
  disconnectWhatsApp, deleteWhatsAppInstance, fetchEvolutionConfig, saveEvolutionConfig,
  setupWhatsAppWebhook, restartWhatsAppInstance, syncWhatsAppNow, setInstanceAttendant, setInstanceMode,
  fetchWhatsAppProviders,
  type WhatsAppInstance, type User as UserType, type WhatsAppProviderId,
} from '../../lib/api'
import { providerLabel, qrImageSrc, defaultProvider } from '../../lib/whatsappProviders.js'
import {
  Plus, Wifi, WifiOff, Loader, Trash2, QrCode, Power, PowerOff, RefreshCw, Smartphone, Save, Check,
  Settings, Webhook, RotateCw, Download, User, MessageSquare, ExternalLink,
} from 'lucide-react'
import NumberSettingsModal from '../../components/NumberSettingsModal'
import { InlineNotice, useInlineNotice } from '../../components/InlineNotice'
import ConfirmDialog from '../../components/ConfirmDialog'

interface Props {
  accountId: number
  instances: WhatsAppInstance[]
  setInstances: Dispatch<SetStateAction<WhatsAppInstance[]>>
  reload: () => Promise<void>
  users: UserType[]
  // A lista de numeros falhou ao carregar (nao e "nenhum numero")
  loadError?: boolean
}

// Onde o aviso aparece: no topo do card, nas credenciais da Evolution ou dentro do numero da acao.
type NoticeTarget = 'top' | 'evo' | number

const isEvolution = (inst: WhatsAppInstance) => (inst.provider || 'evolution') === 'evolution'

const statusColor = (status: string) => status === 'connected' ? '#34C759' : status === 'connecting' ? '#FBBC04' : '#FF6B6B'
const statusLabel = (status: string) => status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Aguardando QR...' : 'Desconectado'
const statusIcon = (status: string) => {
  if (status === 'connected') return <Wifi size={14} />
  if (status === 'connecting') return <Loader size={14} className="spinning" />
  return <WifiOff size={14} />
}

// Card "WhatsApp": numeros da conta, provedor de cada numero (UzAPI ou Evolution), QR / painel,
// "leads novos vao para", modo de recebimento, mensagens do numero e credenciais da Evolution (recolhidas).
export default function WhatsAppCard({ accountId, instances, setInstances, reload, users, loadError = false }: Props) {
  const { user } = useAuth()
  const isGerenteOuAdmin = user?.role === 'gerente' || user?.role === 'super_admin'

  const [providers, setProviders] = useState<WhatsAppProviderId[]>(['evolution'])
  const [evoUrl, setEvoUrl] = useState('')
  const [evoKey, setEvoKey] = useState('')
  const [evoConfigured, setEvoConfigured] = useState(false)
  const [evoSaved, setEvoSaved] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'open' | 'restricted'>('open')
  const [newProvider, setNewProvider] = useState<WhatsAppProviderId>('evolution')
  const [creating, setCreating] = useState(false)
  // Trava de criacao: `creating` so vale no proximo render, entao dois Enter no mesmo
  // instante criariam dois numeros. O ref muda na hora.
  const creatingRef = useRef(false)

  const [activeQR, setActiveQR] = useState<number | null>(null)
  const [panelUrls, setPanelUrls] = useState<Record<number, string>>({})
  const [qrLoading, setQrLoading] = useState<number | null>(null)
  const pollRef = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  const [settingsInstance, setSettingsInstance] = useState<WhatsAppInstance | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppInstance | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reconfiguring, setReconfiguring] = useState<number | null>(null)
  const [restarting, setRestarting] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [restartTarget, setRestartTarget] = useState<WhatsAppInstance | null>(null)
  const [restrictTarget, setRestrictTarget] = useState<WhatsAppInstance | null>(null)
  const [retrying, setRetrying] = useState(false)

  // Avisos no lugar do alert(): um do card (com o lugar onde aparece) e um por modal aberto.
  const cardNotice = useInlineNotice()
  const [noticeAt, setNoticeAt] = useState<NoticeTarget>('top')
  const createNotice = useInlineNotice()
  const deleteNotice = useInlineNotice()
  const showErrorAt = (at: NoticeTarget, prefix: string, e?: unknown) => { setNoticeAt(at); cardNotice.showError(prefix, e) }
  const showSuccessAt = (at: NoticeTarget, text: string) => { setNoticeAt(at); cardNotice.showSuccess(text) }
  const noticeFor = (at: NoticeTarget) => noticeAt === at && cardNotice.notice
    ? <InlineNotice notice={cardNotice.notice} onClose={cardNotice.clear} style={typeof at === 'number' ? { marginTop: 12, marginBottom: 0 } : undefined} />
    : null

  useEffect(() => {
    fetchEvolutionConfig(accountId).then(c => {
      setEvoUrl(c.api_url || '')
      setEvoKey(c.api_key || '')
      setEvoConfigured(typeof c.configured === 'boolean' ? c.configured : !!(c.api_url && c.api_key))
    }).catch(() => {})
    // A lista pode chegar depois; o provedor pre-selecionado e aplicado ao ABRIR o modal
    // (openNewNumber), senao a lista atrasada sobrescreveria a escolha de quem ja abriu.
    fetchWhatsAppProviders(accountId).then(setProviders)
  }, [accountId])

  // Enquanto um numero esta "connecting", confere o status a cada 5s (o QR da UzAPI pode chegar depois, pelo aviso).
  useEffect(() => {
    Object.values(pollRef.current).forEach(clearInterval)
    pollRef.current = {}
    instances.forEach(inst => {
      if (inst.status !== 'connecting') return
      pollRef.current[inst.id] = setInterval(async () => {
        try {
          const { instance: updated } = await checkWhatsAppStatus(inst.id, accountId)
          setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
          if (updated.status === 'connected') {
            clearInterval(pollRef.current[updated.id])
            delete pollRef.current[updated.id]
            setActiveQR(cur => cur === updated.id ? null : cur)
          }
        } catch {}
      }, 5000)
    })
    return () => { Object.values(pollRef.current).forEach(clearInterval); pollRef.current = {} }
  }, [instances.map(i => `${i.id}:${i.status}`).join(','), accountId])

  const canCreate = evoConfigured || providers.includes('uzapi')
  const hasUzapi = providers.includes('uzapi')

  const handleSaveConfig = async () => {
    if (!evoUrl || !evoKey) return
    setSavingConfig(true)
    try {
      await saveEvolutionConfig(accountId, { api_url: evoUrl, api_key: evoKey })
      setEvoConfigured(true)
      setEvoSaved(true)
      setTimeout(() => setEvoSaved(false), 2000)
    } catch (e: any) { showErrorAt('evo', 'Erro ao salvar as credenciais', e) }
    setSavingConfig(false)
  }

  // Provedor pre-selecionado: UzAPI quando disponivel, senao Evolution.
  const openNewNumber = () => {
    setNewProvider(defaultProvider(providers))
    createNotice.clear()
    setShowNew(true)
  }

  const openQr = async (inst: WhatsAppInstance) => {
    setActiveQR(inst.id)
    setQrLoading(inst.id)
    try {
      const r = await refreshWhatsAppQR(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, qr_code: r.qr_code, status: r.status || 'connecting' } : i))
      setPanelUrls(prev => {
        const next = { ...prev }
        if (r.panel_url) next[inst.id] = r.panel_url
        else delete next[inst.id]
        return next
      })
      // Ex.: UzAPI recusou a credencial; o painel continua como alternativa.
      if (r.error_message) showErrorAt('top', r.error_message)
    } catch (e: any) {
      // Sem QR nenhum, o painel ficaria aberto e vazio; fecha junto com o aviso do erro.
      setActiveQR(cur => cur === inst.id ? null : cur)
      showErrorAt('top', 'Erro ao gerar o QR code', e)
    }
    setQrLoading(null)
  }

  const handleCreate = async () => {
    if (creatingRef.current || !newName.trim()) return
    creatingRef.current = true
    setCreating(true)
    try {
      const inst = await createWhatsAppInstance(accountId, { instance_name: newName.trim(), lead_intake_mode: newMode, provider: newProvider })
      const chosen = newProvider
      setShowNew(false); setNewName(''); setNewMode('open')
      await reload()
      // UzAPI: sempre pede o QR ao servidor, que manda junto o endereco do painel.
      if ((inst.provider || chosen) !== 'evolution') await openQr(inst)
      else if (inst.qr_code) setActiveQR(inst.id)
    } catch (e: any) { createNotice.showError('Erro ao criar o número', e) }
    finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  const handleConnect = async (inst: WhatsAppInstance) => {
    if (!isEvolution(inst)) { await openQr(inst); return }
    try {
      const updated = await connectWhatsAppInstance(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
      if (updated.qr_code) setActiveQR(updated.id)
    } catch (e: any) { showErrorAt(inst.id, 'Erro ao conectar', e) }
  }

  const handleDisconnect = async (inst: WhatsAppInstance) => {
    try { await disconnectWhatsApp(inst.id, accountId) } catch (e: any) { showErrorAt(inst.id, 'Erro ao desconectar', e) }
    setActiveQR(null)
    await reload()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteWhatsAppInstance(deleteTarget.id, accountId)
      setActiveQR(null)
      setDeleteTarget(null)
      await reload()
    } catch (e: any) { deleteNotice.showError('Erro ao excluir', e) }
    setDeleting(false)
  }

  const handleReconfigureWebhook = async (inst: WhatsAppInstance) => {
    setReconfiguring(inst.id)
    try {
      await setupWhatsAppWebhook(inst.id, accountId)
      showSuccessAt(inst.id, 'Webhook reconfigurado. Os leads voltam a entrar em tempo real.')
    } catch (e: any) { showErrorAt(inst.id, 'Erro ao reconfigurar o webhook', e) }
    setReconfiguring(null)
  }

  const handleRestart = async (inst: WhatsAppInstance) => {
    setRestartTarget(null)
    setRestarting(inst.id)
    try {
      await restartWhatsAppInstance(inst.id, accountId)
      showSuccessAt(inst.id, 'Sessão reiniciada. Aguarde 10 segundos e teste enviando uma mensagem.')
      await reload()
    } catch (e: any) { showErrorAt(inst.id, 'Erro ao reiniciar', e) }
    setRestarting(null)
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await syncWhatsAppNow(accountId)
      showSuccessAt('top', 'Sincronização feita. Confira o Chat: leads novos devem aparecer.')
    } catch (e: any) { showErrorAt('top', 'Erro ao sincronizar', e) }
    setSyncing(false)
  }

  const handleAttendantChange = async (inst: WhatsAppInstance, attendantId: number | null) => {
    try {
      const { instance } = await setInstanceAttendant(inst.id, accountId, attendantId)
      setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, ...instance } : i))
    } catch (e: any) { showErrorAt(inst.id, 'Erro ao trocar o atendente', e) }
  }

  // Restrito pede confirmacao no modal (se cancelar, o select continua no valor salvo).
  const handleModeChange = async (inst: WhatsAppInstance, mode: 'open' | 'restricted', confirmed = false) => {
    if (mode === 'restricted' && !confirmed) { setRestrictTarget(inst); return }
    setRestrictTarget(null)
    try {
      const { instance } = await setInstanceMode(inst.id, accountId, mode)
      setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, ...instance } : i))
    } catch (e: any) { showErrorAt(inst.id, 'Erro ao trocar o modo', e) }
  }

  const handleRetryLoad = async () => {
    setRetrying(true)
    try { await reload() } finally { setRetrying(false) }
  }

  const qrInstance = instances.find(i => i.id === activeQR)
  const qrSrc = qrImageSrc(qrInstance?.qr_code)
  const panelUrl = qrInstance ? panelUrls[qrInstance.id] : undefined
  const attendantOptions = users.filter(u => u.is_active && (u.role === 'atendente' || u.role === 'gerente'))

  return (
    <>
      <section className="dash-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}><Smartphone size={14} /> Números de WhatsApp</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {instances.some(i => i.status === 'connected' && isEvolution(i)) && (
              <button className="btn btn-secondary btn-sm" onClick={handleSyncNow} disabled={syncing} title="Busca agora mensagens perdidas nos números da Evolution conectados.">
                {syncing ? <Loader size={14} className="spinning" /> : <Download size={14} />} Sincronizar agora
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={openNewNumber}><Plus size={14} /> Conectar número</button>
            )}
          </div>
        </div>

        {noticeFor('top')}

        {loadError && (
          <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', marginBottom: 12, borderRadius: 'var(--radius-sm)', background: 'var(--negative-bg)', border: '1px solid var(--negative)', fontSize: 13 }}>
            <span style={{ flex: 1, color: 'var(--text-primary)' }}>Não foi possível carregar os números.</span>
            <button className="btn btn-secondary btn-sm" onClick={handleRetryLoad} disabled={retrying}>
              {retrying ? <Loader size={12} className="spinning" /> : <RefreshCw size={12} />} Tentar de novo
            </button>
          </div>
        )}

        {qrInstance && qrInstance.status !== 'connected' && (
          <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <QrCode size={20} style={{ color: '#FFB300' }} />
              <h2 style={{ fontSize: 18, margin: 0 }}>Conectar {qrInstance.instance_name} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>({providerLabel(qrInstance.provider)})</span></h2>
            </div>
            {qrLoading === qrInstance.id ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}><Loader size={14} className="spinning" /> Gerando o QR code...</p>
            ) : qrSrc ? (
              <>
                <div style={{ background: '#fff', display: 'inline-block', padding: 16, borderRadius: 12, marginBottom: 12 }}>
                  <img src={qrSrc} alt="QR code do WhatsApp" style={{ width: 280, height: 280, display: 'block' }} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                  <p><strong>1.</strong> Abra o WhatsApp no celular</p>
                  <p><strong>2.</strong> Toque em <strong>Configurações → Aparelhos conectados → Conectar aparelho</strong></p>
                  <p><strong>3.</strong> Aponte a câmera para este QR code</p>
                </div>
              </>
            ) : panelUrl ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                O QR deste número fica no painel da UzAPI. Abra o painel, escaneie o QR com o WhatsApp do celular e volte aqui: o status muda sozinho para Conectado.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                O QR ainda não chegou. Clique em Atualizar QR em alguns segundos.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              {panelUrl && (
                <a className="btn btn-primary btn-sm" href={panelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Abrir painel da UzAPI</a>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => openQr(qrInstance)} disabled={qrLoading === qrInstance.id}><RefreshCw size={12} /> Atualizar QR</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(null)}>Fechar</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {instances.map(inst => (
            <div key={inst.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${statusColor(inst.status)}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Smartphone size={18} style={{ color: statusColor(inst.status) }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {inst.instance_name}
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                        {providerLabel(inst.provider)}
                      </span>
                    </div>
                    {inst.phone_number && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.phone_number}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <User size={11} /> Leads novos vão para:
                      <select
                        className="select"
                        value={inst.default_attendant_id ?? ''}
                        onChange={e => handleAttendantChange(inst, e.target.value ? parseInt(e.target.value) : null)}
                        style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180 }}
                        title="Quando uma mensagem chega neste número, o lead criado vai para este atendente. Em branco, usa a roleta do funil."
                      >
                        <option value="">Roleta do funil</option>
                        {attendantOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Modo:
                      <select
                        className="select"
                        value={inst.lead_intake_mode || 'open'}
                        onChange={e => handleModeChange(inst, e.target.value as 'open' | 'restricted')}
                        style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180, color: inst.lead_intake_mode === 'restricted' ? '#FBBC04' : undefined }}
                        title={inst.lead_intake_mode === 'restricted' ? 'Restrito: só processa mensagens de leads já cadastrados. Números novos são ignorados.' : 'Aberto: qualquer mensagem cria lead novo.'}
                      >
                        <option value="open">Aberto (recebe todos)</option>
                        <option value="restricted">Restrito (só leads cadastrados)</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: statusColor(inst.status) }}>
                    {statusIcon(inst.status)} {statusLabel(inst.status)}
                  </span>
                  {inst.status === 'disconnected' && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleConnect(inst)}><Power size={12} /> Conectar</button>
                  )}
                  {inst.status === 'connecting' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => activeQR === inst.id ? setActiveQR(null) : (isEvolution(inst) && inst.qr_code ? setActiveQR(inst.id) : openQr(inst))}>
                      <QrCode size={12} /> {activeQR === inst.id ? 'Ocultar QR' : 'Ver QR'}
                    </button>
                  )}
                  {inst.status === 'connected' && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleReconfigureWebhook(inst)} disabled={reconfiguring === inst.id} title="Reenvia ao provedor o endereço de avisos deste número. Use se os leads pararem de entrar em tempo real.">
                        {reconfiguring === inst.id ? <Loader size={12} className="spinning" /> : <Webhook size={12} />} Webhook
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setRestartTarget(inst)} disabled={restarting === inst.id} title="Reinicia a sessão do WhatsApp no provedor. Use quando aparece Conectado mas não recebe nem envia.">
                        {restarting === inst.id ? <Loader size={12} className="spinning" /> : <RotateCw size={12} />} Reiniciar sessão
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDisconnect(inst)}><PowerOff size={12} /> Desconectar</button>
                    </>
                  )}
                  {(isGerenteOuAdmin || user?.primary_instance_id === inst.id) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setSettingsInstance(inst)} title="Primeira mensagem, horário de atendimento e ausência deste número">
                      <MessageSquare size={12} /> Mensagens do número
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => { deleteNotice.clear(); setDeleteTarget(inst) }} title="Excluir"><Trash2 size={12} /></button>
                </div>
              </div>
              {noticeFor(inst.id)}
            </div>
          ))}
          {instances.length === 0 && !loadError && (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <h3>Nenhum número conectado</h3>
              <p>{canCreate ? 'Clique em "Conectar número" para adicionar um número.' : 'Configure as credenciais da Evolution abaixo para começar.'}</p>
            </div>
          )}
        </div>
      </section>

      {isGerenteOuAdmin && (
        <details className="card" style={{ padding: '12px 16px', marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Settings size={14} /> Credenciais da Evolution desta conta
            {evoConfigured && <span style={{ color: '#34C759', fontSize: 11, fontWeight: 500 }}>· configurada</span>}
          </summary>
          <div style={{ marginTop: 12 }}>{noticeFor('evo')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0' }}>URL e chave do servidor Evolution usadas pelos números desta conta que estão na Evolution. Números da UzAPI não usam estas credenciais.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>URL da API</label>
              <input className="input" value={evoUrl} onChange={e => setEvoUrl(e.target.value)} placeholder="https://evo.exemplo.com.br" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Key</label>
              <input className="input" type="password" value={evoKey} onChange={e => setEvoKey(e.target.value)} placeholder="sua-api-key" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={savingConfig || !evoUrl || !evoKey} style={{ height: 38 }}>
                {evoSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            </div>
          </div>
        </details>
      )}

      {showNew && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2>Conectar número de WhatsApp</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Dê um nome para identificar este número (ex.: Comercial, Suporte, Vendas).</p>
            <InlineNotice notice={createNotice.notice} onClose={createNotice.clear} />

            {hasUzapi && (
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: 8 }}>Provedor deste número</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {providers.map(p => (
                    <label key={p} style={{ flex: 1, minWidth: 180, padding: 10, borderRadius: 8, cursor: 'pointer', border: `1px solid ${newProvider === p ? 'var(--accent)' : 'var(--border-medium)'}`, background: newProvider === p ? 'rgba(255,179,0,0.06)' : 'transparent' }}>
                      <input type="radio" name="new-provider" checked={newProvider === p} onChange={() => setNewProvider(p)} style={{ marginRight: 6 }} />
                      <strong>{providerLabel(p)}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginLeft: 22 }}>
                        {p === 'uzapi' ? 'A conexão fica fora do servidor da Dros. O QR aparece aqui ou no painel da UzAPI.' : 'Servidor Evolution configurado nas credenciais desta conta.'}
                      </div>
                    </label>
                  ))}
                </div>
                {newProvider === 'evolution' && !evoConfigured && (
                  <p style={{ fontSize: 11, color: '#FBBC04', marginTop: 6 }}>Configure antes as credenciais da Evolution (no fim deste card) ou escolha a UzAPI.</p>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Nome do número</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex.: Comercial" autoFocus onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label style={{ display: 'block', marginBottom: 8 }}>Modo de recebimento de leads</label>
              {(['open', 'restricted'] as const).map(m => (
                <div
                  key={m}
                  onClick={() => setNewMode(m)}
                  style={{ padding: 12, marginBottom: 8, borderRadius: 8, cursor: 'pointer', border: `1px solid ${newMode === m ? (m === 'open' ? '#FFB300' : '#FBBC04') : 'var(--border-medium)'}`, background: newMode === m ? 'rgba(255,179,0,0.06)' : 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <input type="radio" checked={newMode === m} onChange={() => setNewMode(m)} style={{ marginTop: 3 }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{m === 'open' ? 'Aberto (recomendado)' : 'Restrito'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {m === 'open'
                          ? 'Recebe leads de todo mundo que mandar mensagem para este WhatsApp. Atendimento comercial padrão.'
                          : 'Recebe apenas mensagens de leads já cadastrados no CRM (formulário, planilha ou "Novo chat"). Números desconhecidos são ignorados. Ideal para quem usa o WhatsApp pessoal também como comercial.'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)} disabled={creating}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim() || (newProvider === 'evolution' && !evoConfigured)}>
                {creating ? 'Criando...' : 'Conectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsInstance && (
        <NumberSettingsModal
          instance={settingsInstance}
          accountId={accountId}
          canEditFirstMessage={isGerenteOuAdmin || user?.primary_instance_id === settingsInstance.id}
          canManageFunnels={isGerenteOuAdmin}
          onClose={() => setSettingsInstance(null)}
          onSaved={updated => { setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i)); setSettingsInstance(null) }}
        />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Trash2 size={20} style={{ color: '#ef4444' }} /> Excluir número
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
              Tem certeza de que quer excluir o número <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.instance_name}"</strong>?
              <br /><br />
              Ele sai do CRM e do provedor ({providerLabel(deleteTarget.provider)}). As mensagens antigas continuam no histórico dos leads, mas <strong>este número não vai mais receber nem enviar mensagens</strong>. Não dá para desfazer.
            </p>
            <InlineNotice notice={deleteNotice.notice} onClose={deleteNotice.clear} />
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</button>
              <button className="btn" disabled={deleting} onClick={confirmDelete} style={{ background: '#ef4444', color: 'white', border: 'none' }}>
                {deleting ? 'Excluindo...' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restartTarget && (
        <ConfirmDialog
          title={<><RotateCw size={20} style={{ color: 'var(--accent)' }} /> Reiniciar sessão</>}
          confirmLabel="Sim, reiniciar"
          onConfirm={() => handleRestart(restartTarget)}
          onCancel={() => setRestartTarget(null)}
        >
          Reiniciar a sessão do WhatsApp <strong style={{ color: 'var(--text-primary)' }}>"{restartTarget.instance_name}"</strong>?
          <br /><br />
          Use quando o número parece conectado mas não recebe mensagens.
        </ConfirmDialog>
      )}

      {restrictTarget && (
        <ConfirmDialog
          title="Trocar para o modo restrito?"
          confirmLabel="Sim, trocar para restrito"
          onConfirm={() => handleModeChange(restrictTarget, 'restricted', true)}
          onCancel={() => setRestrictTarget(null)}
        >
          Mensagens de números desconhecidos serão <strong style={{ color: 'var(--text-primary)' }}>ignoradas</strong>: só entram leads já cadastrados no CRM (formulário, planilha ou Novo chat).
          <br /><br />
          As conversas atuais continuam normais. Para voltar, troque o modo de novo.
        </ConfirmDialog>
      )}
    </>
  )
}

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { fetchWhatsAppInstances, fetchUsers, fetchAccount, type WhatsAppInstance, type User as UserType, type Account } from '../lib/api'
import { Plug, Smartphone, GitBranch, Activity, Bot } from 'lucide-react'
import { BlockedBanner } from '../components/BlockedBanner'
import WhatsAppCard from './integrations/WhatsAppCard'
import LeadIntakeCard from './integrations/LeadIntakeCard'
import MetaCard from './integrations/MetaCard'
import AiCard from './integrations/AiCard'
import { whatsappTileStatus, createLatestRequest } from '../lib/integrationsStatus.js'

type CardId = 'whatsapp' | 'leads' | 'meta' | 'ia'

interface CardTile { id: CardId; label: string; icon: ReactNode; status: string; visible: boolean }

// Integracoes em 4 cards (spec provedor-whatsapp §5.1): WhatsApp / Entrada de leads / Meta / IA.
// O card aberto fica na URL (?card=ia) para outras telas poderem apontar direto para ele.
export default function Integrations() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const isAtendente = user?.role === 'atendente'
  const isGerenteOuAdmin = user?.role === 'gerente' || user?.role === 'super_admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  // A lista de numeros falhou: a tela avisa em vez de dizer "Nenhum número".
  const [instancesError, setInstancesError] = useState(false)

  // So a ultima requisicao da conta atual vale: resposta atrasada de outra conta e ignorada.
  const accountIdRef = useRef(accountId)
  accountIdRef.current = accountId
  const instancesRequest = useRef(createLatestRequest<number | null | undefined>())

  const reloadInstances = useCallback(async () => {
    if (!accountId) return
    const ticket = instancesRequest.current.begin(accountId)
    try {
      const list = await fetchWhatsAppInstances(accountId)
      if (!instancesRequest.current.isLatest(ticket, accountIdRef.current)) return
      setInstances(list)
      setInstancesError(false)
    } catch (e: any) {
      if (!instancesRequest.current.isLatest(ticket, accountIdRef.current)) return
      console.error('[Integrações] falha ao carregar os números:', e?.message || e)
      setInstancesError(true)
    }
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    setInstances([])
    setInstancesError(false)
    setLoading(true)
    Promise.all([
      reloadInstances(),
      fetchUsers(accountId).then(setUsers).catch(() => {}),
      fetchAccount(accountId).then(d => setAccount(d.account || null)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [accountId, reloadInstances])

  const updateAccountLocal = (patch: Partial<Account>) => setAccount(a => a ? { ...a, ...patch } : a)

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>
  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  const hasAiKey = !!(account?.anthropic_api_key || account?.ai_key_source === 'dros' || account?.ai_key_source === 'auto')
  const tiles: CardTile[] = [
    { id: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} />, status: whatsappTileStatus({ instances, loadError: instancesError }), visible: true },
    { id: 'leads', label: 'Entrada de leads', icon: <GitBranch size={16} />, status: 'Formulários e Google Planilhas', visible: isGerenteOuAdmin && !!account },
    { id: 'meta', label: 'Meta', icon: <Activity size={16} />, status: account?.meta_capi_enabled ? 'Pixel ativo' : 'Pixel desligado', visible: isGerenteOuAdmin && !!account },
    { id: 'ia', label: 'IA', icon: <Bot size={16} />, status: hasAiKey ? 'Chave configurada' : 'Falta a chave', visible: isGerenteOuAdmin && !!account && !!account.ai_agents_enabled },
  ]
  const visible = tiles.filter(t => t.visible)
  const requested = searchParams.get('card')
  const current: CardId = visible.find(t => t.id === requested)?.id || 'whatsapp'

  return (
    <div>
      <div className="page-header">
        <h1><Plug size={20} style={{ marginRight: 8 }} />Integrações</h1>
      </div>

      {isAtendente && !user?.primary_instance_id && (
        <BlockedBanner message="Você ainda não tem WhatsApp atribuído. Peça ao gerente para atribuir em Equipe > Editar, ou conecte um número abaixo (você vira o dono automaticamente)." />
      )}

      {visible.length > 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
          {visible.map(t => (
            <button
              key={t.id}
              type="button"
              className="card"
              onClick={() => setSearchParams({ card: t.id }, { replace: true })}
              style={{ textAlign: 'left', padding: '12px 14px', cursor: 'pointer', border: `1px solid ${current === t.id ? 'var(--accent)' : 'var(--border-subtle)'}`, background: current === t.id ? 'rgba(255,179,0,0.06)' : undefined }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: current === t.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                {t.icon} {t.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t.status}</div>
            </button>
          ))}
        </div>
      )}

      {current === 'whatsapp' && (
        <WhatsAppCard accountId={accountId} instances={instances} setInstances={setInstances} reload={reloadInstances} users={users} loadError={instancesError} />
      )}
      {current === 'leads' && account && (
        <LeadIntakeCard accountId={accountId} account={account} instances={instances} users={users} />
      )}
      {current === 'meta' && account && (
        <MetaCard accountId={accountId} account={account} onAccountUpdated={updateAccountLocal} />
      )}
      {current === 'ia' && account && (
        <AiCard accountId={accountId} account={account} isSuperAdmin={user?.role === 'super_admin'} onAccountUpdated={updateAccountLocal} />
      )}

    </div>
  )
}

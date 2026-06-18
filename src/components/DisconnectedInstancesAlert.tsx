import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Smartphone, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchWhatsAppInstances, type WhatsAppInstance } from '../lib/api'

// Alerta de instancias DESCONECTADAS pra gerente/admin.
//
// Comportamento "inteligente" (jun/2026, ajuste depois de o popup ficar piscando):
// 1. Filtra SO status='disconnected' (ignora connecting/qr_pending — sao transitorios)
// 2. Dismiss persiste por 30min em localStorage (nao por sessao)
// 3. Quando dismiss, guarda o CONJUNTO de IDs dispensados. Nao reabre se conjunto so
//    diminui ou trocou ordem — so reabre se inst NOVA cair (id nao estava no dismiss)
//    OU se passou a janela de 30min.
const STORAGE_KEY = 'dros_disc_instances_dismissed_v2'
const DISMISS_WINDOW_MS = 30 * 60 * 1000  // 30 minutos
const CHECK_INTERVAL_MS = 60_000

type DismissState = {
  accountId: number
  at: number  // timestamp
  ids: number[]
}

function loadDismiss(): DismissState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.at !== 'number' || !Array.isArray(parsed?.ids)) return null
    return parsed as DismissState
  } catch { return null }
}

function saveDismiss(state: DismissState | null) {
  try {
    if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export default function DisconnectedInstancesAlert() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const navigate = useNavigate()
  const [disconnected, setDisconnected] = useState<WhatsAppInstance[]>([])
  const [dismiss, setDismiss] = useState<DismissState | null>(loadDismiss)

  const isManager = user?.role === 'gerente' || user?.role === 'super_admin'

  useEffect(() => {
    if (!isManager || !accountId) { setDisconnected([]); return }
    let cancelled = false
    const check = () => {
      fetchWhatsAppInstances(accountId)
        .then(list => {
          if (cancelled) return
          // SO disconnected — ignora connecting/qr_pending/etc. (transitorios)
          setDisconnected(list.filter(i => i.status === 'disconnected'))
        })
        .catch(() => {})
    }
    check()
    const t = setInterval(check, CHECK_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(t) }
  }, [isManager, accountId])

  if (!isManager || disconnected.length === 0) return null

  const currentIds = disconnected.map(i => i.id).sort((a, b) => a - b)
  const now = Date.now()

  // Avalia se dismiss ainda eh valido pra ESSA conta
  const dismissActive = !!(
    dismiss &&
    dismiss.accountId === accountId &&
    (now - dismiss.at) < DISMISS_WINDOW_MS
  )

  if (dismissActive) {
    // So reabre se houver alguma inst NOVA caida que NAO estava no conjunto dispensado
    const dismissedSet = new Set(dismiss!.ids)
    const hasNewlyDisconnected = currentIds.some(id => !dismissedSet.has(id))
    if (!hasNewlyDisconnected) return null
  }

  const handleDismiss = () => {
    const next: DismissState = { accountId: accountId!, at: Date.now(), ids: currentIds }
    saveDismiss(next)
    setDismiss(next)
  }

  const goToIntegrations = () => {
    handleDismiss()
    navigate('/integrations')
  }

  return (
    <div className="modal-overlay" onClick={handleDismiss}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 18 }}>
            <AlertTriangle size={20} style={{ color: '#FF6B6B' }} />
            {disconnected.length === 1 ? 'WhatsApp desconectado' : `${disconnected.length} WhatsApps desconectados`}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={handleDismiss} title="Fechar"><X size={14} /></button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {disconnected.length === 1
            ? 'O numero abaixo esta offline e nao envia/recebe mensagens. Reconecte pra voltar a operar.'
            : 'Os numeros abaixo estao offline e nao enviam/recebem mensagens. Reconecte pra voltar a operar.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {disconnected.map(inst => (
            <div key={inst.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: 'rgba(255,107,107,0.08)',
              border: '1px solid rgba(255,107,107,0.25)',
              borderRadius: 6,
            }}>
              <Smartphone size={16} style={{ color: '#FF6B6B', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{inst.instance_name}</div>
                {inst.phone_number && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{inst.phone_number}</div>
                )}
              </div>
              <span style={{ fontSize: 11, color: '#FF6B6B', fontWeight: 600 }}>Desconectado</span>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={handleDismiss}>Lembrar mais tarde</button>
          <button className="btn btn-primary" onClick={goToIntegrations}>Ir pra Integracoes</button>
        </div>
      </div>
    </div>
  )
}

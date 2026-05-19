import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Smartphone, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchWhatsAppInstances, type WhatsAppInstance } from '../lib/api'

// Mostra um popup pra gerente/admin quando alguma instancia WhatsApp da conta esta desconectada.
// Re-checa a cada 60s. Dispensa por sessao (sessionStorage) por accountId+conjunto-de-instancias —
// se uma NOVA instancia cair depois, o popup volta a aparecer.
const DISMISS_KEY = 'dros_disc_instances_dismissed'

export default function DisconnectedInstancesAlert() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const navigate = useNavigate()
  const [disconnected, setDisconnected] = useState<WhatsAppInstance[]>([])
  const [dismissedKey, setDismissedKey] = useState<string>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) || '' } catch { return '' }
  })

  const isManager = user?.role === 'gerente' || user?.role === 'super_admin'

  useEffect(() => {
    if (!isManager || !accountId) { setDisconnected([]); return }
    let cancelled = false
    const check = () => {
      fetchWhatsAppInstances(accountId)
        .then(list => {
          if (cancelled) return
          setDisconnected(list.filter(i => i.status !== 'connected'))
        })
        .catch(() => {})
    }
    check()
    const t = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [isManager, accountId])

  if (!isManager || disconnected.length === 0) return null

  const currentKey = `${accountId}-${disconnected.map(i => i.id).sort((a, b) => a - b).join(',')}`
  if (currentKey === dismissedKey) return null

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, currentKey) } catch {}
    setDismissedKey(currentKey)
  }

  const goToIntegrations = () => {
    dismiss()
    navigate('/integrations')
  }

  return (
    <div className="modal-overlay" onClick={dismiss}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 18 }}>
            <AlertTriangle size={20} style={{ color: '#FF6B6B' }} />
            {disconnected.length === 1 ? 'WhatsApp desconectado' : `${disconnected.length} WhatsApps desconectados`}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={dismiss} title="Fechar"><X size={14} /></button>
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
          <button className="btn btn-secondary" onClick={dismiss}>Lembrar mais tarde</button>
          <button className="btn btn-primary" onClick={goToIntegrations}>Ir pra Integracoes</button>
        </div>
      </div>
    </div>
  )
}

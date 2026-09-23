import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Smartphone } from 'lucide-react'
import { fetchSendNumberStatus, type SendNumberStatus } from '../lib/api'
import { sendStatusMessage } from '../lib/antiban.js'

// Numero de saida dos envios automaticos (spec secoes 9 e 11). onStatus permite a tela bloquear o botao de envio.
// refreshKey: quando muda (ex.: numeros conectados/padrao trocado), busca o status de novo sem recarregar a pagina.
export default function SendNumberBanner({ accountId, onStatus, refreshKey }: { accountId: number; onStatus?: (s: SendNumberStatus) => void; refreshKey?: string }) {
  const [status, setStatus] = useState<SendNumberStatus | null>(null)
  useEffect(() => {
    let alive = true
    fetchSendNumberStatus(accountId).then(s => { if (alive) { setStatus(s); onStatus?.(s) } }).catch(() => {})
    return () => { alive = false }
  }, [accountId, refreshKey])
  if (!status) return null
  if (status.ok && status.instance) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--positive)' }}>
        <Smartphone size={14} /> Sai por: <strong>{status.instance.instance_name}</strong>
      </div>
    )
  }
  const offline = status.reason === 'send_number_offline'
  const color = offline ? 'var(--negative)' : 'var(--text-muted)'
  return (
    <div role="status" style={{
      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', padding: '10px 12px',
      borderRadius: 'var(--radius-sm)', fontSize: 13, lineHeight: 1.5,
      background: offline ? 'var(--negative-bg)' : 'var(--bg-hover)',
      border: `1px solid ${offline ? color : 'var(--border-subtle)'}`,
    }}>
      <span style={{ color: offline ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{sendStatusMessage(status.reason)}</span>
      <Link to="/integrations" style={{ color, flexShrink: 0 }}>Ir para Integrações</Link>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchAiKeyStatus } from '../lib/roteiroApi'

const HIDE_KEY = 'ai_key_banner_hidden_until'
const DAY_MS = 86400000

function hiddenNow(accountId: number) {
  try { return Number(localStorage.getItem(`${HIDE_KEY}_${accountId}`) || 0) > Date.now() } catch { return false }
}

// Faixa "Conecte sua chave de IA" (spec 2026-10-05 crm simples §7): so gestor/admin, conta sem chave
// propria e sem IA global. [Fechar] esconde por 24 h.
export default function AiKeyBanner() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [show, setShow] = useState(false)
  const isManager = user?.role === 'gerente' || user?.role === 'super_admin'

  useEffect(() => {
    setShow(false)
    if (!isManager || !accountId || hiddenNow(accountId)) return
    let alive = true
    fetchAiKeyStatus(accountId).then(s => { if (alive) setShow(!!s.needs_key) }).catch(() => {})
    return () => { alive = false }
  }, [isManager, accountId])

  if (!show || !accountId) return null
  const close = () => {
    try { localStorage.setItem(`${HIDE_KEY}_${accountId}`, String(Date.now() + DAY_MS)) } catch {}
    setShow(false)
  }
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', fontSize: 13, background: 'var(--warning-bg, #FEF3C7)', borderBottom: '1px solid var(--warning, #D97706)', color: 'var(--text-primary)' }}>
      <Sparkles size={14} style={{ color: 'var(--warning, #D97706)', flexShrink: 0 }} />
      <span style={{ flex: 1 }}>Conecte sua chave de IA para a IA continuar trabalhando (ler as conversas, identificar o tipo de cliente, sugerir melhorias). Ex.: Integrações &gt; IA.</span>
      <Link to="/integrations" className="btn btn-primary btn-sm">Conectar</Link>
      <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Fechar aviso" title="Fechar por hoje" onClick={close}><X size={12} /></button>
    </div>
  )
}

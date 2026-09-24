import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Info, CheckCircle2, X } from 'lucide-react'
import { fetchSystemNotice, type SystemNotice } from '../lib/api'
import { useSSE } from '../context/SSEContext'

const DISMISSED_KEY = 'dros_crm_dismissed_notices'

function getDismissedIds(): number[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}
function addDismissedId(id: number) {
  try {
    const ids = getDismissedIds()
    if (!ids.includes(id)) ids.push(id)
    // Mantem so os ultimos 20 pra nao inflar
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-20)))
  } catch {}
}

export default function SystemNoticeBanner() {
  const [notice, setNotice] = useState<SystemNotice | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Busca inicial ao montar (pra pegar aviso ativo se o user entrou depois do broadcast)
  useEffect(() => {
    fetchSystemNotice().then(r => {
      if (r.notice) {
        const dismissedIds = getDismissedIds()
        if (!dismissedIds.includes(r.notice.id)) {
          setNotice(r.notice)
          setDismissed(false)
        }
      }
    }).catch(() => {})
  }, [])

  // Escuta broadcasts em tempo real via SSE
  const onNotice = useCallback((data: SystemNotice | null) => {
    if (!data) { setNotice(null); return }
    const dismissedIds = getDismissedIds()
    if (!dismissedIds.includes(data.id)) {
      setNotice(data)
      setDismissed(false)
    }
  }, [])
  useSSE('system:notice', onNotice)

  // Auto-esconde quando expira
  useEffect(() => {
    if (!notice) return
    const remainingMs = notice.expiresAt - Date.now()
    if (remainingMs <= 0) { setNotice(null); return }
    const timer = setTimeout(() => setNotice(null), remainingMs)
    return () => clearTimeout(timer)
  }, [notice])

  // Empurra o body pra baixo enquanto banner esta visivel — evita sobrescrever sidebar/conteudo
  useEffect(() => {
    const isVisible = notice && !dismissed
    if (isVisible) {
      const prevPaddingTop = document.body.style.paddingTop
      document.body.style.paddingTop = '68px'
      document.body.style.transition = 'padding-top 0.3s ease-out'
      return () => { document.body.style.paddingTop = prevPaddingTop }
    }
  }, [notice, dismissed])

  if (!notice || dismissed) return null

  const config = {
    info: { bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.55)', color: '#60a5fa', icon: Info },
    warning: { bg: 'rgba(251,191,36,0.14)', border: 'rgba(251,191,36,0.55)', color: '#fbbf24', icon: AlertTriangle },
    success: { bg: 'rgba(52,199,89,0.14)', border: 'rgba(52,199,89,0.55)', color: '#34C759', icon: CheckCircle2 },
  }[notice.type] || { bg: 'rgba(59,130,246,0.14)', border: 'rgba(59,130,246,0.55)', color: '#60a5fa', icon: Info }
  const Icon = config.icon

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0,
        background: config.bg,
        borderBottom: `2px solid ${config.border}`,
        padding: '12px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 9999,
        backdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        animation: 'slideDown 0.3s ease-out',
      }}
    >
      <style>{`
        @keyframes slideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
      <Icon size={22} style={{ color: config.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {notice.title && (
          <div style={{ fontSize: 13, fontWeight: 700, color: config.color, marginBottom: 2 }}>
            {notice.title}
          </div>
        )}
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4 }}>
          {notice.message}
        </div>
      </div>
      <button
        onClick={() => { addDismissedId(notice.id); setDismissed(true) }}
        title="Fechar aviso"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <X size={18} />
      </button>
    </div>
  )
}

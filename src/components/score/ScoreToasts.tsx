import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, MessageCircle } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useSSE } from '../../context/SSEContext'
import { BAND_META, isScoreBand, type ScoreBand } from '../../lib/score'

// Aviso "lead esquentou" (spec 5.5): SSE lead:score_up -> toast so para o atendente do lead
// (ou gerente/admin quando o lead esta sem atendente). Some em 12 s; no maximo 3 na tela.
// Aviso "lead quente sem resposta": SSE lead:hot_alert -> gerente/admin e o atendente do lead
// (chega mesmo sem a Analise de Atendimentos ligada).
interface ScoreUp { lead_id: number; name: string | null; score: number; band: string; attendant_id: number | null }
interface HotAlert { lead_id: number; name: string | null; band: string; minutes: number; capped?: boolean; attendant_id: number | null }
type Toast =
  | { key: number; kind: 'up'; leadId: number; name: string; score: number; band: ScoreBand }
  | { key: number; kind: 'hot'; leadId: number; name: string; minutes: number; capped: boolean; band: ScoreBand }

const TOAST_MS = 12000
const MAX_TOASTS = 3

export default function ScoreToasts() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((key: number) => {
    setToasts(prev => prev.filter(t => t.key !== key))
    const t = timers.current.get(key)
    if (t) { clearTimeout(t); timers.current.delete(key) }
  }, [])

  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  // Mesmo lead de novo: troca o aviso antigo pelo novo. Timer de aviso que ja saiu so limpa o mapa.
  const push = useCallback((toast: Toast) => {
    setToasts(prev => [...prev.filter(t => t.leadId !== toast.leadId), toast].slice(-MAX_TOASTS))
    timers.current.set(toast.key, setTimeout(() => dismiss(toast.key), TOAST_MS))
  }, [dismiss])

  const onScoreUp = useCallback((d: ScoreUp) => {
    if (!user || !d || !isScoreBand(d.band)) return
    const isManager = user.role === 'gerente' || user.role === 'super_admin'
    const mine = d.attendant_id != null ? d.attendant_id === user.id : isManager
    if (!mine) return
    push({ key: ++seq.current, kind: 'up', leadId: d.lead_id, name: d.name || 'Um lead', score: d.score, band: d.band })
  }, [user, push])
  useSSE('lead:score_up', onScoreUp)

  const onHotAlert = useCallback((d: HotAlert) => {
    if (!user || !d || !isScoreBand(d.band)) return
    const isManager = user.role === 'gerente' || user.role === 'super_admin'
    if (!isManager && d.attendant_id !== user.id) return
    push({ key: ++seq.current, kind: 'hot', leadId: d.lead_id, name: d.name || 'Um lead', minutes: d.minutes, capped: !!d.capped, band: d.band })
  }, [user, push])
  useSSE('lead:hot_alert', onHotAlert)

  if (toasts.length === 0) return null

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 9500, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'calc(100vw - 32px)', width: 360 }} aria-live="polite">
      {toasts.map(t => {
        const meta = BAND_META[t.band]
        const Icon = meta.icon
        return (
          <div key={t.key} role="status" style={{ background: 'var(--bg-card)', border: `1px solid ${meta.color}55`, borderLeft: `4px solid ${meta.color}`, borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: '10px 12px', color: 'var(--text-primary)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Icon size={18} style={{ color: meta.color, flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1, fontSize: 13, lineHeight: 1.45 }}>
                {t.kind === 'up' ? (
                  <><strong>{t.name}</strong> passou para <strong style={{ color: meta.color }}>{meta.label}</strong> ({t.score}). Responda agora — quem responde em até 1 hora vende muito mais.</>
                ) : (
                  <><strong>{t.name}</strong> está <strong style={{ color: meta.color }}>{meta.label}</strong> e sem resposta há {t.capped ? 'mais de ' : ''}{t.minutes} min.</>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.key)} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, lineHeight: 0 }}>
                <X size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { dismiss(t.key); navigate(`/chat?lead_id=${t.leadId}`) }}>
                <MessageCircle size={12} /> Abrir conversa
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

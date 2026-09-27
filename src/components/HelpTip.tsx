import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HelpCircle, X } from 'lucide-react'

// Ajuda "?" ao lado de titulos: clique abre um balao com a explicacao (com exemplo).
// Fecha com clique fora, Esc, rolagem ou no X. Balao em position fixed para nao ser cortado
// por paineis com rolagem (ex.: painel do lead no Chat).
interface Props {
  title?: string
  children: ReactNode
  size?: number
  width?: number
}

export default function HelpTip({ title, children, size = 13, width = 280 }: Props) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const open = pos !== null

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (open) { setPos(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const w = Math.min(width, window.innerWidth - 16)
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))
    // Abaixo do "?"; se nao couber embaixo, abre acima
    const below = r.bottom + 6
    const top = below + 160 > window.innerHeight && r.top > 180 ? Math.max(8, r.top - 6 - 160) : below
    setPos({ top, left })
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => {
      const t = e.target as Node
      if (boxRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setPos(null)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    const onScroll = (e: Event) => { if (!boxRef.current?.contains(e.target as Node)) setPos(null) }
    const onResize = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={title ? `Ajuda: ${title}` : 'Ajuda'}
        aria-expanded={open}
        title={title ? `O que é "${title}"?` : 'Ajuda'}
        style={{ background: 'none', border: 'none', padding: 2, margin: 0, cursor: 'pointer', color: open ? 'var(--accent)' : 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', lineHeight: 0 }}
      >
        <HelpCircle size={size} />
      </button>
      {open && pos && (
        <div
          ref={boxRef}
          role="dialog"
          aria-label={title || 'Ajuda'}
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16), zIndex: 10000,
            background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8,
            boxShadow: 'var(--shadow-lg)', padding: '10px 12px', color: 'var(--text-secondary)',
            fontSize: 12, lineHeight: 1.5, textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, textAlign: 'left', whiteSpace: 'normal',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: title ? 4 : 0 }}>
            {title && <strong style={{ color: 'var(--text-primary)', fontSize: 12 }}>{title}</strong>}
            <button type="button" onClick={() => setPos(null)} aria-label="Fechar ajuda" style={{ background: 'none', border: 'none', padding: 0, marginLeft: 'auto', cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 0 }}>
              <X size={12} />
            </button>
          </div>
          <div>{children}</div>
        </div>
      )}
    </>
  )
}

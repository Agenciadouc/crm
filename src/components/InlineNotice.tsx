import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { errorNotice, successNotice, noticeAutoHideMs, type Notice } from '../lib/inlineNotice.js'

// Faixa de aviso dentro do card (substitui o alert() do navegador): erro em vermelho, sucesso em verde.
export function InlineNotice({ notice, onClose, style }: { notice: Notice | null; onClose: () => void; style?: CSSProperties }) {
  if (!notice) return null
  const isError = notice.kind === 'error'
  const color = isError ? 'var(--negative)' : 'var(--positive)'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginBottom: 12, borderRadius: 'var(--radius-sm)',
        background: isError ? 'var(--negative-bg)' : 'var(--positive-bg)', border: `1px solid ${color}`, fontSize: 13, lineHeight: 1.5, textAlign: 'left',
        ...style,
      }}
    >
      {isError
        ? <AlertCircle size={16} style={{ color, flexShrink: 0, marginTop: 2 }} />
        : <CheckCircle2 size={16} style={{ color, flexShrink: 0, marginTop: 2 }} />}
      <div style={{ flex: 1, color: 'var(--text-primary)', whiteSpace: 'pre-line' }}>{notice.text}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar aviso"
        title="Fechar"
        style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  )
}

// Estado do aviso: showError('Erro ao salvar', e) / showSuccess('Salvo.'); o de sucesso some sozinho.
export function useInlineNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  useEffect(() => {
    const ms = noticeAutoHideMs(notice)
    if (ms == null) return
    const t = setTimeout(() => setNotice(cur => cur === notice ? null : cur), ms)
    return () => clearTimeout(t)
  }, [notice])
  const showError = useCallback((prefix: string, err?: unknown) => setNotice(errorNotice(prefix, err)), [])
  const showSuccess = useCallback((text: string) => setNotice(successNotice(text)), [])
  const clear = useCallback(() => setNotice(null), [])
  return { notice, showError, showSuccess, clear }
}

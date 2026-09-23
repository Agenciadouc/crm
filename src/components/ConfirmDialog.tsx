import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  busyLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Modal de confirmacao do CRM (substitui o confirm() do navegador). Mesmo visual do modal de excluir numero.
export default function ConfirmDialog({ title, children, confirmLabel, busyLabel, cancelLabel = 'Cancelar', danger, busy, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay" onClick={() => !busy && onCancel()}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>{title}</h2>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>{children}</div>
        <div className="modal-actions" style={{ marginTop: 20 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
          <button
            className={danger ? 'btn' : 'btn btn-primary'}
            disabled={busy}
            onClick={onConfirm}
            style={danger ? { background: '#ef4444', color: 'white', border: 'none' } : undefined}
            autoFocus
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

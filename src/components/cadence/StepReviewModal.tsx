import { useEffect, useState } from 'react'
import { Send, Smartphone } from 'lucide-react'
import { canSendReview } from '../../lib/atendimentoPanel.js'

// Janela "Conferir mensagem": o vendedor ve (e pode mudar) o texto do passo da cadencia antes de enviar.
// [Cancelar] (ou Esc) nao envia nem marca nada; clicar fora nao fecha. Erro de envio mostra a mensagem e mantem o texto.
interface Props {
  title: string
  initialText: string
  leadName: string
  instanceName: string | null // instancia que o envio do Chat vai usar agora
  noInstanceMessage: string // aviso quando nao ha instancia escolhida
  sending: boolean
  error: string | null
  onCancel: () => void
  onSend: (text: string) => void
}

export default function StepReviewModal({ title, initialText, leadName, instanceName, noInstanceMessage, sending, error, onCancel, onSend }: Props) {
  const [text, setText] = useState(initialText)
  const canSend = canSendReview({ text, hasInstance: !!instanceName, sending })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sending, onCancel])

  return (
    // Clique fora NAO fecha: o texto editado nao pode sumir sem querer. So [Cancelar] e Esc fecham.
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-label={title} onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Send size={16} style={{ color: '#FFB300' }} /> {title}
        </h2>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Para <b style={{ color: 'var(--text-primary)' }}>{leadName}</b>. Confira o texto e mude se precisar.
        </div>
        <textarea
          className="input"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={7}
          autoFocus
          disabled={sending}
          placeholder="ex.: Oi Ana, para quando é o seu evento?"
          style={{ marginTop: 10, width: '100%', fontSize: 13, resize: 'vertical', minHeight: 130, lineHeight: 1.5, fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}
        />
        <div style={{ marginTop: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, color: instanceName ? 'var(--text-secondary)' : '#FBBC04' }}>
          <Smartphone size={12} />
          {instanceName ? <span>Vai por: <b style={{ color: '#FFB300' }}>{instanceName}</b></span> : <span>{noInstanceMessage}</span>}
        </div>
        {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>{error}</div>}
        <div className="modal-actions" style={{ marginTop: 14 }}>
          <button className="btn btn-secondary" onClick={onCancel} disabled={sending}>Cancelar</button>
          <button className="btn btn-primary" onClick={() => onSend(text)} disabled={!canSend}>
            <Send size={14} /> {sending ? 'Enviando...' : 'Enviar agora'}
          </button>
        </div>
      </div>
    </div>
  )
}

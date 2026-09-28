import { AlertTriangle, Bot, CheckCircle2, Send, Undo2, X } from 'lucide-react'
import type { ActiveDeviation, RoteiroOffscript } from '../../lib/roteiroApi'

// Avisos do roteiro usados pelo RoteiroCard (ficha) e pelo cartao "Proximo passo" (Chat):
// avanco automatico com [Desfazer], desvio detectado e pergunta fora do roteiro vista pela IA.
const smallBtn = { fontSize: 10, padding: '2px 8px' }

export function AdvanceBanner({ toName, fromName, undoing, onUndo }: { toName: string; fromName: string; undoing: boolean; onUndo: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--positive-bg)', color: 'var(--positive)', fontSize: 11, lineHeight: 1.45 }}>
      <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1 }}>
        Avançou para '{toName}' — todas as perguntas de '{fromName || 'etapa anterior'}' respondidas.
      </span>
      <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} disabled={undoing} onClick={onUndo}>
        <Undo2 size={10} /> {undoing ? 'Desfazendo...' : 'Desfazer'}
      </button>
    </div>
  )
}

export function DeviationBox({ deviation, onUse, title }: { deviation: ActiveDeviation; onUse: (text: string) => void; title?: string }) {
  return (
    <div style={{ padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--warning)' }}>
        <AlertTriangle size={11} /> {title ?? 'Desvio detectado'}
      </div>
      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{title ? '→ sugestão:' : 'O cliente saiu do roteiro. Resposta sugerida:'}</div>
      <div style={{ color: 'var(--text-primary)', marginTop: 2 }}>{deviation.reply_text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" style={smallBtn} onClick={() => onUse(deviation.reply_text)}>
          <Send size={10} /> Usar
        </button>
        {deviation.return_question_text && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>volta para: {deviation.return_question_text}</span>
        )}
      </div>
    </div>
  )
}

export function OffscriptBox({ offscript, onUse, onClose }: { offscript: RoteiroOffscript; onUse: (text: string) => void; onClose: () => void }) {
  return (
    <div style={{ padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--info-bg)', border: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--info)' }}>
        <Bot size={11} /> A IA viu uma pergunta fora do roteiro
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onClose} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={11} /></button>
      </div>
      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>O cliente perguntou: <i>"{offscript.question}"</i></div>
      {offscript.suggested_reply && (
        <>
          <div style={{ color: 'var(--text-primary)', marginTop: 2 }}>{offscript.suggested_reply}</div>
          <button type="button" className="btn btn-primary btn-sm" style={{ ...smallBtn, marginTop: 4 }} onClick={() => onUse(offscript.suggested_reply)}>
            <Send size={10} /> Usar
          </button>
        </>
      )}
    </div>
  )
}

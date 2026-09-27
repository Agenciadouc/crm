import { Check, ListChecks } from 'lucide-react'
import { displayQuestionText } from '../../lib/roteiroView.js'

// Barra acima da caixa de mensagem (spec 4.1 "Reconhecimento"): a mensagem digitada parece
// uma pergunta pendente do roteiro. Sim registra a pergunta como enviada.
interface Props {
  question: { question_key: string; text: string }
  busy?: boolean
  onYes: () => void
  onNo: () => void
}

export default function RecognizedQuestionBar({ question, busy, onYes, onNo }: Props) {
  return (
    <div style={{ padding: '6px 12px', fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', background: 'var(--info-bg)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <ListChecks size={13} style={{ color: 'var(--info)', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>Você perguntou '{displayQuestionText(question.text)}'?</span>
      <button type="button" className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '2px 10px' }} disabled={busy} onClick={onYes}>
        <Check size={11} /> Sim
      </button>
      <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '2px 10px' }} disabled={busy} onClick={onNo}>
        Não
      </button>
    </div>
  )
}

import { useState } from 'react'
import { Check } from 'lucide-react'
import type { RoteiroOption, RoteiroQuestionKind } from '../../lib/roteiroApi'

// Responder uma pergunta do roteiro: texto (caixa com exemplo) ou opcoes (um botao por opcao).
// Usado no cartao do roteiro e na janela "Falta saber".
interface Props {
  kind: RoteiroQuestionKind
  options: RoteiroOption[]
  initialText?: string | null
  currentOption?: string | null
  saving: boolean
  error?: string | null
  onSave: (body: { option_key?: string; answer_text?: string }) => void
  onCancel: () => void
}

export default function AnswerEditor({ kind, options, initialText, currentOption, saving, error, onSave, onCancel }: Props) {
  const [text, setText] = useState(initialText || '')

  const errorLine = error ? <div style={{ fontSize: 11, color: 'var(--negative)', marginTop: 4 }}>{error}</div> : null

  if (kind === 'options') {
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {options.map(o => {
            const active = o.option_key === currentOption
            return (
              <button
                key={o.option_key}
                type="button"
                className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '3px 8px' }}
                disabled={saving}
                onClick={() => onSave({ option_key: o.option_key })}
              >
                {active && <Check size={10} />} {o.label}
              </button>
            )
          })}
          <button type="button" className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 8px' }} disabled={saving} onClick={onCancel}>Cancelar</button>
        </div>
        {errorLine}
      </div>
    )
  }

  const save = () => { if (text.trim() && !saving) onSave({ answer_text: text.trim() }) }
  return (
    <div style={{ marginTop: 6 }}>
      <textarea
        className="input"
        autoFocus
        rows={2}
        maxLength={1000}
        placeholder="ex.: quer para o casamento em março"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } if (e.key === 'Escape') onCancel() }}
        style={{ width: '100%', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
        disabled={saving}
      />
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        <button type="button" className="btn btn-sm btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} disabled={saving || !text.trim()} onClick={save}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
        <button type="button" className="btn btn-sm btn-secondary" style={{ fontSize: 11, padding: '3px 10px' }} disabled={saving} onClick={onCancel}>Cancelar</button>
      </div>
      {errorLine}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import HelpTip from '../../components/HelpTip'
import { fetchRoteiroSettings, saveRoteiroSettings, type RoteiroSettings } from '../../lib/roteiroApi'
import { labelStyle } from './StepPanel'

export interface StageSettingsProps { accountId: number; onClose: () => void; onSaved: (s: RoteiroSettings) => void }

type Form = { min_reply_rate: string; reply_window_h: string; alert_minutes: string }
const FIELDS: { key: keyof Form; label: string; placeholder: string; help: string }[] = [
  { key: 'min_reply_rate', label: 'Resposta mínima (%)', placeholder: 'ex.: 70', help: 'Abaixo disso o passo aparece como "fraca". Ex.: 70% = de cada 10 clientes que recebem a pergunta, pelo menos 7 respondem.' },
  { key: 'reply_window_h', label: 'Prazo para responder (horas)', placeholder: 'ex.: 24', help: 'Resposta depois disso não conta na taxa. Ex.: 24h = o cliente respondeu até o dia seguinte.' },
  { key: 'alert_minutes', label: 'Aviso de lead quente (minutos)', placeholder: 'ex.: 60', help: 'Lead quente sem resposta do vendedor por mais que isso gera aviso. Ex.: 60 = avisa depois de 1 hora sem resposta.' },
]

// Popover do icone de engrenagem: os 3 numeros do roteiro, salvos juntos.
export default function StageSettings({ accountId, onClose, onSaved }: StageSettingsProps) {
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchRoteiroSettings(accountId)
      .then(s => setForm({ min_reply_rate: String(s.min_reply_rate), reply_window_h: String(s.reply_window_h), alert_minutes: String(s.alert_minutes) }))
      .catch(e => setError(e instanceof Error ? e.message : 'Erro ao carregar.'))
  }, [accountId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      // o balao do HelpTip fica fora do popover (position fixed): clicar nele nao fecha
      if (boxRef.current?.contains(t) || t.closest?.('[role="dialog"]')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [onClose])

  const save = async () => {
    if (!form) return
    setSaving(true); setError(null)
    try {
      const s = await saveRoteiroSettings(accountId, {
        min_reply_rate: Number(form.min_reply_rate), reply_window_h: Number(form.reply_window_h), alert_minutes: Number(form.alert_minutes),
      })
      onSaved(s)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={boxRef} role="group" aria-label="Configurações do roteiro"
      style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, width: 'min(300px, calc(100vw - 32px))', background: 'var(--bg-card)',
        border: '1px solid var(--border-medium)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: 14, display: 'grid', gap: 10 }}>
      {!form && !error && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando…</div>}
      {form && FIELDS.map(f => (
        <div key={f.key} style={{ display: 'grid', gap: 4 }}>
          <span style={labelStyle}>
            <label htmlFor={`set-${f.key}`}>{f.label}</label>
            <HelpTip title={f.label}>{f.help}</HelpTip>
          </span>
          <input id={`set-${f.key}`} type="number" className="input" value={form[f.key]} placeholder={f.placeholder}
            onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
        </div>
      ))}
      {error && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</div>}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Fechar</button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!form || saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </div>
  )
}

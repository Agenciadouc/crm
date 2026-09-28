import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import HelpTip from '../../components/HelpTip'
import { applySuggestionLive, saveStageDeviations } from '../../lib/cadenceApi'
import { suggestionAction, type RoteiroDeviation, type RoteiroSuggestion } from '../../lib/roteiroApi'
import { createSaveQueue, readyDeviations, type SaveStatus } from '../../lib/stageCadence.js'
import { suggestionWhy } from '../../lib/roteiroManager.js'
import { SaveStatusText, labelStyle, hintStyle } from './StepPanel'

export interface StageDeviationsProps {
  accountId: number; funnelId: number; deviations: RoteiroDeviation[]
  questions: { question_key: string; text: string; stage_id: number }[]
  suggestions: RoteiroSuggestion[] // deviationSuggestions
  onSaved: (deviations: RoteiroDeviation[]) => void; onChanged: () => void
}

type Item = { _k: number; triggers: string; reply_text: string; return_question_key: string | null }
let seq = 0
const toItems = (list: RoteiroDeviation[]): Item[] => (list || []).map(d => ({ _k: ++seq, triggers: d.triggers, reply_text: d.reply_text, return_question_key: d.return_question_key }))

// "Se o cliente perguntar…": desvios do funil (recolhido), com salvar automatico.
// Montado com key pelo funil: a lista local guarda os itens incompletos entre recargas.
export default function StageDeviations({ accountId, funnelId, deviations, questions, suggestions, onSaved, onChanged }: StageDeviationsProps) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Item[]>(() => toItems(deviations))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [sugError, setSugError] = useState<Record<number, string>>({})
  const resync = useRef(false)
  const cb = useRef(onSaved)
  cb.current = onSaved

  const [queue] = useState(() => createSaveQueue<RoteiroDeviation[]>({
    onStatus: setStatus,
    save: async ready => {
      setSaveError(null)
      try {
        const r = await saveStageDeviations(funnelId, accountId, ready)
        cb.current(r.deviations)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Erro ao salvar.')
        throw e
      }
    },
  }))
  useEffect(() => () => { queue.flush() }, [queue])

  // Sugestao aplicada: a lista do servidor ganhou um desvio; traz para a tela quando nada esta salvando
  useEffect(() => {
    if (resync.current && !queue.busy()) { resync.current = false; setList(toItems(deviations)) }
  }, [deviations, queue])

  const change = (next: Item[]) => {
    setList(next)
    queue.push(readyDeviations(next).map((d, i) => ({ triggers: d.triggers.trim(), reply_text: d.reply_text.trim(), return_question_key: d.return_question_key || null, position: i })))
  }
  const setItem = (k: number, patch: Partial<Item>) => change(list.map(d => d._k === k ? { ...d, ...patch } : d))

  const sugAct = async (id: number, fn: () => Promise<unknown>, applied: boolean) => {
    setBusy(id)
    setSugError(m => ({ ...m, [id]: '' }))
    try {
      await queue.flush()
      await fn()
      if (applied) resync.current = true
      onChanged()
    } catch (e) {
      setSugError(m => ({ ...m, [id]: e instanceof Error ? e.message : 'Erro.' }))
    } finally {
      setBusy(null)
    }
  }

  const ready = readyDeviations(list).length

  return (
    <section className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Se o cliente perguntar… <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({ready})</span>
        </button>
        <HelpTip title="Se o cliente perguntar…">Respostas prontas para quando o cliente sai do roteiro. Ex.: se ele perguntar "quanto custa?", o vendedor vê a sugestão "Depende do número de convidados; me conta quantos são?" e volta para a pergunta do roteiro.</HelpTip>
        {suggestions.length > 0 && !open && <span style={{ fontSize: 12, color: 'var(--accent)' }}>A IA sugere um desvio novo</span>}
        <span style={{ marginLeft: 'auto' }}><SaveStatusText status={status} error={saveError} onRetry={() => { queue.retry() }} /></span>
      </div>

      {open && (
        <>
          {suggestions.map(s => {
            const p = s.payload || {}
            return (
              <div key={s.id} style={{ border: '1px dashed var(--border-accent)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'grid', gap: 4, fontSize: 13 }}>
                <strong style={{ fontSize: 12, color: 'var(--accent)' }}>A IA sugere um desvio novo:</strong>
                <div>Se o cliente escrever: <strong>{p.triggers}</strong></div>
                <div>Responda: <em>"{p.reply_text}"</em></div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{suggestionWhy(s)}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null} onClick={() => sugAct(s.id, () => applySuggestionLive(s.id, accountId), true)}>Aplicar</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => sugAct(s.id, () => suggestionAction(s.id, accountId, 'reject'), false)}>Ignorar</button>
                </div>
                {sugError[s.id] && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{sugError[s.id]}</div>}
              </div>
            )
          })}

          {list.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Nenhum desvio ainda. Ex.: quando o cliente perguntar de preço, sugerir "Depende do número de convidados" e voltar para a pergunta do orçamento.
            </div>
          )}

          {list.map(d => {
            const incomplete = !d.triggers.trim() || !d.reply_text.trim()
            return (
              <div key={d._k} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 0 }}>
                    <label style={labelStyle}>Palavras que o cliente usa</label>
                    <input className="input" value={d.triggers} placeholder="ex.: preço, valor, quanto custa" onChange={e => setItem(d._k, { triggers: e.target.value })} />
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Tirar desvio" title="Tirar desvio"
                    onClick={() => change(list.filter(x => x._k !== d._k))}><X size={12} /></button>
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={labelStyle}>Resposta sugerida</label>
                  <textarea className="input" rows={2} style={{ resize: 'vertical' }} value={d.reply_text} placeholder="ex.: Depende do número de convidados. Quantos são?"
                    onChange={e => setItem(d._k, { reply_text: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={labelStyle}>Depois volte para</label>
                  <select className="select" value={d.return_question_key || ''} onChange={e => setItem(d._k, { return_question_key: e.target.value || null })}>
                    <option value="">Nenhuma</option>
                    {questions.map(q => <option key={q.question_key} value={q.question_key}>{q.text}</option>)}
                  </select>
                </div>
                {incomplete && <div style={hintStyle}>Incompleto: preencha as palavras e a resposta para salvar.</div>}
              </div>
            )
          })}

          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setList(l => [...l, { _k: ++seq, triggers: '', reply_text: '', return_question_key: null }])}><Plus size={12} /> Desvio</button>
          </div>
        </>
      )}
    </section>
  )
}

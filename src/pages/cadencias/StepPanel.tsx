import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import {
  createStageCadence, addCadenceStep, updateCadenceStep, deleteCadenceStep,
  type CadenceStep, type StageCadence, type StepPatch, type StepSaveResult, type StepType,
} from '../../lib/cadenceApi'
import {
  createSaveQueue, formFromStep, saveStatusLabel, stepLabel, stepPatchFor, SPIN_OPTIONS,
  type SaveStatus, type StepForm, type OptionForm,
} from '../../lib/stageCadence.js'
import { STEP_ICONS } from './StepRow'

export type NewStep = { id: null; action_type: StepType; position: number }

export interface StepPanelProps {
  accountId: number
  stageId: number
  cadenceId: number | null // null = etapa sem cadencia ainda (cria no 1o salvamento)
  step: CadenceStep | NewStep // id null = passo novo
  onSaved: (r: StepSaveResult) => void // devolve a cadencia inteira atualizada
  onCreatedCadence: (cadence: StageCadence) => void
  // Cria (ou devolve) a cadencia da etapa; a pagina divide a mesma criacao entre paineis (sem 409)
  ensureCadence?: () => Promise<StageCadence>
  // Envio feito depois de sair do passo falhou: a pagina avisa
  onBackgroundError?: () => void
  onDeleted: (cadence: StageCadence) => void
  onClose?: () => void
  profiles?: { profile_key: string; name: string }[] // perfis de cliente ideal da conta
  children?: ReactNode // StepInsights embaixo
}

export const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 } as const
export const hintStyle = { fontSize: 12, color: 'var(--warning)' } as const

// "Salvando…" / "Salvo" / "Nao salvou. [Tentar de novo]" (spec 4.3). Usado no passo e nos desvios.
export function SaveStatusText({ status, error, onRetry }: { status: SaveStatus; error?: string | null; onRetry: () => void }) {
  if (status === 'salvando') return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{saveStatusLabel('salvando')}</span>
  if (status === 'salvo') return <span style={{ fontSize: 12, color: 'var(--positive)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Check size={12} /> {saveStatusLabel('salvo')}</span>
  if (status === 'erro') {
    return (
      <span style={{ fontSize: 12, color: 'var(--negative)', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {saveStatusLabel('erro')}{error ? ` ${error}` : ''}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Tentar de novo</button>
      </span>
    )
  }
  return null
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Erro ao salvar.')

// Painel de um passo com salvar automatico. Montado com key por passo aberto: o texto local
// nao e trocado por recargas da lista (SSE), e o passo novo continua no mesmo painel depois de criado.
export default function StepPanel({ accountId, stageId, cadenceId, step, onSaved, onCreatedCadence, ensureCadence, onBackgroundError, onDeleted, onClose, profiles = [], children }: StepPanelProps) {
  const type = step.action_type
  const [form, setForm] = useState<StepForm>(() => formFromStep(step as Partial<CadenceStep>))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [stepId, setStepId] = useState<number | null>(step.id)
  const stepIdRef = useRef<number | null>(step.id)
  const cadenceIdRef = useRef<number | null>(cadenceId)
  const cb = useRef({ onSaved, onCreatedCadence, ensureCadence, onBackgroundError })
  cb.current = { onSaved, onCreatedCadence, ensureCadence, onBackgroundError }
  const mounted = useRef(true)

  useEffect(() => { if (cadenceId != null) cadenceIdRef.current = cadenceId }, [cadenceId])

  // Uma fila por painel: nunca dois envios juntos, o ultimo texto vence.
  const [queue] = useState(() => createSaveQueue<StepPatch>({
    onStatus: s => {
      setStatus(s)
      if (s === 'erro' && !mounted.current) cb.current.onBackgroundError?.()
    },
    save: async patch => {
      setSaveError(null)
      try {
        if (cadenceIdRef.current == null) {
          const cad = await (cb.current.ensureCadence ? cb.current.ensureCadence() : createStageCadence(stageId, accountId))
          cadenceIdRef.current = cad.id
          cb.current.onCreatedCadence(cad)
        }
        if (stepIdRef.current == null) {
          const r = await addCadenceStep(cadenceIdRef.current, accountId, { action_type: type, position: step.position, ...patch })
          stepIdRef.current = r.step_id
          setStepId(r.step_id)
          cb.current.onSaved(r)
        } else {
          cb.current.onSaved(await updateCadenceStep(cadenceIdRef.current, stepIdRef.current, accountId, patch))
        }
      } catch (e) {
        setSaveError(errMsg(e))
        throw e
      }
    },
  }))
  // Saiu do passo: manda na hora o que falta, inclusive o texto que deu erro (retry, nao flush)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; queue.retry() }
  }, [queue])

  const change = (patch: Partial<StepForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    const built = stepPatchFor(type, next)
    if (!built.ok) { setHint(built.reason); return }
    setHint(null)
    queue.push(built.patch)
  }
  const setOption = (i: number, patch: Partial<OptionForm>) => change({ options: form.options.map((o, idx) => idx === i ? { ...o, ...patch } : o) })

  const doDelete = async () => {
    setDeleting(true)
    try {
      await queue.flush()
      if (cadenceIdRef.current == null || stepIdRef.current == null) return
      const r = await deleteCadenceStep(cadenceIdRef.current, stepIdRef.current, accountId)
      setConfirmDelete(false)
      onDeleted(r.cadence)
    } catch (e) {
      setSaveError(errMsg(e))
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  const Icon = STEP_ICONS[type]
  const isPergunta = type === 'pergunta'
  const isMsg = type === 'mensagem' || type === 'whatsapp'

  return (
    <div className="card" style={{ padding: 14, display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {Icon && <Icon size={14} />} {stepId == null ? `Novo passo: ${stepLabel(type)}` : stepLabel(type)}
        </strong>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {hint
            ? <span style={{ fontSize: 12, color: 'var(--warning)' }}>Não salvo</span>
            : <SaveStatusText status={status} error={saveError} onRetry={() => { queue.retry() }} />}
          {onClose && (
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Fechar passo" title="Fechar" onClick={onClose}><X size={12} /></button>
          )}
        </span>
      </div>

      {isPergunta && (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle} htmlFor="step-text">Pergunta</label>
            <textarea id="step-text" className="input" rows={2} style={{ resize: 'vertical' }} value={form.text}
              placeholder="ex.: Para quando é o seu evento, {nome}?" onChange={e => change({ text: e.target.value })} />
          </div>
          <label style={{ ...labelStyle, fontWeight: 500, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.required} onChange={e => change({ required: e.target.checked })} />
            Precisa de resposta para avançar
            <HelpTip title="Precisa de resposta para avançar">Com a chave ligada, o lead só passa para a próxima etapa quando esta pergunta tiver resposta. Ex.: sem saber a data do evento, não dá para mandar proposta.</HelpTip>
          </label>
          <div style={{ display: 'grid', gap: 6 }}>
            <span style={labelStyle}>
              Respostas
              <HelpTip title="Respostas">Com opções, cada resposta soma pontos no termômetro (Perfil). Ex.: "Até 30 dias" = 15 pontos, "Mais de 3 meses" = 0.</HelpTip>
            </span>
            <div role="radiogroup" aria-label="Respostas" style={{ display: 'flex', gap: 14, fontSize: 13 }}>
              <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="step-kind" checked={form.kind === 'text'} onChange={() => change({ kind: 'text' })} /> Livre
              </label>
              <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="step-kind" checked={form.kind === 'options'}
                  onChange={() => change({ kind: 'options', options: form.options.length ? form.options : [{ label: '', points: '' }, { label: '', points: '' }] })} /> Opções
              </label>
            </div>
            {form.kind === 'options' && (
              <div style={{ display: 'grid', gap: 6 }}>
                {form.options.map((o, i) => (
                  <div key={o.option_key || `n${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input className="input" style={{ flex: 1, minWidth: 0 }} value={o.label} placeholder="ex.: Até 30 dias" aria-label={`Opção ${i + 1}`}
                      onChange={e => setOption(i, { label: e.target.value })} />
                    <input className="input" style={{ width: 72, textAlign: 'center' }} inputMode="numeric" value={o.points} placeholder="ex.: 15" aria-label={`Pontos da opção ${i + 1}`}
                      title="Pontos que esta resposta soma no termômetro (de -50 a 50)" onChange={e => setOption(i, { points: e.target.value })} />
                    {profiles.length >= 2 && !form.profile_key && (
                      <select className="select" style={{ width: 120 }} value={o.sets_profile_key || ''} aria-label={`Esta resposta define o tipo de cliente (opção ${i + 1})`}
                        title='Opcional: quem escolher esta resposta vira deste tipo de cliente. Ex.: "Tenho loja" → Loja'
                        onChange={e => setOption(i, { sets_profile_key: e.target.value || null })}>
                        <option value="">Tipo: —</option>
                        {profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.name}</option>)}
                      </select>
                    )}
                    <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Tirar opção" title="Tirar opção"
                      onClick={() => change({ options: form.options.filter((_, idx) => idx !== i) })}><X size={12} /></button>
                  </div>
                ))}
                <div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => change({ options: [...form.options, { label: '', points: '' }] })}><Plus size={12} /> Opção</button>
                </div>
              </div>
            )}
          </div>
          <div>
            <button type="button" onClick={() => setMoreOpen(o => !o)} aria-expanded={moreOpen}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {moreOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Ajustes avançados
            </button>
            {moreOpen && (
              <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 4, flex: '1 1 160px' }}>
                    <span style={labelStyle}>
                      <label htmlFor="step-spin">Tipo de pergunta</label>
                      <HelpTip title="Tipo de pergunta" width={320}>Ajuda a IA a montar a conversa na ordem certa: primeiro como o cliente faz hoje, depois o que incomoda, o que isso custa e o que ele ganha resolvendo. Ex.: "O que mais te incomoda hoje?" = O que incomoda.</HelpTip>
                    </span>
                    <select id="step-spin" className="select" value={form.spin || ''} onChange={e => change({ spin: e.target.value || null })}>
                      <option value="">Nenhum</option>
                      {SPIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {profiles.length > 0 && (
                    <div style={{ display: 'grid', gap: 4, flex: '1 1 160px' }}>
                      <span style={labelStyle}>
                        <label htmlFor="step-profile">Tipo de cliente</label>
                        <HelpTip title="Tipo de cliente">Para qual tipo de cliente esta pergunta vale. Ex.: "Quantos clientes passam na loja?" só para Loja. "Todos" vale para qualquer lead.</HelpTip>
                      </span>
                      <select id="step-profile" className="select" value={form.profile_key || ''} onChange={e => change({ profile_key: e.target.value || null })}>
                        <option value="">Todos</option>
                        {profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 4 }}>
                  <label style={labelStyle} htmlFor="step-hint">Dica para a IA</label>
                  <input id="step-hint" className="input" value={form.ai_hint} placeholder="ex.: procure a data do evento na conversa, mesmo escrita por extenso"
                    onChange={e => change({ ai_hint: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {isMsg && (
        <div style={{ display: 'grid', gap: 4 }}>
          <label style={labelStyle} htmlFor="step-msg">Mensagem</label>
          <textarea id="step-msg" className="input" rows={3} style={{ resize: 'vertical' }} value={form.auto_message}
            placeholder="ex.: Oi {nome}, segue o catálogo com os preços" onChange={e => change({ auto_message: e.target.value })} />
        </div>
      )}

      {!isPergunta && !isMsg && (
        <>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle} htmlFor="step-desc">Descrição</label>
            <input id="step-desc" className="input" value={form.description} placeholder="ex.: Ligar para apresentar a proposta"
              onChange={e => change({ description: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle} htmlFor="step-instr">Instruções</label>
            <input id="step-instr" className="input" value={form.instructions} placeholder="ex.: pergunte se a data ainda está de pé"
              onChange={e => change({ instructions: e.target.value })} />
          </div>
          {type === 'ligacao' && (
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={labelStyle} htmlFor="step-script">Roteiro da ligação</label>
              <textarea id="step-script" className="input" rows={3} style={{ resize: 'vertical' }} value={form.call_script}
                placeholder="ex.: 1) Cumprimente 2) Confirme a data 3) Ofereça a visita" onChange={e => change({ call_script: e.target.value })} />
            </div>
          )}
        </>
      )}

      <div style={{ display: 'grid', gap: 4 }}>
        <span style={labelStyle}>
          <label htmlFor="step-day">Dia</label>
          <HelpTip title="Dia">Quantos dias depois de entrar na etapa este passo vira tarefa. Ex.: 0 = no mesmo dia, 2 = dois dias depois.</HelpTip>
        </span>
        <input id="step-day" type="number" min={0} className="input" style={{ width: 90 }} value={form.delay_days} placeholder="ex.: 0"
          onChange={e => change({ delay_days: e.target.value })} />
      </div>

      {hint && <div style={hintStyle}>{hint}</div>}

      {stepId != null && (
        <div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ color: 'var(--negative)' }} onClick={() => setConfirmDelete(true)}><Trash2 size={12} /> Apagar passo</button>
        </div>
      )}

      {children}

      {confirmDelete && (
        <ConfirmDialog title="Apagar este passo?" danger confirmLabel="Apagar" busyLabel="Apagando..." busy={deleting}
          onConfirm={doDelete} onCancel={() => setConfirmDelete(false)}>
          {isPergunta
            ? 'As respostas que os clientes já deram ficam guardadas na ficha do lead. Se esta pergunta estiver em teste A/B, o teste é cancelado.'
            : 'O passo sai da cadência de todos os leads desta etapa.'}
        </ConfirmDialog>
      )}
    </div>
  )
}

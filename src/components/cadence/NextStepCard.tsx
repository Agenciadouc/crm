import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Play, Check, CheckCircle2, Hourglass, MessageSquareReply, Bot, User, Pencil, ChevronDown, ChevronUp,
  Lock, Send, Circle, MessageCircle,
} from 'lucide-react'
import { fetchLeadStageCadence, markLeadStepDone, type LeadStageCadence, type LeadStep } from '../../lib/cadenceApi'
import { saveLeadAnswer, undoAdvance, type QState, type RoteiroOffscript } from '../../lib/roteiroApi'
import { splitSteps, stepTitle, stepTypeLabel, afterLine, nextActions, doneText, doneOrigin, deviationLine } from '../../lib/nextStep.js'
import { useSSE } from '../../context/SSEContext'
import { AUTOMATION_PATH } from '../../lib/automationTabs.js'
import { STEP_ICONS } from '../../pages/cadencias/StepRow'
import HelpTip from '../HelpTip'
import AnswerEditor from '../roteiro/AnswerEditor'
import { AdvanceBanner, DeviationBox, OffscriptBox } from '../roteiro/RoteiroNotices'

// Cartao "Proximo passo" da cadencia da etapa (spec 2026-09-27 §5.3/§5.4).
// mode 'chat' = painel do Chat (proximo, depois e feitos); 'full' = ficha do lead (todos os passos).
interface Props {
  leadId: number
  accountId: number
  mode: 'chat' | 'full'
  onAsk: (text: string, questionKey: string | null) => void // [Perguntar] / [Usar]
  onSendStep: (text: string, attemptId: number) => void // [Enviar] do passo mensagem
  canManage?: boolean // gestor: link para montar a cadencia
}

const smallBtn = { fontSize: 10, padding: '2px 8px' }
// Varios avisos seguidos do gestor (salvar automatico) viram uma recarga so
const CADENCE_SSE_DEBOUNCE_MS = 600

export default function NextStepCard({ leadId, accountId, mode, onAsk, onSendStep, canManage }: Props) {
  const [data, setData] = useState<LeadStageCadence | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editing, setEditing] = useState<number | null>(null) // attempt_id da pergunta com o editor aberto
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [advanced, setAdvanced] = useState<{ toName: string; fromName: string } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [offscript, setOffscript] = useState<RoteiroOffscript | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [scriptOpen, setScriptOpen] = useState<number | null>(null)
  // Perguntas que a IA acabou de responder (lead:roteiro): aparecem fora do "Feitos" recolhido
  const [aiFresh, setAiFresh] = useState<number[]>([])
  const tokenRef = useRef(0)
  const dataRef = useRef<LeadStageCadence | null>(null)
  dataRef.current = data
  // Lead aberto agora: resposta atrasada de outro lead e descartada
  const leadRef = useRef(leadId)
  leadRef.current = leadId
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((silent = false, doneBefore?: Set<number>) => {
    const my = ++tokenRef.current
    const reqLead = leadId
    const current = () => my === tokenRef.current && reqLead === leadRef.current
    if (!silent) { setLoading(true); setData(null) }
    fetchLeadStageCadence(reqLead, accountId)
      .then(d => {
        if (!current()) return
        setData(d); setError(false)
        if (doneBefore) {
          const fresh = d.steps.filter(s => s.state === 'feito' && doneOrigin(s) === 'ia' && !doneBefore.has(s.attempt_id)).map(s => s.attempt_id)
          if (fresh.length) setAiFresh(prev => Array.from(new Set([...prev, ...fresh])))
        }
      })
      .catch(() => { if (current() && !silent) setError(true) })
      .finally(() => { if (current()) setLoading(false) })
  }, [leadId, accountId])

  useEffect(() => { load() }, [load])
  // Troca de lead: limpa avisos e edicao do lead anterior
  useEffect(() => {
    setEditing(null); setAdvanced(null); setOffscript(null); setSaveError(null); setActionMsg(null); setScriptOpen(null); setAiFresh([])
  }, [leadId])
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // Resposta salva por outra tela / passo feito pelo Chat (lead:cadence) ou por Tarefas (task:updated)
  useSSE('lead:cadence', useCallback((d: any) => { if (Number(d?.lead_id) === leadId) load(true) }, [leadId, load]))
  useSSE('task:updated', useCallback((d: any) => {
    const lcId = dataRef.current?.lead_cadence?.id
    if (lcId && Number(d?.lead_cadence_id) === lcId) load(true)
  }, [load]))
  useSSE('lead:updated', useCallback((d: any) => { if (d?.bulk || Number(d?.id ?? d?.lead_id) === leadId) load(true) }, [leadId, load]))
  useSSE('lead:message', useCallback((d: any) => { if (Number(d?.leadId ?? d?.lead_id) === leadId) load(true) }, [leadId, load]))
  useSSE('lead:roteiro', useCallback((d: any) => {
    if (Number(d?.lead_id) !== leadId) return
    if (d?.offscript && d.offscript.question) setOffscript(d.offscript)
    // A IA completou a etapa e o lead avancou: faixa com Desfazer (spec 4.4)
    if (d?.advanced && d.advanced.to_name) setAdvanced({ toName: d.advanced.to_name, fromName: fromStageName(d.advanced.from) })
    const prev = dataRef.current
    load(true, new Set(prev ? prev.steps.filter(s => s.state === 'feito').map(s => s.attempt_id) : []))
  }, [leadId, load]))
  // Gestor mudou a cadencia ({cadence_id, stage_id}) ou os desvios ({funnel_id}): recarrega
  useSSE('cadence:updated', useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => load(true), CADENCE_SSE_DEBOUNCE_MS)
  }, [load]))

  function fromStageName(from: number | null | undefined) {
    const st = dataRef.current?.stage
    return st && st.id === from ? st.name : ''
  }

  // Passo que mudou por baixo (409) ou outro erro: mostra o texto do servidor e recarrega
  const failAction = (e: any, fallback: string) => {
    setActionMsg(e?.message || fallback)
    load(true)
  }

  const handleDone = async (step: LeadStep) => {
    if (busy) return
    setBusy(step.attempt_id); setActionMsg(null)
    try {
      const r = await markLeadStepDone(leadId, step.attempt_id, accountId)
      // A resposta ja e o estado novo: descarta recarga silenciosa que estiver no ar
      if (leadRef.current === leadId) { tokenRef.current++; setData(r); setError(false) }
    } catch (e: any) {
      if (leadRef.current === leadId) failAction(e, 'Não deu para marcar como feito.')
    } finally { setBusy(null) }
  }

  const handleSave = async (q: QState, body: { option_key?: string; answer_text?: string }) => {
    if (saving) return
    const fromName = data?.stage?.name || ''
    setSaving(true); setSaveError(null)
    try {
      const r = await saveLeadAnswer(leadId, accountId, q.question_key, body)
      if (leadRef.current !== leadId) return
      setEditing(null)
      if (r.advanced) setAdvanced({ toName: r.advanced.to_name, fromName })
      load(true)
    } catch (e: any) {
      if (leadRef.current === leadId) setSaveError(e?.message || 'Não deu para salvar a resposta.')
    } finally { setSaving(false) }
  }

  const handleUndo = async () => {
    setUndoing(true)
    try {
      await undoAdvance(leadId, accountId)
      setAdvanced(null)
      load(true)
    } catch (e: any) {
      setActionMsg(e?.message || 'Não deu para desfazer.')
      setAdvanced(null)
    } finally { setUndoing(false) }
  }

  const header = (right?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 6 }}>
      <Play size={11} /> {mode === 'full' ? `Cadência da etapa${data?.stage ? `: ${data.stage.name}` : ''}` : 'Próximo passo'}
      <HelpTip title={mode === 'full' ? 'Cadência da etapa' : 'Próximo passo'}>
        O que fazer agora com este cliente, na ordem da cadência da etapa. Pergunta fica feita quando tem resposta (sua ou da IA); mensagem fica feita quando você envia pelo botão ou marca Feito. Ex.: 1º perguntar para quando é o evento, 2º mandar o catálogo.
      </HelpTip>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  )

  const box = (children: ReactNode, right?: ReactNode) => (
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
      {header(right)}
      {children}
    </div>
  )

  if (loading && !data) return box(<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Carregando...</div>)
  if (error && !data) {
    return box(
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Não deu para carregar o próximo passo. <button type="button" className="btn btn-secondary btn-sm" style={{ ...smallBtn, marginLeft: 4 }} onClick={() => load()}>Tentar de novo</button>
      </div>,
    )
  }
  if (!data) return null

  const manager = canManage ?? data.can_force
  const notices = (
    <>
      {advanced && <AdvanceBanner toName={advanced.toName} fromName={advanced.fromName} undoing={undoing} onUndo={handleUndo} />}
      {actionMsg && <div role="alert" style={{ fontSize: 11, color: 'var(--negative)', marginBottom: 6 }}>{actionMsg}</div>}
      {data.deviation && <DeviationBox deviation={data.deviation} title={deviationLine(data.deviation)} onUse={text => onAsk(text, null)} />}
      {offscript && <OffscriptBox offscript={offscript} onUse={text => onAsk(text, null)} onClose={() => setOffscript(null)} />}
    </>
  )

  // Etapa sem cadencia (ou sem passos): exemplo e caminho para montar
  if (!data.lead_cadence || data.steps.length === 0) {
    return box(
      <>
        {notices}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Esta etapa ainda não tem cadência.</div>
          {manager ? (
            <div style={{ marginTop: 4 }}>
              Monte os passos — ex.: 1º perguntar "Para quando é o seu evento?", 2º mandar o catálogo.{' '}
              <Link to={data.stage ? `${AUTOMATION_PATH}?aba=manuais&etapa=${data.stage.id}` : `${AUTOMATION_PATH}?aba=manuais`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Montar a cadência desta etapa</Link>
            </div>
          ) : (
            <div style={{ marginTop: 4 }}>
              Peça ao gestor para montar em Cadências. Ex.: ele cadastra "Para quando é o seu evento?" e o passo aparece aqui.
            </div>
          )}
        </div>
      </>,
    )
  }

  const { next, after, done } = splitSteps(data)

  const progress = (
    <span
      title={`${data.done_count} de ${data.total} passos desta etapa já feitos (pergunta com resposta, mensagem enviada ou marcada Feito).`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, textTransform: 'none', fontSize: 11, color: data.total && data.done_count === data.total ? 'var(--positive)' : 'var(--text-secondary)', fontWeight: 600 }}
    >
      {data.done_count} de {data.total} <Check size={10} />
    </span>
  )

  const editor = (step: LeadStep) => editing === step.attempt_id && step.question && (
    <AnswerEditor
      kind={step.question.kind}
      options={step.question.options}
      initialText={step.question.answer?.answer_text}
      currentOption={step.question.answer?.option_key}
      saving={saving}
      error={saveError}
      onSave={body => handleSave(step.question!, body)}
      onCancel={() => { setEditing(null); setSaveError(null) }}
    />
  )
  const openEditor = (step: LeadStep) => { setEditing(step.attempt_id); setSaveError(null) }

  const typeLine = (step: LeadStep) => {
    const Icon = STEP_ICONS[step.action_type] || MessageCircle
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon size={10} /> {stepTypeLabel(step.action_type)}
        {step.action_type === 'pergunta' && step.question?.required && (
          <span title="Obrigatória: trava a mudança de etapa até ter resposta" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--negative)', textTransform: 'none' }}>
            <Lock size={9} /> obrigatória
          </span>
        )}
      </span>
    )
  }

  const waitLine = (step: LeadStep) => {
    if (step.state !== 'aguardando') return null
    return step.question?.last_ask?.replied_at ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--info)', marginTop: 4 }}>
        <MessageSquareReply size={10} /> cliente respondeu — anote a resposta
      </div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
        <Hourglass size={10} /> aguardando resposta
      </div>
    )
  }

  const scriptLink = (step: LeadStep) => step.call_script && (
    <div style={{ marginTop: 4 }}>
      <button type="button" onClick={() => setScriptOpen(v => (v === step.attempt_id ? null : step.attempt_id))} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
        Ver roteiro da ligação
      </button>
      {scriptOpen === step.attempt_id && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{step.call_script}</div>
      )}
    </div>
  )

  const nextCard = (step: LeadStep) => {
    const actions = nextActions(step)
    const isBusy = busy === step.attempt_id
    return (
      <div style={{ padding: 8, marginBottom: 8, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-accent)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>{typeLine(step)}</div>
        <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{stepTitle(step)}</div>
        {step.instructions && step.action_type !== 'pergunta' && step.instructions !== stepTitle(step) && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 2 }}>{step.instructions}</div>
        )}
        {waitLine(step)}
        {scriptLink(step)}
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {actions.includes('perguntar') && step.question && (
            <button type="button" className="btn btn-primary btn-sm" style={smallBtn} onClick={() => onAsk(step.question!.text_for_lead, step.question_key)} title="Colocar a pergunta na caixa de mensagem">
              <Send size={10} /> Perguntar
            </button>
          )}
          {actions.includes('ja_sei') && step.question && (
            <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} onClick={() => openEditor(step)}>Já sei a resposta</button>
          )}
          {actions.includes('enviar') && (
            <button type="button" className="btn btn-primary btn-sm" style={smallBtn} onClick={() => onSendStep(step.auto_message || step.description || '', step.attempt_id)} title="Colocar a mensagem na caixa para você revisar e enviar">
              <Send size={10} /> Enviar
            </button>
          )}
          {actions.includes('feito') && (
            <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} disabled={isBusy} onClick={() => handleDone(step)}>
              <Check size={10} /> {isBusy ? 'Salvando...' : 'Feito'}
            </button>
          )}
        </div>
        {editor(step)}
      </div>
    )
  }

  const originLine = (step: LeadStep) => {
    const origin = doneOrigin(step)
    if (origin === 'ia') return <><Bot size={10} aria-label="Respondida pela IA" /> IA</>
    const who = step.done_by_name || step.question?.answer?.answered_by_name || (origin === 'vendedor' || step.how ? 'Vendedor' : '')
    return who ? <><User size={10} aria-label="Feito à mão" /> {who}</> : null
  }

  const doneRow = (step: LeadStep) => {
    const text = doneText(step)
    const isAi = doneOrigin(step) === 'ia'
    const canFix = step.action_type === 'pergunta' && !!step.question
    return (
      <div key={step.attempt_id} style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Check size={10} style={{ color: 'var(--positive)', flexShrink: 0, marginTop: 3 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.4 }}>
            <span style={{ color: 'var(--text-muted)' }}>{stepTypeLabel(step.action_type)}: </span>
            <span style={{ color: 'var(--text-secondary)' }}>{stepTitle(step)}</span>
          </div>
          {canFix && (
            <button type="button" onClick={() => openEditor(step)} title="Corrigir a resposta" aria-label="Corrigir a resposta" style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)' }}>
              <Pencil size={11} />
            </button>
          )}
        </div>
        {editing !== step.attempt_id && (
          <div style={{ fontSize: 11, marginTop: 2, marginLeft: 16 }}>
            {isAi ? (
              <div style={{ color: 'var(--text-primary)' }}>
                IA respondeu: <b>{text || '—'}</b>{' '}
                {canFix && (
                  <button type="button" onClick={() => openEditor(step)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>corrigir</button>
                )}
              </div>
            ) : (
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{text || '—'}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 10, marginTop: 1 }}>{originLine(step)}</div>
          </div>
        )}
        {canFix && <div style={{ marginLeft: 16 }}>{editor(step)}</div>}
      </div>
    )
  }

  const allDone = !next && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--positive)', marginBottom: 6 }}>
      <CheckCircle2 size={12} /> Tudo feito nesta etapa. Mude a etapa quando o cliente avançar.
    </div>
  )

  // --- modo completo (ficha): todos os passos na ordem --------------------------------
  if (mode === 'full') {
    return box(
      <>
        {notices}
        {allDone}
        {data.steps.map((step, i) => {
          if (next && step.attempt_id === next.attempt_id) return <div key={step.attempt_id}>{nextCard(step)}</div>
          if (step.state === 'feito') return doneRow(step)
          const StateIcon = step.state === 'aguardando' ? Hourglass : Circle
          return (
            <div key={step.attempt_id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 0', borderTop: '1px solid var(--border-subtle)', opacity: step.orphan ? 0.55 : 1 }}>
              <StateIcon size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 3 }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 11, lineHeight: 1.4 }}>
                <span style={{ color: 'var(--text-muted)' }}>{i + 1}. {stepTypeLabel(step.action_type)}: </span>
                <span style={{ color: 'var(--text-primary)' }}>{stepTitle(step)}</span>
                {step.orphan && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> (pergunta removida do roteiro)</span>}
              </div>
            </div>
          )
        })}
      </>,
      progress,
    )
  }

  // --- modo Chat: proximo, depois e feitos -------------------------------------------------
  const after1 = afterLine(after)
  const fresh = showDone ? [] : done.filter(s => aiFresh.includes(s.attempt_id))
  return box(
    <>
      {notices}
      {fresh.length > 0 && <div style={{ marginBottom: 6 }}>{fresh.map(doneRow)}</div>}
      {next ? nextCard(next) : allDone}
      {after1 && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>{after1}</div>}
      {done.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowDone(v => !v)}
            aria-expanded={showDone}
            style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}
          >
            <CheckCircle2 size={11} /> Feitos ({done.length}) {showDone ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showDone && done.map(doneRow)}
        </div>
      )}
    </>,
    progress,
  )
}

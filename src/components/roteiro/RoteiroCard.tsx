import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ListChecks, Play, Check, CheckCircle2, Hourglass, MessageSquareReply, Bot, User, Pencil,
  ChevronDown, ChevronUp, AlertTriangle, X, Undo2, Send,
} from 'lucide-react'
import {
  fetchLeadRoteiro, saveLeadAnswer, undoAdvance,
  type LeadRoteiro, type LeadRoteiroBase, type QState, type RoteiroOffscript,
} from '../../lib/roteiroApi'
import { splitCurrentStage, progressText, stageName } from '../../lib/roteiroView.js'
import { parseSqlDate } from '../../lib/dates'
import { useSSE } from '../../context/SSEContext'
import { AUTOMATION_PATH } from '../../lib/automationTabs.js'
import HelpTip from '../HelpTip'
import AnswerEditor from './AnswerEditor'

// Cartao "Roteiro" (spec 4.1/4.2): o que perguntar agora, pendentes, respondidas e desvio.
// mode 'chat' = etapa atual (painel do Chat); 'full' = todas as etapas (ficha do lead).
interface Props {
  leadId: number
  accountId: number
  mode: 'chat' | 'full'
  onAsk: (text: string, questionKey: string | null) => void
  canForce?: boolean
}

const REQUIRED_COLOR = 'var(--negative)'
const OPTIONAL_COLOR = 'var(--warning)'

function shortDate(at: string | null | undefined) {
  if (!at) return ''
  const d = parseSqlDate(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function Dot({ required }: { required: boolean }) {
  return (
    <span
      title={required ? 'Obrigatória: trava a mudança de etapa' : 'Recomendada: não trava'}
      aria-label={required ? 'Obrigatória' : 'Recomendada'}
      style={{ width: 8, height: 8, borderRadius: '50%', background: required ? REQUIRED_COLOR : OPTIONAL_COLOR, flexShrink: 0, marginTop: 4 }}
    />
  )
}

function answerText(q: QState) {
  if (!q.answer) return ''
  return q.answer.option_label || q.answer.answer_text || ''
}

const smallBtn = { fontSize: 10, padding: '2px 8px' }

export default function RoteiroCard({ leadId, accountId, mode, onAsk, canForce }: Props) {
  const [data, setData] = useState<LeadRoteiro | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState<{ toName: string; fromName: string } | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [offscript, setOffscript] = useState<RoteiroOffscript | null>(null)
  const [showAnswered, setShowAnswered] = useState(mode === 'full')
  const tokenRef = useRef(0)
  // Dados atuais para o banner vindo do SSE (nome da etapa de onde saiu)
  const dataRef = useRef<LeadRoteiro | null>(null)
  dataRef.current = data
  // Lead aberto agora: resposta atrasada de outro lead e descartada
  const leadRef = useRef(leadId)
  leadRef.current = leadId

  const load = useCallback((silent = false) => {
    const my = ++tokenRef.current
    const reqLead = leadId
    const current = () => my === tokenRef.current && reqLead === leadRef.current
    if (!silent) { setLoading(true); setData(null) }
    fetchLeadRoteiro(reqLead, accountId)
      .then(d => { if (current()) { setData(d); setError(false) } })
      .catch(() => { if (current() && !silent) setError(true) })
      .finally(() => { if (current()) setLoading(false) })
  }, [leadId, accountId])

  useEffect(() => { load() }, [load])
  // Troca de lead: limpa avisos e edicao do lead anterior
  useEffect(() => { setEditingKey(null); setAdvanced(null); setOffscript(null); setSaveError(null) }, [leadId])

  useSSE('lead:updated', useCallback((d: any) => { if (d?.bulk || Number(d?.id ?? d?.lead_id) === leadId) load(true) }, [leadId, load]))
  useSSE('lead:roteiro', useCallback((d: any) => {
    if (Number(d?.lead_id) !== leadId) return
    if (d?.offscript && d.offscript.question) setOffscript(d.offscript)
    // A IA completou a etapa e o lead avancou: mesmo banner com Desfazer (spec 4.4)
    if (d?.advanced && d.advanced.to_name) {
      setAdvanced({ toName: d.advanced.to_name, fromName: stageName(dataRef.current, d.advanced.from) })
    }
    load(true)
  }, [leadId, load]))
  // Mensagem nova muda "aguardando resposta" e o desvio detectado pela palavra-gatilho
  useSSE('lead:message', useCallback((d: any) => { if (Number(d?.leadId ?? d?.lead_id) === leadId) load(true) }, [leadId, load]))

  // Mantem desvio e permissao (a resposta do PUT/undo nao traz esses campos)
  const merge = (base: LeadRoteiroBase) => setData(prev => (prev ? { ...prev, ...base } : { ...base, deviation: null, can_force: false }))

  const handleSave = async (q: QState, body: { option_key?: string; answer_text?: string }) => {
    if (saving) return
    const before = data
    setSaving(true); setSaveError(null)
    try {
      const r = await saveLeadAnswer(leadId, accountId, q.question_key, body)
      if (leadRef.current !== leadId) return
      merge(r.roteiro)
      setEditingKey(null)
      if (r.advanced) setAdvanced({ toName: r.advanced.to_name, fromName: stageName(before, r.advanced.from) })
    } catch (e: any) {
      setSaveError(e?.message || 'Não deu para salvar a resposta.')
    } finally { setSaving(false) }
  }

  const handleUndo = async () => {
    setUndoing(true)
    try {
      const r = await undoAdvance(leadId, accountId)
      merge(r.roteiro)
      setAdvanced(null)
    } catch (e: any) {
      setSaveError(e?.message || 'Não deu para desfazer.')
      setAdvanced(null)
    } finally { setUndoing(false) }
  }

  const header = (right?: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 6 }}>
      <ListChecks size={11} /> Roteiro
      <HelpTip title="Roteiro">
        As perguntas que você deve fazer ao cliente em cada etapa. As obrigatórias (bolinha vermelha) travam a mudança de etapa até terem resposta; as recomendadas (amarela) não travam. Ex.: na etapa Qualificando, pergunte "Para quando é o seu evento?" e anote o que o cliente disser.
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
        Não deu para carregar o roteiro agora. <button type="button" className="btn btn-secondary btn-sm" style={{ ...smallBtn, marginLeft: 4 }} onClick={() => load()}>Tentar de novo</button>
      </div>
    )
  }
  if (!data) return null

  if (!data.has_roteiro) {
    return box(
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Este funil ainda não tem roteiro.</div>
        {(canForce ?? data.can_force) ? (
          <div style={{ marginTop: 4 }}>
            Monte as perguntas de cada etapa — ex.: "Para quando é o seu evento?" na etapa Qualificando.{' '}
            <Link to={`${AUTOMATION_PATH}?aba=manuais`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Montar a cadência das etapas</Link>
          </div>
        ) : (
          <div style={{ marginTop: 4 }}>
            Peça ao gestor para montar em Cadências. Ex.: ele cadastra "Para quando é o seu evento?" e a pergunta aparece aqui para você fazer.
          </div>
        )}
      </div>,
    )
  }

  const current = data.stages.find(s => s.is_current) || null
  const split = splitCurrentStage(current, data.next_question_key)

  // --- blocos -----------------------------------------------------------------

  const answerLine = (q: QState) => {
    const a = q.answer!
    return (
      <div style={{ fontSize: 11, marginTop: 2, marginLeft: 14 }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{answerText(q) || '—'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 10, marginTop: 1, flexWrap: 'wrap' }}>
          {a.origin === 'ia' ? (
            <><Bot size={10} aria-label="Respondida pela IA" /> IA</>
          ) : (
            <><User size={10} aria-label="Respondida à mão" /> {a.answered_by_name || 'Vendedor'}</>
          )}
          {shortDate(a.answered_at) && <span>· {shortDate(a.answered_at)}</span>}
        </div>
        {a.origin === 'ia' && a.evidence && (
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: 2 }}>"{a.evidence}"</div>
        )}
      </div>
    )
  }

  const askStatus = (q: QState) => {
    if (q.answer || !q.last_ask) return null
    return q.last_ask.replied_at ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--info)', marginLeft: 14, marginTop: 2 }}>
        <MessageSquareReply size={10} /> cliente respondeu — anote a resposta
      </div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text-muted)', marginLeft: 14, marginTop: 2 }}>
        <Hourglass size={10} /> aguardando resposta
      </div>
    )
  }

  const editor = (q: QState) => editingKey === q.question_key && (
    <div style={{ marginLeft: 14 }}>
      <AnswerEditor
        kind={q.kind}
        options={q.options}
        initialText={q.answer?.answer_text}
        currentOption={q.answer?.option_key}
        saving={saving}
        error={saveError}
        onSave={body => handleSave(q, body)}
        onCancel={() => { setEditingKey(null); setSaveError(null) }}
      />
    </div>
  )

  const openEditor = (q: QState) => { setEditingKey(q.question_key); setSaveError(null) }

  const questionRow = (q: QState, canAsk: boolean) => (
    <div key={q.question_key} style={{ padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        {q.answer ? <Check size={10} style={{ color: 'var(--positive)', flexShrink: 0, marginTop: 3 }} /> : <Dot required={q.required} />}
        <button
          type="button"
          onClick={() => openEditor(q)}
          title={q.answer ? 'Corrigir a resposta' : 'Clique para anotar a resposta'}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12, color: q.answer ? 'var(--text-secondary)' : 'var(--text-primary)', lineHeight: 1.4 }}
        >
          {q.text_for_lead}
        </button>
        {q.answer ? (
          <button type="button" onClick={() => openEditor(q)} title="Corrigir a resposta" aria-label="Corrigir a resposta" style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'var(--text-muted)' }}>
            <Pencil size={11} />
          </button>
        ) : canAsk && (
          <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} onClick={() => onAsk(q.text_for_lead, q.question_key)} title="Colocar a pergunta na caixa de mensagem">
            Perguntar
          </button>
        )}
      </div>
      {q.answer && editingKey !== q.question_key && answerLine(q)}
      {askStatus(q)}
      {editor(q)}
    </div>
  )

  const advanceBanner = advanced && (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--positive-bg)', color: 'var(--positive)', fontSize: 11, lineHeight: 1.45 }}>
      <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ flex: 1 }}>
        Avançou para '{advanced.toName}' — todas as perguntas de '{advanced.fromName || 'etapa anterior'}' respondidas.
      </span>
      <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} disabled={undoing} onClick={handleUndo}>
        <Undo2 size={10} /> {undoing ? 'Desfazendo...' : 'Desfazer'}
      </button>
    </div>
  )

  const deviationBox = data.deviation && (
    <div style={{ padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--warning-bg)', border: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--warning)' }}>
        <AlertTriangle size={11} /> Desvio detectado
      </div>
      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>O cliente saiu do roteiro. Resposta sugerida:</div>
      <div style={{ color: 'var(--text-primary)', marginTop: 2 }}>{data.deviation.reply_text}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary btn-sm" style={smallBtn} onClick={() => onAsk(data.deviation!.reply_text, null)}>
          <Send size={10} /> Usar
        </button>
        {data.deviation.return_question_text && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>volta para: {data.deviation.return_question_text}</span>
        )}
      </div>
    </div>
  )

  const offscriptBox = offscript && (
    <div style={{ padding: '6px 8px', marginBottom: 8, borderRadius: 6, background: 'var(--info-bg)', border: '1px solid var(--border-subtle)', fontSize: 11, lineHeight: 1.45 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: 'var(--info)' }}>
        <Bot size={11} /> A IA viu uma pergunta fora do roteiro
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setOffscript(null)} aria-label="Fechar aviso" style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={11} /></button>
      </div>
      <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>O cliente perguntou: <i>"{offscript.question}"</i></div>
      {offscript.suggested_reply && (
        <>
          <div style={{ color: 'var(--text-primary)', marginTop: 2 }}>{offscript.suggested_reply}</div>
          <button type="button" className="btn btn-primary btn-sm" style={{ ...smallBtn, marginTop: 4 }} onClick={() => onAsk(offscript.suggested_reply, null)}>
            <Send size={10} /> Usar
          </button>
        </>
      )}
    </div>
  )

  const askNow = split.next && (
    <div style={{ padding: '8px', marginBottom: 8, borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border-accent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', marginBottom: 4 }}>
        <Play size={10} /> Pergunte agora
        <Dot required={split.next.required} />
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{split.next.text_for_lead}</div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" style={smallBtn} onClick={() => onAsk(split.next!.text_for_lead, split.next!.question_key)} title="Colocar a pergunta na caixa de mensagem">
          <Send size={10} /> Perguntar
        </button>
        <button type="button" className="btn btn-secondary btn-sm" style={smallBtn} onClick={() => openEditor(split.next!)}>Já sei a resposta</button>
      </div>
      {askStatus(split.next)}
      {editor(split.next)}
    </div>
  )

  const progress = current && (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, textTransform: 'none', fontSize: 11, color: data.progress.total && data.progress.answered === data.progress.total ? 'var(--positive)' : 'var(--text-secondary)', fontWeight: 600 }}>
      {progressText(data.progress)} <Check size={10} />
    </span>
  )

  const stageLine = (
    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
      Etapa: <b style={{ color: 'var(--text-primary)' }}>{current?.name || '—'}</b>
    </div>
  )

  const legacy = data.legacy_answers.length > 0 && (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Respostas de perguntas antigas</div>
      {data.legacy_answers.map(a => (
        <div key={a.question_key} style={{ fontSize: 11, padding: '4px 0', borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
          {a.answer_text || '—'} <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>· {shortDate(a.answered_at)}</span>
        </div>
      ))}
    </div>
  )

  const topBlocks = (
    <>
      {advanceBanner}
      {saveError && !editingKey && <div style={{ fontSize: 11, color: 'var(--negative)', marginBottom: 6 }}>{saveError}</div>}
      {deviationBox}
      {offscriptBox}
    </>
  )

  // --- modo completo (ficha): todas as etapas ------------------------------------
  if (mode === 'full') {
    return box(
      <>
        {stageLine}
        {topBlocks}
        {askNow}
        {data.stages.map(stage => {
          const qs = stage.questions.filter(q => q.question_key !== split.next?.question_key || !stage.is_current)
          const done = stage.questions.filter(q => q.answer).length
          return (
            <div key={stage.id} style={{ marginTop: 8, opacity: stage.is_terminal && !stage.questions.length ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: stage.is_current ? 'var(--accent)' : 'var(--text-primary)', marginBottom: 2 }}>
                {stage.name}
                {stage.is_current && <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border-accent)' }}>etapa atual</span>}
                <span style={{ flex: 1 }} />
                {stage.questions.length > 0 && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{done} de {stage.questions.length}</span>}
              </div>
              {stage.questions.length === 0 ? (
                <div style={{ fontSize: 10, color: 'var(--text-subtle)', padding: '2px 0 4px' }}>Sem perguntas nesta etapa.</div>
              ) : qs.map(q => questionRow(q, true))}
            </div>
          )
        })}
        {legacy}
      </>,
      progress,
    )
  }

  // --- modo Chat: etapa atual ------------------------------------------------------
  return box(
    <>
      {stageLine}
      {topBlocks}
      {!current || current.questions.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Esta etapa não tem perguntas no roteiro. Siga a conversa e mude a etapa quando o cliente avançar.
        </div>
      ) : (
        <>
          {askNow}
          {!split.next && split.pending.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--positive)', marginBottom: 6 }}>
              <CheckCircle2 size={12} /> Tudo respondido nesta etapa.
            </div>
          )}
          {split.pending.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>
                Pendentes ({split.pending.length})
                <HelpTip title="Pendentes" size={11}>
                  Perguntas desta etapa que ainda não têm resposta. Clique em [Perguntar] para mandar ao cliente, ou clique no texto para anotar o que ele já disse. Ex.: se o cliente contou que o evento é em março, clique em "Para quando é o evento?" e escreva "março".
                </HelpTip>
              </div>
              {split.pending.map(q => questionRow(q, true))}
            </div>
          )}
          {split.answered.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                <button
                  type="button"
                  onClick={() => setShowAnswered(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}
                >
                  {showAnswered ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Respondidas ({split.answered.length})
                </button>
                <HelpTip title="Respondidas" size={11}>
                  O que o cliente já respondeu. O robô indica resposta anotada pela IA (com o trecho da conversa); a pessoa indica quem anotou. Use o lápis para corrigir. Ex.: a IA anotou "Até 30 dias" mas o cliente mudou para "abril" — clique no lápis e troque.
                </HelpTip>
              </div>
              {showAnswered && split.answered.map(q => questionRow(q, false))}
            </div>
          )}
        </>
      )}
    </>,
    progress,
  )
}

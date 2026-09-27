import { useEffect, useState } from 'react'
import { Lock, Check, Send, PenLine, X } from 'lucide-react'
import { moveLeadStage, RoteiroGateError } from '../../lib/api'
import { fetchLeadRoteiro, saveLeadAnswer, type RoteiroPendingQuestion } from '../../lib/roteiroApi'
import { displayQuestionText } from '../../lib/roteiroView.js'
import HelpTip from '../HelpTip'
import AnswerEditor from './AnswerEditor'

// Janela "Falta saber" (spec 4.3): o lead nao pode avancar sem as obrigatorias.
// Cada pendente: [Escrever a resposta] (salva; com tudo respondido tenta mover de novo)
// ou [Perguntar agora] (fecha e poe a pergunta no Chat). Gestor: avancar com motivo.
interface Props {
  leadId: number
  accountId: number
  toStage: { id: number; name: string }
  pending: RoteiroPendingQuestion[]
  canForce: boolean
  onDone: (moved: boolean) => void
  onAsk: (text: string, questionKey: string) => void
}

export default function StageGateModal({ leadId, accountId, toStage, pending: initialPending, canForce, onDone, onAsk }: Props) {
  const [pending, setPending] = useState(initialPending)
  const [answered, setAnswered] = useState<Set<string>>(new Set())
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [forceOpen, setForceOpen] = useState(false)
  const [reason, setReason] = useState('')
  // Texto da pergunta com o nome do lead e a versao A/B dele (o gate so traz o texto cru)
  const [leadTexts, setLeadTexts] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    fetchLeadRoteiro(leadId, accountId)
      .then(r => {
        if (!alive) return
        const map: Record<string, string> = {}
        for (const s of r.stages) for (const q of s.questions) map[q.question_key] = q.text_for_lead
        setLeadTexts(map)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [leadId, accountId])

  const textFor = (q: RoteiroPendingQuestion) => leadTexts[q.question_key] || displayQuestionText(q.text)

  const tryMove = async (forceReason?: string) => {
    setMoving(true); setError(null)
    try {
      await moveLeadStage(leadId, toStage.id, { accountId, forceReason })
      onDone(true)
    } catch (e: any) {
      if (e instanceof RoteiroGateError) {
        // Ainda falta algo (ex.: resposta corrigida por outra pessoa): mostra a lista nova
        setPending(e.pending); setAnswered(new Set())
        setError('Ainda falta responder as perguntas abaixo.')
      } else {
        setError(e?.message || 'Não deu para mudar a etapa.')
      }
    } finally { setMoving(false) }
  }

  const handleSave = async (q: RoteiroPendingQuestion, body: { option_key?: string; answer_text?: string }) => {
    setSaving(true); setError(null)
    try {
      await saveLeadAnswer(leadId, accountId, q.question_key, body)
      const next = new Set(answered); next.add(q.question_key)
      setAnswered(next); setEditingKey(null)
      // Tudo respondido: tenta mover de novo sozinho
      if (pending.every(p => next.has(p.question_key))) await tryMove()
    } catch (e: any) {
      setError(e?.message || 'Não deu para salvar a resposta.')
    } finally { setSaving(false) }
  }

  const close = () => { if (!moving && !saving) onDone(false) }
  const remaining = pending.filter(p => !answered.has(p.question_key)).length

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Lock size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 3 }} />
          <h2 style={{ margin: 0, flex: 1, fontSize: 17, lineHeight: 1.35 }}>Para avançar para '{toStage.name}' falta saber:</h2>
          <HelpTip title="Por que travou?">
            Algumas perguntas do roteiro são obrigatórias antes de mudar de etapa. Ex.: sem saber o orçamento, não dá para mandar proposta. Anote a resposta aqui se você já sabe, ou pergunte ao cliente agora.
          </HelpTip>
          <button type="button" onClick={close} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 2 }}><X size={16} /></button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {pending.map(q => {
            const done = answered.has(q.question_key)
            return (
              <div key={q.question_key} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: done ? 'var(--positive-bg)' : 'var(--bg-hover)' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  {done
                    ? <Check size={13} style={{ color: 'var(--positive)', flexShrink: 0, marginTop: 2 }} />
                    : <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--negative)', flexShrink: 0, marginTop: 5 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{textFor(q)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>etapa {q.stage_name}{done ? ' · respondida' : ''}</div>
                  </div>
                </div>
                {!done && editingKey !== q.question_key && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 14, flexWrap: 'wrap' }}>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} disabled={saving || moving} onClick={() => { setEditingKey(q.question_key); setError(null) }}>
                      <PenLine size={11} /> Escrever a resposta
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" style={{ fontSize: 11 }} disabled={saving || moving} onClick={() => { onAsk(textFor(q), q.question_key); onDone(false) }}>
                      <Send size={11} /> Perguntar agora
                    </button>
                  </div>
                )}
                {!done && editingKey === q.question_key && (
                  <div style={{ marginLeft: 14 }}>
                    <AnswerEditor
                      kind={q.kind}
                      options={q.options}
                      saving={saving || moving}
                      onSave={body => handleSave(q, body)}
                      onCancel={() => setEditingKey(null)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--negative)', marginTop: 10 }}>{error}</div>}
        {moving && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>Mudando a etapa...</div>}
        {remaining === 0 && !moving && (
          <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => tryMove()}>Tentar avançar de novo</button>
        )}

        {canForce && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
            {!forceOpen ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForceOpen(true)} disabled={moving}>Avançar mesmo assim</button>
            ) : (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
                  Só o gestor pode pular as perguntas. O motivo fica no histórico do lead.
                </div>
                <textarea
                  className="input"
                  autoFocus
                  rows={2}
                  maxLength={500}
                  placeholder="Motivo (ex.: cliente já chegou decidido, fechou por telefone)"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  style={{ width: '100%', fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }}
                  disabled={moving}
                />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={moving || !reason.trim()} onClick={() => tryMove(reason.trim())}>Avançar com esse motivo</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={moving} onClick={() => { setForceOpen(false); setReason('') }}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

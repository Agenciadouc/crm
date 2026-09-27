import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, Upload, Sparkles, ListChecks, History, RotateCcw, Split, Gauge,
} from 'lucide-react'
import {
  fetchRoteiro, saveDraft, publishRoteiro, restoreVersion, bantTemplate, aiDraft, AiUnavailableError,
  type RoteiroFunnel, type RoteiroVersion, type BantKey,
} from '../../lib/roteiroApi'
import {
  stageQuestions, moveQuestion, moveToStage, addQuestion, removeQuestion, changeKind, sameContent, hasUnpublished,
  hasAnyQuestions, previousVersions, toDraftInput, maxProfilePoints, profileMaxText,
} from '../../lib/roteiroManager.js'
import { parseSqlDate } from '../../lib/dates'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import { InlineNotice, useInlineNotice } from '../../components/InlineNotice'

// Aba "Roteiro" (spec 3.1): perguntas por etapa, desvios, rascunho x publicado e versoes anteriores.
// Toda edicao fica local ate [Salvar rascunho]; [Publicar] salva (se preciso) e publica.

interface LocalOption { option_key?: string; label: string; points: string | number }
interface LocalQuestion {
  question_key: string; stage_id: number; position: number; text: string; kind: 'text' | 'options'
  required: boolean; bant: BantKey | null; ai_hint: string | null; options: LocalOption[]
}
interface LocalDeviation { triggers: string; reply_text: string; return_question_key: string | null }
interface LocalContent { questions: LocalQuestion[]; deviations: LocalDeviation[] }

const EMPTY: LocalContent = { questions: [], deviations: [] }
const NO_AI_TEXT = 'Ligue a IA em Integrações > IA'
const MAX_OPTIONS = 10

const BANT_LABELS: { value: '' | BantKey; label: string }[] = [
  { value: '', label: 'Nenhum' },
  { value: 'budget', label: 'Orçamento' },
  { value: 'authority', label: 'Quem decide' },
  { value: 'need', label: 'Necessidade' },
  { value: 'timeline', label: 'Prazo' },
]

function toLocal(v: RoteiroVersion | null): LocalContent {
  if (!v) return { questions: [], deviations: [] }
  return {
    questions: v.questions.map(q => ({
      question_key: q.question_key, stage_id: q.stage_id, position: q.position, text: q.text, kind: q.kind,
      required: !!q.required, bant: q.bant, ai_hint: q.ai_hint, options: q.options.map(o => ({ option_key: o.option_key, label: o.label, points: o.points })),
    })),
    deviations: v.deviations.map(d => ({ triggers: d.triggers, reply_text: d.reply_text, return_question_key: d.return_question_key })),
  }
}

function fmtDate(at: string | null) {
  if (!at) return ''
  const d = parseSqlDate(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

type Confirm = { kind: 'ai' } | { kind: 'restore'; versionId: number; version: number }

interface Props {
  funnelId: number
  accountId: number
  onDirtyChange: (dirty: boolean) => void
}

export default function RoteiroEditor({ funnelId, accountId, onDirtyChange }: Props) {
  const [roteiro, setRoteiro] = useState<RoteiroFunnel | null>(null)
  const [local, setLocal] = useState<LocalContent>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [aiOff, setAiOff] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const { notice, showError, showSuccess, clear } = useInlineNotice()

  const baseline = useMemo<LocalContent>(() => toLocal(roteiro?.draft || roteiro?.published || null), [roteiro])
  const dirty = !!roteiro && !sameContent(local, baseline)
  const unpublished = dirty || hasUnpublished(roteiro)

  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Aviso do navegador ao fechar/recarregar com mudancas nao salvas
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const applyRoteiro = useCallback((r: RoteiroFunnel) => {
    setRoteiro(r)
    setLocal(toLocal(r.draft || r.published))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try { applyRoteiro(await fetchRoteiro(funnelId, accountId)) } catch (e) { showError('Não foi possível carregar o roteiro', e) } finally { setLoading(false) }
  }, [funnelId, accountId, applyRoteiro, showError])

  useEffect(() => { load() }, [load])

  // Depois de mexer no rascunho pelo servidor, recarrega o funil inteiro (versoes e publicado)
  const afterServerDraft = async (msg: string) => {
    applyRoteiro(await fetchRoteiro(funnelId, accountId))
    showSuccess(msg)
  }

  const run = async (key: string, fn: () => Promise<void>, errPrefix: string) => {
    setBusy(key); clear()
    try { await fn() } catch (e) {
      if (e instanceof AiUnavailableError) { setAiOff(true); showError('', new Error(`A IA não está ligada nesta conta. ${NO_AI_TEXT}.`)) } else showError(errPrefix, e)
    } finally { setBusy(null) }
  }

  const handleSave = () => run('save', async () => {
    await saveDraft(funnelId, accountId, toDraftInput(local))
    await afterServerDraft('Rascunho salvo. O vendedor só vê depois de publicar.')
  }, 'Não foi possível salvar')

  const handlePublish = () => run('publish', async () => {
    if (dirty) await saveDraft(funnelId, accountId, toDraftInput(local))
    const v = await publishRoteiro(funnelId, accountId)
    await afterServerDraft(`Versão ${v.version} publicada. Os vendedores já veem o roteiro novo.`)
  }, 'Não foi possível publicar')

  const handleBant = () => run('bant', async () => {
    await bantTemplate(funnelId, accountId)
    await afterServerDraft('Modelo BANT criado no rascunho. Revise os textos e os pontos e depois publique.')
  }, 'Não foi possível criar o modelo')

  const doAi = () => run('ai', async () => {
    await aiDraft(funnelId, accountId)
    await afterServerDraft('A IA montou um rascunho. Revise pergunta por pergunta e depois publique.')
  }, 'Montar com IA')

  const doRestore = (versionId: number, version: number) => run('restore', async () => {
    await restoreVersion(versionId, accountId)
    await afterServerDraft(`A versão ${version} voltou para o rascunho. Publique para os vendedores verem.`)
  }, 'Não foi possível restaurar')

  const requestAi = () => {
    if (aiOff) return
    if (hasAnyQuestions(roteiro) || local.questions.length) setConfirm({ kind: 'ai' })
    else doAi()
  }

  const onConfirm = () => {
    const c = confirm
    setConfirm(null)
    if (!c) return
    if (c.kind === 'ai') doAi()
    else doRestore(c.versionId, c.version)
  }

  // --- edicao local ---
  const updateQuestion = (key: string, patch: Partial<LocalQuestion>) =>
    setLocal(c => ({ ...c, questions: c.questions.map(q => (q.question_key === key ? { ...q, ...patch } : q)) }))
  const setQuestions = (fn: (qs: LocalQuestion[]) => LocalQuestion[]) => setLocal(c => ({ ...c, questions: fn(c.questions) }))
  const updateOption = (key: string, idx: number, patch: Partial<LocalOption>) =>
    setLocal(c => ({ ...c, questions: c.questions.map(q => (q.question_key === key ? { ...q, options: q.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)) } : q)) }))
  const updateDeviation = (idx: number, patch: Partial<LocalDeviation>) =>
    setLocal(c => ({ ...c, deviations: c.deviations.map((d, i) => (i === idx ? { ...d, ...patch } : d)) }))

  if (loading && !roteiro) return <div className="loading-container"><div className="spinner" /></div>
  if (!roteiro) return <InlineNotice notice={notice} onClose={clear} />

  const stages = [...roteiro.stages].sort((a, b) => a.position - b.position)
  const openStages = stages.filter(s => !s.is_terminal)
  const empty = !local.questions.length && !local.deviations.length
  const versions = previousVersions(roteiro.versions)
  const maxPoints = maxProfilePoints(local.questions.map(q => ({ kind: q.kind, options: q.options.map(o => ({ points: Number(o.points) || 0 })) })))
  const namedQuestions = [...local.questions]
    .sort((a, b) => (stages.findIndex(s => s.id === a.stage_id) - stages.findIndex(s => s.id === b.stage_id)) || (a.position - b.position))

  return (
    <div>
      <InlineNotice notice={notice} onClose={clear} />

      {unpublished && (
        <div
          role="status"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 14, borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}
        >
          <div style={{ flex: 1, minWidth: 220, fontSize: 13, color: 'var(--text-primary)' }}>
            <strong>Mudanças não publicadas</strong>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {dirty
                ? 'Você mudou o roteiro e ainda não salvou. Salve o rascunho para não perder, e publique quando estiver pronto.'
                : 'O rascunho está diferente da versão que os vendedores usam. Publique para eles verem.'}
            </div>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={!dirty || !!busy}>
            <Save size={13} /> {busy === 'save' ? 'Salvando...' : 'Salvar rascunho'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handlePublish} disabled={!!busy}>
            <Upload size={13} /> {busy === 'publish' ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      )}

      {empty && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ListChecks size={18} style={{ color: 'var(--accent)' }} />
            <strong style={{ fontFamily: 'var(--font-heading)' }}>Este funil ainda não tem roteiro</strong>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
            Diga ao vendedor o que perguntar em cada etapa. Exemplo: na etapa <em>Qualificando</em>, a pergunta <em>"Para quando você precisa disso, {'{nome}'}?"</em> com as opções
            {' '}<em>Até 30 dias</em> (15 pontos), <em>De 1 a 3 meses</em> (8) e <em>Mais de 3 meses</em> (0). Quem responde "Até 30 dias" sobe no termômetro.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary btn-sm" onClick={handleBant} disabled={!!busy || !openStages.length}>
              <ListChecks size={13} /> {busy === 'bant' ? 'Criando...' : 'Começar com modelo BANT'}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={requestAi}
              disabled={aiOff || !!busy}
              title={aiOff ? NO_AI_TEXT : 'A IA monta um rascunho a partir do briefing do agente e das conversas de quem comprou'}
            >
              <Sparkles size={13} /> {busy === 'ai' ? 'Montando...' : 'Montar com IA'}
            </button>
            <HelpTip title="Modelo BANT">
              Cria 4 perguntas de opções com pontos na primeira etapa: Necessidade, Orçamento, Quem decide e Prazo. Ex.: "Você já tem uma faixa de investimento em mente?" — Sim, dentro do nosso preço (15).
            </HelpTip>
          </div>
          {aiOff && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{NO_AI_TEXT} para usar o Montar com IA.</div>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Perguntas por etapa</h3>
        <HelpTip title="Perguntas por etapa">
          Cada coluna é uma etapa do funil. Obrigatória trava a mudança de etapa até ter resposta; recomendada só aparece para o vendedor. Ex.: "Qual o seu orçamento?" obrigatória em Qualificando.
        </HelpTip>
      </div>

      <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 10, marginBottom: 16, WebkitOverflowScrolling: 'touch' }}>
        {stages.map(stage => {
          const list = stageQuestions(local.questions, stage.id)
          return (
            <div
              key={stage.id}
              style={{ flex: '0 0 300px', maxWidth: '85vw', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 10, opacity: stage.is_terminal ? 0.55 : 1 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>{stage.name}</strong>
                {!stage.is_terminal && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{list.length} {list.length === 1 ? 'pergunta' : 'perguntas'}</span>}
              </div>
              {stage.is_terminal ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Etapa final — não tem perguntas</div>
              ) : (
                <>
                  {!list.length && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                      Esta etapa ainda não tem perguntas. Exemplo: <em>"Qual o prazo do seu evento?"</em>
                    </div>
                  )}
                  {list.map((q, idx) => (
                    <QuestionCard
                      key={q.question_key}
                      q={q}
                      isFirst={idx === 0}
                      isLast={idx === list.length - 1}
                      stages={openStages}
                      onChange={patch => updateQuestion(q.question_key, patch)}
                      onKind={kind => setQuestions(qs => qs.map(x => (x.question_key === q.question_key ? changeKind(x, kind) : x)))}
                      onOption={(i, patch) => updateOption(q.question_key, i, patch)}
                      onMove={dir => setQuestions(qs => moveQuestion(qs, q.question_key, dir))}
                      onMoveStage={sid => setQuestions(qs => moveToStage(qs, q.question_key, sid))}
                      onRemove={() => setLocal(c => removeQuestion(c.questions, c.deviations, q.question_key))}
                    />
                  ))}
                  <button className="btn btn-secondary btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setQuestions(qs => addQuestion(qs, stage.id))}>
                    <Plus size={13} /> Pergunta
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <Split size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Desvios</h3>
          <HelpTip title="Desvios">
            Quando o cliente pergunta algo fora da ordem, o vendedor recebe a resposta pronta e a pergunta para voltar ao roteiro. Ex.: se falar em "preço", responda que passa o valor depois de entender o evento e volte para "Quantos convidados?".
          </HelpTip>
        </div>
        {!local.deviations.length && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Nenhum desvio ainda. Exemplo: se o cliente escrever <em>preço, valor, quanto custa</em> → responder <em>"Consigo te passar o valor certinho assim que entender o tamanho do evento. Quantos convidados?"</em> → voltar para a pergunta de convidados.
          </p>
        )}
        {local.deviations.map((d, i) => (
          <div key={i} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: 10, marginBottom: 8, display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Se o cliente escrever (palavras separadas por vírgula)
              <input className="input" value={d.triggers} placeholder="ex.: preço, valor, quanto custa" onChange={e => updateDeviation(i, { triggers: e.target.value })} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Responda
              <textarea rows={2} value={d.reply_text} placeholder="ex.: Consigo te passar o valor certinho assim que entender o tamanho do evento. Quantos convidados?" onChange={e => updateDeviation(i, { reply_text: e.target.value })} />
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>
                Volte para
                <select className="select" value={d.return_question_key || ''} onChange={e => updateDeviation(i, { return_question_key: e.target.value || null })}>
                  <option value="">Nenhuma pergunta</option>
                  {namedQuestions.map(q => (
                    <option key={q.question_key} value={q.question_key}>{q.text.trim() || '(pergunta sem texto)'}</option>
                  ))}
                </select>
              </label>
              <button className="btn btn-danger btn-sm btn-icon" title="Apagar desvio" aria-label="Apagar desvio" onClick={() => setLocal(c => ({ ...c, deviations: c.deviations.filter((_, j) => j !== i) }))}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={() => setLocal(c => ({ ...c, deviations: c.deviations.concat([{ triggers: '', reply_text: '', return_question_key: null }]) }))}>
          <Plus size={13} /> Desvio
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <Gauge size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', flex: 1 }}>{profileMaxText(maxPoints)}</div>
        <HelpTip title="Perfil máximo">
          É a soma da maior pontuação de cada pergunta de opções. O termômetro converte para 0 a 50. Ex.: máximo 60 e o lead fez 30 pontos = Perfil 25 de 50.
        </HelpTip>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <History size={15} style={{ color: 'var(--accent)' }} />
          <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Versões anteriores</h3>
          <HelpTip title="Versões anteriores">
            Cada vez que você publica, a versão fica guardada aqui. Restaurar copia a versão para o rascunho; os vendedores só veem depois de publicar. Ex.: a versão 3 respondia melhor? Restaure e publique.
          </HelpTip>
        </div>
        {!versions.length ? (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma versão publicada ainda. Quando você clicar em Publicar, a versão 1 aparece aqui.</p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {versions.map(v => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ flex: 1 }}>
                  Versão {v.version}
                  {v.published_at && <span style={{ color: 'var(--text-muted)' }}> · publicada em {fmtDate(v.published_at)}</span>}
                  {v.status === 'published' && <span style={{ color: 'var(--positive)', marginLeft: 6 }}>(em uso)</span>}
                </span>
                <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setConfirm({ kind: 'restore', versionId: v.id, version: v.version })}>
                  <RotateCcw size={12} /> Restaurar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'ai' ? 'Montar com IA' : `Restaurar a versão ${confirm.version}?`}
          confirmLabel={confirm.kind === 'ai' ? 'Continuar' : 'Restaurar'}
          danger
          onConfirm={onConfirm}
          onCancel={() => setConfirm(null)}
        >
          {confirm.kind === 'ai'
            ? 'Isso substitui o rascunho atual. Continuar?'
            : `O rascunho atual${dirty ? ' (e as mudanças que você ainda não salvou)' : ''} é trocado pela versão ${confirm.version}. Os vendedores só veem depois de publicar.`}
        </ConfirmDialog>
      )}
    </div>
  )
}

interface CardProps {
  q: LocalQuestion
  isFirst: boolean
  isLast: boolean
  stages: { id: number; name: string }[]
  onChange: (patch: Partial<LocalQuestion>) => void
  onKind: (kind: 'text' | 'options') => void
  onOption: (idx: number, patch: Partial<LocalOption>) => void
  onMove: (dir: -1 | 1) => void
  onMoveStage: (stageId: number) => void
  onRemove: () => void
}

function QuestionCard({ q, isFirst, isLast, stages, onChange, onKind, onOption, onMove, onMoveStage, onRemove }: CardProps) {
  const labelStyle = { fontSize: 11, color: 'var(--text-muted)', display: 'grid', gap: 3 } as const
  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${q.required ? 'var(--negative)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-sm)', padding: 10, marginBottom: 8, display: 'grid', gap: 8 }}>
      <textarea
        rows={2}
        value={q.text}
        placeholder="ex.: Para quando você precisa disso, {nome}?"
        aria-label="Texto da pergunta"
        onChange={e => onChange({ text: e.target.value })}
        style={{ fontSize: 13 }}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <label style={labelStyle}>
          Trava?
          <select className="select" value={q.required ? '1' : '0'} onChange={e => onChange({ required: e.target.value === '1' })}>
            <option value="1">Obrigatória</option>
            <option value="0">Recomendada</option>
          </select>
        </label>
        <label style={labelStyle}>
          Tipo
          <select className="select" value={q.kind} onChange={e => onKind(e.target.value as 'text' | 'options')}>
            <option value="text">Texto livre</option>
            <option value="options">Opções com pontos</option>
          </select>
        </label>
      </div>

      {q.kind === 'options' && (
        <div style={{ display: 'grid', gap: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            Opções e pontos
            <HelpTip title="Pontos das opções" size={11}>
              Os pontos (de -50 a 50) somam no Perfil do lead. Ex.: "Até 30 dias" = 15, "Mais de 3 meses" = 0. Use negativo para o que afasta a venda.
            </HelpTip>
          </div>
          {q.options.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 4 }}>
              <input className="input" style={{ flex: 1, padding: '6px 8px' }} value={o.label} placeholder="ex.: Até 30 dias" aria-label="Texto da opção" onChange={e => onOption(i, { label: e.target.value })} />
              <input className="input" style={{ width: 64, padding: '6px 8px' }} type="number" min={-50} max={50} step={1} value={o.points} placeholder="ex.: 15" aria-label="Pontos da opção" onChange={e => onOption(i, { points: e.target.value })} />
              <button
                className="btn btn-secondary btn-sm btn-icon"
                title="Apagar opção"
                aria-label="Apagar opção"
                disabled={q.options.length <= 2}
                onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {q.options.length < MAX_OPTIONS && (
            <button className="btn btn-secondary btn-sm" style={{ justifySelf: 'start' }} onClick={() => onChange({ options: q.options.concat([{ label: '', points: 0 }]) })}>
              <Plus size={12} /> Opção
            </button>
          )}
        </div>
      )}

      <label style={labelStyle}>
        BANT
        <select className="select" value={q.bant || ''} onChange={e => onChange({ bant: (e.target.value || null) as BantKey | null })}>
          {BANT_LABELS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Dica para a IA (opcional)
        <input className="input" style={{ padding: '6px 8px' }} value={q.ai_hint || ''} placeholder="ex.: aceite respostas como 'mês que vem' = De 1 a 3 meses" onChange={e => onChange({ ai_hint: e.target.value })} />
      </label>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button className="btn btn-secondary btn-sm btn-icon" title="Subir" aria-label="Subir pergunta" disabled={isFirst} onClick={() => onMove(-1)}><ChevronUp size={13} /></button>
        <button className="btn btn-secondary btn-sm btn-icon" title="Descer" aria-label="Descer pergunta" disabled={isLast} onClick={() => onMove(1)}><ChevronDown size={13} /></button>
        <select
          className="select"
          style={{ flex: 1, padding: '6px 28px 6px 8px', fontSize: 12 }}
          value=""
          aria-label="Mover para etapa"
          onChange={e => { if (e.target.value) onMoveStage(Number(e.target.value)) }}
        >
          <option value="">Mover para etapa...</option>
          {stages.filter(s => s.id !== q.stage_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className="btn btn-danger btn-sm btn-icon" title="Apagar pergunta" aria-label="Apagar pergunta" onClick={onRemove}><Trash2 size={13} /></button>
      </div>
    </div>
  )
}

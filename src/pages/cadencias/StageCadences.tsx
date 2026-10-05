import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Settings, X } from 'lucide-react'
import { useAccount } from '../../context/AccountContext'
import { useSSE } from '../../context/SSEContext'
import HelpTip from '../../components/HelpTip'
import ConfirmDialog from '../../components/ConfirmDialog'
import { fetchFunnels, type Funnel } from '../../lib/api'
import {
  fetchStageView, fetchStepMetrics, createStageCadence, reorderCadenceSteps, deleteCadenceStep, applySuggestionLive,
  type StageView, type StageCadence, type StepMetric, type StepType, type CadenceStep,
} from '../../lib/cadenceApi'
import { fetchSuggestions, fetchRoteiroSettings, suggestionAction, type RoteiroSuggestions, type RoteiroSettings } from '../../lib/roteiroApi'
import {
  stageChipLabel, stageChipTitle, stageFromSearch, stageSummary, moveStep, dropStep, suggestionsForStep, testForStep,
  stageSuggestions, deviationSuggestions, sseTouchesView,
} from '../../lib/stageCadence.js'
import { suggestionWhy } from '../../lib/roteiroManager.js'
import { AUTOMATION_PATH, automationUrl } from '../../lib/automationTabs.js'
import StepRow from './StepRow'
import StepPanel, { type NewStep } from './StepPanel'
import StepInsights from './StepInsights'
import StageDeviations from './StageDeviations'
import StageSettings from './StageSettings'
import BusinessProfilesCard from './BusinessProfilesCard'
import StageEmpty, { AddStepMenu, TemplateButtons } from './StageEmpty'

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Erro.')

// Cadencia de cada etapa do funil (spec 2026-09-27 §5.1): chips das etapas, lista compacta de
// passos, painel do passo com salvar automatico, desvios e follow-up da etapa.
export default function StageCadences() {
  const { accountId } = useAccount()
  const location = useLocation()
  const navigate = useNavigate()
  const [funnels, setFunnels] = useState<Funnel[] | null>(null)
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [view, setView] = useState<StageView | null>(null)
  const [stageId, setStageId] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | 'novo' | null>(null)
  const [panelKey, setPanelKey] = useState('')
  const [newStep, setNewStep] = useState<NewStep | null>(null)
  const [metrics, setMetrics] = useState<StepMetric[]>([])
  const [sugs, setSugs] = useState<RoteiroSuggestions>({ suggestions: [], tests: [] })
  const [settings, setSettings] = useState<RoteiroSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orphanToDelete, setOrphanToDelete] = useState<CadenceStep | null>(null)
  const [deletingOrphan, setDeletingOrphan] = useState(false)
  const [sugBusy, setSugBusy] = useState<number | null>(null)
  const dragRef = useRef<number | null>(null)
  const searchRef = useRef(location.search)
  searchRef.current = location.search

  useEffect(() => {
    if (!accountId) return
    setFunnels(null); setView(null); setFunnelId(null)
    fetchFunnels(accountId).then(fs => {
      const active = fs.filter(f => f.is_active)
      setFunnels(active)
      setFunnelId((active.find(f => f.is_default) || active[0])?.id ?? null)
    }).catch(e => { setFunnels([]); setError(errText(e)) })
    fetchRoteiroSettings(accountId).then(setSettings).catch(() => {})
  }, [accountId])

  const loadView = useCallback(() => {
    if (!accountId || !funnelId) return
    fetchStageView(funnelId, accountId).then(v => {
      setView(v)
      setStageId(prev => prev && v.stages.some(s => s.id === prev && !s.is_terminal) ? prev : stageFromSearch(searchRef.current, v.stages))
    }).catch(e => setError(errText(e)))
    fetchSuggestions(accountId).then(setSugs).catch(() => {})
  }, [accountId, funnelId])
  useEffect(() => { loadView() }, [loadView])

  // Outro gestor (ou o proprio salvar) mexeu: recarrega a lista. O painel aberto guarda o texto local.
  // Aviso tem 2 formatos ({cadence_id, stage_id} e {funnel_id}); varios seguidos viram uma recarga.
  const viewRef = useRef<StageView | null>(null)
  viewRef.current = view
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (reloadTimer.current) clearTimeout(reloadTimer.current) }, [])
  useSSE('cadence:updated', useCallback((data: any) => {
    const ids = (viewRef.current?.stages || []).map(s => s.id)
    if (!sseTouchesView(data, funnelId, ids)) return
    if (reloadTimer.current) clearTimeout(reloadTimer.current)
    reloadTimer.current = setTimeout(loadView, 600)
  }, [funnelId, loadView]))

  const stage = view?.stages.find(s => s.id === stageId) || null
  const cadence = stage?.cadence || null
  const steps = cadence?.attempts || []
  useEffect(() => {
    if (!cadence || !accountId) { setMetrics([]); return }
    fetchStepMetrics(cadence.id, accountId).then(setMetrics).catch(() => setMetrics([]))
  }, [cadence?.id, accountId])

  // Passo aberto sumiu (outro gestor apagou): fecha o painel
  useEffect(() => {
    if (typeof selected === 'number' && cadence && !cadence.attempts.some(a => a.id === selected)) setSelected(null)
  }, [cadence, selected])

  // Salvou um passo: troca so a cadencia desta etapa (sem recarregar tudo)
  const putCadence = useCallback((c: StageCadence) => setView(v => v && ({
    ...v,
    stages: v.stages.map(s => s.id === c.stage_id ? { ...s, cadence: c, summary: stageSummary(c) } : s),
  })), [])

  const chooseStage = (id: number) => {
    setStageId(id)
    setSelected(null); setNewStep(null)
    navigate(`${AUTOMATION_PATH}?aba=manuais&etapa=${id}`, { replace: true })
  }
  const openStep = (id: number) => { setSelected(id); setNewStep(null); setPanelKey(`s${id}`) }
  const addStep = (type: StepType) => {
    setNewStep({ id: null, action_type: type, position: steps.length })
    setSelected('novo')
    setPanelKey(`n${Date.now()}`)
  }
  const closePanel = () => { setSelected(null); setNewStep(null); setPanelKey('') }
  const panelKeyRef = useRef(panelKey)
  panelKeyRef.current = panelKey

  // Criacao da cadencia da etapa dividida entre paineis: dois passos novos numa etapa vazia
  // esperam a mesma criacao (sem 409 "Esta etapa ja tem cadencia."). Fica no mapa depois de
  // criada, ate a tela receber a cadencia; so sai do mapa se falhar.
  const creating = useRef(new Map<number, Promise<StageCadence>>())
  const ensureCadenceFor = (sid: number) => (): Promise<StageCadence> => {
    const st = viewRef.current?.stages.find(s => s.id === sid)
    if (st?.cadence) return Promise.resolve(st.cadence)
    let p = creating.current.get(sid)
    if (!p) {
      p = createStageCadence(sid, accountId as number).then(c => { putCadence(c); return c })
      p.catch(() => creating.current.delete(sid))
      creating.current.set(sid, p)
    }
    return p
  }

  const reorder = async (ids: number[]) => {
    if (!cadence || !accountId) return
    try {
      const r = await reorderCadenceSteps(cadence.id, accountId, ids)
      putCadence(r.cadence)
    } catch (e) {
      setError(errText(e))
      loadView()
    }
  }
  const ids = steps.map(a => a.id)

  const deleteOrphan = async () => {
    if (!orphanToDelete || !cadence || !accountId) return
    setDeletingOrphan(true)
    try {
      const r = await deleteCadenceStep(cadence.id, orphanToDelete.id, accountId)
      putCadence(r.cadence)
    } catch (e) {
      setError(errText(e))
    } finally {
      setDeletingOrphan(false)
      setOrphanToDelete(null)
    }
  }

  const reorderAction = async (id: number, fn: () => Promise<unknown>) => {
    setSugBusy(id)
    try { await fn(); loadView() } catch (e) { setError(errText(e)) } finally { setSugBusy(null) }
  }

  if (!accountId) return null
  const windowH = settings?.reply_window_h ?? 24
  const minRate = settings?.min_reply_rate ?? 70
  const metricOf = (id: number) => metrics.find(m => m.attempt_id === id)

  if (funnels && funnels.length === 0) {
    return (
      <div className="empty-state">
        <p>Esta conta ainda não tem funil. Crie um em Funis para montar as cadências. Ex.: Novo Lead → Qualificando → Proposta → Venda.</p>
      </div>
    )
  }

  const panelStep: CadenceStep | NewStep | null = selected === 'novo' ? newStep : (typeof selected === 'number' ? steps.find(a => a.id === selected) || null : null)
  const showList = steps.length > 0 || selected === 'novo'
  // Callbacks presos ao painel aberto: resposta atrasada de um painel antigo nao mexe na selecao
  const myKey = panelKey
  const stepNo = selected === 'novo' ? steps.length + 1 : steps.findIndex(a => a.id === selected) + 1

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Cadência de cada etapa
          <HelpTip title="Cadência de cada etapa" width={320}>Cada etapa do funil tem uma cadência: os passos que o vendedor segue, na ordem, enquanto o lead está nela. Ela começa sozinha quando o lead entra na etapa e fecha quando ele sai. Ex.: em Qualificando, 1º perguntar para quando é o evento, 2º mandar o catálogo, 3º ligar no dia 2.</HelpTip>
        </h2>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {funnels && funnels.length > 0 && (
            <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Funil
              <select className="select" value={funnelId ?? ''} onChange={e => { setFunnelId(Number(e.target.value)); setView(null); setStageId(null); closePanel() }}>
                {funnels.map(f => <option key={f.id} value={f.id}>{f.name}{f.is_default ? ' (padrão)' : ''}</option>)}
              </select>
            </label>
          )}
          <span style={{ position: 'relative' }}>
            <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label="Configurações do roteiro" title="Configurações do roteiro"
              aria-expanded={showSettings} onMouseDown={e => e.stopPropagation()} onClick={() => setShowSettings(s => !s)}>
              <Settings size={14} />
            </button>
            {showSettings && <StageSettings accountId={accountId} onClose={() => setShowSettings(false)} onSaved={setSettings} />}
          </span>
        </span>
      </div>

      {error && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--negative)', color: 'var(--negative)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setError(null)}><X size={12} /> Fechar</button>
        </div>
      )}

      <BusinessProfilesCard accountId={accountId} onSaved={() => loadView()} />

      {!view ? (
        <div className="loading-container"><div className="spinner" /></div>
      ) : (
        <>
          <div role="tablist" aria-label="Etapas" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {view.stages.map(s => {
              const active = s.id === stageId
              return (
                <button key={s.id} type="button" role="tab" aria-selected={active} disabled={s.is_terminal}
                  title={s.is_terminal ? 'Etapa final — não tem cadência' : undefined}
                  onClick={() => { if (!active) chooseStage(s.id) }}
                  style={{ fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-full)', cursor: s.is_terminal ? 'not-allowed' : 'pointer',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`, background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#000' : s.is_terminal ? 'var(--text-subtle)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400, opacity: s.is_terminal ? 0.6 : 1 }}>
                  <span title={s.is_terminal ? undefined : stageChipTitle(s)}>{s.is_terminal ? s.name : stageChipLabel(s)}</span>
                </button>
              )
            })}
          </div>

          {stage && stageSuggestions(sugs.suggestions, stage.id).map(s => (
            <div key={s.id} style={{ border: '1px dashed var(--border-accent)', borderRadius: 'var(--radius-sm)', padding: 10, display: 'grid', gap: 6, fontSize: 13 }}>
              <strong style={{ fontSize: 12, color: 'var(--accent)' }}>A IA sugere mudar a ordem das perguntas desta etapa.</strong>
              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{suggestionWhy(s)}</span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={sugBusy !== null} onClick={() => reorderAction(s.id, () => applySuggestionLive(s.id, accountId))}>Aplicar</button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={sugBusy !== null} onClick={() => reorderAction(s.id, () => suggestionAction(s.id, accountId, 'reject'))}>Ignorar</button>
              </span>
            </div>
          ))}

          {stage && funnelId && !showList && (
            <StageEmpty accountId={accountId} funnelId={funnelId} stage={stage} onCadence={c => { putCadence(c); closePanel() }} onAddStep={addStep} />
          )}

          {stage && funnelId && showList && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 360px', minWidth: 0, display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <strong style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Passos
                    <HelpTip title="Passos" width={300}>Clique num passo para editar. Pergunta obrigatória (cadeado) trava a mudança de etapa até ter resposta. O selo mostra como o passo está indo: ex.: "respondem 45% · fraca" quer dizer que menos da metade responde.</HelpTip>
                  </strong>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TemplateButtons accountId={accountId} funnelId={funnelId} stage={stage} compact onCadence={c => putCadence(c)} />
                    <AddStepMenu onAddStep={addStep} />
                  </span>
                </div>
                {steps.map((a, i) => (
                  <StepRow key={a.id} step={a} index={i} metric={metricOf(a.id)} windowH={windowH} minRate={minRate}
                    selected={selected === a.id} first={i === 0} last={i === steps.length - 1}
                    onSelect={() => openStep(a.id)}
                    onMove={dir => reorder(moveStep(ids, a.id, dir))}
                    onDragStart={() => { dragRef.current = a.id }}
                    onDropHere={() => { const from = dragRef.current; dragRef.current = null; if (from != null && from !== a.id) reorder(dropStep(ids, from, a.id)) }}
                    onDeleteOrphan={() => setOrphanToDelete(a)}
                    profileName={a.question?.profile_key ? (view.profiles || []).find(p => p.profile_key === a.question?.profile_key)?.name ?? null : null} />
                ))}
                {selected === 'novo' && newStep && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 10px', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                    {steps.length + 1}. passo novo: preencha ao lado para salvar
                  </div>
                )}
              </div>
              {panelStep && (
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                  <StepPanel key={panelKey} accountId={accountId} stageId={stage.id} cadenceId={cadence?.id ?? null} step={panelStep}
                    onSaved={r => {
                      putCadence(r.cadence)
                      if (panelKeyRef.current !== myKey) return
                      setSelected(sel => sel === 'novo' ? r.step_id : sel)
                      setNewStep(null)
                    }}
                    onCreatedCadence={c => putCadence(c)}
                    ensureCadence={ensureCadenceFor(stage.id)}
                    onBackgroundError={() => setError(`Não salvou a última mudança do passo ${stepNo}. Abra o passo e tente de novo.`)}
                    onDeleted={c => { putCadence(c); closePanel() }}
                    onClose={closePanel}
                    profiles={view.profiles || []}>
                    {panelStep.id != null && (
                      <StepInsights accountId={accountId} step={panelStep as CadenceStep} metric={metricOf(panelStep.id)} windowH={windowH} minRate={minRate}
                        suggestions={suggestionsForStep(sugs.suggestions, panelStep as CadenceStep)} test={testForStep(sugs.tests, panelStep as CadenceStep)}
                        onChanged={loadView} />
                    )}
                  </StepPanel>
                </div>
              )}
            </div>
          )}

          {funnelId && (
            <StageDeviations key={funnelId} accountId={accountId} funnelId={funnelId} deviations={view.deviations} questions={view.questions}
              suggestions={deviationSuggestions(sugs.suggestions, funnelId)}
              onSaved={d => setView(v => v && ({ ...v, deviations: d }))} onChanged={loadView} />
          )}

          {stage && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Follow-up automático desta etapa:{' '}
              {stage.followups[0]
                ? <>{stage.followups[0].name} <Link to={automationUrl('automaticas', '')} style={{ color: 'var(--accent)' }}>ver</Link></>
                : <>nenhum <Link to={automationUrl('automaticas', '')} style={{ color: 'var(--accent)' }}>criar</Link></>}
            </div>
          )}
        </>
      )}

      {orphanToDelete && (
        <ConfirmDialog title="Apagar este passo?" danger confirmLabel="Apagar" busyLabel="Apagando..." busy={deletingOrphan}
          onConfirm={deleteOrphan} onCancel={() => setOrphanToDelete(null)}>
          A pergunta deste passo já saiu do roteiro. As respostas que os clientes já deram ficam guardadas na ficha do lead.
        </ConfirmDialog>
      )}
    </div>
  )
}

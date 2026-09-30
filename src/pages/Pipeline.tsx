import { useState, useEffect, useCallback, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import StageGateModal from '../components/roteiro/StageGateModal'
import AccountSelector from '../components/AccountSelector'
import FilterDropdown, { type FilterValue } from '../components/FilterDropdown'
import { useCityFilter } from '../components/CityFilter'
import MoreFilters, { useScoreFilter } from '../components/MoreFilters'
import ScoreBadge from '../components/score/ScoreBadge'
import { geoParams } from '../lib/geoFilter.js'
import { scoreParams, isScoreFilterActive, EMPTY_SCORE_FILTER } from '../lib/scoreFilter.js'
import { useSSE } from '../context/SSEContext'
import { fetchFunnels, fetchLeads, fetchTags, fetchUsers, moveLeadStage, RoteiroGateError, UseOutcomeError, fetchCustomerCard, type RoteiroPendingQuestion, fetchPipelineMetrics, archiveLead, type Funnel, type Lead, type PipelineMetric, type Tag, type User as ApiUser } from '../lib/api'
import { Phone, MessageCircle, User, Clock, ChevronDown, ChevronRight, ArrowRight, Smartphone, Archive } from 'lucide-react'
import { parseSqlDate } from '../lib/dates'
import SaleModal from '../components/SaleModal'
import OutcomeModal from '../components/OutcomeModal'

// Funil escolhido no Pipeline fica salvo por conta (spec LTV/Recompra §6/§12) — troca de conta
// nao "vaza" a escolha de outra conta, e o navegador lembra da ultima vez (mesmo padrao do
// useCityFilter). localStorage pode lancar em aba anonima/storage desabilitado — nunca deixa quebrar a tela.
const funnelStorageKey = (accountId: number) => `pipeline:funnel:${accountId}`
function useFunnelId(accountId: number | null | undefined): [number | null, (id: number) => void] {
  const [funnelId, setFunnelIdState] = useState<number | null>(null)
  useEffect(() => {
    if (!accountId) { setFunnelIdState(null); return }
    try {
      const raw = localStorage.getItem(funnelStorageKey(accountId))
      setFunnelIdState(raw ? Number(raw) : null)
    } catch { setFunnelIdState(null) }
  }, [accountId])
  const setFunnelId = (id: number) => {
    setFunnelIdState(id)
    if (!accountId) return
    try { localStorage.setItem(funnelStorageKey(accountId), String(id)) } catch {}
  }
  return [funnelId, setFunnelId]
}

function timeAgo(dateStr: string) {
  // parseSqlDate interpreta UTC (backend grava sem timezone)
  const diff = Date.now() - parseSqlDate(dateStr).getTime()
  const mins = Math.max(0, Math.floor(diff / 60000))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 640)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth <= 640)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return isMobile
}

export default function Pipeline() {
  const navigate = useNavigate()
  const { accountId, accounts } = useAccount()
  const isMobile = useIsMobile()
  const [funnelId, setFunnelId] = useFunnelId(accountId)
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedLead, setDraggedLead] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<PipelineMetric[]>([])
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set())
  const [moveLeadId, setMoveLeadId] = useState<number | null>(null)
  // Modal de valor: aparece quando lead move pra stage is_conversion=1
  const [saleModal, setSaleModal] = useState<{ leadId: number; stageId: number; leadName: string; stageName: string } | null>(null)
  // Janela "Falta saber": o cartao volta para a etapa de origem e o modal mostra o que falta
  // Janela de desfecho de recompra (Task 12, spec §6.3): "Não comprou agora" / "Não quer mais"
  const [outcomeModal, setOutcomeModal] = useState<{ leadId: number; stageId: number; outcome: 'nao_agora' | 'nao_quer'; leadName: string; reasons: { id: number; label: string }[]; defaultDays: number } | null>(null)
  const { user } = useAuth()
  const canForce = user?.role === 'gerente' || user?.role === 'super_admin'
  const [stageGate, setStageGate] = useState<{ leadId: number; toStage: { id: number; name: string }; pending: RoteiroPendingQuestion[] } | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<FilterValue[]>([])
  const [users, setUsers] = useState<ApiUser[]>([])
  const [attendantFilter, setAttendantFilter] = useState<FilterValue[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [cityFilter, setCityFilter] = useCityFilter(accountId)
  const [scoreFilter, setScoreFilter] = useScoreFilter(accountId)
  const [expandedColumns, setExpandedColumns] = useState<Set<number>>(new Set())
  const CARDS_LIMIT = 5

  const loadData = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const f = await fetchFunnels(accountId)
      setFunnels(f)
      // Funil escolhido pelo usuario (persistido por conta) — cai pro padrao se ainda nao
      // escolheu, ou se o funil salvo sumiu (ex.: desativado).
      const active = (funnelId && f.find(x => x.id === funnelId)) || f.find(x => x.is_default) || f[0] || null
      setFunnel(active || null)
      if (active && active.id !== funnelId) setFunnelId(active.id)
      if (active) {
        const [data, m] = await Promise.all([
          fetchLeads(accountId, { funnel_id: active.id, limit: 500, ...geoParams(cityFilter), ...scoreParams(scoreFilter) }),
          fetchPipelineMetrics(accountId, active.id, cityFilter).catch(() => ({ metrics: [], totalLeads: 0 })),
        ])
        setLeads(data.leads)
        setMetrics(m.metrics)
        // Auto-expand stages with leads on mobile
        if (isMobile) {
          const withLeads = new Set(data.leads.map(l => l.stage_id))
          setExpandedStages(withLeads)
        }
      }
    } catch {}
    setLoading(false)
  }, [accountId, isMobile, cityFilter, scoreFilter, funnelId])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => { if (accountId) fetchTags(accountId).then(setTags).catch(() => {}) }, [accountId])
  useEffect(() => { if (accountId) fetchUsers(accountId).then(setUsers).catch(() => {}) }, [accountId])

  const filteredLeads = leads.filter(l => {
    if (tagFilter.length > 0) {
      const wantsUntagged = tagFilter.includes('untagged')
      const wantedTagIds = tagFilter.filter((v): v is number => typeof v === 'number')
      const hasNoTags = !l.tags || l.tags.length === 0
      const hasWantedTag = l.tags?.some(t => wantedTagIds.includes(t.id)) || false
      if (!((wantsUntagged && hasNoTags) || hasWantedTag)) return false
    }
    if (attendantFilter.length > 0) {
      const wantsNoAttendant = attendantFilter.includes('none')
      const wantedAttIds = attendantFilter.filter((v): v is number => typeof v === 'number')
      const isNone = !l.attendant_id
      const matches = l.attendant_id != null && wantedAttIds.includes(l.attendant_id)
      if (!((wantsNoAttendant && isNone) || matches)) return false
    }
    if (dateFrom) {
      const created = new Date(l.created_at).getTime()
      if (created < new Date(dateFrom + 'T00:00:00').getTime()) return false
    }
    if (dateTo) {
      const created = new Date(l.created_at).getTime()
      if (created > new Date(dateTo + 'T23:59:59').getTime()) return false
    }
    return true
  })

  useSSE('lead:created', useCallback(() => loadData(), [loadData]))
  useSSE('lead:updated', useCallback(() => loadData(), [loadData]))
  useSSE('lead:archived', useCallback((data: { id: number }) => setLeads(prev => prev.filter(l => l.id !== data.id)), []))
  useSSE('lead:unarchived', useCallback(() => loadData(), [loadData]))

  const handleArchive = async (e: MouseEvent, leadId: number) => {
    e.stopPropagation()
    if (!confirm('Arquivar este lead? Ele some do pipeline e do chat, mas o historico fica salvo.')) return
    setLeads(prev => prev.filter(l => l.id !== leadId))
    try { await archiveLead(leadId) } catch { loadData() }
  }

  const handleDragStart = (leadId: number) => setDraggedLead(leadId)
  const handleDragEnd = () => setDraggedLead(null)

  // Move de fato — extraído pra ser reusado depois do modal
  const doMoveLead = async (leadId: number, stageId: number) => {
    const fromStageId = leads.find(l => l.id === leadId)?.stage_id
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: stageId } : l))
    try {
      await moveLeadStage(leadId, stageId, { accountId })
    } catch (e) {
      if (e instanceof RoteiroGateError) {
        // Reverte o cartao e abre a janela com as perguntas que faltam
        if (fromStageId != null) setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: fromStageId } : l))
        const target = (funnel?.stages || []).find(s => s.id === stageId)
        setStageGate({ leadId, toStage: { id: stageId, name: target?.name || 'a próxima etapa' }, pending: e.pending })
        return
      }
      if (e instanceof UseOutcomeError) {
        // Caminho defensivo: o servidor recusou o move direto pra uma etapa de desfecho da
        // recompra por algum caminho que tryMoveWithSaleCheck nao cobriu — reverte o cartao e
        // abre a mesma janela de desfecho.
        if (fromStageId != null) setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: fromStageId } : l))
        await openOutcomeModal(leadId, stageId)
        return
      }
      loadData()
    }
  }
  // Busca motivos/lembrete do cartao do cliente e abre a janela de desfecho (nao_agora/nao_quer)
  const openOutcomeModal = async (leadId: number, stageId: number) => {
    const target = (funnel?.stages || []).find(s => s.id === stageId)
    const outcome = target?.system_key === 'nao_agora' || target?.system_key === 'nao_quer' ? target.system_key : null
    if (!outcome || !accountId) return
    const lead = leads.find(l => l.id === leadId)
    try {
      const card = await fetchCustomerCard(leadId, accountId)
      setOutcomeModal({
        leadId, stageId, outcome,
        leadName: lead?.name || 'Lead',
        reasons: card.reasons[outcome] || [],
        defaultDays: card.cycle?.remind_days ?? 30,
      })
    } catch {
      // Nao conseguiu buscar motivos — nao move o card (evita perder o motivo obrigatorio)
    }
  }
  // [Perguntar agora]: abre o Chat do lead com a pergunta na caixa
  const askInChat = (leadId: number) => (text: string, questionKey: string | null) => {
    navigate(`/chat?lead_id=${leadId}`, { state: { roteiroAsk: { text, questionKey } } })
  }

  // Checa se o stage destino eh de conversao. Se for E o lead ainda nao tem value_estimated,
  // abre a janela de venda antes de mover. O card so muda de coluna depois do onSaved —
  // fechar sem salvar (Cancelar) deixa o card na coluna de origem.
  const tryMoveWithSaleCheck = (leadId: number, stageId: number) => {
    const lead = leads.find(l => l.id === leadId)
    if (!lead || lead.stage_id === stageId) return
    const targetStage = (funnel?.stages || []).find(s => s.id === stageId)
    // Etapa de desfecho da recompra (nao_agora/nao_quer, spec §6.3) — nao move na hora, abre a
    // janela de motivo primeiro. So um successful outcome (ou cancelar) decide o que acontece com o card.
    if (targetStage?.system_key === 'nao_agora' || targetStage?.system_key === 'nao_quer') {
      openOutcomeModal(leadId, stageId)
      return
    }
    const isConversion = !!(targetStage && targetStage.is_conversion)
    const alreadyHasValue = !!((lead as any).value_estimated && Number((lead as any).value_estimated) > 0)
    if (isConversion && !alreadyHasValue) {
      setSaleModal({ leadId, stageId, leadName: lead.name || 'Lead', stageName: targetStage!.name })
      return
    }
    doMoveLead(leadId, stageId)
  }

  const handleDrop = async (stageId: number) => {
    if (!draggedLead) return
    const leadId = draggedLead
    setDraggedLead(null)
    tryMoveWithSaleCheck(leadId, stageId)
  }

  const handleMobileMove = async (leadId: number, stageId: number) => {
    setMoveLeadId(null)
    tryMoveWithSaleCheck(leadId, stageId)
  }

  // <SaleModal> ja fez o POST e devolveu o total das vendas do lead — atualiza o card local e
  // so agora move o lead de fato pra coluna de destino.
  const handleSaleSaved = async (total: number) => {
    if (!saleModal) return
    const { leadId, stageId } = saleModal
    setLeads(prev => prev.map(l => l.id === leadId ? ({ ...l, value_estimated: total } as any) : l))
    await doMoveLead(leadId, stageId)
  }

  const toggleStage = (stageId: number) => {
    setExpandedStages(prev => {
      const next = new Set(prev)
      next.has(stageId) ? next.delete(stageId) : next.add(stageId)
      return next
    })
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!funnel) return <div className="empty-state"><h3>Nenhum funil configurado</h3><p>Crie um funil na pagina de Funis.</p></div>

  const stages = funnel.stages || []
  const aiEnabledForAccount = !!accounts.find(a => a.id === accountId)?.ai_agents_enabled

  const gateModal = stageGate && accountId && (
    <StageGateModal
      leadId={stageGate.leadId}
      accountId={accountId}
      toStage={stageGate.toStage}
      pending={stageGate.pending}
      canForce={canForce}
      onAsk={askInChat(stageGate.leadId)}
      onDone={moved => { setStageGate(null); if (moved) loadData() }}
    />
  )

  // MOBILE: Vertical accordion layout
  if (isMobile) {
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1>Pipeline</h1>
            <AccountSelector />
          </div>
        </div>

        {stages.map(stage => {
          const stageLeads = filteredLeads.filter(l => l.stage_id === stage.id)
          const expanded = expandedStages.has(stage.id)
          const metric = metrics.find(m => m.stage_id === stage.id)

          return (
            <div key={stage.id} className="kanban-mobile-stage">
              <div className="kanban-mobile-stage-header" onClick={() => toggleStage(stage.id)}>
                <div className="kanban-mobile-stage-title">
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: stage.color }} />
                  {stage.name}
                  <span style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 10, fontSize: 12, color: '#9B96B0' }}>{stageLeads.length}</span>
                  {metric?.conversion_from_prev != null && <span style={{ fontSize: 10, color: '#9B96B0' }}>{metric.conversion_from_prev.toFixed(0)}%</span>}
                </div>
                {expanded ? <ChevronDown size={16} style={{ color: '#9B96B0' }} /> : <ChevronRight size={16} style={{ color: '#9B96B0' }} />}
              </div>
              {expanded && stageLeads.length > 0 && (
                <div className="kanban-mobile-cards">
                  {stageLeads.map(lead => (
                    <div key={lead.id} className="kanban-mobile-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div onClick={() => navigate(`/leads/${lead.id}`)} style={{ cursor: 'pointer', flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>{lead.name || 'Sem nome'} <ScoreBadge score={lead.score} band={lead.score_band} prev={lead.score_prev} /></div>
                          {lead.phone && <div style={{ fontSize: 12, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}><Phone size={10} /> {lead.phone}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          <button className="btn btn-secondary btn-sm" title="Arquivar" onClick={e => handleArchive(e, lead.id)}>
                            <Archive size={12} />
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setMoveLeadId(lead.id)}>
                            <ArrowRight size={12} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, color: '#6B6580', flexWrap: 'wrap' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>{lead.source === 'whatsapp' ? <MessageCircle size={9} /> : <User size={9} />} {lead.source}</span>
                        {lead.attendant_name && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><User size={9} /> {lead.attendant_name}</span>}
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={9} /> {timeAgo(lead.created_at)}</span>
                        {lead.instance_name && <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: '#34C759' }}><Smartphone size={9} /> {lead.instance_name}</span>}
                      </div>
                      {lead.tags && lead.tags.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                          {lead.tags.map(t => <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color }}>{t.name}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {expanded && stageLeads.length === 0 && (
                <div style={{ padding: '20px 14px', textAlign: 'center', color: '#6B6580', fontSize: 12 }}>Nenhum lead nesta etapa</div>
              )}
            </div>
          )
        })}

        {gateModal}

        {outcomeModal && accountId && (
          <OutcomeModal
            open
            outcome={outcomeModal.outcome}
            leadId={outcomeModal.leadId}
            accountId={accountId}
            leadName={outcomeModal.leadName}
            reasons={outcomeModal.reasons}
            defaultDays={outcomeModal.defaultDays}
            onClose={() => setOutcomeModal(null)}
            onDone={() => loadData()}
          />
        )}

        {/* Move lead modal */}
        {moveLeadId && (
          <div className="modal-overlay" onClick={() => setMoveLeadId(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>Mover lead</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stages.map(s => {
                  const isCurrentStage = leads.find(l => l.id === moveLeadId)?.stage_id === s.id
                  return (
                    <button key={s.id} className={`btn ${isCurrentStage ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => !isCurrentStage && handleMobileMove(moveLeadId, s.id)}
                      disabled={isCurrentStage}
                      style={{ justifyContent: 'flex-start', minHeight: 44 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color }} />
                      {s.name} {isCurrentStage && '(atual)'}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // DESKTOP: Kanban board
  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1>Pipeline</h1>
          <AccountSelector />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {funnels.length > 1 && (
            <select className="select" style={{ width: 180 }} value={funnel.id} onChange={e => setFunnelId(+e.target.value)}>
              {funnels.map(f => <option key={f.id} value={f.id}>{f.kind === 'recompra' ? '🔁 Recompra' : f.name}</option>)}
            </select>
          )}
          <FilterDropdown
            label="tags"
            width={150}
            options={[
              { value: 'untagged', label: '(Sem tag)' },
              ...tags.map(t => ({ value: t.id, label: t.name })),
            ]}
            selected={tagFilter}
            onChange={setTagFilter}
          />
          <FilterDropdown
            label="atendentes"
            width={170}
            options={[
              { value: 'none', label: '(Sem atendente)' },
              ...users.filter(u => u.is_active).map(u => ({ value: u.id, label: u.name })),
            ]}
            selected={attendantFilter}
            onChange={setAttendantFilter}
          />
          <input type="date" className="input" style={{ width: 140 }} value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Data inicial (criacao)" />
          <input type="date" className="input" style={{ width: 140 }} value={dateTo} onChange={e => setDateTo(e.target.value)} title="Data final (criacao)" />
          <MoreFilters accountId={accountId} city={cityFilter} onCityChange={setCityFilter} score={scoreFilter} onScoreChange={setScoreFilter} />
          {(tagFilter.length > 0 || attendantFilter.length > 0 || dateFrom || dateTo || cityFilter || isScoreFilterActive(scoreFilter)) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setTagFilter([]); setAttendantFilter([]); setDateFrom(''); setDateTo(''); setCityFilter(''); setScoreFilter({ ...EMPTY_SCORE_FILTER, bands: [] }) }}>
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      <div className="kanban-board">
        {stages.map(stage => {
          const stageLeads = filteredLeads.filter(l => l.stage_id === stage.id)
          const metric = metrics.find(m => m.stage_id === stage.id)
          return (
            <div key={stage.id} className="kanban-column"
              onDragOver={e => { e.preventDefault(); e.currentTarget.querySelector('.kanban-cards')?.classList.add('drag-over') }}
              onDragLeave={e => e.currentTarget.querySelector('.kanban-cards')?.classList.remove('drag-over')}
              onDrop={e => { e.preventDefault(); e.currentTarget.querySelector('.kanban-cards')?.classList.remove('drag-over'); handleDrop(stage.id) }}>
              <div className="kanban-column-header">
                <div className="kanban-column-title">
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: stage.color, display: 'inline-block' }} />
                  {stage.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {metric?.conversion_from_prev != null && (
                    <span style={{ fontSize: 9, color: '#9B96B0', fontWeight: 500 }}>{metric.conversion_from_prev.toFixed(0)}%</span>
                  )}
                  {metric?.avg_hours_in_stage != null && (
                    <span style={{ fontSize: 9, color: '#6B6580' }}>{metric.avg_hours_in_stage < 24 ? `${metric.avg_hours_in_stage.toFixed(0)}h` : `${(metric.avg_hours_in_stage / 24).toFixed(1)}d`}</span>
                  )}
                  <span className="kanban-column-count">{stageLeads.length}</span>
                </div>
              </div>
              <div className="kanban-cards">
                {(expandedColumns.has(stage.id) ? stageLeads : stageLeads.slice(0, CARDS_LIMIT)).map(lead => (
                  <div key={lead.id} className={`kanban-card ${draggedLead === lead.id ? 'dragging' : ''}`}
                    draggable onDragStart={() => handleDragStart(lead.id)} onDragEnd={handleDragEnd}
                    onClick={() => navigate(`/leads/${lead.id}`)}
                    style={{ borderLeft: `3px solid ${stage.color}`, position: 'relative' }}>
                    <button className="kanban-card-archive" title="Arquivar" onClick={e => handleArchive(e, lead.id)}
                      style={{ position: 'absolute', top: 6, right: 6, background: 'transparent', border: 'none', color: '#9B96B0', cursor: 'pointer', padding: 4, borderRadius: 4, display: 'flex', opacity: 0.5 }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.background = 'transparent' }}>
                      <Archive size={12} />
                    </button>
                    <div className="kanban-card-name" style={{ paddingRight: 20, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{lead.name || 'Sem nome'}</span>
                      <ScoreBadge score={lead.score} band={lead.score_band} prev={lead.score_prev} />
                    </div>
                    {lead.phone && <div className="kanban-card-phone"><Phone size={10} /> {lead.phone}</div>}
                    {lead.tags && lead.tags.length > 0 && (
                      <div className="kanban-card-tags">
                        {lead.tags.map(t => <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color }}>{t.name}</span>)}
                      </div>
                    )}
                    <div className="kanban-card-meta">
                      <span className="kanban-card-source">{lead.source === 'whatsapp' ? <MessageCircle size={10} /> : <User size={10} />} {lead.source || 'manual'}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={10} /> {timeAgo(lead.created_at)}</span>
                    </div>
                    {lead.attendant_name && <div className="kanban-card-attendant"><User size={10} /> {lead.attendant_name}</div>}
                    {lead.instance_name && <div style={{ fontSize: 10, color: '#34C759', display: 'flex', alignItems: 'center', gap: 3, marginTop: 2 }}><Smartphone size={9} /> {lead.instance_name}</div>}
                  </div>
                ))}
                {!expandedColumns.has(stage.id) && stageLeads.length > CARDS_LIMIT && (
                  <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: 11, marginTop: 4 }}
                    onClick={() => setExpandedColumns(prev => { const n = new Set(prev); n.add(stage.id); return n })}>
                    Ver mais ({stageLeads.length - CARDS_LIMIT} restantes)
                  </button>
                )}
                {expandedColumns.has(stage.id) && stageLeads.length > CARDS_LIMIT && (
                  <button className="btn btn-secondary btn-sm" style={{ width: '100%', fontSize: 11, marginTop: 4 }}
                    onClick={() => setExpandedColumns(prev => { const n = new Set(prev); n.delete(stage.id); return n })}>
                    Ver menos
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Janela unica de venda ao mover pra stage de conversao. So move o card de coluna depois
          do onSaved — fechar sem salvar (Cancelar) deixa o card na coluna de origem. */}
      {saleModal && accountId && (
        <SaleModal
          open
          leadId={saleModal.leadId}
          accountId={accountId}
          leadName={saleModal.leadName}
          aiEnabled={aiEnabledForAccount}
          note={<>Movendo <strong style={{ color: 'var(--text-primary)' }}>{saleModal.leadName}</strong> pra <strong style={{ color: '#34C759' }}>{saleModal.stageName}</strong>.</>}
          onClose={() => setSaleModal(null)}
          onSaved={handleSaleSaved}
        />
      )}

      {outcomeModal && accountId && (
        <OutcomeModal
          open
          outcome={outcomeModal.outcome}
          leadId={outcomeModal.leadId}
          accountId={accountId}
          leadName={outcomeModal.leadName}
          reasons={outcomeModal.reasons}
          defaultDays={outcomeModal.defaultDays}
          onClose={() => setOutcomeModal(null)}
          onDone={() => loadData()}
        />
      )}

      {gateModal}
    </div>
  )
}

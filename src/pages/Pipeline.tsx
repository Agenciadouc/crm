import { useState, useEffect, useCallback, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import AccountSelector from '../components/AccountSelector'
import FilterDropdown, { type FilterValue } from '../components/FilterDropdown'
import { useSSE } from '../context/SSEContext'
import { fetchFunnels, fetchLeads, fetchTags, fetchUsers, moveLeadStage, fetchPipelineMetrics, archiveLead, type Funnel, type Lead, type PipelineMetric, type Tag, type User } from '../lib/api'
import { Phone, MessageCircle, User, Clock, ChevronDown, ChevronRight, ArrowRight, Smartphone, Archive } from 'lucide-react'
import { parseSqlDate } from '../lib/dates'

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
  const { accountId } = useAccount()
  const isMobile = useIsMobile()
  const [funnel, setFunnel] = useState<Funnel | null>(null)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedLead, setDraggedLead] = useState<number | null>(null)
  const [metrics, setMetrics] = useState<PipelineMetric[]>([])
  const [expandedStages, setExpandedStages] = useState<Set<number>>(new Set())
  const [moveLeadId, setMoveLeadId] = useState<number | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [tagFilter, setTagFilter] = useState<FilterValue[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [attendantFilter, setAttendantFilter] = useState<FilterValue[]>([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedColumns, setExpandedColumns] = useState<Set<number>>(new Set())
  const CARDS_LIMIT = 5

  const loadData = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const f = await fetchFunnels(accountId)
      setFunnels(f)
      const active = f.find(x => x.is_default) || f[0]
      setFunnel(active || null)
      if (active) {
        const [data, m] = await Promise.all([
          fetchLeads(accountId, { funnel_id: active.id, limit: 500 }),
          fetchPipelineMetrics(accountId, active.id).catch(() => ({ metrics: [], totalLeads: 0 })),
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
  }, [accountId, isMobile])

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

  const handleDrop = async (stageId: number) => {
    if (!draggedLead) return
    const lead = leads.find(l => l.id === draggedLead)
    if (!lead || lead.stage_id === stageId) return
    setLeads(prev => prev.map(l => l.id === draggedLead ? { ...l, stage_id: stageId } : l))
    setDraggedLead(null)
    try { await moveLeadStage(draggedLead, stageId) } catch { loadData() }
  }

  const handleMobileMove = async (leadId: number, stageId: number) => {
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, stage_id: stageId } : l))
    setMoveLeadId(null)
    try { await moveLeadStage(leadId, stageId) } catch { loadData() }
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
                          <div style={{ fontSize: 14, fontWeight: 600 }}>{lead.name || 'Sem nome'}</div>
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
            <select className="select" style={{ width: 180 }} value={funnel.id} onChange={e => { const f = funnels.find(x => x.id === +e.target.value); if (f) setFunnel(f) }}>
              {funnels.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
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
          {(tagFilter.length > 0 || attendantFilter.length > 0 || dateFrom || dateTo) && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setTagFilter([]); setAttendantFilter([]); setDateFrom(''); setDateTo('') }}>
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
                    <div className="kanban-card-name" style={{ paddingRight: 20 }}>{lead.name || 'Sem nome'}</div>
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
    </div>
  )
}

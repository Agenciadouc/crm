import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import AccountSelector from '../components/AccountSelector'
import {
  fetchLeads, fetchFunnels, fetchUsers, fetchTags, createLead, bulkAssignLeads, bulkMoveLeads,
  archiveLead, unarchiveLead, fetchArchivedCount, fetchWhatsAppInstances,
  formatNumber, type Lead, type Funnel, type User as UserType, type Tag, type WhatsAppInstance,
} from '../lib/api'
import { Plus, Download, Phone, MessageCircle, Clock, CheckSquare, Square, Users, ArrowRight, Archive, ArchiveRestore } from 'lucide-react'
import { parseSqlDate } from '../lib/dates'

function timeAgo(d: string) { const m = Math.max(0, Math.floor((Date.now() - parseSqlDate(d).getTime()) / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); if (h < 24) return `${h}h`; return `${Math.floor(h / 24)}d` }

function useIsMobile() {
  const [m, setM] = useState(window.innerWidth <= 640)
  useEffect(() => { const h = () => setM(window.innerWidth <= 640); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  return m
}

export default function Leads() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [attendantFilter, setAttendantFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [newLead, setNewLead] = useState<Record<string, any>>({ name: '', phone: '', email: '', city: '', source: 'manual', empresa: '', cpf_cnpj: '', instagram: '', trabalha_anuncio: 0, investimento_anuncios: '' })
  const [showArchived, setShowArchived] = useState(false)
  const [archivedCount, setArchivedCount] = useState<{ count: number; withActivity: number }>({ count: 0, withActivity: 0 })
  // Bulk
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showBulkAssign, setShowBulkAssign] = useState(false)
  const [showBulkStage, setShowBulkStage] = useState(false)

  const [whatsappInstances, setWhatsappInstances] = useState<WhatsAppInstance[]>([])

  useEffect(() => {
    if (!accountId) return
    fetchFunnels(accountId).then(setFunnels).catch(() => {})
    fetchUsers(accountId).then(setUsers).catch(() => {})
    fetchTags(accountId).then(setTags).catch(() => {})
    fetchWhatsAppInstances(accountId).then(insts => setWhatsappInstances(insts.filter(i => i.status === 'connected'))).catch(() => {})
  }, [accountId])

  const loadLeads = () => {
    if (!accountId) return
    setLoading(true)
    fetchLeads(accountId, {
      search: search || undefined, stage_id: stageFilter ? +stageFilter : undefined,
      source: sourceFilter || undefined, attendant_id: attendantFilter ? +attendantFilter : undefined,
      date_from: dateFrom || undefined, date_to: dateTo || undefined,
      tag: tagFilter ? +tagFilter : undefined,
      show_archived: showArchived ? '1' : undefined,
      page, limit: 30,
    })
      .then(d => { setLeads(d.leads); setTotal(d.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(loadLeads, [accountId, search, stageFilter, sourceFilter, attendantFilter, dateFrom, dateTo, tagFilter, showArchived, page])

  const loadArchivedCount = useCallback(() => {
    if (!accountId) return
    fetchArchivedCount(accountId).then(setArchivedCount).catch(() => {})
  }, [accountId])
  useEffect(() => { loadArchivedCount() }, [loadArchivedCount])

  useSSE('lead:archived', useCallback(() => loadArchivedCount(), [loadArchivedCount]))
  useSSE('lead:unarchived', useCallback(() => loadArchivedCount(), [loadArchivedCount]))
  useSSE('lead:archived-activity', useCallback(() => loadArchivedCount(), [loadArchivedCount]))

  const handleToggleArchive = async (e: { stopPropagation?: () => void }, leadId: number, isArchived: boolean) => {
    e.stopPropagation?.()
    if (!confirm(isArchived ? 'Desarquivar este lead?' : 'Arquivar este lead?')) return
    setLeads(prev => prev.filter(l => l.id !== leadId))
    try {
      if (isArchived) await unarchiveLead(leadId)
      else await archiveLead(leadId)
      loadArchivedCount()
    } catch { loadLeads() }
  }

  const handleCreate = async () => {
    if (!accountId || !newLead.name) return
    await createLead(accountId, newLead)
    setShowNew(false); setNewLead({ name: '', phone: '', email: '', city: '', source: 'manual', empresa: '', cpf_cnpj: '', instagram: '', trabalha_anuncio: 0, investimento_anuncios: '' }); loadLeads()
  }

  const toggleSelect = (id: number) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const toggleSelectAll = () => {
    if (selected.size === leads.length) setSelected(new Set())
    else setSelected(new Set(leads.map(l => l.id)))
  }

  const handleBulkAssign = async (attId: number | null) => {
    if (!accountId) return
    await bulkAssignLeads(accountId, [...selected], attId)
    setSelected(new Set()); setShowBulkAssign(false); loadLeads()
  }

  const handleBulkStage = async (stageId: number) => {
    if (!accountId) return
    await bulkMoveLeads(accountId, [...selected], stageId)
    setSelected(new Set()); setShowBulkStage(false); loadLeads()
  }

  const allStages = funnels.flatMap(f => f.stages || [])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1>Leads <span style={{ fontSize: 14, color: '#9B96B0', fontWeight: 400 }}>({formatNumber(total)})</span></h1><AccountSelector /></div>
        <div className="page-header-actions">
          <button
            className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => { setShowArchived(v => !v); setPage(1) }}
            title={showArchived ? 'Mostrar leads ativos' : 'Mostrar leads arquivados'}>
            {showArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            {showArchived ? ' Ver ativos' : ` Arquivados (${archivedCount.count})`}
            {!showArchived && archivedCount.withActivity > 0 && (
              <span style={{ marginLeft: 6, background: '#FFB300', color: '#000', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10 }}>{archivedCount.withActivity} nova{archivedCount.withActivity > 1 ? 's' : ''}</span>
            )}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={async () => {
            const token = localStorage.getItem('dros_crm_token')
            const res = await fetch(`/api/leads/export?account_id=${accountId}`, { headers: { Authorization: `Bearer ${token}` } })
            const blob = await res.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`; a.click()
            URL.revokeObjectURL(url)
          }}><Download size={14} /> Exportar</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Lead</button>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        <input className="input search-input" placeholder="Buscar nome, telefone, email..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select className="select" value={stageFilter} onChange={e => { setStageFilter(e.target.value); setPage(1) }}>
          <option value="">Todas etapas</option>
          {allStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1) }}>
          <option value="">Todas fontes</option>
          <option value="whatsapp">WhatsApp</option><option value="meta_form">Meta Form</option><option value="website">Website</option><option value="manual">Manual</option>
        </select>
        {user?.role !== 'atendente' && (
          <select className="select" value={attendantFilter} onChange={e => { setAttendantFilter(e.target.value); setPage(1) }}>
            <option value="">Todos atendentes</option>
            <option value="0">Sem atendente</option>
            {users.filter(u => u.role === 'atendente' || u.role === 'gerente').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        )}
        {tags.length > 0 && (
          <select className="select" value={tagFilter} onChange={e => { setTagFilter(e.target.value); setPage(1) }}>
            <option value="">Todas tags</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>
      <div className="filter-bar" style={{ marginTop: -8 }}>
        <input className="input" type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} style={{ width: 160 }} />
        <span style={{ color: '#6B6580', fontSize: 12 }}>ate</span>
        <input className="input" type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} style={{ width: 160 }} />
        {(dateFrom || dateTo || search || stageFilter || sourceFilter || attendantFilter || tagFilter) && (
          <button className="btn btn-secondary btn-sm" onClick={() => { setSearch(''); setStageFilter(''); setSourceFilter(''); setAttendantFilter(''); setDateFrom(''); setDateTo(''); setTagFilter(''); setPage(1) }}>Limpar filtros</button>
        )}
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && user?.role !== 'atendente' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', background: 'rgba(255,179,0,0.08)', borderRadius: 8, marginBottom: 12, border: '1px solid rgba(255,179,0,0.15)' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#FFB300' }}>{selected.size} selecionados</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAssign(true)}><Users size={12} /> Atribuir</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkStage(true)}><ArrowRight size={12} /> Mover etapa</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setSelected(new Set())}>Cancelar</button>
        </div>
      )}

      {/* Content */}
      {loading ? <div className="loading-container"><div className="spinner" /></div> : isMobile ? (
        /* MOBILE: Card layout */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {leads.map(l => (
            <div key={l.id} className="lead-mobile-card" onClick={() => navigate(`/leads/${l.id}`)} style={{ position: 'relative' }}>
              <div className="lead-mobile-card-header">
                <div>
                  <div className="lead-mobile-card-name">{l.name || 'Sem nome'}</div>
                  {l.phone && <div style={{ fontSize: 12, color: '#9B96B0', marginTop: 2 }}>{l.phone}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                  <span className="stage-badge" style={{ background: `${l.stage_color}20`, color: l.stage_color, fontSize: 10 }}>{l.stage_name}</span>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ padding: '4px 6px', position: 'relative' }}
                    title={l.is_archived ? 'Desarquivar' : 'Arquivar'}
                    onClick={e => handleToggleArchive(e, l.id, !!l.is_archived)}>
                    {l.is_archived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
                    {l.is_archived && l.has_new_after_archive ? <span style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#FFB300' }} /> : null}
                  </button>
                </div>
              </div>
              <div className="lead-mobile-card-meta">
                {l.attendant_name ? <span><Users size={10} /> {l.attendant_name}</span> : <span style={{ color: '#FF6B6B' }}>Sem atendente</span>}
                <span>{l.source === 'whatsapp' ? <MessageCircle size={10} /> : <Phone size={10} />} {l.source}</span>
                {l.city && <span>{l.city}</span>}
                <span><Clock size={10} /> {timeAgo(l.created_at)}</span>
              </div>
              {l.tags && l.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap' }}>
                  {l.tags.map(t => <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color }}>{t.name}</span>)}
                </div>
              )}
            </div>
          ))}
          {leads.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhum lead encontrado</div>}
          {total > 30 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 12 }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
              <span style={{ fontSize: 12, color: '#9B96B0', padding: '8px 12px' }}>{page}/{Math.ceil(total / 30)}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / 30)} onClick={() => setPage(p => p + 1)}>Proxima</button>
            </div>
          )}
        </div>
      ) : (
        /* DESKTOP: Table layout */
        <div className="table-card">
          <table>
            <thead><tr>
              {user?.role !== 'atendente' && <th style={{ width: 32 }}><button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9B96B0' }} onClick={toggleSelectAll}>{selected.size === leads.length && leads.length > 0 ? <CheckSquare size={14} /> : <Square size={14} />}</button></th>}
              <th>Nome</th><th>Telefone</th><th>Etapa</th><th>Atendente</th><th>Fonte</th><th>Cidade</th><th className="right">Criado</th><th style={{ width: 88 }}></th>
            </tr></thead>
            <tbody>
              {leads.map(l => (
                <tr key={l.id} style={{ cursor: 'pointer' }}>
                  {user?.role !== 'atendente' && <td onClick={e => { e.stopPropagation(); toggleSelect(l.id) }}><span style={{ color: selected.has(l.id) ? '#FFB300' : '#6B6580', cursor: 'pointer' }}>{selected.has(l.id) ? <CheckSquare size={14} /> : <Square size={14} />}</span></td>}
                  <td className="name" onClick={() => navigate(`/leads/${l.id}`)}>{l.name || 'Sem nome'}
                    {l.tags && l.tags.length > 0 && <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>{l.tags.map(t => <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color }}>{t.name}</span>)}</div>}
                  </td>
                  <td onClick={() => navigate(`/leads/${l.id}`)}>{l.phone || '-'}</td>
                  <td onClick={() => navigate(`/leads/${l.id}`)}><span className="stage-badge" style={{ background: `${l.stage_color}20`, color: l.stage_color }}>{l.stage_name}</span></td>
                  <td onClick={() => navigate(`/leads/${l.id}`)}>{l.attendant_name || <span style={{ color: '#FF6B6B', fontSize: 11 }}>Sem atendente</span>}</td>
                  <td onClick={() => navigate(`/leads/${l.id}`)} style={{ fontSize: 11 }}>{l.source === 'whatsapp' ? <MessageCircle size={10} /> : <Phone size={10} />} {l.source}</td>
                  <td onClick={() => navigate(`/leads/${l.id}`)}>{l.city || '-'}</td>
                  <td className="right" onClick={() => navigate(`/leads/${l.id}`)}><Clock size={10} /> {timeAgo(l.created_at)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 6px', marginRight: 4, color: '#34C759' }}
                      title="Abrir chat"
                      onClick={e => { e.stopPropagation(); navigate(`/chat?lead=${l.id}`) }}>
                      <MessageCircle size={12} />
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 6px', position: 'relative' }}
                      title={l.is_archived ? 'Desarquivar' : 'Arquivar'}
                      onClick={e => handleToggleArchive(e, l.id, !!l.is_archived)}>
                      {l.is_archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                      {l.is_archived && l.has_new_after_archive ? <span style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#FFB300' }} /> : null}
                    </button>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={user?.role !== 'atendente' ? 9 : 8} style={{ textAlign: 'center', padding: 40, color: '#6B6580' }}>Nenhum lead encontrado</td></tr>}
            </tbody>
          </table>
          {total > 30 && (
            <div style={{ padding: 12, display: 'flex', justifyContent: 'center', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
              <span style={{ fontSize: 12, color: '#9B96B0', padding: '6px 12px' }}>Pagina {page} de {Math.ceil(total / 30)}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= Math.ceil(total / 30)} onClick={() => setPage(p => p + 1)}>Proxima</button>
            </div>
          )}
        </div>
      )}

      {/* New lead modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Lead</h2>
            <div className="form-group"><label>Nome *</label><input className="input" value={newLead.name} onChange={e => setNewLead(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-row">
              <div className="form-group"><label>Telefone</label><input className="input" value={newLead.phone} onChange={e => setNewLead(p => ({ ...p, phone: e.target.value }))} /></div>
              <div className="form-group"><label>Email</label><input className="input" value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Cidade</label><input className="input" value={newLead.city} onChange={e => setNewLead(p => ({ ...p, city: e.target.value }))} /></div>
              <div className="form-group"><label>Fonte</label><select className="select" value={newLead.source} onChange={e => setNewLead(p => ({ ...p, source: e.target.value }))}><option value="manual">Manual</option><option value="whatsapp">WhatsApp</option><option value="website">Website</option><option value="indicacao">Indicacao</option><option value="anuncio">Anuncio</option></select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Nome da Empresa</label><input className="input" value={newLead.empresa} onChange={e => setNewLead(p => ({ ...p, empresa: e.target.value }))} placeholder="Empresa do lead" /></div>
              <div className="form-group"><label>CPF/CNPJ</label><input className="input" value={newLead.cpf_cnpj} onChange={e => setNewLead(p => ({ ...p, cpf_cnpj: e.target.value }))} placeholder="000.000.000-00" /></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label>Instagram</label><input className="input" value={newLead.instagram} onChange={e => setNewLead(p => ({ ...p, instagram: e.target.value }))} placeholder="@perfil" /></div>
              <div className="form-group"><label>Investimento Anuncios (R$)</label><input className="input" type="number" step="0.01" value={newLead.investimento_anuncios} onChange={e => setNewLead(p => ({ ...p, investimento_anuncios: e.target.value }))} placeholder="5000.00" /></div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Trabalha com anuncio?</label>
                <select className="select" value={newLead.trabalha_anuncio || 0} onChange={e => setNewLead(p => ({ ...p, trabalha_anuncio: parseInt(e.target.value) }))}>
                  <option value={0}>Nao</option>
                  <option value={1}>Sim</option>
                </select>
              </div>
              {whatsappInstances.length > 0 && (
                <div className="form-group">
                  <label>Numero WhatsApp (envia por)</label>
                  <select className="select" value={newLead.instance_id || ''} onChange={e => setNewLead(p => ({ ...p, instance_id: e.target.value ? parseInt(e.target.value) : null }))}>
                    <option value="">Padrao (mais recente)</option>
                    {whatsappInstances.map(i => <option key={i.id} value={i.id}>{i.instance_name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="modal-actions"><button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button><button className="btn btn-primary" onClick={handleCreate}>Criar Lead</button></div>
          </div>
        </div>
      )}

      {/* Bulk assign modal */}
      {showBulkAssign && (
        <div className="modal-overlay" onClick={() => setShowBulkAssign(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Atribuir {selected.size} leads</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button className="btn btn-secondary" onClick={() => handleBulkAssign(null)} style={{ justifyContent: 'flex-start' }}>Remover atendente</button>
              {users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active).map(u => (
                <button key={u.id} className="btn btn-secondary" onClick={() => handleBulkAssign(u.id)} style={{ justifyContent: 'flex-start' }}><Users size={14} /> {u.name}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bulk stage modal */}
      {showBulkStage && (
        <div className="modal-overlay" onClick={() => setShowBulkStage(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Mover {selected.size} leads para</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allStages.map(s => (
                <button key={s.id} className="btn btn-secondary" onClick={() => handleBulkStage(s.id)} style={{ justifyContent: 'flex-start' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} /> {s.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

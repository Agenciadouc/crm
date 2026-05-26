import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import {
  fetchLead, fetchFunnels, fetchUsers, fetchTags, updateLead, moveLeadStage, assignLead,
  sendMessage, addLeadNote, addLeadTag, removeLeadTag, createTag,
  fetchLeadCadence, fetchCadences, assignLeadCadence, advanceLeadCadence, removeLeadCadence,
  fetchReadyMessages, fetchLeadQualifications, answerQualification,
  archiveLead, unarchiveLead, optInLead, optOutLead,
  type Lead, type Message, type StageHistoryEntry, type LeadNote, type Funnel, type User as UserType, type Tag,
  type LeadCadence, type Cadence, type ReadyMessage, type LeadQualification,
} from '../lib/api'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Send, Clock, User, GitBranch, Edit3, Save, X, Plus, StickyNote, Tag as TagIcon, ListOrdered, Zap, ClipboardList, ChevronRight, Check, Archive, ArchiveRestore, FileText } from 'lucide-react'
import MessageMedia from '../components/MessageMedia'
import { parseSqlDate } from '../lib/dates'

export default function LeadDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const { accountId } = useAccount()
  const navigate = useNavigate()
  const [lead, setLead] = useState<Lead | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [history, setHistory] = useState<StageHistoryEntry[]>([])
  const [notes, setNotes] = useState<LeadNote[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [msgText, setMsgText] = useState('')
  const [sending, setSending] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [editing, setEditing] = useState(false)
  const [editData, setEditData] = useState<Record<string, any>>({ name: '', phone: '', email: '', city: '', empresa: '', cpf_cnpj: '', instagram: '', trabalha_anuncio: 0, investimento_anuncios: '' })
  const [showTagMenu, setShowTagMenu] = useState(false)
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#FFB300')
  const [activeTab, setActiveTab] = useState<'notes' | 'history' | 'qualification'>('notes')
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [leadCadence, setLeadCadence] = useState<LeadCadence | null>(null)
  const [cadences, setCadences] = useState<Cadence[]>([])
  const [showCadenceMenu, setShowCadenceMenu] = useState(false)
  const [scriptModal, setScriptModal] = useState<{ text: string } | null>(null)
  const [readyMsgs, setReadyMsgs] = useState<ReadyMessage[]>([])
  const [showReadyMsgs, setShowReadyMsgs] = useState(false)
  const [qualifications, setQualifications] = useState<LeadQualification[]>([])
  const [qualAnswers, setQualAnswers] = useState<Record<number, string>>({})
  const [savingQual, setSavingQual] = useState<number | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const loadLead = useCallback(async () => {
    if (!id || !accountId) return
    const data = await fetchLead(+id, accountId)
    setLead(data.lead); setMessages(data.messages); setHistory(data.stageHistory); setNotes(data.notes || [])
    setEditData({ name: data.lead.name || '', phone: data.lead.phone || '', email: data.lead.email || '', city: data.lead.city || '', empresa: data.lead.empresa || '', cpf_cnpj: data.lead.cpf_cnpj || '', instagram: data.lead.instagram || '', trabalha_anuncio: data.lead.trabalha_anuncio || 0, investimento_anuncios: data.lead.investimento_anuncios || '' })
  }, [id, accountId])

  const loadCadence = useCallback(async () => {
    if (!id || !accountId) return
    const lc = await fetchLeadCadence(+id, accountId)
    setLeadCadence(lc)
  }, [id, accountId])

  const loadQualifications = useCallback(async () => {
    if (!id || !accountId) return
    const q = await fetchLeadQualifications(+id, accountId)
    setQualifications(q)
  }, [id, accountId])

  useEffect(() => {
    if (!id || !accountId) return
    setLoading(true)
    Promise.all([
      loadLead(), fetchFunnels(accountId).then(setFunnels), fetchUsers(accountId).then(setUsers), fetchTags(accountId).then(setTags),
      loadCadence(), fetchCadences(accountId).then(setCadences), fetchReadyMessages(accountId).then(setReadyMsgs), loadQualifications(),
    ]).finally(() => setLoading(false))
  }, [id, accountId, loadLead, loadCadence, loadQualifications])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useSSE('lead:message', useCallback((data: any) => { if (data.leadId === parseInt(id || '0')) loadLead() }, [id, loadLead]))
  useSSE('lead:updated', useCallback((data: any) => { if (data.id === parseInt(id || '0')) loadLead() }, [id, loadLead]))

  const handleSendMsg = async () => {
    if (!msgText.trim() || !lead || !accountId) return
    setSending(true)
    try {
      const result = await sendMessage(lead.id, accountId, msgText)
      setMessages(prev => [...prev, result.message])
      setMsgText('')
      if (!result.delivered) alert('Mensagem salva mas NAO enviada no WhatsApp. Verifique a conexao.')
    } catch (e: any) { alert('Erro: ' + (e?.message || 'desconhecido')) }
    setSending(false)
  }

  const handleSaveEdit = async () => {
    if (!lead) return
    await updateLead(lead.id, editData)
    setEditing(false); loadLead()
  }

  const handleAddNote = async () => {
    if (!noteText.trim() || !lead) return
    const note = await addLeadNote(lead.id, noteText)
    setNotes(prev => [note, ...prev]); setNoteText('')
  }

  const handleStageChange = async (stageId: number) => { if (lead) { await moveLeadStage(lead.id, stageId); loadLead() } }
  // Assign com modal de confirmacao + checkbox "enviar 1a msg"
  const [assignModal, setAssignModal] = useState<{ attId: number; userName: string } | null>(null)
  const [assignNotify, setAssignNotify] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const handleAssign = async (attId: number | null) => {
    if (!lead) return
    if (attId == null) {
      // Despatribuicao direta sem modal
      await assignLead(lead.id, null); loadLead(); return
    }
    if (attId === lead.attendant_id) return // sem mudanca
    // Encontra nome do atendente pra mostrar no modal
    const u = (users || []).find((x: any) => x.id === attId)
    setAssignNotify(false)
    setAssignModal({ attId, userName: u?.name || `User ${attId}` })
  }
  const confirmAssign = async () => {
    if (!lead || !assignModal) return
    setAssignSaving(true)
    try {
      await assignLead(lead.id, assignModal.attId, assignNotify)
      setAssignModal(null)
      loadLead()
    } catch (e: any) {
      alert('Erro: ' + (e?.message || 'desconhecido'))
    }
    setAssignSaving(false)
  }
  const handleAddTag = async (tagId: number) => { if (lead) { await addLeadTag(lead.id, tagId); loadLead(); setShowTagMenu(false) } }
  const handleCreateTag = async () => {
    if (!accountId || !newTagName.trim() || !lead) return
    const tag = await createTag(accountId, newTagName.trim(), newTagColor)
    setTags(prev => [...prev, tag])
    await addLeadTag(lead.id, tag.id)
    setNewTagName(''); loadLead()
  }
  const handleRemoveTag = async (tagId: number) => { if (lead) { await removeLeadTag(lead.id, tagId); loadLead() } }

  const handleAssignCadence = async (cadenceId: number) => {
    if (!lead || !accountId) return
    await assignLeadCadence(cadenceId, accountId, lead.id)
    setShowCadenceMenu(false); loadCadence()
  }
  const handleAdvanceCadence = async () => {
    if (!leadCadence || !accountId) return
    await advanceLeadCadence(leadCadence.id, accountId); loadCadence()
  }
  const handleViewScript = () => { if (leadCadence?.attempt_script) setScriptModal({ text: leadCadence.attempt_script }) }
  const handleSelectReadyMsg = (content: string) => { setMsgText(content); setShowReadyMsgs(false) }
  const handleToggleArchive = async () => {
    if (!lead) return
    const confirmText = lead.is_archived
      ? 'Desarquivar este lead? Ele volta para o pipeline e chat.'
      : 'Arquivar este lead? Ele some do pipeline e do chat, mas o historico fica salvo.'
    if (!confirm(confirmText)) return
    const updated = lead.is_archived ? await unarchiveLead(lead.id) : await archiveLead(lead.id)
    setLead(updated)
  }
  const handleAnswerQual = async (seqId: number) => {
    if (!lead || !accountId || !qualAnswers[seqId]?.trim()) return
    setSavingQual(seqId)
    await answerQualification(lead.id, accountId, seqId, qualAnswers[seqId].trim())
    setQualAnswers(prev => { const n = { ...prev }; delete n[seqId]; return n })
    setSavingQual(null); loadQualifications()
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!lead) return <div className="empty-state"><h3>Lead nao encontrado</h3></div>

  const allStages = funnels.flatMap(f => f.stages || [])
  const currentStage = allStages.find(s => s.id === lead.stage_id)
  const attendants = users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active)
  const availableTags = tags.filter(t => !lead.tags?.some(lt => lt.id === t.id))

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate(-1)}><ArrowLeft size={16} /></button>
          <div>
            <h1 style={{ fontSize: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
              {lead.name || 'Sem nome'}
              {lead.is_archived ? <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: '#9B96B020', color: '#9B96B0', fontWeight: 500 }}>Arquivado</span> : null}
            </h1>
            {lead.phone && <div style={{ fontSize: 12, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10} /> {lead.phone}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select className="select" style={{ width: 170 }} value={lead.stage_id} onChange={e => handleStageChange(+e.target.value)}>
            {allStages.filter(s => s.funnel_id === lead.funnel_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {user?.role !== 'atendente' && (
            <select className="select" style={{ width: 150 }} value={lead.attendant_id || ''} onChange={e => handleAssign(e.target.value ? +e.target.value : null)}>
              <option value="">Sem atendente</option>
              {attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/chat?lead=${lead.id}`)} title="Abrir conversa">
            <MessageCircle size={14} /> Abrir Chat
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleToggleArchive} title={lead.is_archived ? 'Desarquivar' : 'Arquivar'}>
            {lead.is_archived ? <><ArchiveRestore size={14} /> Desarquivar</> : <><Archive size={14} /> Arquivar</>}
          </button>
        </div>
      </div>

      <div className="lead-detail">
        {/* Left column: Info + Tags + History */}
        <div>
          {/* Lead Info Card */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>Informacoes</div>
              {!editing ? (
                <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}><Edit3 size={12} /> Editar</button>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}><Save size={12} /> Salvar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}><X size={12} /></button>
                </div>
              )}
            </div>
            <div className="lead-info">
              {editing ? (
                <>
                  <div className="form-group"><label>Nome</label><input className="input" value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} /></div>
                  <div className="form-group"><label>Telefone</label><input className="input" value={editData.phone} onChange={e => setEditData(p => ({ ...p, phone: e.target.value }))} /></div>
                  <div className="form-group"><label>Email</label><input className="input" value={editData.email} onChange={e => setEditData(p => ({ ...p, email: e.target.value }))} /></div>
                  <div className="form-group"><label>Cidade</label><input className="input" value={editData.city} onChange={e => setEditData(p => ({ ...p, city: e.target.value }))} /></div>
                  <div className="form-group"><label>Nome da Empresa</label><input className="input" value={editData.empresa} onChange={e => setEditData(p => ({ ...p, empresa: e.target.value }))} placeholder="Nome da empresa" /></div>
                  <div className="form-group"><label>CPF/CNPJ</label><input className="input" value={editData.cpf_cnpj} onChange={e => setEditData(p => ({ ...p, cpf_cnpj: e.target.value }))} placeholder="000.000.000-00" /></div>
                  <div className="form-group"><label>Instagram</label><input className="input" value={editData.instagram} onChange={e => setEditData(p => ({ ...p, instagram: e.target.value }))} placeholder="@perfil" /></div>
                  <div className="form-group">
                    <label>Trabalha com anuncio?</label>
                    <select className="select" value={editData.trabalha_anuncio || 0} onChange={e => setEditData(p => ({ ...p, trabalha_anuncio: parseInt(e.target.value) }))}>
                      <option value={0}>Nao</option>
                      <option value={1}>Sim</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Investimento Anuncios Mensal (R$)</label><input className="input" type="number" step="0.01" value={editData.investimento_anuncios} onChange={e => setEditData(p => ({ ...p, investimento_anuncios: e.target.value }))} placeholder="5000.00" /></div>
                </>
              ) : (
                <>
                  <div className="lead-info-row"><span className="lead-info-label">Nome</span><span className="lead-info-value">{lead.name || '-'}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><Phone size={12} /> Telefone</span><span className="lead-info-value">{lead.phone || '-'} {lead.phone && lead.phone.replace(/\D/g,'').length !== 13 && <span style={{ color: '#FF6B6B', fontSize: 10 }}>⚠ incompleto</span>}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><Mail size={12} /> Email</span><span className="lead-info-value">{lead.email || '-'}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><MapPin size={12} /> Cidade</span><span className="lead-info-value">{lead.city || '-'}</span></div>
                  {lead.empresa && <div className="lead-info-row"><span className="lead-info-label">Empresa</span><span className="lead-info-value">{lead.empresa}</span></div>}
                  {lead.cpf_cnpj && <div className="lead-info-row"><span className="lead-info-label">CPF/CNPJ</span><span className="lead-info-value">{lead.cpf_cnpj}</span></div>}
                  {lead.instagram && <div className="lead-info-row"><span className="lead-info-label">Instagram</span><span className="lead-info-value">{lead.instagram}</span></div>}
                  <div className="lead-info-row"><span className="lead-info-label">Anuncio</span><span className="lead-info-value" style={{ color: lead.trabalha_anuncio ? '#34C759' : '#9B96B0' }}>{lead.trabalha_anuncio ? 'Sim' : 'Nao'}</span></div>
                  <div className="lead-info-row">
                    <span className="lead-info-label">Recebe Disparos</span>
                    <span className="lead-info-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!lead.opted_out_at || (lead.opted_in_at && lead.opted_in_at > lead.opted_out_at)
                        ? <><span style={{ color: '#34C759' }}>Sim</span><button className="btn btn-danger btn-sm" style={{ fontSize: 9, padding: '1px 6px' }} onClick={async () => { await optOutLead(lead.id); loadLead() }}>Bloquear</button></>
                        : <><span style={{ color: '#FF6B6B' }}>Bloqueado</span><button className="btn btn-primary btn-sm" style={{ fontSize: 9, padding: '1px 6px' }} onClick={async () => { await optInLead(lead.id); loadLead() }}>Desbloquear</button></>}
                    </span>
                  </div>
                  {lead.investimento_anuncios && <div className="lead-info-row"><span className="lead-info-label">Investimento</span><span className="lead-info-value">R$ {Number(lead.investimento_anuncios).toLocaleString('pt-BR')}</span></div>}
                  <div className="lead-info-row"><span className="lead-info-label">Fonte</span><span className="lead-info-value">{lead.source || '-'}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label">Etapa</span><span className="stage-badge" style={{ background: `${currentStage?.color}20`, color: currentStage?.color }}>{currentStage?.name}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><User size={12} /> Atendente</span><span className="lead-info-value">{lead.attendant_name || 'Nao atribuido'}</span></div>
                  <div className="lead-info-row"><span className="lead-info-label"><Clock size={12} /> Criado</span><span className="lead-info-value">{parseSqlDate(lead.created_at).toLocaleString('pt-BR')}</span></div>
                  {lead.instance_name && <div className="lead-info-row"><span className="lead-info-label" style={{ color: '#34C759' }}>WhatsApp</span><span className="lead-info-value" style={{ color: '#34C759' }}>{lead.instance_name}</span></div>}
                </>
              )}
            </div>
          </div>

          {/* Observacoes */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Observacoes</div>
              {!editingNotes ? (
                <button className="btn btn-secondary btn-sm" onClick={() => { setNotesDraft(lead.notes || ''); setEditingNotes(true) }}><Edit3 size={12} /> Editar</button>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-primary btn-sm" disabled={savingNotes} onClick={async () => {
                    setSavingNotes(true)
                    try { await updateLead(lead.id, { notes: notesDraft }); await loadLead(); setEditingNotes(false) }
                    catch (e: any) { alert('Erro: ' + e.message) }
                    setSavingNotes(false)
                  }}><Save size={12} /> Salvar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingNotes(false)}><X size={12} /></button>
                </div>
              )}
            </div>
            {editingNotes ? (
              <textarea className="input" value={notesDraft} onChange={e => setNotesDraft(e.target.value)} rows={5} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }} placeholder="Anote qualquer informacao extra sobre o lead..." />
            ) : (
              lead.notes ? (
                <div style={{ fontSize: 13, color: '#C8C4D4', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{lead.notes}</div>
              ) : (
                <div style={{ fontSize: 11, color: '#6B6580' }}>Sem observacoes</div>
              )
            )}
          </div>

          {/* Tags */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase' }}><TagIcon size={12} /> Tags</div>
              <div style={{ position: 'relative' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowTagMenu(!showTagMenu)}><Plus size={12} /></button>
                {showTagMenu && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 6, zIndex: 50, minWidth: 220 }}>
                    {availableTags.length > 0 && (
                      <>
                        {availableTags.map(t => (
                          <button key={t.id} onClick={() => handleAddTag(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', borderRadius: 4, width: '100%', textAlign: 'left' }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />{t.name}
                          </button>
                        ))}
                        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 0' }} />
                      </>
                    )}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 2 }}>
                      <input type="color" value={newTagColor} onChange={e => setNewTagColor(e.target.value)} style={{ width: 24, height: 24, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                      <input className="input" value={newTagName} onChange={e => setNewTagName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateTag()} placeholder="Nova tag..." style={{ flex: 1, fontSize: 12 }} />
                      <button className="btn btn-primary btn-sm" onClick={handleCreateTag} disabled={!newTagName.trim()}><Plus size={12} /></button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {lead.tags && lead.tags.map(t => (
                <span key={t.id} className="tag-pill" style={{ background: `${t.color}20`, color: t.color, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => handleRemoveTag(t.id)}>
                  {t.name} <X size={8} />
                </span>
              ))}
              {(!lead.tags || lead.tags.length === 0) && <span style={{ fontSize: 11, color: '#6B6580' }}>Sem tags</span>}
            </div>
          </div>

          {/* Cadence */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}><ListOrdered size={12} /> Cadencia</div>
              <div style={{ position: 'relative', display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowCadenceMenu(!showCadenceMenu)}>{leadCadence ? 'Trocar' : 'Atribuir'}</button>
                {leadCadence && <button className="btn btn-danger btn-sm" onClick={async () => { if (!accountId || !confirm('Remover cadencia?')) return; await removeLeadCadence(leadCadence.id, accountId); loadCadence() }}>Remover</button>}
                {showCadenceMenu && cadences.length > 0 && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border-medium)', borderRadius: 8, padding: 6, zIndex: 50, minWidth: 180 }}>
                    {cadences.map(c => (
                      <button key={c.id} onClick={() => handleAssignCadence(c.id)} style={{ display: 'block', padding: '6px 10px', border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: 12, cursor: 'pointer', borderRadius: 4, width: '100%', textAlign: 'left' }}>
                        {c.name} <span style={{ color: 'var(--text-muted)' }}>({c.attempts.length} etapas)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {leadCadence ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{leadCadence.cadence_name}</div>
                {leadCadence.status === 'completed' ? (
                  <div style={{ fontSize: 12, color: '#34C759', display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Concluida</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: '#FFB300', display: 'flex', alignItems: 'center', gap: 4 }}>
                      Etapa {(leadCadence.attempt_position ?? 0) + 1}/{leadCadence.total_attempts}: {leadCadence.action_type?.toUpperCase()}
                    </div>
                    {leadCadence.attempt_description && <div style={{ fontSize: 11, color: '#C8C4D4', marginTop: 2 }}>{leadCadence.attempt_description}</div>}
                    {leadCadence.attempt_instructions && <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 2, fontStyle: 'italic' }}>{leadCadence.attempt_instructions}</div>}
                    {leadCadence.attempt_script ? (
                      <>
                        <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={handleViewScript}><FileText size={12} /> Ver script</button>
                        <button className="btn btn-secondary btn-sm" style={{ marginTop: 6 }} onClick={handleAdvanceCadence}><ChevronRight size={12} /> Avancar</button>
                      </>
                    ) : (
                      <button className="btn btn-primary btn-sm" style={{ marginTop: 8 }} onClick={handleAdvanceCadence}><ChevronRight size={12} /> Avancar</button>
                    )}
                  </>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 11, color: '#6B6580' }}>Sem cadencia atribuida</span>
            )}
          </div>

          {/* Stage history */}
          {history.length > 0 && (
            <div className="card">
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 10 }}><GitBranch size={12} /> Historico</div>
              {history.slice(0, 10).map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: i < Math.min(history.length, 10) - 1 ? '1px solid var(--border-subtle)' : 'none', fontSize: 11 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFB300', marginTop: 4, flexShrink: 0 }} />
                  <div>
                    <div style={{ color: '#fff' }}>{h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : `Entrada: ${h.to_stage_name}`}</div>
                    <div style={{ color: '#6B6580', fontSize: 10 }}>{h.trigger_type === 'manual' ? 'Manual' : h.trigger_type}{h.user_name ? ` por ${h.user_name}` : ''} · {parseSqlDate(h.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Chat + Notes tabs */}
        <div>
          {/* Botao destacado pra abrir o chat */}
          <button onClick={() => navigate(`/chat?lead=${lead.id}`)} style={{ width: '100%', padding: '14px 16px', background: 'linear-gradient(135deg, #34C759, #2BA84A)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10, boxShadow: '0 2px 8px rgba(52,199,89,0.25)' }}>
            <MessageCircle size={18} /> Abrir Chat {messages.length > 0 ? `(${messages.length} ${messages.length === 1 ? 'mensagem' : 'mensagens'})` : '— iniciar conversa'}
          </button>

          {/* Tab switcher (sem chat) */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
            {(['notes', 'qualification', 'history'] as const).map(tab => (
              <button key={tab} className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveTab(tab)}>
                {tab === 'notes' ? <><StickyNote size={12} /> Notas ({notes.length})</> : tab === 'qualification' ? <><ClipboardList size={12} /> Qualificacao</> : <><GitBranch size={12} /> Historico</>}
              </button>
            ))}
          </div>

          {/* Notes tab */}
          {activeTab === 'notes' && (
            <div className="card" style={{ minHeight: 400 }}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input className="input" placeholder="Adicionar nota interna..." value={noteText} onChange={e => setNoteText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddNote()} />
                <button className="btn btn-primary btn-icon" onClick={handleAddNote} disabled={!noteText.trim()}><Plus size={16} /></button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {notes.map(n => (
                  <div key={n.id} style={{ padding: '10px 12px', background: 'rgba(255,179,0,0.05)', borderRadius: 8, border: '1px solid rgba(255,179,0,0.1)' }}>
                    <div style={{ fontSize: 13 }}>{n.content}</div>
                    <div style={{ fontSize: 10, color: '#6B6580', marginTop: 4 }}>{n.user_name} · {parseSqlDate(n.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                ))}
                {notes.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Nenhuma nota ainda</div>}
              </div>
            </div>
          )}

          {/* Qualification tab */}
          {activeTab === 'qualification' && (
            <div className="card" style={{ minHeight: 400 }}>
              {qualifications.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {qualifications.map((q, i) => (
                    <div key={q.sequence_id} style={{ padding: '10px 12px', background: q.answer ? 'rgba(52,199,89,0.05)' : 'rgba(255,179,0,0.03)', borderRadius: 8, border: `1px solid ${q.answer ? 'rgba(52,199,89,0.15)' : 'var(--border-subtle)'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: q.answer ? '#34C75920' : '#FFB30020', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {q.answer ? <Check size={10} style={{ color: '#34C759' }} /> : <span style={{ fontSize: 10, fontWeight: 700, color: '#FFB300' }}>{i + 1}</span>}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{q.question}</span>
                      </div>
                      {q.answer ? (
                        <div style={{ marginLeft: 26 }}>
                          <div style={{ fontSize: 12, color: '#C8C4D4' }}>{q.answer}</div>
                          <div style={{ fontSize: 10, color: '#6B6580', marginTop: 2 }}>{q.answered_by_name} · {q.answered_at ? new Date(q.answered_at).toLocaleString('pt-BR') : ''}</div>
                        </div>
                      ) : (
                        <div style={{ marginLeft: 26, display: 'flex', gap: 6 }}>
                          <input className="input" placeholder="Resposta..." value={qualAnswers[q.sequence_id] || ''} onChange={e => setQualAnswers(prev => ({ ...prev, [q.sequence_id]: e.target.value }))} onKeyDown={e => e.key === 'Enter' && handleAnswerQual(q.sequence_id)} style={{ flex: 1, fontSize: 12 }} />
                          <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleAnswerQual(q.sequence_id)} disabled={savingQual === q.sequence_id || !qualAnswers[q.sequence_id]?.trim()}><Check size={12} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Nenhuma pergunta de qualificacao configurada</div>
              )}
            </div>
          )}

          {/* Full history tab */}
          {activeTab === 'history' && (
            <div className="card" style={{ minHeight: 400 }}>
              {history.map((h, i) => (
                <div key={h.id} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: i < history.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFB300', marginTop: 5, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13 }}>{h.from_stage_name ? `${h.from_stage_name} → ${h.to_stage_name}` : `Entrada: ${h.to_stage_name}`}</div>
                    <div style={{ fontSize: 11, color: '#6B6580' }}>{h.trigger_type}{h.user_name ? ` por ${h.user_name}` : ''}</div>
                    <div style={{ fontSize: 10, color: '#6B6580' }}>{parseSqlDate(h.created_at).toLocaleString('pt-BR')}</div>
                  </div>
                </div>
              ))}
              {history.length === 0 && <div style={{ textAlign: 'center', color: '#6B6580', padding: 30 }}>Sem historico</div>}
            </div>
          )}
        </div>
      </div>
      {scriptModal && (
        <div className="modal-overlay" onClick={() => setScriptModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Phone size={16} style={{ color: '#FFB300' }} /> Script de Ligacao</h2>
            <div style={{ background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 8, padding: 16, marginTop: 12, maxHeight: 400, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: '#F0EDF5' }}>
              {scriptModal.text}
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setScriptModal(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de atribuicao de atendente — pergunta se quer enviar 1a msg automatica */}
      {assignModal && (
        <div className="modal-overlay" onClick={() => !assignSaving && setAssignModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: 8 }}>Atribuir lead pra atendente</h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Novo atendente: <strong>{assignModal.userName}</strong>
            </p>

            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={assignNotify}
                  onChange={e => setAssignNotify(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ fontSize: 13 }}>
                  <strong>Enviar mensagem inicial automática do novo atendente</strong>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    Se marcado: o sistema envia a msg de boas-vindas da instância do vendedor pro lead.
                    <br /><strong>A notificação ao vendedor é enviada de qualquer jeito</strong> (mesmo desmarcado).
                  </div>
                </span>
              </label>
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setAssignModal(null)} disabled={assignSaving}>Cancelar</button>
              <button className="btn btn-primary" onClick={confirmAssign} disabled={assignSaving}>
                {assignSaving ? 'Atribuindo...' : 'Confirmar atribuição'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

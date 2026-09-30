import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import {
  fetchLead, fetchFunnels, fetchUsers, fetchTags, updateLead, moveLeadStage, assignLead,
  sendMessage, addLeadNote, addLeadTag, removeLeadTag, createTag,
  fetchLeadCadence, fetchCadences, assignLeadCadence, advanceLeadCadence, removeLeadCadence,
  fetchReadyMessages, RoteiroGateError, type RoteiroPendingQuestion,
  archiveLead, unarchiveLead, optInLead, optOutLead,
  fetchLeadSales, patchLeadSale, deleteLeadSale, type LeadSale,
  fetchCustomerCard, type CustomerCardData,
  REMIND_DAYS, type SaleKind,
  type Lead, type Message, type StageHistoryEntry, type LeadNote, type Funnel, type User as UserType, type Tag,
  type LeadCadence, type Cadence, type ReadyMessage,
} from '../lib/api'
import { ArrowLeft, Phone, Mail, MapPin, MessageCircle, Send, Clock, User, GitBranch, Edit3, Save, X, Plus, StickyNote, Tag as TagIcon, ListOrdered, Zap, ClipboardList, ChevronRight, Check, Archive, ArchiveRestore, FileText, DollarSign, Trash2 } from 'lucide-react'
import MessageMedia from '../components/MessageMedia'
import ScoreThermometer from '../components/score/ScoreThermometer'
import RoteiroCard from '../components/roteiro/RoteiroCard'
import NextStepCard from '../components/cadence/NextStepCard'
import { applyMessageVars } from '../lib/messageVars'
import StageGateModal from '../components/roteiro/StageGateModal'
import SaleModal from '../components/SaleModal'
import { parseSqlDate } from '../lib/dates'

// Rotulo do tipo da venda (spec LTV/Recompra §5) — venda antiga (sale_kind null) nao tem rotulo, so o botao "Marcar tipo"
function saleKindLabel(s: LeadSale): string | null {
  if (s.sale_kind === 'recompra') return `Recompra em ${s.remind_days} dias`
  if (s.sale_kind === 'unica') return s.cross_sell ? `Única + oferta em ${s.remind_days} dias` : 'Compra única'
  return null
}

export default function LeadDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const { accountId, accounts } = useAccount()
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
  const [editData, setEditData] = useState<Record<string, any>>({ name: '', phone: '', email: '', city: '', empresa: '', cpf_cnpj: '', instagram: '' })
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
  // Janela "Falta saber" (trava de etapa do roteiro)
  const [stageGate, setStageGate] = useState<{ toStage: { id: number; name: string }; pending: RoteiroPendingQuestion[] } | null>(null)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const loadLead = useCallback(async () => {
    if (!id || !accountId) return
    const data = await fetchLead(+id, accountId)
    setLead(data.lead); setMessages(data.messages); setHistory(data.stageHistory); setNotes(data.notes || [])
    setEditData({ name: data.lead.name || '', phone: data.lead.phone || '', email: data.lead.email || '', city: data.lead.city || '', empresa: data.lead.empresa || '', cpf_cnpj: data.lead.cpf_cnpj || '', instagram: data.lead.instagram || '' })
  }, [id, accountId])

  const loadCadence = useCallback(async () => {
    if (!id || !accountId) return
    const lc = await fetchLeadCadence(+id, accountId)
    setLeadCadence(lc)
  }, [id, accountId])

  useEffect(() => {
    if (!id || !accountId) return
    setLoading(true)
    Promise.all([
      loadLead(), fetchFunnels(accountId).then(setFunnels), fetchUsers(accountId).then(setUsers), fetchTags(accountId).then(setTags),
      loadCadence(), fetchCadences(accountId).then(setCadences), fetchReadyMessages(accountId).then(setReadyMsgs),
    ]).finally(() => setLoading(false))
  }, [id, accountId, loadLead, loadCadence])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useSSE('lead:message', useCallback((data: any) => { if (data.leadId === parseInt(id || '0')) loadLead() }, [id, loadLead]))
  useSSE('lead:updated', useCallback((data: any) => { if (data?.bulk || data?.id === parseInt(id || '0')) loadLead() }, [id, loadLead]))

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

  // ─── Vendas (multiple sales por lead) ───
  const [sales, setSales] = useState<LeadSale[]>([])
  const [salesTotal, setSalesTotal] = useState(0)
  const [customerCard, setCustomerCard] = useState<CustomerCardData | null>(null)
  const [saleModal, setSaleModal] = useState<{ leadId: number; stageId: number | null; leadName: string; stageName: string | null } | null>(null)
  // Venda antiga sem tipo (sale_kind null): mini-formulario inline pra "Marcar tipo"
  const [typeForm, setTypeForm] = useState<{ saleId: number; kind: SaleKind; days: number; cross: boolean; offer: string; saving: boolean; error: string | null } | null>(null)

  const loadSales = useCallback(async () => {
    if (!lead || !accountId) return
    try { const r = await fetchLeadSales(lead.id, accountId); setSales(r.sales); setSalesTotal(r.total) } catch {}
  }, [lead?.id, accountId])
  useEffect(() => { loadSales() }, [loadSales])

  const loadCustomerCard = useCallback(async () => {
    if (!lead || !accountId) return
    try { setCustomerCard(await fetchCustomerCard(lead.id, accountId)) } catch {}
  }, [lead?.id, accountId])
  useEffect(() => { loadCustomerCard() }, [loadCustomerCard])

  const openSaleModalForConversion = (stageId: number, stageName: string) => {
    if (!lead) return
    setSaleModal({ leadId: lead.id, stageId, leadName: lead.name || 'Lead', stageName })
  }
  const openSaleModalStandalone = () => {
    if (!lead) return
    setSaleModal({ leadId: lead.id, stageId: null, leadName: lead.name || 'Lead', stageName: null })
  }
  const doMoveStage = async (stageId: number) => {
    if (!lead) return
    try {
      await moveLeadStage(lead.id, stageId, { accountId })
    } catch (e: any) {
      if (e instanceof RoteiroGateError) {
        const target = funnels.flatMap(f => f.stages || []).find(s => s.id === stageId)
        setStageGate({ toStage: { id: stageId, name: target?.name || 'a próxima etapa' }, pending: e.pending })
        return
      }
      alert('Erro: ' + (e?.message || 'não deu para mudar a etapa'))
      return
    }
    loadLead()
  }
  // [Perguntar agora]/[Perguntar] na ficha: abre o Chat do lead com a pergunta na caixa
  const askInChat = (text: string, questionKey: string | null, attemptId: number | null = null) => {
    if (!lead) return
    navigate(`/chat?lead_id=${lead.id}`, { state: { roteiroAsk: { text, questionKey, attemptId } } })
  }
  const canForce = user?.role === 'gerente' || user?.role === 'super_admin'
  // [Enviar] do passo mensagem na ficha: abre o Chat com o texto (variaveis ja trocadas) na caixa;
  // o attemptId vai junto, entao enviar pelo Chat marca o passo como feito
  const sendStepInChat = (text: string, attemptId: number) => {
    if (!lead) return
    const filled = applyMessageVars(text, { leadName: lead.name, leadEmpresa: lead.empresa, leadCity: lead.city, attendantName: user?.name })
    if (!filled.trim()) return
    askInChat(filled, null, attemptId)
  }
  // <SaleModal> ja fez o POST; so falta recarregar vendas/cartao do cliente e, se veio de uma
  // troca de etapa de conversao, mover o lead de fato (so agora — cancelar nao move nada).
  const handleSaleSaved = async () => {
    const stageId = saleModal?.stageId
    await Promise.all([loadSales(), loadCustomerCard()])
    if (stageId != null) await doMoveStage(stageId)
  }
  const openTypeForm = (s: LeadSale) => setTypeForm({ saleId: s.id, kind: 'recompra', days: 30, cross: false, offer: '', saving: false, error: null })
  const saveTypeForm = async () => {
    if (!typeForm || !lead || !accountId) return
    const needsDays = typeForm.kind === 'recompra' || typeForm.cross
    setTypeForm(f => f ? { ...f, saving: true, error: null } : f)
    try {
      await patchLeadSale(lead.id, accountId, typeForm.saleId, {
        sale_kind: typeForm.kind,
        remind_days: needsDays ? typeForm.days : undefined,
        cross_sell: typeForm.kind === 'unica' ? typeForm.cross : undefined,
        cross_sell_offer: typeForm.kind === 'unica' && typeForm.cross ? (typeForm.offer.trim() || undefined) : undefined,
      })
      setTypeForm(null)
      await loadSales()
    } catch (e: any) {
      setTypeForm(f => f ? { ...f, saving: false, error: e?.message || 'Não foi possível salvar.' } : f)
    }
  }
  const handleDeleteSale = async (saleId: number) => {
    if (!lead || !accountId) return
    if (!confirm('Excluir essa venda? O total é ajustado.')) return
    try { await deleteLeadSale(lead.id, saleId, accountId); await loadSales() }
    catch (e: any) { alert('Erro: ' + (e?.message || 'falha')) }
  }

  const handleStageChange = async (stageId: number) => {
    if (!lead) return
    const allStages = funnels.flatMap(f => f.stages || [])
    const targetStage = allStages.find(s => s.id === stageId)
    const isConversion = !!(targetStage && (targetStage as any).is_conversion)
    if (isConversion && stageId !== lead.stage_id) {
      openSaleModalForConversion(stageId, targetStage!.name)
      return
    }
    await doMoveStage(stageId)
  }
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

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!lead) return <div className="empty-state"><h3>Lead nao encontrado</h3></div>

  const allStages = funnels.flatMap(f => f.stages || [])
  const currentStage = allStages.find(s => s.id === lead.stage_id)
  const attendants = users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active)
  const availableTags = tags.filter(t => !lead.tags?.some(lt => lt.id === t.id))
  const aiEnabledForAccount = !!accounts.find(a => a.id === accountId)?.ai_agents_enabled

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
          {accountId && <ScoreThermometer key={lead.id} leadId={lead.id} accountId={accountId} />}
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
                  <div className="lead-info-row">
                    <span className="lead-info-label">Recebe Disparos</span>
                    <span className="lead-info-value" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {!lead.opted_out_at || (lead.opted_in_at && lead.opted_in_at > lead.opted_out_at)
                        ? <><span style={{ color: '#34C759' }}>Sim</span><button className="btn btn-danger btn-sm" style={{ fontSize: 9, padding: '1px 6px' }} onClick={async () => { await optOutLead(lead.id); loadLead() }}>Bloquear</button></>
                        : <><span style={{ color: '#FF6B6B' }}>Bloqueado</span><button className="btn btn-primary btn-sm" style={{ fontSize: 9, padding: '1px 6px' }} onClick={async () => { await optInLead(lead.id); loadLead() }}>Desbloquear</button></>}
                    </span>
                  </div>
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

          {/* Vendas */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                <DollarSign size={12} style={{ color: '#34C759' }} /> Vendas {sales.length > 0 && <span style={{ color: '#6B6580' }}>({sales.length})</span>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={openSaleModalStandalone} title="Registrar nova venda"><Plus size={12} /></button>
            </div>
            {salesTotal > 0 && (
              <div style={{ fontSize: 18, fontWeight: 700, color: '#34C759', marginBottom: 10 }}>
                R$ {salesTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span style={{ fontSize: 10, color: '#6B6580', fontWeight: 400, marginLeft: 6 }}>total</span>
              </div>
            )}
            {sales.length === 0 ? (
              <div style={{ fontSize: 11, color: '#6B6580' }}>Sem vendas registradas</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {sales.map(s => {
                  const dt = new Date(s.sale_date.replace(' ', 'T') + 'Z')
                  const dateStr = dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                  const canDelete = user?.role === 'super_admin' || user?.role === 'gerente'
                  const kindLabel = saleKindLabel(s)
                  return (
                    <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 10px', background: 'rgba(52,199,89,0.06)', border: '1px solid rgba(52,199,89,0.15)', borderRadius: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#34C759' }}>
                            R$ {Number(s.value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {s.product && <span style={{ fontSize: 11, fontWeight: 400, color: '#B8B4C7', marginLeft: 6 }}>{s.product}</span>}
                          </div>
                          <div style={{ fontSize: 10, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <Clock size={9} /> {dateStr}
                            {s.created_by_name && <span>· {s.created_by_name}</span>}
                            {kindLabel && <span>· {kindLabel}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {s.sale_kind === null && (
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => openTypeForm(s)}>Marcar tipo</button>
                          )}
                          {canDelete && (
                            <button onClick={() => handleDeleteSale(s.id)} title="Excluir" style={{ background: 'none', border: 'none', color: '#6B6580', cursor: 'pointer', padding: 3, display: 'flex' }}>
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </div>
                      {typeForm?.saleId === s.id && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 4px 2px', borderTop: '1px solid rgba(52,199,89,0.2)' }}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button type="button" className={`btn btn-sm ${typeForm.kind === 'recompra' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setTypeForm(f => f ? { ...f, kind: 'recompra' } : f)}>Pode recomprar</button>
                            <button type="button" className={`btn btn-sm ${typeForm.kind === 'unica' ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setTypeForm(f => f ? { ...f, kind: 'unica' } : f)}>Compra única</button>
                          </div>
                          {typeForm.kind === 'unica' && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, cursor: 'pointer' }}>
                              <input type="checkbox" checked={typeForm.cross} onChange={e => setTypeForm(f => f ? { ...f, cross: e.target.checked } : f)} /> Oferecer produtos relacionados depois
                            </label>
                          )}
                          {(typeForm.kind === 'recompra' || typeForm.cross) && (
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {REMIND_DAYS.map(d => (
                                <button key={d} type="button" className={`btn btn-sm ${typeForm.days === d ? 'btn-primary' : 'btn-secondary'}`} style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setTypeForm(f => f ? { ...f, days: d } : f)}>{d}d</button>
                              ))}
                            </div>
                          )}
                          {typeForm.kind === 'unica' && typeForm.cross && (
                            <input className="input" style={{ fontSize: 11, padding: '4px 6px' }} maxLength={500} value={typeForm.offer} onChange={e => setTypeForm(f => f ? { ...f, offer: e.target.value } : f)} placeholder="O que oferecer" />
                          )}
                          {typeForm.error && <div style={{ fontSize: 10, color: '#FF6B6B' }}>{typeForm.error}</div>}
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => setTypeForm(null)} disabled={typeForm.saving}>Cancelar</button>
                            <button className="btn btn-primary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={saveTypeForm} disabled={typeForm.saving}>{typeForm.saving ? 'Salvando…' : 'Salvar'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
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
              <div style={{ fontSize: 12, fontWeight: 600, color: '#9B96B0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}><ListOrdered size={12} /> Cadência avulsa</div>
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
                {tab === 'notes' ? <><StickyNote size={12} /> Notas ({notes.length})</> : tab === 'qualification' ? <><ClipboardList size={12} /> Cadência e respostas</> : <><GitBranch size={12} /> Historico</>}
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

          {/* Cadencia e respostas: cadencia da etapa inteira + roteiro completo (todas as etapas) */}
          {activeTab === 'qualification' && accountId && (
            <div className="card" style={{ minHeight: 400 }}>
              <NextStepCard key={`cad-${lead.id}`} leadId={lead.id} accountId={accountId} mode="full" onAsk={askInChat} onSendStep={sendStepInChat} canManage={canForce} />
              <RoteiroCard key={`roteiro-${lead.id}`} leadId={lead.id} accountId={accountId} mode="full" onAsk={askInChat} canForce={canForce} showNotices={false} />
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

      {/* Janela "Falta saber": a troca de etapa travou por perguntas obrigatorias */}
      {stageGate && accountId && (
        <StageGateModal
          leadId={lead.id}
          accountId={accountId}
          toStage={stageGate.toStage}
          pending={stageGate.pending}
          canForce={canForce}
          onAsk={askInChat}
          onDone={moved => { setStageGate(null); if (moved) loadLead() }}
        />
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

      {/* Janela unica de venda. Cancelar so fecha a janela — a troca de etapa so acontece de fato em onSaved. */}
      {saleModal && accountId && (
        <SaleModal
          open
          leadId={saleModal.leadId}
          accountId={accountId}
          leadName={saleModal.leadName}
          aiEnabled={aiEnabledForAccount}
          note={saleModal.stageId != null ? (
            <>Movendo <strong style={{ color: 'var(--text-primary)' }}>{saleModal.leadName}</strong> pra <strong style={{ color: '#34C759' }}>{saleModal.stageName}</strong>.</>
          ) : undefined}
          onClose={() => setSaleModal(null)}
          onSaved={handleSaleSaved}
        />
      )}
    </div>
  )
}

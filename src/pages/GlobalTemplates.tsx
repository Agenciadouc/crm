import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchGlobalCadences, createGlobalCadence, updateGlobalCadence, updateGlobalCadenceAttempts, deleteGlobalCadence,
  fetchGlobalCadenceAppliedIn, applyGlobalCadence,
  fetchGlobalFollowUps, createGlobalFollowUp, updateGlobalFollowUp, deleteGlobalFollowUp,
  fetchGlobalFollowUpAppliedIn, applyGlobalFollowUp,
  fetchAccounts, fetchWhatsAppInstances, fetchAgents,
  type GlobalCadence, type GlobalFollowUp, type CadenceAttempt, type FollowUpStep,
  type Account, type WhatsAppInstance, type Agent,
} from '../lib/api'
import { MESSAGE_VARIABLES } from '../lib/messageVars'
import { Plus, Trash2, Save, Layers, MessageCircle, Phone, Mail, Video, MapPin, HelpCircle, Copy, Check, Send, Zap, ListOrdered, Users } from 'lucide-react'

const ACTION_TYPES = [
  { value: 'mensagem', label: 'Mensagem', icon: MessageCircle },
  { value: 'ligacao', label: 'Ligacao', icon: Phone },
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'reuniao', label: 'Reuniao', icon: Video },
  { value: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { value: 'visita', label: 'Visita', icon: MapPin },
]

type Tab = 'cadences' | 'followups'

export default function GlobalTemplates() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'super_admin'
  const [tab, setTab] = useState<Tab>('cadences')
  const [copiedVar, setCopiedVar] = useState<string | null>(null)

  const copyVar = (token: string) => {
    navigator.clipboard.writeText(token)
    setCopiedVar(token)
    setTimeout(() => setCopiedVar(null), 1200)
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Templates Globais</h1>
        <p style={{ color: '#9B96B0', marginTop: 12 }}>Voce nao tem permissao pra ver essa pagina.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1><Layers size={20} style={{ verticalAlign: -4, marginRight: 6 }} />Templates Globais</h1>
      </div>

      {/* Cheat sheet fixo de variaveis — clicar copia, cola direto na mensagem */}
      <div style={{ marginBottom: 14, padding: '10px 14px', background: 'rgba(255,179,0,0.05)', border: '1px dashed rgba(255,179,0,0.3)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11, color: '#FFB300', fontWeight: 600 }}>
          <HelpCircle size={12} /> VARIAVEIS DISPONIVEIS (clique pra copiar, cole na mensagem)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {MESSAGE_VARIABLES.map(v => (
            <button
              key={v.token}
              onClick={() => copyVar(v.token)}
              title={v.label + ' (ex: ' + v.example + ')'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', fontSize: 11, fontFamily: 'monospace',
                background: copiedVar === v.token ? '#7ee787' : 'rgba(255,255,255,0.06)',
                color: copiedVar === v.token ? '#000' : '#FFB300',
                border: '1px solid ' + (copiedVar === v.token ? '#7ee787' : 'rgba(255,179,0,0.4)'),
                borderRadius: 6, cursor: 'pointer',
                transition: 'background 0.15s'
              }}
            >
              {copiedVar === v.token ? <Check size={11} /> : <Copy size={11} />}
              {v.token}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
        <button className="btn btn-sm" style={{ background: tab === 'cadences' ? '#FFB300' : 'transparent', color: tab === 'cadences' ? '#000' : '#9B96B0', border: 'none', borderBottom: tab === 'cadences' ? '2px solid #FFB300' : 'none', borderRadius: 0 }} onClick={() => setTab('cadences')}>
          <ListOrdered size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> Cadencias
        </button>
        <button className="btn btn-sm" style={{ background: tab === 'followups' ? '#FFB300' : 'transparent', color: tab === 'followups' ? '#000' : '#9B96B0', border: 'none', borderBottom: tab === 'followups' ? '2px solid #FFB300' : 'none', borderRadius: 0 }} onClick={() => setTab('followups')}>
          <Zap size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> Follow-ups
        </button>
      </div>
      {tab === 'cadences' ? <CadencesTab /> : <FollowUpsTab />}
    </div>
  )
}

// ============================================================
// CADENCES TAB
// ============================================================

function CadencesTab() {
  const [cadences, setCadences] = useState<GlobalCadence[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [editing, setEditing] = useState<GlobalCadence | null>(null)
  const [editAttempts, setEditAttempts] = useState<Partial<CadenceAttempt>[]>([])
  const [applyingId, setApplyingId] = useState<number | null>(null)
  const [showVars, setShowVars] = useState(false)
  const [copiedVar, setCopiedVar] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchGlobalCadences().then(setCadences).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!newName) return
    await createGlobalCadence({ name: newName, description: newDesc || null })
    setShowNew(false); setNewName(''); setNewDesc(''); load()
  }

  const startEdit = (c: GlobalCadence) => { setEditing(c); setEditAttempts(c.attempts.map(a => ({ ...a }))) }
  const addAttempt = () => setEditAttempts(p => [...p, { action_type: 'mensagem', description: '', instructions: '', schedule_mode: 'date', delay_days: 0, delay_minutes: 0 }])
  const removeAttempt = (i: number) => setEditAttempts(p => p.filter((_, idx) => idx !== i))
  const updateAttempt = (i: number, field: string, value: any) => setEditAttempts(p => p.map((a, idx) => idx === i ? { ...a, [field]: (field === 'delay_days' || field === 'delay_minutes') ? (parseInt(value) || 0) : value } : a))

  const saveAttempts = async () => {
    if (!editing) return
    await updateGlobalCadenceAttempts(editing.id, editAttempts.map((a, i) => ({ ...a, position: i })))
    setEditing(null); load()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Deletar esse template global? Contas ja aplicadas continuam funcionando com a copia local.')) return
    await deleteGlobalCadence(id); load()
  }

  const copyVar = (token: string) => { navigator.clipboard.writeText(token); setCopiedVar(token); setTimeout(() => setCopiedVar(null), 1500) }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowVars(true)}><HelpCircle size={14} /> Variaveis</button>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Cadencia Global</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cadences.length === 0 && <div className="empty-state"><h3>Nenhum template global criado</h3><p>Crie 1 cadencia aqui e aplique em qualquer conta com 1 clique.</p></div>}
          {cadences.map(c => (
            <div key={c.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</h3>
                    <span style={{ fontSize: 11, color: '#9B96B0', background: 'rgba(155,150,176,0.1)', padding: '2px 8px', borderRadius: 10 }}>{c.attempts.length} etapas</span>
                    <span style={{ fontSize: 11, color: '#7ee787', background: 'rgba(126,231,135,0.1)', padding: '2px 8px', borderRadius: 10 }}>{c.applied_count || 0} contas aplicadas</span>
                  </div>
                  {c.description && <p style={{ fontSize: 12, color: '#9B96B0', marginTop: 4 }}>{c.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit(c)}>Editar</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setApplyingId(c.id)}><Send size={12} /> Aplicar em contas</button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(c.id)}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showVars && <VariablesModal onClose={() => setShowVars(false)} copiedVar={copiedVar} onCopy={copyVar} />}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Nova Cadencia Global</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Cadencia B2B Padrao" /></div>
            <div className="form-group"><label>Descricao (opcional)</label><textarea className="input" value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={3} style={{ resize: 'vertical' }} /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 700 }} onClick={e => e.stopPropagation()}>
            <h2>Editar Etapas — {editing.name}</h2>
            <p style={{ fontSize: 11, color: '#FFB300', marginBottom: 8 }}>⚠ Alteracoes aqui NAO propagam pras contas ja aplicadas. Use "Aplicar em contas" (com sobrescrever) pra atualizar.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {editAttempts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: 8, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ width: 24, color: '#9B96B0', fontSize: 12, fontWeight: 700, paddingTop: 8, textAlign: 'center' }}>{i + 1}</div>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select className="select" value={a.action_type || 'mensagem'} onChange={e => updateAttempt(i, 'action_type', e.target.value)} style={{ width: 130 }}>
                        {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input className="input" value={a.description || ''} onChange={e => updateAttempt(i, 'description', e.target.value)} placeholder="Descricao" style={{ flex: 1 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button type="button" className={`btn btn-sm ${(a.schedule_mode || 'date') === 'date' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateAttempt(i, 'schedule_mode', 'date')} style={{ fontSize: 10, padding: '3px 10px' }}>Por Data</button>
                      <button type="button" className={`btn btn-sm ${a.schedule_mode === 'duration' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => updateAttempt(i, 'schedule_mode', 'duration')} style={{ fontSize: 10, padding: '3px 10px' }}>Por Tempo</button>
                    </div>
                    {a.schedule_mode === 'duration' ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="number" min={0} className="input" value={a.delay_minutes ?? 0} onChange={e => updateAttempt(i, 'delay_minutes', e.target.value)} style={{ width: 80, textAlign: 'center' }} />
                        <span style={{ fontSize: 11, color: '#9B96B0' }}>minutos depois</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: '#FFB300', fontWeight: 700 }}>D+</span>
                        <input type="number" min={0} className="input" value={a.delay_days ?? 0} onChange={e => updateAttempt(i, 'delay_days', e.target.value)} style={{ width: 60, textAlign: 'center' }} />
                        <span style={{ fontSize: 11, color: '#9B96B0' }}>as</span>
                        <input type="time" className="input" value={a.scheduled_time || ''} onChange={e => updateAttempt(i, 'scheduled_time', e.target.value)} style={{ width: 110 }} />
                      </div>
                    )}
                    <input className="input" value={a.instructions || ''} onChange={e => updateAttempt(i, 'instructions', e.target.value)} placeholder="Instrucoes (opcional)" style={{ fontSize: 12 }} />
                    {(a.action_type === 'whatsapp' || a.action_type === 'mensagem') && (
                      <textarea className="input" value={a.auto_message || ''} onChange={e => updateAttempt(i, 'auto_message', e.target.value)} placeholder="Mensagem. Use {{primeiro_nome}}, {{atendente}}, {{empresa}}, {{cidade}}" rows={2} style={{ fontSize: 12, resize: 'vertical' }} />
                    )}
                  </div>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeAttempt(i)}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addAttempt}><Plus size={12} /> Adicionar Etapa</button>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveAttempts}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {applyingId !== null && <ApplyCadenceModal cadenceId={applyingId} onClose={() => setApplyingId(null)} onDone={() => { setApplyingId(null); load() }} />}
    </div>
  )
}

// ============================================================
// APPLY CADENCE MODAL
// ============================================================

function ApplyCadenceModal({ cadenceId, onClose, onDone }: { cadenceId: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)
  const [results, setResults] = useState<Array<{ account_id: number; account_name?: string; ok: boolean; error?: string }> | null>(null)
  const [appliedIn, setAppliedIn] = useState<Set<number>>(new Set())

  useEffect(() => {
    Promise.all([
      fetchAccounts(),
      fetchGlobalCadenceAppliedIn(cadenceId).catch(() => []),
    ]).then(([accs, applied]) => {
      setAccounts((accs || []).filter(a => a.is_active))
      setAppliedIn(new Set(applied.map(r => r.account_id)))
    })
  }, [cadenceId])

  const toggle = (id: number) => setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const handleApply = async () => {
    if (selected.size === 0) return
    setApplying(true)
    try {
      const r = await applyGlobalCadence(cadenceId, Array.from(selected), overwrite)
      setResults(r)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 550 }} onClick={e => e.stopPropagation()}>
        <h2>Aplicar cadencia em contas</h2>
        {results ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
              {results.map(r => (
                <div key={r.account_id} style={{ display: 'flex', gap: 8, padding: 8, background: r.ok ? 'rgba(126,231,135,0.05)' : 'rgba(255,107,107,0.05)', borderRadius: 6, fontSize: 12 }}>
                  <span style={{ color: r.ok ? '#7ee787' : '#FF6B6B' }}>{r.ok ? '✓' : '✗'}</span>
                  <span>{r.account_name || r.account_id}</span>
                  {r.error && <span style={{ color: '#FF6B6B', marginLeft: 'auto' }}>{r.error}</span>}
                </div>
              ))}
            </div>
            <div className="modal-actions"><button className="btn btn-primary" onClick={onDone}>Fechar</button></div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>Contas com badge "aplicada" ja tem uma copia. Marque "sobrescrever" pra substituir por uma nova.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto', marginBottom: 12 }}>
              {accounts.map(a => (
                <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                  <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
                  {appliedIn.has(a.id) && <span style={{ fontSize: 10, color: '#FFB300', background: 'rgba(255,179,0,0.1)', padding: '2px 6px', borderRadius: 8 }}>ja aplicada</span>}
                </label>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              <span>Sobrescrever (desativa copias antigas dessa mesma origem nas contas selecionadas)</span>
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || selected.size === 0}>
                {applying ? 'Aplicando...' : `Aplicar em ${selected.size} conta(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// FOLLOW-UPS TAB (simplificado — sequence type mainly, inactivity opcional)
// ============================================================

function FollowUpsTab() {
  const [followUps, setFollowUps] = useState<GlobalFollowUp[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<GlobalFollowUp | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [applyingId, setApplyingId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetchGlobalFollowUps().then(setFollowUps).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const handleDelete = async (id: number) => {
    if (!confirm('Deletar esse follow-up global? Contas ja aplicadas continuam funcionando.')) return
    await deleteGlobalFollowUp(id); load()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Follow-up Global</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {followUps.length === 0 && <div className="empty-state"><h3>Nenhum follow-up global criado</h3><p>Crie 1 aqui e aplique em qualquer conta com 1 clique.</p></div>}
          {followUps.map(fu => (
            <div key={fu.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600 }}>{fu.name}</h3>
                    <span style={{ fontSize: 11, color: '#9B96B0', background: 'rgba(155,150,176,0.1)', padding: '2px 8px', borderRadius: 10 }}>{fu.steps.length} steps</span>
                    <span style={{ fontSize: 11, color: '#FFB300', background: 'rgba(255,179,0,0.1)', padding: '2px 8px', borderRadius: 10 }}>{fu.type}</span>
                    <span style={{ fontSize: 11, color: '#7ee787', background: 'rgba(126,231,135,0.1)', padding: '2px 8px', borderRadius: 10 }}>{fu.applied_count || 0} contas aplicadas</span>
                  </div>
                  {fu.description && <p style={{ fontSize: 12, color: '#9B96B0', marginTop: 4 }}>{fu.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(fu)}>Editar</button>
                  <button className="btn btn-primary btn-sm" onClick={() => setApplyingId(fu.id)}><Send size={12} /> Aplicar em contas</button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(fu.id)}><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showNew || editing) && (
        <FollowUpEditorModal
          initial={editing}
          onClose={() => { setShowNew(false); setEditing(null) }}
          onDone={() => { setShowNew(false); setEditing(null); load() }}
        />
      )}

      {applyingId !== null && <ApplyFollowUpModal followUpId={applyingId} onClose={() => setApplyingId(null)} onDone={() => { setApplyingId(null); load() }} />}
    </div>
  )
}

// ============================================================
// FOLLOW-UP EDITOR MODAL
// ============================================================

function FollowUpEditorModal({ initial, onClose, onDone }: { initial: GlobalFollowUp | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [stopOnReply, setStopOnReply] = useState(initial?.stop_on_reply === undefined ? 1 : initial.stop_on_reply)
  const [type, setType] = useState<'sequence' | 'inactivity'>(initial?.type || 'sequence')
  const [inactivityMode, setInactivityMode] = useState<'rotation' | 'sequence'>(initial?.inactivity_mode || 'rotation')
  const [inactivityDays, setInactivityDays] = useState(String(initial?.inactivity_days ?? 2))
  const [steps, setSteps] = useState<Partial<FollowUpStep>[]>(initial?.steps || [{ delay_minutes: 60, message_template: '', schedule_mode: 'relative' }])
  const [saving, setSaving] = useState(false)

  const addStep = () => setSteps(p => [...p, { delay_minutes: 60, message_template: '', schedule_mode: 'relative' }])
  const removeStep = (i: number) => setSteps(p => p.filter((_, idx) => idx !== i))
  const updateStep = (i: number, field: string, value: any) => setSteps(p => p.map((s, idx) => idx === i ? { ...s, [field]: field === 'delay_minutes' ? (parseInt(value) || 0) : value } : s))

  const handleSave = async () => {
    if (!name) { alert('Nome obrigatorio'); return }
    if (steps.length === 0) { alert('Pelo menos 1 step'); return }
    setSaving(true)
    try {
      const payload: any = {
        name, description: description || null, stop_on_reply: stopOnReply, type,
        inactivity_days: type === 'inactivity' ? parseInt(inactivityDays) || 2 : null,
        inactivity_mode: type === 'inactivity' ? inactivityMode : null,
        steps: steps.map((s, i) => ({ ...s, position: i + 1 })),
      }
      if (initial) await updateGlobalFollowUp(initial.id, payload)
      else await createGlobalFollowUp(payload)
      onDone()
    } catch (e: any) {
      alert('Erro: ' + (e?.message || 'unknown'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={e => e.stopPropagation()}>
        <h2>{initial ? `Editar Follow-up — ${initial.name}` : 'Novo Follow-up Global'}</h2>
        {initial && <p style={{ fontSize: 11, color: '#FFB300', marginBottom: 8 }}>⚠ Alteracoes NAO propagam pras contas ja aplicadas. Use "Aplicar" com sobrescrever pra atualizar.</p>}

        <div className="form-group"><label>Nome</label><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Reativacao 3 dias" /></div>
        <div className="form-group"><label>Descricao (opcional)</label><textarea className="input" value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ resize: 'vertical' }} /></div>

        <div className="form-group">
          <label>Tipo</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className={`btn btn-sm ${type === 'sequence' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setType('sequence')}>Sequencia</button>
            <button type="button" className={`btn btn-sm ${type === 'inactivity' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setType('inactivity')}>Inatividade</button>
          </div>
          <small style={{ color: '#9B96B0', fontSize: 11 }}>{type === 'sequence' ? 'Roda uma vez atribuido ao lead' : 'Roda quando lead fica inativo por N dias'}</small>
        </div>

        {type === 'inactivity' && (
          <div className="form-group">
            <label>Dias de inatividade</label>
            <input type="number" min={1} className="input" value={inactivityDays} onChange={e => setInactivityDays(e.target.value)} style={{ width: 100 }} />
          </div>
        )}

        <div className="form-group">
          <label>Parar quando lead responder?</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={stopOnReply === 1} onChange={e => setStopOnReply(e.target.checked ? 1 : 0)} />
            <span>Sim, para o follow-up automaticamente</span>
          </label>
        </div>

        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 6 }}>Steps</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: 8, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
              <div style={{ width: 24, color: '#9B96B0', fontSize: 12, fontWeight: 700, paddingTop: 8, textAlign: 'center' }}>{i + 1}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#9B96B0' }}>Delay:</span>
                  <input type="number" min={0} className="input" value={s.delay_minutes ?? 0} onChange={e => updateStep(i, 'delay_minutes', e.target.value)} style={{ width: 80, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: '#9B96B0' }}>minutos {i === 0 ? '(apos atribuir)' : '(apos step anterior)'}</span>
                </div>
                <textarea className="input" value={s.message_template || ''} onChange={e => updateStep(i, 'message_template', e.target.value)} placeholder="Mensagem. Use {{primeiro_nome}}, {{atendente}}, {{empresa}}, {{cidade}}" rows={3} style={{ fontSize: 12, resize: 'vertical' }} />
              </div>
              <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStep(i)}><Trash2 size={12} /></button>
            </div>
          ))}
        </div>
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addStep}><Plus size={12} /> Adicionar Step</button>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// APPLY FOLLOW-UP MODAL (com mapping de instance/agent por conta)
// ============================================================

interface AccountMapping {
  account_id: number
  account_name: string
  instances: WhatsAppInstance[]
  agents: Agent[]
  instance_id: number | null
  agent_id: number | null
  loaded: boolean
}

function ApplyFollowUpModal({ followUpId, onClose, onDone }: { followUpId: number; onClose: () => void; onDone: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [mappings, setMappings] = useState<Record<number, AccountMapping>>({})
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)
  const [results, setResults] = useState<Array<{ account_id: number; account_name?: string; ok: boolean; error?: string }> | null>(null)
  const [appliedIn, setAppliedIn] = useState<Set<number>>(new Set())

  useEffect(() => {
    Promise.all([
      fetchAccounts(),
      fetchGlobalFollowUpAppliedIn(followUpId).catch(() => []),
    ]).then(([accs, applied]) => {
      setAccounts((accs || []).filter(a => a.is_active))
      setAppliedIn(new Set(applied.map(r => r.account_id)))
    })
  }, [followUpId])

  const toggle = async (accountId: number, accountName: string) => {
    const isSelected = selected.has(accountId)
    if (isSelected) {
      setSelected(p => { const n = new Set(p); n.delete(accountId); return n })
      return
    }
    setSelected(p => { const n = new Set(p); n.add(accountId); return n })
    if (!mappings[accountId]?.loaded) {
      // Fetch instances + agents da conta
      try {
        const [insts, agentsData] = await Promise.all([
          fetchWhatsAppInstances(accountId).catch(() => []),
          fetchAgents(accountId).catch(() => ({ agents: [], feature_enabled: false, has_api_key: false })),
        ])
        const connected = (insts || []).filter(i => i.status === 'connected')
        setMappings(p => ({ ...p, [accountId]: {
          account_id: accountId, account_name: accountName,
          instances: connected, agents: agentsData.agents || [],
          instance_id: connected[0]?.id || null, agent_id: null, loaded: true,
        } }))
      } catch (e) {
        setMappings(p => ({ ...p, [accountId]: { account_id: accountId, account_name: accountName, instances: [], agents: [], instance_id: null, agent_id: null, loaded: true } }))
      }
    }
  }

  const setMappingField = (accountId: number, field: 'instance_id' | 'agent_id', value: number | null) => {
    setMappings(p => ({ ...p, [accountId]: { ...p[accountId], [field]: value } }))
  }

  const handleApply = async () => {
    const items = Array.from(selected).map(aid => mappings[aid]).filter(Boolean)
    const missing = items.filter(m => !m.instance_id)
    if (missing.length > 0) {
      alert(`Selecione uma instancia pra: ${missing.map(m => m.account_name).join(', ')}`)
      return
    }
    setApplying(true)
    try {
      const r = await applyGlobalFollowUp(followUpId, items.map(m => ({
        account_id: m.account_id, instance_id: m.instance_id!, agent_id: m.agent_id || null,
      })), overwrite)
      setResults(r)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <h2>Aplicar follow-up em contas</h2>
        {results ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
              {results.map(r => (
                <div key={r.account_id} style={{ display: 'flex', gap: 8, padding: 8, background: r.ok ? 'rgba(126,231,135,0.05)' : 'rgba(255,107,107,0.05)', borderRadius: 6, fontSize: 12 }}>
                  <span style={{ color: r.ok ? '#7ee787' : '#FF6B6B' }}>{r.ok ? '✓' : '✗'}</span>
                  <span>{r.account_name || r.account_id}</span>
                  {r.error && <span style={{ color: '#FF6B6B', marginLeft: 'auto' }}>{r.error}</span>}
                </div>
              ))}
            </div>
            <div className="modal-actions"><button className="btn btn-primary" onClick={onDone}>Fechar</button></div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 12 }}>Escolha as contas, e pra cada uma selecione qual instancia WhatsApp vai enviar.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflowY: 'auto', marginBottom: 12 }}>
              {accounts.map(a => {
                const isSelected = selected.has(a.id)
                const m = mappings[a.id]
                return (
                  <div key={a.id} style={{ padding: 8, background: isSelected ? 'rgba(255,179,0,0.05)' : 'rgba(255,255,255,0.02)', borderRadius: 8, border: isSelected ? '1px solid rgba(255,179,0,0.3)' : '1px solid var(--border-subtle)' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggle(a.id, a.name)} />
                      <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
                      {appliedIn.has(a.id) && <span style={{ fontSize: 10, color: '#FFB300', background: 'rgba(255,179,0,0.1)', padding: '2px 6px', borderRadius: 8 }}>ja aplicada</span>}
                    </label>
                    {isSelected && m && m.loaded && (
                      <div style={{ marginTop: 8, marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {m.instances.length === 0 ? (
                          <span style={{ fontSize: 11, color: '#FF6B6B' }}>⚠ Sem instancia conectada. Conecte um WhatsApp em /integrations pra essa conta primeiro.</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#9B96B0', width: 70 }}>Instancia:</span>
                            <select className="select" value={m.instance_id || ''} onChange={e => setMappingField(a.id, 'instance_id', e.target.value ? +e.target.value : null)} style={{ flex: 1, fontSize: 12 }}>
                              <option value="">Selecionar...</option>
                              {m.instances.map(inst => <option key={inst.id} value={inst.id}>{inst.instance_name}</option>)}
                            </select>
                          </div>
                        )}
                        {m.agents.length > 0 && (
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span style={{ fontSize: 11, color: '#9B96B0', width: 70 }}>Agente:</span>
                            <select className="select" value={m.agent_id || ''} onChange={e => setMappingField(a.id, 'agent_id', e.target.value ? +e.target.value : null)} style={{ flex: 1, fontSize: 12 }}>
                              <option value="">(nenhum)</option>
                              {m.agents.map(ag => <option key={ag.id} value={ag.id}>{ag.name}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              <span>Sobrescrever (desativa copias antigas dessa mesma origem)</span>
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleApply} disabled={applying || selected.size === 0}>
                {applying ? 'Aplicando...' : `Aplicar em ${selected.size} conta(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// VARIABLES MODAL (helper)
// ============================================================

function VariablesModal({ onClose, copiedVar, onCopy }: { onClose: () => void; copiedVar: string | null; onCopy: (t: string) => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h2>Variaveis para templates</h2>
        <p style={{ fontSize: 12, color: '#9B96B0', marginBottom: 16 }}>Cole essas tags no campo "Mensagem" — sao substituidas na hora do envio pelo backend (follow-up) ou frontend (cadencia).</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {MESSAGE_VARIABLES.map(v => (
            <div key={v.token} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}>
              <code style={{ fontSize: 13, color: '#FFB300', fontFamily: 'monospace', flexShrink: 0, minWidth: 160 }}>{v.token}</code>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#E8E4F0' }}>{v.label}</div>
                <div style={{ fontSize: 11, color: '#6B6580' }}>Ex: <em>{v.example}</em></div>
              </div>
              <button className="btn btn-secondary btn-sm btn-icon" onClick={() => onCopy(v.token)}>
                {copiedVar === v.token ? <Check size={12} /> : <Copy size={12} />}
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions"><button className="btn btn-secondary" onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  )
}

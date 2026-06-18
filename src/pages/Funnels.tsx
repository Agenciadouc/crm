import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchFunnels, createFunnel, updateFunnelStages, type Funnel, type FunnelStage } from '../lib/api'
import { Plus, GripVertical, Trash2, Save, Target } from 'lucide-react'

const DEFAULT_COLORS = ['#FFB300', '#5DADE2', '#9B59B6', '#FFAA83', '#FF6B8A', '#34C759', '#FF6B6B']

export default function Funnels() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Funnel | null>(null)
  const [editStages, setEditStages] = useState<Partial<FunnelStage>[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const load = () => { if (accountId) { setLoading(true); fetchFunnels(accountId).then(setFunnels).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!accountId || !newName) return
    const stages = [
      { name: 'Novo Lead', color: '#FFB300' },
      { name: 'Em Atendimento', color: '#5DADE2' },
      { name: 'Qualificado', color: '#9B59B6' },
      { name: 'Venda', color: '#34C759', is_conversion: true, is_terminal: true },
      { name: 'Perdido', color: '#FF6B6B', is_terminal: true },
    ]
    await createFunnel(accountId, { name: newName, stages })
    setShowNew(false); setNewName(''); load()
  }

  const startEdit = (f: Funnel) => { setEditing(f); setEditStages(f.stages.map(s => ({ ...s }))) }

  const addStage = () => { setEditStages(prev => [...prev, { name: '', color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length], is_conversion: 0, is_terminal: 0, auto_keywords: null }]) }
  const removeStage = (i: number) => { setEditStages(prev => prev.filter((_, idx) => idx !== i)) }
  const updateStage = (i: number, field: string, value: any) => { setEditStages(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s)) }

  const [savingStages, setSavingStages] = useState(false)
  const saveStages = async () => {
    if (!editing || !accountId) return
    setSavingStages(true)
    try {
      await updateFunnelStages(editing.id, accountId, editStages.map((s, i) => ({ ...s, position: i })))
      setEditing(null); load()
    } catch (e: any) {
      alert('Erro ao salvar etapas: ' + (e.message || 'desconhecido'))
    } finally {
      setSavingStages(false)
    }
  }

  const handleDragStart = (i: number) => () => { setDragIndex(i) }
  const handleDragOver = (i: number) => (e: React.DragEvent) => { e.preventDefault(); setDragOverIndex(i) }
  const handleDragEnd = () => { setDragIndex(null); setDragOverIndex(null) }
  const handleDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (dragIndex === null || dragIndex === i) { handleDragEnd(); return }
    setEditStages(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(dragIndex, 1)
      arr.splice(i, 0, moved)
      return arr
    })
    handleDragEnd()
  }

  return (
    <div>
      <div className="page-header">
        <h1>Funis</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Funil</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {funnels.map(f => (
            <div key={f.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 600 }}>{f.name}</h3>
                  {f.is_default ? <span style={{ fontSize: 10, color: '#FFB300' }}>PADRAO</span> : null}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(f)}>Editar Etapas</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {f.stages.map(s => (
                  <span key={s.id} className="stage-badge" style={{ background: `${s.color}20`, color: s.color }}>
                    {s.is_conversion ? <Target size={10} style={{ marginRight: 3 }} /> : null}
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {funnels.length === 0 && <div className="empty-state"><h3>Nenhum funil criado</h3></div>}
        </div>
      )}

      {/* Edit stages modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
            <h2>Editar Etapas — {editing.name}</h2>
            <div style={{ marginTop: 8, padding: 8, background: 'rgba(91,173,226,0.06)', borderRadius: 6, fontSize: 11, color: '#9B96B0', lineHeight: 1.5 }}>
              💡 Para leads de <strong>Click-to-WhatsApp</strong> o Meta só aceita <code>LeadSubmitted</code> e <code>Purchase</code>. Qualquer outro evento é enviado automaticamente como <code>LeadSubmitted</code> nesses leads (em leads normais, vai o evento escolhido).
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {editStages.map((s, i) => {
                const isCustomEvent = s.meta_event_name && !['Lead','Contact','Schedule','SubmitApplication','Purchase','CompleteRegistration','AddToCart','InitiateCheckout','LeadSubmitted'].includes(s.meta_event_name)
                return (
                <div
                  key={i}
                  draggable
                  onDragStart={handleDragStart(i)}
                  onDragOver={handleDragOver(i)}
                  onDrop={handleDrop(i)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 6,
                    padding: 8, borderRadius: 6,
                    opacity: dragIndex === i ? 0.4 : 1,
                    background: dragOverIndex === i && dragIndex !== i ? 'rgba(255,179,0,0.08)' : 'rgba(255,255,255,0.02)',
                    borderTop: dragOverIndex === i && dragIndex !== null && dragIndex > i ? '2px solid #FFB300' : '2px solid transparent',
                    borderBottom: dragOverIndex === i && dragIndex !== null && dragIndex < i ? '2px solid #FFB300' : '2px solid transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <GripVertical size={14} style={{ color: '#9B96B0', cursor: 'grab' }} />
                    <input type="color" value={s.color || '#FFB300'} onChange={e => updateStage(i, 'color', e.target.value)} style={{ width: 30, height: 30, border: 'none', background: 'none', cursor: 'pointer' }} />
                    <input className="input" value={s.name || ''} onChange={e => updateStage(i, 'name', e.target.value)} placeholder="Nome da etapa" style={{ flex: 1 }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!s.is_conversion} onChange={e => updateStage(i, 'is_conversion', e.target.checked ? 1 : 0)} /> Conv.
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!s.is_terminal} onChange={e => updateStage(i, 'is_terminal', e.target.checked ? 1 : 0)} /> Final
                    </label>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeStage(i)}><Trash2 size={12} /></button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', paddingLeft: 22 }}>
                    <span style={{ fontSize: 10, color: '#9B96B0', minWidth: 90 }}>Evento Meta:</span>
                    <select
                      className="select"
                      value={isCustomEvent ? '__custom__' : (s.meta_event_name || '')}
                      onChange={e => {
                        if (e.target.value === '__custom__') updateStage(i, 'meta_event_name', '')
                        else updateStage(i, 'meta_event_name', e.target.value || null)
                      }}
                      style={{ fontSize: 11, flex: 1 }}
                    >
                      <option value="">— nenhum (não dispara) —</option>
                      <option value="LeadSubmitted">LeadSubmitted (CTWA ✓)</option>
                      <option value="Purchase">Purchase (CTWA ✓)</option>
                      <option value="Lead">Lead</option>
                      <option value="Contact">Contact</option>
                      <option value="Schedule">Schedule</option>
                      <option value="SubmitApplication">SubmitApplication</option>
                      <option value="CompleteRegistration">CompleteRegistration</option>
                      <option value="AddToCart">AddToCart</option>
                      <option value="InitiateCheckout">InitiateCheckout</option>
                      <option value="__custom__">Custom...</option>
                    </select>
                    {isCustomEvent && (
                      <input
                        className="input"
                        value={s.meta_event_name || ''}
                        onChange={e => updateStage(i, 'meta_event_name', e.target.value || null)}
                        placeholder="Nome do evento custom"
                        style={{ fontSize: 11, flex: 1 }}
                      />
                    )}
                  </div>
                </div>
                )
              })}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addStage}><Plus size={12} /> Adicionar Etapa</button>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveStages} disabled={savingStages}><Save size={14} /> {savingStages ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* New funnel modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Funil</h2>
            <div className="form-group"><label>Nome do Funil</label><input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex: Funil de Vendas" /></div>
            <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 8 }}>Um funil padrao sera criado com etapas: Novo Lead, Em Atendimento, Qualificado, Venda, Perdido. Voce pode editar depois.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar Funil</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

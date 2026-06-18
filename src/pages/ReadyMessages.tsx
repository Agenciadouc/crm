import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchReadyMessages, createReadyMessage, updateReadyMessage, deleteReadyMessage,
  fetchFunnels, type ReadyMessage, type Funnel, type FunnelStage,
} from '../lib/api'
import { Plus, Edit3, Trash2, MessageSquare, Image, Video } from 'lucide-react'

export default function ReadyMessages() {
  const { accountId } = useAccount()
  const [messages, setMessages] = useState<ReadyMessage[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState({ title: '', content: '', image_url: '', video_url: '', stage_id: '' })

  const allStages: FunnelStage[] = funnels.flatMap(f => f.stages || [])

  const load = () => {
    if (!accountId) return
    setLoading(true)
    Promise.all([fetchReadyMessages(accountId), fetchFunnels(accountId)])
      .then(([msgs, funs]) => { setMessages(msgs); setFunnels(funs) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [accountId])

  const openNew = () => { setEditingId(null); setForm({ title: '', content: '', image_url: '', video_url: '', stage_id: '' }); setShowModal(true) }
  const openEdit = (m: ReadyMessage) => {
    setEditingId(m.id)
    setForm({ title: m.title, content: m.content, image_url: m.image_url || '', video_url: m.video_url || '', stage_id: m.stage_id ? String(m.stage_id) : '' })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!accountId || !form.title || !form.content) return
    const data = { title: form.title, content: form.content, image_url: form.image_url || null, video_url: form.video_url || null, stage_id: form.stage_id ? +form.stage_id : null }
    if (editingId) await updateReadyMessage(editingId, accountId, data)
    else await createReadyMessage(accountId, data)
    setShowModal(false); load()
  }

  const handleDelete = async (id: number) => { if (accountId) { await deleteReadyMessage(id, accountId); load() } }

  return (
    <div>
      <div className="page-header">
        <h1>Mensagens Prontas</h1>
        <button className="btn btn-primary btn-sm" onClick={openNew}><Plus size={14} /> Nova Mensagem</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {messages.map(m => (
            <div key={m.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <MessageSquare size={14} style={{ color: '#FFB300' }} />
                  <h3 style={{ fontSize: 14, fontWeight: 600 }}>{m.title}</h3>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(m)}><Edit3 size={12} /></button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(m.id)}><Trash2 size={12} /></button>
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#C8C4D4', lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}>{m.content}</p>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {m.stage_name && (
                  <span className="stage-badge" style={{ background: `${m.stage_color || '#FFB300'}20`, color: m.stage_color || '#FFB300', fontSize: 10 }}>{m.stage_name}</span>
                )}
                {m.image_url && <span style={{ fontSize: 10, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 2 }}><Image size={10} /> Imagem</span>}
                {m.video_url && <span style={{ fontSize: 10, color: '#9B96B0', display: 'flex', alignItems: 'center', gap: 2 }}><Video size={10} /> Video</span>}
              </div>
            </div>
          ))}
          {messages.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><h3>Nenhuma mensagem pronta</h3><p>Crie templates de mensagens para agilizar o atendimento.</p></div>}
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editingId ? 'Editar Mensagem' : 'Nova Mensagem'}</h2>
            <div className="form-group"><label>Titulo</label><input className="input" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Ex: Boas-vindas" /></div>
            <div className="form-group"><label>Conteudo</label><textarea className="input" value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} placeholder="Texto da mensagem..." rows={5} style={{ resize: 'vertical' }} /></div>
            <div className="form-group"><label>Etapa (filtro opcional)</label>
              <select className="select" value={form.stage_id} onChange={e => setForm(p => ({ ...p, stage_id: e.target.value }))}>
                <option value="">Todas as etapas</option>
                {allStages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div className="form-group" style={{ flex: 1 }}><label>URL Imagem (opcional)</label><input className="input" value={form.image_url} onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))} placeholder="https://..." /></div>
              <div className="form-group" style={{ flex: 1 }}><label>URL Video (opcional)</label><input className="input" value={form.video_url} onChange={e => setForm(p => ({ ...p, video_url: e.target.value }))} placeholder="https://..." /></div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave}>{editingId ? 'Salvar' : 'Criar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

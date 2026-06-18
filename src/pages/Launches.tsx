import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import {
  fetchLaunches, createLaunch, updateLaunchMessages, deleteLaunch,
  type Launch, type LaunchMessage,
} from '../lib/api'
import { Plus, Trash2, Save, Rocket, MessageCircle } from 'lucide-react'

export default function Launches() {
  const { accountId } = useAccount()
  const [launches, setLaunches] = useState<Launch[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Launch | null>(null)
  const [editMsgs, setEditMsgs] = useState<Partial<LaunchMessage>[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newIdent, setNewIdent] = useState('')

  const load = () => { if (accountId) { setLoading(true); fetchLaunches(accountId).then(setLaunches).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!accountId || !newTitle) return
    await createLaunch(accountId, { title: newTitle, identification: newIdent || undefined })
    setShowNew(false); setNewTitle(''); setNewIdent(''); load()
  }

  const startEdit = (l: Launch) => { setEditing(l); setEditMsgs(l.messages.map(m => ({ ...m }))) }
  const addMsg = () => setEditMsgs(prev => [...prev, { question: '', answer: '' }])
  const removeMsg = (i: number) => setEditMsgs(prev => prev.filter((_, idx) => idx !== i))
  const updateMsg = (i: number, field: string, value: string) => setEditMsgs(prev => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))

  const saveMsgs = async () => {
    if (!editing || !accountId) return
    await updateLaunchMessages(editing.id, accountId, editMsgs.map((m, i) => ({ ...m, position: i })))
    setEditing(null); load()
  }

  const handleDelete = async (id: number) => { if (accountId) { await deleteLaunch(id, accountId); load() } }

  return (
    <div>
      <div className="page-header">
        <h1>Lancamentos</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Novo Lancamento</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
          {launches.map(l => (
            <div key={l.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Rocket size={14} style={{ color: '#FFB300' }} />
                    <h3 style={{ fontSize: 14, fontWeight: 600 }}>{l.title}</h3>
                  </div>
                  {l.identification && <div style={{ fontSize: 11, color: '#9B96B0', marginTop: 2 }}>ID: {l.identification}</div>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => startEdit(l)}>Mensagens</button>
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(l.id)}><Trash2 size={12} /></button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9B96B0' }}>
                <MessageCircle size={10} /> {l.messages.length} mensagem(ns)
              </div>
              {l.messages.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {l.messages.slice(0, 2).map((m, i) => (
                    <div key={m.id} style={{ fontSize: 11, color: '#C8C4D4', padding: '4px 0', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <strong style={{ color: '#FFB300' }}>P:</strong> {m.question.substring(0, 50)}{m.question.length > 50 ? '...' : ''}
                    </div>
                  ))}
                  {l.messages.length > 2 && <div style={{ fontSize: 10, color: '#6B6580', marginTop: 2 }}>+{l.messages.length - 2} mais</div>}
                </div>
              )}
            </div>
          ))}
          {launches.length === 0 && <div className="empty-state" style={{ gridColumn: '1 / -1' }}><h3>Nenhum lancamento</h3><p>Cadastre lancamentos (imoveis, produtos) com perguntas e respostas prontas.</p></div>}
        </div>
      )}

      {/* Edit messages modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 650 }} onClick={e => e.stopPropagation()}>
            <h2>Mensagens — {editing.title}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
              {editMsgs.map((m, i) => (
                <div key={i} style={{ padding: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#FFB300' }}>#{i + 1}</span>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => removeMsg(i)}><Trash2 size={12} /></button>
                  </div>
                  <input className="input" value={m.question || ''} onChange={e => updateMsg(i, 'question', e.target.value)} placeholder="Pergunta" style={{ marginBottom: 6 }} />
                  <textarea className="input" value={m.answer || ''} onChange={e => updateMsg(i, 'answer', e.target.value)} placeholder="Resposta" rows={3} style={{ resize: 'vertical' }} />
                </div>
              ))}
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={addMsg}><Plus size={12} /> Adicionar Mensagem</button>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={saveMsgs}><Save size={14} /> Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* New launch modal */}
      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Lancamento</h2>
            <div className="form-group"><label>Titulo</label><input className="input" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Ex: Residencial Park" /></div>
            <div className="form-group"><label>Identificacao (opcional)</label><input className="input" value={newIdent} onChange={e => setNewIdent(e.target.value)} placeholder="Ex: SKU, codigo do anuncio" /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

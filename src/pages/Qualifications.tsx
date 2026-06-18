import { useState, useEffect } from 'react'
import { useAccount } from '../context/AccountContext'
import { fetchQualifications, createQualification, updateQualification, deleteQualification, type QualificationSequence } from '../lib/api'
import { Plus, Trash2, Edit3, Save, X, ClipboardList } from 'lucide-react'

export default function Qualifications() {
  const { accountId } = useAccount()
  const [sequences, setSequences] = useState<QualificationSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newQuestion, setNewQuestion] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const load = () => { if (accountId) { setLoading(true); fetchQualifications(accountId).then(setSequences).finally(() => setLoading(false)) } }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!accountId || !newQuestion.trim()) return
    await createQualification(accountId, newQuestion.trim())
    setShowNew(false); setNewQuestion(''); load()
  }

  const startEdit = (s: QualificationSequence) => { setEditingId(s.id); setEditText(s.question) }
  const cancelEdit = () => { setEditingId(null); setEditText('') }

  const handleSave = async () => {
    if (!editingId || !accountId || !editText.trim()) return
    await updateQualification(editingId, accountId, { question: editText.trim() })
    setEditingId(null); load()
  }

  const handleDelete = async (id: number) => { if (accountId) { await deleteQualification(id, accountId); load() } }

  return (
    <div>
      <div className="page-header">
        <h1>Qualificacao de Leads</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Nova Pergunta</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="card">
          {sequences.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sequences.map((s, i) => (
                <div key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: 'rgba(255,179,0,0.03)', borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#FFB30020', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#FFB300' }}>{i + 1}</span>
                  </div>
                  {editingId === s.id ? (
                    <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                      <input className="input" value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSave()} style={{ flex: 1 }} autoFocus />
                      <button className="btn btn-primary btn-sm btn-icon" onClick={handleSave}><Save size={12} /></button>
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={cancelEdit}><X size={12} /></button>
                    </div>
                  ) : (
                    <>
                      <div style={{ flex: 1, fontSize: 13 }}>{s.question}</div>
                      <button className="btn btn-secondary btn-sm btn-icon" onClick={() => startEdit(s)}><Edit3 size={12} /></button>
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(s.id)}><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state"><ClipboardList size={32} style={{ color: '#6B6580', marginBottom: 8 }} /><h3>Nenhuma pergunta de qualificacao</h3><p>Defina perguntas para qualificar seus leads no detalhe do lead.</p></div>
          )}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Nova Pergunta</h2>
            <div className="form-group"><label>Pergunta</label><input className="input" value={newQuestion} onChange={e => setNewQuestion(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreate()} placeholder="Ex: Qual o orcamento disponivel?" autoFocus /></div>
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

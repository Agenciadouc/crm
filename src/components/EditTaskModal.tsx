import { useState, useEffect } from 'react'
import { updateStandaloneTask, fetchUsers, type User as UserType } from '../lib/api'
import { useAccount } from '../context/AccountContext'
import { Save, X } from 'lucide-react'
import { parseSqlDate } from '../lib/dates'

interface Props {
  task: any
  onClose: () => void
  onSaved: () => void
}

export default function EditTaskModal({ task, onClose, onSaved }: Props) {
  const { accountId } = useAccount()
  const [title, setTitle] = useState(task.title || '')
  const [description, setDescription] = useState(task.description || '')
  const [dueMode, setDueMode] = useState<'date' | 'duration'>('date')
  const [dueDate, setDueDate] = useState(() => {
    const d = task.due_datetime ? parseSqlDate(task.due_datetime) : new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const [dueTime, setDueTime] = useState(() => {
    const d = task.due_datetime ? parseSqlDate(task.due_datetime) : new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [dueMinutes, setDueMinutes] = useState('10')
  const [assignedTo, setAssignedTo] = useState(String(task.assigned_to || ''))
  const [users, setUsers] = useState<UserType[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (accountId) fetchUsers(accountId).then(setUsers).catch(() => {})
  }, [accountId])

  const handleSave = async () => {
    if (!title.trim()) { setError('Titulo obrigatorio'); return }
    if (!accountId) return
    setSaving(true); setError('')
    try {
      const data: any = { title, description }
      if (assignedTo) data.assigned_to = +assignedTo
      if (dueMode === 'duration') { data.due_mode = 'duration'; data.due_minutes = +dueMinutes }
      else { data.due_mode = 'date'; data.due_date = dueDate; data.due_time = dueTime }
      await updateStandaloneTask(task.id, accountId, data)
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Editar Tarefa</h2>
        {error && <div style={{ padding: '8px 12px', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 6, color: '#FF6B6B', fontSize: 12, marginBottom: 12 }}>{error}</div>}

        <div className="form-group"><label>Titulo *</label><input className="input" value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="form-group"><label>Descricao</label><textarea className="input" rows={3} value={description} onChange={e => setDescription(e.target.value)} /></div>

        <div className="form-group">
          <label>Quando</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button type="button" onClick={() => setDueMode('date')} className={`btn btn-sm ${dueMode === 'date' ? 'btn-primary' : 'btn-secondary'}`}>Data/Hora</button>
            <button type="button" onClick={() => setDueMode('duration')} className={`btn btn-sm ${dueMode === 'duration' ? 'btn-primary' : 'btn-secondary'}`}>Em X minutos</button>
          </div>
          {dueMode === 'date' ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} style={{ flex: 1 }} />
              <input className="input" type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} style={{ width: 110 }} />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="input" type="number" min="1" value={dueMinutes} onChange={e => setDueMinutes(e.target.value)} style={{ width: 100 }} />
              <span style={{ fontSize: 13, color: '#9B96B0' }}>minutos a partir de agora</span>
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Responsavel</label>
          <select className="select" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
            <option value="">Sem responsavel</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}><X size={14} /> Cancelar</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !title.trim()}><Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  )
}

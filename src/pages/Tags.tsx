import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { fetchTags, createTag, updateTag, deleteTag, type Tag } from '../lib/api'
import { Tag as TagIcon, Plus, Edit3, Trash2, Save, X } from 'lucide-react'

const PRESET_COLORS = ['#FFB300', '#FF6B6B', '#34C759', '#5DADE2', '#9B59B6', '#FFAA83', '#FF6B8A', '#26C6DA', '#FFD54F', '#A1887F']

export default function Tags() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newTag, setNewTag] = useState({ name: '', color: '#FFB300' })
  const [editing, setEditing] = useState<number | null>(null)
  const [editData, setEditData] = useState({ name: '', color: '#FFB300' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Atendente tambem pode criar/editar tags (decisao do user em 03/06/2026)
  const canEdit = user?.role === 'super_admin' || user?.role === 'gerente' || user?.role === 'atendente'

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try { setTags(await fetchTags(accountId)) } catch {}
    setLoading(false)
  }, [accountId])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!accountId || !newTag.name.trim()) return
    setSaving(true); setError('')
    try {
      await createTag(accountId, newTag.name.trim(), newTag.color)
      setShowNew(false); setNewTag({ name: '', color: '#FFB300' })
      load()
    } catch (e: any) { setError(e.message || 'Erro') }
    setSaving(false)
  }

  const handleSaveEdit = async (tagId: number) => {
    if (!accountId || !editData.name.trim()) return
    setSaving(true); setError('')
    try {
      await updateTag(tagId, accountId, { name: editData.name.trim(), color: editData.color })
      setEditing(null)
      load()
    } catch (e: any) { setError(e.message || 'Erro') }
    setSaving(false)
  }

  const handleDelete = async (tagId: number, name: string) => {
    if (!accountId) return
    if (!confirm(`Excluir tag "${name}"? Sera removida de todos os leads que tem ela.`)) return
    try { await deleteTag(tagId, accountId); load() } catch (e: any) { alert(e.message || 'Erro') }
  }

  const startEdit = (t: Tag) => { setEditing(t.id); setEditData({ name: t.name, color: t.color }); setError('') }

  return (
    <div>
      <div className="page-header">
        <h1><TagIcon size={20} style={{ marginRight: 8, verticalAlign: 'middle' }} />Tags</h1>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => { setShowNew(true); setError('') }}><Plus size={14} /> Nova Tag</button>}
      </div>

      {error && <div style={{ padding: '8px 12px', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 6, color: '#FF6B6B', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9B96B0' }}>Carregando...</div>
      ) : tags.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40, color: '#9B96B0' }}>
          <TagIcon size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div style={{ fontSize: 14, marginBottom: 4 }}>Nenhuma tag criada ainda.</div>
          {canEdit && <div style={{ fontSize: 12 }}>Clique em "Nova Tag" para comecar.</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tags.map(t => (
            <div key={t.id} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
              {editing === t.id ? (
                <>
                  <input type="color" value={editData.color} onChange={e => setEditData(p => ({ ...p, color: e.target.value }))} style={{ width: 36, height: 36, border: 'none', borderRadius: 6, cursor: 'pointer', background: 'transparent' }} />
                  <input className="input" value={editData.name} onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} autoFocus style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && handleSaveEdit(t.id)} />
                  <button className="btn btn-primary btn-sm" onClick={() => handleSaveEdit(t.id)} disabled={saving || !editData.name.trim()}><Save size={12} /> Salvar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(null)}><X size={12} /></button>
                </>
              ) : (
                <>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: `${t.color}25`, color: t.color, borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color }} />
                    {t.name}
                  </div>
                  <div style={{ flex: 1 }} />
                  {canEdit && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => startEdit(t)} style={{ fontSize: 11 }}><Edit3 size={12} /> Editar</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(t.id, t.name)} style={{ fontSize: 11, color: '#FF6B6B' }}><Trash2 size={12} /> Excluir</button>
                    </>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h2>Nova Tag</h2>
            {error && <div style={{ padding: '8px 12px', background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', borderRadius: 6, color: '#FF6B6B', fontSize: 12, marginBottom: 12 }}>{error}</div>}
            <div className="form-group"><label>Nome *</label><input className="input" value={newTag.name} onChange={e => setNewTag(p => ({ ...p, name: e.target.value }))} autoFocus placeholder="Ex: Quente, Cliente VIP, Sem perfil..." /></div>
            <div className="form-group">
              <label>Cor</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setNewTag(p => ({ ...p, color: c }))} style={{ width: 32, height: 32, borderRadius: 6, background: c, border: newTag.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer' }} title={c} />
                ))}
                <input type="color" value={newTag.color} onChange={e => setNewTag(p => ({ ...p, color: e.target.value }))} style={{ width: 36, height: 36, border: '2px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', background: 'transparent' }} title="Cor personalizada" />
              </div>
            </div>
            <div className="form-group">
              <label>Preview</label>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: `${newTag.color}25`, color: newTag.color, borderRadius: 6, fontSize: 13, fontWeight: 600 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: newTag.color }} />
                {newTag.name || 'Nome da tag'}
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={saving || !newTag.name.trim()}>{saving ? 'Criando...' : 'Criar Tag'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

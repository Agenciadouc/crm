import { useState, useEffect, useCallback } from 'react'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import {
  fetchTags, createTag, updateTag, deleteTag, type Tag,
  fetchWhatsAppInstances, fetchUsers, type WhatsAppInstance, type User as UserType,
  fetchTagInstanceMappings, upsertTagInstanceMapping, deleteTagInstanceMapping,
  fetchDefaultFormInstance, setDefaultFormInstance,
  type TagInstanceMapping,
} from '../lib/api'
import { Tag as TagIcon, Plus, Edit3, Trash2, Save, X, Smartphone, Link as LinkIcon } from 'lucide-react'

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

  // Mapeamento tag → instancia (leads de form)
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [mappings, setMappings] = useState<TagInstanceMapping[]>([])
  const [defaultFormInstanceId, setDefaultFormInstanceIdState] = useState<number | null>(null)
  const [mappingEditTag, setMappingEditTag] = useState<Tag | null>(null)
  const [mappingForm, setMappingForm] = useState<{ instance_id: string; attendant_id: string }>({ instance_id: '', attendant_id: '' })

  const canEdit = user?.role === 'super_admin' || user?.role === 'gerente'

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    try {
      const [t, inst, u, m, def] = await Promise.all([
        fetchTags(accountId),
        fetchWhatsAppInstances(accountId).catch(() => []),
        fetchUsers(accountId).catch(() => []),
        fetchTagInstanceMappings(accountId).then(r => r.mappings).catch(() => []),
        fetchDefaultFormInstance(accountId).then(r => r.instance_id).catch(() => null),
      ])
      setTags(t); setInstances(inst); setUsers(u); setMappings(m); setDefaultFormInstanceIdState(def)
    } catch {}
    setLoading(false)
  }, [accountId])

  useEffect(() => { load() }, [load])

  const startMappingEdit = (t: Tag) => {
    const existing = mappings.find(m => m.tag_id === t.id)
    setMappingEditTag(t)
    setMappingForm({
      instance_id: existing?.instance_id ? String(existing.instance_id) : '',
      attendant_id: existing?.attendant_id ? String(existing.attendant_id) : '',
    })
  }

  const handleSaveMapping = async () => {
    if (!accountId || !mappingEditTag || !mappingForm.instance_id) return
    setSaving(true); setError('')
    try {
      await upsertTagInstanceMapping(accountId, {
        tag_id: mappingEditTag.id,
        instance_id: Number(mappingForm.instance_id),
        attendant_id: mappingForm.attendant_id ? Number(mappingForm.attendant_id) : null,
      })
      setMappingEditTag(null)
      load()
    } catch (e: any) { setError(e.message || 'Erro') }
    setSaving(false)
  }

  const handleDeleteMapping = async (tagId: number) => {
    if (!accountId) return
    if (!confirm('Remover vinculo dessa tag com WhatsApp?')) return
    try { await deleteTagInstanceMapping(accountId, tagId); load() } catch (e: any) { alert(e.message || 'Erro') }
  }

  const handleChangeDefaultFormInstance = async (instanceId: number | null) => {
    if (!accountId) return
    try { await setDefaultFormInstance(accountId, instanceId); setDefaultFormInstanceIdState(instanceId) }
    catch (e: any) { alert(e.message || 'Erro') }
  }

  const connectedInstances = instances.filter(i => i.status === 'connected')
  const attendants = users.filter(u => (u.role === 'atendente' || u.role === 'gerente') && u.is_active)

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

      {/* Vinculação com WhatsApp (leads de formulário) */}
      {canEdit && !loading && connectedInstances.length > 0 && (
        <div className="card" style={{ marginBottom: 12, padding: 12, background: 'rgba(255,179,0,0.04)', border: '1px solid rgba(255,179,0,0.2)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#FFB300', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <LinkIcon size={12} /> Leads de formulário (sem WhatsApp na origem)
          </div>
          <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
            Leads que chegam via Google Sheets, Meta Lead Form ou site não tem WhatsApp vinculado. Aqui voce decide qual instância eles vão usar.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <Smartphone size={12} style={{ color: '#9B96B0' }} />
            <span style={{ color: '#9B96B0' }}>Instância padrão (fallback):</span>
            <select
              className="select"
              value={defaultFormInstanceId ?? ''}
              onChange={e => handleChangeDefaultFormInstance(e.target.value ? Number(e.target.value) : null)}
              style={{ fontSize: 12, minWidth: 220 }}
            >
              <option value="">— nenhuma (lead fica sem instância) —</option>
              {connectedInstances.map(i => (
                <option key={i.id} value={i.id}>{i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 10, color: '#6B6580', marginTop: 6 }}>
            Usado quando o lead não tem mapeamento de tag abaixo. Use os botões "Vincular" nas tags pra regras específicas (ex: tag "Loja Autorizada" → instância X).
          </p>
        </div>
      )}

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
                  {(() => {
                    const map = mappings.find(m => m.tag_id === t.id)
                    if (!map) return null
                    return (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#34C759', padding: '4px 8px', background: 'rgba(52,199,89,0.08)', borderRadius: 4 }}>
                        <Smartphone size={10} /> {map.instance_name}
                        {map.attendant_name && <span style={{ color: '#9B96B0' }}>· {map.attendant_name}</span>}
                      </div>
                    )
                  })()}
                  <div style={{ flex: 1 }} />
                  {canEdit && connectedInstances.length > 0 && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => startMappingEdit(t)}
                      style={{ fontSize: 11 }}
                      title="Vincular lead que receber essa tag a uma instância WhatsApp + atendente"
                    >
                      <LinkIcon size={12} /> {mappings.find(m => m.tag_id === t.id) ? 'Trocar vínculo' : 'Vincular WhatsApp'}
                    </button>
                  )}
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

      {/* Modal de vinculação tag → WhatsApp */}
      {mappingEditTag && (
        <div className="modal-overlay" onClick={() => setMappingEditTag(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LinkIcon size={16} style={{ color: '#FFB300' }} /> Vincular WhatsApp
            </h2>
            <p style={{ fontSize: 12, color: '#9B96B0', marginTop: 4, marginBottom: 12 }}>
              Lead de formulário que receber a tag <strong style={{ color: mappingEditTag.color }}>{mappingEditTag.name}</strong> vai ser atribuído a esta instância (e atendente, se escolher).
            </p>
            <div className="form-group">
              <label>Instância WhatsApp *</label>
              <select className="select" value={mappingForm.instance_id} onChange={e => setMappingForm(p => ({ ...p, instance_id: e.target.value }))}>
                <option value="">— escolha —</option>
                {connectedInstances.map(i => (
                  <option key={i.id} value={i.id}>{i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Atendente padrão (opcional)</label>
              <select className="select" value={mappingForm.attendant_id} onChange={e => setMappingForm(p => ({ ...p, attendant_id: e.target.value }))}>
                <option value="">— sem atendente fixo (usa roleta) —</option>
                {attendants.map(a => (
                  <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setMappingEditTag(null)}>Cancelar</button>
              {mappings.find(m => m.tag_id === mappingEditTag.id) && (
                <button className="btn btn-secondary" style={{ color: '#FF6B6B' }} onClick={async () => { await handleDeleteMapping(mappingEditTag.id); setMappingEditTag(null) }}>
                  <Trash2 size={12} /> Remover vínculo
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveMapping} disabled={saving || !mappingForm.instance_id}>
                <Save size={12} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

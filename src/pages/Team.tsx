import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchUsers, createUser, updateUser, deleteUser, fetchWhatsAppInstances, type User as UserType, type WhatsAppInstance } from '../lib/api'
import { UserPlus, ToggleLeft, ToggleRight, Trash2, Edit3 } from 'lucide-react'

export default function Team() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [users, setUsers] = useState<UserType[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '' })
  const [editingUser, setEditingUser] = useState<UserType | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', primary_instance_id: '' as string, notification_instance_id: '' as string, can_manage_proposals: false, can_manage_contracts: false, can_grab_leads: false })
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])

  const isAdmin = user?.role === 'super_admin'

  const load = () => {
    if (accountId) {
      setLoading(true)
      fetchUsers(accountId).then(setUsers).finally(() => setLoading(false))
      fetchWhatsAppInstances(accountId).then(setInstances).catch(() => {})
    }
  }
  useEffect(load, [accountId])

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, role: 'atendente', account_id: accountId! })
    setShowNew(false); setNewUser({ name: '', email: '', password: '' }); load()
  }

  const openEdit = (u: UserType) => { setEditingUser(u); setEditForm({ name: u.name, email: u.email, password: '', primary_instance_id: u.primary_instance_id ? String(u.primary_instance_id) : '', notification_instance_id: u.notification_instance_id ? String(u.notification_instance_id) : '', can_manage_proposals: u.can_manage_proposals === 1, can_manage_contracts: u.can_manage_contracts === 1, can_grab_leads: u.can_grab_leads === 1 }) }
  const handleSaveEdit = async () => {
    if (!editingUser) return
    const data: any = { name: editForm.name, email: editForm.email, primary_instance_id: editForm.primary_instance_id ? +editForm.primary_instance_id : null, notification_instance_id: editForm.notification_instance_id ? +editForm.notification_instance_id : null, can_manage_proposals: editForm.can_manage_proposals ? 1 : 0, can_manage_contracts: editForm.can_manage_contracts ? 1 : 0, can_grab_leads: editForm.can_grab_leads ? 1 : 0 }
    if (editForm.password) data.password = editForm.password
    await updateUser(editingUser.id, data)
    setEditingUser(null); load()
  }

  const toggleActive = async (u: UserType) => { await updateUser(u.id, { is_active: u.is_active ? 0 : 1 } as any); load() }
  const handleDelete = async (u: UserType) => { if (confirm(`Remover ${u.name}?`)) { await deleteUser(u.id); load() } }

  const atendentes = users.filter(u => u.role === 'atendente')
  const gerentes = users.filter(u => u.role === 'gerente')

  const renderUserRow = (u: UserType, canEdit: boolean) => (
    <tr key={u.id}>
      <td className="name">{u.name}</td>
      <td>{u.email}</td>
      <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
      <td className="right">
        {canEdit && (
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(u)} title="Editar"><Edit3 size={12} /></button>
            <button className="btn btn-secondary btn-sm btn-icon" onClick={() => toggleActive(u)} title={u.is_active ? 'Desativar' : 'Ativar'}>
              {u.is_active ? <ToggleRight size={14} style={{ color: '#34C759' }} /> : <ToggleLeft size={14} />}
            </button>
            <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(u)} title="Excluir"><Trash2 size={12} /></button>
          </div>
        )}
      </td>
    </tr>
  )

  return (
    <div>
      <div className="page-header">
        <h1>Equipe</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><UserPlus size={14} /> Novo Atendente</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <>
          {gerentes.length > 0 && (
            <section className="dash-section">
              <div className="section-title">Gerentes</div>
              <div className="table-card"><table>
                <thead><tr><th>Nome</th><th>Email</th><th>Status</th><th className="right">Acoes</th></tr></thead>
                <tbody>{gerentes.map(u => renderUserRow(u, isAdmin))}</tbody>
              </table></div>
            </section>
          )}

          <section className="dash-section">
            <div className="section-title">Atendentes ({atendentes.length})</div>
            <div className="table-card"><table>
              <thead><tr><th>Nome</th><th>Email</th><th>Status</th><th className="right">Acoes</th></tr></thead>
              <tbody>
                {atendentes.map(u => renderUserRow(u, true))}
                {atendentes.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum atendente cadastrado</td></tr>}
              </tbody>
            </table></div>
          </section>
        </>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Atendente</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate}>Criar</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Editar — {editingUser.name}</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Nova senha (deixe em branco para manter)</label><input className="input" type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••••" /></div>
            <div className="form-group">
              <label>Instancia primaria (numero padrao para envios)</label>
              <select className="select" value={editForm.primary_instance_id} onChange={e => setEditForm(p => ({ ...p, primary_instance_id: e.target.value }))}>
                <option value="">Nenhuma (usa instancia do lead)</option>
                {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name}{i.status === 'connected' ? ' ✓' : ' ✗'}</option>)}
              </select>
              <small style={{ color: '#9B96B0', fontSize: 11 }}>Usado quando lead nao tem conversa previa. Casos normais: lead manda primeiro, sistema usa o numero que recebeu.</small>
            </div>
            <div className="form-group">
              <label>Instancia de notificacao (recebe alertas de novo lead)</label>
              <select className="select" value={editForm.notification_instance_id} onChange={e => setEditForm(p => ({ ...p, notification_instance_id: e.target.value }))}>
                <option value="">Nenhuma (sem notificação WhatsApp)</option>
                {instances.map(i => <option key={i.id} value={i.id}>{i.instance_name}{i.phone_number ? ` (${i.phone_number})` : ''}</option>)}
              </select>
              <small style={{ color: '#9B96B0', fontSize: 11 }}>Quando esse vendedor receber um lead novo, uma notificação chega no WhatsApp dessa instância (vinda do número Comercial Dros).</small>
            </div>
            {editingUser?.account_name === 'Dros | Deivid' && (
              <>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.can_manage_proposals} onChange={e => setEditForm(p => ({ ...p, can_manage_proposals: e.target.checked }))} />
                    <span>Pode gerenciar Propostas (área comercial)</span>
                  </label>
                  <small style={{ color: '#9B96B0', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 4 }}>
                    Libera acesso à aba "Propostas" pra esse usuário, mesmo sem ser super admin.
                  </small>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.can_manage_contracts} onChange={e => setEditForm(p => ({ ...p, can_manage_contracts: e.target.checked }))} />
                    <span>Pode gerenciar Contratos (área comercial)</span>
                  </label>
                  <small style={{ color: '#9B96B0', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 4 }}>
                    Libera acesso à aba "Contratos" pra esse usuário, mesmo sem ser super admin.
                  </small>
                </div>
              </>
            )}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={editForm.can_grab_leads} onChange={e => setEditForm(p => ({ ...p, can_grab_leads: e.target.checked }))} />
                <span>Pode assumir leads de outros atendentes (sem aprovação)</span>
              </label>
              <small style={{ color: '#9B96B0', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 4 }}>
                Permite "tomar" lead de outro atendente direto, sem pedido/aprovação. Sem essa permissão, só pode pedir transferência.
              </small>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditingUser(null)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSaveEdit}>Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

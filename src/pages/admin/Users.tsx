import { useState, useEffect } from 'react'
import { fetchUsers, fetchAccounts, createUser, updateUser, deleteUser, type User as UserType, type Account } from '../../lib/api'
import { UsersRound, UserPlus, Edit3, Trash2, UserCheck, UserX } from 'lucide-react'

export default function AdminUsers() {
  const [users, setUsers] = useState<UserType[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'gerente', account_id: '' })
  const [editingUser, setEditingUser] = useState<UserType | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', role: 'gerente', can_manage_proposals: false, can_manage_contracts: false, can_grab_leads: false })

  const load = () => { setLoading(true); Promise.all([fetchUsers(), fetchAccounts()]).then(([u, a]) => { setUsers(u); setAccounts(a) }).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async () => {
    if (!newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, account_id: newUser.account_id ? +newUser.account_id : undefined })
    setShowNew(false); setNewUser({ name: '', email: '', password: '', role: 'gerente', account_id: '' }); load()
  }

  const openEdit = (u: UserType) => { setEditingUser(u); setEditForm({ name: u.name, email: u.email, password: '', role: u.role, can_manage_proposals: u.can_manage_proposals === 1, can_manage_contracts: u.can_manage_contracts === 1, can_grab_leads: u.can_grab_leads === 1 }) }
  const handleSaveEdit = async () => {
    if (!editingUser) return
    const data: any = { name: editForm.name, email: editForm.email, role: editForm.role, can_manage_proposals: editForm.can_manage_proposals ? 1 : 0, can_manage_contracts: editForm.can_manage_contracts ? 1 : 0, can_grab_leads: editForm.can_grab_leads ? 1 : 0 }
    if (editForm.password) data.password = editForm.password
    await updateUser(editingUser.id, data)
    setEditingUser(null); load()
  }

  const handleToggleActive = async (u: UserType) => { await updateUser(u.id, { is_active: u.is_active ? 0 : 1 } as any); load() }
  const handleDelete = async (u: UserType) => { if (confirm(`Excluir "${u.name}"?`)) { await deleteUser(u.id); load() } }

  const getAccountName = (id: number | null) => id ? accounts.find(a => a.id === id)?.name || '-' : 'Admin'

  return (
    <div>
      <div className="page-header">
        <h1><UsersRound size={20} style={{ marginRight: 8 }} /> Todos Usuarios</h1>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><UserPlus size={14} /> Novo Usuario</button>
      </div>

      {loading ? <div className="loading-container"><div className="spinner" /></div> : (
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Email</th><th>Conta</th><th>Role</th><th>Status</th><th className="right">Acoes</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="name">{u.name}</td><td>{u.email}</td>
                <td>{getAccountName(u.account_id)}</td>
                <td><span className="stage-badge" style={{ background: u.role === 'super_admin' ? '#FF6B6B20' : u.role === 'gerente' ? '#FFB30020' : '#5DADE220', color: u.role === 'super_admin' ? '#FF6B6B' : u.role === 'gerente' ? '#FFB300' : '#5DADE2' }}>{u.role}</span></td>
                <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                <td className="right">
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(u)} title="Editar"><Edit3 size={12} /></button>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleToggleActive(u)} title={u.is_active ? 'Desativar' : 'Ativar'}>
                      {u.is_active ? <UserX size={12} /> : <UserCheck size={12} />}
                    </button>
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(u)} title="Excluir"><Trash2 size={12} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      {showNew && (
        <div className="modal-overlay" onClick={() => setShowNew(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Usuario</h2>
            <div className="form-group"><label>Conta</label>
              <select className="select" value={newUser.account_id} onChange={e => setNewUser(p => ({ ...p, account_id: e.target.value }))}>
                <option value="">Admin (sem conta)</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            <div className="form-group"><label>Role</label>
              <select className="select" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                <option value="super_admin">Super Admin</option><option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
            </div>
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
            <div className="form-group"><label>Role</label>
              <select className="select" value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                <option value="super_admin">Super Admin</option><option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
            </div>
            {editingUser?.account_name === 'Dros | Deivid' && (
              <>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.can_manage_proposals} onChange={e => setEditForm(p => ({ ...p, can_manage_proposals: e.target.checked }))} />
                    <span>Pode gerenciar Propostas (área comercial)</span>
                  </label>
                  <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 4, marginLeft: 24 }}>
                    Libera acesso à aba "Propostas" mesmo pra usuários que não são super admin.
                  </p>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editForm.can_manage_contracts} onChange={e => setEditForm(p => ({ ...p, can_manage_contracts: e.target.checked }))} />
                    <span>Pode gerenciar Contratos (área comercial)</span>
                  </label>
                  <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 4, marginLeft: 24 }}>
                    Libera acesso à aba "Contratos" mesmo pra usuários que não são super admin.
                  </p>
                </div>
              </>
            )}
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={editForm.can_grab_leads} onChange={e => setEditForm(p => ({ ...p, can_grab_leads: e.target.checked }))} />
                <span>Pode assumir leads de outros atendentes (sem aprovação)</span>
              </label>
              <p style={{ fontSize: 11, color: '#9B96B0', marginTop: 4, marginLeft: 24 }}>
                Quando tentar criar chat com telefone já cadastrado com outro atendente, aparece botão "Assumir lead" pra tomar direto. Sem essa permissão, só pode pedir transferência (que o atendente dono aprova).
              </p>
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

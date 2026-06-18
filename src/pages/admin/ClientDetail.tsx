import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { fetchAccount, createUser, updateUser, deleteUser, updateAccount, type Account, type User as UserType, type Funnel } from '../../lib/api'
import { ArrowLeft, UserPlus, Building2, Edit3, Trash2, UserCheck, UserX, Save, Check } from 'lucide-react'

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [account, setAccount] = useState<Account | null>(null)
  const [users, setUsers] = useState<UserType[]>([])
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewUser, setShowNewUser] = useState(false)
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: 'gerente' })
  const [editingUser, setEditingUser] = useState<UserType | null>(null)
  const [editForm, setEditForm] = useState({ name: '', email: '', password: '', role: 'gerente' })
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountSaved, setAccountSaved] = useState(false)

  const isAdmin = currentUser?.role === 'super_admin'

  const load = () => {
    if (!id) return
    setLoading(true)
    fetchAccount(+id).then(data => { setAccount(data.account); setUsers(data.users); setFunnels(data.funnels) }).finally(() => setLoading(false))
  }
  useEffect(load, [id])

  const handleCreateUser = async () => {
    if (!id || !newUser.name || !newUser.email || !newUser.password) return
    await createUser({ ...newUser, account_id: +id })
    setShowNewUser(false); setNewUser({ name: '', email: '', password: '', role: 'gerente' }); load()
  }

  const openEdit = (u: UserType) => {
    setEditingUser(u)
    setEditForm({ name: u.name, email: u.email, password: '', role: u.role })
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    const data: any = { name: editForm.name, email: editForm.email, role: editForm.role }
    if (editForm.password) data.password = editForm.password
    await updateUser(editingUser.id, data)
    setEditingUser(null); load()
  }

  const handleToggleActive = async (u: UserType) => {
    await updateUser(u.id, { is_active: u.is_active ? 0 : 1 })
    load()
  }

  const handleDelete = async (u: UserType) => {
    if (!confirm(`Excluir usuario "${u.name}"? Esta acao nao pode ser desfeita.`)) return
    await deleteUser(u.id)
    load()
  }

  if (loading) return <div className="loading-container"><div className="spinner" /></div>
  if (!account) return <div className="empty-state"><h3>Conta nao encontrada</h3></div>

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-secondary btn-icon" onClick={() => navigate('/admin/clients')}><ArrowLeft size={16} /></button>
          <div><h1><Building2 size={20} style={{ marginRight: 8 }} />{account.name}</h1><div style={{ fontSize: 12, color: '#9B96B0' }}>Slug: {account.slug}</div></div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNewUser(true)}><UserPlus size={14} /> Novo Usuario</button>
      </div>

      {/* Client Info */}
      <section className="dash-section">
        <div className="section-title" style={{ justifyContent: 'space-between' }}>
          <span>Dados do Cliente</span>
          <button className="btn btn-primary btn-sm" disabled={savingAccount} onClick={async () => {
            if (!account) return
            setSavingAccount(true)
            await updateAccount(account.id, account)
            setAccountSaved(true); setTimeout(() => setAccountSaved(false), 2000)
            setSavingAccount(false)
          }}>
            {accountSaved ? <><Check size={12} /> Salvo</> : <><Save size={12} /> Salvar</>}
          </button>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <div className="form-row">
            <div className="form-group"><label>Nome Fantasia</label><input className="input" value={account.name} onChange={e => setAccount({ ...account, name: e.target.value })} /></div>
            <div className="form-group"><label>CNPJ</label><input className="input" value={account.cnpj || ''} onChange={e => setAccount({ ...account, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Razao Social</label><input className="input" value={account.razao_social || ''} onChange={e => setAccount({ ...account, razao_social: e.target.value })} /></div>
            <div className="form-group"><label>Segmento</label><input className="input" value={account.segmento || ''} onChange={e => setAccount({ ...account, segmento: e.target.value })} placeholder="Ex: Imobiliaria" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Website</label><input className="input" value={account.website || ''} onChange={e => setAccount({ ...account, website: e.target.value })} placeholder="https://..." /></div>
            <div className="form-group"><label>Instagram</label><input className="input" value={account.instagram || ''} onChange={e => setAccount({ ...account, instagram: e.target.value })} placeholder="@perfil" /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>WhatsApp Comercial</label><input className="input" value={account.whatsapp_comercial || ''} onChange={e => setAccount({ ...account, whatsapp_comercial: e.target.value })} placeholder="5511999..." /></div>
            <div className="form-group"><label>Valor Mensal (R$)</label><input className="input" type="number" step="0.01" value={account.valor_mensal || ''} onChange={e => setAccount({ ...account, valor_mensal: parseFloat(e.target.value) || null })} /></div>
          </div>
          <div className="form-row">
            <div className="form-group"><label>Inicio Contrato</label><input className="input" type="date" value={account.contrato_inicio || ''} onChange={e => setAccount({ ...account, contrato_inicio: e.target.value })} /></div>
            <div className="form-group"><label>Cidade</label><input className="input" value={account.cidade || ''} onChange={e => setAccount({ ...account, cidade: e.target.value })} /></div>
            <div className="form-group"><label>Estado</label><input className="input" value={account.estado || ''} onChange={e => setAccount({ ...account, estado: e.target.value })} placeholder="SP" style={{ maxWidth: 80 }} /></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Trabalha com anuncio?</label>
              <select className="select" value={account.trabalha_anuncio || 0} onChange={e => setAccount({ ...account, trabalha_anuncio: parseInt(e.target.value) })}>
                <option value={0}>Nao</option>
                <option value={1}>Sim</option>
              </select>
            </div>
            <div className="form-group"><label>Investimento em Anuncios (R$)</label><input className="input" type="number" step="0.01" value={account.investimento_anuncios || ''} onChange={e => setAccount({ ...account, investimento_anuncios: parseFloat(e.target.value) || null })} placeholder="5000.00" /></div>
          </div>
          <div className="form-group"><label>Observacoes</label><textarea className="input" rows={3} value={account.observacoes || ''} onChange={e => setAccount({ ...account, observacoes: e.target.value })} style={{ resize: 'vertical' }} /></div>

          <div className="form-group" style={{ padding: 10, background: 'rgba(255,179,0,0.05)', border: '1px solid rgba(255,179,0,0.2)', borderRadius: 6, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={(account as any).ai_agents_enabled === 1}
                onChange={e => setAccount({ ...account, ai_agents_enabled: e.target.checked ? 1 : 0 } as any)}
              />
              <span><strong>🤖 Habilitar Agentes de IA</strong></span>
            </label>
            <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 2 }}>
              Libera o módulo "Agentes de IA" no painel do gerente desta conta. Permite cobrar separado se quiser.
            </small>
            {(account as any).ai_agents_enabled === 1 && (
              <div style={{ marginTop: 10, marginLeft: 24 }}>
                <label style={{ fontSize: 12, display: 'block' }}><strong>API Anthropic da conta</strong></label>
                <input className="input" type="password" placeholder="sk-ant-... (chave própria do cliente)" value={(account as any).anthropic_api_key || ''} onChange={e => setAccount({ ...account, anthropic_api_key: e.target.value } as any)} style={{ marginTop: 4 }} />
                <label style={{ fontSize: 12, display: 'block', marginTop: 8 }}><strong>Limite mensal de tokens</strong></label>
                <input className="input" type="number" min={0} step={10000} value={(account as any).analysis_token_limit ?? 200000} onChange={e => setAccount({ ...account, analysis_token_limit: Number(e.target.value) || 0 } as any)} style={{ marginTop: 4 }} />
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 4 }}>
                  Sem chave, a IA não funciona pra esta conta (sem fallback pra nossa). O cliente também pode preencher em Integrações.
                </small>
              </div>
            )}
          </div>

          <div className="form-group" style={{ padding: 10, background: 'rgba(93,173,226,0.05)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 6, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={(account as any).attendant_analytics_enabled === 1}
                onChange={e => setAccount({ ...account, attendant_analytics_enabled: e.target.checked ? 1 : 0 } as any)}
              />
              <span><strong>📊 Habilitar Análise de Atendimentos</strong></span>
            </label>
            <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block', marginTop: 2 }}>
              Libera o módulo "Atendimentos" no painel do gerente (rankings, TTFR/TMR, vendas perdidas, score IA).
              Quando ativo, a IA analisa as conversas todos os dias às 0h Brasília. Custo: ~$8-32/mês por conta dependendo do volume.
            </small>
          </div>
        </div>
      </section>

      <section className="dash-section">
        <div className="section-title">Usuarios ({users.length})</div>
        <div className="table-card"><table>
          <thead><tr><th>Nome</th><th>Email</th><th>Role</th><th>Status</th><th className="right">Acoes</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="name">{u.name}</td>
                <td>{u.email}</td>
                <td><span className="stage-badge" style={{ background: u.role === 'gerente' ? '#FFB30020' : '#5DADE220', color: u.role === 'gerente' ? '#FFB300' : '#5DADE2' }}>{u.role}</span></td>
                <td><span style={{ color: u.is_active ? '#34C759' : '#FF6B6B' }}>{u.is_active ? 'Ativo' : 'Inativo'}</span></td>
                <td className="right">
                  <div style={{ display: 'inline-flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => openEdit(u)} title="Editar"><Edit3 size={12} /></button>
                    <button className="btn btn-secondary btn-sm btn-icon" onClick={() => handleToggleActive(u)} title={u.is_active ? 'Desativar' : 'Ativar'}>
                      {u.is_active ? <UserX size={12} /> : <UserCheck size={12} />}
                    </button>
                    {isAdmin && <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(u)} title="Excluir"><Trash2 size={12} /></button>}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 30, color: '#6B6580' }}>Nenhum usuario</td></tr>}
          </tbody>
        </table></div>
      </section>

      <section className="dash-section">
        <div className="section-title">Funis ({funnels.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {funnels.map(f => (
            <div key={f.id} className="card">
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{f.name} {f.is_default ? <span style={{ fontSize: 10, color: '#FFB300' }}>PADRAO</span> : null}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {(f.stages || []).map(s => <span key={s.id} className="stage-badge" style={{ background: `${s.color}20`, color: s.color }}>{s.name}</span>)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {showNewUser && (
        <div className="modal-overlay" onClick={() => setShowNewUser(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Novo Usuario — {account.name}</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={newUser.name} onChange={e => setNewUser(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Senha</label><input className="input" type="password" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} /></div>
            <div className="form-group"><label>Role</label>
              <select className="select" value={newUser.role} onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                <option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewUser(false)}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreateUser}>Criar</button>
            </div>
          </div>
        </div>
      )}

      {editingUser && (
        <div className="modal-overlay" onClick={() => setEditingUser(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Editar Usuario</h2>
            <div className="form-group"><label>Nome</label><input className="input" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label>Email</label><input className="input" type="email" value={editForm.email} onChange={e => setEditForm(p => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label>Nova senha (deixe em branco para manter)</label><input className="input" type="password" value={editForm.password} onChange={e => setEditForm(p => ({ ...p, password: e.target.value }))} placeholder="••••••••" /></div>
            <div className="form-group"><label>Role</label>
              <select className="select" value={editForm.role} onChange={e => setEditForm(p => ({ ...p, role: e.target.value }))}>
                <option value="gerente">Gerente</option><option value="atendente">Atendente</option>
              </select>
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

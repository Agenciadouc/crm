import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import { apiFetch, fetchTaskCounts, fetchPendingTransferRequests } from '../lib/api'
import {
  LayoutDashboard, Kanban, Users, MessageCircle, UserCog, GitBranch,
  Plug, Settings, Building2, LogOut, UsersRound, Menu, X,
  ListOrdered, MessageSquarePlus, ClipboardList, Rocket, ListTodo, ExternalLink, Tag as TagIcon, FileText, ArrowRightLeft,
} from 'lucide-react'

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { accountId, accounts, setAccountId } = useAccount()
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [transferCount, setTransferCount] = useState(0)

  const loadTaskCount = useCallback(() => {
    if (!accountId) return
    fetchTaskCounts(accountId).then(c => setTaskCount(c.overdue + c.today)).catch(() => {})
  }, [accountId])
  useEffect(() => { loadTaskCount() }, [loadTaskCount])
  useSSE('task:updated', loadTaskCount)
  useSSE('task:due', loadTaskCount)

  const loadTransferCount = useCallback(() => {
    fetchPendingTransferRequests().then(r => setTransferCount((r.requests || []).length)).catch(() => {})
  }, [])
  useEffect(() => { loadTransferCount() }, [loadTransferCount])
  useSSE('lead:transfer-requested', loadTransferCount)
  useSSE('lead:transfer-accepted', loadTransferCount)
  useSSE('lead:transfer-rejected', loadTransferCount)
  const [mobileOpen, setMobileOpen] = useState(false)
  if (!user) return null

  const isAdmin = user.role === 'super_admin'
  const isGerente = user.role === 'gerente'

  // Fetch new leads count (unassigned)
  useEffect(() => {
    if (!accountId) return
    apiFetch(`/api/dashboard/stats?account_id=${accountId}&days=1`)
      .then((data: any) => setNewLeadsCount(data.leadsToday || 0))
      .catch(() => {})
  }, [accountId])

  // Listen for new leads via SSE
  useSSE('lead:created', () => setNewLeadsCount(prev => prev + 1))

  const closeMobile = () => setMobileOpen(false)

  return (
    <>
      {/* Mobile hamburger */}
      <button className="hamburger-btn" onClick={() => setMobileOpen(true)}>
        <Menu size={20} />
      </button>

      {/* Overlay */}
      {mobileOpen && <div className="sidebar-overlay" onClick={closeMobile} />}

      <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <img src="https://drosagencia.com.br/wp-content/uploads/2025/12/DROS-LOGO-1-1024x1024.png" alt="Dros" className="sidebar-logo" />
              <div className="sidebar-subtitle">CRM</div>
            </div>
            <button className="sidebar-close-btn" onClick={closeMobile}><X size={18} /></button>
          </div>
        </div>

        {isAdmin && accounts.length > 0 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <label style={{ fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Visualizando conta</label>
            <select className="select" value={accountId || ''} onChange={e => setAccountId(Number(e.target.value))} style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <nav className="sidebar-nav">
          {isAdmin && (
            <>
              <div className="nav-section">Admin</div>
              <NavLink to="/admin/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <LayoutDashboard size={16} /> Dashboard Global
              </NavLink>
              <NavLink to="/admin/clients" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <Building2 size={16} /> Clientes
              </NavLink>
              <NavLink to="/admin/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <UsersRound size={16} /> Usuarios
              </NavLink>
              <NavLink to="/admin/propostas" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <FileText size={16} /> Propostas
              </NavLink>
            </>
          )}

          {!isAdmin && (user as any).can_manage_proposals === 1 && (
            <>
              <div className="nav-section">Comercial</div>
              <NavLink to="/admin/propostas" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <FileText size={16} /> Propostas
              </NavLink>
            </>
          )}

          {(isGerente || isAdmin) && <div className="nav-section">Gestao</div>}
          {(isGerente || isAdmin) && (
            <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
              <LayoutDashboard size={16} /> Dashboard
            </NavLink>
          )}
          <NavLink to="/chat" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
            <MessageCircle size={16} /> Chat
          </NavLink>
          <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
            <ListTodo size={16} /> Tarefas
            {taskCount > 0 && <span className="nav-badge" style={{ background: '#FF6B6B' }}>{taskCount > 99 ? '99+' : taskCount}</span>}
          </NavLink>
          <NavLink to="/pipeline" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
            <Kanban size={16} /> Pipeline
            {newLeadsCount > 0 && <span className="nav-badge">{newLeadsCount > 99 ? '99+' : newLeadsCount}</span>}
          </NavLink>
          <NavLink to="/leads" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
            <Users size={16} /> Leads
          </NavLink>
          <NavLink to="/transferencias" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
            <ArrowRightLeft size={16} /> Transferencias
            {transferCount > 0 && <span className="nav-badge" style={{ background: '#FF6B6B' }}>{transferCount > 99 ? '99+' : transferCount}</span>}
          </NavLink>

          {(isGerente || isAdmin) && (
            <>
              <div className="nav-section">Configuracoes</div>
              <NavLink to="/messages" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><MessageCircle size={16} /> Disparos</NavLink>
              <NavLink to="/team" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><UserCog size={16} /> Equipe</NavLink>
              <NavLink to="/funnels" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><GitBranch size={16} /> Funis</NavLink>
              <NavLink to="/tags" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><TagIcon size={16} /> Tags</NavLink>
              <NavLink to="/integrations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Plug size={16} /> Integracoes</NavLink>
              <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Settings size={16} /> Configuracoes</NavLink>
              <div className="nav-section">Automacao</div>
              <NavLink to="/cadences" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><ListOrdered size={16} /> Cadencias</NavLink>
              <NavLink to="/ready-messages" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><MessageSquarePlus size={16} /> Msgs Prontas</NavLink>
              <NavLink to="/qualifications" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><ClipboardList size={16} /> Qualificacao</NavLink>
              <NavLink to="/launches" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Rocket size={16} /> Lancamentos</NavLink>
              <div className="nav-section">Sistemas</div>
              <a href="/hub/" target="_blank" rel="noopener noreferrer" className="nav-item" style={{ textDecoration: 'none' }} onClick={closeMobile}><ExternalLink size={16} /> HUB</a>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div>
            <div className="sidebar-user">{user.name}</div>
            <div className="sidebar-role">{user.role === 'super_admin' ? 'Admin' : user.role === 'gerente' ? 'Gerente' : 'Atendente'}</div>
          </div>
          <button className="logout-btn" onClick={logout} title="Sair"><LogOut size={16} /></button>
        </div>
      </aside>
    </>
  )
}

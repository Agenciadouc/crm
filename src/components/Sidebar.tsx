import { useState, useEffect, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { useSSE } from '../context/SSEContext'
import { useTheme } from '../context/ThemeContext'
import { apiFetch, fetchTaskCounts, fetchPendingTransferRequests, fetchAlerts } from '../lib/api'
import {
  LayoutDashboard, Kanban, Users, MessageCircle, UserCog, GitBranch,
  Plug, Settings, Building2, LogOut, UsersRound, Menu, X,
  ListOrdered, MessageSquarePlus, ClipboardList, Rocket, ListTodo, ExternalLink, Tag as TagIcon, FileText, FileSignature, ArrowRightLeft, Zap, Bot, Sun, Moon, BarChart3,
} from 'lucide-react'

function getInitials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const { accountId, accounts, setAccountId } = useAccount()
  const { theme, setTheme } = useTheme()
  const [newLeadsCount, setNewLeadsCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [transferCount, setTransferCount] = useState(0)
  const [alertsCount, setAlertsCount] = useState(0)

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

  // Alertas V2 — polling a cada 60s, só pra contas com flag ou super_admin.
  const loadAlertsCount = useCallback(() => {
    if (!accountId || !user) return
    const acc = accounts.find(a => a.id === accountId)
    const hasFlag = acc?.attendant_analytics_enabled === 1
    if (!hasFlag && user.role !== 'super_admin') { setAlertsCount(0); return }
    fetchAlerts(accountId, 'open').then(arr => setAlertsCount(arr.length)).catch(() => setAlertsCount(0))
  }, [accountId, accounts, user])
  useEffect(() => {
    loadAlertsCount()
    const id = setInterval(loadAlertsCount, 60000)
    return () => clearInterval(id)
  }, [loadAlertsCount])
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
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <label style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 4 }}>Visualizando conta</label>
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
              <NavLink to="/contratos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                <FileSignature size={16} /> Contratos
              </NavLink>
            </>
          )}

          {!isAdmin && ((user as any).can_manage_proposals === 1 || (user as any).can_manage_contracts === 1) && (
            <>
              <div className="nav-section">Comercial</div>
              {(user as any).can_manage_proposals === 1 && (
                <NavLink to="/admin/propostas" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                  <FileText size={16} /> Propostas
                </NavLink>
              )}
              {(user as any).can_manage_contracts === 1 && (
                <NavLink to="/contratos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
                  <FileSignature size={16} /> Contratos
                </NavLink>
              )}
            </>
          )}

          {(isGerente || isAdmin) && <div className="nav-section">Gestao</div>}
          {(isGerente || isAdmin) && (
            <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
              <LayoutDashboard size={16} /> Dashboard
            </NavLink>
          )}
          {/* "/atendimentos" só pra contas com feature flag ativada. Super_admin sempre vê (auditoria). */}
          {((isGerente && accounts.find(a => a.id === accountId)?.attendant_analytics_enabled === 1) || isAdmin) && (
            <NavLink to="/atendimentos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}>
              <BarChart3 size={16} /> Atendimentos
              {alertsCount > 0 && (
                <span style={{ marginLeft: 'auto', background: 'var(--negative)', color: 'white', fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 700 }}>
                  {alertsCount}
                </span>
              )}
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

          {/* Integracoes: tambem visivel pra atendente (UI da pagina restringe o que ele edita) */}
          {!isGerente && !isAdmin && (
            <NavLink to="/integrations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Plug size={16} /> Integracoes</NavLink>
          )}

          {/* Tags: visivel pra atendente tb (pagina restringe edicao se necessario) */}
          {!isGerente && !isAdmin && (
            <NavLink to="/tags" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><TagIcon size={16} /> Tags</NavLink>
          )}

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
              <NavLink to="/follow-ups" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Zap size={16} /> Follow-ups</NavLink>
              {(isAdmin || (user as any)?.account_ai_agents_enabled === 1) && (
                <NavLink to="/agents" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Bot size={16} /> Agentes de IA</NavLink>
              )}
              <NavLink to="/ready-messages" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><MessageSquarePlus size={16} /> Msgs Prontas</NavLink>
              <NavLink to="/qualifications" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><ClipboardList size={16} /> Qualificacao</NavLink>
              <NavLink to="/launches" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={closeMobile}><Rocket size={16} /> Lancamentos</NavLink>
              <div className="nav-section">Sistemas</div>
              <a href="/hub/" target="_blank" rel="noopener noreferrer" className="nav-item" style={{ textDecoration: 'none' }} onClick={closeMobile}><ExternalLink size={16} /> HUB</a>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="theme-toggle" role="tablist" aria-label="Alternar tema">
            <button
              type="button"
              role="tab"
              aria-selected={theme === 'light'}
              className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
              title="Tema claro"
            >
              <Sun size={13} /> Claro
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={theme === 'dark'}
              className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
              title="Tema escuro"
            >
              <Moon size={13} /> Escuro
            </button>
          </div>
          <div className="sidebar-user-row">
            <div className="sidebar-avatar" aria-hidden="true">{getInitials(user.name)}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user">{user.name}</div>
              <div className="sidebar-role">{user.role === 'super_admin' ? 'Admin' : user.role === 'gerente' ? 'Gerente' : 'Atendente'}</div>
            </div>
            <button className="logout-btn" onClick={logout} title="Sair"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
    </>
  )
}

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { AccountProvider } from './context/AccountContext'
import { SSEProvider } from './context/SSEContext'
import { ThemeProvider } from './context/ThemeContext'
import Sidebar from './components/Sidebar'
import DisconnectedInstancesAlert from './components/DisconnectedInstancesAlert'
import ReleaseNotesModal from './components/ReleaseNotesModal'
import SystemNoticeBanner from './components/SystemNoticeBanner'
import ScoreToasts from './components/score/ScoreToasts'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Projecao from './pages/Projecao'
import AttendantAnalytics from './pages/AttendantAnalytics'
import Pipeline from './pages/Pipeline'
import Leads from './pages/Leads'
import LeadDetail from './pages/LeadDetail'
import Chat from './pages/Chat'
import Tasks from './pages/Tasks'
import Messages from './pages/Messages'
import BroadcastDetail from './pages/BroadcastDetail'
import Team from './pages/Team'
import Funnels from './pages/Funnels'
import Integrations from './pages/Integrations'
import SettingsPage from './pages/Settings'
import GlobalTemplates from './pages/GlobalTemplates'
import CadencesAndFollowUps from './pages/CadencesAndFollowUps'
import { AUTOMATION_PATH, legacyAutomationRedirect } from './lib/automationTabs'
import Agents from './pages/Agents'
import ReadyMessages from './pages/ReadyMessages'
import Launches from './pages/Launches'
import Tags from './pages/Tags'
import AdminClients from './pages/admin/Clients'
import AdminClientDetail from './pages/admin/ClientDetail'
import AdminGlobalDashboard from './pages/admin/GlobalDashboard'
import AdminUsers from './pages/admin/Users'
import Propostas from './pages/Propostas'
import Contratos from './pages/Contratos'
import TransferRequests from './pages/TransferRequests'
import AgentInterview from './pages/AgentInterview'
import AgentBriefingSummary from './pages/AgentBriefingSummary'

// Fix global: impede modal de fechar quando user arrasta seleção de texto
// de dentro do input pra fora do modal (mousedown dentro, mouseup no overlay)
// /cadences e /follow-ups viraram abas de uma tela so; links antigos caem na aba certa.
function LegacyAutomationRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={legacyAutomationRedirect(pathname, search)} replace />
}

function useModalDragFix() {
  useEffect(() => {
    let mousedownInsideModal = false
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      mousedownInsideModal = !!target?.closest?.('.modal')
    }
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (mousedownInsideModal && target?.classList?.contains('modal-overlay')) {
        e.stopPropagation()
      }
      mousedownInsideModal = false
    }
    document.addEventListener('mousedown', onMouseDown, true)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [])
}

function AppRoutes() {
  const { user, loading } = useAuth()
  useModalDragFix()

  if (loading) return <div className="loading-container"><div className="spinner" /><span>Carregando...</span></div>
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>

  const isAdmin = user.role === 'super_admin'
  const isGerente = user.role === 'gerente'
  const canManageProposals = isAdmin || (user as any).can_manage_proposals === 1
  const canManageContracts = isAdmin || (user as any).can_manage_contracts === 1
  const homeRoute = isAdmin ? '/admin/dashboard' : isGerente ? '/dashboard' : '/pipeline'

  return (
    <AccountProvider>
    <SSEProvider>
    <SystemNoticeBanner />
    <ScoreToasts />
    <DisconnectedInstancesAlert />
    <ReleaseNotesModal />
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/login" element={<Navigate to={homeRoute} />} />
          <Route path="/" element={<Navigate to={homeRoute} />} />

          {/* Admin routes */}
          {isAdmin && <>
            <Route path="/admin/dashboard" element={<AdminGlobalDashboard />} />
            <Route path="/admin/clients" element={<AdminClients />} />
            <Route path="/admin/clients/:id" element={<AdminClientDetail />} />
            <Route path="/admin/users" element={<AdminUsers />} />
            <Route path="/global-templates" element={<GlobalTemplates />} />
          </>}
          {canManageProposals && <Route path="/admin/propostas" element={<Propostas />} />}
          {canManageContracts && <Route path="/contratos" element={<Contratos />} />}

          {/* Gerente + Admin routes */}
          {(isGerente || isAdmin) && <>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/projecao" element={<Projecao />} />
            <Route path="/atendimentos" element={<AttendantAnalytics />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:id" element={<BroadcastDetail />} />
            <Route path="/team" element={<Team />} />
            <Route path="/funnels" element={<Funnels />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path={AUTOMATION_PATH} element={<CadencesAndFollowUps />} />
            <Route path="/cadences" element={<LegacyAutomationRedirect />} />
            <Route path="/follow-ups" element={<LegacyAutomationRedirect />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/agents/interview" element={<AgentInterview />} />
            <Route path="/agents/interview/:briefingId" element={<AgentInterview />} />
            <Route path="/agents/resumo/:briefingId" element={<AgentBriefingSummary />} />
            <Route path="/ready-messages" element={<ReadyMessages />} />
            <Route path="/qualifications" element={<LegacyAutomationRedirect />} />
            <Route path="/launches" element={<Launches />} />
          </>}

          {/* All authenticated users */}
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/pipeline" element={<Pipeline />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/leads" element={<Leads />} />
          <Route path="/leads/:id" element={<LeadDetail />} />
          <Route path="/transferencias" element={<TransferRequests />} />

          <Route path="*" element={<Navigate to={homeRoute} />} />
        </Routes>
      </main>
    </div>
    </SSEProvider>
    </AccountProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

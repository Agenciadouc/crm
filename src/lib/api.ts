const getToken = () => localStorage.getItem('dros_crm_token')
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? `${BASE}${path}` : path
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...opts.headers },
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `API error: ${res.status}`) }
  return res.json()
}

export function formatBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
export function formatNumber(n: number) { return n.toLocaleString('pt-BR') }
export function pctChange(c: number, p: number) { if (p === 0) return c > 0 ? 100 : null; return ((c - p) / p) * 100 }

// =============================================
// Types
// =============================================

export interface Account { id: number; name: string; slug: string; logo_url: string | null; is_active: number; created_at: string; lead_count?: number; user_count?: number; cnpj?: string | null; razao_social?: string | null; segmento?: string | null; website?: string | null; instagram?: string | null; whatsapp_comercial?: string | null; valor_mensal?: number | null; contrato_inicio?: string | null; cidade?: string | null; estado?: string | null; observacoes?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null; meta_pixel_id?: string | null; meta_capi_token?: string | null; meta_capi_test_event_code?: string | null; meta_capi_enabled?: number; ai_agents_enabled?: number }
export interface User { id: number; account_id: number | null; account_name?: string | null; name: string; email: string; role: string; is_active: number; is_bot?: number; primary_instance_id?: number | null; can_manage_proposals?: number; can_manage_contracts?: number; can_grab_leads?: number; created_at: string }
export interface FunnelStage { id: number; funnel_id: number; name: string; position: number; color: string; is_conversion: number; is_terminal: number; auto_keywords: string | null; meta_event_name?: string | null }
export interface Funnel { id: number; account_id: number; name: string; is_default: number; is_active: number; stages: FunnelStage[] }
export interface Tag { id: number; account_id: number; name: string; color: string }
export interface Lead {
  id: number; account_id: number; funnel_id: number; stage_id: number; attendant_id: number | null
  name: string | null; phone: string | null; email: string | null; city: string | null
  source: string | null; source_detail: string | null; notes: string | null
  wa_remote_jid: string | null; instance_id: number | null; last_instance_id?: number | null; profile_pic_url: string | null; is_active: number; created_at: string; updated_at: string
  is_archived?: number; archived_at?: string | null; has_new_after_archive?: number
  empresa?: string | null; cpf_cnpj?: string | null; instagram?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null
  opted_in_at?: string | null; opted_out_at?: string | null; last_broadcast_at?: string | null
  state?: string | null; zip?: string | null; birthdate?: string | null; gender?: string | null
  ctwa_clid?: string | null; fbp?: string | null; fbc?: string | null
  meta_ad_id?: string | null; meta_campaign_id?: string | null; meta_form_id?: string | null; lead_form_lead_id?: string | null
  client_ip_address?: string | null; client_user_agent?: string | null
  stage_name?: string; stage_color?: string; attendant_name?: string; instance_name?: string
  last_message?: string; message_count?: number; tags?: Tag[]
}
export interface Message { id: number; lead_id: number; direction: 'inbound' | 'outbound'; content: string | null; media_type: string; media_url: string | null; sender_name: string | null; wa_msg_id: string | null; instance_id?: number | null; created_at: string }
export const fetchMessageMedia = (leadId: number, msgId: number) => apiFetch<{ dataUrl: string; mime: string; type: string }>(`/api/messages/${leadId}/media/${msgId}`)
export interface StageHistoryEntry { id: number; lead_id: number; from_stage_name: string | null; to_stage_name: string; trigger_type: string; user_name: string | null; created_at: string }
export interface LeadNote { id: number; lead_id: number; user_id: number; content: string; user_name: string; created_at: string }
export interface PipelineMetric { stage_id: number; name: string; color: string; position: number; is_conversion: number; lead_count: number; avg_hours_in_stage: number | null; pct_of_total: number; conversion_from_prev: number | null }
export interface DashboardStats {
  totalLeads: number; prevTotalLeads: number; leadsToday: number; conversionRate: number; unassigned: number
  byStage: { id: number; name: string; color: string; position: number; count: number; is_conversion: number }[]
  bySource: { source: string; count: number }[]
  daily: { date: string; count: number }[]
}
export interface AgentStat { id: number; name: string; is_active: number; leads_period: number; leads_total: number; conversions: number }
export interface WhatsAppInstance { id: number; account_id: number; instance_name: string; api_url: string; api_key: string; status: string; phone_number: string | null; qr_code: string | null; default_attendant_id: number | null; lead_intake_mode?: 'open' | 'restricted' }
export interface Broadcast {
  id: number; account_id?: number; name: string; message_template: string; message_variations?: string | null
  status: string; sent_count: number; failed_count: number; total_count: number
  delay_seconds?: number; instance_id?: number | null; instance_name?: string | null; instance_status?: string | null
  paused_at?: string | null; paused_reason?: string | null
  scheduled_at?: string | null
  started_at?: string | null; completed_at?: string | null; created_at: string; created_by_name?: string | null
}
export interface BroadcastRecipient {
  id: number; broadcast_id: number; lead_id: number; phone: string
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  wa_msg_id?: string | null; sent_at?: string | null; error?: string | null
  lead_name?: string | null
}

// =============================================
// API Functions
// =============================================

// Auth
export const login = (email: string, password: string) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

// Accounts
export const fetchAccounts = () => apiFetch<{ accounts: Account[] }>('/api/accounts').then(d => d.accounts)
export const createAccount = (data: Partial<Account> & { name: string }) => apiFetch<{ account: Account }>('/api/accounts', { method: 'POST', body: JSON.stringify(data) }).then(d => d.account)
export const updateAccount = (id: number, data: Partial<Account>) => apiFetch<{ account: Account }>(`/api/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.account)
export const testMetaCapi = (id: number) => apiFetch<{ ok: boolean; error?: string; response?: any }>(`/api/accounts/${id}/test-meta-capi`, { method: 'POST' })
export const updateMetaCapi = (id: number, data: { meta_pixel_id?: string | null; meta_capi_token?: string | null; meta_capi_enabled?: number }) => apiFetch<{ account: Account }>(`/api/accounts/${id}/meta-capi`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.account)
export const fetchAccount = (id: number) => apiFetch<{ account: Account; users: User[]; funnels: Funnel[] }>(`/api/accounts/${id}`)

// Users
export const fetchUsers = (accountId?: number) => apiFetch<{ users: User[] }>(`/api/users${accountId ? `?account_id=${accountId}` : ''}`).then(d => d.users)
export const createUser = (data: { name: string; email: string; password: string; role: string; account_id?: number }) => apiFetch<{ user: User }>('/api/users', { method: 'POST', body: JSON.stringify(data) }).then(d => d.user)
export const updateUser = (id: number, data: Partial<User & { password?: string }>) => apiFetch(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteUser = (id: number) => apiFetch(`/api/users/${id}`, { method: 'DELETE' })

// Funnels
export const fetchFunnels = (accountId: number) => apiFetch<{ funnels: Funnel[] }>(`/api/funnels?account_id=${accountId}`).then(d => d.funnels)
export const createFunnel = (accountId: number, data: { name: string; stages: Partial<FunnelStage>[] }) => apiFetch<{ funnel: Funnel }>(`/api/funnels?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.funnel)
export const fetchFunnel = (id: number, accountId: number) => apiFetch<{ funnel: Funnel }>(`/api/funnels/${id}?account_id=${accountId}`).then(d => d.funnel)
export const updateFunnelStages = (id: number, accountId: number, stages: Partial<FunnelStage>[]) => apiFetch(`/api/funnels/${id}/stages?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ stages }) })

// Leads
export interface LeadFilters { stage_id?: number | string; attendant_id?: number | string; instance_id?: number | string; funnel_id?: number; source?: string; city?: string; tag?: number | string; search?: string; date_from?: string; date_to?: string; show_archived?: '1' | 'all'; page?: number; limit?: number }
export const fetchLeads = (accountId: number, filters: LeadFilters = {}) => {
  const params = new URLSearchParams({ account_id: String(accountId) })
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') params.set(k, String(v)) })
  return apiFetch<{ leads: Lead[]; total: number; page: number; totalPages: number }>(`/api/leads?${params}`)
}
export const fetchLead = (id: number, accountId: number) => apiFetch<{ lead: Lead; messages: Message[]; stageHistory: StageHistoryEntry[]; notes: LeadNote[] }>(`/api/leads/${id}?account_id=${accountId}`)
export const createLead = (accountId: number, data: Partial<Lead>) => apiFetch<{ lead: Lead }>(`/api/leads?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.lead)
export async function createLeadOrFindExisting(accountId: number, data: Partial<Lead>): Promise<{ lead: Lead; alreadyExisted: boolean }> {
  const url = `${BASE}/api/leads?account_id=${accountId}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    if (body.existing) return { lead: body.existing as Lead, alreadyExisted: true }
    // Lead pertence a outro atendente da mesma empresa — atendente atual nao pode acessar
    const err: any = new Error(body.error || 'Contato ja existe')
    err.otherAttendant = !!body.otherAttendant
    err.ownerName = body.ownerName || null
    err.leadId = body.leadId || null
    throw err
  }
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `API error: ${res.status}`) }
  const body = await res.json()
  return { lead: body.lead as Lead, alreadyExisted: false }
}
export const updateLead = (id: number, data: Partial<Lead>) => apiFetch(`/api/leads/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const optInLead = (id: number) => apiFetch(`/api/leads/${id}/opt-in`, { method: 'POST' })
export const optOutLead = (id: number) => apiFetch(`/api/leads/${id}/opt-out`, { method: 'POST' })
export const moveLeadStage = (id: number, stageId: number) => apiFetch(`/api/leads/${id}/stage`, { method: 'PUT', body: JSON.stringify({ stage_id: stageId }) })
export const assignLead = (id: number, attendantId: number | null) => apiFetch(`/api/leads/${id}/assign`, { method: 'PUT', body: JSON.stringify({ attendant_id: attendantId }) })
export const refreshProfilePic = (id: number) => apiFetch<{ profile_pic_url: string | null }>(`/api/leads/${id}/refresh-profile-pic`, { method: 'POST' })
export const archiveLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/archive`, { method: 'PATCH' }).then(d => d.lead)
export const unarchiveLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/unarchive`, { method: 'PATCH' }).then(d => d.lead)
export const blockLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/block`, { method: 'POST' }).then(d => d.lead)
export const unblockLead = (id: number) => apiFetch<{ lead: Lead }>(`/api/leads/${id}/unblock`, { method: 'POST' }).then(d => d.lead)
export const fetchArchivedCount = (accountId: number) => apiFetch<{ count: number; withActivity: number }>(`/api/leads/archived-count?account_id=${accountId}`)
export interface LeadConversation { instance_id: number; instance_name: string; status: string; attendant_id: number | null; attendant_name: string | null; msg_count: number; last_msg_at: string | null }
export const fetchLeadConversations = (leadId: number, accountId: number) => apiFetch<{ conversations: LeadConversation[] }>(`/api/leads/${leadId}/conversations?account_id=${accountId}`).then(d => d.conversations)

// Messages
export const fetchMessages = (leadId: number, accountId: number) => apiFetch<{ messages: Message[] }>(`/api/messages/${leadId}?account_id=${accountId}`).then(d => d.messages)
export interface SendResult { message: Message; delivered: boolean; error?: string }
export const sendMessage = (leadId: number, accountId: number, content: string, instance_id?: number) => apiFetch<SendResult>(`/api/messages/${leadId}?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ content, instance_id }) })
export const sendMessageMedia = (leadId: number, accountId: number, payload: { base64: string; mime: string; file_name: string; caption?: string; instance_id?: number }) => apiFetch<SendResult>(`/api/messages/${leadId}/media?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(payload) })

// Proposals
export interface Proposal {
  id: number; slug: string; client_name: string;
  phone: string | null; segmento: string | null;
  has_production: number;
  num_videos: number; num_images: number;
  valor: number; contrato_meses: number;
  observacoes: string | null;
  has_comissao: number; comissao_percent: number;
  created_by: number | null; created_by_name?: string;
  created_at: string; updated_at: string;
}
export interface ProposalInput {
  client_name: string; phone?: string; segmento?: string;
  has_production: boolean;
  num_videos?: number; num_images?: number;
  valor: number; contrato_meses: number;
  observacoes?: string;
  has_comissao?: boolean; comissao_percent?: number;
}
export const fetchProposals = () => apiFetch<{ proposals: Proposal[] }>('/api/proposals').then(d => d.proposals)
export const createProposal = (data: ProposalInput) => apiFetch<{ proposal: Proposal }>('/api/proposals', { method: 'POST', body: JSON.stringify(data) }).then(d => d.proposal)
export const updateProposal = (id: number, data: Partial<ProposalInput>) => apiFetch<{ proposal: Proposal }>(`/api/proposals/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.proposal)
export const deleteProposal = (id: number) => apiFetch(`/api/proposals/${id}`, { method: 'DELETE' })

// Contracts
export interface Contract {
  id: number; numero: string;
  razao_social: string; cnpj: string; inscricao_estadual: string | null;
  endereco_logradouro: string; endereco_bairro: string; endereco_cep: string;
  endereco_cidade: string; endereco_estado: string;
  fee_mensal: number; comissao_percent: number;
  vigencia_meses: number; data_inicio: string; data_fim: string;
  renovacao_meses: number; aviso_previo_dias: number; reajuste_indice: string;
  frente_diagnostico: number; frente_estruturacao: number; frente_aquisicao: number; frente_editorial: number;
  exclusoes_extras: string | null;
  videos_por_mes: number; imagens_por_mes: number;
  fat_mes1_ref: string | null; fat_mes1_valor: number | null;
  fat_mes2_ref: string | null; fat_mes2_valor: number | null;
  fat_mes3_ref: string | null; fat_mes3_valor: number | null;
  fat_base: number | null;
  local_assinatura: string; data_assinatura: string;
  created_by: number | null; created_by_name?: string;
  created_at: string; updated_at: string;
}
export interface ContractInput {
  razao_social: string; cnpj: string; inscricao_estadual?: string;
  endereco_logradouro: string; endereco_bairro: string; endereco_cep: string;
  endereco_cidade: string; endereco_estado: string;
  fee_mensal: number; comissao_percent: number;
  vigencia_meses: number; data_inicio: string; data_fim?: string;
  renovacao_meses: number; aviso_previo_dias: number; reajuste_indice: string;
  frente_diagnostico: boolean; frente_estruturacao: boolean; frente_aquisicao: boolean; frente_editorial: boolean;
  exclusoes_extras?: string;
  videos_por_mes?: number; imagens_por_mes?: number;
  fat_mes1_ref?: string; fat_mes1_valor?: number | null;
  fat_mes2_ref?: string; fat_mes2_valor?: number | null;
  fat_mes3_ref?: string; fat_mes3_valor?: number | null;
  local_assinatura: string; data_assinatura: string;
}
export const fetchContracts = () => apiFetch<{ contracts: Contract[] }>('/api/contracts').then(d => d.contracts)
export const createContract = (data: ContractInput) => apiFetch<{ contract: Contract }>('/api/contracts', { method: 'POST', body: JSON.stringify(data) }).then(d => d.contract)
export const updateContract = (id: number, data: Partial<ContractInput>) => apiFetch<{ contract: Contract }>(`/api/contracts/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.contract)
export const deleteContract = (id: number) => apiFetch(`/api/contracts/${id}`, { method: 'DELETE' })

// Dashboard
export const fetchDashboardStats = (accountId: number, days = 7) => apiFetch<DashboardStats>(`/api/dashboard/stats?account_id=${accountId}&days=${days}`)
export const fetchAgentStats = (accountId: number, days = 7) => apiFetch<{ agents: AgentStat[] }>(`/api/dashboard/agents?account_id=${accountId}&days=${days}`).then(d => d.agents)
export const fetchGlobalDashboard = () => apiFetch<{ accounts: any[]; totalLeads: number; leadsToday: number }>('/api/dashboard/global')

// Integrations
export interface EvolutionConfig { api_url: string; api_key: string }
export const fetchEvolutionConfig = (accountId: number) => apiFetch<EvolutionConfig>(`/api/integrations/evolution-config?account_id=${accountId}`)
export const saveEvolutionConfig = (accountId: number, data: EvolutionConfig) => apiFetch(`/api/integrations/evolution-config?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })

export const fetchWhatsAppInstances = (accountId: number) => apiFetch<{ instances: WhatsAppInstance[] }>(`/api/integrations/whatsapp?account_id=${accountId}`).then(d => d.instances)
export const createWhatsAppInstance = (accountId: number, data: { instance_name: string; lead_intake_mode?: 'open' | 'restricted' }) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.instance)
export const connectWhatsAppInstance = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/connect?account_id=${accountId}`, { method: 'POST' }).then(d => d.instance)
export const checkWhatsAppStatus = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance; state: string }>(`/api/integrations/whatsapp/${id}/status?account_id=${accountId}`)
export const refreshWhatsAppQR = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/qrcode?account_id=${accountId}`, { method: 'POST' }).then(d => d.instance)
export const disconnectWhatsApp = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}/disconnect?account_id=${accountId}`, { method: 'POST' })
export const deleteWhatsAppInstance = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const setupWhatsAppWebhook = (id: number, accountId: number) => apiFetch<{ ok: boolean; webhookUrl: string }>(`/api/integrations/whatsapp/${id}/setup-webhook?account_id=${accountId}`, { method: 'POST' })
export const restartWhatsAppInstance = (id: number, accountId: number) => apiFetch<{ ok: boolean }>(`/api/integrations/whatsapp/${id}/restart?account_id=${accountId}`, { method: 'POST' })
export const setInstanceAttendant = (id: number, accountId: number, attendantId: number | null) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/attendant?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ attendant_id: attendantId }) })
export const setInstanceMode = (id: number, accountId: number, mode: 'open' | 'restricted') => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/mode?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ mode }) })
export const syncWhatsAppNow = (accountId: number) => apiFetch<{ ok: boolean }>(`/api/integrations/whatsapp/sync-now?account_id=${accountId}`, { method: 'POST' })
export const testWhatsAppConnection = (id: number, accountId: number) => apiFetch<{ success: boolean; status: string }>(`/api/integrations/whatsapp/${id}/test?account_id=${accountId}`, { method: 'POST' })

// Broadcasts
export const fetchBroadcasts = (accountId: number) => apiFetch<{ broadcasts: Broadcast[] }>(`/api/broadcasts?account_id=${accountId}`).then(d => d.broadcasts)
export const fetchBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast; recipients: BroadcastRecipient[] }>(`/api/broadcasts/${id}?account_id=${accountId}`)
export const createBroadcast = (accountId: number, data: { name: string; message_template: string; message_variations?: string[]; delay_seconds?: number; lead_ids: number[]; instance_id: number; scheduled_at?: string | null }) => apiFetch(`/api/broadcasts?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) })
export const sendBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}/send?account_id=${accountId}`, { method: 'POST' })
export const resumeBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}/resume?account_id=${accountId}`, { method: 'POST' })
export const cancelScheduledBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast }>(`/api/broadcasts/${id}/cancel-schedule?account_id=${accountId}`, { method: 'POST' })
export const deleteBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}?account_id=${accountId}`, { method: 'DELETE' })
export interface BroadcastCloneData {
  clone: { name: string; message_template: string; message_variations: string[]; media_url: string | null; delay_seconds: number; instance_id: number | null; leads: Lead[] }
  original: { total_count: number; valid_leads_now: number }
}
export const fetchBroadcastCloneData = (id: number, accountId: number) => apiFetch<BroadcastCloneData>(`/api/broadcasts/${id}/clone-data?account_id=${accountId}`)

// Lead transfer requests (atendente pede atendimento de lead que esta com outro atendente)
export interface TransferRequest {
  id: number; lead_id: number; from_attendant_id: number; to_attendant_id: number | null
  account_id: number; status: 'pending'|'accepted'|'rejected'|'cancelled'
  message: string | null; created_at: string; responded_at: string | null
  lead_name?: string | null; lead_phone?: string | null; from_attendant_name?: string | null
}
export const requestLeadTransfer = (leadId: number, accountId: number, message?: string) =>
  apiFetch<{ request: TransferRequest; alreadyExists: boolean }>(`/api/leads/${leadId}/transfer-request?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ message }) })
export const acceptTransferRequest = (reqId: number) =>
  apiFetch(`/api/leads/transfer-requests/${reqId}/accept`, { method: 'POST', body: JSON.stringify({}) })
export const rejectTransferRequest = (reqId: number) =>
  apiFetch(`/api/leads/transfer-requests/${reqId}/reject`, { method: 'POST', body: JSON.stringify({}) })
export const fetchPendingTransferRequests = () =>
  apiFetch<{ requests: TransferRequest[] }>(`/api/leads/transfer-requests/pending`)
export const fetchAllTransferRequests = () =>
  apiFetch<{ received: TransferRequest[]; sent: TransferRequest[] }>(`/api/leads/transfer-requests/all`)
export const cancelTransferRequest = (reqId: number) =>
  apiFetch(`/api/leads/transfer-requests/${reqId}/cancel`, { method: 'POST', body: JSON.stringify({}) })
export const grabLead = (leadId: number, accountId: number) =>
  apiFetch<{ ok: boolean; leadId: number }>(`/api/leads/${leadId}/grab?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({}) })

// Auto-mensagens por instancia (saudacao, ausencia, inatividade)
export interface InstanceAutoMessageConfig {
  instance_id: number
  greeting_enabled?: number
  greeting_text?: string | null
  greeting_cooldown_hours?: number
  away_enabled?: number
  away_mode?: 'manual' | 'schedule'
  away_manual_active?: number
  away_text?: string | null
  away_schedule_json?: string | null
  away_cooldown_hours?: number
}
export const fetchInstanceAutoMessages = (instanceId: number, accountId: number) =>
  apiFetch<{ config: InstanceAutoMessageConfig }>(`/api/integrations/whatsapp/${instanceId}/auto-messages?account_id=${accountId}`)
export const saveInstanceAutoMessages = (instanceId: number, accountId: number, config: Partial<InstanceAutoMessageConfig>) =>
  apiFetch<{ config: InstanceAutoMessageConfig }>(`/api/integrations/whatsapp/${instanceId}/auto-messages?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(config) })

// Mapeamento tag → instancia (leads de form)
export interface TagInstanceMapping {
  id: number; tag_id: number; tag_name: string; tag_color: string
  instance_id: number; instance_name: string
  attendant_id: number | null; attendant_name: string | null
}
export const fetchTagInstanceMappings = (accountId: number) =>
  apiFetch<{ mappings: TagInstanceMapping[] }>(`/api/tag-mapping/list?account_id=${accountId}`)
export const upsertTagInstanceMapping = (accountId: number, data: { tag_id: number; instance_id: number; attendant_id?: number | null }) =>
  apiFetch(`/api/tag-mapping?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteTagInstanceMapping = (accountId: number, tagId: number) =>
  apiFetch(`/api/tag-mapping/${tagId}?account_id=${accountId}`, { method: 'DELETE' })
export const fetchDefaultFormInstance = (accountId: number) =>
  apiFetch<{ instance_id: number | null }>(`/api/tag-mapping/default-form-instance?account_id=${accountId}`)
export const setDefaultFormInstance = (accountId: number, instanceId: number | null) =>
  apiFetch(`/api/tag-mapping/default-form-instance?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ instance_id: instanceId }) })
export const fetchSheetsStatus = (accountId: number) =>
  apiFetch<{ last_lead_at: string | null }>(`/api/integrations/sheets-status?account_id=${accountId}`)

// Admin: check all WhatsApp instances across all accounts (super_admin only)
export interface InstanceCheckResult {
  id: number; account: string; instance: string; state: string; action: string; error?: string
}
export interface InstanceCheckResponse {
  ok: boolean
  summary: { total: number; connected: number; needs_qr: number; connecting: number; error: number }
  results: InstanceCheckResult[]
}
export const checkAllInstances = () => apiFetch<InstanceCheckResponse>('/api/admin/instances/check-all', { method: 'POST' })

// Notes
export const addLeadNote = (leadId: number, content: string) => apiFetch<{ note: LeadNote }>(`/api/leads/${leadId}/notes`, { method: 'POST', body: JSON.stringify({ content }) }).then(d => d.note)

// Tags
export const fetchTags = (accountId: number) => apiFetch<{ tags: Tag[] }>(`/api/leads/tags/list?account_id=${accountId}`).then(d => d.tags)
export const createTag = (accountId: number, name: string, color: string) => apiFetch<{ tag: Tag }>(`/api/leads/tags/create?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ name, color }) }).then(d => d.tag)
export const updateTag = (tagId: number, accountId: number, data: { name?: string; color?: string }) => apiFetch<{ tag: Tag }>(`/api/leads/tags/${tagId}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.tag)
export const deleteTag = (tagId: number, accountId: number) => apiFetch(`/api/leads/tags/${tagId}?account_id=${accountId}`, { method: 'DELETE' })
export const addLeadTag = (leadId: number, tagId: number) => apiFetch(`/api/leads/${leadId}/tags`, { method: 'POST', body: JSON.stringify({ tag_id: tagId }) })
export const removeLeadTag = (leadId: number, tagId: number) => apiFetch(`/api/leads/${leadId}/tags/${tagId}`, { method: 'DELETE' })

// Bulk actions
export const bulkAssignLeads = (accountId: number, leadIds: number[], attendantId: number | null) => apiFetch(`/api/leads/bulk/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, attendant_id: attendantId }) })
export const bulkMoveLeads = (accountId: number, leadIds: number[], stageId: number) => apiFetch(`/api/leads/bulk/stage?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, stage_id: stageId }) })

// Pipeline metrics
export const fetchPipelineMetrics = (accountId: number, funnelId: number) => apiFetch<{ metrics: PipelineMetric[]; totalLeads: number }>(`/api/leads/pipeline/metrics?account_id=${accountId}&funnel_id=${funnelId}`)

// =============================================
// Cadences (sequential contact workflows)
// =============================================

export interface CadenceAttempt { id: number; cadence_id: number; position: number; action_type: string; description: string | null; instructions: string | null; delay_days: number; scheduled_time: string | null; auto_message: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; call_script?: string | null }
export interface Cadence { id: number; account_id: number; name: string; description: string | null; is_active: number; created_at: string; attempts: CadenceAttempt[] }
export interface LeadCadence {
  id: number; lead_id: number; cadence_id: number; current_attempt_id: number | null; status: string; started_at: string
  cadence_name?: string; action_type?: string; attempt_description?: string; attempt_instructions?: string; attempt_message?: string | null; attempt_script?: string | null; attempt_position?: number; total_attempts?: number
}

export const fetchCadences = (accountId: number) => apiFetch<{ cadences: Cadence[] }>(`/api/cadences?account_id=${accountId}`).then(d => d.cadences)
export const createCadence = (accountId: number, data: { name: string; description?: string; attempts?: Partial<CadenceAttempt>[] }) => apiFetch<{ cadence: Cadence }>(`/api/cadences?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.cadence)
export const updateCadence = (id: number, accountId: number, data: Partial<Cadence>) => apiFetch(`/api/cadences/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateCadenceAttempts = (id: number, accountId: number, attempts: Partial<CadenceAttempt>[]) => apiFetch(`/api/cadences/${id}/attempts?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ attempts }) })
export const deleteCadence = (id: number, accountId: number) => apiFetch(`/api/cadences/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const assignLeadCadence = (cadenceId: number, accountId: number, leadId: number) => apiFetch(`/api/cadences/${cadenceId}/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_id: leadId }) })
export const advanceLeadCadence = (lcId: number, accountId: number) => apiFetch(`/api/cadences/lead-cadence/${lcId}/advance?account_id=${accountId}`, { method: 'PUT' })
export const removeLeadCadence = (lcId: number, accountId: number) => apiFetch(`/api/cadences/lead-cadence/${lcId}?account_id=${accountId}`, { method: 'DELETE' })
export const fetchLeadCadence = (leadId: number, accountId: number) => apiFetch<{ leadCadence: LeadCadence | null }>(`/api/cadences/lead/${leadId}?account_id=${accountId}`).then(d => d.leadCadence)

// =============================================
// Follow-ups (cadencias automaticas — envio sozinho via scheduler)
// =============================================
export interface FollowUpStep {
  id?: number; follow_up_id?: number; position?: number;
  delay_minutes: number; message_template: string;
  schedule_mode?: 'relative' | 'absolute';
  scheduled_at?: string | null;
  variations?: string[] | null;  // JSON array; sender escolhe aleatoria. null = usa message_template
}
export interface FollowUp {
  id: number; account_id: number; name: string; description: string | null;
  instance_id: number; instance_name?: string | null; instance_status?: string | null;
  stop_on_reply: number; is_active: number;
  type?: 'sequence' | 'inactivity';
  inactivity_stage_id?: number | null;
  inactivity_days?: number;
  inactivity_minutes?: number | null;
  inactivity_mode?: 'rotation' | 'sequence';
  variation_delay_seconds?: number;
  on_reply_action?: 'pause' | 'roulette' | 'assign_user';
  on_reply_user_id?: number | null;
  on_reply_move_to_stage_id?: number | null;
  on_reply_add_tag_id?: number | null;
  steps?: FollowUpStep[]; steps_count?: number; active_leads?: number;
  created_by: number | null; created_by_name?: string | null;
  created_at: string; updated_at: string;
}
export interface LeadFollowUp {
  id: number; lead_id: number; follow_up_id: number;
  follow_up_name?: string; instance_id?: number; instance_name?: string | null;
  stop_on_reply?: number;
  current_step_id: number | null; current_position?: number; current_message?: string | null;
  total_steps?: number;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  next_run_at: string | null;
  last_executed_at: string | null;
  paused_at: string | null; paused_reason: string | null;
  started_at: string;
}

export const fetchFollowUps = (accountId: number) => apiFetch<{ follow_ups: FollowUp[] }>(`/api/follow-ups?account_id=${accountId}`).then(d => d.follow_ups)
export const fetchFollowUp = (id: number, accountId: number) => apiFetch<{ follow_up: FollowUp }>(`/api/follow-ups/${id}?account_id=${accountId}`).then(d => d.follow_up)
export const createFollowUp = (accountId: number, data: Partial<FollowUp> & { name: string; instance_id: number; steps: FollowUpStep[] }) =>
  apiFetch<{ follow_up: FollowUp }>(`/api/follow-ups?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.follow_up)
export const updateFollowUp = (id: number, accountId: number, data: Partial<FollowUp> & { steps?: FollowUpStep[] }) =>
  apiFetch<{ follow_up: FollowUp }>(`/api/follow-ups/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.follow_up)
export const deleteFollowUp = (id: number, accountId: number, force = false) =>
  apiFetch(`/api/follow-ups/${id}?account_id=${accountId}${force ? '&force=1' : ''}`, { method: 'DELETE' })
export const assignFollowUp = (followUpId: number, accountId: number, leadId: number) =>
  apiFetch<{ lead_follow_up: LeadFollowUp }>(`/api/follow-ups/${followUpId}/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_id: leadId }) }).then(d => d.lead_follow_up)
export const pauseLeadFollowUp = (lfuId: number, accountId: number) =>
  apiFetch(`/api/follow-ups/lead/${lfuId}/pause?account_id=${accountId}`, { method: 'POST' })
export const resumeLeadFollowUp = (lfuId: number, accountId: number) =>
  apiFetch(`/api/follow-ups/lead/${lfuId}/resume?account_id=${accountId}`, { method: 'POST' })
export const cancelLeadFollowUp = (lfuId: number, accountId: number) =>
  apiFetch(`/api/follow-ups/lead/${lfuId}/cancel?account_id=${accountId}`, { method: 'POST' })
export const fetchLeadFollowUp = (leadId: number, accountId: number) =>
  apiFetch<{ lead_follow_up: LeadFollowUp | null }>(`/api/follow-ups/lead/${leadId}?account_id=${accountId}`).then(d => d.lead_follow_up)

// =============================================
// AI Agents (Haiku 4.5)
// =============================================
export type AgentActivationMode = 'default_attendant' | 'roulette' | 'conditional' | 'manual'
export type AgentHandoffReason = 'qualified' | 'keyword' | 'unknown' | 'max_messages' | 'audio_received'

export interface AgentHandoffRule {
  agent_id?: number
  reason: AgentHandoffReason
  target_type: 'roulette' | 'specific_user'
  target_user_id: number | null
  fallback_to_roulette: number
  move_to_stage_id: number | null
  add_tag_id: number | null
  target_user_name?: string
  stage_name?: string
  tag_name?: string
}

export interface AgentStage { id: number; name: string; color: string; funnel_id: number; funnel_name: string }
export interface AgentInstance { id: number; instance_name: string; status: string }

export interface Agent {
  id: number
  account_id: number
  user_id: number
  name: string
  is_active: number
  identifies_as_bot: number
  persona: string | null
  knowledge_base: string | null
  never_mention: string | null
  qualification_criteria: string | null
  required_fields: string | null  // JSON
  required_fields_arr?: string[]
  responds_to_audio: number
  audio_decline_message: string
  max_messages_before_handoff: number
  handoff_keywords: string
  activation_mode: AgentActivationMode
  required_tag_id: number | null
  monthly_token_limit: number
  tokens_used_this_month: number
  current_month: string | null
  created_at: string
  updated_at: string
  // Joined
  bot_user_name?: string
  stages_count?: number
  instances_count?: number
  stages?: AgentStage[]
  instances?: AgentInstance[]
  handoff_rules?: AgentHandoffRule[]
}

export interface AgentInput {
  name: string
  persona?: string
  knowledge_base?: string
  never_mention?: string
  qualification_criteria?: string
  required_fields?: string[]
  responds_to_audio?: boolean
  audio_decline_message?: string
  max_messages_before_handoff?: number
  handoff_keywords?: string
  activation_mode?: AgentActivationMode
  required_tag_id?: number | null
  monthly_token_limit?: number
  identifies_as_bot?: boolean
  is_active?: boolean
  stage_ids?: number[]
  instance_ids?: number[]
  handoff_rules?: Omit<AgentHandoffRule, 'agent_id'>[]
}

export interface AgentUsage {
  monthly_limit: number
  tokens_used_this_month: number
  cost_usd_this_month: number
  current_month: string | null
  recent_log: Array<{
    id: number; agent_id: number; lead_id: number | null; lead_name: string | null
    input_tokens: number; output_tokens: number
    cache_read_tokens: number; cache_creation_tokens: number
    cost_usd: number; created_at: string
  }>
}

export const fetchAgents = (accountId: number) =>
  apiFetch<{ feature_enabled: boolean; agents: Agent[] }>(`/api/agents?account_id=${accountId}`)

export const fetchAgent = (id: number, accountId: number) =>
  apiFetch<{ agent: Agent }>(`/api/agents/${id}?account_id=${accountId}`).then(d => d.agent)

export const createAgent = (accountId: number, data: AgentInput) =>
  apiFetch<{ agent: Agent }>(`/api/agents?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.agent)

export const updateAgent = (id: number, accountId: number, data: Partial<AgentInput>) =>
  apiFetch<{ agent: Agent }>(`/api/agents/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.agent)

export const deleteAgent = (id: number, accountId: number) =>
  apiFetch(`/api/agents/${id}?account_id=${accountId}`, { method: 'DELETE' })

export const fetchAgentUsage = (id: number, accountId: number) =>
  apiFetch<AgentUsage>(`/api/agents/${id}/usage?account_id=${accountId}`)

export const testAgent = (id: number, accountId: number, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) =>
  apiFetch<{ response: string; usage: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }; cost_usd: number; stop_reason: string }>(`/api/agents/${id}/test?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ message, history }) })

// =============================================
// Tasks (cadence steps that need execution)
// =============================================

export interface Task {
  lead_cadence_id: number; lead_id: number; cadence_id: number; current_attempt_id: number; status: string
  lead_name: string | null; lead_phone: string | null; lead_empresa: string | null; lead_city: string | null; profile_pic_url: string | null
  attendant_id: number | null; attendant_name: string | null
  stage_name: string | null; stage_color: string | null
  cadence_name: string; attempt_position: number; total_attempts: number
  action_type: string; attempt_description: string | null; attempt_instructions: string | null
  delay_days: number; scheduled_time: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; auto_message: string | null; call_script: string | null
  due_datetime: string; bucket: 'overdue' | 'today' | 'tomorrow' | 'week' | 'later'
}
export interface TaskCounts { overdue: number; today: number; tomorrow: number; week: number; total: number }
export interface TaskGroups { overdue: Task[]; today: Task[]; tomorrow: Task[]; week: Task[]; later: Task[] }

export const fetchMyTasks = (accountId: number) => apiFetch<TaskGroups>(`/api/tasks/my?account_id=${accountId}`)
export const fetchTaskCounts = (accountId: number) => apiFetch<TaskCounts>(`/api/tasks/counts?account_id=${accountId}`)
export interface NextStep { position: number; action_type: string; description: string | null; delay_days: number; scheduled_time: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; due_datetime: string }
export interface CompleteResult { ok: boolean; completed: boolean; nextStep: NextStep | null }
export const completeTask = (lcId: number, accountId: number) => apiFetch<CompleteResult>(`/api/tasks/${lcId}/complete?account_id=${accountId}`, { method: 'POST' })
export const skipTask = (lcId: number, accountId: number) => apiFetch(`/api/tasks/${lcId}/skip?account_id=${accountId}`, { method: 'POST' })

// Standalone tasks
export interface StandaloneTaskInput { lead_id?: number; title: string; description?: string; due_mode: 'date' | 'duration'; due_date?: string; due_time?: string; due_minutes?: number; assigned_to?: number }
export const createStandaloneTask = (accountId: number, data: StandaloneTaskInput) => apiFetch<{ task: any }>(`/api/tasks/standalone?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) })
export const updateStandaloneTask = (id: number, accountId: number, data: Partial<StandaloneTaskInput>) => apiFetch<{ task: any }>(`/api/tasks/standalone/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const fetchLeadTasks = (leadId: number, accountId: number) => apiFetch<{ tasks: any[] }>(`/api/tasks/standalone/by-lead/${leadId}?account_id=${accountId}`).then(d => d.tasks)
export const completeStandaloneTask = (id: number, accountId: number) => apiFetch(`/api/tasks/standalone/${id}/complete?account_id=${accountId}`, { method: 'POST' })
export const deleteStandaloneTask = (id: number, accountId: number) => apiFetch(`/api/tasks/standalone/${id}?account_id=${accountId}`, { method: 'DELETE' })

// =============================================
// Ready Messages (quick templates)
// =============================================

export interface ReadyMessage { id: number; account_id: number; title: string; content: string; image_url: string | null; video_url: string | null; stage_id: number | null; stage_name?: string; stage_color?: string; is_active: number; created_at: string }

export const fetchReadyMessages = (accountId: number) => apiFetch<{ messages: ReadyMessage[] }>(`/api/ready-messages?account_id=${accountId}`).then(d => d.messages)
export const createReadyMessage = (accountId: number, data: Partial<ReadyMessage>) => apiFetch<{ message: ReadyMessage }>(`/api/ready-messages?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.message)
export const updateReadyMessage = (id: number, accountId: number, data: Partial<ReadyMessage>) => apiFetch(`/api/ready-messages/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteReadyMessage = (id: number, accountId: number) => apiFetch(`/api/ready-messages/${id}?account_id=${accountId}`, { method: 'DELETE' })

// =============================================
// Qualification Sequences
// =============================================

export interface QualificationSequence { id: number; account_id: number; question: string; position: number; is_active: number }
export interface LeadQualification { sequence_id: number; question: string; position: number; answer_id: number | null; answer: string | null; answered_at: string | null; answered_by: number | null; answered_by_name: string | null }

export const fetchQualifications = (accountId: number) => apiFetch<{ sequences: QualificationSequence[] }>(`/api/qualifications?account_id=${accountId}`).then(d => d.sequences)
export const createQualification = (accountId: number, question: string) => apiFetch<{ sequence: QualificationSequence }>(`/api/qualifications?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ question }) }).then(d => d.sequence)
export const updateQualification = (id: number, accountId: number, data: Partial<QualificationSequence>) => apiFetch(`/api/qualifications/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteQualification = (id: number, accountId: number) => apiFetch(`/api/qualifications/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const fetchLeadQualifications = (leadId: number, accountId: number) => apiFetch<{ qualifications: LeadQualification[] }>(`/api/qualifications/lead/${leadId}?account_id=${accountId}`).then(d => d.qualifications)
export const answerQualification = (leadId: number, accountId: number, sequenceId: number, answer: string) => apiFetch(`/api/qualifications/lead/${leadId}/answer?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ sequence_id: sequenceId, answer }) })

// =============================================
// Launches (product/property listings)
// =============================================

export interface LaunchMessage { id: number; launch_id: number; position: number; question: string; answer: string }
export interface Launch { id: number; account_id: number; title: string; identification: string | null; is_active: number; created_at: string; messages: LaunchMessage[] }

export const fetchLaunches = (accountId: number) => apiFetch<{ launches: Launch[] }>(`/api/launches?account_id=${accountId}`).then(d => d.launches)
export const createLaunch = (accountId: number, data: { title: string; identification?: string; messages?: Partial<LaunchMessage>[] }) => apiFetch<{ launch: Launch }>(`/api/launches?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.launch)
export const updateLaunch = (id: number, accountId: number, data: Partial<Launch>) => apiFetch(`/api/launches/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateLaunchMessages = (id: number, accountId: number, messages: Partial<LaunchMessage>[]) => apiFetch(`/api/launches/${id}/messages?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ messages }) })
export const deleteLaunch = (id: number, accountId: number) => apiFetch(`/api/launches/${id}?account_id=${accountId}`, { method: 'DELETE' })

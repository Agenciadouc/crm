import { normalizeProviders, type WhatsAppProviderId } from './whatsappProviders.js'
import { geoQuery } from './geoFilter.js'
import { funnelQuery, type FunnelValue } from './funnelFilter.js'
import type { ScoreBand, ScoreQuadrant } from './score'
export type { WhatsAppProviderId }

const getToken = () => localStorage.getItem('dros_crm_token')
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

// Flag pra evitar disparar o alert de conta inativa varias vezes em concorrencia
let inactiveShown = false

export async function apiFetch<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const url = path.startsWith('/api') ? `${BASE}${path}` : path
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', ...opts.headers },
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  // 403 com error='account_inactive' → conta foi desativada durante sessao ativa.
  // Mostra alert amigavel + logout forcado. Flag evita empilhar alerts em concorrencia.
  if (res.status === 403) {
    const errBody = await res.clone().json().catch(() => ({}))
    if (errBody?.error === 'account_inactive') {
      if (!inactiveShown) {
        inactiveShown = true
        alert(errBody.message || 'Sua conta esta desativada. Fale com a Dros pra reativar.')
        localStorage.removeItem('dros_crm_token')
        window.location.href = `${BASE}/login`
      }
      throw new Error('account_inactive')
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    // status e code vao junto no erro (ex.: 503 code 'ai_off') sem mudar a mensagem
    throw Object.assign(new Error(err.error || `API error: ${res.status}`), { status: res.status, code: err.code })
  }
  return res.json()
}

export function formatBRL(v: number) { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
export function formatNumber(n: number) { return n.toLocaleString('pt-BR') }
export function pctChange(c: number, p: number) { if (p === 0) return c > 0 ? 100 : null; return ((c - p) / p) * 100 }

// =============================================
// Types
// =============================================

export interface Account { id: number; name: string; slug: string; logo_url: string | null; is_active: number; created_at: string; lead_count?: number; user_count?: number; cnpj?: string | null; razao_social?: string | null; segmento?: string | null; website?: string | null; instagram?: string | null; whatsapp_comercial?: string | null; valor_mensal?: number | null; contrato_inicio?: string | null; cidade?: string | null; estado?: string | null; observacoes?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null; avg_ticket?: number | null; meta_pixel_id?: string | null; meta_capi_token?: string | null; meta_capi_test_event_code?: string | null; meta_capi_enabled?: number; meta_page_id?: string | null; ai_agents_enabled?: number; attendant_analytics_enabled?: number; admin_marks_as_read?: number; anthropic_api_key?: string | null; analysis_token_limit?: number; ai_key_source?: 'client' | 'dros' | 'auto' }
export interface User { id: number; account_id: number | null; account_name?: string | null; name: string; email: string; role: string; is_active: number; is_bot?: number; primary_instance_id?: number | null; notification_instance_id?: number | null; can_manage_proposals?: number; can_manage_contracts?: number; can_grab_leads?: number; created_at: string }
export interface FunnelStage { id: number; funnel_id: number; name: string; position: number; color: string; is_conversion: number; is_terminal: number; is_qualified?: number; is_meeting?: number; auto_keywords: string | null; meta_event_name?: string | null; system_key?: string | null; trigger_keywords?: string | null; weak_keywords?: string | null; strong_keywords?: string | null; negative_keywords?: string | null }
export interface Funnel { id: number; account_id: number; name: string; is_default: number; is_active: number; first_msg_template?: string | null; stages: FunnelStage[]; kind?: 'vendas' | 'recompra' }
export interface Tag { id: number; account_id: number; name: string; color: string }
export interface Lead {
  id: number; account_id: number; funnel_id: number; stage_id: number; attendant_id: number | null
  name: string | null; phone: string | null; email: string | null; city: string | null
  uf?: string | null // estado calculado (estado informado > cidade IBGE > DDD)
  source: string | null; source_detail: string | null; notes: string | null
  wa_remote_jid: string | null; instance_id: number | null; last_instance_id?: number | null; profile_pic_url: string | null; is_active: number; created_at: string; updated_at: string
  is_archived?: number; archived_at?: string | null; has_new_after_archive?: number
  contact_type?: 'lead' | 'cliente' | 'revendedor' | 'interno' | null // quem nao e cliente em potencial sai do funil e dos numeros
  contact_type_origin?: string | null
  unread_count?: number  // qtd de msgs inbound nao lidas — zerado ao abrir o chat
  last_inbound_at?: string | null  // timestamp da ultima msg do cliente (nao do atendente) — sort do chat
  empresa?: string | null; cpf_cnpj?: string | null; instagram?: string | null; trabalha_anuncio?: number; investimento_anuncios?: number | null
  opted_in_at?: string | null; opted_out_at?: string | null; last_broadcast_at?: string | null
  state?: string | null; zip?: string | null; birthdate?: string | null; gender?: string | null
  ctwa_clid?: string | null; fbp?: string | null; fbc?: string | null
  meta_ad_id?: string | null; meta_campaign_id?: string | null; meta_form_id?: string | null; lead_form_lead_id?: string | null
  client_ip_address?: string | null; client_user_agent?: string | null
  ai_close_chance?: number | null; ai_main_blocker?: string | null; ai_moment?: string | null; ai_criteria_json?: string | null
  ai_paused_at?: string | null; ai_paused_by?: number | null; ai_handed_off_at?: string | null
  stage_name?: string; stage_color?: string; attendant_name?: string; instance_name?: string
  last_message?: string; message_count?: number; tags?: Tag[]
  // Termometro (spec 5.1): nota 0-100, faixa, nota anterior, letra do perfil, engajamento 0-50 e acao da matriz
  score?: number | null; score_band?: ScoreBand | null; score_prev?: number | null
  score_fit_grade?: 'A' | 'B' | 'C' | 'D' | null; score_engagement?: number | null; score_quadrant?: ScoreQuadrant | null
}
// Termometro completo do lead (GET /api/leads/:id/score)
export interface ScoreReason { grupo: 'perfil' | 'engajamento' | 'ia'; texto: string; pontos: number }
export interface LeadScore {
  score: number | null; band: ScoreBand | null
  fit: number | null; fit_grade: 'A' | 'B' | 'C' | 'D' | null
  engagement: number | null; quadrant: ScoreQuadrant | null
  reasons: ScoreReason[]; score_prev: number | null; score_at: string | null
}
export const fetchLeadScore = (leadId: number, accountId: number) => apiFetch<LeadScore>(`/api/leads/${leadId}/score?account_id=${accountId}`)
export type MessageDeliveryStatus = 'sent' | 'delivered' | 'read'
export interface Message { id: number; lead_id: number; direction: 'inbound' | 'outbound'; content: string | null; media_type: string; media_url: string | null; transcription?: string | null; sender_name: string | null; wa_msg_id: string | null; instance_id?: number | null; created_at: string; delivery_status?: MessageDeliveryStatus; delivered_at?: string | null; read_at?: string | null }
export const fetchMessageMedia = (leadId: number, msgId: number) => apiFetch<{ dataUrl: string; mime: string; type: string }>(`/api/messages/${leadId}/media/${msgId}`)
export const markLeadAsRead = (leadId: number) => apiFetch<{ ok: boolean; lead_id: number; unread_count: number }>(`/api/leads/${leadId}/read`, { method: 'PATCH' })
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
export interface WhatsAppInstance { id: number; account_id: number; instance_name: string; api_url: string; api_key: string; status: string; phone_number: string | null; qr_code: string | null; default_attendant_id: number | null; lead_intake_mode?: 'open' | 'restricted'; first_msg_template?: string | null; provider?: WhatsAppProviderId | string; role?: 'leitura' | 'disparo'; is_default_send?: boolean; reply_rate?: { reached: number; replied: number; rate: number | null } | null }
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
export const updateMetaCapi = (id: number, data: { meta_pixel_id?: string | null; meta_capi_token?: string | null; meta_capi_enabled?: number; meta_page_id?: string | null }) => apiFetch<{ account: Account }>(`/api/accounts/${id}/meta-capi`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.account)
export const updateAiConfig = (id: number, data: { anthropic_api_key?: string | null; analysis_token_limit?: number }) => apiFetch<{ account: { id: number; has_anthropic_key: boolean; analysis_token_limit: number } }>(`/api/accounts/${id}/ai-config`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.account)
export const testAnthropic = (id: number, anthropic_api_key?: string | null) => apiFetch<{ ok: boolean; msg?: string }>(`/api/accounts/${id}/test-anthropic`, { method: 'POST', body: JSON.stringify({ anthropic_api_key: anthropic_api_key || undefined }) })
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
export const updateFunnelFirstMessage = (funnelId: number, accountId: number, template: string | null) =>
  apiFetch(`/api/funnels/${funnelId}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ first_msg_template: template }) })

// Leads
export interface LeadFilters { stage_id?: number | string; attendant_id?: number | string; instance_id?: number | string; funnel_id?: number; source?: string; city?: string; uf?: string; tag?: number | string; search?: string; date_from?: string; date_to?: string; show_archived?: '1' | 'all'; page?: number; limit?: number; score_bands?: string; score_min?: number; fit?: 'AB'; engagement?: 'high'; sort?: 'score'; curve?: string; tier_id?: number; repurchase_late?: '1'; only_leads?: '1'; funnel?: string }
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
// Custom fetch: 400 NAO lanca exception, retorna body com blockers pra UI listar motivos.
// Path com BASE — nginx roteia /crm/* pro backend Node. Sem BASE cai no WordPress.
// instanceId opcional: instancia ativa no "Enviar via" do chat (caso user queira forcar
// resposta em uma instancia especifica diferente da que recebeu a inbound).
export const forceAiRespond = async (id: number, instanceId?: number): Promise<{ ok: boolean; message?: string; error?: string; blockers?: string[] }> => {
  const res = await fetch(`${BASE}/api/leads/${id}/force-ai-respond`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: instanceId ? JSON.stringify({ instance_id: instanceId }) : undefined,
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: body.error || `Erro ${res.status}`, blockers: body.blockers, message: body.message }
  return body
}
// Trava do roteiro (spec 4.3): PUT /leads/:id/stage devolve 409 {code:'roteiro_gate', pending}
export interface RoteiroOption { option_key: string; label: string; points: number; position: number; sets_profile_key?: string | null }
export interface RoteiroPendingQuestion {
  question_key: string; text: string; stage_id: number; stage_name: string
  kind: 'text' | 'options'; options: RoteiroOption[]
}
export class RoteiroGateError extends Error {
  pending: RoteiroPendingQuestion[]
  constructor(message: string, pending: RoteiroPendingQuestion[]) {
    super(message)
    this.name = 'RoteiroGateError'
    this.pending = pending
  }
}
// Etapa destino e de desfecho de recompra (nao_agora/nao_quer) — servidor recusa o move direto
// e pede a janela de desfecho (motivo obrigatorio, spec LTV/Recompra §6.3/§12).
export class UseOutcomeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UseOutcomeError'
  }
}
// forceReason: "avancar mesmo assim" (so gestor/admin; o servidor grava o motivo no historico)
export async function moveLeadStage(id: number, stageId: number, opts: { forceReason?: string; accountId?: number | null } = {}) {
  const q = opts.accountId ? `?account_id=${opts.accountId}` : ''
  const body: Record<string, unknown> = { stage_id: stageId }
  if (opts.forceReason) body.force_reason = opts.forceReason
  const res = await fetch(`${BASE}/api/leads/${id}/stage${q}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  const data = await res.json().catch(() => ({}))
  if (res.status === 409 && data.code === 'roteiro_gate') {
    throw new RoteiroGateError(data.error || 'Faltam perguntas obrigatórias para avançar.', Array.isArray(data.pending) ? data.pending : [])
  }
  if (res.status === 409 && data.code === 'use_outcome') {
    throw new UseOutcomeError(data.error || 'Use a janela de desfecho para informar o motivo.')
  }
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`)
  return data as { lead: Lead }
}
export const assignLead = (id: number, attendantId: number | null, notify?: boolean) => apiFetch(`/api/leads/${id}/assign`, { method: 'PUT', body: JSON.stringify({ attendant_id: attendantId, notify_attendant: !!notify }) })
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
// recognized_question: o servidor reconheceu na mensagem digitada uma pergunta pendente do roteiro
export interface SendResult { message: Message; delivered: boolean; error?: string; recognized_question?: { question_key: string; text: string } | null }
// roteiroQuestionKey: mensagem veio do botao [Perguntar] do roteiro (vira registro de pergunta enviada)
// roteiroQuestionKey: [Perguntar] do roteiro; cadenceAttemptId: [Enviar] do passo mensagem da cadencia da etapa
export const sendMessage = (leadId: number, accountId: number, content: string, instance_id?: number, roteiroQuestionKey?: string | null, cadenceAttemptId?: number | null) =>
  apiFetch<SendResult>(`/api/messages/${leadId}?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({
    content, instance_id,
    ...(roteiroQuestionKey ? { roteiro_question_key: roteiroQuestionKey } : {}),
    ...(cadenceAttemptId ? { cadence_attempt_id: cadenceAttemptId } : {}),
  }) })
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
  frente_site: number;
  site_dominio_valor: number; site_hospedagem_valor: number;
  exclusoes_extras: string | null;
  videos_por_mes: number; imagens_por_mes: number;
  fat_mes1_ref: string | null; fat_mes1_valor: number | null;
  fat_mes2_ref: string | null; fat_mes2_valor: number | null;
  fat_mes3_ref: string | null; fat_mes3_valor: number | null;
  fat_base: number | null;
  local_assinatura: string; data_assinatura: string;
  created_by: number | null; created_by_name?: string;
  created_at: string; updated_at: string;
  // v2: aprovacao (cria cliente)
  approved_at?: string | null;
  approved_by?: number | null;
  approved_email?: string | null;
  account_id?: number | null;
  hub_client_id?: number | null;
}
export interface ContractInput {
  razao_social: string; cnpj: string; inscricao_estadual?: string;
  endereco_logradouro: string; endereco_bairro: string; endereco_cep: string;
  endereco_cidade: string; endereco_estado: string;
  fee_mensal: number; comissao_percent: number;
  vigencia_meses: number; data_inicio: string; data_fim?: string;
  renovacao_meses: number; aviso_previo_dias: number; reajuste_indice: string;
  frente_diagnostico: boolean; frente_estruturacao: boolean; frente_aquisicao: boolean; frente_editorial: boolean;
  frente_site?: boolean;
  site_dominio_valor?: number; site_hospedagem_valor?: number;
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
export const approveContract = (id: number, email?: string) => apiFetch<{ contract: Contract; credentials: { email: string; password: string; account_id: number }; hub?: { created: boolean; client_id?: number; client_name?: string; reason?: string }; message: string }>(`/api/contracts/${id}/approve`, { method: 'POST', body: JSON.stringify(email ? { email } : {}) })
export const syncContractHub = (id: number) => apiFetch<{ ok: boolean; client_id?: number; reason?: string; message?: string }>(`/api/contracts/${id}/sync-hub`, { method: 'POST' })

// Dashboard
// Filtro de estado/cidade dos relatorios: o valor e o texto "UF|Cidade" (ver lib/geoFilter.js)
const cityQ = (geo?: string | null) => geoQuery(geo)
// Filtro de funil (Vendas novas | Recompra | Todos): so vai na URL quando a tela passa
const fq = (funnel?: FunnelValue | null) => (funnel ? funnelQuery(funnel) : '')
export interface CityOption { value: string; uf: string | null; count: number }
export interface StateOption { value: string; name: string; count: number }
export const fetchLeadCities = (accountId: number, uf?: string | null) => apiFetch<{ cities: CityOption[] }>(`/api/leads/cities?account_id=${accountId}${uf ? `&uf=${encodeURIComponent(uf)}` : ''}`).then(d => d.cities || [])
export const fetchLeadStates = (accountId: number) => apiFetch<{ states: StateOption[]; sem_estado: number }>(`/api/leads/states?account_id=${accountId}`)
export const fetchDashboardStats = (accountId: number, days = 7, city?: string | null, funnel?: FunnelValue | null) => apiFetch<DashboardStats>(`/api/dashboard/stats?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`)
export const fetchAgentStats = (accountId: number, days = 7, city?: string | null, funnel?: FunnelValue | null) => apiFetch<{ agents: AgentStat[] }>(`/api/dashboard/agents?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`).then(d => d.agents)
export const fetchGlobalDashboard = () => apiFetch<{ accounts: any[]; totalLeads: number; leadsToday: number }>('/api/dashboard/global')

// ─── Funil Mensal + ROAS + Projecao ────────────────────────────────────────
export interface FunilMensalCascade {
  total: number
  qualified: number
  meeting: number
  won: number
  qualified_rate: number | null
  meeting_rate: number | null
  won_rate: number | null
  overall_conversion: number | null
  real_revenue: number
  config_missing: { qualified: boolean; meeting: boolean; won: boolean }
}
export interface MonthlyConfig {
  year_month: string
  ad_investment: number
  sales_target: number
  avg_ticket: number
  notes: string
  is_overridden: boolean
  updated_at: string | null
}
export interface FunilMensal {
  month: string
  cascade: FunilMensalCascade
  config: MonthlyConfig
  by_city?: boolean
  calc: {
    cpl: number | null
    cac: number | null
    roas: number | null
    estimated_revenue: number
    target_progress: number | null
    target_remaining: number
  }
}
export interface ProjecaoRow {
  year_month: string
  is_future: boolean
  projected: boolean
  investment: number
  total_leads: number
  cpl: number | null
  qualified: number
  qualified_rate: number | null
  meeting: number
  meeting_rate: number | null
  won: number
  won_rate: number | null
  target: number
  ticket: number
  revenue: number
  cac: number | null
  roas: number | null
}
export interface ProjecaoResponse {
  rows: ProjecaoRow[]
  by_city?: boolean
  assumptions: {
    avg_qualified_rate: number
    avg_meeting_rate: number
    avg_won_rate: number
    avg_cpl: number
    months_used_for_avg: number
  }
}

export const fetchFunilMensal = (accountId: number, month: string, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<FunilMensal>(`/api/dashboard/funil-mensal/${month}?account_id=${accountId}${cityQ(city)}${fq(funnel)}`)
export const fetchMonthlyMetrics = (accountId: number, month: string) =>
  apiFetch<MonthlyConfig>(`/api/dashboard/monthly-metrics/${month}?account_id=${accountId}`)
export const updateMonthlyMetrics = (accountId: number, month: string, data: { ad_investment?: number; sales_target?: number; avg_ticket?: number | null; notes?: string }) =>
  apiFetch<MonthlyConfig>(`/api/dashboard/monthly-metrics/${month}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateAccountAvgTicket = (accountId: number, avgTicket: number | null) =>
  apiFetch<{ ok: boolean; avg_ticket: number | null }>(`/api/dashboard/account/avg-ticket?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ avg_ticket: avgTicket }) })
export const fetchProjecao = (accountId: number, months = 3, futuros = 3, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<ProjecaoResponse>(`/api/dashboard/projecao?account_id=${accountId}&months=${months}&futuros=${futuros}${cityQ(city)}${fq(funnel)}`)

export interface AiUsageData {
  period: string
  total: {
    total_tokens: number
    haiku_cost_usd: number
    stt_seconds: number
    stt_cost_usd: number
    audio_count: number
    message_count: number
    total_cost_usd: number
  }
  byAccount: Array<{ id: number; name: string; total_tokens: number; haiku_cost_usd: number; stt_seconds: number; stt_cost_usd: number; audio_count: number; message_count: number; total_cost_usd: number }>
  byAgent: Array<{ id: number; agent_name: string; account_name: string; total_tokens: number; haiku_cost_usd: number; stt_seconds: number; stt_cost_usd: number; audio_count: number; message_count: number; total_cost_usd: number }>
}
export const fetchAiUsageGlobal = (days?: number) => apiFetch<AiUsageData>(`/api/dashboard/ai-usage${days ? `?days=${days}` : ''}`)

// ─── Dashboard de Análise de Atendimentos ───
export interface AttendantMetrics {
  user_id: number; user_name: string; role: 'atendente' | 'gerente'
  leads_assigned: number; leads_responded: number; leads_converted: number
  ttfr_avg_seconds: number | null; tmr_avg_seconds: number | null
  leads_under_5min: number; leads_under_30min: number; leads_under_1h: number
  open_conversations: number; abandoned_leads: number
  ai_score_avg: number | null; ai_errors_total: number | null; lost_sales_detected: number
}
export interface AttendantDailyMetric {
  date: string; leads_assigned: number; leads_responded: number; leads_converted: number
  ttfr_avg_seconds: number | null; tmr_avg_seconds: number | null
  leads_under_5min: number; leads_under_30min: number; leads_under_1h: number
  open_conversations: number; abandoned_leads: number
}
export interface ConversationInsight {
  id: number; lead_id: number; lead_name: string; lead_phone?: string
  summary: string; lead_intent: 'hot' | 'warm' | 'cold' | 'not_qualified'
  lost_sale_signals: string | null
  attendant_errors: string[]; attendant_score: number | null
  score_reasoning: string; suggested_next_step: string
  last_message_quality: 'excellent' | 'good' | 'mediocre' | 'poor'
  attendant_user_id: number | null; attendant_name: string | null
  analyzed_at: string
}
export interface AttendantDetail {
  user: { id: number; name: string; role: string }
  days: number
  daily: AttendantDailyMetric[]
  recent_insights: ConversationInsight[]
  top_errors: Array<{ error: string; count: number }>
}
export const fetchAttendants = (accountId: number, days = 30, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<{ days: number; attendants: AttendantMetrics[]; by_city?: boolean }>(`/api/dashboard/attendants?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`)
export const fetchAttendantDetail = (userId: number, accountId: number, days = 30) =>
  apiFetch<AttendantDetail>(`/api/dashboard/attendants/${userId}?account_id=${accountId}&days=${days}`)
export const fetchConversationInsights = (accountId: number, opts: { days?: number; filter?: string; attendant_id?: number; limit?: number; funnel?: FunnelValue | null } = {}) => {
  const q = new URLSearchParams({ account_id: String(accountId) })
  if (opts.days) q.set('days', String(opts.days))
  if (opts.filter) q.set('filter', opts.filter)
  if (opts.attendant_id) q.set('attendant_id', String(opts.attendant_id))
  if (opts.limit) q.set('limit', String(opts.limit))
  if (opts.funnel) q.set('funnel', opts.funnel)
  return apiFetch<{ insights: ConversationInsight[] }>(`/api/dashboard/conversation-insights?${q.toString()}`)
}
export const fetchLeadInsight = (leadId: number, accountId: number) =>
  apiFetch<{ insight: ConversationInsight | null }>(`/api/dashboard/conversation-insights/lead/${leadId}?account_id=${accountId}`)
// Custom fetch: 429 nao lanca exception, retorna body com retry_after_min pra UI tratar.
export const triggerAnalysisNow = async (
  accountId: number,
  maxLeads: number = 50,
  opts: { resetAll?: boolean; resetLead?: number; days?: number } = {}
): Promise<{ ok: boolean; message?: string; error?: string; retry_after_min?: number; max_leads?: number }> => {
  const params = new URLSearchParams({ account_id: String(accountId), max: String(maxLeads) })
  if (opts.resetAll) params.set('reset_all', 'true')
  if (opts.resetLead) params.set('reset_lead', String(opts.resetLead))
  if (opts.days) params.set('days', String(opts.days))
  const res = await fetch(`${BASE}/api/dashboard/analyze-now?${params.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${BASE}/login`; throw new Error('Unauthorized') }
  const body = await res.json().catch(() => ({}))
  if (res.status === 429) return { ok: false, error: body.error, retry_after_min: body.retry_after_min }
  if (!res.ok) return { ok: false, error: body.error || `Erro ${res.status}` }
  return body
}
export const updateAnalysisLimit = (accountId: number, limit: number) =>
  apiFetch<{ ok: boolean; analysis_token_limit: number }>(`/api/dashboard/analysis-limit?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ limit }) })

// Integrations
export interface EvolutionConfig { api_url: string | null; api_key: string | null; configured?: boolean }
export const fetchEvolutionConfig = (accountId: number) => apiFetch<EvolutionConfig>(`/api/integrations/evolution-config?account_id=${accountId}`)
export const saveEvolutionConfig = (accountId: number, data: { api_url: string; api_key: string }) => apiFetch(`/api/integrations/evolution-config?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })
export const fetchPublicConfig = () => apiFetch<{ public_base_url: string }>('/api/integrations/public-config')
export const fetchWhatsAppProviders = (accountId: number): Promise<WhatsAppProviderId[]> =>
  apiFetch<unknown>(`/api/integrations/whatsapp/providers?account_id=${accountId}`)
    .then(normalizeProviders)
    .catch(() => ['evolution'] as WhatsAppProviderId[])

export const fetchWhatsAppInstances = (accountId: number) => apiFetch<{ instances: WhatsAppInstance[] }>(`/api/integrations/whatsapp?account_id=${accountId}`).then(d => d.instances)
export const createWhatsAppInstance = (accountId: number, data: { instance_name: string; lead_intake_mode?: 'open' | 'restricted'; provider?: WhatsAppProviderId }) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.instance)
export const connectWhatsAppInstance = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/connect?account_id=${accountId}`, { method: 'POST' }).then(d => d.instance)
export const checkWhatsAppStatus = (id: number, accountId: number) => apiFetch<{ instance: WhatsAppInstance; state: string }>(`/api/integrations/whatsapp/${id}/status?account_id=${accountId}`)
export interface QrCodeResult { qr_code: string | null; status: string; panel_url: string | null; error_message?: string | null }
// Contrato: { qr_code, status, panel_url?, error_message? }. Aceita tambem o formato antigo { instance } por seguranca.
export const refreshWhatsAppQR = (id: number, accountId: number) =>
  apiFetch<any>(`/api/integrations/whatsapp/${id}/qrcode?account_id=${accountId}`, { method: 'POST' })
    .then((d): QrCodeResult => ({
      qr_code: d?.qr_code ?? d?.instance?.qr_code ?? null,
      status: d?.status ?? d?.instance?.status ?? 'connecting',
      panel_url: d?.panel_url ?? null,
      error_message: d?.error_message ?? null,
    }))
export const disconnectWhatsApp = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}/disconnect?account_id=${accountId}`, { method: 'POST' })
export const deleteWhatsAppInstance = (id: number, accountId: number) => apiFetch(`/api/integrations/whatsapp/${id}?account_id=${accountId}`, { method: 'DELETE' })
export const setupWhatsAppWebhook = (id: number, accountId: number) => apiFetch<{ ok: boolean; webhookUrl: string }>(`/api/integrations/whatsapp/${id}/setup-webhook?account_id=${accountId}`, { method: 'POST' })
export const restartWhatsAppInstance = (id: number, accountId: number) => apiFetch<{ ok: boolean }>(`/api/integrations/whatsapp/${id}/restart?account_id=${accountId}`, { method: 'POST' })

// System notice (popup global de aviso pra todos usuarios logados)
export interface SystemNotice { id: number; title: string | null; message: string; type: 'info' | 'warning' | 'success'; expiresAt: number; createdAt: number }
export const fetchSystemNotice = () => apiFetch<{ notice: SystemNotice | null }>(`/api/admin/system-notice`)
export const sendSystemNotice = (data: { message: string; type?: 'info' | 'warning' | 'success'; durationMinutes?: number; title?: string }) =>
  apiFetch<{ ok: boolean; notice: SystemNotice }>(`/api/admin/system-notice`, { method: 'POST', body: JSON.stringify(data) })
export const clearSystemNotice = () => apiFetch<{ ok: boolean }>(`/api/admin/system-notice`, { method: 'DELETE' })
export const publishRelease = (version?: string) =>
  apiFetch<{ ok: boolean; version: string | null }>(`/api/admin/publish-release`, { method: 'POST', body: JSON.stringify({ version }) })
export const setInstanceAttendant = (id: number, accountId: number, attendantId: number | null) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/attendant?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ attendant_id: attendantId }) })
export const setInstanceMode = (id: number, accountId: number, mode: 'open' | 'restricted') => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${id}/mode?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ mode }) })
export const syncWhatsAppNow = (accountId: number) => apiFetch<{ ok: boolean }>(`/api/integrations/whatsapp/sync-now?account_id=${accountId}`, { method: 'POST' })
export const testWhatsAppConnection = (id: number, accountId: number) => apiFetch<{ success: boolean; status: string }>(`/api/integrations/whatsapp/${id}/test?account_id=${accountId}`, { method: 'POST' })

// Numero de disparo padrao (spec papeis dos numeros e anti-ban) e configuracoes anti-ban da conta.
export interface SendNumberStatus {
  ok: boolean
  reason: 'no_send_number' | 'send_number_offline' | null
  instance: { id: number; instance_name: string; provider: string; status: string } | null
}
export interface AntibanSettings {
  optout_footer_enabled: boolean
  optout_footer_text: string
  optout_confirm_text: string
  reply_rate_alert_pct: number
}
export const fetchSendNumberStatus = (accountId: number) =>
  apiFetch<SendNumberStatus>(`/api/integrations/whatsapp/send-number-status?account_id=${accountId}`)
export const setDefaultSendInstance = (accountId: number, instanceId: number) =>
  apiFetch<{ ok: true; status: SendNumberStatus }>(`/api/integrations/whatsapp/default-send-instance?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ instance_id: instanceId }) })
export const fetchAntibanSettings = (accountId: number) =>
  apiFetch<{ settings: AntibanSettings }>(`/api/integrations/antiban-settings?account_id=${accountId}`).then(d => d.settings)
export const saveAntibanSettings = (accountId: number, data: Partial<AntibanSettings>) =>
  apiFetch<{ settings: AntibanSettings }>(`/api/integrations/antiban-settings?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.settings)

// Broadcasts
export const fetchBroadcasts = (accountId: number) => apiFetch<{ broadcasts: Broadcast[] }>(`/api/broadcasts?account_id=${accountId}`).then(d => d.broadcasts)
export const fetchBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast; recipients: BroadcastRecipient[] }>(`/api/broadcasts/${id}?account_id=${accountId}`)
export const createBroadcast = (accountId: number, data: { name: string; message_template: string; message_variations?: string[]; delay_seconds?: number; lead_ids: number[]; instance_id?: number; scheduled_at?: string | null }) => apiFetch(`/api/broadcasts?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) })
export const sendBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}/send?account_id=${accountId}`, { method: 'POST' })
export const resumeBroadcast = (id: number, accountId: number) => apiFetch(`/api/broadcasts/${id}/resume?account_id=${accountId}`, { method: 'POST' })
export const cancelScheduledBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast }>(`/api/broadcasts/${id}/cancel-schedule?account_id=${accountId}`, { method: 'POST' })
export const pauseBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast }>(`/api/broadcasts/${id}/pause?account_id=${accountId}`, { method: 'POST' })
export const cancelBroadcast = (id: number, accountId: number) => apiFetch<{ broadcast: Broadcast }>(`/api/broadcasts/${id}/cancel?account_id=${accountId}`, { method: 'POST' })
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
  business_hours_json?: string | null      // trava anti-bloqueio (whatsapp_instances); so leitura no GET
  hold_sends_outside_hours?: boolean       // PUT: grava o horario tambem na trava (true) ou libera 24h (false)
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
  apiFetch<{ last_lead_at: string | null; default_tag_id: number | null }>(`/api/integrations/sheets-status?account_id=${accountId}`)
export const setSheetsDefaultTag = (accountId: number, tagId: number | null) =>
  apiFetch<{ ok: boolean; default_tag_id: number | null }>(
    `/api/integrations/sheets-default-tag?account_id=${accountId}`,
    { method: 'PUT', body: JSON.stringify({ tag_id: tagId }) }
  )

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
// blocked: leads que nao moveram por perguntas obrigatorias pendentes (trava do roteiro)
export interface BulkMoveResult { ok: boolean; count: number; moved: number; blocked: { id: number; name: string | null; pending_count: number }[] }
export const bulkMoveLeads = (accountId: number, leadIds: number[], stageId: number) => apiFetch<BulkMoveResult>(`/api/leads/bulk/stage?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds, stage_id: stageId }) })

// Pipeline metrics
export const fetchPipelineMetrics = (accountId: number, funnelId: number, city?: string | null) => apiFetch<{ metrics: PipelineMetric[]; totalLeads: number }>(`/api/leads/pipeline/metrics?account_id=${accountId}&funnel_id=${funnelId}${cityQ(city)}`)

// =============================================
// Cadences (sequential contact workflows)
// =============================================

export interface CadenceAttempt { id: number; cadence_id: number; position: number; action_type: string; description: string | null; instructions: string | null; delay_days: number; scheduled_time: string | null; auto_message: string | null; schedule_mode: 'date' | 'duration'; delay_minutes: number; call_script?: string | null }
export interface Cadence { id: number; account_id: number; name: string; description: string | null; is_active: number; created_at: string; attempts: CadenceAttempt[]; stage_id?: number | null; funnel_id?: number | null }
export interface LeadCadence {
  id: number; lead_id: number; cadence_id: number; current_attempt_id: number | null; status: string; started_at: string
  cadence_name?: string; action_type?: string; attempt_description?: string; attempt_instructions?: string; attempt_message?: string | null; attempt_script?: string | null; attempt_position?: number; total_attempts?: number
}

export const fetchCadences = (accountId: number, kind?: 'avulsa' | 'etapa') => apiFetch<{ cadences: Cadence[] }>(`/api/cadences?account_id=${accountId}${kind ? `&kind=${kind}` : ''}`).then(d => d.cadences)
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
  agent_id?: number | null;  // se setado, follow-up agent-based (lead atendido pelo bot) em vez de stage-based
  optout_footer_enabled?: number;
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
// Templates Globais (Plano C) — super_admin only
// =============================================

export interface GlobalCadence {
  id: number; name: string; description: string | null; is_active: number;
  created_by: number | null; created_at: string; updated_at: string;
  attempts: Array<Omit<CadenceAttempt, 'cadence_id'> & { global_cadence_id?: number }>
  applied_count?: number
}

export interface GlobalFollowUp {
  id: number; name: string; description: string | null; stop_on_reply: number; is_active: number;
  type: 'sequence' | 'inactivity';
  inactivity_days?: number | null; inactivity_minutes?: number | null;
  inactivity_mode?: 'rotation' | 'sequence' | null;
  variation_delay_seconds: number;
  on_reply_action: 'pause' | 'roulette' | 'assign_user';
  created_by: number | null; created_at: string; updated_at: string;
  steps: Array<Omit<FollowUpStep, 'follow_up_id'> & { global_follow_up_id?: number }>
  applied_count?: number
}

export interface GlobalCadenceAppliedRow { cadence_id: number; cadence_name: string; account_id: number; account_name: string | null; created_at: string }
export interface GlobalFollowUpAppliedRow { follow_up_id: number; follow_up_name: string; account_id: number; account_name: string | null; instance_id: number | null; instance_name: string | null; agent_id: number | null; created_at: string }

export const fetchGlobalCadences = () => apiFetch<{ cadences: GlobalCadence[] }>('/api/global-templates/cadences').then(d => d.cadences)
export const fetchGlobalCadence = (id: number) => apiFetch<{ cadence: GlobalCadence }>(`/api/global-templates/cadences/${id}`).then(d => d.cadence)
export const createGlobalCadence = (data: { name: string; description?: string | null; attempts?: Partial<CadenceAttempt>[] }) => apiFetch<{ cadence: GlobalCadence }>('/api/global-templates/cadences', { method: 'POST', body: JSON.stringify(data) }).then(d => d.cadence)
export const updateGlobalCadence = (id: number, data: { name?: string; description?: string | null; is_active?: boolean }) => apiFetch(`/api/global-templates/cadences/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const updateGlobalCadenceAttempts = (id: number, attempts: Partial<CadenceAttempt>[]) => apiFetch(`/api/global-templates/cadences/${id}/attempts`, { method: 'PUT', body: JSON.stringify({ attempts }) })
export const deleteGlobalCadence = (id: number) => apiFetch(`/api/global-templates/cadences/${id}`, { method: 'DELETE' })
export const fetchGlobalCadenceAppliedIn = (id: number) => apiFetch<{ applied: GlobalCadenceAppliedRow[] }>(`/api/global-templates/cadences/${id}/applied-in`).then(d => d.applied)
export const applyGlobalCadence = (id: number, account_ids: number[], overwrite = false) => apiFetch<{ results: Array<{ account_id: number; account_name?: string; ok: boolean; error?: string; new_cadence_id?: number }> }>(`/api/global-templates/cadences/${id}/apply`, { method: 'POST', body: JSON.stringify({ account_ids, overwrite }) }).then(d => d.results)
export const promoteCadenceToGlobal = (cadenceId: number, opts: { name?: string; description?: string | null; mark_source?: boolean } = {}) => apiFetch<{ cadence: GlobalCadence }>(`/api/global-templates/cadences/from-account/${cadenceId}`, { method: 'POST', body: JSON.stringify(opts) }).then(d => d.cadence)

export const fetchGlobalFollowUps = () => apiFetch<{ follow_ups: GlobalFollowUp[] }>('/api/global-templates/follow-ups').then(d => d.follow_ups)
export const fetchGlobalFollowUp = (id: number) => apiFetch<{ follow_up: GlobalFollowUp }>(`/api/global-templates/follow-ups/${id}`).then(d => d.follow_up)
export const createGlobalFollowUp = (data: Partial<GlobalFollowUp> & { name: string; steps: Partial<FollowUpStep>[] }) => apiFetch<{ follow_up: GlobalFollowUp }>('/api/global-templates/follow-ups', { method: 'POST', body: JSON.stringify(data) }).then(d => d.follow_up)
export const updateGlobalFollowUp = (id: number, data: Partial<GlobalFollowUp> & { steps?: Partial<FollowUpStep>[] }) => apiFetch<{ follow_up: GlobalFollowUp }>(`/api/global-templates/follow-ups/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.follow_up)
export const deleteGlobalFollowUp = (id: number) => apiFetch(`/api/global-templates/follow-ups/${id}`, { method: 'DELETE' })
export const fetchGlobalFollowUpAppliedIn = (id: number) => apiFetch<{ applied: GlobalFollowUpAppliedRow[] }>(`/api/global-templates/follow-ups/${id}/applied-in`).then(d => d.applied)
export const applyGlobalFollowUp = (id: number, mappings: Array<{ account_id: number; instance_id: number; agent_id?: number | null; inactivity_stage_id?: number | null }>, overwrite = false) => apiFetch<{ results: Array<{ account_id: number; account_name?: string; ok: boolean; error?: string; new_follow_up_id?: number }> }>(`/api/global-templates/follow-ups/${id}/apply`, { method: 'POST', body: JSON.stringify({ mappings, overwrite }) }).then(d => d.results)

// Gerente/super_admin usar templates globais na conta atual (nao precisa admin fazer o apply)
export type GlobalTemplateAvailable = GlobalCadence & { applied_here: boolean; applied_cadence_id: number | null }
export type GlobalFollowUpAvailable = GlobalFollowUp & { applied_here: boolean; applied_follow_up_id: number | null }
export const fetchAvailableGlobalTemplates = (accountId: number) => apiFetch<{ cadences: GlobalTemplateAvailable[]; follow_ups: GlobalFollowUpAvailable[] }>(`/api/global-templates/available?account_id=${accountId}`)
export const applyGlobalCadenceHere = (globalId: number, accountId: number, overwrite = false) => apiFetch<{ ok: boolean; new_cadence_id?: number; error?: string }>(`/api/global-templates/cadences/${globalId}/apply-here?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ overwrite }) })
export const applyGlobalFollowUpHere = (globalId: number, accountId: number, opts: { instance_id: number; agent_id?: number | null; inactivity_stage_id?: number | null; overwrite?: boolean }) => apiFetch<{ ok: boolean; new_follow_up_id?: number; error?: string }>(`/api/global-templates/follow-ups/${globalId}/apply-here?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(opts) })

// =============================================
// Lead Handoff: first_msg_template + app-settings
// =============================================
export const updateInstanceFirstMsgTemplate = (instanceId: number, template: string | null) =>
  apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp/${instanceId}/first-msg-template`, { method: 'PUT', body: JSON.stringify({ first_msg_template: template }) }).then(d => d.instance)

export const fetchAppSettings = () =>
  apiFetch<{ settings: Record<string, string | null> }>('/api/app-settings').then(d => d.settings)

export const fetchAllInstancesAdmin = () =>
  apiFetch<{ instances: Array<{ id: number; instance_name: string; phone_number: string | null; status: string; account_id: number | null; account_name: string | null }> }>('/api/app-settings/all-instances').then(d => d.instances)

export const updateAppSetting = (key: string, value: string | null) =>
  apiFetch<{ ok: boolean; key: string; value: string | null }>(`/api/app-settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) })

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

export type AgentMode = 'auto' | 'copilot' | 'sdr'
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
  send_welcome_for_sheets_leads: number
  welcome_extra_instructions: string | null
  max_messages_before_handoff: number
  handoff_keywords: string
  activation_mode: AgentActivationMode
  mode: AgentMode
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
  send_welcome_for_sheets_leads?: boolean
  welcome_extra_instructions?: string | null
  max_messages_before_handoff?: number
  handoff_keywords?: string
  activation_mode?: AgentActivationMode
  mode?: AgentMode
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
  apiFetch<{ feature_enabled: boolean; has_api_key?: boolean; agents: Agent[] }>(`/api/agents?account_id=${accountId}`)

export const fetchAgent = (id: number, accountId: number) =>
  apiFetch<{ agent: Agent }>(`/api/agents/${id}?account_id=${accountId}`).then(d => d.agent)

export const createAgent = (accountId: number, data: AgentInput) =>
  apiFetch<{ agent: Agent }>(`/api/agents?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.agent)

export const updateAgent = (id: number, accountId: number, data: Partial<AgentInput>) =>
  apiFetch<{ agent: Agent }>(`/api/agents/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.agent)

export const deleteAgent = (id: number, accountId: number) =>
  apiFetch(`/api/agents/${id}?account_id=${accountId}`, { method: 'DELETE' })

// Toggle rapido pausar/reativar bot. Ao reativar, backend dispara replay da ultima msg pendente de cada lead.
export const toggleAgentActive = (id: number, accountId: number) =>
  apiFetch<{
    ok: boolean
    is_active: number
    replay?: { total: number; will_replay: number }
    released_leads?: number
  }>(`/api/agents/${id}/toggle-active?account_id=${accountId}`, { method: 'PATCH' })

export const fetchAgentUsage = (id: number, accountId: number) =>
  apiFetch<AgentUsage>(`/api/agents/${id}/usage?account_id=${accountId}`)

// Follow-up de inatividade vinculado ao agente (1:1)
export interface AgentInactivityFollowUpInput {
  enabled: boolean
  instance_id?: number | null
  inactivity_minutes?: number
  variation_delay_seconds?: number
  stop_on_reply?: boolean
  on_reply_action?: 'pause' | 'roulette' | 'assign_user'
  on_reply_user_id?: number | null
  steps: Array<{ delay_minutes: number; message_template: string }>
}
export const fetchAgentInactivityFollowUp = (agentId: number, accountId: number) =>
  apiFetch<{ follow_up: FollowUp | null }>(`/api/follow-ups/by-agent/${agentId}?account_id=${accountId}`).then(d => d.follow_up)
export const saveAgentInactivityFollowUp = (agentId: number, accountId: number, data: AgentInactivityFollowUpInput) =>
  apiFetch<{ ok: boolean; follow_up: FollowUp | null }>(`/api/agents/${agentId}/inactivity-followup?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) })

export const testAgent = (id: number, accountId: number, message: string, history: Array<{ role: 'user' | 'assistant'; content: string }> = []) =>
  apiFetch<{ response: string; usage: { input: number; output: number; cacheRead: number; cacheCreation: number; total: number }; cost_usd: number; stop_reason: string }>(`/api/agents/${id}/test?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ message, history }) })

// Copiloto: sugestao da IA na caixa do Chat + pausa da IA por conversa
export interface AiSuggestion {
  id: number
  account_id: number
  lead_id: number
  agent_id: number | null
  kind: 'reply' | 'follow_up'
  source: 'ai' | 'base'
  content: string
  status: 'pending' | 'sent' | 'edited' | 'discarded' | 'expired'
  final_content: string | null
  created_at: string
  resolved_at: string | null
  resolved_by: number | null
}
export const fetchPendingAiSuggestion = (leadId: number, accountId: number) =>
  apiFetch<{ suggestion: AiSuggestion | null }>(`/api/copilot/leads/${leadId}/suggestion?account_id=${accountId}`).then(d => d.suggestion)
export const resolveAiSuggestion = (id: number, accountId: number, action: 'sent' | 'discarded', finalContent?: string) =>
  apiFetch<{ suggestion: AiSuggestion }>(`/api/copilot/suggestions/${id}/resolve?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ action, final_content: finalContent }) })
export const pauseLeadAi = (leadId: number, accountId: number) =>
  apiFetch<{ lead_id: number; ai_paused_at: string | null }>(`/api/copilot/leads/${leadId}/pause?account_id=${accountId}`, { method: 'POST' })
export const resumeLeadAi = (leadId: number, accountId: number) =>
  apiFetch<{ lead_id: number; ai_paused_at: string | null }>(`/api/copilot/leads/${leadId}/resume?account_id=${accountId}`, { method: 'POST' })

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

// =============================================
// Conversation Intelligence V2
// =============================================

export interface OverviewV2 {
  by_city?: boolean
  cards: {
    conversas_analisadas: number
    score_medio: number | null
    sla_humano_pct: number | null
    leads_quentes_em_risco: number
    vendas_perdidas: number
    receita_em_risco: number
    erros_criticos_count: number
    proximas_acoes_pendentes: number
    bot_taxa_resolucao: number | null
    follow_ups_atrasados: number
  }
  days: number
}

export interface RankingRowV2 {
  user_id: number
  user_name: string
  role: 'atendente' | 'gerente'
  leads_assigned: number
  leads_responded: number
  leads_converted: number
  ttfr_human: number | null
  tmr_human: number | null
  under5: number
  idle24: number
  score_v2: number | null
  lost_sales: number
  quentes: number
  sla_5min_pct: number | null
  conversion_pct: number | null
  principal_erro: string | null
  principal_forte: string | null
}

export interface CriticalConversation {
  lead_id: number
  lead_name: string
  lead_phone: string
  attendant_name: string | null
  attendant_user_id: number | null
  temperatura_lead: 'frio' | 'morno' | 'quente' | null
  conversation_score: number | null
  summary: string
  prioridade_revisao: 'baixa' | 'media' | 'alta' | 'critica' | null
  mensagem_retomada: string | null
  suggested_next_step: string | null
  chance_conversao: number | null
  lost_sale_signals: string | null
  erro_critico: string | null
}

export interface ConversationErrorDetail {
  id: number
  actor_type: 'bot' | 'atendente' | 'gerente' | 'processo'
  code: string | null
  category: string | null
  gravity: 'baixa' | 'media' | 'alta' | 'critica'
  description: string
  impact: string | null
  how_to_fix: string | null
  evidence_message_ids: number[]
}

export interface ConversationStrengthDetail {
  id: number
  actor_type: 'bot' | 'atendente' | 'gerente' | 'processo'
  code: string | null
  description: string
  impact: string | null
  evidence_message_ids: number[]
}

export interface ParticipantAnalysis {
  actor_type: 'bot' | 'atendente' | 'gerente'
  actor_user_id: number | null
  actor_ai_agent_id: number | null
  actor_name: string
  score: number | null
  acertos_summary: string | null
  erros_summary: string | null
  recomendacao: string | null
}

export interface ConversationDetailV2 {
  insight: any  // shape detalhado preserva V1+V2
  errors: ConversationErrorDetail[]
  strengths: ConversationStrengthDetail[]
  participants: ParticipantAnalysis[]
}

export interface AnalystAlert {
  id: number
  account_id: number
  lead_id: number | null
  lead_name: string | null
  lead_phone: string | null
  insight_id: number | null
  type: 'lead_quente_abandonado' | 'proposta_sem_retorno' | 'erro_critico' | 'bot_falhou'
  severity: 'media' | 'alta' | 'critica'
  title: string
  description: string | null
  suggested_action: string | null
  assigned_to_user_id: number | null
  assigned_to_name: string | null
  status: 'open' | 'resolved' | 'dismissed'
  created_at: string
  resolved_at: string | null
}

export interface CoachingWeekly {
  id: number
  account_id: number
  user_id: number
  week_start: string
  summary: string
  strengths: string[]
  improvements: string[]
  conversations_to_review: number[]
  training_recommended: string
  suggested_script: string
  goal_next_week: string
  ai_score_avg_week: number | null
  cost_usd: number
  created_at: string
}

export interface MarketIntel {
  objecoes_top: Array<{ label: string; count: number }>
  motivos_perda_top: Array<{ label: string; count: number }>
  riscos_top: Array<{ label: string; count: number }>
  days: number
  sample_size: number
}

export interface AnalyzeEstimate {
  leads_pending_total: number
  leads_to_analyze: number
  leads_skipped?: number                // novo: ja em dia (puladas)
  leads_incremental?: number            // novo: total de incrementais pendentes
  leads_full?: number                   // novo: total de fulls pendentes
  leads_incremental_to_analyze?: number // novo: incrementais no batch
  leads_full_to_analyze?: number        // novo: fulls no batch
  estimated_cost_incremental_usd?: number  // novo
  estimated_cost_full_usd?: number         // novo
  estimated_cost_usd: number
  estimated_cost_all_usd: number
  month_spent_usd: number
  month_limit_usd: number
  account_has_flag: boolean
  is_super_admin_bypass: boolean
}

export const fetchOverviewV2 = (accountId: number, days: number = 30, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<OverviewV2>(`/api/dashboard/overview-v2?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`)
export const fetchRankingV2 = (accountId: number, days: number = 30, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<{ days: number; attendants: RankingRowV2[]; by_city?: boolean }>(`/api/dashboard/ranking-v2?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`)
export const fetchCriticalConversations = (accountId: number, days: number = 30, limit: number = 50, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<{ conversations: CriticalConversation[] }>(`/api/dashboard/critical-conversations?account_id=${accountId}&days=${days}&limit=${limit}${cityQ(city)}${fq(funnel)}`).then(d => d.conversations)
export const fetchConversationDetailV2 = (leadId: number, accountId: number) =>
  apiFetch<ConversationDetailV2>(`/api/dashboard/conversation-detail/${leadId}?account_id=${accountId}`)
export const fetchAlerts = (accountId: number, status: 'open' | 'resolved' | 'dismissed' = 'open', city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<{ alerts: AnalystAlert[] }>(`/api/dashboard/alerts?account_id=${accountId}&status=${status}${cityQ(city)}${fq(funnel)}`).then(d => d.alerts)
export const resolveAlert = (id: number, accountId: number, status: 'resolved' | 'dismissed' = 'resolved') =>
  apiFetch(`/api/dashboard/alerts/${id}/resolve?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ status }) })
export const assignAlert = (id: number, accountId: number, userId: number | null) =>
  apiFetch(`/api/dashboard/alerts/${id}/assign?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ user_id: userId }) })
export const fetchCoaching = (userId: number, accountId: number, weeks: number = 4) =>
  apiFetch<{ weekly: CoachingWeekly[] }>(`/api/dashboard/coaching/${userId}?account_id=${accountId}&weeks=${weeks}`).then(d => d.weekly)
export const generateCoachingNow = (userId: number, accountId: number) =>
  apiFetch<{ ok: boolean; week_start: string; message: string }>(`/api/dashboard/coaching/${userId}/generate?account_id=${accountId}`, { method: 'POST' })
export const fetchMarketIntel = (accountId: number, days: number = 30, city?: string | null, funnel?: FunnelValue | null) =>
  apiFetch<MarketIntel>(`/api/dashboard/market-intelligence?account_id=${accountId}&days=${days}${cityQ(city)}${fq(funnel)}`)
export const fetchAnalyzeEstimate = (accountId: number, days: number = 7, maxLeads: number = 50) =>
  apiFetch<AnalyzeEstimate>(`/api/dashboard/analyze-estimate?account_id=${accountId}&days=${days}&max=${maxLeads}`)
export const markProposalSent = (leadId: number, accountId: number) =>
  apiFetch(`/api/dashboard/leads/${leadId}/mark-proposal-sent?account_id=${accountId}`, { method: 'POST' })
export const updateLeadValue = (leadId: number, accountId: number, value: number) =>
  apiFetch(`/api/dashboard/leads/${leadId}/value?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ value_estimated: value }) })

// ================ Agente por entrevista (bloco 6) ================
export interface CompiledAgent {
  name: string
  persona: string
  knowledge_base: string
  never_mention: string
  qualification_criteria: string
  required_fields: string[]
  resumo: {
    quem_sou: string
    o_que_sei: string
    o_que_descubro: string[]
    o_que_nunca_falo: string[]
  }
}

export interface BriefingTurn { id: number; position: number; role: 'ia' | 'user'; content: string; created_at: string }
export interface BriefingSource { id: number; kind: 'entrevista' | 'site' | 'conversas' | 'colado'; ref: string | null; content: string | null; status: 'ok' | 'falhou'; error: string | null }
export interface AgentBriefing {
  id: number; account_id: number; agent_id: number | null
  status: 'entrevistando' | 'compilado' | 'ativo'
  compiled_json: string | null; compiled_at: string | null
  created_at: string; updated_at: string
  // 1 quando o briefing mudou depois da ultima compilacao: o resumo tem que
  // recompilar em vez de reaproveitar o compiled_json, senao a correcao some.
  precisa_recompilar: 0 | 1
  tokens_used: number
  turns: BriefingTurn[]; sources: BriefingSource[]
}
// Onde o atendente vai atender: o que a ativacao vai amarrar (ou o que o agente
// ja tem amarrado, quando o briefing ja virou agente).
export interface BriefingAtendimento { etapas: string[]; instancias: string[] }
export interface BriefingDraft { id: number; status: string; created_at: string; updated_at: string; first_answer: string | null }

// Todas as chamadas do briefing levam account_id, como as rotas de agente acima:
// o scopeToAccount deixa req.accountId NULO para super_admin sem esse parametro.
export const startBriefing = (accountId: number) =>
  apiFetch<{ briefing_id: number; question: string; done: boolean }>(`/api/agent-briefings?account_id=${accountId}`, { method: 'POST' })

export const answerBriefing = (id: number, accountId: number, text: string) =>
  apiFetch<{ done: boolean; question: string | null; reason: string | null }>(`/api/agent-briefings/${id}/answer?account_id=${accountId}`, {
    method: 'POST', body: JSON.stringify({ text }),
  })

// Usada quando a IA falha DEPOIS de a resposta ja ter sido gravada: pede so a
// proxima pergunta, sem reenviar o texto (reenviar duplicaria o turno).
export const retryNextQuestion = (id: number, accountId: number) =>
  apiFetch<{ done: boolean; question: string | null; reason: string | null }>(`/api/agent-briefings/${id}/next-question?account_id=${accountId}`, {
    method: 'POST',
  })

export const pasteIntoBriefing = (id: number, accountId: number, text: string) =>
  apiFetch<{ ok: true }>(`/api/agent-briefings/${id}/paste?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ text }) })

export const compileBriefing = (id: number, accountId: number) =>
  apiFetch<{ compiled: CompiledAgent }>(`/api/agent-briefings/${id}/compile?account_id=${accountId}`, { method: 'POST' })

export const activateBriefing = (id: number, accountId: number, mode: 'auto' | 'copilot' | 'sdr' = 'copilot', instanceIds: number[] = []) =>
  apiFetch<{ agent_id: number }>(`/api/agent-briefings/${id}/activate?account_id=${accountId}`, {
    method: 'POST', body: JSON.stringify({ mode, instance_ids: instanceIds }),
  })

export const fetchBriefing = (id: number, accountId: number) =>
  apiFetch<{ briefing: AgentBriefing; atendimento: BriefingAtendimento }>(`/api/agent-briefings/${id}?account_id=${accountId}`)

export const fetchBriefingDrafts = (accountId: number) =>
  apiFetch<{ drafts: BriefingDraft[] }>(`/api/agent-briefings?account_id=${accountId}`).then(r => r.drafts)

export const deleteBriefing = (id: number, accountId: number) =>
  apiFetch<{ ok: true }>(`/api/agent-briefings/${id}?account_id=${accountId}`, { method: 'DELETE' })

export const briefingFromAgent = (agentId: number, accountId: number) =>
  apiFetch<{ briefing_id: number }>(`/api/agent-briefings/from-agent/${agentId}?account_id=${accountId}`, { method: 'POST' })
// Vendas multiplas por lead (spec LTV/Recompra §5)
export type SaleKind = 'recompra' | 'unica'
export const REMIND_DAYS = [7, 15, 30, 45, 60] as const
export interface LeadSale {
  id: number; lead_id: number; value: number; sale_date: string; notes: string | null
  created_by: number | null; created_by_name: string | null; created_at: string
  product: string | null; sale_kind: SaleKind | null; remind_days: number | null; cross_sell: number; cross_sell_offer: string | null
}
export interface NewSaleInput {
  value: number; sale_date?: string; notes?: string; product?: string
  sale_kind: SaleKind; remind_days?: number; cross_sell?: boolean; cross_sell_offer?: string
}
export const fetchLeadSales = (leadId: number, accountId: number) =>
  apiFetch<{ sales: LeadSale[]; total: number }>(`/api/leads/${leadId}/sales?account_id=${accountId}`)
export const addLeadSale = (leadId: number, accountId: number, input: NewSaleInput) =>
  apiFetch<{ sale: LeadSale; total: number; cycle_id: number | null; opt_out: boolean }>(`/api/leads/${leadId}/sales?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(input) })
export const patchLeadSale = (leadId: number, accountId: number, saleId: number, input: Partial<NewSaleInput>) =>
  apiFetch<{ sale: LeadSale }>(`/api/leads/${leadId}/sales/${saleId}?account_id=${accountId}`, { method: 'PATCH', body: JSON.stringify(input) })
export const deleteLeadSale = (leadId: number, saleId: number, accountId: number) =>
  apiFetch<{ ok: boolean; total: number }>(`/api/leads/${leadId}/sales/${saleId}?account_id=${accountId}`, { method: 'DELETE' })

// Cartao do cliente (tela Clientes / spec §10) — LTV, curva, selo, ciclo de recompra aberto
export interface CustomerCardData {
  ltv: number; purchases: number; lastPurchaseAt: string | null; curve: 'A' | 'B' | 'C' | 'D' | '1a' | null
  tier: { id: number; name: string; icon: string | null; color: string } | null
  cycle: {
    id: number; kind: 'recompra' | 'cruzada'; status: string; remind_at: string; remind_days: number
    attempt: number; exhausted: number; offer_text: string | null
    ai_suggestion: { products: string[]; message: string } | null; auto_failed_reason: string | null
  } | null
  reasons: { nao_agora: { id: number; label: string }[]; nao_quer: { id: number; label: string }[] }
  optOut: boolean; maxAttempts: number
}
export function fetchCustomerCard(leadId: number, accountId: number) {
  return apiFetch<CustomerCardData>(`/api/customers/lead/${leadId}?account_id=${accountId}`)
}
export function postRepurchaseOutcome(leadId: number, accountId: number, body: { outcome: 'nao_agora' | 'nao_quer'; reason_id: number; next_days?: number }) {
  return apiFetch<{ cycle: unknown }>(`/api/customers/lead/${leadId}/outcome?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(body) })
}
export function undoRepurchaseOptOut(leadId: number, accountId: number) {
  return apiFetch<{ ok: true }>(`/api/customers/lead/${leadId}/undo-optout?account_id=${accountId}`, { method: 'POST' })
}

// =============================================
// Tela Clientes (spec LTV/Recompra §10.2/§12) — visao geral, lista, funil de recompra e parados.
// Filtros combinam geoParams(cityFilter) + customerParams(customerFilter) (curva/selo/atrasado).
// =============================================
export interface CustomerOverview {
  clients: number; ltvAvg: number; ticketAvg: number; purchasesAvg: number; repeatPct: number
  byCurve: Record<string, { count: number; ltv: number }>
  byTier: { id: number; name: string; icon: string | null; color: string; count: number; ltv: number }[]
  repurchase: { medianDays: number | null; markedDays: number | null; cases: number; suggestion: number | null }
}
export interface CustomerRow {
  id: number; name: string | null; phone: string | null; ltv: number; purchases: number
  last_purchase_at: string | null; curve: 'A' | 'B' | 'C' | 'D' | '1a' | null; tier_id: number | null
  attendant_id: number | null; attendant_name: string | null
  tier_name: string | null; tier_icon: string | null; tier_color: string | null
  cycle_status: 'aguardando' | 'a_contatar' | 'em_conversa' | null; remind_at: string | null
  attempt: number | null; cycle_kind: 'recompra' | 'cruzada' | null; exhausted: number | null
}
export interface CustomerTier { id: number; account_id: number; name: string; icon: string | null; color: string; min_ltv: number }
export interface RepurchaseReasonCount { id: number; label: string; count: number }
export interface RepurchaseStats {
  contacted: number; conversa: number; comprou: number; naoAgora: number; naoQuer: number
  reasons: { nao_agora: RepurchaseReasonCount[]; nao_quer: RepurchaseReasonCount[] }
  byAttempt: { '1': number; '2': number; '3': number; '4+': number }
  byKind: { recompra: { total: number; comprou: number }; cruzada: { total: number; comprou: number } }
  byAuto: { auto: { total: number; comprou: number }; manual: { total: number; comprou: number } }
}
export interface StaleBand { band: '30-60' | '61-90' | '91-180' | '181+'; curve: string | null; tierId: number | null; count: number; ltv: number; leadIds: number[] }
export interface StaleCustomerRow { id: number; name: string | null; ltv: number; purchases: number; curve: string | null; tier_id: number | null; last_purchase_at: string | null }
export interface StaleStats {
  late: { count: number; value: number; rows: StaleCustomerRow[] }
  bands: StaleBand[]
}

function customerQuery(accountId: number, params: Record<string, any> = {}) {
  const q = new URLSearchParams({ account_id: String(accountId) })
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, String(v)) })
  return q
}
export const fetchCustomersOverview = (accountId: number, params: Record<string, any> = {}) =>
  apiFetch<CustomerOverview>(`/api/customers/overview?${customerQuery(accountId, params)}`)
export const fetchCustomersList = (accountId: number, params: Record<string, any> = {}) =>
  apiFetch<{ rows: CustomerRow[]; total: number }>(`/api/customers/list?${customerQuery(accountId, params)}`)
export const fetchRepurchaseStats = (accountId: number, params: Record<string, any> = {}) =>
  apiFetch<RepurchaseStats>(`/api/customers/repurchase?${customerQuery(accountId, params)}`)
export const fetchStaleStats = (accountId: number, params: Record<string, any> = {}) =>
  apiFetch<StaleStats>(`/api/customers/stale?${customerQuery(accountId, params)}`)
export const createStaleTasks = (accountId: number, leadIds: number[]) =>
  apiFetch<{ created: number }>(`/api/customers/stale/tasks?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ lead_ids: leadIds }) })
export const fetchTiers = (accountId: number) =>
  apiFetch<{ tiers: CustomerTier[] }>(`/api/customers/tiers?account_id=${accountId}`).then(d => d.tiers)
export const createTier = (accountId: number, input: { name: string; icon?: string | null; color: string; min_ltv: number }) =>
  apiFetch<{ tier: CustomerTier }>(`/api/customers/tiers?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(input) }).then(d => d.tier)
export const updateTier = (accountId: number, id: number, input: { name: string; icon?: string | null; color: string; min_ltv: number }) =>
  apiFetch<{ tier: CustomerTier }>(`/api/customers/tiers/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(input) }).then(d => d.tier)
export const deleteTier = (accountId: number, id: number) =>
  apiFetch<{ ok: true }>(`/api/customers/tiers/${id}?account_id=${accountId}`, { method: 'DELETE' })

// =============================================
// Configuracoes "Clientes" (spec LTV/Recompra §10.1) — curva por ritmo, limite de tentativas
// e chave de lembretes automaticos (so gestor/admin muda, GET disponivel para todos).
// =============================================
export interface CustomerSettings {
  curve: { a: number; b: number; c: number }
  maxAttempts: number
  autoSend: boolean
  autoAvailable: { ok: boolean; reason?: string }
}
export interface CustomerSettingsPatch {
  curve?: { a: number; b: number; c: number }
  maxAttempts?: number
  autoSend?: boolean
}
export const fetchCustomerSettings = (accountId: number) =>
  apiFetch<CustomerSettings>(`/api/customers/settings?account_id=${accountId}`)
export const saveCustomerSettings = (accountId: number, patch: CustomerSettingsPatch) =>
  apiFetch<CustomerSettings>(`/api/customers/settings?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(patch) })

export const fetchKeywordSignalSettings = (accountId: number) =>
  apiFetch<{ keyword_signal_ghost_hours: number }>(`/api/accounts/${accountId}/keyword-signals`)
export const saveKeywordSignalSettings = (accountId: number, hours: number) =>
  apiFetch<{ keyword_signal_ghost_hours: number }>(`/api/accounts/${accountId}/keyword-signals`, { method: 'PUT', body: JSON.stringify({ keyword_signal_ghost_hours: hours }) })

export interface RepurchaseReason { id: number; account_id: number; grp: 'nao_agora' | 'nao_quer'; label: string; position: number; is_active: number }
export const fetchReasons = (accountId: number) =>
  apiFetch<{ reasons: RepurchaseReason[] }>(`/api/customers/reasons?account_id=${accountId}`).then(d => d.reasons)
export const createReason = (accountId: number, input: { grp: 'nao_agora' | 'nao_quer'; label: string }) =>
  apiFetch<{ reason: RepurchaseReason }>(`/api/customers/reasons?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(input) }).then(d => d.reason)
export const updateReason = (accountId: number, id: number, patch: Partial<{ label: string; is_active: boolean; position: number }>) =>
  apiFetch<{ reason: RepurchaseReason }>(`/api/customers/reasons/${id}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(patch) }).then(d => d.reason)

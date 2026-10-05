// Chamadas de /api/roteiro (spec 7.3). Todas levam ?account_id= (super_admin precisa dele).
// Formatos conferidos em server/routes/roteiroRouter.js e server/services/roteiro/*.
import { apiFetch, type RoteiroOption, type RoteiroPendingQuestion } from './api'
import type { ScoreBand } from './score'

export type { RoteiroOption, RoteiroPendingQuestion }
export { RoteiroGateError } from './api'

export type RoteiroQuestionKind = 'text' | 'options'
export type SpinKey = 'situation' | 'problem' | 'implication' | 'need_payoff'

// ---------------------------------------------------------------- vendedor ----

export interface RoteiroAnswer {
  option_key: string | null
  option_label: string | null
  answer_text: string | null
  origin: 'manual' | 'ia'
  evidence: string | null // trecho da conversa quando a IA respondeu
  answered_by: number | null
  answered_by_name: string | null
  answered_at: string
}

// Estado de uma pergunta para o lead
export interface QState {
  question_key: string
  text: string // texto cru (pode ter {nome})
  text_for_lead: string // versao A/B do lead com {nome} resolvido — vai para a caixa de mensagem
  variant: 'A' | 'B'
  kind: RoteiroQuestionKind
  required: boolean
  spin: SpinKey | null
  profile_key: string | null // perfil de cliente para o qual a pergunta vale (null = todos)
  options: RoteiroOption[]
  answer: RoteiroAnswer | null
  last_ask: { asked_at: string; replied_at: string | null } | null
}

export interface LeadRoteiroStage {
  id: number
  name: string
  position: number
  is_terminal: boolean
  is_current: boolean
  questions: QState[]
}

export interface LegacyAnswer { question_key: string; answer_text: string | null; answered_at: string }

// Roteiro do lead sem os campos de tela (volta assim de PUT answers e undo-advance)
export interface LeadRoteiroBase {
  funnel_id: number | null
  stage_id: number | null
  has_roteiro: boolean
  stages: LeadRoteiroStage[]
  next_question_key: string | null
  progress: { answered: number; total: number }
  legacy_answers: LegacyAnswer[]
  profile: { key: string | null; origin: 'ia' | 'manual' | null } // perfil de cliente que vale para o lead
}

export interface RoteiroDeviation { triggers: string; reply_text: string; return_question_key: string | null; position: number }
export interface ActiveDeviation extends RoteiroDeviation { return_question_text: string | null }

export interface LeadRoteiro extends LeadRoteiroBase {
  deviation: ActiveDeviation | null
  can_force: boolean // gestor/admin: pode "avancar mesmo assim" e montar o roteiro
}

export interface RoteiroAdvance { from: number; to: number; to_name: string }
// SSE lead:roteiro {lead_id, offscript, advanced}: pergunta fora do roteiro vista pela IA;
// advanced (RoteiroAdvance) quando a IA completou a etapa e o lead avancou
export interface RoteiroOffscript { question: string; suggested_reply: string }

export type GateResult = { ok: true } | { ok: false; pending: RoteiroPendingQuestion[] }

const lp = (leadId: number) => `/api/roteiro/leads/${leadId}`

export const fetchLeadRoteiro = (leadId: number, accountId: number) =>
  apiFetch<LeadRoteiro>(`${lp(leadId)}?account_id=${accountId}`)

export const saveLeadAnswer = (leadId: number, accountId: number, questionKey: string, body: { option_key?: string; answer_text?: string }) =>
  apiFetch<{ roteiro: LeadRoteiroBase; advanced: RoteiroAdvance | null }>(
    `${lp(leadId)}/answers/${encodeURIComponent(questionKey)}?account_id=${accountId}`,
    { method: 'PUT', body: JSON.stringify(body) },
  )

// "Voce perguntou X? [Sim]": registra a pergunta enviada (reconhecida) ligada a mensagem
export const confirmAsk = (leadId: number, accountId: number, questionKey: string, messageId: number) =>
  apiFetch<{ ask_id: number }>(`${lp(leadId)}/asks?account_id=${accountId}`, {
    method: 'POST', body: JSON.stringify({ question_key: questionKey, message_id: messageId }),
  })

export const undoAdvance = (leadId: number, accountId: number) =>
  apiFetch<{ roteiro: LeadRoteiroBase; result: { moved: boolean; fromStageId: number; toStageId: number; historyId: number } }>(
    `${lp(leadId)}/undo-advance?account_id=${accountId}`, { method: 'POST' },
  )

export const fetchGate = (leadId: number, accountId: number, toStageId: number) =>
  apiFetch<GateResult>(`${lp(leadId)}/gate?account_id=${accountId}&to_stage_id=${toStageId}`)

// ------------------------------------------------------------------ gestor ----

export interface RoteiroQuestion {
  question_key: string
  stage_id: number
  position: number
  text: string
  kind: RoteiroQuestionKind
  required: boolean
  spin: SpinKey | null
  profile_key: string | null
  ai_hint: string | null
  options: RoteiroOption[]
}

export interface RoteiroVersion {
  id: number
  version: number
  status: 'draft' | 'published' | 'archived'
  published_at: string | null
  questions: RoteiroQuestion[]
  deviations: RoteiroDeviation[]
}

export interface RoteiroFunnelStage { id: number; name: string; position: number; is_terminal: boolean; is_conversion: boolean }

export interface RoteiroFunnel {
  funnel: { id: number; name: string }
  stages: RoteiroFunnelStage[]
  draft: RoteiroVersion | null
  published: RoteiroVersion | null
  versions: { id: number; version: number; status: 'draft' | 'published' | 'archived'; published_at: string | null }[]
}

// Rascunho salvo inteiro. question_key/option_key vazios: o servidor gera.
export interface RoteiroDraftInput {
  questions: (Omit<RoteiroQuestion, 'question_key' | 'options'> & {
    question_key?: string
    options: (Omit<RoteiroOption, 'option_key' | 'position'> & { option_key?: string; position?: number })[]
  })[]
  deviations: (Omit<RoteiroDeviation, 'position'> & { position?: number })[]
}

export interface SellerMetric { user_id: number; name: string | null; sent: number; reply_rate: number | null; examples: string[] }
export interface QuestionMetric {
  question_key: string
  text: string
  stage_id: number
  sent: number
  reply_rate: number | null // % (null sem envios)
  advanced_rate: number | null
  bought_rate: number | null
  status: 'ok' | 'fraca' | 'amostra_pequena'
  by_seller: SellerMetric[]
}
export interface RoteiroPerformance {
  questions: QuestionMetric[]
  conversion: { bands: { band: ScoreBand; leads: number; bought: number; rate: number | null }[]; warning: boolean }
}

export interface RoteiroSettings { min_reply_rate: number; reply_window_h: number; alert_minutes: number }

export type SuggestionType = 'rewrite' | 'seller_phrasing' | 'new_option' | 'new_deviation' | 'reorder'
export interface RoteiroSuggestion {
  id: number
  funnel_id: number | null
  question_key: string | null
  type: SuggestionType
  payload: Record<string, any>
  evidence: Record<string, any> | null
  status: 'new'
  created_at: string
}
export interface RoteiroVariantRow {
  id: number
  account_id?: number
  question_key: string
  text: string
  status: 'testing' | 'won' | 'lost' | 'cancelled'
  started_at: string
  ended_at: string | null
  suggestion_id: number | null
}
// Resumo do teste para a tela: funil, texto atual (A), envios/taxa de A e B, dias restantes e se ja foi decidido
export interface RoteiroTestSummary {
  funnel_id: number | null
  current_text: string | null
  a: { sent: number; rate: number | null }
  b: { sent: number; rate: number | null }
  days_left: number
  decided: boolean
}
export type RoteiroTest = Omit<RoteiroVariantRow, 'account_id'> & RoteiroTestSummary
export interface RoteiroSuggestions { suggestions: RoteiroSuggestion[]; tests: RoteiroTest[] }

const fp = (funnelId: number) => `/api/roteiro/funnels/${funnelId}`

export const fetchRoteiro = (funnelId: number, accountId: number) =>
  apiFetch<RoteiroFunnel>(`${fp(funnelId)}?account_id=${accountId}`)

export const saveDraft = (funnelId: number, accountId: number, draft: RoteiroDraftInput) =>
  apiFetch<RoteiroVersion>(`${fp(funnelId)}/draft?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(draft) })

export const publishRoteiro = (funnelId: number, accountId: number) =>
  apiFetch<RoteiroVersion>(`${fp(funnelId)}/publish?account_id=${accountId}`, { method: 'POST' })

// Copia a versao escolhida para o rascunho (publicar continua manual)
export const restoreVersion = (versionId: number, accountId: number) =>
  apiFetch<RoteiroVersion>(`/api/roteiro/versions/${versionId}/restore?account_id=${accountId}`, { method: 'POST' })

// Soma as perguntas do modelo SPIN cujas fases faltarem ao rascunho
export const spinTemplate = (funnelId: number, accountId: number) =>
  apiFetch<RoteiroVersion>(`${fp(funnelId)}/spin-template?account_id=${accountId}`, { method: 'POST' })

// ------------------------------------------------ negocio e perfis de cliente ----

export interface RoteiroProfile { profile_key: string; name: string; description: string | null; position: number }
export interface Business { business_objective: string | null; profiles: RoteiroProfile[] }
export interface BusinessInput { business_objective: string | null; profiles: { profile_key?: string; name: string; description: string | null }[] }

export const fetchBusiness = (accountId: number) => apiFetch<Business>(`/api/roteiro/profiles?account_id=${accountId}`)
export const saveBusiness = (accountId: number, body: BusinessInput) =>
  apiFetch<Business>(`/api/roteiro/profiles?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(body) })
// IA propoe objetivo + perfis a partir das conversas; nada e gravado ate o [Salvar]
export const suggestBusiness = (accountId: number) =>
  apiFetch<{ business_objective: string | null; profiles: { name: string; description: string }[] }>(`/api/roteiro/profiles/suggest?account_id=${accountId}`, { method: 'POST' })

export interface LeadProfileView {
  profile_key: string | null
  origin: 'ia' | 'manual' | null
  effective_key: string | null // com 1 perfil na conta, vale o unico mesmo sem escolha
  profiles: { profile_key: string; name: string }[]
}
export const fetchLeadProfile = (leadId: number, accountId: number) =>
  apiFetch<LeadProfileView>(`${lp(leadId)}/roteiro-profile?account_id=${accountId}`)
export const saveLeadProfile = (leadId: number, accountId: number, profileKey: string | null) =>
  apiFetch<LeadProfileView>(`${lp(leadId)}/roteiro-profile?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ profile_key: profileKey }) })

// Montar com IA: SUBSTITUI o rascunho inteiro (confirmar antes se ja houver rascunho).
// 503 sem IA na conta; 502 quando a IA nao respondeu.
// AiUnavailableError: 503 = a conta nao tem IA ligada (a tela desliga o botao e explica onde ligar).
export class AiUnavailableError extends Error {}
export async function aiDraft(funnelId: number, accountId: number): Promise<RoteiroVersion> {
  // mesma base do apiFetch (vite: /crm/)
  const base = String((import.meta as any).env?.BASE_URL ?? '/').replace(/\/$/, '')
  const res = await fetch(`${base}${fp(funnelId)}/ai-draft?account_id=${accountId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('dros_crm_token')}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 401) { localStorage.removeItem('dros_crm_token'); window.location.href = `${base}/login`; throw new Error('Unauthorized') }
  const data = await res.json().catch(() => ({}))
  if (res.status === 503) throw new AiUnavailableError(data.error || 'A IA não está ligada nesta conta.')
  if (!res.ok) throw new Error(data.error || `API error: ${res.status}`)
  return data as RoteiroVersion
}

export const fetchPerformance = (funnelId: number, accountId: number) =>
  apiFetch<RoteiroPerformance>(`/api/roteiro/performance?account_id=${accountId}&funnel_id=${funnelId}`)

export type ConversionByBand = RoteiroPerformance['conversion']
export const fetchConversionByBand = (accountId: number) =>
  apiFetch<ConversionByBand>(`/api/roteiro/conversion-by-band?account_id=${accountId}`)

export const fetchRoteiroSettings = (accountId: number) =>
  apiFetch<RoteiroSettings>(`/api/roteiro/settings?account_id=${accountId}`)

// Salva os 3 campos juntos (o servidor recusa com 400 se faltar ou sair da faixa)
export const saveRoteiroSettings = (accountId: number, settings: RoteiroSettings) =>
  apiFetch<RoteiroSettings>(`/api/roteiro/settings?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(settings) })

export const fetchSuggestions = (accountId: number) =>
  apiFetch<RoteiroSuggestions>(`/api/roteiro/suggestions?account_id=${accountId}`)

export type SuggestionActionResult =
  | { variant: RoteiroVariantRow } // test
  | { draft: RoteiroVersion } // apply
  | { ok: true } // reject

// test: body opcional { version_index } (qual das 2 versoes da IA vira a B)
export function suggestionAction(id: number, accountId: number, action: 'test', body?: { version_index?: number }): Promise<{ variant: RoteiroVariantRow }>
export function suggestionAction(id: number, accountId: number, action: 'apply'): Promise<{ draft: RoteiroVersion }>
export function suggestionAction(id: number, accountId: number, action: 'reject'): Promise<{ ok: true }>
export function suggestionAction(id: number, accountId: number, action: 'test' | 'apply' | 'reject', body?: Record<string, unknown>): Promise<SuggestionActionResult> {
  return apiFetch<SuggestionActionResult>(`/api/roteiro/suggestions/${id}/${action}?account_id=${accountId}`, {
    method: 'POST', body: body ? JSON.stringify(body) : undefined,
  })
}

// confirm: publica a vencedora ({published:false} quando a B perdeu/empatou); keep: mantem a atual
export function variantAction(id: number, accountId: number, action: 'confirm'): Promise<{ published: boolean; version?: RoteiroVersion }>
export function variantAction(id: number, accountId: number, action: 'keep'): Promise<{ ok: true }>
export function variantAction(id: number, accountId: number, action: 'confirm' | 'keep'): Promise<{ published: boolean; version?: RoteiroVersion } | { ok: true }> {
  return apiFetch(`/api/roteiro/variants/${id}/${action}?account_id=${accountId}`, { method: 'POST' })
}

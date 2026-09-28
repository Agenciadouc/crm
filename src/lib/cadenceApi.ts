// Chamadas de /api/cadences (cadencia da etapa e avulsas). Todas levam ?account_id=.
// Formatos conferidos em server/routes/cadencesRouter.js e server/services/cadence/*.
import { apiFetch } from './api'
import type { RoteiroQuestion, RoteiroDeviation, QState, ActiveDeviation, BantKey, RoteiroQuestionKind, SellerMetric } from './roteiroApi'

export type StepType = 'pergunta' | 'mensagem' | 'ligacao' | 'email' | 'reuniao' | 'whatsapp' | 'visita'

export interface CadenceStep {
  id: number; cadence_id: number; position: number; action_type: StepType
  description: string | null; instructions: string | null; auto_message: string | null; call_script: string | null
  scheduled_time: string | null; delay_days: number; delay_minutes: number; schedule_mode: 'date' | 'duration'
  question_key: string | null; question: RoteiroQuestion | null
  orphan?: boolean // pergunta que saiu do roteiro publicado: a tela so oferece apagar
}
export interface StageCadence {
  id: number; account_id: number; name: string; description: string | null; is_active: number
  funnel_id: number | null; stage_id: number | null; attempts: CadenceStep[]
}
export interface StageViewStage {
  id: number; name: string; position: number; is_terminal: boolean; cadence: StageCadence | null
  summary: { steps: number; questions: number }; followups: { id: number; name: string }[]
}
export interface StageView {
  funnel: { id: number; name: string }; stages: StageViewStage[]; deviations: RoteiroDeviation[]
  questions: { question_key: string; text: string; stage_id: number }[]
}
export interface QuestionInput {
  text: string; kind: RoteiroQuestionKind; required: boolean; bant: BantKey | null; ai_hint: string | null
  options: { option_key?: string; label: string; points: number; position?: number }[]
}
export interface StepInput {
  action_type: StepType; description?: string | null; instructions?: string | null; auto_message?: string | null
  call_script?: string | null; delay_days?: number; position?: number; question?: QuestionInput
}
export type StepPatch = Partial<Omit<StepInput, 'position'>>
export interface StepSaveResult { cadence: StageCadence; step_id: number; published: boolean }
export type StepMetric =
  | { attempt_id: number; kind: 'resposta'; sent: number; reply_rate: number | null; advanced_rate: number | null; bought_rate: number | null; status: 'ok' | 'fraca' | 'amostra_pequena'; by_seller: SellerMetric[] }
  | { attempt_id: number; kind: 'feitas'; done: number; reached: number }

export interface LeadStep {
  attempt_id: number; position: number; action_type: StepType; description: string | null; instructions: string | null
  auto_message: string | null; call_script: string | null; delay_days: number; question_key: string | null
  state: 'feito' | 'aguardando' | 'pendente'; how: 'respondida' | 'enviado' | 'feito' | 'pulado' | null
  done_at: string | null; done_by_name: string | null; question: QState | null; orphan?: boolean
}
export interface LeadStageCadence {
  lead_id: number; stage: { id: number; name: string } | null
  lead_cadence: { id: number; cadence_id: number; cadence_name: string | null; status: 'active' | 'completed' | 'paused'; started_at: string } | null
  steps: LeadStep[]; next_attempt_id: number | null; done_count: number; total: number
  deviation: ActiveDeviation | null; can_force: boolean
}

const acc = (accountId: number) => `account_id=${accountId}`
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const fetchStageView = (funnelId: number, accountId: number) =>
  apiFetch<StageView>(`/api/cadences/stage-view?funnel_id=${funnelId}&${acc(accountId)}`)
export const createStageCadence = (stageId: number, accountId: number) =>
  apiFetch<{ cadence: StageCadence }>(`/api/cadences?${acc(accountId)}`, post({ stage_id: stageId })).then(d => d.cadence)
export const addCadenceStep = (cadenceId: number, accountId: number, input: StepInput) =>
  apiFetch<StepSaveResult>(`/api/cadences/${cadenceId}/steps?${acc(accountId)}`, post(input))
export const updateCadenceStep = (cadenceId: number, stepId: number, accountId: number, patch: StepPatch) =>
  apiFetch<StepSaveResult>(`/api/cadences/${cadenceId}/steps/${stepId}?${acc(accountId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteCadenceStep = (cadenceId: number, stepId: number, accountId: number) =>
  apiFetch<{ cadence: StageCadence; published: boolean }>(`/api/cadences/${cadenceId}/steps/${stepId}?${acc(accountId)}`, { method: 'DELETE' })
export const reorderCadenceSteps = (cadenceId: number, accountId: number, attemptIds: number[]) =>
  apiFetch<{ cadence: StageCadence; published: boolean }>(`/api/cadences/${cadenceId}/steps/order?${acc(accountId)}`, { method: 'PUT', body: JSON.stringify({ attempt_ids: attemptIds }) })
export const fetchStepMetrics = (cadenceId: number, accountId: number) =>
  apiFetch<{ steps: StepMetric[] }>(`/api/cadences/${cadenceId}/metrics?${acc(accountId)}`).then(d => d.steps)
export const saveStageDeviations = (funnelId: number, accountId: number, deviations: RoteiroDeviation[]) =>
  apiFetch<{ deviations: RoteiroDeviation[]; published: boolean }>(`/api/cadences/funnels/${funnelId}/deviations?${acc(accountId)}`, { method: 'PUT', body: JSON.stringify({ deviations }) })
export const stageTemplate = (funnelId: number, stageId: number, accountId: number, mode: 'bant' | 'ia') =>
  apiFetch<{ cadence: StageCadence }>(`/api/cadences/funnels/${funnelId}/stages/${stageId}/template?${acc(accountId)}`, post({ mode })).then(d => d.cadence)
export const applySuggestionLive = (id: number, accountId: number) =>
  apiFetch<{ published: true; funnel_id: number; cadence_ids: number[] }>(`/api/cadences/suggestions/${id}/apply?${acc(accountId)}`, post())
export const confirmVariantLive = (id: number, accountId: number) =>
  apiFetch<{ published: boolean; cadence_ids: number[] }>(`/api/cadences/variants/${id}/confirm?${acc(accountId)}`, post())
export const fetchLeadStageCadence = (leadId: number, accountId: number) =>
  apiFetch<LeadStageCadence>(`/api/cadences/lead/${leadId}/stage?${acc(accountId)}`)
export const markLeadStepDone = (leadId: number, attemptId: number, accountId: number, how: 'feito' | 'pulado' = 'feito') =>
  apiFetch<LeadStageCadence>(`/api/cadences/lead/${leadId}/steps/${attemptId}/done?${acc(accountId)}`, post({ how }))

// IA desligada na conta (503 code 'ai_off'): a tela desliga o botao e explica onde ligar
export const isAiOff = (e: unknown) => {
  const err = e as { status?: number; code?: string; message?: string } | null
  return !!err && (err.code === 'ai_off' || (err.status === 503 && err.message === 'A IA não está ligada nesta conta.'))
}
export const AI_OFF_TEXT = 'Ligue a IA em Integrações > IA'

import type { CadenceStep, StepMetric, StepPatch, StepType, StageViewStage } from './cadenceApi'
import type { RoteiroSuggestion, RoteiroTest } from './roteiroApi'

export const STEP_TYPES: { value: StepType; label: string }[]
export function stepLabel(type: string): string
export function stageChipLabel(stage: Pick<StageViewStage, 'name' | 'summary'>): string
export function stageChipTitle(stage: Pick<StageViewStage, 'summary'>): string
export function stageSummary(cadence: { attempts: { action_type: string }[] } | null | undefined): { steps: number; questions: number }
export function stepShortText(step: Partial<CadenceStep> & { action_type: string }, max?: number): string
export function stepDayText(step: { schedule_mode?: string; delay_days?: number; delay_minutes?: number }): string
export function metricBadge(m: StepMetric | null | undefined): { text: string; tone: 'good' | 'bad' | 'muted' } | null
export function metricWhy(m: StepMetric | null | undefined, opts: { windowH: number; minRate: number }): string
export function moveStep(ids: number[], id: number, dir: -1 | 1): number[]
export function dropStep(ids: number[], dragId: number | null, overId: number): number[]
export interface OptionForm { option_key?: string; label: string; points: string; sets_profile_key?: string | null }
export const SPIN_OPTIONS: { value: 'situation' | 'problem' | 'implication' | 'need_payoff'; label: string }[]
export interface StepForm {
  text: string; required: boolean; kind: 'text' | 'options'; options: OptionForm[]; spin: string | null; profile_key: string | null; ai_hint: string
  auto_message: string; description: string; instructions: string; call_script: string; delay_days: number | string
}
export function formFromStep(step: Partial<CadenceStep>): StepForm
export function stepPatchFor(type: StepType, form: StepForm): { ok: true; patch: StepPatch } | { ok: false; reason: string }
export type SaveStatus = 'idle' | 'pendente' | 'salvando' | 'salvo' | 'erro'
export interface SaveQueue<P> { push(payload: P): void; flush(): Promise<void>; retry(): Promise<void>; busy(): boolean }
export function createSaveQueue<P>(opts: {
  save: (payload: P) => Promise<unknown>; delayMs?: number; onStatus?: (s: SaveStatus) => void
  setTimer?: (fn: () => void, ms: number) => any; clearTimer?: (t: any) => void
}): SaveQueue<P>
export function saveStatusLabel(status: SaveStatus): string
export function readyDeviations<D extends { triggers: string; reply_text: string }>(list: D[] | null | undefined): D[]
export function suggestionsForStep(suggestions: RoteiroSuggestion[], step: { question_key: string | null } | null): RoteiroSuggestion[]
export function stageSuggestions(suggestions: RoteiroSuggestion[], stageId: number): RoteiroSuggestion[]
export function deviationSuggestions(suggestions: RoteiroSuggestion[], funnelId: number): RoteiroSuggestion[]
export function testForStep(tests: RoteiroTest[], step: { question_key: string | null } | null): RoteiroTest | null
export function stageFromSearch(search: string, stages: { id: number; is_terminal: boolean }[]): number | null
export function sseTouchesView(data: { funnel_id?: number | string | null; stage_id?: number | string | null; cadence_id?: number } | null | undefined, funnelId: number | null, stageIds: number[]): boolean
export function newQuestionSuggestions(suggestions: RoteiroSuggestion[], stageId: number): RoteiroSuggestion[]
export function newProfileSuggestions(suggestions: RoteiroSuggestion[]): RoteiroSuggestion[]

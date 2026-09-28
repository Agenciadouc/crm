import type { LeadStageCadence, LeadStep } from './cadenceApi'
import type { RoteiroDeviation } from './roteiroApi'
export function stepTypeLabel(t: string): string
export function splitSteps(data: Pick<LeadStageCadence, 'steps' | 'next_attempt_id'> | null | undefined): { next: LeadStep | null; after: LeadStep[]; done: LeadStep[] }
export function stepTitle(step: Partial<LeadStep> & { action_type: string }): string
export function afterLine(after: LeadStep[]): string
export type NextAction = 'perguntar' | 'ja_sei' | 'enviar' | 'feito'
export function nextActions(step: (Pick<LeadStep, 'action_type' | 'state'> & Partial<Pick<LeadStep, 'auto_message' | 'description'>>) | null): NextAction[]
export function doneText(step: Partial<LeadStep> & { action_type: string }): string
export function doneOrigin(step: Partial<LeadStep> & { action_type: string }): 'ia' | 'vendedor' | null
export function deviationLine(deviation: Pick<RoteiroDeviation, 'triggers'> | null | undefined): string
export function stepSendText(step: Partial<Pick<LeadStep, 'auto_message' | 'description'>> | null | undefined): string
export function cadenceEventForAccount(data: { account_id?: number | string | null } | null | undefined, accountId: number | null | undefined): boolean
export interface ReloadDebouncer { schedule(doneBefore?: Set<number>): void; cancel(): void }
export function createReloadDebouncer(opts: {
  delayMs?: number
  run: (doneBefore: Set<number> | undefined) => void
  setTimer?: (fn: () => void, ms: number) => any
  clearTimer?: (t: any) => void
}): ReloadDebouncer

import type { LeadStageCadence, LeadStep } from './cadenceApi'
import type { RoteiroDeviation } from './roteiroApi'
export function stepTypeLabel(t: string): string
export function splitSteps(data: Pick<LeadStageCadence, 'steps' | 'next_attempt_id'> | null | undefined): { next: LeadStep | null; after: LeadStep[]; done: LeadStep[] }
export function stepTitle(step: Partial<LeadStep> & { action_type: string }): string
export function afterLine(after: LeadStep[]): string
export type NextAction = 'perguntar' | 'ja_sei' | 'enviar' | 'feito'
export function nextActions(step: Pick<LeadStep, 'action_type' | 'state'> | null): NextAction[]
export function doneText(step: Partial<LeadStep> & { action_type: string }): string
export function doneOrigin(step: Partial<LeadStep> & { action_type: string }): 'ia' | 'vendedor' | null
export function deviationLine(deviation: Pick<RoteiroDeviation, 'triggers'> | null | undefined): string

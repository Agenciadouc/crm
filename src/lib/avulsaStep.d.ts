import type { LeadCadence } from './api'
type AvulsaLc = Pick<LeadCadence, 'action_type' | 'attempt_message' | 'attempt_script' | 'attempt_description' | 'attempt_instructions' | 'attempt_position' | 'total_attempts'>
export type AvulsaAction = 'enviar' | 'feito' | 'roteiro' | 'pular'
export interface AvulsaStepView { kind: 'mensagem' | 'ligacao' | 'outro'; text: string; actions: AvulsaAction[] }
export function avulsaStepLabel(lc: Partial<AvulsaLc> | null | undefined): string
export function avulsaStepView(lc: Partial<AvulsaLc> | null | undefined, fill?: (text: string) => string): AvulsaStepView | null
export function avulsaReviewPos(lc: Partial<AvulsaLc> | null | undefined): { n: number; m: number } | null
export function telHref(phone: string | null | undefined): string | null

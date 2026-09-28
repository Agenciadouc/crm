import type { LeadStep } from './cadenceApi'
export type ReviewKind = 'pergunta' | 'mensagem'
export interface StepReview { leadId: number; kind: ReviewKind; text: string; questionKey: string | null; attemptId: number | null }
export interface ReviewPos { n: number; m: number }
export function reviewPosition(
  data: { steps: Array<Pick<LeadStep, 'attempt_id' | 'question_key' | 'state'> & { orphan?: boolean }> } | null | undefined,
  key: { attemptId?: number | null; questionKey?: string | null },
): ReviewPos | null
export function reviewTitle(kind: ReviewKind, pos: ReviewPos | null | undefined): string
export function reviewFromPendingAsk(p: { leadId: number; text: string; questionKey: string | null; attemptId: number | null } | null | undefined): StepReview | null
export function reviewSendKeys(review: Pick<StepReview, 'kind' | 'questionKey' | 'attemptId'>): { askKey: string | null; stepKey: number | null }
export function canSendReview(opts: { text: string; hasInstance: boolean; sending: boolean }): boolean
export function boxKeysAfterReviewSend(
  box: { askKey: string | null; stepKey: number | null },
  sent: { askKey: string | null; stepKey: number | null },
): { askKey: string | null; stepKey: number | null }
export function offerRecognition(askKey: string | null, result: { recognized_question?: unknown; message?: { id?: number } | null } | null | undefined): boolean
export interface LeadTaskRow { key: string; isCadence: boolean; title: string; desc: string; due: Date; overdue: boolean; task: any }
export function leadTaskRows(tasks: any[] | null | undefined, leadId: number, nowMs?: number): LeadTaskRow[]
export function attendantView(opts: { role: string | undefined; attendantId: number | null | undefined; attendants: Array<{ id: number; name: string }>; fallbackName?: string | null }): { canChange: boolean; name: string }
export function sectionTitle(label: string, n: number): string

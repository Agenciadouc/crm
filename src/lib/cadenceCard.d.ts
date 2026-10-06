export const BOX_PLACEHOLDER: string
export interface CardAction { id: 'enviar' | 'perguntar' | 'ja_sei' | 'pular' | 'feito' | 'ligar'; label: string }
export interface CardActions { primary: CardAction | null; secondary: CardAction | null; links: CardAction[] }
export function stepLine(kind: 'etapa' | 'avulsa', n: number | null | undefined, m: number | null | undefined, type: string | null | undefined): string
export function cadenceCardActions(kind: 'etapa' | 'avulsa', step: { action_type: string; state?: string } | null | undefined): CardActions
export function stageStepView(step: any, fill?: (text: string) => string): { title: string; text: string }
export const CADENCE_GROUP: 'cadencia'
export function cadenceRenderList<T extends string>(ids: T[] | null | undefined): Array<T | 'cadencia'>
export function actionWord(type: string | null | undefined): string
export function unifiedProgress(p: { stageDone?: number; stageTotal?: number; stageHasNext?: boolean; extra?: { done: number; total: number } | null }): { n: number; m: number } | null
export function afterSummary(after: Array<{ action_type: string }> | null | undefined, extraRemaining?: number): string

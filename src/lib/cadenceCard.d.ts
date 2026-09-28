export const BOX_PLACEHOLDER: string
export interface CardAction { id: 'enviar' | 'perguntar' | 'ja_sei' | 'pular' | 'feito' | 'ligar'; label: string }
export interface CardActions { primary: CardAction | null; secondary: CardAction | null; links: CardAction[] }
export function stepLine(kind: 'etapa' | 'avulsa', n: number | null | undefined, m: number | null | undefined, type: string | null | undefined): string
export function cadenceCardActions(kind: 'etapa' | 'avulsa', step: { action_type: string; state?: string } | null | undefined): CardActions
export function stageStepView(step: any): { title: string; text: string }
export const CADENCE_GROUP: 'cadencia'
export function cadenceRenderList<T extends string>(ids: T[] | null | undefined): Array<T | 'cadencia'>

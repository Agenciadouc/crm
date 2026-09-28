export const NO_TEXT_HINT: string
export interface CardAction<Id extends string = string> { id: Id; label: string }
export interface CardActions<Id extends string = string> { primary: CardAction<Id> | null; secondary: CardAction<Id>[] }
export function cardHeader(kind: 'etapa' | 'avulsa', name: string | null | undefined, n: number | null | undefined, m: number | null | undefined): { title: string; count: string }
export function stageCardActions(step: { action_type: string; state?: string } | null | undefined): CardActions<'perguntar' | 'ja_sei' | 'enviar' | 'feito' | 'ligar'>
export function avulsaCardActions(view: { actions: string[] } | null | undefined): CardActions<'enviar' | 'roteiro' | 'feito' | 'pular'>
export const CADENCE_GROUP: 'cadencia'
export function cadenceRenderList<T extends string>(ids: T[] | null | undefined): Array<T | 'cadencia'>
export function stageStepView(step: any): { title: string; text: string }

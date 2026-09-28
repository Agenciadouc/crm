export const NO_TEXT_HINT: string
export interface CardAction<Id extends string = string> { id: Id; label: string }
export interface CardActions<Id extends string = string> { primary: CardAction<Id> | null; secondary: CardAction<Id>[] }
export function cardHeader(kind: 'etapa' | 'avulsa', name: string | null | undefined, n: number | null | undefined, m: number | null | undefined): { title: string; count: string }
export function stageCardActions(step: { action_type: string; state?: string } | null | undefined): CardActions<'perguntar' | 'ja_sei' | 'enviar' | 'feito' | 'ligar'>
export function avulsaCardActions(view: { actions: string[] } | null | undefined): CardActions<'enviar' | 'roteiro' | 'feito' | 'pular'>
export function cadenceTitleIds(ids: string[] | null | undefined): string[]

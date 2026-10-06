export type FunnelValue = 'vendas' | 'recompra' | 'todos'
export const FUNNEL_OPTIONS: { value: FunnelValue; label: string }[]
export function normalizeFunnel(v: string | null | undefined): FunnelValue
export function effectiveFunnel(value: string | null | undefined, available: boolean, ready: boolean): FunnelValue | null
export function funnelQuery(v: string | null | undefined): string
export function funnelParams(v: string | null | undefined): { funnel: FunnelValue }
export function leadMatchesFunnel(
  lead: { funnel_id?: number | null } | null | undefined,
  v: string | null | undefined,
  funnels: { id: number; kind?: string | null }[] | null | undefined,
): boolean
export function stagesForFunnel<S>(
  funnels: { kind?: string | null; stages?: S[] }[] | null | undefined,
  v: string | null | undefined,
): S[]

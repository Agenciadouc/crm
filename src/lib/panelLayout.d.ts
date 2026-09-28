export type AtendimentoBlockId =
  | 'score' | 'atendente' | 'etapa' | 'contato' | 'tags' | 'proximo_passo' | 'avulsa' | 'tarefas' | 'vendas' | 'observacoes'
export interface PanelBlock { id: AtendimentoBlockId; visible: boolean }
export interface SavedLayouts { account: PanelBlock[] | null; user: PanelBlock[] | null }
export type LayoutSource = 'user' | 'account' | 'factory'
export const ATENDIMENTO_BLOCKS: Array<{ id: AtendimentoBlockId; label: string; visible: boolean }>
export function blockLabel(id: string): string
export function factoryLayout(): PanelBlock[]
export function normalizeLayout(saved: unknown): PanelBlock[]
export function resolveLayout(saved: SavedLayouts | null | undefined): { layout: PanelBlock[]; source: LayoutSource }
export function visibleIds(layout: PanelBlock[]): AtendimentoBlockId[]
export function moveBlockTo(layout: PanelBlock[], from: number, to: number): PanelBlock[]
export function moveBlock(layout: PanelBlock[], id: string, delta: number): PanelBlock[]
export function toggleVisible(layout: PanelBlock[], id: string): PanelBlock[]
export function validateLayout(layout: unknown): string | null

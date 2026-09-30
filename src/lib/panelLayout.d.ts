export type AtendimentoBlockId =
  | 'score' | 'atendente' | 'etapa' | 'contato' | 'tags' | 'proximo_passo' | 'avulsa' | 'tarefas' | 'vendas' | 'cliente' | 'observacoes'
export interface PanelBlock { id: AtendimentoBlockId; visible: boolean }
export interface SavedLayouts { account: PanelBlock[] | null; user: PanelBlock[] | null }
export type LayoutSource = 'user' | 'account' | 'factory'
export const ATENDIMENTO_BLOCKS: Array<{ id: AtendimentoBlockId; label: string; visible: boolean }>
export function blockLabel(id: string): string
export function factoryLayout(): PanelBlock[]
export function normalizeLayout(saved: unknown): PanelBlock[]
export function resolveLayout(saved: SavedLayouts | null | undefined): { layout: PanelBlock[]; source: LayoutSource }
export function visibleIds(layout: PanelBlock[]): AtendimentoBlockId[]
export function moveBlockTo<T extends { id: string }>(layout: T[], from: number, to: number): T[]
export function moveBlock<T extends { id: string }>(layout: T[], id: string, delta: number): T[]
export function toggleVisible(layout: PanelBlock[], id: string): PanelBlock[]
export function validateLayout(layout: unknown): string | null
export interface EditorRow { id: AtendimentoBlockId | 'cadencia'; visible: boolean; parts?: Partial<Record<'proximo_passo' | 'avulsa', boolean>> }
export function editorRows(layout: PanelBlock[]): EditorRow[]
export function expandRows(rows: EditorRow[]): PanelBlock[]
export function toggleRow(rows: EditorRow[], id: string): EditorRow[]

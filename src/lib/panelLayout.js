// "Arrumar" a aba Atendimento do Chat: logica pura (ordem e o que aparece).
// Os ids espelham server/services/panelLayouts.js (o teste confere).
// Resolucao: jeito do vendedor > padrao da conta > padrao de fabrica (= a aba de hoje).

export const ATENDIMENTO_BLOCKS = [
  { id: 'score', label: 'Termômetro', visible: true },
  { id: 'atendente', label: 'Atendente', visible: true },
  { id: 'etapa', label: 'Etapa do funil', visible: true },
  { id: 'contato', label: 'Dados do contato', visible: false },
  { id: 'tags', label: 'Tags', visible: true },
  { id: 'proximo_passo', label: 'Próximo passo', visible: true },
  { id: 'avulsa', label: 'Cadência avulsa', visible: true },
  { id: 'tarefas', label: 'Tarefas', visible: true },
  { id: 'vendas', label: 'Vendas', visible: true },
  { id: 'observacoes', label: 'Observações', visible: false },
]

const BY_ID = new Map(ATENDIMENTO_BLOCKS.map(b => [b.id, b]))

export function blockLabel(id) {
  return BY_ID.get(id)?.label ?? id
}

export function factoryLayout() {
  return ATENDIMENTO_BLOCKS.map(b => ({ id: b.id, visible: b.visible }))
}

// Salvo -> lista completa: ignora ids desconhecidos/repetidos, visible invalido usa o de
// fabrica, e blocos que o salvo nao conhece entram no fim (na ordem e visibilidade de fabrica).
export function normalizeLayout(saved) {
  if (!Array.isArray(saved)) return factoryLayout()
  const out = []
  const seen = new Set()
  for (const b of saved) {
    if (!b || typeof b.id !== 'string' || !BY_ID.has(b.id) || seen.has(b.id)) continue
    seen.add(b.id)
    out.push({ id: b.id, visible: typeof b.visible === 'boolean' ? b.visible : BY_ID.get(b.id).visible })
  }
  for (const b of ATENDIMENTO_BLOCKS) if (!seen.has(b.id)) out.push({ id: b.id, visible: b.visible })
  return out
}

export function resolveLayout(saved) {
  if (saved && Array.isArray(saved.user)) return { layout: normalizeLayout(saved.user), source: 'user' }
  if (saved && Array.isArray(saved.account)) return { layout: normalizeLayout(saved.account), source: 'account' }
  return { layout: factoryLayout(), source: 'factory' }
}

export function visibleIds(layout) {
  return layout.filter(b => b.visible).map(b => b.id)
}

export function moveBlockTo(layout, from, to) {
  if (from === to || from < 0 || to < 0 || from >= layout.length || to >= layout.length) return layout
  const out = layout.slice()
  const [b] = out.splice(from, 1)
  out.splice(to, 0, b)
  return out
}

// delta -1 = sobe, +1 = desce
export function moveBlock(layout, id, delta) {
  const i = layout.findIndex(b => b.id === id)
  if (i < 0) return layout
  return moveBlockTo(layout, i, i + delta)
}

export function toggleVisible(layout, id) {
  return layout.map(b => (b.id === id ? { ...b, visible: !b.visible } : b))
}

// Mesmas regras do servidor (validatePanelLayout). Devolve a mensagem de erro ou null.
export function validateLayout(layout) {
  if (!Array.isArray(layout)) return 'O layout precisa ser uma lista de blocos.'
  if (layout.length === 0) return 'Escolha pelo menos um bloco.'
  if (layout.length > ATENDIMENTO_BLOCKS.length) return 'Tem blocos demais no layout.'
  const seen = new Set()
  for (const b of layout) {
    if (!b || typeof b !== 'object' || typeof b.id !== 'string') return 'Cada bloco precisa ter um id.'
    if (!BY_ID.has(b.id)) return `Bloco desconhecido: "${b.id}".`
    if (seen.has(b.id)) return `Bloco repetido: "${b.id}".`
    seen.add(b.id)
    if (typeof b.visible !== 'boolean') return `Diga se o bloco "${b.id}" fica visível (sim ou não).`
  }
  return null
}

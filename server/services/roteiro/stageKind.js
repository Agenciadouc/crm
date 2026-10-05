// Etapa de tentativa de contato x etapa de conversa (spec 2026-10-02 §7.2): pelo nome.
const CONTACT_WORDS = ['novo', 'nova', 'contato', 'tentativa', 'prospec', 'entrada']
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function isContactStage(stage) {
  if (!stage || stage.is_terminal) return false
  const n = norm(stage.name)
  return CONTACT_WORDS.some(w => n.includes(w))
}

// Nao finais e nao de contato, na ordem; se nao sobrar nenhuma, todas as nao finais.
export function conversationStages(stages) {
  const open = (stages || []).filter(s => !s.is_terminal).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const conv = open.filter(s => !isContactStage(s))
  return conv.length ? conv : open
}

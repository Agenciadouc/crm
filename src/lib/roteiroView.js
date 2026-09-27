// Regras puras do cartao do roteiro (spec 4.1, 4.3): o que mostrar como proxima pergunta,
// pendentes e respondidas; resumo da troca de etapa em massa. Sem React (testavel com node:test).

// Etapa atual -> { next, pending, answered }. A proxima vem do servidor (next_question_key);
// nas pendentes, obrigatorias primeiro, depois recomendadas, cada grupo na ordem da etapa.
export function splitCurrentStage(stage, nextKey) {
  if (!stage || !Array.isArray(stage.questions)) return { next: null, pending: [], answered: [] }
  const answered = stage.questions.filter(q => q.answer)
  const open = stage.questions.filter(q => !q.answer)
  const next = open.find(q => q.question_key === nextKey) || null
  const rest = open.filter(q => q !== next)
  const pending = rest.filter(q => q.required).concat(rest.filter(q => !q.required))
  return { next, pending, answered }
}

export function progressText(progress) {
  const answered = progress?.answered ?? 0
  const total = progress?.total ?? 0
  return `${answered} de ${total}`
}

// "12 movidos · 3 travados por perguntas pendentes · 2 nao mudaram porque ..."
// count - moved - blocked: o servidor pula quem ja estava na etapa ou e de outro funil.
export function bulkMoveSummary(result) {
  const moved = Number(result?.moved) || 0
  const blocked = Array.isArray(result?.blocked) ? result.blocked.length : 0
  const count = Number(result?.count) || 0
  const skipped = Math.max(0, count - moved - blocked)
  const parts = [`${moved} ${moved === 1 ? 'movido' : 'movidos'}`]
  if (blocked) parts.push(`${blocked} ${blocked === 1 ? 'travado' : 'travados'} por perguntas pendentes`)
  if (skipped) {
    parts.push(skipped === 1
      ? '1 não mudou porque já estava nessa etapa ou está em outro funil'
      : `${skipped} não mudaram porque já estavam nessa etapa ou estão em outro funil`)
  }
  return parts.join(' · ')
}

// Texto cru da pergunta (com {nome}) para mostrar ao vendedor quando nao ha o texto do lead:
// tira o {nome} sem deixar virgula solta e recapitaliza (mesma ideia do servidor sem nome).
export function displayQuestionText(text) {
  if (typeof text !== 'string') return ''
  if (!text.includes('{nome}')) return text
  const cleaned = text
    .replace(/\{nome\}\s*,\s*/g, '')
    .replace(/,\s*\{nome\}/g, '')
    .replace(/\s*\{nome\}\s*/g, ' ')
    .replace(/\s+([?!.,])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned
}

export function stageName(roteiro, stageId) {
  const s = (roteiro?.stages || []).find(x => x.id === stageId)
  return s ? s.name : ''
}

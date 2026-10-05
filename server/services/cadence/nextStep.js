// Proximo passo da cadencia da etapa (spec 4.2), puro: primeiro passo, na ordem, ainda nao
// concluido. Pergunta concluida = tem resposta (vendedor ou IA); enviada sem resposta =
// 'aguardando' (continua sendo o proximo). Mensagem/ligacao/etc = registro em lead_cadence_steps.
// Pergunta orfa (saiu do roteiro publicado, step.orphan) sem resposta nao trava: fica fora do
// proximo passo e do total. Pergunta de outro perfil (step.not_applicable) segue a mesma regra.
export function stepState(step, { answeredKeys, askedKeys, doneByAttempt }) {
  const done = doneByAttempt.get(step.id)
  if (done) return { state: 'feito', how: done.how }
  if (step.action_type === 'pergunta') {
    if (answeredKeys.has(step.question_key)) return { state: 'feito', how: 'respondida' }
    if (askedKeys.has(step.question_key)) return { state: 'aguardando', how: null }
  }
  return { state: 'pendente', how: null }
}

export function computeNext(steps, ctx) {
  const states = steps.map(s => ({ id: s.id, ...stepState(s, ctx) }))
  const counts = states.filter((x, i) => !((steps[i].orphan || steps[i].not_applicable) && x.state !== 'feito'))
  const next = counts.find(x => x.state !== 'feito')
  return {
    states,
    nextAttemptId: next ? next.id : null,
    doneCount: counts.filter(x => x.state === 'feito').length,
    total: counts.length,
  }
}

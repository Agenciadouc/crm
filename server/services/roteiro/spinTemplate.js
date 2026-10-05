// Modelo SPIN (Situacao, Problema, Implicacao, Necessidade de Solucao) — spec 2026-10-02 §7.1.
// Usado por "Comecar com modelo SPIN" e para completar fase que a IA esquecer.
export const SPIN_KEYS = ['situation', 'problem', 'implication', 'need_payoff']
export const SPIN_LABEL = { situation: 'Situação', problem: 'Problema', implication: 'Implicação', need_payoff: 'Necessidade de Solução' }
export const SPIN_ORDER = Object.fromEntries(SPIN_KEYS.map((k, i) => [k, i]))

const q = (spin, text, options) => ({ spin, text, kind: 'options', required: true, options: options.map(([label, points]) => ({ label, points })) })

export const SPIN_QUESTIONS = [
  q('situation', 'Como você resolve isso hoje, {nome}?', [['Já uso algo e não estou satisfeito(a)', 10], ['Faço de um jeito improvisado', 8], ['Ainda não faço nada', 3]]),
  q('problem', 'O que mais te incomoda na forma como está hoje?', [['Atrapalha o dia a dia, é urgente', 15], ['Incomoda, mas dá pra levar', 8], ['Nada em especial, só pesquisando', 0]]),
  q('problem', 'Isso já aconteceu outras vezes ou foi algo pontual?', [['Acontece sempre', 12], ['Às vezes', 6], ['Foi só uma vez', 0]]),
  q('implication', 'E se continuar assim pelos próximos meses, o que isso te causa?', [['Perco dinheiro/clientes/tempo', 15], ['Fica chato, mas não muda muito', 5], ['Nada', 0]]),
  q('implication', 'Isso afeta mais alguém além de você (família, equipe, sócio)?', [['Sim, afeta outras pessoas', 10], ['Um pouco', 5], ['Só a mim', 2]]),
  q('need_payoff', 'Se isso estivesse resolvido, o que mudaria pra você? Quanto valeria resolver agora?', [['Mudaria muito, quero resolver já', 15], ['Seria bom, mas sem pressa', 6], ['Não mudaria muito', 0]]),
]

// Perguntas do modelo cujas fases ainda nao aparecem em `questions` (roteiro todo).
export function missingSpinQuestions(questions) {
  const used = new Set((questions || []).map(x => x.spin).filter(Boolean))
  return SPIN_QUESTIONS.filter(x => !used.has(x.spin))
}

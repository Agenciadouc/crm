import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseTab, fmtPct, maxProfilePoints, profileMaxText, stageQuestions, moveQuestion, moveToStage, addQuestion,
  removeQuestion, changeKind, sameContent, hasUnpublished, hasAnyQuestions, previousVersions, toDraftInput,
  suggestionWhy, findSellerSuggestion, testRemainingText, testResultText, barWidth,
} from '../src/lib/roteiroManager.js'

const q = (key, stage, position, extra = {}) => ({
  question_key: key, stage_id: stage, position, text: key, kind: 'text', required: false, spin: null, profile_key: null, ai_hint: null, options: [], ...extra,
})
const order = (qs, stage) => stageQuestions(qs, stage).map(x => x.question_key)

test('parseTab: aba da URL, padrao roteiro', () => {
  assert.equal(parseTab('?tab=desempenho'), 'desempenho')
  assert.equal(parseTab('?tab=sugestoes'), 'sugestoes')
  assert.equal(parseTab('?tab=xyz'), 'roteiro')
  assert.equal(parseTab(''), 'roteiro')
})

test('fmtPct: virgula decimal e traco sem dado', () => {
  assert.equal(fmtPct(83.3), '83,3%')
  assert.equal(fmtPct(70), '70%')
  assert.equal(fmtPct(null), '—')
})

test('maxProfilePoints: maior opcao de cada pergunta de opcoes; negativa conta 0; texto nao conta', () => {
  const qs = [
    q('a', 1, 0, { kind: 'options', options: [{ label: 'x', points: 15 }, { label: 'y', points: 8 }] }),
    q('b', 1, 1, { kind: 'options', options: [{ label: 'x', points: -10 }, { label: 'y', points: -5 }] }),
    q('c', 2, 0, { kind: 'options', options: [{ label: 'x', points: 45 }, { label: 'y', points: 0 }] }),
    q('d', 2, 1),
  ]
  assert.equal(maxProfilePoints(qs), 60)
  assert.equal(maxProfilePoints([]), 0)
  assert.match(profileMaxText(60), /^Perfil máximo deste roteiro: 60 pontos\. Cada lead vai de 0 a 50/)
  assert.match(profileMaxText(0), /ex\.:/)
})

test('moveQuestion: sobe e desce dentro da etapa; nas pontas nao muda', () => {
  const qs = [q('a', 1, 0), q('b', 1, 1), q('c', 1, 2), q('z', 2, 0)]
  assert.deepEqual(order(moveQuestion(qs, 'c', -1), 1), ['a', 'c', 'b'])
  assert.deepEqual(order(moveQuestion(qs, 'a', 1), 1), ['b', 'a', 'c'])
  assert.equal(moveQuestion(qs, 'a', -1), qs)
  assert.equal(moveQuestion(qs, 'c', 1), qs)
})

test('moveToStage: vai para o fim da outra etapa e renumera as duas', () => {
  const qs = [q('a', 1, 0), q('b', 1, 1), q('c', 1, 2), q('z', 2, 0)]
  const r = moveToStage(qs, 'a', 2)
  assert.deepEqual(order(r, 1), ['b', 'c'])
  assert.deepEqual(stageQuestions(r, 1).map(x => x.position), [0, 1])
  assert.deepEqual(order(r, 2), ['z', 'a'])
  assert.equal(r.find(x => x.question_key === 'a').position, 1)
})

test('addQuestion e removeQuestion (desvio que voltava para ela fica sem volta)', () => {
  const qs = addQuestion([q('a', 1, 0)], 1, 'novo')
  const n = qs.find(x => x.question_key === 'novo')
  assert.equal(n.position, 1)
  assert.equal(n.kind, 'text')
  const devs = [{ triggers: 'preço', reply_text: 'x', return_question_key: 'a' }]
  const r = removeQuestion(qs, devs, 'a')
  assert.deepEqual(r.questions.map(x => [x.question_key, x.position]), [['novo', 0]])
  assert.equal(r.deviations[0].return_question_key, null)
})

test('changeKind: opcoes comecam com 2 linhas; voltar para texto limpa as opcoes', () => {
  const o = changeKind(q('a', 1, 0), 'options')
  assert.equal(o.options.length, 2)
  assert.equal(changeKind(o, 'text').options.length, 0)
})

test('sameContent / hasUnpublished / hasAnyQuestions', () => {
  const pub = { questions: [q('a', 1, 0)], deviations: [] }
  const draftIgual = { questions: [{ ...q('a', 1, 0), id: 99 }], deviations: [] }
  const draftOutro = { questions: [q('a', 1, 0, { text: 'mudou' })], deviations: [] }
  assert.equal(sameContent(pub, draftIgual), true)
  assert.equal(hasUnpublished({ draft: draftIgual, published: pub }), false)
  assert.equal(hasUnpublished({ draft: draftOutro, published: pub }), true)
  assert.equal(hasUnpublished({ draft: { questions: [], deviations: [] }, published: null }), false)
  assert.equal(hasUnpublished({ draft: draftOutro, published: null }), true)
  assert.equal(hasUnpublished({ draft: null, published: pub }), false)
  assert.equal(hasAnyQuestions({ draft: null, published: pub }), true)
  assert.equal(hasAnyQuestions({ draft: { questions: [], deviations: [] }, published: null }), false)
})

test('previousVersions tira o rascunho e ordena da mais nova', () => {
  const v = previousVersions([
    { id: 1, version: 1, status: 'archived' }, { id: 9, version: 0, status: 'draft' }, { id: 2, version: 2, status: 'published' },
  ])
  assert.deepEqual(v.map(x => x.id), [2, 1])
})

test('toDraftInput: pontos numericos, posicao das opcoes e texto sem opcoes', () => {
  const r = toDraftInput({
    questions: [
      q('a', 1, 0, { kind: 'options', spin: 'need_payoff', profile_key: 'loja', options: [{ label: 'x', points: '15' }, { label: 'y', points: 0, option_key: 'k' }] }),
      q('b', 1, 1, { options: [{ label: 'sobra', points: 1 }] }),
    ],
    deviations: [{ triggers: 'preço', reply_text: 'r', return_question_key: '' }],
  })
  assert.deepEqual(r.questions[0].options, [{ option_key: undefined, label: 'x', points: 15, position: 0 }, { option_key: 'k', label: 'y', points: 0, position: 1 }])
  assert.equal(r.questions[0].spin, 'need_payoff')
  assert.equal(r.questions[0].profile_key, 'loja')
  assert.deepEqual(r.questions[1].options, [])
  assert.deepEqual(r.deviations, [{ triggers: 'preço', reply_text: 'r', return_question_key: null, position: 0 }])
})

test('suggestionWhy: frase com o numero para cada tipo', () => {
  assert.equal(
    suggestionWhy({ type: 'seller_phrasing', payload: { text: 't', seller_name: 'Ana', seller_rate: 81, current_rate: 62 }, evidence: { sent: 45 } }),
    'Esta pergunta perde 38% dos clientes (taxa 62% em 45 envios). A versão abaixo teve 81% com Ana.',
  )
  assert.match(suggestionWhy({ type: 'rewrite', payload: { versions: ['x', 'y'], current_rate: 55.5 }, evidence: { sent: 30 } }), /perde 44,5% .*taxa 55,5% em 30 envios/)
  assert.match(suggestionWhy({ type: 'new_option', payload: { label: 'Casamento', count: 7 }, evidence: {} }), /^7 clientes responderam algo como "Casamento"/)
  assert.match(suggestionWhy({ type: 'new_deviation', payload: { triggers: 'frete', count: 3 }, evidence: { leads: 3 } }), /^3 clientes diferentes/)
  assert.match(
    suggestionWhy({ type: 'reorder', payload: { gain: 20 }, evidence: { before: { rate: 80, sent: 12 }, after: { rate: 60, sent: 15 } } }),
    /20 pontos \(80% quando feita antes, 60% quando feita depois\)/,
  )
})

test('findSellerSuggestion: acha por pergunta e vendedor', () => {
  const list = [
    { id: 1, type: 'seller_phrasing', question_key: 'q1', payload: { seller_name: 'Ana' }, evidence: { seller_id: 7 } },
    { id: 2, type: 'rewrite', question_key: 'q1', payload: {}, evidence: null },
  ]
  assert.equal(findSellerSuggestion(list, 'q1', { user_id: 7, name: 'Ana' }).id, 1)
  assert.equal(findSellerSuggestion(list, 'q1', { user_id: 8, name: 'Bia' }), null)
  assert.equal(findSellerSuggestion(list, 'q2', { user_id: 7, name: 'Ana' }), null)
})

test('textos do teste A/B e largura da barra', () => {
  assert.equal(testRemainingText({ status: 'testing', days_left: 12 }), 'Faltam até 12 dias (ou antes, quando cada versão tiver 30 envios).')
  assert.equal(testRemainingText({ status: 'testing', days_left: 1 }), 'Faltam até 1 dia (ou antes, quando cada versão tiver 30 envios).')
  assert.match(testResultText({ status: 'won', a: { sent: 30, rate: 60 }, b: { sent: 31, rate: 75.5 } }), /^A nova versão venceu\. Atual 60% \(30 envios\) × nova 75,5% \(31 envios\)\.$/)
  assert.match(testResultText({ status: 'lost', a: { sent: 30, rate: 60 }, b: { sent: 30, rate: 62 } }), /empatou/)
  assert.equal(barWidth(null), 0)
  assert.equal(barWidth(140), 100)
  assert.equal(barWidth(42.5), 42.5)
})

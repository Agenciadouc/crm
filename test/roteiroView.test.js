import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitCurrentStage, progressText, bulkMoveSummary, displayQuestionText, stageName } from '../src/lib/roteiroView.js'

const q = (key, { required = false, answer = null } = {}) => ({ question_key: key, required, answer })

test('splitCurrentStage separa a proxima, pendentes e respondidas', () => {
  const stage = { questions: [q('a', { answer: { origin: 'manual' } }), q('b'), q('c', { required: true }), q('d')] }
  const r = splitCurrentStage(stage, 'c')
  assert.equal(r.next.question_key, 'c')
  assert.deepEqual(r.pending.map(x => x.question_key), ['b', 'd'])
  assert.deepEqual(r.answered.map(x => x.question_key), ['a'])
})

test('splitCurrentStage: obrigatorias pendentes vem antes das recomendadas', () => {
  const stage = { questions: [q('b'), q('c', { required: true }), q('d'), q('e', { required: true })] }
  const r = splitCurrentStage(stage, 'c')
  assert.deepEqual(r.pending.map(x => x.question_key), ['e', 'b', 'd'])
})

test('splitCurrentStage sem etapa ou sem proxima', () => {
  assert.deepEqual(splitCurrentStage(null, null), { next: null, pending: [], answered: [] })
  const r = splitCurrentStage({ questions: [q('a', { answer: {} })] }, null)
  assert.equal(r.next, null)
  assert.equal(r.answered.length, 1)
})

test('progressText', () => {
  assert.equal(progressText({ answered: 3, total: 5 }), '3 de 5')
  assert.equal(progressText(null), '0 de 0')
})

test('bulkMoveSummary no plural, singular e sem travados', () => {
  assert.equal(bulkMoveSummary({ moved: 12, blocked: [{}, {}, {}] }), '12 movidos · 3 travados por perguntas pendentes')
  assert.equal(bulkMoveSummary({ moved: 1, blocked: [{}] }), '1 movido · 1 travado por perguntas pendentes')
  assert.equal(bulkMoveSummary({ moved: 4, blocked: [] }), '4 movidos')
  assert.equal(bulkMoveSummary({ moved: 0 }), '0 movidos')
  assert.equal(bulkMoveSummary(null), '0 movidos')
})

test('bulkMoveSummary explica os que nao mudaram (mesma etapa ou outro funil)', () => {
  assert.equal(
    bulkMoveSummary({ count: 17, moved: 12, blocked: [{}, {}, {}] }),
    '12 movidos · 3 travados por perguntas pendentes · 2 não mudaram porque já estavam nessa etapa ou estão em outro funil',
  )
  assert.equal(bulkMoveSummary({ count: 5, moved: 4, blocked: [] }), '4 movidos · 1 não mudou porque já estava nessa etapa ou está em outro funil')
  assert.equal(bulkMoveSummary({ count: 4, moved: 4, blocked: [] }), '4 movidos')
})

test('displayQuestionText tira {nome} sem deixar virgula solta', () => {
  assert.equal(displayQuestionText('{nome}, qual o prazo do evento?'), 'Qual o prazo do evento?')
  assert.equal(displayQuestionText('Qual o prazo, {nome}?'), 'Qual o prazo?')
  assert.equal(displayQuestionText('Oi {nome} tudo bem?'), 'Oi tudo bem?')
  assert.equal(displayQuestionText('Sem nome'), 'Sem nome')
  assert.equal(displayQuestionText(null), '')
})

test('stageName acha o nome pela id', () => {
  const roteiro = { stages: [{ id: 1, name: 'Novo' }, { id: 2, name: 'Qualificando' }] }
  assert.equal(stageName(roteiro, 2), 'Qualificando')
  assert.equal(stageName(roteiro, 9), '')
  assert.equal(stageName(null, 1), '')
})

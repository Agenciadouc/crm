import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSteps, stepTitle, afterLine, nextActions, doneText, doneOrigin, deviationLine } from '../src/lib/nextStep.js'

const q = (over = {}) => ({ text_for_lead: 'Para quando é o seu evento, Ana?', kind: 'options', answer: null, last_ask: null, ...over })
const data = {
  next_attempt_id: 2,
  steps: [
    { attempt_id: 1, action_type: 'pergunta', state: 'feito', how: 'respondida', question: q({ answer: { option_label: 'Até 30 dias', answer_text: null, origin: 'ia', answered_by_name: null } }) },
    { attempt_id: 2, action_type: 'mensagem', state: 'pendente', auto_message: 'Segue o catálogo, {nome}', description: null },
    { attempt_id: 3, action_type: 'ligacao', state: 'pendente', description: 'Ligar para confirmar a data' },
    { attempt_id: 4, action_type: 'pergunta', state: 'aguardando', question: q({ text_for_lead: 'Quantos convidados?' }) },
    { attempt_id: 5, action_type: 'visita', state: 'pendente', description: 'Visita ao salão' },
  ],
}

test('divide em proximo, depois (2) e feitos', () => {
  const r = splitSteps(data)
  assert.equal(r.next.attempt_id, 2)
  assert.deepEqual(r.after.map(s => s.attempt_id), [3, 4])
  assert.deepEqual(r.done.map(s => s.attempt_id), [1])
  assert.deepEqual(splitSteps({ steps: [], next_attempt_id: null }), { next: null, after: [], done: [] })
})

test('titulo, linha do depois e botoes por tipo', () => {
  assert.equal(stepTitle(data.steps[0]), 'Para quando é o seu evento, Ana?')
  assert.equal(stepTitle(data.steps[1]), 'Segue o catálogo, {nome}')
  assert.equal(afterLine(splitSteps(data).after), 'Depois: Ligação: Ligar para confirmar a data · Pergunta: Quantos convidados?')
  assert.equal(afterLine([]), '')
  assert.deepEqual(nextActions({ action_type: 'pergunta', state: 'pendente' }), ['perguntar', 'ja_sei'])
  assert.deepEqual(nextActions({ action_type: 'pergunta', state: 'aguardando' }), ['ja_sei'])
  assert.deepEqual(nextActions({ action_type: 'mensagem', state: 'pendente' }), ['enviar', 'feito'])
  assert.deepEqual(nextActions({ action_type: 'whatsapp', state: 'pendente' }), ['enviar', 'feito'])
  assert.deepEqual(nextActions({ action_type: 'visita', state: 'pendente' }), ['feito'])
})

test('feitos: resposta salva e origem; desvio em uma linha', () => {
  assert.equal(doneText(data.steps[0]), 'Até 30 dias')
  assert.equal(doneOrigin(data.steps[0]), 'ia')
  assert.equal(doneText({ action_type: 'mensagem', how: 'enviado' }), 'Enviada')
  assert.equal(doneText({ action_type: 'ligacao', how: 'feito' }), 'Feito')
  assert.equal(doneText({ action_type: 'pergunta', how: 'pulado', question: q() }), 'Pulado')
  assert.equal(doneOrigin({ action_type: 'mensagem', how: 'enviado' }), null)
  assert.equal(deviationLine({ triggers: 'preço, valor', reply_text: 'Depende' }), 'Ele perguntou de preço')
})

// Pergunta orfa (saiu do roteiro publicado) nao trava: nunca e o proximo nem entra no "Depois"
test('pergunta orfa pendente fica fora do proximo e do depois', () => {
  const d = {
    next_attempt_id: 7,
    steps: [
      { attempt_id: 6, action_type: 'pergunta', state: 'pendente', orphan: true, question: null, description: null },
      { attempt_id: 7, action_type: 'mensagem', state: 'pendente', auto_message: 'Oi', description: null },
      { attempt_id: 8, action_type: 'pergunta', state: 'pendente', orphan: true, question: null, description: null },
      { attempt_id: 9, action_type: 'ligacao', state: 'pendente', description: 'Ligar' },
    ],
  }
  const r = splitSteps(d)
  assert.equal(r.next.attempt_id, 7)
  assert.deepEqual(r.after.map(s => s.attempt_id), [9])
  assert.deepEqual(r.done, [])
  // Mesmo que o proximo aponte para uma orfa (dado velho), ela nao aparece como proximo
  assert.equal(splitSteps({ ...d, next_attempt_id: 6 }).next, null)
  // Orfa ja respondida continua nos feitos
  const answered = { attempt_id: 10, action_type: 'pergunta', state: 'feito', how: 'respondida', orphan: true, question: null }
  assert.deepEqual(splitSteps({ next_attempt_id: null, steps: [answered] }).done.map(s => s.attempt_id), [10])
})

test('origem do vendedor e pergunta sem resposta', () => {
  const byHand = { action_type: 'pergunta', how: 'respondida', question: q({ answer: { option_label: null, answer_text: 'março', origin: 'manual', answered_by_name: 'Bia' } }) }
  assert.equal(doneText(byHand), 'março')
  assert.equal(doneOrigin(byHand), 'vendedor')
  assert.equal(nextActions(null).length, 0)
  assert.equal(deviationLine(null), 'Ele saiu do roteiro')
  assert.equal(stepTitle({ action_type: 'pergunta', question: null, description: null }), 'Pergunta')
})

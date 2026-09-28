import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  reviewPosition, reviewTitle, reviewFromPendingAsk, reviewSendKeys, canSendReview,
  boxKeysAfterReviewSend, offerRecognition, leadTaskRows, attendantView, sectionTitle,
} from '../src/lib/atendimentoPanel.js'

const data = {
  steps: [
    { attempt_id: 10, action_type: 'pergunta', question_key: 'q_evento', state: 'feito' },
    { attempt_id: 11, action_type: 'pergunta', question_key: 'q_velha', state: 'pendente', orphan: true },
    { attempt_id: 12, action_type: 'mensagem', question_key: null, state: 'pendente' },
    { attempt_id: 13, action_type: 'pergunta', question_key: 'q_convidados', state: 'pendente' },
    { attempt_id: 14, action_type: 'pergunta', question_key: 'q_antiga', state: 'feito', orphan: true },
  ],
}

test('posicao do passo: conta como o servidor (orfa sem resposta fica fora)', () => {
  assert.deepEqual(reviewPosition(data, { attemptId: 12 }), { n: 2, m: 4 })
  assert.deepEqual(reviewPosition(data, { questionKey: 'q_convidados' }), { n: 3, m: 4 })
  assert.deepEqual(reviewPosition(data, { questionKey: 'q_evento' }), { n: 1, m: 4 })
  // orfa sem resposta, passo que nao existe, sem dados: sem numero
  assert.equal(reviewPosition(data, { attemptId: 11 }), null)
  assert.equal(reviewPosition(data, { attemptId: 99 }), null)
  assert.equal(reviewPosition(null, { attemptId: 12 }), null)
  assert.equal(reviewPosition(data, {}), null)
})

test('titulo da janela Conferir mensagem', () => {
  assert.equal(reviewTitle('pergunta', { n: 2, m: 5 }), 'Conferir mensagem — Pergunta 2 de 5')
  assert.equal(reviewTitle('mensagem', { n: 3, m: 3 }), 'Conferir mensagem — Mensagem 3 de 3')
  assert.equal(reviewTitle('mensagem', null), 'Conferir mensagem — Mensagem')
})

test('passo vindo da ficha: pergunta ou mensagem abre a janela; texto sem passo vai para a caixa', () => {
  assert.deepEqual(
    reviewFromPendingAsk({ leadId: 7, text: 'Para quando é?', questionKey: 'q_evento', attemptId: null }),
    { leadId: 7, kind: 'pergunta', text: 'Para quando é?', questionKey: 'q_evento', attemptId: null },
  )
  assert.deepEqual(
    reviewFromPendingAsk({ leadId: 7, text: 'Segue o catálogo', questionKey: null, attemptId: 12 }),
    { leadId: 7, kind: 'mensagem', text: 'Segue o catálogo', questionKey: null, attemptId: 12 },
  )
  // [Usar] de um desvio: sem passo, continua indo para a caixa
  assert.equal(reviewFromPendingAsk({ leadId: 7, text: 'Temos parcelamento', questionKey: null, attemptId: null }), null)
  assert.equal(reviewFromPendingAsk({ leadId: 7, text: '   ', questionKey: 'q', attemptId: null }), null)
  assert.equal(reviewFromPendingAsk(null), null)
})

test('chaves do envio: pergunta leva roteiro_question_key; mensagem leva cadence_attempt_id', () => {
  assert.deepEqual(reviewSendKeys({ kind: 'pergunta', questionKey: 'q_evento', attemptId: 10 }), { askKey: 'q_evento', stepKey: null })
  assert.deepEqual(reviewSendKeys({ kind: 'mensagem', questionKey: null, attemptId: 12 }), { askKey: null, stepKey: 12 })
})

test('Enviar agora so com texto, instancia e sem envio no ar', () => {
  assert.equal(canSendReview({ text: 'Oi', hasInstance: true, sending: false }), true)
  assert.equal(canSendReview({ text: '  ', hasInstance: true, sending: false }), false)
  assert.equal(canSendReview({ text: 'Oi', hasInstance: false, sending: false }), false)
  assert.equal(canSendReview({ text: 'Oi', hasInstance: true, sending: true }), false)
})

test('depois do envio pela janela: a caixa perde so a chave igual (nao conta duas vezes)', () => {
  assert.deepEqual(boxKeysAfterReviewSend({ askKey: 'q_evento', stepKey: null }, { askKey: 'q_evento', stepKey: null }), { askKey: null, stepKey: null })
  assert.deepEqual(boxKeysAfterReviewSend({ askKey: 'q_outra', stepKey: 12 }, { askKey: null, stepKey: 12 }), { askKey: 'q_outra', stepKey: null })
  assert.deepEqual(boxKeysAfterReviewSend({ askKey: 'q_outra', stepKey: null }, { askKey: 'q_evento', stepKey: null }), { askKey: 'q_outra', stepKey: null })
})

test('"Voce perguntou...?" so quando o envio nao levou a pergunta', () => {
  const r = { recognized_question: { question_key: 'q', text: 'x' }, message: { id: 5 } }
  assert.equal(offerRecognition(null, r), true)
  assert.equal(offerRecognition('q', r), false)
  assert.equal(offerRecognition(null, { recognized_question: null, message: { id: 5 } }), false)
  assert.equal(offerRecognition(null, { recognized_question: r.recognized_question, message: null }), false)
})

test('tarefas do lead: so do lead aberto, em ordem de prazo, atrasada marcada', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  const tasks = [
    { type: 'standalone', id: 1, lead_id: 7, title: 'Ligar amanhã', description: 'x'.repeat(120), due_datetime: '2026-09-29 12:00:00' },
    { type: 'cadence', lead_cadence_id: 3, lead_id: 7, cadence_name: 'Pós-venda', attempt_position: 1, total_attempts: 4, attempt_description: null, auto_message: 'Tudo certo?', due_datetime: '2026-09-27T10:00:00.000Z', action_type: 'ligacao' },
    { type: 'standalone', id: 2, lead_id: 8, title: 'De outro lead', due_datetime: '2026-09-20 12:00:00' },
  ]
  const rows = leadTaskRows(tasks, 7, now)
  assert.deepEqual(rows.map(r => r.key), ['c-3', 's-1'])
  assert.equal(rows[0].isCadence, true)
  assert.equal(rows[0].title, 'Pós-venda · Etapa 2/4')
  assert.equal(rows[0].desc, 'Tudo certo?')
  assert.equal(rows[0].overdue, true)
  assert.equal(rows[1].overdue, false)
  assert.equal(rows[1].desc.length, 103)
  assert.ok(rows[1].desc.endsWith('...'))
  assert.deepEqual(leadTaskRows(null, 7, now), [])
})

test('atendente: vendedor ve quem atende; gestor troca', () => {
  const attendants = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Bruno' }]
  assert.deepEqual(attendantView({ role: 'atendente', attendantId: 2, attendants }), { canChange: false, name: 'Bruno' })
  assert.deepEqual(attendantView({ role: 'gerente', attendantId: null, attendants }), { canChange: true, name: 'Sem atendente' })
  assert.deepEqual(attendantView({ role: 'super_admin', attendantId: 9, attendants, fallbackName: 'Carla' }), { canChange: true, name: 'Carla' })
})

test('titulo de secao com contagem', () => {
  assert.equal(sectionTitle('Tarefas', 2), 'Tarefas (2)')
  assert.equal(sectionTitle('Vendas', 0), 'Vendas (0)')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSendProvider, agentCanUseProvider, roleLabel, sendStatusMessage, lacksQuestion, needsVariety, formatReplyRate } from '../src/lib/antiban.js'

test('provedor de disparo', () => {
  assert.equal(isSendProvider('uzapi'), true)
  assert.equal(isSendProvider('cloud_api'), true)
  assert.equal(isSendProvider('evolution'), false)
  assert.equal(isSendProvider(undefined), false)
  assert.equal(roleLabel('disparo'), 'Disparo')
  assert.equal(roleLabel('leitura'), 'Leitura')
})

test('textos do aviso', () => {
  assert.equal(sendStatusMessage('no_send_number'), 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar')
  assert.equal(sendStatusMessage('send_number_offline'), 'O número de disparos está desconectado — os envios automáticos estão parados')
  assert.equal(sendStatusMessage(null), null)
})

test('dica da pergunta', () => {
  assert.equal(lacksQuestion('Oi, tudo bem?'), false)
  assert.equal(lacksQuestion('Oi, tudo bem'), true)
  assert.equal(lacksQuestion(''), false)
})

test('variacao: mesma regra do servidor', () => {
  assert.equal(needsVariety({ message_template: 'Oi {{nome}}' }), false)
  assert.equal(needsVariety({ variations: ['a', 'b'] }), false)
  assert.equal(needsVariety({ variations: '["a","b"]' }), false)
  assert.equal(needsVariety({ message_template: 'Oi' }), true)
  assert.equal(needsVariety({ message_template: '' }), false) // passo vazio: outra validacao cuida
})

test('taxa de resposta para o selo', () => {
  assert.equal(formatReplyRate(null), null)
  assert.equal(formatReplyRate({ reached: 5, replied: 1, rate: null }), null)
  assert.equal(formatReplyRate({ reached: 40, replied: 10, rate: 0.25 }), '25% responderam (7 dias)')
})

test('agente e numero: leitura (Evolution) so no modo Copiloto', () => {
  assert.equal(agentCanUseProvider('copilot', 'evolution'), true)
  assert.equal(agentCanUseProvider('auto', 'evolution'), false)
  assert.equal(agentCanUseProvider('sdr', 'evolution'), false)
  for (const m of ['auto', 'copilot', 'sdr']) assert.equal(agentCanUseProvider(m, 'uzapi'), true)
})

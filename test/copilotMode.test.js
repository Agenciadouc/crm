import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MODES, normalizeAgentMode, resolveEffectiveMode, usesSalesEngine,
  deliveryActionForMode, agentAcceptsLead,
} from '../server/services/copilotMode.js'

test('AGENT_MODES e normalizeAgentMode', () => {
  assert.deepEqual(AGENT_MODES, ['auto', 'copilot', 'sdr'])
  assert.equal(normalizeAgentMode('copilot'), 'copilot')
  assert.equal(normalizeAgentMode('sdr'), 'sdr')
  assert.equal(normalizeAgentMode(undefined), 'auto')
  assert.equal(normalizeAgentMode('qualquer'), 'auto')
})

test('resolveEffectiveMode: auto, copilot e sdr antes/depois da passagem', () => {
  assert.equal(resolveEffectiveMode({ mode: 'auto' }, {}), 'auto')
  assert.equal(resolveEffectiveMode({ mode: 'copilot' }, {}), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, { ai_handed_off_at: null }), 'sdr')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, { ai_handed_off_at: '2026-09-15 10:00:00' }), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, {}, true), 'copilot')
})

test('usesSalesEngine vale para todos os modos (Dros Sales)', () => {
  assert.equal(usesSalesEngine({ mode: 'auto' }), true)
  assert.equal(usesSalesEngine({}), true)
  assert.equal(usesSalesEngine({ mode: 'copilot' }), true)
  assert.equal(usesSalesEngine({ mode: 'sdr' }), true)
})

test('deliveryActionForMode: passo 13 por modo', () => {
  assert.equal(deliveryActionForMode('auto'), 'send')
  assert.equal(deliveryActionForMode('sdr'), 'send')
  assert.equal(deliveryActionForMode('copilot'), 'suggest')
})

test('agentAcceptsLead: auto mantem as regras atuais de ativacao', () => {
  const agent = { mode: 'auto', user_id: 9 }
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'default_attendant' }, { attendant_id: null }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'default_attendant' }, { attendant_id: 9 }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'roulette' }, { attendant_id: null }, false), false)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'roulette' }, { attendant_id: 9 }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'conditional' }, { attendant_id: null }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'manual' }, { attendant_id: 3 }, false), false)
})

test('agentAcceptsLead: lead com humano ou ja passado so aceita copilot/sdr', () => {
  const handed = { attendant_id: 3, ai_handed_off_at: '2026-09-15 10:00:00' }
  assert.equal(agentAcceptsLead({ mode: 'auto', activation_mode: 'conditional', user_id: 9 }, handed, true), false)
  assert.equal(agentAcceptsLead({ mode: 'copilot', activation_mode: 'roulette', user_id: 9 }, handed, true), true)
  assert.equal(agentAcceptsLead({ mode: 'sdr', activation_mode: 'roulette', user_id: 9 }, handed, true), true)
  assert.equal(agentAcceptsLead({ mode: 'auto', activation_mode: 'conditional', user_id: 9 }, { attendant_id: 3 }, true), false)
})

test('agentAcceptsLead: copilot ignora o modo de ativacao', () => {
  assert.equal(agentAcceptsLead({ mode: 'copilot', activation_mode: 'manual', user_id: 9 }, { attendant_id: null }, false), true)
})

test('resolveEffectiveMode: numero de leitura forca copilot (nunca envia pela Evolution)', () => {
  assert.equal(resolveEffectiveMode({ mode: 'auto' }, {}, false, true), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, {}, false, true), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'copilot' }, {}, false, true), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'auto' }, {}, false, false), 'auto')
})

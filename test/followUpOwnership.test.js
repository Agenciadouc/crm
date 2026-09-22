import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFollowUpLock, AGENT_FOLLOWUP_LOCKED_MSG } from '../server/services/followUpOwnership.js'

test('follow-up comum (sem agente) nao trava', () => {
  assert.equal(agentFollowUpLock({ id: 1, agent_id: null }, false), null)
  assert.equal(agentFollowUpLock({ id: 1 }, false), null)
})

test('follow-up de agente existente trava com 409 e diz onde editar', () => {
  assert.deepEqual(agentFollowUpLock({ id: 1, agent_id: 7 }, true), { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: 7 })
  assert.match(AGENT_FOLLOWUP_LOCKED_MSG, /Atendimento/)
})

test('follow-up de agente que nao existe mais nao trava', () => {
  assert.equal(agentFollowUpLock({ id: 1, agent_id: 7 }, false), null)
})

// server/routes/follow-ups.js passa agentExists = false pra agente apagado (soft delete,
// is_active = 0) ou de outra conta — a consulta real e
// 'SELECT 1 FROM ai_agents WHERE id = ? AND account_id = ? AND is_active = 1'.
// Aqui testamos so o contrato da funcao pura: agentExists=false destrava, seja qual for o motivo.
test('follow-up de agente inativo (soft delete) nao trava', () => {
  assert.equal(agentFollowUpLock({ id: 1, agent_id: 7, account_id: 1 }, false), null)
})

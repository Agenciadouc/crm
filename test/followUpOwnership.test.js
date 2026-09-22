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

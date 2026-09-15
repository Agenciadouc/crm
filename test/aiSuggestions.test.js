import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  normalizeForCompare, createReplySuggestion, getPendingSuggestion, resolveSuggestion,
  expirePendingForLead, expirePendingForAgent,
} from '../server/services/aiSuggestions.js'
import { pauseAiForLead, resumeAiForLead } from '../server/services/leadAiPause.js'

function statusOf(db, id) {
  return db.prepare('SELECT status FROM ai_suggestions WHERE id = ?').get(id).status
}

test('normalizeForCompare ignora espacos extras', () => {
  assert.equal(normalizeForCompare('  oi,\n  tudo   bem? '), 'oi, tudo bem?')
  assert.equal(normalizeForCompare(null), '')
})

test('createReplySuggestion grava pendente e expira a anterior do mesmo lead', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const first = createReplySuggestion(db, { accountId, leadId, agentId, content: 'primeira' })
  const second = createReplySuggestion(db, { accountId, leadId, agentId, content: 'segunda', source: 'base', payload: { analysis: { closeChance: 40 } } })
  assert.equal(statusOf(db, first), 'expired')
  const pending = getPendingSuggestion(db, accountId, leadId)
  assert.equal(pending.id, second)
  assert.equal(pending.content, 'segunda')
  assert.equal(pending.source, 'base')
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload_json FROM ai_suggestions WHERE id = ?').get(second).payload_json), { analysis: { closeChance: 40 } })
})

test('source invalido vira ai; sem pendente devolve null', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  assert.equal(getPendingSuggestion(db, accountId, leadId), null)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x', source: 'hack' })
  assert.equal(db.prepare('SELECT source FROM ai_suggestions WHERE id = ?').get(id).source, 'ai')
})

test('resolveSuggestion: igual (so espacos diferentes) = sent; diferente = edited', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const a = createReplySuggestion(db, { accountId, leadId, agentId, content: 'Oi, tudo bem?' })
  const r1 = resolveSuggestion(db, { accountId, suggestionId: a, action: 'sent', finalContent: 'Oi,  tudo bem? ', userId })
  assert.equal(r1.ok, true)
  assert.equal(r1.suggestion.status, 'sent')
  assert.equal(r1.suggestion.resolved_by, userId)
  const b = createReplySuggestion(db, { accountId, leadId, agentId, content: 'Oi, tudo bem?' })
  const r2 = resolveSuggestion(db, { accountId, suggestionId: b, action: 'sent', finalContent: 'Oi! Qual o volume por mes?', userId })
  assert.equal(r2.suggestion.status, 'edited')
  assert.equal(r2.suggestion.final_content, 'Oi! Qual o volume por mes?')
})

test('resolveSuggestion: descartar, nao pendente, outra conta e acao invalida', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  assert.deepEqual(resolveSuggestion(db, { accountId: outra.accountId, suggestionId: id, action: 'discarded', userId }), { ok: false, error: 'not_found' })
  assert.deepEqual(resolveSuggestion(db, { accountId, suggestionId: id, action: 'apagar', userId }), { ok: false, error: 'invalid_action' })
  const r = resolveSuggestion(db, { accountId, suggestionId: id, action: 'discarded', userId })
  assert.equal(r.suggestion.status, 'discarded')
  assert.equal(r.suggestion.final_content, null)
  assert.equal(resolveSuggestion(db, { accountId, suggestionId: id, action: 'sent', finalContent: 'x', userId }).error, 'not_pending')
})

test('expirePendingForLead expira so a pendente daquele lead e conta', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  assert.equal(expirePendingForLead(db, accountId + 999, leadId), 0)
  assert.equal(expirePendingForLead(db, accountId, leadId), 1)
  assert.equal(statusOf(db, id), 'expired')
  assert.equal(expirePendingForLead(db, accountId, leadId), 0)
})

test('expirePendingForAgent devolve os leads afetados e nao mexe em outro agente', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const lead2 = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(accountId, 'Lead 2').lastInsertRowid)
  const agent2 = Number(db.prepare('INSERT INTO ai_agents (account_id, user_id, name) VALUES (?, ?, ?)').run(accountId, userId, 'Agente 2').lastInsertRowid)
  createReplySuggestion(db, { accountId, leadId, agentId, content: 'a' })
  const other = createReplySuggestion(db, { accountId, leadId: lead2, agentId: agent2, content: 'b' })
  assert.deepEqual(expirePendingForAgent(db, accountId, agentId), [leadId])
  assert.equal(statusOf(db, other), 'pending')
})

test('pausar grava quem pausou e expira pendente; retomar limpa', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  const pausedAt = pauseAiForLead(db, { accountId, leadId, userId })
  assert.ok(pausedAt)
  const row = db.prepare('SELECT ai_paused_at, ai_paused_by FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.ai_paused_by, userId)
  assert.equal(statusOf(db, id), 'expired')
  assert.equal(resumeAiForLead(db, { accountId, leadId }), null)
  const after = db.prepare('SELECT ai_paused_at, ai_paused_by FROM leads WHERE id = ?').get(leadId)
  assert.equal(after.ai_paused_at, null)
  assert.equal(after.ai_paused_by, null)
})

test('pausar lead de outra conta nao altera nada', () => {
  const db = createTestDb()
  const { leadId, userId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  assert.equal(pauseAiForLead(db, { accountId: outra.accountId, leadId, userId }), null)
  assert.equal(db.prepare('SELECT ai_paused_at FROM leads WHERE id = ?').get(leadId).ai_paused_at, null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { applyCopilotSchema } from '../server/services/copilotSchema.js'

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}

test('schema cria colunas novas em ai_agents, accounts e leads', () => {
  const db = createTestDb()
  assert.ok(columns(db, 'ai_agents').includes('mode'))
  assert.ok(columns(db, 'accounts').includes('ai_key_source'))
  for (const col of ['ai_close_chance', 'ai_main_blocker', 'ai_criteria_json', 'ai_moment', 'ai_msgs_since_analysis', 'ai_paused_at', 'ai_paused_by']) {
    assert.ok(columns(db, 'leads').includes(col), `faltou leads.${col}`)
  }
})

test('defaults nao mudam comportamento: mode auto, ai_key_source client, contador 0', () => {
  const db = createTestDb()
  const { accountId, agentId, leadId } = seedAccountAndLead(db)
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(agentId).mode, 'auto')
  assert.equal(db.prepare('SELECT ai_key_source FROM accounts WHERE id = ?').get(accountId).ai_key_source, 'client')
  assert.equal(db.prepare('SELECT ai_msgs_since_analysis FROM leads WHERE id = ?').get(leadId).ai_msgs_since_analysis, 0)
})

test('tabela ai_suggestions tem as colunas do spec e defaults pending/reply/ai', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const expected = ['id', 'account_id', 'lead_id', 'agent_id', 'kind', 'source', 'ready_message_id', 'content', 'payload_json', 'status', 'final_content', 'lead_follow_up_id', 'outcome_replied', 'outcome_advanced', 'outcome_checked_at', 'created_at', 'resolved_at', 'resolved_by']
  assert.deepEqual(columns(db, 'ai_suggestions').sort(), [...expected].sort())
  const id = db.prepare('INSERT INTO ai_suggestions (account_id, lead_id, agent_id, content) VALUES (?, ?, ?, ?)').run(accountId, leadId, agentId, 'oi').lastInsertRowid
  const row = db.prepare('SELECT status, kind, source FROM ai_suggestions WHERE id = ?').get(id)
  assert.deepEqual({ ...row }, { status: 'pending', kind: 'reply', source: 'ai' })
})

test('applyCopilotSchema e idempotente', () => {
  const db = createTestDb()
  assert.doesNotThrow(() => applyCopilotSchema(db))
  assert.doesNotThrow(() => applyCopilotSchema(db))
})

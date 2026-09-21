import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { applyAgentBriefingSchema } from '../server/services/agentBriefingSchema.js'

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}

test('cria as tres tabelas com as colunas do spec', () => {
  const db = createTestDb()
  assert.deepEqual(columns(db, 'agent_briefings'),
    ['id', 'account_id', 'agent_id', 'status', 'compiled_json', 'created_by', 'created_at', 'updated_at',
     'compiled_at', 'tokens_used'])
  assert.deepEqual(columns(db, 'agent_briefing_turns'),
    ['id', 'briefing_id', 'position', 'role', 'content', 'created_at'])
  assert.deepEqual(columns(db, 'agent_briefing_sources'),
    ['id', 'briefing_id', 'kind', 'ref', 'content', 'status', 'error', 'created_at'])
})

test('migracao das colunas novas e idempotente e nao mexe em briefing que ja existe', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const id = db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId).lastInsertRowid
  applyAgentBriefingSchema(db)
  applyAgentBriefingSchema(db)
  const row = db.prepare('SELECT compiled_at, tokens_used FROM agent_briefings WHERE id = ?').get(id)
  assert.equal(row.compiled_at, null)
  assert.equal(row.tokens_used, 0, 'briefing antigo entra na migracao com contador zerado')
})

test('briefing nasce como rascunho sem agente', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const id = db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId).lastInsertRowid
  const row = db.prepare('SELECT status, agent_id FROM agent_briefings WHERE id = ?').get(id)
  assert.equal(row.status, 'entrevistando')
  assert.equal(row.agent_id, null)
})

test('status so aceita os tres valores do spec', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  assert.throws(
    () => db.prepare("INSERT INTO agent_briefings (account_id, created_by, status) VALUES (?, ?, 'sei la')").run(accountId, userId),
    /CHECK constraint failed/
  )
})

test('apagar o briefing leva turnos e fontes junto', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const bid = db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId).lastInsertRowid
  db.prepare("INSERT INTO agent_briefing_turns (briefing_id, position, role, content) VALUES (?, 1, 'ia', 'oi')").run(bid)
  db.prepare("INSERT INTO agent_briefing_sources (briefing_id, kind, content) VALUES (?, 'entrevista', 'texto')").run(bid)
  db.prepare('DELETE FROM agent_briefings WHERE id = ?').run(bid)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefing_turns').get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefing_sources').get().c, 0)
})

test('so pode haver um briefing por agente', () => {
  const db = createTestDb()
  const { accountId, userId, agentId } = seedAccountAndLead(db)
  db.prepare("INSERT INTO agent_briefings (account_id, agent_id, created_by, status) VALUES (?, ?, ?, 'ativo')").run(accountId, agentId, userId)
  assert.throws(
    () => db.prepare("INSERT INTO agent_briefings (account_id, agent_id, created_by, status) VALUES (?, ?, ?, 'ativo')").run(accountId, agentId, userId),
    /UNIQUE constraint failed/
  )
})

test('varios rascunhos sem agente convivem (agent_id nulo nao colide no indice unico)', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId)
  db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefings').get().c, 2)
})

test('aplicar o schema duas vezes nao quebra', () => {
  const db = createTestDb()
  applyAgentBriefingSchema(db)
  applyAgentBriefingSchema(db)
  assert.ok(columns(db, 'agent_briefings').includes('compiled_json'))
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { agentFollowUpLock, AGENT_FOLLOWUP_LOCKED_MSG, agentIsActiveOwner } from '../server/services/followUpOwnership.js'

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

// ─── agentIsActiveOwner: exercita a consulta SQL de verdade (nao so o contrato
// booleano de agentFollowUpLock). E a mesma funcao que server/routes/follow-ups.js
// chama em lockIfAgentOwned — aqui rodamos contra um banco SQLite em memoria de
// verdade pra provar o predicado `AND account_id = ? AND is_active = 1`.
function dbComAgentes() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      ai_agents_enabled INTEGER
    );
    CREATE TABLE ai_agents (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `)
  db.exec(`
    INSERT INTO accounts (id, ai_agents_enabled) VALUES
      (10, 1),     -- conta com agentes de IA ligados
      (20, 1),
      (30, 0),     -- conta com a IA desligada
      (40, NULL);  -- conta antiga, nunca habilitada
    INSERT INTO ai_agents (id, account_id, is_active) VALUES
      (1, 10, 1),  -- ativo, conta 10
      (2, 10, 0),  -- inativo (soft delete), conta 10
      (3, 20, 1),  -- ativo, mas de OUTRA conta (20)
      (4, 30, 1),  -- ativo, mas a conta esta com a IA desligada
      (5, 40, 1);  -- ativo, conta sem a flag
  `)
  return db
}

test('agentIsActiveOwner: agente ativo da mesma conta trava (PUT/DELETE devolvem 409)', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: 1, account_id: 10 }), true)
  assert.deepEqual(
    agentFollowUpLock({ id: 99, agent_id: 1 }, agentIsActiveOwner(db, { agent_id: 1, account_id: 10 })),
    { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: 1 },
  )
})

test('agentIsActiveOwner: agente inativo (soft delete) nao trava (PUT/DELETE passam)', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: 2, account_id: 10 }), false)
  assert.equal(agentFollowUpLock({ id: 99, agent_id: 2 }, agentIsActiveOwner(db, { agent_id: 2, account_id: 10 })), null)
})

test('agentIsActiveOwner: agent_id de OUTRA conta nao trava', () => {
  const db = dbComAgentes()
  // O follow-up e da conta 10, mas o agent_id (3) so existe ativo na conta 20 —
  // nao pode travar por causa do agente de outra conta.
  assert.equal(agentIsActiveOwner(db, { agent_id: 3, account_id: 10 }), false)
})

test('agentIsActiveOwner: sem agent_id nao consulta nada e nao trava', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: null, account_id: 10 }), false)
  assert.equal(agentIsActiveOwner(db, {}), false)
})

// Com a feature de IA desligada na conta, a pagina Agentes de IA responde agents: []
// e o editor do agente fica inacessivel (403). Se o follow-up continuasse travado,
// a linha ficaria sem caminho nenhum: nao da pra editar aqui nem la.
test('agentIsActiveOwner: conta com a IA desligada nao trava o follow-up', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: 4, account_id: 30 }), false)
  assert.equal(agentFollowUpLock({ id: 99, agent_id: 4 }, agentIsActiveOwner(db, { agent_id: 4, account_id: 30 })), null)
})

test('agentIsActiveOwner: conta antiga sem a flag nao trava o follow-up', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: 5, account_id: 40 }), false)
})

test('agentIsActiveOwner: conta que nao existe mais nao trava', () => {
  const db = dbComAgentes()
  assert.equal(agentIsActiveOwner(db, { agent_id: 1, account_id: 99 }), false)
})

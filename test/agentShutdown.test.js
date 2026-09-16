import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { AGENT_OFF_NOTE, findLeadsHeldByAgent, findResponsibleHumanId } from '../server/services/agentShutdown.js'

// Colunas e tabelas de atendimento que o helper da Task 1 nao cria
function addAttendanceTables(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN attendant_id INTEGER;
    ALTER TABLE leads ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content TEXT,
      ai_agent_id INTEGER
    );
    CREATE TABLE whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      default_attendant_id INTEGER
    );
    CREATE TABLE lead_instance_assignments (
      lead_id INTEGER NOT NULL,
      instance_id INTEGER NOT NULL,
      attendant_id INTEGER,
      PRIMARY KEY (lead_id, instance_id)
    );
  `)
}

function setup() {
  const db = createTestDb()
  addAttendanceTables(db)
  const base = seedAccountAndLead(db)
  // O usuario semeado vira o robo do agente
  db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(base.userId)
  const humanId = Number(db.prepare('INSERT INTO users (account_id, name) VALUES (?, ?)').run(base.accountId, 'Vendedora').lastInsertRowid)
  const newLead = (fields = {}) => {
    const id = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(base.accountId, 'Lead').lastInsertRowid)
    for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE leads SET ${k} = ? WHERE id = ?`).run(v, id)
    return id
  }
  const aiMessage = (leadId) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, ai_agent_id) VALUES (?, ?, 'outbound', 'oi', ?)").run(leadId, base.accountId, base.agentId)
  return { db, ...base, humanId, newLead, aiMessage }
}

const held = (s) => findLeadsHeldByAgent(s.db, { accountId: s.accountId, agentId: s.agentId, agentUserId: s.userId }).map(l => l.id)

test('AGENT_OFF_NOTE tem o texto do spec', () => {
  assert.equal(AGENT_OFF_NOTE, 'IA desligada — assuma a conversa')
})

test('lead com o robo do agente como atendente esta com a IA', () => {
  const s = setup()
  const id = s.newLead({ attendant_id: s.userId })
  assert.deepEqual(held(s), [id])
})

test('lead sem atendente mas com mensagem enviada pelo agente esta com a IA', () => {
  const s = setup()
  const id = s.newLead()
  s.aiMessage(id)
  assert.ok(held(s).includes(id))
  assert.ok(!held(s).includes(s.leadId), 'lead sem atendente e sem mensagem da IA nao entra')
})

test('fica de fora: ja passado, humano atendendo, arquivado, bloqueado, inativo', () => {
  const s = setup()
  const passado = s.newLead({ attendant_id: s.userId, ai_handed_off_at: '2026-09-15 10:00:00' })
  const humano = s.newLead({ attendant_id: s.humanId })
  s.aiMessage(humano)
  const arquivado = s.newLead({ attendant_id: s.userId, is_archived: 1 })
  const bloqueado = s.newLead({ attendant_id: s.userId, is_blocked: 1 })
  const inativo = s.newLead({ attendant_id: s.userId, is_active: 0 })
  const ids = held(s)
  for (const id of [passado, humano, arquivado, bloqueado, inativo]) assert.ok(!ids.includes(id), `lead ${id} nao deveria entrar`)
})

test('lead de outra conta nao entra', () => {
  const s = setup()
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  s.db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(s.userId, outra.leadId)
  assert.ok(!held(s).includes(outra.leadId))
})

test('responsavel: atendente humano da conversa na instancia', () => {
  const s = setup()
  const inst = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, NULL)').run(s.accountId).lastInsertRowid)
  s.db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(s.leadId, inst, s.humanId)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: inst }), s.humanId)
})

test('responsavel: conversa com robo cai no atendente padrao humano da instancia', () => {
  const s = setup()
  const inst = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.humanId).lastInsertRowid)
  s.db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(s.leadId, inst, s.userId)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: inst }), s.humanId)
})

test('responsavel: sem humano, sem instancia ou instancia de outra conta = null (vai para a roleta)', () => {
  const s = setup()
  const instRobo = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.userId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instRobo }), null)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: null }), null)
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  const instOutra = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(outra.accountId, s.humanId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instOutra }), null)
  s.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(s.humanId)
  const instInativo = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.humanId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instInativo }), null)
})

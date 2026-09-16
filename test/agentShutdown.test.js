import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { AGENT_OFF_NOTE, findLeadsHeldByAgent, findResponsibleHumanId, releaseLeadsFromAgent } from '../server/services/agentShutdown.js'

// Espera a fila de microtasks/setImmediate esvaziar (releaseLeadsFromAgent dispara
// notifyAndOpenLead via setImmediate, fire-and-forget, pra nao bloquear o caller).
const flush = () => new Promise((resolve) => setImmediate(resolve))

// Colunas e tabelas de atendimento que o helper da Task 1 nao cria
function addAttendanceTables(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN attendant_id INTEGER;
    ALTER TABLE leads ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN last_instance_id INTEGER;
    ALTER TABLE leads ADD COLUMN updated_at TEXT;
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
  // agent no formato que releaseLeadsFromAgent espera ({ id, account_id, user_id })
  const agent = { id: base.agentId, account_id: base.accountId, user_id: base.userId }
  return { db, ...base, humanId, newLead, aiMessage, agent }
}

const held = (s) => findLeadsHeldByAgent(s.db, { accountId: s.accountId, agentId: s.agentId, agentUserId: s.userId }).map(l => l.id)

// executeHandoff fake: simula a roleta achando (ou nao) um humano, sem depender do
// executeHandoff real (que mora em aiAgent.js e importa server/db.js).
function fakeExecuteHandoff(db, { assignsTo = null } = {}) {
  const calls = []
  const fn = (agent, lead, reason, instanceId) => {
    calls.push({ agentId: agent.id, leadId: lead.id, reason, instanceId })
    if (assignsTo) {
      db.prepare("UPDATE leads SET attendant_id = ?, ai_handed_off_at = datetime('now') WHERE id = ?").run(assignsTo, lead.id)
    } else {
      // roleta tambem nao achou ninguem: so marca handoff, NAO mexe no attendant_id
      // (replica o executeHandoff real quando targetUserId fica null)
      db.prepare("UPDATE leads SET ai_handed_off_at = datetime('now') WHERE id = ?").run(lead.id)
    }
  }
  return { fn, calls }
}

function fakeNotify() {
  const calls = []
  const fn = async (leadId, userId, opts) => { calls.push({ leadId, userId, opts }) }
  return { fn, calls }
}

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

// ─── releaseLeadsFromAgent: escrita real (attendant_id, ai_handed_off_at, nota, notificacao) ───

test('libera para o vendedor responsavel: atualiza attendant_id e ai_handed_off_at, grava nota e notifica (sem chamar executeHandoff)', async () => {
  const s = setup()
  const inst = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, NULL)').run(s.accountId).lastInsertRowid)
  const leadId = s.newLead({ attendant_id: s.userId, last_instance_id: inst })
  s.db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(leadId, inst, s.humanId)

  const handoff = fakeExecuteHandoff(s.db)
  const notify = fakeNotify()
  const broadcasts = []

  const result = releaseLeadsFromAgent(s.db, s.agent, {
    executeHandoff: handoff.fn,
    notifyAndOpenLead: notify.fn,
    broadcastSSE: (...args) => broadcasts.push(args),
  })

  assert.deepEqual(result, { total: 1, released: 1 })
  assert.equal(handoff.calls.length, 0, 'ha responsavel direto: nao deveria cair no executeHandoff/roleta')

  const lead = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.attendant_id, s.humanId)
  assert.ok(lead.ai_handed_off_at, 'ai_handed_off_at deveria estar preenchido')

  const note = s.db.prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId)
  assert.equal(note.content, AGENT_OFF_NOTE)
  assert.equal(note.user_id, s.userId)

  assert.equal(broadcasts.length, 1)

  await flush() // notifyAndOpenLead eh disparado via setImmediate (fire-and-forget)
  assert.equal(notify.calls.length, 1)
  assert.equal(notify.calls[0].leadId, leadId)
  assert.equal(notify.calls[0].userId, s.humanId)
  assert.equal(notify.calls[0].opts.source, 'bot_handoff')
})

test('ninguem humano disponivel (nem responsavel nem roleta): lead fica sem atendente, nao no robo desligado', async () => {
  const s = setup()
  const leadId = s.newLead({ attendant_id: s.userId }) // sem instancia -> findResponsibleHumanId = null

  const handoff = fakeExecuteHandoff(s.db, { assignsTo: null }) // roleta tambem nao acha ninguem
  const notify = fakeNotify()

  const result = releaseLeadsFromAgent(s.db, s.agent, {
    executeHandoff: handoff.fn,
    notifyAndOpenLead: notify.fn,
  })

  assert.deepEqual(result, { total: 1, released: 1 })
  assert.equal(handoff.calls.length, 1)
  assert.equal(handoff.calls[0].reason, 'agent_off')

  const lead = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.attendant_id, null, 'lead nao pode continuar apontando pro robo desligado')
  assert.ok(lead.ai_handed_off_at)

  const note = s.db.prepare('SELECT * FROM lead_notes WHERE lead_id = ?').get(leadId)
  assert.equal(note.content, AGENT_OFF_NOTE)

  await flush()
  assert.equal(notify.calls.length, 0, 'sem humano encontrado, ninguem pra notificar')
})

test('roleta (dentro do executeHandoff) encontra um humano: attendant_id fica com ele, nao eh zerado', () => {
  const s = setup()
  const leadId = s.newLead({ attendant_id: s.userId })
  const handoff = fakeExecuteHandoff(s.db, { assignsTo: s.humanId })

  releaseLeadsFromAgent(s.db, s.agent, { executeHandoff: handoff.fn, notifyAndOpenLead: fakeNotify().fn })

  const lead = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.attendant_id, s.humanId)
  assert.ok(lead.ai_handed_off_at)
})

test('libera nao mexe em lead nem em nota de outra conta', () => {
  const s = setup()
  const leadId = s.newLead({ attendant_id: s.userId })
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  const before = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(outra.leadId)

  const handoff = fakeExecuteHandoff(s.db, { assignsTo: null })
  releaseLeadsFromAgent(s.db, s.agent, { executeHandoff: handoff.fn, notifyAndOpenLead: fakeNotify().fn })

  const after = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(outra.leadId)
  assert.deepEqual(after, before, 'lead de outra conta nao pode ser tocado')
  const notesOutra = s.db.prepare('SELECT * FROM lead_notes WHERE lead_id = ?').all(outra.leadId)
  assert.equal(notesOutra.length, 0, 'nenhuma nota deveria ser criada pra lead de outra conta')

  // confirma que o lead da propria conta foi mesmo processado (efeito real aconteceu)
  const own = s.db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(own.attendant_id, null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { agentSendsWithoutSeller, findAutoRescueCandidates, findFollowUpAgent } from '../server/services/copilotGuards.js'

// Colunas/tabelas de atendimento que o helper base nao cria
function addAttendanceTables(db) {
  db.exec(`
    ALTER TABLE leads ADD COLUMN attendant_id INTEGER;
    ALTER TABLE leads ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN last_rescue_attempt_at TEXT;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content TEXT,
      ai_agent_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

function setup({ mode = 'auto' } = {}) {
  const db = createTestDb()
  addAttendanceTables(db)
  const base = seedAccountAndLead(db)
  db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(base.userId)
  db.prepare('UPDATE ai_agents SET mode = ? WHERE id = ?').run(mode, base.agentId)
  const newLead = (fields = {}) => {
    const id = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(base.accountId, 'Lead').lastInsertRowid)
    for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE leads SET ${k} = ? WHERE id = ?`).run(v, id)
    return id
  }
  const inbound = (leadId, at = '2026-09-15 10:00:00') =>
    db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, 'inbound', 'oi', ?)").run(leadId, base.accountId, at)
  const outboundAi = (leadId, at = '2026-09-15 11:00:00') =>
    db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, ai_agent_id, created_at) VALUES (?, ?, 'outbound', 'resposta', ?, ?)").run(leadId, base.accountId, base.agentId, at)
  const outboundHuman = (leadId, at = '2026-09-15 11:00:00') =>
    db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, 'outbound', 'resposta', ?)").run(leadId, base.accountId, at)
  const ids = () => findAutoRescueCandidates(db).map(r => r.id)
  return { db, ...base, newLead, inbound, outboundAi, outboundHuman, ids }
}

// ─── Item 2: auto-rescue nao pode gerar sugestao fantasma no Copiloto ───

test('auto-rescue: lead do robo com inbound sem resposta da IA entra (agente auto)', () => {
  const s = setup({ mode: 'auto' })
  const id = s.newLead({ attendant_id: s.userId })
  s.inbound(id)
  assert.deepEqual(s.ids(), [id])
})

test('auto-rescue: agente auto que ja respondeu depois do inbound sai da lista', () => {
  const s = setup({ mode: 'auto' })
  const id = s.newLead({ attendant_id: s.userId })
  s.inbound(id, '2026-09-15 10:00:00')
  s.outboundAi(id, '2026-09-15 10:05:00')
  assert.deepEqual(s.ids(), [])
})

test('auto-rescue: lead de agente em modo copilot NUNCA entra, mesmo sem nenhuma outbound da IA', () => {
  const s = setup({ mode: 'copilot' })
  const id = s.newLead({ attendant_id: s.userId })
  s.inbound(id)
  assert.deepEqual(s.ids(), [], 'no copiloto quem responde e o vendedor: nao ha nada a resgatar')
  // e continua fora mesmo depois de o vendedor responder na mao (outbound sem ai_agent_id),
  // que era exatamente o caso que fazia a sugestao fantasma voltar a cada tick
  s.outboundHuman(id, '2026-09-15 10:05:00')
  assert.deepEqual(s.ids(), [])
})

test('auto-rescue: agente migrado de auto para copilot para de gerar candidatos', () => {
  const s = setup({ mode: 'auto' })
  const id = s.newLead({ attendant_id: s.userId })
  s.inbound(id)
  assert.deepEqual(s.ids(), [id])
  s.db.prepare("UPDATE ai_agents SET mode = 'copilot' WHERE id = ?").run(s.agentId)
  assert.deepEqual(s.ids(), [])
})

test('auto-rescue: copilot de OUTRA conta nao desqualifica o robo desta conta', () => {
  const s = setup({ mode: 'auto' })
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  // agente copilot de outra conta compartilhando o mesmo user_id do robo daqui
  s.db.prepare("UPDATE ai_agents SET mode = 'copilot', user_id = ? WHERE id = ?").run(s.userId, outra.agentId)
  const id = s.newLead({ attendant_id: s.userId })
  s.inbound(id)
  assert.deepEqual(s.ids(), [id])
})

test('auto-rescue: cooldown, arquivado, bloqueado, inativo e ja passado ficam de fora', () => {
  const s = setup({ mode: 'auto' })
  const ok = s.newLead({ attendant_id: s.userId })
  s.inbound(ok)
  for (const fields of [{ is_archived: 1 }, { is_blocked: 1 }, { is_active: 0 }, { ai_handed_off_at: '2026-09-15 09:00:00' }]) {
    const id = s.newLead({ attendant_id: s.userId, ...fields })
    s.inbound(id)
  }
  const recente = s.newLead({ attendant_id: s.userId })
  s.inbound(recente)
  s.db.prepare("UPDATE leads SET last_rescue_attempt_at = datetime('now') WHERE id = ?").run(recente)
  assert.deepEqual(s.ids(), [ok])
})

// ─── Item 4: follow-up de inatividade nao envia sozinho no Copiloto ───

test('follow-up: agente auto pode enviar sozinho; agente copilot nao', () => {
  const s = setup({ mode: 'auto' })
  const auto = findFollowUpAgent(s.db, { accountId: s.accountId, agentId: s.agentId })
  assert.equal(auto.mode, 'auto')
  assert.equal(agentSendsWithoutSeller(auto), true)

  s.db.prepare("UPDATE ai_agents SET mode = 'copilot' WHERE id = ?").run(s.agentId)
  const copilot = findFollowUpAgent(s.db, { accountId: s.accountId, agentId: s.agentId })
  assert.equal(agentSendsWithoutSeller(copilot), false, 'no copiloto nada sai sem o vendedor')
})

test('follow-up: agente migrado de auto para copilot para de enviar (caso do outbound antigo)', () => {
  const s = setup({ mode: 'auto' })
  const id = s.newLead({ attendant_id: s.userId })
  s.outboundAi(id) // outbound antiga com ai_agent_id — o que fazia o EXISTS do scanner passar
  s.db.prepare("UPDATE ai_agents SET mode = 'copilot' WHERE id = ?").run(s.agentId)
  const agent = findFollowUpAgent(s.db, { accountId: s.accountId, agentId: s.agentId })
  assert.equal(agentSendsWithoutSeller(agent), false)
})

test('follow-up: agente de outra conta ou inativo nao e encontrado', () => {
  const s = setup({ mode: 'auto' })
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  assert.equal(findFollowUpAgent(s.db, { accountId: s.accountId, agentId: outra.agentId }), null)
  s.db.prepare('UPDATE ai_agents SET is_active = 0 WHERE id = ?').run(s.agentId)
  assert.equal(findFollowUpAgent(s.db, { accountId: s.accountId, agentId: s.agentId }), null)
})

test('follow-up: modo desconhecido ou nulo cai no auto (nao trava o legado)', () => {
  assert.equal(agentSendsWithoutSeller({ mode: null }), true)
  assert.equal(agentSendsWithoutSeller({ mode: 'sdr' }), true)
  assert.equal(agentSendsWithoutSeller(null), false)
})

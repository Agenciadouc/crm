import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberRole, isSendRole, SEND_PROVIDERS, agentInstanceBlocker, agentServesInstance, READ_NUMBER_AGENT_BLOCKER } from '../server/services/whatsapp/numberRole.js'
import { createTestDb, seedBasic } from './helpers/db.js'

test('papel pelo provedor', () => {
  assert.equal(numberRole({ provider: 'evolution' }), 'leitura')
  assert.equal(numberRole({ provider: '' }), 'leitura')
  assert.equal(numberRole({}), 'leitura')
  assert.equal(numberRole(null), 'leitura')
  assert.equal(numberRole({ provider: 'custom' }), 'leitura')
  assert.equal(numberRole({ provider: 'uzapi' }), 'disparo')
  assert.equal(numberRole({ provider: 'cloud_api' }), 'disparo')
  assert.equal(isSendRole({ provider: 'uzapi' }), true)
  assert.equal(isSendRole({ provider: 'evolution' }), false)
  assert.deepEqual(SEND_PROVIDERS, ['uzapi', 'cloud_api'])
})

test('migracao cria as colunas novas (idempotente)', () => {
  const db = createTestDb()
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  for (const c of ['default_send_instance_id', 'optout_footer_enabled', 'optout_footer_text', 'optout_confirm_text', 'reply_rate_alert_pct']) {
    assert.ok(cols('accounts').includes(c), c)
  }
  assert.ok(cols('leads').includes('opted_out_at'))
  assert.ok(cols('follow_ups').includes('optout_footer_enabled'))
  const acc = db.prepare("INSERT INTO accounts (name, slug) VALUES ('A', 'a')").run().lastInsertRowid
  const row = db.prepare('SELECT optout_footer_enabled, reply_rate_alert_pct FROM accounts WHERE id = ?').get(acc)
  assert.equal(row.optout_footer_enabled, 1)
  assert.equal(row.reply_rate_alert_pct, 10)
})

test('agentInstanceBlocker: agente so atende numero de disparo', () => {
  const db = createTestDb(); const s = seedBasic(db) // s.instance = Evolution (leitura)
  assert.equal(agentInstanceBlocker(db, s.instance.id), READ_NUMBER_AGENT_BLOCKER)
  assert.equal(READ_NUMBER_AGENT_BLOCKER, 'Número de leitura: o agente só atende números de disparo')
  const uz = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', 'connected', 'uzapi')`).run(s.account.id).lastInsertRowid
  assert.equal(agentInstanceBlocker(db, uz), null)
  db.prepare("UPDATE whatsapp_instances SET provider = 'cloud_api' WHERE id = ?").run(uz)
  assert.equal(agentInstanceBlocker(db, uz), null)
  assert.equal(agentInstanceBlocker(db, 9999), 'Número de WhatsApp não encontrado')
  assert.equal(agentInstanceBlocker(db, null), null) // sem numero: sem filtro de numero (como antes)
})

// Decisao do dono (24/09/2026): na Evolution o Copiloto roda so como suporte (sugere, nunca envia).
// Auto e SDR continuam so no numero de disparo.
test('agentServesInstance: leitura so aceita agente em modo copilot', () => {
  const evo = { provider: 'evolution' }
  const uz = { provider: 'uzapi' }
  assert.equal(agentServesInstance({ mode: 'copilot' }, evo), true)
  assert.equal(agentServesInstance({ mode: 'auto' }, evo), false)
  assert.equal(agentServesInstance({ mode: 'sdr' }, evo), false)
  assert.equal(agentServesInstance({}, evo), false)
  for (const mode of ['auto', 'copilot', 'sdr']) assert.equal(agentServesInstance({ mode }, uz), true)
  assert.equal(agentServesInstance({ mode: 'copilot' }, null), false)
})

test('agentInstanceBlocker: leitura libera quando a conta tem Copiloto ativo', () => {
  const db = createTestDb(); const s = seedBasic(db)
  db.exec("CREATE TABLE ai_agents (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, user_id INTEGER, name TEXT, is_active INTEGER NOT NULL DEFAULT 1, mode TEXT NOT NULL DEFAULT 'auto')")
  const userId = db.prepare("INSERT INTO users (account_id, name, is_bot) VALUES (?, 'Bot', 1)").run(s.account.id).lastInsertRowid
  const agentId = db.prepare("INSERT INTO ai_agents (account_id, user_id, name, is_active, mode) VALUES (?, ?, 'IA', 1, 'auto')").run(s.account.id, userId).lastInsertRowid
  assert.equal(agentInstanceBlocker(db, s.instance.id, s.account.id), READ_NUMBER_AGENT_BLOCKER)
  db.prepare("UPDATE ai_agents SET mode = 'copilot' WHERE id = ?").run(agentId)
  assert.equal(agentInstanceBlocker(db, s.instance.id, s.account.id), null)
  db.prepare('UPDATE ai_agents SET is_active = 0 WHERE id = ?').run(agentId)
  assert.equal(agentInstanceBlocker(db, s.instance.id, s.account.id), READ_NUMBER_AGENT_BLOCKER)
})

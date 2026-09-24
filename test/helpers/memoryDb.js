// Banco SQLite em memoria para testes. NAO importa server/db.js (ele abre o banco real).
import Database from 'better-sqlite3'
import { registerCityFunctions } from '../../server/services/city.js'
import { applyCopilotSchema } from '../../server/services/copilotSchema.js'
import { applyAgentBriefingSchema } from '../../server/services/agentBriefingSchema.js'

export function createTestDb() {
  const db = new Database(':memory:')
  registerCityFunctions(db)
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      anthropic_api_key TEXT,
      ai_agents_enabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      name TEXT NOT NULL,
      email TEXT,
      password TEXT,
      role TEXT,
      is_active INTEGER DEFAULT 1,
      is_bot INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      identifies_as_bot INTEGER DEFAULT 1,
      persona TEXT,
      knowledge_base TEXT,
      never_mention TEXT,
      qualification_criteria TEXT,
      required_fields TEXT,
      responds_to_audio INTEGER DEFAULT 0,
      audio_decline_message TEXT,
      max_messages_before_handoff INTEGER DEFAULT 15,
      handoff_keywords TEXT,
      activation_mode TEXT,
      required_tag_id INTEGER,
      monthly_token_limit INTEGER DEFAULT 500000,
      tokens_used_this_month INTEGER DEFAULT 0,
      current_month TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agent_stages (
      agent_id INTEGER,
      stage_id INTEGER
    );
    CREATE TABLE ai_agent_instances (
      agent_id INTEGER,
      instance_id INTEGER
    );
    CREATE TABLE ai_agent_handoff_rules (
      agent_id INTEGER,
      reason TEXT,
      target_type TEXT,
      target_user_id INTEGER,
      fallback_to_roulette INTEGER,
      move_to_stage_id INTEGER,
      add_tag_id INTEGER
    );
    CREATE TABLE whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      instance_name TEXT,
      status TEXT
    );
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE funnel_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      funnel_id INTEGER NOT NULL,
      name TEXT,
      position INTEGER
    );
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT, email TEXT, phone TEXT, city TEXT, empresa TEXT, instagram TEXT,
      ai_handed_off_at TEXT
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      content TEXT,
      media_type TEXT DEFAULT 'text',
      media_url TEXT,
      wa_msg_id TEXT,
      sender_name TEXT,
      instance_id INTEGER,
      ai_agent_id INTEGER,
      sent_by_user_id INTEGER,
      follow_up_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE lead_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ai_agent_token_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      account_id INTEGER NOT NULL,
      lead_id INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  applyCopilotSchema(db)
  applyAgentBriefingSchema(db)
  return db
}

// Conta com o recurso pago de agentes ligado, um funil padrao com etapas e uma
// instancia de WhatsApp: o minimo para as rotas da entrevista funcionarem de
// ponta a ponta (portao do recurso + amarracao de etapas/instancias na ativacao).
export function seedContaCompleta(db, { accountName = 'Conta Teste' } = {}) {
  const accountId = Number(db.prepare('INSERT INTO accounts (name, ai_agents_enabled) VALUES (?, 1)').run(accountName).lastInsertRowid)
  const userId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, ?, ?, 'gerente')")
    .run(accountId, 'Gerente', `gerente-${accountId}@teste.local`).lastInsertRowid)
  const funnelId = Number(db.prepare('INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, ?, 1, 1)')
    .run(accountId, 'Funil Principal').lastInsertRowid)
  const stageIds = ['Novo', 'Em atendimento'].map((nome, i) => Number(
    db.prepare('INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, ?, ?)').run(funnelId, nome, i).lastInsertRowid
  ))
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, ?, 'connected')")
    .run(accountId, `linha-${accountId}`).lastInsertRowid)
  return { accountId, userId, funnelId, stageIds, instanceId }
}

export function seedAccountAndLead(db, { accountName = 'Conta Teste' } = {}) {
  const accountId = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run(accountName).lastInsertRowid)
  const userId = Number(db.prepare('INSERT INTO users (account_id, name) VALUES (?, ?)').run(accountId, 'Vendedor').lastInsertRowid)
  const agentId = Number(db.prepare('INSERT INTO ai_agents (account_id, user_id, name) VALUES (?, ?, ?)').run(accountId, userId, 'Agente').lastInsertRowid)
  const leadId = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(accountId, 'Lead Teste').lastInsertRowid)
  return { accountId, userId, agentId, leadId }
}

// Banco SQLite em memoria para testes. NAO importa server/db.js (ele abre o banco real).
import Database from 'better-sqlite3'
import { applyCopilotSchema } from '../../server/services/copilotSchema.js'

export function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      anthropic_api_key TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      name TEXT NOT NULL
    );
    CREATE TABLE ai_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT, email TEXT, phone TEXT, city TEXT, empresa TEXT, instagram TEXT,
      ai_handed_off_at TEXT
    );
    CREATE TABLE lead_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  applyCopilotSchema(db)
  return db
}

export function seedAccountAndLead(db, { accountName = 'Conta Teste' } = {}) {
  const accountId = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run(accountName).lastInsertRowid)
  const userId = Number(db.prepare('INSERT INTO users (account_id, name) VALUES (?, ?)').run(accountId, 'Vendedor').lastInsertRowid)
  const agentId = Number(db.prepare('INSERT INTO ai_agents (account_id, user_id, name) VALUES (?, ?, ?)').run(accountId, userId, 'Agente').lastInsertRowid)
  const leadId = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(accountId, 'Lead Teste').lastInsertRowid)
  return { accountId, userId, agentId, leadId }
}

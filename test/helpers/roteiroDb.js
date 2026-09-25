import { createTestDb } from './memoryDb.js'
import { applyRoteiroSchema } from '../../server/services/roteiro/schema.js'

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

export function createRoteiroTestDb() {
  const db = createTestDb()
  for (const [c, t] of [['is_conversion', 'INTEGER NOT NULL DEFAULT 0'], ['is_terminal', 'INTEGER NOT NULL DEFAULT 0'], ['auto_keywords', 'TEXT']]) addCol(db, 'funnel_stages', c, t)
  for (const [c, t] of [['funnel_id', 'INTEGER'], ['stage_id', 'INTEGER'], ['attendant_id', 'INTEGER'], ['instance_id', 'INTEGER'], ['last_instance_id', 'INTEGER'],
    ['is_active', 'INTEGER NOT NULL DEFAULT 1'], ['is_archived', 'INTEGER NOT NULL DEFAULT 0'], ['last_inbound_at', 'TEXT'], ['uf', 'TEXT'], ['source', 'TEXT'],
    ['created_at', "TEXT NOT NULL DEFAULT (datetime('now'))"], ['updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))"]]) addCol(db, 'leads', c, t)
  addCol(db, 'users', 'primary_instance_id', 'INTEGER')
  db.exec(`
    CREATE TABLE IF NOT EXISTS stage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, from_stage_id INTEGER, to_stage_id INTEGER, trigger_type TEXT DEFAULT 'manual', triggered_by INTEGER, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lead_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, value REAL, sale_date TEXT, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS conversation_insights (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, lead_id INTEGER UNIQUE, analyzed_at TEXT, summary TEXT, temperatura_lead TEXT, chance_conversao INTEGER);
    CREATE TABLE IF NOT EXISTS analyst_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER, insight_id INTEGER, type TEXT NOT NULL, severity TEXT, title TEXT, description TEXT, suggested_action TEXT, assigned_to_user_id INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS instance_auto_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id INTEGER UNIQUE, away_schedule_json TEXT);
    CREATE TABLE IF NOT EXISTS qualification_sequences (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, question TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lead_qualifications (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, sequence_id INTEGER NOT NULL, answer TEXT, answered_at TEXT, answered_by INTEGER, UNIQUE(lead_id, sequence_id));
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  applyRoteiroSchema(db)
  return db
}

export function seedRoteiroBase(db) {
  const accountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta A')").run().lastInsertRowid)
  const otherAccountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta B')").run().lastInsertRowid)
  const gerenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestora', 'g@a.local', 'gerente')").run(accountId).lastInsertRowid)
  const atendenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Ana', 'ana@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const funnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil', 1, 1)").run(accountId).lastInsertRowid)
  const mk = (name, position, conv = 0, term = 0) => Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, ?, ?, ?, ?)').run(funnelId, name, position, conv, term).lastInsertRowid)
  const stages = { novo: mk('Novo', 0), qualificando: mk('Qualificando', 1), proposta: mk('Proposta', 2), venda: mk('Venda', 3, 1, 1), perdido: mk('Perdido', 4, 0, 1) }
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'n1', 'connected')").run(accountId).lastInsertRowid)
  return { accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages, instanceId }
}

export function addLead(db, fields) {
  const f = { name: 'Lead', phone: '5548999990000', ...fields }
  const cols = Object.keys(f)
  return Number(db.prepare(`INSERT INTO leads (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => f[c])).lastInsertRowid)
}

export function addMessage(db, { leadId, direction, content = 'oi', minutesAgo = 0, userId = null }) {
  const lead = db.prepare('SELECT account_id FROM leads WHERE id = ?').get(leadId)
  return Number(db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, sent_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))`)
    .run(leadId, lead.account_id, direction, content, userId, `-${minutesAgo} minutes`).lastInsertRowid)
}

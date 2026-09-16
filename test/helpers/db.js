import Database from 'better-sqlite3'
import { migrateWhatsappProviderSchema } from '../../server/services/whatsapp/schema.js'

export function createTestDb({ migrate = true } = {}) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'atendente', is_active INTEGER NOT NULL DEFAULT 1, is_bot INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE funnel_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, funnel_id INTEGER NOT NULL, name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0, auto_keywords TEXT
    );
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL, attendant_id INTEGER, name TEXT, phone TEXT, source TEXT, source_detail TEXT,
      wa_remote_jid TEXT, instance_id INTEGER, last_instance_id INTEGER,
      is_archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, has_new_after_archive INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0, opted_in_at TEXT, ctwa_clid TEXT,
      trabalha_anuncio INTEGER NOT NULL DEFAULT 0, client_ip_address TEXT,
      profile_pic_url TEXT, profile_pic_updated_at TEXT, unread_count INTEGER NOT NULL DEFAULT 0,
      last_inbound_at TEXT, ai_handed_off_at TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      direction TEXT NOT NULL, content TEXT, media_type TEXT DEFAULT 'text', media_url TEXT,
      sender_name TEXT, wa_msg_id TEXT, wa_timestamp TEXT, instance_id INTEGER, sent_by_user_id INTEGER,
      delivery_status TEXT NOT NULL DEFAULT 'sent', delivered_at TEXT, read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, from_stage_id INTEGER,
      to_stage_id INTEGER NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, instance_name TEXT NOT NULL,
      api_url TEXT NOT NULL, api_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected',
      phone_number TEXT, webhook_secret TEXT, default_attendant_id INTEGER,
      lead_intake_mode TEXT NOT NULL DEFAULT 'open', hourly_send_limit INTEGER, daily_send_limit INTEGER,
      warmup_until TEXT, business_hours_json TEXT, lead_daily_msg_cap INTEGER DEFAULT 50,
      paused_at TEXT, paused_reason TEXT, health_check_window_min INTEGER DEFAULT 120,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE lead_instance_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, instance_id INTEGER NOT NULL,
      attendant_id INTEGER, UNIQUE(lead_id, instance_id)
    );
    CREATE TABLE distribution_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual', last_assigned_index INTEGER NOT NULL DEFAULT 0,
      active_attendants TEXT, updated_at TEXT
    );
    CREATE TABLE follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, instance_id INTEGER,
      stop_on_reply INTEGER NOT NULL DEFAULT 1, on_reply_action TEXT NOT NULL DEFAULT 'pause',
      on_reply_user_id INTEGER, on_reply_move_to_stage_id INTEGER, on_reply_add_tag_id INTEGER
    );
    CREATE TABLE lead_follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, follow_up_id INTEGER NOT NULL,
      current_step_id INTEGER, status TEXT NOT NULL DEFAULT 'active', next_run_at TEXT,
      paused_at TEXT, paused_reason TEXT, updated_at TEXT
    );
    CREATE TABLE lead_tags (lead_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (lead_id, tag_id));
  `)
  if (migrate) migrateWhatsappProviderSchema(db)
  return db
}

export const TEST_TOKEN = 'a'.repeat(32)

// Conta + funil padrao com 2 etapas + 1 instancia Evolution conectada.
export function seedBasic(db, opts = {}) {
  const accountId = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta Teste', 'conta-teste')").run().lastInsertRowid
  const funnelId = db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Principal', 1, 1)").run(accountId).lastInsertRowid
  const stage1 = db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Novo Lead', 0)").run(funnelId).lastInsertRowid
  const stage2 = db.prepare("INSERT INTO funnel_stages (funnel_id, name, position, auto_keywords) VALUES (?, 'Em Atendimento', 1, ?)").run(funnelId, opts.stage2Keywords || null).lastInsertRowid
  const instanceId = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, webhook_token, lead_intake_mode, default_attendant_id)
    VALUES (?, 'inst-teste', 'http://evo.local', 'KEY', 'connected', ?, ?, ?)
  `).run(accountId, TEST_TOKEN, opts.intakeMode || 'open', opts.defaultAttendantId || null).lastInsertRowid
  return {
    account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId),
    instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId),
    funnelId, stage1, stage2,
  }
}

export function insertLead(db, fields) {
  const cols = Object.keys(fields)
  const r = db.prepare(`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => fields[c]))
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid)
}

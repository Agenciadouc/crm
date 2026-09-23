import crypto from 'crypto'

export const WHATSAPP_PROVIDERS = ['evolution', 'uzapi', 'cloud_api', 'custom']

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}

// 32 caracteres hexadecimais (16 bytes aleatorios)
export function generateWebhookToken() {
  return crypto.randomBytes(16).toString('hex')
}

// Colunas do provedor por numero (spec secao 6). Idempotente; roda no boot.
export function migrateWhatsappProviderSchema(db) {
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider', "TEXT NOT NULL DEFAULT 'evolution'")
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider_config', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'webhook_token', 'TEXT')
  // qr_code ja existe em producao (db.js); aqui garante nos bancos de teste. connected_at = 1a conexao (cobranca futura).
  addColumnIfNotExists(db, 'whatsapp_instances', 'qr_code', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'connected_at', 'TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_connection_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      instance_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      event TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wa_conn_log_account ON whatsapp_connection_log(account_id, provider);
    CREATE TABLE IF NOT EXISTS media_temp (
      token TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      mimetype TEXT,
      expires_at TEXT NOT NULL
    );
  `)
  const missing = db.prepare("SELECT id FROM whatsapp_instances WHERE webhook_token IS NULL OR webhook_token = ''").all()
  const update = db.prepare('UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ?')
  for (const row of missing) update.run(generateWebhookToken(), row.id)
  if (missing.length > 0) console.log(`[db] migration: webhook_token gerado para ${missing.length} instancias`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_instances_webhook_token ON whatsapp_instances(webhook_token)')
  // Rede de seguranca: qualquer INSERT que nao informe webhook_token (ex.: codigo legado) ganha um na hora.
  // ALTER TABLE nao aceita DEFAULT nao-constante quando ja existem linhas, entao o token e gerado via trigger.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_wa_instances_webhook_token
    AFTER INSERT ON whatsapp_instances
    WHEN NEW.webhook_token IS NULL OR NEW.webhook_token = ''
    BEGIN
      UPDATE whatsapp_instances SET webhook_token = lower(hex(randomblob(16))) WHERE id = NEW.id;
    END;
  `)
  // Papeis dos numeros + anti-ban (spec 2026-09-23). opted_out_at ja existe em producao (db.js); aqui garante nos testes.
  addColumnIfNotExists(db, 'accounts', 'default_send_instance_id', 'INTEGER')
  addColumnIfNotExists(db, 'accounts', 'optout_footer_enabled', 'INTEGER NOT NULL DEFAULT 1')
  addColumnIfNotExists(db, 'accounts', 'optout_footer_text', 'TEXT')
  addColumnIfNotExists(db, 'accounts', 'optout_confirm_text', 'TEXT')
  addColumnIfNotExists(db, 'accounts', 'reply_rate_alert_pct', 'INTEGER NOT NULL DEFAULT 10')
  addColumnIfNotExists(db, 'leads', 'opted_out_at', 'TEXT')
  addColumnIfNotExists(db, 'follow_ups', 'optout_footer_enabled', 'INTEGER NOT NULL DEFAULT 0')
}

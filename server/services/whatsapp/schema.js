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

// Migracao unica (pedido do dono, 2026-09-27): numero ja conectado no upgrade mantem o webhook de
// hoje (URL legada por slug da conta); so numero criado depois usa a URL nova por token. Roda 1x no
// boot (flag em app_settings) — rodar de novo nao mexe em nada, pois so marca quem ainda esta NULL.
export const WEBHOOK_LEGACY_MARK_FLAG = 'webhook_legacy_marked'

export function markExistingInstancesLegacy(db) {
  // Cria a tabela aqui tambem (idempotente): nos testes ela nao existe ainda quando essa funcao roda.
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WEBHOOK_LEGACY_MARK_FLAG)) {
    return { marked: 0, skipped: true }
  }
  const r = db.prepare("UPDATE whatsapp_instances SET webhook_mode = 'legacy' WHERE webhook_mode IS NULL").run()
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(WEBHOOK_LEGACY_MARK_FLAG, new Date().toISOString())
  return { marked: r.changes, skipped: false }
}

// Colunas do provedor por numero (spec secao 6). Idempotente; roda no boot.
export function migrateWhatsappProviderSchema(db) {
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider', "TEXT NOT NULL DEFAULT 'evolution'")
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider_config', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'webhook_token', 'TEXT')
  // qr_code ja existe em producao (db.js); aqui garante nos bancos de teste. connected_at = 1a conexao (cobranca futura).
  addColumnIfNotExists(db, 'whatsapp_instances', 'qr_code', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'connected_at', 'TEXT')
  // webhook_mode: 'legacy' (numero que ja existia no upgrade, mantem a URL de hoje) | 'token' (numero
  // novo, URL por token). NULL depois da migracao unica abaixo = tratado como 'token' (nunca mais NULL).
  addColumnIfNotExists(db, 'whatsapp_instances', 'webhook_mode', 'TEXT')
  try {
    const r = markExistingInstancesLegacy(db)
    if (!r.skipped && r.marked > 0) console.log(`[Webhook] migracao: ${r.marked} numero(s) marcado(s) como webhook legado`)
  } catch (err) {
    console.error('[Webhook] migracao webhook_mode legado FALHOU:', err.message)
  }
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
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_instance_dir_created ON messages(instance_id, direction, created_at)')
}

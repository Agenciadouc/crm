import crypto from 'crypto'

export const WHATSAPP_PROVIDERS = ['evolution', 'cloud_api', 'custom']

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
}

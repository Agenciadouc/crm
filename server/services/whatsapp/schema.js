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
  // UPDATE + flag numa transacao so: se cair no meio, ou marca tudo e grava a flag, ou nao marca nada
  // (nunca fica so com parte das instancias legadas marcadas sem a flag registrada).
  const marked = db.transaction(() => {
    const r = db.prepare("UPDATE whatsapp_instances SET webhook_mode = 'legacy' WHERE webhook_mode IS NULL").run()
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(WEBHOOK_LEGACY_MARK_FLAG, new Date().toISOString())
    return r.changes
  })()
  return { marked, skipped: false }
}

// Migracao unica (pedido do dono, 2026-09-27, item 1c): preenche provider_config das instancias UzAPI
// legadas SO com o phoneNumberId (vem da coluna antiga uzapi_session da producao, quando ela existe —
// bancos novos/de teste nunca tem essa coluna, entao a migracao vira no-op nesse caso). Isso e o
// suficiente e SEGURO pra achar a instancia certa num aviso recebido em /webhooks/uzapi/:slug
// (readUzapiPhoneNumberId so olha esse campo, nao precisa de chave nenhuma).
//
// NUNCA escreve instanceToken: o cliente uzapi novo (uzapiClient.js) bate num caminho com o usuario
// da conta (`/{username}/v1/...`) diferente do que a producao usava (`/v1/...`, sem usuario) — nao da
// pra confirmar, so lendo codigo, que o token/instancia antigo (instance.api_key) ainda autentica
// nesse caminho novo. Sem instanceToken, tryReadUzapiConfig continua falhando de proposito: nenhuma
// chamada autenticada (reregistro de webhook, status, etc.) e feita numa instancia legada por engano —
// so o recebimento (que nao precisa de token) volta a funcionar. Documentado no report (item 1c).
export const UZAPI_PROVIDER_CONFIG_BACKFILL_FLAG = 'webhook_legacy_uzapi_config_backfilled'

export function backfillLegacyUzapiProviderConfig(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(UZAPI_PROVIDER_CONFIG_BACKFILL_FLAG)) {
    return { filled: 0, skipped: true }
  }
  const cols = db.prepare('PRAGMA table_info(whatsapp_instances)').all()
  const hasLegacyColumn = cols.some(c => c.name === 'uzapi_session')
  let filled = 0
  db.transaction(() => {
    if (hasLegacyColumn) {
      const rows = db.prepare(`
        SELECT id, uzapi_session FROM whatsapp_instances
        WHERE provider = 'uzapi' AND (provider_config IS NULL OR provider_config = '')
          AND uzapi_session IS NOT NULL AND uzapi_session != ''
      `).all()
      const update = db.prepare('UPDATE whatsapp_instances SET provider_config = ? WHERE id = ?')
      for (const row of rows) {
        // instanceToken de proposito ausente (ver comentario acima) — so phoneNumberId, pra casar o
        // webhook recebido. uzapiInstanceId fica null (nao tinha equivalente na producao).
        update.run(JSON.stringify({ phoneNumberId: String(row.uzapi_session), instanceToken: null, uzapiInstanceId: null }), row.id)
        filled++
      }
    }
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(UZAPI_PROVIDER_CONFIG_BACKFILL_FLAG, new Date().toISOString())
  })()
  return { filled, skipped: false }
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
  try {
    const r = backfillLegacyUzapiProviderConfig(db)
    if (!r.skipped && r.filled > 0) console.log(`[Webhook] migracao: ${r.filled} numero(s) UzAPI legado(s) ganharam provider_config (so phoneNumberId, sem token)`)
  } catch (err) {
    console.error('[Webhook] migracao provider_config UzAPI legado FALHOU:', err.message)
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

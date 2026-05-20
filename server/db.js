import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = resolve(__dirname, 'data', 'crm.db')

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Schema
db.exec(`
  -- Accounts (client companies)
  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    logo_url    TEXT,
    timezone    TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Users (super_admin, gerente, atendente)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER,
    name        TEXT NOT NULL,
    email       TEXT NOT NULL UNIQUE,
    password    TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('super_admin', 'gerente', 'atendente')),
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Funnels (custom pipelines per account)
  CREATE TABLE IF NOT EXISTS funnels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Funnel stages
  CREATE TABLE IF NOT EXISTS funnel_stages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    funnel_id       INTEGER NOT NULL,
    name            TEXT NOT NULL,
    position        INTEGER NOT NULL DEFAULT 0,
    color           TEXT NOT NULL DEFAULT '#FFB300',
    is_conversion   INTEGER NOT NULL DEFAULT 0,
    is_terminal     INTEGER NOT NULL DEFAULT 0,
    auto_keywords   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_stages_funnel ON funnel_stages(funnel_id, position);

  -- Tags
  CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#FFB300',
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE(account_id, name)
  );

  -- Leads
  CREATE TABLE IF NOT EXISTS leads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    funnel_id       INTEGER NOT NULL,
    stage_id        INTEGER NOT NULL,
    attendant_id    INTEGER,
    name            TEXT,
    phone           TEXT,
    email           TEXT,
    city            TEXT,
    source          TEXT,
    source_detail   TEXT,
    notes           TEXT,
    custom_fields   TEXT,
    wa_remote_jid   TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (funnel_id) REFERENCES funnels(id),
    FOREIGN KEY (stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (attendant_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_account ON leads(account_id);
  CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);
  CREATE INDEX IF NOT EXISTS idx_leads_attendant ON leads(attendant_id);
  CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(phone);
  CREATE INDEX IF NOT EXISTS idx_leads_wa_jid ON leads(wa_remote_jid);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_funnel_active ON leads(funnel_id, is_active);
  CREATE INDEX IF NOT EXISTS idx_leads_account_created ON leads(account_id, created_at DESC);

  -- Lead tags (many-to-many)
  CREATE TABLE IF NOT EXISTS lead_tags (
    lead_id     INTEGER NOT NULL,
    tag_id      INTEGER NOT NULL,
    PRIMARY KEY (lead_id, tag_id),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  -- Messages (WhatsApp conversation)
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    account_id      INTEGER NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    content         TEXT,
    media_type      TEXT DEFAULT 'text',
    media_url       TEXT,
    wa_msg_id       TEXT,
    wa_timestamp    TEXT,
    sender_name     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id, created_at);

  -- Stage history (audit trail)
  CREATE TABLE IF NOT EXISTS stage_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    from_stage_id   INTEGER,
    to_stage_id     INTEGER NOT NULL,
    trigger_type    TEXT NOT NULL DEFAULT 'manual',
    triggered_by    INTEGER,
    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (from_stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (to_stage_id) REFERENCES funnel_stages(id),
    FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_history_lead ON stage_history(lead_id, created_at);

  -- WhatsApp instances (Evolution API config)
  CREATE TABLE IF NOT EXISTS whatsapp_instances (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    instance_name   TEXT NOT NULL,
    api_url         TEXT NOT NULL,
    api_key         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'disconnected',
    phone_number    TEXT,
    webhook_secret  TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  -- Distribution rules (round-robin)
  CREATE TABLE IF NOT EXISTS distribution_rules (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id          INTEGER NOT NULL,
    funnel_id           INTEGER NOT NULL,
    type                TEXT NOT NULL DEFAULT 'manual' CHECK (type IN ('round_robin', 'manual')),
    last_assigned_index INTEGER NOT NULL DEFAULT 0,
    active_attendants   TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (funnel_id) REFERENCES funnels(id) ON DELETE CASCADE,
    UNIQUE(account_id, funnel_id)
  );

  -- Broadcasts (bulk messaging)
  CREATE TABLE IF NOT EXISTS broadcasts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    name            TEXT NOT NULL,
    message_template TEXT NOT NULL,
    media_url       TEXT,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'completed', 'failed')),
    scheduled_at    TEXT,
    sent_count      INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    total_count     INTEGER NOT NULL DEFAULT 0,
    created_by      INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_broadcasts_scheduled ON broadcasts(status, scheduled_at);

  -- Broadcast recipients
  CREATE TABLE IF NOT EXISTS broadcast_recipients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id    INTEGER NOT NULL,
    lead_id         INTEGER NOT NULL,
    phone           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
    wa_msg_id       TEXT,
    sent_at         TEXT,
    error           TEXT,
    FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_bcast_recipients ON broadcast_recipients(broadcast_id);

  -- Lead notes (internal comments)
  CREATE TABLE IF NOT EXISTS lead_notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id     INTEGER NOT NULL,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_lead ON lead_notes(lead_id, created_at DESC);

  -- Cadences (sequential contact workflows)
  CREATE TABLE IF NOT EXISTS cadences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS cadence_attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cadence_id  INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    action_type TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita')),
    description TEXT,
    instructions TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position);

  CREATE TABLE IF NOT EXISTS lead_cadences (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id               INTEGER NOT NULL,
    cadence_id            INTEGER NOT NULL,
    current_attempt_id    INTEGER,
    status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
    started_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
    FOREIGN KEY (current_attempt_id) REFERENCES cadence_attempts(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lead_cadences_lead ON lead_cadences(lead_id);

  -- Ready messages (quick templates)
  CREATE TABLE IF NOT EXISTS ready_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    image_url   TEXT,
    video_url   TEXT,
    stage_id    INTEGER,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES funnel_stages(id) ON DELETE SET NULL
  );

  -- Qualification sequences (lead scoring questions)
  CREATE TABLE IF NOT EXISTS qualification_sequences (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL,
    question    TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_qual_seq_account ON qualification_sequences(account_id, position);

  CREATE TABLE IF NOT EXISTS lead_qualifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id         INTEGER NOT NULL,
    sequence_id     INTEGER NOT NULL,
    answer          TEXT,
    answered_at     TEXT,
    answered_by     INTEGER,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (sequence_id) REFERENCES qualification_sequences(id) ON DELETE CASCADE,
    FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(lead_id, sequence_id)
  );

  -- Launches (product/property listings)
  CREATE TABLE IF NOT EXISTS launches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    title           TEXT NOT NULL,
    identification  TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS launch_messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    launch_id   INTEGER NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (launch_id) REFERENCES launches(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_launch_messages_launch ON launch_messages(launch_id, position);
`)

// ─── Schema migrations (add columns safely) ─────────────────────
function addColumnIfNotExists(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}
// whatsapp_instances: qr_code for QR code base64
addColumnIfNotExists('whatsapp_instances', 'qr_code', 'TEXT')
// whatsapp_instances: default attendant for new inbound leads (overrides round-robin when set)
addColumnIfNotExists('whatsapp_instances', 'default_attendant_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
// leads: instance_id to track which WhatsApp number received this lead
addColumnIfNotExists('leads', 'instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')
// accounts: Evolution API credentials (shared across all instances)
addColumnIfNotExists('accounts', 'evolution_api_url', 'TEXT')
addColumnIfNotExists('accounts', 'evolution_api_key', 'TEXT')

// Defaults centralizados da Evolution API (ja preenche em todas contas)
export const DEFAULT_EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://127.0.0.1:8080'
export const DEFAULT_EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || 'dros-evo-key-2026'

// Backfill: aplica defaults em contas que ainda nao tem credenciais salvas
db.prepare("UPDATE accounts SET evolution_api_url = ? WHERE evolution_api_url IS NULL OR evolution_api_url = ''").run(DEFAULT_EVOLUTION_API_URL)
db.prepare("UPDATE accounts SET evolution_api_key = ? WHERE evolution_api_key IS NULL OR evolution_api_key = ''").run(DEFAULT_EVOLUTION_API_KEY)
// cadence_attempts: D+N days from lead creation + scheduled time
addColumnIfNotExists('cadence_attempts', 'delay_days', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('cadence_attempts', 'scheduled_time', 'TEXT')
// cadence_attempts: auto-send message template (for WhatsApp auto)
addColumnIfNotExists('cadence_attempts', 'auto_message', 'TEXT')
// cadence_attempts: schedule mode ('date' = D+N HH:MM, 'duration' = delay_minutes from anchor)
addColumnIfNotExists('cadence_attempts', 'schedule_mode', "TEXT NOT NULL DEFAULT 'date'")
addColumnIfNotExists('cadence_attempts', 'delay_minutes', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('cadence_attempts', 'call_script', 'TEXT')
// lead_cadences: track when each attempt was executed/skipped
addColumnIfNotExists('lead_cadences', 'last_executed_at', 'TEXT')
addColumnIfNotExists('lead_cadences', 'last_executed_attempt_id', 'INTEGER')
// leads: WhatsApp profile picture URL (cached, expires periodically)
addColumnIfNotExists('leads', 'profile_pic_url', 'TEXT')
addColumnIfNotExists('leads', 'profile_pic_updated_at', 'TEXT')
// leads: archive flag + unread marker for messages that arrived after archiving
addColumnIfNotExists('leads', 'is_archived', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('leads', 'archived_at', 'TEXT')
addColumnIfNotExists('leads', 'has_new_after_archive', 'INTEGER NOT NULL DEFAULT 0')

// Accounts: extra business fields
addColumnIfNotExists('accounts', 'cnpj', 'TEXT')
addColumnIfNotExists('accounts', 'razao_social', 'TEXT')
addColumnIfNotExists('accounts', 'segmento', 'TEXT')
addColumnIfNotExists('accounts', 'website', 'TEXT')
addColumnIfNotExists('accounts', 'instagram', 'TEXT')
addColumnIfNotExists('accounts', 'whatsapp_comercial', 'TEXT')
addColumnIfNotExists('accounts', 'valor_mensal', 'REAL')
addColumnIfNotExists('accounts', 'contrato_inicio', 'TEXT')
addColumnIfNotExists('accounts', 'cidade', 'TEXT')
addColumnIfNotExists('accounts', 'estado', 'TEXT')
addColumnIfNotExists('accounts', 'observacoes', 'TEXT')
addColumnIfNotExists('accounts', 'trabalha_anuncio', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('accounts', 'investimento_anuncios', 'REAL')

// Meta Pixel + Conversions API (CAPI) — envio de eventos pra Meta otimizar campanhas
addColumnIfNotExists('accounts', 'meta_pixel_id', 'TEXT')
addColumnIfNotExists('accounts', 'meta_capi_token', 'TEXT')
addColumnIfNotExists('accounts', 'meta_capi_test_event_code', 'TEXT')
addColumnIfNotExists('accounts', 'meta_capi_enabled', 'INTEGER NOT NULL DEFAULT 0')
// Ultimo lead recebido via webhook Google Sheets (pra UI mostrar status da integração)
addColumnIfNotExists('accounts', 'last_sheets_lead_at', 'TEXT')

// Normaliza configs antigas que tinham modo manual (feature descontinuada — agora so schedule)
try {
  db.prepare("UPDATE instance_auto_messages SET away_mode = 'schedule', away_manual_active = 0 WHERE away_mode = 'manual'").run()
} catch {}

// Funnel stages: evento Meta enviado quando lead entra nessa etapa (CAPI)
addColumnIfNotExists('funnel_stages', 'meta_event_name', 'TEXT')

// Leads: ctwa_clid capturado do click-to-WhatsApp ad (pra correlacionar com campanha Meta via CAPI)
addColumnIfNotExists('leads', 'ctwa_clid', 'TEXT')
// Leads: ids de Meta Lead Form (campanha/anuncio/formulario) — usado pra disparar CAPI pra leads vindos de forms
addColumnIfNotExists('leads', 'meta_ad_id', 'TEXT')
addColumnIfNotExists('leads', 'meta_campaign_id', 'TEXT')
addColumnIfNotExists('leads', 'meta_form_id', 'TEXT')

// stage_history: auditoria de envios CAPI
addColumnIfNotExists('stage_history', 'capi_event_id', 'TEXT')
addColumnIfNotExists('stage_history', 'capi_status', 'TEXT')

// Leads: campos extras pra elevar Event Match Quality (EMQ) no Meta CAPI
addColumnIfNotExists('leads', 'fbp', 'TEXT')                  // _fbp cookie do browser (plaintext)
addColumnIfNotExists('leads', 'fbc', 'TEXT')                  // _fbc cookie ou montado a partir de fbclid (plaintext)
addColumnIfNotExists('leads', 'client_ip_address', 'TEXT')    // IP do lead na 1a interacao
addColumnIfNotExists('leads', 'client_user_agent', 'TEXT')    // UA do navegador (so faz sentido em forms web)
addColumnIfNotExists('leads', 'lead_form_lead_id', 'TEXT')    // leadgen_id do Meta Lead Form (NAO confundir com leads.id)
addColumnIfNotExists('leads', 'state', 'TEXT')                // estado (UF) — pra hash st no CAPI
addColumnIfNotExists('leads', 'zip', 'TEXT')                  // CEP — pra hash zp no CAPI
addColumnIfNotExists('leads', 'birthdate', 'TEXT')            // YYYY-MM-DD — pra hash db no CAPI
addColumnIfNotExists('leads', 'gender', 'TEXT')               // 'f' ou 'm' — pra hash ge no CAPI

// Leads: extra business fields
addColumnIfNotExists('leads', 'empresa', 'TEXT')
addColumnIfNotExists('leads', 'cpf_cnpj', 'TEXT')
addColumnIfNotExists('leads', 'instagram', 'TEXT')
addColumnIfNotExists('leads', 'trabalha_anuncio', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('leads', 'investimento_anuncios', 'REAL')
// Opt-in/opt-out for WhatsApp broadcasts (Meta compliance)
addColumnIfNotExists('leads', 'opted_in_at', 'TEXT')
addColumnIfNotExists('leads', 'opted_out_at', 'TEXT')
addColumnIfNotExists('leads', 'last_broadcast_at', 'TEXT')

// Broadcasts: message variations (JSON array) + delay between sends
addColumnIfNotExists('broadcasts', 'message_variations', 'TEXT')
addColumnIfNotExists('broadcasts', 'delay_seconds', 'INTEGER NOT NULL DEFAULT 3')
addColumnIfNotExists('broadcasts', 'instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')
addColumnIfNotExists('broadcasts', 'paused_at', 'TEXT')
addColumnIfNotExists('broadcasts', 'paused_reason', 'TEXT')
addColumnIfNotExists('broadcasts', 'started_at', 'TEXT')

// ─── Multi-instance routing (decide which WhatsApp number to use when sending)
// leads.last_instance_id: ultima instancia que conversou com este lead (origem ou recepcao)
addColumnIfNotExists('leads', 'last_instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')
// users.primary_instance_id: instancia padrao do usuario para envios manuais quando lead nao tem instancia
addColumnIfNotExists('users', 'primary_instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')
// users.can_manage_proposals: permissao granular pra acessar a area de Propostas (super_admin sempre tem)
addColumnIfNotExists('users', 'can_manage_proposals', 'INTEGER NOT NULL DEFAULT 0')
// users.can_manage_contracts: permite ao atendente gerenciar contratos (igual proposals)
addColumnIfNotExists('users', 'can_manage_contracts', 'INTEGER NOT NULL DEFAULT 0')
// instance_auto_messages.greeting_cooldown_hours: cooldown configuravel da saudacao (default 24h, comportamento anterior)
addColumnIfNotExists('instance_auto_messages', 'greeting_cooldown_hours', 'INTEGER NOT NULL DEFAULT 24')
// whatsapp_instances.lead_intake_mode: 'open' (atual, qualquer msg cria lead) | 'restricted' (so processa leads ja cadastrados no CRM)
addColumnIfNotExists('whatsapp_instances', 'lead_intake_mode', "TEXT NOT NULL DEFAULT 'open'")
// leads.is_blocked: bloqueio total (lead some do CRM e mensagens futuras sao silenciosamente ignoradas pelo webhook)
addColumnIfNotExists('leads', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('leads', 'blocked_at', 'TEXT')
addColumnIfNotExists('leads', 'blocked_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')
// Indice composto pra query O(1) do gate no webhook (account + phone + flag)
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_blocked_phone ON leads(account_id, phone, is_blocked)')
// contracts: quantidade de videos/imagens por mes (so aparece quando Frente 4 - Linha Editorial esta ativa)
addColumnIfNotExists('contracts', 'videos_por_mes', 'INTEGER NOT NULL DEFAULT 0')
addColumnIfNotExists('contracts', 'imagens_por_mes', 'INTEGER NOT NULL DEFAULT 0')
// users.can_grab_leads: permite ao atendente "tomar" leads de outros sem precisar aprovacao
addColumnIfNotExists('users', 'can_grab_leads', 'INTEGER NOT NULL DEFAULT 0')
// messages.instance_id: qual instancia enviou/recebeu cada mensagem (mostrado internamente no chat)
addColumnIfNotExists('messages', 'instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')

// ─── Multi-conversation: cada lead pode ter conversa com varias instancias
// e cada conversa tem seu proprio atendente
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_instance_assignments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id       INTEGER NOT NULL,
    instance_id   INTEGER NOT NULL,
    attendant_id  INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lead_id, instance_id),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    FOREIGN KEY (attendant_id) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_lia_lead ON lead_instance_assignments(lead_id);
  CREATE INDEX IF NOT EXISTS idx_lia_instance ON lead_instance_assignments(instance_id);
  CREATE INDEX IF NOT EXISTS idx_lia_attendant ON lead_instance_assignments(attendant_id);
`)

// Backfill: pra cada lead com instance_id, cria assignment se nao existir
try {
  db.prepare(`
    INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
    SELECT id, instance_id, attendant_id FROM leads WHERE instance_id IS NOT NULL
  `).run()
  // Tambem cria assignments pra cada lead com last_instance_id != instance_id
  db.prepare(`
    INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
    SELECT id, last_instance_id, attendant_id FROM leads
    WHERE last_instance_id IS NOT NULL AND last_instance_id != COALESCE(instance_id, -1)
  `).run()
} catch (e) { console.log('[DB] Backfill lead_instance_assignments:', e.message) }

// Standalone tasks (not tied to cadences)
db.exec(`
  CREATE TABLE IF NOT EXISTS standalone_tasks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL,
    lead_id         INTEGER,
    assigned_to     INTEGER,
    title           TEXT NOT NULL,
    description     TEXT,
    due_datetime    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    created_by      INTEGER,
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    FOREIGN KEY (assigned_to) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
  )
`)

// Pedidos de transferencia de lead entre atendentes (Emily pede o lead que esta com Deivid)
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_transfer_requests (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id           INTEGER NOT NULL,
    from_attendant_id INTEGER NOT NULL,
    to_attendant_id   INTEGER,
    account_id        INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
    message           TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at      TEXT,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (from_attendant_id) REFERENCES users(id),
    FOREIGN KEY (to_attendant_id) REFERENCES users(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_transfer_pending ON lead_transfer_requests(to_attendant_id, status);
  CREATE INDEX IF NOT EXISTS idx_transfer_from ON lead_transfer_requests(from_attendant_id, status);
`)

// Auto-mensagens por instância (saudação, ausência)
db.exec(`
  CREATE TABLE IF NOT EXISTS instance_auto_messages (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id                 INTEGER NOT NULL UNIQUE,
    greeting_enabled            INTEGER NOT NULL DEFAULT 0,
    greeting_text               TEXT,
    away_enabled                INTEGER NOT NULL DEFAULT 0,
    away_mode                   TEXT NOT NULL DEFAULT 'manual',
    away_manual_active          INTEGER NOT NULL DEFAULT 0,
    away_text                   TEXT,
    away_schedule_json          TEXT,
    away_cooldown_hours         INTEGER NOT NULL DEFAULT 4,
    greeting_cooldown_hours     INTEGER NOT NULL DEFAULT 24,
    updated_at                  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (instance_id) REFERENCES whatsapp_instances(id) ON DELETE CASCADE
  );

  -- Log de auto-mensagens enviadas (anti-flood + auditoria)
  -- type aceita 'greeting' e 'away' (outros tipos legados ficam no CHECK pra compat)
  CREATE TABLE IF NOT EXISTS auto_messages_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id     INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    account_id  INTEGER NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('greeting','away','inactivity_lead','inactivity_agent')),
    message_id  INTEGER,
    sent_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES whatsapp_instances(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_auto_log_lead ON auto_messages_log(lead_id, type, sent_at);
  CREATE INDEX IF NOT EXISTS idx_auto_log_instance ON auto_messages_log(instance_id, type);

  CREATE TABLE IF NOT EXISTS tag_instance_mapping (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL,
    tag_id        INTEGER NOT NULL,
    instance_id   INTEGER NOT NULL,
    attendant_id  INTEGER,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(account_id, tag_id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
    FOREIGN KEY (attendant_id) REFERENCES users(id) ON DELETE SET NULL
  );
`)

// Instância padrão pra leads de formulário
addColumnIfNotExists('accounts', 'default_form_instance_id', 'INTEGER REFERENCES whatsapp_instances(id) ON DELETE SET NULL')

// Proposals (proposta comercial gerada pelo super_admin)
db.exec(`
  CREATE TABLE IF NOT EXISTS proposals (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    slug              TEXT NOT NULL UNIQUE,
    client_name       TEXT NOT NULL,
    phone             TEXT,
    segmento          TEXT,
    has_production    INTEGER NOT NULL DEFAULT 1,
    num_videos        INTEGER NOT NULL DEFAULT 0,
    num_images        INTEGER NOT NULL DEFAULT 0,
    valor             REAL NOT NULL DEFAULT 0,
    contrato_meses    INTEGER NOT NULL DEFAULT 3,
    observacoes       TEXT,
    created_by        INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_proposals_slug ON proposals(slug);
`)

// Contracts (contrato de prestacao de servicos — gerenciado por super_admin OU users.can_manage_contracts=1)
db.exec(`
  CREATE TABLE IF NOT EXISTS contracts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    numero                TEXT NOT NULL UNIQUE,
    razao_social          TEXT NOT NULL,
    cnpj                  TEXT NOT NULL,
    inscricao_estadual    TEXT,
    endereco_logradouro   TEXT NOT NULL,
    endereco_bairro       TEXT NOT NULL,
    endereco_cep          TEXT NOT NULL,
    endereco_cidade       TEXT NOT NULL,
    endereco_estado       TEXT NOT NULL,
    fee_mensal            REAL NOT NULL DEFAULT 3500,
    comissao_percent      REAL NOT NULL DEFAULT 1.0,
    vigencia_meses        INTEGER NOT NULL DEFAULT 3,
    data_inicio           TEXT NOT NULL,
    data_fim              TEXT NOT NULL,
    renovacao_meses       INTEGER NOT NULL DEFAULT 12,
    aviso_previo_dias     INTEGER NOT NULL DEFAULT 30,
    reajuste_indice       TEXT NOT NULL DEFAULT 'IGPM/FGV',
    frente_diagnostico    INTEGER NOT NULL DEFAULT 1,
    frente_estruturacao   INTEGER NOT NULL DEFAULT 1,
    frente_aquisicao      INTEGER NOT NULL DEFAULT 1,
    frente_editorial      INTEGER NOT NULL DEFAULT 1,
    exclusoes_extras      TEXT,
    fat_mes1_ref          TEXT,
    fat_mes1_valor        REAL,
    fat_mes2_ref          TEXT,
    fat_mes2_valor        REAL,
    fat_mes3_ref          TEXT,
    fat_mes3_valor        REAL,
    fat_base              REAL,
    local_assinatura      TEXT NOT NULL DEFAULT 'Sombrio/SC',
    data_assinatura       TEXT NOT NULL,
    created_by            INTEGER,
    created_at            TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_contracts_created_at ON contracts(created_at DESC);
`)

// Seed super_admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@drosagencia.com.br')
if (!adminExists) {
  db.prepare(`
    INSERT INTO users (name, email, password, role, account_id) VALUES (?, ?, ?, 'super_admin', NULL)
  `).run('Dros Admin', 'admin@drosagencia.com.br', bcrypt.hashSync('dros2026', 10))
  console.log('[DB] Super admin created: admin@drosagencia.com.br')
}

console.log('[DB] SQLite ready at', dbPath)

export default db

// Tabelas do Roteiro de Qualificacao e colunas do Termometro (spec 7.1). Idempotente.
function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyRoteiroSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roteiro_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      funnel_id INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
      published_at TEXT, published_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_versions_funnel ON roteiro_versions(account_id, funnel_id, status);
    CREATE TABLE IF NOT EXISTS roteiro_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES roteiro_versions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      stage_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text','options')),
      required INTEGER NOT NULL DEFAULT 0,
      bant TEXT,
      ai_hint TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_questions_version ON roteiro_questions(version_id, stage_id, position);
    CREATE TABLE IF NOT EXISTS roteiro_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES roteiro_questions(id) ON DELETE CASCADE,
      option_key TEXT NOT NULL,
      label TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS roteiro_deviations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES roteiro_versions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      triggers TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      return_question_key TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS roteiro_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('testing','won','lost','cancelled')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      suggestion_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS roteiro_asks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'A',
      text_sent TEXT,
      message_id INTEGER,
      user_id INTEGER,
      source TEXT NOT NULL CHECK (source IN ('button','recognized','ia')),
      asked_at TEXT NOT NULL DEFAULT (datetime('now')),
      replied_at TEXT, answered_at TEXT, advanced_at TEXT, bought_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_asks_lead ON roteiro_asks(lead_id, asked_at);
    CREATE INDEX IF NOT EXISTS idx_roteiro_asks_q ON roteiro_asks(account_id, question_key, asked_at);
    CREATE TABLE IF NOT EXISTS lead_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      option_key TEXT,
      answer_text TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('ia','manual')),
      evidence TEXT,
      answered_by INTEGER,
      answered_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(lead_id, question_key)
    );
    CREATE TABLE IF NOT EXISTS roteiro_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      funnel_id INTEGER,
      question_key TEXT,
      type TEXT NOT NULL CHECK (type IN ('rewrite','seller_phrasing','new_option','new_deviation','reorder')),
      payload_json TEXT NOT NULL,
      evidence_json TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','testing','applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_by INTEGER, decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS roteiro_offscript (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_score_daily (
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      score INTEGER NOT NULL,
      band TEXT NOT NULL,
      PRIMARY KEY (lead_id, day)
    );
  `)
  for (const [c, t] of [
    ['score', 'INTEGER'], ['score_band', 'TEXT'], ['score_fit', 'INTEGER'], ['score_fit_grade', 'TEXT'],
    ['score_engagement', 'INTEGER'], ['score_quadrant', 'TEXT'], ['score_reasons_json', 'TEXT'],
    ['score_prev', 'INTEGER'], ['score_at', 'TEXT'], ['score_alerted_at', 'TEXT'], ['roteiro_no_auto_from_stage', 'INTEGER'],
  ]) addColumnIfNotExists(db, 'leads', c, t)
  for (const [c, t] of [
    ['roteiro_min_reply_rate', 'INTEGER NOT NULL DEFAULT 70'], ['roteiro_reply_window_h', 'INTEGER NOT NULL DEFAULT 24'],
    ['score_alert_minutes', 'INTEGER NOT NULL DEFAULT 60'], ['score_half_life_days', 'REAL NOT NULL DEFAULT 7'],
  ]) addColumnIfNotExists(db, 'accounts', c, t)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(account_id, score)') } catch (e) { console.warn('[Roteiro] indice idx_leads_score:', e.message) }
}

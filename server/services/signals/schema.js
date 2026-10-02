// Esquema dos Sinais de Venda por Palavra-chave (spec 2026-10-02 §4). Nao importa server/db.js: recebe db.
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
}
function addColumnIfNotExists(db, table, column, type) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyKeywordSignalsSchema(db) {
  addColumnIfNotExists(db, 'funnel_stages', 'trigger_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'weak_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'strong_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'negative_keywords', 'TEXT')

  addColumnIfNotExists(db, 'accounts', 'keyword_signal_ghost_hours', 'INTEGER NOT NULL DEFAULT 24')

  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      stage_id INTEGER,
      signal_type TEXT NOT NULL CHECK (signal_type IN ('weak', 'strong', 'negative')),
      keyword TEXT,
      message_id INTEGER,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lead_signals_lead ON lead_signals(lead_id, signal_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_lead_signals_pending ON lead_signals(lead_id, signal_type, confirmed_at);
  `)
}

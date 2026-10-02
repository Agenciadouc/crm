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

// Semeia defaults de forte/negativo (spec §4.1) nas etapas 100% intocadas (as 4 colunas NULL),
// pra nenhuma conta ficar sem NENHUM sinal possivel no dia do deploy (antes, toda conta tinha
// pelo menos o buyingTermLast7d raso que esta feature substitui). So forte e negativo, porque
// os dois valem sozinhos (sem gatilho) -- gatilho e fraco ficam de fora por serem inerentemente
// especificos do negocio (o texto que o VENDEDOR de cada conta realmente usa). Migracao de 1x
// so (flag em app_settings), pra uma etapa nova criada depois do deploy nao ganhar default so
// por estar sem config ainda -- o dono decide se configura ela ou nao.
const DEFAULT_STRONG_KEYWORDS = ['quero comprar', 'pode fechar']
const DEFAULT_NEGATIVE_KEYWORDS = ['não quero', 'caro demais']
const SEED_DEFAULTS_FLAG = 'signals_default_keywords_seeded_at'

export function seedDefaultKeywordsForUntouchedStages(db) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SEED_DEFAULTS_FLAG)) return 0

  const rows = db.prepare(`
    SELECT id FROM funnel_stages
    WHERE trigger_keywords IS NULL AND weak_keywords IS NULL AND strong_keywords IS NULL AND negative_keywords IS NULL
  `).all()

  const update = db.prepare('UPDATE funnel_stages SET strong_keywords = ?, negative_keywords = ? WHERE id = ?')
  const strongJson = JSON.stringify(DEFAULT_STRONG_KEYWORDS)
  const negativeJson = JSON.stringify(DEFAULT_NEGATIVE_KEYWORDS)
  for (const r of rows) update.run(strongJson, negativeJson, r.id)

  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SEED_DEFAULTS_FLAG, new Date().toISOString())

  return rows.length
}

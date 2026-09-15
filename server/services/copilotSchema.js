// Schema do Copiloto (Plano A). Recebe o db por parametro para ser testavel em memoria.
// Segue o padrao de server/db.js: addColumnIfNotExists + CREATE TABLE IF NOT EXISTS.

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}

export function applyCopilotSchema(db) {
  // Como a IA atua: 'auto' (envia sozinha, comportamento atual) | 'copilot' (so sugere) | 'sdr'
  addColumnIfNotExists(db, 'ai_agents', 'mode', "TEXT NOT NULL DEFAULT 'auto'")
  // De onde vem a chave Anthropic: 'client' (accounts.anthropic_api_key) | 'dros' (ANTHROPIC_API_KEY_DROS)
  addColumnIfNotExists(db, 'accounts', 'ai_key_source', "TEXT NOT NULL DEFAULT 'client'")
  // Ultima analise de venda da IA no lead
  addColumnIfNotExists(db, 'leads', 'ai_close_chance', 'INTEGER')
  addColumnIfNotExists(db, 'leads', 'ai_main_blocker', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_criteria_json', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_moment', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_msgs_since_analysis', 'INTEGER DEFAULT 0')
  // Pausa da IA nesta conversa
  addColumnIfNotExists(db, 'leads', 'ai_paused_at', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_paused_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id         INTEGER NOT NULL,
      lead_id            INTEGER NOT NULL,
      agent_id           INTEGER,
      kind               TEXT NOT NULL DEFAULT 'reply',
      source             TEXT NOT NULL DEFAULT 'ai',
      ready_message_id   INTEGER,
      content            TEXT NOT NULL,
      payload_json       TEXT,
      status             TEXT NOT NULL DEFAULT 'pending',
      final_content      TEXT,
      lead_follow_up_id  INTEGER,
      outcome_replied    INTEGER,
      outcome_advanced   INTEGER,
      outcome_checked_at TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at        TEXT,
      resolved_by        INTEGER,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_lead ON ai_suggestions(lead_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_account ON ai_suggestions(account_id, created_at);
  `)
}

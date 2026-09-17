// Schema do agente por entrevista (bloco 6). Recebe o db por parametro para ser
// testavel em memoria. Segue o padrao de copilotSchema.js: CREATE TABLE IF NOT EXISTS.

export function applyAgentBriefingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_briefings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      agent_id      INTEGER,
      status        TEXT NOT NULL DEFAULT 'entrevistando'
                      CHECK (status IN ('entrevistando', 'compilado', 'ativo')),
      compiled_json TEXT,
      created_by    INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_briefing_turns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      briefing_id INTEGER NOT NULL,
      position    INTEGER NOT NULL,
      role        TEXT NOT NULL CHECK (role IN ('ia', 'user')),
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (briefing_id) REFERENCES agent_briefings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_briefing_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      briefing_id INTEGER NOT NULL,
      kind        TEXT NOT NULL
                    CHECK (kind IN ('entrevista', 'site', 'conversas', 'colado')),
      ref         TEXT,
      content     TEXT,
      status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'falhou')),
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (briefing_id) REFERENCES agent_briefings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_briefings_conta ON agent_briefings(account_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_briefings_agente
      ON agent_briefings(agent_id) WHERE agent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_briefing_turns_ordem
      ON agent_briefing_turns(briefing_id, position);
    CREATE INDEX IF NOT EXISTS idx_agent_briefing_sources_briefing
      ON agent_briefing_sources(briefing_id);
  `)
}

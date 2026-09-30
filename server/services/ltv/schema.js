// Esquema do LTV / Recompra (spec 2026-09-29 §4). Nao importa server/db.js: recebe db.
export const REMIND_DAYS = [7, 15, 30, 45, 60]
export const SYSTEM_KEYS = ['aguardando', 'a_contatar', 'em_conversa', 'comprou', 'nao_agora', 'nao_quer']
export const OPEN_STATUSES = ['aguardando', 'a_contatar', 'em_conversa']

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
}
function addColumnIfNotExists(db, table, column, type) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyLtvSchema(db) {
  addColumnIfNotExists(db, 'lead_sales', 'product', 'TEXT')
  addColumnIfNotExists(db, 'lead_sales', 'sale_kind', 'TEXT')
  addColumnIfNotExists(db, 'lead_sales', 'remind_days', 'INTEGER')
  addColumnIfNotExists(db, 'lead_sales', 'cross_sell', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'lead_sales', 'cross_sell_offer', 'TEXT')

  addColumnIfNotExists(db, 'funnels', 'kind', "TEXT NOT NULL DEFAULT 'vendas'")
  addColumnIfNotExists(db, 'funnel_stages', 'system_key', 'TEXT')

  addColumnIfNotExists(db, 'accounts', 'repurchase_funnel_id', 'INTEGER')
  addColumnIfNotExists(db, 'accounts', 'repurchase_max_attempts', 'INTEGER NOT NULL DEFAULT 5')
  addColumnIfNotExists(db, 'accounts', 'repurchase_auto_send', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'accounts', 'curve_a_days', 'INTEGER NOT NULL DEFAULT 30')
  addColumnIfNotExists(db, 'accounts', 'curve_b_days', 'INTEGER NOT NULL DEFAULT 45')
  addColumnIfNotExists(db, 'accounts', 'curve_c_days', 'INTEGER NOT NULL DEFAULT 60')
  addColumnIfNotExists(db, 'accounts', 'ltv_daily_on', 'TEXT')

  addColumnIfNotExists(db, 'leads', 'ltv', 'REAL NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'leads', 'purchases', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'leads', 'last_purchase_at', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'avg_interval_days', 'REAL')
  addColumnIfNotExists(db, 'leads', 'curve', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'tier_id', 'INTEGER')
  addColumnIfNotExists(db, 'leads', 'repurchase_opt_out', 'INTEGER NOT NULL DEFAULT 0')

  addColumnIfNotExists(db, 'standalone_tasks', 'repurchase_cycle_id', 'INTEGER')

  db.exec(`
    CREATE TABLE IF NOT EXISTS repurchase_cycles (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id         INTEGER NOT NULL,
      lead_id            INTEGER NOT NULL,
      sale_id            INTEGER REFERENCES lead_sales(id) ON DELETE SET NULL,
      kind               TEXT NOT NULL CHECK (kind IN ('recompra','cruzada')),
      status             TEXT NOT NULL CHECK (status IN ('aguardando','a_contatar','em_conversa','comprou','nao_agora','nao_quer','encerrado')),
      remind_at          TEXT NOT NULL,
      remind_days        INTEGER NOT NULL,
      attempt            INTEGER NOT NULL DEFAULT 1,
      exhausted          INTEGER NOT NULL DEFAULT 0,
      offer_text         TEXT,
      ai_suggestion      TEXT,
      task_id            INTEGER,
      auto_sent_at       TEXT,
      auto_failed_reason TEXT,
      closed_reason_id   INTEGER,
      closed_at          TEXT,
      closed_by          INTEGER,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_repurchase_cycle_open ON repurchase_cycles(lead_id)
      WHERE status IN ('aguardando','a_contatar','em_conversa');
    CREATE INDEX IF NOT EXISTS idx_repurchase_cycles_due ON repurchase_cycles(account_id, status, remind_at);

    CREATE TABLE IF NOT EXISTS repurchase_attempts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       INTEGER NOT NULL,
      cycle_id         INTEGER NOT NULL REFERENCES repurchase_cycles(id) ON DELETE CASCADE,
      lead_id          INTEGER NOT NULL,
      attempt          INTEGER NOT NULL,
      kind             TEXT NOT NULL,
      outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('comprou','nao_agora','nao_quer','sem_desfecho')),
      reason_id        INTEGER,
      next_remind_days INTEGER,
      auto             INTEGER NOT NULL DEFAULT 0,
      task_id          INTEGER,
      contacted_at     TEXT,
      decided_at       TEXT,
      decided_by       INTEGER,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (cycle_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_repurchase_attempts_account ON repurchase_attempts(account_id, created_at);

    CREATE TABLE IF NOT EXISTS repurchase_reasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      grp        TEXT NOT NULL CHECK (grp IN ('nao_agora','nao_quer')),
      label      TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customer_tiers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name       TEXT NOT NULL,
      icon       TEXT,
      color      TEXT NOT NULL DEFAULT '#7E57C2',
      min_ltv    REAL NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}

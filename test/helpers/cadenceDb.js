// Banco de teste da cadencia da etapa: parte do banco do roteiro e cria as tabelas de
// cadencia como estao em producao hoje (CHECK antigo), para testar a reconstrucao.
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './roteiroDb.js'
import { applyCadenceSchema } from '../../server/services/cadence/schema.js'
import { getRoteiro } from '../../server/services/roteiro/repo.js'

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

export function createLegacyCadenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cadences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS cadence_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cadence_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      action_type TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita')),
      description TEXT, instructions TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position);
    CREATE TABLE IF NOT EXISTS lead_cadences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, cadence_id INTEGER NOT NULL, current_attempt_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
      FOREIGN KEY (current_attempt_id) REFERENCES cadence_attempts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, type TEXT, inactivity_stage_id INTEGER
    );
  `)
  for (const [c, t] of [['delay_days', 'INTEGER NOT NULL DEFAULT 0'], ['scheduled_time', 'TEXT'], ['auto_message', 'TEXT'],
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'date'"], ['delay_minutes', 'INTEGER NOT NULL DEFAULT 0'], ['call_script', 'TEXT']]) addCol(db, 'cadence_attempts', c, t)
  for (const [c, t] of [['last_executed_at', 'TEXT'], ['last_executed_attempt_id', 'INTEGER']]) addCol(db, 'lead_cadences', c, t)
}

export function createCadenceTestDb() {
  const db = createRoteiroTestDb()
  createLegacyCadenceTables(db)
  applyCadenceSchema(db)
  return db
}

export const seedCadenceBase = seedRoteiroBase

// Lead parado numa etapa, com a entrada gravada no historico (como as rotas de criacao fazem).
export function leadIn(db, s, stageKey, fields = {}) {
  const id = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages[stageKey], ...fields })
  db.prepare("INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, 'manual')").run(id, s.stages[stageKey])
  return id
}

export const Q_PRAZO = {
  text: 'Para quando é o seu evento, {nome}?', kind: 'options', required: true, spin: 'situation', ai_hint: null,
  options: [{ label: 'Até 30 dias', points: 15 }, { label: 'Mais de 30 dias', points: 5 }],
}
export const Q_LIVRE = { text: 'Conte mais sobre o evento', kind: 'text', required: false, spin: null, ai_hint: null, options: [] }

export function publishedRoteiro(db, s) {
  return getRoteiro(db, s.accountId, s.funnelId).published
}

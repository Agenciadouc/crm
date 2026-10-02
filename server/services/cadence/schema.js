// Cadencia da etapa (spec 2026-09-27 §3): colunas novas, passos feitos por lead e
// cadence_attempts aceitando 'pergunta'. Idempotente. Recebe db (nao importa server/db.js).
import { CadenceError } from './errors.js'

export const CADENCE_ACTION_TYPES = ['mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'pergunta']

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

export function acceptsPergunta(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cadence_attempts'").get()
  return !!row && row.sql.includes("'pergunta'")
}

const COPY_COLUMNS = 'id, cadence_id, position, action_type, description, instructions, created_at, delay_days, scheduled_time, auto_message, schedule_mode, delay_minutes, call_script'

const NEW_TABLE_SQL = `
  CREATE TABLE cadence_attempts_new (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cadence_id     INTEGER NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    action_type    TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'pergunta')),
    description    TEXT,
    instructions   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    delay_days     INTEGER NOT NULL DEFAULT 0,
    scheduled_time TEXT,
    auto_message   TEXT,
    schedule_mode  TEXT NOT NULL DEFAULT 'date',
    delay_minutes  INTEGER NOT NULL DEFAULT 0,
    call_script    TEXT,
    question_key   TEXT,
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
    CHECK (action_type <> 'pergunta' OR question_key IS NOT NULL)
  )
`

// Conta ponteiros nao-nulos (current_attempt_id e last_executed_attempt_id) em lead_cadences.
// Se o FK ficar ligado durante o DROP, ON DELETE SET NULL zera current_attempt_id sem apagar
// a linha nem "sobrar" um id orfao — so contar orfaos nao pega essa perda, por isso comparamos
// as contagens de nao-nulos antes/depois (devem ficar iguais).
function pointerCounts(db) {
  return db.prepare(`
    SELECT
      SUM(CASE WHEN current_attempt_id IS NOT NULL THEN 1 ELSE 0 END) AS current_attempt_id,
      SUM(CASE WHEN last_executed_attempt_id IS NOT NULL THEN 1 ELSE 0 END) AS last_executed_attempt_id
    FROM lead_cadences
  `).get()
}

// SQLite nao altera CHECK: cria a tabela nova, copia com os MESMOS ids, confere e troca.
// Com FK ligada o DROP apagaria as linhas "de verdade" e o ON DELETE SET NULL zeraria
// lead_cadences.current_attempt_id; PRAGMA foreign_keys nao muda dentro de uma transacao ja
// aberta (fica em silencio, sem erro), entao desligamos ANTES de abrir a nossa transacao,
// conferimos que realmente desligou (senao quem chamou esta dentro de outra transacao) e
// religamos no finally.
export function rebuildCadenceAttempts(db) {
  if (acceptsPergunta(db)) return { rebuilt: false, count: null }
  // bancos muito antigos: garante as colunas que a copia le
  for (const [c, t] of [['delay_days', 'INTEGER NOT NULL DEFAULT 0'], ['scheduled_time', 'TEXT'], ['auto_message', 'TEXT'],
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'date'"], ['delay_minutes', 'INTEGER NOT NULL DEFAULT 0'], ['call_script', 'TEXT']]) addColumnIfNotExists(db, 'cadence_attempts', c, t)

  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  db.pragma('foreign_keys = OFF')
  if (db.pragma('foreign_keys', { simple: true }) === 1) {
    // PRAGMA foreign_keys ignorado: ja estamos dentro de uma transacao aberta por quem chamou.
    // Rodar assim faria o DROP TABLE disparar ON DELETE SET NULL de verdade.
    throw new CadenceError('cadence_rebuild_requires_no_transaction', 500, 'Reconstrucao de cadence_attempts precisa rodar fora de uma transacao (nao foi possivel desligar o FK)')
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts').get().n
  const seqRow = tableExists(db, 'sqlite_sequence') ? db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'cadence_attempts'").get() : null
  const oldSeq = seqRow ? seqRow.seq : 0
  const pointersBefore = pointerCounts(db)
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS cadence_attempts_new')
      db.exec(NEW_TABLE_SQL)
      db.exec(`INSERT INTO cadence_attempts_new (${COPY_COLUMNS}) SELECT ${COPY_COLUMNS} FROM cadence_attempts`)
      const copied = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts_new').get().n
      if (copied !== count) throw new Error(`copia incompleta de cadence_attempts (${copied} de ${count})`)
      db.exec('DROP TABLE cadence_attempts')
      db.exec('ALTER TABLE cadence_attempts_new RENAME TO cadence_attempts')
      db.exec('CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position)')
      // id novo nunca reaproveita id antigo (lead_cadences.last_executed_attempt_id nao tem FK)
      db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'cadence_attempts'").run(oldSeq)
      const pointersAfter = pointerCounts(db)
      if (pointersAfter.current_attempt_id !== pointersBefore.current_attempt_id || pointersAfter.last_executed_attempt_id !== pointersBefore.last_executed_attempt_id) {
        throw new Error('lead_cadences perderia o passo atual')
      }
      // Escopado em cadence_attempts: 'foreign_key_check' sem tabela varre o banco inteiro e
      // pega lixo de FK alheio que ja existia (ex.: linhas orfas em outras tabelas), travando
      // essa migracao para sempre sem relacao nenhuma com a reconstrucao.
      const fkViolations = db.pragma('foreign_key_check(cadence_attempts)')
      if (fkViolations.length > 0) throw new Error(`cadence_attempts reconstruida com FK quebrada: ${JSON.stringify(fkViolations)}`)
    })()
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
  return { rebuilt: true, count }
}

// Ordem: colunas, tabela de passos feitos e indices PRIMEIRO; a reconstrucao de
// cadence_attempts (a parte que pode falhar) por ULTIMO — se ela falhar, o resto ja existe.
export function applyCadenceSchema(db, { rebuild = rebuildCadenceAttempts } = {}) {
  addColumnIfNotExists(db, 'cadences', 'funnel_id', 'INTEGER')
  addColumnIfNotExists(db, 'cadences', 'stage_id', 'INTEGER REFERENCES funnel_stages(id) ON DELETE SET NULL')
  addColumnIfNotExists(db, 'lead_cadences', 'kind', "TEXT NOT NULL DEFAULT 'avulsa'")
  addColumnIfNotExists(db, 'lead_cadences', 'stage_id', 'INTEGER')
  addColumnIfNotExists(db, 'lead_cadences', 'stage_entry_id', 'INTEGER')
  addColumnIfNotExists(db, 'lead_cadences', 'last_executed_at', 'TEXT')
  addColumnIfNotExists(db, 'lead_cadences', 'last_executed_attempt_id', 'INTEGER')
  // passo ja avisado pelo agendador (task:due sai uma vez por passo)
  addColumnIfNotExists(db, 'lead_cadences', 'notified_attempt_id', 'INTEGER')
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cadences_stage_active ON cadences(stage_id) WHERE stage_id IS NOT NULL AND is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_lead_cadences_lead_kind ON lead_cadences(lead_id, kind, status);
    CREATE TABLE IF NOT EXISTS lead_cadence_steps (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL,
      lead_cadence_id INTEGER NOT NULL REFERENCES lead_cadences(id) ON DELETE CASCADE,
      lead_id         INTEGER NOT NULL,
      attempt_id      INTEGER NOT NULL,
      how             TEXT NOT NULL CHECK (how IN ('enviado', 'feito', 'pulado')),
      done_by         INTEGER,
      done_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (lead_cadence_id, attempt_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_cadence_steps_attempt ON lead_cadence_steps(attempt_id, done_at);
  `)
  if (tableExists(db, 'roteiro_asks')) addColumnIfNotExists(db, 'roteiro_asks', 'attempt_id', 'INTEGER')
  return rebuild(db)
}

// Helpers de data/hora compartilhados pelo roteiro: sempre UTC, sempre via SQLite (spec 6.1).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).

export function toSqliteDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// 'now' em UTC formatado 'YYYY-MM-DD HH:MM:SS': usa o Date passado (testes) ou o relogio do SQLite.
export function resolveNow(db, now) {
  if (now) return toSqliteDate(now)
  return db.prepare("SELECT datetime('now') AS v").get().v
}

// Desloca uma data (string SQLite) por um modificador, ex.: '-24 hours', '-7 days'.
export function shiftFromNow(db, nowStr, modifier) {
  return db.prepare('SELECT datetime(?, ?) AS v').get(nowStr, modifier).v
}

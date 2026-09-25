// Registro de envios (asks) do roteiro: criacao e marcacao de respondido/avancou/comprou (spec 6.1).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).

function toSqliteDate(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// 'now' em UTC formatado 'YYYY-MM-DD HH:MM:SS': usa o Date passado (testes) ou o relogio do SQLite.
function resolveNow(db, now) {
  if (now) return toSqliteDate(now)
  return db.prepare("SELECT datetime('now') AS v").get().v
}

function shiftFromNow(db, nowStr, modifier) {
  return db.prepare('SELECT datetime(?, ?) AS v').get(nowStr, modifier).v
}

// Cria o ask (envio de pergunta) e devolve o id.
export function recordAsk(db, { accountId, leadId, questionKey, variant = 'A', textSent, messageId = null, userId = null, source }) {
  const nowStr = resolveNow(db, null)
  const info = db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, message_id, user_id, source, asked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, leadId, questionKey, variant, textSent ?? null, messageId, userId, source, nowStr)
  return Number(info.lastInsertRowid)
}

// Mensagem do cliente: todo ask aberto do lead dentro da janela (horas) recebe replied_at.
export function markReplied(db, { leadId, windowHours, now }) {
  const nowStr = resolveNow(db, now)
  const cutoff = shiftFromNow(db, nowStr, `-${windowHours} hours`)
  const info = db.prepare(`
    UPDATE roteiro_asks SET replied_at = ?
    WHERE lead_id = ? AND replied_at IS NULL AND asked_at >= ?
  `).run(nowStr, leadId, cutoff)
  return info.changes
}

// Resposta salva para a pergunta: marca answered_at no ask mais recente dela ainda em aberto.
export function markAnswered(db, { leadId, questionKey, now }) {
  const nowStr = resolveNow(db, now)
  const row = db.prepare(`
    SELECT id FROM roteiro_asks
    WHERE lead_id = ? AND question_key = ? AND answered_at IS NULL
    ORDER BY asked_at DESC, id DESC LIMIT 1
  `).get(leadId, questionKey)
  if (!row) return 0
  const info = db.prepare('UPDATE roteiro_asks SET answered_at = ? WHERE id = ?').run(nowStr, row.id)
  return info.changes
}

// Mudanca de etapa: asks do lead dos ultimos 7 dias sem advanced_at recebem.
export function markAdvanced(db, { leadId, now }) {
  const nowStr = resolveNow(db, now)
  const cutoff = shiftFromNow(db, nowStr, '-7 days')
  const info = db.prepare(`
    UPDATE roteiro_asks SET advanced_at = ?
    WHERE lead_id = ? AND advanced_at IS NULL AND asked_at >= ?
  `).run(nowStr, leadId, cutoff)
  return info.changes
}

// Venda: asks dos ultimos 30 dias sem bought_at recebem.
export function markBought(db, { leadId, now }) {
  const nowStr = resolveNow(db, now)
  const cutoff = shiftFromNow(db, nowStr, '-30 days')
  const info = db.prepare(`
    UPDATE roteiro_asks SET bought_at = ?
    WHERE lead_id = ? AND bought_at IS NULL AND asked_at >= ?
  `).run(nowStr, leadId, cutoff)
  return info.changes
}

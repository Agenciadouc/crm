// Leitura e escrita do briefing do agente. Recebe o db por parametro.
// Toda funcao que le ou muda um briefing filtra por account_id.

const BRIEFING_COLUMNS = 'id, account_id, agent_id, status, compiled_json, compiled_at, tokens_used, created_by, created_at, updated_at'

// O compilado so serve enquanto nada mudou no briefing depois dele. addTurn e
// addSource apagam o compiled_at justamente para invalidar aqui; a comparacao
// com updated_at fica como segunda linha de defesa (banco antigo, escrita
// direta). Sem isso, "Corrigir algo" grava a correcao e a tela continua
// mostrando o resumo velho.
export function precisaRecompilar(briefing) {
  if (!briefing || !briefing.compiled_json) return true
  if (!briefing.compiled_at) return true
  return String(briefing.updated_at || '') > String(briefing.compiled_at)
}

export function createBriefing(db, { accountId, userId }) {
  return Number(db.prepare(
    'INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)'
  ).run(accountId, userId || null).lastInsertRowid)
}

export function addTurn(db, { accountId, briefingId, role, content }) {
  const insert = db.transaction(() => {
    const dono = db.prepare('SELECT 1 FROM agent_briefings WHERE id = ? AND account_id = ?').get(briefingId, accountId)
    if (!dono) return null
    const last = db.prepare('SELECT MAX(position) AS p FROM agent_briefing_turns WHERE briefing_id = ?').get(briefingId)
    const position = (last && last.p ? last.p : 0) + 1
    db.prepare(
      'INSERT INTO agent_briefing_turns (briefing_id, position, role, content) VALUES (?, ?, ?, ?)'
    ).run(briefingId, position, role, String(content))
    db.prepare("UPDATE agent_briefings SET updated_at = datetime('now'), compiled_at = NULL WHERE id = ?").run(briefingId)
    return position
  })
  return insert()
}

export function addSource(db, { accountId, briefingId, kind, ref = null, content = null, status = 'ok', error = null }) {
  const insert = db.transaction(() => {
    const dono = db.prepare('SELECT 1 FROM agent_briefings WHERE id = ? AND account_id = ?').get(briefingId, accountId)
    if (!dono) return null
    const id = db.prepare(
      'INSERT INTO agent_briefing_sources (briefing_id, kind, ref, content, status, error) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(briefingId, kind, ref, content, status, error).lastInsertRowid
    db.prepare("UPDATE agent_briefings SET updated_at = datetime('now'), compiled_at = NULL WHERE id = ?").run(briefingId)
    return Number(id)
  })
  return insert()
}

export function getBriefing(db, accountId, briefingId) {
  const row = db.prepare(
    `SELECT ${BRIEFING_COLUMNS} FROM agent_briefings WHERE id = ? AND account_id = ?`
  ).get(briefingId, accountId)
  if (!row) return null
  row.turns = db.prepare(
    'SELECT id, position, role, content, created_at FROM agent_briefing_turns WHERE briefing_id = ? ORDER BY position'
  ).all(briefingId)
  row.sources = db.prepare(
    'SELECT id, kind, ref, content, status, error, created_at FROM agent_briefing_sources WHERE briefing_id = ? ORDER BY id'
  ).all(briefingId)
  row.precisa_recompilar = precisaRecompilar(row) ? 1 : 0
  return row
}

export function listDrafts(db, accountId) {
  return db.prepare(`
    SELECT b.id, b.status, b.created_at, b.updated_at,
           (SELECT t.content FROM agent_briefing_turns t
             WHERE t.briefing_id = b.id AND t.role = 'user'
             ORDER BY t.position LIMIT 1) AS first_answer
      FROM agent_briefings b
     WHERE b.account_id = ? AND b.status != 'ativo'
     ORDER BY b.updated_at DESC
  `).all(accountId)
}

export function setCompiled(db, { accountId, briefingId, compiled }) {
  // Briefing que ja esta ativo continua ativo: rebaixar para 'compilado' faria a
  // ativacao criar um SEGUNDO agente e deixar o primeiro orfao.
  const r = db.prepare(`
    UPDATE agent_briefings
       SET compiled_json = ?,
           status = CASE WHEN status = 'ativo' THEN 'ativo' ELSE 'compilado' END,
           updated_at = datetime('now'),
           compiled_at = datetime('now')
     WHERE id = ? AND account_id = ?
  `).run(JSON.stringify(compiled), briefingId, accountId)
  return r.changes > 0
}

// Soma tokens gastos pela IA NESTE briefing. Nao mexe em updated_at nem em
// compiled_at: gastar token nao e mudanca de conteudo e nao pode invalidar o
// compilado. Devolve o total acumulado.
export function addTokens(db, { accountId, briefingId, tokens }) {
  const n = Number(tokens) || 0
  if (n > 0) {
    db.prepare('UPDATE agent_briefings SET tokens_used = tokens_used + ? WHERE id = ? AND account_id = ?')
      .run(n, briefingId, accountId)
  }
  const row = db.prepare('SELECT tokens_used FROM agent_briefings WHERE id = ? AND account_id = ?')
    .get(briefingId, accountId)
  return row ? Number(row.tokens_used) : 0
}

// Nao mexe em updated_at: amarrar o agente nao muda o conteudo, e updated_at
// maior que compiled_at faria todo briefing ativado pedir recompilacao (paga).
export function linkAgent(db, { accountId, briefingId, agentId }) {
  const donoAgente = db.prepare('SELECT 1 FROM ai_agents WHERE id = ? AND account_id = ?').get(agentId, accountId)
  if (!donoAgente) return false
  const r = db.prepare(`
    UPDATE agent_briefings
       SET agent_id = ?, status = 'ativo'
     WHERE id = ? AND account_id = ?
  `).run(agentId, briefingId, accountId)
  return r.changes > 0
}

export function deleteBriefing(db, accountId, briefingId) {
  return db.prepare('DELETE FROM agent_briefings WHERE id = ? AND account_id = ?')
    .run(briefingId, accountId).changes > 0
}

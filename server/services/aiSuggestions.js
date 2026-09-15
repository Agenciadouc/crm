// Sugestoes da IA (tabela ai_suggestions). Recebe o db por parametro. Toda query filtra por conta.
// Status: pending -> sent | edited | discarded | expired

const SUGGESTION_COLUMNS = 'id, account_id, lead_id, agent_id, kind, source, content, status, final_content, created_at, resolved_at, resolved_by'

export function normalizeForCompare(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
}

export function expirePendingForLead(db, accountId, leadId) {
  return db.prepare(`
    UPDATE ai_suggestions SET status = 'expired', resolved_at = datetime('now')
    WHERE account_id = ? AND lead_id = ? AND status = 'pending'
  `).run(accountId, leadId).changes
}

export function expirePendingForAgent(db, accountId, agentId) {
  const leadIds = db.prepare(`
    SELECT DISTINCT lead_id FROM ai_suggestions
    WHERE account_id = ? AND agent_id = ? AND status = 'pending'
  `).all(accountId, agentId).map(r => r.lead_id)
  db.prepare(`
    UPDATE ai_suggestions SET status = 'expired', resolved_at = datetime('now')
    WHERE account_id = ? AND agent_id = ? AND status = 'pending'
  `).run(accountId, agentId)
  return leadIds
}

export function createReplySuggestion(db, { accountId, leadId, agentId, content, source = 'ai', payload = null }) {
  const safeSource = source === 'base' ? 'base' : 'ai'
  const insert = db.transaction(() => {
    expirePendingForLead(db, accountId, leadId)
    return db.prepare(`
      INSERT INTO ai_suggestions (account_id, lead_id, agent_id, kind, source, content, payload_json, status)
      VALUES (?, ?, ?, 'reply', ?, ?, ?, 'pending')
    `).run(accountId, leadId, agentId || null, safeSource, String(content), payload ? JSON.stringify(payload) : null).lastInsertRowid
  })
  return Number(insert())
}

export function getPendingSuggestion(db, accountId, leadId) {
  const row = db.prepare(`
    SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions
    WHERE account_id = ? AND lead_id = ? AND kind = 'reply' AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(accountId, leadId)
  return row || null
}

export function resolveSuggestion(db, { accountId, suggestionId, action, finalContent, userId }) {
  const s = db.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions WHERE id = ? AND account_id = ?`).get(suggestionId, accountId)
  if (!s) return { ok: false, error: 'not_found' }
  if (action !== 'sent' && action !== 'discarded') return { ok: false, error: 'invalid_action' }
  if (s.status !== 'pending') return { ok: false, error: 'not_pending' }
  let status = 'discarded'
  let finalText = null
  if (action === 'sent') {
    finalText = String(finalContent == null ? '' : finalContent)
    status = normalizeForCompare(finalText) === normalizeForCompare(s.content) ? 'sent' : 'edited'
  }
  db.prepare(`
    UPDATE ai_suggestions SET status = ?, final_content = ?, resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ? AND account_id = ?
  `).run(status, finalText, userId || null, s.id, accountId)
  const suggestion = db.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions WHERE id = ? AND account_id = ?`).get(s.id, accountId)
  return { ok: true, suggestion }
}

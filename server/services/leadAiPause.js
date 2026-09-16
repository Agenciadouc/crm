// Pausa da IA numa conversa (spec 3.10). Recebe o db por parametro.
import { expirePendingForLead } from './aiSuggestions.js'

export function pauseAiForLead(db, { accountId, leadId, userId }) {
  const res = db.prepare(`
    UPDATE leads SET ai_paused_at = datetime('now'), ai_paused_by = ?
    WHERE id = ? AND account_id = ?
  `).run(userId || null, leadId, accountId)
  if (res.changes === 0) return null
  expirePendingForLead(db, accountId, leadId)
  const row = db.prepare('SELECT ai_paused_at FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  return row ? row.ai_paused_at : null
}

export function resumeAiForLead(db, { accountId, leadId }) {
  db.prepare('UPDATE leads SET ai_paused_at = NULL, ai_paused_by = NULL WHERE id = ? AND account_id = ?').run(leadId, accountId)
  return null
}

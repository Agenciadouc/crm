import db from '../db.js'

// Atendente pode acessar lead se:
//   1) e o atendente principal (l.attendant_id = userId), OU
//   2) tem assignment em lead_instance_assignments, OU
//   3) o lead pertence a instancia primaria dele (l.instance_id ou l.last_instance_id)
// Espelha a UNIAO usada em GET /leads. Reuse em outras rotas pra evitar 403 ao clicar em lead visivel.
export function canAtendenteAccessLead(userId, lead) {
  if (!lead) return false
  if (lead.attendant_id === userId) return true
  const hasAssignment = db.prepare('SELECT 1 FROM lead_instance_assignments WHERE lead_id = ? AND attendant_id = ?').get(lead.id, userId)
  if (hasAssignment) return true
  const userRow = db.prepare('SELECT primary_instance_id FROM users WHERE id = ?').get(userId)
  const primaryId = userRow?.primary_instance_id
  if (primaryId && (lead.instance_id === primaryId || lead.last_instance_id === primaryId)) return true
  return false
}

// Le primary_instance_id do user (nao vem no JWT, precisa consultar DB).
export function getUserPrimaryInstanceId(userId) {
  const row = db.prepare('SELECT primary_instance_id FROM users WHERE id = ?').get(userId)
  return row?.primary_instance_id || null
}

// Desligamento do atendimento da IA (spec 3.10). Recebe o db por parametro. Toda query filtra por conta.

export const AGENT_OFF_NOTE = 'IA desligada — assuma a conversa'

// Leads que estavam com a IA e ainda nao foram passados para um humano
export function findLeadsHeldByAgent(db, { accountId, agentId, agentUserId }) {
  return db.prepare(`
    SELECT l.* FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    WHERE l.account_id = ?
      AND l.is_active = 1
      AND COALESCE(l.is_archived, 0) = 0
      AND COALESCE(l.is_blocked, 0) = 0
      AND l.ai_handed_off_at IS NULL
      AND (
        l.attendant_id = ?
        OR (
          (l.attendant_id IS NULL OR u.is_bot = 1)
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.lead_id = l.id AND m.account_id = l.account_id AND m.ai_agent_id = ?
          )
        )
      )
    ORDER BY l.id
  `).all(accountId, agentUserId || -1, agentId)
}

// Vendedor responsavel: atendente humano ativo da conversa naquela instancia; senao o atendente padrao humano da instancia
export function findResponsibleHumanId(db, { accountId, leadId, instanceId }) {
  if (!instanceId) return null
  const assigned = db.prepare(`
    SELECT u.id FROM lead_instance_assignments a
    JOIN leads l ON l.id = a.lead_id
    JOIN users u ON u.id = a.attendant_id
    WHERE a.lead_id = ? AND a.instance_id = ? AND l.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(leadId, instanceId, accountId)
  if (assigned) return assigned.id
  const byDefault = db.prepare(`
    SELECT u.id FROM whatsapp_instances i
    JOIN users u ON u.id = i.default_attendant_id
    WHERE i.id = ? AND i.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(instanceId, accountId)
  return byDefault ? byDefault.id : null
}

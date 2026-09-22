// Follow-up de inatividade de agente de IA (follow_ups.agent_id) so se edita no editor do agente
// (aba Atendimento, rota PUT /api/agents/:id/inactivity-followup). A pagina Follow-ups so mostra.
export const AGENT_FOLLOWUP_LOCKED_MSG = 'Este follow-up pertence a um agente de IA. Edite em Agentes de IA, no agente, aba Atendimento.'

export function agentFollowUpLock(fu, agentExists) {
  if (fu && fu.agent_id && agentExists) {
    return { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: fu.agent_id }
  }
  return null
}

// Consulta real usada pelo controlador (server/routes/follow-ups.js) pra decidir o
// `agentExists` acima: o agent_id do follow-up so "trava" enquanto apontar pra um
// agente ATIVO da MESMA conta do follow-up. Um agente apagado (soft delete,
// is_active = 0) ou de outra conta nao trava mais a edicao na pagina Follow-ups.
export function agentIsActiveOwner(db, fu) {
  if (!fu || !fu.agent_id) return false
  return !!db.prepare('SELECT 1 FROM ai_agents WHERE id = ? AND account_id = ? AND is_active = 1')
    .get(fu.agent_id, fu.account_id)
}

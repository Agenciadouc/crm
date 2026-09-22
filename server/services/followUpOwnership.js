// Follow-up de inatividade de agente de IA (follow_ups.agent_id) so se edita no editor do agente
// (aba Atendimento, rota PUT /api/agents/:id/inactivity-followup). A pagina Follow-ups so mostra.
export const AGENT_FOLLOWUP_LOCKED_MSG = 'Este follow-up pertence a um agente de IA. Edite em Agentes de IA, no agente, aba Atendimento.'

export function agentFollowUpLock(fu, agentExists) {
  if (fu && fu.agent_id && agentExists) {
    return { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: fu.agent_id }
  }
  return null
}

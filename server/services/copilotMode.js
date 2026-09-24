// Modos do Agente de IA (spec 3.1 e 3.10). Funcoes puras.
// auto    = IA responde sozinha (comportamento atual)
// copilot = IA so sugere; o vendedor envia
// sdr     = IA responde sozinha ate qualificar; depois da passagem vira copilot naquele lead

export const AGENT_MODES = ['auto', 'copilot', 'sdr']

export function normalizeAgentMode(value) {
  return AGENT_MODES.includes(value) ? value : 'auto'
}

// readNumber: conversa num numero de leitura (Evolution) — ali a IA so sugere, em qualquer modo.
export function resolveEffectiveMode(agent, lead, attendantIsHuman = false, readNumber = false) {
  if (readNumber) return 'copilot'
  const mode = normalizeAgentMode(agent && agent.mode)
  if (mode === 'copilot') return 'copilot'
  if (mode === 'sdr') {
    const humanOwned = !!(lead && lead.ai_handed_off_at) || !!attendantIsHuman
    return humanOwned ? 'copilot' : 'sdr'
  }
  return 'auto'
}

// Regras de venda + analise obrigatoria + trava de etapa/qualificacao.
// Decisao do CEO: valem em todos os modos (robo "Dros Sales": pre-atendimento -> valida dados e ICP -> especialista).
// Mantido como funcao para ser o ponto unico de decisao.
export function usesSalesEngine(_agent) {
  return true
}

// Passo 13 do processInboundMessage: enviar ao lead ou gravar sugestao.
export function deliveryActionForMode(mode) {
  return mode === 'copilot' ? 'suggest' : 'send'
}

// Substitui o trecho de findAgentForLead que decidia pelo atendente e pelo modo de ativacao.
export function agentAcceptsLead(agent, lead, attendantIsHuman) {
  if (!agent || !lead) return false
  const mode = normalizeAgentMode(agent.mode)
  const humanOwned = !!lead.ai_handed_off_at || !!attendantIsHuman
  if (humanOwned) return mode === 'copilot' || mode === 'sdr'
  if (mode === 'copilot') return true
  switch (agent.activation_mode) {
    case 'default_attendant':
      return lead.attendant_id === agent.user_id || !lead.attendant_id
    case 'roulette':
      return lead.attendant_id === agent.user_id
    case 'conditional':
      return true
    case 'manual':
      return lead.attendant_id === agent.user_id
    default:
      return false
  }
}

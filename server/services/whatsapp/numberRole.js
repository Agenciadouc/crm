// Papel do numero pelo provedor escolhido na conexao (spec secao 3).
// leitura = Evolution: le conversas e so envia o que humano digitou. disparo = UzAPI/Oficial: todo envio automatico.
export const SEND_PROVIDERS = ['uzapi', 'cloud_api']

export function numberRole(instance) {
  const p = instance && instance.provider
  return SEND_PROVIDERS.includes(p) ? 'disparo' : 'leitura'
}

export function isSendRole(instance) {
  return numberRole(instance) === 'disparo'
}

// Agente de IA so atende numero de disparo (spec secao 6): ligacoes antigas do agente com numero
// de leitura ficam no banco mas sao ignoradas. Excecao (dono, 24/09/2026): o agente em modo
// Copiloto roda no numero de leitura so como suporte — sugere no Chat e nunca envia.
export const READ_NUMBER_AGENT_BLOCKER = 'Número de leitura: o agente só atende números de disparo'

export function agentServesInstance(agent, instance) {
  if (!instance) return false
  if (isSendRole(instance)) return true
  return !!agent && agent.mode === 'copilot'
}

// Devolve o motivo do bloqueio (pt-BR) ou null. Sem numero informado (instanceId vazio) nao ha
// filtro de numero, como antes. Com accountId, o numero de leitura passa se a conta tiver Copiloto ativo.
export function agentInstanceBlocker(db, instanceId, accountId = null) {
  if (!instanceId) return null
  const inst = db.prepare('SELECT provider FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!inst) return 'Número de WhatsApp não encontrado'
  if (isSendRole(inst)) return null
  if (accountId && db.prepare("SELECT 1 FROM ai_agents WHERE account_id = ? AND is_active = 1 AND mode = 'copilot' LIMIT 1").get(accountId)) return null
  return READ_NUMBER_AGENT_BLOCKER
}

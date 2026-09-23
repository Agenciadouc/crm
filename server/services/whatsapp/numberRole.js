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
// de leitura ficam no banco mas sao ignoradas. Devolve o motivo do bloqueio (pt-BR) ou null.
// Sem numero informado (instanceId vazio) nao ha filtro de numero, como antes.
export const READ_NUMBER_AGENT_BLOCKER = 'Número de leitura: o agente só atende números de disparo'

export function agentInstanceBlocker(db, instanceId) {
  if (!instanceId) return null
  const inst = db.prepare('SELECT provider FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!inst) return 'Número de WhatsApp não encontrado'
  return isSendRole(inst) ? null : READ_NUMBER_AGENT_BLOCKER
}

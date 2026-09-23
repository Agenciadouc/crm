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

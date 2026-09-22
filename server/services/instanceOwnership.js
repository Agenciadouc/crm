// Quem pode mexer nas configuracoes de UM numero: gerente/super_admin em qualquer numero
// da conta; atendente so no numero dele (users.primary_instance_id).
// Regra pura (sem banco) usada pelo middleware allowInstanceOwner e pela rota
// PUT /whatsapp/:id/auto-messages, que aceita atendente mas nao pode deixar um atendente
// segurar os envios automaticos do numero de outra pessoa.
export function canManageInstance(role, primaryInstanceId, instanceId) {
  if (role === 'super_admin' || role === 'gerente') return true
  if (!primaryInstanceId) return false
  return Number(instanceId) === Number(primaryInstanceId)
}

export const HOLD_SENDS_FORBIDDEN_MSG = 'Só o gerente ou o atendente dono deste número pode segurar os envios fora do horário.'

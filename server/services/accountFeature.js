// Portao do recurso pago "agentes de IA" da conta. Vivia dentro de
// server/routes/agents.js; virou servico para a entrevista usar o MESMO teste,
// em vez de duplicar a regra (e esquecer de atualizar uma das copias).
// Recebe o db por parametro para ser testavel em memoria.

export function accountHasAiAgents(db, accountId) {
  if (!accountId) return false
  const acc = db.prepare('SELECT ai_agents_enabled FROM accounts WHERE id = ?').get(accountId)
  return !!(acc && acc.ai_agents_enabled === 1)
}

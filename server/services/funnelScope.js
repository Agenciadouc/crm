// Escopo de conta do UPDATE de funil (PUT /api/funnels/:id). Sem o filtro por conta,
// qualquer gerente autenticado alterava funil de OUTRA conta — inclusive pelo botao
// "Usar a deste numero" da tela Mensagens do numero.
// super_admin (suporte da Dros) continua alcancando qualquer conta.
// 0 linhas alteradas = funil de outra conta ou inexistente: a rota responde 404.
export function funnelUpdateTarget(role, accountId, funnelId) {
  if (role === 'super_admin') return { where: 'id = ?', params: [funnelId] }
  return { where: 'id = ? AND account_id = ?', params: [funnelId, accountId ?? null] }
}

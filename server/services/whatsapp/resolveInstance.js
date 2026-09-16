// Instancia usada para baixar a midia de uma mensagem.
// Antes usava lead.instance_id (messages.js:175-178), o que falha quando o lead conversa por mais de um numero.
export function resolveMediaInstance(db, message, lead) {
  if (!message || !lead) return null
  const byId = (id) => (id
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(id, lead.account_id)
    : null)
  return byId(message.instance_id)
    || byId(lead.instance_id)
    || db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? ORDER BY id LIMIT 1').get(lead.account_id, 'connected')
    || null
}

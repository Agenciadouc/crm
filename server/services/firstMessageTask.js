// Passagem ao vendedor em numero de leitura (Evolution): a 1a mensagem vira tarefa com texto pronto (spec secao 7).
import { numberRole } from './whatsapp/numberRole.js'

// Numero do vendedor para a 1a mensagem: leitura vira tarefa (nao precisa estar conectado);
// disparo envia de verdade, entao so vale conectado. null = nada a fazer.
export function sellerFirstMessageInstance(db, instanceId) {
  if (!instanceId) return null
  const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!inst) return null
  if (numberRole(inst) === 'leitura') return inst
  return inst.status === 'connected' ? inst : null
}

export function createFirstMessageTask(db, { lead, user, text }) {
  const who = (lead && (lead.name || lead.phone)) || 'lead'
  const r = db.prepare(`INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'pending')`)
    .run(lead.account_id, lead.id, (user && user.id) || null, `Mandar 1ª mensagem para ${who}`, text)
  db.prepare("UPDATE leads SET first_msg_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(lead.id)
  return { id: r.lastInsertRowid }
}

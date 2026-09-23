// Escolhedor central do numero de saida (spec secoes 4, 5 e 9).
import { SEND_PROVIDERS } from './numberRole.js'

const PLACEHOLDERS = SEND_PROVIDERS.map(() => '?').join(', ')

export function getDefaultSendInstance(db, accountId) {
  if (!accountId) return null
  const acc = db.prepare('SELECT default_send_instance_id FROM accounts WHERE id = ?').get(accountId)
  if (acc && acc.default_send_instance_id) {
    const chosen = db.prepare(`SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ? AND provider IN (${PLACEHOLDERS})`)
      .get(acc.default_send_instance_id, accountId, ...SEND_PROVIDERS)
    if (chosen) return chosen
  }
  return db.prepare(`SELECT * FROM whatsapp_instances WHERE account_id = ? AND provider IN (${PLACEHOLDERS}) ORDER BY id LIMIT 1`)
    .get(accountId, ...SEND_PROVIDERS) || null
}

export function resolveSendInstance(db, { accountId, kind, conversationInstanceId = null }) {
  if (kind === 'manual') {
    const inst = conversationInstanceId
      ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(conversationInstanceId, accountId)
      : null
    return inst ? { ok: true, instance: inst } : { ok: false, reason: 'no_conversation_number' }
  }
  const inst = getDefaultSendInstance(db, accountId)
  if (!inst) return { ok: false, reason: 'no_send_number' }
  if (inst.status !== 'connected') return { ok: false, reason: 'send_number_offline' }
  return { ok: true, instance: inst }
}

export function setDefaultSendInstance(db, accountId, instanceId) {
  const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instanceId, accountId)
  if (!inst) return { ok: false, reason: 'not_found' }
  if (!SEND_PROVIDERS.includes(inst.provider)) return { ok: false, reason: 'not_send_role' }
  db.prepare('UPDATE accounts SET default_send_instance_id = ? WHERE id = ?').run(inst.id, accountId)
  return { ok: true }
}

export function sendNumberStatus(db, accountId) {
  const inst = getDefaultSendInstance(db, accountId)
  if (!inst) return { ok: false, reason: 'no_send_number', instance: null }
  const instance = { id: inst.id, instance_name: inst.instance_name, provider: inst.provider, status: inst.status }
  if (inst.status !== 'connected') return { ok: false, reason: 'send_number_offline', instance }
  return { ok: true, reason: null, instance }
}

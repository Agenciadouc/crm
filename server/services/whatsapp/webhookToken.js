import { generateWebhookToken } from './schema.js'

const TOKEN_RE = /^[a-f0-9]{32}$/

export function isValidWebhookToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token)
}

// Garante que a instancia tem webhook_token (instancias criadas antes do boot com a migracao).
export function ensureWebhookToken(db, instance) {
  if (instance.webhook_token) return instance
  db.prepare("UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ? AND (webhook_token IS NULL OR webhook_token = '')")
    .run(generateWebhookToken(), instance.id)
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
}

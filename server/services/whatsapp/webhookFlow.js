// Recebimento de webhooks de WhatsApp: identifica a instancia e passa o corpo pelo parse do provedor + handler.
import { isValidWebhookToken } from './webhookToken.js'

// Rota nova: POST /api/webhooks/whatsapp/:instanceToken
export function resolveInstanceByToken(db, token) {
  if (!isValidWebhookToken(token)) return { status: 401, error: 'Invalid webhook token' }
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE webhook_token = ?').get(token)
  if (!instance) return { status: 401, error: 'Invalid webhook token' }
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND is_active = 1').get(instance.account_id)
  if (!account) return { status: 404, error: 'Account not found' }
  return { account, instance }
}

// Rota antiga: POST /api/webhooks/evolution/:accountSlug — SEM fallback para a primeira instancia da conta.
export function resolveLegacyEvolutionInstance(db, accountSlug, body, headers) {
  const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(accountSlug)
  if (!account) return { status: 404, error: 'Account not found' }
  const name = body?.instance || body?.instanceName || null
  const instance = name
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(account.id, name)
    : null
  if (!instance || (instance.provider || 'evolution') !== 'evolution') return { status: 401, error: 'Unknown instance' }
  if (instance.webhook_secret && headers?.['x-webhook-secret'] !== instance.webhook_secret) {
    return { status: 401, error: 'Invalid webhook secret' }
  }
  return { account, instance }
}

export function processWebhook({ getProvider, handleInboundMessage, handleStatusUpdate }, account, instance, req) {
  const provider = getProvider(instance)
  const parsed = provider.parseWebhook(instance, req.body || {}, req.headers || {})
  if (parsed.statuses.length > 0) {
    try {
      handleStatusUpdate(account, instance, parsed.statuses)
    } catch (e) {
      console.error('[Webhook messages.update]', e.message)
    }
  }
  let result = { ok: true }
  for (const normalized of parsed.messages) {
    result = handleInboundMessage(account, instance, normalized, { source: 'webhook', req })
  }
  return result
}

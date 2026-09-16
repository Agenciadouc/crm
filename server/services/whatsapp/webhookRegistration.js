// Registra no provedor o webhook exclusivo da instancia: <PUBLIC_BASE_URL>/api/webhooks/whatsapp/<webhook_token>.
// Usado na criacao/conexao da instancia (integrations.js) e no reregistro periodico (scheduler.js).
import { ensureWebhookToken } from './webhookToken.js'
import { buildInstanceWebhookUrl } from '../publicUrl.js'

export function createWebhookRegistrar({ db, getProvider, env = process.env }) {
  async function registerInstanceWebhook(instance) {
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, url: null, reason: e.message } }
    if (!provider.registerWebhook) return { ok: false, url: null, reason: 'provider_without_webhook_registration' }
    const withToken = ensureWebhookToken(db, instance)
    const url = buildInstanceWebhookUrl(withToken, env)
    try {
      await provider.registerWebhook(withToken, url)
      return { ok: true, url }
    } catch (e) {
      return { ok: false, url, reason: e.message }
    }
  }
  return { registerInstanceWebhook }
}

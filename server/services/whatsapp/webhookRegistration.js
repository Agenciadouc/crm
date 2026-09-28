// Registra no provedor o webhook da instancia. Duas rotas, pelo webhook_mode gravado na instancia:
// - 'legacy' (numero Evolution que ja existia no upgrade): mantem a URL de hoje da producao,
//   <PUBLIC_BASE_URL>/api/webhooks/evolution/<slug da conta>, com os mesmos eventos de sempre
//   (['MESSAGES_UPSERT'] — a producao nunca mandou MESSAGES_UPDATE). Pedido do dono: nao mexer
//   no que ja ta conectado e funcionando.
// - qualquer outro valor ('token', ou NULL antes de existir a coluna): URL nova por instancia,
//   <PUBLIC_BASE_URL>/api/webhooks/whatsapp/<webhook_token> (comportamento ja existente).
// Usado na criacao/conexao da instancia (integrations.js) e no reregistro periodico (scheduler.js).
import { ensureWebhookToken } from './webhookToken.js'
import { buildInstanceWebhookUrl, getPublicBaseUrl } from '../publicUrl.js'

// Eventos que a producao (origin/main scheduler.js) sempre mandou no setWebhook da Evolution.
export const LEGACY_EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT']

export function createWebhookRegistrar({ db, getProvider, env = process.env }) {
  async function registerLegacyWebhook(instance) {
    const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
    if (!account?.slug) return { ok: false, url: null, reason: 'account_without_slug' }
    const url = `${getPublicBaseUrl(env)}/api/webhooks/evolution/${account.slug}`
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, url: null, reason: e.message } }
    if (!provider.registerWebhook) return { ok: false, url: null, reason: 'provider_without_webhook_registration' }
    try {
      await provider.registerWebhook(instance, url, LEGACY_EVOLUTION_WEBHOOK_EVENTS)
      return { ok: true, url }
    } catch (e) {
      return { ok: false, url, reason: e.message }
    }
  }

  async function registerTokenWebhook(instance) {
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

  async function registerInstanceWebhook(instance) {
    // So a Evolution teve webhook legado em producao; UzAPI (e qualquer provedor futuro) nao existia
    // la e sempre usou a URL por token desde que foi implementada — nunca trata 'legacy' pra eles,
    // mesmo que a migracao unica tenha marcado webhook_mode='legacy' num numero de outro provedor.
    const isEvolution = (instance.provider || 'evolution') === 'evolution'
    if (isEvolution && instance.webhook_mode === 'legacy') return registerLegacyWebhook(instance)
    return registerTokenWebhook(instance)
  }

  return { registerInstanceWebhook }
}

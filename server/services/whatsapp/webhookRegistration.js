// Registra no provedor o webhook da instancia. Duas rotas, pelo webhook_mode gravado na instancia:
// - 'legacy' (numero que ja existia no upgrade): mantem a URL de hoje da producao, com base FIXA
//   (nunca PUBLIC_BASE_URL — um .env diferente nao pode reapontar numero ja conectado):
//     Evolution: https://drosagencia.com.br/crm/api/webhooks/evolution/<slug da conta>
//     UzAPI:     https://drosagencia.com.br/crm/api/webhooks/uzapi/<slug da conta>
//   com os mesmos eventos de sempre (['MESSAGES_UPSERT'] — a producao nunca mandou MESSAGES_UPDATE).
// - qualquer outro valor ('token', ou NULL antes de existir a coluna): URL nova por instancia,
//   <PUBLIC_BASE_URL>/api/webhooks/whatsapp/<webhook_token> (comportamento ja existente).
// Usado na criacao/conexao da instancia (integrations.js) e no reregistro periodico (scheduler.js).
import { ensureWebhookToken } from './webhookToken.js'
import { buildInstanceWebhookUrl, DEFAULT_PUBLIC_BASE_URL } from '../publicUrl.js'
import { tryReadUzapiConfig } from './providerConfig.js'

// Eventos que a producao (origin/main scheduler.js) sempre mandou no setWebhook/setWebhook da Evolution e UzAPI.
export const LEGACY_WEBHOOK_EVENTS = ['MESSAGES_UPSERT']

function legacyUrlFor(providerName, slug) {
  const path = providerName === 'uzapi' ? 'uzapi' : 'evolution'
  return `${DEFAULT_PUBLIC_BASE_URL}/api/webhooks/${path}/${slug}`
}

export function createWebhookRegistrar({ db, getProvider, env = process.env }) {
  async function registerLegacyEvolutionWebhook(instance, url) {
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, url: null, reason: e.message } }
    if (!provider.registerWebhook) return { ok: false, url: null, reason: 'provider_without_webhook_registration' }
    try {
      await provider.registerWebhook(instance, url, LEGACY_WEBHOOK_EVENTS)
      return { ok: true, url }
    } catch (e) {
      return { ok: false, url, reason: e.message }
    }
  }

  // UzAPI legado: o numero ja tinha o webhook antigo registrado no provedor pela producao ANTES do
  // upgrade (uzapi_session/api_key, formato que nao existe mais aqui). A rota de recebimento
  // (/api/webhooks/uzapi/:slug) foi restaurada e nao depende disso. Mas REGISTRAR de novo (chamada
  // autenticada no provedor) so e seguro se a instancia ja tiver provider_config utilizavel — coisa
  // que a migracao unica preenche so com phoneNumberId (pra casar o webhook recebido), nunca com um
  // instanceToken reconstruido (formato/URL do cliente uzapi mudou — ver report). Sem instanceToken
  // valido, tryReadUzapiConfig falha e NUNCA cai pro fluxo por token: so devolve "nao mexido".
  async function registerLegacyUzapiWebhook(instance, url) {
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, url: null, reason: e.message } }
    if (!provider.registerWebhook) return { ok: false, url: null, reason: 'provider_without_webhook_registration' }
    const { error } = tryReadUzapiConfig(instance, env)
    if (error) return { ok: false, url, reason: 'legacy_uzapi_untouched' }
    try {
      await provider.registerWebhook(instance, url, LEGACY_WEBHOOK_EVENTS)
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
    if (instance.webhook_mode === 'legacy') {
      const providerName = instance.provider || 'evolution'
      // So Evolution e UzAPI tiveram webhook legado em producao; qualquer outro provider marcado
      // 'legacy' (nao devia acontecer, mas por seguranca) NUNCA cai pro token — so fica sem reregistro.
      if (providerName !== 'evolution' && providerName !== 'uzapi') {
        return { ok: false, url: null, reason: 'legacy_unsupported_provider' }
      }
      const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
      if (!account?.slug) return { ok: false, url: null, reason: 'account_without_slug' }
      const url = legacyUrlFor(providerName, account.slug)
      return providerName === 'uzapi' ? registerLegacyUzapiWebhook(instance, url) : registerLegacyEvolutionWebhook(instance, url)
    }
    return registerTokenWebhook(instance)
  }

  return { registerInstanceWebhook }
}

// Dominio publico do CRM (antes fixo em integrations.js:68,394, scheduler.js:319 e Integrations.tsx:790,838).
// Le a env na hora da chamada: em ESM os imports rodam antes do dotenv.config do server/index.js.
export const DEFAULT_PUBLIC_BASE_URL = 'https://drosagencia.com.br/crm'

export function getPublicBaseUrl(env = process.env) {
  const raw = String(env.PUBLIC_BASE_URL || '').trim()
  return (raw || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '')
}

export function buildInstanceWebhookUrl(instance, env = process.env) {
  if (!instance || !instance.webhook_token) throw new Error('instance_without_webhook_token')
  return `${getPublicBaseUrl(env)}/api/webhooks/whatsapp/${instance.webhook_token}`
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PUBLIC_BASE_URL, getPublicBaseUrl, buildInstanceWebhookUrl } from '../server/services/publicUrl.js'

test('getPublicBaseUrl usa o default quando a env nao existe ou esta vazia', () => {
  assert.equal(DEFAULT_PUBLIC_BASE_URL, 'https://drosagencia.com.br/crm')
  assert.equal(getPublicBaseUrl({}), 'https://drosagencia.com.br/crm')
  assert.equal(getPublicBaseUrl({ PUBLIC_BASE_URL: '   ' }), 'https://drosagencia.com.br/crm')
})

test('getPublicBaseUrl respeita a env e tira barras finais', () => {
  assert.equal(getPublicBaseUrl({ PUBLIC_BASE_URL: 'https://crm.cliente.com.br/crm///' }), 'https://crm.cliente.com.br/crm')
})

test('buildInstanceWebhookUrl monta a URL por token', () => {
  const env = { PUBLIC_BASE_URL: 'https://x.com/crm/' }
  assert.equal(buildInstanceWebhookUrl({ webhook_token: 'b'.repeat(32) }, env), `https://x.com/crm/api/webhooks/whatsapp/${'b'.repeat(32)}`)
  assert.throws(() => buildInstanceWebhookUrl({ webhook_token: null }, env), /instance_without_webhook_token/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiKeyStatus } from '../server/services/aiKeyStatus.js'

test('precisa de chave: so conta client (ou sem modo) e sem chave propria', () => {
  assert.deepEqual(aiKeyStatus({ ai_key_source: 'client', anthropic_api_key: null }), { needs_key: true })
  assert.deepEqual(aiKeyStatus({ ai_key_source: null, anthropic_api_key: '  ' }), { needs_key: true })
  assert.deepEqual(aiKeyStatus({ ai_key_source: 'client', anthropic_api_key: 'sk-x' }), { needs_key: false })
  assert.deepEqual(aiKeyStatus({ ai_key_source: 'auto', anthropic_api_key: null }), { needs_key: false })
  assert.deepEqual(aiKeyStatus({ ai_key_source: 'dros', anthropic_api_key: null }), { needs_key: false })
  assert.deepEqual(aiKeyStatus(null), { needs_key: false })
})

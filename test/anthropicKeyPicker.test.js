import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAnthropicKey } from '../server/services/anthropicKeyPicker.js'

test('client (ou vazio) usa a chave da conta, sem espacos', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: '  sk-cliente  ', ai_key_source: 'client' }, {}), 'sk-cliente')
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente' }, {}), 'sk-cliente')
})

test('client sem chave devolve null (sem fallback para a Dros)', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: '   ', ai_key_source: 'client' }, { ANTHROPIC_API_KEY_DROS: 'sk-dros' }), null)
})

test('dros usa ANTHROPIC_API_KEY_DROS', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente', ai_key_source: 'dros' }, { ANTHROPIC_API_KEY_DROS: ' sk-dros ' }), 'sk-dros')
})

test('dros sem a variavel devolve null (nao cai na chave do cliente)', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente', ai_key_source: 'dros' }, {}), null)
})

test('conta inexistente devolve null', () => {
  assert.equal(pickAnthropicKey(null, { ANTHROPIC_API_KEY_DROS: 'sk-dros' }), null)
})

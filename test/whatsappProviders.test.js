import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerLabel, normalizeProviders, defaultProvider, qrImageSrc } from '../src/lib/whatsappProviders.js'

test('nome do provedor para a tela', () => {
  assert.equal(providerLabel('uzapi'), 'UzAPI (estável)')
  assert.equal(providerLabel('evolution'), 'Evolution')
  assert.equal(providerLabel(undefined), 'Evolution')
  assert.equal(providerLabel(null), 'Evolution')
  assert.equal(providerLabel('custom'), 'custom')
})

test('lista de provedores: array de textos', () => {
  assert.deepEqual(normalizeProviders(['uzapi', 'evolution']), ['evolution', 'uzapi'])
})

test('lista de provedores: { providers: [textos] }', () => {
  assert.deepEqual(normalizeProviders({ providers: ['evolution'] }), ['evolution'])
})

test('lista de provedores: { providers: [objetos] } com id, provider, key ou name', () => {
  assert.deepEqual(normalizeProviders({ providers: [{ id: 'uzapi', label: 'UzAPI' }, { provider: 'evolution' }] }), ['evolution', 'uzapi'])
  assert.deepEqual(normalizeProviders({ providers: [{ key: 'uzapi' }, { name: 'evolution' }] }), ['evolution', 'uzapi'])
})

test('lista de provedores: formato real do servidor { providers: [{ id, label }], default }', () => {
  assert.deepEqual(
    normalizeProviders({ providers: [{ id: 'evolution', label: 'Evolution' }, { id: 'uzapi', label: 'UzAPI (estável)' }], default: 'evolution' }),
    ['evolution', 'uzapi'],
  )
})

test('lista de provedores: ignora desconhecidos e repetidos', () => {
  assert.deepEqual(normalizeProviders(['uzapi', 'uzapi', 'cloud_api', 'evolution']), ['evolution', 'uzapi'])
})

test('lista de provedores: resposta vazia ou estranha cai na Evolution', () => {
  assert.deepEqual(normalizeProviders(null), ['evolution'])
  assert.deepEqual(normalizeProviders({}), ['evolution'])
  assert.deepEqual(normalizeProviders({ providers: [] }), ['evolution'])
})

test('provedor padrao: uzapi quando disponivel', () => {
  assert.equal(defaultProvider(['evolution', 'uzapi']), 'uzapi')
})

test('provedor padrao: evolution quando uzapi nao esta na lista', () => {
  assert.equal(defaultProvider(['evolution']), 'evolution')
})

test('provedor padrao: lista vazia ou estranha cai na evolution', () => {
  assert.equal(defaultProvider([]), 'evolution')
  assert.equal(defaultProvider(undefined), 'evolution')
})

test('QR: data URL passa como veio', () => {
  assert.equal(qrImageSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
})

test('QR: base64 cru vira imagem png', () => {
  const b64 = 'iVBORw0KGgo' + 'A'.repeat(120) + '=='
  assert.equal(qrImageSrc(b64), `data:image/png;base64,${b64}`)
  assert.equal(qrImageSrc(`  ${b64}\n`), `data:image/png;base64,${b64}`)
})

test('QR: texto cru do WhatsApp (nao e imagem) nao vira imagem', () => {
  assert.equal(qrImageSrc('2@AbCdEf123,XyZ+/w==,QwErTy=='), null)
})

test('QR: vazio ou curto demais', () => {
  assert.equal(qrImageSrc(null), null)
  assert.equal(qrImageSrc(''), null)
  assert.equal(qrImageSrc('abcd'), null)
})

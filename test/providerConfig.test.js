import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encryptSecret, decryptSecret, hasEncryptionKey, buildUzapiConfig, readUzapiConfig, tryReadUzapiConfig, readUzapiPhoneNumberId,
} from '../server/services/whatsapp/providerConfig.js'
import { UZAPI_TEST_ENV as ENV, UZAPI_PNID } from './helpers/uzapiFixtures.js'

test('cifra e decifra; o texto cifrado nao contem o segredo e muda a cada vez', () => {
  const a = encryptSecret('eyJ-token-da-instancia', ENV)
  const b = encryptSecret('eyJ-token-da-instancia', ENV)
  assert.match(a, /^v1:[^:]+:[^:]+:[^:]+$/)
  assert.ok(!a.includes('eyJ-token'))
  assert.notEqual(a, b)
  assert.equal(decryptSecret(a, ENV), 'eyJ-token-da-instancia')
})

test('sem WA_ENC_KEY (ou com tamanho errado) nao cifra', () => {
  assert.equal(hasEncryptionKey({}), false)
  assert.equal(hasEncryptionKey({ WA_ENC_KEY: 'abc' }), false)
  assert.equal(hasEncryptionKey(ENV), true)
  assert.throws(() => encryptSecret('x', {}), (e) => e.code === 'wa_enc_key_missing')
})

test('texto adulterado, chave errada ou formato invalido falham', () => {
  const box = encryptSecret('segredo', ENV)
  const parts = box.split(':')
  parts[3] = Buffer.from('outra coisa').toString('base64')
  assert.throws(() => decryptSecret(parts.join(':'), ENV))
  assert.throws(() => decryptSecret(box, { WA_ENC_KEY: 'cd'.repeat(32) }))
  assert.throws(() => decryptSecret('lixo', ENV), /wa_secret_invalid/)
})

test('provider_config da UzAPI: grava o token cifrado e le de volta', () => {
  const json = buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA', uzapiInstanceId: 'loja' }, ENV)
  assert.ok(!json.includes('TOKEN-INSTANCIA'))
  assert.deepEqual(readUzapiConfig({ provider_config: json }, ENV), { phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA', uzapiInstanceId: 'loja' })
  assert.deepEqual(tryReadUzapiConfig({ provider_config: json }, ENV).cfg.instanceToken, 'TOKEN-INSTANCIA')
  assert.equal(readUzapiPhoneNumberId({ provider_config: json }), UZAPI_PNID)
})

test('provider_config ausente ou invalido', () => {
  assert.throws(() => readUzapiConfig({ provider_config: null }, ENV), (e) => e.code === 'uzapi_config_missing')
  assert.deepEqual(tryReadUzapiConfig({ provider_config: '{' }, ENV), { error: 'uzapi_config_missing' })
  assert.equal(readUzapiPhoneNumberId({ provider_config: null }), null)
  assert.equal(readUzapiPhoneNumberId(null), null)
})

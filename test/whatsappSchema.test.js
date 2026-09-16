import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb } from './helpers/db.js'
import { migrateWhatsappProviderSchema, generateWebhookToken, WHATSAPP_PROVIDERS } from '../server/services/whatsapp/schema.js'
import { isValidWebhookToken, ensureWebhookToken } from '../server/services/whatsapp/webhookToken.js'

function insertLegacyInstance(db, name) {
  db.prepare("INSERT OR IGNORE INTO accounts (id, name, slug) VALUES (1, 'A', 'a')").run()
  return db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key) VALUES (1, ?, 'http://evo', 'k')").run(name).lastInsertRowid
}

test('migracao adiciona provider (default evolution), provider_config e webhook_token nas instancias existentes', () => {
  const db = createTestDb({ migrate: false })
  insertLegacyInstance(db, 'um')
  insertLegacyInstance(db, 'dois')
  migrateWhatsappProviderSchema(db)
  const rows = db.prepare('SELECT * FROM whatsapp_instances ORDER BY id').all()
  assert.equal(rows.length, 2)
  for (const r of rows) {
    assert.equal(r.provider, 'evolution')
    assert.equal(r.provider_config, null)
    assert.match(r.webhook_token, /^[a-f0-9]{32}$/)
  }
  assert.notEqual(rows[0].webhook_token, rows[1].webhook_token)
})

test('migracao e idempotente e nao troca tokens ja gerados', () => {
  const db = createTestDb({ migrate: false })
  insertLegacyInstance(db, 'um')
  migrateWhatsappProviderSchema(db)
  const before = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  migrateWhatsappProviderSchema(db)
  const after = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  assert.equal(after, before)
})

test('instancia nova sem provider recebe evolution', () => {
  const db = createTestDb()
  const id = insertLegacyInstance(db, 'nova')
  assert.equal(db.prepare('SELECT provider FROM whatsapp_instances WHERE id = ?').get(id).provider, 'evolution')
})

test('token unico por indice', () => {
  const db = createTestDb()
  insertLegacyInstance(db, 'x')
  const tok = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  const id2 = insertLegacyInstance(db, 'y')
  assert.throws(() => db.prepare('UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ?').run(tok, id2), /UNIQUE/)
})

test('generateWebhookToken, isValidWebhookToken e lista de provedores', () => {
  assert.match(generateWebhookToken(), /^[a-f0-9]{32}$/)
  assert.equal(isValidWebhookToken('a'.repeat(32)), true)
  assert.equal(isValidWebhookToken('A'.repeat(32)), false)
  assert.equal(isValidWebhookToken('abc'), false)
  assert.equal(isValidWebhookToken(null), false)
  assert.deepEqual(WHATSAPP_PROVIDERS, ['evolution', 'cloud_api', 'custom'])
})

test('ensureWebhookToken gera token quando falta e preserva quando existe', () => {
  const db = createTestDb()
  const id = insertLegacyInstance(db, 'sem-token')
  db.prepare('UPDATE whatsapp_instances SET webhook_token = NULL WHERE id = ?').run(id)
  const semToken = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
  const comToken = ensureWebhookToken(db, semToken)
  assert.match(comToken.webhook_token, /^[a-f0-9]{32}$/)
  const denovo = ensureWebhookToken(db, comToken)
  assert.equal(denovo.webhook_token, comToken.webhook_token)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { migrateWhatsappProviderSchema, markExistingInstancesLegacy, WEBHOOK_LEGACY_MARK_FLAG } from '../server/services/whatsapp/schema.js'

// Migracao unica (pedido do dono, 2026-09-27): numero Evolution ja conectado no upgrade mantem o
// webhook de hoje; so numero criado depois usa a URL nova por token.
test('marca legado 1x; rodar de novo nao muda nada; instancia criada depois fica token (NULL)', () => {
  const db = createTestDb({ migrate: false })
  // Simula 2 numeros que ja existiam ANTES do upgrade (banco sem as colunas novas ainda).
  const accountId = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta Antiga', 'conta-antiga')").run().lastInsertRowid
  const preA = db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status) VALUES (?, 'pre-a', 'http://evo.local', 'K', 'connected')").run(accountId).lastInsertRowid
  const preB = db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status) VALUES (?, 'pre-b', 'http://evo.local', 'K', 'disconnected')").run(accountId).lastInsertRowid

  // "Boot" do upgrade: cria as colunas novas (webhook_mode fica NULL) e roda a migracao unica.
  migrateWhatsappProviderSchema(db)

  const modeOf = (id) => db.prepare('SELECT webhook_mode FROM whatsapp_instances WHERE id = ?').get(id).webhook_mode
  assert.equal(modeOf(preA), 'legacy')
  assert.equal(modeOf(preB), 'legacy')
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WEBHOOK_LEGACY_MARK_FLAG))

  // Roda a migracao de novo ("segundo boot"): idempotente, nao mexe em nada (flag ja setada).
  const r2 = markExistingInstancesLegacy(db)
  assert.deepEqual(r2, { marked: 0, skipped: true })
  assert.equal(modeOf(preA), 'legacy')
  assert.equal(modeOf(preB), 'legacy')

  // Instancia criada DEPOIS do upgrade (via seedBasic, como as rotas fariam) nao e afetada.
  const { instance: posUpgrade } = seedBasic(db)
  assert.notEqual(modeOf(posUpgrade.id), 'legacy')
})

test('rodar migrateWhatsappProviderSchema de novo (varios boots) mantem o estado legado estavel', () => {
  const db = createTestDb({ migrate: false })
  const accountId = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta X', 'conta-x')").run().lastInsertRowid
  const pre = db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status) VALUES (?, 'pre', 'http://evo.local', 'K', 'connected')").run(accountId).lastInsertRowid

  migrateWhatsappProviderSchema(db) // boot 1: marca legado
  migrateWhatsappProviderSchema(db) // boot 2
  migrateWhatsappProviderSchema(db) // boot 3

  assert.equal(db.prepare('SELECT webhook_mode FROM whatsapp_instances WHERE id = ?').get(pre).webhook_mode, 'legacy')
})

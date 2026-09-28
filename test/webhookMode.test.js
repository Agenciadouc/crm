import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import {
  migrateWhatsappProviderSchema, markExistingInstancesLegacy, WEBHOOK_LEGACY_MARK_FLAG,
  backfillLegacyUzapiProviderConfig, UZAPI_PROVIDER_CONFIG_BACKFILL_FLAG,
} from '../server/services/whatsapp/schema.js'
import { readUzapiPhoneNumberId, tryReadUzapiConfig } from '../server/services/whatsapp/providerConfig.js'

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

// Item 3 do review: boot com a tabela de instancias VAZIA (0 linhas pra marcar) e so DEPOIS um numero
// de verdade e criado (aqui, direto no banco simulando o que a rota/manager fazem) — tem que nascer token.
test('boot com 0 instancias pre-existentes: nada pra marcar; instancia criada depois fica token', () => {
  const db = createTestDb({ migrate: false })
  db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta Nova', 'conta-nova')").run()

  migrateWhatsappProviderSchema(db) // boot com whatsapp_instances vazia
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(WEBHOOK_LEGACY_MARK_FLAG))
  assert.deepEqual(markExistingInstancesLegacy(db), { marked: 0, skipped: true })

  const { instance } = seedBasic(db) // "insert atraves da rota/manager" — grava webhook_mode='token' como integrations.js/instanceManager.js fazem
  const mode = db.prepare('SELECT webhook_mode FROM whatsapp_instances WHERE id = ?').get(instance.id).webhook_mode
  assert.notEqual(mode, 'legacy')
})

// Item 1c do review: instancia UzAPI legada (uzapi_session da producao) ganha SO o phoneNumberId no
// provider_config — o bastante pra achar a instancia certa num aviso recebido, nunca um instanceToken
// reconstruido (ver comentario em schema.js e o report). Sem instanceToken, continua sem poder fazer
// chamada autenticada (status, reregistro) — exatamente o "nao mexido" pedido pelo dono.
test('backfill do provider_config UzAPI legado: so phoneNumberId (nunca token); idempotente; sem a coluna antiga vira no-op', () => {
  const db = createTestDb({ migrate: false })
  // Simula o banco real: as colunas novas (provider, provider_config) E a antiga (uzapi_session,
  // da producao) convivem, porque a producao ja tinha criado uzapi_session antes do upgrade.
  db.exec("ALTER TABLE whatsapp_instances ADD COLUMN provider TEXT NOT NULL DEFAULT 'evolution'")
  db.exec('ALTER TABLE whatsapp_instances ADD COLUMN provider_config TEXT')
  db.exec('ALTER TABLE whatsapp_instances ADD COLUMN uzapi_session TEXT')
  const accountId = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta UzAPI', 'conta-uzapi')").run().lastInsertRowid
  const legacyId = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider, uzapi_session)
    VALUES (?, 'uz-legado', '', '', 'connected', 'uzapi', '100000000000001')
  `).run(accountId).lastInsertRowid

  const r1 = backfillLegacyUzapiProviderConfig(db)
  assert.deepEqual(r1, { filled: 1, skipped: false })
  const row = db.prepare('SELECT provider_config FROM whatsapp_instances WHERE id = ?').get(legacyId)
  assert.deepEqual(JSON.parse(row.provider_config), { phoneNumberId: '100000000000001', instanceToken: null, uzapiInstanceId: null })
  // phoneNumberId da pra casar o webhook recebido...
  assert.equal(readUzapiPhoneNumberId({ provider_config: row.provider_config }), '100000000000001')
  // ...mas SEM instanceToken nenhuma chamada autenticada e possivel (reregistro de webhook, status etc).
  assert.equal(tryReadUzapiConfig({ provider_config: row.provider_config }).error, 'uzapi_config_missing')

  // Rodar de novo (2o boot): idempotente, nao mexe em nada.
  const r2 = backfillLegacyUzapiProviderConfig(db)
  assert.deepEqual(r2, { filled: 0, skipped: true })
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(UZAPI_PROVIDER_CONFIG_BACKFILL_FLAG))
})

test('backfill do provider_config UzAPI legado: banco sem a coluna antiga uzapi_session vira no-op (nunca quebra o boot)', () => {
  const db = createTestDb() // schema atual, nunca teve uzapi_session
  const r = backfillLegacyUzapiProviderConfig(db)
  assert.deepEqual(r, { filled: 0, skipped: true }) // ja rodou dentro do createTestDb (migrate:true por padrao)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { CONNECTION_EVENTS, logConnectionEvent, uzapiUsageByAccount } from '../server/services/whatsapp/connectionLog.js'

function insertUzapi(db, accountId, { name, status = 'connected', createdAt, token }) {
  const id = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider, provider_config, webhook_token, created_at)
    VALUES (?, ?, '', '', ?, 'uzapi', '{}', ?, ?)
  `).run(accountId, name, status, token, createdAt).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('eventos aceitos', () => {
  assert.deepEqual(CONNECTION_EVENTS, ['created', 'connected', 'disconnected', 'removed'])
})

test('logConnectionEvent grava conta, numero, provedor e evento', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const inst = insertUzapi(db, account.id, { name: 'loja', createdAt: '2026-09-21 10:00:00', token: 'c'.repeat(32) })
  logConnectionEvent(db, inst, 'created')
  const rows = db.prepare('SELECT account_id, instance_id, provider, event FROM whatsapp_connection_log').all()
  assert.deepEqual(rows, [{ account_id: account.id, instance_id: inst.id, provider: 'uzapi', event: 'created' }])
})

test('logConnectionEvent recusa evento desconhecido', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.throws(() => logConnectionEvent(db, instance, 'pago'), /invalid_connection_event:pago/)
})

test('uzapiUsageByAccount: numeros UzAPI por conta, conectados agora e desde quando; ignora Evolution', () => {
  const db = createTestDb()
  const { account } = seedBasic(db) // ja tem 1 numero Evolution
  const outra = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Outra', 'outra')").run().lastInsertRowid
  const a = insertUzapi(db, account.id, { name: 'a', status: 'connected', createdAt: '2026-09-21 10:00:00', token: 'c'.repeat(32) })
  insertUzapi(db, account.id, { name: 'b', status: 'connecting', createdAt: '2026-09-22 09:00:00', token: 'd'.repeat(32) })
  db.prepare("INSERT INTO whatsapp_connection_log (account_id, instance_id, provider, event, created_at) VALUES (?, ?, 'uzapi', 'created', '2026-09-20 08:00:00')").run(account.id, a.id)
  const rows = uzapiUsageByAccount(db)
  assert.deepEqual(rows, [{
    account_id: account.id, numbers: 2, connected_now: 1,
    oldest_created_at: '2026-09-21 10:00:00', first_created_at: '2026-09-20 08:00:00',
  }])
  assert.equal(rows.some(r => r.account_id === outra), false)
})

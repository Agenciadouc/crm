import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberRole, isSendRole, SEND_PROVIDERS } from '../server/services/whatsapp/numberRole.js'
import { createTestDb } from './helpers/db.js'

test('papel pelo provedor', () => {
  assert.equal(numberRole({ provider: 'evolution' }), 'leitura')
  assert.equal(numberRole({ provider: '' }), 'leitura')
  assert.equal(numberRole({}), 'leitura')
  assert.equal(numberRole(null), 'leitura')
  assert.equal(numberRole({ provider: 'custom' }), 'leitura')
  assert.equal(numberRole({ provider: 'uzapi' }), 'disparo')
  assert.equal(numberRole({ provider: 'cloud_api' }), 'disparo')
  assert.equal(isSendRole({ provider: 'uzapi' }), true)
  assert.equal(isSendRole({ provider: 'evolution' }), false)
  assert.deepEqual(SEND_PROVIDERS, ['uzapi', 'cloud_api'])
})

test('migracao cria as colunas novas (idempotente)', () => {
  const db = createTestDb()
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  for (const c of ['default_send_instance_id', 'optout_footer_enabled', 'optout_footer_text', 'optout_confirm_text', 'reply_rate_alert_pct']) {
    assert.ok(cols('accounts').includes(c), c)
  }
  assert.ok(cols('leads').includes('opted_out_at'))
  assert.ok(cols('follow_ups').includes('optout_footer_enabled'))
  const acc = db.prepare("INSERT INTO accounts (name, slug) VALUES ('A', 'a')").run().lastInsertRowid
  const row = db.prepare('SELECT optout_footer_enabled, reply_rate_alert_pct FROM accounts WHERE id = ?').get(acc)
  assert.equal(row.optout_footer_enabled, 1)
  assert.equal(row.reply_rate_alert_pct, 10)
})

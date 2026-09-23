import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { getAntibanSettings, saveAntibanSettings, decorateInstances } from '../server/services/antibanSettings.js'

// computeReplyRate (Task 10) tambem le broadcasts/broadcast_recipients; o DB de teste compartilhado
// nao tem essas tabelas, entao criamos aqui do mesmo jeito que test/replyRate.test.js.
function withBroadcasts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, instance_id INTEGER);
    CREATE TABLE IF NOT EXISTS broadcast_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, broadcast_id INTEGER, lead_id INTEGER, phone TEXT, status TEXT, sent_at TEXT)
  `)
  return db
}

test('padroes quando a conta nao configurou', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(getAntibanSettings(db, s.account.id), {
    optout_footer_enabled: true,
    optout_footer_text: 'Digite SAIR para não receber mais mensagens.',
    optout_confirm_text: 'Pronto! Você não vai mais receber nossas mensagens automáticas.',
    reply_rate_alert_pct: 10,
  })
})

test('salva e valida', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const r = saveAntibanSettings(db, s.account.id, { optout_footer_enabled: false, optout_footer_text: '  SAIR p/ parar ', optout_confirm_text: '', reply_rate_alert_pct: 15 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.settings, {
    optout_footer_enabled: false, optout_footer_text: 'SAIR p/ parar',
    optout_confirm_text: 'Pronto! Você não vai mais receber nossas mensagens automáticas.', reply_rate_alert_pct: 15,
  })
  assert.equal(saveAntibanSettings(db, s.account.id, { reply_rate_alert_pct: 0 }).ok, false)
  assert.equal(saveAntibanSettings(db, s.account.id, { reply_rate_alert_pct: 90 }).ok, false)
  assert.equal(saveAntibanSettings(db, s.account.id, { optout_footer_text: 'x'.repeat(201) }).ok, false)
})

test('lista de numeros ganha papel e padrao', () => {
  const db = withBroadcasts(createTestDb()); const s = seedBasic(db)
  const uzId = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', 'connected', 'uzapi')`).run(s.account.id).lastInsertRowid
  const rows = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY id').all(s.account.id)
  const out = decorateInstances(db, s.account.id, rows)
  assert.equal(out[0].role, 'leitura'); assert.equal(out[0].is_default_send, false); assert.equal(out[0].reply_rate, null)
  assert.equal(out[1].role, 'disparo'); assert.equal(out[1].is_default_send, true)
  assert.deepEqual(out[1].reply_rate, { reached: 0, replied: 0, rate: null })
  assert.equal(out[1].id, uzId)
})

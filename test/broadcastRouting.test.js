import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { broadcastFooter, pauseReasonText, NO_SEND_REASONS, canStartBroadcast, skipOptedOutRecipient, pausedBroadcastsToResume } from '../server/services/broadcastRouting.js'

test('rodape ligado por padrao com o texto padrao; desligavel; texto da conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.equal(broadcastFooter(db, s.account.id), 'Digite SAIR para não receber mais mensagens.')
  db.prepare("UPDATE accounts SET optout_footer_text = 'SAIR = parar' WHERE id = ?").run(s.account.id)
  assert.equal(broadcastFooter(db, s.account.id), 'SAIR = parar')
  db.prepare('UPDATE accounts SET optout_footer_enabled = 0 WHERE id = ?').run(s.account.id)
  assert.equal(broadcastFooter(db, s.account.id), null)
})

test('textos de pausa', () => {
  assert.equal(pauseReasonText('no_send_number'), 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar')
  assert.equal(pauseReasonText('send_number_offline'), 'O número de disparos está desconectado — os envios automáticos estão parados')
  assert.deepEqual(NO_SEND_REASONS, [pauseReasonText('no_send_number'), pauseReasonText('send_number_offline')])
})

test('canStartBroadcast: sem numero de disparo, offline, e ok', () => {
  const db = createTestDb(); const s = seedBasic(db) // so tem instancia Evolution (leitura)

  let r = canStartBroadcast(db, s.account.id)
  assert.equal(r.ok, false)
  assert.equal(r.reasonText, pauseReasonText('no_send_number'))

  const uzapiId = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'inst-uzapi', 'http://uz.local', 'KEY', 'disconnected', 'uzapi')
  `).run(s.account.id).lastInsertRowid

  r = canStartBroadcast(db, s.account.id)
  assert.equal(r.ok, false)
  assert.equal(r.reasonText, pauseReasonText('send_number_offline'))

  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(uzapiId)
  r = canStartBroadcast(db, s.account.id)
  assert.equal(r.ok, true)
  assert.equal(r.reasonText, null)
  assert.equal(r.instance.id, uzapiId)
})

function withBroadcastTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT, instance_id INTEGER,
      status TEXT, paused_at TEXT, paused_reason TEXT, sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS broadcast_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, broadcast_id INTEGER, lead_id INTEGER,
      phone TEXT, status TEXT DEFAULT 'pending', error TEXT);
  `)
  return db
}

test('skipOptedOutRecipient: lead descadastrado com o disparo na fila vira falha lead_opted_out sem envio', () => {
  const db = withBroadcastTables(createTestDb())
  const b = db.prepare("INSERT INTO broadcasts (account_id, status) VALUES (1, 'sending')").run().lastInsertRowid
  const r1 = db.prepare("INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone) VALUES (?, 1, '1')").run(b).lastInsertRowid
  const r2 = db.prepare("INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone) VALUES (?, 2, '2')").run(b).lastInsertRowid
  assert.equal(skipOptedOutRecipient(db, { broadcastId: b, recipientId: r1, lead: { opted_out_at: '2026-09-23 10:00:00', opted_in_at: null } }), true)
  assert.equal(skipOptedOutRecipient(db, { broadcastId: b, recipientId: r2, lead: { opted_out_at: '2026-09-20 10:00:00', opted_in_at: '2026-09-21 10:00:00' } }), false)
  assert.equal(skipOptedOutRecipient(db, { broadcastId: b, recipientId: r2, lead: null }), false)
  const rows = db.prepare('SELECT status, error FROM broadcast_recipients ORDER BY id').all()
  assert.deepEqual(rows, [{ status: 'failed', error: 'lead_opted_out' }, { status: 'pending', error: null }])
  assert.equal(db.prepare('SELECT failed_count FROM broadcasts WHERE id = ?').get(b).failed_count, 1)
})

test('pausedBroadcastsToResume: nunca retoma disparo pausado a mao pelo usuario', () => {
  const db = withBroadcastTables(createTestDb())
  const ins = db.prepare("INSERT INTO broadcasts (account_id, name, instance_id, status, paused_at, paused_reason) VALUES (1, ?, ?, 'sending', datetime('now'), ?)")
  ins.run('manual', 5, 'manual_user')
  ins.run('queda', 5, 'Instancia desconectada')
  ins.run('sem numero', 9, pauseReasonText('no_send_number'))
  ins.run('outro numero', 9, 'Instancia desconectada')
  const names = pausedBroadcastsToResume(db, 1, 5).map(b => b.name).sort()
  assert.deepEqual(names, ['queda', 'sem numero'])
})

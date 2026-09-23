import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { broadcastFooter, pauseReasonText, NO_SEND_REASONS, canStartBroadcast } from '../server/services/broadcastRouting.js'

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

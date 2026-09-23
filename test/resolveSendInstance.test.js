import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { getDefaultSendInstance, resolveSendInstance, setDefaultSendInstance, sendNumberStatus } from '../server/services/whatsapp/resolveSendInstance.js'

function addInstance(db, accountId, { provider = 'uzapi', status = 'connected', name = 'disp' } = {}) {
  const id = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, ?, 'http://x', 'K', ?, ?)`).run(accountId, name, status, provider).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('so Evolution: automatico sem numero (no_send_number); manual usa o numero da conversa', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }), { ok: false, reason: 'no_send_number' })
  const m = resolveSendInstance(db, { accountId: s.account.id, kind: 'manual', conversationInstanceId: s.instance.id })
  assert.equal(m.ok, true); assert.equal(m.instance.id, s.instance.id)
})

test('manual sem numero da conversa', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'manual' }), { ok: false, reason: 'no_conversation_number' })
})

test('conta com um UzAPI so: ele e o padrao e faz o automatico', () => {
  const db = createTestDb(); const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  const r = resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' })
  assert.equal(r.ok, true); assert.equal(r.instance.id, s.instance.id)
})

test('Evolution + UzAPI: automatico sai pela UzAPI', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const uz = addInstance(db, s.account.id)
  assert.equal(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }).instance.id, uz.id)
})

test('padrao desconectado: send_number_offline (nao cai para outro nem para Evolution)', () => {
  const db = createTestDb(); const s = seedBasic(db)
  addInstance(db, s.account.id, { status: 'disconnected' })
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }), { ok: false, reason: 'send_number_offline' })
})

test('sem padrao escolhido: menor id de disparo; Tornar padrao troca', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const a = addInstance(db, s.account.id, { name: 'a' })
  const b = addInstance(db, s.account.id, { name: 'b' })
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, b.id), { ok: true })
  assert.equal(getDefaultSendInstance(db, s.account.id).id, b.id)
})

test('Tornar padrao recusa Evolution e numero de outra conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, s.instance.id), { ok: false, reason: 'not_send_role' })
  const other = db.prepare("INSERT INTO accounts (name, slug) VALUES ('B', 'b')").run().lastInsertRowid
  const alheio = addInstance(db, other)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, alheio.id), { ok: false, reason: 'not_found' })
})

test('padrao apagado ou de outra conta: cai para o proximo de disparo da propria conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const a = addInstance(db, s.account.id, { name: 'a' })
  const other = db.prepare("INSERT INTO accounts (name, slug) VALUES ('B', 'b')").run().lastInsertRowid
  const alheio = addInstance(db, other)
  db.prepare('UPDATE accounts SET default_send_instance_id = ? WHERE id = ?').run(alheio.id, s.account.id)
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
  db.prepare('UPDATE accounts SET default_send_instance_id = 9999 WHERE id = ?').run(s.account.id)
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
})

test('status para a tela', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(sendNumberStatus(db, s.account.id), { ok: false, reason: 'no_send_number', instance: null })
  const uz = addInstance(db, s.account.id, { status: 'disconnected', name: 'Disparos' })
  assert.deepEqual(sendNumberStatus(db, s.account.id), {
    ok: false, reason: 'send_number_offline',
    instance: { id: uz.id, instance_name: 'Disparos', provider: 'uzapi', status: 'disconnected' },
  })
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(uz.id)
  assert.equal(sendNumberStatus(db, s.account.id).ok, true)
  assert.equal(sendNumberStatus(db, s.account.id).reason, null)
})

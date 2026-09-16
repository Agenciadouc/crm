import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { resolveMediaInstance } from '../server/services/whatsapp/resolveInstance.js'
import { fetchAudioBuffer } from '../server/services/deepgramClient.js'

function addInstance(db, accountId, name, status = 'connected') {
  const id = db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status) VALUES (?, ?, 'http://evo', 'k', ?)").run(accountId, name, status).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('usa a instancia da mensagem antes da instancia do lead', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const outra = addInstance(db, account.id, 'outra')
  const r = resolveMediaInstance(db, { instance_id: outra.id }, { account_id: account.id, instance_id: instance.id })
  assert.equal(r.id, outra.id)
})

test('mensagem antiga sem instance_id cai na instancia do lead', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  addInstance(db, account.id, 'outra')
  assert.equal(resolveMediaInstance(db, { instance_id: null }, { account_id: account.id, instance_id: instance.id }).id, instance.id)
})

test('sem nenhuma, primeira conectada da conta; instancia de outra conta nunca e usada', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  db.prepare("INSERT INTO accounts (name, slug) VALUES ('Outra', 'outra')").run()
  const alheia = addInstance(db, 2, 'alheia')
  const r = resolveMediaInstance(db, { instance_id: alheia.id }, { account_id: account.id, instance_id: null })
  assert.equal(r.account_id, account.id)
  assert.equal(r.instance_name, 'inst-teste')
})

test('nada encontrado devolve null', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET status = 'disconnected'").run()
  assert.equal(resolveMediaInstance(db, { instance_id: null }, { account_id: account.id, instance_id: null }), null)
})

test('fetchAudioBuffer busca pela tomada e mantem mimetype default', async () => {
  const inst = { id: 1, provider: 'evolution', api_url: 'http://evo', api_key: 'k', instance_name: 'i' }
  const calls = []
  const getProvider = () => ({ fetchMedia: async (i, m) => { calls.push(m); return { buffer: Buffer.from('abc'), mimetype: null } } })
  const r = await fetchAudioBuffer(inst, 'AUD1', { getProvider })
  assert.deepEqual(calls, [{ wa_msg_id: 'AUD1' }])
  assert.equal(r.buffer.toString(), 'abc')
  assert.equal(r.mimetype, 'audio/ogg')
})

test('fetchAudioBuffer valida credenciais da Evolution e wa_msg_id', async () => {
  const getProvider = () => ({ fetchMedia: async () => ({ buffer: Buffer.from(''), mimetype: 'audio/ogg' }) })
  await assert.rejects(() => fetchAudioBuffer({ api_url: '', api_key: 'k', instance_name: 'i' }, 'X', { getProvider }), /instance_missing_credentials/)
  await assert.rejects(() => fetchAudioBuffer(null, 'X', { getProvider }), /instance_missing_credentials/)
  await assert.rejects(() => fetchAudioBuffer({ api_url: 'u', api_key: 'k', instance_name: 'i' }, '', { getProvider }), /wa_msg_id_required/)
})

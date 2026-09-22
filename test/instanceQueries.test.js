import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { insertUzapiInstance, UZAPI_TEST_ENV, quietLog } from './helpers/uzapiFixtures.js'
import * as Q from '../server/services/whatsapp/instanceQueries.js'
import { createUzapiStatusSync } from '../server/services/whatsapp/uzapiStatusSync.js'
import { createInstanceManager } from '../server/services/whatsapp/instanceManager.js'

const ids = (rows) => rows.map(r => r.id)

test('rotinas da Evolution (GhostDetect, checagem diaria, check-all, reregistro de webhook) ignoram numeros UzAPI', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id)
  assert.deepEqual(ids(Q.listGhostCandidates(db)), [instance.id])
  assert.deepEqual(ids(Q.listDailyCheckInstances(db)), [instance.id])
  assert.deepEqual(ids(Q.listAdminCheckAll(db)), [instance.id])
  assert.deepEqual(ids(Q.listWebhookReRegister(db)), [instance.id])
  assert.deepEqual(ids(Q.listUzapiInstances(db)), [uz.id])
  assert.equal(Q.listDailyCheckInstances(db)[0].account_name, 'Conta Teste')
})

test('cleanupStaleQRCodes: Evolution perde o QR apos 2 min; UzAPI so apos 5 min', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connecting' })
  db.prepare("UPDATE whatsapp_instances SET qr_code = 'QR', status = 'connecting', updated_at = datetime('now', '-3 minutes')").run()
  Q.cleanupStaleQRCodes(db)
  const qr = (id) => db.prepare('SELECT qr_code FROM whatsapp_instances WHERE id = ?').get(id).qr_code
  assert.equal(qr(instance.id), null)
  assert.equal(qr(uz.id), 'QR')
  db.prepare("UPDATE whatsapp_instances SET updated_at = datetime('now', '-6 minutes') WHERE id = ?").run(uz.id)
  Q.cleanupStaleQRCodes(db)
  assert.equal(qr(uz.id), null)
})

test('checagem de hora em hora: corrige status e telefone dos numeros UzAPI sem reiniciar nem pedir QR', async () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connecting' })
  const calls = []
  const adapter = {
    async status(i) { calls.push(['status', i.id]); return { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null } },
    async restart() { calls.push(['restart']); return { ok: true } },
    async getQr() { calls.push(['getQr']); return { ok: true } },
  }
  const getProvider = () => adapter
  const manager = createInstanceManager({ db, getProvider, env: UZAPI_TEST_ENV, log: quietLog })
  const sync = createUzapiStatusSync({ db, getProvider, manager, log: quietLog })
  assert.equal(await sync.run(), 1)
  assert.deepEqual(calls, [['status', uz.id]])
  const row = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(uz.id)
  assert.deepEqual([row.status, row.phone_number], ['connected', '554890000001'])
  assert.ok(row.connected_at)
  assert.equal(await sync.run(), 0, 'sem diferenca, nao mexe')
})

test('checagem de hora em hora: erro da UzAPI nao muda nada', async () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connected' })
  const adapter = { async status() { return { ok: false, status: null, reason: 'provider_error' } } }
  const manager = createInstanceManager({ db, getProvider: () => adapter, env: UZAPI_TEST_ENV, log: quietLog })
  const sync = createUzapiStatusSync({ db, getProvider: () => adapter, manager, log: quietLog })
  assert.equal(await sync.run(), 0)
  assert.equal(db.prepare('SELECT status FROM whatsapp_instances WHERE id = ?').get(uz.id).status, 'connected')
})

test('findInstanceByName: devolve id e provedor so da conta pedida', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const uz = insertUzapiInstance(db, seed.account.id, { instance_name: 'Loja UzAPI' })
  assert.deepEqual(Q.findInstanceByName(db, seed.account.id, 'Loja UzAPI'), { id: uz.id, provider: 'uzapi' })
  const evo = seed.instance
  assert.equal(Q.findInstanceByName(db, seed.account.id, evo.instance_name).provider, 'evolution')
  assert.equal(Q.findInstanceByName(db, seed.account.id + 999, 'Loja UzAPI'), undefined)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, TEST_TOKEN } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook } from '../server/services/whatsapp/webhookFlow.js'

test('token valido resolve instancia e conta', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const r = resolveInstanceByToken(db, TEST_TOKEN)
  assert.equal(r.instance.id, instance.id)
  assert.equal(r.account.id, account.id)
})

test('token com formato invalido ou inexistente devolve 401', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveInstanceByToken(db, 'abc'), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, 'b'.repeat(32)), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, undefined), { status: 401, error: 'Invalid webhook token' })
})

test('conta inativa devolve 404', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare('UPDATE accounts SET is_active = 0').run()
  assert.deepEqual(resolveInstanceByToken(db, TEST_TOKEN), { status: 404, error: 'Account not found' })
})

test('rota antiga: resolve pelo nome da instancia no corpo', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instanceName: 'inst-teste' }, {}).instance.id, instance.id)
})

test('rota antiga: sem fallback para a primeira instancia da conta', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'nao-existe' }, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', {}, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'outra-conta', { instance: 'inst-teste' }, {}), { status: 404, error: 'Account not found' })
})

test('rota antiga: webhook_secret e provedor', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = 's3cr3t'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Invalid webhook secret' })
  assert.ok(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, { 'x-webhook-secret': 's3cr3t' }).instance)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = NULL, provider = 'custom'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Unknown instance' })
})

function flowDeps() {
  const calls = { inbound: [], status: [] }
  const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede') } })
  return {
    calls,
    deps: {
      getProvider: () => adapter,
      handleInboundMessage: (account, instance, normalized, opts) => { calls.inbound.push({ normalized, opts }); return { ok: true } },
      handleStatusUpdate: (account, instance, statuses) => { calls.status.push(statuses); return statuses.length },
    },
  }
}

test('processWebhook: upsert chama o handler com source webhook e o req', () => {
  const { calls, deps } = flowDeps()
  const req = { body: P.textConversation, headers: { a: 1 }, ip: '1.2.3.4' }
  const r = processWebhook(deps, { id: 1 }, { id: 2 }, req)
  assert.deepEqual(r, { ok: true })
  assert.equal(calls.inbound.length, 1)
  assert.equal(calls.inbound[0].normalized.messageId, '3EB0A1B2C3D4E5F60001')
  assert.equal(calls.inbound[0].opts.source, 'webhook')
  assert.equal(calls.inbound[0].opts.req, req)
  assert.equal(calls.status.length, 0)
})

test('processWebhook: update chama so o status; grupo nao chama nada', () => {
  const a = flowDeps()
  assert.deepEqual(processWebhook(a.deps, { id: 1 }, { id: 2 }, { body: P.statusUpdateRead, headers: {} }), { ok: true })
  assert.equal(a.calls.status.length, 1)
  assert.equal(a.calls.inbound.length, 0)
  const b = flowDeps()
  assert.deepEqual(processWebhook(b.deps, { id: 1 }, { id: 2 }, { body: P.groupMessage, headers: {} }), { ok: true })
  assert.equal(b.calls.inbound.length + b.calls.status.length, 0)
})

test('processWebhook: devolve o resultado do handler (blocked/restricted)', () => {
  const { deps } = flowDeps()
  deps.handleInboundMessage = () => ({ ok: true, blocked: true })
  assert.deepEqual(processWebhook(deps, { id: 1 }, { id: 2 }, { body: P.textConversation, headers: {} }), { ok: true, blocked: true })
})

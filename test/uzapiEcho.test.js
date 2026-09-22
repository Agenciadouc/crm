import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createTestInboundHandler } from './helpers/inboundSetup.js'
import { insertUzapiInstance, loadUzapiFixture, LEAD_PHONE, quietLog } from './helpers/uzapiFixtures.js'
import { createEchoResolver } from '../server/services/whatsapp/uzapiEcho.js'
import { parseChatMessage } from '../server/services/whatsapp/uzapi.js'

const ECHO_ID = '2A286AC5064891EF4DE7'

function setup({ wait = async () => {}, fetchImpl } = {}) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, name: 'Lead', phone: LEAD_PHONE, wa_remote_jid: `${LEAD_PHONE}@s.whatsapp.net` })
  const { handler } = createTestInboundHandler(db)
  const fetched = []
  const provider = {
    async fetchMessageById(inst, id, { phone }) {
      fetched.push([id, phone])
      if (fetchImpl) return fetchImpl(id, phone)
      return parseChatMessage(loadUzapiFixture('chats-get-echo.synthetic.json'), { phone, messageId: id })
    },
  }
  const resolver = createEchoResolver({ db, getProvider: () => provider, handleInboundMessage: handler.handleInboundMessage, delayMs: 0, wait, log: quietLog })
  return { db, seed, instance, lead, resolver, fetched }
}

test('eco: resposta dada pelo celular vira mensagem ENVIADA no lead do telefone', async () => {
  const { db, seed, instance, lead, resolver, fetched } = setup()
  const n = await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  assert.equal(n, 1)
  assert.deepEqual(fetched, [[ECHO_ID, LEAD_PHONE]])
  const msgs = db.prepare('SELECT * FROM messages').all()
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].lead_id, lead.id)
  assert.equal(msgs[0].direction, 'outbound')
  assert.equal(msgs[0].content, 'Resposta pelo celular')
  assert.equal(msgs[0].wa_msg_id, ECHO_ID)
  assert.equal(msgs[0].instance_id, instance.id)
})

test('eco: o mesmo id de novo (delivered e depois read) nao duplica nem busca de novo', async () => {
  const { db, seed, instance, resolver, fetched } = setup()
  await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  const n = await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  assert.equal(n, 0)
  assert.equal(fetched.length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1)
})

test('eco: status de mensagem que o proprio CRM enviou (ja gravada) nao e buscado', async () => {
  const { db, seed, instance, lead, resolver, fetched } = setup()
  db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id) VALUES (?, ?, 'outbound', 'via API', '3EB03F3FB62BE08FFAA771')").run(lead.id, seed.account.id)
  assert.equal(await resolver.resolveEchoes(seed.account, instance, [{ messageId: '3EB03F3FB62BE08FFAA771', phone: LEAD_PHONE }]), 0)
  assert.deepEqual(fetched, [])
})

test('eco: dois avisos do mesmo id ao mesmo tempo buscam uma vez so', async () => {
  let open
  const gate = new Promise(r => { open = r })
  const { seed, instance, resolver, fetched } = setup({ wait: () => gate })
  const p1 = resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  const p2 = resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  open()
  const [a, b] = await Promise.all([p1, p2])
  assert.equal(a + b, 1)
  assert.equal(fetched.length, 1)
})

test('eco: busca sem resultado ou com erro nao grava nada e nao lanca', async () => {
  const vazio = setup({ fetchImpl: () => null })
  assert.equal(await vazio.resolver.resolveEchoes(vazio.seed.account, vazio.instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }]), 0)
  const erro = setup({ fetchImpl: () => { throw new Error('boom') } })
  assert.equal(await erro.resolver.resolveEchoes(erro.seed.account, erro.instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }]), 0)
  assert.equal(erro.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
})

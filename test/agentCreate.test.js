import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createAgentRecord } from '../server/services/agentCreate.js'

const BODY = {
  name: 'Ana Clara',
  persona: 'Cordial.',
  knowledge_base: 'Vende curso.',
  never_mention: 'preco',
  qualification_criteria: 'nome e cidade',
  required_fields: ['name', 'city'],
  mode: 'copilot',
}

test('cria o agente e o usuario-bot da conta', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const r = createAgentRecord(db, { accountId, body: BODY })
  assert.equal(r.ok, true)
  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.account_id, accountId)
  assert.equal(a.name, 'Ana Clara')
  assert.equal(a.mode, 'copilot')
  assert.equal(a.persona, 'Cordial.')
  assert.equal(JSON.parse(a.required_fields).length, 2)
  const bot = db.prepare('SELECT * FROM users WHERE id = ?').get(a.user_id)
  assert.equal(bot.is_bot, 1)
  assert.equal(bot.account_id, accountId)
  // Colunas NOT NULL no banco real (o helper de teste nao restringe, mas o
  // caminho de codigo nunca pode gravar NULL nelas)
  assert.notEqual(a.is_active, null)
  assert.notEqual(a.identifies_as_bot, null)
  assert.notEqual(a.responds_to_audio, null)
  assert.notEqual(a.max_messages_before_handoff, null)
  assert.notEqual(a.monthly_token_limit, null)
  assert.notEqual(a.tokens_used_this_month, null)
  assert.notEqual(bot.is_bot, null)
})

test('recusa nome vazio e mode invalido sem criar nada', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const antesAgentes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const antesUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c

  assert.equal(createAgentRecord(db, { accountId, body: { ...BODY, name: '  ' } }).ok, false)
  assert.equal(createAgentRecord(db, { accountId, body: { ...BODY, mode: 'sei_la' } }).ok, false)

  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antesAgentes)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, antesUsers, 'nao pode deixar usuario-bot orfao')
})

test('mode ausente cai no padrao auto', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const r = createAgentRecord(db, { accountId, body: { name: 'Sem modo' } })
  assert.equal(r.ok, true)
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(r.agentId).mode, 'auto')
})

test('falha dentro da transacao (depois do INSERT do usuario-bot) nao deixa usuario nem agente orfao', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const antesAgentes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const antesUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c

  // required_fields circular: passa o Array.isArray (entra na transacao, apos o
  // INSERT do usuario-bot) mas o JSON.stringify no INSERT do agente lanca
  // TypeError. createAgentRecord nao captura essa excecao - ela sobe para o
  // chamador (a rota trata isso com try/catch e devolve 500).
  const circular = []
  circular.push(circular)

  assert.throws(
    () => createAgentRecord(db, { accountId, body: { name: 'Vai falhar', required_fields: circular } }),
    /circular structure/
  )

  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antesAgentes, 'nao pode sobrar agente orfao')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, antesUsers, 'nao pode sobrar usuario-bot orfao')
})

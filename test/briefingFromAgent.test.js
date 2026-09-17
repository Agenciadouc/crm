import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { getBriefing, createBriefing } from '../server/services/briefingStore.js'
import { briefingFromAgent } from '../server/services/briefingFromAgent.js'

function comAgenteConfigurado() {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  db.prepare(`
    UPDATE ai_agents
       SET persona = 'Formal e tecnica.',
           knowledge_base = 'Vende produto quimico industrial.',
           never_mention = 'prazo de entrega',
           qualification_criteria = 'Qualificado com CNPJ e volume',
           required_fields = ?
     WHERE id = ?
  `).run(JSON.stringify(['name', 'empresa']), seed.agentId)
  return { db, ...seed }
}

test('cria briefing compilado e amarrado ao agente que ja existe', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(r.ok, true)

  const b = getBriefing(db, accountId, r.briefingId)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, agentId)

  const c = JSON.parse(b.compiled_json)
  assert.equal(c.persona, 'Formal e tecnica.')
  assert.equal(c.knowledge_base, 'Vende produto quimico industrial.')
  assert.deepEqual(c.required_fields, ['name', 'empresa'])
})

test('guarda os campos atuais como fonte de entrevista', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  const sources = getBriefing(db, accountId, r.briefingId).sources
  assert.equal(sources.length, 1)
  assert.equal(sources[0].kind, 'entrevista')
  assert.match(sources[0].content, /produto quimico industrial/)
})

test('NAO cria agente novo nem mexe no agente existente', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const antes = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId)
  const total = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, total)
  assert.deepEqual(db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId), antes)
})

test('agente com campos vazios ainda vira briefing utilizavel', () => {
  const db = createTestDb()
  const { accountId, userId, agentId } = seedAccountAndLead(db)
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(r.ok, true)
  const c = JSON.parse(getBriefing(db, accountId, r.briefingId).compiled_json)
  assert.ok(c.name, 'o nome do agente sempre existe')
  assert.deepEqual(c.required_fields, [])
})

test('agente de outra conta nao vira briefing', () => {
  const { db, userId, agentId } = comAgenteConfigurado()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const r = briefingFromAgent(db, { accountId: outra, agentId, userId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'agente_nao_encontrado')
})

test('agente que ja tem briefing devolve o mesmo, sem duplicar', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const primeiro = briefingFromAgent(db, { accountId, agentId, userId })
  const segundo = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(segundo.ok, true)
  assert.equal(segundo.briefingId, primeiro.briefingId)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefings').get().c, 1)
})

test('colisao do indice unico do agent_id devolve erro em vez de lancar', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  // Caminho honesto para forcar a colisao sem mock: um briefing de OUTRA conta
  // ja fica amarrado a este agent_id (agent_id tem indice unico na tabela toda,
  // independente de conta). Usa UPDATE direto em SQL para montar esse estado
  // invalido de proposito: linkAgent ja nao aceita mais amarrar um agente de
  // uma conta a um briefing de outra, que era o caminho antigo usado aqui -
  // e essa e exatamente a brecha que a validacao de posse do agente fechou.
  // A checagem de idempotencia filtra por account_id, entao nao acha essa
  // linha e a funcao segue ate o linkAgent de dentro da propria transacao,
  // que colide com o indice unico e lanca.
  const outraConta = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const outroBriefingId = createBriefing(db, { accountId: outraConta, userId })
  db.prepare('UPDATE agent_briefings SET agent_id = ? WHERE id = ?').run(agentId, outroBriefingId)

  const r = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(r.ok, false)
  assert.match(r.error, /UNIQUE constraint failed/)
})

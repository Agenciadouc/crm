import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  createBriefing, addTurn, addSource, getBriefing,
  listDrafts, setCompiled, linkAgent, deleteBriefing,
} from '../server/services/briefingStore.js'

function setup() {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  return { db, ...seed }
}

test('createBriefing devolve um rascunho sem agente', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'entrevistando')
  assert.equal(b.agent_id, null)
  assert.deepEqual(b.turns, [])
  assert.deepEqual(b.sources, [])
})

test('addTurn numera a posicao sozinho e getBriefing devolve na ordem', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'ia', content: 'O que voce vende?' }), 1)
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'user', content: 'imoveis' }), 2)
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'ia', content: 'Compra ou aluguel?' }), 3)
  const turns = getBriefing(db, accountId, id).turns
  assert.deepEqual(turns.map(t => t.position), [1, 2, 3])
  assert.deepEqual(turns.map(t => t.role), ['ia', 'user', 'ia'])
  assert.equal(turns[2].content, 'Compra ou aluguel?')
})

test('addSource guarda fonte que deu certo e fonte que falhou', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  addSource(db, { accountId, briefingId: id, kind: 'colado', content: 'tabela de precos' })
  addSource(db, { accountId, briefingId: id, kind: 'site', ref: 'https://x.com', status: 'falhou', error: 'timeout' })
  const sources = getBriefing(db, accountId, id).sources
  assert.equal(sources.length, 2)
  assert.equal(sources[0].status, 'ok')
  assert.equal(sources[1].status, 'falhou')
  assert.equal(sources[1].error, 'timeout')
  assert.equal(sources[1].ref, 'https://x.com')
})

test('getBriefing nao devolve briefing de outra conta', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(getBriefing(db, outra, id), null)
})

test('listDrafts traz so o que nao esta ativo, com a primeira resposta como rotulo', () => {
  const { db, accountId, userId, agentId } = setup()
  const rascunho = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId: rascunho, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId: rascunho, role: 'user', content: 'curso de ingles' })

  const ativo = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId: ativo, compiled: { name: 'X' } })
  linkAgent(db, { accountId, briefingId: ativo, agentId })

  const drafts = listDrafts(db, accountId)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].id, rascunho)
  assert.equal(drafts[0].first_answer, 'curso de ingles')
})

test('setCompiled guarda o json e muda o status, sem criar agente', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  assert.equal(setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Ana', persona: 'direta' } }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'compilado')
  assert.equal(b.agent_id, null)
  assert.equal(JSON.parse(b.compiled_json).persona, 'direta')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes, 'compilar NAO pode criar agente')
})

test('setCompiled de outra conta nao faz nada', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(setCompiled(db, { accountId: outra, briefingId: id, compiled: { name: 'X' } }), false)
  assert.equal(getBriefing(db, accountId, id).status, 'entrevistando')
})

test('recompilar briefing ja ativo atualiza o json mas NAO volta para compilado', () => {
  const { db, accountId, userId, agentId } = setup()
  const id = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Antes' } })
  linkAgent(db, { accountId, briefingId: id, agentId })

  assert.equal(setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Depois' } }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'ativo', 'sair de ativo faria a ativacao criar um SEGUNDO agente')
  assert.equal(b.agent_id, agentId)
  assert.equal(JSON.parse(b.compiled_json).name, 'Depois')
})

test('linkAgent amarra o agente e marca ativo', () => {
  const { db, accountId, userId, agentId } = setup()
  const id = createBriefing(db, { accountId, userId })
  assert.equal(linkAgent(db, { accountId, briefingId: id, agentId }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, agentId)
})

test('addTurn de outra conta devolve null e nao cria turno', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(addTurn(db, { accountId: outra, briefingId: id, role: 'user', content: 'invasao' }), null)
  assert.deepEqual(getBriefing(db, accountId, id).turns, [])
})

test('addSource de outra conta devolve null e nao cria fonte', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(addSource(db, { accountId: outra, briefingId: id, kind: 'colado', content: 'invasao' }), null)
  assert.deepEqual(getBriefing(db, accountId, id).sources, [])
})

test('deleteBriefing apaga e nao apaga o de outra conta', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(deleteBriefing(db, outra, id), false)
  assert.equal(deleteBriefing(db, accountId, id), true)
  assert.equal(getBriefing(db, accountId, id), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  createBriefing, addTurn, addSource, getBriefing,
  listDrafts, setCompiled, linkAgent, deleteBriefing, addTokens,
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

test('linkAgent com agente de outra conta devolve false e nao muda o briefing', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const agenteDaOutra = Number(db.prepare('INSERT INTO ai_agents (account_id, name) VALUES (?, ?)').run(outra, 'Agente da Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(linkAgent(db, { accountId, briefingId: id, agentId: agenteDaOutra }), false)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'entrevistando')
  assert.equal(b.agent_id, null)
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

// ---- compiled_at: o compilado so vale enquanto nada mudou depois dele -------
// Defeito que estes testes cobrem: addTurn mexia so no updated_at, nada
// invalidava o compiled_json, e a tela de resumo reaproveitava o compilado
// velho. A pessoa corrigia "preco a IA pode falar sim", via o resumo ANTIGO e
// ativava um agente sem a correcao — em silencio.

const COMPILADO = {
  name: 'Ana', persona: 'Cordial.', knowledge_base: 'Curso.', never_mention: 'preco',
  qualification_criteria: 'nome', required_fields: ['name'],
  resumo: { quem_sou: 'a', o_que_sei: 'b', o_que_descubro: ['c'], o_que_nunca_falo: ['d'] },
}

test('setCompiled carimba compiled_at e o briefing deixa de precisar recompilar', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 1, 'sem compilado, precisa compilar')

  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  const b = getBriefing(db, accountId, briefingId)
  assert.ok(b.compiled_at, 'compiled_at tem que ser preenchido')
  assert.equal(b.precisa_recompilar, 0)
})

test('turno novo depois do compile obriga a recompilar', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 0)

  addTurn(db, { accountId, briefingId, role: 'user', content: 'nao, preco a IA pode falar sim' })

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.compiled_at, null, 'a correcao tem que invalidar o compilado')
  assert.equal(b.precisa_recompilar, 1)
  assert.ok(b.compiled_json, 'o texto antigo continua guardado, so deixa de valer')
})

test('material colado depois do compile tambem obriga a recompilar', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'tabela de precos nova' })
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 1)
})

test('recompilar depois da correcao volta a valer o compilado', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'corrige isso' })
  setCompiled(db, { accountId, briefingId, compiled: { ...COMPILADO, never_mention: 'nada' } })

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.precisa_recompilar, 0)
  assert.equal(JSON.parse(b.compiled_json).never_mention, 'nada')
})

test('updated_at mais novo que compiled_at tambem pede recompilacao', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  // Segunda linha de defesa: escrita direta no banco, sem passar por addTurn.
  db.prepare("UPDATE agent_briefings SET updated_at = '2099-01-01 00:00:00' WHERE id = ?").run(briefingId)
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 1)
})

// ---- tokens_used: teto do briefing --------------------------------------
test('addTokens acumula por briefing, respeita a conta e nao invalida o compilado', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })

  assert.equal(addTokens(db, { accountId, briefingId, tokens: 1200 }), 1200)
  assert.equal(addTokens(db, { accountId, briefingId, tokens: 800 }), 2000)
  assert.equal(addTokens(db, { accountId, briefingId, tokens: 0 }), 2000)

  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  assert.equal(addTokens(db, { accountId: outra, briefingId, tokens: 5000 }), 0, 'outra conta nao soma nem le')
  assert.equal(getBriefing(db, accountId, briefingId).tokens_used, 2000)
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 0, 'gastar token nao e mudanca de conteudo')
})

// linkAgent nao e mudanca de conteudo: se mexesse em updated_at, todo briefing
// ativado passaria a dizer precisa_recompilar = 1 e reabrir o resumo pagaria
// uma compilacao nova. Os carimbos vao para o passado para o teste nao
// depender de cair no mesmo segundo.
test('linkAgent nao marca o briefing como desatualizado', () => {
  const { db, accountId, userId, agentId } = setup()
  const briefingId = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId, compiled: { name: 'X' } })
  db.prepare("UPDATE agent_briefings SET updated_at = '2020-01-01 00:00:00', compiled_at = '2020-01-01 00:00:00' WHERE id = ?").run(briefingId)
  assert.equal(linkAgent(db, { accountId, briefingId, agentId }), true)
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 0)

  addTurn(db, { accountId, briefingId, role: 'user', content: 'correcao' })
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 1, 'turno novo depois de compilar continua invalidando')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, addTurn } from '../server/services/briefingStore.js'
import {
  TEMAS, MAX_PERGUNTAS, MAX_TOKENS_BRIEFING, SYSTEM_PROMPT,
  shouldFinish, nextQuestion, answer,
} from '../server/services/agentInterview.js'

function fakeAi(reply = 'O que sua empresa vende?', tokens = 0) {
  const calls = []
  return {
    calls,
    ask: async (params) => { calls.push(params); return { content: reply, usage: { total: 10 }, costUsd: 0 } },
    tokensUsed: () => tokens,
  }
}

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  return { db, accountId, briefingId }
}

test('os 6 temas do spec existem e nenhum cita ramo de negocio', () => {
  assert.equal(TEMAS.length, 6)
  const texto = JSON.stringify(TEMAS).toLowerCase()
  for (const ramo of ['imovel', 'imobiliaria', 'clinica', 'curso', 'advogado', 'loja']) {
    assert.ok(!texto.includes(ramo), `o tema nao pode citar o ramo "${ramo}"`)
  }
})

test('o SYSTEM_PROMPT tambem nao cita ramo de negocio', () => {
  const texto = SYSTEM_PROMPT.toLowerCase()
  for (const ramo of ['imovel', 'imobiliaria', 'clinica', 'curso', 'advogado', 'loja']) {
    assert.ok(!texto.includes(ramo), `o prompt nao pode citar o ramo "${ramo}"`)
  }
})

test('tetos sao os do spec', () => {
  assert.equal(MAX_PERGUNTAS, 20)
  assert.equal(MAX_TOKENS_BRIEFING, 60000)
})

test('primeira pergunta e gravada como turno da ia', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('O que sua empresa vende?')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.done, false)
  assert.equal(r.question, 'O que sua empresa vende?')
  const turns = getBriefing(db, accountId, briefingId).turns
  assert.equal(turns.length, 1)
  assert.equal(turns[0].role, 'ia')
})

test('answer grava a resposta da pessoa', () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  assert.equal(answer(db, { accountId, briefingId, text: 'software de gestao' }).ok, true)
  const turns = getBriefing(db, accountId, briefingId).turns
  assert.equal(turns[1].role, 'user')
  assert.equal(turns[1].content, 'software de gestao')
})

test('answer recusa texto vazio e briefing de outra conta', () => {
  const { db, accountId, briefingId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  assert.equal(answer(db, { accountId, briefingId, text: '  ' }).ok, false)
  assert.equal(answer(db, { accountId: outra, briefingId, text: 'oi' }).ok, false)
  assert.equal(getBriefing(db, accountId, briefingId).turns.length, 0)
})

test('shouldFinish corta no teto de perguntas', () => {
  const { db, accountId, briefingId } = setup()
  for (let i = 0; i < MAX_PERGUNTAS; i++) addTurn(db, { accountId, briefingId, role: 'ia', content: `p${i}` })
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', 0)), { finish: true, reason: 'perguntas' })
})

test('shouldFinish corta no teto de tokens', () => {
  const { db, accountId, briefingId } = setup()
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', MAX_TOKENS_BRIEFING)), { finish: true, reason: 'tokens' })
})

test('shouldFinish deixa seguir quando esta dentro dos dois tetos', () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'p1' })
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', 100)), { finish: false, reason: null })
})

test('no teto, nextQuestion encerra sem gastar IA', async () => {
  const { db, accountId, briefingId } = setup()
  for (let i = 0; i < MAX_PERGUNTAS; i++) addTurn(db, { accountId, briefingId, role: 'ia', content: `p${i}` })
  const ai = fakeAi()
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.done, true)
  assert.equal(r.reason, 'perguntas')
  assert.equal(ai.calls.length, 0, 'nao pode chamar a IA depois de bater o teto')
})

test('a IA recebe os temas e a conversa ate agora', async () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'consultoria contabil' })
  const ai = fakeAi('Quem e o seu cliente ideal?')
  await nextQuestion(db, { accountId, briefingId, ai })
  const call = ai.calls[0]
  assert.match(call.systemPrompt, /TEMAS/i)
  assert.match(JSON.stringify(call.messages), /consultoria contabil/)
  assert.equal(call.source, 'entrevista')
})

test('IA devolvendo vazio vira erro nomeado e nao grava turno', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('   ')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'pergunta_vazia')
  assert.equal(getBriefing(db, accountId, briefingId).turns.length, 0)
})

test('falha da IA vira erro nomeado, nao excecao', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = { calls: [], ask: async () => { throw new Error('dros_key_missing') }, tokensUsed: () => 0 }
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'dros_key_missing')
})

test('sentinela PRONTO com pontuacao ou espacos encerra e nao grava turno', async () => {
  for (const variacao of ['PRONTO', 'pronto', '  PRONTO  ', 'Pronto!', 'PRONTO.']) {
    const { db, accountId, briefingId } = setup()
    const ai = fakeAi(variacao)
    const r = await nextQuestion(db, { accountId, briefingId, ai })
    assert.equal(r.ok, true, `variacao "${variacao}" deveria ser ok`)
    assert.equal(r.done, true, `variacao "${variacao}" deveria encerrar`)
    assert.equal(r.reason, 'temas_cobertos')
    assert.equal(getBriefing(db, accountId, briefingId).turns.length, 0, `variacao "${variacao}" nao pode gravar turno`)
  }
})

test('frase que so menciona PRONTO dentro de outra frase nao encerra, vira pergunta', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('Tudo PRONTO')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.done, false)
  assert.equal(r.question, 'Tudo PRONTO')
  const turns = getBriefing(db, accountId, briefingId).turns
  assert.equal(turns.length, 1)
  assert.equal(turns[0].role, 'ia')
  assert.equal(turns[0].content, 'Tudo PRONTO')
})

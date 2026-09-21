import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, addTurn } from '../server/services/briefingStore.js'
import { addTokens } from '../server/services/briefingStore.js'
import { createDrosAi } from '../server/services/drosAi.js'
import {
  TEMAS, MAX_PERGUNTAS, MAX_TOKENS_BRIEFING, MAX_TOKENS_ENTREVISTA, RESERVA_COMPILACAO, SYSTEM_PROMPT,
  shouldFinish, nextQuestion, answer,
} from '../server/services/agentInterview.js'

function fakeAi(reply = 'O que sua empresa vende?') {
  const calls = []
  return {
    calls,
    ask: async (params) => { calls.push(params); return { content: reply, usage: { total: 10 }, costUsd: 0 } },
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
  assert.equal(MAX_TOKENS_ENTREVISTA, MAX_TOKENS_BRIEFING - RESERVA_COMPILACAO,
    'a entrevista para antes do teto total para sobrar orcamento para compilar')
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
  assert.deepEqual(shouldFinish(b), { finish: true, reason: 'perguntas' })
})

test('shouldFinish corta no teto de tokens ACUMULADO no briefing', () => {
  const { db, accountId, briefingId } = setup()
  addTokens(db, { accountId, briefingId, tokens: MAX_TOKENS_ENTREVISTA })
  assert.deepEqual(shouldFinish(getBriefing(db, accountId, briefingId)), { finish: true, reason: 'tokens' })
})

test('shouldFinish deixa seguir quando esta dentro dos dois tetos', () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'p1' })
  addTokens(db, { accountId, briefingId, tokens: 100 })
  assert.deepEqual(shouldFinish(getBriefing(db, accountId, briefingId)), { finish: false, reason: null })
})

// O defeito que este teste cobre: o contador vivia no cliente de IA, que o
// agentBriefings.js cria NOVO a cada requisicao HTTP. Resultado: tokensUsed()
// valia sempre 0 na hora da checagem e o teto de 60.000 nunca disparava. Aqui
// cada chamada usa um cliente NOVO, como em producao, e o acumulado ainda sobe.
test('o gasto de IA acumula no briefing entre chamadas separadas e faz o teto disparar', async () => {
  const { db, accountId, briefingId } = setup()
  const porChamada = Math.ceil(MAX_TOKENS_ENTREVISTA / 3)
  const callAi = async () => ({ content: 'oi', usage: { input: 1, output: 1, total: porChamada }, costUsd: 0 })

  for (let i = 0; i < 3; i++) {
    const ai = createDrosAi(db, { accountId, briefingId, callAi, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })
    assert.equal(ai.tokensUsed(), 0, 'cliente novo comeca zerado: e por isso que o contador em memoria nao servia')
    await ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' })
  }

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.tokens_used, porChamada * 3)
  assert.deepEqual(shouldFinish(b), { finish: true, reason: 'tokens' })
})

test('batendo o teto de tokens, nextQuestion encerra sem gastar IA', async () => {
  const { db, accountId, briefingId } = setup()
  addTokens(db, { accountId, briefingId, tokens: MAX_TOKENS_ENTREVISTA })
  const ai = fakeAi()
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.done, true)
  assert.equal(r.reason, 'tokens')
  assert.equal(ai.calls.length, 0)
})

// Duas rotas chamam nextQuestion (/answer e /next-question, esta com o botao
// "Tentar de novo" na mao da pessoa). Sem a guarda, dois cliques seguidos
// empilhavam perguntas da IA e queimavam o teto de perguntas a toa.
test('com pergunta ja no ar, nextQuestion devolve a mesma sem chamar a IA', async () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  const ai = fakeAi('Outra pergunta qualquer')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.done, false)
  assert.equal(r.question, 'O que voce vende?')
  assert.equal(ai.calls.length, 0, 'nao pode gastar IA para repetir a pergunta que ja esta na tela')
  assert.equal(getBriefing(db, accountId, briefingId).turns.length, 1, 'nao pode empilhar turno da ia')
})

test('depois da resposta, nextQuestion volta a chamar a IA', async () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  answer(db, { accountId, briefingId, text: 'consultoria' })
  const ai = fakeAi('Quem e o seu cliente ideal?')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.question, 'Quem e o seu cliente ideal?')
  assert.equal(ai.calls.length, 1)
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

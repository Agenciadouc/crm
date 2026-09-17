import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, addTurn, addSource } from '../server/services/briefingStore.js'
import { compileBriefing, validateCompiled, REQUIRED_FIELD_KEYS } from '../server/services/agentCompiler.js'

const VALIDO = {
  name: 'Ana Clara',
  persona: 'Cordial e objetiva.',
  knowledge_base: 'Vende curso de ingles online.',
  never_mention: 'preco',
  qualification_criteria: 'Qualificado quando souber nome e cidade',
  required_fields: ['name', 'city'],
  resumo: {
    quem_sou: 'Consultora do curso.',
    o_que_sei: 'Curso de ingles online.',
    o_que_descubro: ['Nivel do aluno'],
    o_que_nunca_falo: ['Preco'],
  },
}

// Fake do drosAi: devolve as respostas na ordem em que foram programadas.
function fakeAi(...replies) {
  const calls = []
  let i = 0
  return {
    calls,
    ask: async (params) => {
      calls.push(params)
      const r = replies[Math.min(i, replies.length - 1)]
      i++
      return { content: typeof r === 'string' ? r : JSON.stringify(r), usage: { total: 10 }, costUsd: 0 }
    },
  }
}

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles online' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'ementa do curso' })
  return { db, accountId, briefingId }
}

test('REQUIRED_FIELD_KEYS bate com as opcoes do formulario', () => {
  assert.deepEqual(REQUIRED_FIELD_KEYS, ['name', 'email', 'phone', 'city', 'empresa', 'instagram'])
})

test('validateCompiled aceita a forma do spec', () => {
  const r = validateCompiled(VALIDO)
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'Ana Clara')
})

test('validateCompiled recusa campo faltando, tipo errado e required_field invalido', () => {
  assert.equal(validateCompiled({ ...VALIDO, name: '' }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, persona: 123 }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, required_fields: ['cpf'] }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, resumo: undefined }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, resumo: { ...VALIDO.resumo, o_que_descubro: 'texto' } }).ok, false)
  assert.equal(validateCompiled(null).ok, false)
  assert.equal(validateCompiled('nao sou objeto').ok, false)
})

test('compila o briefing e manda transcricao e fontes para a IA', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.compiled.name, 'Ana Clara')
  const prompt = JSON.stringify(ai.calls[0].messages)
  assert.match(prompt, /curso de ingles online/, 'a resposta da pessoa tem que ir no prompt')
  assert.match(prompt, /ementa do curso/, 'a fonte colada tem que ir no prompt')
  assert.equal(ai.calls[0].source, 'compilacao')
})

test('saida com cerca de markdown ainda e aceita', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('```json\n' + JSON.stringify(VALIDO) + '\n```')
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.compiled.persona, 'Cordial e objetiva.')
})

test('saida invalida tenta uma vez de novo e aceita a segunda', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('isso nao e json', VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(ai.calls.length, 2)
})

test('duas saidas invalidas devolvem erro e nao inventam agente', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('lixo', 'mais lixo')
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'saida_invalida')
  assert.equal(ai.calls.length, 2, 'tenta no maximo duas vezes')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, 1, 'so o agente semeado')
})

test('briefing de outra conta nao compila', async () => {
  const { db, briefingId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId: outra, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_encontrado')
  assert.equal(ai.calls.length, 0)
})

test('falha da IA vira erro nomeado, nao excecao', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = { calls: [], ask: async () => { throw new Error('dros_key_missing') } }
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'dros_key_missing')
})

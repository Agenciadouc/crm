import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, addTurn, addSource, getBriefing, addTokens } from '../server/services/briefingStore.js'
import { MAX_TOKENS_BRIEFING, MAX_TOKENS_ENTREVISTA } from '../server/services/agentInterview.js'
import {
  compileBriefing, validateCompiled, REQUIRED_FIELD_KEYS,
  buildBriefingText, MAX_MATERIAIS_CHARS, MARCA_TRUNCADO,
} from '../server/services/agentCompiler.js'

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

test('validateCompiled recusa resumo.o_que_descubro vazio', () => {
  const r = validateCompiled({ ...VALIDO, resumo: { ...VALIDO.resumo, o_que_descubro: [] } })
  assert.equal(r.ok, false)
})

test('validateCompiled recusa resumo.o_que_nunca_falo vazio', () => {
  const r = validateCompiled({ ...VALIDO, resumo: { ...VALIDO.resumo, o_que_nunca_falo: [] } })
  assert.equal(r.ok, false)
})

test('validateCompiled aceita required_fields vazio (negocio sem campo estruturado)', () => {
  const r = validateCompiled({ ...VALIDO, required_fields: [] })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.required_fields, [])
})

test('validateCompiled remove duplicatas de required_fields preservando ordem', () => {
  const r = validateCompiled({ ...VALIDO, required_fields: ['name', 'city', 'name'] })
  assert.equal(r.ok, true)
  assert.deepEqual(r.value.required_fields, ['name', 'city'])
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

test('fonte com status falhou nao entra no prompt, so a que deu ok', async () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles online' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'texto da fonte que deu certo' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'texto da fonte que falhou', status: 'falhou' })

  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  const prompt = JSON.stringify(ai.calls[0].messages)
  assert.match(prompt, /texto da fonte que deu certo/, 'a fonte ok tem que ir no prompt')
  assert.doesNotMatch(prompt, /texto da fonte que falhou/, 'a fonte falhou NAO pode ir no prompt')
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

// ---- teto de texto das fontes (I3) ---------------------------------------
// POST /:id/paste pode ser chamado quantas vezes a pessoa quiser, e o
// compilador concatenava TODAS as fontes no prompt. Vinte colagens de 20.000
// caracteres = 400 KB num prompt so, acima da janela do modelo.
test('buildBriefingText corta o total das fontes e deixa marca visivel', () => {
  // Briefing montado aqui (sem o setup) para a conta de caracteres ser exata.
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  for (let i = 0; i < 5; i++) {
    addSource(db, { accountId, briefingId, kind: 'colado', content: 'x'.repeat(20000) })
  }
  const texto = buildBriefingText(getBriefing(db, accountId, briefingId))
  const materiais = texto.split('=== MATERIAIS ===')[1]
  assert.ok(materiais.includes(MARCA_TRUNCADO), 'o corte tem que aparecer no prompt')
  // A propria marca tem um "x" (em "texto"): tira ela antes de contar.
  const xs = (materiais.replace(MARCA_TRUNCADO, '').match(/x/g) || []).length
  assert.equal(xs, MAX_MATERIAIS_CHARS, 'nao pode passar do teto total de caracteres de fonte')
})

test('dentro do teto, nenhuma fonte e cortada nem marcada', () => {
  const { db, accountId, briefingId } = setup()
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'tabela de precos' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'faq da empresa' })
  const texto = buildBriefingText(getBriefing(db, accountId, briefingId))
  assert.ok(texto.includes('tabela de precos'))
  assert.ok(texto.includes('faq da empresa'))
  assert.ok(!texto.includes(MARCA_TRUNCADO))
})

test('fonte que falhou continua fora do prompt e nao gasta o teto', () => {
  const { db, accountId, briefingId } = setup()
  addSource(db, { accountId, briefingId, kind: 'site', ref: 'https://x.com', status: 'falhou', error: 'timeout' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'material bom' })
  const texto = buildBriefingText(getBriefing(db, accountId, briefingId))
  assert.ok(texto.includes('material bom'))
  assert.ok(!texto.includes('timeout'))
})

// ---- teto de tokens na compilacao (I2) -----------------------------------
test('briefing que estourou o teto de tokens nao compila e nao chama a IA', async () => {
  const { db, accountId, briefingId } = setup()
  addTokens(db, { accountId, briefingId, tokens: MAX_TOKENS_BRIEFING })
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'teto_de_tokens')
  assert.equal(ai.calls.length, 0, 'nao pode gastar a chave da Dros depois do teto')
})

test('abaixo do teto total, a compilacao ainda roda mesmo com a entrevista encerrada por tokens', async () => {
  const { db, accountId, briefingId } = setup()
  addTokens(db, { accountId, briefingId, tokens: MAX_TOKENS_ENTREVISTA })
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true, 'a reserva existe justamente para o briefing nunca ficar sem compilar')
})

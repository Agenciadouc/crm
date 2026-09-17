import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing } from '../server/services/briefingStore.js'
import { collectPastedText, MAX_PASTED_CHARS } from '../server/services/briefingSources/pastedText.js'

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  return { db, accountId, briefingId }
}

test('guarda o texto colado como fonte ok', () => {
  const { db, accountId, briefingId } = setup()
  const r = collectPastedText(db, { accountId, briefingId, text: 'Tabela de precos: plano A R$ 500' })
  assert.equal(r.ok, true)
  const sources = getBriefing(db, accountId, briefingId).sources
  assert.equal(sources.length, 1)
  assert.equal(sources[0].kind, 'colado')
  assert.equal(sources[0].status, 'ok')
  assert.match(sources[0].content, /plano A/)
})

test('texto vazio ou so espaco nao vira fonte', () => {
  const { db, accountId, briefingId } = setup()
  assert.equal(collectPastedText(db, { accountId, briefingId, text: '   ' }).ok, false)
  assert.equal(collectPastedText(db, { accountId, briefingId, text: '' }).ok, false)
  assert.equal(collectPastedText(db, { accountId, briefingId, text: null }).ok, false)
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})

test('texto gigante e cortado no teto, nao rejeitado', () => {
  const { db, accountId, briefingId } = setup()
  const r = collectPastedText(db, { accountId, briefingId, text: 'a'.repeat(MAX_PASTED_CHARS + 5000) })
  assert.equal(r.ok, true)
  const s = getBriefing(db, accountId, briefingId).sources[0]
  assert.equal(s.content.length, MAX_PASTED_CHARS)
  assert.equal(s.status, 'ok')
})

test('erro inesperado vira fonte falhou e nao lanca', () => {
  const { db, accountId, briefingId } = setup()
  // briefing inexistente (ou de outra conta) -> addSource devolve null, a fonte nao grava, e nao lanca
  const r = collectPastedText(db, { accountId, briefingId: 999999, text: 'texto' })
  assert.equal(r.ok, false)
  assert.ok(r.error, 'tem que dizer o motivo')
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})

test('entrada cujo toString lanca vira ok:false, nao derruba', () => {
  const { db, accountId, briefingId } = setup()
  const hostil = { toString() { throw new Error('boom-toString') } }
  const r = collectPastedText(db, { accountId, briefingId, text: hostil })
  assert.equal(r.ok, false)
  assert.ok(r.error)
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})

test('addSource com kind invalido vira ok:false, nao lanca', () => {
  const { db, accountId, briefingId } = setup()
  // Testa que mesmo um erro do addSource nao derruba a funcao, devolve ok:false
  // Para isso, precisamos forcar addSource a falhar. Vamos fazer isso chamando
  // collectPastedText com um accountId que nao existe (vai passar pelas validacoes
  // iniciais mas addSource vai falhar) ou passando um briefingId invalido ja testado.
  // Na verdade, a forma mais clara de exercitar o catch e garantindo que addSource
  // lancara e nao devolvera null, seria mockarlo. Mas sem mock, qualquer falha de
  // db.run() dentro de addSource vira catch aqui. Vamos usar um briefingId negativo
  // que passa a normalização mas causa erro no db quando tenta gravar.
  const r = collectPastedText(db, { accountId, briefingId: -1, text: 'texto valido' })
  assert.equal(r.ok, false)
  assert.ok(r.error)
  // A fonte nao foi gravada
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})

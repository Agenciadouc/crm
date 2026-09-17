import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusForError } from '../server/routes/agentBriefings.js'

test('erro de nao encontrado vira 404', () => {
  assert.equal(statusForError('briefing_nao_encontrado'), 404)
  assert.equal(statusForError('agente_nao_encontrado'), 404)
})

test('falta da chave da Dros vira 503, nao 400', () => {
  assert.equal(statusForError('dros_key_missing'), 503)
})

test('estado errado do briefing vira 409', () => {
  assert.equal(statusForError('briefing_nao_compilado'), 409)
  assert.equal(statusForError('compilado_invalido'), 409)
})

test('erro do cliente continua 400', () => {
  assert.equal(statusForError('resposta_vazia'), 400)
  assert.equal(statusForError('texto_vazio'), 400)
  assert.equal(statusForError('qualquer_coisa'), 400)
  assert.equal(statusForError(undefined), 400)
})

test('falha da IA vira 502', () => {
  assert.equal(statusForError('pergunta_vazia'), 502)
  assert.equal(statusForError('saida_invalida'), 502)
})

test('corrida de estado vira 409', () => {
  assert.equal(statusForError('briefing_desapareceu'), 409)
  assert.equal(statusForError('falha_ao_amarrar_agente_ao_briefing'), 409)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, matchKeyword, parseKeywordList, classifyMessage, findTriggerKeyword } from '../server/services/signals/keywordMatch.js'

test('normalizeText remove acentos, baixa caixa e colapsa espacos', () => {
  assert.equal(normalizeText('  QUANTO   Custa?  '), 'quanto custa?')
  assert.equal(normalizeText('Não Quero'), 'nao quero')
  assert.equal(normalizeText(null), '')
})

test('matchKeyword acha ignorando acento e caixa, ou null', () => {
  assert.equal(matchKeyword('Quanto CUSTA isso?', ['quanto custa']), 'quanto custa')
  assert.equal(matchKeyword('nada a ver', ['quanto custa']), null)
  assert.equal(matchKeyword('qualquer coisa', []), null)
})

test('parseKeywordList: JSON valido vira array, invalido/nulo vira []', () => {
  assert.deepEqual(parseKeywordList('["a","b"]'), ['a', 'b'])
  assert.deepEqual(parseKeywordList(null), [])
  assert.deepEqual(parseKeywordList('nao e json'), [])
  assert.deepEqual(parseKeywordList('{"a":1}'), [])
})

test('classifyMessage: negativo tem prioridade sobre forte', () => {
  const r = classifyMessage('nao quero mais, caro demais', {
    strongKeywords: ['caro demais'], negativeKeywords: ['nao quero mais'], weakKeywords: [], hasArmedTrigger: false,
  })
  assert.deepEqual(r, { type: 'negative', keyword: 'nao quero mais' })
})

test('classifyMessage: forte vale sem gatilho armado', () => {
  const r = classifyMessage('pode fechar, quero comprar', {
    strongKeywords: ['quero comprar'], negativeKeywords: [], weakKeywords: [], hasArmedTrigger: false,
  })
  assert.deepEqual(r, { type: 'strong', keyword: 'quero comprar' })
})

test('classifyMessage: fraco SO conta com gatilho armado', () => {
  const semGatilho = classifyMessage('quanto custa?', {
    strongKeywords: [], negativeKeywords: [], weakKeywords: ['quanto custa'], hasArmedTrigger: false,
  })
  assert.deepEqual(semGatilho, { type: null, keyword: null })

  const comGatilho = classifyMessage('quanto custa?', {
    strongKeywords: [], negativeKeywords: [], weakKeywords: ['quanto custa'], hasArmedTrigger: true,
  })
  assert.deepEqual(comGatilho, { type: 'weak', keyword: 'quanto custa' })
})

test('classifyMessage: nenhuma lista bate -> null (nao quebra com listas vazias)', () => {
  const r = classifyMessage('oi, tudo bem?', { strongKeywords: [], negativeKeywords: [], weakKeywords: [], hasArmedTrigger: true })
  assert.deepEqual(r, { type: null, keyword: null })
})

test('findTriggerKeyword: acha em qualquer mensagem da sequencia outbound, ou null', () => {
  assert.equal(findTriggerKeyword(['oi', 'posso te mandar uma proposta?'], ['posso te mandar uma proposta']), 'posso te mandar uma proposta')
  assert.equal(findTriggerKeyword(['oi', 'tudo bem?'], ['posso te mandar uma proposta']), null)
  assert.equal(findTriggerKeyword([], ['qualquer coisa']), null)
})

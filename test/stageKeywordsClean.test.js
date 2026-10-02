import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanKeywordList } from '../src/lib/stageKeywords.js'

test('array editado: trim e remove vazios', () => {
  assert.deepEqual(cleanKeywordList([' a ', '', 'b']), ['a', 'b'])
})

test('string JSON intocada (vinda do backend, campo nao editado) vira array', () => {
  assert.deepEqual(cleanKeywordList('["quanto custa","qual o valor"]'), ['quanto custa', 'qual o valor'])
})

test('string invalida vira undefined (nao quebra nem apaga por engano)', () => {
  assert.equal(cleanKeywordList('nao e json'), undefined)
})

test('null/undefined vira undefined', () => {
  assert.equal(cleanKeywordList(null), undefined)
  assert.equal(cleanKeywordList(undefined), undefined)
})

test('array so com vazios vira undefined', () => {
  assert.equal(cleanKeywordList(['', '  ']), undefined)
})

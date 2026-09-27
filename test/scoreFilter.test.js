import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_SCORE_FILTER, encodeScoreFilter, parseScoreFilter, scoreParams, isScoreFilterActive, scoreFilterLabel, countScoreFilters, leadMatchesScore } from '../src/lib/scoreFilter.js'

const full = { bands: ['quente', 'pronto'], min: 70, fit: true, engagement: true }

test('encode/parse ida e volta', () => {
  assert.deepEqual(parseScoreFilter(encodeScoreFilter(full)), full)
  const soFaixa = { bands: ['frio'], min: null, fit: false, engagement: false }
  assert.deepEqual(parseScoreFilter(encodeScoreFilter(soFaixa)), soFaixa)
})

test('encode de filtro vazio e string vazia', () => {
  assert.equal(encodeScoreFilter(EMPTY_SCORE_FILTER), '')
  assert.equal(encodeScoreFilter(null), '')
  assert.equal(encodeScoreFilter({ bands: [], min: null, fit: false, engagement: false }), '')
})

test('parse de texto invalido volta filtro vazio', () => {
  for (const bad of [null, undefined, '', 'lixo', '{', '[]', '123', 'null']) {
    assert.deepEqual(parseScoreFilter(bad), EMPTY_SCORE_FILTER, `entrada: ${bad}`)
  }
})

test('parse limpa faixas desconhecidas, repetidas e nota fora de 0-100', () => {
  const f = parseScoreFilter(JSON.stringify({ bands: ['quente', 'xx', 'quente', 'pronto'], min: 150, fit: 'sim', engagement: 1 }))
  assert.deepEqual(f.bands, ['quente', 'pronto'])
  assert.equal(f.min, null)
  assert.equal(f.fit, false)
  assert.equal(f.engagement, false)
  assert.equal(parseScoreFilter(JSON.stringify({ min: -3 })).min, null)
  assert.equal(parseScoreFilter(JSON.stringify({ min: '70' })).min, 70)
  assert.equal(parseScoreFilter(JSON.stringify({ min: 70.6 })).min, 71)
})

test('scoreParams segue o formato do backend', () => {
  assert.deepEqual(scoreParams(full), { score_bands: 'quente,pronto', score_min: 70, fit: 'AB', engagement: 'high' })
  assert.deepEqual(scoreParams(EMPTY_SCORE_FILTER), {})
  assert.deepEqual(scoreParams(null), {})
  assert.deepEqual(scoreParams({ bands: [], min: 0, fit: false, engagement: false }), { score_min: 0 })
})

test('isScoreFilterActive e contador', () => {
  assert.equal(isScoreFilterActive(EMPTY_SCORE_FILTER), false)
  assert.equal(isScoreFilterActive(null), false)
  assert.equal(isScoreFilterActive({ ...EMPTY_SCORE_FILTER, fit: true }), true)
  assert.equal(countScoreFilters(full), 4)
  assert.equal(countScoreFilters({ ...EMPTY_SCORE_FILTER, bands: ['frio', 'morno'] }), 1)
  assert.equal(countScoreFilters(EMPTY_SCORE_FILTER), 0)
})

test('scoreFilterLabel', () => {
  assert.equal(scoreFilterLabel({ bands: ['quente', 'pronto'], min: 70, fit: false, engagement: false }), 'Quente, Pronto · nota ≥ 70')
  assert.equal(scoreFilterLabel(full), 'Quente, Pronto · nota ≥ 70 · perfil A/B · engajamento alto')
  assert.equal(scoreFilterLabel({ ...EMPTY_SCORE_FILTER, bands: ['frio'] }), 'Frio')
  assert.equal(scoreFilterLabel(EMPTY_SCORE_FILTER), '')
})

test('leadMatchesScore espelha o filtro do servidor (lead que chega em tempo real)', () => {
  const lead = { score: 72, score_band: 'quente', score_fit_grade: 'B', score_engagement: 30 }
  assert.equal(leadMatchesScore(lead, EMPTY_SCORE_FILTER), true)
  assert.equal(leadMatchesScore(lead, full), true)
  assert.equal(leadMatchesScore(lead, { ...full, min: 80 }), false)
  assert.equal(leadMatchesScore(lead, { ...EMPTY_SCORE_FILTER, bands: ['frio'] }), false)
  assert.equal(leadMatchesScore({ ...lead, score_fit_grade: 'C' }, { ...EMPTY_SCORE_FILTER, fit: true }), false)
  assert.equal(leadMatchesScore({ ...lead, score_engagement: 24 }, { ...EMPTY_SCORE_FILTER, engagement: true }), false)
  // Sem nota: so passa sem filtro ligado
  assert.equal(leadMatchesScore({ score: null, score_band: null }, { ...EMPTY_SCORE_FILTER, min: 0 }), false)
  assert.equal(leadMatchesScore({ score: null, score_band: null }, EMPTY_SCORE_FILTER), true)
})

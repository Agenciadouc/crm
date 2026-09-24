import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGeo, encodeGeo, geoParams, geoQuery, geoLabel, leadMatchesGeo } from '../src/lib/geoFilter.js'

test('parseGeo/encodeGeo: estado, cidade, ambos, vazio e texto antigo so com cidade', () => {
  assert.deepEqual(parseGeo('RS|Porto Alegre'), { uf: 'RS', city: 'Porto Alegre' })
  assert.deepEqual(parseGeo('SC|'), { uf: 'SC', city: '' })
  assert.deepEqual(parseGeo(''), { uf: '', city: '' })
  assert.deepEqual(parseGeo('Torres'), { uf: '', city: 'Torres' })
  assert.equal(encodeGeo('rs', 'Porto Alegre'), 'RS|Porto Alegre')
  assert.equal(encodeGeo('SC', ''), 'SC|')
  assert.equal(encodeGeo('', ''), '')
})

test('geoParams/geoQuery/geoLabel', () => {
  assert.deepEqual(geoParams('RS|Porto Alegre'), { city: 'Porto Alegre', uf: 'RS' })
  assert.deepEqual(geoParams('SC|'), { uf: 'SC' })
  assert.deepEqual(geoParams(''), {})
  assert.equal(geoQuery('RS|São José'), '&city=S%C3%A3o%20Jos%C3%A9&uf=RS')
  assert.equal(geoQuery(''), '')
  assert.equal(geoLabel('RS|Torres'), 'Torres - RS')
  assert.equal(geoLabel('SC|'), 'SC')
  assert.equal(geoLabel('Torres'), 'Torres')
})

test('leadMatchesGeo: estado e cidade sem acento', () => {
  const lead = { uf: 'SC', city: 'Florianópolis' }
  assert.equal(leadMatchesGeo(lead, ''), true)
  assert.equal(leadMatchesGeo(lead, 'SC|'), true)
  assert.equal(leadMatchesGeo(lead, 'RS|'), false)
  assert.equal(leadMatchesGeo(lead, 'SC|florianopolis'), true)
  assert.equal(leadMatchesGeo(lead, '|Florianopolis'), true)
  assert.equal(leadMatchesGeo({ uf: null, city: null }, 'SC|'), false)
})

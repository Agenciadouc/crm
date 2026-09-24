import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { normalizeCity, cityKey, registerCityFunctions, normalizeExistingCities, cityWhere, resolveCity } from '../server/services/city.js'

test('normalizeCity: tira espacos e ajusta maiusculas; preposicoes em minusculo', () => {
  assert.equal(normalizeCity('  são   paulo '), 'São Paulo')
  assert.equal(normalizeCity('SAO PAULO'), 'Sao Paulo')
  assert.equal(normalizeCity('balneário camboriú'), 'Balneário Camboriú')
  assert.equal(normalizeCity('RIO DE JANEIRO'), 'Rio de Janeiro')
  assert.equal(normalizeCity('são josé dos campos'), 'São José dos Campos')
  assert.equal(normalizeCity('embu das artes'), 'Embu das Artes')
  assert.equal(normalizeCity('de itajaí'), 'De Itajaí') // primeira palavra sempre maiuscula
  assert.equal(normalizeCity("santa bárbara d'oeste"), "Santa Bárbara D'oeste")
  assert.equal(normalizeCity('guaramirim-sc'), 'Guaramirim-Sc')
})

test('normalizeCity: vazio vira null; nao-texto vira texto', () => {
  assert.equal(normalizeCity(''), null)
  assert.equal(normalizeCity('   '), null)
  assert.equal(normalizeCity(null), null)
  assert.equal(normalizeCity(undefined), null)
  assert.equal(normalizeCity(123), '123')
})

test('cityKey: junta variacoes de acento, maiuscula e espacos', () => {
  assert.equal(cityKey('São Paulo'), cityKey('sao  paulo '))
  assert.equal(cityKey('SÃO PAULO'), 'sao paulo')
  assert.equal(cityKey('Itajaí'), cityKey('ITAJAI'))
  assert.notEqual(cityKey('Itajaí'), cityKey('Itapema'))
  assert.equal(cityKey(''), '')
  assert.equal(cityKey(null), '')
})

test('city_key no SQLite + cityWhere filtra ignorando acento', () => {
  const db = new Database(':memory:')
  registerCityFunctions(db)
  db.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, city TEXT)')
  for (const c of ['São Paulo', 'sao paulo', 'Itajaí', null]) db.prepare('INSERT INTO leads (city) VALUES (?)').run(c)
  const w = cityWhere('l', 'SAO PAULO')
  const ids = db.prepare(`SELECT id FROM leads l WHERE 1=1 ${w.sql} ORDER BY id`).all(...w.params).map(r => r.id)
  assert.deepEqual(ids, [1, 2])
  const none = cityWhere('l', '')
  assert.deepEqual(none, { sql: '', params: [] })
})

test('normalizeExistingCities: padroniza gravados e unifica acento pela forma mais usada da conta', () => {
  const db = new Database(':memory:')
  registerCityFunctions(db)
  db.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, account_id INTEGER, city TEXT)')
  const add = (acc, c) => db.prepare('INSERT INTO leads (account_id, city) VALUES (?, ?)').run(acc, c)
  add(1, 'são paulo '); add(1, 'SÃO PAULO'); add(1, 'sao paulo'); add(1, '  '); add(1, 'itajai')
  add(2, 'sao paulo') // outra conta: nao se mistura
  const changed = normalizeExistingCities(db)
  assert.ok(changed > 0)
  const rows = db.prepare('SELECT account_id, city FROM leads ORDER BY id').all()
  assert.deepEqual(rows.map(r => r.city), ['São Paulo', 'São Paulo', 'São Paulo', null, 'Itajai', 'Sao Paulo'])
  assert.equal(normalizeExistingCities(db), 0, 'rodar de novo nao muda nada')
})

test('resolveCity: reaproveita a forma ja usada na conta; senao padroniza', () => {
  const db = new Database(':memory:')
  registerCityFunctions(db)
  db.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, account_id INTEGER, city TEXT)')
  db.prepare("INSERT INTO leads (account_id, city) VALUES (1, 'São Paulo'), (1, 'São Paulo'), (1, 'Sao Paulo'), (2, 'Sao Paulo')").run()
  assert.equal(resolveCity(db, 1, 'SAO PAULO'), 'São Paulo')
  assert.equal(resolveCity(db, 2, 'são paulo'), 'Sao Paulo')
  assert.equal(resolveCity(db, 1, 'itajaí'), 'Itajaí')
  assert.equal(resolveCity(db, 1, '  '), null)
  assert.equal(resolveCity(db, null, 'itajaí'), 'Itajaí')
})

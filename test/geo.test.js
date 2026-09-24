import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUF, ufFromPhone, ufsForCity, resolveUF, UF_NAMES } from '../server/services/geo.js'

test('UF_NAMES: 27 estados', () => {
  assert.equal(Object.keys(UF_NAMES).length, 27)
  assert.equal(UF_NAMES.SC, 'Santa Catarina')
  assert.equal(UF_NAMES.DF, 'Distrito Federal')
})

test('normalizeUF: sigla ou nome, com ou sem acento', () => {
  assert.equal(normalizeUF('sc'), 'SC')
  assert.equal(normalizeUF(' RS '), 'RS')
  assert.equal(normalizeUF('Santa Catarina'), 'SC')
  assert.equal(normalizeUF('sao paulo'), 'SP')
  assert.equal(normalizeUF('PARÁ'), 'PA')
  assert.equal(normalizeUF('XX'), null)
  assert.equal(normalizeUF(''), null)
  assert.equal(normalizeUF(null), null)
})

test('ufFromPhone: DDD com ou sem 55', () => {
  assert.equal(ufFromPhone('5548991234567'), 'SC')
  assert.equal(ufFromPhone('5551999998888'), 'RS')
  assert.equal(ufFromPhone('11987654321'), 'SP')
  assert.equal(ufFromPhone('(61) 3333-4444'), 'DF')
  assert.equal(ufFromPhone('5520999998888'), null) // DDD 20 nao existe
  assert.equal(ufFromPhone('123'), null)
  assert.equal(ufFromPhone(null), null)
})

test('ufsForCity: cidade unica, homonimas e desconhecida', () => {
  assert.deepEqual(ufsForCity('Florianópolis'), ['SC'])
  assert.deepEqual(ufsForCity('florianopolis'), ['SC'])
  assert.ok(ufsForCity('Bom Jesus').length > 1)
  assert.deepEqual(ufsForCity('Cidade Que Nao Existe'), [])
  assert.deepEqual(ufsForCity(''), [])
})

test('resolveUF: estado informado > cidade unica > DDD entre homonimas > DDD sem cidade', () => {
  assert.equal(resolveUF({ state: 'rs', city: 'Florianópolis', phone: '5548999' }), 'RS') // informado vence
  assert.equal(resolveUF({ city: 'Florianópolis', phone: '5511999998888' }), 'SC') // cidade unica vence DDD
  const bomJesus = ufsForCity('Bom Jesus')
  assert.ok(bomJesus.includes('RS'))
  assert.equal(resolveUF({ city: 'Bom Jesus', phone: '5554999998888' }), 'RS') // DDD 54 = RS, desempata
  assert.equal(resolveUF({ city: 'Bom Jesus', phone: '5511999998888' }), null) // DDD fora das opcoes
  assert.equal(resolveUF({ city: 'Bom Jesus' }), null)
  assert.equal(resolveUF({ phone: '5548999998888' }), 'SC') // sem cidade: DDD
  assert.equal(resolveUF({ city: 'Cidade Inventada', phone: '5548999998888' }), 'SC') // cidade fora do IBGE: DDD
  assert.equal(resolveUF({}), null)
})

test('applyGeoSchema: coluna uf preenchida ao criar e atualizada ao mudar cidade/estado/telefone', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { registerCityFunctions } = await import('../server/services/city.js')
  const { applyGeoSchema } = await import('../server/services/geo.js')
  const db = new Database(':memory:')
  registerCityFunctions(db)
  db.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, account_id INTEGER, city TEXT, state TEXT, phone TEXT)')
  db.prepare("INSERT INTO leads (city, phone) VALUES ('Florianópolis', NULL), (NULL, '5551999998888')").run()
  applyGeoSchema(db) // backfill dos existentes
  const uf = (id) => db.prepare('SELECT uf FROM leads WHERE id = ?').get(id).uf
  assert.equal(uf(1), 'SC')
  assert.equal(uf(2), 'RS')
  const id = db.prepare("INSERT INTO leads (city, phone) VALUES ('Torres', NULL)").run().lastInsertRowid
  assert.equal(uf(id), 'RS', 'gatilho no INSERT')
  db.prepare("UPDATE leads SET city = 'Curitiba' WHERE id = ?").run(id)
  assert.equal(uf(id), 'PR', 'gatilho ao mudar cidade')
  db.prepare("UPDATE leads SET state = 'sp' WHERE id = ?").run(id)
  assert.equal(uf(id), 'SP', 'estado informado vence')
  applyGeoSchema(db) // idempotente
  assert.equal(uf(id), 'SP')
})

test('applyGeoSchema: gatilho nao fica gravado no arquivo (outra conexao sem lead_uf consegue inserir lead)', async () => {
  const { default: Database } = await import('better-sqlite3')
  const { registerCityFunctions } = await import('../server/services/city.js')
  const { applyGeoSchema } = await import('../server/services/geo.js')
  const { mkdtempSync } = await import('fs')
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  const file = join(mkdtempSync(join(tmpdir(), 'geo-')), 'crm.db')
  const a = new Database(file)
  registerCityFunctions(a)
  a.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, account_id INTEGER, city TEXT, state TEXT, phone TEXT)')
  applyGeoSchema(a)
  const b = new Database(file) // sem lead_uf registrada
  assert.doesNotThrow(() => b.prepare("INSERT INTO leads (city) VALUES ('Torres')").run())
  assert.equal(b.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type = 'trigger'").get().n, 0)
  a.close(); b.close()
})

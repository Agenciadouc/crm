import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { scoreWhere, scoreOrder } from '../server/services/leadScore/filters.js'

// ---- scoreWhere -------------------------------------------------------------

test('scoreWhere: sem filtros devolve sql vazio', () => {
  assert.deepEqual(scoreWhere('l', {}), { sql: '', params: [] })
  assert.deepEqual(scoreWhere('l', undefined), { sql: '', params: [] })
})

test('scoreWhere: score_bands filtra pela lista, descarta faixa desconhecida', () => {
  const w = scoreWhere('l', { score_bands: 'quente,pronto' })
  assert.equal(w.sql, ' AND l.score_band IN (?,?)')
  assert.deepEqual(w.params, ['quente', 'pronto'])

  const w2 = scoreWhere('l', { score_bands: 'quente,lava,pronto' })
  assert.equal(w2.sql, ' AND l.score_band IN (?,?)')
  assert.deepEqual(w2.params, ['quente', 'pronto'])

  // todas as faixas invalidas -> nenhum filtro aplicado
  const w3 = scoreWhere('l', { score_bands: 'lava,fogo' })
  assert.deepEqual(w3, { sql: '', params: [] })
})

test('scoreWhere: score_min valido (0..100) filtra; fora do intervalo ou nao-numero e ignorado', () => {
  const w = scoreWhere('l', { score_min: '70' })
  assert.equal(w.sql, ' AND l.score >= ?')
  assert.deepEqual(w.params, [70])

  assert.deepEqual(scoreWhere('l', { score_min: 'abc' }), { sql: '', params: [] })
  assert.deepEqual(scoreWhere('l', { score_min: '-5' }), { sql: '', params: [] })
  assert.deepEqual(scoreWhere('l', { score_min: '150' }), { sql: '', params: [] })

  // limites inclusivos
  assert.equal(scoreWhere('l', { score_min: '0' }).sql, ' AND l.score >= ?')
  assert.equal(scoreWhere('l', { score_min: '100' }).sql, ' AND l.score >= ?')
})

test('scoreWhere: fit=AB filtra score_fit_grade A/B; outros valores ignorados', () => {
  const w = scoreWhere('l', { fit: 'AB' })
  assert.equal(w.sql, " AND l.score_fit_grade IN ('A','B')")
  assert.deepEqual(w.params, [])

  assert.deepEqual(scoreWhere('l', { fit: 'CD' }), { sql: '', params: [] })
  assert.deepEqual(scoreWhere('l', { fit: '' }), { sql: '', params: [] })
})

test('scoreWhere: engagement=high filtra score_engagement >= 25; outros valores ignorados', () => {
  const w = scoreWhere('l', { engagement: 'high' })
  assert.equal(w.sql, ' AND l.score_engagement >= ?')
  assert.deepEqual(w.params, [25])

  assert.deepEqual(scoreWhere('l', { engagement: 'low' }), { sql: '', params: [] })
})

test('scoreWhere: combina todos os filtros na ordem bands, min, fit, engagement', () => {
  const w = scoreWhere('l', { score_bands: 'quente', score_min: '50', fit: 'AB', engagement: 'high' })
  assert.equal(w.sql, " AND l.score_band IN (?) AND l.score >= ? AND l.score_fit_grade IN ('A','B') AND l.score_engagement >= ?")
  assert.deepEqual(w.params, ['quente', 50, 25])
})

test('scoreWhere: composicao real com better-sqlite3, igual cityWhere', () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE leads (id INTEGER PRIMARY KEY, score INTEGER, score_band TEXT, score_fit_grade TEXT, score_engagement INTEGER)')
  const add = (score, band, grade, eng) => db.prepare('INSERT INTO leads (score, score_band, score_fit_grade, score_engagement) VALUES (?, ?, ?, ?)').run(score, band, grade, eng)
  add(90, 'pronto', 'A', 40)
  add(20, 'frio', 'D', 5)
  add(70, 'quente', 'B', 30)

  const w = scoreWhere('l', { score_bands: 'quente,pronto' })
  const ids = db.prepare(`SELECT id FROM leads l WHERE 1=1 ${w.sql} ORDER BY id`).all(...w.params).map(r => r.id)
  assert.deepEqual(ids, [1, 3])
})

// ---- scoreOrder ---------------------------------------------------------------

test('scoreOrder: null quando sort != score', () => {
  assert.equal(scoreOrder('l', {}), null)
  assert.equal(scoreOrder('l', { sort: 'recent' }), null)
})

test('scoreOrder: sort=score devolve ordem exata pela nota', () => {
  assert.equal(scoreOrder('l', { sort: 'score' }), 'l.score IS NULL, l.score DESC, COALESCE(l.last_inbound_at, l.updated_at) DESC')
})

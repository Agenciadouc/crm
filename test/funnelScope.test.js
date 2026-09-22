import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { funnelUpdateTarget } from '../server/services/funnelScope.js'

// PUT /api/funnels/:id (server/routes/funnels.js) so pode alterar funil da PROPRIA conta.
// A rota importa o db singleton, entao aqui rodamos o MESMO alvo (where + params) que ela
// monta, contra um SQLite em memoria, para provar o filtro por conta.
function dbComFunis() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL,
      name TEXT NOT NULL
    );
  `)
  db.exec(`
    INSERT INTO funnels (id, account_id, name) VALUES
      (1, 10, 'Comercial da conta 10'),
      (2, 20, 'Comercial da conta 20');
  `)
  return db
}

function renomeia(db, target, nome) {
  return db.prepare(`UPDATE funnels SET name = ? WHERE ${target.where}`).run(nome, ...target.params).changes
}

test('gerente altera funil da propria conta', () => {
  const db = dbComFunis()
  const target = funnelUpdateTarget('gerente', 10, 1)
  assert.equal(renomeia(db, target, 'Novo nome'), 1)
  assert.equal(db.prepare('SELECT name FROM funnels WHERE id = 1').get().name, 'Novo nome')
})

test('gerente NAO altera funil de outra conta (0 linhas = 404)', () => {
  const db = dbComFunis()
  const target = funnelUpdateTarget('gerente', 10, 2)
  assert.equal(renomeia(db, target, 'Invadido'), 0)
  assert.equal(db.prepare('SELECT name FROM funnels WHERE id = 2').get().name, 'Comercial da conta 20')
})

test('atendente/gerente sem conta no pedido nao altera nada', () => {
  const db = dbComFunis()
  const target = funnelUpdateTarget('gerente', undefined, 1)
  assert.equal(renomeia(db, target, 'Invadido'), 0)
})

test('super_admin altera qualquer funil (suporte da Dros)', () => {
  const db = dbComFunis()
  assert.equal(renomeia(db, funnelUpdateTarget('super_admin', 10, 2), 'Ajuste do suporte'), 1)
  assert.equal(db.prepare('SELECT name FROM funnels WHERE id = 2').get().name, 'Ajuste do suporte')
})

test('id vem como texto na rota (req.params.id) e continua casando', () => {
  const db = dbComFunis()
  assert.equal(renomeia(db, funnelUpdateTarget('gerente', 10, '1'), 'Novo nome'), 1)
  assert.equal(renomeia(db, funnelUpdateTarget('gerente', 10, '2'), 'Invadido'), 0)
})

test('funil inexistente nao casa (0 linhas = 404)', () => {
  const db = dbComFunis()
  assert.equal(renomeia(db, funnelUpdateTarget('gerente', 10, 999), 'x'), 0)
  assert.equal(renomeia(db, funnelUpdateTarget('super_admin', 10, 999), 'x'), 0)
})

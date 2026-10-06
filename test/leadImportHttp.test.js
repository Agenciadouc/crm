// test/leadImportHttp.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImportTestDb, seedImport } from './helpers/leadImportDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createLeadImportRouter } from '../server/routes/leadImportRouter.js'

async function comServidor(fn) {
  const db = createImportTestDb(); const s = seedImport(db); const sent = []
  await withServer(app => app.use('/api/leads/import', authenticate, scopeToAccount, createLeadImportRouter(db, { broadcast: (a, e, d) => sent.push([a, e, d]) })),
    ({ base }) => fn({ db, s, base, sent }))
}
const body = s => ({ rows: [{ row: 2, fields: { name: 'Ana', phone: '48999990000' }, extra: {} }], destination: s.dest, fileName: 'lista.csv' })

test('gestor: previa nao grava; importar grava e avisa as telas', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const g = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const p = await peca(base, { method: 'POST', path: '/api/leads/import/preview', jwtToken: g, body: body(s) })
    assert.equal(p.status, 200); assert.equal(p.body.new_count, 1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
    const r = await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: g, body: body(s) })
    assert.equal(r.status, 200); assert.equal(r.body.created, 1)
    assert.ok(sent.some(x => x[1] === 'lead:updated' && x[2].bulk === true))
  })
})

test('atendente 403; destino de outra conta 400 e nada gravado', async () => {
  await comServidor(async ({ db, s, base }) => {
    const a = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    assert.equal((await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: a, body: body(s) })).status, 403)
    const intruso = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'X', 'x@b.local', 'gerente')").run(s.otherAccountId).lastInsertRowid)
    const tx = token({ id: intruso, role: 'gerente', accountId: s.otherAccountId })
    const r = await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: tx, body: body(s) })
    assert.equal(r.status, 400)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
  })
})

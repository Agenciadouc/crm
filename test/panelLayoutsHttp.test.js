import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb } from './helpers/memoryDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createPanelLayoutsRouter } from '../server/routes/panelLayoutsRouter.js'
import { applyPanelLayoutSchema, PANEL_BLOCKS } from '../server/services/panelLayouts.js'

function base(db) {
  const conta = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Clinica')").run().lastInsertRowid)
  const outra = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Outra')").run().lastInsertRowid)
  const user = (acc, name, role) => Number(db.prepare('INSERT INTO users (account_id, name, email, role) VALUES (?, ?, ?, ?)').run(acc, name, `${name}@t.local`, role).lastInsertRowid)
  const gerente = user(conta, 'Gerente', 'gerente')
  const ana = user(conta, 'Ana', 'atendente')
  const bruno = user(conta, 'Bruno', 'atendente')
  const gerenteOutra = user(outra, 'Intruso', 'gerente')
  const admin = user(null, 'Admin', 'super_admin')
  return {
    conta, outra,
    tGerente: token({ id: gerente, role: 'gerente', accountId: conta }),
    tAna: token({ id: ana, role: 'atendente', accountId: conta }),
    tBruno: token({ id: bruno, role: 'atendente', accountId: conta }),
    tOutra: token({ id: gerenteOutra, role: 'gerente', accountId: outra }),
    tAdmin: token({ id: admin, role: 'super_admin' }),
  }
}

async function comServidor(fn) {
  const db = createTestDb()
  applyPanelLayoutSchema(db)
  applyPanelLayoutSchema(db) // idempotente
  const s = base(db)
  await withServer(app => app.use('/api/panel-layouts', authenticate, scopeToAccount, createPanelLayoutsRouter(db)), ({ base: url }) => fn({ db, s, url }))
}

const P = '/api/panel-layouts/atendimento'
const layoutA = [{ id: 'tarefas', visible: true }, { id: 'score', visible: true }, { id: 'vendas', visible: false }]
const layoutConta = [{ id: 'etapa', visible: true }, { id: 'contato', visible: true }]

test('vendedor salva o proprio jeito, le de volta e volta ao padrao', async () => {
  await comServidor(async ({ s, url }) => {
    let r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, { account: null, user: null })

    r = await peca(url, { method: 'PUT', path: `${P}/me`, jwtToken: s.tAna, body: { layout: layoutA } })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.layout, layoutA)

    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body, { account: null, user: layoutA })

    // salvar de novo substitui (nao duplica)
    r = await peca(url, { method: 'PUT', path: `${P}/me`, jwtToken: s.tAna, body: { layout: [{ id: 'score', visible: false }] } })
    assert.equal(r.status, 200)
    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body.user, [{ id: 'score', visible: false }])

    // outro vendedor da mesma conta nao ve o jeito da Ana
    r = await peca(url, { path: P, jwtToken: s.tBruno })
    assert.deepEqual(r.body, { account: null, user: null })

    r = await peca(url, { method: 'DELETE', path: `${P}/me`, jwtToken: s.tAna })
    assert.equal(r.status, 200)
    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body, { account: null, user: null })
  })
})

test('gerente salva o padrao da conta; vendedores da conta leem, outra conta nao ve', async () => {
  await comServidor(async ({ db, s, url }) => {
    let r = await peca(url, { method: 'PUT', path: `${P}/account`, jwtToken: s.tGerente, body: { layout: layoutConta } })
    assert.equal(r.status, 200)
    r = await peca(url, { method: 'PUT', path: `${P}/me`, jwtToken: s.tAna, body: { layout: layoutA } })
    assert.equal(r.status, 200)

    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body, { account: layoutConta, user: layoutA })
    r = await peca(url, { path: P, jwtToken: s.tBruno })
    assert.deepEqual(r.body, { account: layoutConta, user: null })

    r = await peca(url, { path: P, jwtToken: s.tOutra })
    assert.deepEqual(r.body, { account: null, user: null })

    // gravar de novo o padrao da conta substitui a linha (user_id NULL tambem e unico)
    r = await peca(url, { method: 'PUT', path: `${P}/account`, jwtToken: s.tGerente, body: { layout: layoutA } })
    assert.equal(r.status, 200)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM panel_layouts WHERE account_id = ? AND user_id IS NULL').get(s.conta).n, 1)
    // voltar ao padrao do vendedor nao apaga o padrao da conta
    await peca(url, { method: 'DELETE', path: `${P}/me`, jwtToken: s.tAna })
    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body, { account: layoutA, user: null })
  })
})

test('atendente recebe 403 ao salvar o padrao da conta e nada muda', async () => {
  await comServidor(async ({ db, s, url }) => {
    const r = await peca(url, { method: 'PUT', path: `${P}/account`, jwtToken: s.tAna, body: { layout: layoutConta } })
    assert.equal(r.status, 403)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM panel_layouts').get().n, 0)
  })
})

test('super_admin sem conta recebe 400; com conta escolhida salva o padrao dela', async () => {
  await comServidor(async ({ s, url }) => {
    let r = await peca(url, { path: P, jwtToken: s.tAdmin })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'Selecione uma conta.')
    r = await peca(url, { method: 'PUT', path: `${P}/account?account_id=${s.conta}`, jwtToken: s.tAdmin, body: { layout: layoutConta } })
    assert.equal(r.status, 200)
    r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body.account, layoutConta)
  })
})

test('layout invalido recebe 400 com mensagem em portugues e nada e gravado', async () => {
  await comServidor(async ({ db, s, url }) => {
    const casos = [
      [undefined, /lista/i],
      [{ id: 'score', visible: true }, /lista/i],
      [[], /pelo menos/i],
      [[{ id: 'bolo', visible: true }], /desconhecido/i],
      [[{ id: 'score', visible: true }, { id: 'score', visible: false }], /repetido/i],
      [[{ id: 'score', visible: 'sim' }], /visível/i],
      [[{ id: 'score' }], /visível/i],
      [['score'], /bloco/i],
      [Array.from({ length: PANEL_BLOCKS.atendimento.length + 1 }, () => ({ id: 'score', visible: true })), /blocos demais/i],
    ]
    for (const [layout, msg] of casos) {
      const r = await peca(url, { method: 'PUT', path: `${P}/me`, jwtToken: s.tAna, body: { layout } })
      assert.equal(r.status, 400, JSON.stringify(layout))
      assert.match(r.body.error, msg, JSON.stringify(layout))
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM panel_layouts').get().n, 0)
  })
})

test('painel desconhecido recebe 404', async () => {
  await comServidor(async ({ s, url }) => {
    const r = await peca(url, { path: '/api/panel-layouts/pipeline', jwtToken: s.tAna })
    assert.equal(r.status, 404)
  })
})

test('guarda so id e visible (campos extras saem)', async () => {
  await comServidor(async ({ s, url }) => {
    await peca(url, { method: 'PUT', path: `${P}/me`, jwtToken: s.tAna, body: { layout: [{ id: 'score', visible: true, label: 'x', hack: 1 }] } })
    const r = await peca(url, { path: P, jwtToken: s.tAna })
    assert.deepEqual(r.body.user, [{ id: 'score', visible: true }])
  })
})

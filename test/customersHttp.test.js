import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createCustomersRouter } from '../server/routes/customersRouter.js'
import { onSaleCreated } from '../server/services/ltv/cycles.js'
import { recalcAccountCustomers } from '../server/services/ltv/customer.js'

function mount(db) {
  return app => app.use('/api/customers', authenticate, scopeToAccount, createCustomersRouter(db, { now: () => new Date('2026-09-29T15:00:00Z') }))
}
function setup() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const mine = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Ana', attendant_id: s.atendenteId })
  const other = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Bia', attendant_id: s.gerenteId })
  const sale = addSale(db, { accountId: s.accountId, leadId: mine, kind: 'recompra', remindDays: 30, saleDate: '2026-09-01' })
  addSale(db, { accountId: s.accountId, leadId: other, value: 900 })
  onSaleCreated(db, { saleId: sale, now: new Date('2026-09-29T15:00:00Z') })
  recalcAccountCustomers(db, s.accountId, { now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, mine, other }
}

test('gestor vê todos; atendente só os seus', async () => {
  const { db, s } = setup()
  await withServer(mount(db), async ({ base }) => {
    const g = await peca(base, { path: `/api/customers/overview?account_id=${s.accountId}`, jwtToken: token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId }) })
    assert.equal(g.status, 200); assert.equal(g.body.clients, 2)
    const a = await peca(base, { path: `/api/customers/overview?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }) })
    assert.equal(a.body.clients, 1)
  })
})

test('desfecho: atendente não mexe em lead de outro', async () => {
  const { db, s, other } = setup()
  await withServer(mount(db), async ({ base }) => {
    const r = await peca(base, { method: 'POST', path: `/api/customers/lead/${other}/outcome?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }), body: { outcome: 'nao_agora', reason_id: 1 } })
    assert.equal(r.status, 403)
  })
})

test('desfecho pelo dono do lead funciona', async () => {
  const { db, s, mine } = setup()
  const reasonId = db.prepare("SELECT id FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_agora' ORDER BY position").get(s.accountId).id
  await withServer(mount(db), async ({ base }) => {
    const r = await peca(base, { method: 'POST', path: `/api/customers/lead/${mine}/outcome?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }), body: { outcome: 'nao_agora', reason_id: reasonId, next_days: 15 } })
    assert.equal(r.status, 200); assert.equal(r.body.cycle.attempt, 2)
  })
})

test('configurações: atendente 403; gestor valida curva e recalcula', async () => {
  const { db, s } = setup()
  await withServer(mount(db), async ({ base }) => {
    const atd = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const ger = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    assert.equal((await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: atd, body: { maxAttempts: 3 } })).status, 403)
    assert.equal((await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { curve: { a: 50, b: 45, c: 60 } } })).status, 400)
    const ok = await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { curve: { a: 10, b: 20, c: 30 }, maxAttempts: 3 } })
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.curve, { a: 10, b: 20, c: 30 }); assert.equal(ok.body.maxAttempts, 3)
    assert.equal(ok.body.autoAvailable.ok, false) // sem IA no teste
    const on = await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { autoSend: true } })
    assert.equal(on.status, 409) // não pode ligar sem IA + número de disparo
  })
})

// Regressao: falha de validacao em QUALQUER campo do PUT /settings nao pode deixar escrita parcial
// (ex.: curva valida gravada silenciosamente enquanto maxAttempts invalido devolve 400 pro cliente).
test('configurações: falha em 1 campo não grava nenhum dos campos da mesma requisição', async () => {
  const { db, s } = setup()
  await withServer(mount(db), async ({ base }) => {
    const ger = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const before = await peca(base, { path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger })
    assert.equal(before.status, 200)

    // Curva valida + maxAttempts invalido na MESMA requisicao
    const r = await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { curve: { a: 10, b: 20, c: 30 }, maxAttempts: 999 } })
    assert.equal(r.status, 400)

    const after = await peca(base, { path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger })
    assert.deepEqual(after.body.curve, before.body.curve) // curva NAO deve ter mudado
    assert.equal(after.body.maxAttempts, before.body.maxAttempts)
  })
})

test('selos: criar recalcula o selo dos clientes', async () => {
  const { db, s, other } = setup()
  await withServer(mount(db), async ({ base }) => {
    const ger = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'POST', path: `/api/customers/tiers?account_id=${s.accountId}`, jwtToken: ger, body: { name: 'Diamante', icon: '💎', color: '#7E57C2', min_ltv: 500 } })
    assert.equal(r.status, 200)
    assert.equal(db.prepare('SELECT tier_id FROM leads WHERE id = ?').get(other).tier_id, r.body.tier.id)
    assert.equal((await peca(base, { method: 'POST', path: `/api/customers/tiers?account_id=${s.accountId}`, jwtToken: ger, body: { name: '', min_ltv: 1 } })).status, 400)
  })
})

test('cartão do lead', async () => {
  const { db, s, mine } = setup()
  await withServer(mount(db), async ({ base }) => {
    const r = await peca(base, { path: `/api/customers/lead/${mine}?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }) })
    assert.equal(r.status, 200)
    assert.equal(r.body.cycle.status, 'aguardando'); assert.equal(r.body.purchases, 1); assert.equal(r.body.reasons.nao_agora.length, 5)
  })
})

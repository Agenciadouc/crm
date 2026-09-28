import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO } from './helpers/cadenceDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createCadencesRouter } from '../server/routes/cadencesRouter.js'
import { createCadence, addStep, getCadence } from '../server/services/cadence/repo.js'
import { ensureStageCadence, assignAvulsa } from '../server/services/cadence/leadCadence.js'

async function comServidor(fn) {
  const db = createCadenceTestDb()
  const s = seedCadenceBase(db)
  const sent = []
  const broadcast = (acc, ev, data) => sent.push([acc, ev, data])
  await withServer(app => app.use('/api/cadences', authenticate, scopeToAccount, createCadencesRouter(db, { broadcast })), ({ base }) => fn({ db, s, base, sent }))
}

function montar(db, s) {
  const etapa = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, etapa.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const mensagem = addStep(db, s.accountId, etapa.id, { action_type: 'mensagem', auto_message: 'Catálogo' }).step_id
  const avulsa = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem' }, { action_type: 'ligacao' }] })
  const leadId = leadIn(db, s, 'qualificando', { attendant_id: s.atendenteId })
  const lcEtapa = ensureStageCadence(db, { leadId })
  const lcAvulsa = assignAvulsa(db, { accountId: s.accountId, cadenceId: avulsa.id, leadId })
  return { etapa, pergunta, mensagem, avulsa, leadId, lcEtapa, lcAvulsa }
}

test('gestor de outra conta recebe 404 em toda rota por id e nada muda', async () => {
  await comServidor(async ({ db, s, base }) => {
    const m = montar(db, s)
    const intruso = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Intruso', 'i@b.local', 'gerente')").run(s.otherAccountId).lastInsertRowid)
    const t = token({ id: intruso, role: 'gerente', accountId: s.otherAccountId })
    const casos = [
      ['GET', `/api/cadences/${m.etapa.id}`], ['PUT', `/api/cadences/${m.avulsa.id}`, { name: 'Hack' }], ['DELETE', `/api/cadences/${m.avulsa.id}`],
      ['PUT', `/api/cadences/${m.avulsa.id}/attempts`, { attempts: [] }], ['POST', `/api/cadences/${m.etapa.id}/steps`, { action_type: 'ligacao' }],
      ['PATCH', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, { auto_message: 'x' }], ['DELETE', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`],
      ['PUT', `/api/cadences/${m.etapa.id}/steps/order`, { attempt_ids: [m.mensagem, m.pergunta] }], ['GET', `/api/cadences/${m.etapa.id}/metrics`],
      ['POST', `/api/cadences/${m.avulsa.id}/assign`, { lead_id: m.leadId }], ['PUT', `/api/cadences/lead-cadence/${m.lcAvulsa.id}/advance`],
      ['DELETE', `/api/cadences/lead-cadence/${m.lcAvulsa.id}`], ['GET', `/api/cadences/lead/${m.leadId}`], ['GET', `/api/cadences/lead/${m.leadId}/stage`],
      ['POST', `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, { how: 'feito' }], ['GET', `/api/cadences/stage-view?funnel_id=${s.funnelId}`],
      ['PUT', `/api/cadences/funnels/${s.funnelId}/deviations`, { deviations: [] }],
    ]
    for (const [method, path, body] of casos) {
      const r = await peca(base, { method, path, jwtToken: t, body })
      assert.equal(r.status, 404, `${method} ${path} -> ${r.status}`)
    }
    assert.equal(getCadence(db, s.accountId, m.avulsa.id).name, 'Reativar')
    assert.equal(getCadence(db, s.accountId, m.etapa.id).attempts.length, 2)
    assert.equal(db.prepare('SELECT status FROM lead_cadences WHERE id = ?').get(m.lcAvulsa.id).status, 'active')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadence_steps').get().n, 0)
  })
})

test('atendente: 403 nas rotas do gestor e em lead que nao acessa; le a lista', async () => {
  await comServidor(async ({ db, s, base }) => {
    const m = montar(db, s)
    const t = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    for (const [method, path, body] of [
      ['POST', '/api/cadences', { name: 'X' }], ['PATCH', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, { auto_message: 'x' }],
      ['DELETE', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`], ['GET', `/api/cadences/stage-view?funnel_id=${s.funnelId}`],
      ['POST', `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.novo}/template`, { mode: 'bant' }],
    ]) {
      assert.equal((await peca(base, { method, path, jwtToken: t, body })).status, 403, `${method} ${path}`)
    }
    assert.equal((await peca(base, { path: '/api/cadences?kind=avulsa', jwtToken: t })).body.cadences.length, 1)
    const alheio = leadIn(db, s, 'qualificando') // sem atendente
    for (const [method, path, body] of [
      ['GET', `/api/cadences/lead/${alheio}/stage`], ['POST', `/api/cadences/${m.avulsa.id}/assign`, { lead_id: alheio }],
      ['POST', `/api/cadences/lead/${alheio}/steps/${m.mensagem}/done`, { how: 'feito' }],
    ]) {
      assert.equal((await peca(base, { method, path, jwtToken: t, body })).status, 403, `${method} ${path}`)
    }
    const meu = await peca(base, { path: `/api/cadences/lead/${m.leadId}/stage`, jwtToken: t })
    assert.equal(meu.status, 200)
    assert.equal(meu.body.next_attempt_id, m.pergunta)
  })
})

test('PATCH do passo por id mantem o id e o ponteiro do lead e avisa cadence:updated', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const m = montar(db, s)
    const t = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'PATCH', path: `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, jwtToken: t, body: { auto_message: 'Segue o catálogo, {nome}' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.step_id, m.mensagem)
    assert.equal(r.body.published, false)
    assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE id = ?').get(m.lcEtapa.id).current_attempt_id, m.pergunta)
    assert.deepEqual(sent.filter(x => x[1] === 'cadence:updated'), [[s.accountId, 'cadence:updated', { cadence_id: m.etapa.id, stage_id: s.stages.qualificando }]])
    const bad = await peca(base, { method: 'POST', path: `/api/cadences/${m.etapa.id}/steps`, jwtToken: t, body: { action_type: 'pergunta', question_key: 'naoexiste' } })
    assert.deepEqual([bad.status, bad.body.error], [400, 'Esta pergunta não está no roteiro da etapa.'])
  })
})

test('vendedor: Feito avanca e avisa lead:cadence; passo apagado -> 409; GET /lead/:id so traz a avulsa', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const m = montar(db, s)
    const tv = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const feito = await peca(base, { method: 'POST', path: `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, jwtToken: tv, body: { how: 'feito' } })
    assert.equal(feito.status, 200)
    assert.equal(feito.body.steps.find(x => x.attempt_id === m.mensagem).state, 'feito')
    assert.ok(sent.some(x => x[1] === 'lead:cadence' && x[2].lead_id === m.leadId))
    await peca(base, { method: 'DELETE', path: `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, jwtToken: tg })
    const velho = await peca(base, { method: 'POST', path: `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, jwtToken: tv, body: { how: 'feito' } })
    assert.deepEqual([velho.status, velho.body.error], [409, 'Esse passo mudou. A tela foi atualizada.'])
    const av = await peca(base, { path: `/api/cadences/lead/${m.leadId}`, jwtToken: tv })
    assert.equal(av.body.leadCadence.cadence_id, m.avulsa.id)
    assert.equal((await peca(base, { method: 'DELETE', path: `/api/cadences/lead-cadence/${m.lcEtapa.id}`, jwtToken: tv })).status, 400)
  })
})

test('super_admin sem conta -> 400; modelo BANT pela rota cria a cadencia da etapa', async () => {
  await comServidor(async ({ db, s, base }) => {
    const ts = token({ id: 1, role: 'super_admin' })
    assert.equal((await peca(base, { path: '/api/cadences', jwtToken: ts })).status, 400)
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'POST', path: `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.novo}/template`, jwtToken: tg, body: { mode: 'bant' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.cadence.attempts.length, 4)
    const ia = await peca(base, { method: 'POST', path: `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.proposta}/template`, jwtToken: tg, body: { mode: 'ia' } })
    assert.deepEqual([ia.status, ia.body.error], [503, 'A IA não está ligada nesta conta.'])
  })
})

test('tasks.js conclui e pula pelo servico com conta conferida', () => {
  const src = fs.readFileSync(new URL('../server/routes/tasks.js', import.meta.url), 'utf8')
  assert.equal((src.match(/completeCurrentStep\(db, \{ accountId: req\.accountId/g) || []).length, 2)
  assert.doesNotMatch(src, /SELECT \* FROM lead_cadences WHERE id = \?'\)\.get\(req\.params\.lcId\)/)
})

// ---- alem do brief: regras do controlador (PERF, D5, contas) ----

function temEtapaAtiva(db, leadId, cadenceId) {
  return !!db.prepare("SELECT 1 FROM lead_cadences WHERE lead_id = ? AND cadence_id = ? AND kind = 'etapa' AND status = 'active'").get(leadId, cadenceId)
}

test('so mudanca estrutural recalcula os leads da etapa; texto de passo so avisa a tela', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const m = montar(db, s)
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    // Lead que entrou na etapa sem passar pelo ensure: so o recalculo o pega.
    const novo = leadIn(db, s, 'qualificando')
    const caminho = `/api/cadences/${m.etapa.id}/steps`
    for (const body of [{ auto_message: 'Oi {nome}' }, { description: 'Mandar catálogo', delay_days: 2 }]) {
      assert.equal((await peca(base, { method: 'PATCH', path: `${caminho}/${m.mensagem}`, jwtToken: tg, body })).status, 200)
    }
    assert.equal((await peca(base, { method: 'PATCH', path: `${caminho}/${m.pergunta}`, jwtToken: tg, body: { instructions: 'Pergunte com calma' } })).status, 200)
    assert.equal(temEtapaAtiva(db, novo, m.etapa.id), false, 'edicao de texto nao recalcula')
    assert.equal(sent.filter(x => x[1] === 'cadence:updated').length, 3, 'mas a tela sempre e avisada')

    // Mudanca na pergunta (texto/obrigatoria/opcoes) e estrutural.
    const q = await peca(base, { method: 'PATCH', path: `${caminho}/${m.pergunta}`, jwtToken: tg, body: { question: { ...Q_PRAZO, text: 'Qual a data do evento?' } } })
    assert.equal(q.status, 200)
    assert.equal(q.body.published, true)
    assert.equal(temEtapaAtiva(db, novo, m.etapa.id), true)

    // Reordenar recalcula o ponteiro dos leads que ja estao na cadencia.
    const ord = await peca(base, { method: 'PUT', path: `${caminho}/order`, jwtToken: tg, body: { attempt_ids: [m.mensagem, m.pergunta] } })
    assert.equal(ord.status, 200)
    assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE id = ?').get(m.lcEtapa.id).current_attempt_id, m.mensagem)

    // Passo novo tambem.
    const outro = leadIn(db, s, 'qualificando')
    const add = await peca(base, { method: 'POST', path: caminho, jwtToken: tg, body: { action_type: 'ligacao', description: 'Ligar' } })
    assert.equal(add.status, 200)
    assert.equal(typeof add.body.step_id, 'number')
    assert.equal(temEtapaAtiva(db, outro, m.etapa.id), true)
  })
})

test('D5: cadencia da etapa criada ou reativada depois pega os leads que ja estao na etapa', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const a = leadIn(db, s, 'proposta')
    const b = leadIn(db, s, 'proposta')
    const arquivado = leadIn(db, s, 'proposta', { is_archived: 1 })
    const r = await peca(base, { method: 'POST', path: '/api/cadences', jwtToken: tg, body: { stage_id: s.stages.proposta, attempts: [{ action_type: 'mensagem', auto_message: 'Proposta enviada?' }] } })
    assert.equal(r.status, 200)
    const cid = r.body.cadence.id
    assert.equal(r.body.cadence.stage_id, s.stages.proposta)
    assert.deepEqual([temEtapaAtiva(db, a, cid), temEtapaAtiva(db, b, cid), temEtapaAtiva(db, arquivado, cid)], [true, true, false])
    assert.ok(sent.some(x => x[1] === 'cadence:updated' && x[2].cadence_id === cid && x[2].stage_id === s.stages.proposta))

    // Cadencia da etapa desativada (dado antigo) e reativada pela rota.
    const velha = createCadence(db, s.accountId, { stageId: s.stages.novo })
    addStep(db, s.accountId, velha.id, { action_type: 'ligacao' })
    db.prepare('UPDATE cadences SET is_active = 0 WHERE id = ?').run(velha.id)
    const c = leadIn(db, s, 'novo')
    const on = await peca(base, { method: 'PUT', path: `/api/cadences/${velha.id}`, jwtToken: tg, body: { is_active: true } })
    assert.equal(on.status, 200)
    assert.equal(on.body.cadence.is_active, 1)
    assert.equal(temEtapaAtiva(db, c, velha.id), true)

    // Desativar a da etapa continua proibido (Task 2); escrever em etapa inativa -> 409.
    assert.equal((await peca(base, { method: 'PUT', path: `/api/cadences/${velha.id}`, jwtToken: tg, body: { is_active: false } })).status, 400)
    db.prepare('UPDATE cadences SET is_active = 0 WHERE id = ?').run(velha.id)
    assert.equal((await peca(base, { method: 'POST', path: `/api/cadences/${velha.id}/steps`, jwtToken: tg, body: { action_type: 'ligacao' } })).status, 409)
  })
})

test('atendente sem acesso ao lead: 403 em advance/pausar/ver avulsa; passo da avulsa fora da vez -> 409', async () => {
  await comServidor(async ({ db, s, base }) => {
    const m = montar(db, s)
    const tv = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const alheio = leadIn(db, s, 'qualificando')
    const lcAlheio = assignAvulsa(db, { accountId: s.accountId, cadenceId: m.avulsa.id, leadId: alheio })
    for (const [method, path] of [
      ['PUT', `/api/cadences/lead-cadence/${lcAlheio.id}/advance`], ['DELETE', `/api/cadences/lead-cadence/${lcAlheio.id}`], ['GET', `/api/cadences/lead/${alheio}`],
    ]) {
      assert.equal((await peca(base, { method, path, jwtToken: tv })).status, 403, `${method} ${path}`)
    }
    assert.equal(db.prepare('SELECT status, current_attempt_id FROM lead_cadences WHERE id = ?').get(lcAlheio.id).status, 'active')

    const [primeiro, segundo] = getCadence(db, s.accountId, m.avulsa.id).attempts.map(a => a.id)
    const fora = await peca(base, { method: 'POST', path: `/api/cadences/lead/${m.leadId}/steps/${segundo}/done`, jwtToken: tv, body: { how: 'feito' } })
    assert.deepEqual([fora.status, fora.body.error], [409, 'Esse passo mudou. A tela foi atualizada.'])
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadence_steps').get().n, 0)

    // Avancar a propria avulsa devolve o formato antigo (leadCadenceView).
    const adv = await peca(base, { method: 'PUT', path: `/api/cadences/lead-cadence/${m.lcAvulsa.id}/advance`, jwtToken: tv })
    assert.equal(adv.status, 200)
    assert.equal(adv.body.leadCadence.current_attempt_id, segundo)
    assert.equal(adv.body.leadCadence.cadence_name, 'Reativar')
    assert.notEqual(primeiro, segundo)
  })
})

test('modelo com etapa de outro funil -> 404; sugestao e variante de outra conta -> 404', async () => {
  await comServidor(async ({ db, s, base }) => {
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const f2 = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil 2', 0, 1)").run(s.accountId).lastInsertRowid)
    const st2 = Number(db.prepare("INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, 'Outra', 0, 0, 0)").run(f2).lastInsertRowid)
    const r = await peca(base, { method: 'POST', path: `/api/cadences/funnels/${s.funnelId}/stages/${st2}/template`, jwtToken: tg, body: { mode: 'bant' } })
    assert.equal(r.status, 404)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadences WHERE stage_id = ?').get(st2).n, 0)
    for (const path of ['/api/cadences/suggestions/999999/apply', '/api/cadences/variants/999999/confirm']) {
      assert.equal((await peca(base, { method: 'POST', path, jwtToken: tg })).status, 404, path)
    }
  })
})

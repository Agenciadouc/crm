// Testes HTTP das rotas do Roteiro de Qualificacao + Termometro (gestor e vendedor).
// Sobem o router num Express nu, numa porta efemera, com banco em MEMORIA: nenhuma
// escrita no banco de producao. Padrao de test/agentBriefingHttp.test.js.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { authenticate, scopeToAccount, JWT_SECRET } from '../server/middleware/auth.js'
import { createRoteiroRouter } from '../server/routes/roteiroRouter.js'

function token({ id, role, accountId = null }) {
  return jwt.sign({ id, role, account_id: accountId }, JWT_SECRET)
}

// Requisicao crua com node:http: nao depende de fetch global nem de biblioteca.
function peca(base, { method = 'GET', path = '/', jwtToken, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + path)
    const dados = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
        ...(dados ? { 'Content-Length': dados.length } : {}),
      },
    }, res => {
      let bruto = ''
      res.setEncoding('utf8')
      res.on('data', c => { bruto += c })
      res.on('end', () => {
        let json = null
        try { json = bruto ? JSON.parse(bruto) : null } catch { json = null }
        resolve({ status: res.statusCode, body: json, raw: bruto })
      })
    })
    req.on('error', reject)
    if (dados) req.write(dados)
    req.end()
  })
}

async function comServidor(fn, { ai = null } = {}) {
  const db = createRoteiroTestDb()
  const app = express()
  app.use(express.json())
  app.use('/api/roteiro', authenticate, scopeToAccount, createRoteiroRouter(db, { ai }))
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ db, base })
  } finally {
    await new Promise(r => server.close(r))
  }
}

// 1 pergunta obrigatoria em cada uma das 2 primeiras etapas nao terminais.
function publishRoteiroDuasEtapas(db, accountId, funnelId, stages) {
  saveDraft(db, accountId, funnelId, {
    questions: [
      { stage_id: stages.novo, position: 0, text: 'Qual seu nome completo?', kind: 'text', required: true, bant: null, ai_hint: null },
      {
        stage_id: stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, bant: 'budget', ai_hint: null,
        options: [{ label: 'Até R$5 mil', points: 5 }, { label: 'Acima de R$20 mil', points: 15 }],
      },
    ],
    deviations: [],
  })
  return publish(db, accountId, funnelId, null)
}

function questionKeyForStage(published, stageId) {
  return published.questions.find(q => q.stage_id === stageId).question_key
}

// ---------------------------------------------------------------- gestor ----

test('gestor salva rascunho, publica e le o funil', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })

    const salvo = await peca(base, {
      method: 'PUT',
      path: `/api/roteiro/funnels/${funnelId}/draft`,
      jwtToken: t,
      body: {
        questions: [{ stage_id: stages.novo, position: 0, text: 'Qual seu nome?', kind: 'text', required: true, bant: null, ai_hint: null }],
        deviations: [],
      },
    })
    assert.equal(salvo.status, 200)
    assert.equal(salvo.body.status, 'draft')
    assert.equal(salvo.body.questions.length, 1)

    const publicado = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/publish`, jwtToken: t, body: {} })
    assert.equal(publicado.status, 200)
    assert.equal(publicado.body.status, 'published')
    assert.equal(publicado.body.version, 1)

    const lido = await peca(base, { path: `/api/roteiro/funnels/${funnelId}`, jwtToken: t })
    assert.equal(lido.status, 200)
    assert.ok(lido.body.draft, 'a versao rascunho continua na lista de versoes')
    assert.ok(lido.body.published)
    assert.equal(lido.body.funnel.id, funnelId)
  })
})

test('atendente recebe 403 nas rotas de gestor', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId } = seedRoteiroBase(db)
    const t = token({ id: 5, role: 'atendente', accountId })
    for (const [method, path] of [
      ['GET', `/api/roteiro/funnels/${funnelId}`],
      ['PUT', `/api/roteiro/funnels/${funnelId}/draft`],
      ['POST', `/api/roteiro/funnels/${funnelId}/publish`],
      ['POST', '/api/roteiro/versions/1/restore'],
      ['POST', `/api/roteiro/funnels/${funnelId}/bant-template`],
      ['POST', `/api/roteiro/funnels/${funnelId}/ai-draft`],
      ['GET', `/api/roteiro/performance?funnel_id=${funnelId}`],
      ['GET', '/api/roteiro/settings'],
      ['PUT', '/api/roteiro/settings'],
      ['GET', '/api/roteiro/suggestions'],
      ['POST', '/api/roteiro/suggestions/1/test'],
      ['POST', '/api/roteiro/suggestions/1/apply'],
      ['POST', '/api/roteiro/suggestions/1/reject'],
      ['POST', '/api/roteiro/variants/1/confirm'],
      ['POST', '/api/roteiro/variants/1/keep'],
    ]) {
      const r = await peca(base, { method, path, jwtToken: t, body: {} })
      assert.equal(r.status, 403, `${method} ${path} devia ser 403 para atendente`)
    }
  })
})

test('modelo BANT e restaurar versao', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })

    const bant = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/bant-template`, jwtToken: t, body: {} })
    assert.equal(bant.status, 200)
    assert.equal(bant.body.questions.length, 4, 'as 4 perguntas BANT')

    const publicado = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/publish`, jwtToken: t, body: {} })
    assert.equal(publicado.status, 200)
    const versionId = publicado.body.id

    // Rascunho vazio some com as perguntas; restaurar a versao publicada traz de volta.
    await peca(base, { method: 'PUT', path: `/api/roteiro/funnels/${funnelId}/draft`, jwtToken: t, body: { questions: [], deviations: [] } })
    const restaurado = await peca(base, { method: 'POST', path: `/api/roteiro/versions/${versionId}/restore`, jwtToken: t, body: {} })
    assert.equal(restaurado.status, 200)
    assert.equal(restaurado.body.questions.length, 4)
  })
})

test('ai-draft sem IA configurada devolve 503 em portugues', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })
    const r = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/ai-draft`, jwtToken: t, body: {} })
    assert.equal(r.status, 503)
    assert.equal(r.body.error, 'A IA não está ligada nesta conta.')
  })
})

test('ai-draft de funil de outra conta continua dando 404 (nao 503)', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, otherAccountId, funnelId } = seedRoteiroBase(db)
    db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestor B', 'b@b.local', 'gerente')").run(otherAccountId)
    void accountId
    const tB = token({ id: 998, role: 'gerente', accountId: otherAccountId })
    const r = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/ai-draft`, jwtToken: tB, body: {} })
    assert.equal(r.status, 404)
  })
})

test('PUT /settings fora da faixa -> 400, dentro da faixa salva e GET confere', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })

    const foraDaFaixa = await peca(base, { method: 'PUT', path: '/api/roteiro/settings', jwtToken: t, body: { min_reply_rate: 5, reply_window_h: 24, alert_minutes: 60 } })
    assert.equal(foraDaFaixa.status, 400)
    assert.match(foraDaFaixa.body.error, /entre 10 e 100/)

    const foraDaJanela = await peca(base, { method: 'PUT', path: '/api/roteiro/settings', jwtToken: t, body: { min_reply_rate: 70, reply_window_h: 200, alert_minutes: 60 } })
    assert.equal(foraDaJanela.status, 400)

    const ok = await peca(base, { method: 'PUT', path: '/api/roteiro/settings', jwtToken: t, body: { min_reply_rate: 80, reply_window_h: 48, alert_minutes: 30 } })
    assert.equal(ok.status, 200)
    assert.deepEqual(ok.body, { min_reply_rate: 80, reply_window_h: 48, alert_minutes: 30 })

    const lido = await peca(base, { path: '/api/roteiro/settings', jwtToken: t })
    assert.deepEqual(lido.body, { min_reply_rate: 80, reply_window_h: 48, alert_minutes: 30 })
  })
})

test('GET /performance e /suggestions sem dados devolvem listas vazias', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })
    publishRoteiroDuasEtapas(db, accountId, funnelId, stages)

    const perf = await peca(base, { path: `/api/roteiro/performance?funnel_id=${funnelId}`, jwtToken: t })
    assert.equal(perf.status, 200)
    assert.equal(perf.body.questions.length, 2)
    assert.equal(perf.body.conversion.bands.length, 4)

    const sug = await peca(base, { path: '/api/roteiro/suggestions', jwtToken: t })
    assert.equal(sug.status, 200)
    assert.deepEqual(sug.body, { suggestions: [], tests: [] })
  })
})

test('super_admin sem account_id recebe 400 em vez de 500/vazio', async () => {
  await comServidor(async ({ base }) => {
    const t = token({ id: 1, role: 'super_admin' })
    const r = await peca(base, { path: '/api/roteiro/suggestions', jwtToken: t })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Selecione uma conta/)
  })
})

// ---------------------------------------------------------------- vendedor ----

test('atendente le o roteiro do proprio lead e responde; ultima obrigatoria avanca a etapa', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo, attendant_id: atendenteId })
    const t = token({ id: atendenteId, role: 'atendente', accountId })

    const lido = await peca(base, { path: `/api/roteiro/leads/${leadId}`, jwtToken: t })
    assert.equal(lido.status, 200)
    assert.equal(lido.body.has_roteiro, true)
    assert.equal(lido.body.can_force, false, 'atendente nao pode forcar avanco')
    assert.equal(lido.body.deviation, null)

    const qNome = questionKeyForStage(published, stages.novo)
    const respondido = await peca(base, {
      method: 'PUT', path: `/api/roteiro/leads/${leadId}/answers/${qNome}`, jwtToken: t, body: { answer_text: 'Maria Souza' },
    })
    assert.equal(respondido.status, 200)
    assert.ok(respondido.body.advanced, 'unica obrigatoria da etapa respondida -> avanco automatico')
    assert.equal(respondido.body.advanced.to, stages.qualificando)
    assert.equal(respondido.body.roteiro.stage_id, stages.qualificando)

    // Desfaz o avanco automatico.
    const desfeito = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/undo-advance`, jwtToken: t, body: {} })
    assert.equal(desfeito.status, 200)
    assert.equal(desfeito.body.result.moved, true)
    assert.equal(desfeito.body.roteiro.stage_id, stages.novo)
  })
})

test('atendente sem vinculo com o lead recebe 403', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const outroAtendenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Bia', 'bia@a.local', 'atendente')").run(accountId).lastInsertRowid)
    const leadId = addLead(db, { account_id: accountId, name: 'Sem Vinculo', funnel_id: funnelId, stage_id: stages.novo })
    const t = token({ id: outroAtendenteId, role: 'atendente', accountId })

    const r = await peca(base, { path: `/api/roteiro/leads/${leadId}`, jwtToken: t })
    assert.equal(r.status, 403)
  })
})

test('gate devolve pendentes entre etapas', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const leadId = addLead(db, { account_id: accountId, name: 'Joao', funnel_id: funnelId, stage_id: stages.novo })
    const t = token({ id: 999, role: 'gerente', accountId })

    const gate = await peca(base, { path: `/api/roteiro/leads/${leadId}/gate?to_stage_id=${stages.proposta}`, jwtToken: t })
    assert.equal(gate.status, 200)
    assert.equal(gate.body.ok, false)
    assert.equal(gate.body.pending.length, 2, 'as 2 obrigatorias de novo e qualificando ainda faltam')

    const qNome = questionKeyForStage(published, stages.novo)
    await peca(base, { method: 'PUT', path: `/api/roteiro/leads/${leadId}/answers/${qNome}`, jwtToken: t, body: { answer_text: 'Joao' } })

    const gate2 = await peca(base, { path: `/api/roteiro/leads/${leadId}/gate?to_stage_id=${stages.proposta}`, jwtToken: t })
    // A resposta da 1a pergunta avanca automaticamente para "qualificando"; so falta a de la.
    assert.equal(gate2.body.pending.length, 1)
  })
})

test('lead e funil de outra conta -> 404 mesmo para gestor', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, otherAccountId, funnelId, stages } = seedRoteiroBase(db)
    const gerenteBId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestor B', 'b@b.local', 'gerente')").run(otherAccountId).lastInsertRowid)
    const leadId = addLead(db, { account_id: accountId, name: 'Da Conta A', funnel_id: funnelId, stage_id: stages.novo })
    const tB = token({ id: gerenteBId, role: 'gerente', accountId: otherAccountId })

    const funilOutraConta = await peca(base, { path: `/api/roteiro/funnels/${funnelId}`, jwtToken: tB })
    assert.equal(funilOutraConta.status, 404)

    const leadOutraConta = await peca(base, { path: `/api/roteiro/leads/${leadId}`, jwtToken: tB })
    assert.equal(leadOutraConta.status, 404)

    const publicarOutraConta = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/publish`, jwtToken: tB, body: {} })
    assert.equal(publicarOutraConta.status, 404, 'funil de outra conta: nem publicar enxerga')
  })
})

test('POST /leads/:leadId/asks registra o envio reconhecido', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const leadId = addLead(db, { account_id: accountId, name: 'Carla', funnel_id: funnelId, stage_id: stages.novo })
    const msgId = Number(db.prepare("INSERT INTO messages (lead_id, account_id, direction, content) VALUES (?, ?, 'outbound', 'Qual seu nome?')").run(leadId, accountId).lastInsertRowid)
    const t = token({ id: 999, role: 'gerente', accountId })
    const qNome = questionKeyForStage(published, stages.novo)

    const r = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/asks`, jwtToken: t, body: { question_key: qNome, message_id: msgId } })
    assert.equal(r.status, 201)
    assert.ok(r.body.ask_id)
    const row = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(r.body.ask_id)
    assert.equal(row.source, 'recognized')
    assert.equal(row.text_sent, 'Qual seu nome?')
  })
})

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
import { variantFor } from '../server/services/roteiro/variants.js'
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

async function comServidor(fn, { ai = null, broadcast } = {}) {
  const db = createRoteiroTestDb()
  const app = express()
  app.use(express.json())
  app.use('/api/roteiro', authenticate, scopeToAccount, createRoteiroRouter(db, { ai, broadcast }))
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
      { stage_id: stages.novo, position: 0, text: 'Qual seu nome completo?', kind: 'text', required: true, spin: null, ai_hint: null },
      {
        stage_id: stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, spin: 'need_payoff', ai_hint: null,
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
        questions: [{ stage_id: stages.novo, position: 0, text: 'Qual seu nome?', kind: 'text', required: true, spin: null, ai_hint: null }],
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
      ['POST', `/api/roteiro/funnels/${funnelId}/spin-template`],
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

test('modelo SPIN e restaurar versao', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId } = seedRoteiroBase(db)
    const t = token({ id: 999, role: 'gerente', accountId })

    const bant = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/spin-template`, jwtToken: t, body: {} })
    assert.equal(bant.status, 200)
    assert.equal(bant.body.questions.length, 6, 'as 6 perguntas SPIN')

    const publicado = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/publish`, jwtToken: t, body: {} })
    assert.equal(publicado.status, 200)
    const versionId = publicado.body.id

    // Rascunho vazio some com as perguntas; restaurar a versao publicada traz de volta.
    await peca(base, { method: 'PUT', path: `/api/roteiro/funnels/${funnelId}/draft`, jwtToken: t, body: { questions: [], deviations: [] } })
    const restaurado = await peca(base, { method: 'POST', path: `/api/roteiro/versions/${versionId}/restore`, jwtToken: t, body: {} })
    assert.equal(restaurado.status, 200)
    assert.equal(restaurado.body.questions.length, 6)
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

test('ai-draft com IA e chave monta o rascunho; IA falhando -> 502 em portugues', async (t) => {
  t.mock.method(console, 'error', () => {})
  const respostas = [
    { toolUses: [{ id: 't', name: 'propose_roteiro', input: { questions: [], deviations: [] } }], usage: {}, costUsd: 0 },
    new Error('Anthropic API 529'),
  ]
  const ai = { isAvailable: () => true, call: async () => { const r = respostas.shift(); if (r instanceof Error) throw r; return r } }
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId } = seedRoteiroBase(db)
    db.prepare("UPDATE accounts SET anthropic_api_key = 'sk-teste' WHERE id = ?").run(accountId)
    const t = token({ id: 999, role: 'gerente', accountId })
    const ok = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/ai-draft`, jwtToken: t, body: {} })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.status, 'draft')
    assert.equal(ok.body.questions.filter(q => q.spin).length, 6)
    const falha = await peca(base, { method: 'POST', path: `/api/roteiro/funnels/${funnelId}/ai-draft`, jwtToken: t, body: {} })
    assert.equal(falha.status, 502)
    assert.equal(falha.body.error, 'A IA não respondeu agora. Monte à mão ou tente de novo.')
  }, { ai })
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

test('GET /conversion-by-band: gestor ve as 4 faixas; atendente recebe 403', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, gerenteId, atendenteId } = seedRoteiroBase(db)
    const r = await peca(base, { path: '/api/roteiro/conversion-by-band', jwtToken: token({ id: gerenteId, role: 'gerente', accountId }) })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.bands.map(b => b.band), ['frio', 'morno', 'quente', 'pronto'])
    assert.equal(r.body.warning, false)
    const a = await peca(base, { path: '/api/roteiro/conversion-by-band', jwtToken: token({ id: atendenteId, role: 'atendente', accountId }) })
    assert.equal(a.status, 403)
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

test('POST /leads/:leadId/asks com pergunta que nao esta no roteiro do lead devolve 400', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const leadId = addLead(db, { account_id: accountId, name: 'Carla', funnel_id: funnelId, stage_id: stages.novo })
    const msgId = Number(db.prepare("INSERT INTO messages (lead_id, account_id, direction, content) VALUES (?, ?, 'outbound', 'oi')").run(leadId, accountId).lastInsertRowid)
    const t = token({ id: 999, role: 'gerente', accountId })

    const r = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/asks`, jwtToken: t, body: { question_key: 'chave-que-nao-existe', message_id: msgId } })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /não está no roteiro/)
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM roteiro_asks').get().c, 0, 'nao pode gravar ask de chave invalida')
  })
})

test('POST /leads/:leadId/asks grava a variante realmente servida ao lead (B com teste A/B rodando e sorteio em B)', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const qNome = questionKeyForStage(published, stages.novo)
    const t = token({ id: 999, role: 'gerente', accountId })

    // Sugestao de novo texto pra pergunta + inicia o teste A/B pela propria rota do gestor.
    const suggestionId = Number(db.prepare(
      "INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json, status) VALUES (?, ?, ?, 'rewrite', ?, 'new')",
    ).run(accountId, funnelId, qNome, JSON.stringify({ text: 'Como você se chama?' })).lastInsertRowid)
    const iniciado = await peca(base, { method: 'POST', path: `/api/roteiro/suggestions/${suggestionId}/test`, jwtToken: t, body: {} })
    assert.equal(iniciado.status, 200)
    assert.equal(iniciado.body.variant.status, 'testing')

    // Sorteio fixo por lead+pergunta: cria leads ate achar um cujo sorteio cai em 'B'.
    let leadId = null
    for (let i = 0; i < 50 && !leadId; i++) {
      const candidateId = addLead(db, { account_id: accountId, name: `Lead ${i}`, funnel_id: funnelId, stage_id: stages.novo })
      if (variantFor(candidateId, qNome) === 'B') leadId = candidateId
    }
    assert.ok(leadId, 'nao achou lead com sorteio B em 50 tentativas (probabilidade ~2^-50)')

    const msgId = Number(db.prepare("INSERT INTO messages (lead_id, account_id, direction, content) VALUES (?, ?, 'outbound', 'Como você se chama?')").run(leadId, accountId).lastInsertRowid)
    const r = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/asks`, jwtToken: t, body: { question_key: qNome, message_id: msgId } })
    assert.equal(r.status, 201)
    const row = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(r.body.ask_id)
    assert.equal(row.variant, 'B', 'tem que gravar a variante realmente servida, nao sempre A')

    // A lista de testes traz os numeros de A e B para a tela do gestor
    const lista = await peca(base, { path: '/api/roteiro/suggestions', jwtToken: t })
    const [teste] = lista.body.tests
    assert.equal(teste.funnel_id, funnelId)
    assert.equal(teste.b.sent, 1)
    assert.equal(teste.a.sent, 0)
    assert.equal(teste.decided, false)
    assert.ok(teste.days_left > 0)
  })
})

test('gate, asks e undo-advance de lead de outra conta -> 404', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, otherAccountId, funnelId, stages } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const gerenteBId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestor B', 'b@b.local', 'gerente')").run(otherAccountId).lastInsertRowid)
    const leadId = addLead(db, { account_id: accountId, name: 'Da Conta A', funnel_id: funnelId, stage_id: stages.novo })
    const tB = token({ id: gerenteBId, role: 'gerente', accountId: otherAccountId })
    const qNome = questionKeyForStage(published, stages.novo)

    const gate = await peca(base, { path: `/api/roteiro/leads/${leadId}/gate?to_stage_id=${stages.proposta}`, jwtToken: tB })
    assert.equal(gate.status, 404)
    const asks = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/asks`, jwtToken: tB, body: { question_key: qNome } })
    assert.equal(asks.status, 404)
    const undo = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/undo-advance`, jwtToken: tB, body: {} })
    assert.equal(undo.status, 404)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_asks').get().n, 0)
  })
})

test('atendente sem vinculo com o lead recebe 403 nas rotas de escrita do vendedor', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages } = seedRoteiroBase(db)
    const published = publishRoteiroDuasEtapas(db, accountId, funnelId, stages)
    const outroAtendenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Bia', 'bia@a.local', 'atendente')").run(accountId).lastInsertRowid)
    const leadId = addLead(db, { account_id: accountId, name: 'Sem Vinculo', funnel_id: funnelId, stage_id: stages.novo })
    const t = token({ id: outroAtendenteId, role: 'atendente', accountId })
    const qNome = questionKeyForStage(published, stages.novo)

    const resp = await peca(base, { method: 'PUT', path: `/api/roteiro/leads/${leadId}/answers/${qNome}`, jwtToken: t, body: { answer_text: 'Maria' } })
    assert.equal(resp.status, 403)
    const asks = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/asks`, jwtToken: t, body: { question_key: qNome } })
    assert.equal(asks.status, 403)
    const undo = await peca(base, { method: 'POST', path: `/api/roteiro/leads/${leadId}/undo-advance`, jwtToken: t, body: {} })
    assert.equal(undo.status, 403)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_answers').get().n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_asks').get().n, 0)
  })
})

test('perfis da conta: gestor le e grava; atendente 403; limite de 6', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, atendenteId } = seedRoteiroBase(db)
    const tg = token({ id: 999, role: 'gerente', accountId })
    const ta = token({ id: atendenteId, role: 'atendente', accountId })
    assert.equal((await peca(base, { path: '/api/roteiro/profiles', jwtToken: ta })).status, 403)
    assert.equal((await peca(base, { method: 'PUT', path: '/api/roteiro/profiles', jwtToken: ta, body: { profiles: [] } })).status, 403)
    const ok = await peca(base, { method: 'PUT', path: '/api/roteiro/profiles', jwtToken: tg, body: { business_objective: 'revender limpeza', profiles: [{ name: 'Loja', description: 'mercadinho' }] } })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.profiles[0].name, 'Loja')
    const lido = await peca(base, { path: '/api/roteiro/profiles', jwtToken: tg })
    assert.equal(lido.body.business_objective, 'revender limpeza')
    const muitos = await peca(base, { method: 'PUT', path: '/api/roteiro/profiles', jwtToken: tg, body: { profiles: Array.from({ length: 7 }, (_, i) => ({ name: `P${i}` })) } })
    assert.deepEqual([muitos.status, muitos.body.error], [400, 'Máximo de 6 perfis.'])
  })
})

test('perfil do lead: vendedor com acesso grava manual, avisa a cadencia; invalido 400; sem acesso 403', async () => {
  const avisos = []
  await comServidor(async ({ db, base }) => {
    const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
    const tg = token({ id: 999, role: 'gerente', accountId })
    const ta = token({ id: atendenteId, role: 'atendente', accountId })
    const loja = (await peca(base, { method: 'PUT', path: '/api/roteiro/profiles', jwtToken: tg, body: { profiles: [{ name: 'Loja' }, { name: 'Porta' }] } })).body.profiles[0]
    const meu = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando, attendant_id: atendenteId })
    const outro = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando, attendant_id: 999 })
    const r = await peca(base, { method: 'PUT', path: `/api/roteiro/leads/${meu}/roteiro-profile`, jwtToken: ta, body: { profile_key: loja.profile_key } })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.profile_key, r.body.origin, r.body.profiles.length], [loja.profile_key, 'manual', 2])
    assert.deepEqual(avisos, [[accountId, 'lead:cadence', { lead_id: meu }]])
    const lido = await peca(base, { path: `/api/roteiro/leads/${meu}/roteiro-profile`, jwtToken: ta })
    assert.equal(lido.body.profile_key, loja.profile_key)
    const ruim = await peca(base, { method: 'PUT', path: `/api/roteiro/leads/${meu}/roteiro-profile`, jwtToken: ta, body: { profile_key: 'zz' } })
    assert.deepEqual([ruim.status, ruim.body.error], [400, 'Perfil inválido.'])
    assert.equal((await peca(base, { method: 'PUT', path: `/api/roteiro/leads/${outro}/roteiro-profile`, jwtToken: ta, body: { profile_key: null } })).status, 403)
  }, { broadcast: (...a) => avisos.push(a) })
})

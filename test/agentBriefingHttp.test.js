// Testes HTTP das 10 rotas da entrevista. Sobem o router num Express nu, numa
// porta efemera, com banco em MEMORIA e IA FALSA injetada: nenhuma chamada real
// de IA, nenhuma escrita no banco de producao.
//
// Existem por causa do defeito que passou por todas as revisoes de tarefa: o
// cliente do front nao mandava account_id, e o scopeToAccount deixa
// req.accountId NULO para super_admin sem esse parametro — que e exatamente o
// login do dono da agencia. Nada exercitava requireRole, scopeToAccount nem os
// envelopes; o unico teste de rota que existia cobria uma funcao pura.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import { createTestDb, seedContaCompleta } from './helpers/memoryDb.js'
import { authenticate, scopeToAccount, JWT_SECRET } from '../server/middleware/auth.js'
import { createAgentBriefingsRouter } from '../server/routes/agentBriefingsRouter.js'

const COMPILADO = {
  name: 'Ana Clara',
  persona: 'Cordial e objetiva.',
  knowledge_base: 'Vende curso de ingles online.',
  never_mention: 'preco',
  qualification_criteria: 'Qualificado quando souber nome e cidade',
  required_fields: ['name', 'city'],
  resumo: {
    quem_sou: 'Consultora do curso.',
    o_que_sei: 'Curso de ingles online.',
    o_que_descubro: ['Nivel do aluno'],
    o_que_nunca_falo: ['Preco'],
  },
}

// IA falsa: responde pergunta na entrevista e o JSON na compilacao. A fila de
// perguntas deixa o teste decidir quando a entrevista termina ('PRONTO').
function fakeAi(perguntas = ['O que sua empresa vende?']) {
  const calls = []
  const fila = [...perguntas]
  return {
    calls,
    ask: async (params) => {
      calls.push(params)
      if (params.source === 'compilacao') {
        return { content: JSON.stringify(COMPILADO), usage: { total: 10 }, costUsd: 0 }
      }
      const q = fila.length > 1 ? fila.shift() : fila[0]
      return { content: q, usage: { total: 10 }, costUsd: 0 }
    },
  }
}

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

async function comServidor(fn, { ai } = {}) {
  const db = createTestDb()
  const iaFalsa = ai || fakeAi()
  const app = express()
  app.use(express.json())
  app.use('/api/agent-briefings', authenticate, scopeToAccount, createAgentBriefingsRouter(db, {
    // A IA de producao cobra os tokens NO briefing: sem o briefingId o teto por
    // briefing nao funciona. Cada chamada tem que trazer os dois.
    makeAi: ({ accountId, briefingId }) => {
      assert.ok(accountId, 'makeAi sem accountId')
      assert.ok(briefingId, 'makeAi sem briefingId')
      return iaFalsa
    },
  }))
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ db, base, ai: iaFalsa })
  } finally {
    await new Promise(r => server.close(r))
  }
}

function contaAgentes(db) {
  return db.prepare('SELECT COUNT(*) AS c FROM ai_agents').get().c
}

// ---------------------------------------------------------------- papeis ----

test('super_admin SEM account_id nao cria briefing e recebe mensagem em portugues', async () => {
  await comServidor(async ({ db, base }) => {
    seedContaCompleta(db)
    const t = token({ id: 999, role: 'super_admin' })

    const criar = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    assert.equal(criar.status, 400, 'sem conta escolhida a criacao tem que ser recusada')
    assert.match(criar.body.error, /Selecione uma conta/)
    assert.ok(!/account_id required/.test(criar.raw), 'nada de ingles cru na tela do dono')

    const lista = await peca(base, { path: '/api/agent-briefings', jwtToken: t })
    assert.equal(lista.status, 400, 'a lista tambem avisa, em vez de devolver vazio em silencio')

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_briefings').get().c, 0)
  })
})

test('super_admin COM account_id usa a entrevista normalmente', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId } = seedContaCompleta(db)
    const t = token({ id: 999, role: 'super_admin' })

    const criar = await peca(base, { method: 'POST', path: `/api/agent-briefings?account_id=${accountId}`, jwtToken: t, body: {} })
    assert.equal(criar.status, 201)
    assert.equal(criar.body.question, 'O que sua empresa vende?')

    const lista = await peca(base, { path: `/api/agent-briefings?account_id=${accountId}`, jwtToken: t })
    assert.equal(lista.status, 200)
    assert.equal(lista.body.drafts.length, 1)

    const detalhe = await peca(base, { path: `/api/agent-briefings/${criar.body.briefing_id}?account_id=${accountId}`, jwtToken: t })
    assert.equal(detalhe.status, 200)
    assert.equal(detalhe.body.briefing.account_id, accountId)
    assert.ok(detalhe.body.atendimento, 'o resumo precisa do "Onde eu atendo"')
    assert.deepEqual(detalhe.body.atendimento.etapas, ['Novo', 'Em atendimento'])
    assert.equal(detalhe.body.atendimento.instancias.length, 1)
  })
})

test('gerente trabalha na propria conta, tirada do proprio token', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, userId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })

    const criar = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    assert.equal(criar.status, 201)
    const b = db.prepare('SELECT account_id, created_by FROM agent_briefings WHERE id = ?').get(criar.body.briefing_id)
    assert.equal(b.account_id, accountId)
    assert.equal(b.created_by, userId)
  })
})

test('atendente nao entra em nenhuma das rotas', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId } = seedContaCompleta(db)
    const t = token({ id: 5, role: 'atendente', accountId })
    for (const [method, path] of [
      ['POST', '/api/agent-briefings'],
      ['GET', '/api/agent-briefings'],
      ['GET', '/api/agent-briefings/1'],
      ['POST', '/api/agent-briefings/1/answer'],
      ['POST', '/api/agent-briefings/1/next-question'],
      ['POST', '/api/agent-briefings/1/paste'],
      ['POST', '/api/agent-briefings/1/compile'],
      ['POST', '/api/agent-briefings/1/activate'],
      ['DELETE', '/api/agent-briefings/1'],
      ['POST', '/api/agent-briefings/from-agent/1'],
    ]) {
      const r = await peca(base, { method, path, jwtToken: t, body: {} })
      assert.equal(r.status, 403, `${method} ${path} devia ser 403 para atendente`)
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_briefings').get().c, 0)
  })
})

test('sem token nenhum, nada passa', async () => {
  await comServidor(async ({ base }) => {
    const r = await peca(base, { method: 'POST', path: '/api/agent-briefings', body: {} })
    assert.equal(r.status, 401)
  })
})

// ---------------------------------------------------------------- conta ------

test('briefing de outra conta da 404, tanto para gerente quanto para super_admin', async () => {
  await comServidor(async ({ db, base }) => {
    const a = seedContaCompleta(db, { accountName: 'Conta A' })
    const b = seedContaCompleta(db, { accountName: 'Conta B' })

    const tokenA = token({ id: a.userId, role: 'gerente', accountId: a.accountId })
    const criado = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: tokenA, body: {} })
    assert.equal(criado.status, 201)
    const id = criado.body.briefing_id

    const tokenB = token({ id: b.userId, role: 'gerente', accountId: b.accountId })
    const lido = await peca(base, { path: `/api/agent-briefings/${id}`, jwtToken: tokenB })
    assert.equal(lido.status, 404)

    const apagado = await peca(base, { method: 'DELETE', path: `/api/agent-briefings/${id}`, jwtToken: tokenB })
    assert.equal(apagado.status, 404)

    const admin = token({ id: 999, role: 'super_admin' })
    const lidoAdmin = await peca(base, { path: `/api/agent-briefings/${id}?account_id=${b.accountId}`, jwtToken: admin })
    assert.equal(lidoAdmin.status, 404, 'super_admin escopado na conta errada tambem nao ve')

    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM agent_briefings').get().c, 1, 'o briefing da conta A continua la')
    const listaB = await peca(base, { path: '/api/agent-briefings', jwtToken: tokenB })
    assert.deepEqual(listaB.body.drafts, [])
  })
})

// ---------------------------------------------------------------- recurso ----

test('conta com o recurso de agentes desligado nao entrevista nem ativa', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, userId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })

    // Com o recurso ligado, chega ate o briefing compilado.
    const criado = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    const id = criado.body.briefing_id
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'curso de ingles' } })
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/compile`, jwtToken: t, body: {} })

    db.prepare('UPDATE accounts SET ai_agents_enabled = 0 WHERE id = ?').run(accountId)

    const ativar = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/activate`, jwtToken: t, body: {} })
    assert.equal(ativar.status, 403, 'recurso pago desligado nao pode criar agente')
    assert.equal(ativar.body.error, 'Recurso não habilitado nesta conta')
    assert.equal(contaAgentes(db), 0, 'REGRA DE SEGURANCA: nenhuma linha em ai_agents')

    const novo = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    assert.equal(novo.status, 403)
    const legado = await peca(base, { method: 'POST', path: '/api/agent-briefings/from-agent/1', jwtToken: t, body: {} })
    assert.equal(legado.status, 403)
  })
})

// ---------------------------------------------------------------- percurso ---

test('percurso completo: criar, responder, compilar e ativar', async () => {
  const ai = fakeAi(['O que sua empresa vende?', 'PRONTO'])
  await comServidor(async ({ db, base }) => {
    const { accountId, userId, stageIds, instanceId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })

    const criado = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    assert.equal(criado.status, 201)
    const id = criado.body.briefing_id

    const colado = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/paste`, jwtToken: t, body: { text: 'tabela de precos' } })
    assert.equal(colado.status, 200)

    const resposta = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'curso de ingles online' } })
    assert.equal(resposta.status, 200)
    assert.equal(resposta.body.done, true, 'a IA respondeu PRONTO, a entrevista encerra')

    const vazia = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: '   ' } })
    assert.equal(vazia.status, 400)

    const compilado = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/compile`, jwtToken: t, body: {} })
    assert.equal(compilado.status, 200)
    assert.equal(compilado.body.compiled.name, 'Ana Clara')

    // A PROVA da regra de seguranca inviolavel, como teste executavel.
    assert.equal(contaAgentes(db), 0, 'entrevistar e compilar NAO podem criar agente')

    const ativado = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/activate`, jwtToken: t, body: {} })
    assert.equal(ativado.status, 201)
    assert.equal(contaAgentes(db), 1, 'so o Ativar cria o agente')

    const agente = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(ativado.body.agent_id)
    assert.equal(agente.account_id, accountId)
    assert.equal(agente.mode, 'copilot', 'nasce em Copiloto: so sugere, nunca envia sozinho')
    assert.equal(agente.name, 'Ana Clara')

    // Nasceu ouvindo: sem estas duas amarracoes o findAgentForLead pula o agente.
    const etapas = db.prepare('SELECT stage_id FROM ai_agent_stages WHERE agent_id = ? ORDER BY stage_id').all(agente.id).map(x => x.stage_id)
    assert.deepEqual(etapas, [...stageIds].sort((x, y) => x - y))
    const instancias = db.prepare('SELECT instance_id FROM ai_agent_instances WHERE agent_id = ?').all(agente.id).map(x => x.instance_id)
    assert.deepEqual(instancias, [instanceId])

    const briefing = db.prepare('SELECT status, agent_id FROM agent_briefings WHERE id = ?').get(id)
    assert.equal(briefing.status, 'ativo')
    assert.equal(briefing.agent_id, agente.id)
  }, { ai })
})

test('corrigir depois de compilar marca o briefing para recompilar', async () => {
  const ai = fakeAi(['O que sua empresa vende?', 'PRONTO'])
  await comServidor(async ({ db, base }) => {
    const { accountId, userId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })

    const criado = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
    const id = criado.body.briefing_id
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'curso de ingles' } })
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/compile`, jwtToken: t, body: {} })

    const emDia = await peca(base, { path: `/api/agent-briefings/${id}`, jwtToken: t })
    assert.equal(emDia.body.briefing.precisa_recompilar, 0)

    // "Corrigir algo": a pessoa volta para a conversa e muda uma regra.
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'nao, preco a IA pode falar sim' } })

    const depois = await peca(base, { path: `/api/agent-briefings/${id}`, jwtToken: t })
    assert.equal(depois.body.briefing.precisa_recompilar, 1,
      'sem isso a tela mostraria o resumo velho e o agente nasceria sem a correcao')
  }, { ai })
})

test('rota inexistente de briefing devolve 404 sem vazar excecao', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, userId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })
    const r = await peca(base, { path: '/api/agent-briefings/4242', jwtToken: t })
    assert.equal(r.status, 404)
    assert.match(r.body.error, /não encontrado/i)
  })
})

// ---------------------------------------------------------------- ativacao ---

async function briefingCompilado(base, t) {
  const criado = await peca(base, { method: 'POST', path: '/api/agent-briefings', jwtToken: t, body: {} })
  const id = criado.body.briefing_id
  await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'curso de ingles' } })
  await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/compile`, jwtToken: t, body: {} })
  return id
}

test('ativar compilado velho (corrigido depois de compilar) da 409 e nao cria agente', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, userId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })
    const id = await briefingCompilado(base, t)
    await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/answer`, jwtToken: t, body: { text: 'pode falar o preco' } })

    const ativar = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/activate`, jwtToken: t, body: {} })
    assert.equal(ativar.status, 409)
    assert.match(ativar.body.error, /atualizar o resumo antes de ativar/)
    assert.equal(contaAgentes(db), 0)
  }, { ai: fakeAi(['O que sua empresa vende?', 'PRONTO']) })
})

test('conta sem numero ou sem etapa nao ativa: 409 com o que fazer primeiro', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, userId, funnelId } = seedContaCompleta(db)
    const t = token({ id: userId, role: 'gerente', accountId })
    const id = await briefingCompilado(base, t)

    db.prepare('DELETE FROM whatsapp_instances WHERE account_id = ?').run(accountId)
    const semNumero = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/activate`, jwtToken: t, body: {} })
    assert.equal(semNumero.status, 409)
    assert.match(semNumero.body.error, /Integrações/)

    db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'linha', 'connected')").run(accountId)
    db.prepare('DELETE FROM funnel_stages WHERE funnel_id = ?').run(funnelId)
    const semEtapa = await peca(base, { method: 'POST', path: `/api/agent-briefings/${id}/activate`, jwtToken: t, body: {} })
    assert.equal(semEtapa.status, 409)
    assert.match(semEtapa.body.error, /funil/)
    assert.equal(contaAgentes(db), 0)
  }, { ai: fakeAi(['O que sua empresa vende?', 'PRONTO']) })
})

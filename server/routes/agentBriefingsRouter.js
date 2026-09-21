// API da entrevista que monta o agente. Entrevista e compilacao rodam sempre na
// chave da Dros (drosAi), nao na chave da conta.
//
// Este modulo NAO importa server/db.js: ele monta o router a partir do db que
// recebe. E o que permite testar as 10 rotas de ponta a ponta com banco em
// memoria e IA falsa, sem abrir o banco real. O server/routes/agentBriefings.js
// e so a casca que injeta o db de producao.

import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { createDrosAi } from '../services/drosAi.js'
import { accountHasAiAgents } from '../services/accountFeature.js'
import { createBriefing, getBriefing, listDrafts, setCompiled, deleteBriefing } from '../services/briefingStore.js'
import { nextQuestion, answer } from '../services/agentInterview.js'
import { collectPastedText } from '../services/briefingSources/pastedText.js'
import { compileBriefing } from '../services/agentCompiler.js'
import { activateBriefing, resolveOndeAtende } from '../services/briefingActivate.js'
import { briefingFromAgent } from '../services/briefingFromAgent.js'

export function statusForError(error) {
  if (error === 'briefing_nao_encontrado' || error === 'agente_nao_encontrado') return 404
  if (error === 'dros_key_missing') return 503
  if (error === 'briefing_nao_compilado' || error === 'compilado_invalido') return 409
  if (error === 'briefing_desapareceu' || error === 'falha_ao_amarrar_agente_ao_briefing') return 409
  if (error === 'teto_de_tokens') return 409
  if (error === 'briefing_desatualizado' || error === 'sem_instancia' || error === 'sem_etapa') return 409
  if (error === 'pergunta_vazia' || error === 'saida_invalida') return 502
  return 400
}

// Lista fechada: nunca deixa texto cru de excecao (Anthropic, SQLite, etc)
// vazar para o cliente. Erro fora do mapa cai na mensagem generica, e o
// texto cru vai so para o console do servidor, com o codigo da rota.
const ERROR_MESSAGES = {
  briefing_nao_encontrado: 'Briefing não encontrado.',
  agente_nao_encontrado: 'Agente não encontrado.',
  dros_key_missing: 'A chave de IA da Dros não está configurada no servidor (ANTHROPIC_API_KEY_DROS).',
  briefing_nao_compilado: 'Este briefing ainda não foi compilado.',
  compilado_invalido: 'O conteúdo compilado deste briefing está inválido.',
  resposta_vazia: 'A resposta não pode ficar vazia.',
  texto_vazio: 'O texto colado não pode ficar vazio.',
  limite_de_materiais: 'Você já colou o máximo de materiais neste atendente. Continue pela conversa.',
  teto_de_tokens: 'Este briefing já usou todo o limite de IA. Use os ajustes avançados para terminar.',
  pergunta_vazia: 'A IA não conseguiu gerar a próxima pergunta. Tente novamente.',
  saida_invalida: 'A IA não conseguiu compilar o briefing num formato válido. Tente novamente.',
  briefing_desapareceu: 'O briefing foi alterado por outra operação. Tente novamente.',
  falha_ao_amarrar_agente_ao_briefing: 'Não foi possível vincular o agente ao briefing. Tente novamente.',
  briefing_desatualizado: 'Você corrigiu algo depois do último resumo. Recarregue a página para atualizar o resumo antes de ativar.',
  sem_instancia: 'Nenhum número de WhatsApp conectado — conecte um em Integrações e volte aqui para ativar.',
  sem_etapa: 'Nenhuma etapa de funil — crie o funil antes de ativar.',
}

const MENSAGEM_GENERICA = 'Ocorreu um erro ao processar o pedido.'

function fail(res, error, route) {
  console.error(`[${route}] error:`, error)
  const status = statusForError(error)
  const msg = ERROR_MESSAGES[error] || MENSAGEM_GENERICA
  return res.status(status).json({ error: msg })
}

// scopeToAccount deixa req.accountId NULO para super_admin que nao mandou
// ?account_id — que e justamente o login do dono da agencia. Sem esta guarda
// cada rota falharia de um jeito diferente, e em ingles cru na tela.
function exigeConta(req, res, next) {
  if (!req.accountId) return res.status(400).json({ error: 'Selecione uma conta antes de usar a entrevista.' })
  next()
}

export function createAgentBriefingsRouter(db, { makeAi } = {}) {
  const router = Router()
  const aiFor = (accountId, briefingId) => (
    makeAi ? makeAi({ accountId, briefingId }) : createDrosAi(db, { accountId, briefingId })
  )

  // Mesmo portao do POST /api/agents: sem o recurso pago ligado na conta,
  // a entrevista nao comeca e, principalmente, nao ativa agente nenhum.
  function exigeRecurso(req, res, next) {
    if (!accountHasAiAgents(db, req.accountId)) {
      return res.status(403).json({ error: 'Recurso não habilitado nesta conta' })
    }
    next()
  }

  const gerente = requireRole('super_admin', 'gerente')

  router.post('/', gerente, exigeConta, exigeRecurso, async (req, res) => {
    const briefingId = createBriefing(db, { accountId: req.accountId, userId: req.user.id })
    const r = await nextQuestion(db, { accountId: req.accountId, briefingId, ai: aiFor(req.accountId, briefingId) })
    if (!r.ok) {
      deleteBriefing(db, req.accountId, briefingId) // nao deixa rascunho morto se a IA nem respondeu
      return fail(res, r.error, 'POST /agent-briefings')
    }
    res.status(201).json({ briefing_id: briefingId, question: r.question, done: r.done })
  })

  router.get('/', gerente, exigeConta, (req, res) => {
    res.json({ drafts: listDrafts(db, req.accountId) })
  })

  router.get('/:id', gerente, exigeConta, (req, res) => {
    const b = getBriefing(db, req.accountId, req.params.id)
    if (!b) return fail(res, 'briefing_nao_encontrado', 'GET /agent-briefings/:id')
    // "Onde eu atendo" no resumo: a pessoa precisa ver as etapas e os numeros
    // ANTES de aprovar, porque e isso que a ativacao vai amarrar.
    const atendimento = resolveOndeAtende(db, { accountId: req.accountId, agentId: b.agent_id })
    res.json({ briefing: b, atendimento })
  })

  router.post('/:id/answer', gerente, exigeConta, async (req, res) => {
    const gravou = answer(db, { accountId: req.accountId, briefingId: req.params.id, text: (req.body || {}).text })
    if (!gravou.ok) return fail(res, gravou.error, 'POST /agent-briefings/:id/answer')
    const r = await nextQuestion(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req.accountId, req.params.id) })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/:id/answer')
    res.json({ done: r.done, question: r.question || null, reason: r.reason || null })
  })

  // So chama nextQuestion, sem gravar resposta: e o retry seguro depois de uma
  // falha da IA em /:id/answer, pra nao duplicar o turno do usuario que ja foi
  // gravado antes da IA falhar.
  router.post('/:id/next-question', gerente, exigeConta, async (req, res) => {
    const r = await nextQuestion(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req.accountId, req.params.id) })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/:id/next-question')
    res.json({ done: r.done, question: r.question || null, reason: r.reason || null })
  })

  router.post('/:id/paste', gerente, exigeConta, (req, res) => {
    const b = getBriefing(db, req.accountId, req.params.id)
    if (!b) return fail(res, 'briefing_nao_encontrado', 'POST /agent-briefings/:id/paste')
    const r = collectPastedText(db, { accountId: req.accountId, briefingId: b.id, text: (req.body || {}).text })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/:id/paste')
    res.json({ ok: true })
  })

  router.post('/:id/compile', gerente, exigeConta, async (req, res) => {
    const r = await compileBriefing(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req.accountId, req.params.id) })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/:id/compile')
    setCompiled(db, { accountId: req.accountId, briefingId: req.params.id, compiled: r.compiled })
    res.json({ compiled: r.compiled })
  })

  router.post('/:id/activate', gerente, exigeConta, exigeRecurso, (req, res) => {
    const b = req.body || {}
    const r = activateBriefing(db, {
      accountId: req.accountId,
      briefingId: req.params.id,
      mode: b.mode || 'copilot',
      instanceIds: Array.isArray(b.instance_ids) ? b.instance_ids : [],
    })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/:id/activate')
    res.status(201).json({ agent_id: r.agentId })
  })

  router.delete('/:id', gerente, exigeConta, (req, res) => {
    if (!deleteBriefing(db, req.accountId, req.params.id)) {
      return fail(res, 'briefing_nao_encontrado', 'DELETE /agent-briefings/:id')
    }
    res.json({ ok: true })
  })

  router.post('/from-agent/:agentId', gerente, exigeConta, exigeRecurso, (req, res) => {
    const r = briefingFromAgent(db, { accountId: req.accountId, agentId: req.params.agentId, userId: req.user.id })
    if (!r.ok) return fail(res, r.error, 'POST /agent-briefings/from-agent/:agentId')
    res.json({ briefing_id: r.briefingId })
  })

  return router
}

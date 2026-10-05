// Partes com IA do roteiro (spec 6.3, 6.4): extracao de respostas, montar com IA e
// sugestoes com IA. IA sempre falsa (fila de respostas por `source`): nunca toca a rede.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { saveDraft, publish, getRoteiro, RoteiroError } from '../server/services/roteiro/repo.js'
import { saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { recordAsk } from '../server/services/roteiro/asks.js'
import { maybeAutoAdvance, undoAutoAdvance } from '../server/services/roteiro/autoAdvance.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'
import { configureStageMoveHooks } from '../server/services/stageMove.js'
import { extractAnswers, createExtractQueue, EXTRACT_DELAY_MS } from '../server/services/roteiro/aiExtract.js'
import { buildAiDraft } from '../server/services/roteiro/aiDraft.js'
import { runAiLearning } from '../server/services/roteiro/aiLearning.js'
import { buildRoteiroAi, AI_UNAVAILABLE } from '../server/services/roteiro/aiCall.js'
import { runLearning } from '../server/services/roteiro/learning.js'
import { runScoreNightly } from '../server/services/leadScore/nightly.js'
import { bootRoteiroRuntime, bootRoteiroAi, enqueueAiExtract, setAiExtractHandler } from '../server/services/roteiro/runtime.js'

const NOW = new Date('2026-09-20T12:00:00Z')
const DAY = 86400000
const at = daysAgo => toSqliteDate(new Date(NOW.getTime() - daysAgo * DAY))

// IA falsa: fila de respostas por source. Item pode ser objeto, Error (lanca) ou funcao(params).
function fakeAi(queues = {}, { available = true } = {}) {
  const calls = []
  return {
    calls,
    isAvailable: () => available,
    call: async (params) => {
      calls.push(params)
      const q = queues[params.source] || []
      if (!q.length) throw new Error(`sem resposta falsa para ${params.source}`)
      let item = q.shift()
      if (typeof item === 'function') item = item(params)
      if (item instanceof Error) throw item
      return { usage: { input: 10, output: 5 }, costUsd: 0.0001, ...item }
    },
  }
}

const tool = (name, input) => ({ toolUses: [{ id: 't1', name, input }] })
// Responde conforme a ferramenta pedida (varias chamadas na mesma fila de source).
const byTool = map => p => map[p.tools[0].name] || { toolUses: [] }

test.afterEach(() => {
  configureStageMoveHooks({ onMoved: null })
  setAiExtractHandler(null)
})

// --- Extracao ------------------------------------------------------------------------

function setupExtract() {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [
      { question_key: 'orcamento', stage_id: s.stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true,
        ai_hint: 'valor que o cliente pretende gastar',
        options: [{ option_key: 'ate5', label: 'Até R$5 mil', points: 5 }, { option_key: 'acima20', label: 'Acima de R$20 mil', points: 15 }] },
      { question_key: 'prazo', stage_id: s.stages.qualificando, position: 1, text: 'Para quando você precisa?', kind: 'text', required: true },
      { question_key: 'decisor', stage_id: s.stages.proposta, position: 0, text: 'Quem decide?', kind: 'text', required: true },
    ],
    deviations: [{ triggers: 'pix, parcelar', reply_text: 'Aceitamos pix e cartão em até 10x.', return_question_key: 'orcamento' }],
  })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Maria' })
  addMessage(db, { leadId, direction: 'outbound', content: 'Qual sua faixa de orçamento?', minutesAgo: 10, userId: s.atendenteId })
  addMessage(db, { leadId, direction: 'inbound', content: 'Uns 25 mil, preciso até dezembro', minutesAgo: 5 })
  return { db, s, leadId }
}

const answer = (db, leadId, key) => db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, key)

test('extractAnswers: grava resposta de opcoes e de texto com origem ia, marca o ask e avanca a etapa', async () => {
  const { db, s, leadId } = setupExtract()
  const askId = recordAsk(db, { accountId: s.accountId, leadId, questionKey: 'orcamento', textSent: 'Qual sua faixa?', source: 'button' })
  const ai = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [
    { question_key: 'orcamento', option_key: 'acima20', evidence: 'Uns 25 mil' },
    { question_key: 'prazo', text: 'até dezembro', evidence: 'preciso até dezembro' },
  ] })] })

  const r = await extractAnswers(db, { accountId: s.accountId, leadId, ai })

  assert.deepEqual(r.saved.sort(), ['orcamento', 'prazo'])
  assert.equal(r.offscript, null)
  const a1 = answer(db, leadId, 'orcamento')
  assert.equal(a1.option_key, 'acima20')
  assert.equal(a1.origin, 'ia')
  assert.equal(a1.evidence, 'Uns 25 mil')
  assert.equal(answer(db, leadId, 'prazo').answer_text, 'até dezembro')
  assert.ok(db.prepare('SELECT answered_at FROM roteiro_asks WHERE id = ?').get(askId).answered_at)
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId).stage_id, s.stages.proposta)
  assert.equal(r.advanced.to, s.stages.proposta)

  const call = ai.calls[0]
  assert.equal(call.source, 'roteiro_extraction')
  assert.equal(call.accountId, s.accountId)
  assert.deepEqual(call.toolChoice, { type: 'tool', name: 'record_answers' })
  assert.equal(call.tools[0].name, 'record_answers')
  const prompt = JSON.stringify(call.messages)
  assert.match(prompt, /Cliente: Uns 25 mil/)
  assert.match(prompt, /Vendedor: Qual sua faixa/)
  assert.match(prompt, /acima20/)
  assert.match(prompt, /valor que o cliente pretende gastar/)
  assert.doesNotMatch(prompt, /decisor/) // so as pendentes da etapa atual
})

test('extractAnswers: ignora pergunta/opcao desconhecida e sem trecho; corta trecho em 300', async () => {
  const { db, s, leadId } = setupExtract()
  const ai = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [
    { question_key: 'inexistente', text: 'x', evidence: 'x' },
    { question_key: 'orcamento', option_key: 'nao-existe', evidence: 'Uns 25 mil' },
    { question_key: 'decisor', text: 'ela', evidence: 'ela decide' }, // fora da etapa atual
    { question_key: 'prazo', text: 'dezembro', evidence: '   ' },
  ] })] })
  const r = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.deepEqual(r.saved, [])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_answers').get().n, 0)

  const ai2 = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [{ question_key: 'prazo', text: 'dezembro', evidence: 'a'.repeat(400) }] })] })
  await extractAnswers(db, { accountId: s.accountId, leadId, ai: ai2 })
  assert.equal(answer(db, leadId, 'prazo').evidence.length, 300)
})

test('extractAnswers: nunca sobrescreve resposta manual', async () => {
  const { db, s, leadId } = setupExtract()
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: 'orcamento', optionKey: 'ate5', origin: 'manual', userId: s.atendenteId })
  const ai = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [
    { question_key: 'orcamento', option_key: 'acima20', evidence: 'Uns 25 mil' },
  ] })] })
  const r = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.deepEqual(r.saved, [])
  const a = answer(db, leadId, 'orcamento')
  assert.equal(a.origin, 'manual')
  assert.equal(a.option_key, 'ate5')
})

test('extractAnswers: pergunta fora do roteiro sem desvio grava roteiro_offscript; com desvio, nada', async () => {
  const { db, s, leadId } = setupExtract()
  const ai = fakeAi({ roteiro_extraction: [
    tool('record_answers', { answers: [], off_script: { question: 'Vocês atendem em Floripa?', suggested_reply: 'Atendemos sim!' } }),
    tool('record_answers', { answers: [], off_script: { question: 'Dá pra parcelar?', suggested_reply: 'Dá sim.' } }),
  ] })
  const r1 = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.deepEqual(r1.offscript, { question: 'Vocês atendem em Floripa?', suggested_reply: 'Atendemos sim!' })
  const rows = db.prepare('SELECT * FROM roteiro_offscript').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, 'Vocês atendem em Floripa?')
  assert.equal(rows[0].account_id, s.accountId)
  assert.equal(rows[0].lead_id, leadId)

  const r2 = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.equal(r2.offscript, null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_offscript').get().n, 1)
})

test('extractAnswers: mesma pergunta fora do roteiro do mesmo lead em 7 dias nao grava de novo', async () => {
  const { db, s, leadId } = setupExtract()
  const off = q => tool('record_answers', { answers: [], off_script: { question: q, suggested_reply: 'Atendemos sim!' } })
  const ai = fakeAi({ roteiro_extraction: [off('Vocês atendem em Floripa?'), off('  voces atendem em floripa  '), off('Vocês atendem em Floripa?')] })
  assert.ok((await extractAnswers(db, { accountId: s.accountId, leadId, ai })).offscript)
  assert.equal((await extractAnswers(db, { accountId: s.accountId, leadId, ai })).offscript, null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_offscript').get().n, 1)
  // Registro de mais de 7 dias nao conta como repeticao
  db.prepare("UPDATE roteiro_offscript SET detected_at = datetime('now', '-8 days')").run()
  assert.ok((await extractAnswers(db, { accountId: s.accountId, leadId, ai })).offscript)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_offscript').get().n, 2)
})

test('extractAnswers: sem pendente na etapa, sem roteiro ou IA indisponivel -> nao chama a IA', async () => {
  const { db, s, leadId } = setupExtract()
  const off = fakeAi({}, { available: false })
  assert.deepEqual(await extractAnswers(db, { accountId: s.accountId, leadId, ai: off }), { saved: [], offscript: null, advanced: null })
  assert.equal(off.calls.length, 0)

  const ai = fakeAi({})
  const leadNovo = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  await extractAnswers(db, { accountId: s.accountId, leadId: leadNovo, ai })
  const semFunil = addLead(db, { account_id: s.accountId })
  await extractAnswers(db, { accountId: s.accountId, leadId: semFunil, ai })
  assert.equal(ai.calls.length, 0)
  // Lead de outra conta: nao existe para esta conta
  await assert.rejects(extractAnswers(db, { accountId: s.otherAccountId, leadId, ai }), e => e instanceof RoteiroError && e.status === 404)
})

test('createExtractQueue: no maximo 1 extracao por lead a cada 2 min, com o payload mais novo', async () => {
  assert.equal(EXTRACT_DELAY_MS, 120000)
  const timers = []
  const ran = []
  const q = createExtractQueue({
    run: async p => { ran.push(p) },
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
  })
  q.enqueue({ lead: { id: 1 }, message: { id: 10 } })
  q.enqueue({ lead: { id: 1 }, message: { id: 11 } })
  q.enqueue({ lead: { id: 2 }, message: { id: 20 } })
  assert.equal(timers.length, 2)
  assert.equal(timers[0].ms, 120000)
  await timers[0].fn()
  assert.deepEqual(ran.map(p => p.message.id), [11])
  q.enqueue({ lead: { id: 1 }, message: { id: 12 } })
  assert.equal(timers.length, 3)
  await q.flushAll()
  assert.deepEqual(ran.map(p => p.message.id).sort(), [11, 12, 20])
})

test('bootRoteiroAi: mensagem recebida -> extracao na fila -> SSE lead:roteiro com o offscript', async () => {
  const { db, s, leadId } = setupExtract()
  const sse = []
  bootRoteiroRuntime({ db, broadcastSSE: (...a) => sse.push(a), triggerCapiForStageChange: () => {}, schedule: () => {} })
  const reply = () => tool('record_answers', { answers: [], off_script: { question: 'Tem estacionamento?', suggested_reply: 'Temos sim.' } })
  const ai = fakeAi({ roteiro_extraction: [reply(), reply()] })
  const queue = bootRoteiroAi({ db, ai, setTimer: () => 1, clearTimer: () => {} })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  enqueueAiExtract({ db, account: null, lead, message: { id: 1 } })
  await queue.flushAll()
  const ev = sse.find(e => e[1] === 'lead:roteiro')
  assert.deepEqual(ev, [s.accountId, 'lead:roteiro', { lead_id: leadId, offscript: { question: 'Tem estacionamento?', suggested_reply: 'Temos sim.' }, advanced: null }])
  // Mesma pergunta de novo na proxima janela: sem SSE repetido
  enqueueAiExtract({ db, account: null, lead, message: { id: 2 } })
  await queue.flushAll()
  assert.equal(ai.calls.length, 2)
  assert.equal(sse.filter(e => e[1] === 'lead:roteiro').length, 1)
})

test('bootRoteiroAi: IA completa a etapa -> SSE lead:roteiro leva o avanco (para o banner com Desfazer)', async () => {
  const { db, s, leadId } = setupExtract()
  const sse = []
  bootRoteiroRuntime({ db, broadcastSSE: (...a) => sse.push(a), triggerCapiForStageChange: () => {}, schedule: () => {} })
  const ai = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [
    { question_key: 'orcamento', option_key: 'acima20', evidence: 'Uns 25 mil' },
    { question_key: 'prazo', text: 'até dezembro', evidence: 'preciso até dezembro' },
  ] })] })
  const queue = bootRoteiroAi({ db, ai, setTimer: () => 1, clearTimer: () => {} })
  enqueueAiExtract({ db, account: null, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: { id: 1 } })
  await queue.flushAll()
  const ev = sse.find(e => e[1] === 'lead:roteiro')
  assert.deepEqual(ev[2].advanced, { from: s.stages.qualificando, to: s.stages.proposta, to_name: 'Proposta' })
})

test('resposta da IA nao desfaz o "Desfazer" do vendedor: lead nao avanca sozinho de novo', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [
      { question_key: 'orcamento', stage_id: s.stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'text', required: true },
      { question_key: 'prazo', stage_id: s.stages.qualificando, position: 1, text: 'Para quando você precisa?', kind: 'text', required: false },
    ],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Maria' })
  addMessage(db, { leadId, direction: 'inbound', content: 'Preciso até dezembro', minutesAgo: 5 })

  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: 'orcamento', answerText: '25 mil', origin: 'manual', userId: s.atendenteId })
  assert.ok(maybeAutoAdvance(db, { accountId: s.accountId, leadId }))
  undoAutoAdvance(db, { accountId: s.accountId, leadId, userId: s.atendenteId })

  const ai = fakeAi({ roteiro_extraction: [tool('record_answers', { answers: [{ question_key: 'prazo', text: 'dezembro', evidence: 'Preciso até dezembro' }] })] })
  const r = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.deepEqual(r.saved, ['prazo'])
  assert.equal(r.advanced, null)
  const lead = db.prepare('SELECT stage_id, roteiro_no_auto_from_stage FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.stage_id, s.stages.qualificando)
  assert.equal(lead.roteiro_no_auto_from_stage, s.stages.qualificando, 'resposta da IA mantem a trava')

  // resposta manual nova libera
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: 'orcamento', answerText: '30 mil', origin: 'manual', userId: s.atendenteId })
  assert.equal(db.prepare('SELECT roteiro_no_auto_from_stage AS v FROM leads WHERE id = ?').get(leadId).v, null)
})

// --- Adaptador (canAnalyze, chave, log de tokens) --------------------------------------

test('buildRoteiroAi: canAnalyze falso -> nao chama o modelo; ok -> chama com a chave e loga tokens com source', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const modelCalls = []
  const callModel = async (p) => { modelCalls.push(p); return { toolUses: [], usage: { input: 100, output: 20, cacheRead: 3, cacheCreation: 4 }, costUsd: 0.002 } }

  const off = buildRoteiroAi({ db, canAnalyze: () => ({ ok: false }), resolveKey: () => 'k', callModel })
  assert.equal(off.isAvailable(s.accountId), false)
  await assert.rejects(off.call({ accountId: s.accountId, source: 'roteiro_extraction', messages: [] }), e => e.code === AI_UNAVAILABLE)
  const noKey = buildRoteiroAi({ db, canAnalyze: () => ({ ok: true }), resolveKey: () => null, callModel })
  await assert.rejects(noKey.call({ accountId: s.accountId, source: 'roteiro_extraction', messages: [] }), e => e.code === AI_UNAVAILABLE)
  assert.equal(modelCalls.length, 0)

  const on = buildRoteiroAi({ db, canAnalyze: () => ({ ok: true }), resolveKey: () => 'chave-x', callModel })
  const r = await on.call({ accountId: s.accountId, leadId: 7, source: 'roteiro_draft', systemPrompt: 'sp', messages: [{ role: 'user', content: 'oi' }], tools: [], toolChoice: 'auto', maxTokens: 50 })
  assert.equal(r.costUsd, 0.002)
  assert.equal(modelCalls[0].apiKey, 'chave-x')
  assert.equal(modelCalls[0].accountId, s.accountId)
  const log = db.prepare('SELECT * FROM ai_agent_token_log').get()
  assert.equal(log.source, 'roteiro_draft')
  assert.equal(log.account_id, s.accountId)
  assert.equal(log.lead_id, 7)
  assert.equal(log.input_tokens, 100)
  assert.equal(log.output_tokens, 20)
  assert.equal(log.cost_usd, 0.002)
})

// --- Montar com IA ------------------------------------------------------------------

function setupDraft() {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO agent_briefings (account_id, status, compiled_json) VALUES (?, 'compilado', ?)").run(s.accountId, JSON.stringify({
    qualification_criteria: 'Tem evento marcado e orçamento acima de 10 mil',
    required_fields: ['name', 'city'],
    resumo: { o_que_descubro: ['data do evento', 'número de convidados'] },
  }))
  db.prepare("INSERT INTO agent_briefings (account_id, status, compiled_json) VALUES (?, 'compilado', ?)").run(s.otherAccountId, JSON.stringify({ qualification_criteria: 'CONTA B SECRETA' }))
  const comprou = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 1000, '2026-09-01')").run(s.accountId, comprou)
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, summary) VALUES (?, ?, 'Casamento em dezembro, fechou rápido')").run(s.accountId, comprou)
  const naoComprou = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, summary) VALUES (?, ?, 'Sumiu depois do preço')").run(s.accountId, naoComprou)
  return { db, s }
}

test('buildAiDraft: salva rascunho, completa as fases SPIN, corrige etapa invalida e liga o desvio a pergunta', async () => {
  const { db, s } = setupDraft()
  const ai = fakeAi({ roteiro_draft: [tool('propose_roteiro', {
    questions: [
      { stage_id: s.stages.qualificando, text: 'Qual a data do evento?', kind: 'text', required: true, ai_hint: 'data' },
      { stage_id: 99999, text: 'Quantos convidados?', kind: 'options', required: false,
        options: [{ label: 'Até 50', points: 5 }, { label: 'Mais de 50', points: 10 }] },
      { stage_id: s.stages.venda, text: 'Qual o orçamento?', kind: 'options', required: true, spin: 'need_payoff',
        options: [{ label: 'Até 10 mil', points: 0 }, { label: 'Acima de 10 mil', points: 80 }] },
      { stage_id: s.stages.qualificando, text: 'Opções sem opções', kind: 'options', options: [{ label: 'só uma', points: 1 }] },
      { stage_id: s.stages.qualificando, text: 'O que você precisa?', kind: 'text', spin: 'problem' },
    ],
    deviations: [{ triggers: 'preço, valor', reply_text: 'Depende do número de convidados.', return_question_index: 1 }],
  })] })

  const draft = await buildAiDraft(db, { accountId: s.accountId, funnelId: s.funnelId, ai })

  const rot = getRoteiro(db, s.accountId, s.funnelId)
  assert.equal(rot.published, null)
  assert.equal(rot.draft.id, draft.id)
  const qs = draft.questions
  const fases = qs.map(q => q.spin).filter(Boolean).sort()
  assert.deepEqual(fases, ['implication', 'implication', 'need_payoff', 'problem', 'problem', 'situation'])
  const convidados = qs.find(q => q.text === 'Quantos convidados?')
  assert.equal(convidados.stage_id, s.stages.novo) // 1a nao final
  const orcamento = qs.find(q => q.text === 'Qual o orçamento?')
  assert.equal(orcamento.stage_id, s.stages.novo) // etapa final nao tem pergunta
  assert.equal(orcamento.options[1].points, 50) // pontos no limite
  assert.equal(qs.find(q => q.text === 'Opções sem opções').kind, 'text')
  assert.equal(qs.find(q => q.text === 'O que você precisa?').spin, null) // fase SPIN so em opcoes
  assert.equal(qs.find(q => q.spin === 'problem').kind, 'options') // veio do modelo SPIN
  assert.equal(draft.deviations[0].return_question_key, convidados.question_key)

  const call = ai.calls[0]
  assert.equal(call.source, 'roteiro_draft')
  assert.equal(call.tools[0].name, 'propose_roteiro')
  const prompt = JSON.stringify(call.messages)
  assert.match(prompt, /data do evento/)
  assert.match(prompt, /Casamento em dezembro/)
  assert.doesNotMatch(prompt, /Sumiu depois do preço/)
  assert.doesNotMatch(prompt, /CONTA B SECRETA/)
  assert.doesNotMatch(prompt, /Venda|Perdido/) // so etapas nao finais
})

test('buildAiDraft: IA falhando ou sem ferramenta -> 502 em portugues', async (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const { db, s } = setupDraft()
  const ai = fakeAi({ roteiro_draft: [new Error('Anthropic API 529'), { toolUses: [] }] })
  for (let i = 0; i < 2; i++) {
    await assert.rejects(buildAiDraft(db, { accountId: s.accountId, funnelId: s.funnelId, ai }), e => {
      assert.ok(e instanceof RoteiroError)
      assert.equal(e.status, 502)
      assert.equal(e.code, 'ai_failed')
      assert.equal(e.message, 'A IA não respondeu agora. Monte à mão ou tente de novo.')
      return true
    })
  }
  assert.equal(getRoteiro(db, s.accountId, s.funnelId).draft, null)
  assert.equal(logged.mock.callCount(), 1) // so a falha da IA, sem chave no log
  await assert.rejects(buildAiDraft(db, { accountId: s.otherAccountId, funnelId: s.funnelId, ai }), e => e.status === 404)
})

// --- Sugestoes com IA ----------------------------------------------------------------

function setupLearning() {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [
      { question_key: 'q1', stage_id: s.stages.qualificando, position: 0, text: 'Qual seu orçamento?', kind: 'text' },
      { question_key: 'q2', stage_id: s.stages.qualificando, position: 1, text: 'Quem decide?', kind: 'text' },
      { question_key: 'q3', stage_id: s.stages.qualificando, position: 2, text: 'Qual o plano?', kind: 'options',
        options: [{ label: 'Básico', points: 0 }, { label: 'Pro', points: 10 }] },
    ],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  return { db, s, leadId }
}

function insertAsks(db, { accountId, leadId, questionKey, n, replied = 0, daysAgo = 1 }) {
  const stmt = db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, source, asked_at, replied_at)
    VALUES (?, ?, ?, 'A', 'texto', 'button', ?, ?)
  `)
  for (let i = 0; i < n; i++) stmt.run(accountId, leadId, questionKey, at(daysAgo), i < replied ? at(daysAgo) : null)
}

const suggestions = (db, accountId, type) => db.prepare('SELECT * FROM roteiro_suggestions WHERE account_id = ? AND type = ? ORDER BY id').all(accountId, type)
  .map(r => ({ ...r, payload: JSON.parse(r.payload_json) }))

const rewriteReply = tool('propose_rewrites', { rewrites: [{ question_key: 'q1', versions: ['Quanto você pensa em investir?', 'Tem um valor em mente?'] }, { question_key: 'q9', versions: ['a', 'b'] }] })

test('runAiLearning: rewrite com 2 versoes para pergunta fraca, sem duplicar na noite seguinte', async () => {
  const { db, s, leadId } = setupLearning()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 20, replied: 5 })
  const metricsByFunnel = await metricsFor(db, s)
  const ai = fakeAi({ roteiro_learning: [rewriteReply] })
  const r = await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai, now: NOW })
  assert.equal(r.created, 1)
  const [sg] = suggestions(db, s.accountId, 'rewrite')
  assert.equal(sg.question_key, 'q1')
  assert.equal(sg.funnel_id, s.funnelId)
  assert.deepEqual(sg.payload, { versions: ['Quanto você pensa em investir?', 'Tem um valor em mente?'], current_rate: 25 })
  assert.equal(ai.calls[0].source, 'roteiro_learning')

  const ai2 = fakeAi({ roteiro_learning: [rewriteReply] })
  const r2 = await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai: ai2, now: NOW })
  assert.equal(r2.created, 0)
  assert.equal(ai2.calls.length, 0) // nada novo pra pedir
  assert.equal(suggestions(db, s.accountId, 'rewrite').length, 1)
})

async function metricsFor(db, s) {
  const { questionMetrics } = await import('../server/services/roteiro/metrics.js')
  return { [s.funnelId]: questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW }) }
}

function seedTextAnswers(db, s, n) {
  for (let i = 0; i < n; i++) {
    const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, phone: `55489${i}` })
    db.prepare("INSERT INTO lead_answers (account_id, lead_id, question_key, answer_text, origin, answered_at) VALUES (?, ?, 'q2', ?, 'manual', ?)")
      .run(s.accountId, lead, i % 2 ? 'minha esposa' : 'eu e minha esposa', at(3))
  }
}

test('runAiLearning: respeita maxCalls', async () => {
  const { db, s, leadId } = setupLearning()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 20, replied: 5 })
  seedTextAnswers(db, s, 6)
  const metricsByFunnel = await metricsFor(db, s)
  const ai = fakeAi({ roteiro_learning: [rewriteReply, tool('group_answers', { groups: [{ question_key: 'q2', label: 'Com a esposa', count: 6 }] })] })
  const r = await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai, maxCalls: 1, now: NOW })
  assert.equal(ai.calls.length, 1)
  assert.equal(r.created, 1)
  assert.equal(suggestions(db, s.accountId, 'new_option').length, 0)
})

test('runAiLearning: new_option agrupa >= 5 respostas de texto; new_deviation com >= 3 fora do roteiro', async () => {
  const { db, s, leadId } = setupLearning()
  seedTextAnswers(db, s, 6)
  void leadId
  for (const t of ['Dá pra parcelar?', 'Parcela no cartão?', 'Aceita parcelado?']) {
    const outro = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, phone: `5548777${t.length}` })
    db.prepare('INSERT INTO roteiro_offscript (account_id, lead_id, text, detected_at) VALUES (?, ?, ?, ?)').run(s.accountId, outro, t, at(2))
  }
  const metricsByFunnel = await metricsFor(db, s)
  const ai = fakeAi({ roteiro_learning: [
    tool('group_answers', { groups: [{ question_key: 'q2', label: 'Com a esposa', count: 6 }, { question_key: 'q2', label: 'Pouco', count: 2 }, { question_key: 'zz', label: 'x', count: 9 }] }),
    tool('group_offscript', { deviations: [
      { triggers: 'parcelar, parcela, parcelado', reply_text: 'Parcelamos em até 10x.', return_question_key: 'q1', count: 3 },
      { triggers: 'frete', reply_text: 'x', return_question_key: 'q1', count: 1 },
    ] }),
  ] })
  await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai, now: NOW })
  const opts = suggestions(db, s.accountId, 'new_option')
  assert.equal(opts.length, 1)
  assert.deepEqual(opts[0].payload, { question_key: 'q2', label: 'Com a esposa', count: 6 })
  assert.equal(opts[0].question_key, 'q2')
  const devs = suggestions(db, s.accountId, 'new_deviation')
  assert.equal(devs.length, 1)
  assert.deepEqual(devs[0].payload, { triggers: 'parcelar, parcela, parcelado', reply_text: 'Parcelamos em até 10x.', return_question_key: 'q1', count: 3 })
  assert.equal(devs[0].funnel_id, s.funnelId)

  // Segunda noite: com sugestoes ainda abertas, a IA nem e chamada (textos reescritos nao viram cartao novo)
  const ai2 = fakeAi({ roteiro_learning: [
    tool('group_answers', { groups: [{ question_key: 'q2', label: 'Junto com a esposa', count: 6 }] }),
    tool('group_offscript', { deviations: [{ triggers: 'parcelamento, parcelas', reply_text: 'Parcelamos.', return_question_key: null, count: 3 }] }),
  ] })
  const r2 = await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai: ai2, now: NOW })
  assert.equal(r2.created, 0)
  assert.equal(ai2.calls.length, 0)
  assert.equal(suggestions(db, s.accountId, 'new_option').length, 1)
  assert.equal(suggestions(db, s.accountId, 'new_deviation').length, 1)

  // Recusadas: a IA volta a olhar
  db.prepare("UPDATE roteiro_suggestions SET status = 'rejected' WHERE account_id = ?").run(s.accountId)
  const ai3 = fakeAi({ roteiro_learning: [tool('group_answers', { groups: [] }), tool('group_offscript', { deviations: [] })] })
  await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai: ai3, now: NOW })
  assert.equal(ai3.calls.length, 2)
})

test('runAiLearning: um lead so repetindo a pergunta fora do roteiro nao vira desvio', async () => {
  const { db, s, leadId } = setupLearning()
  for (const t of ['Dá pra parcelar?', 'Parcela no cartão?', 'Aceita parcelado?', 'E parcelado?']) {
    db.prepare('INSERT INTO roteiro_offscript (account_id, lead_id, text, detected_at) VALUES (?, ?, ?, ?)').run(s.accountId, leadId, t, at(2))
  }
  const ai = fakeAi({ roteiro_learning: [tool('group_offscript', { deviations: [{ triggers: 'parcelar', reply_text: 'Sim.', count: 4 }] })] })
  const r = await runAiLearning(db, { accountId: s.accountId, metricsByFunnel: await metricsFor(db, s), ai, now: NOW })
  assert.equal(r.created, 0)
  assert.equal(ai.calls.length, 0)
})

test('runAiLearning: reorder quando a pergunta posterior responde >= 15 pts mais feita antes (regra calculada, IA so explica)', async () => {
  const { db, s } = setupLearning()
  // q2 (posicao 1) feita antes de q1: 10 de 10 respondem; feita depois: 3 de 10.
  const ask = db.prepare(`INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, source, asked_at, replied_at) VALUES (?, ?, ?, 'A', 'button', ?, ?)`)
  for (let i = 0; i < 20; i++) {
    const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, phone: `55480${i}` })
    if (i < 10) {
      ask.run(s.accountId, lead, 'q2', at(5), at(5))
      ask.run(s.accountId, lead, 'q1', at(4), at(4))
    } else {
      ask.run(s.accountId, lead, 'q1', at(5), at(5))
      ask.run(s.accountId, lead, 'q2', at(4), i < 13 ? at(4) : null)
    }
  }
  const metricsByFunnel = await metricsFor(db, s)
  const explain = tool('explain_reorders', { explanations: [{ stage_id: s.stages.qualificando, text: 'Perguntar quem decide antes do orçamento aumenta as respostas.' }] })
  const ai = fakeAi({ roteiro_learning: [1, 2, 3, 4].map(() => byTool({ explain_reorders: explain })) })
  await runAiLearning(db, { accountId: s.accountId, metricsByFunnel, ai, now: NOW })
  const [r] = suggestions(db, s.accountId, 'reorder')
  assert.ok(r)
  assert.equal(r.payload.stage_id, s.stages.qualificando)
  assert.deepEqual(r.payload.order, ['q2', 'q1', 'q3'])
  assert.equal(r.payload.gain, 70)
  assert.equal(r.payload.explanation, 'Perguntar quem decide antes do orçamento aumenta as respostas.')
})

test('runLearning com ai soma as sugestoes da IA; noturno so passa IA para conta liberada', async () => {
  const { db, s, leadId } = setupLearning()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 20, replied: 5 })
  const ai = fakeAi({ roteiro_learning: [rewriteReply] })
  const r = await runLearning(db, { accountId: s.accountId, now: NOW, ai })
  assert.equal(r.created, 1)
  assert.equal(suggestions(db, s.accountId, 'rewrite').length, 1)

  // Noturno: aiForAccount decide por conta
  const { db: db2, s: s2, leadId: l2 } = setupLearning()
  insertAsks(db2, { accountId: s2.accountId, leadId: l2, questionKey: 'q1', n: 20, replied: 5 })
  const ai2 = fakeAi({ roteiro_learning: [rewriteReply] })
  const asked = []
  await runScoreNightly(db2, { now: NOW, onBandUp: () => {}, aiForAccount: id => { asked.push(id); return id === s2.accountId ? ai2 : null } })
  assert.ok(asked.includes(s2.accountId))
  assert.equal(ai2.calls.length, 1)
  assert.equal(suggestions(db2, s2.accountId, 'rewrite').length, 1)
})

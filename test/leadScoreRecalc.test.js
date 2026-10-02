import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { gatherScoreInputs } from '../server/services/leadScore/inputs.js'
import {
  recalcLeadScore, createScoreScheduler, configureScoreRuntime, scheduleScore, SCORE_SCHEDULE_DELAY_MS,
} from '../server/services/leadScore/recalc.js'

// Publica 1 pergunta de opcoes "Orçamento" na etapa qualificando (spec 5.1, exemplo do brief).
function publishOrcamento(db, accountId, funnelId, stageId) {
  saveDraft(db, accountId, funnelId, {
    questions: [{
      stage_id: stageId, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, bant: 'budget', ai_hint: null,
      options: [
        { label: 'até R$5 mil', points: 0 },
        { label: 'R$5 a R$20 mil', points: 15 },
        { label: 'acima de R$20 mil', points: 30 },
      ],
    }],
    deviations: [],
  })
  return publish(db, accountId, funnelId, null).questions[0]
}

function addAnswer(db, accountId, leadId, questionKey, optionKey) {
  db.prepare(`
    INSERT INTO lead_answers (account_id, lead_id, question_key, option_key, answer_text, origin)
    VALUES (?, ?, ?, ?, NULL, 'manual')
  `).run(accountId, leadId, questionKey, optionKey)
}

// ---- gatherScoreInputs -----------------------------------------------------

test('gatherScoreInputs: fit, recencia, delay de resposta, termo de compra, avanco de etapa, IA e meia-vida', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const question = publishOrcamento(db, s.accountId, s.funnelId, s.stages.qualificando)
  const opt30 = question.options.find(o => o.points === 30)

  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead A', attendant_id: s.atendenteId })
  addAnswer(db, s.accountId, leadId, question.question_key, opt30.option_key)

  addMessage(db, { leadId, direction: 'outbound', content: 'Oi, tudo bem?', minutesAgo: 30, userId: s.atendenteId })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 25 })
  addMessage(db, { leadId, direction: 'inbound', content: 'oi de novo', minutesAgo: 0 })

  db.prepare(`INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, ?, ?, datetime('now', '-2 days'))`)
    .run(leadId, s.stages.novo, s.stages.qualificando)

  db.prepare(`INSERT INTO conversation_insights (account_id, lead_id, analyzed_at, temperatura_lead, chance_conversao) VALUES (?, ?, datetime('now', '-1 day'), 'quente', 80)`)
    .run(s.accountId, leadId)

  db.prepare('UPDATE accounts SET score_half_life_days = 10 WHERE id = ?').run(s.accountId)

  const input = gatherScoreInputs(db, leadId)

  // fit
  assert.equal(input.fit.obtained, 30)
  assert.equal(input.fit.max, 30)
  assert.equal(input.fit.answeredCount, 1)
  assert.equal(input.fit.totalCount, 1)
  assert.ok(input.fit.reasons.some(r => r.texto === 'Orçamento: acima de R$20 mil' && r.pontos === 30))

  // engajamento
  assert.ok(input.engagement.daysSinceLastInbound < 0.01, `daysSinceLastInbound deveria ser ~0, veio ${input.engagement.daysSinceLastInbound}`)
  assert.equal(input.engagement.replyDelaysMin.length, 1)
  assert.ok(Math.abs(input.engagement.replyDelaysMin[0] - 5) < 0.1, `delay deveria ser ~5min, veio ${input.engagement.replyDelaysMin[0]}`)
  assert.deepEqual(input.engagement.lastOutboundReplied, [true])
  assert.equal(input.engagement.strongSignalLast7d, false)
  assert.equal(input.engagement.weakSignalConfirmedLast7d, false)
  assert.equal(input.engagement.negativeSignalLast7d, false)
  assert.equal(input.engagement.advancedLast7d, true)
  assert.equal(input.engagement.halfLifeDays, 10)

  // ia
  assert.equal(input.ai.temperatura, 'quente')
  assert.equal(input.ai.chance, 80)
  assert.ok(Math.abs(input.ai.analyzedDaysAgo - 1) < 0.05, `analyzedDaysAgo deveria ser ~1, veio ${input.ai.analyzedDaysAgo}`)
})

test('gatherScoreInputs: lastOutboundReplied ordenado do mais recente pro mais antigo', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead B' })

  addMessage(db, { leadId, direction: 'outbound', content: 'Oi', minutesAgo: 500 })
  addMessage(db, { leadId, direction: 'inbound', content: 'Oi, tudo bem', minutesAgo: 480 }) // respondeu em 20min: sequencia antiga -> true
  addMessage(db, { leadId, direction: 'outbound', content: 'Fechou?', minutesAgo: 100 }) // sequencia mais nova, sem resposta -> false

  const input = gatherScoreInputs(db, leadId)
  assert.deepEqual(input.engagement.lastOutboundReplied, [false, true])
})

test('gatherScoreInputs: lead inexistente devolve null', () => {
  const db = createRoteiroTestDb()
  seedRoteiroBase(db)
  assert.equal(gatherScoreInputs(db, 999999), null)
})

// ---- recalcLeadScore --------------------------------------------------------

test('recalcLeadScore: grava as colunas de nota e score_prev recebe a nota anterior na 2a chamada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead C' })

  const r1 = recalcLeadScore(db, leadId)
  assert.ok(r1)
  let row = db.prepare('SELECT score, score_band, score_fit, score_fit_grade, score_engagement, score_quadrant, score_reasons_json, score_prev, score_at FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.score, r1.score)
  assert.equal(row.score_band, r1.band)
  assert.equal(row.score_fit, r1.fit)
  assert.equal(row.score_fit_grade, r1.fitGrade)
  assert.equal(row.score_engagement, r1.engagement)
  assert.equal(row.score_quadrant, r1.quadrant)
  assert.deepEqual(JSON.parse(row.score_reasons_json), r1.reasons)
  assert.equal(row.score_prev, null) // 1a vez: nao havia nota anterior
  assert.ok(row.score_at)

  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa isso?', minutesAgo: 0 })
  const r2 = recalcLeadScore(db, leadId)
  assert.ok(r2)
  row = db.prepare('SELECT score_prev FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.score_prev, r1.score)
})

test('recalcLeadScore: subir para quente/pronto chama onBandUp 1x e nao de novo no mesmo dia', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const question = publishOrcamento(db, s.accountId, s.funnelId, s.stages.qualificando)
  const opt30 = question.options.find(o => o.points === 30)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead D', attendant_id: s.atendenteId })
  addAnswer(db, s.accountId, leadId, question.question_key, opt30.option_key)
  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 0 })
  db.prepare(`INSERT INTO conversation_insights (account_id, lead_id, analyzed_at, temperatura_lead, chance_conversao) VALUES (?, ?, datetime('now'), 'quente', 80)`)
    .run(s.accountId, leadId)

  const calls = []
  const onBandUp = payload => calls.push(payload)

  const r1 = recalcLeadScore(db, leadId, { onBandUp })
  assert.ok(['quente', 'pronto'].includes(r1.band), `esperava quente/pronto, veio ${r1.band} (score ${r1.score})`)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].lead.id, leadId)
  assert.equal(calls[0].result.band, r1.band)
  let row = db.prepare('SELECT score_alerted_at FROM leads WHERE id = ?').get(leadId)
  assert.ok(row.score_alerted_at)
  const alertedFirst = row.score_alerted_at

  // 2a chamada: banda ja era quente/pronto -> nao e "subida" -> nao avisa de novo
  recalcLeadScore(db, leadId, { onBandUp })
  assert.equal(calls.length, 1)

  // simula uma queda de faixa no mesmo dia (score_alerted_at continua de hoje) e recalcula: mesmo "subindo" de novo, nao avisa 2x no dia
  db.prepare('UPDATE leads SET score_band = ? WHERE id = ?').run('frio', leadId)
  const r3 = recalcLeadScore(db, leadId, { onBandUp })
  assert.ok(['quente', 'pronto'].includes(r3.band))
  assert.equal(calls.length, 1)
  row = db.prepare('SELECT score_alerted_at FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.score_alerted_at, alertedFirst) // nao regravou score_alerted_at
})

test('recalcLeadScore: lead em etapa final (venda) nao recalcula', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Lead E' })

  const result = recalcLeadScore(db, leadId)
  assert.equal(result, null)
  const row = db.prepare('SELECT score FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.score, null)
})

test('recalcLeadScore: lead inexistente devolve null', () => {
  const db = createRoteiroTestDb()
  seedRoteiroBase(db)
  assert.equal(recalcLeadScore(db, 999999), null)
})

// ---- createScoreScheduler ---------------------------------------------------

test('createScoreScheduler: 10 schedules seguidos = 1 unico recalculo quando o timer dispara', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead F' })

  const timers = []
  const fakeSetTimer = (fn, delay) => { timers.push({ fn, delay }); return timers.length }

  const scheduler = createScoreScheduler({ db, setTimer: fakeSetTimer })
  for (let i = 0; i < 10; i++) scheduler.schedule(leadId)

  assert.equal(timers.length, 1) // agendamentos repetidos enquanto pendente sao ignorados
  assert.equal(timers[0].delay, SCORE_SCHEDULE_DELAY_MS)

  const before = db.prepare('SELECT score_at FROM leads WHERE id = ?').get(leadId)
  assert.equal(before.score_at, null)

  timers[0].fn() // dispara o timer
  const after = db.prepare('SELECT score_at FROM leads WHERE id = ?').get(leadId)
  assert.ok(after.score_at) // recalculou 1x

  // libera o id: um novo schedule depois do disparo cria um novo timer
  scheduler.schedule(leadId)
  assert.equal(timers.length, 2)
})

test('createScoreScheduler: nota mudou -> onChanged (SSE lead:score); igual -> nada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead G' })
  const changed = []
  const timers = []
  const scheduler = createScoreScheduler({ db, setTimer: fn => { timers.push(fn); return timers.length }, onChanged: x => changed.push(x) })

  scheduler.schedule(leadId); scheduler.flushAll()
  assert.equal(changed.length, 1, '1a nota: mudou de nada para algo')
  const row = db.prepare('SELECT score, score_band, account_id FROM leads WHERE id = ?').get(leadId)
  assert.deepEqual(changed[0], { lead: { id: leadId, account_id: s.accountId }, score: row.score, band: row.score_band })

  scheduler.schedule(leadId); scheduler.flushAll()
  assert.equal(changed.length, 1, 'mesma nota e faixa: sem aviso')

  // onChanged que falha nao derruba o recalculo
  const bad = createScoreScheduler({ db, setTimer: () => 1, onChanged: () => { throw new Error('sse fora') } })
  db.prepare('UPDATE leads SET score = NULL, score_band = NULL WHERE id = ?').run(leadId)
  bad.schedule(leadId); bad.flushAll()
  assert.ok(db.prepare('SELECT score FROM leads WHERE id = ?').get(leadId).score != null)
})

test('createScoreScheduler: flushAll roda os pendentes na hora', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId1 = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead F1' })
  const leadId2 = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead F2' })

  const timers = []
  const fakeSetTimer = fn => { timers.push(fn); return timers.length }
  const scheduler = createScoreScheduler({ db, setTimer: fakeSetTimer })
  scheduler.schedule(leadId1)
  scheduler.schedule(leadId2)

  scheduler.flushAll()

  for (const id of [leadId1, leadId2]) {
    const row = db.prepare('SELECT score_at FROM leads WHERE id = ?').get(id)
    assert.ok(row.score_at)
  }
})

test('createScoreScheduler: erro no recalculo agendado nao propaga, so loga [Termometro]', () => {
  const badDb = { prepare() { throw new Error('boom') } }
  const timers = []
  const fakeSetTimer = fn => { timers.push(fn); return timers.length }
  const scheduler = createScoreScheduler({ db: badDb, setTimer: fakeSetTimer })

  const originalError = console.error
  const logs = []
  console.error = (...args) => logs.push(args)
  try {
    scheduler.schedule(1)
    assert.doesNotThrow(() => timers[0]())
  } finally {
    console.error = originalError
  }
  assert.ok(logs.some(l => l[0] === '[Termometro]'))
})

// ---- configureScoreRuntime / scheduleScore (singleton de producao) ---------

test('configureScoreRuntime/scheduleScore: no-op antes de configurar; agenda depois de configurar', () => {
  assert.doesNotThrow(() => scheduleScore(999999)) // ainda nao configurado neste processo de teste

  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Lead G' })

  const originalSetTimeout = global.setTimeout
  let captured = null
  global.setTimeout = (fn, delay) => { captured = { fn, delay }; return 1 }
  try {
    configureScoreRuntime({ db, onBandUp: () => {} })
    scheduleScore(leadId)
  } finally {
    global.setTimeout = originalSetTimeout
  }

  assert.ok(captured)
  assert.equal(captured.delay, SCORE_SCHEDULE_DELAY_MS)
  captured.fn()
  const row = db.prepare('SELECT score FROM leads WHERE id = ?').get(leadId)
  assert.ok(row.score !== null)
})

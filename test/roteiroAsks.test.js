import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { recognizeQuestion } from '../server/services/roteiro/recognize.js'
import { recordAsk, markReplied, markAnswered, markAdvanced, markBought } from '../server/services/roteiro/asks.js'
import { matchDeviation, activeDeviationForLead } from '../server/services/roteiro/deviations.js'

// Insere um ask direto no banco com asked_at explicito (testes de janela nao passam por recordAsk).
function insertAsk(db, { accountId, leadId, questionKey, hoursAgo = 0, source = 'button' }) {
  return Number(db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, source, asked_at)
    VALUES (?, ?, ?, 'A', 'texto enviado', ?, datetime('now', ?))
  `).run(accountId, leadId, questionKey, source, `-${hoursAgo} hours`).lastInsertRowid)
}

// Insere uma mensagem com created_at explicito (para testar empate de timestamp por id).
function insertMessageAt(db, { leadId, accountId, direction, content, createdAt }) {
  return Number(db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, ?, ?, ?)
  `).run(leadId, accountId, direction, content, createdAt).lastInsertRowid)
}

function publishWithDeviation(db, accountId, funnelId, stages, returnQuestionKey = null) {
  saveDraft(db, accountId, funnelId, {
    questions: [
      { stage_id: stages.qualificando, position: 0, question_key: 'orcamento', text: 'Qual sua faixa de orçamento?', kind: 'text', required: false, spin: null, ai_hint: null },
    ],
    deviations: [
      { triggers: 'preço, quanto custa', reply_text: 'Os planos começam em R$500.', return_question_key: returnQuestionKey, position: 0 },
    ],
  })
  return publish(db, accountId, funnelId, null)
}

// --- recognize.js -----------------------------------------------------------------------

test('recognizeQuestion: reconhece pergunta parecida ignorando {nome} e stopwords', () => {
  const questions = [{ question_key: 'prazo', text: 'Qual o prazo do seu evento, {nome}?' }]
  const result = recognizeQuestion('Me conta, qual o prazo do seu evento?', questions)
  assert.ok(result)
  assert.equal(result.question_key, 'prazo')
  assert.equal(result.text, 'Qual o prazo do seu evento, {nome}?')
  assert.ok(result.similarity >= 0.6)
})

test('recognizeQuestion: mensagem sem relação com nenhuma pergunta -> null', () => {
  const questions = [{ question_key: 'prazo', text: 'Qual o prazo do seu evento, {nome}?' }]
  assert.equal(recognizeQuestion('Bom dia!', questions), null)
})

test('recognizeQuestion: similaridade abaixo de 0,6 -> null', () => {
  const questions = [{ question_key: 'orcamento', text: 'Qual sua faixa de orçamento para o evento, {nome}?' }]
  // palavras da pergunta (sem stopwords/curtas): faixa, orcamento, evento (3) ; mensagem só bate "evento" -> 1/3 < 0.6
  const result = recognizeQuestion('Qual o evento?', questions)
  assert.equal(result, null)
})

test('recognizeQuestion: pega a maior similaridade entre varias perguntas', () => {
  const questions = [
    { question_key: 'fraca', text: 'Qual sua faixa de orçamento, {nome}?' },
    { question_key: 'forte', text: 'Qual o prazo do seu evento, {nome}?' },
  ]
  const result = recognizeQuestion('Qual o prazo do evento?', questions)
  assert.ok(result)
  assert.equal(result.question_key, 'forte')
})

// --- asks.js ------------------------------------------------------------------------------

test('recordAsk: cria o ask e devolve o id', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })

  const id = recordAsk(db, { accountId, leadId, questionKey: 'q1', textSent: 'Qual seu orçamento?', source: 'button' })
  assert.ok(id > 0)

  const row = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(id)
  assert.equal(row.question_key, 'q1')
  assert.equal(row.variant, 'A')
  assert.equal(row.source, 'button')
  assert.ok(row.asked_at)
  assert.equal(row.replied_at, null)
})

test('markReplied: só marca asks abertos dentro da janela (ask de 30h atrás com janela de 24h não marca)', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const oldAskId = insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 30 })
  const recentAskId = insertAsk(db, { accountId, leadId, questionKey: 'q2', hoursAgo: 2 })

  const changed = markReplied(db, { leadId, windowHours: 24 })
  assert.equal(changed, 1)

  const oldRow = db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(oldAskId)
  const recentRow = db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(recentAskId)
  assert.equal(oldRow.replied_at, null)
  assert.ok(recentRow.replied_at)
})

test('markReplied: aceita "now" explícito para o cálculo da janela', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })

  const insertAskAt = (questionKey, askedAt) => Number(db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, source, asked_at)
    VALUES (?, ?, ?, 'A', 'texto', 'button', ?)
  `).run(accountId, leadId, questionKey, askedAt).lastInsertRowid)

  const insideId = insertAskAt('q1', '2026-01-01 11:00:00') // 1h30 antes do "now" fixado, dentro da janela de 24h
  const outsideId = insertAskAt('q2', '2025-12-30 00:00:00') // bem antes da janela de 24h

  const now = new Date('2026-01-01T12:30:00Z')
  const changed = markReplied(db, { leadId, windowHours: 24, now })
  assert.equal(changed, 1)

  const inside = db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(insideId)
  const outside = db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(outsideId)
  assert.equal(inside.replied_at, '2026-01-01 12:30:00')
  assert.equal(outside.replied_at, null)
})

test('markReplied: não marca de novo um ask que já tem replied_at', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 1 })
  markReplied(db, { leadId, windowHours: 24 })

  const changed = markReplied(db, { leadId, windowHours: 24 })
  assert.equal(changed, 0)
})

test('markAnswered: marca o ask mais recente sem answered_at da pergunta', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const firstAskId = insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 5 })
  const secondAskId = insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 1 })

  const changed = markAnswered(db, { leadId, questionKey: 'q1' })
  assert.equal(changed, 1)

  const first = db.prepare('SELECT answered_at FROM roteiro_asks WHERE id = ?').get(firstAskId)
  const second = db.prepare('SELECT answered_at FROM roteiro_asks WHERE id = ?').get(secondAskId)
  assert.equal(first.answered_at, null)
  assert.ok(second.answered_at)
})

test('markAdvanced: marca asks dos últimos 7 dias sem advanced_at, ignora os mais antigos', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const withinId = insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 24 * 3 })
  const outsideId = insertAsk(db, { accountId, leadId, questionKey: 'q2', hoursAgo: 24 * 10 })

  const changed = markAdvanced(db, { leadId })
  assert.equal(changed, 1)

  const within = db.prepare('SELECT advanced_at FROM roteiro_asks WHERE id = ?').get(withinId)
  const outside = db.prepare('SELECT advanced_at FROM roteiro_asks WHERE id = ?').get(outsideId)
  assert.ok(within.advanced_at)
  assert.equal(outside.advanced_at, null)
})

test('markBought: marca asks dos últimos 30 dias sem bought_at, ignora os mais antigos', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const withinId = insertAsk(db, { accountId, leadId, questionKey: 'q1', hoursAgo: 24 * 20 })
  const outsideId = insertAsk(db, { accountId, leadId, questionKey: 'q2', hoursAgo: 24 * 40 })

  const changed = markBought(db, { leadId })
  assert.equal(changed, 1)

  const within = db.prepare('SELECT bought_at FROM roteiro_asks WHERE id = ?').get(withinId)
  const outside = db.prepare('SELECT bought_at FROM roteiro_asks WHERE id = ?').get(outsideId)
  assert.ok(within.bought_at)
  assert.equal(outside.bought_at, null)
})

// --- deviations.js ------------------------------------------------------------------------

test('matchDeviation: casa gatilho normalizado contido no texto', () => {
  const deviations = [{ triggers: 'preço, quanto custa', reply_text: 'A partir de R$500.' }]
  const result = matchDeviation('Quanto CUSTA?', deviations)
  assert.ok(result)
  assert.equal(result.reply_text, 'A partir de R$500.')
})

test('matchDeviation: nenhum gatilho bate -> null', () => {
  const deviations = [{ triggers: 'preço, quanto custa', reply_text: 'A partir de R$500.' }]
  assert.equal(matchDeviation('Bom dia, tudo bem?', deviations), null)
})

test('matchDeviation: respeita fronteira de palavra (gatilho curto não casa dentro de outra palavra)', () => {
  const deviations = [{ triggers: 'preço, quanto custa, pix', reply_text: 'A partir de R$500.' }]
  assert.equal(matchDeviation('Comprei um pixel novo', deviations), null)
  const viaPix = matchDeviation('Posso pagar no pix?', deviations)
  assert.ok(viaPix)
  const viaMultiPalavra = matchDeviation('Quanto custa o pacote?', deviations)
  assert.ok(viaMultiPalavra)
})

test('activeDeviationForLead: casa com o último inbound dentro de 24h', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishWithDeviation(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'Quanto custa o pacote?', minutesAgo: 30 })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const result = activeDeviationForLead(db, { accountId, lead })
  assert.ok(result)
  assert.equal(result.reply_text, 'Os planos começam em R$500.')
  assert.equal(result.return_question_text, null)
})

test('activeDeviationForLead: some depois que sai uma mensagem outbound', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishWithDeviation(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'Quanto custa o pacote?', minutesAgo: 30 })
  addMessage(db, { leadId, direction: 'outbound', content: 'Os planos começam em R$500.', minutesAgo: 10 })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(activeDeviationForLead(db, { accountId, lead }), null)
})

test('activeDeviationForLead: outbound no mesmo segundo do inbound (id maior) faz o desvio sumir', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishWithDeviation(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const sameTimestamp = '2026-01-01 12:00:00'
  insertMessageAt(db, { leadId, accountId, direction: 'inbound', content: 'Quanto custa o pacote?', createdAt: sameTimestamp })
  insertMessageAt(db, { leadId, accountId, direction: 'outbound', content: 'Os planos começam em R$500.', createdAt: sameTimestamp })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const now = new Date('2026-01-01T12:30:00Z')
  assert.equal(activeDeviationForLead(db, { accountId, lead, now }), null)
})

test('activeDeviationForLead: inbound fora das últimas 24h -> null', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishWithDeviation(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'Quanto custa o pacote?', minutesAgo: 60 * 30 })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(activeDeviationForLead(db, { accountId, lead }), null)
})

test('activeDeviationForLead: devolve o texto da pergunta de volta quando houver return_question_key', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishWithDeviation(db, accountId, funnelId, stages, 'orcamento')
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'Quanto custa o pacote?', minutesAgo: 5 })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const result = activeDeviationForLead(db, { accountId, lead })
  assert.ok(result)
  assert.equal(result.return_question_key, 'orcamento')
  assert.equal(result.return_question_text, 'Qual sua faixa de orçamento?')
})

test('activeDeviationForLead: lead sem funnel_id -> null', () => {
  const db = createRoteiroTestDb()
  const { accountId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(activeDeviationForLead(db, { accountId, lead }), null)
})

test('activeDeviationForLead: funil sem roteiro publicado -> null', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'Quanto custa o pacote?', minutesAgo: 5 })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(activeDeviationForLead(db, { accountId, lead }), null)
})

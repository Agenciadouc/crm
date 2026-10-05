import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'
import { configureScoreRuntime, getRuntimeOnBandUp } from '../server/services/leadScore/recalc.js'
import { runScoreNightly } from '../server/services/leadScore/nightly.js'

const DAY = 86400000

// Lead que sobe para quente/pronto: perfil cheio + mensagem agora + IA quente.
function makeHotLead(db, s, name = 'Lead Quente') {
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [{
      question_key: 'orc', stage_id: s.stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, spin: 'need_payoff',
      options: [{ option_key: 'baixo', label: 'até R$5 mil', points: 0 }, { option_key: 'alto', label: 'acima de R$20 mil', points: 30 }],
    }],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, null)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name, attendant_id: s.atendenteId })
  db.prepare(`INSERT INTO lead_answers (account_id, lead_id, question_key, option_key, origin) VALUES (?, ?, 'orc', 'alto', 'manual')`).run(s.accountId, leadId)
  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 0 })
  db.prepare(`INSERT INTO conversation_insights (account_id, lead_id, analyzed_at, temperatura_lead, chance_conversao) VALUES (?, ?, datetime('now'), 'quente', 80)`).run(s.accountId, leadId)
  return leadId
}

test('runScoreNightly: recalcula leads ativos, grava retrato do dia, apaga retratos > 120 dias e ajusta meia-vida', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const now = new Date()
  const today = toSqliteDate(now).slice(0, 10)
  db.prepare('UPDATE accounts SET score_half_life_days = 12 WHERE id = ?').run(s.accountId)

  const ativo = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  addMessage(db, { leadId: ativo, direction: 'inbound', minutesAgo: 10 })
  const arquivado = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, is_archived: 1 })
  const inativo = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, is_active: 0 })
  const vendido = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  const outraConta = addLead(db, { account_id: s.otherAccountId })

  const snap = db.prepare('INSERT INTO lead_score_daily (lead_id, account_id, day, score, band) VALUES (?, ?, ?, 10, ?)')
  snap.run(ativo, s.accountId, toSqliteDate(new Date(now.getTime() - 130 * DAY)).slice(0, 10), 'frio')
  snap.run(ativo, s.accountId, toSqliteDate(new Date(now.getTime() - 100 * DAY)).slice(0, 10), 'frio')

  const r = await runScoreNightly(db, { now, batchSize: 2, onBandUp: () => {} })
  assert.ok(r.leads >= 2)

  const scoreOf = id => db.prepare('SELECT score FROM leads WHERE id = ?').get(id).score
  assert.notEqual(scoreOf(ativo), null)
  assert.notEqual(scoreOf(outraConta), null)
  assert.equal(scoreOf(arquivado), null)
  assert.equal(scoreOf(inativo), null)
  assert.equal(scoreOf(vendido), null)

  const days = db.prepare('SELECT day FROM lead_score_daily WHERE lead_id = ? ORDER BY day').all(ativo).map(x => x.day)
  assert.equal(days.length, 2)
  assert.equal(days[1], today)
  assert.ok(!days.includes(toSqliteDate(new Date(now.getTime() - 130 * DAY)).slice(0, 10)))
  const todaySnap = db.prepare('SELECT * FROM lead_score_daily WHERE lead_id = ? AND day = ?').get(ativo, today)
  assert.equal(todaySnap.account_id, s.accountId)
  assert.equal(todaySnap.score, scoreOf(ativo))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_score_daily WHERE lead_id = ?').get(arquivado).n, 0)

  // < 5 vendas -> meia-vida padrao 7
  assert.equal(db.prepare('SELECT score_half_life_days FROM accounts WHERE id = ?').get(s.accountId).score_half_life_days, 7)

  // rodar de novo no mesmo dia nao duplica o retrato
  await runScoreNightly(db, { now, onBandUp: () => {} })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_score_daily WHERE lead_id = ? AND day = ?').get(ativo, today).n, 1)
})

test('runScoreNightly: faixa subindo chama o onBandUp passado', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = makeHotLead(db, s)
  const calls = []
  await runScoreNightly(db, { now: new Date(), onBandUp: p => calls.push(p) })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].lead.id, leadId)
  assert.ok(['quente', 'pronto'].includes(calls[0].result.band))
})

test('runScoreNightly: sem onBandUp usa o do runtime (configureScoreRuntime)', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = makeHotLead(db, s)
  const calls = []
  const onBandUp = p => calls.push(p)
  configureScoreRuntime({ db, onBandUp })
  assert.equal(getRuntimeOnBandUp(), onBandUp)
  await runScoreNightly(db, { now: new Date() })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].lead.id, leadId)
})

test('runScoreNightly: roda o aprendizado do roteiro por conta', async () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [{ question_key: 'q1', stage_id: s.stages.qualificando, position: 0, text: 'Qual seu orçamento?', kind: 'text' }],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, null)
  const leadId = addLead(db, { account_id: s.accountId })
  const stmt = db.prepare(`INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, user_id, source, asked_at, replied_at) VALUES (?, ?, 'q1', 'A', ?, ?, 'button', datetime('now', '-1 day'), ?)`)
  for (let i = 0; i < 12; i++) stmt.run(s.accountId, leadId, 'Jeito da Ana', s.atendenteId, i < 11 ? toSqliteDate(new Date()) : null)
  for (let i = 0; i < 13; i++) stmt.run(s.accountId, leadId, 'Jeito da Gestora', s.gerenteId, null)

  await runScoreNightly(db, { now: new Date(), onBandUp: () => {} })
  const sug = db.prepare("SELECT * FROM roteiro_suggestions WHERE account_id = ? AND type = 'seller_phrasing'").all(s.accountId)
  assert.equal(sug.length, 1)
})

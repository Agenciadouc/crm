import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'
import { questionMetrics, conversionByBand } from '../server/services/roteiro/metrics.js'

const NOW = new Date('2026-09-20T12:00:00Z')
const DAY = 86400000
const at = daysAgo => toSqliteDate(new Date(NOW.getTime() - daysAgo * DAY))

function publishThree(db, s) {
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [
      { question_key: 'q_fraca', stage_id: s.stages.qualificando, position: 0, text: 'Qual seu orçamento?', kind: 'text' },
      { question_key: 'q_pouca', stage_id: s.stages.qualificando, position: 1, text: 'Quem decide?', kind: 'text' },
      { question_key: 'q_ok', stage_id: s.stages.proposta, position: 0, text: 'Para quando?', kind: 'text' },
    ],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
}

// Insere n asks com asked_at explicito; os primeiros `replied` recebem replied_at, etc.
function insertAsks(db, { accountId, leadId, questionKey, n, replied = 0, advanced = 0, bought = 0, userId = null, text = 'texto', daysAgo = 1, variant = 'A' }) {
  const stmt = db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, user_id, source, asked_at, replied_at, advanced_at, bought_at)
    VALUES (?, ?, ?, ?, ?, ?, 'button', ?, ?, ?, ?)
  `)
  const askedAt = at(daysAgo)
  for (let i = 0; i < n; i++) {
    stmt.run(accountId, leadId, questionKey, variant, text, userId, askedAt,
      i < replied ? askedAt : null, i < advanced ? askedAt : null, i < bought ? askedAt : null)
  }
}

test('questionMetrics: fraca, amostra pequena e ok; taxas de avanco e compra; ignora > 90 dias', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })

  // q_fraca: 25 envios, 10 respondidos = 40% (< 70)
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 12, replied: 10, userId: s.atendenteId, text: 'Ana X' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 13, replied: 0, userId: s.gerenteId, text: 'Gestora Y' })
  // q_pouca: 5 envios, todos respondidos
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_pouca', n: 5, replied: 5 })
  // q_ok: 20 envios, 16 respondidos (80%), 5 avancaram, 2 compraram
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_ok', n: 20, replied: 16, advanced: 5, bought: 2 })
  // fora da janela de 90 dias
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_ok', n: 10, replied: 0, daysAgo: 100 })

  const rows = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW })
  const byKey = Object.fromEntries(rows.map(r => [r.question_key, r]))

  assert.equal(byKey.q_fraca.sent, 25)
  assert.equal(byKey.q_fraca.reply_rate, 40)
  assert.equal(byKey.q_fraca.status, 'fraca')
  assert.equal(byKey.q_fraca.text, 'Qual seu orçamento?')
  assert.equal(byKey.q_fraca.stage_id, s.stages.qualificando)

  assert.equal(byKey.q_pouca.sent, 5)
  assert.equal(byKey.q_pouca.reply_rate, 100)
  assert.equal(byKey.q_pouca.status, 'amostra_pequena')

  assert.equal(byKey.q_ok.sent, 20)
  assert.equal(byKey.q_ok.reply_rate, 80)
  assert.equal(byKey.q_ok.advanced_rate, 25)
  assert.equal(byKey.q_ok.bought_rate, 10)
  assert.equal(byKey.q_ok.status, 'ok')
})

test('questionMetrics: sem envios -> taxa null e amostra pequena', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  const rows = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW })
  assert.equal(rows.length, 3)
  for (const r of rows) {
    assert.equal(r.sent, 0)
    assert.equal(r.reply_rate, null)
    assert.equal(r.status, 'amostra_pequena')
    assert.deepEqual(r.by_seller, [])
  }
})

test('questionMetrics: minimo da conta muda o corte de fraca', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  const leadId = addLead(db, { account_id: s.accountId })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_ok', n: 20, replied: 16 })
  db.prepare('UPDATE accounts SET roteiro_min_reply_rate = 90 WHERE id = ?').run(s.accountId)
  const q = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW }).find(r => r.question_key === 'q_ok')
  assert.equal(q.status, 'fraca')
})

test('questionMetrics: por vendedor com ate 3 exemplos distintos, o mais usado primeiro', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  const leadId = addLead(db, { account_id: s.accountId })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 7, replied: 7, userId: s.atendenteId, text: 'Jeito X' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 3, replied: 3, userId: s.atendenteId, text: 'Jeito Y' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 1, replied: 0, userId: s.atendenteId, text: 'Jeito Z' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 1, replied: 0, userId: s.atendenteId, text: 'Jeito W' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_fraca', n: 13, replied: 0, userId: s.gerenteId, text: 'Gestora' })

  const q = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW }).find(r => r.question_key === 'q_fraca')
  const ana = q.by_seller.find(x => x.user_id === s.atendenteId)
  const gestora = q.by_seller.find(x => x.user_id === s.gerenteId)
  assert.equal(ana.name, 'Ana')
  assert.equal(ana.sent, 12)
  assert.equal(ana.reply_rate, 83.3)
  assert.equal(ana.examples.length, 3)
  assert.deepEqual(ana.examples.slice(0, 2), ['Jeito X', 'Jeito Y'])
  assert.equal(gestora.sent, 13)
  assert.equal(gestora.reply_rate, 0)
  assert.deepEqual(gestora.examples, ['Gestora'])
  // melhor taxa primeiro
  assert.equal(q.by_seller[0].user_id, s.atendenteId)
})

test('questionMetrics: nao mistura asks de outra conta', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  const otherLead = addLead(db, { account_id: s.otherAccountId })
  insertAsks(db, { accountId: s.otherAccountId, leadId: otherLead, questionKey: 'q_ok', n: 30, replied: 30 })
  const q = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW }).find(r => r.question_key === 'q_ok')
  assert.equal(q.sent, 0)
})

test('conversionByBand: usa o retrato de 30 dias atras e vendas depois dele; avisa se pronto <= morno', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const day = at(30).slice(0, 10)
  const snap = db.prepare('INSERT INTO lead_score_daily (lead_id, account_id, day, score, band) VALUES (?, ?, ?, ?, ?)')

  const prontos = []
  const mornos = []
  for (let i = 0; i < 10; i++) {
    const id = addLead(db, { account_id: s.accountId, name: `P${i}` })
    snap.run(id, s.accountId, day, 90, 'pronto')
    prontos.push(id)
  }
  for (let i = 0; i < 10; i++) {
    const id = addLead(db, { account_id: s.accountId, name: `M${i}` })
    snap.run(id, s.accountId, day, 40, 'morno')
    mornos.push(id)
  }
  // 3 prontos compraram depois (lead_sales)
  for (const id of prontos.slice(0, 3)) {
    db.prepare('INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 100, ?)').run(s.accountId, id, at(10).slice(0, 10))
  }
  // venda antes do retrato nao conta
  db.prepare('INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 100, ?)').run(s.accountId, prontos[5], at(60).slice(0, 10))
  // 5 mornos entraram na etapa de venda (is_conversion) depois
  for (const id of mornos.slice(0, 5)) {
    db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, ?, ?, ?)').run(id, s.stages.proposta, s.stages.venda, at(5))
  }
  // retrato de outro dia e de outra conta: ignorados
  const other = addLead(db, { account_id: s.accountId })
  snap.run(other, s.accountId, at(29).slice(0, 10), 70, 'quente')
  const otherAcc = addLead(db, { account_id: s.otherAccountId })
  snap.run(otherAcc, s.otherAccountId, day, 70, 'quente')

  const r = conversionByBand(db, { accountId: s.accountId, now: NOW })
  const byBand = Object.fromEntries(r.bands.map(b => [b.band, b]))
  assert.deepEqual(r.bands.map(b => b.band), ['frio', 'morno', 'quente', 'pronto'])
  assert.deepEqual(byBand.pronto, { band: 'pronto', leads: 10, bought: 3, rate: 30 })
  assert.deepEqual(byBand.morno, { band: 'morno', leads: 10, bought: 5, rate: 50 })
  assert.deepEqual(byBand.quente, { band: 'quente', leads: 0, bought: 0, rate: null })
  assert.equal(r.warning, true)
})

test('conversionByBand: sem aviso com menos de 10 leads na faixa', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const day = at(30).slice(0, 10)
  const snap = db.prepare('INSERT INTO lead_score_daily (lead_id, account_id, day, score, band) VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 9; i++) snap.run(addLead(db, { account_id: s.accountId }), s.accountId, day, 90, 'pronto')
  for (let i = 0; i < 10; i++) snap.run(addLead(db, { account_id: s.accountId }), s.accountId, day, 40, 'morno')
  const r = conversionByBand(db, { accountId: s.accountId, now: NOW })
  assert.equal(r.warning, false)
})

test('questionMetrics: exemplos trocam o primeiro nome do lead por {nome} e agrupam', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  publishThree(db, s)
  for (const nome of ['João Silva', 'Maria', 'Pedro']) {
    const leadId = addLead(db, { account_id: s.accountId, name: nome })
    insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q_ok', n: 1, userId: s.atendenteId, text: `Oi ${nome.split(' ')[0]}, para quando você precisa?` })
  }
  const q = questionMetrics(db, { accountId: s.accountId, funnelId: s.funnelId, now: NOW }).find(r => r.question_key === 'q_ok')
  assert.deepEqual(q.by_seller[0].examples, ['Oi {nome}, para quando você precisa?'])
})

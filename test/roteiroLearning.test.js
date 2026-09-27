import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft, publish, getRoteiro } from '../server/services/roteiro/repo.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'
import {
  runLearning, startAbTest, evaluateAbTests, confirmVariant, keepCurrent, applySuggestion, rejectSuggestion, abTestSummary,
} from '../server/services/roteiro/learning.js'

const NOW = new Date('2026-09-20T12:00:00Z')
const DAY = 86400000
const at = daysAgo => toSqliteDate(new Date(NOW.getTime() - daysAgo * DAY))

function setup() {
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

function insertAsks(db, { accountId, leadId, questionKey, n, replied = 0, userId = null, text = 'texto', daysAgo = 1, variant = 'A' }) {
  const stmt = db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, user_id, source, asked_at, replied_at)
    VALUES (?, ?, ?, ?, ?, ?, 'button', ?, ?)
  `)
  const askedAt = at(daysAgo)
  for (let i = 0; i < n; i++) stmt.run(accountId, leadId, questionKey, variant, text, userId, askedAt, i < replied ? askedAt : null)
}

function suggestions(db, accountId) {
  return db.prepare('SELECT * FROM roteiro_suggestions WHERE account_id = ? ORDER BY id').all(accountId)
    .map(r => ({ ...r, payload: JSON.parse(r.payload_json) }))
}

function insertSuggestion(db, { accountId, funnelId, questionKey = null, type, payload, status = 'new' }) {
  return Number(db.prepare(`
    INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json, status) VALUES (?, ?, ?, ?, ?, ?)
  `).run(accountId, funnelId, questionKey, type, JSON.stringify(payload), status).lastInsertRowid)
}

function insertVariant(db, { accountId, questionKey, text, startedDaysAgo, suggestionId = null, status = 'testing' }) {
  return Number(db.prepare(`
    INSERT INTO roteiro_variants (account_id, question_key, text, status, started_at, suggestion_id) VALUES (?, ?, ?, ?, ?, ?)
  `).run(accountId, questionKey, text, status, at(startedDaysAgo), suggestionId).lastInsertRowid)
}

// --- runLearning (sem IA) ------------------------------------------------------------

test('runLearning: cria seller_phrasing para pergunta fraca com o jeito do melhor vendedor, sem duplicar', () => {
  const { db, s, leadId } = setup()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 8, replied: 8, userId: s.atendenteId, text: 'E aí, quanto quer investir?' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 4, replied: 2, userId: s.atendenteId, text: 'Qual o valor que cabe?' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 13, replied: 0, userId: s.gerenteId, text: 'Qual seu orçamento?' })

  const r1 = runLearning(db, { accountId: s.accountId, now: NOW })
  assert.equal(r1.created, 1)
  const [sug] = suggestions(db, s.accountId)
  assert.equal(sug.type, 'seller_phrasing')
  assert.equal(sug.question_key, 'q1')
  assert.equal(sug.funnel_id, s.funnelId)
  assert.equal(sug.status, 'new')
  assert.deepEqual(sug.payload, { text: 'E aí, quanto quer investir?', seller_name: 'Ana', seller_rate: 83.3, current_rate: 40 })

  const r2 = runLearning(db, { accountId: s.accountId, now: NOW })
  assert.equal(r2.created, 0)
  assert.equal(suggestions(db, s.accountId).length, 1)
})

test('runLearning: nao sugere se o vendedor tem menos de 10 envios ou taxa abaixo do minimo', () => {
  const { db, s, leadId } = setup()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 9, replied: 9, userId: s.atendenteId, text: 'Jeito bom' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 16, replied: 0, userId: s.gerenteId, text: 'Jeito ruim' })
  assert.equal(runLearning(db, { accountId: s.accountId, now: NOW }).created, 0)
  assert.equal(suggestions(db, s.accountId).length, 0)
})

// --- teste A/B -----------------------------------------------------------------------

test('startAbTest: cria variante B em teste; segunda na mesma pergunta da 409', () => {
  const { db, s } = setup()
  const sug1 = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'seller_phrasing', payload: { text: 'Quanto quer investir?' } })
  const sug2 = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'rewrite', payload: { versions: ['Versão 1', 'Versão 2'] } })

  const variant = startAbTest(db, { accountId: s.accountId, suggestionId: sug1, userId: s.gerenteId })
  assert.equal(variant.status, 'testing')
  assert.equal(variant.text, 'Quanto quer investir?')
  assert.equal(variant.question_key, 'q1')
  assert.equal(variant.suggestion_id, sug1)
  assert.equal(suggestions(db, s.accountId).find(x => x.id === sug1).status, 'testing')

  assert.throws(() => startAbTest(db, { accountId: s.accountId, suggestionId: sug2, userId: s.gerenteId }),
    e => e.status === 409 && e.message === 'Esta pergunta já está em teste.')
  assert.equal(suggestions(db, s.accountId).find(x => x.id === sug2).status, 'new')
})

test('startAbTest: rewrite usa versions[version_index]; sugestao de outra conta = 404', () => {
  const { db, s } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q2', type: 'rewrite', payload: { versions: ['Versão 1', 'Versão 2'] } })
  const v = startAbTest(db, { accountId: s.accountId, suggestionId: sug, userId: s.gerenteId, versionIndex: 1 })
  assert.equal(v.text, 'Versão 2')
  assert.throws(() => startAbTest(db, { accountId: s.otherAccountId, suggestionId: sug, userId: null }), e => e.status === 404)
})

test('evaluateAbTests: B vence com +5 pontos -> won, ended_at e aviso ao gestor', () => {
  const { db, s, leadId } = setup()
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 10 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 100, replied: 70, variant: 'A', daysAgo: 5 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 100, replied: 75, variant: 'B', daysAgo: 5 })
  // ask anterior ao inicio do teste nao conta
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 50, replied: 0, variant: 'A', daysAgo: 20 })

  const r = evaluateAbTests(db, { accountId: s.accountId, now: NOW })
  assert.equal(r.ended, 1)
  const v = db.prepare('SELECT * FROM roteiro_variants WHERE id = ?').get(vId)
  assert.equal(v.status, 'won')
  assert.equal(v.ended_at, toSqliteDate(NOW))
  const alerts = db.prepare("SELECT * FROM analyst_alerts WHERE account_id = ? AND type = 'roteiro_ab_resultado'").all(s.accountId)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].severity, 'media')
  assert.equal(alerts[0].title, 'Teste A/B terminou')
  assert.match(alerts[0].description, /70%/)
  assert.match(alerts[0].description, /75%/)
})

test('evaluateAbTests: diferenca de +3 = empate (fica A) -> lost', () => {
  const { db, s, leadId } = setup()
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 10 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 100, replied: 70, variant: 'A', daysAgo: 5 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 100, replied: 73, variant: 'B', daysAgo: 5 })
  evaluateAbTests(db, { accountId: s.accountId, now: NOW })
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE id = ?').get(vId).status, 'lost')
  const alert = db.prepare("SELECT * FROM analyst_alerts WHERE type = 'roteiro_ab_resultado'").get()
  assert.match(alert.description, /[Ee]mpate/)
})

test('evaluateAbTests: termina por 30 dias mesmo com poucos envios; sem isso continua em teste', () => {
  const { db, s, leadId } = setup()
  const old = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'B velho', startedDaysAgo: 31 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 5, replied: 3, variant: 'A', daysAgo: 20 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 5, replied: 5, variant: 'B', daysAgo: 20 })

  const recent = insertVariant(db, { accountId: s.accountId, questionKey: 'q2', text: 'B novo', startedDaysAgo: 2 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q2', n: 30, replied: 10, variant: 'A', daysAgo: 1 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q2', n: 10, replied: 10, variant: 'B', daysAgo: 1 })

  const r = evaluateAbTests(db, { accountId: s.accountId, now: NOW })
  assert.equal(r.ended, 1)
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE id = ?').get(old).status, 'won')
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE id = ?').get(recent).status, 'testing')
})

test('runLearning tambem avalia os testes A/B', () => {
  const { db, s, leadId } = setup()
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q2', text: 'B', startedDaysAgo: 40 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q2', n: 3, replied: 3, variant: 'A', daysAgo: 1 })
  runLearning(db, { accountId: s.accountId, now: NOW })
  assert.notEqual(db.prepare('SELECT status FROM roteiro_variants WHERE id = ?').get(vId).status, 'testing')
})

test('confirmVariant: vencedora B vira o texto publicado numa nova versao; sugestao aplicada', () => {
  const { db, s } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'seller_phrasing', payload: { text: 'Texto B' }, status: 'testing' })
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 10, suggestionId: sug, status: 'won' })
  const before = getRoteiro(db, s.accountId, s.funnelId).published.version

  const r = confirmVariant(db, { accountId: s.accountId, variantId: vId, userId: s.gerenteId })
  assert.equal(r.published, true)
  const rot = getRoteiro(db, s.accountId, s.funnelId)
  assert.equal(rot.published.version, before + 1)
  assert.equal(rot.published.questions.find(q => q.question_key === 'q1').text, 'Texto B')
  // o resto do roteiro continua igual
  assert.equal(rot.published.questions.find(q => q.question_key === 'q3').options.length, 2)
  const row = db.prepare('SELECT * FROM roteiro_suggestions WHERE id = ?').get(sug)
  assert.equal(row.status, 'applied')
  assert.equal(row.decided_by, s.gerenteId)
})

test('confirmVariant: teste ainda rodando = 409; outra conta = 404', () => {
  const { db, s } = setup()
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 1 })
  assert.throws(() => confirmVariant(db, { accountId: s.accountId, variantId: vId, userId: s.gerenteId }), e => e.status === 409)
  assert.throws(() => confirmVariant(db, { accountId: s.otherAccountId, variantId: vId, userId: null }), e => e.status === 404)
})

test('keepCurrent: sugestao recusada e roteiro nao muda', () => {
  const { db, s } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'seller_phrasing', payload: { text: 'Texto B' }, status: 'testing' })
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 10, suggestionId: sug, status: 'won' })
  const before = getRoteiro(db, s.accountId, s.funnelId).published.version
  keepCurrent(db, { accountId: s.accountId, variantId: vId, userId: s.gerenteId })
  assert.equal(db.prepare('SELECT status FROM roteiro_suggestions WHERE id = ?').get(sug).status, 'rejected')
  assert.equal(getRoteiro(db, s.accountId, s.funnelId).published.version, before)
})

// --- aplicar / recusar sugestoes -----------------------------------------------------

test('applySuggestion seller_phrasing: troca o texto so no rascunho (publicar continua manual)', () => {
  const { db, s } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q2', type: 'seller_phrasing', payload: { text: 'Quem mais participa da decisão?' } })
  applySuggestion(db, { accountId: s.accountId, suggestionId: sug, userId: s.gerenteId })
  const rot = getRoteiro(db, s.accountId, s.funnelId)
  assert.equal(rot.draft.questions.find(q => q.question_key === 'q2').text, 'Quem mais participa da decisão?')
  assert.equal(rot.published.questions.find(q => q.question_key === 'q2').text, 'Quem decide?')
  assert.equal(db.prepare('SELECT status FROM roteiro_suggestions WHERE id = ?').get(sug).status, 'applied')
  // ja decidida: nao aplica de novo
  assert.throws(() => applySuggestion(db, { accountId: s.accountId, suggestionId: sug, userId: s.gerenteId }), e => e.status === 409)
})

test('applySuggestion new_option, new_deviation e reorder', () => {
  const { db, s } = setup()
  const optSug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q3', type: 'new_option', payload: { question_key: 'q3', label: 'Empresarial', count: 6 } })
  const devSug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, type: 'new_deviation', payload: { triggers: 'garantia', reply_text: 'Tem garantia de 7 dias.', return_question_key: 'q1', count: 4 } })
  const ordSug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, type: 'reorder', payload: { stage_id: s.stages.qualificando, order: ['q2', 'q1', 'q3'], gain: 20 } })

  applySuggestion(db, { accountId: s.accountId, suggestionId: optSug, userId: s.gerenteId })
  applySuggestion(db, { accountId: s.accountId, suggestionId: devSug, userId: s.gerenteId })
  applySuggestion(db, { accountId: s.accountId, suggestionId: ordSug, userId: s.gerenteId })

  const draft = getRoteiro(db, s.accountId, s.funnelId).draft
  const q3 = draft.questions.find(q => q.question_key === 'q3')
  assert.deepEqual(q3.options.map(o => [o.label, o.points]), [['Básico', 0], ['Pro', 10], ['Empresarial', 0]])
  assert.equal(draft.deviations.length, 1)
  assert.equal(draft.deviations[0].triggers, 'garantia')
  assert.equal(draft.deviations[0].return_question_key, 'q1')
  const order = draft.questions.filter(q => q.stage_id === s.stages.qualificando).sort((a, b) => a.position - b.position).map(q => q.question_key)
  assert.deepEqual(order, ['q2', 'q1', 'q3'])
})

test('rejectSuggestion: status rejected com quem decidiu', () => {
  const { db, s } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'seller_phrasing', payload: { text: 'x' } })
  rejectSuggestion(db, { accountId: s.accountId, suggestionId: sug, userId: s.gerenteId })
  const row = db.prepare('SELECT * FROM roteiro_suggestions WHERE id = ?').get(sug)
  assert.equal(row.status, 'rejected')
  assert.equal(row.decided_by, s.gerenteId)
  assert.ok(row.decided_at)
  assert.throws(() => rejectSuggestion(db, { accountId: s.otherAccountId, suggestionId: sug, userId: null }), e => e.status === 404)
})

// --- fix round 1: {nome} e recusa -----------------------------------------------------

test('runLearning: pergunta com {nome} -> sugestao volta com {nome} e sem nome real de cliente', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, {
    questions: [{ question_key: 'qn', stage_id: s.stages.qualificando, position: 0, text: 'O que você quer resolver, {nome}?', kind: 'text' }],
    deviations: [],
  })
  publish(db, s.accountId, s.funnelId, null)
  const nomes = ['João Silva', 'Maria', 'Pedro Alves', 'Ana Paula', 'Lucas', 'Bia']
  const stmt = db.prepare(`INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, user_id, source, asked_at, replied_at) VALUES (?, ?, 'qn', 'A', ?, ?, 'button', ?, ?)`)
  // Ana (vendedora) pergunta do jeito dela para 12 leads diferentes, 11 respondem
  for (let i = 0; i < 12; i++) {
    const nome = nomes[i % nomes.length]
    const leadId = addLead(db, { account_id: s.accountId, name: nome })
    const first = nome.split(' ')[0]
    const text = i < 2 ? `O que você quer resolver, ${first}?` : `${first}, me conta: o que te fez procurar a gente?`
    stmt.run(s.accountId, leadId, text, s.atendenteId, at(1), i < 11 ? at(1) : null)
  }
  // Gestora usa o texto do roteiro e ninguem responde
  for (let i = 0; i < 13; i++) {
    const leadId = addLead(db, { account_id: s.accountId, name: `Cliente${i}` })
    stmt.run(s.accountId, leadId, `O que você quer resolver, Cliente${i}?`, s.gerenteId, at(1), null)
  }

  assert.equal(runLearning(db, { accountId: s.accountId, now: NOW }).created, 1)
  const [sug] = suggestions(db, s.accountId)
  assert.equal(sug.payload.text, '{nome}, me conta: o que te fez procurar a gente?')
  for (const nome of nomes) assert.ok(!sug.payload.text.includes(nome.split(' ')[0]))
})

test('runLearning: exemplo mais usado igual ao texto atual -> usa o proximo', () => {
  const { db, s, leadId } = setup()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 7, replied: 7, userId: s.atendenteId, text: 'Qual seu orçamento?' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 5, replied: 4, userId: s.atendenteId, text: 'Quanto pensa investir?' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 13, replied: 0, userId: s.gerenteId, text: 'Orçamento?' })
  assert.equal(runLearning(db, { accountId: s.accountId, now: NOW }).created, 1)
  assert.equal(suggestions(db, s.accountId)[0].payload.text, 'Quanto pensa investir?')
})

test('runLearning: sugestao recusada nao volta; outro texto ainda cria', () => {
  const { db, s, leadId } = setup()
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 8, replied: 8, userId: s.atendenteId, text: 'Jeito A' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 4, replied: 3, userId: s.atendenteId, text: 'Jeito B' })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 13, replied: 0, userId: s.gerenteId, text: 'Gestora' })

  runLearning(db, { accountId: s.accountId, now: NOW })
  const [first] = suggestions(db, s.accountId)
  assert.equal(first.payload.text, 'Jeito A')
  rejectSuggestion(db, { accountId: s.accountId, suggestionId: first.id, userId: s.gerenteId })

  // mesma noite de novo: 'Jeito A' foi recusado -> usa o outro jeito da vendedora
  assert.equal(runLearning(db, { accountId: s.accountId, now: NOW }).created, 1)
  const second = suggestions(db, s.accountId)[1]
  assert.equal(second.payload.text, 'Jeito B')
  rejectSuggestion(db, { accountId: s.accountId, suggestionId: second.id, userId: s.gerenteId })

  // tudo recusado -> nenhum cartao novo
  assert.equal(runLearning(db, { accountId: s.accountId, now: NOW }).created, 0)
  assert.equal(suggestions(db, s.accountId).length, 2)
})

test('abTestSummary: envios e taxa de A e B, dias restantes e se ja foi decidido', () => {
  const { db, s, leadId } = setup()
  const sug = insertSuggestion(db, { accountId: s.accountId, funnelId: s.funnelId, questionKey: 'q1', type: 'seller_phrasing', payload: { text: 'Texto B' }, status: 'testing' })
  const vId = insertVariant(db, { accountId: s.accountId, questionKey: 'q1', text: 'Texto B', startedDaysAgo: 10, suggestionId: sug })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 10, replied: 6, variant: 'A', daysAgo: 2 })
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 4, replied: 3, variant: 'B', daysAgo: 2 })
  // envio antes do inicio do teste nao conta
  insertAsks(db, { accountId: s.accountId, leadId, questionKey: 'q1', n: 5, replied: 0, variant: 'A', daysAgo: 20 })
  const v = db.prepare('SELECT * FROM roteiro_variants WHERE id = ?').get(vId)

  const r = abTestSummary(db, { accountId: s.accountId, variant: v, now: NOW })
  assert.deepEqual(r, {
    funnel_id: s.funnelId, current_text: 'Qual seu orçamento?',
    a: { sent: 10, rate: 60 }, b: { sent: 4, rate: 75 }, days_left: 20, decided: false,
  })

  db.prepare("UPDATE roteiro_variants SET status = 'won', ended_at = ? WHERE id = ?").run(at(1), vId)
  keepCurrent(db, { accountId: s.accountId, variantId: vId, userId: s.gerenteId })
  const ended = abTestSummary(db, { accountId: s.accountId, variant: db.prepare('SELECT * FROM roteiro_variants WHERE id = ?').get(vId), now: NOW })
  assert.equal(ended.days_left, 0)
  assert.equal(ended.decided, true)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { migrateLegacyQualifications } from '../server/services/roteiro/migrateLegacy.js'
import { getRoteiro, saveDraft, publish } from '../server/services/roteiro/repo.js'

function addSequence(db, accountId, question, position) {
  return Number(db.prepare('INSERT INTO qualification_sequences (account_id, question, position) VALUES (?, ?, ?)').run(accountId, question, position).lastInsertRowid)
}

function addAnswer(db, leadId, sequenceId, answer, answeredBy = null) {
  db.prepare("INSERT INTO lead_qualifications (lead_id, sequence_id, answer, answered_at, answered_by) VALUES (?, ?, ?, datetime('now'), ?)")
    .run(leadId, sequenceId, answer, answeredBy)
}

test('migrateLegacyQualifications: migra perguntas e respostas pro roteiro publicado', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, gerenteId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })

  const s1 = addSequence(db, accountId, 'Qual seu orçamento?', 0)
  const s2 = addSequence(db, accountId, 'Quando pretende começar?', 1)
  addAnswer(db, leadId, s1, 'Até 5 mil', gerenteId)
  addAnswer(db, leadId, s2, '', gerenteId) // resposta vazia nao migra

  const result = migrateLegacyQualifications(db)
  assert.equal(result.accounts, 1)
  assert.equal(result.questions, 2)
  assert.equal(result.answers, 1)

  const roteiro = getRoteiro(db, accountId, funnelId)
  assert.ok(roteiro.published)
  assert.equal(roteiro.published.version, 1)
  const keys = roteiro.published.questions.map(q => q.question_key)
  assert.deepEqual(keys, [`legacy-${s1}`, `legacy-${s2}`])
  assert.equal(roteiro.published.questions[0].stage_id, stages.novo)
  assert.equal(roteiro.published.questions[0].kind, 'text')
  assert.equal(roteiro.published.questions[0].required, false)

  const answerRow = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, `legacy-${s1}`)
  assert.ok(answerRow)
  assert.equal(answerRow.answer_text, 'Até 5 mil')
  assert.equal(answerRow.origin, 'manual')
  assert.equal(answerRow.account_id, accountId)
  assert.equal(answerRow.answered_by, gerenteId)

  const emptyAnswerRow = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, `legacy-${s2}`)
  assert.equal(emptyAnswerRow, undefined)
})

test('migrateLegacyQualifications: segunda execucao nao duplica nem gera nova versao', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, gerenteId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const s1 = addSequence(db, accountId, 'Qual seu orçamento?', 0)
  addAnswer(db, leadId, s1, 'Até 5 mil', gerenteId)

  const first = migrateLegacyQualifications(db)
  assert.equal(first.accounts, 1)

  const second = migrateLegacyQualifications(db)
  assert.deepEqual(second, { accounts: 0, questions: 0, answers: 0 })

  const roteiro = getRoteiro(db, accountId, funnelId)
  assert.equal(roteiro.published.version, 1) // nao criou versao 2
  const answerRows = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ?').all(leadId)
  assert.equal(answerRows.length, 1)
})

test('migrateLegacyQualifications: conta com roteiro ja publicado nao e tocada', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, gerenteId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const s1 = addSequence(db, accountId, 'Qual seu orçamento?', 0)
  addAnswer(db, leadId, s1, 'Até 5 mil', gerenteId)

  // Roteiro ja publicado manualmente antes da migracao rodar.
  saveDraft(db, accountId, funnelId, {
    questions: [{ stage_id: stages.novo, position: 0, text: 'Pergunta manual', kind: 'text', required: true }],
    deviations: [],
  })
  publish(db, accountId, funnelId, gerenteId)

  const result = migrateLegacyQualifications(db)
  assert.deepEqual(result, { accounts: 0, questions: 0, answers: 0 })

  const roteiro = getRoteiro(db, accountId, funnelId)
  assert.equal(roteiro.published.version, 1)
  assert.equal(roteiro.published.questions.length, 1)
  assert.equal(roteiro.published.questions[0].text, 'Pergunta manual')

  const answerRows = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ?').all(leadId)
  assert.equal(answerRows.length, 0) // resposta antiga nao foi migrada
})

test('migrateLegacyQualifications: conta sem funil e pulada', () => {
  const db = createRoteiroTestDb()
  const { otherAccountId } = seedRoteiroBase(db)
  addSequence(db, otherAccountId, 'Pergunta orfa', 0)

  const result = migrateLegacyQualifications(db)
  assert.deepEqual(result, { accounts: 0, questions: 0, answers: 0 })

  const versions = db.prepare('SELECT * FROM roteiro_versions WHERE account_id = ?').all(otherAccountId)
  assert.equal(versions.length, 0)
})

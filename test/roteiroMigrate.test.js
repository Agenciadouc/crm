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

test('migrateLegacyQualifications: pergunta legada em branco e pulada, as outras migram normalmente', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, gerenteId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })

  const blank = addSequence(db, accountId, '   ', 0) // pergunta legada invalida (so espaco)
  const s1 = addSequence(db, accountId, 'Qual seu orçamento?', 1)
  addAnswer(db, leadId, blank, 'resposta orfa', gerenteId) // resposta de pergunta invalida: nao deve migrar
  addAnswer(db, leadId, s1, 'Até 5 mil', gerenteId)

  const result = migrateLegacyQualifications(db)
  assert.equal(result.accounts, 1)
  assert.equal(result.questions, 1) // so a pergunta valida entrou no roteiro
  assert.equal(result.answers, 1)

  const roteiro = getRoteiro(db, accountId, funnelId)
  assert.ok(roteiro.published)
  const keys = roteiro.published.questions.map(q => q.question_key)
  assert.deepEqual(keys, [`legacy-${s1}`]) // pergunta em branco nao entrou

  const orphanAnswer = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, `legacy-${blank}`)
  assert.equal(orphanAnswer, undefined)

  const validAnswer = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, `legacy-${s1}`)
  assert.ok(validAnswer)
})

test('migrateLegacyQualifications: pergunta legada com mais de 500 caracteres e truncada', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const longText = 'x'.repeat(600)
  const s1 = addSequence(db, accountId, longText, 0)

  const result = migrateLegacyQualifications(db)
  assert.equal(result.accounts, 1)
  assert.equal(result.questions, 1)

  const roteiro = getRoteiro(db, accountId, funnelId)
  const question = roteiro.published.questions.find(q => q.question_key === `legacy-${s1}`)
  assert.ok(question)
  assert.equal(question.text.length, 500)
  assert.equal(question.text, 'x'.repeat(500))
})

test('migrateLegacyQualifications: conta que falha nao impede a migracao das demais', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, otherAccountId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const s1 = addSequence(db, accountId, 'Qual seu orçamento?', 0)
  addAnswer(db, leadId, s1, 'Até 5 mil')

  // Conta B tem funil e etapa validos, mas simulamos um erro inesperado especificamente
  // na gravacao do rascunho dela (ex.: falha de banco), pra provar que o erro fica
  // isolado nessa conta e nao impede a migracao da conta A (a ordem das contas no loop
  // nao e garantida, entao o patch mira o funil B, nao "a primeira conta processada").
  const otherFunnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil B', 1, 1)").run(otherAccountId).lastInsertRowid)
  db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, ?, ?, 0, 0)').run(otherFunnelId, 'Novo', 0)
  addSequence(db, otherAccountId, 'Pergunta que vai falhar', 0)

  const originalPrepare = db.prepare.bind(db)
  db.prepare = (sql) => {
    if (sql.includes('INSERT INTO roteiro_versions') && sql.includes("'draft'")) {
      const stmt = originalPrepare(sql)
      return { run: (...args) => {
        if (args[1] === otherFunnelId) throw new Error('falha simulada de banco')
        return stmt.run(...args)
      } }
    }
    return originalPrepare(sql)
  }

  const result = migrateLegacyQualifications(db)
  db.prepare = originalPrepare

  assert.equal(result.accounts, 1) // so a conta A migrou
  const roteiroA = getRoteiro(db, accountId, funnelId)
  assert.ok(roteiroA.published)
  assert.equal(roteiroA.published.questions.length, 1)

  const versionsB = db.prepare('SELECT * FROM roteiro_versions WHERE account_id = ?').all(otherAccountId)
  assert.equal(versionsB.length, 0) // conta B falhou e nao deixou versao pela metade

  const migratedFlag = db.prepare("SELECT value FROM app_settings WHERE key = 'roteiro_legacy_migrated'").get()
  assert.equal(migratedFlag.value, '1') // mesmo com falha, marca migrado pra nao tentar de novo pra sempre
})

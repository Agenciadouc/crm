import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, createLegacyCadenceTables, seedCadenceBase, leadIn, Q_PRAZO, Q_LIVRE } from './helpers/cadenceDb.js'
import { createRoteiroTestDb } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { migrateStageCadences, CADENCIA_ETAPA_FLAG } from '../server/services/cadence/migrateStageCadences.js'

function publicarRoteiro(db, s) {
  saveDraft(db, s.accountId, s.funnelId, { questions: [
    { ...Q_PRAZO, stage_id: s.stages.qualificando, position: 0 },
    { ...Q_LIVRE, stage_id: s.stages.qualificando, position: 1 },
    { ...Q_LIVRE, text: 'Qual o orçamento?', stage_id: s.stages.proposta, position: 0 },
  ], deviations: [] })
  return publish(db, s.accountId, s.funnelId, null)
}

test('cria a cadencia de cada etapa com as perguntas na ordem e abre para os leads ativos', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const pub = publicarRoteiro(db, s)
  const l1 = leadIn(db, s, 'qualificando'); leadIn(db, s, 'qualificando', { is_archived: 1 }); leadIn(db, s, 'venda')
  const antiga = Number(db.prepare("INSERT INTO cadences (account_id, name) VALUES (?, 'Antiga')").run(s.accountId).lastInsertRowid)
  const avulsaLc = Number(db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id) VALUES (?, ?)').run(l1, antiga).lastInsertRowid)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.accounts, r.cadences, r.leads, r.skipped], [1, 2, 1, false])
  const q = db.prepare('SELECT * FROM cadences WHERE stage_id = ?').get(s.stages.qualificando)
  assert.equal(q.name, 'Qualificando')
  const keys = db.prepare('SELECT question_key, action_type, description FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(q.id)
  const esperadas = pub.questions.filter(x => x.stage_id === s.stages.qualificando).sort((a, b) => a.position - b.position)
  assert.deepEqual(keys.map(k => [k.question_key, k.action_type, k.description]), esperadas.map(x => [x.question_key, 'pergunta', x.text]))
  assert.equal(db.prepare("SELECT kind FROM lead_cadences WHERE id = ?").get(avulsaLc).kind, 'avulsa')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_cadences WHERE kind = 'etapa'").get().n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM roteiro_versions WHERE account_id = ? AND status IN ('published','archived')").get(s.accountId).n, 1) // nao publica de novo
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG))
})

test('rodar 2x nao duplica (com e sem a marca)', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  publicarRoteiro(db, s)
  leadIn(db, s, 'qualificando')
  migrateStageCadences(db)
  assert.equal(migrateStageCadences(db).skipped, true)
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(CADENCIA_ETAPA_FLAG)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.cadences, r.skipped], [0, false])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadences WHERE stage_id IS NOT NULL').get().n, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_cadences WHERE kind = 'etapa'").get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts').get().n, 3)
})

test('falha de uma conta nao trava as outras e a marca fica gravada', (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  publicarRoteiro(db, s)
  // versao publicada da conta B apontando para um funil que nao e dela -> getPublishedQuestions lanca 404
  db.prepare("INSERT INTO roteiro_versions (account_id, funnel_id, version, status) VALUES (?, ?, 1, 'published')").run(s.otherAccountId, s.funnelId)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.accounts, r.cadences], [1, 2])
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG))
  assert.equal(logged.mock.callCount(), 1)
  assert.match(logged.mock.calls[0].arguments[0], new RegExp(`conta ${s.otherAccountId}`))
})

test('schema ainda com o CHECK antigo (sem pergunta): adia a migracao, nao marca e nao cria nada', (t) => {
  const logged = t.mock.method(console, 'error', () => {})
  const db = createRoteiroTestDb(); const s = seedCadenceBase(db)
  createLegacyCadenceTables(db) // cadence_attempts com o CHECK antigo, sem 'pergunta' (rebuild do schema nao rodou)
  publicarRoteiro(db, s)
  const r = migrateStageCadences(db)
  assert.equal(r.skipped, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadences').get().n, 0)
  assert.equal(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG), undefined)
  assert.equal(logged.mock.callCount(), 1)
  assert.match(logged.mock.calls[0].arguments[0], /nao aceita 'pergunta'/)
})

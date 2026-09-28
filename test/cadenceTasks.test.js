import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO } from './helpers/cadenceDb.js'
import { createCadence, addStep } from '../server/services/cadence/repo.js'
import { ensureStageCadence, assignAvulsa, markStepDone } from '../server/services/cadence/leadCadence.js'
import { listCadenceTasks, collectDueCadenceTasks, isTaskStep } from '../server/services/cadence/tasks.js'

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

function base() {
  const db = createCadenceTestDb()
  addCol(db, 'leads', 'profile_pic_url', 'TEXT')
  addCol(db, 'funnel_stages', 'color', 'TEXT')
  const s = seedCadenceBase(db)
  return { db, s }
}

const gestor = s => ({ accountId: s.accountId, userId: s.gerenteId, role: 'gerente' })
// Ancora o passo atual no passado (cadencia aberta ha N dias)
const ageDays = (db, lcId, days) => db.prepare(`UPDATE lead_cadences SET started_at = datetime('now', ?), last_executed_at = NULL, last_executed_attempt_id = NULL WHERE id = ?`).run(`-${days} days`, lcId)

test('isTaskStep: avulsa sempre; etapa so passo com data e que nao e pergunta', () => {
  assert.equal(isTaskStep('avulsa', { action_type: 'mensagem', delay_days: 0 }), true)
  assert.equal(isTaskStep('etapa', { action_type: 'mensagem', delay_days: 0 }), false)
  assert.equal(isTaskStep('etapa', { action_type: 'pergunta', delay_days: 3 }), false)
  assert.equal(isTaskStep('etapa', { action_type: 'ligacao', delay_days: 2 }), true)
  assert.equal(isTaskStep('etapa', { action_type: 'ligacao', delay_days: 0, schedule_mode: 'duration', delay_minutes: 30 }), true)
  assert.equal(isTaskStep('etapa', { action_type: 'ligacao', delay_days: 0, schedule_mode: 'date', delay_minutes: 30 }), false)
  assert.equal(isTaskStep('etapa', { action_type: 'visita', delay_days: 0, scheduled_time: '14:00' }), true)
  assert.equal(isTaskStep('etapa', { action_type: 'visita', delay_days: 0, scheduled_time: '' }), false)
})

test('lead na etapa com pergunta e mensagem do dia 0 nao vira tarefa (nem conta, nem aviso)', () => {
  const { db, s } = base()
  const etapa = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, etapa.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  addStep(db, s.accountId, etapa.id, { action_type: 'mensagem', auto_message: 'Catálogo' })
  const leadId = leadIn(db, s, 'qualificando')
  const lc = ensureStageCadence(db, { leadId })
  assert.equal(lc.current_attempt_id, pergunta)
  ageDays(db, lc.id, 5)
  assert.deepEqual(listCadenceTasks(db, gestor(s)), [])
  assert.deepEqual(collectDueCadenceTasks(db), [])
  // pula a pergunta: o passo da vez vira a mensagem do dia 0 — continua fora das tarefas
  markStepDone(db, { accountId: s.accountId, leadId, attemptId: pergunta, how: 'pulado' })
  assert.deepEqual(listCadenceTasks(db, gestor(s)), [])
  assert.deepEqual(collectDueCadenceTasks(db), [])
})

test('"Ligação dia 2" da etapa vira tarefa; o aviso sai uma vez quando vence', () => {
  const { db, s } = base()
  const etapa = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const ligacao = addStep(db, s.accountId, etapa.id, { action_type: 'ligacao', description: 'Ligar', delay_days: 2 }).step_id
  const leadId = leadIn(db, s, 'qualificando')
  const lc = ensureStageCadence(db, { leadId })
  assert.equal(lc.current_attempt_id, ligacao)
  // ainda nao venceu: aparece na lista (amanha/semana), sem aviso
  const antes = listCadenceTasks(db, gestor(s))
  assert.equal(antes.length, 1)
  assert.notEqual(antes[0].bucket, 'overdue')
  assert.deepEqual(collectDueCadenceTasks(db), [])
  // venceu
  ageDays(db, lc.id, 3)
  const tarefas = listCadenceTasks(db, gestor(s))
  assert.equal(tarefas.length, 1)
  assert.equal(tarefas[0].bucket, 'overdue')
  const avisos = collectDueCadenceTasks(db)
  assert.deepEqual(avisos.map(a => [a.lead_cadence_id, a.lead_id, a.account_id]), [[lc.id, leadId, s.accountId]])
  // proximos minutos do agendador: nao repete
  assert.deepEqual(collectDueCadenceTasks(db), [])
  assert.deepEqual(collectDueCadenceTasks(db), [])
  assert.equal(db.prepare('SELECT notified_attempt_id FROM lead_cadences WHERE id = ?').get(lc.id).notified_attempt_id, ligacao)
})

test('avulsa segue igual: passo do dia 0 e tarefa; aviso uma vez por passo', () => {
  const { db, s } = base()
  const avulsa = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem' }, { action_type: 'ligacao' }] })
  const leadId = leadIn(db, s, 'novo')
  const lc = assignAvulsa(db, { accountId: s.accountId, cadenceId: avulsa.id, leadId })
  ageDays(db, lc.id, 1)
  assert.equal(listCadenceTasks(db, gestor(s)).length, 1)
  assert.equal(collectDueCadenceTasks(db).length, 1)
  assert.equal(collectDueCadenceTasks(db).length, 0)
  // passo seguinte: novo aviso (uma vez)
  markStepDone(db, { accountId: s.accountId, leadId, attemptId: lc.current_attempt_id, how: 'feito' })
  assert.equal(collectDueCadenceTasks(db).length, 1)
  assert.equal(collectDueCadenceTasks(db).length, 0)
})

test('atendente so ve tarefa dos leads dele; contagem bate com a lista', () => {
  const { db, s } = base()
  const avulsa = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'ligacao' }] })
  const meu = leadIn(db, s, 'novo', { attendant_id: s.atendenteId })
  const outro = leadIn(db, s, 'novo')
  assignAvulsa(db, { accountId: s.accountId, cadenceId: avulsa.id, leadId: meu })
  assignAvulsa(db, { accountId: s.accountId, cadenceId: avulsa.id, leadId: outro })
  const etapa = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  addStep(db, s.accountId, etapa.id, { action_type: 'pergunta', question: Q_PRAZO })
  ensureStageCadence(db, { leadId: leadIn(db, s, 'qualificando', { attendant_id: s.atendenteId }) })
  assert.equal(listCadenceTasks(db, gestor(s)).length, 2)
  const minhas = listCadenceTasks(db, { accountId: s.accountId, userId: s.atendenteId, role: 'atendente' })
  assert.deepEqual(minhas.map(t => t.lead_id), [meu])
  assert.equal(listCadenceTasks(db, { accountId: s.otherAccountId, userId: s.gerenteId, role: 'gerente' }).length, 0)
})

test('tabela da cadencia ausente: avisa uma vez por processo; outro erro nao e engolido', async () => {
  const { warnMissingCadenceTable, resetMissingCadenceTableWarning } = await import('../server/services/cadence/errors.js')
  resetMissingCadenceTableWarning()
  const avisos = []
  const warn = m => avisos.push(m)
  assert.equal(warnMissingCadenceTable(new Error('no such table: lead_cadences'), { warn }), true)
  assert.equal(warnMissingCadenceTable(new Error('no such table: lead_cadence_steps'), { warn }), true)
  assert.equal(warnMissingCadenceTable(new Error('UNIQUE constraint failed'), { warn }), false)
  assert.equal(avisos.length, 1)
  assert.match(avisos[0], /\[Cadencia\] tabela da cadencia ausente — rode a migracao: no such table: lead_cadences/)
  resetMissingCadenceTableWarning()
})

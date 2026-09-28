import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO, publishedRoteiro } from './helpers/cadenceDb.js'
import { createCadence, addStep, deleteStep, getCadence } from '../server/services/cadence/repo.js'
import { computeNext } from '../server/services/cadence/nextStep.js'
import {
  ensureStageCadence, getLeadStageCadence, markStepDone, assignAvulsa, completeCurrentStep,
  refreshLeadsOfCadence, refreshLeadStageCadence, attachLeadsInStage,
} from '../server/services/cadence/leadCadence.js'
import { configureStageMoveHooks, moveLeadToStage } from '../server/services/stageMove.js'
import { saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { maybeAutoAdvance, undoAutoAdvance } from '../server/services/roteiro/autoAdvance.js'
import { recordAsk } from '../server/services/roteiro/asks.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'

test.afterEach(() => configureStageMoveHooks({ onMoved: null }))

function setup() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const q = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, q.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const mensagem = addStep(db, s.accountId, q.id, { action_type: 'mensagem', auto_message: 'Te mando o catálogo, {nome}' }).step_id
  const p = createCadence(db, s.accountId, { stageId: s.stages.proposta })
  const ligacao = addStep(db, s.accountId, p.id, { action_type: 'ligacao', description: 'Ligar para apresentar a proposta' }).step_id
  const key = getCadence(db, s.accountId, q.id).attempts[0].question_key
  const optionKey = publishedRoteiro(db, s).questions.find(x => x.question_key === key).options[0].option_key
  return { db, s, q, p, pergunta, mensagem, ligacao, key, optionKey }
}
const leadRow = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
const etapaRows = (db, leadId) => db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' ORDER BY id").all(leadId)
const move = (db, leadId, stageId, trigger = 'manual') => moveLeadToStage(db, { lead: leadRow(db, leadId), toStageId: stageId, trigger, gate: false })
const last = xs => xs[xs.length - 1]

test('proximo passo (puro): IA responde conta; enviada sem resposta continua sendo a proxima; pulado conta', () => {
  const steps = [{ id: 1, action_type: 'pergunta', question_key: 'k1' }, { id: 2, action_type: 'mensagem', question_key: null }, { id: 3, action_type: 'ligacao', question_key: null }]
  const ctx = (o = {}) => ({ answeredKeys: new Set(), askedKeys: new Set(), doneByAttempt: new Map(), ...o })
  assert.equal(computeNext(steps, ctx()).nextAttemptId, 1)
  const waiting = computeNext(steps, ctx({ askedKeys: new Set(['k1']) }))
  assert.equal(waiting.nextAttemptId, 1)
  assert.equal(waiting.states[0].state, 'aguardando')
  assert.equal(computeNext(steps, ctx({ answeredKeys: new Set(['k1']) })).nextAttemptId, 2)
  const r = computeNext(steps, ctx({ answeredKeys: new Set(['k1']), doneByAttempt: new Map([[2, { how: 'enviado' }], [3, { how: 'pulado' }]]) }))
  assert.deepEqual([r.nextAttemptId, r.doneCount, r.total], [null, 3, 3])
})

test('entrar na etapa abre a cadencia dela; sair fecha e abre a da nova; etapa final so fecha', () => {
  const { db, s, q, pergunta, ligacao } = setup()
  const leadId = leadIn(db, s, 'novo')
  move(db, leadId, s.stages.qualificando)
  let rows = etapaRows(db, leadId)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].cadence_id, rows[0].status, rows[0].current_attempt_id, rows[0].stage_id], [q.id, 'active', pergunta, s.stages.qualificando])
  move(db, leadId, s.stages.proposta)
  rows = etapaRows(db, leadId)
  assert.deepEqual(rows.map(r => r.status), ['completed', 'active'])
  assert.equal(rows[1].current_attempt_id, ligacao)
  move(db, leadId, s.stages.perdido)
  assert.deepEqual(etapaRows(db, leadId).map(r => r.status), ['completed', 'completed'])
})

test('lead novo e volta para a mesma etapa: abre uma vez por entrada (ensure idempotente)', () => {
  const { db, s, q } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  ensureStageCadence(db, { leadId })
  assert.equal(etapaRows(db, leadId).length, 1)
  move(db, leadId, s.stages.novo)
  move(db, leadId, s.stages.qualificando)
  assert.deepEqual(etapaRows(db, leadId).map(r => [r.cadence_id, r.status]), [[q.id, 'completed'], [q.id, 'active']])
})

test('desfazer o avanco automatico reabre a cadencia da etapa de onde saiu, com o que ja foi feito', () => {
  const { db, s, key, optionKey, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const first = ensureStageCadence(db, { leadId })
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'manual' })
  const adv = maybeAutoAdvance(db, { accountId: s.accountId, leadId })
  assert.equal(adv.to, s.stages.proposta)
  undoAutoAdvance(db, { accountId: s.accountId, leadId })
  const active = etapaRows(db, leadId).filter(r => r.status === 'active')
  assert.equal(active.length, 1)
  assert.equal(active[0].id, first.id)
  assert.equal(active[0].current_attempt_id, mensagem)
  const view = getLeadStageCadence(db, { accountId: s.accountId, leadId })
  assert.deepEqual(view.steps.map(x => x.state), ['feito', 'pendente'])
  assert.equal(view.steps[0].question.answer.option_key, optionKey)
})

test('etapa e avulsa juntas: troca de etapa nao mexe na avulsa; nova avulsa pausa so a avulsa', () => {
  const { db, s, q } = setup()
  const av = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem', auto_message: 'Sumiu?' }, { action_type: 'ligacao' }] })
  const av2 = createCadence(db, s.accountId, { name: 'Pós-evento', attempts: [{ action_type: 'mensagem' }] })
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const a = assignAvulsa(db, { accountId: s.accountId, cadenceId: av.id, leadId })
  assert.equal(a.kind, 'avulsa')
  assert.equal(etapaRows(db, leadId)[0].status, 'active')
  move(db, leadId, s.stages.proposta)
  const avRow = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(a.id)
  assert.deepEqual([avRow.status, avRow.current_attempt_id], ['active', av.attempts[0].id])
  assignAvulsa(db, { accountId: s.accountId, cadenceId: av2.id, leadId })
  assert.equal(db.prepare('SELECT status FROM lead_cadences WHERE id = ?').get(a.id).status, 'paused')
  assert.equal(last(etapaRows(db, leadId)).status, 'active')
  assert.throws(() => assignAvulsa(db, { accountId: s.accountId, cadenceId: q.id, leadId }), e => e.status === 400)
  assert.throws(() => assignAvulsa(db, { accountId: s.otherAccountId, cadenceId: av.id, leadId }), e => e.status === 404)
})

test('feito: pergunta so com resposta; resposta da IA conclui; ultimo passo fecha a cadencia', () => {
  const { db, s, pergunta, mensagem, key, optionKey } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  assert.throws(() => markStepDone(db, { accountId: s.accountId, leadId, attemptId: pergunta, how: 'feito' }), e => e.status === 400)
  markStepDone(db, { accountId: s.accountId, leadId, attemptId: mensagem, how: 'feito' })
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, pergunta)
  recordAsk(db, { accountId: s.accountId, leadId, questionKey: key, textSent: 'Para quando?', source: 'button' })
  assert.equal(getLeadStageCadence(db, { accountId: s.accountId, leadId }).steps[0].state, 'aguardando')
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'ia', evidence: 'dia 10' })
  refreshLeadStageCadence(db, { leadId })
  assert.equal(etapaRows(db, leadId)[0].status, 'completed')
})

test('passo apagado com o Chat aberto -> 409 sem gravar; lead de outra conta -> 404', () => {
  const { db, s, q, pergunta, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  deleteStep(db, s.accountId, q.id, mensagem)
  assert.throws(() => markStepDone(db, { accountId: s.accountId, leadId, attemptId: mensagem, how: 'feito' }),
    e => e.status === 409 && e.message === 'Esse passo mudou. A tela foi atualizada.')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadence_steps WHERE lead_id = ?').get(leadId).n, 0)
  assert.throws(() => markStepDone(db, { accountId: s.otherAccountId, leadId, attemptId: pergunta, how: 'pulado' }), e => e.status === 404)
  assert.throws(() => getLeadStageCadence(db, { accountId: s.otherAccountId, leadId }), e => e.status === 404)
})

test('apagar o passo atual: refreshLeadsOfCadence aponta para o proximo', () => {
  const { db, s, q, pergunta, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  deleteStep(db, s.accountId, q.id, pergunta)
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, null) // FK zerou
  assert.equal(refreshLeadsOfCadence(db, q.id), 1)
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, mensagem)
})

test('cadencia da etapa sem passos: a troca so fecha a anterior', () => {
  const { db, s } = setup()
  createCadence(db, s.accountId, { stageId: s.stages.novo })
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  move(db, leadId, s.stages.novo)
  assert.deepEqual(etapaRows(db, leadId).map(r => r.status), ['completed'])
})

test('Tarefas: concluir e pular pela mesma regra; outra conta -> 404; avulsa segue o jeito antigo', () => {
  const { db, s, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const lc = ensureStageCadence(db, { leadId })
  assert.throws(() => completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: lc.id, how: 'feito' }), e => e.status === 400)
  const r = completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: lc.id, how: 'pulado' })
  assert.deepEqual([r.completed, r.nextAttempt.id], [false, mensagem])
  assert.throws(() => completeCurrentStep(db, { accountId: s.otherAccountId, leadCadenceId: lc.id, how: 'feito' }), e => e.status === 404)
  const av = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem' }, { action_type: 'ligacao' }] })
  const a = assignAvulsa(db, { accountId: s.accountId, cadenceId: av.id, leadId })
  const r2 = completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: a.id, how: 'feito' })
  assert.deepEqual([r2.completed, r2.nextAttempt.id], [false, av.attempts[1].id])
  assert.equal(completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: a.id, how: 'feito' }).completed, true)
})

test('cadencia criada depois pega quem ja esta na etapa (menos arquivado)', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const l1 = leadIn(db, s, 'novo'); const l2 = leadIn(db, s, 'novo'); leadIn(db, s, 'novo', { is_archived: 1 })
  const c = createCadence(db, s.accountId, { stageId: s.stages.novo })
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 0) // sem passos nao abre
  addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' })
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 2)
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 2) // idempotente
  assert.equal(etapaRows(db, l1).length + etapaRows(db, l2).length, 2)
})

test('visao do lead: passos com estado, pergunta com QState e can_force pelo papel', () => {
  const { db, s, pergunta } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const v = getLeadStageCadence(db, { accountId: s.accountId, leadId, role: 'atendente' }) // ensure preguicoso
  assert.equal(v.stage.id, s.stages.qualificando)
  assert.equal(v.next_attempt_id, pergunta)
  assert.deepEqual(v.steps.map(x => x.action_type), ['pergunta', 'mensagem'])
  assert.equal(v.steps[0].question.text_for_lead, 'Para quando é o seu evento, Lead?')
  assert.equal(v.can_force, false)
  assert.equal(getLeadStageCadence(db, { accountId: s.accountId, leadId, role: 'gerente' }).can_force, true)
  const semEtapa = getLeadStageCadence(db, { accountId: s.accountId, leadId: leadIn(db, s, 'novo') })
  assert.deepEqual([semEtapa.lead_cadence, semEtapa.steps], [null, []])
})

test('proximo passo (puro): pergunta orfa sem resposta nao trava e nao entra no total', () => {
  const steps = [{ id: 1, action_type: 'pergunta', question_key: 'k1', orphan: true }, { id: 2, action_type: 'mensagem', question_key: null }]
  const ctx = { answeredKeys: new Set(), askedKeys: new Set(), doneByAttempt: new Map() }
  const r = computeNext(steps, ctx)
  assert.deepEqual([r.nextAttemptId, r.doneCount, r.total], [2, 0, 1])
  const done = computeNext(steps, { ...ctx, doneByAttempt: new Map([[2, { how: 'feito' }]]) })
  assert.deepEqual([done.nextAttemptId, done.doneCount, done.total], [null, 1, 1])
})

test('pergunta que saiu do roteiro publicado nao trava: o proximo passo pula ela', () => {
  const { db, s, mensagem } = setup()
  saveDraft(db, s.accountId, s.funnelId, { questions: [], deviations: [] })
  publish(db, s.accountId, s.funnelId, null)
  const leadId = leadIn(db, s, 'qualificando')
  assert.equal(ensureStageCadence(db, { leadId }).current_attempt_id, mensagem)
  const v = getLeadStageCadence(db, { accountId: s.accountId, leadId })
  assert.deepEqual([v.next_attempt_id, v.total, v.steps[0].orphan, v.steps[0].question], [mensagem, 1, true, null])
  markStepDone(db, { accountId: s.accountId, leadId, attemptId: mensagem, how: 'enviado' })
  assert.equal(etapaRows(db, leadId)[0].status, 'completed')
})

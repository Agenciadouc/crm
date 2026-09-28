import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_LIVRE } from './helpers/cadenceDb.js'
import { createCadence, addStep, getCadence } from '../server/services/cadence/repo.js'
import { ensureStageCadence } from '../server/services/cadence/leadCadence.js'
import { recordStepSend, stepMetrics, stepAskKey } from '../server/services/cadence/metrics.js'
import { markReplied, recordAsk } from '../server/services/roteiro/asks.js'
import { bootRoteiroRuntime, roteiroOnChatSend } from '../server/services/roteiro/runtime.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'

const NOW = new Date('2026-09-27T12:00:00Z')

function setup() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const mensagem = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Segue o catálogo' }).step_id
  const ligacao = addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' }).step_id
  return { db, s, c, pergunta, mensagem, ligacao }
}
const lead = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)

test('enviar pelo botao do passo mensagem grava ask step-<id> e marca o passo como enviado', () => {
  const { db, s, mensagem, pergunta } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const askId = recordStepSend(db, { lead: lead(db, leadId), attemptId: mensagem, userId: s.atendenteId, content: 'Segue o catálogo' })
  const ask = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(askId)
  assert.deepEqual([ask.question_key, ask.attempt_id, ask.source, ask.user_id], [stepAskKey(mensagem), mensagem, 'button', s.atendenteId])
  assert.equal(db.prepare('SELECT how FROM lead_cadence_steps WHERE attempt_id = ? AND lead_id = ?').get(mensagem, leadId).how, 'enviado')
  // pergunta nao passa por aqui; lead de outra conta / passo fora da cadencia do lead -> null, nada gravado
  assert.equal(recordStepSend(db, { lead: lead(db, leadId), attemptId: pergunta }), null)
  const outro = leadIn(db, s, 'novo')
  assert.equal(recordStepSend(db, { lead: lead(db, outro), attemptId: mensagem }), null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_asks').get().n, 1)
})

test('metrica da mensagem pelo mesmo calculo das perguntas; ligacao = feitas X de Y', () => {
  const { db, s, c, mensagem, ligacao } = setup()
  for (let i = 0; i < 20; i++) {
    const leadId = leadIn(db, s, 'qualificando')
    ensureStageCadence(db, { leadId })
    recordStepSend(db, { lead: lead(db, leadId), attemptId: mensagem, content: 'Segue o catálogo' })
    if (i < 10) markReplied(db, { leadId, windowHours: 24 })
    if (i < 3) db.prepare("INSERT INTO lead_cadence_steps (account_id, lead_cadence_id, lead_id, attempt_id, how) SELECT ?, id, ?, ?, 'feito' FROM lead_cadences WHERE lead_id = ?").run(s.accountId, leadId, ligacao, leadId)
  }
  const m = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id })
  const msg = m.find(x => x.attempt_id === mensagem)
  assert.deepEqual([msg.kind, msg.sent, msg.reply_rate, msg.status], ['resposta', 20, 50, 'fraca'])
  const lig = m.find(x => x.attempt_id === ligacao)
  assert.deepEqual([lig.kind, lig.done, lig.reached], ['feitas', 3, 20])
  assert.throws(() => stepMetrics(db, { accountId: s.otherAccountId, cadenceId: c.id }), e => e.status === 404)
})

test('metrica da pergunta vem do roteiro (questionMetrics) e janela de 90 dias', () => {
  const { db, s, c, pergunta } = setup()
  const key = getCadence(db, s.accountId, c.id).attempts[0].question_key
  const leadId = leadIn(db, s, 'qualificando')
  recordAsk(db, { accountId: s.accountId, leadId, questionKey: key, textSent: 'Conte mais', source: 'button' })
  db.prepare('UPDATE roteiro_asks SET asked_at = ?').run(toSqliteDate(new Date(NOW.getTime() - 5 * 86400000)))
  const m = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id, now: NOW }).find(x => x.attempt_id === pergunta)
  assert.deepEqual([m.kind, m.sent, m.status], ['resposta', 1, 'amostra_pequena'])
  const old = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id, days: 3, now: NOW }).find(x => x.attempt_id === pergunta)
  assert.equal(old.sent, 0)
})

test('envio do Chat com cadence_attempt_id avisa lead:cadence', () => {
  const { db, s, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const sent = []
  bootRoteiroRuntime({ db, broadcastSSE: (acc, ev, data) => sent.push([acc, ev, data]), triggerCapiForStageChange: () => {}, schedule: () => {} })
  roteiroOnChatSend(db, { lead: lead(db, leadId), userId: s.atendenteId, content: 'Segue', messageId: null, questionKey: null, attemptId: mensagem })
  assert.deepEqual(sent.filter(x => x[1] === 'lead:cadence'), [[s.accountId, 'lead:cadence', { lead_id: leadId }]])
})

test('messages.js repassa cadence_attempt_id nos dois envios (texto e midia)', () => {
  const src = fs.readFileSync(new URL('../server/routes/messages.js', import.meta.url), 'utf8')
  assert.equal((src.match(/attemptId: req\.body\.cadence_attempt_id/g) || []).length, 2)
  assert.match(src, /roteiroOnChatSend\(db, \{ lead, userId, content, messageId, questionKey: questionKey \|\| null, attemptId: attemptId \|\| null \}\)/)
})

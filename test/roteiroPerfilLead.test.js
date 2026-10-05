// Pergunta vale para o lead conforme o perfil dele (spec 2026-10-02 §5): roteiro do lead,
// trava, avanco automatico, cadencia da etapa e Termometro.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn } from './helpers/cadenceDb.js'
import { getRoteiro } from '../server/services/roteiro/repo.js'
import { addQuestionSteps } from '../server/services/cadence/repo.js'
import { getLeadRoteiro, checkRoteiroGate, saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { maybeAutoAdvance } from '../server/services/roteiro/autoAdvance.js'
import { getLeadStageCadence } from '../server/services/cadence/leadCadence.js'
import { gatherScoreInputs } from '../server/services/leadScore/inputs.js'
import { saveBusiness, setLeadProfile } from '../server/services/roteiro/profiles.js'
import { configureStageMoveHooks } from '../server/services/stageMove.js'

test.afterEach(() => configureStageMoveHooks({ onMoved: null }))

// Qualificando tem 3 perguntas obrigatorias de opcoes:
//   descoberta (Todos: "Tenho loja" -> loja, "Vendo de porta em porta" -> porta), uma da loja e uma da porta.
function cenario() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja' }, { name: 'Porta' }] }).profiles
  const o = (label, points, sets = null) => ({ label, points, ...(sets ? { sets_profile_key: sets } : {}) })
  addQuestionSteps(db, s.accountId, { stageId: s.stages.qualificando, questions: [
    { text: 'Você tem loja ou vende de porta em porta?', kind: 'options', required: true, spin: 'situation', options: [o('Tenho loja', 5, loja.profile_key), o('Vendo de porta em porta', 5, porta.profile_key)] },
    { text: 'Quantos clientes passam na loja?', kind: 'options', required: true, spin: 'situation', profile_key: loja.profile_key, options: [o('Muitos', 10), o('Poucos', 2)] },
    { text: 'Quantas casas visita por dia?', kind: 'options', required: true, spin: 'situation', profile_key: porta.profile_key, options: [o('Mais de 20', 10), o('Menos', 2)] },
  ] })
  const leadId = leadIn(db, s, 'qualificando')
  const pub = getRoteiro(db, s.accountId, s.funnelId).published.questions
  return { db, s, loja, porta, leadId, pub }
}

const leadRow = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)

test('lead sem perfil ve so as perguntas Todos; com perfil ve Todos + as dele', () => {
  const { db, s, loja, leadId } = cenario()
  const qs = () => getLeadRoteiro(db, { accountId: s.accountId, leadId }).stages.find(x => x.is_current).questions.map(q => q.text)
  assert.deepEqual(qs(), ['Você tem loja ou vende de porta em porta?'])
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  assert.deepEqual(qs(), ['Você tem loja ou vende de porta em porta?', 'Quantos clientes passam na loja?'])
  const r = getLeadRoteiro(db, { accountId: s.accountId, leadId })
  assert.deepEqual(r.profile, { key: loja.profile_key, origin: 'manual' })
  assert.equal(r.legacy_answers.length, 0)
})

test('opcao com sets_profile_key grava o perfil; resposta da IA nao troca perfil manual', () => {
  const { db, s, loja, porta, leadId, pub } = cenario()
  const r = saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[0].option_key, origin: 'ia', evidence: 'tenho um mercadinho' })
  assert.equal(r.profile_changed, true)
  assert.deepEqual([leadRow(db, leadId).roteiro_profile_key, leadRow(db, leadId).roteiro_profile_origin], [loja.profile_key, 'ia'])
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: porta.profile_key, origin: 'manual' })
  const r2 = saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[0].option_key, origin: 'ia', evidence: 'tenho loja' })
  assert.equal(r2.profile_changed, false)
  assert.equal(leadRow(db, leadId).roteiro_profile_key, porta.profile_key)
})

test('trava e avanco automatico so contam obrigatorias aplicaveis', () => {
  const { db, s, leadId, pub } = cenario()
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[0].option_key, origin: 'manual' }) // vira loja
  assert.deepEqual(checkRoteiroGate(db, leadRow(db, leadId), s.stages.proposta).pending.map(p => p.text), ['Quantos clientes passam na loja?'])
  assert.equal(maybeAutoAdvance(db, { accountId: s.accountId, leadId }), null)
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[1].question_key, optionKey: pub[1].options[0].option_key, origin: 'manual' })
  assert.equal(checkRoteiroGate(db, leadRow(db, leadId), s.stages.proposta).ok, true) // pergunta da porta nao trava
  assert.ok(maybeAutoAdvance(db, { accountId: s.accountId, leadId }))
})

test('cadencia: passo de outro perfil nao vira proximo passo e nao conta no total', () => {
  const { db, s, loja, leadId } = cenario()
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  const v = getLeadStageCadence(db, { accountId: s.accountId, leadId })
  assert.equal(v.total, 2)
  const casas = v.steps.find(st => st.description === 'Quantas casas visita por dia?')
  assert.equal(casas.not_applicable, true)
  assert.notEqual(v.next_attempt_id, casas.attempt_id)
})

test('termometro: Perfil soma so as aplicaveis e o motivo usa o rotulo SPIN', () => {
  const { db, s, loja, leadId, pub } = cenario()
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[1].question_key, optionKey: pub[1].options[0].option_key, origin: 'manual' })
  const fit = gatherScoreInputs(db, leadId).fit
  assert.equal(fit.totalCount, 2); assert.equal(fit.max, 15)
  assert.deepEqual(fit.reasons, [{ texto: 'Situação: Muitos', pontos: 10 }])
})

test('vendedor corrige a propria resposta de descoberta: o perfil acompanha a ultima resposta manual', () => {
  const { db, s, loja, porta, leadId, pub } = cenario()
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[0].option_key, origin: 'manual' })
  assert.equal(leadRow(db, leadId).roteiro_profile_key, loja.profile_key)
  const r = saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[1].option_key, origin: 'manual' })
  assert.equal(r.profile_changed, true)
  assert.deepEqual([leadRow(db, leadId).roteiro_profile_key, leadRow(db, leadId).roteiro_profile_origin], [porta.profile_key, 'manual'])
  // resposta da IA continua sem trocar perfil manual
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: pub[0].question_key, optionKey: pub[0].options[0].option_key, origin: 'ia', evidence: 'x' })
  assert.equal(leadRow(db, leadId).roteiro_profile_key, porta.profile_key)
})

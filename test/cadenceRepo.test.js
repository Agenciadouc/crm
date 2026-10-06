import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO, Q_LIVRE, publishedRoteiro } from './helpers/cadenceDb.js'
import {
  createCadence, getCadence, listCadences, updateCadence, deleteCadence, addStep, updateStep, deleteStep, reorderSteps,
  replaceAttemptsById, saveDeviations, addQuestionSteps, spinStepQuestions, aiStepQuestions, aiContactSteps, isContactStageId, applySuggestionLive, confirmVariantLive, getStageView, syncStageQuestions,
} from '../server/services/cadence/repo.js'
import { CadenceError } from '../server/services/cadence/errors.js'
import { getLeadRoteiro, saveAnswer, checkRoteiroGate } from '../server/services/roteiro/leadRoteiro.js'
import { saveDraft, getRoteiro, publish } from '../server/services/roteiro/repo.js'

const versions = (db, s) => db.prepare("SELECT COUNT(*) AS n FROM roteiro_versions WHERE account_id = ? AND status IN ('published','archived')").get(s.accountId).n
const stageCad = (db, s, key = 'qualificando') => createCadence(db, s.accountId, { stageId: s.stages[key] })
const stageQuestions = (db, s, key = 'qualificando') => publishedRoteiro(db, s).questions.filter(q => q.stage_id === s.stages[key]).sort((a, b) => a.position - b.position)

test('avulsa: passos atualizados por id mantem ids e o ponteiro do lead', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem', auto_message: 'Oi' }, { action_type: 'ligacao', description: 'Ligar' }] })
  const [a1, a2] = c.attempts
  const leadId = leadIn(db, s, 'novo')
  db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id) VALUES (?, ?, ?)').run(leadId, c.id, a1.id)
  const r = replaceAttemptsById(db, s.accountId, c.id, [{ id: a1.id, action_type: 'mensagem', auto_message: 'Oi de novo' }, { action_type: 'visita', description: 'Visitar' }])
  assert.equal(r.attempts[0].id, a1.id)
  assert.equal(r.attempts[0].auto_message, 'Oi de novo')
  assert.equal(r.attempts.length, 2)
  assert.ok(!r.attempts.some(a => a.id === a2.id))
  assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId).current_attempt_id, a1.id)
  assert.deepEqual(listCadences(db, s.accountId, { kind: 'avulsa' }).map(x => x.id), [c.id])
  assert.throws(() => getCadence(db, s.otherAccountId, c.id), e => e instanceof CadenceError && e.status === 404)
})

test('cadencia da etapa: uma ativa por etapa, etapa final, outra conta, nao apaga', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  assert.deepEqual([c.name, c.stage_id, c.funnel_id], ['Qualificando', s.stages.qualificando, s.funnelId])
  assert.throws(() => stageCad(db, s), e => e.status === 409 && e.message === 'Esta etapa já tem cadência.')
  assert.throws(() => stageCad(db, s, 'venda'), e => e.status === 400 && /finais/.test(e.message))
  assert.throws(() => createCadence(db, s.otherAccountId, { stageId: s.stages.novo }), e => e.status === 404)
  assert.throws(() => deleteCadence(db, s.accountId, c.id), e => e.status === 400)
  db.prepare('UPDATE cadences SET is_active = 0 WHERE id = ?').run(c.id) // inativa (dado antigo): a tela nao desativa mais
  assert.notEqual(stageCad(db, s).id, c.id) // inativa libera a etapa
  assert.throws(() => updateCadence(db, s.accountId, c.id, { is_active: 1 }), e => e.status === 409)
  assert.deepEqual(listCadences(db, s.accountId, { kind: 'etapa' }).length, 1)
})

test('passo pergunta vira pergunta publicada; salvar igual nao gera versao', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const r = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO })
  assert.equal(r.published, true)
  const step = r.cadence.attempts.find(a => a.id === r.step_id)
  assert.equal(step.description, Q_PRAZO.text)
  assert.equal(step.question.text, Q_PRAZO.text)
  assert.deepEqual(stageQuestions(db, s).map(q => [q.question_key, q.position]), [[step.question_key, 0]])
  const v = versions(db, s)
  const again = updateStep(db, s.accountId, c.id, step.id, { question: step.question })
  assert.equal(again.published, false)
  assert.equal(versions(db, s), v)
})

test('ordem: mexer so em mensagem nao publica; trocar perguntas de lugar publica', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const p1 = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const m = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Oi {nome}' }).step_id
  const p2 = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const v = versions(db, s)
  assert.equal(reorderSteps(db, s.accountId, c.id, [m, p1, p2]).published, false)
  assert.equal(updateStep(db, s.accountId, c.id, m, { auto_message: 'Olá {nome}', delay_days: 1 }).published, false)
  assert.equal(updateStep(db, s.accountId, c.id, m, { action_type: 'whatsapp' }).published, false)
  assert.equal(versions(db, s), v)
  assert.equal(reorderSteps(db, s.accountId, c.id, [m, p2, p1]).published, true)
  const keys = getCadence(db, s.accountId, c.id).attempts.filter(a => a.action_type === 'pergunta').map(a => a.question_key)
  assert.deepEqual(stageQuestions(db, s).map(q => q.question_key), keys)
  assert.throws(() => reorderSteps(db, s.accountId, c.id, [m, p1]), e => e.status === 409)
})

test('apagar pergunta com resposta e teste A/B: cancela o teste, resposta fica, trava solta, desvio sem volta', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const stepId = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const key = getCadence(db, s.accountId, c.id).attempts[0].question_key
  saveDeviations(db, s.accountId, s.funnelId, [{ triggers: 'preço, valor', reply_text: 'Depende do tamanho.', return_question_key: key }])
  const leadId = leadIn(db, s, 'qualificando')
  const outro = leadIn(db, s, 'qualificando')
  const optionKey = stageQuestions(db, s)[0].options[0].option_key
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'manual' })
  db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, 'Versão B', 'testing')").run(s.accountId, key)
  const lead = id => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  assert.equal(checkRoteiroGate(db, lead(outro), s.stages.proposta).ok, false)
  const r = deleteStep(db, s.accountId, c.id, stepId)
  assert.equal(r.published, true)
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE question_key = ?').get(key).status, 'cancelled')
  assert.equal(db.prepare('SELECT option_key FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, key).option_key, optionKey)
  assert.ok(getLeadRoteiro(db, { accountId: s.accountId, leadId }).legacy_answers.some(a => a.question_key === key))
  assert.equal(checkRoteiroGate(db, lead(outro), s.stages.proposta).ok, true)
  assert.equal(publishedRoteiro(db, s).deviations[0].return_question_key, null)
})

test('pergunta fora do roteiro da etapa, pergunta em avulsa e opcoes invalidas nao gravam nada', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  assert.throws(() => addStep(db, s.accountId, c.id, { action_type: 'pergunta', question_key: 'naoexiste' }),
    e => e.status === 400 && e.message === 'Esta pergunta não está no roteiro da etapa.')
  const av = createCadence(db, s.accountId, { name: 'Avulsa' })
  assert.throws(() => addStep(db, s.accountId, av.id, { action_type: 'pergunta', question: Q_LIVRE }), e => e.status === 400)
  assert.throws(() => addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: { ...Q_PRAZO, options: [{ label: 'Só uma', points: 1 }] } }), e => e.status === 400)
  assert.equal(getCadence(db, s.accountId, c.id).attempts.length, 0)
  assert.equal(publishedRoteiro(db, s), null)
  const ok = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  assert.throws(() => updateStep(db, s.accountId, c.id, ok.step_id, { action_type: 'mensagem' }), e => e.status === 400)
  assert.throws(() => updateStep(db, s.accountId, av.id, ok.step_id, { description: 'x' }), e => e.status === 404)
})

test('duas edicoes seguidas no mesmo passo: fica a ultima, id igual, uma versao por mudanca', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const id = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const optionKeys = stageQuestions(db, s)[0].options.map(o => o.option_key)
  const opts = Q_PRAZO.options.map((o, i) => ({ ...o, option_key: optionKeys[i] }))
  const v = versions(db, s)
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: opts, text: 'Para quando é a festa?' } })
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: opts, text: 'Para quando é a festa, {nome}?' } })
  assert.equal(versions(db, s), v + 2)
  const q = stageQuestions(db, s)[0]
  assert.equal(q.text, 'Para quando é a festa, {nome}?')
  assert.deepEqual(q.options.map(o => o.option_key), optionKeys) // respostas antigas continuam valendo
  assert.equal(getCadence(db, s.accountId, c.id).attempts[0].id, id)
})

test('modelo SPIN e IA: cria a cadencia da etapa e so poe o que falta', async () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const bant = spinStepQuestions(db, s.accountId, s.funnelId)
  assert.equal(bant.length, 6)
  const cad = addQuestionSteps(db, s.accountId, { stageId: s.stages.novo, questions: bant })
  assert.equal(cad.stage_id, s.stages.novo)
  assert.equal(cad.attempts.length, 6)
  assert.equal(spinStepQuestions(db, s.accountId, s.funnelId).length, 0)
  const ai = { call: async () => ({ toolUses: [{ name: 'propose_roteiro', input: { questions: [
    { stage_id: s.stages.proposta, text: 'Qual a data do evento?', kind: 'text', required: true },
    { stage_id: s.stages.qualificando, text: 'Quantos convidados?', kind: 'text' },
  ], deviations: [] } }] }) }
  const fromAi = await aiStepQuestions(db, s.accountId, { funnelId: s.funnelId, stageId: s.stages.proposta, ai })
  assert.deepEqual(fromAi.map(q => q.text), ['Qual a data do evento?'])
  await assert.rejects(aiStepQuestions(db, s.accountId, { funnelId: s.funnelId, stageId: s.stages.venda, ai }), e => e.status === 422)
  addQuestionSteps(db, s.accountId, { stageId: s.stages.proposta, questions: fromAi })
  // o rascunho que a IA montou para o funil inteiro nao vaza para o publicado
  assert.ok(!publishedRoteiro(db, s).questions.some(q => q.text === 'Quantos convidados?'))
})

test('sugestao de reordenar aplicada ja vale: roteiro publicado e vagas de pergunta da cadencia', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO })
  const m = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Catálogo' }).step_id
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  const [k1, k2] = stageQuestions(db, s).map(q => q.question_key)
  const sid = Number(db.prepare("INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json) VALUES (?, ?, NULL, 'reorder', ?)")
    .run(s.accountId, s.funnelId, JSON.stringify({ stage_id: s.stages.qualificando, order: [k2, k1] })).lastInsertRowid)
  const r = applySuggestionLive(db, s.accountId, sid)
  assert.deepEqual(r.cadence_ids, [c.id])
  assert.deepEqual(stageQuestions(db, s).map(q => q.question_key), [k2, k1])
  const steps = getCadence(db, s.accountId, c.id).attempts
  assert.deepEqual(steps.map(a => a.question_key || a.id), [k2, m, k1]) // mensagem nao sai do lugar
})

test('desvios: publica so quando muda; visao das etapas traz resumo e follow-up da etapa', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' })
  const d = [{ triggers: 'preço', reply_text: 'Depende do tamanho.', return_question_key: null }]
  assert.equal(saveDeviations(db, s.accountId, s.funnelId, d).published, true)
  assert.equal(saveDeviations(db, s.accountId, s.funnelId, d).published, false)
  db.prepare("INSERT INTO follow_ups (account_id, name, is_active, type, inactivity_stage_id) VALUES (?, 'Sumiu na qualificação', 1, 'inactivity', ?)").run(s.accountId, s.stages.qualificando)
  const view = getStageView(db, s.accountId, s.funnelId)
  const q = view.stages.find(x => x.id === s.stages.qualificando)
  assert.deepEqual(q.summary, { steps: 2, questions: 1 })
  assert.deepEqual(q.followups.map(f => f.name), ['Sumiu na qualificação'])
  assert.equal(view.stages.find(x => x.id === s.stages.novo).cadence, null)
  assert.equal(view.deviations.length, 1)
  assert.throws(() => getStageView(db, s.otherAccountId, s.funnelId), e => e.status === 404)
})

test('rascunho que ninguem publicou (IA desistida, tela antiga) nao vaza quando sugestao entra no ar', async () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO })
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  const ai = { call: async () => ({ toolUses: [{ name: 'propose_roteiro', input: { questions: [
    { stage_id: s.stages.proposta, text: 'Quantos convidados?', kind: 'text' },
  ], deviations: [] } }] }) }
  await aiStepQuestions(db, s.accountId, { funnelId: s.funnelId, stageId: s.stages.proposta, ai }) // gestor desiste
  assert.ok(!getRoteiro(db, s.accountId, s.funnelId).draft.questions.some(q => q.text === 'Quantos convidados?'))
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.novo, text: 'Rascunho velho', kind: 'text' }], deviations: [] })
  const [k1, k2] = stageQuestions(db, s).map(q => q.question_key)
  const sid = Number(db.prepare("INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json) VALUES (?, ?, NULL, 'reorder', ?)")
    .run(s.accountId, s.funnelId, JSON.stringify({ stage_id: s.stages.qualificando, order: [k2, k1] })).lastInsertRowid)
  applySuggestionLive(db, s.accountId, sid)
  assert.deepEqual(publishedRoteiro(db, s).questions.map(q => q.question_key), [k2, k1])
})

test('A/B confirmado entra no ar sem rascunho velho e avisa a cadencia cujo texto mudou', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const stepId = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const key = stageQuestions(db, s)[0].question_key
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.novo, text: 'Rascunho velho', kind: 'text' }], deviations: [] })
  const vid = Number(db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, 'Me conta do evento?', 'won')").run(s.accountId, key).lastInsertRowid)
  const r = confirmVariantLive(db, s.accountId, vid)
  assert.equal(r.published, true)
  assert.deepEqual(r.cadence_ids, [c.id])
  assert.deepEqual(publishedRoteiro(db, s).questions.map(q => q.text), ['Me conta do evento?'])
  assert.equal(getCadence(db, s.accountId, c.id).attempts.find(a => a.id === stepId).description, 'Me conta do evento?')
})

test('cadencia da etapa desativada: escrita da 409 e nao apaga as perguntas da cadencia ativa', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const a = stageCad(db, s)
  const m1 = addStep(db, s.accountId, a.id, { action_type: 'mensagem', auto_message: 'Oi' }).step_id
  const m2 = addStep(db, s.accountId, a.id, { action_type: 'mensagem', auto_message: 'Tchau' }).step_id
  db.prepare('UPDATE cadences SET is_active = 0 WHERE id = ?').run(a.id)
  const b = stageCad(db, s)
  addStep(db, s.accountId, b.id, { action_type: 'pergunta', question: Q_LIVRE })
  const key = stageQuestions(db, s)[0].question_key
  db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, 'Versão B', 'testing')").run(s.accountId, key)
  const v = versions(db, s)
  const off = e => e instanceof CadenceError && e.status === 409 && e.message === 'Esta cadência está desativada.'
  assert.throws(() => reorderSteps(db, s.accountId, a.id, [m2, m1]), off)
  assert.throws(() => addStep(db, s.accountId, a.id, { action_type: 'mensagem', auto_message: 'x' }), off)
  assert.throws(() => updateStep(db, s.accountId, a.id, m1, { auto_message: 'y' }), off)
  assert.throws(() => deleteStep(db, s.accountId, a.id, m1), off)
  assert.equal(syncStageQuestions(db, s.accountId, a.id).published, false)
  assert.deepEqual(stageQuestions(db, s).map(q => q.question_key), [key])
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE question_key = ?').get(key).status, 'testing')
  assert.equal(versions(db, s), v)
})

test('passo pergunta orfao (fora do publicado) nao trava a cadencia e aparece marcado', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const p = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const m = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Oi' }).step_id
  saveDraft(db, s.accountId, s.funnelId, { questions: [], deviations: [] })
  publish(db, s.accountId, s.funnelId, null)
  assert.equal(reorderSteps(db, s.accountId, c.id, [m, p]).published, false)
  const st = getStageView(db, s.accountId, s.funnelId).stages.find(x => x.id === s.stages.qualificando)
  assert.deepEqual(st.cadence.attempts.map(a => [a.id, !!a.orphan]), [[m, false], [p, true]])
  assert.equal(addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).published, true)
  assert.equal(stageQuestions(db, s).length, 1)
  deleteStep(db, s.accountId, c.id, p)
  assert.ok(!getCadence(db, s.accountId, c.id).attempts.some(a => a.id === p))
})

test('cadencia da etapa nao pode ser desativada; avulsa pode', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  assert.throws(() => updateCadence(db, s.accountId, c.id, { is_active: 0 }),
    e => e.status === 400 && e.message === 'A cadência da etapa não pode ser desativada. Apague os passos que não quiser.')
  assert.equal(getCadence(db, s.accountId, c.id).is_active, 1)
  const av = createCadence(db, s.accountId, { name: 'Avulsa' })
  assert.equal(updateCadence(db, s.accountId, av.id, { is_active: 0 }).is_active, 0)
})

test('editar opcoes sem option_key mantem as chaves (por texto, depois por posicao) e a resposta antiga vale', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const id = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const [kAte, kMais] = stageQuestions(db, s)[0].options.map(o => o.option_key)
  const leadId = leadIn(db, s, 'qualificando')
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: stageQuestions(db, s)[0].question_key, optionKey: kAte, origin: 'manual' })
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: [{ label: 'Mais de 30 dias', points: 5 }, { label: 'Até 30 dias', points: 15 }] } })
  assert.deepEqual(stageQuestions(db, s)[0].options.map(o => [o.label, o.option_key]), [['Mais de 30 dias', kMais], ['Até 30 dias', kAte]])
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: [{ label: 'Em até 1 mês', points: 15 }, { label: 'Até 30 dias', points: 15 }] } })
  assert.deepEqual(stageQuestions(db, s)[0].options.map(o => o.option_key), [kMais, kAte])
  const cur = getLeadRoteiro(db, { accountId: s.accountId, leadId }).stages.find(x => x.is_current)
  assert.equal(cur.questions[0].answer.option_label, 'Até 30 dias') // resposta antiga ainda casa com a opcao
})

test('stage-view: marca etapa de contato e lista os perfis da conta', async () => {
  const { saveBusiness } = await import('../server/services/roteiro/profiles.js')
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja', description: 'mercadinho' }] })
  const view = getStageView(db, s.accountId, s.funnelId)
  const byName = Object.fromEntries(view.stages.map(st => [st.name, st.is_contact]))
  assert.equal(byName.Novo, true)
  assert.equal(byName.Qualificando, false)
  assert.deepEqual(view.profiles.map(p => p.name), ['Loja'])
  assert.ok(view.profiles[0].profile_key)
})

// Sugestoes da revisao semanal (spec 2026-10-02 §10)
function weeklySuggestion(db, accountId, type, payload, funnelId = null) {
  return Number(db.prepare("INSERT INTO roteiro_suggestions (account_id, funnel_id, type, payload_json, evidence_json) VALUES (?, ?, ?, ?, '{\"source\":\"weekly\"}')")
    .run(accountId, funnelId, type, JSON.stringify(payload)).lastInsertRowid)
}

test('aplicar pergunta nova da revisao semanal: cria a cadencia da etapa com o passo e publica', async () => {
  const { saveBusiness } = await import('../server/services/roteiro/profiles.js')
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const [loja] = saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja' }, { name: 'Porta' }] }).profiles
  const id = weeklySuggestion(db, s.accountId, 'new_question', { stage_id: s.stages.qualificando, text: 'O que falta na prateleira?', spin: 'problem', profile_key: loja.profile_key,
    options: [{ label: 'Limpeza pesada', points: 10 }, { label: 'Nada', points: 0 }] }, s.funnelId)
  const r = applySuggestionLive(db, s.accountId, id, { userId: s.gerenteId })
  assert.equal(r.published, true)
  const q = publishedRoteiro(db, s).questions.find(x => x.text === 'O que falta na prateleira?')
  assert.deepEqual([q.stage_id, q.spin, q.profile_key, q.kind, q.options.length], [s.stages.qualificando, 'problem', loja.profile_key, 'options', 2])
  const cad = db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1').get(s.stages.qualificando)
  assert.ok(db.prepare("SELECT 1 FROM cadence_attempts WHERE cadence_id = ? AND question_key = ? AND action_type = 'pergunta'").get(cad.id, q.question_key))
  assert.deepEqual(r.cadence_ids, [cad.id])
  assert.equal(db.prepare('SELECT status FROM roteiro_suggestions WHERE id = ?').get(id).status, 'applied')
  assert.throws(() => applySuggestionLive(db, s.accountId, id, {}), e => e.status === 409)
})

test('aplicar pergunta nova com perfil apagado vira Todos', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const id = weeklySuggestion(db, s.accountId, 'new_question', { stage_id: s.stages.qualificando, text: 'Q?', spin: null, profile_key: 'sumiu',
    options: [{ label: 'a', points: 1 }, { label: 'b', points: 0 }] }, s.funnelId)
  applySuggestionLive(db, s.accountId, id, {})
  assert.equal(publishedRoteiro(db, s).questions.find(x => x.text === 'Q?').profile_key, null)
})

test('aplicar perfil novo: cria o perfil; com 6 perfis recusa e a sugestao continua nova; outra conta 404', async () => {
  const { saveBusiness, listProfiles } = await import('../server/services/roteiro/profiles.js')
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja' }] })
  const id = weeklySuggestion(db, s.accountId, 'new_profile', { name: 'Atacado', description: 'caixa fechada' })
  assert.throws(() => applySuggestionLive(db, s.otherAccountId, id, {}), e => e.status === 404)
  const r = applySuggestionLive(db, s.accountId, id, { userId: s.gerenteId })
  assert.deepEqual(r, { published: false, funnel_id: null, cadence_ids: [] })
  assert.deepEqual(listProfiles(db, s.accountId).map(p => [p.name, p.description]), [['Loja', null], ['Atacado', 'caixa fechada']])
  saveBusiness(db, s.accountId, { profiles: listProfiles(db, s.accountId).concat([1, 2, 3, 4].map(i => ({ name: `P${i}` }))) })
  const cheio = weeklySuggestion(db, s.accountId, 'new_profile', { name: 'Setimo', description: '' })
  assert.throws(() => applySuggestionLive(db, s.accountId, cheio, {}), /Máximo de 6 tipos de cliente/)
  assert.equal(db.prepare('SELECT status FROM roteiro_suggestions WHERE id = ?').get(cheio).status, 'new')
})

test('montar com IA na etapa de contato: mensagens e ligacoes, sem pergunta, no fim da lista', async () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  assert.equal(isContactStageId(db, s.accountId, s.stages.novo), true)
  assert.equal(isContactStageId(db, s.accountId, s.stages.qualificando), false)
  let sent
  const ai = { call: async (args) => { sent = args; return { toolUses: [{ name: 'propose_contact_steps', input: { steps: [
    { action_type: 'mensagem', delay_days: 0, text: 'Oi {nome}, vi seu cadastro!' },
    { action_type: 'ligacao', delay_days: 1, title: 'Ligar para {nome}', text: 'Se apresentar e perguntar se recebeu a mensagem.' },
    { action_type: 'pergunta', delay_days: 99, text: 'Vira mensagem, dia limitado' },
    { action_type: 'mensagem', delay_days: 2, text: '   ' },
  ] } }] } } }
  const c = await aiContactSteps(db, s.accountId, { stageId: s.stages.novo, ai })
  assert.equal(sent.toolChoice.name, 'propose_contact_steps')
  assert.match(sent.messages[0].content, /Novo/)
  assert.deepEqual(c.attempts.map(a => [a.action_type, a.delay_days]), [['mensagem', 0], ['ligacao', 1], ['mensagem', 30]])
  assert.equal(c.attempts[0].auto_message, 'Oi {nome}, vi seu cadastro!')
  assert.equal(c.attempts[1].description, 'Ligar para {nome}')
  assert.equal(c.attempts[1].call_script, 'Se apresentar e perguntar se recebeu a mensagem.')
  assert.ok(!c.attempts.some(a => a.question_key))
  const again = await aiContactSteps(db, s.accountId, { stageId: s.stages.novo, ai })
  assert.equal(again.id, c.id)
  assert.equal(again.attempts.length, 6) // soma no fim, nao apaga
  const empty = { call: async () => ({ toolUses: [{ name: 'propose_contact_steps', input: { steps: [] } }] }) }
  await assert.rejects(aiContactSteps(db, s.accountId, { stageId: s.stages.novo, ai: empty }), e => e.status === 422)
  const broken = { call: async () => { throw new Error('rede') } }
  await assert.rejects(aiContactSteps(db, s.accountId, { stageId: s.stages.novo, ai: broken }), e => e.status === 502)
})

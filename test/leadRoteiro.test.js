import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { variantFor, activeVariant, questionTextForLead } from '../server/services/roteiro/variants.js'
import { getLeadRoteiro, pendingRequired, checkRoteiroGate, saveAnswer } from '../server/services/roteiro/leadRoteiro.js'

function publishBasicRoteiro(db, accountId, funnelId, stages) {
  saveDraft(db, accountId, funnelId, {
    questions: [
      {
        stage_id: stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento, {nome}?', kind: 'options', required: true, bant: 'budget', ai_hint: null,
        options: [{ label: 'Até R$5 mil', points: 5 }, { label: 'Acima de R$20 mil', points: 15 }],
      },
      { stage_id: stages.qualificando, position: 1, text: 'Conte mais sobre seu projeto', kind: 'text', required: false, bant: null, ai_hint: null },
      { stage_id: stages.proposta, position: 0, text: 'Qual o prazo desejado?', kind: 'text', required: true, bant: 'timeline', ai_hint: null },
    ],
    deviations: [],
  })
  return publish(db, accountId, funnelId, null)
}

function questionKeys(published) {
  const [q1, q2, q3] = published.questions.sort((a, b) => (a.stage_id - b.stage_id) || (a.position - b.position))
  return { q1: q1.question_key, q2: q2.question_key, q3: q3.question_key }
}

test('getLeadRoteiro: sem roteiro publicado -> has_roteiro false e gate sempre ok', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  const r = getLeadRoteiro(db, { accountId, leadId })
  assert.equal(r.has_roteiro, false)
  assert.equal(r.next_question_key, null)
  assert.equal(r.funnel_id, funnelId)
  assert.equal(r.stage_id, stages.novo)
  assert.equal(r.stages.length, 5) // todas as etapas do funil, inclusive terminais
  for (const s of r.stages) assert.deepEqual(s.questions, [])

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const gate = checkRoteiroGate(db, lead, stages.proposta)
  assert.equal(gate.ok, true)
})

test('getLeadRoteiro: lead sem funnel_id -> has_roteiro false, stages vazio, gate ok', () => {
  const db = createRoteiroTestDb()
  const { accountId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, name: 'Sem Funil' })

  const r = getLeadRoteiro(db, { accountId, leadId })
  assert.equal(r.has_roteiro, false)
  assert.deepEqual(r.stages, [])
  assert.equal(r.next_question_key, null)

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const gate = checkRoteiroGate(db, lead, 999999)
  assert.equal(gate.ok, true)
})

test('getLeadRoteiro: com roteiro publicado, monta etapas com perguntas e next_question_key', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.qualificando })

  const r = getLeadRoteiro(db, { accountId, leadId })
  assert.equal(r.has_roteiro, true)
  assert.equal(r.stages.length, 5)
  const qualificando = r.stages.find(s => s.id === stages.qualificando)
  assert.equal(qualificando.is_current, true)
  assert.equal(qualificando.questions.length, 2)
  assert.equal(r.next_question_key, q1) // obrigatoria antes da recomendada
  assert.deepEqual(r.progress, { answered: 0, total: 2 })

  const terminal = r.stages.find(s => s.id === stages.venda)
  assert.equal(terminal.is_terminal, true)
  assert.deepEqual(terminal.questions, [])
})

test('checkRoteiroGate: mover novo -> proposta com Q1 pendente bloqueia', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const gate = checkRoteiroGate(db, lead, stages.proposta)
  assert.equal(gate.ok, false)
  assert.equal(gate.pending.length, 1)
  assert.equal(gate.pending[0].question_key, q1)

  const pending = pendingRequired(db, { accountId, lead, fromStageId: stages.novo, toStageId: stages.proposta })
  assert.equal(pending.length, 1)
  assert.equal(pending[0].question_key, q1)
})

test('checkRoteiroGate: mover para etapa final (venda) nunca trava', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishBasicRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const gate = checkRoteiroGate(db, lead, stages.venda)
  assert.equal(gate.ok, true)
})

test('checkRoteiroGate: voltar de etapa (destino anterior/igual) nunca trava', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishBasicRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.proposta })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const gateBack = checkRoteiroGate(db, lead, stages.novo)
  assert.equal(gateBack.ok, true)
  const gateSame = checkRoteiroGate(db, lead, stages.proposta)
  assert.equal(gateSame.ok, true)
})

test('saveAnswer: salvar Q1 manual libera gate para proposta e vira answer com option_label', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const optionKey = q1Question.options[1].option_key // Acima de R$20 mil
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  const { answer, skipped } = saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey, origin: 'manual', userId: atendenteId })
  assert.equal(skipped, false)
  assert.equal(answer.option_key, optionKey)
  assert.equal(answer.option_label, 'Acima de R$20 mil')
  assert.equal(answer.origin, 'manual')
  assert.equal(answer.answered_by, atendenteId)
  assert.equal(answer.answered_by_name, 'Ana')

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const gate = checkRoteiroGate(db, lead, stages.proposta)
  assert.equal(gate.ok, true)

  const r = getLeadRoteiro(db, { accountId, leadId })
  const q1State = r.stages.find(s => s.id === stages.qualificando).questions.find(q => q.question_key === q1)
  assert.equal(q1State.answer.option_key, optionKey)
})

test('saveAnswer: origem ia depois de manual nao sobrescreve (skipped=true)', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const manualOption = q1Question.options[1].option_key
  const iaOption = q1Question.options[0].option_key
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: manualOption, origin: 'manual', userId: atendenteId })
  const result = saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: iaOption, origin: 'ia', evidence: 'cliente disse acima de 20 mil' })

  assert.equal(result.skipped, true)
  assert.equal(result.answer.option_key, manualOption)
  assert.equal(result.answer.origin, 'manual')
})

test('saveAnswer: manual depois de ia sobrescreve e origem vira manual', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const iaOption = q1Question.options[0].option_key
  const manualOption = q1Question.options[1].option_key
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: iaOption, origin: 'ia', evidence: 'trecho' })
  const result = saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: manualOption, origin: 'manual', userId: atendenteId })

  assert.equal(result.skipped, false)
  assert.equal(result.answer.option_key, manualOption)
  assert.equal(result.answer.origin, 'manual')
  assert.equal(result.answer.answered_by, atendenteId)
})

test('saveAnswer: optionKey invalido -> 400', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  assert.throws(() => saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: 'nao-existe', origin: 'manual' }), (err) => {
    assert.equal(err.status, 400)
    return true
  })
})

test('saveAnswer: pergunta removida da versao publicada -> 400 e aparece em legacy_answers', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q2 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.qualificando })

  // responde Q2 (texto) enquanto ainda publicada
  saveAnswer(db, { accountId, leadId, questionKey: q2, answerText: 'Projeto de casamento', origin: 'manual' })

  // republica sem Q2
  saveDraft(db, accountId, funnelId, {
    questions: [
      { stage_id: stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, bant: 'budget', ai_hint: null, options: [{ label: 'Até R$5 mil', points: 5 }, { label: 'Acima de R$20 mil', points: 15 }] },
      { stage_id: stages.proposta, position: 0, text: 'Qual o prazo desejado?', kind: 'text', required: true, bant: 'timeline', ai_hint: null },
    ],
    deviations: [],
  })
  publish(db, accountId, funnelId, null)

  assert.throws(() => saveAnswer(db, { accountId, leadId, questionKey: q2, answerText: 'outra resposta', origin: 'manual' }), (err) => {
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Esta pergunta não está mais no roteiro.')
    return true
  })

  const r = getLeadRoteiro(db, { accountId, leadId })
  assert.equal(r.legacy_answers.length, 1)
  assert.equal(r.legacy_answers[0].question_key, q2)
  assert.equal(r.legacy_answers[0].answer_text, 'Projeto de casamento')
})

test('getLeadRoteiro: lead de outra conta -> 404', () => {
  const db = createRoteiroTestDb()
  const { accountId, otherAccountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  assert.throws(() => getLeadRoteiro(db, { accountId: otherAccountId, leadId }), (err) => {
    assert.ok(err.name === 'RoteiroError')
    assert.equal(err.code, 'not_found')
    assert.equal(err.status, 404)
    return true
  })
})

test('saveAnswer: lead de outra conta -> 404', () => {
  const db = createRoteiroTestDb()
  const { accountId, otherAccountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria Souza', funnel_id: funnelId, stage_id: stages.novo })

  assert.throws(() => saveAnswer(db, { accountId: otherAccountId, leadId, questionKey: q1, answerText: 'x', origin: 'manual' }), (err) => {
    assert.equal(err.status, 404)
    return true
  })
})

test('questionTextForLead: troca {nome} pelo primeiro nome, remove ", {nome}" sem nome', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const question = published.questions.find(q => q.question_key === q1)

  const withName = questionTextForLead(db, { accountId, leadId: 1, question, leadName: 'Maria Souza' })
  assert.equal(withName.text, 'Qual sua faixa de orçamento, Maria?')

  const withoutName = questionTextForLead(db, { accountId, leadId: 1, question, leadName: '' })
  assert.equal(withoutName.text, 'Qual sua faixa de orçamento?')
})

test('variantFor: estavel e distribui aproximadamente 50/50 em 200 leads', () => {
  const first = variantFor(42, 'abc123')
  const second = variantFor(42, 'abc123')
  assert.equal(first, second)
  assert.ok(first === 'A' || first === 'B')

  let countB = 0
  for (let leadId = 1; leadId <= 200; leadId++) {
    if (variantFor(leadId, 'q-fixed') === 'B') countB++
  }
  assert.ok(countB >= 70 && countB <= 130, `esperado entre 70 e 130, obteve ${countB}`)
})

test('activeVariant: null sem teste ativo, linha quando status testing', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)

  assert.equal(activeVariant(db, accountId, q1), null)

  db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, ?, 'testing')").run(accountId, q1, 'Texto variante B')
  const active = activeVariant(db, accountId, q1)
  assert.equal(active.text, 'Texto variante B')
  assert.equal(active.status, 'testing')
})

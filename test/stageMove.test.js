import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { configureStageMoveHooks, moveLeadToStage } from '../server/services/stageMove.js'
import { maybeAutoAdvance, undoAutoAdvance } from '../server/services/roteiro/autoAdvance.js'

function publishBasicRoteiro(db, accountId, funnelId, stages) {
  saveDraft(db, accountId, funnelId, {
    questions: [
      {
        stage_id: stages.qualificando, position: 0, text: 'Qual sua faixa de orçamento?', kind: 'options', required: true, bant: 'budget', ai_hint: null,
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

test.afterEach(() => {
  // Cada teste registra seu proprio hook (ou nenhum); nunca deve vazar pro proximo.
  configureStageMoveHooks({ onMoved: null })
})

test('moveLeadToStage: move normal grava historico e chama o hook onMoved', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, name: 'Maria', funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  let hookCall = null
  configureStageMoveHooks({ onMoved: (payload) => { hookCall = payload } })

  const result = moveLeadToStage(db, { lead, toStageId: stages.qualificando, trigger: 'manual', userId: atendenteId })

  assert.equal(result.moved, true)
  assert.equal(result.fromStageId, stages.novo)
  assert.equal(result.toStageId, stages.qualificando)
  assert.ok(result.historyId)

  const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(updatedLead.stage_id, stages.qualificando)

  const hist = db.prepare('SELECT * FROM stage_history WHERE id = ?').get(result.historyId)
  assert.equal(hist.lead_id, leadId)
  assert.equal(hist.from_stage_id, stages.novo)
  assert.equal(hist.to_stage_id, stages.qualificando)
  assert.equal(hist.trigger_type, 'manual')
  assert.equal(hist.triggered_by, atendenteId)

  assert.ok(hookCall)
  assert.equal(hookCall.fromStageId, stages.novo)
  assert.equal(hookCall.toStageId, stages.qualificando)
  assert.equal(hookCall.trigger, 'manual')
  assert.equal(hookCall.historyId, result.historyId)
  assert.equal(hookCall.lead.id, leadId)
  assert.equal(hookCall.db, db)
})

test('moveLeadToStage: hook padrao e no-op quando nao configurado', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const result = moveLeadToStage(db, { lead, toStageId: stages.qualificando, trigger: 'manual' })
  assert.equal(result.moved, true)
})

test('moveLeadToStage: excecao no hook e capturada e logada, mudanca fica gravada', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  configureStageMoveHooks({ onMoved: () => { throw new Error('boom') } })

  const originalConsoleError = console.error
  let loggedArgs = null
  console.error = (...args) => { loggedArgs = args }
  try {
    const result = moveLeadToStage(db, { lead, toStageId: stages.qualificando, trigger: 'manual' })
    assert.equal(result.moved, true)
  } finally {
    console.error = originalConsoleError
  }

  assert.ok(loggedArgs)
  assert.equal(loggedArgs[0], '[stageMove] hook:')
  assert.equal(loggedArgs[1], 'boom')

  const updatedLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(updatedLead.stage_id, stages.qualificando)
})

test('moveLeadToStage: mesma etapa retorna same_stage e nao grava historico', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const before = db.prepare('SELECT COUNT(*) c FROM stage_history').get().c
  const result = moveLeadToStage(db, { lead, toStageId: stages.novo, trigger: 'manual' })
  assert.deepEqual(result, { moved: false, reason: 'same_stage' })

  const after = db.prepare('SELECT COUNT(*) c FROM stage_history').get().c
  assert.equal(after, before)
})

test('moveLeadToStage: travado pelo roteiro retorna roteiro_gate com pendentes e nao grava', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const before = db.prepare('SELECT COUNT(*) c FROM stage_history').get().c
  const result = moveLeadToStage(db, { lead, toStageId: stages.proposta, trigger: 'manual' })

  assert.equal(result.moved, false)
  assert.equal(result.reason, 'roteiro_gate')
  assert.equal(result.pending.length, 1)
  assert.equal(result.pending[0].question_key, q1)

  const after = db.prepare('SELECT COUNT(*) c FROM stage_history').get().c
  assert.equal(after, before)
  const leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.novo)
})

test('moveLeadToStage: force grava mesmo travado, com notes e trigger forced', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, gerenteId } = seedRoteiroBase(db)
  publishBasicRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const result = moveLeadToStage(db, {
    lead, toStageId: stages.proposta, trigger: 'forced', force: true, notes: 'Cliente pediu urgência', userId: gerenteId,
  })

  assert.equal(result.moved, true)
  assert.equal(result.toStageId, stages.proposta)

  const hist = db.prepare('SELECT * FROM stage_history WHERE id = ?').get(result.historyId)
  assert.equal(hist.trigger_type, 'forced')
  assert.equal(hist.notes, 'Cliente pediu urgência')
  assert.equal(hist.triggered_by, gerenteId)

  const leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.proposta)
})

test('moveLeadToStage: etapa que nao pertence ao funil do lead lanca stage_not_in_funnel', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const otherFunnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil B', 0, 1)").run(accountId).lastInsertRowid)
  const otherStageId = Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, ?, ?)').run(otherFunnelId, 'Outra etapa', 0).lastInsertRowid)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  assert.throws(() => moveLeadToStage(db, { lead, toStageId: otherStageId, trigger: 'manual' }), (err) => {
    assert.equal(err.message, 'stage_not_in_funnel')
    return true
  })
})

test('maybeAutoAdvance: avanca de qualificando para proposta ao responder a ultima obrigatoria', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const optionKey = q1Question.options[1].option_key
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })

  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey, origin: 'manual', userId: atendenteId })

  const result = maybeAutoAdvance(db, { accountId, leadId, userId: atendenteId })
  assert.ok(result)
  assert.equal(result.from, stages.qualificando)
  assert.equal(result.to, stages.proposta)
  assert.equal(result.to_name, 'Proposta')

  const leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.proposta)

  const hist = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId)
  assert.equal(hist.trigger_type, 'roteiro_auto')
  assert.equal(hist.from_stage_id, stages.qualificando)
  assert.equal(hist.to_stage_id, stages.proposta)
})

test('maybeAutoAdvance: nao avanca quando a proxima etapa e final', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q3 } = questionKeys(published)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.proposta })

  saveAnswer(db, { accountId, leadId, questionKey: q3, answerText: '30 dias', origin: 'manual' })

  const result = maybeAutoAdvance(db, { accountId, leadId })
  assert.equal(result, null)

  const leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.proposta)
})

test('maybeAutoAdvance: nao avanca quando a etapa atual nao tem perguntas obrigatorias', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishBasicRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })

  const result = maybeAutoAdvance(db, { accountId, leadId })
  assert.equal(result, null)

  const leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.novo)
})

test('undoAutoAdvance: desfaz, trava novo auto-avanco e libera apos resposta nova', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const optionAcima = q1Question.options[1].option_key
  const optionAte = q1Question.options[0].option_key
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })

  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: optionAcima, origin: 'manual', userId: atendenteId })
  const advanced = maybeAutoAdvance(db, { accountId, leadId, userId: atendenteId })
  assert.ok(advanced)

  let leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.proposta)

  // desfazer volta e marca o lead para nao avancar de novo a partir dessa etapa
  const undone = undoAutoAdvance(db, { accountId, leadId, userId: atendenteId })
  assert.equal(undone.moved, true)
  assert.equal(undone.toStageId, stages.qualificando)

  leadRow = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.qualificando)
  assert.equal(leadRow.roteiro_no_auto_from_stage, stages.qualificando)

  const histUndo = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId)
  assert.equal(histUndo.trigger_type, 'roteiro_undo')
  assert.equal(histUndo.from_stage_id, stages.proposta)
  assert.equal(histUndo.to_stage_id, stages.qualificando)

  // depois de desfazer, maybeAutoAdvance nao avanca de novo (mesma resposta continua valendo)
  const secondTry = maybeAutoAdvance(db, { accountId, leadId, userId: atendenteId })
  assert.equal(secondTry, null)
  leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.qualificando)

  // uma resposta nova (mesmo que a mesma pergunta) limpa a marca e libera o avanco de novo
  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey: optionAte, origin: 'manual', userId: atendenteId })
  leadRow = db.prepare('SELECT roteiro_no_auto_from_stage FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.roteiro_no_auto_from_stage, null)

  const thirdTry = maybeAutoAdvance(db, { accountId, leadId, userId: atendenteId })
  assert.ok(thirdTry)
  assert.equal(thirdTry.to, stages.proposta)
  leadRow = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(leadRow.stage_id, stages.proposta)
})

test('undoAutoAdvance: sem avanco automatico para desfazer lanca nothing_to_undo', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  publishBasicRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })

  assert.throws(() => undoAutoAdvance(db, { accountId, leadId }), (err) => {
    assert.equal(err.name, 'RoteiroError')
    assert.equal(err.code, 'nothing_to_undo')
    assert.equal(err.status, 400)
    assert.equal(err.message, 'Não há avanço automático para desfazer.')
    return true
  })
})

test('undoAutoAdvance: lead ja saiu da etapa do avanco automatico lanca nothing_to_undo', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages, atendenteId } = seedRoteiroBase(db)
  const published = publishBasicRoteiro(db, accountId, funnelId, stages)
  const { q1 } = questionKeys(published)
  const q1Question = published.questions.find(q => q.question_key === q1)
  const optionKey = q1Question.options[1].option_key
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })

  saveAnswer(db, { accountId, leadId, questionKey: q1, optionKey, origin: 'manual', userId: atendenteId })
  maybeAutoAdvance(db, { accountId, leadId, userId: atendenteId })

  // vendedor move manualmente o lead pra outra etapa antes de tentar desfazer
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  moveLeadToStage(db, { lead, toStageId: stages.venda, trigger: 'manual', userId: atendenteId })

  assert.throws(() => undoAutoAdvance(db, { accountId, leadId, userId: atendenteId }), (err) => {
    assert.equal(err.code, 'nothing_to_undo')
    return true
  })
})

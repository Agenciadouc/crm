import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { configureStageMoveHooks, moveLeadToStage, resolveManualMove } from '../server/services/stageMove.js'
import {
  bootRoteiroRuntime, buildOnBandUp, onInboundSaved, onOutboundSaved, roteiroOnChatSend,
  setAiExtractHandler, enqueueAiExtract,
} from '../server/services/roteiro/runtime.js'

function insertAsk(db, { accountId, leadId, questionKey, hoursAgo = 0 }) {
  return Number(db.prepare(`
    INSERT INTO roteiro_asks (account_id, lead_id, question_key, variant, text_sent, source, asked_at)
    VALUES (?, ?, ?, 'A', 'texto', 'button', datetime('now', ?))
  `).run(accountId, leadId, questionKey, `-${hoursAgo} hours`).lastInsertRowid)
}

function publishRoteiro(db, accountId, funnelId, stages) {
  saveDraft(db, accountId, funnelId, {
    questions: [
      { stage_id: stages.qualificando, position: 0, question_key: 'orcamento', text: 'Qual sua faixa de orçamento para o projeto?', kind: 'text', required: true, bant: null, ai_hint: null },
      { stage_id: stages.qualificando, position: 1, question_key: 'prazo', text: 'Qual o prazo desejado para começar?', kind: 'text', required: false, bant: null, ai_hint: null },
      { stage_id: stages.proposta, position: 0, question_key: 'decisor', text: 'Quem decide a compra?', kind: 'text', required: true, bant: null, ai_hint: null },
    ],
    deviations: [],
  })
  return publish(db, accountId, funnelId, null)
}

function setup() {
  const db = createRoteiroTestDb()
  const seed = seedRoteiroBase(db)
  const calls = { capi: [], sse: [], score: [] }
  bootRoteiroRuntime({
    db,
    broadcastSSE: (...a) => calls.sse.push(a),
    triggerCapiForStageChange: (...a) => calls.capi.push(a),
    schedule: (id) => calls.score.push(id),
  })
  return { db, ...seed, calls }
}

test.afterEach(() => {
  configureStageMoveHooks({ onMoved: null })
  setAiExtractHandler(null)
})

test('onMoved: chama CAPI 1x, marca advanced, agenda nota e manda SSE lead:updated', () => {
  const { db, accountId, funnelId, stages, calls } = setup()
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const askId = insertAsk(db, { accountId, leadId, questionKey: 'orcamento', hoursAgo: 2 })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const r = moveLeadToStage(db, { lead, toStageId: stages.qualificando, trigger: 'manual' })

  assert.equal(r.moved, true)
  assert.deepEqual(calls.capi, [[leadId, stages.qualificando, r.historyId]])
  const ask = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(askId)
  assert.ok(ask.advanced_at)
  assert.equal(ask.bought_at, null)
  assert.deepEqual(calls.score, [leadId])
  assert.deepEqual(calls.sse, [[accountId, 'lead:updated', { id: leadId }]])
})

test('onMoved: etapa de conversao marca bought', () => {
  const { db, accountId, funnelId, stages } = setup()
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.proposta })
  const askId = insertAsk(db, { accountId, leadId, questionKey: 'orcamento', hoursAgo: 48 })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  moveLeadToStage(db, { lead, toStageId: stages.venda, trigger: 'manual' })

  const ask = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(askId)
  assert.ok(ask.bought_at)
  assert.ok(ask.advanced_at)
})

test('onMoved: erro no CAPI nao impede o resto do hook', () => {
  const db = createRoteiroTestDb()
  const { accountId, funnelId, stages } = seedRoteiroBase(db)
  const scored = []
  bootRoteiroRuntime({ db, broadcastSSE: () => {}, triggerCapiForStageChange: () => { throw new Error('capi fora') }, schedule: (id) => scored.push(id) })
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.novo })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  moveLeadToStage(db, { lead, toStageId: stages.qualificando, trigger: 'manual' })
  assert.deepEqual(scored, [leadId])
})

test('buildOnBandUp: manda SSE lead:score_up com dados do lead', () => {
  const sse = []
  const onBandUp = buildOnBandUp((...a) => sse.push(a))
  onBandUp({ lead: { id: 5, account_id: 2, name: 'Maria', attendant_id: 9 }, result: { score: 72, band: 'quente' } })
  assert.deepEqual(sse, [[2, 'lead:score_up', { lead_id: 5, name: 'Maria', score: 72, band: 'quente', attendant_id: 9 }]])
})

test('onInboundSaved: marca replied dentro da janela da conta, agenda nota e chama extracao', () => {
  const { db, accountId, funnelId, stages, calls } = setup()
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const recent = insertAsk(db, { accountId, leadId, questionKey: 'orcamento', hoursAgo: 2 })
  const old = insertAsk(db, { accountId, leadId, questionKey: 'prazo', hoursAgo: 30 })
  const extracted = []
  setAiExtractHandler((p) => extracted.push(p.lead.id))
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const msgId = addMessage(db, { leadId, direction: 'inbound', content: 'uns 10 mil' })

  onInboundSaved({ db, account, lead, message: { id: msgId, content: 'uns 10 mil' } })

  assert.ok(db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(recent).replied_at)
  assert.equal(db.prepare('SELECT replied_at FROM roteiro_asks WHERE id = ?').get(old).replied_at, null)
  assert.deepEqual(calls.score, [leadId])
  assert.deepEqual(extracted, [leadId])
})

test('enqueueAiExtract: sem handler configurado e no-op', () => {
  assert.doesNotThrow(() => enqueueAiExtract({ lead: { id: 1 } }))
})

test('onOutboundSaved: resolve alerta aberto de lead quente sem resposta e agenda nota', () => {
  const { db, accountId, funnelId, stages, calls } = setup()
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const ins = db.prepare("INSERT INTO analyst_alerts (account_id, lead_id, type, severity, title, status) VALUES (?, ?, ?, 'alta', 't', ?)")
  const open = Number(ins.run(accountId, leadId, 'lead_quente_sem_resposta', 'open').lastInsertRowid)
  const other = Number(ins.run(accountId, leadId, 'outro_tipo', 'open').lastInsertRowid)
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  onOutboundSaved({ db, lead })

  const a = db.prepare('SELECT * FROM analyst_alerts WHERE id = ?').get(open)
  assert.equal(a.status, 'resolved')
  assert.ok(a.resolved_at)
  assert.equal(db.prepare('SELECT status FROM analyst_alerts WHERE id = ?').get(other).status, 'open')
  assert.deepEqual(calls.score, [leadId])
})

test('roteiroOnChatSend: botao grava ask source=button com a variante vigente', () => {
  const { db, accountId, funnelId, stages, atendenteId } = setup()
  publishRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  const msgId = addMessage(db, { leadId, direction: 'outbound', content: 'Qual seu orçamento?' })

  const rec = roteiroOnChatSend(db, { lead, userId: atendenteId, content: 'Qual seu orçamento?', messageId: msgId, questionKey: 'orcamento' })

  assert.equal(rec, null)
  const ask = db.prepare('SELECT * FROM roteiro_asks WHERE lead_id = ?').get(leadId)
  assert.equal(ask.question_key, 'orcamento')
  assert.equal(ask.source, 'button')
  assert.equal(ask.variant, 'A')
  assert.equal(ask.message_id, msgId)
  assert.equal(ask.user_id, atendenteId)
  assert.equal(ask.text_sent, 'Qual seu orçamento?')
})

test('roteiroOnChatSend: chave que nao existe no roteiro do lead e ignorada', () => {
  const { db, accountId, funnelId, stages } = setup()
  publishRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  roteiroOnChatSend(db, { lead, userId: null, content: 'oi', messageId: null, questionKey: 'nao_existe' })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM roteiro_asks').get().c, 0)
})

test('roteiroOnChatSend: texto digitado reconhece pergunta pendente da etapa atual (sem gravar ask)', () => {
  const { db, accountId, funnelId, stages } = setup()
  publishRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const rec = roteiroOnChatSend(db, { lead, userId: null, content: 'E qual a faixa de orçamento do projeto?', messageId: null })
  assert.deepEqual(rec, { question_key: 'orcamento', text: 'Qual sua faixa de orçamento para o projeto?' })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM roteiro_asks').get().c, 0)

  // Pergunta de outra etapa nao e reconhecida
  assert.equal(roteiroOnChatSend(db, { lead, userId: null, content: 'Quem decide a compra?', messageId: null }), null)
})

test('roteiroOnChatSend: pergunta ja respondida nao e reconhecida', () => {
  const { db, accountId, funnelId, stages } = setup()
  publishRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  saveAnswer(db, { accountId, leadId, questionKey: 'orcamento', answerText: '10 mil', origin: 'manual' })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(roteiroOnChatSend(db, { lead, userId: null, content: 'E qual a faixa de orçamento do projeto?', messageId: null }), null)
})

test('resolveManualMove: sem motivo move com trava; atendente com motivo e barrado; gestor com motivo forca', () => {
  assert.deepEqual(resolveManualMove({ role: 'atendente', forceReason: undefined }), { ok: true, force: false, notes: null })
  assert.deepEqual(resolveManualMove({ role: 'gerente', forceReason: '   ' }), { ok: true, force: false, notes: null })
  assert.deepEqual(resolveManualMove({ role: 'atendente', forceReason: 'cliente com pressa' }),
    { ok: false, status: 403, error: 'Só o gestor pode avançar sem as respostas.' })
  assert.deepEqual(resolveManualMove({ role: 'gerente', forceReason: ' cliente com pressa ' }), { ok: true, force: true, notes: 'cliente com pressa' })
  assert.deepEqual(resolveManualMove({ role: 'super_admin', forceReason: 'x' }), { ok: true, force: true, notes: 'x' })
})

test('moveLeadToStage forcado grava trigger forced e notas (fluxo do PUT /stage do gestor)', () => {
  const { db, accountId, funnelId, stages, gerenteId } = setup()
  publishRoteiro(db, accountId, funnelId, stages)
  const leadId = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stages.qualificando })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  const blocked = moveLeadToStage(db, { lead, toStageId: stages.proposta, trigger: 'manual', userId: gerenteId, gate: true })
  assert.equal(blocked.reason, 'roteiro_gate')
  assert.equal(blocked.pending.length, 1)

  const decision = resolveManualMove({ role: 'gerente', forceReason: 'cliente pediu proposta' })
  const r = moveLeadToStage(db, { lead, toStageId: stages.proposta, trigger: 'forced', userId: gerenteId, notes: decision.notes, force: decision.force })
  assert.equal(r.moved, true)
  const h = db.prepare('SELECT * FROM stage_history WHERE id = ?').get(r.historyId)
  assert.equal(h.trigger_type, 'forced')
  assert.equal(h.notes, 'cliente pediu proposta')
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  ANALYSIS_TOOL, ANALYSIS_TOOL_NAME, parseAnalysisInput, parseRequiredFields, readLeadCriteria,
  checkStageGate, formatGateRefusal, shouldSdrHandoff, buildQualificationSummary,
  buildSalesRulesLines, saveLeadAnalysis, gateForLead, handoffStageMoveAllowed,
} from '../server/services/salesAnalysis.js'

test('ANALYSIS_TOOL tem nome e campos obrigatorios do spec', () => {
  assert.equal(ANALYSIS_TOOL.name, ANALYSIS_TOOL_NAME)
  assert.equal(ANALYSIS_TOOL_NAME, 'record_analysis')
  assert.deepEqual(ANALYSIS_TOOL.input_schema.required, ['momento', 'chance_fechar', 'trava_principal', 'criterios'])
})

test('parseAnalysisInput normaliza chance, trava vazia e status', () => {
  const a = parseAnalysisInput({
    momento: ' qualificacao ',
    chance_fechar: 140.6,
    trava_principal: '   ',
    criterios: [
      { criterio: 'Volume mensal', status: 'Atendido', evidencia: '200 litros' },
      { criterio: 'Regiao', status: 'talvez' },
      { status: 'atendido' },
    ],
  })
  assert.deepEqual(a, {
    moment: 'qualificacao',
    closeChance: 100,
    mainBlocker: null,
    criteria: [
      { name: 'Volume mensal', status: 'atendido', evidence: '200 litros' },
      { name: 'Regiao', status: 'pendente', evidence: '' },
    ],
  })
})

test('parseAnalysisInput: chance invalida vira null, negativa vira 0, entrada invalida vira null', () => {
  assert.equal(parseAnalysisInput({ chance_fechar: 'abc', criterios: [] }).closeChance, null)
  assert.equal(parseAnalysisInput({ chance_fechar: -5, criterios: [] }).closeChance, 0)
  assert.equal(parseAnalysisInput(null), null)
  assert.equal(parseAnalysisInput('texto'), null)
})

test('parseRequiredFields e readLeadCriteria toleram JSON ruim', () => {
  assert.deepEqual(parseRequiredFields('["name","city"]'), ['name', 'city'])
  assert.deepEqual(parseRequiredFields('nao-json'), [])
  assert.deepEqual(parseRequiredFields(null), [])
  assert.equal(readLeadCriteria({ ai_criteria_json: null }), null)
  assert.equal(readLeadCriteria({ ai_criteria_json: '{quebrado' }), null)
  assert.deepEqual(readLeadCriteria({ ai_criteria_json: '[{"name":"X","status":"atendido","evidence":""}]' }), [{ name: 'X', status: 'atendido', evidence: '' }])
})

test('trava: campo obrigatorio faltando recusa', () => {
  const gate = checkStageGate({
    requiredFields: ['name', 'city'],
    lead: { name: 'Ana', city: '  ' },
    criteria: [{ name: 'Volume', status: 'atendido', evidence: 'x' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, false)
  assert.deepEqual(gate.missingFields, ['city'])
  assert.match(formatGateRefusal(gate), /campos obrigatorios: cidade/)
})

test('trava: criterio pendente recusa', () => {
  const gate = checkStageGate({
    requiredFields: [],
    lead: {},
    criteria: [{ name: 'Volume', status: 'atendido', evidence: 'x' }, { name: 'Prazo', status: 'pendente', evidence: '' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, false)
  assert.deepEqual(gate.pendingCriteria, ['Prazo'])
  assert.match(formatGateRefusal(gate), /criterios pendentes: Prazo/)
})

test('trava: sem analise recusa; criterios vazios com texto de qualificacao recusa', () => {
  const semAnalise = checkStageGate({ requiredFields: [], lead: {}, criteria: null, hasQualificationText: false })
  assert.equal(semAnalise.allowed, false)
  assert.equal(semAnalise.noAnalysis, true)
  assert.match(formatGateRefusal(semAnalise), /record_analysis/)
  const vazio = checkStageGate({ requiredFields: [], lead: {}, criteria: [], hasQualificationText: true })
  assert.equal(vazio.allowed, false)
  assert.equal(vazio.noCriteriaEvaluated, true)
})

test('trava: tudo atendido libera', () => {
  const gate = checkStageGate({
    requiredFields: ['name'],
    lead: { name: 'Ana' },
    criteria: [{ name: 'Volume', status: 'atendido', evidence: '200 litros' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, true)
})

test('shouldSdrHandoff exige algo para qualificar', () => {
  assert.equal(shouldSdrHandoff({ requiredFields: [], lead: {}, criteria: [], hasQualificationText: false }), false)
  assert.equal(shouldSdrHandoff({ requiredFields: ['name'], lead: { name: 'Ana' }, criteria: [], hasQualificationText: false }), true)
  assert.equal(shouldSdrHandoff({ requiredFields: [], lead: {}, criteria: [{ name: 'V', status: 'atendido', evidence: '' }], hasQualificationText: true }), true)
  assert.equal(shouldSdrHandoff({ requiredFields: ['name'], lead: {}, criteria: [], hasQualificationText: false }), false)
})

test('buildQualificationSummary lista criterios, chance e trava', () => {
  const text = buildQualificationSummary(
    { ai_close_chance: 60, ai_main_blocker: 'preco' },
    [{ name: 'Volume', status: 'atendido', evidence: '200 litros' }],
  )
  assert.match(text, /Resumo da qualificacao/)
  assert.match(text, /Volume: atendido — "200 litros"/)
  assert.match(text, /Chance de fechar: 60%/)
  assert.match(text, /Trava principal: preco/)
})

test('buildSalesRulesLines: regra de preco em todos; copilot nao transfere', () => {
  const sdr = buildSalesRulesLines('sdr').join('\n')
  assert.match(sdr, /NUNCA passe orcamento/)
  assert.match(sdr, /record_analysis/)
  assert.doesNotMatch(sdr, /Nao transfira/)
  assert.match(buildSalesRulesLines('copilot').join('\n'), /Nao transfira/)
})

test('buildSalesRulesLines: objecao de preco usa contorno da base antes da empatia, sempre segue perguntando e nunca recusa seco', () => {
  const rules = buildSalesRulesLines('auto').join('\n')
  assert.match(rules, /CONTEXTO DA EMPRESA/)
  assert.match(rules, /contorne com empatia/)
  assert.match(rules, /PROXIMA pergunta de qualificacao/)
  assert.match(rules, /Nunca recuse seco/)
})

test('saveLeadAnalysis grava no lead da conta e zera o contador', () => {
  const db = createTestDb()
  const { accountId, leadId } = seedAccountAndLead(db)
  db.prepare('UPDATE leads SET ai_msgs_since_analysis = 4 WHERE id = ?').run(leadId)
  saveLeadAnalysis(db, accountId, leadId, { moment: 'objecao', closeChance: 55, mainBlocker: 'preco', criteria: [{ name: 'Volume', status: 'pendente', evidence: '' }] })
  const row = db.prepare('SELECT ai_moment, ai_close_chance, ai_main_blocker, ai_criteria_json, ai_msgs_since_analysis FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.ai_moment, 'objecao')
  assert.equal(row.ai_close_chance, 55)
  assert.equal(row.ai_main_blocker, 'preco')
  assert.deepEqual(JSON.parse(row.ai_criteria_json), [{ name: 'Volume', status: 'pendente', evidence: '' }])
  assert.equal(row.ai_msgs_since_analysis, 0)
})

test('saveLeadAnalysis nao grava em lead de outra conta', () => {
  const db = createTestDb()
  const { leadId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  saveLeadAnalysis(db, outra.accountId, leadId, { moment: 'x', closeChance: 10, mainBlocker: null, criteria: [] })
  assert.equal(db.prepare('SELECT ai_moment FROM leads WHERE id = ?').get(leadId).ai_moment, null)
})


// ─── Trava de etapa no handoff (item 3): a regra de handoff nao pode furar o gate ───
// Quem escolhe o reason do handoff e a propria IA, entao uma regra "keyword -> Qualificado"
// movia o lead para Qualificado sem nenhum criterio atendido.

const agenteQualifica = { required_fields: '["name","city"]', qualification_criteria: 'tem orcamento?' }
const leadCompleto = {
  name: 'Ana', city: 'Sao Paulo',
  ai_criteria_json: JSON.stringify([{ name: 'tem orcamento?', status: 'atendido', evidence: 'tenho 5k' }]),
}
const leadIncompleto = { name: 'Ana', city: null, ai_criteria_json: null }

test('gateForLead: lead completo passa, lead sem campo/analise nao passa', () => {
  assert.equal(gateForLead(agenteQualifica, leadCompleto).allowed, true)
  const gate = gateForLead(agenteQualifica, leadIncompleto)
  assert.equal(gate.allowed, false)
  assert.deepEqual(gate.missingFields, ['city'])
  assert.equal(gate.noAnalysis, true)
})

test('handoff com move_to_stage_id: bloqueado quando a qualificacao nao esta completa', () => {
  const rule = { reason: 'keyword', move_to_stage_id: 7 }
  const gate = gateForLead(agenteQualifica, leadIncompleto)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, rule, gate }), false)
})

test('handoff com move_to_stage_id: liberado quando a qualificacao esta completa', () => {
  const rule = { reason: 'keyword', move_to_stage_id: 7 }
  const gate = gateForLead(agenteQualifica, leadCompleto)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, rule, gate }), true)
})

test('a trava vale para todo reason escolhido pela IA, nao so qualified', () => {
  const gate = gateForLead(agenteQualifica, leadIncompleto)
  for (const reason of ['keyword', 'unknown', 'max_messages', 'other', 'audio_received']) {
    assert.equal(
      handoffStageMoveAllowed({ salesEngine: true, rule: { reason, move_to_stage_id: 7 }, gate }),
      false,
      `reason=${reason} nao pode furar a trava`
    )
  }
})

test('regra sem move_to_stage_id nunca move etapa (handoff em si continua acontecendo)', () => {
  const gate = gateForLead(agenteQualifica, leadCompleto)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, rule: { reason: 'keyword' }, gate }), false)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, rule: null, gate }), false)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, gate }), false)
})

test('sem salesEngine o comportamento antigo volta (move sem gate)', () => {
  const gate = gateForLead(agenteQualifica, leadIncompleto)
  assert.equal(handoffStageMoveAllowed({ salesEngine: false, rule: { move_to_stage_id: 7 }, gate }), true)
})

test('agente sem criterios nem campos obrigatorios: gate nao trava por falta de analise avaliada', () => {
  // agente 'auto' simples, sem qualificacao configurada: exige so a analise da conversa
  const agenteSimples = { required_fields: null, qualification_criteria: null }
  const semAnalise = gateForLead(agenteSimples, { name: 'Ana' })
  assert.equal(semAnalise.allowed, false, 'sem record_analysis a IA ainda nao pode mover a etapa')
  const comAnalise = gateForLead(agenteSimples, { name: 'Ana', ai_criteria_json: '[]' })
  assert.equal(comAnalise.allowed, true)
  assert.equal(handoffStageMoveAllowed({ salesEngine: true, rule: { move_to_stage_id: 7 }, gate: comAnalise }), true)
})

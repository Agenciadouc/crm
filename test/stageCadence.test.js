import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stageChipLabel, stepShortText, stepDayText, metricBadge, metricWhy, moveStep, dropStep, formFromStep, stepPatchFor,
  createSaveQueue, saveStatusLabel, readyDeviations, suggestionsForStep, stageSuggestions, testForStep, stageFromSearch,
  stageSummary, sseTouchesView, deviationSuggestions, stageChipTitle, SPIN_OPTIONS,
} from '../src/lib/stageCadence.js'

function fakeTimers() {
  let fn = null
  return { setTimer: f => { fn = f; return 1 }, clearTimer: () => { fn = null }, fire: () => { const f = fn; fn = null; return f ? f() : undefined } }
}
function deferred() {
  let resolve, reject
  const p = new Promise((r, j) => { resolve = r; reject = j })
  return { p, resolve, reject }
}
const tick = () => new Promise(r => setImmediate(r))

test('chip da etapa: passos e perguntas no singular e plural', () => {
  assert.equal(stageChipLabel({ name: 'Novo Lead', summary: { steps: 4, questions: 2 } }), 'Novo Lead · 4 passos · 2 perguntas')
  assert.equal(stageChipLabel({ name: 'Proposta', summary: { steps: 1, questions: 1 } }), 'Proposta · 1 passo · 1 pergunta')
  assert.equal(stageChipLabel({ name: 'Visita', summary: { steps: 3, questions: 0 } }), 'Visita · 3 passos')
  assert.equal(stageChipLabel({ name: 'Negociação', summary: { steps: 0, questions: 0 } }), 'Negociação · sem passos')
})

test('linha do passo: texto curto e dia', () => {
  assert.equal(stepShortText({ action_type: 'pergunta', question: { text: 'Para quando é o seu evento, {nome}?' }, description: 'x' }), 'Para quando é o seu evento, {nome}?')
  assert.equal(stepShortText({ action_type: 'mensagem', auto_message: 'Oi {nome}, segue o catálogo com todos os preços e fotos dos salões', description: null }, 30), 'Oi {nome}, segue o catálogo c…')
  assert.equal(stepShortText({ action_type: 'ligacao', description: null, instructions: null }), 'Ligação')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 0 }), 'mesmo dia')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 1 }), '+1 dia')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 3 }), '+3 dias')
  assert.equal(stepDayText({ schedule_mode: 'duration', delay_minutes: 90 }), '+1h30')
  assert.equal(stepDayText({ schedule_mode: 'duration', delay_minutes: 20 }), '+20 min')
})

test('selo da metrica e o porque', () => {
  assert.equal(metricBadge(null), null)
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 0, reply_rate: null, status: 'amostra_pequena' }), { text: 'sem envios ainda', tone: 'muted' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 8, reply_rate: 62.5, status: 'amostra_pequena' }), { text: 'respondem 63% · poucos envios', tone: 'muted' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 40, reply_rate: 45, status: 'fraca' }), { text: 'respondem 45% · fraca', tone: 'bad' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 40, reply_rate: 80, status: 'ok' }), { text: 'respondem 80%', tone: 'good' })
  assert.deepEqual(metricBadge({ kind: 'feitas', done: 12, reached: 30 }), { text: 'feitas 12 de 30 leads', tone: 'muted' })
  assert.equal(metricWhy({ kind: 'resposta', sent: 40, reply_rate: 45, status: 'fraca' }, { windowH: 24, minRate: 70 }),
    'De 40 envios nos últimos 90 dias, 45% tiveram resposta em até 24h. Abaixo de 70% conta como fraca.')
  assert.equal(metricWhy({ kind: 'feitas', done: 12, reached: 30 }, { windowH: 24, minRate: 70 }),
    'Dos 30 leads que entraram nesta cadência nos últimos 90 dias, 12 tiveram este passo marcado como feito.')
})

test('ordem: subir/descer e arrastar', () => {
  assert.deepEqual(moveStep([1, 2, 3], 2, -1), [2, 1, 3])
  assert.deepEqual(moveStep([1, 2, 3], 3, 1), [1, 2, 3])
  assert.deepEqual(dropStep([1, 2, 3, 4], 1, 3), [2, 3, 1, 4])
  assert.deepEqual(dropStep([1, 2, 3, 4], 4, 2), [1, 4, 2, 3])
  assert.deepEqual(dropStep([1, 2], 1, 1), [1, 2])
})

test('ordem: id que nao esta na lista nao mexe em nada', () => {
  assert.deepEqual(moveStep([1, 2, 3], 9, 1), [1, 2, 3])
  assert.deepEqual(moveStep([1, 2, 3], 1, -1), [1, 2, 3])
  assert.deepEqual(dropStep([1, 2, 3], 9, 2), [1, 2, 3])
  assert.deepEqual(dropStep([1, 2, 3], 1, 9), [1, 2, 3])
  assert.deepEqual(dropStep([1, 2, 3], null, 2), [1, 2, 3])
})

test('formulario da pergunta: valida antes de mandar e guarda option_key', () => {
  const step = { action_type: 'pergunta', delay_days: 0, question: { text: 'Para quando?', kind: 'options', required: true, spin: 'situation', ai_hint: null,
    options: [{ option_key: 'a1', label: 'Até 30 dias', points: 15 }, { option_key: 'b2', label: 'Mais de 30 dias', points: 5 }] } }
  const form = formFromStep(step)
  const ok = stepPatchFor('pergunta', form)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.patch.question.options.map(o => [o.option_key, o.label, o.points]), [['a1', 'Até 30 dias', 15], ['b2', 'Mais de 30 dias', 5]])
  assert.deepEqual(stepPatchFor('pergunta', { ...form, text: '  ' }), { ok: false, reason: 'Escreva a pergunta.' })
  assert.deepEqual(stepPatchFor('pergunta', { ...form, options: [form.options[0], { label: '', points: '' }] }),
    { ok: false, reason: 'Coloque pelo menos 2 opções (ex.: "Até 30 dias" e "Mais de 30 dias").' })
  assert.deepEqual(stepPatchFor('pergunta', { ...form, options: [form.options[0], { ...form.options[1], points: '99' }] }),
    { ok: false, reason: 'Os pontos vão de -50 a 50 (ex.: 15).' })
  const livre = stepPatchFor('pergunta', { ...form, kind: 'text' })
  assert.deepEqual(livre.patch.question.options, [])
  const msg = stepPatchFor('mensagem', formFromStep({ action_type: 'mensagem', auto_message: 'Oi', delay_days: 2 }))
  assert.deepEqual(msg, { ok: true, patch: { auto_message: 'Oi', delay_days: 2 } })
  const lig = stepPatchFor('ligacao', { ...formFromStep({ action_type: 'ligacao', delay_days: 1 }), description: 'Ligar', call_script: '1) Oi' })
  assert.deepEqual(lig, { ok: true, patch: { description: 'Ligar', instructions: null, call_script: '1) Oi', delay_days: 1 } })
})

test('formulario da pergunta: opcao reordenada ou editada continua com a mesma option_key', () => {
  const step = { action_type: 'pergunta', question: { text: 'Orçamento?', kind: 'options', required: false, spin: null, ai_hint: null,
    options: [{ option_key: 'k1', label: 'Até 5 mil', points: 5 }, { option_key: 'k2', label: 'Mais de 5 mil', points: 15 }] } }
  const form = formFromStep(step)
  const edited = { ...form, options: [{ ...form.options[1], label: 'Acima de 5 mil' }, form.options[0], { label: 'Não sei', points: '' }] }
  const r = stepPatchFor('pergunta', edited)
  assert.equal(r.ok, true)
  assert.deepEqual(r.patch.question.options, [
    { option_key: 'k2', label: 'Acima de 5 mil', points: 15, position: 0 },
    { option_key: 'k1', label: 'Até 5 mil', points: 5, position: 1 },
    { label: 'Não sei', points: 0, position: 2 },
  ])
})

test('fila de salvamento: duas edicoes rapidas viram um envio so, com o texto final', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  const q = createSaveQueue({ save: p => { sent.push(p); return Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('a'); q.push('ab')
  await t.fire(); await tick()
  assert.deepEqual(sent, ['ab'])
  assert.equal(st[st.length - 1], 'salvo')
})

test('fila de salvamento: editar durante o envio nunca manda dois juntos e Salvo so vem no fim', async () => {
  const t = fakeTimers(); const sent = []; const st = []; const d1 = deferred()
  const q = createSaveQueue({ save: p => { sent.push(p); return sent.length === 1 ? d1.p : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('v1'); t.fire()
  q.push('v2'); t.fire()
  assert.deepEqual(sent, ['v1'])
  assert.ok(!st.includes('salvo'))
  assert.equal(q.busy(), true)
  d1.resolve(); await tick(); await tick()
  assert.deepEqual(sent, ['v1', 'v2'])
  assert.equal(st[st.length - 1], 'salvo')
  assert.equal(q.busy(), false)
})

test('fila de salvamento: erro guarda o ultimo texto e Tentar de novo reenvia', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  let fail = true
  const q = createSaveQueue({ save: p => { sent.push(p); return fail ? Promise.reject(new Error('rede')) : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('texto'); t.fire(); await tick(); await tick()
  assert.equal(st[st.length - 1], 'erro')
  fail = false
  await q.retry(); await tick()
  assert.deepEqual(sent, ['texto', 'texto'])
  assert.equal(st[st.length - 1], 'salvo')
  assert.deepEqual([saveStatusLabel('salvando'), saveStatusLabel('salvo'), saveStatusLabel('erro'), saveStatusLabel('idle')], ['Salvando…', 'Salvo', 'Não salvou.', ''])
})

test('fila de salvamento: envio que falha com texto novo esperando manda o novo e nao mostra erro', async () => {
  const t = fakeTimers(); const sent = []; const st = []; const d1 = deferred()
  const q = createSaveQueue({ save: p => { sent.push(p); return sent.length === 1 ? d1.p : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('v1'); t.fire()
  q.push('v2')
  d1.reject(new Error('rede')); await tick(); await tick()
  assert.deepEqual(sent, ['v1', 'v2'])
  assert.ok(!st.includes('erro'))
  assert.equal(st[st.length - 1], 'salvo')
})

test('fila de salvamento: flush manda na hora e save que lanca vira erro', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  const q = createSaveQueue({ save: p => { sent.push(p); throw new Error('quebrou') }, onStatus: s => st.push(s), ...t })
  q.push('x')
  await q.flush()
  assert.deepEqual(sent, ['x'])
  assert.equal(st[st.length - 1], 'erro')
  assert.equal(q.busy(), false)
  // nada pendente: flush nao reenvia
  await q.flush()
  assert.deepEqual(sent, ['x'])
})

test('fila de salvamento: tentar de novo sem erro nao manda nada', async () => {
  const t = fakeTimers(); const sent = []
  const q = createSaveQueue({ save: p => { sent.push(p); return Promise.resolve() }, ...t })
  await q.retry()
  assert.deepEqual(sent, [])
})

test('desvios prontos, sugestoes por passo/etapa, teste A/B do passo e etapa pela URL', () => {
  assert.deepEqual(readyDeviations([{ triggers: 'preço', reply_text: 'Depende' }, { triggers: ' ', reply_text: 'x' }]).length, 1)
  const sug = [
    { id: 1, type: 'rewrite', question_key: 'k1', payload: {} },
    { id: 2, type: 'reorder', question_key: null, payload: { stage_id: 7 } },
    { id: 3, type: 'new_deviation', question_key: null, payload: {} },
    { id: 4, type: 'new_option', question_key: 'k2', payload: {} },
  ]
  assert.deepEqual(suggestionsForStep(sug, { question_key: 'k1' }).map(s => s.id), [1])
  assert.deepEqual(suggestionsForStep(sug, { question_key: null }), [])
  assert.deepEqual(stageSuggestions(sug, 7).map(s => s.id), [2])
  const tests = [{ id: 9, question_key: 'k1', status: 'won', decided: true }, { id: 10, question_key: 'k1', status: 'testing', decided: false }]
  assert.equal(testForStep(tests, { question_key: 'k1' }).id, 10)
  const stages = [{ id: 1, is_terminal: false }, { id: 2, is_terminal: false }, { id: 3, is_terminal: true }]
  assert.equal(stageFromSearch('?aba=manuais&etapa=2', stages), 2)
  assert.equal(stageFromSearch('?etapa=3', stages), 1)
  assert.equal(stageFromSearch('', stages), 1)
})

test('sugestoes de desvio so do funil aberto (ou sem funil)', () => {
  const sug = [
    { id: 1, type: 'new_deviation', funnel_id: 5, question_key: null, payload: {} },
    { id: 2, type: 'new_deviation', funnel_id: 6, question_key: null, payload: {} },
    { id: 3, type: 'new_deviation', funnel_id: null, question_key: null, payload: {} },
    { id: 4, type: 'rewrite', funnel_id: 5, question_key: 'k', payload: {} },
  ]
  assert.deepEqual(deviationSuggestions(sug, 5).map(s => s.id), [1, 3])
})

test('resumo da etapa conta passos e perguntas da cadencia', () => {
  assert.deepEqual(stageSummary(null), { steps: 0, questions: 0 })
  assert.deepEqual(stageSummary({ attempts: [{ action_type: 'pergunta' }, { action_type: 'mensagem' }, { action_type: 'pergunta' }] }), { steps: 3, questions: 2 })
})

test('aviso cadence:updated: aceita os dois formatos e so recarrega o que e da tela', () => {
  const stageIds = [10, 11]
  assert.equal(sseTouchesView({ cadence_id: 1, stage_id: 11 }, 5, stageIds), true)
  assert.equal(sseTouchesView({ cadence_id: 1, stage_id: 99 }, 5, stageIds), false)
  assert.equal(sseTouchesView({ funnel_id: 5 }, 5, stageIds), true)
  assert.equal(sseTouchesView({ funnel_id: 6 }, 5, stageIds), false)
  assert.equal(sseTouchesView({ funnel_id: '5' }, 5, stageIds), true)
  assert.equal(sseTouchesView(null, 5, stageIds), false)
  assert.equal(sseTouchesView({}, 5, stageIds), false)
})

test('fila de salvamento: tentar de novo ao sair do passo reenvia o texto que falhou', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  let fail = true
  const q = createSaveQueue({ save: p => { sent.push(p); return fail ? Promise.reject(new Error('rede')) : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('texto final'); t.fire(); await tick(); await tick()
  assert.equal(st[st.length - 1], 'erro')
  // flush sozinho nao reenvia (e por isso a saida do passo usa retry)
  await q.flush()
  assert.deepEqual(sent, ['texto final'])
  fail = false
  await q.retry()
  assert.deepEqual(sent, ['texto final', 'texto final'])
  assert.equal(st[st.length - 1], 'salvo')
  // falhou de novo ao sair: status volta a ser erro (a tela avisa)
  fail = true
  q.push('outro'); await q.retry()
  assert.deepEqual(sent, ['texto final', 'texto final', 'outro'])
  assert.equal(st[st.length - 1], 'erro')
})

test('campo Dia vazio ou invalido nao salva', () => {
  const form = formFromStep({ action_type: 'mensagem', auto_message: 'Oi', delay_days: 2 })
  const reason = 'Coloque o dia: 0 ou mais (ex.: 0 = no mesmo dia).'
  assert.deepEqual(stepPatchFor('mensagem', { ...form, delay_days: '' }), { ok: false, reason })
  assert.deepEqual(stepPatchFor('ligacao', { ...form, delay_days: '-1' }), { ok: false, reason })
  assert.deepEqual(stepPatchFor('pergunta', { ...formFromStep({ action_type: 'pergunta', question: { text: 'Quando?', kind: 'text', required: false, spin: null, ai_hint: null, options: [] } }), delay_days: '1.5' }), { ok: false, reason })
  assert.deepEqual(stepPatchFor('mensagem', { ...form, delay_days: '3' }), { ok: true, patch: { auto_message: 'Oi', delay_days: 3 } })
})

test('porque dos numeros do chip', () => {
  assert.equal(stageChipTitle({ summary: { steps: 4, questions: 2 } }), '4 passos que o vendedor segue nesta etapa, na ordem; 2 são perguntas do roteiro.')
  assert.equal(stageChipTitle({ summary: { steps: 1, questions: 0 } }), '1 passo que o vendedor segue nesta etapa, na ordem; nenhum é pergunta do roteiro.')
  assert.equal(stageChipTitle({ summary: { steps: 1, questions: 1 } }), '1 passo que o vendedor segue nesta etapa, na ordem; 1 é pergunta do roteiro.')
  assert.equal(stageChipTitle({ summary: { steps: 0, questions: 0 } }), 'Nenhum passo ainda. Clique para montar a cadência desta etapa.')
})

test('formulario da pergunta leva fase SPIN, perfil e "define o perfil" das opcoes', () => {
  const step = { action_type: 'pergunta', delay_days: 0, question: { text: 'Tem loja?', kind: 'options', required: true, spin: 'situation', profile_key: null, ai_hint: null,
    options: [{ option_key: 'a', label: 'Sim', points: 5, sets_profile_key: 'loja' }, { option_key: 'b', label: 'Não', points: 0, sets_profile_key: null }] } }
  const form = formFromStep(step)
  assert.equal(form.spin, 'situation'); assert.equal(form.profile_key, null); assert.equal(form.options[0].sets_profile_key, 'loja')
  const r = stepPatchFor('pergunta', { ...form, profile_key: 'porta' })
  assert.equal(r.patch.question.spin, 'situation'); assert.equal(r.patch.question.profile_key, 'porta')
  assert.deepEqual(r.patch.question.options.map(o => o.sets_profile_key ?? null), ['loja', null])
  assert.equal('bant' in r.patch.question, false)
  assert.deepEqual(SPIN_OPTIONS.map(o => o.label), ['Situação', 'Problema', 'Implicação', 'Necessidade de Solução'])
})

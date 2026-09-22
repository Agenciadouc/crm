import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY_KEYS, defaultSchedule, resolveFirstMessage, buildFirstMessageSave,
  resolveServiceHours, buildServiceHoursSave, scheduleErrors, holdSendsError,
} from '../src/lib/numberSettings.js'

// ---- Primeira mensagem ----

test('primeira mensagem: so a de formulario/planilha', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: ' Oi {{primeiro_nome}} ', greeting_text: null, greeting_enabled: 0 }),
    { text: 'Oi {{primeiro_nome}}', onAssign: true, onInbound: false, conflict: null },
  )
})

test('primeira mensagem: so a saudacao ligada', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: null, greeting_text: 'Olá!', greeting_enabled: 1 }),
    { text: 'Olá!', onAssign: false, onInbound: true, conflict: null },
  )
})

test('primeira mensagem: saudacao com texto mas desligada aparece desmarcada', () => {
  assert.deepEqual(
    resolveFirstMessage({ greeting_text: 'Olá!', greeting_enabled: 0 }),
    { text: 'Olá!', onAssign: false, onInbound: false, conflict: null },
  )
})

test('primeira mensagem: textos iguais nao sao conflito', () => {
  const r = resolveFirstMessage({ first_msg_template: 'Oi', greeting_text: ' Oi ', greeting_enabled: 1 })
  assert.equal(r.conflict, null)
  assert.equal(r.onAssign && r.onInbound, true)
})

test('primeira mensagem: textos diferentes mostram o outro sem perder nada', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: 'A', greeting_text: 'B', greeting_enabled: 1 }),
    { text: 'A', onAssign: true, onInbound: true, conflict: { otherText: 'B' } },
  )
})

test('primeira mensagem: nada configurado', () => {
  assert.deepEqual(resolveFirstMessage({}), { text: '', onAssign: false, onInbound: false, conflict: null })
})

test('salvar primeira mensagem: as duas situacoes', () => {
  assert.deepEqual(buildFirstMessageSave({ text: ' Oi ', onAssign: true, onInbound: true }),
    { first_msg_template: 'Oi', greeting_text: 'Oi', greeting_enabled: 1 })
})

test('salvar primeira mensagem: so formulario guarda o texto tambem na saudacao desligada', () => {
  assert.deepEqual(buildFirstMessageSave({ text: 'Oi', onAssign: true, onInbound: false }),
    { first_msg_template: 'Oi', greeting_text: 'Oi', greeting_enabled: 0 })
})

test('salvar primeira mensagem: nenhuma situacao marcada nao perde o texto', () => {
  assert.deepEqual(buildFirstMessageSave({ text: 'Oi', onAssign: false, onInbound: false }),
    { first_msg_template: null, greeting_text: 'Oi', greeting_enabled: 0 })
})

test('salvar primeira mensagem: texto vazio desliga tudo', () => {
  assert.deepEqual(buildFirstMessageSave({ text: '   ', onAssign: true, onInbound: true }),
    { first_msg_template: null, greeting_text: null, greeting_enabled: 0 })
})

// ---- Horario de atendimento ----

const soSegundaManha = { mon: [{ start: '08:00', end: '12:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

test('horario: usa o da ausencia e completa os dias que faltam', () => {
  const r = resolveServiceHours({ away_schedule_json: JSON.stringify({ mon: [{ start: '08:00', end: '12:00' }] }), business_hours_json: null })
  assert.deepEqual(r, { schedule: soSegundaManha, holdSends: false, conflict: false })
})

test('horario: sem ausencia usa o da trava e marca segurar envios', () => {
  const r = resolveServiceHours({ away_schedule_json: null, business_hours_json: JSON.stringify(soSegundaManha) })
  assert.deepEqual(r, { schedule: soSegundaManha, holdSends: true, conflict: false })
})

test('horario: nenhum configurado usa o padrao seg-sex 9h-18h', () => {
  const r = resolveServiceHours({})
  assert.deepEqual(r.schedule, defaultSchedule())
  assert.equal(r.schedule.fri[0].end, '18:00')
  assert.deepEqual(r.schedule.sat, [])
  assert.equal(r.holdSends, false)
})

test('horario: iguais nao e conflito; diferentes e conflito', () => {
  const iguais = resolveServiceHours({ away_schedule_json: JSON.stringify(soSegundaManha), business_hours_json: JSON.stringify(soSegundaManha) })
  assert.equal(iguais.conflict, false)
  const outro = { ...soSegundaManha, tue: [{ start: '10:00', end: '11:00' }] }
  const diferentes = resolveServiceHours({ away_schedule_json: JSON.stringify(soSegundaManha), business_hours_json: JSON.stringify(outro) })
  assert.equal(diferentes.conflict, true)
  assert.deepEqual(diferentes.schedule, soSegundaManha)
  assert.equal(diferentes.holdSends, true)
})

test('horario: json invalido e ignorado', () => {
  const r = resolveServiceHours({ away_schedule_json: 'nao-json', business_hours_json: '[1,2]' })
  assert.deepEqual(r.schedule, defaultSchedule())
  assert.equal(r.holdSends, false)
})

test('horario: salvar normaliza os dias e manda a caixa', () => {
  const r = buildServiceHoursSave({ ...soSegundaManha, tue: [{ start: '', end: '' }] }, true)
  assert.deepEqual(JSON.parse(r.away_schedule_json), soSegundaManha)
  assert.equal(r.hold_sends_outside_hours, true)
  assert.deepEqual(Object.keys(JSON.parse(r.away_schedule_json)), DAY_KEYS)
})

test('horario: aponta horario invertido e horario vazio', () => {
  const errs = scheduleErrors({ ...soSegundaManha, wed: [{ start: '18:00', end: '09:00' }], sat: [{ start: '', end: '12:00' }] })
  assert.deepEqual(errs, [
    'Quarta: o horário 18:00–09:00 termina antes de começar.',
    'Sábado: preencha o início e o fim do horário.',
  ])
  assert.deepEqual(scheduleErrors(soSegundaManha), [])
})

// A tela precisa barrar ANTES de salvar: com a semana toda "Fechado" e a caixa
// "Segurar envios" marcada, o numero pararia de mandar tudo que e automatico.
test('horario: segurar envios com a semana toda fechada e barrado na tela', () => {
  const fechado = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
  assert.match(holdSendsError(fechado, true), /Fechado/)
  assert.match(holdSendsError(fechado, true), /pelo menos uma faixa/)
})

test('horario: faixa pela metade nao conta como horario preenchido', () => {
  const meia = { mon: [{ start: '09:00', end: '' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
  assert.notEqual(holdSendsError(meia, true), null)
})

test('horario: sem segurar envios, semana toda fechada e permitida', () => {
  const fechado = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
  assert.equal(holdSendsError(fechado, false), null)
})

test('horario: uma faixa em um dia ja libera segurar envios', () => {
  assert.equal(holdSendsError(soSegundaManha, true), null)
  assert.equal(holdSendsError(defaultSchedule(), true), null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAutoMessageVars, renderHandoffTemplate } from '../server/services/messageTemplateVars.js'

const lead = { name: 'Maria Souza', phone: '5511999990000', empresa: 'ACME', city: 'Campinas', attendant_name: 'Hemily Vitoria' }
const inst = { instance_name: 'Comercial' }

test('saudacao continua entendendo as variaveis antigas dela', () => {
  const t = applyAutoMessageVars('Oi {{primeiro_nome}} ({{name}}) da {{empresa}} em {{cidade}} - {{instance}} - {{atendente}} / {{atendente_nome}} / {{first_name}} / {{attendant}} / {{phone}}', lead, inst)
  assert.equal(t, 'Oi Maria (Maria Souza) da ACME em Campinas - Comercial - Hemily Vitoria / Hemily / Maria / Hemily Vitoria / 5511999990000')
})

test('saudacao passa a entender as variaveis da primeira mensagem', () => {
  const t = applyAutoMessageVars('{{nome}} | {{vendedor}} | {{vendedor_primeiro_nome}} | [{{etapa}}{{funil}}]', lead, inst)
  assert.equal(t, 'Maria Souza | Hemily Vitoria | Hemily | []')
})

test('saudacao sem nome usa Cliente e sem atendente usa nosso time', () => {
  assert.equal(applyAutoMessageVars('{{primeiro_nome}} {{nome}} {{vendedor}} {{atendente_nome}}', {}, inst), 'Cliente Cliente nosso time nosso time')
})

test('saudacao vazia volta como veio', () => {
  assert.equal(applyAutoMessageVars('', lead, inst), '')
  assert.equal(applyAutoMessageVars(null, lead, inst), null)
})

const vars = {
  lead_name: 'Maria Souza', lead_first_name: 'Maria', user_name: 'Hemily Vitoria', user_first_name: 'Hemily',
  city: 'Campinas', phone: '5511', stage_name: 'Novo', funnel_name: 'Vendas', empresa: 'ACME', instance_name: 'Comercial',
}

test('primeira mensagem continua entendendo as variaveis antigas dela', () => {
  assert.equal(
    renderHandoffTemplate('{{primeiro_nome}} {{nome}} {{vendedor}} {{vendedor_primeiro_nome}} {{cidade}} {{phone}} {{etapa}} {{funil}}', vars),
    'Maria Maria Souza Hemily Vitoria Hemily Campinas 5511 Novo Vendas',
  )
})

test('primeira mensagem passa a entender as variaveis da saudacao', () => {
  assert.equal(
    renderHandoffTemplate('{{name}} {{atendente}} {{atendente_nome}} {{empresa}} {{instance}} {{first_name}}', vars),
    'Maria Souza Hemily Vitoria Hemily ACME Comercial Maria',
  )
})

test('primeira mensagem vazia volta texto vazio', () => {
  assert.equal(renderHandoffTemplate(null, vars), '')
  assert.equal(renderHandoffTemplate('', vars), '')
})

test('primeira mensagem sem dados deixa as variaveis em branco (como hoje)', () => {
  assert.equal(renderHandoffTemplate('Oi {{primeiro_nome}}!', {}), 'Oi !')
})

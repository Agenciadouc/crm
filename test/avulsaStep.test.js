import { test } from 'node:test'
import assert from 'node:assert/strict'
import { avulsaStepLabel, avulsaStepView, avulsaReviewPos, telHref } from '../src/lib/avulsaStep.js'

const fill = t => t.replace(/\{\{primeiro_nome\}\}/g, 'Ana')

test('rotulo "Passo N de M · Tipo" da cadencia avulsa', () => {
  assert.equal(avulsaStepLabel({ attempt_position: 0, total_attempts: 2, action_type: 'mensagem' }), 'Passo 1 de 2 · Mensagem')
  assert.equal(avulsaStepLabel({ attempt_position: 2, total_attempts: 3, action_type: 'ligacao' }), 'Passo 3 de 3 · Ligação')
  assert.equal(avulsaStepLabel({ attempt_position: 1, total_attempts: 4, action_type: 'whatsapp' }), 'Passo 2 de 4 · WhatsApp')
  // sem posicao: primeiro passo; sem tipo: so o numero
  assert.equal(avulsaStepLabel({ total_attempts: 2, action_type: 'visita' }), 'Passo 1 de 2 · Visita')
  assert.equal(avulsaStepLabel({ attempt_position: 0, total_attempts: 2, action_type: null }), 'Passo 1 de 2')
  assert.equal(avulsaStepLabel(null), '')
})

test('passo mensagem: mostra o texto com as variaveis e tem [Enviar] + [Pular]', () => {
  const v = avulsaStepView({ action_type: 'mensagem', attempt_message: 'Oi {{primeiro_nome}}, tudo bem?' }, fill)
  assert.deepEqual(v, { kind: 'mensagem', title: '', text: 'Oi Ana, tudo bem?', actions: ['enviar', 'feito', 'pular'] })
  const w = avulsaStepView({ action_type: 'whatsapp', attempt_message: 'Oi' }, fill)
  assert.deepEqual(w.actions, ['enviar', 'feito', 'pular'])
})

test('passo mensagem sem texto: continua com [Enviar] (a janela abre vazia) + [Pular]; descricao vira titulo', () => {
  assert.deepEqual(
    avulsaStepView({ action_type: 'mensagem', attempt_message: '   ', attempt_description: 'Mandar o catálogo' }, fill),
    { kind: 'mensagem', title: 'Mandar o catálogo', text: '', actions: ['enviar', 'feito', 'pular'] },
  )
  // variavel que some (empresa vazia) tambem conta como vazio
  assert.deepEqual(avulsaStepView({ action_type: 'mensagem', attempt_message: null }, fill), { kind: 'mensagem', title: '', text: '', actions: ['enviar', 'feito', 'pular'] })
  assert.deepEqual(avulsaStepView({ action_type: 'mensagem', attempt_message: '{{x}}' }, () => '').actions, ['enviar', 'feito', 'pular'])
})

test('passo ligacao: mostra o roteiro (ou a descricao) e tem [Ver roteiro e concluir] + [Pular]', () => {
  assert.deepEqual(
    avulsaStepView({ action_type: 'ligacao', attempt_script: 'Oi, aqui é da loja...', attempt_description: 'Ligar para confirmar' }, fill),
    { kind: 'ligacao', text: 'Oi, aqui é da loja...', actions: ['roteiro', 'pular'] },
  )
  assert.deepEqual(
    avulsaStepView({ action_type: 'ligacao', attempt_script: '', attempt_description: 'Ligar para confirmar' }, fill),
    { kind: 'ligacao', text: 'Ligar para confirmar', actions: ['roteiro', 'pular'] },
  )
})

test('visita, reuniao e e-mail: mostram a descricao com [Feito] + [Pular]', () => {
  for (const t of ['visita', 'reuniao', 'email']) {
    assert.deepEqual(
      avulsaStepView({ action_type: t, attempt_description: 'Levar amostras', attempt_instructions: 'Com o carro da loja' }, fill),
      { kind: 'outro', text: 'Levar amostras', actions: ['feito', 'pular'] },
    )
  }
  // sem descricao: as instrucoes
  assert.equal(avulsaStepView({ action_type: 'visita', attempt_instructions: 'Com o carro' }, fill).text, 'Com o carro')
  // pergunta numa avulsa nao tem [Feito] (o servidor so aceita pular)
  assert.deepEqual(avulsaStepView({ action_type: 'pergunta', attempt_description: 'Qual o orçamento?' }, fill).actions, ['pular'])
  assert.equal(avulsaStepView(null, fill), null)
})

test('"N de M" da janela Conferir mensagem vem da avulsa', () => {
  assert.deepEqual(avulsaReviewPos({ attempt_position: 1, total_attempts: 3 }), { n: 2, m: 3 })
  assert.equal(avulsaReviewPos({ attempt_position: 0, total_attempts: 0 }), null)
})

test('link de ligar: so os digitos (com + se tiver)', () => {
  assert.equal(telHref('+55 (11) 98888-7777'), 'tel:+5511988887777')
  assert.equal(telHref('11 98888-7777'), 'tel:11988887777')
  assert.equal(telHref(''), null)
  assert.equal(telHref(null), null)
})

test('passo mensagem com descricao e texto: a descricao vai em cima como titulo', () => {
  assert.deepEqual(
    avulsaStepView({ action_type: 'mensagem', attempt_message: 'Oi {{primeiro_nome}}!', attempt_description: '  Boas-vindas ' }, fill),
    { kind: 'mensagem', title: 'Boas-vindas', text: 'Oi Ana!', actions: ['enviar', 'feito', 'pular'] },
  )
  // sem texto: a descricao fica so como titulo (o texto vem vazio para o vendedor escrever)
  const empty = avulsaStepView({ action_type: 'mensagem', attempt_message: '', attempt_description: 'Boas-vindas' }, fill)
  assert.equal(empty.title, 'Boas-vindas')
  assert.equal(empty.text, '')
})

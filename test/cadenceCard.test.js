import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardHeader, stageCardActions, avulsaCardActions, cadenceRenderList, stageStepView, NO_TEXT_HINT } from '../src/lib/cadenceCard.js'
import { avulsaStepView } from '../src/lib/avulsaStep.js'

const ids = r => ({ primary: r.primary && r.primary.id, secondary: r.secondary.map(s => s.id) })

test('cabecalho do cartao: "Etapa · nome" / "Avulsa · nome" e "N de M" a direita', () => {
  assert.deepEqual(cardHeader('etapa', 'Novo Lead', 0, 4), { title: 'Etapa · Novo Lead', count: '0 de 4' })
  assert.deepEqual(cardHeader('avulsa', 'teste', 2, 2), { title: 'Avulsa · teste', count: '2 de 2' })
  // sem nome (carregando) e sem total: so o tipo, sem contagem
  assert.deepEqual(cardHeader('etapa', '', 0, 0), { title: 'Etapa', count: '' })
  assert.deepEqual(cardHeader('avulsa', null, null, null), { title: 'Avulsa', count: '' })
})

test('cartao da etapa: pergunta tem [Enviar pergunta] e o link Ja sei a resposta', () => {
  const r = stageCardActions({ action_type: 'pergunta', state: 'pendente' })
  assert.deepEqual(r.primary, { id: 'perguntar', label: 'Enviar pergunta' })
  assert.deepEqual(r.secondary, [{ id: 'ja_sei', label: 'Já sei a resposta' }])
  // ja perguntou (aguardando): o principal vira anotar a resposta
  assert.deepEqual(ids(stageCardActions({ action_type: 'pergunta', state: 'aguardando' })), { primary: 'ja_sei', secondary: [] })
})

test('cartao da etapa: mensagem SEMPRE tem [Enviar mensagem], com ou sem texto', () => {
  for (const step of [
    { action_type: 'mensagem', auto_message: 'Oi {{primeiro_nome}}' },
    { action_type: 'mensagem', auto_message: '', description: '' },
    { action_type: 'whatsapp' },
  ]) {
    const r = stageCardActions(step)
    assert.deepEqual(r.primary, { id: 'enviar', label: 'Enviar mensagem' })
    // Feito continua possivel, mas discreto
    assert.deepEqual(r.secondary, [{ id: 'feito', label: 'Marcar como feito' }])
  }
})

test('cartao da etapa: ligacao abre o roteiro; visita/reuniao/e-mail tem [Feito]', () => {
  assert.deepEqual(ids(stageCardActions({ action_type: 'ligacao' })), { primary: 'ligar', secondary: [] })
  assert.equal(stageCardActions({ action_type: 'ligacao' }).primary.label, 'Ver roteiro e ligar')
  for (const t of ['visita', 'reuniao', 'email']) {
    assert.deepEqual(stageCardActions({ action_type: t }).primary, { id: 'feito', label: 'Feito' })
    assert.deepEqual(stageCardActions({ action_type: t }).secondary, [])
  }
  assert.deepEqual(stageCardActions(null), { primary: null, secondary: [] })
})

test('cartao da avulsa: um botao principal e Pular como link', () => {
  assert.deepEqual(avulsaCardActions({ actions: ['enviar', 'feito', 'pular'] }), {
    primary: { id: 'enviar', label: 'Enviar mensagem' },
    secondary: [{ id: 'feito', label: 'Marcar como feito' }, { id: 'pular', label: 'Pular' }],
  })
  assert.deepEqual(ids(avulsaCardActions({ actions: ['roteiro', 'pular'] })), { primary: 'roteiro', secondary: ['pular'] })
  assert.equal(avulsaCardActions({ actions: ['roteiro', 'pular'] }).primary.label, 'Ver roteiro e ligar')
  assert.deepEqual(avulsaCardActions({ actions: ['feito', 'pular'] }).primary, { id: 'feito', label: 'Feito' })
  // pergunta numa avulsa: so Pular
  assert.deepEqual(ids(avulsaCardActions({ actions: ['pular'] })), { primary: null, secondary: ['pular'] })
  assert.deepEqual(avulsaCardActions(null), { primary: null, secondary: [] })
})

test('aviso de passo sem texto pronto', () => {
  assert.equal(NO_TEXT_HINT, '(sem texto pronto — você escreve)')
})

test('Cadencia sempre junta: um grupo na posicao do primeiro dos dois', () => {
  // conta com Tarefas entre os dois (bug visto no navegador): um grupo so, onde aparece o primeiro
  assert.deepEqual(cadenceRenderList(['score', 'proximo_passo', 'tarefas', 'avulsa', 'vendas']), ['score', 'cadencia', 'tarefas', 'vendas'])
  // avulsa antes: o grupo fica na posicao da avulsa
  assert.deepEqual(cadenceRenderList(['avulsa', 'tarefas', 'proximo_passo']), ['cadencia', 'tarefas'])
  // lado a lado (fabrica)
  assert.deepEqual(cadenceRenderList(['etapa', 'proximo_passo', 'avulsa', 'tarefas']), ['etapa', 'cadencia', 'tarefas'])
  // so um visivel: o grupo aparece com ele so
  assert.deepEqual(cadenceRenderList(['tarefas', 'avulsa']), ['tarefas', 'cadencia'])
  // nenhum
  assert.deepEqual(cadenceRenderList(['tarefas']), ['tarefas'])
})

test('passo mensagem: os dois cartoes mostram igual (descricao = titulo; so o texto pronto vai para a janela)', () => {
  const fill = t => t
  // descricao sem texto: a janela abre VAZIA (a descricao e interna, nao vai para o cliente)
  assert.deepEqual(stageStepView({ action_type: 'mensagem', auto_message: '', description: 'Mandar o catálogo' }), { title: 'Mandar o catálogo', text: '' })
  const av = avulsaStepView({ action_type: 'mensagem', attempt_message: '', attempt_description: 'Mandar o catálogo' }, fill)
  assert.equal(av.title, 'Mandar o catálogo')
  assert.equal(av.text, '')
  // com texto
  assert.deepEqual(stageStepView({ action_type: 'whatsapp', auto_message: ' Oi! ', description: 'Boas-vindas' }), { title: 'Boas-vindas', text: 'Oi!' })
  const av2 = avulsaStepView({ action_type: 'whatsapp', attempt_message: ' Oi! ', attempt_description: 'Boas-vindas' }, fill)
  assert.deepEqual({ title: av2.title, text: av2.text }, { title: 'Boas-vindas', text: 'Oi!' })
  // outros tipos: o titulo de sempre do passo
  assert.deepEqual(stageStepView({ action_type: 'visita', description: 'Levar amostras' }), { title: '', text: 'Levar amostras' })
  assert.deepEqual(stageStepView({ action_type: 'pergunta', question: { text_for_lead: 'Para quando?' } }), { title: '', text: 'Para quando?' })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadenceCardActions, stepLine, cadenceRenderList, stageStepView, BOX_PLACEHOLDER } from '../src/lib/cadenceCard.js'
import { avulsaStepView } from '../src/lib/avulsaStep.js'

const ids = r => ({ primary: r.primary && r.primary.id, secondary: r.secondary && r.secondary.id, links: r.links.map(l => l.id) })

test('linha laranja: "Passo 1/4: PERGUNTA" (etapa) e "Etapa 6/7: MENSAGEM" (avulsa)', () => {
  assert.equal(stepLine('etapa', 1, 4, 'pergunta'), 'Passo 1/4: PERGUNTA')
  assert.equal(stepLine('avulsa', 6, 7, 'mensagem'), 'Etapa 6/7: MENSAGEM')
  assert.equal(stepLine('avulsa', 2, 3, 'ligacao'), 'Etapa 2/3: LIGAÇÃO')
  // sem total: so o tipo
  assert.equal(stepLine('etapa', null, null, 'visita'), 'VISITA')
})

test('mensagem (etapa e avulsa): [Revisar e enviar] + [So avancar (sem enviar)] + link Marcar como feito', () => {
  for (const kind of ['etapa', 'avulsa']) {
    for (const t of ['mensagem', 'whatsapp']) {
      const r = cadenceCardActions(kind, { action_type: t })
      assert.deepEqual(r.primary, { id: 'enviar', label: 'Revisar e enviar' })
      assert.deepEqual(r.secondary, { id: 'pular', label: 'Só avançar (sem enviar)' })
      assert.deepEqual(r.links, [{ id: 'feito', label: 'Marcar como feito' }])
    }
  }
})

test('pergunta: etapa = [Revisar e enviar] + [Ja sei a resposta]; avulsa so avanca', () => {
  const r = cadenceCardActions('etapa', { action_type: 'pergunta', state: 'pendente' })
  assert.deepEqual(r.primary, { id: 'perguntar', label: 'Revisar e enviar' })
  assert.deepEqual(r.secondary, { id: 'ja_sei', label: 'Já sei a resposta' })
  assert.deepEqual(r.links, [])
  // ja perguntou: falta anotar a resposta
  assert.deepEqual(ids(cadenceCardActions('etapa', { action_type: 'pergunta', state: 'aguardando' })), { primary: 'ja_sei', secondary: null, links: [] })
  // avulsa: o servidor so aceita pular a pergunta (sem resposta pela avulsa)
  const a = cadenceCardActions('avulsa', { action_type: 'pergunta' })
  assert.equal(a.primary, null)
  assert.deepEqual(a.secondary, { id: 'pular', label: 'Só avançar (sem enviar)' })
})

test('ligacao: [Ver roteiro e ligar] + [So avancar]; visita/reuniao/e-mail: [Feito] + [So avancar]', () => {
  for (const kind of ['etapa', 'avulsa']) {
    assert.deepEqual(ids(cadenceCardActions(kind, { action_type: 'ligacao' })), { primary: 'ligar', secondary: 'pular', links: [] })
    assert.equal(cadenceCardActions(kind, { action_type: 'ligacao' }).primary.label, 'Ver roteiro e ligar')
    for (const t of ['visita', 'reuniao', 'email']) {
      const r = cadenceCardActions(kind, { action_type: t })
      assert.deepEqual(r.primary, { id: 'feito', label: 'Feito' })
      assert.deepEqual(r.secondary, { id: 'pular', label: 'Só avançar' })
    }
  }
  assert.deepEqual(cadenceCardActions('etapa', null), { primary: null, secondary: null, links: [] })
})

test('caixa vazia: placeholder de passo sem texto pronto', () => {
  assert.equal(BOX_PLACEHOLDER, 'Sem texto pronto — você escreve ao enviar')
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

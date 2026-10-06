import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cadenceCardActions, stepLine, cadenceRenderList, stageStepView, BOX_PLACEHOLDER, actionWord, unifiedProgress, afterSummary } from '../src/lib/cadenceCard.js'
import { avulsaStepView } from '../src/lib/avulsaStep.js'

const ids = r => ({ primary: r.primary && r.primary.id, secondary: r.secondary && r.secondary.id, links: r.links.map(l => l.id) })

test('linha laranja: "Passo 1/4: PERGUNTA" (etapa) e "Etapa 6/7: MENSAGEM" (avulsa)', () => {
  assert.equal(stepLine('etapa', 1, 4, 'pergunta'), 'Passo 1/4: PERGUNTA')
  assert.equal(stepLine('avulsa', 6, 7, 'mensagem'), 'Etapa 6/7: MENSAGEM')
  assert.equal(stepLine('avulsa', 2, 3, 'ligacao'), 'Etapa 2/3: LIGAÇÃO')
  // sem total: so o tipo
  assert.equal(stepLine('etapa', null, null, 'visita'), 'VISITA')
})

test('mensagem (etapa e avulsa): [Enviar] + [Pular] + link "Já mandei por fora"', () => {
  for (const kind of ['etapa', 'avulsa']) {
    for (const t of ['mensagem', 'whatsapp']) {
      const r = cadenceCardActions(kind, { action_type: t })
      assert.deepEqual(r.primary, { id: 'enviar', label: 'Enviar' })
      assert.deepEqual(r.secondary, { id: 'pular', label: 'Pular' })
      assert.deepEqual(r.links, [{ id: 'feito', label: 'Já mandei por fora' }])
    }
  }
})

test('pergunta: etapa = [Enviar] + [Ja sei a resposta]; avulsa so pula', () => {
  const r = cadenceCardActions('etapa', { action_type: 'pergunta', state: 'pendente' })
  assert.deepEqual(r.primary, { id: 'perguntar', label: 'Enviar' })
  assert.deepEqual(r.secondary, { id: 'ja_sei', label: 'Já sei a resposta' })
  assert.deepEqual(r.links, [])
  // ja perguntou: falta anotar a resposta
  assert.deepEqual(ids(cadenceCardActions('etapa', { action_type: 'pergunta', state: 'aguardando' })), { primary: 'ja_sei', secondary: null, links: [] })
  // avulsa: o servidor so aceita pular a pergunta (sem resposta pela avulsa)
  const a = cadenceCardActions('avulsa', { action_type: 'pergunta' })
  assert.equal(a.primary, null)
  assert.deepEqual(a.secondary, { id: 'pular', label: 'Pular' })
})

test('ligacao: [Ver roteiro e ligar] + [Pular]; visita/reuniao/e-mail: [Feito] + [Pular]', () => {
  for (const kind of ['etapa', 'avulsa']) {
    assert.deepEqual(ids(cadenceCardActions(kind, { action_type: 'ligacao' })), { primary: 'ligar', secondary: 'pular', links: [] })
    assert.equal(cadenceCardActions(kind, { action_type: 'ligacao' }).primary.label, 'Ver roteiro e ligar')
    for (const t of ['visita', 'reuniao', 'email']) {
      const r = cadenceCardActions(kind, { action_type: t })
      assert.deepEqual(r.primary, { id: 'feito', label: 'Feito' })
      assert.deepEqual(r.secondary, { id: 'pular', label: 'Pular' })
    }
  }
  assert.deepEqual(cadenceCardActions('etapa', null), { primary: null, secondary: null, links: [] })
})

test('palavra do que fazer: Pergunte / Mande / Ligue (sem "Passo 1/4" nem "Etapa 6/7")', () => {
  assert.equal(actionWord('pergunta'), 'Pergunte')
  assert.equal(actionWord('mensagem'), 'Mande')
  assert.equal(actionWord('whatsapp'), 'Mande')
  assert.equal(actionWord('ligacao'), 'Ligue')
  assert.equal(actionWord('email'), 'Mande um e-mail')
  assert.equal(actionWord('visita'), 'Visite')
  assert.equal(actionWord('reuniao'), 'Faça a reunião')
  assert.equal(actionWord('outro'), 'outro')
})

test('contador unico "N de M": etapa primeiro, depois a cadencia extra', () => {
  // etapa com 4, 1 feito; extra com 7, 2 feitos: o da vez e o 2o da etapa
  assert.deepEqual(unifiedProgress({ stageDone: 1, stageTotal: 4, stageHasNext: true, extra: { done: 2, total: 7 } }), { n: 2, m: 11 })
  // etapa acabou: o da vez e o 3o da extra = 4 + 3
  assert.deepEqual(unifiedProgress({ stageDone: 4, stageTotal: 4, stageHasNext: false, extra: { done: 2, total: 7 } }), { n: 7, m: 11 })
  // sem extra
  assert.deepEqual(unifiedProgress({ stageDone: 0, stageTotal: 3, stageHasNext: true, extra: null }), { n: 1, m: 3 })
  // tudo feito
  assert.equal(unifiedProgress({ stageDone: 3, stageTotal: 3, stageHasNext: false, extra: null }), null)
  assert.equal(unifiedProgress({ stageDone: 0, stageTotal: 0, stageHasNext: false, extra: null }), null)
})

test('"Depois:" resume em contagem e soma a cadencia extra', () => {
  const after = [{ action_type: 'pergunta' }, { action_type: 'pergunta' }, { action_type: 'mensagem' }, { action_type: 'whatsapp' }, { action_type: 'ligacao' }]
  assert.equal(afterSummary(after, 0), 'Depois: 2 perguntas, 2 mensagens, 1 ligação')
  assert.equal(afterSummary([{ action_type: 'pergunta' }], 4), 'Depois: 1 pergunta e 4 passos da cadência extra')
  assert.equal(afterSummary([], 1), 'Depois: 1 passo da cadência extra')
  assert.equal(afterSummary([{ action_type: 'visita' }], 0), 'Depois: 1 visita')
  assert.equal(afterSummary([], 0), '')
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

test('previa da etapa com as variaveis trocadas (igual a avulsa)', () => {
  const fill = t => t.replace(/\{\{primeiro_nome\}\}/g, 'Ana')
  assert.deepEqual(stageStepView({ action_type: 'mensagem', auto_message: 'Oi {{primeiro_nome}}!', description: 'Boas-vindas' }, fill), { title: 'Boas-vindas', text: 'Oi Ana!' })
  const av = avulsaStepView({ action_type: 'mensagem', attempt_message: 'Oi {{primeiro_nome}}!', attempt_description: 'Boas-vindas' }, fill)
  assert.equal(av.text, 'Oi Ana!')
  // variavel que some vira vazio (caixa vazia), igual a avulsa
  assert.equal(stageStepView({ action_type: 'mensagem', auto_message: '{{empresa}}' }, () => '').text, '')
  // sem fill: texto como esta
  assert.equal(stageStepView({ action_type: 'mensagem', auto_message: 'Oi {{primeiro_nome}}' }).text, 'Oi {{primeiro_nome}}')
})

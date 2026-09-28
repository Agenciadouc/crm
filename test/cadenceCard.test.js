import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardHeader, stageCardActions, avulsaCardActions, cadenceTitleIds, NO_TEXT_HINT } from '../src/lib/cadenceCard.js'

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
  assert.deepEqual(avulsaCardActions({ actions: ['enviar', 'pular'] }), {
    primary: { id: 'enviar', label: 'Enviar mensagem' },
    secondary: [{ id: 'pular', label: 'Pular' }],
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

test('titulo "Cadência" uma vez so para os blocos de cadencia lado a lado', () => {
  // padrao: etapa e avulsa juntas -> titulo so em cima da etapa
  assert.deepEqual(cadenceTitleIds(['score', 'etapa', 'proximo_passo', 'avulsa', 'tarefas']), ['proximo_passo'])
  // avulsa antes da etapa: titulo em cima da avulsa
  assert.deepEqual(cadenceTitleIds(['avulsa', 'proximo_passo']), ['avulsa'])
  // separadas: cada uma com seu titulo
  assert.deepEqual(cadenceTitleIds(['proximo_passo', 'tarefas', 'avulsa']), ['proximo_passo', 'avulsa'])
  // so uma visivel
  assert.deepEqual(cadenceTitleIds(['avulsa', 'vendas']), ['avulsa'])
  assert.deepEqual(cadenceTitleIds(['tarefas']), [])
})

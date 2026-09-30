import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATENDIMENTO_BLOCKS, blockLabel, factoryLayout, normalizeLayout, resolveLayout,
  moveBlock, moveBlockTo, toggleVisible, validateLayout, visibleIds, editorRows, expandRows, toggleRow,
} from '../src/lib/panelLayout.js'
import { PANEL_BLOCKS } from '../server/services/panelLayouts.js'

test('padrao de fabrica = exatamente a aba Atendimento de hoje', () => {
  assert.deepEqual(visibleIds(factoryLayout()), ['score', 'atendente', 'etapa', 'tags', 'proximo_passo', 'avulsa', 'tarefas', 'vendas', 'cliente'])
  const f = factoryLayout()
  assert.equal(f.find(b => b.id === 'contato').visible, false)
  assert.equal(f.find(b => b.id === 'observacoes').visible, false)
  assert.equal(f.length, 11)
  // quem nunca mexeu: nada salvo -> fabrica
  assert.deepEqual(resolveLayout({ account: null, user: null }), { layout: f, source: 'factory' })
  assert.deepEqual(resolveLayout(null), { layout: f, source: 'factory' })
})

test('mesmos ids de bloco no servidor e na tela', () => {
  assert.deepEqual(ATENDIMENTO_BLOCKS.map(b => b.id), PANEL_BLOCKS.atendimento)
})

test('nome de cada bloco em portugues', () => {
  assert.equal(blockLabel('contato'), 'Dados do contato')
  assert.equal(blockLabel('score'), 'Termômetro')
  assert.equal(blockLabel('xyz'), 'xyz')
})

test('resolve: vendedor > conta > fabrica', () => {
  const conta = [{ id: 'vendas', visible: true }]
  const meu = [{ id: 'tarefas', visible: true }]
  assert.equal(resolveLayout({ account: conta, user: meu }).source, 'user')
  assert.equal(resolveLayout({ account: conta, user: meu }).layout[0].id, 'tarefas')
  assert.equal(resolveLayout({ account: conta, user: null }).source, 'account')
  assert.equal(resolveLayout({ account: conta, user: null }).layout[0].id, 'vendas')
})

test('mescla: ids desconhecidos/repetidos saem, blocos novos entram no fim com a visibilidade de fabrica', () => {
  const l = normalizeLayout([
    { id: 'vendas', visible: false }, { id: 'bolo', visible: true }, { id: 'vendas', visible: true },
    { id: 'contato', visible: true }, null, { id: 'score' },
  ])
  assert.deepEqual(l.slice(0, 3), [{ id: 'vendas', visible: false }, { id: 'contato', visible: true }, { id: 'score', visible: true }])
  assert.deepEqual(l.slice(3).map(b => b.id), ['atendente', 'etapa', 'tags', 'proximo_passo', 'avulsa', 'tarefas', 'cliente', 'observacoes'])
  assert.equal(l.find(b => b.id === 'observacoes').visible, false)
  assert.equal(l.find(b => b.id === 'tarefas').visible, true)
  assert.deepEqual(normalizeLayout('lixo'), factoryLayout())
})

test('mover para cima/baixo e arrastar; nas pontas nao faz nada', () => {
  const f = factoryLayout()
  assert.deepEqual(moveBlock(f, 'atendente', -1).slice(0, 2).map(b => b.id), ['atendente', 'score'])
  assert.deepEqual(moveBlock(f, 'score', 1).slice(0, 2).map(b => b.id), ['atendente', 'score'])
  assert.deepEqual(moveBlock(f, 'score', -1), f)
  assert.deepEqual(moveBlock(f, 'observacoes', 1), f)
  assert.deepEqual(moveBlock(f, 'bolo', 1), f)
  assert.deepEqual(moveBlockTo(f, 7, 0).slice(0, 2).map(b => b.id), ['tarefas', 'score'])
  assert.deepEqual(moveBlockTo(f, 0, 2).slice(0, 3).map(b => b.id), ['atendente', 'etapa', 'score'])
  assert.deepEqual(moveBlockTo(f, 0, 99), f)
  assert.equal(f[0].id, 'score') // nao muda o original
})

test('mostrar/esconder alterna so o bloco escolhido', () => {
  const f = factoryLayout()
  const l = toggleVisible(f, 'vendas')
  assert.equal(l.find(b => b.id === 'vendas').visible, false)
  assert.equal(toggleVisible(l, 'vendas').find(b => b.id === 'vendas').visible, true)
  assert.equal(f.find(b => b.id === 'vendas').visible, true)
  assert.deepEqual(visibleIds(l), ['score', 'atendente', 'etapa', 'tags', 'proximo_passo', 'avulsa', 'tarefas', 'cliente'])
})

test('validar: mesma regra do servidor', () => {
  assert.equal(validateLayout(factoryLayout()), null)
  assert.match(validateLayout(undefined), /lista/i)
  assert.match(validateLayout([]), /pelo menos/i)
  assert.match(validateLayout([{ id: 'bolo', visible: true }]), /desconhecido/i)
  assert.match(validateLayout([{ id: 'score', visible: true }, { id: 'score', visible: true }]), /repetido/i)
  assert.match(validateLayout([{ id: 'score', visible: 1 }]), /visível/i)
  assert.match(validateLayout(['score']), /bloco/i)
})

test('Arrumar: etapa + avulsa viram UMA linha "Cadência" e voltam juntas', () => {
  const saved = [
    { id: 'score', visible: true }, { id: 'proximo_passo', visible: true }, { id: 'tarefas', visible: true },
    { id: 'avulsa', visible: false }, { id: 'vendas', visible: true },
  ]
  const rows = editorRows(saved)
  assert.deepEqual(rows.map(r => r.id), ['score', 'cadencia', 'tarefas', 'vendas'])
  assert.equal(blockLabel('cadencia'), 'Cadência (etapa + avulsa)')
  assert.equal(rows[1].visible, true)
  // salvar sem mexer: juntas na posicao do primeiro, cada uma com a visibilidade que tinha
  assert.deepEqual(expandRows(rows), [
    { id: 'score', visible: true }, { id: 'proximo_passo', visible: true }, { id: 'avulsa', visible: false },
    { id: 'tarefas', visible: true }, { id: 'vendas', visible: true },
  ])
  // mover a linha move as duas
  const moved = expandRows(moveBlock(rows, 'cadencia', 2))
  assert.deepEqual(moved.map(b => b.id), ['score', 'tarefas', 'vendas', 'proximo_passo', 'avulsa'])
  // esconder esconde as duas; mostrar mostra as duas
  const hidden = toggleRow(rows, 'cadencia')
  assert.equal(hidden[1].visible, false)
  assert.deepEqual(expandRows(hidden).filter(b => b.id === 'proximo_passo' || b.id === 'avulsa').map(b => b.visible), [false, false])
  const shown = toggleRow(hidden, 'cadencia')
  assert.deepEqual(expandRows(shown).filter(b => b.id === 'proximo_passo' || b.id === 'avulsa').map(b => b.visible), [true, true])
  // outra linha: igual ao toggleVisible
  assert.equal(toggleRow(rows, 'vendas')[3].visible, false)
  // o resultado continua valido para o servidor (mesmos ids)
  assert.equal(validateLayout(expandRows(editorRows(factoryLayout()))), null)
  assert.equal(expandRows(editorRows(factoryLayout())).length, 11)
})

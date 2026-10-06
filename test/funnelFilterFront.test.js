import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFunnel, funnelQuery, funnelParams, leadMatchesFunnel, stagesForFunnel } from '../src/lib/funnelFilter.js'

const funnels = [
  { id: 1, kind: 'vendas', stages: [{ id: 10, name: 'Novo' }] },
  { id: 2, kind: 'recompra', stages: [{ id: 20, name: 'Aguardando' }] },
  { id: 3, stages: [{ id: 30, name: 'Outro' }] }, // sem kind = vendas
]

test('normalizeFunnel: padrao vendas', () => {
  assert.equal(normalizeFunnel(''), 'vendas')
  assert.equal(normalizeFunnel('recompra'), 'recompra')
  assert.equal(normalizeFunnel('lixo'), 'vendas')
})

test('query e params', () => {
  assert.equal(funnelQuery('recompra'), '&funnel=recompra')
  assert.deepEqual(funnelParams('todos'), { funnel: 'todos' })
})

test('leadMatchesFunnel e stagesForFunnel', () => {
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'recompra', funnels), true)
  assert.equal(leadMatchesFunnel({ funnel_id: 3 }, 'vendas', funnels), true)
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'vendas', funnels), false)
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'todos', funnels), true)
  assert.deepEqual(stagesForFunnel(funnels, 'vendas').map(s => s.id), [10, 30])
  assert.deepEqual(stagesForFunnel(funnels, 'todos').map(s => s.id), [10, 20, 30])
})

test('effectiveFunnel: espera saber se a conta tem Recompra antes de buscar', async () => {
  const { effectiveFunnel } = await import('../src/lib/funnelFilter.js')
  assert.equal(effectiveFunnel('vendas', false, false), null)   // ainda carregando: nao busca
  assert.equal(effectiveFunnel('vendas', false, true), 'todos') // conta sem Recompra
  assert.equal(effectiveFunnel('recompra', true, true), 'recompra')
})

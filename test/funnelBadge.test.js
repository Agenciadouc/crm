import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funnelLabel, funnelBadgeStyle } from '../src/lib/funnelBadge.js'

test('funil do lead: Recompra pelo kind; senao Vendas; sem funil null', () => {
  assert.equal(funnelLabel({ kind: 'recompra' }), 'Recompra')
  assert.equal(funnelLabel({ kind: 'vendas' }), 'Vendas')
  assert.equal(funnelLabel({}), 'Vendas')
  assert.equal(funnelLabel(null), null)
  assert.deepEqual(funnelBadgeStyle('Recompra'), { color: '#7C3AED', background: '#7C3AED20' })
  assert.deepEqual(funnelBadgeStyle('Vendas'), { color: '#2563EB', background: '#2563EB20' })
})

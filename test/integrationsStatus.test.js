import { test } from 'node:test'
import assert from 'node:assert/strict'
import { whatsappTileStatus, createLatestRequest } from '../src/lib/integrationsStatus.js'

test('status do cartao WhatsApp: erro ao carregar nao vira "Nenhum número"', () => {
  assert.equal(whatsappTileStatus({ instances: [], loadError: true }), 'Não foi possível carregar')
  assert.equal(whatsappTileStatus({ instances: [], loadError: false }), 'Nenhum número')
  assert.equal(whatsappTileStatus({ instances: [{ status: 'connected' }, { status: 'disconnected' }], loadError: false }), '1 de 2 conectado(s)')
  // lista anterior + recarga que falhou: continua avisando o erro
  assert.equal(whatsappTileStatus({ instances: [{ status: 'connected' }], loadError: true }), 'Não foi possível carregar')
})

test('createLatestRequest: so a ultima requisicao da mesma chave vale (resposta atrasada e ignorada)', () => {
  const guard = createLatestRequest()
  const a = guard.begin(1)
  const b = guard.begin(2) // trocou de conta no meio
  assert.equal(guard.isLatest(a, 2), false)
  assert.equal(guard.isLatest(b, 2), true)
  assert.equal(guard.isLatest(b, 1), false) // conta atual mudou de novo
  const c = guard.begin(2)
  assert.equal(guard.isLatest(b, 2), false)
  assert.equal(guard.isLatest(c, 2), true)
})

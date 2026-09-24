import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isOptOutMessage, isOptedOut, appendOptOutFooter, checkStepVariety,
  DEFAULT_OPTOUT_FOOTER, DEFAULT_OPTOUT_CONFIRM, OPTOUT_WORDS,
} from '../server/services/antiban.js'

test('palavras de descadastro: mensagem inteira, sem acento/pontuacao/caixa', () => {
  for (const t of ['sair', 'SAIR', 'Sair.', ' sair! ', 'sáir', 'Parar', 'pare', 'CANCELAR', 'descadastrar', 'Stop']) {
    assert.equal(isOptOutMessage(t), true, t)
  }
  for (const t of ['vou sair agora', 'sair?? quando', 'saindo', '', null, undefined, 'não quero sair']) {
    assert.equal(isOptOutMessage(t), false, String(t))
  }
  assert.deepEqual(OPTOUT_WORDS, ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'])
})

test('lead descadastrado: opted_out_at mais novo que opted_in_at', () => {
  assert.equal(isOptedOut({ opted_out_at: null }), false)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-20 10:00:00' }), true)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-20 10:00:00', opted_in_at: '2026-09-21 10:00:00' }), false)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-22 10:00:00', opted_in_at: '2026-09-21 10:00:00' }), true)
  assert.equal(isOptedOut(null), false)
})

test('rodape SAIR', () => {
  assert.equal(DEFAULT_OPTOUT_FOOTER, 'Digite SAIR para não receber mais mensagens.')
  assert.equal(DEFAULT_OPTOUT_CONFIRM, 'Pronto! Você não vai mais receber nossas mensagens automáticas.')
  assert.equal(appendOptOutFooter('Oi Ana', DEFAULT_OPTOUT_FOOTER), 'Oi Ana\n\nDigite SAIR para não receber mais mensagens.')
  const once = appendOptOutFooter('Oi', DEFAULT_OPTOUT_FOOTER)
  assert.equal(appendOptOutFooter(once, DEFAULT_OPTOUT_FOOTER), once)
  assert.equal(appendOptOutFooter('Oi', ''), 'Oi')
  assert.equal(appendOptOutFooter('Oi', null), 'Oi')
})

test('variacao do passo de follow-up: 2+ variacoes OU variavel do lead', () => {
  assert.deepEqual(checkStepVariety({ message_template: 'Oi {{nome}}, tudo bem?' }), { ok: true })
  assert.deepEqual(checkStepVariety({ message_template: 'Oi {{primeiro_nome}}' }), { ok: true })
  assert.deepEqual(checkStepVariety({ variations: ['Oi', 'Ola'] }), { ok: true })
  assert.deepEqual(checkStepVariety({ variations: JSON.stringify(['Oi', 'Ola']) }), { ok: true })
  const bad = checkStepVariety({ message_template: 'Oi, tudo bem?' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /variação|\{\{nome\}\}/)
  assert.equal(checkStepVariety({ variations: ['Oi', '  '] }).ok, false)
})

test('isOptedOut: carimbos iguais (SAIR no mesmo segundo do opt-in da criacao) = descadastrado', () => {
  assert.equal(isOptedOut({ opted_out_at: '2026-09-23 10:00:00', opted_in_at: '2026-09-23 10:00:00' }), true)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-23 10:00:00', opted_in_at: '2026-09-23 10:00:01' }), false)
})

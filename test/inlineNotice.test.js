import { test } from 'node:test'
import assert from 'node:assert/strict'
import { errorNotice, successNotice, noticeAutoHideMs, NOTICE_AUTO_HIDE_MS } from '../src/lib/inlineNotice.js'

test('aviso de erro: prefixo + mensagem do erro; sem mensagem fica so o prefixo', () => {
  assert.deepEqual(errorNotice('Erro ao excluir', new Error('Número não encontrado')), { kind: 'error', text: 'Erro ao excluir: Número não encontrado' })
  assert.deepEqual(errorNotice('Erro ao excluir', {}), { kind: 'error', text: 'Erro ao excluir.' })
  assert.deepEqual(errorNotice('Erro ao excluir', null), { kind: 'error', text: 'Erro ao excluir.' })
  assert.deepEqual(errorNotice('', new Error('Falhou')), { kind: 'error', text: 'Falhou' })
})

test('aviso de sucesso some sozinho (~4s); o de erro fica ate fechar', () => {
  assert.deepEqual(successNotice('Salvo.'), { kind: 'success', text: 'Salvo.' })
  assert.equal(NOTICE_AUTO_HIDE_MS, 4000)
  assert.equal(noticeAutoHideMs(successNotice('ok')), 4000)
  assert.equal(noticeAutoHideMs(errorNotice('Erro', new Error('x'))), null)
  assert.equal(noticeAutoHideMs(null), null)
})

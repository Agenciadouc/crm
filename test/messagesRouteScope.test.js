// messages.js importa server/db.js (banco real), entao nao sobe em teste HTTP com banco em
// memoria. Guarda de regressao: o POST /:leadId (enviar mensagem) confere a conta do lead
// antes de qualquer envio/gravacao, lido do PROPRIO arquivo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(resolve(__dirname, '../server/routes/messages.js'), 'utf8')

test("POST /messages/:leadId devolve 404 para lead de outra conta antes de enviar", () => {
  const start = SRC.indexOf("router.post('/:leadId', async")
  assert.ok(start >= 0)
  const body = SRC.slice(start, SRC.indexOf('router.', start + 10))
  const check = body.search(/if \(req\.accountId && lead\.account_id !== req\.accountId\) return res\.status\(404\)/)
  assert.ok(check > 0, 'falta conferir a conta do lead')
  assert.ok(check < body.indexOf('resolveInstanceForSend('), 'a conferencia vem antes de escolher a instancia/enviar')
  assert.ok(check < body.indexOf('Anti-duplicate'), 'e antes de consultar mensagens do lead')
})

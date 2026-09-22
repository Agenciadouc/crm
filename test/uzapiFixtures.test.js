import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { UZAPI_FIXTURE_DIR, listUzapiFixtures, loadUzapiFixture, MASKED_PHONES, UZAPI_PNID } from './helpers/uzapiFixtures.js'

test('fixtures da UzAPI: 16 arquivos, todos JSON validos', () => {
  const files = listUzapiFixtures()
  assert.equal(files.length, 16)
  for (const f of files) assert.doesNotThrow(() => loadUzapiFixture(f), f)
})

test('fixtures da UzAPI: so telefones mascarados e phone_number_id mascarado (nada de dado real)', () => {
  for (const f of listUzapiFixtures()) {
    const text = fs.readFileSync(path.join(UZAPI_FIXTURE_DIR, f), 'utf8')
    for (const m of text.match(/\b55\d{10,11}\b/g) || []) assert.ok(MASKED_PHONES.includes(m), `${f}: telefone ${m} nao mascarado`)
    for (const m of text.match(/"phone_number_id":\s*"(\d*)"/g) || []) assert.ok(m.includes(UZAPI_PNID), `${f}: phone_number_id nao mascarado`)
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(text), `${f}: parece conter um JWT`)
  }
})

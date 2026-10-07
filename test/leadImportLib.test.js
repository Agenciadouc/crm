// test/leadImportLib.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  suggestField, uniqueHeaders, autoMapping, setMapping, buildRows, parseMoney, cleanInstagram, maskPhone, decodeText, skippedCsv, MAX_ROWS,
} from '../src/lib/leadImport.js'

test('sugere o campo pelo nome da coluna (sem acento, minusculo)', () => {
  const pares = [['Nome Completo', 'name'], ['Celular', 'phone'], ['WhatsApp', 'phone'], ['E-mail', 'email'], ['Município', 'city'], ['UF', 'state'],
    ['Razão Social', 'empresa'], ['Insta', 'instagram'], ['CNPJ', 'cpf_cnpj'], ['Observações', 'notes'], ['Valor', 'value_estimated'],
    ['Fonte', 'source_detail'], ['Etiquetas', 'tags'], ['Tamanho da loja', 'extra'], ['', 'extra']]
  for (const [h, k] of pares) assert.equal(suggestField(h), k, h)
})

test('cabecalhos repetidos/vazios e mapeamento sem campo unico repetido', () => {
  assert.deepEqual(uniqueHeaders(['Telefone', 'Telefone', '', 'Nome']), ['Telefone', 'Telefone (2)', 'Coluna 3', 'Nome'])
  assert.deepEqual(autoMapping(['Celular', 'Telefone', 'Nome', 'Sobrenome']), ['phone', 'extra', 'name', 'name']) // Sobrenome junta no Nome
  const m = setMapping(['phone', 'extra', 'name'], 1, 'phone')
  assert.deepEqual(m, ['skip', 'phone', 'name'])
  assert.deepEqual(setMapping(['name', 'skip'], 1, 'name'), ['name', 'name']) // Nome pode repetir (junta)
})

test('linhas viram Row: junta nomes, observacoes, tags, extras; limpa valor e instagram; pula linha vazia', () => {
  const headers = ['Nome', 'Sobrenome', 'Fone', 'Insta', 'Valor', 'Tags', 'Tamanho', 'Obs', 'Obs 2', 'Lixo']
  const mapping = ['name', 'name', 'phone', 'instagram', 'value_estimated', 'tags', 'extra', 'notes', 'notes', 'skip']
  const data = [
    [' Ana ', 'Souza', '(48) 99999-0000', 'https://instagram.com/ana.loja/', 'R$ 1.234,56', 'vip; feira , ', '120 m²', 'liga cedo', 'tem 2 lojas', 'x'],
    ['', '', '', '', '', '', '', '', '', ''],
    ['João', '', '48 3333-2222', '@joao', '1500', '', '', '', '', ''],
  ]
  const rows = buildRows(headers, data, mapping)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    row: 2,
    fields: { name: 'Ana Souza', phone: '(48) 99999-0000', instagram: 'ana.loja', value_estimated: 1234.56, tags: ['vip', 'feira'], notes: 'liga cedo\ntem 2 lojas' },
    extra: { Tamanho: '120 m²' },
  })
  assert.equal(rows[1].row, 4)
  assert.equal(rows[1].fields.instagram, 'joao')
  assert.equal(rows[1].fields.value_estimated, 1500)
  assert.equal(parseMoney('abc'), null)
  assert.equal(parseMoney('1,5'), 1.5)
  assert.equal(cleanInstagram('@@x'), 'x')
})

test('telefone mascarado, texto Latin-1 e CSV dos que nao entraram', () => {
  assert.equal(maskPhone('5548999990000'), '(48) 9****-0000')
  assert.equal(maskPhone('123'), '***')
  const latin1 = Uint8Array.from([0x4a, 0x6f, 0xe3, 0x6f]) // "João" em Latin-1
  assert.equal(decodeText(latin1), 'João')
  assert.equal(decodeText(new TextEncoder().encode('São')), 'São')
  const csv = skippedCsv(['Nome', 'Fone'], [['Ana', ''], ['Bia', '1']], [{ row: 2, reason: 'sem telefone' }, { row: 3, reason: 'telefone inválido' }])
  assert.equal(csv, '﻿Nome;Fone;Motivo\r\nAna;;sem telefone\r\nBia;1;telefone inválido\r\n')
  assert.equal(MAX_ROWS, 5000)
})

test('revisao: "R$ 1.500" e 1500 (ponto de milhar sem virgula); CSV nao vira formula no Excel', () => {
  assert.equal(parseMoney('R$ 1.500'), 1500)
  assert.equal(parseMoney('1.500.000'), 1500000)
  assert.equal(parseMoney('1.5'), 1.5)
  const csv = skippedCsv(['Fone', 'Obs'], [['+55 48 98888-1111', '=HYPERLINK("x")']], [{ row: 2, reason: 'telefone inválido' }])
  assert.equal(csv, "﻿Fone;Obs;Motivo\r\n'+55 48 98888-1111;\"'=HYPERLINK(\"\"x\"\")\";telefone inválido\r\n")
})

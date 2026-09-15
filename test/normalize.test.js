import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePhone, normalizeForSend, phoneCompareKey, stripJid, jidToSendNumber,
} from '../server/services/whatsapp/normalize.js'

test('normalizePhone: formatos BR viram 55 + DDD + 9 digitos', () => {
  assert.equal(normalizePhone('5547991351835'), '5547991351835')
  assert.equal(normalizePhone('554791351835'), '5547991351835')
  assert.equal(normalizePhone('47991351835'), '5547991351835')
  assert.equal(normalizePhone('4791351835'), '5547991351835')
  assert.equal(normalizePhone('+55 (47) 99135-1835'), '5547991351835')
})

test('normalizePhone: formato desconhecido volta como digitos, vazio volta igual', () => {
  assert.equal(normalizePhone('123'), '123')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(null), null)
  assert.equal(normalizePhone(undefined), undefined)
})

test('normalizeForSend: so acrescenta 55, nao insere o 9 (comportamento atual do envio)', () => {
  assert.equal(normalizeForSend('47991351835'), '5547991351835')
  assert.equal(normalizeForSend('4791351835'), '554791351835')
  assert.equal(normalizeForSend('554791351835'), '554791351835')
  assert.equal(normalizeForSend('5547991351835'), '5547991351835')
  assert.equal(normalizeForSend(''), '')
  assert.equal(normalizeForSend(null), '')
})

test('phoneCompareKey: DDD + 8 digitos finais', () => {
  assert.equal(phoneCompareKey('5547991351835'), '4791351835')
  assert.equal(phoneCompareKey('47991351835'), '4791351835')
  assert.equal(phoneCompareKey('4791351835'), '4791351835')
  assert.equal(phoneCompareKey(''), '')
})

test('stripJid e jidToSendNumber', () => {
  assert.equal(stripJid('5547991351835@s.whatsapp.net'), '5547991351835')
  assert.equal(stripJid('5547991351835@c.us'), '5547991351835')
  assert.equal(stripJid('123456789@lid'), '123456789')
  assert.equal(jidToSendNumber('554791351835@s.whatsapp.net'), '5547991351835')
  assert.equal(jidToSendNumber('47991351835'), '5547991351835')
  assert.equal(jidToSendNumber('123@lid'), '123')
  assert.equal(jidToSendNumber(''), '')
})

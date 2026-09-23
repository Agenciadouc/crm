import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTOMATION_PATH, parseAba, automationUrl, legacyAutomationRedirect,
} from '../src/lib/automationTabs.js'

test('rota nova e curta, sem acento', () => {
  assert.equal(AUTOMATION_PATH, '/cadencias-e-follow-ups')
})

test('parseAba: padrao e manuais', () => {
  assert.equal(parseAba(''), 'manuais')
  assert.equal(parseAba('?x=1'), 'manuais')
  assert.equal(parseAba('?aba=qualquer'), 'manuais')
  assert.equal(parseAba(undefined), 'manuais')
})

test('parseAba: le automaticas e manuais', () => {
  assert.equal(parseAba('?aba=automaticas'), 'automaticas')
  assert.equal(parseAba('aba=automaticas'), 'automaticas')
  assert.equal(parseAba('?aba=manuais'), 'manuais')
})

test('automationUrl: monta a rota com a aba', () => {
  assert.equal(automationUrl('manuais'), '/cadencias-e-follow-ups?aba=manuais')
  assert.equal(automationUrl('automaticas'), '/cadencias-e-follow-ups?aba=automaticas')
})

test('automationUrl: preserva outros parametros e troca a aba existente', () => {
  assert.equal(automationUrl('automaticas', '?id=5&aba=manuais'), '/cadencias-e-follow-ups?id=5&aba=automaticas')
  assert.equal(automationUrl('manuais', '?id=5'), '/cadencias-e-follow-ups?id=5&aba=manuais')
})

test('legacyAutomationRedirect: /cadences vai para manuais', () => {
  assert.equal(legacyAutomationRedirect('/cadences', ''), '/cadencias-e-follow-ups?aba=manuais')
})

test('legacyAutomationRedirect: /follow-ups vai para automaticas preservando query', () => {
  assert.equal(legacyAutomationRedirect('/follow-ups', '?lead=9'), '/cadencias-e-follow-ups?lead=9&aba=automaticas')
})

test('legacyAutomationRedirect: aba vinda na URL antiga e sobrescrita pela rota', () => {
  assert.equal(legacyAutomationRedirect('/cadences', '?aba=automaticas'), '/cadencias-e-follow-ups?aba=manuais')
})

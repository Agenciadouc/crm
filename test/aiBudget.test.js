// Orcamentos de IA separados: roteiro nao consome o teto da analise de conversas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRoteiroTestDb } from './helpers/roteiroDb.js'
import { analysisBudget, canRoteiroAi, DEFAULT_ROTEIRO_LIMIT } from '../server/services/aiBudget.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const NOW = new Date('2026-09-20T12:00:00Z')

function setup({ key = 'sk-teste' } = {}) {
  const db = createRoteiroTestDb()
  db.exec("ALTER TABLE accounts ADD COLUMN analysis_token_limit INTEGER NOT NULL DEFAULT 200000")
  const accountId = Number(db.prepare('INSERT INTO accounts (name, anthropic_api_key) VALUES (?, ?)').run('Conta', key).lastInsertRowid)
  return { db, accountId }
}

function spend(db, accountId, source, tokens, createdAt = '2026-09-10 10:00:00') {
  db.prepare('INSERT INTO ai_agent_token_log (account_id, input_tokens, output_tokens, source, created_at) VALUES (?, ?, 0, ?, ?)')
    .run(accountId, tokens, source, createdAt)
}

test('roteiro_ai_token_limit existe com padrao 300000', () => {
  const { db, accountId } = setup()
  assert.equal(db.prepare('SELECT roteiro_ai_token_limit AS n FROM accounts WHERE id = ?').get(accountId).n, 300000)
  assert.equal(DEFAULT_ROTEIRO_LIMIT, 300000)
})

test('gasto do roteiro nao bloqueia a analise de conversas', () => {
  const { db, accountId } = setup()
  spend(db, accountId, 'roteiro_extraction', 250000)
  spend(db, accountId, 'roteiro_learning', 40000)
  const a = analysisBudget(db, accountId, { now: NOW })
  assert.equal(a.ok, true)
  assert.equal(a.used, 0)
  const r = canRoteiroAi(db, accountId, { now: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.used, 290000)
})

test('canRoteiroAi para no teto do roteiro e ignora gasto da analise e de outros meses', () => {
  const { db, accountId } = setup()
  spend(db, accountId, 'conversation_analysis', 900000)
  spend(db, accountId, 'roteiro_draft', 999999, '2026-08-31 23:00:00')
  assert.equal(canRoteiroAi(db, accountId, { now: NOW }).ok, true)
  spend(db, accountId, 'roteiro_extraction', 300000)
  const r = canRoteiroAi(db, accountId, { now: NOW })
  assert.equal(r.ok, false)
  assert.equal(r.limit, 300000)
  db.prepare('UPDATE accounts SET roteiro_ai_token_limit = 500000 WHERE id = ?').run(accountId)
  assert.equal(canRoteiroAi(db, accountId, { now: NOW }).ok, true)
  assert.equal(analysisBudget(db, accountId, { now: NOW }).ok, false, 'analise estourou o proprio teto')
})

test('canRoteiroAi sem chave Anthropic -> no_api_key', () => {
  const { db, accountId } = setup({ key: null })
  assert.deepEqual(canRoteiroAi(db, accountId, { now: NOW, env: {} }), { ok: false, reason: 'no_api_key', used: 0, limit: 0 })
})

test('conversationAnalyzer.canAnalyze usa o orcamento da analise (sem fontes do roteiro)', () => {
  const src = readFileSync(resolve(__dirname, '../server/services/conversationAnalyzer.js'), 'utf8')
  const body = src.slice(src.indexOf('export function canAnalyze'), src.indexOf('export function canAnalyze') + 600)
  assert.ok(!/roteiro_/.test(body), 'canAnalyze nao pode somar fontes roteiro_*')
  assert.match(body, /analysisBudget\(db, accountId\)/)
})

test('IA do roteiro usa canRoteiroAi (adaptador e aprendizado noturno)', () => {
  const adapter = readFileSync(resolve(__dirname, '../server/services/roteiro/aiAdapter.js'), 'utf8')
  assert.match(adapter, /canRoteiroAi/)
  assert.ok(!/conversationAnalyzer/.test(adapter), 'nao usa mais o orcamento da analise')
  const scheduler = readFileSync(resolve(__dirname, '../server/scheduler.js'), 'utf8')
  assert.match(scheduler, /canRoteiroAi\(db, accountId\)\.ok \? roteiroAi : null/)
})

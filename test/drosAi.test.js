import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { resolveDrosKey, createDrosAi } from '../server/services/drosAi.js'

// Fake do callHaiku: devolve sempre a mesma resposta e registra como foi chamado.
function fakeCallAi(reply = 'ok', usage = { input: 10, output: 5, cacheRead: 0, cacheCreation: 0, total: 15 }) {
  const calls = []
  return {
    calls,
    fn: async (params) => {
      calls.push(params)
      return { content: reply, toolUses: [], usage, costUsd: 0.000025, stopReason: 'end_turn', raw: {} }
    },
  }
}

test('resolveDrosKey le ANTHROPIC_API_KEY_DROS e ignora a chave da conta', () => {
  assert.equal(resolveDrosKey({ ANTHROPIC_API_KEY_DROS: 'sk-dros' }), 'sk-dros')
  assert.equal(resolveDrosKey({ ANTHROPIC_API_KEY_DROS: '   ' }), null)
  assert.equal(resolveDrosKey({}), null)
})

test('ask usa a chave da Dros mesmo com a conta em ai_key_source client', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  db.prepare("UPDATE accounts SET anthropic_api_key = 'sk-do-cliente', ai_key_source = 'client' WHERE id = ?").run(accountId)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  await ai.ask({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'oi' }], source: 'entrevista' })

  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].apiKey, 'sk-dros', 'tem que mandar a chave da Dros explicita')
  assert.equal(fake.calls[0].accountId, null, 'nao pode deixar o callHaiku resolver pela conta')
})

test('ask grava o custo em ai_agent_token_log com agent_id nulo e o source dado', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  await ai.ask({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'oi' }], source: 'entrevista' })

  const row = db.prepare('SELECT * FROM ai_agent_token_log WHERE account_id = ?').get(accountId)
  assert.equal(row.agent_id, null)
  assert.equal(row.source, 'entrevista')
  assert.equal(row.input_tokens, 10)
  assert.equal(row.output_tokens, 5)
  assert.equal(row.lead_id, null)
})

test('tokensUsed soma o total de todas as chamadas', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  assert.equal(ai.tokensUsed(), 0)
  await ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' })
  await ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' })
  assert.equal(ai.tokensUsed(), 30)
})

test('sem a chave da Dros, ask falha com erro nomeado e nao chama a IA', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: {} })

  await assert.rejects(
    () => ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' }),
    /dros_key_missing/
  )
  assert.equal(fake.calls.length, 0)
})

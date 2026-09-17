// Cliente de IA da entrevista e da compilacao. Usa SEMPRE a chave central da Dros
// (ANTHROPIC_API_KEY_DROS), ignorando accounts.ai_key_source: a conta do cliente
// normalmente ainda nao tem chave quando o primeiro agente e criado.
// O custo cai no ai_agent_token_log que ja existe, com agent_id NULL.

import { callHaiku } from './anthropicClient.js'

export function resolveDrosKey(env = process.env) {
  const key = String((env && env.ANTHROPIC_API_KEY_DROS) || '').trim()
  return key || null
}

export function createDrosAi(db, { accountId, callAi = callHaiku, env = process.env }) {
  let total = 0

  async function ask({ systemPrompt, messages, maxTokens = 600, source }) {
    const key = resolveDrosKey(env)
    if (!key) throw new Error('dros_key_missing')

    const r = await callAi({
      systemPrompt,
      messages,
      maxTokens,
      apiKey: key,
      accountId: null, // explicito: o callHaiku nao deve resolver chave pela conta
    })

    const u = r.usage || {}
    total += u.total || 0
    db.prepare(`
      INSERT INTO ai_agent_token_log
        (agent_id, account_id, lead_id, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, cost_usd, source)
      VALUES (NULL, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(accountId, u.input || 0, u.output || 0, u.cacheRead || 0, u.cacheCreation || 0, r.costUsd || 0, source)

    return r
  }

  return { ask, tokensUsed: () => total }
}

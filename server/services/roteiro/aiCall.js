// Chamada de IA do roteiro (spec 6.3, 6.4): confere orcamento (canAnalyze = teto do roteiro) e chave antes,
// chama o modelo e loga os tokens com o `source`. Nao importa server/db.js: recebe tudo
// injetado; a casca de producao (aiAdapter.js) liga canRoteiroAi, a chave e o callHaiku.
export const AI_UNAVAILABLE = 'ai_unavailable'

function unavailable(reason) {
  const err = new Error('IA indisponível nesta conta.')
  err.code = AI_UNAVAILABLE
  err.reason = reason
  return err
}

export function buildRoteiroAi({ db, canAnalyze, resolveKey, callModel }) {
  function isAvailable(accountId) {
    try {
      return !!(accountId && canAnalyze(accountId)?.ok && resolveKey(accountId))
    } catch {
      return false
    }
  }

  async function call({ accountId, leadId = null, systemPrompt, messages, tools, toolChoice, maxTokens = 1024, source }) {
    if (!accountId || !canAnalyze(accountId)?.ok) throw unavailable('budget')
    const apiKey = resolveKey(accountId)
    if (!apiKey) throw unavailable('no_api_key')

    const result = await callModel({ systemPrompt, messages, tools, toolChoice, maxTokens, accountId, apiKey })
    const u = result.usage || {}
    try {
      db.prepare(`
        INSERT INTO ai_agent_token_log (
          account_id, lead_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, leadId, u.input || 0, u.output || 0, u.cacheRead || 0, u.cacheCreation || 0, result.costUsd || 0, source)
    } catch (e) {
      console.error('[Roteiro] log de tokens:', e.message)
    }
    return { toolUses: result.toolUses || [], usage: u, costUsd: result.costUsd || 0 }
  }

  return { call, isAvailable }
}

// Primeira chamada da ferramenta pedida na resposta (ou null).
export function toolInput(result, name) {
  const use = (result?.toolUses || []).find(t => t && t.name === name)
  return use && use.input && typeof use.input === 'object' ? use.input : null
}

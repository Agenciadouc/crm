// Wrapper fetch da API Anthropic (Claude Haiku 4.5).
// Usa prompt caching agressivo no system prompt — 90% off de input depois da 1a chamada.
// Sem dep nova: usa node-fetch que ja existe.

import fetch from 'node-fetch'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20251001'
const ANTHROPIC_VERSION = '2023-06-01'

// Precos por MTok (Haiku 4.5 — atualizado conforme docs Anthropic)
const PRICING = {
  input: 1.00 / 1_000_000,            // $1/MTok
  output: 5.00 / 1_000_000,           // $5/MTok
  cache_read: 0.10 / 1_000_000,       // $0.10/MTok (90% off do input)
  cache_creation: 1.25 / 1_000_000,   // $1.25/MTok (25% premium na criacao)
}

/**
 * Chama Claude Haiku 4.5.
 *
 * @param {Object} params
 * @param {string} params.systemPrompt - System prompt (sera cacheado automaticamente)
 * @param {Array} params.messages - [{role: 'user'|'assistant', content: string|array}]
 * @param {Array} [params.tools] - Tool definitions (function calling)
 * @param {number} [params.maxTokens=300] - Max tokens de output
 * @param {string} [params.toolChoice] - 'auto'|'any'|'none' ou {type:'tool',name:'X'}
 * @returns {Promise<{content, toolUses, usage, costUsd, raw}>}
 */
export async function callHaiku({ systemPrompt, messages, tools, maxTokens = 300, toolChoice = 'auto' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY nao configurada no .env')

  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    // System como array com cache_control = cacheia 1x (TTL 5min, refresh ao usar)
    system: systemPrompt
      ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
      : undefined,
    messages,
  }
  if (tools && tools.length > 0) {
    body.tools = tools
    body.tool_choice = typeof toolChoice === 'string' ? { type: toolChoice } : toolChoice
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 400)}`)
  }

  const data = await res.json()

  // Extrai content de texto e tool uses
  let textOut = ''
  const toolUses = []
  for (const block of data.content || []) {
    if (block.type === 'text') textOut += block.text
    else if (block.type === 'tool_use') toolUses.push({ id: block.id, name: block.name, input: block.input })
  }

  // Usage
  const usage = data.usage || {}
  const inputTokens = usage.input_tokens || 0
  const outputTokens = usage.output_tokens || 0
  const cacheReadTokens = usage.cache_read_input_tokens || 0
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0

  // Custo
  const costUsd =
    inputTokens * PRICING.input +
    outputTokens * PRICING.output +
    cacheReadTokens * PRICING.cache_read +
    cacheCreationTokens * PRICING.cache_creation

  return {
    content: textOut,
    toolUses,
    usage: {
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheCreation: cacheCreationTokens,
      total: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    },
    costUsd,
    stopReason: data.stop_reason,
    raw: data,
  }
}

// Smoke test util — pra rodar via curl ou node script
export async function smokeTest() {
  const r = await callHaiku({
    systemPrompt: 'Voce e um assistente. Responda em PT-BR, 1 frase curta.',
    messages: [{ role: 'user', content: 'Diga um oi simpatico.' }],
    maxTokens: 50,
  })
  console.log('[Smoke test Haiku]')
  console.log('  Content:', r.content)
  console.log('  Usage:', r.usage)
  console.log('  Cost USD:', r.costUsd.toFixed(6))
  return r
}

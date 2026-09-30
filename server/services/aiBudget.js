// Orcamentos mensais de IA por conta (tokens de entrada + saida no mes corrente, UTC).
// Analise de conversas/coaching tem um teto; o roteiro tem outro, separado, pra extracao
// por mensagem nao gastar o orcamento da analise noturna. Nao importa server/db.js: recebe db.
import { pickAnthropicKey } from './anthropicKeyPicker.js'

export const ANALYSIS_SOURCES = ['conversation_analysis', 'coaching_analysis']
export const ROTEIRO_SOURCES = ['roteiro_extraction', 'roteiro_draft', 'roteiro_learning', 'repurchase_offer']
export const DEFAULT_ANALYSIS_LIMIT = 200000
export const DEFAULT_ROTEIRO_LIMIT = 300000

function monthStart(now) {
  return now.toISOString().slice(0, 7) + '-01 00:00:00'
}

function usedTokens(db, accountId, sources, now) {
  return db.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as n
    FROM ai_agent_token_log
    WHERE account_id = ? AND source IN (${sources.map(() => '?').join(',')}) AND created_at >= ?
  `).get(accountId, ...sources, monthStart(now))?.n || 0
}

function check(db, accountId, { sources, limitColumn, defaultLimit, now = new Date(), env = process.env }) {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
  // Sem chave Anthropic (propria ou da Dros, conforme ai_key_source), a conta nao roda IA
  if (!pickAnthropicKey(account, env)) return { ok: false, reason: 'no_api_key', used: 0, limit: 0 }
  const limit = account?.[limitColumn] || defaultLimit
  const used = usedTokens(db, accountId, sources, now)
  return { ok: used < limit, used, limit }
}

// Analise de conversas + coaching (teto accounts.analysis_token_limit).
export function analysisBudget(db, accountId, opts = {}) {
  return check(db, accountId, { ...opts, sources: ANALYSIS_SOURCES, limitColumn: 'analysis_token_limit', defaultLimit: DEFAULT_ANALYSIS_LIMIT })
}

// IA do roteiro: extracao, montar com IA e aprendizado (teto accounts.roteiro_ai_token_limit).
export function canRoteiroAi(db, accountId, opts = {}) {
  return check(db, accountId, { ...opts, sources: ROTEIRO_SOURCES, limitColumn: 'roteiro_ai_token_limit', defaultLimit: DEFAULT_ROTEIRO_LIMIT })
}

// Escolhe a chave Anthropic da conta conforme accounts.ai_key_source.
// 'client' (default): chave propria da conta. 'dros': chave central ANTHROPIC_API_KEY_DROS (/root/.env).
// Sem fallback entre as duas: se a fonte escolhida nao tem chave, a IA nao roda.
export function pickAnthropicKey(account, env = process.env) {
  if (!account) return null
  if (account.ai_key_source === 'dros') {
    const central = String((env && env.ANTHROPIC_API_KEY_DROS) || '').trim()
    return central || null
  }
  const own = String(account.anthropic_api_key || '').trim()
  return own || null
}

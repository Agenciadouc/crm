// Escolhe a chave Anthropic da conta conforme accounts.ai_key_source.
// 'client' (default): so a chave propria da conta, sem fallback.
// 'dros': so a chave central ANTHROPIC_API_KEY_DROS (/root/.env), sem fallback.
// 'auto': propria primeiro (custo cai no cliente); se a conta nao tem chave, cai na
// central da Dros (custo cai na Dros) — e so nessas duas, cada uma tem seu proprio "sem
// fallback" acima para quem quer forcar uma fonte especifica.
export function pickAnthropicKey(account, env = process.env) {
  if (!account) return null
  const central = () => {
    const c = String((env && env.ANTHROPIC_API_KEY_DROS) || '').trim()
    return c || null
  }
  if (account.ai_key_source === 'dros') return central()
  const own = String(account.anthropic_api_key || '').trim()
  if (account.ai_key_source === 'auto') return own || central()
  return own || null
}

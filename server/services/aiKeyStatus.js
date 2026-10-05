// Aviso "Conecte sua chave de IA" (spec 2026-10-05 crm simples §7): conta no modo 'client'
// (ou sem modo) e sem chave propria nao tem IA no dia a dia. 'auto'/'dros' = IA global ligada.
export function aiKeyStatus(account) {
  if (!account) return { needs_key: false }
  const source = account.ai_key_source || 'client'
  if (source !== 'client') return { needs_key: false }
  return { needs_key: !String(account.anthropic_api_key || '').trim() }
}

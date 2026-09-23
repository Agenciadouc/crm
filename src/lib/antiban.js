// Regras puras anti-ban e papeis dos numeros na tela. JS puro com .d.ts ao lado para rodar no `node --test`.
const SEND_PROVIDERS = ['uzapi', 'cloud_api']
const LEAD_VARS = ['{{nome}}', '{{name}}', '{{primeiro_nome}}', '{{first_name}}', '{{empresa}}', '{{cidade}}']
const STATUS_TEXT = {
  no_send_number: 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar',
  send_number_offline: 'O número de disparos está desconectado — os envios automáticos estão parados',
}

export function isSendProvider(provider) {
  return SEND_PROVIDERS.includes(provider)
}

export function roleLabel(role) {
  return role === 'disparo' ? 'Disparo' : 'Leitura'
}

export function sendStatusMessage(reason) {
  return reason ? (STATUS_TEXT[reason] || null) : null
}

export function lacksQuestion(text) {
  const t = String(text || '').trim()
  return t.length > 0 && !t.includes('?')
}

function parseVariations(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }
  return []
}

export function needsVariety(step) {
  const vars = parseVariations(step && step.variations).map(x => String(x || '').trim()).filter(Boolean)
  const tpl = String((step && step.message_template) || '').trim()
  if (!tpl && vars.length === 0) return false
  if (vars.length >= 2) return false
  return ![tpl, ...vars].some(t => LEAD_VARS.some(v => t.includes(v)))
}

export function formatReplyRate(rr) {
  if (!rr || rr.rate == null) return null
  return `${Math.round(rr.rate * 100)}% responderam (7 dias)`
}

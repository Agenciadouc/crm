// Regras puras dos provedores de WhatsApp na tela (Integracoes > WhatsApp).
// JS puro com .d.ts ao lado para rodar no `node --test`.

export const PROVIDER_LABELS = { uzapi: 'UzAPI (estável)', evolution: 'Evolution' }

// Ordem de exibicao: Evolution (padrao) primeiro.
const KNOWN = ['evolution', 'uzapi']

export function providerLabel(p) {
  const id = p || 'evolution'
  return PROVIDER_LABELS[id] || String(id)
}

// Aceita a resposta de GET /api/integrations/whatsapp/providers em qualquer um destes formatos:
// ['evolution','uzapi'] | { providers: ['evolution'] } | { providers: [{ id|provider|key|name: 'uzapi', ... }], default? }
// (o formato real do servidor e { providers: [{ id, label }], default }).
export function normalizeProviders(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.providers) ? raw.providers : [])
  const ids = new Set()
  for (const item of list) {
    const id = typeof item === 'string' ? item : (item && (item.id || item.provider || item.key || item.name))
    if (KNOWN.includes(id)) ids.add(id)
  }
  const ordered = KNOWN.filter(k => ids.has(k))
  return ordered.length ? ordered : ['evolution']
}

// Provedor pre-selecionado ao conectar um numero novo: UzAPI quando estiver disponivel na lista,
// senao Evolution (Ajuste do controlador sobre a decisao 4 do spec).
export function defaultProvider(list) {
  const normalized = Array.isArray(list) ? list : []
  return normalized.includes('uzapi') ? 'uzapi' : 'evolution'
}

// qr_code pode vir como data URL ou base64 cru de PNG. Texto cru do WhatsApp (ex.: "2@...,...")
// nao e imagem: devolve null e a tela mostra o botao do painel ou pede para atualizar.
export function qrImageSrc(qr) {
  const s = typeof qr === 'string' ? qr.trim() : ''
  if (!s) return null
  if (s.startsWith('data:image/')) return s
  const compact = s.replace(/\s+/g, '')
  if (compact.length >= 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return `data:image/png;base64,${compact}`
  return null
}

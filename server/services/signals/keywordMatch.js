// Funcoes puras de casamento e classificacao de sinais por palavra-chave (spec 2026-10-02 §3.1).
// Sem banco, sem efeitos colaterais.

export function normalizeText(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchKeyword(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return null
  const t = normalizeText(text)
  if (!t) return null
  for (const kw of keywords) {
    const nk = normalizeText(kw)
    if (nk && t.includes(nk)) return kw
  }
  return null
}

export function parseKeywordList(json) {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr.filter(k => typeof k === 'string' && k.trim()) : []
  } catch {
    return []
  }
}

// Ordem de prioridade (spec §3.1): negativo > forte > fraco (so com gatilho armado).
export function classifyMessage(content, { strongKeywords, negativeKeywords, weakKeywords, hasArmedTrigger }) {
  const neg = matchKeyword(content, negativeKeywords)
  if (neg) return { type: 'negative', keyword: neg }

  const strong = matchKeyword(content, strongKeywords)
  if (strong) return { type: 'strong', keyword: strong }

  if (hasArmedTrigger) {
    const weak = matchKeyword(content, weakKeywords)
    if (weak) return { type: 'weak', keyword: weak }
  }

  return { type: null, keyword: null }
}

export function findTriggerKeyword(outboundContents, triggerKeywords) {
  for (const content of outboundContents) {
    const match = matchKeyword(content, triggerKeywords)
    if (match) return match
  }
  return null
}

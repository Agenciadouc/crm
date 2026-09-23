// Regras puras anti-banimento (spec secao 10, apresentacao da UzAPI).
export const OPTOUT_WORDS = ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop']
export const DEFAULT_OPTOUT_FOOTER = 'Digite SAIR para não receber mais mensagens.'
export const DEFAULT_OPTOUT_CONFIRM = 'Pronto! Você não vai mais receber nossas mensagens automáticas.'
export const LEAD_VARS = ['{{nome}}', '{{name}}', '{{primeiro_nome}}', '{{first_name}}', '{{empresa}}', '{{cidade}}']

function normalizeWord(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

// So a palavra sozinha conta ("vou sair agora" nao descadastra).
export function isOptOutMessage(text) {
  const w = normalizeWord(text)
  return OPTOUT_WORDS.includes(w)
}

export function isOptedOut(lead) {
  if (!lead || !lead.opted_out_at) return false
  return !lead.opted_in_at || lead.opted_out_at > lead.opted_in_at
}

export function appendOptOutFooter(text, footer) {
  const base = String(text || '')
  const f = String(footer || '').trim()
  if (!f) return base
  if (base.trimEnd().endsWith(f)) return base
  return `${base}\n\n${f}`
}

function parseVariations(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) {
    try { const arr = JSON.parse(v); return Array.isArray(arr) ? arr : [] } catch { return [] }
  }
  return []
}

export function checkStepVariety(step) {
  const vars = parseVariations(step && step.variations).map(x => String(x || '').trim()).filter(Boolean)
  if (vars.length >= 2) return { ok: true }
  const texts = [step && step.message_template, ...vars].map(t => String(t || ''))
  if (texts.some(t => LEAD_VARS.some(v => t.includes(v)))) return { ok: true }
  return { ok: false, error: 'Mensagem igual para todos aumenta o risco de bloqueio: adicione uma variação ou use {{nome}}.' }
}

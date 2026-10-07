// Importar leads: regras puras do navegador (spec 2026-10-06 importar leads §3-§4, §8).
// JS puro com .d.ts: roda no node --test e e importado pelo front.
export const MAX_ROWS = 5000

export const FIELDS = [
  { key: 'name', label: 'Nome', unique: false },
  { key: 'phone', label: 'Telefone', unique: true },
  { key: 'email', label: 'E-mail', unique: true },
  { key: 'city', label: 'Cidade', unique: true },
  { key: 'state', label: 'Estado (UF)', unique: true },
  { key: 'empresa', label: 'Empresa', unique: true },
  { key: 'instagram', label: 'Instagram', unique: true },
  { key: 'cpf_cnpj', label: 'CPF/CNPJ', unique: true },
  { key: 'notes', label: 'Observações', unique: false },
  { key: 'value_estimated', label: 'Valor estimado', unique: true },
  { key: 'source_detail', label: 'Origem', unique: true },
  { key: 'tags', label: 'Tags', unique: true },
  { key: 'extra', label: 'Informação extra', unique: false },
  { key: 'skip', label: 'Não importar', unique: false },
]
const UNIQUE = new Set(FIELDS.filter(f => f.unique).map(f => f.key))

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const HINTS = [
  ['phone', ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'phone', 'tel', 'contato']],
  ['email', ['email', 'e mail']],
  ['name', ['nome', 'nome completo', 'name', 'cliente', 'sobrenome']],
  ['city', ['cidade', 'municipio']],
  ['state', ['estado', 'uf']],
  ['empresa', ['empresa', 'razao social', 'loja', 'nome fantasia']],
  ['instagram', ['instagram', 'insta']],
  ['cpf_cnpj', ['cpf', 'cnpj', 'documento', 'cpf cnpj']],
  ['notes', ['obs', 'observacao', 'observacoes', 'nota', 'notas']],
  ['value_estimated', ['valor', 'ticket', 'valor estimado']],
  ['source_detail', ['origem', 'fonte', 'source', 'campanha']],
  ['tags', ['tag', 'tags', 'etiqueta', 'etiquetas']],
]

export function suggestField(header) {
  const h = norm(header)
  if (!h) return 'extra'
  for (const [key, words] of HINTS) if (words.includes(h)) return key
  // "telefone 2", "nome do cliente": comeca com a palavra
  for (const [key, words] of HINTS) if (words.some(w => h.startsWith(w + ' '))) return key
  return 'extra'
}

export function uniqueHeaders(headers) {
  const seen = new Map()
  return (headers || []).map((h, i) => {
    const base = String(h == null ? '' : h).trim() || `Coluna ${i + 1}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

export function autoMapping(headers) {
  const used = new Set()
  return (headers || []).map(h => {
    const k = suggestField(h)
    if (UNIQUE.has(k)) { if (used.has(k)) return 'extra'; used.add(k) }
    return k
  })
}

export function setMapping(mapping, index, key) {
  return mapping.map((k, i) => (i === index ? key : UNIQUE.has(key) && k === key ? 'skip' : k))
}

const str = v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()

export function parseMoney(v) {
  let s = str(v).replace(/[^\d.,-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '') // "1.500" = mil e quinhentos
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function cleanInstagram(v) {
  let s = str(v).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '')
  return s.replace(/^@+/, '').trim()
}

export function buildRows(headers, data, mapping) {
  const out = []
  ;(data || []).forEach((cells, i) => {
    const values = (cells || []).map(str)
    if (!values.some(Boolean)) return
    const fields = {}
    const extra = {}
    const names = []
    const notes = []
    mapping.forEach((key, c) => {
      const v = values[c] || ''
      if (!v || key === 'skip') return
      if (key === 'name') names.push(v)
      else if (key === 'notes') notes.push(v)
      else if (key === 'extra') extra[headers[c]] = v
      else if (key === 'tags') {
        const tags = v.split(/[,;]/).map(t => t.trim()).filter(Boolean)
        if (tags.length) fields.tags = tags
      } else if (key === 'value_estimated') {
        const n = parseMoney(v)
        if (n !== null) fields.value_estimated = n
      } else if (key === 'instagram') {
        const ig = cleanInstagram(v)
        if (ig) fields.instagram = ig
      } else fields[key] = v
    })
    if (names.length) fields.name = names.join(' ')
    if (notes.length) fields.notes = notes.join('\n')
    out.push({ row: i + 2, fields, extra })
  })
  return out
}

export function maskPhone(v) {
  let d = String(v || '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return '***'
  return `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(-4)}`
}

export function decodeText(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(bytes)
}

// Celula que comeca com = + - @ viraria formula no Excel: vai com ' na frente
const csvCell = v => {
  let s = String(v == null ? '' : v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function skippedCsv(headers, data, skipped) {
  const lines = [[...headers, 'Motivo'].map(csvCell).join(';')]
  for (const s of skipped) {
    const cells = data[s.row - 2] || []
    lines.push([...headers.map((_, c) => cells[c] ?? ''), s.reason].map(csvCell).join(';'))
  }
  return '﻿' + lines.map(l => l + '\r\n').join('')
}

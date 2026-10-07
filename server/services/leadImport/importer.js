// Importar leads (spec 2026-10-06 importar leads §6-§7): previa e gravacao. Nada automatico:
// nao usa leadIntake/getOrCreateLead (distribuem e avisam). Nao importa server/db.js: recebe db.
import { normalizePhone, phoneCompareKey } from '../whatsapp/normalize.js'
import { resolveCity, cityKey } from '../city.js'
import { ensureStageCadence } from '../cadence/leadCadence.js'
import { CONTACT_TYPES } from '../contacts/scope.js'

export class LeadImportError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status }
}

export const MAX_ROWS = 5000
const TEXT_FIELDS = ['name', 'email', 'city', 'state', 'empresa', 'instagram', 'cpf_cnpj', 'notes', 'source_detail']
const LIMITS = { name: 200, email: 200, city: 200, state: 200, empresa: 200, instagram: 200, cpf_cnpj: 200, source_detail: 200, notes: 5000 }
const MAX_EXTRA_KEYS = 50
const MAX_EXTRA_VALUE = 500

const pad = n => String(n).padStart(2, '0')
export function autoTagName(fileName, now = new Date()) {
  const base = String(fileName || 'planilha').replace(/\.[^.]+$/, '').trim() || 'planilha'
  return `Importado ${pad(now.getDate())}/${pad(now.getMonth() + 1)} – ${base}`.slice(0, 60)
}

const empty = v => v === null || v === undefined || String(v).trim() === ''
const maskPhone = p => {
  let d = String(p || '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  return d.length < 10 ? '***' : `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(-4)}`
}

function cleanRow(raw) {
  const f = raw?.fields || {}
  const fields = {}
  for (const k of TEXT_FIELDS) if (!empty(f[k])) fields[k] = String(f[k]).trim().slice(0, LIMITS[k])
  const n = Number(f.value_estimated)
  if (f.value_estimated !== undefined && f.value_estimated !== null && Number.isFinite(n)) fields.value_estimated = n
  const tags = Array.isArray(f.tags) ? [...new Set(f.tags.map(t => String(t).trim().slice(0, 60)).filter(Boolean))] : []
  const extra = {}
  for (const [k, v] of Object.entries(raw?.extra || {}).slice(0, MAX_EXTRA_KEYS)) {
    const key = String(k).trim().slice(0, 100)
    if (key && !empty(v)) extra[key] = String(v).trim().slice(0, MAX_EXTRA_VALUE)
  }
  return { row: Number(raw?.row) || 0, phoneRaw: f.phone, fields, tags, extra }
}

function checkDestination(db, accountId, d) {
  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ? AND account_id = ?').get(d?.funnel_id, accountId)
  if (!funnel || (funnel.kind || 'vendas') !== 'vendas') throw new LeadImportError('invalid', 400, 'Escolha um funil de vendas desta conta.')
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(d?.stage_id, funnel.id)
  if (!stage) throw new LeadImportError('invalid', 400, 'Escolha uma etapa do funil.')
  const mode = d?.attendant?.mode || 'none'
  let attendants = []
  if (mode === 'one') {
    const u = db.prepare("SELECT id FROM users WHERE id = ? AND account_id = ? AND is_active = 1").get(d.attendant.user_id, accountId)
    if (!u) throw new LeadImportError('invalid', 400, 'Vendedor não encontrado nesta conta.')
    attendants = [u.id]
  } else if (mode === 'split') {
    attendants = db.prepare("SELECT id FROM users WHERE account_id = ? AND role = 'atendente' AND is_active = 1 ORDER BY id").all(accountId).map(u => u.id)
    if (!attendants.length) throw new LeadImportError('invalid', 400, 'A conta não tem vendedores ativos para dividir.')
  } else if (mode !== 'none') throw new LeadImportError('invalid', 400, 'Escolha quem atende.')
  const contactType = d?.contact_type || 'lead'
  if (!CONTACT_TYPES.includes(contactType)) throw new LeadImportError('invalid', 400, 'Tipo de contato inválido.')
  return { funnel, stage, attendants, contactType, autoTag: d?.auto_tag !== false }
}

function existingByKey(db, accountId) {
  const map = new Map()
  const rows = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone IS NOT NULL ORDER BY is_archived ASC, created_at DESC, id DESC').all(accountId)
  for (const l of rows) { const k = phoneCompareKey(l.phone); if (k && !map.has(k)) map.set(k, l) }
  return map
}

// Agrupa por telefone, separa invalidos e decide novo x existente. Nao grava.
function analyze(db, { accountId, rows, destination }) {
  if (!Array.isArray(rows)) throw new LeadImportError('invalid', 400, 'Nenhuma linha recebida.')
  if (rows.length > MAX_ROWS) throw new LeadImportError('too_many', 400, `Máximo de ${MAX_ROWS} linhas por importação. Divida o arquivo em partes.`)
  const dest = checkDestination(db, accountId, destination)
  const skipped = []
  const groups = new Map() // key -> { first, phone }
  for (const raw of rows) {
    const r = cleanRow(raw)
    if (empty(r.phoneRaw)) { skipped.push({ row: r.row, reason: 'sem telefone' }); continue }
    const digits = String(r.phoneRaw).replace(/\D/g, '')
    if (digits.length < 10) { skipped.push({ row: r.row, reason: 'telefone inválido' }); continue }
    const phone = normalizePhone(digits)
    // So celular/fixo do Brasil (55 + DDD + numero); dois numeros na mesma celula viram invalido
    if (!/^55\d{10,11}$/.test(phone)) { skipped.push({ row: r.row, reason: 'telefone inválido' }); continue }
    const key = phoneCompareKey(phone)
    const g = groups.get(key)
    if (!g) { groups.set(key, { ...r, phone }); continue }
    // Repetido na planilha: a primeira manda; esta so completa o que faltou
    for (const [k, v] of Object.entries(r.fields)) if (g.fields[k] === undefined) g.fields[k] = v
    for (const [k, v] of Object.entries(r.extra)) if (g.extra[k] === undefined) g.extra[k] = v
    g.tags = [...new Set([...g.tags, ...r.tags])]
    skipped.push({ row: r.row, reason: `repetido na planilha (junto com a linha ${g.row})` })
  }
  const existing = existingByKey(db, accountId)
  const novos = []
  const existentes = []
  for (const [key, g] of groups) {
    const lead = existing.get(key)
    if (lead) existentes.push({ g, lead }); else novos.push(g)
  }
  skipped.sort((a, b) => a.row - b.row)
  return { dest, novos, existentes, skipped }
}

function fillsFor(lead, g) {
  const sets = {}
  for (const [k, v] of Object.entries(g.fields)) if (empty(lead[k])) sets[k] = v
  return sets
}
function parseExtra(lead) {
  try { const v = lead.custom_fields ? JSON.parse(lead.custom_fields) : {}; return v && typeof v === 'object' ? v : {} } catch { return {} }
}
// Chaves novas da planilha somadas as do lead (chave que ja existe nao e trocada); nada novo = null
function mergedExtra(lead, extra) {
  const cur = parseExtra(lead)
  const added = Object.entries(extra).filter(([k]) => cur[k] === undefined)
  return added.length ? { ...cur, ...Object.fromEntries(added) } : null
}

export function planImport(db, { accountId, rows, destination }) {
  const { novos, existentes, skipped } = analyze(db, { accountId, rows, destination })
  let filled = 0
  for (const { g, lead } of existentes) {
    const cur = parseExtra(lead)
    filled += Object.keys(fillsFor(lead, g)).length + Object.keys(g.extra).filter(k => cur[k] === undefined).length
  }
  const sample = list => list.slice(0, 5)
  return {
    new_count: novos.length,
    existing_count: existentes.length,
    filled_fields: filled,
    skipped,
    samples: {
      novos: sample(novos).map(g => ({ name: g.fields.name || '', phone: maskPhone(g.phone) })),
      existentes: sample(existentes).map(({ lead }) => ({ name: lead.name || '', phone: maskPhone(lead.phone) })),
    },
  }
}

function tagId(db, accountId, name) {
  db.prepare('INSERT OR IGNORE INTO tags (account_id, name) VALUES (?, ?)').run(accountId, name)
  return db.prepare('SELECT id FROM tags WHERE account_id = ? AND name = ?').get(accountId, name).id
}

export function applyImport(db, { accountId, rows, destination, fileName, userId = null }) {
  let out
  db.transaction(() => {
    const { dest, novos, existentes, skipped } = analyze(db, { accountId, rows, destination })
    const autoTag = dest.autoTag ? tagId(db, accountId, autoTagName(fileName)) : null
    const linkTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)')
    const tagsOf = g => [...g.tags.map(t => tagId(db, accountId, t)), ...(autoTag ? [autoTag] : [])]
    const defInstance = db.prepare("SELECT id FROM whatsapp_instances WHERE account_id = ? AND status = 'connected' ORDER BY id DESC LIMIT 1").get(accountId)?.id || null
    // Cidade: uma busca por cidade diferente (resolveCity varre os leads da conta)
    const cityCache = new Map()
    const city = v => {
      const k = cityKey(v)
      if (!cityCache.has(k)) cityCache.set(k, resolveCity(db, accountId, v))
      return cityCache.get(k)
    }
    const ids = []
    novos.forEach((g, i) => {
      const attendantId = dest.attendants.length ? dest.attendants[i % dest.attendants.length] : null
      const instanceId = (attendantId && db.prepare('SELECT primary_instance_id FROM users WHERE id = ?').get(attendantId)?.primary_instance_id) || defInstance
      const f = g.fields
      const id = Number(db.prepare(`
        INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, instance_id, name, phone, email, city, state, empresa, instagram, cpf_cnpj,
          notes, value_estimated, source, source_detail, custom_fields, contact_type, contact_type_origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importacao', ?, ?, ?, ?)
      `).run(accountId, dest.funnel.id, dest.stage.id, attendantId, instanceId, f.name || null, g.phone, f.email || null,
        f.city ? city(f.city) : null, f.state || null, f.empresa || null, f.instagram || null, f.cpf_cnpj || null,
        f.notes || null, f.value_estimated ?? null, f.source_detail || String(fileName || '').slice(0, 200) || null,
        Object.keys(g.extra).length ? JSON.stringify(g.extra) : null, dest.contactType, dest.contactType === 'lead' ? null : 'lista').lastInsertRowid)
      db.prepare("INSERT INTO stage_history (lead_id, to_stage_id, trigger_type, triggered_by) VALUES (?, ?, 'import', ?)").run(id, dest.stage.id, userId)
      if (instanceId) {
        db.prepare('UPDATE leads SET last_instance_id = ? WHERE id = ?').run(instanceId, id)
        db.prepare('INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(id, instanceId, attendantId)
      }
      for (const t of tagsOf(g)) linkTag.run(id, t)
      // Savepoint proprio: se a cadencia falhar no meio, so ela volta (o lead fica)
      try { db.transaction(() => ensureStageCadence(db, { leadId: id }))() } catch (e) { console.error('[Importar] cadencia:', e.message) }
      ids.push(id)
    })
    for (const { g, lead } of existentes) {
      const sets = fillsFor(lead, g)
      if (sets.city) sets.city = city(sets.city)
      const ex = mergedExtra(lead, g.extra)
      if (ex) sets.custom_fields = JSON.stringify(ex)
      const cols = Object.keys(sets)
      if (cols.length) {
        db.prepare(`UPDATE leads SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...cols.map(c => sets[c]), lead.id)
      }
      for (const t of tagsOf(g)) linkTag.run(lead.id, t)
      ids.push(lead.id)
    }
    out = { created: novos.length, updated: existentes.length, skipped, tag_id: autoTag, lead_ids: ids }
  })()
  return out
}

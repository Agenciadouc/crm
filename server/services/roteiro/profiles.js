// Perfis de cliente ideal da conta e perfil do lead (spec 2026-10-02 §4-§6).
// Pergunta com profile_key so vale para lead daquele perfil; sem profile_key vale para todos.
// Nao importa server/db.js: recebe db.
import { RoteiroError, newKey } from './repo.js'

export const MAX_PROFILES = 6
const str = v => (typeof v === 'string' ? v.trim() : '')

export function appliesToLead(question, leadProfileKey) {
  return !question.profile_key || question.profile_key === leadProfileKey
}

export function listProfiles(db, accountId) {
  return db.prepare('SELECT profile_key, name, description, position FROM roteiro_profiles WHERE account_id = ? ORDER BY position ASC, id ASC').all(accountId)
}

export function getBusiness(db, accountId) {
  const row = db.prepare('SELECT business_objective FROM accounts WHERE id = ?').get(accountId)
  if (!row) throw new RoteiroError('not_found', 404, 'Conta não encontrada.')
  return { business_objective: row.business_objective ?? null, profiles: listProfiles(db, accountId) }
}

// Chaves de perfil citadas em perguntas ou opcoes do rascunho/publicado da conta.
function usedProfileKeys(db, accountId) {
  const rows = db.prepare(`
    SELECT q.profile_key AS k FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id
    WHERE v.account_id = ? AND v.status IN ('draft','published') AND q.profile_key IS NOT NULL
    UNION
    SELECT o.sets_profile_key AS k FROM roteiro_options o
    JOIN roteiro_questions q ON q.id = o.question_id JOIN roteiro_versions v ON v.id = q.version_id
    WHERE v.account_id = ? AND v.status IN ('draft','published') AND o.sets_profile_key IS NOT NULL
  `).all(accountId, accountId)
  return new Set(rows.map(r => r.k))
}

// Grava objetivo + a lista inteira de perfis (perfil fora da lista e apagado).
export function saveBusiness(db, accountId, { business_objective = null, profiles = [] } = {}) {
  getBusiness(db, accountId) // 404 se a conta nao existe
  const objective = str(business_objective)
  if (objective.length > 300) throw new RoteiroError('invalid', 400, 'O objetivo do negócio pode ter até 300 caracteres.')
  if (!Array.isArray(profiles)) throw new RoteiroError('invalid', 400, 'Lista de perfis obrigatória.')
  if (profiles.length > MAX_PROFILES) throw new RoteiroError('invalid', 400, 'Máximo de 6 tipos de cliente.')
  const currentList = listProfiles(db, accountId)
  const current = new Set(currentList.map(p => p.profile_key))
  const clean = profiles.map((p, i) => {
    const name = str(p?.name)
    if (!name || name.length > 60) throw new RoteiroError('invalid', 400, 'Cada perfil precisa de um nome (até 60 caracteres).')
    const description = str(p?.description)
    if (description.length > 500) throw new RoteiroError('invalid', 400, '"Como reconhecer" pode ter até 500 caracteres.')
    const key = p?.profile_key && current.has(p.profile_key) ? p.profile_key : newKey()
    return { profile_key: key, name, description: description || null, position: i }
  })
  const keep = new Set(clean.map(p => p.profile_key))
  const removed = [...current].filter(k => !keep.has(k))
  const used = usedProfileKeys(db, accountId)
  if (removed.some(k => used.has(k))) throw new RoteiroError('in_use', 400, 'Este tipo de cliente tem perguntas. Mude ou apague as perguntas antes.')
  db.transaction(() => {
    db.prepare('UPDATE accounts SET business_objective = ? WHERE id = ?').run(objective || null, accountId)
    const del = db.prepare('DELETE FROM roteiro_profiles WHERE account_id = ? AND profile_key = ?')
    const clearLeads = db.prepare('UPDATE leads SET roteiro_profile_key = NULL, roteiro_profile_origin = NULL WHERE account_id = ? AND roteiro_profile_key = ?')
    for (const k of removed) { del.run(accountId, k); clearLeads.run(accountId, k) }
    const up = db.prepare(`
      INSERT INTO roteiro_profiles (account_id, profile_key, name, description, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, profile_key) DO UPDATE SET name = excluded.name, description = excluded.description,
        position = excluded.position, updated_at = datetime('now')
    `)
    for (const p of clean) up.run(accountId, p.profile_key, p.name, p.description, p.position)
    // Com 1 perfil o lead usa o unico sem gravar (effectiveProfileKey). Ao ganhar o 2o perfil,
    // quem estava nele implicitamente passa a te-lo gravado ('herdado'), senao perderia as
    // perguntas dele. 'herdado' nao foi escolha de ninguem: a IA ainda pode trocar.
    const sole = currentList.length === 1 ? currentList[0].profile_key : null
    if (sole && keep.has(sole) && clean.length >= 2) {
      db.prepare(`UPDATE leads SET roteiro_profile_key = ?, roteiro_profile_origin = 'herdado'
        WHERE account_id = ? AND roteiro_profile_key IS NULL AND COALESCE(is_active, 1) = 1 AND COALESCE(is_archived, 0) = 0`).run(sole, accountId)
    }
  })()
  return getBusiness(db, accountId)
}

// Perfil que vale para o lead: o gravado; senao, o unico perfil da conta; senao, nenhum.
export function effectiveProfileKey(db, lead) {
  if (!lead) return null
  if (lead.roteiro_profile_key) return lead.roteiro_profile_key
  const rows = db.prepare('SELECT profile_key FROM roteiro_profiles WHERE account_id = ? LIMIT 2').all(lead.account_id)
  return rows.length === 1 ? rows[0].profile_key : null
}

// origin 'ia' nunca troca perfil escolhido a mao, nem apaga perfil.
export function setLeadProfile(db, { accountId, leadId, profileKey, origin }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new RoteiroError('not_found', 404, 'Lead não encontrado.')
  const key = profileKey || null
  if (key && !db.prepare('SELECT 1 FROM roteiro_profiles WHERE account_id = ? AND profile_key = ?').get(accountId, key)) {
    throw new RoteiroError('invalid', 400, 'Tipo de cliente inválido.')
  }
  if (origin === 'ia' && (lead.roteiro_profile_origin === 'manual' || !key)) return { changed: false }
  const nextOrigin = key ? origin : null
  if ((lead.roteiro_profile_key || null) === key && (lead.roteiro_profile_origin || null) === nextOrigin) return { changed: false }
  db.prepare('UPDATE leads SET roteiro_profile_key = ?, roteiro_profile_origin = ? WHERE id = ?').run(key, nextOrigin, lead.id)
  return { changed: true }
}

export function leadProfileView(db, { accountId, lead }) {
  return {
    profile_key: lead.roteiro_profile_key ?? null,
    origin: lead.roteiro_profile_origin ?? null,
    effective_key: effectiveProfileKey(db, lead),
    profiles: listProfiles(db, accountId).map(p => ({ profile_key: p.profile_key, name: p.name })),
  }
}

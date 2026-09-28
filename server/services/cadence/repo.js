// Cadencias (da etapa e avulsas): CRUD com passos atualizados por id e sincronizacao dos
// passos 'pergunta' com o roteiro (spec 2026-09-27 §3.1-3.4, §4.3). A cadencia e a tela;
// o roteiro publicado continua sendo o motor. Recebe db (nao importa server/db.js).
import { getRoteiro, saveDraft, publish, newKey } from '../roteiro/repo.js'
import { BANT_QUESTIONS } from '../roteiro/bantTemplate.js'
import { buildAiDraft } from '../roteiro/aiDraft.js'
import { applySuggestion, confirmVariant } from '../roteiro/learning.js'
import { CADENCE_ACTION_TYPES } from './schema.js'
import { CadenceError } from './errors.js'

const QUESTION_NOT_IN_STAGE = 'Esta pergunta não está no roteiro da etapa.'

function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function nonNegInt(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function loadCadenceRow(db, accountId, cadenceId) {
  const c = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ?').get(cadenceId, accountId)
  if (!c) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  return c
}

function loadAttempts(db, cadenceId) {
  return db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(cadenceId)
}

function loadStageForAccount(db, accountId, stageId) {
  const st = db.prepare(`
    SELECT s.id, s.name, s.funnel_id, s.is_terminal FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id
    WHERE s.id = ? AND f.account_id = ?
  `).get(stageId, accountId)
  if (!st) throw new CadenceError('not_found', 404, 'Etapa não encontrada.')
  if (st.is_terminal) throw new CadenceError('invalid', 400, 'Etapas finais (venda/perdido) não têm cadência.')
  return st
}

// Base de toda sincronizacao: a versao PUBLICADA (decisao D1). Rascunho nao entra.
function publishedContent(db, accountId, funnelId) {
  const rot = getRoteiro(db, accountId, funnelId)
  const p = rot.published
  return { rot, content: p ? { questions: p.questions, deviations: p.deviations } : { questions: [], deviations: [] } }
}

function withSteps(db, accountId, c) {
  const attempts = loadAttempts(db, c.id)
  let byKey = new Map()
  if (c.funnel_id && attempts.some(a => a.action_type === 'pergunta')) {
    byKey = new Map(publishedContent(db, accountId, c.funnel_id).content.questions.map(q => [q.question_key, q]))
  }
  return { ...c, attempts: attempts.map(a => ({ ...a, question: a.question_key ? (byKey.get(a.question_key) || null) : null })) }
}

export function getCadence(db, accountId, cadenceId) {
  return withSteps(db, accountId, loadCadenceRow(db, accountId, cadenceId))
}

export function listCadences(db, accountId, { kind } = {}) {
  let where = 'account_id = ? AND is_active = 1'
  if (kind === 'avulsa') where += ' AND stage_id IS NULL'
  if (kind === 'etapa') where += ' AND stage_id IS NOT NULL'
  return db.prepare(`SELECT * FROM cadences WHERE ${where} ORDER BY name`).all(accountId).map(c => withSteps(db, accountId, c))
}

function normalizeStep(a, { isStage }) {
  const actionType = a.action_type || 'mensagem'
  if (!CADENCE_ACTION_TYPES.includes(actionType)) throw new CadenceError('invalid', 400, 'Tipo de passo inválido.')
  if (actionType === 'pergunta' && !isStage) throw new CadenceError('invalid', 400, 'Pergunta só entra na cadência de uma etapa.')
  return {
    action_type: actionType,
    description: strOrNull(a.description),
    instructions: strOrNull(a.instructions),
    auto_message: strOrNull(a.auto_message),
    call_script: strOrNull(a.call_script),
    scheduled_time: strOrNull(a.scheduled_time),
    delay_days: nonNegInt(a.delay_days),
    delay_minutes: nonNegInt(a.delay_minutes),
    schedule_mode: a.schedule_mode === 'duration' ? 'duration' : 'date',
  }
}

function insertStepRow(db, cadenceId, step, position, questionKey = null) {
  return Number(db.prepare(`
    INSERT INTO cadence_attempts (cadence_id, position, action_type, description, instructions, auto_message, call_script, scheduled_time, delay_days, delay_minutes, schedule_mode, question_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cadenceId, position, step.action_type, step.description, step.instructions, step.auto_message, step.call_script,
    step.scheduled_time, step.delay_days, step.delay_minutes, step.schedule_mode, questionKey).lastInsertRowid)
}

function updateStepRow(db, id, step, position = null) {
  db.prepare(`
    UPDATE cadence_attempts SET action_type = ?, description = ?, instructions = ?, auto_message = ?, call_script = ?,
      scheduled_time = ?, delay_days = ?, delay_minutes = ?, schedule_mode = ?, position = COALESCE(?, position)
    WHERE id = ?
  `).run(step.action_type, step.description, step.instructions, step.auto_message, step.call_script,
    step.scheduled_time, step.delay_days, step.delay_minutes, step.schedule_mode, position, id)
}

function renumber(db, cadenceId) {
  const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
  loadAttempts(db, cadenceId).forEach((a, i) => { if (a.position !== i) upd.run(i, a.id) })
}

function touch(db, cadenceId) {
  db.prepare("UPDATE cadences SET updated_at = datetime('now') WHERE id = ?").run(cadenceId)
}

export function createCadence(db, accountId, { name, description = null, stageId = null, attempts = [] } = {}) {
  let stage = null
  if (stageId != null) {
    stage = loadStageForAccount(db, accountId, stageId)
    if (db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1').get(stage.id)) {
      throw new CadenceError('stage_taken', 409, 'Esta etapa já tem cadência.')
    }
  }
  const finalName = strOrNull(name) || (stage && stage.name)
  if (!finalName) throw new CadenceError('invalid', 400, 'Nome obrigatório.')
  const steps = (Array.isArray(attempts) ? attempts : []).map(a => normalizeStep(a, { isStage: false }))
  let id
  db.transaction(() => {
    id = Number(db.prepare('INSERT INTO cadences (account_id, name, description, funnel_id, stage_id) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, finalName, strOrNull(description), stage ? stage.funnel_id : null, stage ? stage.id : null).lastInsertRowid)
    steps.forEach((st, i) => insertStepRow(db, id, st, i))
  })()
  return getCadence(db, accountId, id)
}

export function updateCadence(db, accountId, cadenceId, { name, description, is_active } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const sets = []
  const params = []
  if (name !== undefined) {
    const n = strOrNull(name)
    if (!n) throw new CadenceError('invalid', 400, 'Nome obrigatório.')
    sets.push('name = ?'); params.push(n)
  }
  if (description !== undefined) { sets.push('description = ?'); params.push(strOrNull(description)) }
  if (is_active !== undefined) {
    const on = is_active ? 1 : 0
    if (on && c.stage_id && db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1 AND id <> ?').get(c.stage_id, c.id)) {
      throw new CadenceError('stage_taken', 409, 'Esta etapa já tem cadência.')
    }
    sets.push('is_active = ?'); params.push(on)
  }
  if (!sets.length) throw new CadenceError('invalid', 400, 'Nada para atualizar.')
  sets.push("updated_at = datetime('now')")
  db.prepare(`UPDATE cadences SET ${sets.join(', ')} WHERE id = ?`).run(...params, c.id)
  return getCadence(db, accountId, c.id)
}

export function deleteCadence(db, accountId, cadenceId) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (c.stage_id) throw new CadenceError('invalid', 400, 'A cadência da etapa não pode ser apagada. Apague os passos dela.')
  db.prepare("UPDATE cadences SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(c.id)
  return { ok: true }
}

function projectQuestion(q) {
  const opts = q.kind === 'options' ? (q.options || []) : []
  return [q.question_key, q.stage_id, q.position, String(q.text || '').trim(), q.kind, !!q.required, q.bant ?? null,
    (typeof q.ai_hint === 'string' && q.ai_hint.trim()) || null,
    opts.map((o, i) => [o.option_key ?? null, String(o.label || '').trim(), Number(o.points), Number.isInteger(o.position) ? o.position : i])]
}
function projectDeviation(d, i) {
  return [String(d.triggers || '').trim(), String(d.reply_text || '').trim(), d.return_question_key ?? null, i]
}
export function sameRoteiroContent(a, b) {
  const qs = x => JSON.stringify(x.questions.map(projectQuestion).sort((p, q) => (p[1] - q[1]) || (p[2] - q[2]) || (p[0] < q[0] ? -1 : 1)))
  const ds = x => JSON.stringify([...x.deviations].sort((p, q) => (p.position ?? 0) - (q.position ?? 0)).map(projectDeviation))
  return qs(a) === qs(b) && ds(a) === ds(b)
}

function mirrorDescriptions(db, steps, questions) {
  const upd = db.prepare('UPDATE cadence_attempts SET description = ? WHERE id = ?')
  const byKey = new Map(questions.map(q => [q.question_key, q]))
  let n = 0
  for (const a of steps) {
    const q = byKey.get(a.question_key)
    if (q && a.description !== q.text) { upd.run(q.text, a.id); n++ }
  }
  return n
}

// D1: o que vai ao ar parte sempre do publicado. Rascunho que ninguem publicou (tela antiga
// de Qualificacao, IA que o gestor desistiu) nao pode vazar quando uma mudanca entra direto.
function resetDraftToPublished(db, accountId, funnelId) {
  const { rot, content } = publishedContent(db, accountId, funnelId)
  if (rot.draft && !sameRoteiroContent(rot.draft, content)) saveDraft(db, accountId, funnelId, content)
}

function funnelOfQuestion(db, accountId, questionKey) {
  const row = db.prepare(`
    SELECT v.funnel_id FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id
    WHERE q.account_id = ? AND q.question_key = ? AND v.status = 'published' LIMIT 1
  `).get(accountId, questionKey)
  return row ? row.funnel_id : null
}

// Passos 'pergunta' da cadencia da etapa, na ordem, SAO as perguntas da etapa no roteiro.
// Publica so quando o conteudo muda (spec 3.4; decisoes D1/D2).
export function syncStageQuestions(db, accountId, cadenceId, { overrides = new Map(), deviations = null, userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (!c.stage_id || !c.funnel_id) return { published: false }
  const { rot, content } = publishedContent(db, accountId, c.funnel_id)
  const baseByKey = new Map(content.questions.map(q => [q.question_key, q]))
  const steps = c.is_active ? loadAttempts(db, c.id).filter(a => a.action_type === 'pergunta') : []
  const stageQuestions = steps.map((a, idx) => {
    const base = baseByKey.get(a.question_key)
    const patch = overrides.get(a.question_key)
    if (!base && !patch) throw new CadenceError('invalid', 400, QUESTION_NOT_IN_STAGE)
    const m = { ...(base || { kind: 'text', required: false, bant: null, ai_hint: null, options: [] }), ...(patch || {}) }
    return {
      question_key: a.question_key, stage_id: c.stage_id, position: idx,
      text: m.text, kind: m.kind, required: !!m.required, bant: m.bant ?? null, ai_hint: m.ai_hint ?? null,
      options: m.kind === 'options' ? (m.options || []) : [],
    }
  })
  const others = content.questions.filter(q => q.stage_id !== c.stage_id)
  const allKeys = new Set(others.map(q => q.question_key).concat(stageQuestions.map(q => q.question_key)))
  const devs = (deviations || content.deviations).map((d, idx) => ({
    triggers: d.triggers, reply_text: d.reply_text, position: idx,
    return_question_key: d.return_question_key && allKeys.has(d.return_question_key) ? d.return_question_key : null,
  }))
  const next = { questions: others.concat(stageQuestions), deviations: devs }
  if (!rot.published && !next.questions.length && !next.deviations.length) return { published: false }
  if (rot.published && sameRoteiroContent(rot.published, next)) {
    mirrorDescriptions(db, steps, stageQuestions)
    return { published: false }
  }
  saveDraft(db, accountId, c.funnel_id, next) // valida texto/opcoes/pontos (RoteiroError 400)
  const version = publish(db, accountId, c.funnel_id, userId)
  mirrorDescriptions(db, steps, version.questions.filter(q => q.stage_id === c.stage_id))
  return { published: true }
}

function assertQuestionInStage(db, accountId, c, questionKey) {
  const { content } = publishedContent(db, accountId, c.funnel_id)
  if (!content.questions.some(q => q.question_key === questionKey && q.stage_id === c.stage_id)) {
    throw new CadenceError('invalid', 400, QUESTION_NOT_IN_STAGE)
  }
  if (db.prepare('SELECT 1 FROM cadence_attempts WHERE cadence_id = ? AND question_key = ?').get(c.id, questionKey)) {
    throw new CadenceError('invalid', 400, 'Esta pergunta já está em outro passo.')
  }
}

export function addStep(db, accountId, cadenceId, input = {}, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const step = normalizeStep(input, { isStage: !!c.stage_id })
  let stepId
  let published = false
  db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts WHERE cadence_id = ?').get(c.id).n
    const position = Number.isInteger(input.position) ? Math.max(0, Math.min(input.position, count)) : count
    db.prepare('UPDATE cadence_attempts SET position = position + 1 WHERE cadence_id = ? AND position >= ?').run(c.id, position)
    let questionKey = null
    const overrides = new Map()
    if (step.action_type === 'pergunta') {
      if (input.question_key) {
        questionKey = String(input.question_key)
        assertQuestionInStage(db, accountId, c, questionKey)
      } else {
        questionKey = newKey()
        overrides.set(questionKey, input.question || {})
      }
    }
    stepId = insertStepRow(db, c.id, step, position, questionKey)
    renumber(db, c.id)
    if (questionKey) published = syncStageQuestions(db, accountId, c.id, { overrides, userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), step_id: stepId, published }
}

function loadStep(db, c, attemptId) {
  const row = db.prepare('SELECT * FROM cadence_attempts WHERE id = ? AND cadence_id = ?').get(attemptId, c.id)
  if (!row) throw new CadenceError('step_changed', 404, 'Passo não encontrado. A tela foi atualizada.')
  return row
}

export function updateStep(db, accountId, cadenceId, attemptId, patch = {}, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const row = loadStep(db, c, attemptId)
  const nextType = patch.action_type || row.action_type
  if (nextType !== row.action_type && (nextType === 'pergunta' || row.action_type === 'pergunta')) {
    throw new CadenceError('invalid', 400, 'Não dá para trocar pergunta por outro tipo. Apague o passo e crie outro.')
  }
  const step = normalizeStep({ ...row, ...patch, action_type: nextType }, { isStage: !!c.stage_id })
  let published = false
  db.transaction(() => {
    updateStepRow(db, row.id, step)
    if (row.action_type === 'pergunta' && patch.question) {
      published = syncStageQuestions(db, accountId, c.id, { overrides: new Map([[row.question_key, patch.question]]), userId }).published
    }
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), step_id: row.id, published }
}

export function deleteStep(db, accountId, cadenceId, attemptId, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const row = loadStep(db, c, attemptId)
  let published = false
  db.transaction(() => {
    db.prepare('DELETE FROM cadence_attempts WHERE id = ?').run(row.id) // FK zera lead_cadences.current_attempt_id
    renumber(db, c.id)
    if (row.action_type === 'pergunta') published = syncStageQuestions(db, accountId, c.id, { userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), published }
}

export function reorderSteps(db, accountId, cadenceId, attemptIds, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const current = loadAttempts(db, c.id).map(a => a.id)
  const ids = (Array.isArray(attemptIds) ? attemptIds : []).map(Number)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every(id => current.includes(id))) {
    throw new CadenceError('step_changed', 409, 'A lista de passos mudou. A tela foi atualizada.')
  }
  let published = false
  db.transaction(() => {
    const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
    ids.forEach((id, i) => upd.run(i, id))
    if (c.stage_id) published = syncStageQuestions(db, accountId, c.id, { userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), published }
}

export function replaceAttemptsById(db, accountId, cadenceId, attempts) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (c.stage_id) throw new CadenceError('invalid', 400, 'Edite a cadência da etapa pela tela da etapa.')
  if (!Array.isArray(attempts)) throw new CadenceError('invalid', 400, 'Lista de passos obrigatória.')
  const existing = new Set(loadAttempts(db, c.id).map(a => a.id))
  db.transaction(() => {
    const keep = new Set()
    attempts.forEach((a, i) => {
      const step = normalizeStep(a, { isStage: false })
      const id = Number(a.id)
      if (id && existing.has(id)) { updateStepRow(db, id, step, i); keep.add(id) }
      else keep.add(insertStepRow(db, c.id, step, i))
    })
    const del = db.prepare('DELETE FROM cadence_attempts WHERE id = ?')
    for (const id of existing) if (!keep.has(id)) del.run(id)
    touch(db, c.id)
  })()
  return getCadence(db, accountId, c.id)
}

export function saveDeviations(db, accountId, funnelId, deviations, { userId = null } = {}) {
  if (!Array.isArray(deviations)) throw new CadenceError('invalid', 400, 'Lista de desvios obrigatória.')
  const { rot, content } = publishedContent(db, accountId, funnelId)
  const next = {
    questions: content.questions,
    deviations: deviations.map((d, i) => ({ triggers: d.triggers, reply_text: d.reply_text, return_question_key: d.return_question_key || null, position: i })),
  }
  if (rot.published && sameRoteiroContent(rot.published, next)) return { deviations: rot.published.deviations, published: false }
  saveDraft(db, accountId, funnelId, next)
  const v = publish(db, accountId, funnelId, userId)
  return { deviations: v.deviations, published: true }
}

export function addQuestionSteps(db, accountId, { stageId, questions, userId = null }) {
  const stage = loadStageForAccount(db, accountId, stageId)
  if (!Array.isArray(questions) || !questions.length) throw new CadenceError('invalid', 400, 'Nenhuma pergunta para adicionar.')
  let cadenceId
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1 AND account_id = ?').get(stage.id, accountId)
    cadenceId = existing ? existing.id : createCadence(db, accountId, { stageId: stage.id }).id
    let pos = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts WHERE cadence_id = ?').get(cadenceId).n
    const overrides = new Map()
    const step = normalizeStep({ action_type: 'pergunta' }, { isStage: true })
    for (const q of questions) {
      const key = newKey()
      overrides.set(key, q)
      insertStepRow(db, cadenceId, { ...step, description: strOrNull(q.text) }, pos++, key)
    }
    syncStageQuestions(db, accountId, cadenceId, { overrides, userId })
    touch(db, cadenceId)
  })()
  return getCadence(db, accountId, cadenceId)
}

function toQuestionInput(q) {
  return {
    text: q.text, kind: q.kind, required: !!q.required, bant: q.bant ?? null, ai_hint: q.ai_hint ?? null,
    options: (q.options || []).map((o, i) => ({ label: o.label, points: o.points, position: i })),
  }
}

export function bantStepQuestions(db, accountId, funnelId) {
  const { content } = publishedContent(db, accountId, funnelId)
  const used = new Set(content.questions.map(q => q.bant).filter(Boolean))
  return BANT_QUESTIONS.filter(b => !used.has(b.bant)).map(b => toQuestionInput({ ...b, ai_hint: null }))
}

// Montar com IA (spec 5.1): usa o gerador do roteiro e fica so com as perguntas desta etapa.
// O rascunho do funil que ele grava e ignorado (sincronizacao parte do publicado, D1).
export async function aiStepQuestions(db, accountId, { funnelId, stageId, ai }) {
  const before = getRoteiro(db, accountId, funnelId).draft // 404 se o funil nao e da conta
  const draft = await buildAiDraft(db, { accountId, funnelId, ai })
  // A tela nova so usa as perguntas devolvidas: o rascunho do funil volta a ser o de antes.
  if (before) saveDraft(db, accountId, funnelId, { questions: before.questions, deviations: before.deviations })
  else resetDraftToPublished(db, accountId, funnelId)
  const qs = draft.questions.filter(q => q.stage_id === Number(stageId))
  if (!qs.length) throw new CadenceError('ai_empty', 422, 'A IA não sugeriu perguntas para esta etapa. Tente o modelo BANT.')
  return qs.map(toQuestionInput)
}

function rankOf(order, key) {
  const i = order.indexOf(key)
  return i === -1 ? order.length : i
}

// Depois de uma mudanca feita direto no roteiro (sugestao aplicada, A/B confirmado): as vagas
// de pergunta de cada cadencia da etapa recebem as perguntas na ordem publicada e o texto espelho.
export function pullFromRoteiro(db, accountId, funnelId) {
  const { content } = publishedContent(db, accountId, funnelId)
  const touched = []
  const cads = db.prepare('SELECT * FROM cadences WHERE account_id = ? AND funnel_id = ? AND stage_id IS NOT NULL AND is_active = 1').all(accountId, funnelId)
  const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
  for (const c of cads) {
    const stageQs = content.questions.filter(q => q.stage_id === c.stage_id).sort((a, b) => a.position - b.position)
    const order = stageQs.map(q => q.question_key)
    const slots = loadAttempts(db, c.id).filter(a => a.action_type === 'pergunta')
    const sorted = slots.slice().sort((a, b) => rankOf(order, a.question_key) - rankOf(order, b.question_key))
    let changed = false
    slots.forEach((slot, i) => {
      if (sorted[i].id !== slot.id) { changed = true; upd.run(slot.position, sorted[i].id) }
    })
    if (mirrorDescriptions(db, slots, stageQs)) changed = true
    if (changed) { touch(db, c.id); touched.push(c.id) }
  }
  return touched
}

// [Aplicar] na tela nova: sem botao Publicar, a sugestao ja entra no ar.
export function applySuggestionLive(db, accountId, suggestionId, { userId = null } = {}) {
  let result
  db.transaction(() => {
    const sug = db.prepare('SELECT funnel_id, question_key FROM roteiro_suggestions WHERE id = ? AND account_id = ?').get(suggestionId, accountId)
    const fid = sug && (sug.funnel_id ?? (sug.question_key ? funnelOfQuestion(db, accountId, sug.question_key) : null))
    if (fid) resetDraftToPublished(db, accountId, fid)
    const { draft } = applySuggestion(db, { accountId, suggestionId, userId })
    const funnelId = db.prepare('SELECT funnel_id FROM roteiro_versions WHERE id = ?').get(draft.id).funnel_id
    publish(db, accountId, funnelId, userId)
    result = { published: true, funnel_id: funnelId, cadence_ids: pullFromRoteiro(db, accountId, funnelId) }
  })()
  return result
}

export function confirmVariantLive(db, accountId, variantId, { userId = null } = {}) {
  let result
  db.transaction(() => {
    const v = db.prepare('SELECT question_key FROM roteiro_variants WHERE id = ? AND account_id = ?').get(variantId, accountId)
    const fid = v && funnelOfQuestion(db, accountId, v.question_key)
    if (fid) resetDraftToPublished(db, accountId, fid)
    const r = confirmVariant(db, { accountId, variantId, userId })
    const funnelId = r.version ? db.prepare('SELECT funnel_id FROM roteiro_versions WHERE id = ?').get(r.version.id).funnel_id : null
    result = { ...r, cadence_ids: funnelId ? pullFromRoteiro(db, accountId, funnelId) : [] }
  })()
  return result
}

export function getStageView(db, accountId, funnelId) {
  const rot = getRoteiro(db, accountId, funnelId) // 404 se o funil nao e da conta
  const cadStmt = db.prepare('SELECT * FROM cadences WHERE account_id = ? AND stage_id = ? AND is_active = 1')
  const fuStmt = db.prepare('SELECT id, name FROM follow_ups WHERE account_id = ? AND inactivity_stage_id = ? AND is_active = 1 ORDER BY id')
  const stages = rot.stages.map(st => {
    const row = cadStmt.get(accountId, st.id)
    const cadence = row ? withSteps(db, accountId, row) : null
    const steps = cadence ? cadence.attempts.length : 0
    const questions = cadence ? cadence.attempts.filter(a => a.action_type === 'pergunta').length : 0
    return { id: st.id, name: st.name, position: st.position, is_terminal: st.is_terminal, cadence, summary: { steps, questions }, followups: fuStmt.all(accountId, st.id) }
  })
  const pub = rot.published
  return {
    funnel: rot.funnel,
    stages,
    deviations: pub ? pub.deviations : [],
    questions: pub ? pub.questions.map(q => ({ question_key: q.question_key, text: q.text, stage_id: q.stage_id })) : [],
  }
}

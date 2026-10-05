// Repositorio do Roteiro de Qualificacao: rascunho, publicacao, versoes e modelo SPIN (spec 3.1, 7.1, 7.5;
// SPIN por perfil: spec 2026-10-02 §4, §7).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import crypto from 'node:crypto'
import { SPIN_KEYS, missingSpinQuestions } from './spinTemplate.js'
import { conversationStages } from './stageKind.js'

export class RoteiroError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'RoteiroError'
    this.code = code
    this.status = status
  }
}

export function newKey() {
  return crypto.randomBytes(6).toString('hex')
}

function getFunnelForAccount(db, accountId, funnelId) {
  const funnel = db.prepare('SELECT id, name FROM funnels WHERE id = ? AND account_id = ?').get(funnelId, accountId)
  if (!funnel) throw new RoteiroError('not_found', 404, 'Funil não encontrado.')
  return funnel
}

function getStagesForFunnel(db, funnelId) {
  return db.prepare('SELECT id, name, position, is_terminal, is_conversion FROM funnel_stages WHERE funnel_id = ? ORDER BY position ASC')
    .all(funnelId)
    .map(s => ({ ...s, is_terminal: !!s.is_terminal, is_conversion: !!s.is_conversion }))
}

function loadVersionContent(db, versionId) {
  const qRows = db.prepare('SELECT * FROM roteiro_questions WHERE version_id = ? ORDER BY stage_id ASC, position ASC, id ASC').all(versionId)
  const optRows = db.prepare(`
    SELECT o.* FROM roteiro_options o
    JOIN roteiro_questions q ON q.id = o.question_id
    WHERE q.version_id = ?
    ORDER BY o.position ASC, o.id ASC
  `).all(versionId)
  const optionsByQuestion = new Map()
  for (const o of optRows) {
    if (!optionsByQuestion.has(o.question_id)) optionsByQuestion.set(o.question_id, [])
    optionsByQuestion.get(o.question_id).push({ option_key: o.option_key, label: o.label, points: o.points, position: o.position, sets_profile_key: o.sets_profile_key ?? null })
  }
  const questions = qRows.map(q => ({
    question_key: q.question_key,
    stage_id: q.stage_id,
    position: q.position,
    text: q.text,
    kind: q.kind,
    required: !!q.required,
    spin: q.spin ?? null,
    profile_key: q.profile_key ?? null,
    ai_hint: q.ai_hint ?? null,
    options: optionsByQuestion.get(q.id) || [],
  }))
  const devRows = db.prepare('SELECT * FROM roteiro_deviations WHERE version_id = ? ORDER BY position ASC, id ASC').all(versionId)
  const deviations = devRows.map(d => ({
    triggers: d.triggers,
    reply_text: d.reply_text,
    return_question_key: d.return_question_key ?? null,
    position: d.position,
  }))
  return { questions, deviations }
}

function buildVersionObject(row, content) {
  return { id: row.id, version: row.version, status: row.status, published_at: row.published_at, questions: content.questions, deviations: content.deviations }
}

function getVersionObject(db, versionId) {
  const row = db.prepare('SELECT * FROM roteiro_versions WHERE id = ?').get(versionId)
  return buildVersionObject(row, loadVersionContent(db, versionId))
}

function findVersionRow(db, accountId, funnelId, status) {
  return db.prepare('SELECT * FROM roteiro_versions WHERE account_id = ? AND funnel_id = ? AND status = ?').get(accountId, funnelId, status)
}

// Chaves de perfil da conta (roteiro_profiles). SQL proprio: profiles.js importa este arquivo.
function profileKeysOf(db, accountId) {
  return new Set(db.prepare('SELECT profile_key FROM roteiro_profiles WHERE account_id = ?').all(accountId).map(r => r.profile_key))
}

function normalizeQuestion(q, stageMap, profileKeys) {
  const text = typeof q.text === 'string' ? q.text.trim() : ''
  if (!text || text.length > 500) throw new RoteiroError('invalid', 400, 'A pergunta precisa de um texto.')
  if (q.kind !== 'text' && q.kind !== 'options') throw new RoteiroError('invalid', 400, 'Tipo de pergunta inválido.')

  const stage = stageMap.get(q.stage_id)
  if (!stage) throw new RoteiroError('invalid', 400, 'A etapa escolhida não pertence a este funil.')
  if (stage.is_terminal) throw new RoteiroError('invalid', 400, 'Etapas finais (venda/perdido) não têm perguntas.')

  const spin = q.spin ?? null
  if (spin !== null && !SPIN_KEYS.includes(spin)) throw new RoteiroError('invalid', 400, 'Fase SPIN inválida.')
  const profileKey = q.profile_key ?? null
  if (profileKey !== null && !profileKeys.has(profileKey)) throw new RoteiroError('invalid', 400, 'Perfil inválido.')

  let options = []
  if (q.kind === 'options') {
    const raw = Array.isArray(q.options) ? q.options : []
    if (raw.length < 2 || raw.length > 10) throw new RoteiroError('invalid', 400, 'Perguntas de opções precisam de 2 a 10 opções.')
    options = raw.map((o, idx) => {
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      if (!label) throw new RoteiroError('invalid', 400, 'A opção precisa de um texto.')
      const points = Number(o.points)
      if (!Number.isInteger(points) || points < -50 || points > 50) throw new RoteiroError('invalid', 400, 'Os pontos de cada opção vão de -50 a 50.')
      // Opcao que define o perfil: perfil inexistente e descartado (nao trava o salvamento).
      // Pergunta de um perfil so vale para quem ja tem o perfil: nao define perfil.
      const setsProfileKey = !profileKey && o.sets_profile_key && profileKeys.has(o.sets_profile_key) ? o.sets_profile_key : null
      return { option_key: o.option_key || newKey(), label, points, position: Number.isInteger(o.position) ? o.position : idx, sets_profile_key: setsProfileKey }
    })
  }

  return {
    question_key: q.question_key || newKey(),
    stage_id: q.stage_id,
    position: Number.isInteger(q.position) ? q.position : 0,
    text,
    kind: q.kind,
    required: !!q.required,
    spin,
    profile_key: profileKey,
    ai_hint: typeof q.ai_hint === 'string' && q.ai_hint.trim() ? q.ai_hint.trim() : null,
    options,
  }
}

function normalizeDeviation(d, idx) {
  const triggers = typeof d.triggers === 'string' ? d.triggers.trim() : ''
  const reply_text = typeof d.reply_text === 'string' ? d.reply_text.trim() : ''
  if (!triggers || !reply_text) throw new RoteiroError('invalid', 400, 'Desvio precisa das palavras-gatilho e da resposta.')
  return {
    triggers,
    reply_text,
    return_question_key: d.return_question_key || null,
    position: Number.isInteger(d.position) ? d.position : idx,
  }
}

function getOrCreateDraftId(db, accountId, funnelId) {
  const row = findVersionRow(db, accountId, funnelId, 'draft')
  if (row) return row.id
  const info = db.prepare("INSERT INTO roteiro_versions (account_id, funnel_id, version, status) VALUES (?, ?, 0, 'draft')").run(accountId, funnelId)
  return Number(info.lastInsertRowid)
}

function replaceVersionContent(db, versionId, accountId, questions, deviations) {
  db.prepare('DELETE FROM roteiro_questions WHERE version_id = ?').run(versionId) // cascata apaga roteiro_options
  db.prepare('DELETE FROM roteiro_deviations WHERE version_id = ?').run(versionId)
  const insertQuestion = db.prepare(`
    INSERT INTO roteiro_questions (version_id, account_id, question_key, stage_id, position, text, kind, required, spin, profile_key, ai_hint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertOption = db.prepare('INSERT INTO roteiro_options (question_id, option_key, label, points, position, sets_profile_key) VALUES (?, ?, ?, ?, ?, ?)')
  const insertDeviation = db.prepare(`
    INSERT INTO roteiro_deviations (version_id, account_id, triggers, reply_text, return_question_key, position)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  for (const q of questions) {
    const info = insertQuestion.run(versionId, accountId, q.question_key, q.stage_id, q.position, q.text, q.kind, q.required ? 1 : 0, q.spin ?? null, q.profile_key ?? null, q.ai_hint ?? null)
    const questionId = Number(info.lastInsertRowid)
    for (const o of q.options || []) insertOption.run(questionId, o.option_key, o.label, o.points, o.position, o.sets_profile_key ?? null)
  }
  for (const d of deviations) insertDeviation.run(versionId, accountId, d.triggers, d.reply_text, d.return_question_key ?? null, d.position)
}

export function getRoteiro(db, accountId, funnelId) {
  const funnel = getFunnelForAccount(db, accountId, funnelId)
  const stages = getStagesForFunnel(db, funnelId)
  const rows = db.prepare('SELECT * FROM roteiro_versions WHERE account_id = ? AND funnel_id = ? ORDER BY version DESC, id DESC').all(accountId, funnelId)
  const draftRow = rows.find(r => r.status === 'draft') || null
  const publishedRow = rows.find(r => r.status === 'published') || null
  return {
    funnel,
    stages,
    draft: draftRow ? buildVersionObject(draftRow, loadVersionContent(db, draftRow.id)) : null,
    published: publishedRow ? buildVersionObject(publishedRow, loadVersionContent(db, publishedRow.id)) : null,
    versions: rows.map(r => ({ id: r.id, version: r.version, status: r.status, published_at: r.published_at })),
  }
}

export function saveDraft(db, accountId, funnelId, { questions = [], deviations = [] } = {}) {
  getFunnelForAccount(db, accountId, funnelId)
  const stageMap = new Map(getStagesForFunnel(db, funnelId).map(s => [s.id, s]))
  const profileKeys = profileKeysOf(db, accountId)
  const normalizedQuestions = questions.map(q => normalizeQuestion(q, stageMap, profileKeys))
  const normalizedDeviations = deviations.map((d, idx) => normalizeDeviation(d, idx))

  let draftId
  db.transaction(() => {
    draftId = getOrCreateDraftId(db, accountId, funnelId)
    replaceVersionContent(db, draftId, accountId, normalizedQuestions, normalizedDeviations)
  })()

  return getVersionObject(db, draftId)
}

export function publish(db, accountId, funnelId, userId) {
  getFunnelForAccount(db, accountId, funnelId)
  const draftRow = findVersionRow(db, accountId, funnelId, 'draft')
  if (!draftRow) throw new RoteiroError('no_draft', 400, 'Não há rascunho para publicar.')
  const content = loadVersionContent(db, draftRow.id)

  let newVersionId
  db.transaction(() => {
    const maxRow = db.prepare("SELECT MAX(version) as maxVersion FROM roteiro_versions WHERE account_id = ? AND funnel_id = ? AND status IN ('published','archived')").get(accountId, funnelId)
    const nextVersion = (maxRow.maxVersion || 0) + 1
    db.prepare("UPDATE roteiro_versions SET status = 'archived' WHERE account_id = ? AND funnel_id = ? AND status = 'published'").run(accountId, funnelId)
    const info = db.prepare(`
      INSERT INTO roteiro_versions (account_id, funnel_id, version, status, published_at, published_by)
      VALUES (?, ?, ?, 'published', datetime('now'), ?)
    `).run(accountId, funnelId, nextVersion, userId ?? null)
    newVersionId = Number(info.lastInsertRowid)
    replaceVersionContent(db, newVersionId, accountId, content.questions, content.deviations)
    // Pergunta apagada com teste A/B rodando: cancela o teste (spec 6.5). Variantes sao da
    // conta (sem funil): so cancela se a pergunta nao esta em nenhuma versao publicada da conta.
    db.prepare(`
      UPDATE roteiro_variants SET status = 'cancelled', ended_at = datetime('now')
      WHERE account_id = ? AND status = 'testing' AND question_key NOT IN (
        SELECT q.question_key FROM roteiro_questions q
        JOIN roteiro_versions v ON v.id = q.version_id
        WHERE v.account_id = ? AND v.status = 'published'
      )
    `).run(accountId, accountId)
  })()

  return getVersionObject(db, newVersionId)
}

export function restoreVersion(db, accountId, versionId) {
  const versionRow = db.prepare('SELECT * FROM roteiro_versions WHERE id = ? AND account_id = ?').get(versionId, accountId)
  if (!versionRow) throw new RoteiroError('not_found', 404, 'Versão não encontrada.')
  const content = loadVersionContent(db, versionRow.id)
  // Versao antiga pode citar perfil que nao existe mais: vira "Todos" (nao recusa a restauracao).
  const keys = profileKeysOf(db, accountId)
  const questions = content.questions.map(q => ({
    ...q,
    profile_key: q.profile_key && keys.has(q.profile_key) ? q.profile_key : null,
    options: q.options.map(o => ({ ...o, sets_profile_key: o.sets_profile_key && keys.has(o.sets_profile_key) ? o.sets_profile_key : null })),
  }))
  return saveDraft(db, accountId, versionRow.funnel_id, { questions, deviations: content.deviations })
}

// "Comecar com modelo SPIN": soma as fases que o funil ainda nao tem na 1a etapa de conversa.
export function createSpinDraft(db, accountId, funnelId) {
  getFunnelForAccount(db, accountId, funnelId)
  const stages = getStagesForFunnel(db, funnelId)
  const targetStage = conversationStages(stages)[0]

  const draftRow = findVersionRow(db, accountId, funnelId, 'draft')
  const publishedRow = findVersionRow(db, accountId, funnelId, 'published')
  const base = draftRow ? loadVersionContent(db, draftRow.id) : (publishedRow ? loadVersionContent(db, publishedRow.id) : { questions: [], deviations: [] })

  const missing = missingSpinQuestions(base.questions)

  let questions = base.questions
  if (targetStage && missing.length) {
    const inStage = base.questions.filter(q => q.stage_id === targetStage.id)
    let nextPosition = inStage.length ? Math.max(...inStage.map(q => q.position)) + 1 : 0
    const added = missing.map(bq => ({
      question_key: newKey(),
      stage_id: targetStage.id,
      position: nextPosition++,
      text: bq.text,
      kind: bq.kind,
      required: bq.required,
      spin: bq.spin,
      profile_key: null,
      ai_hint: null,
      options: bq.options.map((o, idx) => ({ option_key: newKey(), label: o.label, points: o.points, position: idx })),
    }))
    questions = base.questions.concat(added)
  }

  return saveDraft(db, accountId, funnelId, { questions, deviations: base.deviations })
}

export function getPublishedQuestions(db, accountId, funnelId) {
  getFunnelForAccount(db, accountId, funnelId)
  const row = findVersionRow(db, accountId, funnelId, 'published')
  return row ? loadVersionContent(db, row.id).questions : []
}

export function getPublishedDeviations(db, accountId, funnelId) {
  getFunnelForAccount(db, accountId, funnelId)
  const row = findVersionRow(db, accountId, funnelId, 'published')
  return row ? loadVersionContent(db, row.id).deviations : []
}

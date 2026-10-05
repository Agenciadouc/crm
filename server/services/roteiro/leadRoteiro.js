// Estado do roteiro do lead: proxima pergunta, trava de etapa (gate) e respostas
// (spec 4.1, 4.3, 7.5). Nao importa server/db.js: recebe db.
import { RoteiroError, getPublishedQuestions } from './repo.js'
import { questionTextForLead } from './variants.js'
import { appliesToLead, effectiveProfileKey, setLeadProfile } from './profiles.js'

const MAX_ANSWER_TEXT = 1000

function getLead(db, accountId, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new RoteiroError('not_found', 404, 'Lead não encontrado.')
  return lead
}

export function getFunnelStages(db, funnelId) {
  return db.prepare('SELECT id, name, position, is_terminal, is_conversion FROM funnel_stages WHERE funnel_id = ? ORDER BY position ASC')
    .all(funnelId)
    .map(s => ({ ...s, is_terminal: !!s.is_terminal, is_conversion: !!s.is_conversion }))
}

// getPublishedQuestions lanca not_found se o funil nao existir/pertencer a conta;
// aqui tratamos essa borda como "sem roteiro" em vez de propagar o erro.
export function safeGetPublishedQuestions(db, accountId, funnelId) {
  if (!funnelId) return []
  try {
    return getPublishedQuestions(db, accountId, funnelId)
  } catch (err) {
    if (err instanceof RoteiroError && err.code === 'not_found') return []
    throw err
  }
}

function loadAnswerRow(db, leadId, questionKey) {
  return db.prepare(`
    SELECT la.*, u.name as answered_by_name
    FROM lead_answers la
    LEFT JOIN users u ON u.id = la.answered_by
    WHERE la.lead_id = ? AND la.question_key = ?
  `).get(leadId, questionKey)
}

function formatAnswer(row, question) {
  if (!row) return null
  const option = question ? (question.options || []).find(o => o.option_key === row.option_key) : null
  return {
    option_key: row.option_key ?? null,
    option_label: option ? option.label : null,
    answer_text: row.answer_text ?? null,
    origin: row.origin,
    evidence: row.evidence ?? null,
    answered_by: row.answered_by ?? null,
    answered_by_name: row.answered_by_name ?? null,
    answered_at: row.answered_at,
  }
}

function loadLastAsk(db, leadId, questionKey) {
  const row = db.prepare('SELECT asked_at, replied_at FROM roteiro_asks WHERE lead_id = ? AND question_key = ? ORDER BY asked_at DESC LIMIT 1')
    .get(leadId, questionKey)
  return row ? { asked_at: row.asked_at, replied_at: row.replied_at ?? null } : null
}

function buildQState(db, { accountId, leadId, lead, question }) {
  const { text: textForLead, variant } = questionTextForLead(db, { accountId, leadId, question, leadName: lead.name })
  return {
    question_key: question.question_key,
    text: question.text,
    text_for_lead: textForLead,
    variant,
    kind: question.kind,
    required: question.required,
    spin: question.spin ?? null,
    profile_key: question.profile_key ?? null,
    options: question.options,
    answer: formatAnswer(loadAnswerRow(db, leadId, question.question_key), question),
    last_ask: loadLastAsk(db, leadId, question.question_key),
  }
}

// Estado completo do roteiro do lead: etapas (com terminais, para o front mostrar
// apagadas), progresso da etapa atual, proxima pergunta pendente e respostas orfas
// (perguntas que saíram da versão publicada).
export function getLeadRoteiro(db, { accountId, leadId }) {
  const lead = getLead(db, accountId, leadId)
  const funnelId = lead.funnel_id || null
  const stagesRaw = funnelId ? getFunnelStages(db, funnelId) : []
  const allQuestions = safeGetPublishedQuestions(db, accountId, funnelId)
  const hasRoteiro = allQuestions.length > 0
  // So as perguntas do perfil do lead (sem perfil: so as de "Todos") — spec 2026-10-02 §5.
  const leadProfile = effectiveProfileKey(db, lead)
  const questions = allQuestions.filter(q => appliesToLead(q, leadProfile))

  const questionsByStage = new Map()
  for (const q of questions) {
    if (!questionsByStage.has(q.stage_id)) questionsByStage.set(q.stage_id, [])
    questionsByStage.get(q.stage_id).push(q)
  }

  const stages = stagesRaw.map(stage => {
    const stageQuestions = (questionsByStage.get(stage.id) || []).sort((a, b) => a.position - b.position)
    return {
      id: stage.id,
      name: stage.name,
      position: stage.position,
      is_terminal: stage.is_terminal,
      is_current: stage.id === lead.stage_id,
      questions: stageQuestions.map(q => buildQState(db, { accountId, leadId, lead, question: q })),
    }
  })

  const currentStage = stages.find(s => s.is_current) || null
  const progress = currentStage
    ? { answered: currentStage.questions.filter(q => q.answer).length, total: currentStage.questions.length }
    : { answered: 0, total: 0 }

  let nextQuestionKey = null
  if (currentStage) {
    const pending = currentStage.questions.filter(q => !q.answer)
    const required = pending.filter(q => q.required)
    const optional = pending.filter(q => !q.required)
    const first = required[0] || optional[0]
    nextQuestionKey = first ? first.question_key : null
  }

  // Resposta de pergunta de outro perfil nao e "orfa": a pergunta continua no roteiro.
  const publishedKeys = new Set(allQuestions.map(q => q.question_key))
  const allAnswers = db.prepare('SELECT * FROM lead_answers WHERE lead_id = ? AND account_id = ? ORDER BY answered_at ASC').all(leadId, accountId)
  const legacyAnswers = allAnswers
    .filter(a => !publishedKeys.has(a.question_key))
    .map(a => ({ question_key: a.question_key, answer_text: a.answer_text, answered_at: a.answered_at }))

  return {
    funnel_id: funnelId,
    stage_id: lead.stage_id || null,
    has_roteiro: hasRoteiro,
    stages,
    next_question_key: nextQuestionKey,
    progress,
    legacy_answers: legacyAnswers,
    profile: { key: leadProfile, origin: lead.roteiro_profile_origin ?? null },
  }
}

// Obrigatorias sem resposta nas etapas entre a atual (inclusive) e o destino (exclusive).
// So considera o intervalo quando o destino esta a frente da etapa de origem.
export function pendingRequired(db, { accountId, lead, fromStageId, toStageId }) {
  if (!lead.funnel_id) return []
  const stages = getFunnelStages(db, lead.funnel_id)
  const fromStage = stages.find(s => s.id === fromStageId)
  const toStage = stages.find(s => s.id === toStageId)
  if (!fromStage || !toStage || toStage.position <= fromStage.position) return []

  const stageById = new Map(stages.map(s => [s.id, s]))
  const questions = safeGetPublishedQuestions(db, accountId, lead.funnel_id)
  const leadProfile = effectiveProfileKey(db, lead)
  const inRange = questions.filter(q => {
    if (!q.required || !appliesToLead(q, leadProfile)) return false
    const stage = stageById.get(q.stage_id)
    return stage && stage.position >= fromStage.position && stage.position < toStage.position
  })
  if (!inRange.length) return []

  return inRange
    .filter(q => !loadAnswerRow(db, lead.id, q.question_key))
    .sort((a, b) => {
      const posA = stageById.get(a.stage_id).position
      const posB = stageById.get(b.stage_id).position
      return posA !== posB ? posA - posB : a.position - b.position
    })
    .map(q => ({
      question_key: q.question_key,
      text: q.text,
      stage_id: q.stage_id,
      stage_name: stageById.get(q.stage_id).name,
      kind: q.kind,
      options: q.options,
    }))
}

// Trava de etapa (spec 4.3): livre para etapa final ou para voltar/repetir etapa,
// livre quando nao ha roteiro publicado; senao, obrigatorias pendentes bloqueiam.
export function checkRoteiroGate(db, lead, toStageId) {
  if (!lead.funnel_id || !lead.stage_id) return { ok: true }
  const stages = getFunnelStages(db, lead.funnel_id)
  const toStage = stages.find(s => s.id === toStageId)
  const fromStage = stages.find(s => s.id === lead.stage_id)
  if (!toStage || !fromStage) return { ok: true }
  if (toStage.is_terminal) return { ok: true }
  if (toStage.position <= fromStage.position) return { ok: true }

  const questions = safeGetPublishedQuestions(db, lead.account_id, lead.funnel_id)
  if (!questions.length) return { ok: true }

  const pending = pendingRequired(db, { accountId: lead.account_id, lead, fromStageId: fromStage.id, toStageId: toStage.id })
  return pending.length ? { ok: false, pending } : { ok: true }
}

// Grava (ou ignora) a resposta de uma pergunta do lead (spec 4.1, 4.3, 6.1, 6.4, 8).
export function saveAnswer(db, { accountId, leadId, questionKey, optionKey = null, answerText = null, origin, evidence = null, userId = null }) {
  const lead = getLead(db, accountId, leadId)
  const questions = safeGetPublishedQuestions(db, accountId, lead.funnel_id)
  const question = questions.find(q => q.question_key === questionKey)
  if (!question) throw new RoteiroError('invalid', 400, 'Esta pergunta não está mais no roteiro.')

  let finalOptionKey = null
  let finalAnswerText = null
  let chosenOption = null
  if (question.kind === 'options') {
    const option = (question.options || []).find(o => o.option_key === optionKey)
    if (!option) throw new RoteiroError('invalid', 400, 'Selecione uma opção válida.')
    finalOptionKey = option.option_key
    chosenOption = option
  } else {
    const text = typeof answerText === 'string' ? answerText.trim() : ''
    if (!text) throw new RoteiroError('invalid', 400, 'A resposta precisa de um texto.')
    if (text.length > MAX_ANSWER_TEXT) throw new RoteiroError('invalid', 400, 'A resposta não pode passar de 1000 caracteres.')
    finalAnswerText = text
  }

  const existing = loadAnswerRow(db, leadId, questionKey)
  if (existing && existing.origin === 'manual' && origin === 'ia') {
    return { answer: formatAnswer(existing, question), skipped: true, profile_changed: false }
  }

  db.prepare(`
    INSERT INTO lead_answers (account_id, lead_id, question_key, option_key, answer_text, origin, evidence, answered_by, answered_at, updated_at)
    VALUES (@accountId, @leadId, @questionKey, @optionKey, @answerText, @origin, @evidence, @userId, datetime('now'), datetime('now'))
    ON CONFLICT(lead_id, question_key) DO UPDATE SET
      account_id = excluded.account_id,
      option_key = excluded.option_key,
      answer_text = excluded.answer_text,
      origin = excluded.origin,
      evidence = excluded.evidence,
      answered_by = excluded.answered_by,
      answered_at = datetime('now'),
      updated_at = datetime('now')
  `).run({ accountId, leadId, questionKey, optionKey: finalOptionKey, answerText: finalAnswerText, origin, evidence, userId })

  // Resposta nova DO VENDEDOR libera o avanco automatico que um undo tenha travado.
  // Resposta da IA nao libera: senao a IA desfaria o "Desfazer" do vendedor.
  if (origin === 'manual') db.prepare('UPDATE leads SET roteiro_no_auto_from_stage = NULL WHERE id = ?').run(leadId)

  // Resposta que define o perfil (pergunta de descoberta): grava o perfil. A IA nunca passa por
  // cima de um perfil escolhido a mao; a resposta do vendedor sim (a ultima acao dele vale).
  let profileChanged = false
  if (chosenOption && chosenOption.sets_profile_key && (origin === 'manual' || lead.roteiro_profile_origin !== 'manual')) {
    try {
      profileChanged = setLeadProfile(db, { accountId, leadId, profileKey: chosenOption.sets_profile_key, origin }).changed
    } catch (e) { if (!(e instanceof RoteiroError)) throw e } // perfil apagado: so ignora
  }

  const saved = loadAnswerRow(db, leadId, questionKey)
  return { answer: formatAnswer(saved, question), skipped: false, profile_changed: profileChanged }
}

// Migra a qualificacao antiga (qualification_sequences + lead_qualifications) pro Roteiro
// de Qualificacao (spec 7.4). Nao importa server/db.js: recebe db. Idempotente via
// app_settings (key 'roteiro_legacy_migrated'). Tabelas antigas ficam intactas.
import { saveDraft, publish } from './repo.js'

const MIGRATED_KEY = 'roteiro_legacy_migrated'

function alreadyMigrated(db) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MIGRATED_KEY)
  return !!row && row.value === '1'
}

function markMigrated(db) {
  // app_settings tem updated_at no banco de producao mas nao no helper de teste; so mexe em value.
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, '1')
    ON CONFLICT(key) DO UPDATE SET value = '1'
  `).run(MIGRATED_KEY)
}

function pickDefaultFunnel(db, accountId) {
  return db.prepare('SELECT id FROM funnels WHERE account_id = ? ORDER BY is_default DESC, id ASC LIMIT 1').get(accountId)
}

function pickFirstNonTerminalStage(db, funnelId) {
  return db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? AND is_terminal = 0 ORDER BY position ASC, id ASC LIMIT 1').get(funnelId)
}

function hasPublishedVersion(db, accountId, funnelId) {
  return !!db.prepare("SELECT id FROM roteiro_versions WHERE account_id = ? AND funnel_id = ? AND status = 'published'").get(accountId, funnelId)
}

function migrateAccount(db, accountId) {
  const funnel = pickDefaultFunnel(db, accountId)
  if (!funnel) return null // conta sem funil e pulada

  if (hasPublishedVersion(db, accountId, funnel.id)) return null // roteiro ja publicado: conta nao e tocada

  const stage = pickFirstNonTerminalStage(db, funnel.id)
  if (!stage) return null // sem etapa pra receber as perguntas

  const sequences = db.prepare('SELECT * FROM qualification_sequences WHERE account_id = ? AND is_active = 1 ORDER BY position ASC, id ASC').all(accountId)
  if (!sequences.length) return null

  const questions = sequences.map((seq, idx) => ({
    question_key: `legacy-${seq.id}`,
    stage_id: stage.id,
    position: idx,
    text: seq.question,
    kind: 'text',
    required: false,
    bant: null,
    ai_hint: null,
  }))

  saveDraft(db, accountId, funnel.id, { questions, deviations: [] })
  publish(db, accountId, funnel.id, null)

  const insertAnswer = db.prepare(`
    INSERT OR IGNORE INTO lead_answers (account_id, lead_id, question_key, option_key, answer_text, origin, evidence, answered_by, answered_at, updated_at)
    VALUES (@accountId, @leadId, @questionKey, NULL, @answerText, 'manual', NULL, @answeredBy, COALESCE(@answeredAt, datetime('now')), datetime('now'))
  `)

  const answerRows = db.prepare(`
    SELECT lq.sequence_id, lq.answer, lq.answered_at, lq.answered_by, l.id as lead_id, l.account_id as lead_account_id
    FROM lead_qualifications lq
    JOIN leads l ON l.id = lq.lead_id
    JOIN qualification_sequences qs ON qs.id = lq.sequence_id
    WHERE qs.account_id = ?
  `).all(accountId)

  let answersCount = 0
  for (const row of answerRows) {
    const text = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (!text) continue
    const info = insertAnswer.run({
      accountId: row.lead_account_id,
      leadId: row.lead_id,
      questionKey: `legacy-${row.sequence_id}`,
      answerText: text,
      answeredBy: row.answered_by ?? null,
      answeredAt: row.answered_at ?? null,
    })
    if (info.changes > 0) answersCount += 1
  }

  return { questions: questions.length, answers: answersCount }
}

export function migrateLegacyQualifications(db) {
  if (alreadyMigrated(db)) return { accounts: 0, questions: 0, answers: 0 }

  const accountIds = db.prepare('SELECT DISTINCT account_id FROM qualification_sequences WHERE is_active = 1').all().map(r => r.account_id)

  let accounts = 0
  let questions = 0
  let answers = 0
  for (const accountId of accountIds) {
    const result = migrateAccount(db, accountId)
    if (!result) continue
    accounts += 1
    questions += result.questions
    answers += result.answers
  }

  markMigrated(db)
  return { accounts, questions, answers }
}

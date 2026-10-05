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

// Monta as perguntas do roteiro a partir das sequences legadas, ja validadas pro
// normalizeQuestion do repo.js (que exige texto nao vazio e ate 500 caracteres).
// A rota antiga de criacao nunca aplicou esse limite, entao uma pergunta invalida
// aqui nao pode derrubar a conta inteira: pergunta em branco e pulada (nao entra no
// roteiro, e sua resposta fica orfa e tambem nao migra); pergunta longa demais e
// truncada em 500 caracteres pra continuar utilizavel.
function buildQuestions(sequences, stageId) {
  const questions = []
  let position = 0
  for (const seq of sequences) {
    const raw = typeof seq.question === 'string' ? seq.question.trim() : ''
    if (!raw) continue
    const text = raw.length > 500 ? raw.slice(0, 500) : raw
    questions.push({
      question_key: `legacy-${seq.id}`,
      stage_id: stageId,
      position: position++,
      text,
      kind: 'text',
      required: false,
      spin: null,
      profile_key: null,
      ai_hint: null,
    })
  }
  return questions
}

function migrateAccount(db, accountId) {
  const funnel = pickDefaultFunnel(db, accountId)
  if (!funnel) return null // conta sem funil e pulada

  if (hasPublishedVersion(db, accountId, funnel.id)) return null // roteiro ja publicado: conta nao e tocada

  const stage = pickFirstNonTerminalStage(db, funnel.id)
  if (!stage) return null // sem etapa pra receber as perguntas

  const sequences = db.prepare('SELECT * FROM qualification_sequences WHERE account_id = ? AND is_active = 1 ORDER BY position ASC, id ASC').all(accountId)
  if (!sequences.length) return null

  const questions = buildQuestions(sequences, stage.id)
  const migratedKeys = new Set(questions.map(q => q.question_key))

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
    const questionKey = `legacy-${row.sequence_id}`
    if (!migratedKeys.has(questionKey)) continue // pergunta legada ficou de fora (em branco): resposta fica orfa, nao migra
    const text = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (!text) continue
    const info = insertAnswer.run({
      accountId: row.lead_account_id,
      leadId: row.lead_id,
      questionKey,
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
    // Uma conta com dado legado inesperado (ou qualquer outro erro) nao pode travar
    // o boot nem impedir a migracao das demais contas: isola por conta e segue.
    let result
    try {
      result = migrateAccount(db, accountId)
    } catch (err) {
      console.error(`[Roteiro] migracao legado conta ${accountId}: ${err.message}`)
      continue
    }
    if (!result) continue
    accounts += 1
    questions += result.questions
    answers += result.answers
  }

  // Marca migrado mesmo se alguma conta falhou: as falhas ja ficaram logadas, e sem
  // isso o boot tentaria migrar de novo (e falhar de novo) pra sempre a cada start.
  markMigrated(db)
  return { accounts, questions, answers }
}

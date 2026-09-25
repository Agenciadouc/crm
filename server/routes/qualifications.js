import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { saveAnswer, safeGetPublishedQuestions } from '../services/roteiro/leadRoteiro.js'

const router = Router()

function getLeadForAccount(accountId, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead || lead.account_id !== accountId) return null
  return lead
}

// List qualification sequences
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const sequences = db.prepare('SELECT * FROM qualification_sequences WHERE account_id = ? AND is_active = 1 ORDER BY position').all(req.accountId)
  res.json({ sequences })
})

// Create question
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { question, position } = req.body
  if (!question) return res.status(400).json({ error: 'Pergunta obrigatoria' })

  const maxPos = db.prepare('SELECT MAX(position) as mp FROM qualification_sequences WHERE account_id = ?').get(req.accountId)
  const pos = position !== undefined ? position : (maxPos.mp !== null ? maxPos.mp + 1 : 0)

  const result = db.prepare('INSERT INTO qualification_sequences (account_id, question, position) VALUES (?, ?, ?)').run(req.accountId, question, pos)
  const sequence = db.prepare('SELECT * FROM qualification_sequences WHERE id = ?').get(result.lastInsertRowid)
  res.json({ sequence })
})

// Update question
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const { question, position, is_active } = req.body
  const sets = []; const params = []
  if (question !== undefined) { sets.push('question = ?'); params.push(question) }
  if (position !== undefined) { sets.push('position = ?'); params.push(position) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.id)
  db.prepare(`UPDATE qualification_sequences SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const sequence = db.prepare('SELECT * FROM qualification_sequences WHERE id = ?').get(req.params.id)
  res.json({ sequence })
})

// Delete question
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare('DELETE FROM qualification_sequences WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// Reorder questions
router.put('/reorder/bulk', requireRole('super_admin', 'gerente'), (req, res) => {
  const { items } = req.body
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' })
  const stmt = db.prepare('UPDATE qualification_sequences SET position = ? WHERE id = ?')
  const transaction = db.transaction(() => { items.forEach(item => stmt.run(item.position, item.id)) })
  transaction()
  res.json({ ok: true })
})

// Get lead qualifications (questions + answers) — compat: respostas vem de lead_answers
// (question_key 'legacy-'+sequence_id), a tabela antiga lead_qualifications nao e mais lida aqui.
router.get('/lead/:leadId', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const lead = getLeadForAccount(req.accountId, req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })

  const qualifications = db.prepare(`
    SELECT qs.id as sequence_id, qs.question, qs.position, la.id as answer_id, la.answer_text as answer, la.answered_at, la.answered_by,
      u.name as answered_by_name
    FROM qualification_sequences qs
    LEFT JOIN lead_answers la ON la.question_key = ('legacy-' || qs.id) AND la.lead_id = ?
    LEFT JOIN users u ON u.id = la.answered_by
    WHERE qs.account_id = ? AND qs.is_active = 1
    ORDER BY qs.position
  `).all(req.params.leadId, req.accountId)
  res.json({ qualifications })
})

// Answer a qualification question for a lead — compat: grava em lead_answers. Se a pergunta
// legada ainda estiver no roteiro publicado do funil do lead, usa saveAnswer (mesmo caminho
// do roteiro novo); senao, upsert direto (roteiro nao migrado ou pergunta fora da versao atual).
router.post('/lead/:leadId/answer', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { sequence_id, answer } = req.body
  if (!sequence_id || !answer) return res.status(400).json({ error: 'sequence_id e answer obrigatorios' })

  const lead = getLeadForAccount(req.accountId, req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })

  const questionKey = `legacy-${sequence_id}`
  const publishedQuestions = safeGetPublishedQuestions(db, req.accountId, lead.funnel_id)
  const question = publishedQuestions.find(q => q.question_key === questionKey)

  if (question) {
    saveAnswer(db, {
      accountId: req.accountId, leadId: req.params.leadId, questionKey,
      answerText: answer, origin: 'manual', userId: req.user.id,
    })
  } else {
    db.prepare(`
      INSERT INTO lead_answers (account_id, lead_id, question_key, option_key, answer_text, origin, evidence, answered_by, answered_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, 'manual', NULL, ?, datetime('now'), datetime('now'))
      ON CONFLICT(lead_id, question_key) DO UPDATE SET
        answer_text = excluded.answer_text,
        answered_by = excluded.answered_by,
        answered_at = datetime('now'),
        updated_at = datetime('now')
    `).run(req.accountId, req.params.leadId, questionKey, answer, req.user.id)
  }
  res.json({ ok: true })
})

export default router

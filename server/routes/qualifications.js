import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

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

// Get lead qualifications (questions + answers)
router.get('/lead/:leadId', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const qualifications = db.prepare(`
    SELECT qs.id as sequence_id, qs.question, qs.position, lq.id as answer_id, lq.answer, lq.answered_at, lq.answered_by,
      u.name as answered_by_name
    FROM qualification_sequences qs
    LEFT JOIN lead_qualifications lq ON lq.sequence_id = qs.id AND lq.lead_id = ?
    LEFT JOIN users u ON u.id = lq.answered_by
    WHERE qs.account_id = ? AND qs.is_active = 1
    ORDER BY qs.position
  `).all(req.params.leadId, req.accountId)
  res.json({ qualifications })
})

// Answer a qualification question for a lead
router.post('/lead/:leadId/answer', (req, res) => {
  const { sequence_id, answer } = req.body
  if (!sequence_id || !answer) return res.status(400).json({ error: 'sequence_id e answer obrigatorios' })

  const existing = db.prepare('SELECT id FROM lead_qualifications WHERE lead_id = ? AND sequence_id = ?').get(req.params.leadId, sequence_id)
  if (existing) {
    db.prepare("UPDATE lead_qualifications SET answer = ?, answered_at = datetime('now'), answered_by = ? WHERE id = ?").run(answer, req.user.id, existing.id)
  } else {
    db.prepare("INSERT INTO lead_qualifications (lead_id, sequence_id, answer, answered_at, answered_by) VALUES (?, ?, ?, datetime('now'), ?)").run(
      req.params.leadId, sequence_id, answer, req.user.id
    )
  }
  res.json({ ok: true })
})

export default router

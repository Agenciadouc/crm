import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// List launches with messages
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const launches = db.prepare('SELECT * FROM launches WHERE account_id = ? AND is_active = 1 ORDER BY created_at DESC').all(req.accountId)
  const stmtMsgs = db.prepare('SELECT * FROM launch_messages WHERE launch_id = ? ORDER BY position')
  for (const l of launches) l.messages = stmtMsgs.all(l.id)
  res.json({ launches })
})

// Create launch
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { title, identification, messages } = req.body
  if (!title) return res.status(400).json({ error: 'Titulo obrigatorio' })

  const result = db.prepare('INSERT INTO launches (account_id, title, identification) VALUES (?, ?, ?)').run(req.accountId, title, identification || null)
  const launchId = result.lastInsertRowid

  if (messages && Array.isArray(messages)) {
    const stmt = db.prepare('INSERT INTO launch_messages (launch_id, position, question, answer) VALUES (?, ?, ?, ?)')
    messages.forEach((m, i) => { stmt.run(launchId, i, m.question || '', m.answer || '') })
  }

  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(launchId)
  launch.messages = db.prepare('SELECT * FROM launch_messages WHERE launch_id = ? ORDER BY position').all(launchId)
  res.json({ launch })
})

// Get single launch
router.get('/:id', (req, res) => {
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id)
  if (!launch) return res.status(404).json({ error: 'Lancamento nao encontrado' })
  launch.messages = db.prepare('SELECT * FROM launch_messages WHERE launch_id = ? ORDER BY position').all(launch.id)
  res.json({ launch })
})

// Update launch
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const { title, identification, is_active } = req.body
  const sets = []; const params = []
  if (title !== undefined) { sets.push('title = ?'); params.push(title) }
  if (identification !== undefined) { sets.push('identification = ?'); params.push(identification) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE launches SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id)
  launch.messages = db.prepare('SELECT * FROM launch_messages WHERE launch_id = ? ORDER BY position').all(launch.id)
  res.json({ launch })
})

// Update messages (full replacement)
router.put('/:id/messages', requireRole('super_admin', 'gerente'), (req, res) => {
  const { messages } = req.body
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages array required' })
  const launch = db.prepare('SELECT * FROM launches WHERE id = ?').get(req.params.id)
  if (!launch) return res.status(404).json({ error: 'Lancamento nao encontrado' })

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM launch_messages WHERE launch_id = ?').run(launch.id)
    const stmt = db.prepare('INSERT INTO launch_messages (launch_id, position, question, answer) VALUES (?, ?, ?, ?)')
    messages.forEach((m, i) => { stmt.run(launch.id, i, m.question || '', m.answer || '') })
  })
  transaction()

  db.prepare("UPDATE launches SET updated_at = datetime('now') WHERE id = ?").run(launch.id)
  launch.messages = db.prepare('SELECT * FROM launch_messages WHERE launch_id = ? ORDER BY position').all(launch.id)
  res.json({ launch })
})

// Delete (soft)
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare("UPDATE launches SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

export default router

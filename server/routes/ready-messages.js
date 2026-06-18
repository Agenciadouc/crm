import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// List ready messages
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const messages = db.prepare(`
    SELECT rm.*, fs.name as stage_name, fs.color as stage_color
    FROM ready_messages rm
    LEFT JOIN funnel_stages fs ON fs.id = rm.stage_id
    WHERE rm.account_id = ? AND rm.is_active = 1
    ORDER BY rm.title
  `).all(req.accountId)
  res.json({ messages })
})

// Create
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { title, content, image_url, video_url, stage_id } = req.body
  if (!title || !content) return res.status(400).json({ error: 'Titulo e conteudo obrigatorios' })

  const result = db.prepare('INSERT INTO ready_messages (account_id, title, content, image_url, video_url, stage_id) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.accountId, title, content, image_url || null, video_url || null, stage_id || null
  )
  const message = db.prepare('SELECT * FROM ready_messages WHERE id = ?').get(result.lastInsertRowid)
  res.json({ message })
})

// Update
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const { title, content, image_url, video_url, stage_id, is_active } = req.body
  const sets = []; const params = []
  if (title !== undefined) { sets.push('title = ?'); params.push(title) }
  if (content !== undefined) { sets.push('content = ?'); params.push(content) }
  if (image_url !== undefined) { sets.push('image_url = ?'); params.push(image_url || null) }
  if (video_url !== undefined) { sets.push('video_url = ?'); params.push(video_url || null) }
  if (stage_id !== undefined) { sets.push('stage_id = ?'); params.push(stage_id || null) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE ready_messages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const message = db.prepare('SELECT * FROM ready_messages WHERE id = ?').get(req.params.id)
  res.json({ message })
})

// Delete (soft)
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare("UPDATE ready_messages SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

export default router

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// Lista mapeamentos tag → instância da conta
router.get('/list', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const list = db.prepare(`
    SELECT tim.id, tim.tag_id, t.name as tag_name, t.color as tag_color,
           tim.instance_id, wi.instance_name,
           tim.attendant_id, u.name as attendant_name
    FROM tag_instance_mapping tim
    JOIN tags t ON t.id = tim.tag_id
    JOIN whatsapp_instances wi ON wi.id = tim.instance_id
    LEFT JOIN users u ON u.id = tim.attendant_id
    WHERE tim.account_id = ?
    ORDER BY t.name
  `).all(req.accountId)
  res.json({ mappings: list })
})

// Upsert mapeamento
router.put('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { tag_id, instance_id, attendant_id } = req.body || {}
  if (!tag_id || !instance_id) return res.status(400).json({ error: 'tag_id e instance_id obrigatorios' })

  const tag = db.prepare('SELECT id FROM tags WHERE id = ? AND account_id = ?').get(tag_id, req.accountId)
  if (!tag) return res.status(400).json({ error: 'Tag nao pertence a essa conta' })
  const inst = db.prepare('SELECT id FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instance_id, req.accountId)
  if (!inst) return res.status(400).json({ error: 'Instancia nao pertence a essa conta' })
  if (attendant_id) {
    const user = db.prepare('SELECT id FROM users WHERE id = ? AND (account_id = ? OR account_id IS NULL)').get(attendant_id, req.accountId)
    if (!user) return res.status(400).json({ error: 'Atendente nao pertence a essa conta' })
  }

  const existing = db.prepare('SELECT id FROM tag_instance_mapping WHERE account_id = ? AND tag_id = ?').get(req.accountId, tag_id)
  if (existing) {
    db.prepare('UPDATE tag_instance_mapping SET instance_id = ?, attendant_id = ? WHERE id = ?').run(instance_id, attendant_id || null, existing.id)
  } else {
    db.prepare('INSERT INTO tag_instance_mapping (account_id, tag_id, instance_id, attendant_id) VALUES (?, ?, ?, ?)').run(req.accountId, tag_id, instance_id, attendant_id || null)
  }
  res.json({ ok: true })
})

// Default form instance (fallback)
router.get('/default-form-instance', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const row = db.prepare('SELECT default_form_instance_id FROM accounts WHERE id = ?').get(req.accountId)
  res.json({ instance_id: row?.default_form_instance_id || null })
})

router.put('/default-form-instance', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { instance_id } = req.body || {}
  if (instance_id) {
    const inst = db.prepare('SELECT id FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instance_id, req.accountId)
    if (!inst) return res.status(400).json({ error: 'Instancia nao pertence a essa conta' })
  }
  db.prepare('UPDATE accounts SET default_form_instance_id = ? WHERE id = ?').run(instance_id || null, req.accountId)
  res.json({ ok: true })
})

// Delete mapping (precisa estar por ultimo pra :tagId nao capturar outras coisas)
router.delete('/:tagId', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  db.prepare('DELETE FROM tag_instance_mapping WHERE account_id = ? AND tag_id = ?').run(req.accountId, req.params.tagId)
  res.json({ ok: true })
})

export default router

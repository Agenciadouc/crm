import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// List cadences with attempts
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const cadences = db.prepare('SELECT * FROM cadences WHERE account_id = ? AND is_active = 1 ORDER BY name').all(req.accountId)
  const stmtAttempts = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position')
  for (const c of cadences) c.attempts = stmtAttempts.all(c.id)
  res.json({ cadences })
})

// Create cadence
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, description, attempts } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })

  const result = db.prepare('INSERT INTO cadences (account_id, name, description) VALUES (?, ?, ?)').run(req.accountId, name, description || null)
  const cadenceId = result.lastInsertRowid

  if (attempts && Array.isArray(attempts)) {
    const stmt = db.prepare('INSERT INTO cadence_attempts (cadence_id, position, action_type, description, instructions, delay_days, scheduled_time, auto_message, schedule_mode, delay_minutes, call_script) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    attempts.forEach((a, i) => {
      stmt.run(cadenceId, i, a.action_type || 'mensagem', a.description || null, a.instructions || null, parseInt(a.delay_days) || 0, a.scheduled_time || null, a.auto_message || null, a.schedule_mode === 'duration' ? 'duration' : 'date', parseInt(a.delay_minutes) || 0, a.call_script || null)
    })
  }

  const cadence = db.prepare('SELECT * FROM cadences WHERE id = ?').get(cadenceId)
  cadence.attempts = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(cadenceId)
  res.json({ cadence })
})

// Get single cadence
router.get('/:id', (req, res) => {
  const cadence = db.prepare('SELECT * FROM cadences WHERE id = ?').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Cadencia nao encontrada' })
  cadence.attempts = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(cadence.id)
  res.json({ cadence })
})

// Update cadence
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const { name, description, is_active } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE cadences SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const cadence = db.prepare('SELECT * FROM cadences WHERE id = ?').get(req.params.id)
  cadence.attempts = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(cadence.id)
  res.json({ cadence })
})

// Update attempts (full replacement)
router.put('/:id/attempts', requireRole('super_admin', 'gerente'), (req, res) => {
  const { attempts } = req.body
  if (!attempts || !Array.isArray(attempts)) return res.status(400).json({ error: 'attempts array required' })
  const cadence = db.prepare('SELECT * FROM cadences WHERE id = ?').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Cadencia nao encontrada' })

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM cadence_attempts WHERE cadence_id = ?').run(cadence.id)
    const stmt = db.prepare('INSERT INTO cadence_attempts (cadence_id, position, action_type, description, instructions, delay_days, scheduled_time, auto_message, schedule_mode, delay_minutes, call_script) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    attempts.forEach((a, i) => {
      stmt.run(cadence.id, i, a.action_type || 'mensagem', a.description || null, a.instructions || null, parseInt(a.delay_days) || 0, a.scheduled_time || null, a.auto_message || null, a.schedule_mode === 'duration' ? 'duration' : 'date', parseInt(a.delay_minutes) || 0, a.call_script || null)
    })
  })
  transaction()

  cadence.attempts = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(cadence.id)
  db.prepare("UPDATE cadences SET updated_at = datetime('now') WHERE id = ?").run(cadence.id)
  res.json({ cadence })
})

// Delete cadence (soft)
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare("UPDATE cadences SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

// Assign lead to cadence — atendente can do this for their own leads
router.post('/:id/assign', (req, res) => {
  const { lead_id } = req.body
  if (!lead_id) return res.status(400).json({ error: 'lead_id required' })

  // Atendente: only allowed on leads assigned to them
  if (req.user.role === 'atendente') {
    const lead = db.prepare('SELECT attendant_id FROM leads WHERE id = ?').get(lead_id)
    if (!lead || lead.attendant_id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })
  }

  const cadence = db.prepare('SELECT * FROM cadences WHERE id = ? AND is_active = 1').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Cadencia nao encontrada' })

  // Get first attempt
  const firstAttempt = db.prepare('SELECT id FROM cadence_attempts WHERE cadence_id = ? ORDER BY position LIMIT 1').get(cadence.id)

  // Remove any existing active cadence for this lead
  db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE lead_id = ? AND status = 'active'").run(lead_id)

  const result = db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id) VALUES (?, ?, ?)').run(lead_id, cadence.id, firstAttempt?.id || null)
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(result.lastInsertRowid)
  res.json({ leadCadence: lc })
})

// Advance lead cadence to next attempt
router.put('/lead-cadence/:lcId/advance', (req, res) => {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(req.params.lcId)
  if (!lc) return res.status(404).json({ error: 'Lead cadence nao encontrada' })
  if (lc.status !== 'active') return res.status(400).json({ error: 'Cadencia nao esta ativa' })

  // Find next attempt
  const currentAttempt = lc.current_attempt_id
    ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(lc.current_attempt_id)
    : null
  const currentPos = currentAttempt ? currentAttempt.position : -1
  const nextAttempt = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? AND position > ? ORDER BY position LIMIT 1').get(lc.cadence_id, currentPos)

  if (nextAttempt) {
    db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(nextAttempt.id, lc.id)
  } else {
    db.prepare("UPDATE lead_cadences SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(lc.id)
  }

  const updated = db.prepare(`
    SELECT lc.*, c.name as cadence_name, ca.action_type, ca.description as attempt_description, ca.instructions as attempt_instructions, ca.auto_message as attempt_message, ca.call_script as attempt_script, ca.position as attempt_position, ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    LEFT JOIN cadences c ON c.id = lc.cadence_id
    LEFT JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    WHERE lc.id = ?
  `).get(lc.id)
  res.json({ leadCadence: updated })
})

// Remove cadence from lead (pause/cancel)
router.delete('/lead-cadence/:lcId', (req, res) => {
  db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(req.params.lcId)
  res.json({ ok: true })
})

// Get lead's active cadence
router.get('/lead/:leadId', (req, res) => {
  const lc = db.prepare(`
    SELECT lc.*, c.name as cadence_name, ca.action_type, ca.description as attempt_description, ca.instructions as attempt_instructions, ca.auto_message as attempt_message, ca.call_script as attempt_script, ca.position as attempt_position, ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    LEFT JOIN cadences c ON c.id = lc.cadence_id
    LEFT JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    WHERE lc.lead_id = ? AND lc.status = 'active'
    ORDER BY lc.started_at DESC LIMIT 1
  `).get(req.params.leadId)
  res.json({ leadCadence: lc || null })
})

export default router

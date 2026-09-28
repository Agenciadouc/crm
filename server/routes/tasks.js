import { Router } from 'express'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { createTaskCadenceRouter } from './taskCadenceRouter.js'
import { listCadenceTasks, computeDueDatetime, TASK_STEP_SQL } from '../services/cadence/tasks.js'

const router = Router()

// Tarefas de cadencia: avulsas + passos com data da cadencia da etapa (regra no servico).
function getMyTasks({ accountId, userId, role }) {
  return listCadenceTasks(db, { accountId, userId, role })
}

// Get standalone tasks and compute buckets
function getStandaloneTasks({ accountId, userId, role }) {
  let where = 'st.account_id = ? AND st.status = ?'
  const params = [accountId, 'pending']
  if (role === 'atendente') {
    where += ' AND (st.assigned_to = ? OR st.created_by = ?)'
    params.push(userId, userId)
  }

  const rows = db.prepare(`
    SELECT st.*, l.name as lead_name, l.phone as lead_phone, l.profile_pic_url,
      u.name as assigned_to_name, c.name as created_by_name
    FROM standalone_tasks st
    LEFT JOIN leads l ON l.id = st.lead_id
    LEFT JOIN users u ON u.id = st.assigned_to
    LEFT JOIN users c ON c.id = st.created_by
    WHERE ${where}
    ORDER BY st.due_datetime ASC
  `).all(...params)

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2)
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7)

  return rows.map(r => {
    const due = new Date(r.due_datetime)
    let bucket = 'later'
    if (due < today) bucket = 'overdue'
    else if (due < tomorrow) bucket = 'today'
    else if (due < dayAfterTomorrow) bucket = 'tomorrow'
    else if (due < weekEnd) bucket = 'week'

    return { ...r, bucket, type: 'standalone' }
  })
}

// GET /api/tasks/my — group tasks by bucket (cadence + standalone)
router.get('/my', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const cadenceTasks = getMyTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role }).map(t => ({ ...t, type: 'cadence' }))
  const standaloneTasks = getStandaloneTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role })
  const all = [...cadenceTasks, ...standaloneTasks].sort((a, b) => new Date(a.due_datetime).getTime() - new Date(b.due_datetime).getTime())
  const grouped = { overdue: [], today: [], tomorrow: [], week: [], later: [] }
  for (const t of all) grouped[t.bucket].push(t)
  res.json(grouped)
})

// GET /api/tasks/counts — just numbers for sidebar badge
router.get('/counts', (req, res) => {
  if (!req.accountId) return res.json({ overdue: 0, today: 0, tomorrow: 0 })
  const cadenceTasks = getMyTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role })
  const standaloneTasks = getStandaloneTasks({ accountId: req.accountId, userId: req.user.id, role: req.user.role })
  const all = [...cadenceTasks, ...standaloneTasks]
  const counts = { overdue: 0, today: 0, tomorrow: 0, week: 0, total: all.length }
  for (const t of all) counts[t.bucket] = (counts[t.bucket] || 0) + 1
  res.json(counts)
})

// POST /api/tasks/:lcId/complete e /:lcId/skip: mesma regra do Chat (taskCadenceRouter.js, testado com banco em memoria)
router.use(createTaskCadenceRouter(db, { broadcast: broadcastSSE }))

// ─── Standalone Tasks ─────────────────────────────────────────

// Create standalone task
router.post('/standalone', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { lead_id, title, description, due_mode, due_date, due_time, due_minutes, assigned_to } = req.body
  if (!title) return res.status(400).json({ error: 'title obrigatorio' })

  // Calculate due_datetime
  let due
  const now = new Date()
  if (due_mode === 'duration') {
    due = new Date(now.getTime() + (parseInt(due_minutes) || 10) * 60000)
  } else {
    // date mode
    if (due_date && due_time) {
      due = new Date(`${due_date}T${due_time}:00`)
    } else if (due_date) {
      due = new Date(`${due_date}T00:00:00`)
    } else {
      due = now
    }
  }

  const result = db.prepare(`
    INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(req.accountId, lead_id || null, assigned_to || req.user.id, title, description || null, due.toISOString(), req.user.id)

  broadcastSSE(req.accountId, 'task:updated', { standalone_task_id: result.lastInsertRowid })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(result.lastInsertRowid)
  res.json({ task })
})

// List standalone tasks by lead
router.get('/standalone/by-lead/:leadId', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })

  // Standalone tasks
  const standaloneTasks = db.prepare(`
    SELECT st.*, u.name as assigned_name
    FROM standalone_tasks st
    LEFT JOIN users u ON u.id = st.assigned_to
    WHERE st.lead_id = ? AND st.account_id = ? AND st.status = 'pending'
    ORDER BY st.due_datetime ASC
  `).all(req.params.leadId, req.accountId).map(t => ({ ...t, type: 'standalone' }))

  // Cadence tasks (current_attempt of active cadences for this lead)
  const cadenceTasks = db.prepare(`
    SELECT
      lc.id as lead_cadence_id,
      lc.lead_id,
      lc.cadence_id,
      lc.current_attempt_id,
      lc.last_executed_at,
      lc.started_at,
      c.name as cadence_name,
      ca.position as attempt_position,
      ca.action_type,
      ca.description as attempt_description,
      ca.delay_days,
      ca.scheduled_time,
      ca.schedule_mode,
      ca.delay_minutes,
      ca.auto_message,
      ca.call_script,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN cadences c ON c.id = lc.cadence_id
    JOIN leads l ON l.id = lc.lead_id
    WHERE lc.lead_id = ? AND l.account_id = ? AND lc.status = 'active' AND l.is_active = 1 AND ${TASK_STEP_SQL}
  `).all(req.params.leadId, req.accountId).map(t => {
    const due = computeDueDatetime({
      startedAt: t.started_at,
      lastExecutedAt: t.last_executed_at,
      delay_days: t.delay_days,
      scheduled_time: t.scheduled_time,
      schedule_mode: t.schedule_mode,
      delay_minutes: t.delay_minutes,
    })
    return { ...t, due_datetime: due.toISOString(), type: 'cadence' }
  })

  // Merge and sort by due
  const tasks = [...standaloneTasks, ...cadenceTasks].sort((a, b) =>
    new Date(a.due_datetime).getTime() - new Date(b.due_datetime).getTime()
  )
  res.json({ tasks })
})

// Update standalone task (title, description, due, assigned_to)
router.put('/standalone/:id', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!task) return res.status(404).json({ error: 'Tarefa nao encontrada' })

  const { title, description, due_mode, due_date, due_time, due_minutes, assigned_to } = req.body
  const sets = []
  const params = []
  if (title !== undefined) { sets.push('title = ?'); params.push(title) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (assigned_to !== undefined) { sets.push('assigned_to = ?'); params.push(assigned_to) }

  // Recalcula due_datetime se foi enviado
  if (due_mode || due_date || due_time || due_minutes !== undefined) {
    let due
    const now = new Date()
    if (due_mode === 'duration') {
      due = new Date(now.getTime() + (parseInt(due_minutes) || 10) * 60000)
    } else if (due_date && due_time) {
      due = new Date(`${due_date}T${due_time}:00`)
    } else if (due_date) {
      due = new Date(`${due_date}T00:00:00`)
    }
    if (due) { sets.push('due_datetime = ?'); params.push(due.toISOString()) }
  }

  if (!sets.length) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.id)
  db.prepare(`UPDATE standalone_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  broadcastSSE(req.accountId, 'task:updated', { standalone_task_id: req.params.id })
  const updated = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(req.params.id)
  res.json({ task: updated })
})

// Complete standalone task
router.post('/standalone/:id/complete', (req, res) => {
  db.prepare("UPDATE standalone_tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(req.params.id)
  const task = db.prepare('SELECT account_id FROM standalone_tasks WHERE id = ?').get(req.params.id)
  if (task) broadcastSSE(task.account_id, 'task:updated', { standalone_task_id: req.params.id })
  res.json({ ok: true })
})

// Delete standalone task
router.delete('/standalone/:id', (req, res) => {
  db.prepare('DELETE FROM standalone_tasks WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

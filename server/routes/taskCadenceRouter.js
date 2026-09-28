// Concluir/Pular a tarefa de cadencia (tela de Tarefas): mesma regra do Chat, com conta
// conferida (404) e atendente so em lead que acessa (403). Recebe db (tasks.js injeta).
import { Router } from 'express'
import { completeCurrentStep } from '../services/cadence/leadCadence.js'
import { CadenceError } from '../services/cadence/errors.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'

// Calculate due datetime for a cadence attempt.
// Anchor: last_executed_at (when previous step was completed) OR started_at (for step 1).
// Mode 'duration': anchor + delay_minutes
// Mode 'date': anchor + delay_days at scheduled_time (clock time)
export function computeDueDatetime({ startedAt, lastExecutedAt, delay_days, scheduled_time, schedule_mode, delay_minutes }) {
  const anchorIso = lastExecutedAt || startedAt
  const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')

  if (schedule_mode === 'duration') {
    return new Date(anchor.getTime() + (delay_minutes || 0) * 60000)
  }

  // Date mode (default)
  const due = new Date(anchor)
  due.setDate(due.getDate() + (delay_days || 0))
  if (scheduled_time) {
    const [h, m] = scheduled_time.split(':').map(Number)
    due.setHours(h || 0, m || 0, 0, 0)
  } else if ((delay_days || 0) > 0) {
    due.setHours(0, 0, 0, 0)
  }
  return due
}

export function createTaskCadenceRouter(db, { broadcast = () => {} } = {}) {
  const router = Router()

  function complete(req, how) {
    // Atendente: confere o acesso ao lead antes de qualquer escrita (conta errada -> 404 no servico).
    if (req.user.role === 'atendente') {
      const lead = db.prepare('SELECT l.* FROM lead_cadences lc JOIN leads l ON l.id = lc.lead_id WHERE lc.id = ? AND l.account_id = ?')
        .get(req.params.lcId, req.accountId)
      if (lead && !canAtendenteAccessLead(req.user.id, lead, db)) throw new CadenceError('forbidden', 403, 'Sem permissão.')
    }
    const r = completeCurrentStep(db, { accountId: req.accountId, leadCadenceId: req.params.lcId, how, userId: req.user.id })
    try {
      broadcast(r.lead.account_id, 'task:updated', { lead_cadence_id: Number(req.params.lcId), attendant_id: r.lead.attendant_id })
    } catch (e) { console.error('[Tarefas] SSE:', e.message) }
    return r
  }

  function fail(res, e) {
    if (e instanceof CadenceError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Tarefas] erro:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }

  // POST /api/tasks/:lcId/complete — conclui o passo atual
  router.post('/:lcId/complete', (req, res) => {
    try {
      const r = complete(req, 'feito')
      let nextStep = null
      if (r.nextAttempt) {
        // Anchor for the newly-current step is NOW (we just completed the previous one)
        const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ')
        const n = r.nextAttempt
        const due = computeDueDatetime({ startedAt: nowIso, lastExecutedAt: nowIso, delay_days: n.delay_days, scheduled_time: n.scheduled_time, schedule_mode: n.schedule_mode, delay_minutes: n.delay_minutes })
        nextStep = { position: n.position, action_type: n.action_type, description: n.description, delay_days: n.delay_days, scheduled_time: n.scheduled_time, schedule_mode: n.schedule_mode, delay_minutes: n.delay_minutes, due_datetime: due.toISOString() }
      }
      res.json({ ok: true, completed: r.completed, nextStep })
    } catch (e) { fail(res, e) }
  })

  // POST /api/tasks/:lcId/skip — pula o passo atual
  router.post('/:lcId/skip', (req, res) => {
    try {
      complete(req, 'pulado')
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  return router
}

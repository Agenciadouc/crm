// Concluir/Pular a tarefa de cadencia (tela de Tarefas): mesma regra do Chat, com conta
// conferida (404) e atendente so em lead que acessa (403). Recebe db (tasks.js injeta).
import { Router } from 'express'
import { completeCurrentStep } from '../services/cadence/leadCadence.js'
import { computeDueDatetime } from '../services/cadence/tasks.js'
import { CadenceError } from '../services/cadence/errors.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'

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

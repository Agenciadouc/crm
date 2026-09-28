// Rotas das cadencias (spec 2026-09-27 §5.1, §7): toda operacao por id confere a conta (404),
// atendente so mexe em lead que acessa (403). Nao importa server/db.js (cadences.js injeta).
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { RoteiroError } from '../services/roteiro/repo.js'
import { CadenceError } from '../services/cadence/errors.js'
import {
  listCadences, getCadence, createCadence, updateCadence, deleteCadence, replaceAttemptsById,
  addStep, updateStep, deleteStep, reorderSteps, getStageView, saveDeviations,
  addQuestionSteps, bantStepQuestions, aiStepQuestions, applySuggestionLive, confirmVariantLive,
} from '../services/cadence/repo.js'
import {
  attachLeadsInStage, refreshLeadsOfCadence, getLeadStageCadence, markStepDone,
  assignAvulsa, advanceAvulsa, leadCadenceView,
} from '../services/cadence/leadCadence.js'
import { stepMetrics } from '../services/cadence/metrics.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { pickAnthropicKey } from '../services/anthropicKeyPicker.js'

const MANAGER_ROLES = ['super_admin', 'gerente']
const STEP_CHANGED = 'Esse passo mudou. A tela foi atualizada.'

export function createCadencesRouter(db, { ai = null, broadcast = () => {} } = {}) {
  const router = Router()
  const manager = requireRole(...MANAGER_ROLES)

  function fail(res, e) {
    if (e instanceof CadenceError || e instanceof RoteiroError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Cadencias] erro:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }
  function send(accountId, event, data) {
    try { broadcast(accountId, event, data) } catch (e) { console.error('[Cadencias] SSE:', e.message) }
  }
  function leadScoped(req, leadId) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, req.accountId)
    if (!lead) throw new CadenceError('not_found', 404, 'Lead não encontrado.')
    if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead, db)) throw new CadenceError('forbidden', 403, 'Sem permissão.')
    return lead
  }
  function lcScoped(req, lcId) {
    const lc = db.prepare('SELECT lc.* FROM lead_cadences lc JOIN leads l ON l.id = lc.lead_id WHERE lc.id = ? AND l.account_id = ?').get(lcId, req.accountId)
    if (!lc) throw new CadenceError('not_found', 404, 'Cadência do lead não encontrada.')
    leadScoped(req, lc.lead_id)
    return lc
  }
  function funnelScoped(req, funnelId) {
    if (!db.prepare('SELECT 1 FROM funnels WHERE id = ? AND account_id = ?').get(funnelId, req.accountId)) throw new CadenceError('not_found', 404, 'Funil não encontrado.')
  }
  function stageOfFunnel(req, funnelId, stageId) {
    funnelScoped(req, funnelId)
    if (!db.prepare('SELECT 1 FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(stageId, funnelId)) throw new CadenceError('not_found', 404, 'Etapa não encontrada.')
  }

  // Mudou a cadencia da etapa: as telas abertas recarregam (cadence:updated). So mudanca
  // ESTRUTURAL (passo novo/apagado, ordem, pergunta, criar/ativar) recalcula os leads — o
  // recalculo e por lead, e o salvamento automatico do texto chega a cada 500 ms.
  // `cadence` vem sempre de um servico que ja conferiu a conta (refreshLeadsOfCadence nao confere).
  function afterStageChange(req, cadence, { structural }) {
    if (!cadence || !cadence.stage_id) return
    if (structural && cadence.is_active) {
      try {
        refreshLeadsOfCadence(db, cadence.id)
        attachLeadsInStage(db, { accountId: req.accountId, cadenceId: cadence.id }) // D5
      } catch (e) { console.error('[Cadencias] leads da etapa:', e.message) }
    }
    send(req.accountId, 'cadence:updated', { cadence_id: cadence.id, stage_id: cadence.stage_id })
  }

  router.use((req, res, next) => {
    if (req.user.role === 'super_admin' && !req.accountId) return res.status(400).json({ error: 'Selecione uma conta.' })
    next()
  })

  // ------------------------------------------------ gestor (rotas fixas antes de /:id) ----
  router.get('/stage-view', manager, (req, res) => {
    try {
      if (!req.query.funnel_id) throw new CadenceError('invalid', 400, 'Informe o funil.')
      res.json(getStageView(db, req.accountId, req.query.funnel_id))
    } catch (e) { fail(res, e) }
  })

  router.put('/funnels/:funnelId/deviations', manager, (req, res) => {
    try {
      funnelScoped(req, req.params.funnelId)
      const r = saveDeviations(db, req.accountId, req.params.funnelId, req.body?.deviations, { userId: req.user.id })
      if (r.published) send(req.accountId, 'cadence:updated', { funnel_id: Number(req.params.funnelId) })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.post('/funnels/:funnelId/stages/:stageId/template', manager, async (req, res) => {
    try {
      stageOfFunnel(req, req.params.funnelId, req.params.stageId)
      const mode = req.body?.mode
      let questions
      if (mode === 'bant') {
        questions = bantStepQuestions(db, req.accountId, req.params.funnelId)
        if (!questions.length) throw new CadenceError('invalid', 400, 'As 4 perguntas do modelo BANT já estão no funil.')
      } else if (mode === 'ia') {
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId)
        if (!ai || !pickAnthropicKey(account)) return res.status(503).json({ error: 'A IA não está ligada nesta conta.', code: 'ai_off' })
        questions = await aiStepQuestions(db, req.accountId, { funnelId: req.params.funnelId, stageId: req.params.stageId, ai })
      } else {
        throw new CadenceError('invalid', 400, 'Modelo inválido.')
      }
      const cadence = addQuestionSteps(db, req.accountId, { stageId: req.params.stageId, questions, userId: req.user.id })
      afterStageChange(req, cadence, { structural: true })
      res.json({ cadence: getCadence(db, req.accountId, cadence.id) })
    } catch (e) { fail(res, e) }
  })

  router.post('/suggestions/:id/apply', manager, (req, res) => {
    try {
      const r = applySuggestionLive(db, req.accountId, req.params.id, { userId: req.user.id })
      for (const id of r.cadence_ids) afterStageChange(req, getCadence(db, req.accountId, id), { structural: true })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.post('/variants/:id/confirm', manager, (req, res) => {
    try {
      const r = confirmVariantLive(db, req.accountId, req.params.id, { userId: req.user.id })
      for (const id of r.cadence_ids) afterStageChange(req, getCadence(db, req.accountId, id), { structural: true })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  // -------------------------------------------------------------- vendedor (fixas) ----
  router.get('/lead/:leadId', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      const lc = db.prepare("SELECT id FROM lead_cadences WHERE lead_id = ? AND status = 'active' AND kind = 'avulsa' ORDER BY started_at DESC, id DESC LIMIT 1").get(lead.id)
      res.json({ leadCadence: lc ? leadCadenceView(db, lc.id) : null })
    } catch (e) { fail(res, e) }
  })

  router.get('/lead/:leadId/stage', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      res.json(getLeadStageCadence(db, { accountId: req.accountId, leadId: lead.id, role: req.user.role }))
    } catch (e) { fail(res, e) }
  })

  router.post('/lead/:leadId/steps/:attemptId/done', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      const attemptId = Number(req.params.attemptId)
      const how = req.body?.how === 'pulado' ? 'pulado' : 'feito'
      // Passo de avulsa so conta se e o da vez (senao grava sem avancar e a tela fica errada).
      const lc = db.prepare(`SELECT lc.kind, lc.current_attempt_id FROM lead_cadences lc JOIN cadence_attempts ca ON ca.cadence_id = lc.cadence_id
        WHERE ca.id = ? AND lc.lead_id = ? AND lc.status = 'active' ORDER BY lc.id DESC LIMIT 1`).get(attemptId, lead.id)
      if (lc && lc.kind === 'avulsa' && lc.current_attempt_id !== attemptId) throw new CadenceError('step_changed', 409, STEP_CHANGED)
      markStepDone(db, { accountId: req.accountId, leadId: lead.id, attemptId, how, userId: req.user.id })
      send(req.accountId, 'lead:cadence', { lead_id: lead.id })
      res.json(getLeadStageCadence(db, { accountId: req.accountId, leadId: lead.id, role: req.user.role }))
    } catch (e) { fail(res, e) }
  })

  router.put('/lead-cadence/:lcId/advance', (req, res) => {
    try {
      const lc = lcScoped(req, req.params.lcId)
      if (lc.kind === 'etapa') throw new CadenceError('invalid', 400, 'Use Feito no próximo passo da etapa.')
      if (lc.status !== 'active') throw new CadenceError('invalid', 400, 'Cadência não está ativa.')
      advanceAvulsa(db, lc.id)
      res.json({ leadCadence: leadCadenceView(db, lc.id) })
    } catch (e) { fail(res, e) }
  })

  router.delete('/lead-cadence/:lcId', (req, res) => {
    try {
      const lc = lcScoped(req, req.params.lcId)
      if (lc.kind === 'etapa') throw new CadenceError('invalid', 400, 'A cadência da etapa fecha sozinha quando o lead muda de etapa.')
      db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(lc.id)
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  // ------------------------------------------------------------------ lista e por id ----
  router.get('/', (req, res) => {
    try {
      const kind = req.query.kind === 'avulsa' || req.query.kind === 'etapa' ? req.query.kind : undefined
      res.json({ cadences: listCadences(db, req.accountId, { kind }) })
    } catch (e) { fail(res, e) }
  })

  router.post('/', manager, (req, res) => {
    try {
      const b = req.body || {}
      const cadence = createCadence(db, req.accountId, { name: b.name, description: b.description, stageId: b.stage_id ?? null, attempts: b.attempts || [] })
      afterStageChange(req, cadence, { structural: true })
      res.json({ cadence: getCadence(db, req.accountId, cadence.id) })
    } catch (e) { fail(res, e) }
  })

  router.get('/:id', (req, res) => {
    try { res.json({ cadence: getCadence(db, req.accountId, req.params.id) }) } catch (e) { fail(res, e) }
  })

  router.put('/:id', manager, (req, res) => {
    try {
      const b = req.body || {}
      const cadence = updateCadence(db, req.accountId, req.params.id, { name: b.name, description: b.description, is_active: b.is_active })
      // Ativar e estrutural (D5: pega os leads que ja estao na etapa); nome/descricao nao.
      afterStageChange(req, cadence, { structural: b.is_active !== undefined && !!b.is_active })
      res.json({ cadence: getCadence(db, req.accountId, cadence.id) })
    } catch (e) { fail(res, e) }
  })

  router.delete('/:id', manager, (req, res) => {
    try { res.json(deleteCadence(db, req.accountId, req.params.id)) } catch (e) { fail(res, e) }
  })

  router.put('/:id/attempts', manager, (req, res) => {
    try { res.json({ cadence: replaceAttemptsById(db, req.accountId, req.params.id, req.body?.attempts) }) } catch (e) { fail(res, e) }
  })

  router.post('/:id/steps', manager, (req, res) => {
    try {
      const r = addStep(db, req.accountId, req.params.id, req.body || {}, { userId: req.user.id })
      afterStageChange(req, r.cadence, { structural: true })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.put('/:id/steps/order', manager, (req, res) => {
    try {
      const r = reorderSteps(db, req.accountId, req.params.id, req.body?.attempt_ids, { userId: req.user.id })
      afterStageChange(req, r.cadence, { structural: true })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.patch('/:id/steps/:attemptId', manager, (req, res) => {
    try {
      const patch = req.body || {}
      const r = updateStep(db, req.accountId, req.params.id, Number(req.params.attemptId), patch, { userId: req.user.id })
      // Texto de mensagem/ligacao/visita (descricao, dia...) so avisa a tela; pergunta recalcula.
      const step = r.cadence.attempts.find(a => a.id === r.step_id)
      afterStageChange(req, r.cadence, { structural: !!(step && step.action_type === 'pergunta' && patch.question) })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.delete('/:id/steps/:attemptId', manager, (req, res) => {
    try {
      const r = deleteStep(db, req.accountId, req.params.id, Number(req.params.attemptId), { userId: req.user.id })
      afterStageChange(req, r.cadence, { structural: true })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.get('/:id/metrics', manager, (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 90))
      res.json({ steps: stepMetrics(db, { accountId: req.accountId, cadenceId: req.params.id, days }) })
    } catch (e) { fail(res, e) }
  })

  router.post('/:id/assign', (req, res) => {
    try {
      const leadId = req.body?.lead_id
      if (!leadId) throw new CadenceError('invalid', 400, 'Informe o lead.')
      const lead = leadScoped(req, leadId)
      getCadence(db, req.accountId, req.params.id) // 404 antes de qualquer escrita
      const lc = assignAvulsa(db, { accountId: req.accountId, cadenceId: req.params.id, leadId: lead.id })
      res.json({ leadCadence: lc })
    } catch (e) { fail(res, e) }
  })

  return router
}

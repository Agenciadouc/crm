// Rotas do Roteiro de Qualificacao + Termometro (spec 7.3): gestor (monta, publica,
// aprendizado) e vendedor (responde o lead). Nao importa server/db.js: monta a partir
// do db que recebe, o que permite testar com banco em memoria (server/routes/roteiro.js
// e a casca que injeta o db de producao — ver comentario em agentBriefingsRouter.js).
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { getRoteiro, saveDraft, publish, restoreVersion, createSpinDraft, RoteiroError } from '../services/roteiro/repo.js'
import { getLeadRoteiro, saveAnswer, checkRoteiroGate } from '../services/roteiro/leadRoteiro.js'
import { maybeAutoAdvance, undoAutoAdvance } from '../services/roteiro/autoAdvance.js'
import { recordAsk, markAnswered } from '../services/roteiro/asks.js'
import { activeDeviationForLead } from '../services/roteiro/deviations.js'
import { scheduleScore } from '../services/leadScore/recalc.js'
import { questionMetrics, conversionByBand } from '../services/roteiro/metrics.js'
import { startAbTest, confirmVariant, keepCurrent, applySuggestion, rejectSuggestion, abTestSummary } from '../services/roteiro/learning.js'
import { pickAnthropicKey } from '../services/anthropicKeyPicker.js'
import { buildAiDraft } from '../services/roteiro/aiDraft.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { refreshLeadStageCadence } from '../services/cadence/leadCadence.js'
import { warnMissingCadenceTable } from '../services/cadence/errors.js'
import { getBusiness, saveBusiness, setLeadProfile, leadProfileView } from '../services/roteiro/profiles.js'
import { suggestBusiness } from '../services/roteiro/aiProfiles.js'
import { aiKeyStatus } from '../services/aiKeyStatus.js'

const MANAGER_ROLES = ['super_admin', 'gerente']

export function createRoteiroRouter(db, { ai = null, now = () => new Date(), broadcast = () => {} } = {}) {
  const router = Router()

  function fail(res, e) {
    if (e instanceof RoteiroError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Roteiro] erro:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }

  function getLeadScoped(accountId, leadId) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
    if (!lead) throw new RoteiroError('not_found', 404, 'Lead não encontrado.')
    return lead
  }

  function assertLeadAccess(req, lead) {
    if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead, db)) {
      throw new RoteiroError('forbidden', 403, 'Sem permissão.')
    }
  }

  // super_admin sem ?account_id nao tem conta pra escopar: avisa em vez de devolver
  // vazio em silencio (mesmo defeito que motivou agentBriefingHttp.test.js).
  router.use((req, res, next) => {
    if (req.user.role === 'super_admin' && !req.accountId) {
      return res.status(400).json({ error: 'Selecione uma conta.' })
    }
    next()
  })

  // ---------------------------------------------------------------- gestor ----
  const manager = requireRole(...MANAGER_ROLES)

  router.get('/funnels/:funnelId', manager, (req, res) => {
    try {
      res.json(getRoteiro(db, req.accountId, req.params.funnelId))
    } catch (e) { fail(res, e) }
  })

  router.put('/funnels/:funnelId/draft', manager, (req, res) => {
    try {
      const draft = saveDraft(db, req.accountId, req.params.funnelId, {
        questions: req.body?.questions || [],
        deviations: req.body?.deviations || [],
      })
      res.json(draft)
    } catch (e) { fail(res, e) }
  })

  router.post('/funnels/:funnelId/publish', manager, (req, res) => {
    try {
      res.json(publish(db, req.accountId, req.params.funnelId, req.user.id))
    } catch (e) { fail(res, e) }
  })

  router.post('/versions/:id/restore', manager, (req, res) => {
    try {
      res.json(restoreVersion(db, req.accountId, req.params.id))
    } catch (e) { fail(res, e) }
  })

  router.post('/funnels/:funnelId/spin-template', manager, (req, res) => {
    try {
      res.json(createSpinDraft(db, req.accountId, req.params.funnelId))
    } catch (e) { fail(res, e) }
  })

  // Montar com IA: funil de outra conta -> 404, sem IA/sem chave -> 503, IA falhou -> 502.
  router.post('/funnels/:funnelId/ai-draft', manager, async (req, res) => {
    try {
      getRoteiro(db, req.accountId, req.params.funnelId)
    } catch (e) { return fail(res, e) }
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId)
    const key = pickAnthropicKey(account)
    if (!ai || !key) {
      return res.status(503).json({ error: 'A IA não está ligada nesta conta.' })
    }
    try {
      res.json(await buildAiDraft(db, { accountId: req.accountId, funnelId: req.params.funnelId, ai }))
    } catch (e) { fail(res, e) }
  })

  // Negocio e clientes ideais (spec 2026-10-02 §4, §9): objetivo + ate 6 perfis.
  router.get('/profiles', manager, (req, res) => {
    try {
      res.json(getBusiness(db, req.accountId))
    } catch (e) { fail(res, e) }
  })

  router.put('/profiles', manager, (req, res) => {
    try {
      res.json(saveBusiness(db, req.accountId, { business_objective: req.body?.business_objective ?? null, profiles: req.body?.profiles }))
    } catch (e) { fail(res, e) }
  })

  // Sugerir com IA: so propoe (nao grava). Sem IA/sem chave -> 503, IA falhou -> 502.
  router.post('/profiles/suggest', manager, async (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId)
    if (!ai || !pickAnthropicKey(account)) return res.status(503).json({ error: 'A IA não está ligada nesta conta.', code: 'ai_off' })
    try {
      res.json(await suggestBusiness(db, { accountId: req.accountId, ai }))
    } catch (e) { fail(res, e) }
  })

  // Faixa "Conecte sua chave de IA" (so gestor/admin).
  router.get('/ai-key-status', manager, (req, res) => {
    try {
      res.json(aiKeyStatus(db.prepare('SELECT ai_key_source, anthropic_api_key FROM accounts WHERE id = ?').get(req.accountId)))
    } catch (e) { fail(res, e) }
  })

  router.get('/performance', manager, (req, res) => {
    try {
      const funnelId = req.query.funnel_id
      if (!funnelId) throw new RoteiroError('invalid', 400, 'Informe o funil.')
      const questions = questionMetrics(db, { accountId: req.accountId, funnelId, now: now() })
      const conversion = conversionByBand(db, { accountId: req.accountId, now: now() })
      res.json({ questions, conversion })
    } catch (e) { fail(res, e) }
  })

  // Quadro do Dashboard (spec 2026-09-27 §5.2): nao depende de funil.
  router.get('/conversion-by-band', manager, (req, res) => {
    try {
      res.json(conversionByBand(db, { accountId: req.accountId, now: now() }))
    } catch (e) { fail(res, e) }
  })

  function readSettings(accountId) {
    const row = db.prepare('SELECT roteiro_min_reply_rate, roteiro_reply_window_h, score_alert_minutes FROM accounts WHERE id = ?').get(accountId)
    if (!row) throw new RoteiroError('not_found', 404, 'Conta não encontrada.')
    return { min_reply_rate: row.roteiro_min_reply_rate, reply_window_h: row.roteiro_reply_window_h, alert_minutes: row.score_alert_minutes }
  }

  router.get('/settings', manager, (req, res) => {
    try {
      res.json(readSettings(req.accountId))
    } catch (e) { fail(res, e) }
  })

  router.put('/settings', manager, (req, res) => {
    try {
      const minReplyRate = Number(req.body?.min_reply_rate)
      const replyWindowH = Number(req.body?.reply_window_h)
      const alertMinutes = Number(req.body?.alert_minutes)
      if (!Number.isInteger(minReplyRate) || minReplyRate < 10 || minReplyRate > 100) {
        throw new RoteiroError('invalid', 400, 'A taxa mínima de resposta precisa estar entre 10 e 100.')
      }
      if (!Number.isInteger(replyWindowH) || replyWindowH < 1 || replyWindowH > 168) {
        throw new RoteiroError('invalid', 400, 'A janela de resposta precisa estar entre 1 e 168 horas.')
      }
      if (!Number.isInteger(alertMinutes) || alertMinutes < 5 || alertMinutes > 1440) {
        throw new RoteiroError('invalid', 400, 'O aviso de lead quente precisa estar entre 5 e 1440 minutos.')
      }
      db.prepare('UPDATE accounts SET roteiro_min_reply_rate = ?, roteiro_reply_window_h = ?, score_alert_minutes = ? WHERE id = ?')
        .run(minReplyRate, replyWindowH, alertMinutes, req.accountId)
      res.json(readSettings(req.accountId))
    } catch (e) { fail(res, e) }
  })

  router.get('/suggestions', manager, (req, res) => {
    try {
      const suggestions = db.prepare("SELECT * FROM roteiro_suggestions WHERE account_id = ? AND status = 'new' ORDER BY created_at DESC")
        .all(req.accountId)
        .map(s => ({
          id: s.id,
          funnel_id: s.funnel_id,
          question_key: s.question_key,
          type: s.type,
          payload: JSON.parse(s.payload_json || '{}'),
          evidence: s.evidence_json ? JSON.parse(s.evidence_json) : null,
          status: s.status,
          created_at: s.created_at,
        }))
      const tests = db.prepare("SELECT * FROM roteiro_variants WHERE account_id = ? AND status IN ('testing','won','lost') ORDER BY started_at DESC")
        .all(req.accountId)
        .map(v => ({
          id: v.id, question_key: v.question_key, text: v.text, status: v.status, started_at: v.started_at, ended_at: v.ended_at, suggestion_id: v.suggestion_id,
          ...abTestSummary(db, { accountId: req.accountId, variant: v, now: now() }),
        }))
      res.json({ suggestions, tests })
    } catch (e) { fail(res, e) }
  })

  router.post('/suggestions/:id/test', manager, (req, res) => {
    try {
      const variant = startAbTest(db, { accountId: req.accountId, suggestionId: req.params.id, userId: req.user.id, versionIndex: req.body?.version_index, now: now() })
      res.json({ variant })
    } catch (e) { fail(res, e) }
  })

  router.post('/suggestions/:id/apply', manager, (req, res) => {
    try {
      res.json(applySuggestion(db, { accountId: req.accountId, suggestionId: req.params.id, userId: req.user.id, now: now() }))
    } catch (e) { fail(res, e) }
  })

  router.post('/suggestions/:id/reject', manager, (req, res) => {
    try {
      res.json(rejectSuggestion(db, { accountId: req.accountId, suggestionId: req.params.id, userId: req.user.id, now: now() }))
    } catch (e) { fail(res, e) }
  })

  router.post('/variants/:id/confirm', manager, (req, res) => {
    try {
      res.json(confirmVariant(db, { accountId: req.accountId, variantId: req.params.id, userId: req.user.id, now: now() }))
    } catch (e) { fail(res, e) }
  })

  router.post('/variants/:id/keep', manager, (req, res) => {
    try {
      res.json(keepCurrent(db, { accountId: req.accountId, variantId: req.params.id, userId: req.user.id, now: now() }))
    } catch (e) { fail(res, e) }
  })

  // --------------------------------------------------------------- vendedor ----

  router.get('/leads/:leadId', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const roteiro = getLeadRoteiro(db, { accountId: req.accountId, leadId: lead.id })
      const deviation = activeDeviationForLead(db, { accountId: req.accountId, lead, now: now() })
      res.json({ ...roteiro, deviation, can_force: MANAGER_ROLES.includes(req.user.role) })
    } catch (e) { fail(res, e) }
  })

  router.put('/leads/:leadId/answers/:questionKey', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const saved = saveAnswer(db, {
        accountId: req.accountId,
        leadId: lead.id,
        questionKey: req.params.questionKey,
        optionKey: req.body?.option_key ?? null,
        answerText: req.body?.answer_text ?? null,
        origin: 'manual',
        userId: req.user.id,
      })
      markAnswered(db, { leadId: lead.id, questionKey: req.params.questionKey, now: now() })
      try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { if (!warnMissingCadenceTable(e)) console.error('[Cadencia] proximo passo:', e.message) }
      const advanced = maybeAutoAdvance(db, { accountId: req.accountId, leadId: lead.id, userId: req.user.id })
      scheduleScore(lead.id)
      // Resposta de descoberta mudou o perfil: seletor "Perfil do lead" e cartao recarregam.
      if (saved.profile_changed) { try { broadcast(req.accountId, 'lead:cadence', { lead_id: lead.id }) } catch (e) { console.error('[Roteiro] SSE lead:cadence:', e.message) } }
      const roteiro = getLeadRoteiro(db, { accountId: req.accountId, leadId: lead.id })
      res.json({ roteiro, advanced })
    } catch (e) { fail(res, e) }
  })

  router.post('/leads/:leadId/asks', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const questionKey = req.body?.question_key
      const messageId = req.body?.message_id
      if (!questionKey || !messageId) throw new RoteiroError('invalid', 400, 'Informe a pergunta e a mensagem.')
      // Mesma resolucao de runtime.js (roteiroOnChatSend): acha a pergunta no roteiro do
      // lead pra pegar a variante (A/B) realmente servida, e recusar chave que nao existe.
      const roteiro = getLeadRoteiro(db, { accountId: req.accountId, leadId: lead.id })
      const question = roteiro.stages.flatMap(s => s.questions).find(q => q.question_key === questionKey)
      if (!question) throw new RoteiroError('invalid', 400, 'Esta pergunta não está no roteiro deste lead.')
      const message = db.prepare('SELECT * FROM messages WHERE id = ? AND lead_id = ?').get(messageId, lead.id)
      if (!message) throw new RoteiroError('not_found', 404, 'Mensagem não encontrada.')
      const askId = recordAsk(db, {
        accountId: req.accountId,
        leadId: lead.id,
        questionKey,
        variant: question.variant,
        textSent: message.content,
        messageId: message.id,
        userId: req.user.id,
        source: 'recognized',
      })
      res.status(201).json({ ask_id: askId })
    } catch (e) { fail(res, e) }
  })

  // Perfil do lead (spec 2026-10-02 §6): escolha do vendedor vale mais que a da IA.
  router.get('/leads/:leadId/roteiro-profile', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      res.json(leadProfileView(db, { accountId: req.accountId, lead }))
    } catch (e) { fail(res, e) }
  })

  router.put('/leads/:leadId/roteiro-profile', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const r = setLeadProfile(db, { accountId: req.accountId, leadId: lead.id, profileKey: req.body?.profile_key ?? null, origin: 'manual' })
      if (r.changed) {
        // Perguntas do lead mudaram: proximo passo da cadencia e nota (Perfil) recalculam.
        try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { if (!warnMissingCadenceTable(e)) console.error('[Cadencia] proximo passo:', e.message) }
        scheduleScore(lead.id)
        try { broadcast(req.accountId, 'lead:cadence', { lead_id: lead.id }) } catch (e) { console.error('[Roteiro] SSE lead:cadence:', e.message) }
      }
      res.json(leadProfileView(db, { accountId: req.accountId, lead: getLeadScoped(req.accountId, lead.id) }))
    } catch (e) { fail(res, e) }
  })

  router.post('/leads/:leadId/undo-advance', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const result = undoAutoAdvance(db, { accountId: req.accountId, leadId: lead.id, userId: req.user.id })
      const roteiro = getLeadRoteiro(db, { accountId: req.accountId, leadId: lead.id })
      res.json({ roteiro, result })
    } catch (e) { fail(res, e) }
  })

  router.get('/leads/:leadId/gate', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId)
      assertLeadAccess(req, lead)
      const toStageId = Number(req.query.to_stage_id)
      if (!Number.isInteger(toStageId)) throw new RoteiroError('invalid', 400, 'Informe a etapa de destino.')
      res.json(checkRoteiroGate(db, lead, toStageId))
    } catch (e) { fail(res, e) }
  })

  return router
}

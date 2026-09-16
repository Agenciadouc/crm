// API do Copiloto: sugestao pendente, resolver sugestao, pausar/retomar IA na conversa.
import { Router } from 'express'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { getPendingSuggestion, resolveSuggestion } from '../services/aiSuggestions.js'
import { pauseAiForLead, resumeAiForLead } from '../services/leadAiPause.js'
import { cancelAiTimerForLead } from '../services/copilotScheduler.js'

const router = Router()

// Mesmo criterio das rotas de leads: conta do usuario (exceto super_admin) + acesso do atendente
function loadAccessibleLead(req, res, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead) { res.status(404).json({ error: 'Lead nao encontrado' }); return null }
  if (req.user.role !== 'super_admin' && lead.account_id !== req.user.account_id) {
    res.status(403).json({ error: 'Sem permissao' }); return null
  }
  if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead)) {
    res.status(403).json({ error: 'Sem permissao' }); return null
  }
  return lead
}

router.get('/leads/:leadId/suggestion', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  res.json({ suggestion: getPendingSuggestion(db, lead.account_id, lead.id) })
})

router.post('/suggestions/:id/resolve', (req, res) => {
  const row = db.prepare('SELECT id, lead_id FROM ai_suggestions WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const lead = loadAccessibleLead(req, res, row.lead_id)
  if (!lead) return
  const { action, final_content } = req.body || {}
  const r = resolveSuggestion(db, { accountId: lead.account_id, suggestionId: row.id, action, finalContent: final_content, userId: req.user.id })
  if (!r.ok) {
    const status = r.error === 'not_found' ? 404 : r.error === 'not_pending' ? 409 : 400
    return res.status(status).json({ error: r.error })
  }
  res.json({ suggestion: r.suggestion })
})

router.post('/leads/:leadId/pause', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  const aiPausedAt = pauseAiForLead(db, { accountId: lead.account_id, leadId: lead.id, userId: req.user.id })
  cancelAiTimerForLead(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  try { broadcastSSE(lead.account_id, 'lead:ai_suggestion', { lead_id: lead.id }) } catch {}
  console.log(`[Copilot] IA pausada lead=${lead.id} por user=${req.user.id}`)
  res.json({ lead_id: lead.id, ai_paused_at: aiPausedAt })
})

router.post('/leads/:leadId/resume', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  resumeAiForLead(db, { accountId: lead.account_id, leadId: lead.id })
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  console.log(`[Copilot] IA retomada lead=${lead.id} por user=${req.user.id}`)
  res.json({ lead_id: lead.id, ai_paused_at: null })
})

export default router

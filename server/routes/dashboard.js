import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { analyzeConversationsBatch } from '../services/conversationAnalyzer.js'
import { aggregateAllAccounts } from '../services/attendantMetrics.js'

const router = Router()

// Main dashboard stats
router.get('/stats', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { days = '7' } = req.query
  const d = parseInt(days)
  const since = new Date()
  since.setDate(since.getDate() - d)
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ')

  const prevSince = new Date(since)
  prevSince.setDate(prevSince.getDate() - d)
  const prevSinceStr = prevSince.toISOString().slice(0, 19).replace('T', ' ')

  // Total leads in period
  const totalLeads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND created_at >= ?').get(req.accountId, sinceStr).c
  const prevTotalLeads = db.prepare('SELECT COUNT(*) as c FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND created_at >= ? AND created_at < ?').get(req.accountId, prevSinceStr, sinceStr).c

  // Leads today
  const leadsToday = db.prepare("SELECT COUNT(*) as c FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND date(created_at) = date('now')").get(req.accountId).c

  // Conversion rate (all active leads, not just period — a lead created months ago can convert today)
  const convData = db.prepare(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN fs.is_conversion = 1 THEN 1 ELSE 0 END) as converted
    FROM leads l JOIN funnel_stages fs ON l.stage_id = fs.id
    WHERE l.account_id = ? AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0
  `).get(req.accountId)
  const conversionRate = convData.total > 0 ? (convData.converted / convData.total) * 100 : 0

  // Unassigned leads
  const unassigned = db.prepare('SELECT COUNT(*) as c FROM leads WHERE account_id = ? AND attendant_id IS NULL AND is_active = 1 AND is_archived = 0 AND is_blocked = 0').get(req.accountId).c

  // Leads per stage (for funnel chart)
  const byStage = db.prepare(`
    SELECT fs.id, fs.name, fs.color, fs.position, fs.is_conversion, COUNT(l.id) as count
    FROM funnel_stages fs
    JOIN funnels f ON fs.funnel_id = f.id
    LEFT JOIN leads l ON l.stage_id = fs.id AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0
    WHERE f.account_id = ? AND f.is_default = 1
    GROUP BY fs.id ORDER BY fs.position
  `).all(req.accountId)

  // Leads per source
  const bySource = db.prepare(`
    SELECT COALESCE(source, 'manual') as source, COUNT(*) as count
    FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND created_at >= ?
    GROUP BY source ORDER BY count DESC
  `).all(req.accountId, sinceStr)

  // Daily leads
  const daily = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count
    FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND created_at >= ?
    GROUP BY date(created_at) ORDER BY date
  `).all(req.accountId, sinceStr)

  res.json({
    totalLeads, prevTotalLeads, leadsToday, conversionRate, unassigned,
    byStage, bySource, daily,
  })
})

// Agent performance stats
router.get('/agents', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { days = '7' } = req.query
  const d = parseInt(days)
  const since = new Date()
  since.setDate(since.getDate() - d)
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ')

  const agents = db.prepare(`
    SELECT u.id, u.name, u.is_active,
      (SELECT COUNT(*) FROM leads WHERE attendant_id = u.id AND is_archived = 0 AND is_blocked = 0 AND created_at >= ?) as leads_period,
      (SELECT COUNT(*) FROM leads WHERE attendant_id = u.id AND is_active = 1 AND is_archived = 0 AND is_blocked = 0) as leads_total,
      (SELECT COUNT(*) FROM leads l JOIN funnel_stages fs ON l.stage_id = fs.id WHERE l.attendant_id = u.id AND fs.is_conversion = 1 AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0) as conversions
    FROM users u WHERE u.account_id = ? AND u.role IN ('atendente', 'gerente')
    ORDER BY leads_total DESC
  `).all(sinceStr, req.accountId)

  res.json({ agents })
})

// Daily leads for chart
router.get('/daily', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { days = '30' } = req.query
  const since = new Date()
  since.setDate(since.getDate() - parseInt(days))
  const sinceStr = since.toISOString().slice(0, 19).replace('T', ' ')

  const daily = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count, source
    FROM leads WHERE account_id = ? AND is_archived = 0 AND is_blocked = 0 AND created_at >= ?
    GROUP BY date(created_at), source ORDER BY date
  `).all(req.accountId, sinceStr)

  res.json({ daily })
})

// Global stats (super_admin cross-account)
router.get('/global', requireRole('super_admin'), (req, res) => {
  const accounts = db.prepare(`
    SELECT a.id, a.name, a.slug,
      (SELECT COUNT(*) FROM leads WHERE account_id = a.id AND is_archived = 0 AND is_blocked = 0) as total_leads,
      (SELECT COUNT(*) FROM leads WHERE account_id = a.id AND is_archived = 0 AND is_blocked = 0 AND date(created_at) = date('now')) as leads_today,
      (SELECT COUNT(*) FROM users WHERE account_id = a.id AND role = 'atendente') as attendants
    FROM accounts a WHERE a.is_active = 1 ORDER BY total_leads DESC
  `).all()
  const totalLeads = accounts.reduce((s, a) => s + a.total_leads, 0)
  const leadsToday = accounts.reduce((s, a) => s + a.leads_today, 0)
  res.json({ accounts, totalLeads, leadsToday })
})

// Uso de IA cross-conta (super_admin only) — total + breakdown por conta e por agente.
// Periodo padrao: mes corrente. Aceita ?days=N pra trocar a janela.
router.get('/ai-usage', requireRole('super_admin'), (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 0))
  // Se days=0 (default), usa mes corrente
  const since = days > 0
    ? `datetime('now', '-' || ${days} || ' days')`
    : `date('now', 'start of month') || ' 00:00:00'`

  const total = db.prepare(`
    SELECT
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as total_tokens,
      COALESCE(SUM(cost_usd), 0) as haiku_cost_usd,
      COALESCE(SUM(stt_seconds), 0) as stt_seconds,
      COALESCE(SUM(stt_cost_usd), 0) as stt_cost_usd,
      COALESCE(SUM(CASE WHEN stt_seconds > 0 THEN 1 ELSE 0 END), 0) as audio_count,
      COUNT(*) as message_count
    FROM ai_agent_token_log
    WHERE created_at >= ${since}
  `).get()
  total.total_cost_usd = (total.haiku_cost_usd || 0) + (total.stt_cost_usd || 0)

  const byAccount = db.prepare(`
    SELECT a.id, a.name,
      COALESCE(SUM(tl.input_tokens + tl.output_tokens + tl.cache_read_tokens + tl.cache_creation_tokens), 0) as total_tokens,
      COALESCE(SUM(tl.cost_usd), 0) as haiku_cost_usd,
      COALESCE(SUM(tl.stt_seconds), 0) as stt_seconds,
      COALESCE(SUM(tl.stt_cost_usd), 0) as stt_cost_usd,
      COALESCE(SUM(CASE WHEN tl.stt_seconds > 0 THEN 1 ELSE 0 END), 0) as audio_count,
      COUNT(tl.id) as message_count
    FROM accounts a
    LEFT JOIN ai_agent_token_log tl ON tl.account_id = a.id AND tl.created_at >= ${since}
    WHERE a.is_active = 1
    GROUP BY a.id
    HAVING message_count > 0
    ORDER BY (haiku_cost_usd + stt_cost_usd) DESC
  `).all()
  byAccount.forEach(r => { r.total_cost_usd = (r.haiku_cost_usd || 0) + (r.stt_cost_usd || 0) })

  const byAgent = db.prepare(`
    SELECT ag.id, ag.name as agent_name, a.name as account_name,
      COALESCE(SUM(tl.input_tokens + tl.output_tokens + tl.cache_read_tokens + tl.cache_creation_tokens), 0) as total_tokens,
      COALESCE(SUM(tl.cost_usd), 0) as haiku_cost_usd,
      COALESCE(SUM(tl.stt_seconds), 0) as stt_seconds,
      COALESCE(SUM(tl.stt_cost_usd), 0) as stt_cost_usd,
      COALESCE(SUM(CASE WHEN tl.stt_seconds > 0 THEN 1 ELSE 0 END), 0) as audio_count,
      COUNT(tl.id) as message_count
    FROM ai_agents ag
    JOIN accounts a ON a.id = ag.account_id
    LEFT JOIN ai_agent_token_log tl ON tl.agent_id = ag.id AND tl.created_at >= ${since}
    GROUP BY ag.id
    HAVING message_count > 0
    ORDER BY (haiku_cost_usd + stt_cost_usd) DESC
  `).all()
  byAgent.forEach(r => { r.total_cost_usd = (r.haiku_cost_usd || 0) + (r.stt_cost_usd || 0) })

  res.json({
    period: days > 0 ? `${days} dias` : 'mes corrente',
    total,
    byAccount,
    byAgent,
  })
})

// ─── Dashboard de Análise de Atendimentos (super_admin + gerente) ───

// Lista atendentes da conta com métricas agregadas dos últimos N dias
router.get('/attendants', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30))
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  // Agrega métricas dos últimos N dias por user
  const rows = db.prepare(`
    SELECT
      u.id as user_id, u.name as user_name, u.role,
      COALESCE(SUM(amd.leads_assigned), 0) as leads_assigned,
      COALESCE(SUM(amd.leads_responded), 0) as leads_responded,
      COALESCE(SUM(amd.leads_converted), 0) as leads_converted,
      AVG(NULLIF(amd.ttfr_avg_seconds, 0)) as ttfr_avg_seconds,
      AVG(NULLIF(amd.tmr_avg_seconds, 0)) as tmr_avg_seconds,
      COALESCE(SUM(amd.leads_under_5min), 0) as leads_under_5min,
      COALESCE(SUM(amd.leads_under_30min), 0) as leads_under_30min,
      COALESCE(SUM(amd.leads_under_1h), 0) as leads_under_1h,
      MAX(amd.open_conversations) as open_conversations,
      MAX(amd.abandoned_leads) as abandoned_leads,
      (
        SELECT AVG(ci.attendant_score)
        FROM conversation_insights ci
        WHERE ci.attendant_user_id = u.id AND ci.account_id = u.account_id
          AND ci.analyzed_at >= ?
      ) as ai_score_avg,
      (
        SELECT COUNT(*) FROM conversation_insights ci
        WHERE ci.attendant_user_id = u.id AND ci.account_id = u.account_id
          AND ci.analyzed_at >= ? AND ci.lost_sale_signals IS NOT NULL
      ) as lost_sales_detected,
      (
        SELECT SUM(json_array_length(COALESCE(ci.attendant_errors, '[]')))
        FROM conversation_insights ci
        WHERE ci.attendant_user_id = u.id AND ci.account_id = u.account_id
          AND ci.analyzed_at >= ?
      ) as ai_errors_total
    FROM users u
    LEFT JOIN attendant_metrics_daily amd ON amd.user_id = u.id AND amd.date >= ?
    WHERE u.account_id = ? AND u.role IN ('atendente', 'gerente') AND u.is_active = 1
      AND COALESCE(u.is_bot, 0) = 0
    GROUP BY u.id
    ORDER BY ai_score_avg DESC NULLS LAST, leads_responded DESC
  `).all(sinceDate, sinceDate, sinceDate, sinceDate, req.accountId)

  res.json({ days, attendants: rows })
})

// Detalhe de um atendente específico
router.get('/attendants/:userId', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const userId = parseInt(req.params.userId)
  const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30))
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ? AND account_id = ?').get(userId, req.accountId)
  if (!user) return res.status(404).json({ error: 'Atendente nao encontrado' })

  const daily = db.prepare(`
    SELECT date, leads_assigned, leads_responded, leads_converted,
           ttfr_avg_seconds, tmr_avg_seconds,
           leads_under_5min, leads_under_30min, leads_under_1h,
           open_conversations, abandoned_leads
    FROM attendant_metrics_daily
    WHERE user_id = ? AND account_id = ? AND date >= ?
    ORDER BY date DESC
  `).all(userId, req.accountId, sinceDate)

  const recentInsights = db.prepare(`
    SELECT ci.lead_id, l.name as lead_name, ci.summary, ci.lead_intent,
           ci.attendant_score, ci.last_message_quality, ci.lost_sale_signals,
           ci.suggested_next_step, ci.analyzed_at
    FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    WHERE ci.attendant_user_id = ? AND ci.account_id = ?
      AND ci.analyzed_at >= ?
    ORDER BY ci.analyzed_at DESC
    LIMIT 20
  `).all(userId, req.accountId, sinceDate)

  // Top errors deste atendente (agrega via JSON)
  const allErrorsRows = db.prepare(`
    SELECT attendant_errors FROM conversation_insights
    WHERE attendant_user_id = ? AND account_id = ? AND analyzed_at >= ?
      AND attendant_errors IS NOT NULL
  `).all(userId, req.accountId, sinceDate)
  const errorCount = {}
  for (const r of allErrorsRows) {
    try {
      const arr = JSON.parse(r.attendant_errors || '[]')
      for (const e of arr) errorCount[e] = (errorCount[e] || 0) + 1
    } catch {}
  }
  const topErrors = Object.entries(errorCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([error, count]) => ({ error, count }))

  res.json({ user, days, daily, recent_insights: recentInsights, top_errors: topErrors })
})

// Lista insights de conversas com filtros
router.get('/conversation-insights', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30))
  const sinceDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const filter = req.query.filter || '' // 'lost_sales' | 'low_score' | 'errors' | ''
  const attendantId = req.query.attendant_id ? parseInt(req.query.attendant_id) : null
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50))

  let where = 'ci.account_id = ? AND ci.analyzed_at >= ?'
  const params = [req.accountId, sinceDate]
  if (attendantId) { where += ' AND ci.attendant_user_id = ?'; params.push(attendantId) }
  if (filter === 'lost_sales') where += " AND ci.lost_sale_signals IS NOT NULL AND ci.lost_sale_signals != ''"
  if (filter === 'low_score') where += ' AND ci.attendant_score <= 5'
  if (filter === 'errors') where += " AND ci.attendant_errors IS NOT NULL AND ci.attendant_errors != '[]'"

  const rows = db.prepare(`
    SELECT ci.*, l.name as lead_name, l.phone as lead_phone,
           u.name as attendant_name
    FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    LEFT JOIN users u ON u.id = ci.attendant_user_id
    WHERE ${where}
    ORDER BY ci.analyzed_at DESC
    LIMIT ?
  `).all(...params, limit)

  // Parse JSON dos erros
  const parsed = rows.map(r => ({ ...r, attendant_errors: (() => { try { return JSON.parse(r.attendant_errors || '[]') } catch { return [] } })() }))
  res.json({ insights: parsed })
})

// Insight de um lead específico
router.get('/conversation-insights/lead/:leadId', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const leadId = parseInt(req.params.leadId)
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.user.role !== 'super_admin' && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem permissao' })

  const ci = db.prepare(`
    SELECT ci.*, u.name as attendant_name
    FROM conversation_insights ci
    LEFT JOIN users u ON u.id = ci.attendant_user_id
    WHERE ci.lead_id = ?
  `).get(leadId)
  if (!ci) return res.json({ insight: null })

  try { ci.attendant_errors = JSON.parse(ci.attendant_errors || '[]') } catch { ci.attendant_errors = [] }
  res.json({ insight: ci })
})

// Força análise on-demand (rate limited 1x/30min por conta)
router.post('/analyze-now', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const acc = db.prepare('SELECT last_analysis_at FROM accounts WHERE id = ?').get(req.accountId)
  if (acc?.last_analysis_at) {
    const sinceMs = Date.now() - new Date(acc.last_analysis_at.replace(' ', 'T') + 'Z').getTime()
    if (sinceMs < 30 * 60 * 1000) {
      const retryMin = Math.ceil((30 * 60 * 1000 - sinceMs) / 60000)
      return res.status(429).json({ error: 'Aguarde antes de re-analisar', retry_after_min: retryMin })
    }
  }
  db.prepare("UPDATE accounts SET last_analysis_at = datetime('now') WHERE id = ?").run(req.accountId)
  setImmediate(() => {
    analyzeConversationsBatch(req.accountId, { maxLeads: 50, sinceHours: 168 }) // ultimo 7d on-demand
      .catch(e => console.error('[Analyze-now]', e.message))
    // Tambem agrega metricas do dia atual on-demand
    const today = new Date().toISOString().slice(0, 10)
    try { aggregateAllAccounts(today) } catch (e) { console.error('[Aggregate-now]', e.message) }
  })
  res.json({ ok: true, message: 'Analise iniciada em background. Aguarde ~2min e atualize a pagina.' })
})

// Configura limite mensal de tokens de análise da conta
router.put('/analysis-limit', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const limit = Math.max(0, Math.min(10000000, parseInt(req.body.limit) || 0))
  db.prepare("UPDATE accounts SET analysis_token_limit = ?, updated_at = datetime('now') WHERE id = ?").run(limit, req.accountId)
  res.json({ ok: true, analysis_token_limit: limit })
})

export default router

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { analyzeConversationsBatch, getAnalyzeEstimate } from '../services/conversationAnalyzer.js'
import { aggregateAllAccounts } from '../services/attendantMetrics.js'
import { generateCoachingForUser, isoMonday } from '../services/coachingAnalyzer.js'

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
// Helper: checa se conta tem feature ativada. Super_admin SEMPRE pode acessar (mesmo desativada — uso de auditoria).
// Gerente bloqueado com 403 se conta não tem flag = 1.
function requireAnalyticsEnabled(req, res, next) {
  if (req.user.role === 'super_admin') return next()
  const acc = db.prepare('SELECT attendant_analytics_enabled FROM accounts WHERE id = ?').get(req.accountId)
  if (!acc?.attendant_analytics_enabled) {
    return res.status(403).json({ error: 'Análise de atendimentos não está habilitada nesta conta' })
  }
  next()
}

// Lista atendentes da conta com métricas agregadas dos últimos N dias
router.get('/attendants', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
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
router.get('/attendants/:userId', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
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
router.get('/conversation-insights', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
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
router.post('/analyze-now', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  // ?max=N: quantos leads processar nesse clique (default 50, cap 500 pra evitar abuso)
  const maxLeads = Math.max(1, Math.min(500, parseInt(req.query.max) || 50))
  // ?reset_all=true (super_admin only): zera checkpoint incremental da conta inteira -> proximo batch trata tudo como FULL
  // ?reset_lead=<id> (gerente+): mesma coisa pra 1 lead (debug cirurgico)
  const resetAll = String(req.query.reset_all || '').toLowerCase() === 'true'
  const resetLeadId = req.query.reset_lead ? Math.max(1, parseInt(req.query.reset_lead)) : null
  if (resetAll && req.user?.role !== 'super_admin') {
    return res.status(403).json({ error: 'reset_all requer super_admin' })
  }

  const acc = db.prepare('SELECT last_analysis_at FROM accounts WHERE id = ?').get(req.accountId)
  if (acc?.last_analysis_at) {
    const sinceMs = Date.now() - new Date(acc.last_analysis_at.replace(' ', 'T') + 'Z').getTime()
    if (sinceMs < 30 * 60 * 1000) {
      const retryMin = Math.ceil((30 * 60 * 1000 - sinceMs) / 60000)
      return res.status(429).json({ error: 'Aguarde antes de re-analisar', retry_after_min: retryMin })
    }
  }
  db.prepare("UPDATE accounts SET last_analysis_at = datetime('now') WHERE id = ?").run(req.accountId)

  // Aplica reset ANTES de disparar o batch (sincrono — barato, 1 UPDATE)
  if (resetAll) {
    const r = db.prepare(`
      UPDATE conversation_insights
         SET last_message_id = 0, incremental_count = 0,
             last_full_analysis_at = NULL, last_full_message_id = 0
       WHERE account_id = ?
    `).run(req.accountId)
    console.log(`[Analyze-now] account=${req.accountId} reset_all by user=${req.user?.id || '?'} reset_rows=${r.changes}`)
  } else if (resetLeadId) {
    const r = db.prepare(`
      UPDATE conversation_insights
         SET last_message_id = 0, incremental_count = 0,
             last_full_analysis_at = NULL, last_full_message_id = 0
       WHERE account_id = ? AND lead_id = ?
    `).run(req.accountId, resetLeadId)
    console.log(`[Analyze-now] account=${req.accountId} reset_lead=${resetLeadId} by user=${req.user?.id || '?'} reset_rows=${r.changes}`)
  }

  setImmediate(() => {
    analyzeConversationsBatch(req.accountId, { maxLeads, sinceHours: 168 })
      .catch(e => console.error('[Analyze-now]', e.message))
    const today = new Date().toISOString().slice(0, 10)
    try { aggregateAllAccounts(today) } catch (e) { console.error('[Aggregate-now]', e.message) }
  })
  res.json({
    ok: true,
    message: `Analise de ate ${maxLeads} conversas iniciada em background.`,
    max_leads: maxLeads,
    reset_all: resetAll || undefined,
    reset_lead: resetLeadId || undefined,
  })
})

// Configura limite mensal de tokens de análise da conta
router.put('/analysis-limit', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const limit = Math.max(0, Math.min(10000000, parseInt(req.body.limit) || 0))
  db.prepare("UPDATE accounts SET analysis_token_limit = ?, updated_at = datetime('now') WHERE id = ?").run(limit, req.accountId)
  res.json({ ok: true, analysis_token_limit: limit })
})

// ─── Endpoints V2 (Conversation Intelligence) ───
// Todos respeitam requireAnalyticsEnabled (super_admin sempre passa) e exigem gerente/super_admin.

// Estimativa de custo pra modal de confirmação no "Analisar agora"
router.get('/analyze-estimate', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const sinceHours = Math.max(1, Math.min(720, parseInt(req.query.days || '7') * 24))
  const maxLeads = Math.max(1, Math.min(500, parseInt(req.query.max) || 50))
  const est = getAnalyzeEstimate(req.accountId, sinceHours, maxLeads)
  const isSuperAdmin = req.user?.role === 'super_admin'
  if (!isSuperAdmin && !est.account_has_flag) {
    return res.status(403).json({ error: 'analytics_disabled' })
  }
  res.json({
    ...est,
    is_super_admin_bypass: isSuperAdmin && !est.account_has_flag,
  })
})

// Overview V2 — 10 cards
router.get('/overview-v2', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30')))
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ')

  const conversasAnalisadas = db.prepare(`
    SELECT COUNT(*) as n FROM conversation_insights
    WHERE account_id = ? AND analyzed_at >= ? AND insights_version >= 2
  `).get(req.accountId, since)?.n || 0

  const scoreMedioRow = db.prepare(`
    SELECT AVG(conversation_score) as avg FROM conversation_insights
    WHERE account_id = ? AND analyzed_at >= ? AND insights_version >= 2 AND conversation_score IS NOT NULL
  `).get(req.accountId, since)
  const scoreMedio = scoreMedioRow?.avg ? Math.round(scoreMedioRow.avg) : null

  // SLA <5min (humano) — usa attendant_metrics_daily agregado
  const slaRow = db.prepare(`
    SELECT SUM(leads_under_5min) as under5, SUM(leads_assigned) as total
    FROM attendant_metrics_daily
    WHERE account_id = ? AND date >= date(?)
  `).get(req.accountId, since.slice(0, 10))
  const slaPct = slaRow?.total ? Math.round(100 * (slaRow.under5 || 0) / slaRow.total) : null

  const leadsQuentesEmRisco = db.prepare(`
    SELECT COUNT(*) as n FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    WHERE ci.account_id = ? AND ci.analyzed_at >= ?
      AND ci.temperatura_lead = 'quente'
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM messages WHERE lead_id = l.id AND direction = 'outbound' AND ai_agent_id IS NULL
          AND created_at >= datetime('now', '-1 day')
      )
  `).get(req.accountId, since)?.n || 0

  const vendasPerdidas = db.prepare(`
    SELECT COUNT(*) as n FROM conversation_insights
    WHERE account_id = ? AND analyzed_at >= ? AND lost_sale_signals IS NOT NULL AND lost_sale_signals != ''
  `).get(req.accountId, since)?.n || 0

  // Receita estimada em risco
  const receitaRiscoRow = db.prepare(`
    SELECT COALESCE(SUM(l.value_estimated), 0) as total FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    WHERE ci.account_id = ? AND ci.analyzed_at >= ?
      AND ci.temperatura_lead = 'quente'
      AND l.value_estimated IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM messages WHERE lead_id = l.id AND direction = 'outbound' AND ai_agent_id IS NULL
          AND created_at >= datetime('now', '-1 day')
      )
  `).get(req.accountId, since)
  const receitaRisco = receitaRiscoRow?.total || 0

  const errosCriticos = db.prepare(`
    SELECT COUNT(*) as n FROM conversation_errors
    WHERE account_id = ? AND created_at >= ? AND gravity = 'critica'
  `).get(req.accountId, since)?.n || 0

  const alertasOpen = db.prepare(`
    SELECT COUNT(*) as n FROM analyst_alerts WHERE account_id = ? AND status = 'open'
  `).get(req.accountId)?.n || 0

  // Bot taxa de resolução: % de bot_analysis.respondeu_corretamente
  const botRow = db.prepare(`
    SELECT bot_analysis_json FROM conversation_insights
    WHERE account_id = ? AND analyzed_at >= ? AND bot_analysis_json IS NOT NULL
  `).all(req.accountId, since)
  let botTotal = 0, botOk = 0
  for (const r of botRow) {
    try {
      const b = JSON.parse(r.bot_analysis_json)
      if (b) { botTotal++; if (b.respondeu_corretamente) botOk++ }
    } catch {}
  }
  const botTaxa = botTotal ? Math.round(100 * botOk / botTotal) : null

  // Follow-ups atrasados (leads em follow-up que ja passaram da data)
  const followUpsAtrasados = db.prepare(`
    SELECT COUNT(*) as n FROM lead_follow_ups lfu
    JOIN follow_ups fu ON fu.id = lfu.follow_up_id
    JOIN leads l ON l.id = lfu.lead_id
    WHERE l.account_id = ? AND lfu.status = 'active' AND lfu.next_run_at < datetime('now')
  `).get(req.accountId)?.n || 0

  res.json({
    cards: {
      conversas_analisadas: conversasAnalisadas,
      score_medio: scoreMedio,
      sla_humano_pct: slaPct,
      leads_quentes_em_risco: leadsQuentesEmRisco,
      vendas_perdidas: vendasPerdidas,
      receita_em_risco: receitaRisco,
      erros_criticos_count: errosCriticos,
      proximas_acoes_pendentes: alertasOpen,
      bot_taxa_resolucao: botTaxa,
      follow_ups_atrasados: followUpsAtrasados,
    },
    days,
  })
})

// Ranking V2 — colunas estendidas
router.get('/ranking-v2', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30')))
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const sinceDate = since.slice(0, 10)

  const rows = db.prepare(`
    SELECT
      u.id as user_id, u.name as user_name, u.role,
      COALESCE(SUM(amd.leads_assigned), 0) as leads_assigned,
      COALESCE(SUM(amd.leads_responded), 0) as leads_responded,
      COALESCE(SUM(amd.leads_converted), 0) as leads_converted,
      AVG(amd.ttfr_human_avg_seconds) as ttfr_human,
      AVG(amd.tmr_human_avg_seconds) as tmr_human,
      COALESCE(SUM(amd.leads_under_5min), 0) as under5,
      COALESCE(SUM(amd.leads_idle_24h), 0) as idle24,
      AVG(ci.conversation_score) as score_v2,
      COUNT(DISTINCT CASE WHEN ci.lost_sale_signals IS NOT NULL AND ci.lost_sale_signals != '' THEN ci.lead_id END) as lost_sales,
      COUNT(DISTINCT CASE WHEN ci.temperatura_lead = 'quente' THEN ci.lead_id END) as quentes
    FROM users u
    LEFT JOIN attendant_metrics_daily amd ON amd.user_id = u.id AND amd.account_id = u.account_id AND amd.date >= ?
    LEFT JOIN conversation_insights ci ON ci.attendant_user_id = u.id AND ci.account_id = u.account_id AND ci.analyzed_at >= ? AND ci.insights_version >= 2
    WHERE u.account_id = ? AND u.role IN ('atendente', 'gerente') AND u.is_active = 1 AND COALESCE(u.is_bot, 0) = 0
    GROUP BY u.id, u.name, u.role
    ORDER BY score_v2 DESC NULLS LAST, leads_responded DESC
  `).all(sinceDate, since, req.accountId)

  // Pra cada user: principal_erro e principal_forte
  const principalErrorStmt = db.prepare(`
    SELECT code, COUNT(*) as n FROM conversation_errors
    WHERE account_id = ? AND attendant_user_id = ? AND created_at >= ?
    GROUP BY code ORDER BY n DESC LIMIT 1
  `)
  const principalStrengthStmt = db.prepare(`
    SELECT code, COUNT(*) as n FROM conversation_strengths
    WHERE account_id = ? AND attendant_user_id = ? AND created_at >= ?
    GROUP BY code ORDER BY n DESC LIMIT 1
  `)
  const enriched = rows.map(r => ({
    ...r,
    score_v2: r.score_v2 ? Math.round(r.score_v2) : null,
    ttfr_human: r.ttfr_human ? Math.round(r.ttfr_human) : null,
    tmr_human: r.tmr_human ? Math.round(r.tmr_human) : null,
    sla_5min_pct: r.leads_assigned ? Math.round(100 * r.under5 / r.leads_assigned) : null,
    conversion_pct: r.leads_assigned ? Math.round(100 * r.leads_converted / r.leads_assigned) : null,
    principal_erro: principalErrorStmt.get(req.accountId, r.user_id, since)?.code || null,
    principal_forte: principalStrengthStmt.get(req.accountId, r.user_id, since)?.code || null,
  }))

  res.json({ days, attendants: enriched })
})

// Conversas críticas
router.get('/critical-conversations', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30')))
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50')))
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ')

  const rows = db.prepare(`
    SELECT ci.lead_id, l.name as lead_name, l.phone as lead_phone,
           u.name as attendant_name, u.id as attendant_user_id,
           ci.temperatura_lead, ci.conversation_score, ci.summary,
           ci.prioridade_revisao, ci.mensagem_retomada, ci.suggested_next_step,
           ci.chance_conversao, ci.lost_sale_signals,
           (SELECT description FROM conversation_errors WHERE insight_id = ci.id AND gravity = 'critica' LIMIT 1) as erro_critico
    FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    LEFT JOIN users u ON u.id = ci.attendant_user_id
    WHERE ci.account_id = ? AND ci.analyzed_at >= ? AND ci.insights_version >= 2
      AND (
        ci.prioridade_revisao IN ('alta', 'critica')
        OR ci.lost_sale_signals IS NOT NULL
        OR (ci.temperatura_lead = 'quente' AND ci.conversation_score < 60)
      )
    ORDER BY
      CASE ci.prioridade_revisao WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      ci.chance_conversao DESC
    LIMIT ?
  `).all(req.accountId, since, limit)

  res.json({ conversations: rows })
})

// Detalhe completo da conversa V2 (insight + errors + strengths + participants)
router.get('/conversation-detail/:leadId', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const leadId = parseInt(req.params.leadId)

  const insight = db.prepare(`
    SELECT ci.*, l.name as lead_name, l.phone as lead_phone, u.name as attendant_name
    FROM conversation_insights ci
    JOIN leads l ON l.id = ci.lead_id
    LEFT JOIN users u ON u.id = ci.attendant_user_id
    WHERE ci.lead_id = ? AND ci.account_id = ?
  `).get(leadId, req.accountId)

  if (!insight) return res.json({ insight: null })

  // Parse JSON fields
  try { insight.objecoes_detectadas = JSON.parse(insight.objecoes_detectadas || '[]') } catch { insight.objecoes_detectadas = [] }
  try { insight.motivos_perda = JSON.parse(insight.motivos_perda || '[]') } catch { insight.motivos_perda = [] }
  try { insight.riscos_detectados = JSON.parse(insight.riscos_detectados || '[]') } catch { insight.riscos_detectados = [] }
  try { insight.attendant_errors = JSON.parse(insight.attendant_errors || '[]') } catch { insight.attendant_errors = [] }
  try { insight.bot_analysis = insight.bot_analysis_json ? JSON.parse(insight.bot_analysis_json) : null } catch { insight.bot_analysis = null }
  try { insight.handoff_analysis = insight.handoff_analysis_json ? JSON.parse(insight.handoff_analysis_json) : null } catch { insight.handoff_analysis = null }

  const errors = db.prepare(`
    SELECT id, actor_type, code, category, gravity, description, impact, how_to_fix, evidence_message_ids
    FROM conversation_errors WHERE insight_id = ?
  `).all(insight.id).map(e => {
    try { e.evidence_message_ids = JSON.parse(e.evidence_message_ids || '[]') } catch { e.evidence_message_ids = [] }
    return e
  })

  const strengths = db.prepare(`
    SELECT id, actor_type, code, description, impact, evidence_message_ids
    FROM conversation_strengths WHERE insight_id = ?
  `).all(insight.id).map(s => {
    try { s.evidence_message_ids = JSON.parse(s.evidence_message_ids || '[]') } catch { s.evidence_message_ids = [] }
    return s
  })

  const participants = db.prepare(`
    SELECT actor_type, actor_user_id, actor_ai_agent_id, actor_name, score,
           acertos_summary, erros_summary, recomendacao
    FROM conversation_participant_analysis WHERE insight_id = ?
  `).all(insight.id)

  res.json({ insight, errors, strengths, participants })
})

// Lista de alertas (open por default)
router.get('/alerts', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const status = req.query.status || 'open'
  const rows = db.prepare(`
    SELECT a.*, l.name as lead_name, l.phone as lead_phone, u.name as assigned_to_name
    FROM analyst_alerts a
    LEFT JOIN leads l ON l.id = a.lead_id
    LEFT JOIN users u ON u.id = a.assigned_to_user_id
    WHERE a.account_id = ? AND a.status = ?
    ORDER BY
      CASE a.severity WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      a.created_at DESC
    LIMIT 100
  `).all(req.accountId, status)
  res.json({ alerts: rows })
})

// Marca alerta como resolvido/dispensado
router.post('/alerts/:id/resolve', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const id = parseInt(req.params.id)
  const newStatus = req.body.status === 'dismissed' ? 'dismissed' : 'resolved'
  const r = db.prepare(`
    UPDATE analyst_alerts SET status = ?, resolved_at = datetime('now')
    WHERE id = ? AND account_id = ?
  `).run(newStatus, id, req.accountId)
  res.json({ ok: r.changes > 0, status: newStatus })
})

// Atribui alerta a um user
router.post('/alerts/:id/assign', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const id = parseInt(req.params.id)
  const userId = parseInt(req.body.user_id) || null
  const r = db.prepare(`
    UPDATE analyst_alerts SET assigned_to_user_id = ? WHERE id = ? AND account_id = ?
  `).run(userId, id, req.accountId)
  res.json({ ok: r.changes > 0 })
})

// Coaching weekly por user
router.get('/coaching/:userId', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const userId = parseInt(req.params.userId)
  const weeks = Math.min(12, Math.max(1, parseInt(req.query.weeks || '4')))
  const rows = db.prepare(`
    SELECT * FROM attendant_coaching_weekly
    WHERE account_id = ? AND user_id = ?
    ORDER BY week_start DESC LIMIT ?
  `).all(req.accountId, userId, weeks).map(w => {
    try { w.strengths = JSON.parse(w.strengths || '[]') } catch { w.strengths = [] }
    try { w.improvements = JSON.parse(w.improvements || '[]') } catch { w.improvements = [] }
    try { w.conversations_to_review = JSON.parse(w.conversations_to_review || '[]') } catch { w.conversations_to_review = [] }
    return w
  })
  res.json({ weekly: rows })
})

// Gera coaching on-demand (rate limit: 1x/dia por user)
router.post('/coaching/:userId/generate', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const userId = parseInt(req.params.userId)
  const lastMonday = new Date(Date.now() - 7 * 86400 * 1000)
  const weekStart = isoMonday(lastMonday)

  // Rate limit
  const existing = db.prepare(`
    SELECT created_at FROM attendant_coaching_weekly
    WHERE account_id = ? AND user_id = ? AND week_start = ?
  `).get(req.accountId, userId, weekStart)
  if (existing) {
    const ageMin = (Date.now() - new Date(existing.created_at).getTime()) / 60000
    if (ageMin < 60 * 24) {
      return res.status(429).json({ error: 'Coaching ja gerado hoje. Tente novamente em 24h.', existing })
    }
  }

  setImmediate(() => {
    generateCoachingForUser(req.accountId, userId, weekStart).catch(e =>
      console.error(`[Coaching on-demand]`, e.message)
    )
  })
  res.json({ ok: true, message: 'Coaching sendo gerado em background.', week_start: weekStart })
})

// Inteligência de mercado — agrega objeções/motivos_perda/riscos do período
router.get('/market-intelligence', requireRole('super_admin', 'gerente'), requireAnalyticsEnabled, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const days = Math.min(365, Math.max(1, parseInt(req.query.days || '30')))
  const since = new Date(Date.now() - days * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ')

  const rows = db.prepare(`
    SELECT objecoes_detectadas, motivos_perda, riscos_detectados
    FROM conversation_insights
    WHERE account_id = ? AND analyzed_at >= ? AND insights_version >= 2
  `).all(req.accountId, since)

  function countArr(field) {
    const counts = new Map()
    for (const r of rows) {
      try {
        const arr = JSON.parse(r[field] || '[]')
        for (const item of arr) {
          if (!item) continue
          const k = String(item).toLowerCase().trim()
          counts.set(k, (counts.get(k) || 0) + 1)
        }
      } catch {}
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, count]) => ({ label, count }))
  }

  res.json({
    objecoes_top: countArr('objecoes_detectadas'),
    motivos_perda_top: countArr('motivos_perda'),
    riscos_top: countArr('riscos_detectados'),
    days,
    sample_size: rows.length,
  })
})

// Marca lead como tendo proposta enviada
router.post('/leads/:leadId/mark-proposal-sent', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const leadId = parseInt(req.params.leadId)
  const r = db.prepare(`
    UPDATE leads SET proposal_sent_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND account_id = ?
  `).run(leadId, req.accountId)
  res.json({ ok: r.changes > 0 })
})

// Atualiza value_estimated do lead
router.put('/leads/:leadId/value', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const leadId = parseInt(req.params.leadId)
  const value = Math.max(0, parseFloat(req.body.value_estimated) || 0)
  const r = db.prepare(`
    UPDATE leads SET value_estimated = ?, updated_at = datetime('now')
    WHERE id = ? AND account_id = ?
  `).run(value, leadId, req.accountId)
  res.json({ ok: r.changes > 0, value_estimated: value })
})

export default router

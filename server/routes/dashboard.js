import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

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

export default router

// Calculo das metricas operacionais de um atendente num dia (SQL puro, sem IA), com filtro opcional de
// funil (spec 2026-10-05 filtro de funil §5b). Recebe a conexao (nao importa server/db.js).
// kind = null -> igual ao agregado de sempre (attendant_metrics_daily);
// kind = 'vendas'|'recompra' -> so leads que estavam nesse funil no inicio do dia (lead novo: onde nasceu).
import { kindAtSql, firstKindSql, salesWhere } from './funnelFilter.js'

const COLS = [
  'leads_assigned', 'leads_responded', 'leads_converted',
  'ttfr_avg_seconds', 'tmr_avg_seconds',
  'leads_under_5min', 'leads_under_30min', 'leads_under_1h',
  'open_conversations', 'abandoned_leads',
  'ttfr_human_avg_seconds', 'ttfr_human_p90_seconds', 'ttfr_bot_avg_seconds',
  'tmr_human_avg_seconds',
  'leads_without_human_response', 'leads_idle_24h', 'leads_idle_72h',
  'time_to_qualified_avg_seconds', 'time_to_proposal_avg_seconds',
]

const avg = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)

export function computeAttendantDay(conn, accountId, userId, dateStr, kind = null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr))) throw new Error('data invalida')
  if (kind !== null && kind !== 'vendas' && kind !== 'recompra') throw new Error('funil invalido')
  const dayStart = `${dateStr} 00:00:00`
  const dayEnd = `${dateStr} 23:59:59`
  // Filtros de funil (vazios sem kind): lead novo pelo funil em que nasceu; o resto pelo funil no inicio do dia
  const KN = a => (kind ? ` AND ${firstKindSql(`${a}.id`)} = '${kind}'` : '')
  const KA = a => (kind ? ` AND ${kindAtSql(`${a}.id`, `'${dayStart}'`)} = '${kind}'` : '')

  // 1. Leads novos do dia atribuidos ao user
  const newLeads = conn.prepare(`
    SELECT l.id, l.created_at, l.stage_id FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.created_at BETWEEN ? AND ?${KN('l')}
  `).all(accountId, userId, dayStart, dayEnd)

  // 2. TTFR (qualquer outbound)
  const ttfrSamples = []
  let under5 = 0, under30 = 0, under1h = 0
  const firstOutStmt = conn.prepare("SELECT created_at FROM messages WHERE lead_id = ? AND direction = 'outbound' ORDER BY id ASC LIMIT 1")
  for (const lead of newLeads) {
    const firstOut = firstOutStmt.get(lead.id)
    if (!firstOut) continue
    const sec = (new Date(firstOut.created_at).getTime() - new Date(lead.created_at).getTime()) / 1000
    if (sec < 0) continue
    ttfrSamples.push(sec)
    if (sec < 300) under5++
    if (sec < 1800) under30++
    if (sec < 3600) under1h++
  }

  // 3. Leads com outbound no dia
  const activeLeadIds = conn.prepare(`
    SELECT DISTINCT l.id FROM leads l JOIN messages m ON m.lead_id = l.id
    WHERE l.account_id = ? AND l.attendant_id = ? AND m.direction = 'outbound' AND m.created_at BETWEEN ? AND ?${KA('l')}
  `).all(accountId, userId, dayStart, dayEnd).map(r => r.id)

  // 4/9. TMR (geral e humano): pares inbound -> proxima outbound no dia
  const dayMsgs = conn.prepare('SELECT direction, ai_agent_id, created_at FROM messages WHERE lead_id = ? AND created_at BETWEEN ? AND ? ORDER BY id ASC')
  const tmrSamples = [], tmrHumanSamples = []
  for (const leadId of activeLeadIds) {
    const msgs = dayMsgs.all(leadId, dayStart, dayEnd)
    let lastIn = null, lastInHuman = null
    for (const m of msgs) {
      if (m.direction === 'inbound') { lastIn = m.created_at; lastInHuman = m.created_at; continue }
      if (m.direction !== 'outbound') continue
      if (lastIn) {
        const gap = (new Date(m.created_at).getTime() - new Date(lastIn).getTime()) / 1000
        if (gap > 0 && gap < 86400) tmrSamples.push(gap)
        lastIn = null
      }
      if (m.ai_agent_id == null && lastInHuman) {
        const gap = (new Date(m.created_at).getTime() - new Date(lastInHuman).getTime()) / 1000
        if (gap > 0 && gap < 86400) tmrHumanSamples.push(gap)
        lastInHuman = null
      } else if (m.ai_agent_id != null) {
        lastInHuman = null // bot respondeu primeiro
      }
    }
  }

  // 5. Conversoes: vendas = entrou em etapa de conversao do funil de vendas no dia; recompra = recomprou no dia
  const conversions = kind === 'recompra'
    ? conn.prepare(`
        SELECT COUNT(DISTINCT ls.lead_id) as n FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id
        WHERE l.account_id = ? AND l.attendant_id = ? AND ls.sale_date BETWEEN ? AND ?${salesWhere('ls', 'recompra')}
      `).get(accountId, userId, dayStart, dayEnd)?.n || 0
    : conn.prepare(`
        SELECT COUNT(DISTINCT l.id) as n FROM leads l
        JOIN funnel_stages fs ON fs.id = l.stage_id
        JOIN funnels fk ON fk.id = fs.funnel_id AND fk.kind = 'vendas'
        LEFT JOIN stage_history sh ON sh.lead_id = l.id AND sh.to_stage_id = fs.id
        WHERE l.account_id = ? AND l.attendant_id = ? AND fs.is_conversion = 1
          AND ((sh.created_at BETWEEN ? AND ?) OR (l.created_at BETWEEN ? AND ? AND l.updated_at BETWEEN ? AND ?))${KA('l')}
      `).get(accountId, userId, dayStart, dayEnd, dayStart, dayEnd, dayStart, dayEnd)?.n || 0

  // 6. Conversas abertas (fim do dia)
  const openConvs = conn.prepare(`
    SELECT COUNT(*) as n FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0
      AND EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id AND created_at >= datetime(?, '-1 day'))${KA('l')}
  `).get(accountId, userId, dayEnd)?.n || 0

  // 7. Abandonados: ativos sem outbound ha 7 dias
  const abandoned = conn.prepare(`
    SELECT COUNT(*) as n FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id AND direction = 'outbound' AND created_at >= datetime(?, '-7 day'))
      AND EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id)${KA('l')}
  `).get(accountId, userId, dayEnd)?.n || 0

  // 8. TTFR humano e bot (separados) + P90 humano
  const firstHumanStmt = conn.prepare("SELECT created_at FROM messages WHERE lead_id = ? AND direction = 'outbound' AND ai_agent_id IS NULL ORDER BY id ASC LIMIT 1")
  const firstBotStmt = conn.prepare("SELECT created_at FROM messages WHERE lead_id = ? AND direction = 'outbound' AND ai_agent_id IS NOT NULL ORDER BY id ASC LIMIT 1")
  const ttfrHuman = [], ttfrBot = []
  for (const lead of newLeads) {
    const h = firstHumanStmt.get(lead.id)
    if (h) { const sec = (new Date(h.created_at).getTime() - new Date(lead.created_at).getTime()) / 1000; if (sec >= 0) ttfrHuman.push(sec) }
    const b = firstBotStmt.get(lead.id)
    if (b) { const sec = (new Date(b.created_at).getTime() - new Date(lead.created_at).getTime()) / 1000; if (sec >= 0) ttfrBot.push(sec) }
  }
  let p90 = null
  if (ttfrHuman.length) {
    const sorted = [...ttfrHuman].sort((a, b) => a - b)
    p90 = sorted[Math.max(0, Math.ceil(sorted.length * 0.9) - 1)]
  }

  // 10. Leads novos sem resposta humana ate o fim do dia
  const withoutHuman = conn.prepare(`
    SELECT COUNT(*) as n FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.created_at BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id AND direction = 'outbound' AND ai_agent_id IS NULL AND created_at <= ?)${KN('l')}
  `).get(accountId, userId, dayStart, dayEnd, dayEnd)?.n || 0

  // 11. Ociosos 24h/72h (fim do dia)
  const idle = days => conn.prepare(`
    SELECT COUNT(*) as n FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0
      AND EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id AND direction = 'outbound' AND ai_agent_id IS NULL AND created_at >= datetime(?, '-${days} day'))${KA('l')}
  `).get(accountId, userId, dayEnd)?.n || 0

  // 12/13. Tempo ate qualificacao e ate proposta
  const timeTo = col => conn.prepare(`
    SELECT AVG((julianday(l.${col}) - julianday(l.created_at)) * 86400) as avg_seconds FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ? AND l.${col} IS NOT NULL AND l.${col} BETWEEN ? AND ?${KA('l')}
  `).get(accountId, userId, dayStart, dayEnd)?.avg_seconds ?? null

  return {
    leads_assigned: newLeads.length,
    leads_responded: activeLeadIds.length,
    leads_converted: conversions,
    ttfr_avg_seconds: avg(ttfrSamples),
    tmr_avg_seconds: avg(tmrSamples),
    leads_under_5min: under5, leads_under_30min: under30, leads_under_1h: under1h,
    open_conversations: openConvs,
    abandoned_leads: abandoned,
    ttfr_human_avg_seconds: avg(ttfrHuman),
    ttfr_human_p90_seconds: p90,
    ttfr_bot_avg_seconds: avg(ttfrBot),
    tmr_human_avg_seconds: avg(tmrHumanSamples),
    leads_without_human_response: withoutHuman,
    leads_idle_24h: idle(1),
    leads_idle_72h: idle(3),
    time_to_qualified_avg_seconds: timeTo('qualified_at'),
    time_to_proposal_avg_seconds: timeTo('proposal_sent_at'),
  }
}

export function upsertDailyDay(conn, accountId, userId, dateStr, m) {
  conn.prepare(`
    INSERT INTO attendant_metrics_daily (account_id, user_id, date, ${COLS.join(', ')}, computed_at)
    VALUES (?, ?, ?, ${COLS.map(() => '?').join(', ')}, datetime('now'))
    ON CONFLICT(account_id, user_id, date) DO UPDATE SET
      ${COLS.map(c => `${c} = excluded.${c}`).join(', ')}, computed_at = datetime('now')
  `).run(accountId, userId, dateStr, ...COLS.map(c => m[c]))
}

export function ensureFunnelMetricsTable(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS attendant_metrics_daily_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, user_id INTEGER NOT NULL, date TEXT NOT NULL,
    funnel_kind TEXT NOT NULL, leads_assigned INTEGER DEFAULT 0, leads_responded INTEGER DEFAULT 0, leads_converted INTEGER DEFAULT 0,
    ttfr_avg_seconds REAL, tmr_avg_seconds REAL, leads_under_5min INTEGER DEFAULT 0, leads_under_30min INTEGER DEFAULT 0,
    leads_under_1h INTEGER DEFAULT 0, open_conversations INTEGER DEFAULT 0, abandoned_leads INTEGER DEFAULT 0,
    ttfr_human_avg_seconds REAL, ttfr_human_p90_seconds REAL, ttfr_bot_avg_seconds REAL, tmr_human_avg_seconds REAL,
    leads_without_human_response INTEGER DEFAULT 0, leads_idle_24h INTEGER DEFAULT 0, leads_idle_72h INTEGER DEFAULT 0,
    time_to_qualified_avg_seconds REAL, time_to_proposal_avg_seconds REAL, computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, user_id, date, funnel_kind))`)
  conn.exec('CREATE INDEX IF NOT EXISTS idx_amdf_lookup ON attendant_metrics_daily_funnel(account_id, funnel_kind, date, user_id)')
}

export function upsertFunnelDay(conn, accountId, userId, dateStr, kind, m) {
  conn.prepare(`
    INSERT INTO attendant_metrics_daily_funnel (account_id, user_id, date, funnel_kind, ${COLS.join(', ')}, computed_at)
    VALUES (?, ?, ?, ?, ${COLS.map(() => '?').join(', ')}, datetime('now'))
    ON CONFLICT(account_id, user_id, date, funnel_kind) DO UPDATE SET
      ${COLS.map(c => `${c} = excluded.${c}`).join(', ')}, computed_at = datetime('now')
  `).run(accountId, userId, dateStr, kind, ...COLS.map(c => m[c]))
}

// Grava as duas linhas por funil de um atendente num dia.
export function aggregateFunnelDay(conn, accountId, userId, dateStr) {
  for (const k of ['vendas', 'recompra']) upsertFunnelDay(conn, accountId, userId, dateStr, k, computeAttendantDay(conn, accountId, userId, dateStr, k))
}

const BACKFILL_KEY = 'amd_funnel_backfill_v1'

// Preenchimento unico dos ultimos `days` dias (ate ontem). Marca app_settings para nao repetir.
export function backfillFunnelMetrics(conn, days = 90, today = new Date()) {
  if (conn.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(BACKFILL_KEY)) return { done: false }
  const accounts = conn.prepare('SELECT id FROM accounts WHERE is_active = 1 AND attendant_analytics_enabled = 1').all()
  const dates = []
  for (let i = days; i >= 1; i--) dates.push(new Date(today.getTime() - i * 86400000).toISOString().slice(0, 10))
  for (const acc of accounts) {
    const users = conn.prepare(`
      SELECT id FROM users WHERE account_id = ? AND role IN ('atendente', 'gerente') AND is_active = 1 AND COALESCE(is_bot, 0) = 0
    `).all(acc.id)
    for (const u of users) for (const d of dates) {
      try { aggregateFunnelDay(conn, acc.id, u.id, d) } catch (e) { console.error(`[AMD funnel backfill] account=${acc.id} user=${u.id} date=${d}:`, e.message) }
    }
  }
  conn.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))").run(BACKFILL_KEY)
  return { done: true }
}

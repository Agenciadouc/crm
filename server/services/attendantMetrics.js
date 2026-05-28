// Agregador de métricas operacionais por atendente — roda 1x por dia no cron noturno.
// Calcula via SQL puro (sem IA): TTFR, TMR, conversões, leads atendidos, abandonados.
// Idempotente: UPSERT em attendant_metrics_daily por (account_id, user_id, date).

import db from '../db.js'

/**
 * Calcula e persiste métricas de um atendente pra um dia específico.
 * Conta como "atribuído" a um user os leads onde lead.attendant_id = user.id
 * E o lead foi criado no dia OU recebeu msg no dia.
 */
export function aggregateAttendantMetricsForDate(accountId, userId, dateStr) {
  // dateStr formato YYYY-MM-DD. Janela: dia inteiro UTC.
  const dayStart = `${dateStr} 00:00:00`
  const dayEnd = `${dateStr} 23:59:59`

  // 1. Leads "atribuídos a este user no dia" — created_at OU primeira msg outbound no dia
  // Mais simples: usa created_at do lead pra leads novos; pra leads existentes que receberam
  // msg do user no dia, conta como atividade (separado).
  const newLeads = db.prepare(`
    SELECT id, created_at, stage_id
    FROM leads
    WHERE account_id = ? AND attendant_id = ?
      AND created_at BETWEEN ? AND ?
  `).all(accountId, userId, dayStart, dayEnd)

  // 2. TTFR — pra cada lead novo do dia, tempo até a primeira msg outbound
  const ttfrSamples = []
  let under5 = 0, under30 = 0, under1h = 0
  for (const lead of newLeads) {
    const firstOut = db.prepare(`
      SELECT created_at FROM messages
      WHERE lead_id = ? AND direction = 'outbound'
      ORDER BY id ASC LIMIT 1
    `).get(lead.id)
    if (!firstOut) continue
    const ttfrSec = (new Date(firstOut.created_at).getTime() - new Date(lead.created_at).getTime()) / 1000
    if (ttfrSec < 0) continue // sanidade
    ttfrSamples.push(ttfrSec)
    if (ttfrSec < 300) under5++         // 5 min
    if (ttfrSec < 1800) under30++       // 30 min
    if (ttfrSec < 3600) under1h++       // 1 h
  }
  const ttfrAvg = ttfrSamples.length ? ttfrSamples.reduce((s, x) => s + x, 0) / ttfrSamples.length : null

  // 3. Leads que receberam pelo menos 1 msg outbound no dia (atividade do user) — pra TMR + leads_responded
  const activeLeadsRows = db.prepare(`
    SELECT DISTINCT l.id
    FROM leads l
    JOIN messages m ON m.lead_id = l.id
    WHERE l.account_id = ? AND l.attendant_id = ?
      AND m.direction = 'outbound'
      AND m.created_at BETWEEN ? AND ?
  `).all(accountId, userId, dayStart, dayEnd)
  const activeLeadIds = activeLeadsRows.map(r => r.id)
  const leadsResponded = activeLeadIds.length

  // 4. TMR — pra cada lead com atividade no dia, pega pares (inbound → próxima outbound)
  // gap em segundos. Pega só as msgs do dia inteiro (não restritas só a dayStart pra ter contexto).
  const tmrSamples = []
  for (const leadId of activeLeadIds) {
    const msgs = db.prepare(`
      SELECT direction, created_at FROM messages
      WHERE lead_id = ? AND created_at BETWEEN ? AND ?
      ORDER BY id ASC
    `).all(leadId, dayStart, dayEnd)
    let lastInbound = null
    for (const m of msgs) {
      if (m.direction === 'inbound') {
        lastInbound = m.created_at
      } else if (m.direction === 'outbound' && lastInbound) {
        const gap = (new Date(m.created_at).getTime() - new Date(lastInbound).getTime()) / 1000
        if (gap > 0 && gap < 86400) tmrSamples.push(gap) // ignora gaps > 24h
        lastInbound = null
      }
    }
  }
  const tmrAvg = tmrSamples.length ? tmrSamples.reduce((s, x) => s + x, 0) / tmrSamples.length : null

  // 5. Conversões — leads que estão em stage com is_conversion=1 no dia
  // Considera lead.stage_id atual + criado/movido pra esse stage no dia
  const conversions = db.prepare(`
    SELECT COUNT(DISTINCT l.id) as n
    FROM leads l
    JOIN funnel_stages fs ON fs.id = l.stage_id
    LEFT JOIN stage_history sh ON sh.lead_id = l.id AND sh.to_stage_id = fs.id
    WHERE l.account_id = ? AND l.attendant_id = ?
      AND fs.is_conversion = 1
      AND (
        (sh.created_at BETWEEN ? AND ?)
        OR (l.created_at BETWEEN ? AND ? AND l.updated_at BETWEEN ? AND ?)
      )
  `).get(accountId, userId, dayStart, dayEnd, dayStart, dayEnd, dayStart, dayEnd)?.n || 0

  // 6. Snapshot conversas em aberto (no fim do dia)
  const openConvs = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE account_id = ? AND attendant_id = ?
      AND is_active = 1 AND COALESCE(is_archived, 0) = 0
      AND EXISTS (SELECT 1 FROM messages WHERE lead_id = leads.id AND created_at >= datetime(?, '-1 day'))
  `).get(accountId, userId, dayEnd)?.n || 0

  // 7. Abandoned — leads atribuídos a este user, sem msg outbound nos últimos 7 dias, mas ainda ativos
  const abandoned = db.prepare(`
    SELECT COUNT(*) as n FROM leads l
    WHERE l.account_id = ? AND l.attendant_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM messages
        WHERE lead_id = l.id AND direction = 'outbound'
          AND created_at >= datetime(?, '-7 day')
      )
      AND EXISTS (SELECT 1 FROM messages WHERE lead_id = l.id)
  `).get(accountId, userId, dayEnd)?.n || 0

  // UPSERT
  db.prepare(`
    INSERT INTO attendant_metrics_daily (
      account_id, user_id, date,
      leads_assigned, leads_responded, leads_converted,
      ttfr_avg_seconds, tmr_avg_seconds,
      leads_under_5min, leads_under_30min, leads_under_1h,
      open_conversations, abandoned_leads, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(account_id, user_id, date) DO UPDATE SET
      leads_assigned = excluded.leads_assigned,
      leads_responded = excluded.leads_responded,
      leads_converted = excluded.leads_converted,
      ttfr_avg_seconds = excluded.ttfr_avg_seconds,
      tmr_avg_seconds = excluded.tmr_avg_seconds,
      leads_under_5min = excluded.leads_under_5min,
      leads_under_30min = excluded.leads_under_30min,
      leads_under_1h = excluded.leads_under_1h,
      open_conversations = excluded.open_conversations,
      abandoned_leads = excluded.abandoned_leads,
      computed_at = datetime('now')
  `).run(
    accountId, userId, dateStr,
    newLeads.length, leadsResponded, conversions,
    ttfrAvg, tmrAvg,
    under5, under30, under1h,
    openConvs, abandoned
  )

  return {
    leads_assigned: newLeads.length,
    leads_responded: leadsResponded,
    leads_converted: conversions,
    ttfr_avg_seconds: ttfrAvg,
    tmr_avg_seconds: tmrAvg,
  }
}

/**
 * Roda agregação pra todas as contas ativas + todos os atendentes/gerentes.
 * Chamado pelo scheduler noturno.
 */
export function aggregateAllAccounts(dateStr) {
  const accounts = db.prepare('SELECT id FROM accounts WHERE is_active = 1').all()
  let usersAggregated = 0, errors = 0
  for (const acc of accounts) {
    const users = db.prepare(`
      SELECT id FROM users
      WHERE account_id = ? AND role IN ('atendente', 'gerente')
        AND is_active = 1 AND COALESCE(is_bot, 0) = 0
    `).all(acc.id)
    for (const u of users) {
      try {
        aggregateAttendantMetricsForDate(acc.id, u.id, dateStr)
        usersAggregated++
      } catch (e) {
        errors++
        console.error(`[MetricsAggregator] err account=${acc.id} user=${u.id} date=${dateStr}:`, e.message)
      }
    }
  }
  console.log(`[MetricsAggregator] dateStr=${dateStr} accounts=${accounts.length} users=${usersAggregated} errors=${errors}`)
  return { accountsProcessed: accounts.length, usersAggregated, errors }
}

// Agregador de métricas operacionais por atendente — roda 1x por dia no cron noturno.
// Calcula via SQL puro (sem IA): TTFR, TMR, conversões, leads atendidos, abandonados.
// Idempotente: UPSERT em attendant_metrics_daily por (account_id, user_id, date).

import db from '../db.js'
import { computeAttendantDay, upsertDailyDay, aggregateFunnelDay } from './attendantMetricsCompute.js'

/**
 * Calcula e persiste métricas de um atendente pra um dia específico (cálculo em
 * attendantMetricsCompute.js). Grava o agregado de sempre e, ao lado, as versões por funil
 * (vendas/recompra) em attendant_metrics_daily_funnel — spec 2026-10-05 filtro de funil §5b.
 */
export function aggregateAttendantMetricsForDate(accountId, userId, dateStr) {
  const m = computeAttendantDay(db, accountId, userId, dateStr, null)
  upsertDailyDay(db, accountId, userId, dateStr, m)
  aggregateFunnelDay(db, accountId, userId, dateStr)
  return {
    leads_assigned: m.leads_assigned,
    leads_responded: m.leads_responded,
    leads_converted: m.leads_converted,
    ttfr_avg_seconds: m.ttfr_avg_seconds,
    tmr_avg_seconds: m.tmr_avg_seconds,
    ttfr_human_avg_seconds: m.ttfr_human_avg_seconds,
    ttfr_bot_avg_seconds: m.ttfr_bot_avg_seconds,
    leads_idle_24h: m.leads_idle_24h,
  }
}

/**
 * Roda agregação pra todas as contas ativas + todos os atendentes/gerentes.
 * Chamado pelo scheduler noturno.
 */
export function aggregateAllAccounts(dateStr) {
  // SO contas com feature flag ATIVADA. Evita gerar metricas pra contas que nao usam.
  const accounts = db.prepare('SELECT id FROM accounts WHERE is_active = 1 AND attendant_analytics_enabled = 1').all()
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

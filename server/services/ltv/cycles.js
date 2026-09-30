// Ciclo de recompra / venda cruzada (spec §5, §6.3). Nao importa server/db.js.
import { addDays, localDate } from './compute.js'
import { recalcCustomer } from './customer.js'
import { ensureRepurchaseFunnel, stageIdByKey, stageKey } from './funnel.js'
import { moveLeadToFunnel, moveLeadToStage } from '../stageMove.js'
import { OPEN_STATUSES, REMIND_DAYS } from './schema.js'

const OPEN_SQL = `status IN (${OPEN_STATUSES.map(s => `'${s}'`).join(',')})`
const nowSql = now => now.toISOString().slice(0, 19).replace('T', ' ')

export function openCycleForLead(db, leadId) {
  return db.prepare(`SELECT * FROM repurchase_cycles WHERE lead_id = ? AND ${OPEN_SQL}`).get(leadId) || null
}

export function wantsCycle(sale) {
  return sale.sale_kind === 'recompra' || (sale.sale_kind === 'unica' && !!sale.cross_sell)
}

export function completeTask(db, taskId, note = null) {
  if (!taskId) return
  db.prepare(`
    UPDATE standalone_tasks SET status = 'completed', completed_at = datetime('now'),
      description = CASE WHEN ? IS NULL THEN description ELSE COALESCE(description, '') || char(10) || ? END
    WHERE id = ? AND status = 'pending'
  `).run(note, note, taskId)
}

function openAttempt(db, cycleId) {
  return db.prepare('SELECT * FROM repurchase_attempts WHERE cycle_id = ? AND outcome IS NULL ORDER BY attempt DESC LIMIT 1').get(cycleId)
}

function moveToKey(db, lead, key, userId = null) {
  const toStageId = stageIdByKey(db, lead.account_id, key)
  const funnelId = ensureRepurchaseFunnel(db, lead.account_id)
  const current = db.prepare('SELECT funnel_id, stage_id FROM leads WHERE id = ?').get(lead.id)
  if (current.stage_id === toStageId) return
  if (current.funnel_id === funnelId) moveLeadToStage(db, { lead: { id: lead.id }, toStageId, trigger: 'recompra', userId, gate: false })
  else moveLeadToFunnel(db, { lead: { id: lead.id }, toFunnelId: funnelId, toStageId, trigger: 'recompra', userId })
}

function inRepurchaseFunnel(db, lead) {
  const f = db.prepare('SELECT funnel_id FROM leads WHERE id = ?').get(lead.id)
  return f && f.funnel_id === ensureRepurchaseFunnel(db, lead.account_id)
}

function closeOnPurchase(db, cycle, now) {
  const att = openAttempt(db, cycle.id)
  if (att) db.prepare('UPDATE repurchase_attempts SET outcome = ?, decided_at = ? WHERE id = ?').run('comprou', nowSql(now), att.id)
  db.prepare("UPDATE repurchase_cycles SET status = 'comprou', closed_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowSql(now), cycle.id)
  completeTask(db, cycle.task_id, 'Cliente comprou de novo.')
}

export function onSaleCreated(db, { saleId, userId = null, now = new Date() }) {
  const sale = db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId)
  const lead = db.prepare('SELECT id, account_id, repurchase_opt_out FROM leads WHERE id = ?').get(sale.lead_id)
  let result = { cycleId: null, dueNow: false, optOut: false }
  db.transaction(() => {
    const prev = openCycleForLead(db, lead.id)
    if (prev) closeOnPurchase(db, prev, now)
    recalcCustomer(db, lead.id, { now })
    if (!wantsCycle(sale)) {
      if (prev && inRepurchaseFunnel(db, lead)) moveToKey(db, lead, 'comprou', userId)
      return
    }
    if (lead.repurchase_opt_out) { result.optOut = true; return }
    const remindAt = addDays(sale.sale_date, sale.remind_days)
    const cycleId = Number(db.prepare(`
      INSERT INTO repurchase_cycles (account_id, lead_id, sale_id, kind, status, remind_at, remind_days, attempt, offer_text)
      VALUES (?, ?, ?, ?, 'aguardando', ?, ?, 1, ?)
    `).run(lead.account_id, lead.id, sale.id, sale.sale_kind === 'recompra' ? 'recompra' : 'cruzada', remindAt, sale.remind_days, sale.cross_sell_offer || null).lastInsertRowid)
    moveToKey(db, lead, 'aguardando', userId)
    result = { cycleId, dueNow: remindAt <= localDate(now), optOut: false }
  })()
  return result
}

export function onSaleDeleted(db, { leadId, saleId, now = new Date() }) {
  const c = db.prepare(`SELECT * FROM repurchase_cycles WHERE lead_id = ? AND sale_id = ? AND ${OPEN_SQL}`).get(leadId, saleId)
  if (!c) return
  db.transaction(() => {
    const att = openAttempt(db, c.id)
    if (att) db.prepare("UPDATE repurchase_attempts SET outcome = 'sem_desfecho', decided_at = ? WHERE id = ?").run(nowSql(now), att.id)
    db.prepare("UPDATE repurchase_cycles SET status = 'encerrado', closed_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowSql(now), c.id)
    completeTask(db, c.task_id, 'Venda apagada.')
  })()
}

export function recordOutcome(db, { leadId, outcome, reasonId, nextDays = null, userId = null, now = new Date() }) {
  if (!['nao_agora', 'nao_quer'].includes(outcome)) return { ok: false, status: 400, error: 'Desfecho inválido.' }
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return { ok: false, status: 404, error: 'Lead não encontrado.' }
  const cycle = openCycleForLead(db, leadId)
  if (!cycle) return { ok: false, status: 409, error: 'Este cliente não tem recompra em andamento.' }
  const reason = reasonId && db.prepare('SELECT * FROM repurchase_reasons WHERE id = ? AND account_id = ? AND grp = ?').get(reasonId, lead.account_id, outcome)
  if (!reason) return { ok: false, status: 400, error: 'Escolha o motivo.' }
  const days = nextDays == null ? cycle.remind_days : Number(nextDays)
  if (outcome === 'nao_agora' && !REMIND_DAYS.includes(days)) return { ok: false, status: 400, error: 'Prazo inválido.' }
  const ts = nowSql(now)
  db.transaction(() => {
    let att = openAttempt(db, cycle.id)
    if (!att) {
      db.prepare('INSERT OR IGNORE INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind, contacted_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(lead.account_id, cycle.id, leadId, cycle.attempt, cycle.kind, ts)
      att = openAttempt(db, cycle.id)
    }
    if (att) {
      db.prepare('UPDATE repurchase_attempts SET outcome = ?, reason_id = ?, next_remind_days = ?, decided_at = ?, decided_by = ? WHERE id = ?')
        .run(outcome, reason.id, outcome === 'nao_agora' ? days : null, ts, userId, att.id)
    }
    completeTask(db, cycle.task_id, outcome === 'nao_agora' ? `Não comprou agora: ${reason.label}` : `Não quer mais: ${reason.label}`)
    if (outcome === 'nao_agora') {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'aguardando', attempt = attempt + 1, remind_at = ?, remind_days = ?, task_id = NULL,
          ai_suggestion = NULL, auto_sent_at = NULL, auto_failed_reason = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(addDays(localDate(now), days), days, cycle.id)
      moveToKey(db, lead, 'aguardando', userId)
    } else {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'nao_quer', closed_reason_id = ?, closed_at = ?, closed_by = ?, task_id = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(reason.id, ts, userId, cycle.id)
      db.prepare('UPDATE leads SET repurchase_opt_out = 1 WHERE id = ?').run(leadId)
      moveToKey(db, lead, 'nao_quer', userId)
    }
  })()
  return { ok: true, cycle: db.prepare('SELECT * FROM repurchase_cycles WHERE id = ?').get(cycle.id) }
}

export function undoOptOut(db, { leadId, userId = null, now = new Date() }) {
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return { ok: false, status: 404, error: 'Lead não encontrado.' }
  db.transaction(() => {
    db.prepare('UPDATE leads SET repurchase_opt_out = 0 WHERE id = ?').run(leadId)
    const last = db.prepare("SELECT * FROM repurchase_cycles WHERE lead_id = ? AND status = 'nao_quer' ORDER BY id DESC LIMIT 1").get(leadId)
    if (last && !openCycleForLead(db, leadId)) {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'aguardando', attempt = attempt + 1, remind_at = ?, exhausted = 0,
          closed_reason_id = NULL, closed_at = NULL, closed_by = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(addDays(localDate(now), 7), last.id)
      moveToKey(db, lead, 'aguardando', userId)
    }
  })()
  return { ok: true }
}

export function onMessageExchanged(db, { leadId, now = new Date() }) {
  const c = db.prepare("SELECT * FROM repurchase_cycles WHERE lead_id = ? AND status = 'a_contatar'").get(leadId)
  if (!c) return
  const lead = db.prepare('SELECT id, account_id, stage_id FROM leads WHERE id = ?').get(leadId)
  db.transaction(() => {
    db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa', updated_at = datetime('now') WHERE id = ?").run(c.id)
    db.prepare('UPDATE repurchase_attempts SET contacted_at = COALESCE(contacted_at, ?) WHERE cycle_id = ? AND attempt = ?').run(nowSql(now), c.id, c.attempt)
    if (stageKey(db, lead.stage_id) === 'a_contatar') moveToKey(db, lead, 'em_conversa')
  })()
}

const STATUS_BY_KEY = { aguardando: 'aguardando', a_contatar: 'a_contatar', em_conversa: 'em_conversa' }
export function syncCycleWithStage(db, { leadId, toStageId }) {
  const status = STATUS_BY_KEY[stageKey(db, toStageId)]
  if (!status) return
  db.prepare(`UPDATE repurchase_cycles SET status = ?, updated_at = datetime('now') WHERE lead_id = ? AND ${OPEN_SQL} AND status != ?`).run(status, leadId, status)
}

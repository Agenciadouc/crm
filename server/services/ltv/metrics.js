// Numeros da tela Clientes (spec §10.2). scope = { accountId, attendantId?, geoSql?, geoParams? }.
import { localDate, daysBetween, median, suggestRemindDays, staleBand, dueIso } from './compute.js'
import { lateSql } from './filters.js'

const r2 = n => Math.round(n * 100) / 100
const r1 = n => Math.round(n * 10) / 10

function base(scope) {
  const where = ['l.account_id = ?', 'l.purchases > 0']
  const params = [scope.accountId]
  if (scope.attendantId) { where.push('l.attendant_id = ?'); params.push(scope.attendantId) }
  return { sql: where.join(' AND ') + (scope.geoSql || ''), params: [...params, ...(scope.geoParams || [])] }
}

function periodSales(from, to) {
  const w = []; const p = []
  if (from) { w.push('date(s.sale_date) >= ?'); p.push(from) }
  if (to) { w.push('date(s.sale_date) <= ?'); p.push(to) }
  return { sql: w.length ? ' AND ' + w.join(' AND ') : '', params: p }
}

export function overview(db, scope, { from = null, to = null, now = new Date() } = {}) {
  const b = base(scope); const per = periodSales(from, to)
  const inPeriod = from || to ? ` AND EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = l.id${per.sql})` : ''
  const leads = db.prepare(`SELECT l.id, l.ltv, l.purchases, l.curve, l.tier_id FROM leads l WHERE ${b.sql}${inPeriod}`).all(...b.params, ...per.params)
  const clients = leads.length
  const sales = db.prepare(`SELECT s.value FROM lead_sales s JOIN leads l ON l.id = s.lead_id WHERE ${b.sql}${per.sql}`).all(...b.params, ...per.params)
  const byCurve = Object.fromEntries(['A', 'B', 'C', 'D', '1a'].map(k => [k, { count: 0, ltv: 0 }]))
  for (const l of leads) if (byCurve[l.curve]) { byCurve[l.curve].count++; byCurve[l.curve].ltv = r2(byCurve[l.curve].ltv + l.ltv) }
  const tiers = db.prepare('SELECT id, name, icon, color, min_ltv FROM customer_tiers WHERE account_id = ? ORDER BY min_ltv DESC').all(scope.accountId)
  const byTier = tiers.map(t => {
    const mine = leads.filter(l => l.tier_id === t.id)
    return { id: t.id, name: t.name, icon: t.icon, color: t.color, count: mine.length, ltv: r2(mine.reduce((s, l) => s + l.ltv, 0)) }
  })
  return {
    clients,
    ltvAvg: clients ? r2(leads.reduce((s, l) => s + l.ltv, 0) / clients) : 0,
    ticketAvg: sales.length ? r2(sales.reduce((s, x) => s + x.value, 0) / sales.length) : 0,
    purchasesAvg: clients ? r1(leads.reduce((s, l) => s + l.purchases, 0) / clients) : 0,
    repeatPct: clients ? r1((leads.filter(l => l.purchases >= 2).length / clients) * 100) : 0,
    byCurve, byTier,
    repurchase: repurchaseTiming(db, scope, { from, to }),
  }
}

function repurchaseTiming(db, scope, { from, to }) {
  const b = base(scope); const per = periodSales(from, to)
  const rows = db.prepare(`
    SELECT s.lead_id, s.sale_date, s.remind_days,
      (SELECT MIN(n.sale_date) FROM lead_sales n WHERE n.lead_id = s.lead_id AND date(n.sale_date) > date(s.sale_date)) AS next_date
    FROM lead_sales s JOIN leads l ON l.id = s.lead_id
    WHERE ${b.sql} AND s.sale_kind = 'recompra'${per.sql}
  `).all(...b.params, ...per.params)
  const done = rows.filter(r => r.next_date)
  const medianDays = median(done.map(r => daysBetween(r.sale_date, r.next_date)))
  const markedDays = median(done.map(r => r.remind_days).filter(Boolean))
  return { medianDays, markedDays, cases: done.length, suggestion: suggestRemindDays({ medianDays, markedDays, cases: done.length }) }
}

export function listCustomers(db, scope, { curve = null, tierId = null, late = false, optOut = false, order = 'ltv', limit = 50, offset = 0, now = new Date() } = {}) {
  const b = base(scope)
  const extra = []; const params = []
  if (curve) { extra.push('l.curve = ?'); params.push(curve) }
  if (tierId) { extra.push('l.tier_id = ?'); params.push(Number(tierId)) }
  if (late) { const x = lateSql('l', localDate(now)); extra.push(x.sql); params.push(...x.params) }
  extra.push(optOut ? 'l.repurchase_opt_out = 1' : 'l.repurchase_opt_out = 0')
  const where = `${b.sql} AND ${extra.join(' AND ')}`
  const orderSql = order === 'last_purchase' ? 'l.last_purchase_at DESC' : 'l.ltv DESC'
  const total = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE ${where}`).get(...b.params, ...params).n
  const rows = db.prepare(`
    SELECT l.id, l.name, l.phone, l.ltv, l.purchases, l.last_purchase_at, l.curve, l.tier_id, l.attendant_id,
      u.name AS attendant_name, t.name AS tier_name, t.icon AS tier_icon, t.color AS tier_color,
      rc.status AS cycle_status, rc.remind_at, rc.attempt, rc.kind AS cycle_kind, rc.exhausted
    FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    LEFT JOIN customer_tiers t ON t.id = l.tier_id
    LEFT JOIN repurchase_cycles rc ON rc.lead_id = l.id AND rc.status IN ('aguardando','a_contatar','em_conversa')
    WHERE ${where}
    ORDER BY ${orderSql}, l.id
    LIMIT ? OFFSET ?
  `).all(...b.params, ...params, Math.min(Number(limit) || 50, 200), Number(offset) || 0)
  return { rows, total }
}

export function repurchaseStats(db, scope, { from = null, to = null } = {}) {
  const w = ['a.account_id = ?']; const p = [scope.accountId]
  if (scope.attendantId) { w.push('l.attendant_id = ?'); p.push(scope.attendantId) }
  if (from) { w.push('date(a.created_at) >= ?'); p.push(from) }
  if (to) { w.push('date(a.created_at) <= ?'); p.push(to) }
  const rows = db.prepare(`SELECT a.* FROM repurchase_attempts a JOIN leads l ON l.id = a.lead_id WHERE ${w.join(' AND ')}${scope.geoSql || ''}`).all(...p, ...(scope.geoParams || []))
  const count = f => rows.filter(f).length
  const reasons = {}
  for (const grp of ['nao_agora', 'nao_quer']) {
    reasons[grp] = db.prepare('SELECT id, label FROM repurchase_reasons WHERE account_id = ? AND grp = ? ORDER BY position').all(scope.accountId, grp)
      .map(r => ({ ...r, count: count(a => a.reason_id === r.id) }))
  }
  const byAttempt = { 1: 0, 2: 0, 3: 0, '4+': 0 }
  for (const a of rows.filter(a => a.outcome === 'comprou')) byAttempt[a.attempt >= 4 ? '4+' : a.attempt]++
  const pair = f => ({ total: count(f), comprou: count(a => f(a) && a.outcome === 'comprou') })
  return {
    contacted: rows.length,
    conversa: count(a => !!a.contacted_at),
    comprou: count(a => a.outcome === 'comprou'),
    naoAgora: count(a => a.outcome === 'nao_agora'),
    naoQuer: count(a => a.outcome === 'nao_quer'),
    reasons, byAttempt,
    byKind: { recompra: pair(a => a.kind === 'recompra'), cruzada: pair(a => a.kind === 'cruzada') },
    byAuto: { auto: pair(a => a.auto === 1), manual: pair(a => a.auto !== 1) },
  }
}

export function staleStats(db, scope, { now = new Date() } = {}) {
  const today = localDate(now)
  const b = base(scope)
  const x = lateSql('l', today)
  const lateRows = db.prepare(`SELECT l.id, l.name, l.ltv, l.purchases, l.curve, l.tier_id, l.last_purchase_at FROM leads l WHERE ${b.sql} AND ${x.sql} ORDER BY l.ltv DESC`).all(...b.params, ...x.params)
  const value = r2(lateRows.reduce((s, l) => s + (l.purchases ? l.ltv / l.purchases : 0), 0))
  const all = db.prepare(`SELECT l.id, l.ltv, l.curve, l.tier_id, l.last_purchase_at FROM leads l WHERE ${b.sql} AND l.repurchase_opt_out = 0`).all(...b.params)
  const map = new Map()
  for (const l of all) {
    const band = staleBand(daysBetween(l.last_purchase_at, today))
    if (!band) continue
    const key = `${band}|${l.curve}|${l.tier_id ?? ''}`
    const cur = map.get(key) || { band, curve: l.curve, tierId: l.tier_id ?? null, count: 0, ltv: 0, leadIds: [] }
    cur.count++; cur.ltv = r2(cur.ltv + l.ltv); cur.leadIds.push(l.id)
    map.set(key, cur)
  }
  return { late: { count: lateRows.length, value, rows: lateRows.slice(0, 200) }, bands: [...map.values()] }
}

export function createStaleTasks(db, { accountId, leadIds, userId = null, now = new Date() }) {
  const ids = [...new Set((leadIds || []).map(Number).filter(Boolean))].slice(0, 200)
  const ins = db.prepare(`
    INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `)
  let created = 0
  db.transaction(() => {
    for (const id of ids) {
      const l = db.prepare('SELECT id, name, attendant_id, last_purchase_at FROM leads WHERE id = ? AND account_id = ?').get(id, accountId)
      if (!l) continue
      ins.run(accountId, l.id, l.attendant_id || userId, `Reativar ${l.name || 'cliente'}`, `Cliente parado desde ${l.last_purchase_at || '—'}.`, dueIso(localDate(now), now), userId)
      created++
    }
  })()
  return { created }
}

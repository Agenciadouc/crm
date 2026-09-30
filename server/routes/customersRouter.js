// Tela Clientes, cartao do lead, desfechos e configuracoes da recompra (spec §10, §11).
import { Router } from 'express'
import { cityWhere } from '../services/city.js'
import { validateCurve } from '../services/ltv/compute.js'
import { recalcAccountCustomers } from '../services/ltv/customer.js'
import { recordOutcome, undoOptOut, openCycleForLead } from '../services/ltv/cycles.js'
import { overview, listCustomers, repurchaseStats, staleStats, createStaleTasks } from '../services/ltv/metrics.js'
import { autoSendAvailability } from '../services/ltv/autoSend.js'

const MANAGERS = ['gerente', 'super_admin']

export function createCustomersRouter(db, { aiFor = () => null, broadcast = () => {}, now = () => new Date() } = {}) {
  const router = Router()
  const isManager = req => MANAGERS.includes(req.user.role)
  const managerOnly = (req, res, next) => (isManager(req) ? next() : res.status(403).json({ error: 'Só o gestor pode mudar isso.' }))

  function scopeOf(req) {
    const geo = cityWhere('l', req.query)
    let attendantId = isManager(req) ? (Number(req.query.attendant_id) || null) : req.user.id
    return { accountId: req.accountId, attendantId, geoSql: geo.sql ? ` AND ${geo.sql.replace(/^\s*AND\s+/i, '')}` : '', geoParams: geo.params || [] }
  }
  function leadFor(req, res) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(Number(req.params.leadId), req.accountId)
    if (!lead) { res.status(404).json({ error: 'Lead não encontrado.' }); return null }
    if (!isManager(req) && lead.attendant_id !== req.user.id) { res.status(403).json({ error: 'Sem acesso a este lead.' }); return null }
    return lead
  }
  function settingsOf(accountId) {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
    return {
      curve: { a: a.curve_a_days, b: a.curve_b_days, c: a.curve_c_days },
      maxAttempts: a.repurchase_max_attempts,
      autoSend: !!a.repurchase_auto_send,
      autoAvailable: autoSendAvailability(db, accountId, { ai: aiFor(accountId) }),
    }
  }
  const changed = accountId => { try { broadcast(accountId, 'customers:updated', {}) } catch {} }

  router.use((req, res, next) => (req.accountId ? next() : res.status(400).json({ error: 'account_id required' })))

  router.get('/overview', (req, res) => res.json(overview(db, scopeOf(req), { from: req.query.from || null, to: req.query.to || null, now: now() })))
  router.get('/list', (req, res) => res.json(listCustomers(db, scopeOf(req), {
    curve: req.query.curve || null, tierId: req.query.tier_id || null, late: req.query.late === '1', optOut: req.query.opt_out === '1',
    order: req.query.order, limit: req.query.limit, offset: req.query.offset, now: now(),
  })))
  router.get('/repurchase', (req, res) => res.json(repurchaseStats(db, scopeOf(req), { from: req.query.from || null, to: req.query.to || null })))
  router.get('/stale', (req, res) => res.json(staleStats(db, scopeOf(req), { now: now() })))
  router.post('/stale/tasks', (req, res) => {
    let ids = Array.isArray(req.body?.lead_ids) ? req.body.lead_ids : []
    if (!isManager(req)) {
      ids = ids.filter(id => db.prepare('SELECT 1 FROM leads WHERE id = ? AND attendant_id = ?').get(Number(id), req.user.id))
    }
    const r = createStaleTasks(db, { accountId: req.accountId, leadIds: ids, userId: req.user.id, now: now() })
    res.json(r)
  })

  router.get('/lead/:leadId', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    const tier = lead.tier_id ? db.prepare('SELECT id, name, icon, color FROM customer_tiers WHERE id = ?').get(lead.tier_id) : null
    const cycle = openCycleForLead(db, lead.id)
    const reasons = {}
    for (const grp of ['nao_agora', 'nao_quer']) reasons[grp] = db.prepare('SELECT id, label FROM repurchase_reasons WHERE account_id = ? AND grp = ? AND is_active = 1 ORDER BY position').all(req.accountId, grp)
    const acc = db.prepare('SELECT repurchase_max_attempts FROM accounts WHERE id = ?').get(req.accountId)
    res.json({
      ltv: lead.ltv, purchases: lead.purchases, lastPurchaseAt: lead.last_purchase_at, curve: lead.curve, tier,
      cycle: cycle && { ...cycle, ai_suggestion: cycle.ai_suggestion ? JSON.parse(cycle.ai_suggestion) : null },
      reasons, optOut: !!lead.repurchase_opt_out, maxAttempts: acc?.repurchase_max_attempts ?? 5,
    })
  })
  router.post('/lead/:leadId/outcome', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    const r = recordOutcome(db, { leadId: lead.id, outcome: req.body?.outcome, reasonId: Number(req.body?.reason_id) || null, nextDays: req.body?.next_days ?? null, userId: req.user.id, now: now() })
    if (!r.ok) return res.status(r.status).json({ error: r.error })
    changed(req.accountId); try { broadcast(req.accountId, 'lead:updated', { id: lead.id }) } catch {}
    res.json({ cycle: r.cycle })
  })
  router.post('/lead/:leadId/undo-optout', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    undoOptOut(db, { leadId: lead.id, userId: req.user.id, now: now() })
    changed(req.accountId); try { broadcast(req.accountId, 'lead:updated', { id: lead.id }) } catch {}
    res.json({ ok: true })
  })

  router.get('/settings', (req, res) => res.json(settingsOf(req.accountId)))
  router.put('/settings', managerOnly, (req, res) => {
    const b = req.body || {}
    // Valida TUDO antes de escrever qualquer coisa — uma falha em qualquer campo nao pode
    // deixar escrita parcial (ex.: curva gravada e maxAttempts invalido devolvendo 400).
    let curve = null
    if (b.curve) {
      curve = { a: Number(b.curve.a), b: Number(b.curve.b), c: Number(b.curve.c) }
      const v = validateCurve(curve)
      if (!v.ok) return res.status(400).json({ error: v.error })
    }
    let maxAttempts = null
    if (b.maxAttempts !== undefined) {
      maxAttempts = Number(b.maxAttempts)
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) return res.status(400).json({ error: 'Tentativas: de 1 a 20.' })
    }
    if (b.autoSend !== undefined && b.autoSend) {
      const av = autoSendAvailability(db, req.accountId, { ai: aiFor(req.accountId) })
      if (!av.ok) return res.status(409).json({ error: av.reason === 'no_ai' ? 'Ligue a IA da conta para usar lembretes automáticos.' : 'Conecte um número de disparo (UzAPI ou Oficial) para usar lembretes automáticos.', reason: av.reason })
    }

    // Tudo validado: agora escreve tudo numa unica transacao (tudo ou nada).
    db.transaction(() => {
      if (curve) {
        db.prepare('UPDATE accounts SET curve_a_days = ?, curve_b_days = ?, curve_c_days = ? WHERE id = ?').run(curve.a, curve.b, curve.c, req.accountId)
        recalcAccountCustomers(db, req.accountId, { now: now() })
      }
      if (maxAttempts !== null) {
        db.prepare('UPDATE accounts SET repurchase_max_attempts = ? WHERE id = ?').run(maxAttempts, req.accountId)
      }
      if (b.autoSend !== undefined) {
        db.prepare('UPDATE accounts SET repurchase_auto_send = ? WHERE id = ?').run(b.autoSend ? 1 : 0, req.accountId)
      }
    })()

    changed(req.accountId)
    res.json(settingsOf(req.accountId))
  })

  function tierBody(b) {
    const name = String(b?.name || '').trim().slice(0, 40)
    const min = Number(b?.min_ltv)
    if (!name) return { error: 'Dê um nome ao selo.' }
    if (!Number.isFinite(min) || min <= 0) return { error: 'Informe o valor mínimo gasto.' }
    return { name, min, icon: b.icon ? String(b.icon).slice(0, 8) : null, color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#7E57C2' }
  }
  router.get('/tiers', (req, res) => res.json({ tiers: db.prepare('SELECT * FROM customer_tiers WHERE account_id = ? ORDER BY min_ltv DESC').all(req.accountId) }))
  router.post('/tiers', managerOnly, (req, res) => {
    const t = tierBody(req.body); if (t.error) return res.status(400).json({ error: t.error })
    const id = db.prepare('INSERT INTO customer_tiers (account_id, name, icon, color, min_ltv) VALUES (?, ?, ?, ?, ?)').run(req.accountId, t.name, t.icon, t.color, t.min).lastInsertRowid
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ tier: db.prepare('SELECT * FROM customer_tiers WHERE id = ?').get(id) })
  })
  router.put('/tiers/:id', managerOnly, (req, res) => {
    const t = tierBody(req.body); if (t.error) return res.status(400).json({ error: t.error })
    const r = db.prepare('UPDATE customer_tiers SET name = ?, icon = ?, color = ?, min_ltv = ? WHERE id = ? AND account_id = ?').run(t.name, t.icon, t.color, t.min, Number(req.params.id), req.accountId)
    if (!r.changes) return res.status(404).json({ error: 'Selo não encontrado.' })
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ tier: db.prepare('SELECT * FROM customer_tiers WHERE id = ?').get(Number(req.params.id)) })
  })
  router.delete('/tiers/:id', managerOnly, (req, res) => {
    db.prepare('DELETE FROM customer_tiers WHERE id = ? AND account_id = ?').run(Number(req.params.id), req.accountId)
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ ok: true })
  })

  router.get('/reasons', (req, res) => res.json({ reasons: db.prepare('SELECT * FROM repurchase_reasons WHERE account_id = ? ORDER BY grp, position').all(req.accountId) }))
  router.post('/reasons', managerOnly, (req, res) => {
    const grp = req.body?.grp; const label = String(req.body?.label || '').trim().slice(0, 60)
    if (!['nao_agora', 'nao_quer'].includes(grp) || !label) return res.status(400).json({ error: 'Informe o grupo e o motivo.' })
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM repurchase_reasons WHERE account_id = ? AND grp = ?').get(req.accountId, grp).p
    const id = db.prepare('INSERT INTO repurchase_reasons (account_id, grp, label, position) VALUES (?, ?, ?, ?)').run(req.accountId, grp, label, pos).lastInsertRowid
    res.json({ reason: db.prepare('SELECT * FROM repurchase_reasons WHERE id = ?').get(id) })
  })
  router.put('/reasons/:id', managerOnly, (req, res) => {
    const cur = db.prepare('SELECT * FROM repurchase_reasons WHERE id = ? AND account_id = ?').get(Number(req.params.id), req.accountId)
    if (!cur) return res.status(404).json({ error: 'Motivo não encontrado.' })
    const label = req.body?.label !== undefined ? String(req.body.label).trim().slice(0, 60) : cur.label
    if (!label) return res.status(400).json({ error: 'O motivo não pode ficar vazio.' })
    const active = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : cur.is_active
    const position = Number.isInteger(req.body?.position) ? req.body.position : cur.position
    db.prepare('UPDATE repurchase_reasons SET label = ?, is_active = ?, position = ? WHERE id = ?').run(label, active, position, cur.id)
    res.json({ reason: db.prepare('SELECT * FROM repurchase_reasons WHERE id = ?').get(cur.id) })
  })

  return router
}

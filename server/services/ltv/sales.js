// Registrar / editar / apagar venda (spec §5). Usado pelas rotas de leads.js.
import { REMIND_DAYS } from './schema.js'
import { onSaleCreated, onSaleDeleted } from './cycles.js'
import { activateCycle } from './reminder.js'
import { recalcCustomer } from './customer.js'
import { stageKey } from './funnel.js'

const clip = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n))

export function validateSaleInput(body = {}, { requireKind = true } = {}) {
  const value = parseFloat(body.value)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Informe um valor maior que zero.' }
  const saleKind = body.sale_kind ?? null
  if (saleKind == null && requireKind) return { ok: false, error: 'Marque se é compra única ou se pode recomprar.' }
  if (saleKind != null && !['recompra', 'unica'].includes(saleKind)) return { ok: false, error: 'Tipo de venda inválido.' }
  const crossSell = saleKind === 'unica' && (body.cross_sell === true || body.cross_sell === 1 || body.cross_sell === '1') ? 1 : 0
  const needsDays = saleKind === 'recompra' || crossSell === 1
  const remindDays = needsDays ? Number(body.remind_days) : null
  if (needsDays && !REMIND_DAYS.includes(remindDays)) return { ok: false, error: 'Escolha em quantos dias lembrar: 7, 15, 30, 45 ou 60.' }
  return {
    ok: true,
    fields: {
      value,
      saleDate: body.sale_date ? String(body.sale_date).slice(0, 19).replace('T', ' ') : null,
      notes: clip(body.notes, 500),
      product: clip(body.product, 200),
      saleKind, remindDays, crossSell,
      offer: crossSell ? clip(body.cross_sell_offer, 500) : null,
    },
  }
}

function totalOf(db, leadId) {
  const total = db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM lead_sales WHERE lead_id = ?').get(leadId).t
  db.prepare("UPDATE leads SET value_estimated = ?, updated_at = datetime('now') WHERE id = ?").run(total, leadId)
  return total
}

async function activateIfDue(db, { cycleId, dueNow, ai, now }) {
  if (cycleId && dueNow) await activateCycle(db, { cycleId, ai, now })
}

export async function registerSale(db, { lead, body, userId = null, ai = null, now = new Date() }) {
  const v = validateSaleInput(body)
  if (!v.ok) return { ok: false, status: 400, error: v.error }
  const f = v.fields
  const saleId = Number(db.prepare(`
    INSERT INTO lead_sales (account_id, lead_id, value, sale_date, notes, created_by, product, sale_kind, remind_days, cross_sell, cross_sell_offer)
    VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?)
  `).run(lead.account_id, lead.id, f.value, f.saleDate, f.notes, userId, f.product, f.saleKind, f.remindDays, f.crossSell, f.offer).lastInsertRowid)
  const total = totalOf(db, lead.id)
  const r = onSaleCreated(db, { saleId, userId, now })
  await activateIfDue(db, { ...r, ai, now })
  const sale = db.prepare('SELECT s.*, u.name AS created_by_name FROM lead_sales s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?').get(saleId)
  return { ok: true, sale, total, cycleId: r.cycleId, optOut: r.optOut }
}

export async function patchSale(db, { lead, saleId, body = {}, userId = null, ai = null, now = new Date() }) {
  const sale = db.prepare('SELECT * FROM lead_sales WHERE id = ? AND lead_id = ?').get(saleId, lead.id)
  if (!sale) return { ok: false, status: 404, error: 'Venda não encontrada.' }
  const product = body.product !== undefined ? clip(body.product, 200) : sale.product
  if (body.sale_kind === undefined) {
    db.prepare('UPDATE lead_sales SET product = ? WHERE id = ?').run(product, saleId)
    return { ok: true, sale: db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId) }
  }
  if (sale.sale_kind) return { ok: false, status: 409, error: 'O tipo desta venda já foi marcado.' }
  const v = validateSaleInput({ ...body, value: sale.value })
  if (!v.ok) return { ok: false, status: 400, error: v.error }
  db.prepare('UPDATE lead_sales SET product = ?, sale_kind = ?, remind_days = ?, cross_sell = ?, cross_sell_offer = ? WHERE id = ?')
    .run(product, v.fields.saleKind, v.fields.remindDays, v.fields.crossSell, v.fields.offer, saleId)
  const latest = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC, id DESC LIMIT 1').get(lead.id)
  // So a venda mais recente abre ciclo (uma antiga nao pode "fechar" a recompra de uma mais nova).
  if (latest.id === saleId) {
    const r = onSaleCreated(db, { saleId, userId, now })
    await activateIfDue(db, { ...r, ai, now })
  }
  return { ok: true, sale: db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId) }
}

export function deleteSale(db, { lead, saleId, now = new Date() }) {
  onSaleDeleted(db, { leadId: lead.id, saleId: Number(saleId), now })
  db.prepare('DELETE FROM lead_sales WHERE id = ? AND lead_id = ?').run(saleId, lead.id)
  const total = totalOf(db, lead.id)
  recalcCustomer(db, lead.id, { now })
  return { ok: true, total }
}

export function outcomeStageBlocked(db, toStageId) {
  return ['nao_agora', 'nao_quer'].includes(stageKey(db, toStageId))
}

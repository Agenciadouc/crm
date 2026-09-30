// Tarefa do lembrete de recompra / venda cruzada (spec §7) e sugestao da IA (§7.1).
import { dueIso } from './compute.js'
import { completeTask } from './cycles.js'
import { stageIdByKey, ensureRepurchaseFunnel } from './funnel.js'
import { moveLeadToStage } from '../stageMove.js'
import { toolInput } from '../roteiro/aiCall.js'

const brl = v => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
const brDate = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')

export function reminderTitle({ kind, leadName, product, remindDays }) {
  const name = leadName || 'cliente'
  if (kind === 'cruzada') return `Oferecer relacionados a ${name}${product ? ` (comprou ${product})` : ''}`
  return `Lembrar ${name} da recompra (${product ? `${product}, ` : ''}${remindDays} dias)`
}

export function taskAssignee(db, cycle) {
  const lead = db.prepare('SELECT attendant_id FROM leads WHERE id = ?').get(cycle.lead_id)
  if (lead?.attendant_id) return lead.attendant_id
  const sale = cycle.sale_id && db.prepare('SELECT created_by FROM lead_sales WHERE id = ?').get(cycle.sale_id)
  return sale?.created_by || null
}

const SUGGEST_TOOL = {
  name: 'suggest_offer',
  description: 'Sugere produtos relacionados e uma mensagem curta de WhatsApp para o vendedor enviar.',
  input_schema: {
    type: 'object',
    properties: {
      products: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      message: { type: 'string', description: 'Mensagem curta, em português do Brasil, tom amigável, sem inventar preço.' },
    },
    required: ['products', 'message'],
  },
}

export async function suggestOffer(ai, { accountId, leadId, leadName, product, value, saleDate, notes, offerText, kind }) {
  if (!ai || !ai.isAvailable(accountId)) return null
  const pedido = kind === 'cruzada'
    ? 'O cliente fez uma compra única. Sugira 3 a 5 produtos RELACIONADOS ao que ele comprou e escreva a mensagem oferecendo.'
    : 'O cliente costuma recomprar. Escreva a mensagem lembrando da recompra; em "products" repita o produto comprado.'
  const content = [
    pedido,
    `Cliente: ${leadName || 'cliente'}`,
    `Comprou: ${product || 'não informado'} por ${brl(value)} em ${brDate(saleDate)}`,
    notes ? `Observação da venda: ${notes}` : null,
    offerText ? `O vendedor quer oferecer: ${offerText}` : null,
  ].filter(Boolean).join('\n')
  try {
    const result = await ai.call({
      accountId, leadId, maxTokens: 600, source: 'repurchase_offer',
      systemPrompt: 'Você ajuda vendedores brasileiros a reativar clientes pelo WhatsApp. Responda só pela ferramenta.',
      messages: [{ role: 'user', content }],
      tools: [SUGGEST_TOOL], toolChoice: { type: 'tool', name: 'suggest_offer' },
    })
    const input = toolInput(result, 'suggest_offer')
    if (!input || !Array.isArray(input.products) || typeof input.message !== 'string') return null
    return { products: input.products.map(String).slice(0, 5), message: input.message.trim() }
  } catch (e) {
    console.error('[Recompra] sugestao IA:', e.message)
    return null
  }
}

export async function activateCycle(db, { cycleId, ai = null, now = new Date() }) {
  const cycle = db.prepare('SELECT * FROM repurchase_cycles WHERE id = ?').get(cycleId)
  if (!cycle || cycle.status !== 'aguardando' || cycle.exhausted) return { skipped: true }
  const acc = db.prepare('SELECT repurchase_max_attempts FROM accounts WHERE id = ?').get(cycle.account_id)
  const max = acc?.repurchase_max_attempts ?? 5
  if (cycle.attempt > max) {
    db.prepare("UPDATE repurchase_cycles SET exhausted = 1, updated_at = datetime('now') WHERE id = ?").run(cycle.id)
    return { exhausted: true }
  }
  const lead = db.prepare('SELECT id, account_id, name FROM leads WHERE id = ?').get(cycle.lead_id)
  const sale = (cycle.sale_id && db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(cycle.sale_id)) || {}

  const suggestion = cycle.ai_suggestion ? JSON.parse(cycle.ai_suggestion)
    : (!cycle.offer_text || cycle.kind === 'recompra')
      ? await suggestOffer(ai, { accountId: lead.account_id, leadId: lead.id, leadName: lead.name, product: sale.product, value: sale.value, saleDate: sale.sale_date, notes: sale.notes, offerText: cycle.offer_text, kind: cycle.kind })
      : null

  const offer = cycle.offer_text || (cycle.kind === 'cruzada' && suggestion ? suggestion.products.join(', ') : null)
  const description = [
    `Tentativa ${cycle.attempt} de ${max}`,
    `Última compra: ${sale.product || '—'} · ${brl(sale.value)} em ${brDate(sale.sale_date)}`,
    offer ? `O que oferecer: ${offer}` : null,
    suggestion?.message ? `Mensagem pronta:\n${suggestion.message}` : null,
  ].filter(Boolean).join('\n')

  let taskId = null
  const done = db.transaction(() => {
    const fresh = db.prepare('SELECT status FROM repurchase_cycles WHERE id = ?').get(cycle.id)
    if (fresh.status !== 'aguardando') return false
    taskId = Number(db.prepare(`
      INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, repurchase_cycle_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(cycle.account_id, cycle.lead_id, taskAssignee(db, cycle), reminderTitle({ kind: cycle.kind, leadName: lead.name, product: sale.product, remindDays: cycle.remind_days }), description, dueIso(cycle.remind_at, now), cycle.id).lastInsertRowid)
    db.prepare('INSERT OR IGNORE INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind, task_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cycle.account_id, cycle.id, cycle.lead_id, cycle.attempt, cycle.kind, taskId)
    db.prepare(`UPDATE repurchase_cycles SET status = 'a_contatar', task_id = ?, ai_suggestion = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(taskId, suggestion ? JSON.stringify(suggestion) : null, cycle.id)
    const cur = db.prepare('SELECT funnel_id FROM leads WHERE id = ?').get(cycle.lead_id)
    if (cur.funnel_id === ensureRepurchaseFunnel(db, cycle.account_id)) {
      moveLeadToStage(db, { lead: { id: cycle.lead_id }, toStageId: stageIdByKey(db, cycle.account_id, 'a_contatar'), trigger: 'recompra', gate: false })
    }
    return true
  })()
  return done ? { taskId } : { skipped: true }
}

export { completeTask }

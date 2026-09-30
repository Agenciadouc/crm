// Porta unica de troca de etapa do lead (spec 7.2). Grava historico e chama o hook de
// producao (CAPI, recalculo de nota, asks, SSE). Nao importa server/db.js: recebe db.
import { checkRoteiroGate } from './roteiro/leadRoteiro.js'
import { onStageMoved } from './cadence/leadCadence.js'
import { warnMissingCadenceTable } from './cadence/errors.js'
import { syncCycleWithStage } from './ltv/cycles.js'

let onMovedHook = () => {}

export function configureStageMoveHooks({ onMoved } = {}) {
  onMovedHook = typeof onMoved === 'function' ? onMoved : () => {}
}

// Troca manual (PUT /leads/:id/stage): "avancar mesmo assim" exige motivo e so vale pra gestor/admin.
const FORCE_ROLES = ['gerente', 'super_admin']

export function resolveManualMove({ role, forceReason }) {
  const reason = typeof forceReason === 'string' ? forceReason.trim() : ''
  if (!reason) return { ok: true, force: false, notes: null }
  if (!FORCE_ROLES.includes(role)) return { ok: false, status: 403, error: 'Só o gestor pode avançar sem as respostas.' }
  return { ok: true, force: true, notes: reason.slice(0, 500) }
}

// silent: nao manda o lead:updated deste lead (quem chama avisa depois, ex.: mover em massa).
export function moveLeadToStage(db, { lead, toStageId, trigger, userId = null, notes = null, force = false, gate = true, silent = false }) {
  const current = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)

  const targetStage = db.prepare('SELECT id FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(toStageId, current.funnel_id)
  if (!targetStage) throw new Error('stage_not_in_funnel')

  const fromStageId = current.stage_id
  if (fromStageId === toStageId) return { moved: false, reason: 'same_stage' }

  if (gate && !force) {
    const gateResult = checkRoteiroGate(db, current, toStageId)
    if (!gateResult.ok) return { moved: false, reason: 'roteiro_gate', pending: gateResult.pending }
  }

  let historyId
  db.transaction(() => {
    db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(toStageId, current.id)
    const info = db.prepare(`
      INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(current.id, fromStageId, toStageId, trigger, userId, notes)
    historyId = Number(info.lastInsertRowid)
  })()

  // Cadencia da etapa: fecha a da etapa anterior e abre a da nova (spec 2026-09-27 §4.1).
  // Fora da transacao: se falhar, a troca de etapa continua valendo. Banco sem as tabelas
  // de cadencia: avisa uma vez por processo (mudo nos testes).
  try {
    onStageMoved(db, { leadId: current.id, trigger })
  } catch (e) {
    if (!warnMissingCadenceTable(e)) console.error('[stageMove] cadencia da etapa:', e.message)
  }

  try {
    syncCycleWithStage(db, { leadId: current.id, toStageId })
  } catch (e) {
    console.error('[Recompra] sincronizar ciclo:', e.message)
  }

  try {
    onMovedHook({ db, lead: current, fromStageId, toStageId, historyId, trigger, silent })
  } catch (e) {
    console.error('[stageMove] hook:', e.message)
  }

  return { moved: true, fromStageId, toStageId, historyId }
}

// Troca de FUNIL (recompra, spec 6.2): sem trava de roteiro, mesmo historico e mesmos hooks da troca de etapa.
export function moveLeadToFunnel(db, { lead, toFunnelId, toStageId, trigger, userId = null, notes = null, silent = false }) {
  const current = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)

  const targetStage = db.prepare('SELECT id FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(toStageId, toFunnelId)
  if (!targetStage) throw new Error('stage_not_in_funnel')

  if (current.funnel_id === toFunnelId) {
    return moveLeadToStage(db, { lead: current, toStageId, trigger, userId, notes, gate: false, silent })
  }

  const fromStageId = current.stage_id
  let historyId
  db.transaction(() => {
    db.prepare("UPDATE leads SET funnel_id = ?, stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(toFunnelId, toStageId, current.id)
    const info = db.prepare(`
      INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(current.id, fromStageId, toStageId, trigger, userId, notes)
    historyId = Number(info.lastInsertRowid)
  })()

  try {
    onStageMoved(db, { leadId: current.id, trigger })
  } catch (e) {
    if (!warnMissingCadenceTable(e)) console.error('[stageMove] cadencia da troca de funil:', e.message)
  }

  try {
    onMovedHook({ db, lead: current, fromStageId, toStageId, historyId, trigger, silent })
  } catch (e) {
    console.error('[stageMove] hook:', e.message)
  }

  return { moved: true, fromStageId, toStageId, historyId }
}

// Mover em massa (POST /leads/bulk/stage): um a um pela porta unica (trava do roteiro +
// CAPI/nota pelo hook), sem SSE por lead; no fim UM lead:updated {bulk:true} por conta.
// accountId null (super_admin sem conta) = qualquer conta. Travados nao movem.
export function bulkMoveLeads(db, { accountId = null, leadIds, toStageId, userId = null, broadcast = () => {} }) {
  let moved = 0
  const blocked = []
  const touched = new Set()
  for (const id of leadIds) {
    const lead = accountId
      ? db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(id, accountId)
      : db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
    if (!lead) continue
    try {
      const r = moveLeadToStage(db, { lead, toStageId: Number(toStageId), trigger: 'manual', userId, gate: true, silent: true })
      if (r.moved) { moved++; touched.add(lead.account_id) }
      else if (r.reason === 'roteiro_gate') blocked.push({ id: lead.id, name: lead.name, pending_count: r.pending.length })
    } catch (e) {
      if (e.message !== 'stage_not_in_funnel') throw e
    }
  }
  for (const acc of touched) {
    try { broadcast(acc, 'lead:updated', { bulk: true }) } catch {}
  }
  return { moved, blocked }
}

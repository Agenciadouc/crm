// Porta unica de troca de etapa do lead (spec 7.2). Grava historico e chama o hook de
// producao (CAPI, recalculo de nota, asks, SSE). Nao importa server/db.js: recebe db.
import { checkRoteiroGate } from './roteiro/leadRoteiro.js'

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

export function moveLeadToStage(db, { lead, toStageId, trigger, userId = null, notes = null, force = false, gate = true }) {
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

  try {
    onMovedHook({ db, lead: current, fromStageId, toStageId, historyId, trigger })
  } catch (e) {
    console.error('[stageMove] hook:', e.message)
  }

  return { moved: true, fromStageId, toStageId, historyId }
}

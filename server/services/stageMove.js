// Porta unica de troca de etapa do lead (spec 7.2). Grava historico e chama o hook de
// producao (CAPI, recalculo de nota, asks, SSE). Nao importa server/db.js: recebe db.
import { checkRoteiroGate } from './roteiro/leadRoteiro.js'

let onMovedHook = () => {}

export function configureStageMoveHooks({ onMoved } = {}) {
  onMovedHook = typeof onMoved === 'function' ? onMoved : () => {}
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

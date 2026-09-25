// Avanco automatico de etapa e desfazer (spec 4.4, 7.2). Fica fora de leadRoteiro.js
// para nao criar import circular com stageMove.js (que importa checkRoteiroGate daqui).
// Nao importa server/db.js: recebe db.
import { RoteiroError } from './repo.js'
import { getFunnelStages, safeGetPublishedQuestions } from './leadRoteiro.js'
import { moveLeadToStage } from '../stageMove.js'

// Etapa atual tem >= 1 obrigatoria, todas respondidas, o lead nao esta marcado pra nao
// avancar a partir dela, e a proxima etapa (menor position maior que a atual) existe e
// nao e final: avanca (trigger 'roteiro_auto'). Senao, null.
export function maybeAutoAdvance(db, { accountId, leadId, userId = null }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead || !lead.funnel_id || !lead.stage_id) return null
  if (lead.roteiro_no_auto_from_stage === lead.stage_id) return null

  const stages = getFunnelStages(db, lead.funnel_id)
  const currentStage = stages.find(s => s.id === lead.stage_id)
  if (!currentStage) return null

  const questions = safeGetPublishedQuestions(db, accountId, lead.funnel_id)
  const requiredInStage = questions.filter(q => q.stage_id === lead.stage_id && q.required)
  if (!requiredInStage.length) return null

  const allAnswered = requiredInStage.every(q =>
    db.prepare('SELECT 1 FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, q.question_key)
  )
  if (!allAnswered) return null

  const nextStage = stages
    .filter(s => s.position > currentStage.position)
    .sort((a, b) => a.position - b.position)[0]
  if (!nextStage || nextStage.is_terminal) return null

  const result = moveLeadToStage(db, { lead, toStageId: nextStage.id, trigger: 'roteiro_auto', userId, gate: false })
  if (!result.moved) return null

  return { from: currentStage.id, to: nextStage.id, to_name: nextStage.name }
}

// Volta para a etapa de origem do ultimo avanco automatico, se o lead ainda estiver na
// etapa de destino dele; marca o lead para nao avancar de novo a partir dessa etapa ate
// uma resposta nova ser salva (saveAnswer limpa a marca).
export function undoAutoAdvance(db, { accountId, leadId, userId = null }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new RoteiroError('not_found', 404, 'Lead não encontrado.')

  const lastAuto = db.prepare(`
    SELECT * FROM stage_history WHERE lead_id = ? AND trigger_type = 'roteiro_auto' ORDER BY id DESC LIMIT 1
  `).get(leadId)
  if (!lastAuto || lastAuto.to_stage_id !== lead.stage_id) {
    throw new RoteiroError('nothing_to_undo', 400, 'Não há avanço automático para desfazer.')
  }

  // Move + marca em uma unica transacao (a transacao interna do moveLeadToStage vira
  // savepoint aninhado); o hook onMoved roda uma unica vez, depois do move, ainda dentro
  // desta transacao externa.
  let result
  db.transaction(() => {
    result = moveLeadToStage(db, { lead, toStageId: lastAuto.from_stage_id, trigger: 'roteiro_undo', userId, gate: false })
    db.prepare('UPDATE leads SET roteiro_no_auto_from_stage = ? WHERE id = ?').run(lastAuto.from_stage_id, leadId)
  })()

  return result
}

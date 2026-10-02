// Motor dos sinais de venda por palavra-chave (spec 2026-10-02). Classifica cada mensagem
// inbound, confirma sinais fracos pendentes, grava em lead_signals e avanca a etapa quando
// o sinal e forte o bastante. Nao importa server/db.js: recebe db via os parametros.
import { getFunnelStages } from '../roteiro/leadRoteiro.js'
import { moveLeadToStage } from '../stageMove.js'
import { scheduleScore } from '../leadScore/recalc.js'
import { classifyMessage, findTriggerKeyword, parseKeywordList } from './keywordMatch.js'
import { getPrecedingOutboundRun, confirmPendingWeakSignals, recordSignal } from './repo.js'

function hoursBetween(aIso, bIso) {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 3600000
}

function tryAdvance(db, lead, currentStageId) {
  const stages = getFunnelStages(db, lead.funnel_id)
  const current = stages.find(s => s.id === currentStageId)
  if (!current) return null
  const next = stages.filter(s => s.position > current.position).sort((a, b) => a.position - b.position)[0]
  if (!next || next.is_terminal) return null
  const result = moveLeadToStage(db, { lead, toStageId: next.id, trigger: 'keyword_signal', gate: false })
  if (!result.moved) return null
  return { from: current.id, to: next.id }
}

export function processInboundSignal(db, { account, lead, message }) {
  if (!lead.stage_id) return { type: null, keyword: null, advanced: null }
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!stage) return { type: null, keyword: null, advanced: null }

  const ghostHours = account?.keyword_signal_ghost_hours ?? 24

  // Passo A: confirma sinais fracos pendentes (esta mensagem prova que o lead continuou engajando).
  const confirmInfo = confirmPendingWeakSignals(db, lead.id, ghostHours, message.created_at)
  const confirmedSomething = confirmInfo.changes > 0

  // Passo B: classifica esta mensagem.
  const outboundRun = getPrecedingOutboundRun(db, lead.id, message.id)
    .filter(m => hoursBetween(m.created_at, message.created_at) <= ghostHours)
  const hasArmedTrigger = !!findTriggerKeyword(outboundRun.map(m => m.content), parseKeywordList(stage.trigger_keywords))

  const classification = classifyMessage(message.content, {
    strongKeywords: parseKeywordList(stage.strong_keywords),
    negativeKeywords: parseKeywordList(stage.negative_keywords),
    weakKeywords: parseKeywordList(stage.weak_keywords),
    hasArmedTrigger,
  })

  if (classification.type) {
    recordSignal(db, {
      accountId: account.id, leadId: lead.id, stageId: stage.id,
      signalType: classification.type, keyword: classification.keyword,
      messageId: message.id, createdAt: message.created_at,
    })
  }

  // Negativo nunca avanca etapa (spec §3.4) — mesmo que esta mesma mensagem tambem
  // confirme um sinal fraco pendente (ex.: lead pergunta preco, depois manda "nao quero mais").
  let advanced = null
  if (classification.type !== 'negative' && (classification.type === 'strong' || confirmedSomething)) {
    advanced = tryAdvance(db, lead, stage.id)
  }

  scheduleScore(lead.id)

  return { type: classification.type, keyword: classification.keyword, advanced }
}

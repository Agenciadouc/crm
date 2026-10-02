// Motor dos sinais de venda por palavra-chave (spec 2026-10-02). Classifica cada mensagem
// inbound, confirma sinais fracos pendentes, grava em lead_signals e avanca a etapa quando
// o sinal e forte o bastante. Nao importa server/db.js: recebe db via os parametros.
import { getFunnelStages } from '../roteiro/leadRoteiro.js'
import { moveLeadToStage } from '../stageMove.js'
import { scheduleScore } from '../leadScore/recalc.js'
import { classifyMessage, findTriggerKeyword, parseKeywordList } from './keywordMatch.js'
import { getOutboundWithinWindow, confirmPendingWeakSignals, recordSignal } from './repo.js'

// SQLite 'datetime(...)' grava 'YYYY-MM-DD HH:MM:SS' em UTC sem marcador de fuso -- o
// construtor Date(...) do JS le isso como hora LOCAL (sem o 'Z'), o que encolhe a janela de
// silencio pelo fuso do servidor (ex.: America/Sao_Paulo, UTC-3, tiraria 3h da janela).
// Mesma correcao ja usada em server/services/leadScore/inputs.js (parseSqliteDate).
function parseAsUtcMs(s) {
  return Date.parse(String(s).replace(' ', 'T') + 'Z')
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
  // Sempre reler o lead do banco: quem chama pode ter movido a etapa dele um instante antes
  // (ex.: inboundHandler.js promove a 1a resposta de "Novo Lead" pra "Em Atendimento" via
  // moveLeadToStage ANTES de chamar o motor) -- moveLeadToStage le e atualiza sua PRoPRIA
  // copia do lead, nunca o objeto `lead` recebido aqui, entao confiar nele classificaria com
  // as palavras da etapa errada (a antiga).
  const currentLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id) || lead
  if (!currentLead.stage_id) return { type: null, keyword: null, advanced: null }
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(currentLead.stage_id)
  if (!stage) return { type: null, keyword: null, advanced: null }

  const ghostHours = account?.keyword_signal_ghost_hours ?? 24

  // Passo A: confirma sinais fracos pendentes (esta mensagem prova que o lead continuou engajando).
  const confirmInfo = confirmPendingWeakSignals(db, currentLead.id, ghostHours, message.created_at)
  const confirmedSomething = confirmInfo.changes > 0

  // Passo B: classifica esta mensagem.
  const sinceIso = new Date(parseAsUtcMs(message.created_at) - ghostHours * 3600000).toISOString()
  const outboundRun = getOutboundWithinWindow(db, currentLead.id, message.id, sinceIso)
  const hasArmedTrigger = !!findTriggerKeyword(outboundRun.map(m => m.content), parseKeywordList(stage.trigger_keywords))

  const classification = classifyMessage(message.content, {
    strongKeywords: parseKeywordList(stage.strong_keywords),
    negativeKeywords: parseKeywordList(stage.negative_keywords),
    weakKeywords: parseKeywordList(stage.weak_keywords),
    hasArmedTrigger,
  })

  if (classification.type) {
    recordSignal(db, {
      accountId: account.id, leadId: currentLead.id, stageId: stage.id,
      signalType: classification.type, keyword: classification.keyword,
      messageId: message.id, createdAt: message.created_at,
    })
  }

  // Negativo nunca avanca etapa (spec §3.4) — mesmo que esta mesma mensagem tambem
  // confirme um sinal fraco pendente (ex.: lead pergunta preco, depois manda "nao quero mais").
  let advanced = null
  if (classification.type !== 'negative' && (classification.type === 'strong' || confirmedSomething)) {
    advanced = tryAdvance(db, currentLead, stage.id)
  }

  scheduleScore(currentLead.id)

  return { type: classification.type, keyword: classification.keyword, advanced }
}

// Liga roteiro + termometro no servidor: hook da troca de etapa, avisos de nota e
// efeitos de mensagem recebida/enviada (spec 5.2, 5.5, 6.1, 7.2).
// Nao importa server/db.js: recebe db, broadcastSSE e CAPI na inicializacao.
import { configureStageMoveHooks } from '../stageMove.js'
import { configureScoreRuntime, scheduleScore } from '../leadScore/recalc.js'
import { markAdvanced, markBought, markReplied, recordAsk } from './asks.js'
import { getLeadRoteiro } from './leadRoteiro.js'
import { recognizeQuestion } from './recognize.js'

const DEFAULT_REPLY_WINDOW_H = 24

let scheduleFn = scheduleScore
let aiExtractHandler = () => {}

// Extracao de respostas por IA (Task 13). Ate la, no-op.
export function setAiExtractHandler(fn) {
  aiExtractHandler = typeof fn === 'function' ? fn : () => {}
}

export function enqueueAiExtract(payload) {
  try { aiExtractHandler(payload) } catch (e) { console.error('[Roteiro] extracao IA:', e.message) }
}

// Faixa subiu pra quente/pronto: aviso pro vendedor via SSE.
export function buildOnBandUp(broadcastSSE) {
  return ({ lead, result }) => {
    try {
      broadcastSSE(lead.account_id, 'lead:score_up', {
        lead_id: lead.id, name: lead.name, score: result.score, band: result.band, attendant_id: lead.attendant_id ?? null,
      })
    } catch (e) { console.error('[Termometro] SSE score_up:', e.message) }
  }
}

// Hook unico da troca de etapa: CAPI (so aqui, pra nao duplicar), asks, nota e SSE.
function buildOnMoved({ broadcastSSE, triggerCapiForStageChange }) {
  return ({ db, lead, toStageId, historyId }) => {
    try { triggerCapiForStageChange(lead.id, toStageId, historyId) } catch (e) { console.error('[Roteiro] CAPI:', e.message) }
    try {
      markAdvanced(db, { leadId: lead.id })
      const stage = db.prepare('SELECT is_conversion FROM funnel_stages WHERE id = ?').get(toStageId)
      if (stage && stage.is_conversion) markBought(db, { leadId: lead.id })
    } catch (e) { console.error('[Roteiro] asks na troca de etapa:', e.message) }
    scheduleFn(lead.id)
    try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  }
}

// Chamado 1x no boot do servidor. `schedule` so e trocado em teste.
export function bootRoteiroRuntime({ db, broadcastSSE, triggerCapiForStageChange, schedule }) {
  configureScoreRuntime({ db, onBandUp: buildOnBandUp(broadcastSSE) })
  scheduleFn = typeof schedule === 'function' ? schedule : scheduleScore
  configureStageMoveHooks({ onMoved: buildOnMoved({ broadcastSSE, triggerCapiForStageChange }) })
}

// Mensagem do cliente salva: asks respondidos, nota e extracao por IA.
export function onInboundSaved({ db, account, lead, message }) {
  let windowHours = account?.roteiro_reply_window_h
  if (windowHours == null) {
    const row = db.prepare('SELECT roteiro_reply_window_h FROM accounts WHERE id = ?').get(lead.account_id)
    windowHours = row?.roteiro_reply_window_h ?? DEFAULT_REPLY_WINDOW_H
  }
  markReplied(db, { leadId: lead.id, windowHours })
  scheduleFn(lead.id)
  enqueueAiExtract({ db, account, lead, message })
}

// Mensagem enviada ao lead: nota e fecha o aviso "lead quente sem resposta".
export function onOutboundSaved({ db, lead }) {
  db.prepare(`
    UPDATE analyst_alerts SET status = 'resolved', resolved_at = datetime('now')
    WHERE lead_id = ? AND type = 'lead_quente_sem_resposta' AND status = 'open'
  `).run(lead.id)
  scheduleFn(lead.id)
}

// Envio pelo Chat: com questionKey (botao) grava o ask com a variante vigente;
// sem, tenta reconhecer a pergunta digitada entre as pendentes da etapa atual.
// Devolve { question_key, text } reconhecida ou null.
export function roteiroOnChatSend(db, { lead, userId = null, content, messageId = null, questionKey = null }) {
  const roteiro = getLeadRoteiro(db, { accountId: lead.account_id, leadId: lead.id })
  if (!roteiro.has_roteiro) return null

  if (questionKey) {
    const question = roteiro.stages.flatMap(s => s.questions).find(q => q.question_key === questionKey)
    if (!question) return null
    recordAsk(db, {
      accountId: lead.account_id, leadId: lead.id, questionKey, variant: question.variant,
      textSent: content, messageId, userId, source: 'button',
    })
    return null
  }

  if (!content || !String(content).trim()) return null
  const current = roteiro.stages.find(s => s.is_current)
  if (!current) return null
  const pending = current.questions.filter(q => !q.answer)
  const rec = recognizeQuestion(content, pending)
  return rec ? { question_key: rec.question_key, text: rec.text } : null
}

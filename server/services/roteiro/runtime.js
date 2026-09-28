// Liga roteiro + termometro no servidor: hook da troca de etapa, avisos de nota e
// efeitos de mensagem recebida/enviada (spec 5.2, 5.5, 6.1, 7.2).
// Nao importa server/db.js: recebe db, broadcastSSE e CAPI na inicializacao.
import { configureStageMoveHooks } from '../stageMove.js'
import { configureScoreRuntime, scheduleScore } from '../leadScore/recalc.js'
import { markAdvanced, markBought, markReplied, recordAsk } from './asks.js'
import { getLeadRoteiro } from './leadRoteiro.js'
import { refreshLeadStageCadence } from '../cadence/leadCadence.js'
import { recordStepSend } from '../cadence/metrics.js'
import { recognizeQuestion } from './recognize.js'
import { createExtractQueue, extractAnswers, EXTRACT_DELAY_MS } from './aiExtract.js'

const DEFAULT_REPLY_WINDOW_H = 24

let scheduleFn = scheduleScore
let broadcastFn = () => {}
let aiExtractHandler = () => {}

// Extracao de respostas por IA: no-op ate bootRoteiroAi ligar a fila.
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

// Nota ou faixa mudou (recalculo em tempo real): SSE leve pro termometro e o selo da lista.
export function buildOnScoreChanged(broadcastSSE) {
  return ({ lead, score, band }) => {
    try { broadcastSSE(lead.account_id, 'lead:score', { lead_id: lead.id, score, band }) } catch (e) { console.error('[Termometro] SSE lead:score:', e.message) }
  }
}

// Hook unico da troca de etapa: CAPI (so aqui, pra nao duplicar), asks, nota e SSE (menos se silent).
function buildOnMoved({ broadcastSSE, triggerCapiForStageChange }) {
  return ({ db, lead, toStageId, historyId, silent = false }) => {
    try { triggerCapiForStageChange(lead.id, toStageId, historyId) } catch (e) { console.error('[Roteiro] CAPI:', e.message) }
    try {
      markAdvanced(db, { leadId: lead.id })
      const stage = db.prepare('SELECT is_conversion FROM funnel_stages WHERE id = ?').get(toStageId)
      if (stage && stage.is_conversion) markBought(db, { leadId: lead.id })
    } catch (e) { console.error('[Roteiro] asks na troca de etapa:', e.message) }
    try { scheduleFn(lead.id) } catch (e) { console.error('[Roteiro] agendar nota:', e.message) }
    // silent: quem moveu avisa depois (massa manda 1 SSE; PUT /stage manda o lead completo)
    if (!silent) { try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {} }
  }
}

// Chamado 1x no boot do servidor. `schedule` so e trocado em teste.
export function bootRoteiroRuntime({ db, broadcastSSE, triggerCapiForStageChange, schedule }) {
  configureScoreRuntime({ db, onBandUp: buildOnBandUp(broadcastSSE), onChanged: buildOnScoreChanged(broadcastSSE) })
  scheduleFn = typeof schedule === 'function' ? schedule : scheduleScore
  broadcastFn = typeof broadcastSSE === 'function' ? broadcastSSE : () => {}
  configureStageMoveHooks({ onMoved: buildOnMoved({ broadcastSSE, triggerCapiForStageChange }) })
}

// Liga a extracao por IA (spec 6.4): fila de 2 min por lead -> extractAnswers com o
// adaptador `ai`. Resposta salva ou pergunta fora do roteiro -> nota + SSE lead:roteiro
// {lead_id, offscript, advanced}.
// Chamar depois de bootRoteiroRuntime (usa o broadcastSSE guardado la).
export function bootRoteiroAi({ db, ai, delayMs = EXTRACT_DELAY_MS, setTimer, clearTimer }) {
  const queue = createExtractQueue({
    delayMs, setTimer, clearTimer,
    run: async ({ lead }) => {
      const r = await extractAnswers(db, { accountId: lead.account_id, leadId: lead.id, ai })
      if (!r.saved.length && !r.offscript) return
      if (r.saved.length) {
        try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { if (!/no such table/.test(e.message)) console.error('[Cadencia] proximo passo:', e.message) }
        try { scheduleFn(lead.id) } catch (e) { console.error('[Roteiro] agendar nota:', e.message) }
      }
      // advanced: a IA completou a etapa e o lead avancou -> cartao mostra o banner com Desfazer
      try { broadcastFn(lead.account_id, 'lead:roteiro', { lead_id: lead.id, offscript: r.offscript, advanced: r.advanced || null }) } catch (e) { console.error('[Roteiro] SSE lead:roteiro:', e.message) }
    },
  })
  setAiExtractHandler(queue.enqueue)
  return queue
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

// Envio pelo Chat: com attemptId (botao [Enviar] do passo mensagem) registra o envio do passo;
// com questionKey (botao) grava o ask com a variante vigente; sem nenhum, tenta reconhecer a
// pergunta digitada entre as pendentes da etapa atual. Devolve { question_key, text } ou null.
export function roteiroOnChatSend(db, { lead, userId = null, content, messageId = null, questionKey = null, attemptId = null }) {
  if (attemptId) {
    try {
      if (recordStepSend(db, { lead, attemptId, userId, messageId, content })) {
        broadcastFn(lead.account_id, 'lead:cadence', { lead_id: lead.id })
      }
    } catch (e) { console.error('[Cadencia] envio do passo:', e.message) }
    return null
  }
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

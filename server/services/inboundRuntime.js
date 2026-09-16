// Liga os servicos de entrada (leadIntake, inboundHandler) as dependencias reais (banco, SSE, CAPI, IA).
// Nao importar nos testes.
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { triggerCapiForStageChange } from './metaCapi.js'
import { pickFromRoulette } from './roulette.js'
import { notifyAndOpenLead } from './leadHandoff.js'
import { getInstanceConfig, wasAutoMsgSentRecently, sendAutoMessage, shouldSendAway } from './autoMessages.js'
import { scheduleAiForInbound } from './copilotScheduler.js'
import { getProvider } from './whatsapp/index.js'
import { createLeadIntake } from './leadIntake.js'
import { createInboundHandler } from './inboundHandler.js'

export const leadIntake = createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange })

// Foto de perfil em background (antes em routes/webhooks.js), agora pelo provedor.
async function fetchAndSaveProfilePic(instance, phone, leadId) {
  if (!instance || !phone || !leadId) return
  try {
    const provider = getProvider(instance)
    if (!provider.fetchProfilePictureUrl) return
    const url = await provider.fetchProfilePictureUrl(instance, phone)
    if (url) {
      db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(url, leadId)
    }
  } catch {}
}

// Entrada da IA no tronco unificado: quem recebe a mensagem e o agendador do Copiloto,
// que decide entre agrupar 40s (modo copilot) e disparar na hora (automatico/SDR).
// Devolve promessa porque o inboundHandler faz .catch() no retorno; scheduleAiForInbound
// nao lanca, mas o try/catch evita que uma mudanca futura derrube o processo.
function dispatchAiForInbound(lead, content, mediaType, instanceId) {
  try {
    scheduleAiForInbound(lead, content, mediaType, instanceId)
  } catch (e) {
    console.error('[AI Agent] webhook plug error:', e && e.message)
  }
  return Promise.resolve()
}

const handler = createInboundHandler({
  db,
  broadcastSSE,
  triggerCapiForStageChange,
  getInstanceConfig,
  wasAutoMsgSentRecently,
  sendAutoMessage,
  shouldSendAway,
  processInboundMessage: dispatchAiForInbound,
  pickFromRoulette,
  notifyAndOpenLead,
  getOrCreateLead: leadIntake.getOrCreateLead,
  autoDetectStage: leadIntake.autoDetectStage,
  fetchAndSaveProfilePic,
})

export const handleInboundMessage = handler.handleInboundMessage
export const handleStatusUpdate = handler.handleStatusUpdate

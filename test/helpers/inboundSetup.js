// Handler de entrada real (leadIntake + inboundHandler) com dependencias externas falsas: sem IA, sem SSE, sem CAPI.
import { createLeadIntake } from '../../server/services/leadIntake.js'
import { createInboundHandler } from '../../server/services/inboundHandler.js'

export function createTestInboundHandler(db) {
  const calls = { sse: [], ai: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    triggerCapiForStageChange: () => {},
  })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: () => {},
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: () => Promise.resolve(),
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: () => Promise.resolve(),
  })
  return { handler, calls }
}

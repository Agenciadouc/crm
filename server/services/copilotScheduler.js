// Liga a mensagem recebida no webhook ao Agente de IA.
// Copiloto: espera 40s sem nova mensagem do lead e analisa o bloco inteiro (timer em memoria; 1 processo pm2).
// Automatico / SDR: dispara na hora (comportamento atual).
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { findAgentForLead, processInboundMessage, leadHasHumanAttendant } from './aiAgent.js'
import { resolveEffectiveMode } from './copilotMode.js'
import { createDebouncer } from './leadDebouncer.js'
import { expirePendingForLead } from './aiSuggestions.js'

export const COPILOT_GROUP_DELAY_MS = 40 * 1000

const debouncer = createDebouncer({ delayMs: COPILOT_GROUP_DELAY_MS })

function runNow(leadId, content, mediaType, instanceId) {
  // Rele o lead: pode ter mudado durante a espera (pausa, atendente, etapa)
  const fresh = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!fresh) return Promise.resolve()
  return processInboundMessage(fresh, content, mediaType, instanceId)
    .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
}

export function scheduleAiForInbound(lead, content, mediaType, instanceId) {
  try {
    if (!lead) return
    db.prepare('UPDATE leads SET ai_msgs_since_analysis = COALESCE(ai_msgs_since_analysis, 0) + 1 WHERE id = ? AND account_id = ?').run(lead.id, lead.account_id)

    // Nova mensagem do lead expira a sugestao pendente (o Chat limpa a caixa se ela estiver intacta)
    const expired = expirePendingForLead(db, lead.account_id, lead.id)
    if (expired > 0) {
      try { broadcastSSE(lead.account_id, 'lead:ai_suggestion', { lead_id: lead.id }) } catch {}
    }

    if (lead.ai_paused_at) {
      debouncer.cancel(lead.id)
      return
    }

    const agent = findAgentForLead(lead, instanceId)
    const mode = agent ? resolveEffectiveMode(agent, lead, leadHasHumanAttendant(lead)) : 'auto'
    if (mode === 'copilot') {
      debouncer.schedule(lead.id, () => runNow(lead.id, content, mediaType, instanceId), { agentId: agent.id, accountId: lead.account_id })
      return
    }

    setImmediate(() => {
      try {
        runNow(lead.id, content, mediaType, instanceId)
      } catch (e) {
        console.error('[AI Agent] webhook plug error:', e.message)
      }
    })
  } catch (e) {
    console.error('[Copilot] scheduleAiForInbound erro:', e.message)
  }
}

export function cancelAiTimerForLead(leadId) {
  return debouncer.cancel(leadId)
}

export function cancelAiTimersForAgent(agentId) {
  return debouncer.cancelWhere(meta => meta.agentId === agentId)
}

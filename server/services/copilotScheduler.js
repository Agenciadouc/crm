// Liga a mensagem recebida no webhook ao Agente de IA.
// Copiloto: espera 40s sem nova mensagem do lead e analisa o bloco inteiro (timer em memoria; 1 processo pm2).
// Automatico / SDR: dispara na hora (comportamento atual).
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { findAgentForLead, processInboundMessage, leadHasHumanAttendant } from './aiAgent.js'
import { resolveEffectiveMode } from './copilotMode.js'
import { createDebouncer } from './leadDebouncer.js'
import { expirePendingForLead } from './aiSuggestions.js'
import { transcribeAudio, fetchAudioBuffer } from './deepgramClient.js'
import { lastInboundMessageId } from './blockTranscriber.js'
import { runBlock, resolveBlockMeta } from './copilotBlock.js'

export const COPILOT_GROUP_DELAY_MS = 40 * 1000

const debouncer = createDebouncer({ delayMs: COPILOT_GROUP_DELAY_MS })

function runNow(leadId, content, mediaType, instanceId) {
  // Rele o lead: pode ter mudado durante a espera (pausa, atendente, etapa)
  const fresh = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!fresh) return Promise.resolve()
  return processInboundMessage(fresh, content, mediaType, instanceId)
    .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
}

// Copiloto: ao disparar, analisa TUDO que o lead mandou na janela de 40s — audios
// transcritos + textos, na ordem — em uma unica analise (mediaType 'text', ja e texto).
// A logica fica em copilotBlock.js (testavel); aqui so injetamos as dependencias reais.
function runBlockNow(leadId, instanceId, blockStartMessageId, fallback) {
  return runBlock(db, {
    leadId,
    instanceId,
    blockStartMessageId,
    fallback,
    findAgent: findAgentForLead,
    fetchAudio: fetchAudioBuffer,
    transcribe: transcribeAudio,
    process: processInboundMessage,
    broadcast: (accountId, id) => {
      // leadId (camelCase) e o que o Chat escuta; lead_id mantem os outros ouvintes
      try { broadcastSSE(accountId, 'lead:message', { leadId: id, lead_id: id }) } catch {}
    },
  })
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
      // O meta guarda o inicio do bloco: so e criado quando o bloco comeca (prevMeta null)
      // e sobrevive aos reagendamentos das mensagens seguintes.
      const fallback = { content, mediaType }
      debouncer.schedule(
        lead.id,
        meta => runBlockNow(lead.id, instanceId, meta && meta.blockStartMessageId, fallback)
          .catch(e => console.error('[AI Agent] webhook plug error:', e.message)),
        prevMeta => resolveBlockMeta(
          prevMeta,
          { agentId: agent.id, accountId: lead.account_id },
          // So na 1a mensagem do bloco: a que o webhook acabou de inserir
          () => lastInboundMessageId(db, { accountId: lead.account_id, leadId: lead.id })
        )
      )
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

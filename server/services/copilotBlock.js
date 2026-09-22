// Execucao do bloco do Copiloto: o que roda quando os 40s de silencio do lead terminam.
//
// Testavel: recebe `db` e TODAS as dependencias externas (agente, download/STT, analise,
// broadcast) por parametro. NAO importa server/db.js, deepgramClient.js nem aiAgent.js.

import { loadInboundBlock, transcribeBlock } from './blockTranscriber.js'

/**
 * Meta do debouncer para o bloco.
 * O id da primeira mensagem e criado SO quando o bloco comeca (prevMeta ausente) e
 * herdado em todos os reagendamentos seguintes — inclusive quando ele veio null, para
 * nao recomecar o bloco na segunda mensagem (perdendo a primeira em silencio).
 */
export function resolveBlockMeta(prevMeta, base, findBlockStart) {
  if (prevMeta && Object.prototype.hasOwnProperty.call(prevMeta, 'blockStartMessageId')) {
    return { ...base, blockStartMessageId: prevMeta.blockStartMessageId }
  }
  return { ...base, blockStartMessageId: findBlockStart() }
}

/**
 * Carrega o bloco inteiro do lead, transcreve os audios e manda UMA analise com tudo.
 *
 * @param {Object} db
 * @param {Object} deps
 * @param {number} deps.leadId
 * @param {number|null} deps.instanceId
 * @param {number|null} deps.blockStartMessageId - id da 1a mensagem inbound do bloco
 * @param {{ content: string, mediaType: string }} deps.fallback - conteudo da ultima mensagem (caminho antigo)
 * @param {Function} deps.findAgent   - (lead, instanceId) => agente | null
 * @param {Function} deps.fetchAudio  - async (instance, waMsgIdOrMessage) => { buffer, mimetype }
 * @param {Function} deps.transcribe  - async (buffer, opts) => { ok, transcript, durationSec, costUsd }
 * @param {Function} deps.process     - async (lead, content, mediaType, instanceId, opts) => any
 * @param {Function} [deps.broadcast] - (accountId, leadId) => void, chamado a cada transcricao salva
 */
export async function runBlock(db, {
  leadId, instanceId, blockStartMessageId, fallback = {},
  findAgent, fetchAudio, transcribe, process, broadcast,
} = {}) {
  // Rele o lead: pode ter mudado durante a espera (pausa, atendente, etapa)
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead) return null

  // O vendedor pode ter apertado "Pausar IA" DURANTE os 40s de espera. Aqui o STT ainda
  // nao foi pago: encerra o bloco sem transcrever e sem analisar. Pausou, nao sai dinheiro.
  if (lead.ai_paused_at) {
    console.log(`[Copilot] bloco lead=${lead.id} descartado: IA pausada durante a janela`)
    return null
  }

  // Sem inicio de bloco (id nao encontrado na hora do agendamento): caminho antigo,
  // com a ultima mensagem. Nunca recomeca o bloco no meio.
  if (!blockStartMessageId) {
    return process(lead, fallback.content, fallback.mediaType, instanceId)
  }

  const messages = loadInboundBlock(db, {
    accountId: lead.account_id,
    leadId: lead.id,
    fromMessageId: blockStartMessageId,
  })
  if (!messages.length) {
    // Bloco vazio (mensagem apagada, por exemplo): cai no comportamento antigo
    return process(lead, fallback.content, fallback.mediaType, instanceId)
  }

  const agent = typeof findAgent === 'function' ? findAgent(lead, instanceId) : null
  const inst = instanceId ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId) : null
  // Respeita responds_to_audio: se o dono desligou o audio no agente, nao gasta STT.
  // Os audios entram como '[Audio nao transcrito]' e a analise segue com os textos.
  const canTranscribe = !!(inst && inst.status === 'connected' && agent && agent.responds_to_audio)

  const block = await transcribeBlock(db, {
    accountId: lead.account_id,
    messages,
    fetchAudio: canTranscribe
      ? (msg => fetchAudio(inst, msg.media_url ? { wa_msg_id: msg.wa_msg_id, media_url: msg.media_url } : msg.wa_msg_id))
      : null,
    transcribe: canTranscribe ? transcribe : null,
    onTranscribed: broadcast ? (() => broadcast(lead.account_id, lead.id)) : null,
  })

  if (block.transcribed || block.failed || block.cached) {
    console.log(`[Copilot] bloco lead=${lead.id} msgs=${messages.length} audio_novo=${block.transcribed} audio_cache=${block.cached} audio_falhou=${block.failed} stt=$${block.costUsd.toFixed(4)}`)
  }

  const content = block.text || fallback.content
  // O conteudo ja e texto (audios transcritos). O custo do STT vai junto para o
  // ai_agent_token_log — o dono acompanha custo por cliente nessa tabela.
  return process(lead, content, 'text', instanceId, {
    stt: block.transcribed
      ? { seconds: block.durationSec, costUsd: block.costUsd, provider: 'deepgram' }
      : null,
  })
}

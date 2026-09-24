// Guardas do Copiloto para os subsistemas automaticos (cron).
// Invariante do modo Copiloto: NADA sai para o lead sem o vendedor. Quem cumpre isso no
// fluxo de mensagem e o processInboundMessage, mas os crons tinham caminho proprio:
//   - botAutoRescue redisparava a IA em lead de agente copilot, gerando sugestao fantasma
//     a cada tick (a IA do copiloto nunca grava outbound com ai_agent_id, entao o
//     "ja respondeu?" da query dava sempre falso e o lead ficava candidato para sempre);
//   - inactivityScanner mandava follow-up sozinho para o lead de um agente migrado de
//     auto para copilot (ele tem outbounds antigas com ai_agent_id).
// Este modulo recebe o db por parametro (nao importa server/db.js) para ser testavel.

import { normalizeAgentMode } from './copilotMode.js'
import { SEND_PROVIDERS } from './whatsapp/numberRole.js'

// Agente que pode agir sozinho (mandar mensagem ao lead sem o vendedor).
export function agentSendsWithoutSeller(agent) {
  return !!agent && normalizeAgentMode(agent.mode) !== 'copilot'
}

// Agente de um follow-up de inatividade (modo AGENT). Filtra por conta.
// Retorna null quando o agente nao existe, esta inativo ou e de outra conta.
export function findFollowUpAgent(db, { accountId, agentId }) {
  if (!accountId || !agentId) return null
  const agent = db.prepare(`
    SELECT id, user_id, mode FROM ai_agents
    WHERE id = ? AND account_id = ? AND is_active = 1
  `).get(agentId, accountId)
  return agent || null
}

// Candidatos do auto-rescue: lead com o robo como atendente e inbound sem resposta da IA.
// Filtro novo: se o robo atendente pertence a um agente em modo copilot, o lead NAO entra —
// no copiloto quem responde e o vendedor, e o "sem resposta da IA" e o estado normal.
export function findAutoRescueCandidates(db, { cooldownMin = 25, limit = 100 } = {}) {
  return db.prepare(`
    SELECT l.id, l.account_id
    FROM leads l
    JOIN users u ON u.id = l.attendant_id AND u.is_bot = 1 AND u.is_active = 1
    WHERE l.is_active = 1
      AND COALESCE(l.is_archived, 0) = 0
      AND COALESCE(l.is_blocked, 0) = 0
      AND l.ai_handed_off_at IS NULL
      AND (l.last_rescue_attempt_at IS NULL
           OR l.last_rescue_attempt_at < datetime('now', '-' || ? || ' minutes'))
      AND NOT EXISTS (
        SELECT 1 FROM ai_agents ag
        WHERE ag.user_id = l.attendant_id
          AND ag.account_id = l.account_id
          AND ag.is_active = 1
          AND ag.mode = 'copilot'
      )
      -- Conversa em numero de leitura (Evolution): la so o Copiloto roda, e ele nao e resgatado.
      -- Numero da conversa = o da ultima inbound; sem ele, o ultimo numero do lead.
      AND NOT EXISTS (
        SELECT 1 FROM whatsapp_instances wi
        WHERE wi.id = COALESCE(
            (SELECT m_last.instance_id FROM messages m_last
              WHERE m_last.lead_id = l.id AND m_last.direction = 'inbound'
              ORDER BY m_last.id DESC LIMIT 1),
            l.last_instance_id)
          AND COALESCE(wi.provider, '') NOT IN (${SEND_PROVIDERS.map(p => `'${p}'`).join(', ')})
      )
      AND EXISTS (
        SELECT 1 FROM messages m_in
        WHERE m_in.lead_id = l.id AND m_in.direction = 'inbound'
          AND m_in.created_at > COALESCE(
            (SELECT MAX(created_at) FROM messages m_out
              WHERE m_out.lead_id = l.id AND m_out.direction = 'outbound'
                AND m_out.ai_agent_id IS NOT NULL),
            '1970-01-01'
          )
      )
    ORDER BY l.id
    LIMIT ?
  `).all(cooldownMin, limit)
}

// Desligamento do atendimento da IA (spec 3.10). Recebe o db por parametro. Toda query filtra por conta.
// executeHandoff/notifyAndOpenLead/broadcastSSE sao injetados por quem chama (aiAgent.js passa as
// versoes reais) para manter este modulo testavel sem importar server/db.js.

export const AGENT_OFF_NOTE = 'IA desligada — assuma a conversa'

// Escalonamento entre os leads liberados (mesmo padrao do replayLastMessagesForAgent):
// desligar com centenas de leads nao pode virar rajada de mensagens na instancia.
export const RELEASE_STAGGER_MS = 500

// Leads que estavam com a IA e ainda nao foram passados para um humano
export function findLeadsHeldByAgent(db, { accountId, agentId, agentUserId }) {
  return db.prepare(`
    SELECT l.* FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    WHERE l.account_id = ?
      AND l.is_active = 1
      AND COALESCE(l.is_archived, 0) = 0
      AND COALESCE(l.is_blocked, 0) = 0
      AND l.ai_handed_off_at IS NULL
      AND (
        l.attendant_id = ?
        OR (
          (l.attendant_id IS NULL OR u.is_bot = 1)
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.lead_id = l.id AND m.account_id = l.account_id AND m.ai_agent_id = ?
          )
        )
      )
    ORDER BY l.id
  `).all(accountId, agentUserId || -1, agentId)
}

// Vendedor responsavel: atendente humano ativo da conversa naquela instancia; senao o atendente padrao humano da instancia
export function findResponsibleHumanId(db, { accountId, leadId, instanceId }) {
  if (!instanceId) return null
  const assigned = db.prepare(`
    SELECT u.id FROM lead_instance_assignments a
    JOIN leads l ON l.id = a.lead_id
    JOIN users u ON u.id = a.attendant_id
    WHERE a.lead_id = ? AND a.instance_id = ? AND l.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(leadId, instanceId, accountId)
  if (assigned) return assigned.id
  const byDefault = db.prepare(`
    SELECT u.id FROM whatsapp_instances i
    JOIN users u ON u.id = i.default_attendant_id
    WHERE i.id = ? AND i.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(instanceId, accountId)
  return byDefault ? byDefault.id : null
}

// Atendimento desligado (spec 3.10): cada lead que estava com a IA vai para o vendedor
// responsavel (ou roleta, via executeHandoff sem regra 'agent_off'), com aviso e nota.
// Se nem a roleta (dentro de executeHandoff) achar humano, o lead NAO pode continuar
// apontando pro robo desligado: fica sem atendente (attendant_id = NULL), como um lead
// novo esperando a roleta pegar — apontar pro robo desligado seria estritamente pior.
//
// REGRA DO DONO: desligar ATRIBUI o lead ao humano, NAO REABORDA o lead.
// Por isso todo notifyAndOpenLead deste caminho leva skipFirstMsg: true — sem isso a ETAPA 1
// do leadHandoff mandaria a mensagem-template de primeira abordagem PRO LEAD (qualquer lead
// sem first_msg_sent_at cuja instancia primaria do vendedor seja outra), ou seja: desligar as
// 22h com 200 leads viraria dezenas de abordagens reais fora de hora. Mensagem enviada nao volta.
// As notificacoes tambem sao escalonadas (RELEASE_STAGGER_MS) para nao sair tudo em rajada.
export function releaseLeadsFromAgent(db, agent, { executeHandoff, notifyAndOpenLead, broadcastSSE = () => {}, staggerMs = RELEASE_STAGGER_MS }) {
  if (!agent) return { total: 0, released: 0 }
  const leads = findLeadsHeldByAgent(db, { accountId: agent.account_id, agentId: agent.id, agentUserId: agent.user_id })
  let released = 0
  let dispatched = 0
  for (const lead of leads) {
    try {
      const instanceId = lead.last_instance_id || lead.instance_id || null
      const responsibleId = findResponsibleHumanId(db, { accountId: lead.account_id, leadId: lead.id, instanceId })
      const notifyDelayMs = dispatched * staggerMs
      dispatched++
      if (responsibleId) {
        db.prepare("UPDATE leads SET attendant_id = ?, ai_handed_off_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND account_id = ?")
          .run(responsibleId, lead.id, lead.account_id)
        try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
        setTimeout(() => {
          notifyAndOpenLead(lead.id, responsibleId, { source: 'bot_handoff', skipFirstMsg: true })
            .catch(e => console.error('[Agent off handoff]', e.message))
        }, notifyDelayMs)
      } else {
        executeHandoff(agent, lead, 'agent_off', instanceId, { skipFirstMsg: true, notifyDelayMs })
        // Roleta (dentro do executeHandoff) tambem pode nao achar ninguem humano: confere
        // se o lead continua com o usuario-robo do agente e, se sim, zera o atendente.
        const fresh = db.prepare('SELECT attendant_id FROM leads WHERE id = ? AND account_id = ?').get(lead.id, lead.account_id)
        if (fresh && fresh.attendant_id === agent.user_id) {
          db.prepare("UPDATE leads SET attendant_id = NULL, updated_at = datetime('now') WHERE id = ? AND account_id = ?").run(lead.id, lead.account_id)
        }
      }
      db.prepare('INSERT INTO lead_notes (lead_id, user_id, content) VALUES (?, ?, ?)').run(lead.id, agent.user_id, AGENT_OFF_NOTE)
      released++
    } catch (e) {
      console.error(`[AI Agent] releaseLeadsFromAgent lead=${lead.id}:`, e.message)
    }
  }
  console.log(`[AI Agent] Atendimento desligado agent=${agent.id} leads=${leads.length} passados=${released}`)
  return { total: leads.length, released }
}

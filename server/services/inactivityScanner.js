// Scanner de inatividade: pra cada follow-up tipo 'inactivity' ativo,
// busca leads na etapa configurada que ficaram N dias sem responder e
// agenda envio de 1 variacao de msg pra cada um (com stagger anti-flood).

import db from '../db.js'

function toSqlDate(d) {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19)
}

export async function processInactivityFollowUps() {
  // Aceita 2 modos:
  //  - stage-based (legado): fu.inactivity_stage_id setado, fu.agent_id NULL
  //  - agent-based (novo): fu.agent_id setado (lead atendido pelo bot inativo)
  const followUps = db.prepare(`
    SELECT fu.*, wi.status as instance_status
    FROM follow_ups fu
    LEFT JOIN whatsapp_instances wi ON wi.id = fu.instance_id
    WHERE fu.type = 'inactivity' AND fu.is_active = 1
      AND (fu.inactivity_stage_id IS NOT NULL OR fu.agent_id IS NOT NULL)
  `).all()

  for (const fu of followUps) {
    // Se a instancia ta offline, pula (proximo tick tenta de novo)
    if (fu.instance_status && fu.instance_status !== 'connected') continue

    // Steps ordenados por position. Em modo 'sequence', position=1 é o step inicial.
    // Em modo 'rotation' (legacy), todos são variações da msg unica.
    const steps = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
    const mode = fu.inactivity_mode || 'rotation'
    if (mode === 'rotation' && steps.length < 3) continue // sanidade legacy
    if (mode === 'sequence' && steps.length < 1) continue

    // Threshold em minutos (fallback days*1440 pra back-compat)
    const minutes = fu.inactivity_minutes != null ? fu.inactivity_minutes : (fu.inactivity_days || 2) * 1440

    // Acha leads candidatos — 2 modos isolados
    let candidates
    if (fu.agent_id) {
      // MODO AGENT: lead atendido pelo user-bot do agente, inativo ha >= N min,
      // E que JA TEVE CONVERSA REAL com o bot — ou seja: bot mandou msg E lead respondeu pelo menos 1x.
      // Isso evita disparar follow-up pra leads recem-atribuidos que nunca interagiram.
      const agent = db.prepare('SELECT user_id FROM ai_agents WHERE id = ? AND is_active = 1').get(fu.agent_id)
      if (!agent) continue
      candidates = db.prepare(`
        SELECT l.id, l.name
        FROM leads l
        WHERE l.account_id = ?
          AND l.attendant_id = ?
          AND l.is_active = 1
          AND COALESCE(l.is_archived, 0) = 0
          AND COALESCE(l.is_blocked, 0) = 0
          AND COALESCE(
            (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id),
            l.created_at
          ) <= datetime('now', '-' || ? || ' minutes')
          -- Conversa bidirecional: bot ja mandou pelo menos 1 msg
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.lead_id = l.id AND m.direction = 'outbound' AND m.ai_agent_id = ?
          )
          -- E o lead ja respondeu pelo menos 1 vez (prova que ha conversa de verdade, nao so bot falando sozinho)
          AND EXISTS (
            SELECT 1 FROM messages m2
            WHERE m2.lead_id = l.id AND m2.direction = 'inbound'
          )
          AND NOT EXISTS (
            SELECT 1 FROM lead_follow_ups lfu
            WHERE lfu.lead_id = l.id AND lfu.follow_up_id = ?
              AND lfu.started_at >= COALESCE(
                (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id AND direction = 'inbound'),
                l.created_at
              )
          )
          -- Anti-ban: cooldown 24h apos qualquer inbound do lead (relacao ativa, nao martelar)
          AND NOT EXISTS (
            SELECT 1 FROM messages m_cool
            WHERE m_cool.lead_id = l.id AND m_cool.direction = 'inbound'
              AND m_cool.created_at >= datetime('now', '-24 hours')
          )
        LIMIT 200
      `).all(fu.account_id, agent.user_id, minutes, fu.agent_id, fu.id)
    } else {
      // MODO STAGE (legado, intocado): lead parado na etapa configurada ha N min
      candidates = db.prepare(`
        SELECT l.id, l.name
        FROM leads l
        WHERE l.account_id = ?
          AND l.stage_id = ?
          AND l.is_active = 1
          AND COALESCE(l.is_archived, 0) = 0
          AND COALESCE(l.is_blocked, 0) = 0
          AND COALESCE(
            (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id),
            l.created_at
          ) <= datetime('now', '-' || ? || ' minutes')
          AND NOT EXISTS (
            SELECT 1 FROM lead_follow_ups lfu
            WHERE lfu.lead_id = l.id AND lfu.follow_up_id = ?
              AND lfu.started_at >= COALESCE(
                (SELECT MAX(created_at) FROM stage_history WHERE lead_id = l.id AND to_stage_id = l.stage_id),
                l.created_at
              )
          )
          -- Anti-ban: cooldown 24h apos qualquer inbound do lead
          AND NOT EXISTS (
            SELECT 1 FROM messages m_cool
            WHERE m_cool.lead_id = l.id AND m_cool.direction = 'inbound'
              AND m_cool.created_at >= datetime('now', '-24 hours')
          )
        LIMIT 200
      `).all(fu.account_id, fu.inactivity_stage_id, minutes, fu.id)
    }

    if (candidates.length === 0) continue
    const modeLabel = fu.agent_id ? `agent=${fu.agent_id}` : `stage=${fu.inactivity_stage_id}`
    console.log(`[InactivityScan] Follow-up "${fu.name}" (${modeLabel}, mode=${mode}) — ${candidates.length} candidato(s)`)

    const delaySec = fu.variation_delay_seconds || 30
    const insert = db.prepare(`
      INSERT INTO lead_follow_ups (lead_id, follow_up_id, current_step_id, status, next_run_at, started_at)
      VALUES (?, ?, ?, 'active', ?, datetime('now'))
    `)

    if (mode === 'sequence') {
      // Cada lead começa no step 1 (menor position). Sender avança pra step 2+ se nao responder.
      const firstStep = steps[0]
      candidates.forEach((lead, i) => {
        const nextRun = new Date(Date.now() + i * delaySec * 1000)
        try {
          insert.run(lead.id, fu.id, firstStep.id, toSqlDate(nextRun))
        } catch (e) {
          console.error(`[InactivityScan] Insert err lead=${lead.id}:`, e.message)
        }
      })
    } else {
      // Modo legacy 'rotation': rotaciona variações como one-shot
      const lastExec = db.prepare(`
        SELECT last_executed_step_id FROM lead_follow_ups
        WHERE follow_up_id = ? AND last_executed_step_id IS NOT NULL
        ORDER BY last_executed_at DESC LIMIT 1
      `).get(fu.id)
      let rotIdx = 0
      if (lastExec?.last_executed_step_id) {
        const lastIdx = steps.findIndex(v => v.id === lastExec.last_executed_step_id)
        if (lastIdx >= 0) rotIdx = (lastIdx + 1) % steps.length
      }
      candidates.forEach((lead, i) => {
        const variation = steps[rotIdx % steps.length]
        const nextRun = new Date(Date.now() + i * delaySec * 1000)
        try {
          insert.run(lead.id, fu.id, variation.id, toSqlDate(nextRun))
        } catch (e) {
          console.error(`[InactivityScan] Insert err lead=${lead.id}:`, e.message)
        }
        rotIdx++
      })
    }
  }
}

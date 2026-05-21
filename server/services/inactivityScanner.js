// Scanner de inatividade: pra cada follow-up tipo 'inactivity' ativo,
// busca leads na etapa configurada que ficaram N dias sem responder e
// agenda envio de 1 variacao de msg pra cada um (com stagger anti-flood).

import db from '../db.js'

function toSqlDate(d) {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19)
}

export async function processInactivityFollowUps() {
  const followUps = db.prepare(`
    SELECT fu.*, wi.status as instance_status
    FROM follow_ups fu
    LEFT JOIN whatsapp_instances wi ON wi.id = fu.instance_id
    WHERE fu.type = 'inactivity' AND fu.is_active = 1 AND fu.inactivity_stage_id IS NOT NULL
  `).all()

  for (const fu of followUps) {
    // Se a instancia ta offline, pula (proximo tick tenta de novo)
    if (fu.instance_status && fu.instance_status !== 'connected') continue

    // Variacoes do follow-up (steps, ordenadas por position)
    const variations = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
    if (variations.length < 3) continue // sanidade

    // Acha leads candidatos (na etapa, inativos ha >= N dias, sem follow-up recente)
    const candidates = db.prepare(`
      SELECT l.id, l.name
      FROM leads l
      WHERE l.account_id = ?
        AND l.stage_id = ?
        AND l.is_active = 1
        AND COALESCE(l.is_archived, 0) = 0
        AND COALESCE(l.is_blocked, 0) = 0
        AND COALESCE(
          (SELECT MAX(wa_timestamp) FROM messages WHERE lead_id = l.id),
          l.created_at
        ) <= datetime('now', '-' || ? || ' days')
        AND NOT EXISTS (
          SELECT 1 FROM lead_follow_ups lfu
          WHERE lfu.lead_id = l.id AND lfu.follow_up_id = ?
            AND (
              lfu.status = 'active'
              OR (lfu.last_executed_at IS NOT NULL AND lfu.last_executed_at >= datetime('now', '-' || ? || ' days'))
            )
        )
      LIMIT 200
    `).all(fu.account_id, fu.inactivity_stage_id, fu.inactivity_days, fu.id, fu.inactivity_days)

    if (candidates.length === 0) continue
    console.log(`[InactivityScan] Follow-up "${fu.name}" — ${candidates.length} candidato(s)`)

    // Pega ultima variacao usada pra continuar rotacao
    const lastExec = db.prepare(`
      SELECT last_executed_step_id FROM lead_follow_ups
      WHERE follow_up_id = ? AND last_executed_step_id IS NOT NULL
      ORDER BY last_executed_at DESC LIMIT 1
    `).get(fu.id)
    let rotIdx = 0
    if (lastExec?.last_executed_step_id) {
      const lastIdx = variations.findIndex(v => v.id === lastExec.last_executed_step_id)
      if (lastIdx >= 0) rotIdx = (lastIdx + 1) % variations.length
    }

    const delaySec = fu.variation_delay_seconds || 30
    const insert = db.prepare(`
      INSERT INTO lead_follow_ups (lead_id, follow_up_id, current_step_id, status, next_run_at, started_at)
      VALUES (?, ?, ?, 'active', ?, datetime('now'))
    `)

    candidates.forEach((lead, i) => {
      const variation = variations[rotIdx % variations.length]
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

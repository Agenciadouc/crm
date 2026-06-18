// Cron auto-rescue: a cada 30min varre leads onde o bot deveria ter respondido mas
// ficou travado (cap antigo, race, falha temporaria). Reusa processInboundMessage +
// diagnoseForceAi — mesmo fluxo do botao "Disparar IA", so que automatico.

import db from '../db.js'
import { processInboundMessage, diagnoseForceAi } from './aiAgent.js'

const RESCUE_COOLDOWN_MIN = 25       // nao tenta de novo mesmo lead dentro de N min
const RESCUE_MAX_PER_TICK = 100      // cap por tick — evita rajada se backlog grande

export async function runAutoRescue() {
  const startedAt = Date.now()

  // Candidatos: leads com bot como atendente, inbound sem resposta, cooldown OK
  const candidates = db.prepare(`
    SELECT l.id, l.account_id
    FROM leads l
    JOIN users u ON u.id = l.attendant_id AND u.is_bot = 1 AND u.is_active = 1
    WHERE l.is_active = 1
      AND COALESCE(l.is_archived, 0) = 0
      AND COALESCE(l.is_blocked, 0) = 0
      AND l.ai_handed_off_at IS NULL
      AND (l.last_rescue_attempt_at IS NULL
           OR l.last_rescue_attempt_at < datetime('now', '-${RESCUE_COOLDOWN_MIN} minutes'))
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
    LIMIT ${RESCUE_MAX_PER_TICK}
  `).all()

  if (candidates.length === 0) return

  let processed = 0, skipped = 0, failed = 0

  for (const candidate of candidates) {
    try {
      const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(candidate.id)
      if (!lead) { skipped++; continue }

      // Pega ultimo inbound pra usar como msgContent
      const lastInbound = db.prepare(`
        SELECT content, media_type, instance_id
        FROM messages
        WHERE lead_id = ? AND direction = 'inbound'
        ORDER BY id DESC LIMIT 1
      `).get(lead.id)
      if (!lastInbound) { skipped++; continue }

      // Cascata de instancia: ultima inbound -> last_instance_id -> primeira conectada
      // que algum agente cobre (mesma logica do /force-ai-respond)
      let instanceId = lastInbound.instance_id || lead.last_instance_id || null
      if (!instanceId) {
        const inst = db.prepare(`
          SELECT wi.id FROM whatsapp_instances wi
          WHERE wi.account_id = ? AND wi.status = 'connected'
            AND EXISTS (
              SELECT 1 FROM ai_agent_instances aai
              JOIN ai_agents ag ON ag.id = aai.agent_id
              WHERE aai.instance_id = wi.id AND ag.is_active = 1 AND ag.account_id = wi.account_id
            )
          ORDER BY wi.id LIMIT 1
        `).get(lead.account_id)
        instanceId = inst?.id || null
      }
      if (!instanceId) { skipped++; continue }

      // Diagnostico — se ha blockers (etapa errada, tag faltando, instancia nao
      // configurada, etc), pula silenciosamente. Cron e defensivo.
      const diag = diagnoseForceAi(lead, instanceId)
      if (diag.blockers.length > 0) {
        db.prepare("UPDATE leads SET last_rescue_attempt_at = datetime('now') WHERE id = ?").run(lead.id)
        skipped++
        console.log(`[AutoRescue] lead=${lead.id} skip: ${diag.blockers[0]}`)
        continue
      }

      // Marca tentativa ANTES de disparar (cooldown vale mesmo se falhar)
      db.prepare("UPDATE leads SET last_rescue_attempt_at = datetime('now') WHERE id = ?").run(lead.id)

      // Dispara bot — reusa processInboundMessage (typing, presence, anti-ban, tudo)
      const result = await processInboundMessage(
        lead,
        lastInbound.content || '',
        lastInbound.media_type || 'text',
        instanceId
      )

      if (result && result.ok === false) {
        failed++
        const reasonStr = result.sendReason ? `${result.reason} (${result.sendReason})` : result.reason
        console.log(`[AutoRescue] lead=${lead.id} falhou: ${reasonStr}`)
      } else {
        processed++
        console.log(`[AutoRescue] lead=${lead.id} account=${lead.account_id} agent disparado`)
      }
    } catch (e) {
      failed++
      console.error(`[AutoRescue] lead=${candidate.id} exception:`, e.message)
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`[AutoRescue] tick processed=${processed} skipped=${skipped} failed=${failed} total_candidates=${candidates.length} elapsed=${elapsedSec}s`)
}

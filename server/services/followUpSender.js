// Envio automatico de follow-ups (cadencias automaticas de mensagens WhatsApp).
// Chamado pelo scheduler.processFollowUps() quando next_run_at chega.
// Reusa padrao de envio do broadcasts (POST pra Evolution API).

import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { sendViaInstance } from './leadHandoff.js'

// Substitui variaveis no template: {{nome}}, {{primeiro_nome}}
function renderTemplate(template, lead) {
  if (!template) return ''
  const fullName = lead?.name || ''
  const firstName = fullName.split(' ')[0] || ''
  return template
    .replace(/\{\{nome\}\}/g, fullName)
    .replace(/\{\{name\}\}/g, fullName)
    .replace(/\{\{primeiro_nome\}\}/g, firstName)
    .replace(/\{\{first_name\}\}/g, firstName)
}

// Escolhe texto da variação se step.variations tem array. Fallback message_template.
function pickVariationText(step) {
  if (step?.variations) {
    try {
      const arr = JSON.parse(step.variations)
      if (Array.isArray(arr) && arr.length > 0) return arr[Math.floor(Math.random() * arr.length)]
    } catch {}
  }
  return step?.message_template || ''
}

function pauseLeadFollowUp(leadFollowUpId, reason) {
  db.prepare("UPDATE lead_follow_ups SET status='paused', paused_at=datetime('now'), paused_reason=?, updated_at=datetime('now') WHERE id=?").run(reason, leadFollowUpId)
}

function cancelLeadFollowUp(leadFollowUpId, reason) {
  db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason=?, current_step_id=NULL, next_run_at=NULL, updated_at=datetime('now') WHERE id=?").run(reason, leadFollowUpId)
}

// Lock em memoria pra evitar processamento duplicado se 2 ticks rodarem ao mesmo tempo
const sending = new Set()

export async function sendFollowUpMessage(leadFollowUpId) {
  if (sending.has(leadFollowUpId)) return
  sending.add(leadFollowUpId)

  try {
    const lfu = db.prepare("SELECT * FROM lead_follow_ups WHERE id = ?").get(leadFollowUpId)
    if (!lfu || lfu.status !== 'active') return
    if (!lfu.current_step_id) {
      // Sem step atual = ja completou. Marca como tal.
      db.prepare("UPDATE lead_follow_ups SET status='completed', next_run_at=NULL WHERE id=?").run(leadFollowUpId)
      return
    }

    const step = db.prepare("SELECT * FROM follow_up_steps WHERE id = ?").get(lfu.current_step_id)
    if (!step) {
      cancelLeadFollowUp(leadFollowUpId, 'step_missing')
      return
    }

    const followUp = db.prepare("SELECT * FROM follow_ups WHERE id = ?").get(lfu.follow_up_id)
    if (!followUp || !followUp.is_active) {
      pauseLeadFollowUp(leadFollowUpId, 'follow_up_inactive')
      return
    }

    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lfu.lead_id)
    if (!lead) {
      cancelLeadFollowUp(leadFollowUpId, 'lead_deleted')
      return
    }
    if (!lead.phone) {
      pauseLeadFollowUp(leadFollowUpId, 'lead_no_phone')
      console.log(`[FollowUp] Pausado lead=${lead.id} — sem telefone`)
      return
    }
    // Pausa se lead foi bloqueado/arquivado/desativado APOS atribuicao (em vez de cancelar silencioso)
    if (lead.is_blocked) {
      pauseLeadFollowUp(leadFollowUpId, 'lead_blocked')
      console.log(`[FollowUp] Pausado lead=${lead.id} — lead bloqueado`)
      return
    }
    if (lead.is_archived) {
      pauseLeadFollowUp(leadFollowUpId, 'lead_archived')
      console.log(`[FollowUp] Pausado lead=${lead.id} — lead arquivado`)
      return
    }
    if (!lead.is_active) {
      pauseLeadFollowUp(leadFollowUpId, 'lead_inactive')
      console.log(`[FollowUp] Pausado lead=${lead.id} — lead inativo`)
      return
    }

    const instance = followUp.instance_id
      ? db.prepare("SELECT * FROM whatsapp_instances WHERE id = ?").get(followUp.instance_id)
      : null

    if (!instance) {
      pauseLeadFollowUp(leadFollowUpId, 'instance_removed')
      return
    }
    if (instance.status !== 'connected') {
      pauseLeadFollowUp(leadFollowUpId, 'instance_offline')
      return
    }

    // Renderiza msg (escolhe variação aleatoria se step.variations existe, senao usa message_template)
    const text = renderTemplate(pickVariationText(step), lead)

    // Envia via sendViaInstance (pre-flight de numero + cache + tratamento consistente)
    const sendRes = await sendViaInstance(instance, lead.phone, text, { leadId: lead.id })
    if (!sendRes.ok) {
      // Numero invalido OU Evolution recusou — pausa pra atendente investigar.
      // Registra a tentativa como 'failed' pra UI mostrar X vermelho no historico.
      const errLabel = sendRes.validationFailed ? 'number_not_on_whatsapp' : (sendRes.reason || 'send_failed')
      console.error(`[FollowUp] Envio recusado lead=${lead.id} step=${step.id}: ${errLabel}`)
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, follow_up_id, delivery_status)
        VALUES (?, ?, 'outbound', ?, 'text', 'Follow-up auto', NULL, datetime('now'), ?, ?, 'failed')
      `).run(lead.id, lead.account_id, text, instance.id, followUp.id)
      pauseLeadFollowUp(leadFollowUpId, sendRes.validationFailed ? 'number_not_on_whatsapp' : 'send_failed')
      return
    }
    const wamsgId = sendRes.wamsgId

    // Salva em messages (igual broadcasts). follow_up_id: V2 analytics — sinaliza msg automática de cadência.
    // delivery_status='sent' → webhook promove pra delivered/read OU cron de 10min marca failed se Whats nao confirmar.
    db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, follow_up_id, delivery_status)
      VALUES (?, ?, 'outbound', ?, 'text', 'Follow-up auto', ?, datetime('now'), ?, ?, 'sent')
    `).run(lead.id, lead.account_id, text, wamsgId, instance.id, followUp.id)

    // Inactivity-rotation (legacy): one-shot, NAO avanca pra proximo step (cada execucao = uma variacao independente)
    // Inactivity-sequence (novo): comporta como sequence — avanca pra step 2, 3...
    const isInactivityRotation = (followUp.type === 'inactivity') && (followUp.inactivity_mode || 'rotation') === 'rotation'
    if (isInactivityRotation) {
      db.prepare(`
        UPDATE lead_follow_ups SET
          status = 'completed',
          current_step_id = NULL,
          last_executed_at = datetime('now'),
          last_executed_step_id = ?,
          next_run_at = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(step.id, leadFollowUpId)
      try { broadcastSSE(lead.account_id, 'followup:completed', { lead_id: lead.id, follow_up_id: followUp.id }) } catch {}
      try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
      return
    }

    // Sequence (e Inactivity-sequence): avanca pro proximo step (respeita modo absolute/relative)
    const nextStep = db.prepare("SELECT * FROM follow_up_steps WHERE follow_up_id = ? AND position > ? ORDER BY position ASC LIMIT 1").get(followUp.id, step.position)
    if (nextStep) {
      // computeNextRun: se mode='absolute' usa scheduled_at, senao now+delay
      let nextRunDate
      if (nextStep.schedule_mode === 'absolute' && nextStep.scheduled_at) {
        const target = new Date(nextStep.scheduled_at.replace(' ', 'T') + (nextStep.scheduled_at.endsWith('Z') ? '' : 'Z'))
        nextRunDate = (isNaN(target.getTime()) || target.getTime() < Date.now()) ? new Date() : target
      } else {
        nextRunDate = new Date(Date.now() + (nextStep.delay_minutes || 0) * 60_000)
      }
      const nextRun = nextRunDate.toISOString().replace('T', ' ').slice(0, 19)
      db.prepare(`
        UPDATE lead_follow_ups SET
          current_step_id = ?,
          last_executed_at = datetime('now'),
          last_executed_step_id = ?,
          next_run_at = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(nextStep.id, step.id, nextRun, leadFollowUpId)
      try { broadcastSSE(lead.account_id, 'followup:advanced', { lead_id: lead.id, follow_up_id: followUp.id, current_step_id: nextStep.id }) } catch {}
    } else {
      // Concluido
      db.prepare(`
        UPDATE lead_follow_ups SET
          status = 'completed',
          current_step_id = NULL,
          last_executed_at = datetime('now'),
          last_executed_step_id = ?,
          next_run_at = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(step.id, leadFollowUpId)
      try { broadcastSSE(lead.account_id, 'followup:completed', { lead_id: lead.id, follow_up_id: followUp.id }) } catch {}
    }

    // Notifica chat pra atualizar
    try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
  } finally {
    sending.delete(leadFollowUpId)
  }
}

// Reativacao quando instancia volta a conectar (chamado por scheduler.checkWhatsAppInstances)
export function resumeFollowUpsIfPaused(instanceId) {
  const paused = db.prepare(`
    SELECT lfu.id FROM lead_follow_ups lfu
    JOIN follow_ups fu ON fu.id = lfu.follow_up_id
    WHERE fu.instance_id = ?
      AND lfu.status = 'paused'
      AND lfu.paused_reason IN ('instance_offline', 'instance_removed', 'send_failed', 'send_error')
  `).all(instanceId)
  if (paused.length === 0) return
  console.log(`[FollowUp] Retomando ${paused.length} follow-up(s) — instancia ${instanceId} reconectou`)
  for (const p of paused) {
    db.prepare("UPDATE lead_follow_ups SET status='active', paused_at=NULL, paused_reason=NULL, next_run_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(p.id)
  }
}

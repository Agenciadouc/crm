// Helper de distribuicao de lead: dispara primeira msg + notificacao ao vendedor
// quando lead eh atribuido (por roleta, bot, follow-up reply, ou manual).
//
// Comportamento idempotente: primeira msg sai 1x por lead (lead.first_msg_sent_at).
// Notificacao ao vendedor eh independente: sempre dispara se notification_instance_id configurado.

import db from '../db.js'
import fetch from 'node-fetch'

function getNotifierInstanceId() {
  // 1o: tenta app_settings (configuravel via UI super_admin)
  try {
    const row = db.prepare("SELECT value FROM app_settings WHERE key='notifier_instance_id'").get()
    if (row?.value) {
      const n = parseInt(row.value)
      if (!isNaN(n) && n > 0) return n
    }
  } catch {}
  // 2o: fallback pra env var (back-compat / setup inicial)
  const fromEnv = parseInt(process.env.NOTIFIER_INSTANCE_ID || '0')
  return (!isNaN(fromEnv) && fromEnv > 0) ? fromEnv : null
}

function renderTemplate(tpl, vars) {
  if (!tpl) return ''
  return tpl
    .replace(/\{\{primeiro_nome\}\}/g, vars.lead_first_name || '')
    .replace(/\{\{nome\}\}/g, vars.lead_name || '')
    .replace(/\{\{vendedor\}\}/g, vars.user_name || '')
    .replace(/\{\{vendedor_primeiro_nome\}\}/g, vars.user_first_name || '')
    .replace(/\{\{cidade\}\}/g, vars.city || '')
    .replace(/\{\{phone\}\}/g, vars.phone || '')
    .replace(/\{\{etapa\}\}/g, vars.stage_name || '')
    .replace(/\{\{funil\}\}/g, vars.funnel_name || '')
}

async function sendViaInstance(instance, phone, text) {
  const number = (phone || '').replace(/[^\d]/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')
  if (!number) return { ok: false, reason: 'phone vazio' }
  try {
    const res = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
      body: JSON.stringify({ number, text, delay: 2000 }),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: !!data.key?.id, wamsgId: data.key?.id || null, raw: data }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

const SOURCE_LABELS = {
  webhook: 'novo lead',
  bot_handoff: 'transferido do bot',
  followup_reply: 'respondeu follow-up',
  manual_assign: 'atribuido manualmente',
}

/**
 * Dispara primeira msg + notificacao ao atribuir lead a um vendedor.
 *
 * @param {number} leadId
 * @param {number} attendantUserId
 * @param {Object} [opts]
 * @param {string} [opts.source] - 'webhook'|'bot_handoff'|'followup_reply'|'manual_assign' (log + label notif)
 * @param {boolean} [opts.forceFirstMsg] - se true, ignora flag idempotencia
 */
export async function notifyAndOpenLead(leadId, attendantUserId, opts = {}) {
  try {
    const lead = db.prepare('SELECT * FROM leads WHERE id=?').get(leadId)
    if (!lead || !lead.phone) return

    const user = db.prepare('SELECT id, name, primary_instance_id, notification_instance_id, is_bot, is_active FROM users WHERE id=?').get(attendantUserId)
    if (!user || user.is_bot || !user.is_active) return

    // Pega etapa + funil atual do lead (pra mostrar na notif)
    const stageInfo = lead.stage_id ? db.prepare(`
      SELECT s.name as stage_name, f.name as funnel_name
      FROM funnel_stages s LEFT JOIN funnels f ON f.id = s.funnel_id
      WHERE s.id = ?
    `).get(lead.stage_id) : null

    const vars = {
      lead_name: lead.name || '',
      lead_first_name: (lead.name || '').split(' ')[0],
      user_name: user.name || '',
      user_first_name: (user.name || '').split(' ')[0],
      city: lead.city || '',
      phone: lead.phone || '',
      stage_name: stageInfo?.stage_name || '',
      funnel_name: stageInfo?.funnel_name || '',
    }

    // ETAPA 1: Primeira msg pro lead via primary_instance do vendedor
    // Skip se: opts.skipFirstMsg (manual sem checkbox), vendedor sem primary, mesma inst do lead, ja foi enviada
    const shouldSendFirstMsg = (
      !opts.skipFirstMsg &&
      user.primary_instance_id &&
      user.primary_instance_id !== lead.instance_id &&  // skip se mesma inst (caso Oxi)
      (!lead.first_msg_sent_at || opts.forceFirstMsg)
    )

    if (shouldSendFirstMsg) {
      const vendInst = db.prepare("SELECT * FROM whatsapp_instances WHERE id=? AND status='connected'").get(user.primary_instance_id)
      if (vendInst) {
        // Template resolution: funnel.template (override) > instance.template
        const funnelTpl = lead.funnel_id ? db.prepare('SELECT first_msg_template FROM funnels WHERE id=?').get(lead.funnel_id) : null
        const tpl = funnelTpl?.first_msg_template || vendInst.first_msg_template
        if (tpl && tpl.trim()) {
          const text = renderTemplate(tpl, vars)
          if (text.trim()) {
            const r = await sendViaInstance(vendInst, lead.phone, text)
            if (r.ok) {
              db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, instance_id)
                          VALUES (?, ?, 'outbound', ?, 'text', ?, ?, ?)`)
                .run(lead.id, lead.account_id, text, user.name, r.wamsgId, vendInst.id)
              // CRITICO: muda last_instance_id pro chat abrir na inst certa
              db.prepare("UPDATE leads SET last_instance_id=?, first_msg_sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
                .run(vendInst.id, lead.id)
              db.prepare(`INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)`)
                .run(lead.id, vendInst.id, user.id)
              console.log(`[Handoff] 1a msg lead=${lead.id} via ${vendInst.instance_name} (vendedor=${user.name}) source=${opts.source || '?'}`)
            } else {
              console.error(`[Handoff] 1a msg FALHOU lead=${lead.id}:`, r.reason || JSON.stringify(r.raw).substring(0, 150))
            }
          }
        }
      }
    } else if (user.primary_instance_id === lead.instance_id) {
      console.log(`[Handoff] 1a msg SKIP lead=${lead.id} — mesma inst do vendedor (${user.name}) source=${opts.source || '?'}`)
    }

    // ETAPA 2: Notificacao pro vendedor (INDEPENDENTE da primeira msg)
    const NOTIFIER_ID = getNotifierInstanceId()
    if (NOTIFIER_ID && user.notification_instance_id) {
      const notifier = db.prepare("SELECT * FROM whatsapp_instances WHERE id=? AND status='connected'").get(NOTIFIER_ID)
      const userInst = db.prepare('SELECT phone_number FROM whatsapp_instances WHERE id=?').get(user.notification_instance_id)
      if (notifier && userInst?.phone_number) {
        const cityPart = vars.city ? ` • ${vars.city}` : ''
        const stagePart = vars.stage_name
          ? `\n🎯 ${vars.funnel_name ? vars.funnel_name + ' → ' : ''}${vars.stage_name}`
          : ''
        const sourceLabel = SOURCE_LABELS[opts.source] || 'novo lead'
        const text = `📩 ${sourceLabel.charAt(0).toUpperCase() + sourceLabel.slice(1)}: ${vars.lead_name || vars.phone} (${vars.phone})${cityPart}${stagePart}\n\nAbra o CRM pra continuar a conversa.`
        const r = await sendViaInstance(notifier, userInst.phone_number, text)
        if (r.ok) console.log(`[Handoff] Notif lead=${lead.id} -> ${user.name} source=${opts.source || '?'}`)
        else console.error(`[Handoff] Notif FALHOU lead=${lead.id}:`, r.reason || JSON.stringify(r.raw).substring(0, 150))
      }
    }
  } catch (err) {
    console.error('[Handoff] notifyAndOpenLead erro:', err.message)
  }
}

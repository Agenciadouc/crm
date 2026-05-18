import fetch from 'node-fetch'
import db from '../db.js'

// Aplica variaveis no texto da auto-mensagem
function firstName(s) {
  if (!s) return ''
  return String(s).split(' ')[0] || s
}

export function applyVars(text, lead, instance) {
  if (!text) return text
  return String(text)
    .replace(/\{\{name\}\}/g, lead?.name || 'Cliente')
    .replace(/\{\{primeiro_nome\}\}/g, firstName(lead?.name) || 'Cliente')
    .replace(/\{\{first_name\}\}/g, firstName(lead?.name) || 'Cliente')
    .replace(/\{\{phone\}\}/g, lead?.phone || '')
    .replace(/\{\{empresa\}\}/g, lead?.empresa || '')
    .replace(/\{\{cidade\}\}/g, lead?.city || '')
    .replace(/\{\{instance\}\}/g, instance?.instance_name || '')
    .replace(/\{\{atendente\}\}/g, lead?.attendant_name || 'nosso time')
    .replace(/\{\{attendant\}\}/g, lead?.attendant_name || 'nosso time')
    .replace(/\{\{atendente_nome\}\}/g, firstName(lead?.attendant_name) || 'nosso time')
}

// Pega config da instancia (ou null se nao tiver)
export function getInstanceConfig(instanceId) {
  if (!instanceId) return null
  return db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instanceId) || null
}

// Verifica se ja enviou auto-msg desse tipo pra esse lead nas ultimas N horas
export function wasAutoMsgSentRecently(leadId, type, hoursCooldown) {
  if (!leadId || !type) return false
  const since = `datetime('now', '-${parseInt(hoursCooldown) || 0} hours')`
  const row = db.prepare(`SELECT id FROM auto_messages_log WHERE lead_id = ? AND type = ? AND sent_at >= ${since} LIMIT 1`).get(leadId, type)
  return !!row
}

// Decide se deve enviar ausencia agora (apenas por horario — modo manual foi removido)
export function shouldSendAway(cfg, now = new Date()) {
  if (!cfg?.away_enabled) return false
  let schedule = null
  try { schedule = cfg.away_schedule_json ? JSON.parse(cfg.away_schedule_json) : null } catch {}
  if (!schedule || typeof schedule !== 'object') return false
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const key = dayKeys[now.getDay()]
  const slots = schedule[key]
  // Sem slots ou array vazio = SEMPRE ausente nesse dia
  if (!Array.isArray(slots) || slots.length === 0) return true
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const cur = `${hh}:${mm}`
  for (const slot of slots) {
    if (slot?.start && slot?.end && cur >= slot.start && cur <= slot.end) return false
  }
  return true // fora dos slots = ausente
}

// Envia auto-msg via Evolution + grava em messages + grava em log
// Retorna { ok, error?, messageId? }
export async function sendAutoMessage({ leadId, instanceId, type, text, accountId }) {
  if (!leadId || !instanceId || !type || !text) {
    return { ok: false, error: 'missing_params' }
  }

  const lead = db.prepare(`
    SELECT l.*, u.name as attendant_name
    FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    WHERE l.id = ?
  `).get(leadId)
  if (!lead) return { ok: false, error: 'lead_not_found' }

  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!instance) return { ok: false, error: 'instance_not_found' }
  if (instance.status !== 'connected') return { ok: false, error: 'instance_not_connected' }

  const finalText = applyVars(text, lead, instance)
  const targetPhone = lead.phone || lead.wa_remote_jid?.replace(/@.*$/, '')
  if (!targetPhone) return { ok: false, error: 'no_phone' }

  try {
    const url = `${instance.api_url}/message/sendText/${instance.instance_name}`
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ number: targetPhone, text: finalText }),
      timeout: 10000,
    })
    const respData = await r.json().catch(() => ({}))
    if (!r.ok) {
      console.error(`[AutoMsg ${type}] lead=${leadId} falha HTTP ${r.status}:`, JSON.stringify(respData).substring(0, 200))
      return { ok: false, error: `HTTP ${r.status}` }
    }

    const waMsgId = respData?.key?.id || respData?.messageId || null

    // Salva na tabela messages com marcação especial
    const msgResult = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, instance_id)
      VALUES (?, ?, 'outbound', ?, 'text', 'Auto-Sistema', ?, ?)
    `).run(lead.id, accountId || lead.account_id, finalText, waMsgId, instanceId)

    const messageId = msgResult.lastInsertRowid

    // Grava no log
    db.prepare(`
      INSERT INTO auto_messages_log (lead_id, instance_id, account_id, type, message_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(lead.id, instanceId, accountId || lead.account_id, type, messageId)

    console.log(`[AutoMsg ${type}] lead=${leadId} instance=${instanceId} enviado ok (msg_id=${messageId})`)
    return { ok: true, messageId }
  } catch (err) {
    console.error(`[AutoMsg ${type}] lead=${leadId} erro fatal:`, err.message)
    return { ok: false, error: err.message }
  }
}

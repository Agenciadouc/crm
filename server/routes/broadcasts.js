import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

const MIN_VARIATIONS = 3 // total messages: principal + 2 variations minimum
const MIN_DELAY_SECONDS = 8
const DEFAULT_DELAY_SECONDS = 15

// List broadcasts
router.get('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const broadcasts = db.prepare(`
    SELECT b.*, w.instance_name as instance_name, w.status as instance_status
    FROM broadcasts b
    LEFT JOIN whatsapp_instances w ON w.id = b.instance_id
    WHERE b.account_id = ?
    ORDER BY b.created_at DESC
  `).all(req.accountId)
  res.json({ broadcasts })
})

// Create broadcast
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, message_template, message_variations, media_url, lead_ids, delay_seconds, instance_id, scheduled_at } = req.body
  if (!name || !message_template) return res.status(400).json({ error: 'name e message_template obrigatorios' })

  // Valida instancia (deve existir e pertencer a conta)
  if (!instance_id) return res.status(400).json({ error: 'Selecione um numero de saida (instancia WhatsApp)' })
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instance_id, req.accountId)
  if (!instance) return res.status(400).json({ error: 'Instancia invalida pra esta conta' })

  // Valida minimo de variacoes (principal + N variacoes >= MIN_VARIATIONS mensagens diferentes)
  const variationsArr = Array.isArray(message_variations) ? message_variations.filter(v => v && v.trim()) : []
  const totalMessages = 1 + variationsArr.length
  if (totalMessages < MIN_VARIATIONS) {
    return res.status(400).json({ error: `Minimo ${MIN_VARIATIONS} mensagens diferentes (1 principal + ${MIN_VARIATIONS - 1} variacoes). Voce tem ${totalMessages}.` })
  }

  // Valida delay minimo
  let delay = parseInt(delay_seconds) || DEFAULT_DELAY_SECONDS
  if (delay < MIN_DELAY_SECONDS) delay = MIN_DELAY_SECONDS

  const variationsJson = variationsArr.length > 0 ? JSON.stringify(variationsArr) : null

  // Valida agendamento (opcional). Aceita ISO string. Tem que ser >= now+60s pra evitar race com scheduler.
  let scheduledAtISO = null
  let initialStatus = 'draft'
  if (scheduled_at) {
    const d = new Date(scheduled_at)
    if (isNaN(d.getTime())) return res.status(400).json({ error: 'scheduled_at invalido' })
    if (d.getTime() < Date.now() + 60_000) return res.status(400).json({ error: 'Agendamento precisa ser pelo menos 1min no futuro' })
    // Salva em UTC formato SQLite compativel: 'YYYY-MM-DD HH:MM:SS'
    scheduledAtISO = d.toISOString().replace('T', ' ').slice(0, 19)
    initialStatus = 'scheduled'
  }

  const result = db.prepare(`
    INSERT INTO broadcasts (account_id, name, message_template, message_variations, delay_seconds, media_url, total_count, created_by, instance_id, status, scheduled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.accountId, name, message_template, variationsJson, delay, media_url || null, lead_ids?.length || 0, req.user.id, instance_id, initialStatus, scheduledAtISO)

  // Add recipients (only opted-in leads)
  let skippedNoOptin = 0
  if (lead_ids && Array.isArray(lead_ids)) {
    const stmt = db.prepare('INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone) VALUES (?, ?, ?)')
    for (const leadId of lead_ids) {
      const lead = db.prepare('SELECT phone, opted_in_at, opted_out_at FROM leads WHERE id = ? AND phone IS NOT NULL AND is_archived = 0 AND is_blocked = 0').get(leadId)
      if (!lead) continue
      if (lead.opted_out_at && (!lead.opted_in_at || lead.opted_out_at > lead.opted_in_at)) { skippedNoOptin++; continue }
      stmt.run(result.lastInsertRowid, leadId, lead.phone)
    }
    db.prepare('UPDATE broadcasts SET total_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = ?) WHERE id = ?').run(result.lastInsertRowid, result.lastInsertRowid)
  }

  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(result.lastInsertRowid)
  res.json({ broadcast, skippedNoOptin })
})

// Clone data — retorna config + lead_ids pra pre-preencher modal de criar (duplicar disparo)
router.get('/:id/clone-data', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })

  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!broadcast) return res.status(404).json({ error: 'Broadcast nao encontrado' })

  const recipients = db.prepare('SELECT lead_id FROM broadcast_recipients WHERE broadcast_id = ?').all(broadcast.id)
  const leadIds = recipients.map(r => r.lead_id).filter(Boolean)

  // Filtra apenas leads que ainda existem, ativos e nao arquivados (snapshot pode estar obsoleto)
  let validLeads = []
  if (leadIds.length) {
    const placeholders = leadIds.map(() => '?').join(',')
    validLeads = db.prepare(`SELECT id, name, phone, email, city, source, stage_id, attendant_id, instance_id, last_instance_id, created_at, updated_at, is_active FROM leads WHERE id IN (${placeholders}) AND account_id = ? AND is_active = 1 AND is_archived = 0 AND is_blocked = 0`).all(...leadIds, req.accountId)
  }

  let variations = []
  try { variations = broadcast.message_variations ? JSON.parse(broadcast.message_variations) : [] } catch {}

  res.json({
    clone: {
      name: `${broadcast.name} (cópia)`,
      message_template: broadcast.message_template,
      message_variations: variations,
      media_url: broadcast.media_url || null,
      delay_seconds: broadcast.delay_seconds,
      instance_id: broadcast.instance_id,
      leads: validLeads, // objetos completos pra o front popular selectedLeads direto
    },
    original: {
      total_count: broadcast.total_count,
      valid_leads_now: validLeads.length,
    },
  })
})

// Get broadcast detail (com info de instancia + recipients enriquecidos)
router.get('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const broadcast = db.prepare(`
    SELECT b.*, w.instance_name as instance_name, w.status as instance_status, u.name as created_by_name
    FROM broadcasts b
    LEFT JOIN whatsapp_instances w ON w.id = b.instance_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE b.id = ?
  `).get(req.params.id)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })

  const recipients = db.prepare(`
    SELECT br.*, l.name as lead_name
    FROM broadcast_recipients br
    LEFT JOIN leads l ON br.lead_id = l.id
    WHERE br.broadcast_id = ?
    ORDER BY br.id ASC
  `).all(broadcast.id)

  res.json({ broadcast, recipients })
})

// Lock em memoria pra evitar loops duplicados
const runningLoops = new Set()

// ─── Loop interno de envio (chamado por send + retomada automatica) ──
export async function runBroadcastLoop(broadcastId) {
  if (runningLoops.has(broadcastId)) {
    console.log(`[Broadcast] Loop ${broadcastId} ja em execucao, ignorando duplicata`)
    return
  }
  runningLoops.add(broadcastId)
  try {
    await runBroadcastLoopInner(broadcastId)
  } finally {
    runningLoops.delete(broadcastId)
  }
}

async function runBroadcastLoopInner(broadcastId) {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcastId)
  if (!broadcast) return
  if (broadcast.status !== 'sending') return // apenas se esta marcado como enviando

  const instance = broadcast.instance_id
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(broadcast.instance_id)
    : null

  if (!instance || instance.status !== 'connected') {
    // Pausa: sem instancia ou desconectada
    const reason = !instance ? 'Instancia removida' : `Instancia ${instance.instance_name} desconectada`
    db.prepare("UPDATE broadcasts SET paused_at = datetime('now'), paused_reason = ? WHERE id = ?").run(reason, broadcastId)
    broadcastSSE(broadcast.account_id, 'broadcast:paused', { id: broadcastId, reason })
    return
  }

  // Marca started_at no primeiro disparo
  if (!broadcast.started_at) {
    db.prepare("UPDATE broadcasts SET started_at = datetime('now') WHERE id = ?").run(broadcastId)
  }

  // Limpa pausa anterior (caso seja retomada)
  if (broadcast.paused_at) {
    db.prepare("UPDATE broadcasts SET paused_at = NULL, paused_reason = NULL WHERE id = ?").run(broadcastId)
  }

  const variations = broadcast.message_variations ? JSON.parse(broadcast.message_variations) : []
  const allTemplates = [broadcast.message_template, ...variations].filter(Boolean)
  const baseDelay = (broadcast.delay_seconds || DEFAULT_DELAY_SECONDS) * 1000

  // Usa offset baseado em sent_count + failed_count pra continuar de onde parou
  let processedCount = (broadcast.sent_count || 0) + (broadcast.failed_count || 0)

  while (true) {
    // Re-checa instancia conectada antes de cada envio
    const liveInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(broadcast.instance_id)
    if (!liveInstance || liveInstance.status !== 'connected') {
      const reason = !liveInstance ? 'Instancia removida' : `Instancia ${liveInstance.instance_name} desconectada`
      db.prepare("UPDATE broadcasts SET paused_at = datetime('now'), paused_reason = ? WHERE id = ?").run(reason, broadcastId)
      broadcastSSE(broadcast.account_id, 'broadcast:paused', { id: broadcastId, reason })
      return
    }

    // Pega proximo recipient pendente
    const r = db.prepare("SELECT * FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1").get(broadcastId)
    if (!r) break // todos processados

    try {
      const lead = db.prepare('SELECT name FROM leads WHERE id = ?').get(r.lead_id)
      const template = allTemplates[processedCount % allTemplates.length]
      const text = template.replace(/\{\{name\}\}/g, lead?.name || 'Cliente')
      const number = (r.phone || '').replace(/[^\d]/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')

      const sendRes = await fetch(`${liveInstance.api_url}/message/sendText/${liveInstance.instance_name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': liveInstance.api_key },
        body: JSON.stringify({ number, text }),
      })
      const data = await sendRes.json()

      if (data.key?.id) {
        db.prepare("UPDATE broadcast_recipients SET status = 'sent', wa_msg_id = ?, sent_at = datetime('now') WHERE id = ?").run(data.key.id, r.id)
        db.prepare("UPDATE leads SET last_broadcast_at = datetime('now') WHERE id = ?").run(r.lead_id)
        db.prepare('UPDATE broadcasts SET sent_count = sent_count + 1 WHERE id = ?').run(broadcastId)
      } else {
        db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").run(JSON.stringify(data).substring(0, 500), r.id)
        db.prepare('UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = ?').run(broadcastId)
      }
      processedCount++
      broadcastSSE(broadcast.account_id, 'broadcast:progress', { id: broadcastId })
    } catch (err) {
      db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?").run(String(err.message).substring(0, 500), r.id)
      db.prepare('UPDATE broadcasts SET failed_count = failed_count + 1 WHERE id = ?').run(broadcastId)
      processedCount++
    }

    // Delay aleatorio dentro de +/- 30% pra parecer humano
    const jitter = baseDelay * (0.7 + Math.random() * 0.6)
    await new Promise(resolve => setTimeout(resolve, jitter))
  }

  // Concluido
  const finalCounts = db.prepare('SELECT sent_count, failed_count FROM broadcasts WHERE id = ?').get(broadcastId)
  db.prepare("UPDATE broadcasts SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(broadcastId)
  broadcastSSE(broadcast.account_id, 'broadcast:completed', { id: broadcastId, sent: finalCounts.sent_count, failed: finalCounts.failed_count })
}

// Send broadcast — dispara imediato (so funciona em draft; pra agendado precisa cancelar agendamento antes)
router.post('/:id/send', requireRole('super_admin', 'gerente'), async (req, res) => {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })
  if (broadcast.status === 'scheduled') return res.status(400).json({ error: 'Disparo esta agendado. Cancele o agendamento antes de enviar agora.' })
  if (broadcast.status !== 'draft') return res.status(400).json({ error: 'Disparo ja enviado ou em andamento' })

  if (!broadcast.instance_id) return res.status(400).json({ error: 'Disparo sem instancia configurada' })
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(broadcast.instance_id)
  if (!instance) return res.status(400).json({ error: 'Instancia nao encontrada' })
  if (instance.status !== 'connected') return res.status(400).json({ error: `Instancia "${instance.instance_name}" nao esta conectada. Conecte antes de enviar.` })

  db.prepare("UPDATE broadcasts SET status = 'sending', started_at = datetime('now') WHERE id = ?").run(broadcast.id)

  const recipientsCount = db.prepare("SELECT COUNT(*) as c FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending'").get(broadcast.id).c
  res.json({ ok: true, message: `Enviando para ${recipientsCount} contatos...` })

  // Roda loop em background
  runBroadcastLoop(broadcast.id).catch(err => console.error('[Broadcast] Loop error:', err))
})

// Retoma broadcast pausado (usado pelo scheduler quando instancia reconecta)
export function resumeBroadcastIfPaused(instanceId) {
  const paused = db.prepare("SELECT * FROM broadcasts WHERE instance_id = ? AND status = 'sending' AND paused_at IS NOT NULL").all(instanceId)
  for (const b of paused) {
    console.log(`[Broadcast] Retomando disparo "${b.name}" (id=${b.id}) — instancia ${instanceId} reconectou`)
    runBroadcastLoop(b.id).catch(err => console.error('[Broadcast] Resume error:', err))
  }
}

// Recovery no boot: pega disparos zumbis (status=sending mas ninguem processando)
// Acontece quando o servidor reinicia durante envio
export function recoverPendingBroadcasts() {
  const zombies = db.prepare("SELECT * FROM broadcasts WHERE status = 'sending'").all()
  if (zombies.length === 0) return
  console.log(`[Broadcast] Recovery no boot: encontrados ${zombies.length} disparo(s) em andamento. Retomando...`)
  for (const b of zombies) {
    // Limpa pause anterior (servidor caiu) e relanca
    db.prepare("UPDATE broadcasts SET paused_at = NULL, paused_reason = NULL WHERE id = ?").run(b.id)
    runBroadcastLoop(b.id).catch(err => console.error('[Broadcast] Boot recovery error:', err))
  }
}

// Endpoint manual de retomar (caso queira forcar)
router.post('/:id/resume', requireRole('super_admin', 'gerente'), async (req, res) => {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(req.params.id)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })
  if (broadcast.status !== 'sending') return res.status(400).json({ error: 'Disparo nao esta em andamento' })
  // Limpa pause se houver
  db.prepare("UPDATE broadcasts SET paused_at = NULL, paused_reason = NULL WHERE id = ?").run(broadcast.id)
  res.json({ ok: true })
  runBroadcastLoop(broadcast.id).catch(err => console.error('[Broadcast] Resume error:', err))
})

// Cancelar agendamento — volta pra draft, limpa scheduled_at
router.post('/:id/cancel-schedule', requireRole('super_admin', 'gerente'), (req, res) => {
  const broadcast = db.prepare('SELECT * FROM broadcasts WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!broadcast) return res.status(404).json({ error: 'Disparo nao encontrado' })
  if (broadcast.status !== 'scheduled') return res.status(400).json({ error: 'Disparo nao esta agendado (status: ' + broadcast.status + ')' })
  db.prepare("UPDATE broadcasts SET status = 'draft', scheduled_at = NULL WHERE id = ?").run(broadcast.id)
  const updated = db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(broadcast.id)
  res.json({ broadcast: updated })
})

// Delete broadcast — permite draft OU scheduled (cancela e apaga)
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  db.prepare("DELETE FROM broadcasts WHERE id = ? AND status IN ('draft', 'scheduled')").run(req.params.id)
  res.json({ ok: true })
})

export default router

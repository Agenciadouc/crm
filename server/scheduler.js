import fetch from 'node-fetch'
import db from './db.js'
import { broadcastSSE } from './sse.js'
import { resumeBroadcastIfPaused, runBroadcastLoop } from './routes/broadcasts.js'
import { triggerCapiForStageChange } from './services/metaCapi.js'

// Roda a cada 1min — precisao do agendamento <= 60s. Custo desprezivel (1 SELECT/min).
const INTERVAL_MS = 60 * 1000

// ─── Check WhatsApp instances + auto-reconnect ─────────────────
async function checkWhatsAppInstances() {
  // First check if Evolution API is alive
  let evolutionAlive = false
  try {
    const r = await fetch('http://127.0.0.1:8080/', { timeout: 5000 })
    evolutionAlive = r.ok || r.status === 401 || r.status === 404
  } catch {
    console.error('[Health] Evolution API is DOWN — cannot check instances')
    return
  }

  const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status IN ('connected', 'connecting')").all()
  for (const inst of instances) {
    try {
      const r = await fetch(`${inst.api_url}/instance/connectionState/${encodeURIComponent(inst.instance_name)}`, {
        headers: { apikey: inst.api_key },
      })
      const data = await r.json()
      const state = data?.instance?.state || ''
      let newStatus = 'disconnected'
      if (state === 'open' || state === 'connected') newStatus = 'connected'
      else if (state === 'connecting') newStatus = 'connecting'
      else if (state === 'close' || state === 'closed') newStatus = 'disconnected'

      if (newStatus !== inst.status) {
        db.prepare("UPDATE whatsapp_instances SET status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, inst.id)
        console.log(`[Health] ${inst.instance_name}: ${inst.status} → ${newStatus}`)
        // Se reconectou, retoma broadcasts pausados desta instancia
        if (newStatus === 'connected' && inst.status !== 'connected') {
          try { resumeBroadcastIfPaused(inst.id) } catch (e) { console.error('[Health] Resume broadcast error:', e.message) }
        }
      }

      // AUTO-RECONNECT: if was connected but now disconnected/closed, try to reconnect
      if (inst.status === 'connected' && (newStatus === 'disconnected' || state === 'close' || state === 'closed')) {
        console.log(`[Health] ${inst.instance_name} — connection lost, attempting auto-reconnect...`)
        try {
          const reconnectRes = await fetch(`${inst.api_url}/instance/connect/${encodeURIComponent(inst.instance_name)}`, {
            headers: { apikey: inst.api_key },
          })
          const reconnectData = await reconnectRes.json()
          if (reconnectData?.instance?.state === 'open' || reconnectData?.instance?.state === 'connecting') {
            db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(inst.id)
            console.log(`[Health] ${inst.instance_name} — reconnect initiated successfully`)
          } else {
            console.log(`[Health] ${inst.instance_name} — reconnect response:`, JSON.stringify(reconnectData).substring(0, 150))
          }
        } catch (reconnectErr) {
          console.error(`[Health] ${inst.instance_name} — reconnect failed:`, reconnectErr.message)
        }
      }
    } catch (err) {
      console.error(`[Health] ${inst.instance_name} — check failed:`, err.message)
      // If check fails, mark as disconnected so we try to reconnect next cycle
      if (inst.status === 'connected') {
        db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', updated_at = datetime('now') WHERE id = ?").run(inst.id)
      }
    }
  }
}

// ─── Execute due cadence steps ───────────────────────────────────
async function processCadences() {
  // Find all active lead_cadences with current_attempt_id set
  const active = db.prepare(`
    SELECT lc.*, ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes, ca.action_type, ca.auto_message,
      l.phone, l.name as lead_name, l.account_id
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    WHERE lc.status = 'active' AND l.is_active = 1
  `).all()

  const now = new Date()

  for (const row of active) {
    // Anchor for current step: last_executed_at (previous step done time) OR started_at (step 1)
    const anchorIso = row.last_executed_attempt_id && row.last_executed_at ? row.last_executed_at : row.started_at
    const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')
    let target

    if (row.schedule_mode === 'duration') {
      target = new Date(anchor.getTime() + (row.delay_minutes || 0) * 60000)
    } else {
      target = new Date(anchor)
      target.setDate(target.getDate() + (row.delay_days || 0))
      if (row.scheduled_time) {
        const [h, m] = row.scheduled_time.split(':').map(Number)
        target.setUTCHours((h || 0) + 3, m || 0, 0, 0) // America/Sao_Paulo UTC-3
      } else if ((row.delay_days || 0) > 0) {
        target.setUTCHours(3, 0, 0, 0) // midnight local = 03:00 UTC
      }
    }

    // Only execute if target time has passed
    if (now < target) continue
    // Skip if this attempt was already executed (last_executed_attempt_id === current_attempt_id)
    if (row.last_executed_attempt_id === row.current_attempt_id) continue

    // Auto-send DISABLED — all cadence messages are manual only (via Tasks/Chat button)
    // Just notify that the task is due
    broadcastSSE(row.account_id, 'task:due', { lead_cadence_id: row.id, lead_id: row.lead_id })
    console.log(`[Scheduler] Task due: lead #${row.lead_id} attempt #${row.current_attempt_id} (${row.action_type})`)
  }
}

// sendCadenceMessage REMOVED — all sending is manual only via Chat/Tasks buttons

// ─── Execute scheduled broadcasts ────────────────────────────────
// Quando scheduled_at <= now, marca como 'sending' e chama runBroadcastLoop real (mesmo loop do envio manual:
// jitter, pause/recovery, variacoes, SSE progress). Garante que agendado != qualidade inferior.
async function processScheduledBroadcasts() {
  const due = db.prepare(`
    SELECT id, name, instance_id, account_id FROM broadcasts
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND datetime(scheduled_at) <= datetime('now')
  `).all()

  for (const b of due) {
    // Confere se a instancia ta conectada — se nao, deixa scheduled mesmo (proximo tick tenta de novo)
    const instance = db.prepare("SELECT status, instance_name FROM whatsapp_instances WHERE id = ?").get(b.instance_id)
    if (!instance || instance.status !== 'connected') {
      console.log(`[Scheduler] Broadcast #${b.id} (${b.name}) — instancia ${instance?.instance_name || b.instance_id} desconectada, aguardando proximo tick`)
      continue
    }
    console.log(`[Scheduler] Disparando broadcast agendado #${b.id}: ${b.name}`)
    db.prepare("UPDATE broadcasts SET status = 'sending', started_at = datetime('now') WHERE id = ?").run(b.id)
    runBroadcastLoop(b.id).catch(err => console.error('[Scheduler] Broadcast loop error:', err.message))
  }
}

// ─── Polling backup: fetch missed messages from Evolution ────────
async function pollMissedMessages() {
  const instances = db.prepare("SELECT wi.*, a.id as acc_id, a.slug FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id WHERE wi.status = 'connected'").all()
  if (!instances.length) return

  // Import getOrCreateLead from webhooks logic inline
  function normalizePhone(p) {
    if (!p) return p
    p = p.replace(/[^\d]/g, '')
    if (p.startsWith('55') && p.length === 13) return p
    if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
    if (!p.startsWith('55') && p.length === 11) return '55' + p
    if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
    return p // can't normalize safely — return as-is
  }

  for (const inst of instances) {
    try {
      // Fetch recent messages from Evolution
      const r = await fetch(`${inst.api_url}/chat/findMessages/${encodeURIComponent(inst.instance_name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: inst.api_key },
        body: JSON.stringify({ where: {}, limit: 200 }),
      })
      if (!r.ok) continue
      const data = await r.json()
      const messages = data?.messages?.records || data?.messages || data || []
      if (!Array.isArray(messages)) continue

      let imported = 0
      for (const m of messages) {
        const key = m.key
        if (!key || !key.id || !key.remoteJid) continue
        // Skip groups, broadcasts, status
        if (key.remoteJid.includes('@g.us') || key.remoteJid.includes('@broadcast') || key.remoteJid.includes('status@')) continue
        // Skip if already in DB
        const exists = db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(key.id)
        if (exists) continue

        // Handle @lid (Legacy ID from WhatsApp) — accept if has pushName (real contact), skip if no identity
        const jid = m.senderPn || key.remoteJid
        let phone = ''
        let isLid = false

        if (m.senderPn) {
          // Has real phone via senderPn
          phone = normalizePhone(m.senderPn.replace('@s.whatsapp.net', '').replace('@c.us', ''))
        } else if (jid.endsWith('@lid')) {
          // LID without real phone — only accept if has pushName (real person, not group artifact)
          if (!m.pushName) continue
          isLid = true
          phone = jid.replace('@lid', '') // use LID as identifier
        } else {
          phone = normalizePhone(jid.replace('@s.whatsapp.net', '').replace('@c.us', ''))
        }
        if (!phone) continue

        const fromMe = !!key.fromMe
        const pushName = m.pushName || ''
        const timestamp = m.messageTimestamp || null

        // Parse content
        const msg = m.message || {}
        let content = msg.conversation || msg.extendedTextMessage?.text || ''
        let mediaType = 'text'
        if (msg.imageMessage) { mediaType = 'image'; content = content || '[Imagem]' }
        else if (msg.videoMessage) { mediaType = 'video'; content = content || '[Video]' }
        else if (msg.audioMessage) { mediaType = 'audio'; content = content || '[Audio]' }
        else if (msg.documentMessage) { mediaType = 'document'; content = content || '[Documento]' }
        else if (msg.stickerMessage) { mediaType = 'sticker'; content = '[Sticker]' }
        else if (msg.reactionMessage) continue // skip reactions

        if (!content && mediaType === 'text') continue

        // Get or create lead
        const dedupJid = isLid ? `${phone}@lid` : `${phone}@s.whatsapp.net`
        let lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND (wa_remote_jid = ? OR phone = ?) ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(inst.acc_id, dedupJid, phone)

        // Gate: se ja achou lead bloqueado, ignora msg
        if (lead && lead.is_blocked) {
          console.log(`[Polling] Msg ignorada — lead ${lead.id} bloqueado`)
          continue
        }

        // For @lid: also try matching by pushName (same person, different ID)
        if (!lead && isLid && pushName) {
          lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ? AND is_blocked = 0 ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(inst.acc_id, pushName)
          if (lead) {
            db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
          }
        }

        // If lead is archived, unarchive it (client sent a new message — relevant again)
        if (lead && lead.is_archived) {
          db.prepare("UPDATE leads SET is_archived = 0, archived_at = NULL, has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
          lead.is_archived = 0
          console.log(`[Polling] Desarquivado lead ${lead.id} (${lead.name}) — recebeu mensagem nova`)
        }

        if (!lead) {
          // ─── GATE: instancia em modo RESTRITO so processa leads ja cadastrados (form/sheets/Novo chat).
          // Mesmo gate do webhook (server/routes/webhooks.js getOrCreateLead). Polling tb precisa respeitar.
          if (inst.lead_intake_mode === 'restricted') {
            console.log(`[Polling] Msg ignorada — instancia ${inst.instance_name} em modo restrito (lead novo nao criado)`)
            continue
          }

          // Create new lead
          const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(inst.acc_id)
          if (!funnel) continue
          const stage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
          if (!stage) continue
          const leadPhone = isLid ? null : phone // LID leads have no real phone

          // Distribution: prefer instance.default_attendant_id, fallback to round-robin
          let attendantId = inst.default_attendant_id || null
          if (!attendantId) {
            const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(inst.acc_id, funnel.id)
            if (rule && rule.type === 'round_robin' && rule.active_attendants) {
              try {
                const attendants = JSON.parse(rule.active_attendants)
                if (attendants.length > 0) {
                  const idx = rule.last_assigned_index % attendants.length
                  attendantId = attendants[idx]
                  db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
                }
              } catch {}
            }
          }

          const result = db.prepare("INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").run(
            inst.acc_id, funnel.id, stage.id, attendantId, pushName || phone || 'Sem nome', leadPhone, 'whatsapp', dedupJid, inst.id
          )
          lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
          const histRes = db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(lead.id, stage.id, 'polling')
          broadcastSSE(inst.acc_id, 'lead:created', lead)
          triggerCapiForStageChange(lead.id, stage.id, histRes.lastInsertRowid)
        }

        // Store message + track instance
        db.prepare('INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          lead.id, inst.acc_id, fromMe ? 'outbound' : 'inbound', content, mediaType, fromMe ? '' : pushName, key.id, timestamp, inst.id
        )
        // Update lead's last_instance_id (so future sends remember this number)
        db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(inst.id, lead.id)
        // Ensure assignment exists for (lead, instance). Default attendant = instance.default_attendant_id
        db.prepare(`
          INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
          VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
        `).run(lead.id, inst.id, inst.id)
        imported++

        // SSE notify
        broadcastSSE(inst.acc_id, 'lead:message', { lead_id: lead.id })
      }

      if (imported > 0) console.log(`[Polling] ${inst.instance_name}: imported ${imported} missed messages`)
      else console.log(`[Polling] ${inst.instance_name}: ${messages.length} msgs checked, all synced`)
    } catch (err) {
      console.error(`[Polling] ${inst.instance_name}: error — ${err.message}`)
    }
  }
}

// ─── Re-register webhooks on every health check ─────────────────
async function reRegisterWebhooks() {
  const instances = db.prepare("SELECT wi.*, a.slug FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id WHERE wi.status = 'connected'").all()
  for (const inst of instances) {
    try {
      const webhookUrl = `https://drosagencia.com.br/crm/api/webhooks/evolution/${inst.slug}`
      await fetch(`${inst.api_url}/webhook/set/${encodeURIComponent(inst.instance_name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: inst.api_key },
        body: JSON.stringify({ webhook: { url: webhookUrl, enabled: true, events: ['MESSAGES_UPSERT'] } }),
      })
    } catch {}
  }
}

// ─── Clean up stale QR codes (older than 2 minutes) ──────────────
function cleanupStaleQRCodes() {
  db.prepare(`
    UPDATE whatsapp_instances SET qr_code = NULL
    WHERE qr_code IS NOT NULL AND status = 'connecting'
    AND datetime(updated_at) < datetime('now', '-2 minutes')
  `).run()
}

// ─── Main tick (every 5 min) ─────────────────────────────────────
async function tick() {
  try {
    await Promise.all([
      checkWhatsAppInstances(),
      processCadences(),
      processScheduledBroadcasts(),
    ])
    cleanupStaleQRCodes()
    // Re-register webhooks every tick to prevent stale webhooks
    await reRegisterWebhooks()
  } catch (err) {
    console.error('[Scheduler] Tick error:', err.message)
  }
}

// ─── Polling tick (every 3 min) ──────────────────────────────────
async function pollTick() {
  console.log('[Polling] Running...')
  try {
    await pollMissedMessages()
  } catch (err) {
    console.error('[Polling] Error:', err.message)
  }
}

export { pollTick as runPollNow }

// ─── Verificacao diaria de TODAS as instancias (auto-reconecta as desconectadas)
// Roda 1x por dia as 5h (horario BRT = America/Sao_Paulo)
// Diferente do checkWhatsAppInstances() padrao que so age em transicoes,
// este aqui tenta reconectar instancias que ja estavam disconnected ha tempo.
async function dailyInstanceHealthCheck() {
  console.log('[DailyHealthCheck] Iniciando verificacao diaria das instancias...')
  const instances = db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
  `).all()

  let connected = 0, reconnected = 0, qrNeeded = 0, errors = 0

  for (const inst of instances) {
    try {
      const encoded = encodeURIComponent(inst.instance_name)
      const stateRes = await fetch(`${inst.api_url}/instance/connectionState/${encoded}`, {
        headers: { apikey: inst.api_key },
        timeout: 15000,
      })
      const stateData = await stateRes.json().catch(() => ({}))
      const realState = stateData?.instance?.state || stateData?.state || ''

      if (realState === 'open' || realState === 'connected') {
        if (inst.status !== 'connected') {
          db.prepare("UPDATE whatsapp_instances SET status='connected', updated_at=datetime('now') WHERE id=?").run(inst.id)
        }
        connected++
      } else if (realState === 'close' || realState === 'closed' || realState === 'disconnected') {
        // Tenta reconectar
        const connRes = await fetch(`${inst.api_url}/instance/connect/${encoded}`, {
          headers: { apikey: inst.api_key },
          timeout: 20000,
        })
        const connData = await connRes.json().catch(() => ({}))
        const newState = connData?.instance?.state || connData?.state || ''
        const hasQr = !!(connData?.qrcode?.base64 || connData?.base64 || (typeof connData?.qrcode === 'string' && connData.qrcode.startsWith('data:image')))

        if (hasQr) {
          db.prepare("UPDATE whatsapp_instances SET status='connecting', qr_code=?, updated_at=datetime('now') WHERE id=?")
            .run(connData?.qrcode?.base64 || connData?.base64 || connData?.qrcode || null, inst.id)
          qrNeeded++
          console.log(`[DailyHealthCheck] ${inst.account_name} → ${inst.instance_name}: precisa QR`)
        } else if (newState === 'open' || newState === 'connected') {
          db.prepare("UPDATE whatsapp_instances SET status='connected', updated_at=datetime('now') WHERE id=?").run(inst.id)
          reconnected++
          console.log(`[DailyHealthCheck] ${inst.account_name} → ${inst.instance_name}: reconectada sem QR`)
        } else {
          db.prepare("UPDATE whatsapp_instances SET status='connecting', updated_at=datetime('now') WHERE id=?").run(inst.id)
        }
      } else if (!realState) {
        errors++
      }
    } catch (err) {
      errors++
      console.error(`[DailyHealthCheck] Erro em ${inst.instance_name}:`, err.message)
    }
    // Espacamento entre instancias pra nao sobrecarregar Evolution
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`[DailyHealthCheck] Concluido — ${connected} conectadas, ${reconnected} reconectadas, ${qrNeeded} precisam QR, ${errors} erros`)
}

// Agenda dailyInstanceHealthCheck pra rodar todo dia as 5h (horario BRT/America/Sao_Paulo)
function scheduleDailyHealthCheck() {
  const now = new Date()
  // SQLite stores UTC. Servidor pode estar em UTC ou BRT.
  // Vamos calcular proxima execucao em hora local do servidor pegando como referencia 5h da manha de Sao Paulo (UTC-3)
  // = 08:00 UTC. Se o servidor estiver em BRT, sera 05:00 local; se UTC, 08:00 local.
  const next = new Date(now)
  next.setUTCHours(8, 0, 0, 0) // 08:00 UTC = 05:00 BRT
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  const msUntilNext = next.getTime() - now.getTime()
  console.log(`[Scheduler] Proximo health check diario em ${Math.round(msUntilNext / 60000)}min (${next.toISOString()})`)
  setTimeout(() => {
    dailyInstanceHealthCheck().catch(e => console.error('[DailyHealthCheck] Fatal:', e.message))
    // Depois roda a cada 24h
    setInterval(() => {
      dailyInstanceHealthCheck().catch(e => console.error('[DailyHealthCheck] Fatal:', e.message))
    }, 24 * 60 * 60 * 1000)
  }, msUntilNext)
}

export function startScheduler() {
  console.log('[Scheduler] Started — main every 5 min, polling every 30s, daily health 05h BRT')
  tick()
  setInterval(tick, INTERVAL_MS)
  // Polling runs aggressively (30s) so missed messages surface quickly when webhook misbehaves
  setTimeout(() => pollTick(), 10000) // first poll after 10s
  setInterval(pollTick, 30 * 1000)
  // Daily instance health check (auto-reconecta disconnected)
  scheduleDailyHealthCheck()
}

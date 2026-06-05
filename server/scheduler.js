import fetch from 'node-fetch'
import db from './db.js'
import { broadcastSSE } from './sse.js'
import { resumeBroadcastIfPaused, runBroadcastLoop } from './routes/broadcasts.js'
import { sendFollowUpMessage, resumeFollowUpsIfPaused } from './services/followUpSender.js'
import { processInactivityFollowUps } from './services/inactivityScanner.js'
import { triggerCapiForStageChange } from './services/metaCapi.js'
import { aggregateAllAccounts } from './services/attendantMetrics.js'
import { analyzeAllAccounts } from './services/conversationAnalyzer.js'
import { generateAllCoachings, isoMonday } from './services/coachingAnalyzer.js'
import { runAutoRescue } from './services/botAutoRescue.js'

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
        // Se reconectou, retoma broadcasts e follow-ups pausados desta instancia
        if (newStatus === 'connected' && inst.status !== 'connected') {
          try { resumeBroadcastIfPaused(inst.id) } catch (e) { console.error('[Health] Resume broadcast error:', e.message) }
          try { resumeFollowUpsIfPaused(inst.id) } catch (e) { console.error('[Health] Resume follow-up error:', e.message) }
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

// ─── Follow-ups due ─────────────────────────────────────────────
async function processFollowUps() {
  const due = db.prepare(`
    SELECT id FROM lead_follow_ups
    WHERE status='active' AND next_run_at IS NOT NULL AND datetime(next_run_at) <= datetime('now')
    ORDER BY next_run_at ASC
    LIMIT 50
  `).all()
  if (due.length === 0) return
  console.log(`[FollowUp] Processando ${due.length} follow-up(s) due`)
  for (const r of due) {
    sendFollowUpMessage(r.id).catch(err => console.error(`[FollowUp] Erro envio id=${r.id}:`, err.message))
  }
}

// ─── Nightly Analysis — roda 1x por dia entre 3h00-3h05 UTC ────────
// Agrega metricas operacionais + roda Haiku pra extrair insights de conversas
let nightlyRunning = false
export async function runNightlyAnalysis() {
  if (nightlyRunning) return
  nightlyRunning = true
  try {
    // Date string YYYY-MM-DD do dia anterior (UTC)
    const yesterday = new Date(Date.now() - 86400000)
    const dateStr = yesterday.toISOString().slice(0, 10)
    console.log(`[Nightly] Iniciando agregacao + analise (date=${dateStr})...`)

    // 1. Agrega metricas operacionais (SQL puro, rapido)
    const metricsResult = aggregateAllAccounts(dateStr)
    console.log(`[Nightly] Metrics: ${JSON.stringify(metricsResult)}`)

    // 2. Analisa conversas via Haiku (mais lento)
    const analysisResult = await analyzeAllAccounts()
    console.log(`[Nightly] Analysis: ${JSON.stringify(analysisResult)}`)

    // Marca timestamp pra evitar dupla execucao
    db.prepare("UPDATE accounts SET last_nightly_at = datetime('now') WHERE is_active = 1").run()
  } catch (e) {
    console.error('[Nightly] erro:', e.message)
  } finally {
    nightlyRunning = false
  }
}

function shouldRunNightly() {
  const now = new Date()
  // Janela 3h00-3h05 UTC = 0h-0h05 BR (Brasilia UTC-3)
  if (now.getUTCHours() !== 3 || now.getUTCMinutes() >= 5) return false
  // Verifica se ja rodou hoje (qualquer conta com last_nightly_at > 3h atrás)
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString().slice(0, 19).replace('T', ' ')
  const ranToday = db.prepare("SELECT COUNT(*) as n FROM accounts WHERE last_nightly_at >= ? AND is_active = 1").get(todayStart)
  return (ranToday?.n || 0) === 0
}

// ─── Weekly Coaching — segunda 3h05-3h10 UTC, 1x por semana por user ────
let weeklyRunning = false
export async function runWeeklyCoaching() {
  if (weeklyRunning) return
  weeklyRunning = true
  try {
    // Semana terminada = última segunda anterior à atual (já completou 7 dias)
    const lastMonday = new Date(Date.now() - 7 * 86400 * 1000)
    const weekStart = isoMonday(lastMonday)
    console.log(`[WeeklyCoaching] Iniciando week=${weekStart}...`)
    const r = await generateAllCoachings(weekStart)
    console.log(`[WeeklyCoaching] Done: ${JSON.stringify(r)}`)
    db.prepare("UPDATE accounts SET last_weekly_coaching_at = datetime('now') WHERE is_active = 1 AND attendant_analytics_enabled = 1").run()
  } catch (e) {
    console.error('[WeeklyCoaching] erro:', e.message)
  } finally {
    weeklyRunning = false
  }
}

function shouldRunWeeklyCoaching() {
  const now = new Date()
  // Janela: segunda-feira (getUTCDay() === 1) entre 3h05 e 3h10 UTC
  if (now.getUTCDay() !== 1) return false
  if (now.getUTCHours() !== 3 || now.getUTCMinutes() < 5 || now.getUTCMinutes() >= 10) return false
  // Já rodou nessa segunda?
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString().slice(0, 19).replace('T', ' ')
  const ranToday = db.prepare("SELECT COUNT(*) as n FROM accounts WHERE last_weekly_coaching_at >= ? AND is_active = 1 AND attendant_analytics_enabled = 1").get(todayStart)
  return (ranToday?.n || 0) === 0
}

// ─── Detector de instancia fantasma silenciosa ────────────────────
// Evolution as vezes reporta state='open' mas a sessao Baileys ta zumbi:
// aceita sendText (retorna key.id) mas nada chega no WhatsApp real.
// Detectamos pelo OUTCOME: se ultimas N msgs ficaram 'sent' sem 'delivered_at'
// por mais de X min, considera fantasma e forca restart da instancia.
const GHOST_MIN_MSGS = 3        // pelo menos N envios recentes pra avaliar
const GHOST_MIN_AGE_MIN = 2     // envios com >2min sem delivered_at (igual STALE)
const GHOST_WINDOW_MIN = 15     // janela de analise: ultimas 15 min
const _ghostRestartCooldown = new Map() // instance_id -> timestamp ultimo restart (cooldown 15min)

async function detectGhostInstancesAndRestart() {
  try {
    const instances = db.prepare("SELECT id, instance_name, api_url, api_key FROM whatsapp_instances WHERE status = 'connected'").all()
    for (const inst of instances) {
      // Cooldown — nao tenta restart de novo se ja tentou nos ultimos 15min
      const lastRestart = _ghostRestartCooldown.get(inst.id) || 0
      if (Date.now() - lastRestart < 15 * 60 * 1000) continue

      // Pega outcome das ultimas msgs dessa instancia na janela
      const recent = db.prepare(`
        SELECT delivery_status, delivered_at, read_at, created_at,
               (strftime('%s','now') - strftime('%s', created_at))/60 as age_min
        FROM messages
        WHERE instance_id = ?
          AND direction = 'outbound'
          AND created_at >= datetime('now', '-${GHOST_WINDOW_MIN} minutes')
        ORDER BY id DESC LIMIT 20
      `).all(inst.id)

      if (recent.length < GHOST_MIN_MSGS) continue // insuficiente pra avaliar

      // Conta quantas estao 'sent' velhas sem delivered_at
      const staleNoDelivery = recent.filter(m =>
        m.delivery_status === 'sent' &&
        !m.delivered_at && !m.read_at &&
        m.age_min >= GHOST_MIN_AGE_MIN
      ).length

      // Conta entregas confirmadas no periodo (qualquer uma)
      const anyDelivered = recent.some(m => m.delivered_at || m.read_at)

      // Considera fantasma se: tem >=3 envios stale E nenhuma entrega confirmada na janela
      if (staleNoDelivery >= GHOST_MIN_MSGS && !anyDelivered) {
        console.warn(`[GhostDetect] instancia=${inst.instance_name} suspeita: ${staleNoDelivery} msgs stale sem entrega. Forcando restart...`)
        _ghostRestartCooldown.set(inst.id, Date.now())
        try {
          // /instance/restart eh mais agressivo que /connect — refaz a sessao Baileys
          const encoded = encodeURIComponent(inst.instance_name)
          const r = await fetch(`${inst.api_url}/instance/restart/${encoded}`, {
            method: 'POST',
            headers: { apikey: inst.api_key },
          })
          const data = await r.json().catch(() => ({}))
          console.warn(`[GhostDetect] restart ${inst.instance_name} response:`, JSON.stringify(data).substring(0, 200))
          // Marca como connecting + pausa broadcasts ativos dessa instancia
          db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(inst.id)
          db.prepare("UPDATE broadcasts SET paused_at = datetime('now'), paused_reason = 'instancia_fantasma_detectada' WHERE status = 'sending' AND instance_id = ? AND paused_at IS NULL").run(inst.id)
          try { broadcastSSE(null, 'instance:ghost_restart', { instance_id: inst.id, instance_name: inst.instance_name }) } catch {}
        } catch (e) {
          console.error(`[GhostDetect] restart ${inst.instance_name} erro:`, e.message)
        }
      }
    }
  } catch (e) {
    console.error('[GhostDetect] erro geral:', e.message)
  }
}

// ─── Mark stale outbound messages as 'failed' ─────────────────────
// Threshold dinamico por instancia:
// - SAUDAVEL (webhook recente provou que delivered_at chega): 60s sem confirmacao -> failed.
//   Feedback quase instantaneo. Risco minimo: se instancia ta entregando outras msgs com
//   webhook funcional, essa msg especifica que ficou 60s sem confirmacao = falha real.
// - NAO-PROVADA (instancia nova ou silenciosa ha >2h): 15min sem confirmacao -> failed.
//   Conservador: webhook pode estar quebrado e ainda haver entrega real.
// Guard absoluto: inbound posterior do mesmo lead = msg recebida, NUNCA marca failed.
const STALE_HEALTHY_SECONDS = 60       // ~instantaneo do POV do user
const STALE_UNVERIFIED_MINUTES = 15    // fallback conservador
const HEALTH_LOOKBACK_HOURS = 2        // janela pra considerar instancia "saudavel"
function markStaleMessagesAsFailed() {
  try {
    // SQL helper: subquery que define instancias "saudaveis" — receberam delivered_at recentemente
    // (qualquer msg da instancia teve webhook delivered/read nas ultimas N horas)
    const healthyInstancesSQL = `
      SELECT DISTINCT instance_id FROM messages
      WHERE instance_id IS NOT NULL
        AND delivered_at IS NOT NULL
        AND delivered_at >= datetime('now', '-${HEALTH_LOOKBACK_HOURS} hours')
    `

    // 1a. Fast path: instancias saudaveis, threshold 60s
    const msgFastUpdate = db.prepare(`
      UPDATE messages
      SET delivery_status = 'failed'
      WHERE direction = 'outbound'
        AND delivery_status = 'sent'
        AND delivered_at IS NULL
        AND read_at IS NULL
        AND created_at < datetime('now', '-${STALE_HEALTHY_SECONDS} seconds')
        AND instance_id IN (${healthyInstancesSQL})
        AND NOT EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = messages.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > messages.created_at
        )
    `).run()

    // 1b. Slow path: instancias nao-provadas, threshold 15min
    const msgSlowUpdate = db.prepare(`
      UPDATE messages
      SET delivery_status = 'failed'
      WHERE direction = 'outbound'
        AND delivery_status = 'sent'
        AND delivered_at IS NULL
        AND read_at IS NULL
        AND created_at < datetime('now', '-${STALE_UNVERIFIED_MINUTES} minutes')
        AND (instance_id IS NULL OR instance_id NOT IN (${healthyInstancesSQL}))
        AND NOT EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = messages.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > messages.created_at
        )
    `).run()
    const msgUpdate = { changes: msgFastUpdate.changes + msgSlowUpdate.changes }

    // 2a. broadcast_recipients fast path: instancia saudavel, threshold 60s
    const brFastUpdate = db.prepare(`
      UPDATE broadcast_recipients
      SET status = 'failed',
          error = COALESCE(error, '') || ' [stale_no_delivery_60s]'
      WHERE status = 'sent'
        AND sent_at < datetime('now', '-${STALE_HEALTHY_SECONDS} seconds')
        AND EXISTS (
          SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
            AND b.instance_id IN (${healthyInstancesSQL})
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.wa_msg_id = broadcast_recipients.wa_msg_id
            AND (m.delivery_status = 'delivered' OR m.delivery_status = 'read')
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = broadcast_recipients.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > broadcast_recipients.sent_at
        )
    `).run()

    // 2b. broadcast_recipients slow path: instancia nao-provada, threshold 15min
    const brSlowUpdate = db.prepare(`
      UPDATE broadcast_recipients
      SET status = 'failed',
          error = COALESCE(error, '') || ' [stale_no_delivery_${STALE_UNVERIFIED_MINUTES}min]'
      WHERE status = 'sent'
        AND sent_at < datetime('now', '-${STALE_UNVERIFIED_MINUTES} minutes')
        AND NOT EXISTS (
          SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id
            AND b.instance_id IN (${healthyInstancesSQL})
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m
          WHERE m.wa_msg_id = broadcast_recipients.wa_msg_id
            AND (m.delivery_status = 'delivered' OR m.delivery_status = 'read')
        )
        AND NOT EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = broadcast_recipients.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > broadcast_recipients.sent_at
        )
    `).run()
    const brUpdate = { changes: brFastUpdate.changes + brSlowUpdate.changes }

    if (msgUpdate.changes > 0 || brUpdate.changes > 0) {
      console.log(`[MarkStale] msgs=${msgUpdate.changes} (fast=${msgFastUpdate.changes} slow=${msgSlowUpdate.changes}) br=${brUpdate.changes} (fast=${brFastUpdate.changes} slow=${brSlowUpdate.changes}) marcados failed`)
      // Re-sincroniza failed_count e sent_count dos broadcasts afetados
      if (brUpdate.changes > 0) {
        db.prepare(`
          UPDATE broadcasts SET
            sent_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = broadcasts.id AND status = 'sent'),
            failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = broadcasts.id AND status = 'failed')
          WHERE id IN (SELECT DISTINCT broadcast_id FROM broadcast_recipients WHERE sent_at < datetime('now', '-${STALE_UNVERIFIED_MINUTES} minutes'))
        `).run()
        // Marca broadcast inteiro como 'failed' se 100% dos recipients falharam (visualmente claro pro user)
        db.prepare(`
          UPDATE broadcasts SET status = 'failed'
          WHERE status = 'completed'
            AND total_count > 0
            AND failed_count = total_count
            AND sent_count = 0
        `).run()
      }
      // SSE broadcast pra UI atualizar
      try {
        const affectedAccounts = db.prepare("SELECT DISTINCT account_id FROM messages WHERE delivery_status = 'failed' AND created_at >= datetime('now', '-1 hour')").all()
        for (const a of affectedAccounts) {
          broadcastSSE(a.account_id, 'message:status', { batch_marked_failed: true })
        }
      } catch {}
    }
  } catch (e) {
    console.error('[MarkStale] erro:', e.message)
  }
}

// ─── Main tick (every 5 min) ─────────────────────────────────────
async function tick() {
  try {
    await Promise.all([
      checkWhatsAppInstances(),
      processCadences(),
      processScheduledBroadcasts(),
      processFollowUps(),
      processInactivityFollowUps(),
    ])
    cleanupStaleQRCodes()
    // Re-register webhooks every tick to prevent stale webhooks
    await reRegisterWebhooks()
    // markStaleMessagesAsFailed DESATIVADO: gerava falsos positivos (msg entregue
    // marcada ✗ porque webhook DELIVERY_ACK atrasou ou se perdeu).
    // Falhas reais sao detectadas por: pre-flight de numero, erros do sendText
    // (instantaneos no envio), e ghost detector (instancia inteira morta).
    // Funcao continua no arquivo pra reativar facil se necessario.
    // Reverte ✗ historicos: msgs failed com inbound posterior do mesmo lead = entregue
    revertFalseFailures()
    // Anti-ban: retoma instancias auto-pausadas por delivered_rate baixo apos 4h.
    // Manual pause nunca eh tocado aqui (preserva paused_reason='manual').
    autoResumePausedInstances()
    // Detecta instancias fantasma silenciosas (Evolution state=open mas msgs nao entregam)
    // e forca restart. Cooldown 15min entre tentativas.
    detectGhostInstancesAndRestart().catch(e => console.error('[GhostDetect]', e.message))
    // Nightly analysis (roda so 1x por dia na janela 3h UTC)
    if (shouldRunNightly()) runNightlyAnalysis().catch(e => console.error('[Nightly]', e.message))
    // Weekly coaching (segunda 3h05-3h10 UTC)
    if (shouldRunWeeklyCoaching()) runWeeklyCoaching().catch(e => console.error('[WeeklyCoaching]', e.message))
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
  // markStaleMessagesAsFailed roda em seu proprio loop curto (10s) — ver startScheduler.
  // Detector de instancia fantasma: roda no poll de 30s pra detectar rapido.
  try { await detectGhostInstancesAndRestart() } catch (e) { console.error('[GhostDetect poll]', e.message) }
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

// Revert continuo: msgs outbound 'failed' que tem inbound posterior do mesmo lead
// (= prova absoluta de entrega) voltam pra 'delivered'. Roda em todo tick de 10s no
// scheduler + 1x na startup pra cobrir backlog. Idempotente.
// Sem filtros restritivos (qualquer wa_msg_id, qualquer motivo de failed) — inbound
// posterior do mesmo lead basta como prova.
// Anti-ban: retoma instancias auto-pausadas por delivered_rate baixo apos 4h.
// Pausas manuais (paused_reason='manual') nao sao tocadas — requerem UPDATE explicito.
function autoResumePausedInstances() {
  try {
    const r = db.prepare(`
      UPDATE whatsapp_instances
         SET paused_at = NULL, paused_reason = NULL
       WHERE paused_at IS NOT NULL
         AND paused_reason = 'delivered_rate_low'
         AND paused_at < datetime('now', '-4 hours')
    `).run()
    if (r.changes > 0) console.log(`[Health] ${r.changes} instancia(s) auto-resumida(s) apos 4h de pausa`)
  } catch (e) { console.error('[Health autoResume]', e.message) }
}

function revertFalseFailures() {
  try {
    const r1 = db.prepare(`
      UPDATE messages
      SET delivery_status = 'delivered',
          delivered_at = COALESCE(delivered_at, datetime('now'))
      WHERE direction = 'outbound'
        AND delivery_status = 'failed'
        AND EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = messages.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > messages.created_at
        )
    `).run()
    const r2 = db.prepare(`
      UPDATE broadcast_recipients
      SET status = 'sent',
          error = NULL
      WHERE status = 'failed'
        AND EXISTS (
          SELECT 1 FROM messages m_in
          WHERE m_in.lead_id = broadcast_recipients.lead_id
            AND m_in.direction = 'inbound'
            AND m_in.created_at > broadcast_recipients.sent_at
        )
    `).run()
    if (r1.changes > 0 || r2.changes > 0) {
      console.log(`[RevertFalseFailures] msgs=${r1.changes} broadcast_recipients=${r2.changes} revertidas (lead respondeu apos envio)`)
      // SSE pra UI atualizar ✗ vermelho -> ✓✓ verde em segundos, sem reload
      try {
        const affected = db.prepare(`
          SELECT DISTINCT account_id FROM messages
          WHERE direction = 'outbound' AND delivery_status = 'delivered'
            AND delivered_at >= datetime('now', '-30 seconds')
        `).all()
        for (const a of affected) {
          broadcastSSE(a.account_id, 'message:status', { batch_reverted_to_delivered: true })
        }
      } catch (e) { console.error('[RevertFalseFailures SSE]', e.message) }
      // Re-sincroniza contadores de broadcasts afetados
      if (r2.changes > 0) {
        db.prepare(`
          UPDATE broadcasts SET
            sent_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = broadcasts.id AND status = 'sent'),
            failed_count = (SELECT COUNT(*) FROM broadcast_recipients WHERE broadcast_id = broadcasts.id AND status = 'failed')
        `).run()
        // Se broadcast tinha sido marcado 'failed' por 100% recipients, volta pra 'completed'
        db.prepare(`
          UPDATE broadcasts SET status = 'completed'
          WHERE status = 'failed' AND sent_count > 0
        `).run()
      }
    }
  } catch (e) {
    console.error('[RevertFalseFailures] erro:', e.message)
  }
}

export function startScheduler() {
  console.log('[Scheduler] Started — main every 5 min, polling every 30s, revert-false every 10s, daily health 05h BRT')
  try { revertFalseFailures() } catch (e) { console.error('[RevertFalseFailures startup]', e.message) }
  tick()
  setInterval(tick, INTERVAL_MS)
  // Polling runs aggressively (30s) so missed messages surface quickly when webhook misbehaves
  setTimeout(() => pollTick(), 10000) // first poll after 10s
  setInterval(pollTick, 30 * 1000)
  // Loop continuo de revert: detecta ✗ historicos onde lead respondeu apos (= entregue)
  // e volta pra ✓✓ verde. Cron de markStaleMessagesAsFailed foi DESATIVADO por gerar
  // falsos positivos. Falhas reais: pre-flight + sendText erro + ghost detector.
  setInterval(() => {
    try { revertFalseFailures() } catch (e) { console.error('[RevertFalse tick]', e.message) }
  }, 10 * 1000)
  // Auto-rescue do bot: a cada 30min, dispara bot pra leads com inbound sem resposta.
  // Resolve casos onde bot ficou travado (cap antigo, race, falha temporaria).
  // Reusa processInboundMessage + diagnoseForceAi — mesmo fluxo do botao manual.
  setInterval(() => {
    runAutoRescue().catch(e => console.error('[AutoRescue tick]', e.message))
  }, 30 * 60 * 1000)
  // Roda 1x apos 60s do boot pra pegar backlog acumulado antes do primeiro tick
  setTimeout(() => {
    runAutoRescue().catch(e => console.error('[AutoRescue boot]', e.message))
  }, 60 * 1000)
  // Daily instance health check (auto-reconecta disconnected)
  scheduleDailyHealthCheck()
}

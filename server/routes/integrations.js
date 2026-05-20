import { Router } from 'express'
import fetch from 'node-fetch'
import db, { DEFAULT_EVOLUTION_API_URL, DEFAULT_EVOLUTION_API_KEY } from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { runPollNow } from '../scheduler.js'

const router = Router()

// Helper: get instance only if it belongs to the user's account (or user is super_admin)
function getOwnedInstance(req, res) {
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(req.params.id)
  if (!instance) { res.status(404).json({ error: 'Instancia nao encontrada' }); return null }
  if (req.user.role !== 'super_admin' && instance.account_id !== req.accountId) {
    res.status(403).json({ error: 'Sem permissao para esta instancia' }); return null
  }
  return instance
}

// ─── Get Evolution API config for account ────────────────────────
router.get('/evolution-config', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const account = db.prepare('SELECT evolution_api_url, evolution_api_key FROM accounts WHERE id = ?').get(req.accountId)
  // Fallback pros defaults se a conta nao tiver config propria salva
  res.json({
    api_url: account?.evolution_api_url || DEFAULT_EVOLUTION_API_URL,
    api_key: account?.evolution_api_key || DEFAULT_EVOLUTION_API_KEY,
  })
})

// ─── Save Evolution API config for account ───────────────────────
router.put('/evolution-config', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { api_url, api_key } = req.body
  if (!api_url || !api_key) return res.status(400).json({ error: 'api_url e api_key obrigatorios' })
  const baseUrl = api_url.replace(/\/+$/, '')
  db.prepare("UPDATE accounts SET evolution_api_url = ?, evolution_api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, req.accountId)
  res.json({ ok: true, api_url: baseUrl })
})

// ─── List WhatsApp instances ─────────────────────────────────────
// Atendente tb le (precisa pra saber qual instancia ta conectada e mandar msg),
// mas recebe versao saneada — sem api_url, api_key, webhook_secret.
router.get('/whatsapp', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const rows = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY created_at DESC').all(req.accountId)
  if (req.user.role === 'atendente') {
    const safe = rows.map(({ api_url, api_key, webhook_secret, ...rest }) => rest)
    return res.json({ instances: safe })
  }
  res.json({ instances: rows })
})

// Helper: register webhook on Evolution for a given instance
async function registerEvolutionWebhook(baseUrl, apiKey, instanceName, accountSlug) {
  const webhookUrl = `https://drosagencia.com.br/crm/api/webhooks/evolution/${accountSlug}`
  try {
    await fetch(`${baseUrl}/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify({ webhook: { url: webhookUrl, enabled: true, events: ['MESSAGES_UPSERT'] } }),
    })
    console.log(`[Evolution Webhook] Set for ${instanceName} → ${webhookUrl}`)
  } catch (err) {
    console.error('[Evolution Webhook Setup]', err.message)
  }
}

// ─── Create instance on Evolution API + get QR code ──────────────
router.post('/whatsapp', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { instance_name } = req.body
  if (!instance_name) return res.status(400).json({ error: 'instance_name obrigatorio' })

  // Get Evolution API credentials from account config (or fallback to body for backwards compat)
  const account = db.prepare('SELECT evolution_api_url, evolution_api_key, slug FROM accounts WHERE id = ?').get(req.accountId)
  const api_url = req.body.api_url || account?.evolution_api_url
  const api_key = req.body.api_key || account?.evolution_api_key
  if (!api_url || !api_key) return res.status(400).json({ error: 'Configure a Evolution API primeiro em Integracoes' })

  // Normalize api_url (remove trailing slash)
  const baseUrl = api_url.replace(/\/+$/, '')

  // Check if instance already exists in DB — re-register webhook to recover from past failures, then return
  const existing = db.prepare('SELECT id FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(req.accountId, instance_name)
  if (existing) {
    db.prepare("UPDATE whatsapp_instances SET api_url = ?, api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, existing.id)
    await registerEvolutionWebhook(baseUrl, api_key, instance_name, account.slug)
    const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id)
    return res.json({ instance })
  }

  // Create instance on Evolution API
  let qrCode = null
  try {
    const createRes = await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: api_key },
      body: JSON.stringify({ instanceName: instance_name, qrcode: true, integration: 'WHATSAPP-BAILEYS' }),
    })
    const createData = await createRes.json()
    qrCode = createData?.qrcode?.base64 || createData?.base64 || null
  } catch (err) {
    console.error('[Evolution Create Instance]', err.message)
  }

  // Save to DB
  const result = db.prepare(
    'INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, qr_code) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.accountId, instance_name, baseUrl, api_key, qrCode ? 'connecting' : 'disconnected', qrCode)
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(result.lastInsertRowid)

  // Setup webhook automatically (Evolution v2.3 format)
  await registerEvolutionWebhook(baseUrl, api_key, instance_name, account.slug)

  res.json({ instance })
})

// ─── Connect (get QR code for existing instance) ─────────────────
router.post('/whatsapp/:id/connect', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return

  try {
    const r = await fetch(`${instance.api_url}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const qrCode = data?.base64 || data?.qrcode || null

    db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qrCode, instance.id)

    // Re-register webhook on every connect to recover from any past Evolution-side resets
    const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
    if (account?.slug) await registerEvolutionWebhook(instance.api_url, instance.api_key, instance.instance_name, account.slug)

    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated })
  } catch (err) {
    console.error('[Evolution Connect]', err.message)
    res.status(500).json({ error: 'Falha ao conectar: ' + err.message })
  }
})

// ─── Check connection status ─────────────────────────────────────
router.get('/whatsapp/:id/status', async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return

  try {
    const r = await fetch(`${instance.api_url}/instance/connectionState/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const state = data?.instance?.state || data?.state || ''

    let status = 'disconnected'
    if (state === 'open' || state === 'connected') status = 'connected'
    else if (state === 'connecting') status = 'connecting'

    // If connected, clear QR code and save phone number if available
    const updates = { status }
    if (status === 'connected') {
      updates.qr_code = null
    }

    db.prepare(`UPDATE whatsapp_instances SET status = ?, qr_code = ?, updated_at = datetime('now') WHERE id = ?`).run(
      updates.status, updates.qr_code !== undefined ? updates.qr_code : instance.qr_code, instance.id
    )

    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated, state })
  } catch (err) {
    db.prepare("UPDATE whatsapp_instances SET status = 'disconnected' WHERE id = ?").run(instance.id)
    res.json({ instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id), error: err.message })
  }
})

// ─── Refresh QR code ─────────────────────────────────────────────
router.post('/whatsapp/:id/qrcode', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return

  try {
    const r = await fetch(`${instance.api_url}/instance/connect/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const qrCode = data?.base64 || data?.qrcode || null

    db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qrCode, instance.id)
    const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
    res.json({ instance: updated })
  } catch (err) {
    res.status(500).json({ error: 'Falha ao gerar QR code: ' + err.message })
  }
})

// ─── Disconnect (logout from WhatsApp) ───────────────────────────
router.post('/whatsapp/:id/disconnect', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return

  try {
    await fetch(`${instance.api_url}/instance/logout/${instance.instance_name}`, {
      method: 'DELETE',
      headers: { apikey: instance.api_key },
    })
  } catch (err) {
    console.error('[Evolution Logout]', err.message)
  }

  db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', qr_code = NULL, updated_at = datetime('now') WHERE id = ?").run(instance.id)
  res.json({ ok: true })
})

// ─── Delete instance ─────────────────────────────────────────────
router.delete('/whatsapp/:id', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (instance) {
    // Try to delete from Evolution API too
    try {
      await fetch(`${instance.api_url}/instance/delete/${instance.instance_name}`, {
        method: 'DELETE',
        headers: { apikey: instance.api_key },
      })
    } catch {}
  }
  db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

// ─── Re-set webhook URL on Evolution API ─────────────────────────
router.post('/whatsapp/:id/setup-webhook', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
  if (!account?.slug) return res.status(404).json({ error: 'Conta nao encontrada' })
  const webhookUrl = `https://drosagencia.com.br/crm/api/webhooks/evolution/${account.slug}`
  try {
    await registerEvolutionWebhook(instance.api_url, instance.api_key, instance.instance_name, account.slug)
    res.json({ ok: true, webhookUrl })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Update default attendant for an instance ────────────────────
router.put('/whatsapp/:id/attendant', requireRole('super_admin', 'gerente'), (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const { attendant_id } = req.body
  // null clears the assignment (back to round-robin)
  if (attendant_id !== null && attendant_id !== undefined) {
    const user = db.prepare('SELECT id, account_id, role FROM users WHERE id = ? AND is_active = 1').get(attendant_id)
    if (!user) return res.status(400).json({ error: 'Usuario nao encontrado' })
    if (user.account_id && user.account_id !== instance.account_id) return res.status(400).json({ error: 'Atendente nao pertence a esta conta' })
  }
  db.prepare("UPDATE whatsapp_instances SET default_attendant_id = ?, updated_at = datetime('now') WHERE id = ?").run(attendant_id || null, instance.id)
  const updated = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
  res.json({ instance: updated })
})

// ─── Restart Baileys session on Evolution (fixes "open but no msgs" zombie state) ───
router.post('/whatsapp/:id/restart', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  try {
    const r = await fetch(`${instance.api_url}/instance/restart/${encodeURIComponent(instance.instance_name)}`, {
      method: 'POST',
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    res.json({ ok: true, response: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Force run polling now (catch missed inbound messages immediately) ──
router.post('/whatsapp/sync-now', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  try {
    await runPollNow()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── Test connection (legacy, kept for compatibility) ────────────
router.post('/whatsapp/:id/test', requireRole('super_admin', 'gerente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return

  try {
    const r = await fetch(`${instance.api_url}/instance/connectionState/${instance.instance_name}`, {
      headers: { apikey: instance.api_key },
    })
    const data = await r.json()
    const status = data.instance?.state === 'open' ? 'connected' : 'disconnected'
    db.prepare("UPDATE whatsapp_instances SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, instance.id)
    res.json({ success: status === 'connected', status, data })
  } catch (err) {
    db.prepare("UPDATE whatsapp_instances SET status = 'disconnected' WHERE id = ?").run(instance.id)
    res.json({ success: false, error: err.message })
  }
})

// ─── Auto-mensagens por instancia ─────────────────────────────────
// GET: carrega config atual da instancia (atendente tb le pra mostrar status na sidebar)
router.get('/whatsapp/:id/auto-messages', (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const cfg = db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  res.json({ config: cfg || { instance_id: instance.id, greeting_enabled: 0, away_enabled: 0, away_mode: 'manual' } })
})

// PUT: salva config (upsert)
router.put('/whatsapp/:id/auto-messages', requireRole('super_admin', 'gerente'), (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const {
    greeting_enabled = 0, greeting_text = null, greeting_cooldown_hours = 24,
    away_enabled = 0, away_text = null, away_schedule_json = null, away_cooldown_hours = 4,
  } = req.body || {}
  // Modo manual descontinuado — sempre salva como 'schedule'
  const away_mode = 'schedule'
  const away_manual_active = 0

  // Valida JSON schedule
  let scheduleStr = null
  if (away_schedule_json) {
    try {
      if (typeof away_schedule_json === 'string') { JSON.parse(away_schedule_json); scheduleStr = away_schedule_json }
      else scheduleStr = JSON.stringify(away_schedule_json)
    } catch { return res.status(400).json({ error: 'away_schedule_json invalido' }) }
  }

  const existing = db.prepare('SELECT id FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  if (existing) {
    db.prepare(`
      UPDATE instance_auto_messages SET
        greeting_enabled = ?, greeting_text = ?, greeting_cooldown_hours = ?,
        away_enabled = ?, away_mode = ?, away_manual_active = ?, away_text = ?, away_schedule_json = ?, away_cooldown_hours = ?,
        updated_at = datetime('now')
      WHERE instance_id = ?
    `).run(
      greeting_enabled ? 1 : 0, greeting_text, parseInt(greeting_cooldown_hours) || 24,
      away_enabled ? 1 : 0, away_mode || 'manual', away_manual_active ? 1 : 0, away_text, scheduleStr, parseInt(away_cooldown_hours) || 4,
      instance.id
    )
  } else {
    db.prepare(`
      INSERT INTO instance_auto_messages (
        instance_id, greeting_enabled, greeting_text, greeting_cooldown_hours,
        away_enabled, away_mode, away_manual_active, away_text, away_schedule_json, away_cooldown_hours
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      instance.id,
      greeting_enabled ? 1 : 0, greeting_text, parseInt(greeting_cooldown_hours) || 24,
      away_enabled ? 1 : 0, away_mode || 'manual', away_manual_active ? 1 : 0, away_text, scheduleStr, parseInt(away_cooldown_hours) || 4,
    )
  }
  const cfg = db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  res.json({ config: cfg })
})

// Status da integracao Google Sheets — retorna timestamp do ultimo lead recebido
router.get('/sheets-status', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const row = db.prepare('SELECT last_sheets_lead_at FROM accounts WHERE id = ?').get(req.accountId)
  res.json({ last_lead_at: row?.last_sheets_lead_at || null })
})

export default router

import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// ─── Check + auto-reconnect TODAS as instancias WhatsApp (admin global)
// Usado pelo botao "Verificar todas as instancias" no painel admin
router.post('/instances/check-all', requireRole('super_admin'), async (req, res) => {
  const instances = db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    ORDER BY a.name, w.instance_name
  `).all()

  const results = []
  for (const inst of instances) {
    const r = { id: inst.id, account: inst.account_name, instance: inst.instance_name, action: '', state: '' }
    try {
      // Checa estado real via connectionState (URL-encoded pra suportar acentos/espacos)
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
        r.state = 'connected'
        r.action = 'already_connected'
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
          r.state = 'needs_qr'
          r.action = 'qr_required'
        } else if (newState === 'open' || newState === 'connected') {
          db.prepare("UPDATE whatsapp_instances SET status='connected', updated_at=datetime('now') WHERE id=?").run(inst.id)
          r.state = 'connected'
          r.action = 'reconnected_without_qr'
        } else {
          db.prepare("UPDATE whatsapp_instances SET status='connecting', updated_at=datetime('now') WHERE id=?").run(inst.id)
          r.state = 'connecting'
          r.action = 'pending_reconnect'
        }
      } else if (!realState) {
        r.state = 'no_response'
        r.action = 'evolution_unreachable'
      } else {
        r.state = realState
        r.action = 'unknown_state'
      }
    } catch (err) {
      r.state = 'error'
      r.action = 'request_failed'
      r.error = String(err.message).substring(0, 200)
    }
    results.push(r)
  }

  const summary = {
    total: results.length,
    connected: results.filter(r => r.state === 'connected').length,
    needs_qr: results.filter(r => r.state === 'needs_qr').length,
    connecting: results.filter(r => r.state === 'connecting').length,
    error: results.filter(r => r.state === 'error' || r.state === 'no_response').length,
  }

  res.json({ ok: true, summary, results })
})

export default router

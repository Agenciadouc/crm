import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { getProvider } from '../services/whatsappProvider/index.js'
import { setSystemNotice, clearSystemNotice, getSystemNotice } from '../sse.js'

const router = Router()

// ─── System notice (aviso global — popup em todo mundo logado) ────
// GET /api/admin/system-notice — qualquer user logado le pra saber se tem aviso ativo
router.get('/system-notice', (req, res) => {
  res.json({ notice: getSystemNotice() })
})

// POST /api/admin/system-notice — super_admin dispara aviso global
// Body: { message, type: 'info'|'warning'|'success', durationMinutes: number, title? }
router.post('/system-notice', requireRole('super_admin'), (req, res) => {
  const { message, type = 'info', durationMinutes = 5, title } = req.body || {}
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message obrigatorio' })
  const notice = {
    id: Date.now(),
    title: title ? String(title).slice(0, 100) : null,
    message: String(message).slice(0, 500),
    type: ['info', 'warning', 'success'].includes(type) ? type : 'info',
    expiresAt: Date.now() + Math.max(1, Math.min(1440, Number(durationMinutes) || 5)) * 60000,
    createdAt: Date.now(),
  }
  setSystemNotice(notice)
  res.json({ ok: true, notice })
})

// DELETE /api/admin/system-notice — cancela aviso antes do tempo
router.delete('/system-notice', requireRole('super_admin'), (req, res) => {
  clearSystemNotice()
  res.json({ ok: true })
})

// ─── Check + auto-reconnect TODAS as instancias WhatsApp (admin global)
// Usado pelo botao "Verificar todas as instancias" no painel admin
router.post('/instances/check-all', requireRole('super_admin'), async (req, res) => {
  const instances = db.prepare(`
    SELECT w.*, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    ORDER BY a.name, w.instance_name
  `).all()

  const results = []
  for (const inst of instances) {
    const r = { id: inst.id, account: inst.account_name, instance: inst.instance_name, action: '', state: '' }
    try {
      const provider = getProvider(inst)
      const { state: realState } = await provider.connectionState(inst)

      if (realState === 'open' || realState === 'connected') {
        if (inst.status !== 'connected') {
          db.prepare("UPDATE whatsapp_instances SET status='connected', updated_at=datetime('now') WHERE id=?").run(inst.id)
        }
        r.state = 'connected'
        r.action = 'already_connected'
      } else if (realState === 'close' || realState === 'closed' || realState === 'disconnected') {
        // Tenta reconectar
        const { qrcode, raw: connData } = await provider.connectInstance(inst)
        const newState = connData?.instance?.state || connData?.state || ''
        const hasQr = !!qrcode

        if (hasQr) {
          db.prepare("UPDATE whatsapp_instances SET status='connecting', qr_code=?, updated_at=datetime('now') WHERE id=?")
            .run(qrcode, inst.id)
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
        r.action = 'whatsapp_unreachable'
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

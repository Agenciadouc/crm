// Configs globais do CRM (super_admin only).
// Atualmente usado pra: notifier_instance_id (inst que envia notificacao de novo lead pros vendedores).

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// Chaves aceitas (whitelist pra evitar gravacao de chaves arbitrarias)
const ALLOWED_KEYS = ['notifier_instance_id']

// GET /api/app-settings — lista todas configs
router.get('/', requireRole('super_admin'), (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM app_settings').all()
  const settings = {}
  for (const r of rows) settings[r.key] = r.value
  res.json({ settings })
})

// GET /api/app-settings/all-instances — lista todas instâncias do sistema (cross-account) pro super_admin escolher notifier
router.get('/all-instances', requireRole('super_admin'), (req, res) => {
  const instances = db.prepare(`
    SELECT wi.id, wi.instance_name, wi.phone_number, wi.status, wi.account_id, a.name as account_name
    FROM whatsapp_instances wi
    LEFT JOIN accounts a ON a.id = wi.account_id
    ORDER BY a.name COLLATE NOCASE, wi.instance_name COLLATE NOCASE
  `).all()
  res.json({ instances })
})

// PUT /api/app-settings/:key — atualiza/insere uma config
router.put('/:key', requireRole('super_admin'), (req, res) => {
  const key = req.params.key
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({ error: 'Chave nao permitida' })
  }
  const value = req.body.value != null ? String(req.body.value) : null

  // Validacao especifica por chave
  if (key === 'notifier_instance_id') {
    if (value) {
      const n = parseInt(value)
      if (isNaN(n) || n <= 0) return res.status(400).json({ error: 'notifier_instance_id invalido' })
      const inst = db.prepare('SELECT id, instance_name FROM whatsapp_instances WHERE id = ?').get(n)
      if (!inst) return res.status(400).json({ error: 'Instancia nao encontrada' })
    }
  }

  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, value)

  res.json({ ok: true, key, value })
})

export default router

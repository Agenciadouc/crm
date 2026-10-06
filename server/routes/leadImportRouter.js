// server/routes/leadImportRouter.js
// Importar leads por planilha (spec 2026-10-06): previa e gravacao. So gestor/admin.
import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { planImport, applyImport, LeadImportError } from '../services/leadImport/importer.js'

export function createLeadImportRouter(db, { broadcast = () => {} } = {}) {
  const router = Router()
  router.use(json({ limit: '10mb' }))
  const manager = requireRole('super_admin', 'gerente')
  const fail = (res, e) => {
    if (e instanceof LeadImportError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Importar] erro:', e)
    return res.status(500).json({ error: 'Nada foi importado. Tente de novo.' })
  }
  const input = req => ({ accountId: req.accountId, rows: req.body?.rows, destination: req.body?.destination, fileName: String(req.body?.fileName || '').slice(0, 200) })

  router.post('/preview', manager, (req, res) => {
    try { res.json(planImport(db, input(req))) } catch (e) { fail(res, e) }
  })
  router.post('/', manager, (req, res) => {
    try {
      const r = applyImport(db, { ...input(req), userId: req.user.id })
      try { broadcast(req.accountId, 'lead:updated', { bulk: true }) } catch {}
      res.json({ created: r.created, updated: r.updated, skipped: r.skipped, tag_id: r.tag_id })
    } catch (e) { fail(res, e) }
  })
  return router
}

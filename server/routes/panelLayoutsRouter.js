// Rotas do "Arrumar" (ordem e o que aparece nos paineis, hoje a aba Atendimento do Chat).
// Tudo por conta (req.accountId). Vendedor salva/apaga so o proprio; padrao da conta so
// gerente/super_admin. Nao importa server/db.js (panelLayouts.js injeta).
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { PanelLayoutError, isKnownPanel, getPanelLayouts, savePanelLayout, deletePanelLayout } from '../services/panelLayouts.js'

export function createPanelLayoutsRouter(db) {
  const router = Router()
  const manager = requireRole('super_admin', 'gerente')

  function fail(res, e) {
    if (e instanceof PanelLayoutError) return res.status(e.status).json({ error: e.message })
    console.error('[Arrumar] erro:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }

  router.use((req, res, next) => {
    if (req.user.role === 'super_admin' && !req.accountId) return res.status(400).json({ error: 'Selecione uma conta.' })
    next()
  })
  router.param('panel', (req, res, next, panel) => {
    if (!isKnownPanel(panel)) return res.status(404).json({ error: 'Painel não encontrado.' })
    next()
  })

  router.get('/:panel', (req, res) => {
    try { res.json(getPanelLayouts(db, { accountId: req.accountId, userId: req.user.id, panel: req.params.panel })) } catch (e) { fail(res, e) }
  })

  router.put('/:panel/me', (req, res) => {
    try {
      const layout = savePanelLayout(db, { accountId: req.accountId, userId: req.user.id, panel: req.params.panel, layout: req.body?.layout })
      res.json({ layout })
    } catch (e) { fail(res, e) }
  })

  router.delete('/:panel/me', (req, res) => {
    try {
      deletePanelLayout(db, { accountId: req.accountId, userId: req.user.id, panel: req.params.panel })
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  router.put('/:panel/account', manager, (req, res) => {
    try {
      const layout = savePanelLayout(db, { accountId: req.accountId, userId: null, panel: req.params.panel, layout: req.body?.layout })
      res.json({ layout })
    } catch (e) { fail(res, e) }
  })

  return router
}

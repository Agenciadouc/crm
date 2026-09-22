// GET /api/media-temp/:token — publico (a UzAPI baixa daqui). Token aleatorio de 32 hex, validade de 10 minutos.
import { Router } from 'express'

export function createMediaTempRouter(mediaTemp) {
  const router = Router()
  router.get('/:token', (req, res) => {
    const file = mediaTemp.get(req.params.token)
    if (!file) return res.status(404).json({ error: 'Arquivo expirado ou inexistente' })
    res.set('Content-Type', file.mimetype || 'application/octet-stream')
    res.set('Cache-Control', 'no-store')
    res.send(file.buffer)
  })
  return router
}

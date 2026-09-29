/**
 * Rotas de embed — usadas por sistemas externos (Core Dros) pra ler dados
 * agregados do CRM sem precisar de login/JWT. Autenticacao por header
 * X-Core-Secret compartilhado.
 *
 * Rotas expostas:
 *   GET /api/embed/funnel/:slug/:month  → funil por etapa + CPL + CAC + ROAS
 *                                          + faturamento estimado + progresso da meta
 *
 * O ':month' aceita 'current' ou 'YYYY-MM'.
 * O ':slug' eh o slug publico da conta (accounts.slug).
 */
import { Router } from 'express'
import db from '../db.js'
import { computeFunnelCascade, loadMonthConfig, currentYearMonth, monthBounds } from './dashboard.js'

const router = Router()

// Segredo compartilhado com o Core. Setar CRM_EMBED_SECRET no .env do CRM
// (mesmo valor que o Core usa como CORE_EMBED_SECRET). Fallback padrao ha
// pra dev; troque em producao.
const EMBED_SECRET = process.env.CRM_EMBED_SECRET || 'dros-core-embed-2026-shared-key'

// Middleware: valida header X-Core-Secret ou query embed_secret
function requireCoreSecret(req, res, next) {
  const provided = req.headers['x-core-secret'] || req.query.embed_secret
  if (!provided || provided !== EMBED_SECRET) {
    return res.status(401).json({ error: 'invalid_secret' })
  }
  next()
}

// GET /funnel/:slug/:month
// Retorna:
//   {
//     account: { id, slug, name },
//     month,
//     cascade: { total, contato, atendimento, qualificado, visita, proposta, won, perdido, acompanhamento, real_revenue },
//     config: { ad_investment, sales_target, avg_ticket, notes },
//     calc: { cpl, cac, roas, estimated_revenue, target_progress, target_remaining }
//   }
router.get('/funnel/:slug/:month', requireCoreSecret, (req, res) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase().trim()
    if (!slug) return res.status(400).json({ error: 'slug obrigatorio' })

    const account = db.prepare('SELECT id, slug, name FROM accounts WHERE lower(slug) = ? AND is_active = 1').get(slug)
    if (!account) return res.status(404).json({ error: 'conta nao encontrada', slug })

    const month = req.params.month === 'current' ? currentYearMonth() : req.params.month
    if (!monthBounds(month)) return res.status(400).json({ error: 'formato de mes invalido (use YYYY-MM ou current)' })

    const cascade = computeFunnelCascade(account.id, month)
    if (!cascade) return res.status(500).json({ error: 'falha ao calcular cascade' })

    const cfg = loadMonthConfig(account.id, month)
    const investment = cfg.ad_investment
    const ticket = cfg.avg_ticket
    const target = cfg.sales_target
    const estimatedRevenue = cascade.real_revenue > 0 ? cascade.real_revenue : (cascade.won * ticket)

    const cpl = cascade.total > 0 ? investment / cascade.total : null
    const cac = cascade.won > 0 ? investment / cascade.won : null
    const roas = investment > 0 ? estimatedRevenue / investment : null
    const targetProgress = target > 0 ? (cascade.won / target) * 100 : null

    res.json({
      account: { id: account.id, slug: account.slug, name: account.name },
      month,
      cascade,
      config: cfg,
      calc: {
        cpl, cac, roas,
        estimated_revenue: estimatedRevenue,
        target_progress: targetProgress,
        target_remaining: Math.max(0, target - cascade.won),
      },
    })
  } catch (err) {
    console.error('[embed/funnel]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /health — teste rapido de que o embed ta no ar (autenticado tambem)
router.get('/health', requireCoreSecret, (req, res) => {
  res.json({ ok: true, at: new Date().toISOString() })
})

export default router

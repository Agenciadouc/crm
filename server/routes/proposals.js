import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const TEMPLATE_PATH = path.resolve(__dirname, '..', 'templates', 'proposta-template.html')

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function uniqueSlug(base, ignoreId = null) {
  let slug = base
  let n = 1
  while (true) {
    const existing = db.prepare('SELECT id FROM proposals WHERE slug = ?').get(slug)
    if (!existing || existing.id === ignoreId) return slug
    n++
    slug = `${base}-${n}`
  }
}

function formatBRL(v) {
  const n = Number(v) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })
}

function renderTemplate(p) {
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf-8')

  if (p.has_production) {
    html = html.replace(/<!--\s*BEGIN:NO_PRODUCTION\s*-->[\s\S]*?<!--\s*END:NO_PRODUCTION\s*-->/g, '')
    html = html.replace(/<!--\s*BEGIN:PRODUCTION\s*-->/g, '').replace(/<!--\s*END:PRODUCTION\s*-->/g, '')
  } else {
    html = html.replace(/<!--\s*BEGIN:PRODUCTION\s*-->[\s\S]*?<!--\s*END:PRODUCTION\s*-->/g, '')
    html = html.replace(/<!--\s*BEGIN:NO_PRODUCTION\s*-->/g, '').replace(/<!--\s*END:NO_PRODUCTION\s*-->/g, '')
  }

  // Comissao sobre faturamento — bloco condicional
  if (p.has_comissao && p.comissao_percent > 0) {
    html = html.replace(/<!--\s*BEGIN:COMISSAO\s*-->/g, '').replace(/<!--\s*END:COMISSAO\s*-->/g, '')
  } else {
    html = html.replace(/<!--\s*BEGIN:COMISSAO\s*-->[\s\S]*?<!--\s*END:COMISSAO\s*-->/g, '')
  }

  const replacements = {
    CLIENT_NAME: p.client_name || '',
    CLIENT_NAME_URL: encodeURIComponent(p.client_name || ''),
    NUM_VIDEOS: String(p.num_videos || 0),
    NUM_IMAGES: String(p.num_images || 0),
    VALOR: formatBRL(p.valor),
    CONTRATO_MESES: String(p.contrato_meses || 3),
    COMISSAO_PERCENT: String(p.comissao_percent || 0).replace('.', ','),
  }

  for (const [k, v] of Object.entries(replacements)) {
    html = html.replace(new RegExp(`{{${k}}}`, 'g'), v)
  }

  return html
}

// Handler exportado pra rota publica (registrada no index.js fora do auth)
export function publicProposalHandler(req, res) {
  const proposal = db.prepare('SELECT * FROM proposals WHERE slug = ?').get(req.params.slug)
  if (!proposal) return res.status(404).send('<h1>Proposta nao encontrada</h1>')
  try {
    const html = renderTemplate(proposal)
    res.set('Content-Type', 'text/html; charset=utf-8').send(html)
  } catch (err) {
    console.error('[Proposals] Render error:', err.message)
    res.status(500).send('<h1>Erro ao renderizar proposta</h1>')
  }
}

// Authenticated router — super_admin OU quem tem permissao can_manage_proposals
const router = Router()
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Nao autenticado' })
  if (req.user.role === 'super_admin') return next()
  // Consulta o banco pra pegar a flag atual (permite revogar sem precisar relogar)
  const u = db.prepare('SELECT can_manage_proposals FROM users WHERE id = ?').get(req.user.id)
  if (u?.can_manage_proposals === 1) return next()
  return res.status(403).json({ error: 'Sem permissao para gerenciar propostas' })
})

router.get('/', (req, res) => {
  const proposals = db.prepare(`
    SELECT p.*, u.name as created_by_name
    FROM proposals p
    LEFT JOIN users u ON u.id = p.created_by
    ORDER BY p.created_at DESC
  `).all()
  res.json({ proposals })
})

router.get('/:id', (req, res) => {
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id)
  if (!proposal) return res.status(404).json({ error: 'Proposta nao encontrada' })
  res.json({ proposal })
})

router.post('/', (req, res) => {
  const { client_name, phone, segmento, has_production, num_videos, num_images, valor, contrato_meses, observacoes, has_comissao, comissao_percent } = req.body
  if (!client_name) return res.status(400).json({ error: 'client_name obrigatorio' })

  const baseSlug = slugify(client_name)
  if (!baseSlug) return res.status(400).json({ error: 'Nome do cliente invalido' })
  const slug = uniqueSlug(baseSlug)

  const result = db.prepare(`
    INSERT INTO proposals (slug, client_name, phone, segmento, has_production, num_videos, num_images, valor, contrato_meses, observacoes, has_comissao, comissao_percent, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    slug, client_name, phone || null, segmento || null,
    has_production ? 1 : 0,
    parseInt(num_videos) || 0, parseInt(num_images) || 0,
    parseFloat(valor) || 0,
    parseInt(contrato_meses) || 3,
    observacoes || null,
    has_comissao ? 1 : 0,
    parseFloat(comissao_percent) || 0,
    req.user.id
  )

  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(result.lastInsertRowid)
  res.json({ proposal })
})

router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Proposta nao encontrada' })

  const { client_name, phone, segmento, has_production, num_videos, num_images, valor, contrato_meses, observacoes, has_comissao, comissao_percent } = req.body

  // Slug nao muda em edit (mantem URL fixa)
  const newName = client_name !== undefined ? client_name : existing.client_name
  if (!newName) return res.status(400).json({ error: 'client_name obrigatorio' })

  db.prepare(`
    UPDATE proposals SET
      client_name = ?, phone = ?, segmento = ?, has_production = ?,
      num_videos = ?, num_images = ?, valor = ?, contrato_meses = ?,
      observacoes = ?, has_comissao = ?, comissao_percent = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    newName,
    phone !== undefined ? (phone || null) : existing.phone,
    segmento !== undefined ? (segmento || null) : existing.segmento,
    has_production !== undefined ? (has_production ? 1 : 0) : existing.has_production,
    num_videos !== undefined ? (parseInt(num_videos) || 0) : existing.num_videos,
    num_images !== undefined ? (parseInt(num_images) || 0) : existing.num_images,
    valor !== undefined ? (parseFloat(valor) || 0) : existing.valor,
    contrato_meses !== undefined ? (parseInt(contrato_meses) || 3) : existing.contrato_meses,
    observacoes !== undefined ? (observacoes || null) : existing.observacoes,
    has_comissao !== undefined ? (has_comissao ? 1 : 0) : existing.has_comissao,
    comissao_percent !== undefined ? (parseFloat(comissao_percent) || 0) : existing.comissao_percent,
    req.params.id
  )

  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id)
  res.json({ proposal })
})

router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM proposals WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Proposta nao encontrada' })
  db.prepare('DELETE FROM proposals WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// List funnels
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const funnels = db.prepare('SELECT * FROM funnels WHERE account_id = ? AND is_active = 1 ORDER BY is_default DESC, name').all(req.accountId)
  // Attach stages
  const stageStmt = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position')
  for (const f of funnels) f.stages = stageStmt.all(f.id)
  res.json({ funnels })
})

// Create funnel
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, stages } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })

  const result = db.prepare('INSERT INTO funnels (account_id, name) VALUES (?, ?)').run(req.accountId, name)
  const funnelId = result.lastInsertRowid

  if (stages && Array.isArray(stages)) {
    const stmt = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, auto_keywords, meta_event_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    stages.forEach((s, i) => {
      stmt.run(funnelId, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null)
    })
  }

  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ?').get(funnelId)
  funnel.stages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(funnelId)
  res.json({ funnel })
})

// Get funnel with stages
router.get('/:id', (req, res) => {
  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ?').get(req.params.id)
  if (!funnel) return res.status(404).json({ error: 'Funil nao encontrado' })
  funnel.stages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(funnel.id)
  res.json({ funnel })
})

// Update funnel stages (full replacement)
router.put('/:id/stages', requireRole('super_admin', 'gerente'), (req, res) => {
  const { stages } = req.body
  if (!stages || !Array.isArray(stages)) return res.status(400).json({ error: 'stages array required' })

  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ?').get(req.params.id)
  if (!funnel) return res.status(404).json({ error: 'Funil nao encontrado' })

  // IDs que o frontend enviou (stages que existem e devem ser mantidas/atualizadas)
  const sentStageIds = new Set(stages.filter(s => s.id).map(s => s.id))
  // Stages com QUALQUER lead apontando (inclui arquivados) NUNCA podem ser deletadas
  const stagesWithLeads = new Set(db.prepare('SELECT DISTINCT stage_id FROM leads WHERE funnel_id = ?').all(funnel.id).map(r => r.stage_id))

  // Tenta deletar stages FORA da transaction principal (falha individual nao quebra tudo)
  const oldStages = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ?').all(funnel.id)
  for (const old of oldStages) {
    if (sentStageIds.has(old.id)) continue // mantida pelo front
    if (stagesWithLeads.has(old.id)) {
      console.log(`[Funnels] Stage ${old.id} mantida — tem leads (inclui arquivados)`)
      continue
    }
    try {
      // Limpa stage_history primeiro (FK sem CASCADE)
      db.prepare('DELETE FROM stage_history WHERE from_stage_id = ? OR to_stage_id = ?').run(old.id, old.id)
      db.prepare('DELETE FROM funnel_stages WHERE id = ?').run(old.id)
      console.log(`[Funnels] Stage ${old.id} deletada`)
    } catch (err) {
      console.error(`[Funnels] Falha ao deletar stage ${old.id} (FK constraint?):`, err.message)
      // Segue — stage continua no banco, no proximo GET o front recebe ela de volta
    }
  }

  const transaction = db.transaction(() => {
    // Upsert stages
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i]
      if (s.id) {
        db.prepare('UPDATE funnel_stages SET name = ?, position = ?, color = ?, is_conversion = ?, is_terminal = ?, auto_keywords = ?, meta_event_name = ? WHERE id = ?').run(
          s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null, s.id
        )
      } else {
        db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, auto_keywords, meta_event_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          funnel.id, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null
        )
      }
    }
  })
  transaction()

  funnel.stages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(funnel.id)
  res.json({ funnel })
})

// Update funnel name
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const { name, is_active, first_msg_template } = req.body
  const sets = []; const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (first_msg_template !== undefined) { sets.push('first_msg_template = ?'); params.push(first_msg_template || null) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  params.push(req.params.id)
  db.prepare(`UPDATE funnels SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ?').get(req.params.id)
  funnel.stages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(funnel.id)
  res.json({ funnel })
})

export default router

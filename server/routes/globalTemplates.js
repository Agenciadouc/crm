// Templates globais de cadences e follow-ups (Plano C).
// Criados pelo super_admin (Deivid), aplicados em qualquer conta.
// Snapshot: apply() faz INSERT em cadences/follow_ups da conta destino, com cloned_from_global_id.
// Editar template global NAO propaga automatico — precisa "Reaplicar".

import { Router } from 'express'
import db, { DEFAULT_EVOLUTION_API_URL, DEFAULT_EVOLUTION_API_KEY } from '../db.js'
import { requireRole, scopeToAccount } from '../middleware/auth.js'

const router = Router()

// ============================================================
// ENDPOINTS PRA GERENTE (list disponiveis + aplicar na propria conta)
// ============================================================
// Diferente do /apply do super_admin (que aceita account_ids), aqui gerente/super_admin
// aplica na CONTA DELE (req.accountId, resolvido via scopeToAccount middleware do index.js).

// GET /api/global-templates/available?account_id=X (gerente/super_admin)
// Lista todos globals ativos + flag applied_here se conta ja recebeu esse template
router.get('/available', requireRole('super_admin', 'gerente'), scopeToAccount, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })

  const cadences = db.prepare('SELECT * FROM global_cadences WHERE is_active = 1 ORDER BY name').all()
  const stmtCadAttempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position')
  const stmtCadApplied = db.prepare('SELECT id FROM cadences WHERE account_id = ? AND cloned_from_global_id = ? AND is_active = 1 LIMIT 1')
  for (const c of cadences) {
    c.attempts = stmtCadAttempts.all(c.id)
    const applied = stmtCadApplied.get(req.accountId, c.id)
    c.applied_here = !!applied
    c.applied_cadence_id = applied?.id || null
  }

  const followUps = db.prepare('SELECT * FROM global_follow_ups WHERE is_active = 1 ORDER BY name').all()
  const stmtFuSteps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position')
  const stmtFuApplied = db.prepare('SELECT id FROM follow_ups WHERE account_id = ? AND cloned_from_global_id = ? AND is_active = 1 LIMIT 1')
  for (const fu of followUps) {
    fu.steps = stmtFuSteps.all(fu.id)
    const applied = stmtFuApplied.get(req.accountId, fu.id)
    fu.applied_here = !!applied
    fu.applied_follow_up_id = applied?.id || null
  }

  res.json({ cadences, follow_ups: followUps })
})

// POST /api/global-templates/cadences/:id/apply-here?account_id=X — gerente aplica na CONTA DELE
// Body: { overwrite?: boolean }
router.post('/cadences/:id/apply-here', requireRole('super_admin', 'gerente'), scopeToAccount, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { overwrite } = req.body

  const gc = db.prepare('SELECT id FROM global_cadences WHERE id = ? AND is_active = 1').get(req.params.id)
  if (!gc) return res.status(404).json({ error: 'Template nao encontrado' })

  try {
    if (overwrite) {
      db.prepare("UPDATE cadences SET is_active = 0, updated_at = datetime('now') WHERE account_id = ? AND cloned_from_global_id = ?").run(req.accountId, req.params.id)
    }
    const newId = cloneGlobalCadenceToAccount(req.params.id, req.accountId)
    res.json({ ok: true, new_cadence_id: newId })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

// POST /api/global-templates/follow-ups/:id/apply-here?account_id=X — gerente aplica follow-up na conta dele
// Body: { instance_id, agent_id?, inactivity_stage_id?, overwrite? }
router.post('/follow-ups/:id/apply-here', requireRole('super_admin', 'gerente'), scopeToAccount, (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { instance_id, agent_id, inactivity_stage_id, overwrite } = req.body
  if (!instance_id) return res.status(400).json({ error: 'instance_id obrigatorio' })

  const gfu = db.prepare('SELECT id FROM global_follow_ups WHERE id = ? AND is_active = 1').get(req.params.id)
  if (!gfu) return res.status(404).json({ error: 'Template nao encontrado' })

  try {
    if (overwrite) {
      db.prepare("UPDATE follow_ups SET is_active = 0, updated_at = datetime('now') WHERE account_id = ? AND cloned_from_global_id = ?").run(req.accountId, req.params.id)
    }
    const newId = cloneGlobalFollowUpToAccount(req.params.id, req.accountId, { instance_id, agent_id, inactivity_stage_id, created_by: req.user.id })
    res.json({ ok: true, new_follow_up_id: newId })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

// ============================================================
// CADENCES GLOBAIS
// ============================================================

// GET /api/global-templates/cadences — lista com attempts + contagem de contas aplicadas
router.get('/cadences', requireRole('super_admin'), (req, res) => {
  const cadences = db.prepare('SELECT * FROM global_cadences WHERE is_active = 1 ORDER BY name').all()
  const stmtAttempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position')
  const stmtApplied = db.prepare('SELECT COUNT(*) as n FROM cadences WHERE cloned_from_global_id = ?')
  for (const c of cadences) {
    c.attempts = stmtAttempts.all(c.id)
    c.applied_count = stmtApplied.get(c.id).n
  }
  res.json({ cadences })
})

// GET /api/global-templates/cadences/:id
router.get('/cadences/:id', requireRole('super_admin'), (req, res) => {
  const cadence = db.prepare('SELECT * FROM global_cadences WHERE id = ?').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Template nao encontrado' })
  cadence.attempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position').all(cadence.id)
  res.json({ cadence })
})

// POST /api/global-templates/cadences — cria (com attempts inline)
router.post('/cadences', requireRole('super_admin'), (req, res) => {
  const { name, description, attempts } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })

  const trans = db.transaction(() => {
    const result = db.prepare('INSERT INTO global_cadences (name, description, created_by) VALUES (?, ?, ?)').run(name, description || null, req.user.id)
    const gcId = result.lastInsertRowid
    if (Array.isArray(attempts)) {
      const stmt = db.prepare('INSERT INTO global_cadence_attempts (global_cadence_id, position, action_type, description, instructions, delay_days, delay_minutes, scheduled_time, auto_message, schedule_mode, call_script) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      attempts.forEach((a, i) => {
        stmt.run(gcId, i, a.action_type || 'mensagem', a.description || null, a.instructions || null, parseInt(a.delay_days) || 0, parseInt(a.delay_minutes) || 0, a.scheduled_time || null, a.auto_message || null, a.schedule_mode === 'duration' ? 'duration' : 'date', a.call_script || null)
      })
    }
    return gcId
  })
  const gcId = trans()
  const cadence = db.prepare('SELECT * FROM global_cadences WHERE id = ?').get(gcId)
  cadence.attempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position').all(gcId)
  res.json({ cadence })
})

// PUT /api/global-templates/cadences/:id — edita metadata
router.put('/cadences/:id', requireRole('super_admin'), (req, res) => {
  const { name, description, is_active } = req.body
  const sets = [], params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE global_cadences SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const cadence = db.prepare('SELECT * FROM global_cadences WHERE id = ?').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Template nao encontrado' })
  cadence.attempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position').all(cadence.id)
  res.json({ cadence })
})

// PUT /api/global-templates/cadences/:id/attempts — full replace dos steps
router.put('/cadences/:id/attempts', requireRole('super_admin'), (req, res) => {
  const { attempts } = req.body
  if (!Array.isArray(attempts)) return res.status(400).json({ error: 'attempts array required' })
  const cadence = db.prepare('SELECT * FROM global_cadences WHERE id = ?').get(req.params.id)
  if (!cadence) return res.status(404).json({ error: 'Template nao encontrado' })

  const trans = db.transaction(() => {
    db.prepare('DELETE FROM global_cadence_attempts WHERE global_cadence_id = ?').run(cadence.id)
    const stmt = db.prepare('INSERT INTO global_cadence_attempts (global_cadence_id, position, action_type, description, instructions, delay_days, delay_minutes, scheduled_time, auto_message, schedule_mode, call_script) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    attempts.forEach((a, i) => {
      stmt.run(cadence.id, i, a.action_type || 'mensagem', a.description || null, a.instructions || null, parseInt(a.delay_days) || 0, parseInt(a.delay_minutes) || 0, a.scheduled_time || null, a.auto_message || null, a.schedule_mode === 'duration' ? 'duration' : 'date', a.call_script || null)
    })
    db.prepare("UPDATE global_cadences SET updated_at = datetime('now') WHERE id = ?").run(cadence.id)
  })
  trans()
  cadence.attempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position').all(cadence.id)
  res.json({ cadence })
})

// DELETE /api/global-templates/cadences/:id — soft delete (contas com copia continuam funcionando)
router.delete('/cadences/:id', requireRole('super_admin'), (req, res) => {
  db.prepare("UPDATE global_cadences SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

// GET /api/global-templates/cadences/:id/applied-in — lista contas que ja receberam este template
router.get('/cadences/:id/applied-in', requireRole('super_admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT c.id as cadence_id, c.name as cadence_name, c.account_id, a.name as account_name, c.created_at
    FROM cadences c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.cloned_from_global_id = ?
    ORDER BY a.name
  `).all(req.params.id)
  res.json({ applied: rows })
})

// Helper: clona template global em UMA conta (INSERT em cadences + attempts). Idempotente por (account_id, global_id)?
// NAO — deixamos duplicar se re-aplicar sem apagar. Frontend controla via toggle "reaplicar".
function cloneGlobalCadenceToAccount(globalCadenceId, accountId) {
  const gc = db.prepare('SELECT * FROM global_cadences WHERE id = ?').get(globalCadenceId)
  if (!gc) throw new Error('Template global nao encontrado')
  const attempts = db.prepare('SELECT * FROM global_cadence_attempts WHERE global_cadence_id = ? ORDER BY position').all(globalCadenceId)

  const trans = db.transaction(() => {
    const result = db.prepare('INSERT INTO cadences (account_id, name, description, cloned_from_global_id) VALUES (?, ?, ?, ?)').run(accountId, gc.name, gc.description, globalCadenceId)
    const newCadenceId = result.lastInsertRowid
    const stmt = db.prepare('INSERT INTO cadence_attempts (cadence_id, position, action_type, description, instructions, delay_days, delay_minutes, scheduled_time, auto_message, schedule_mode, call_script) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    for (const a of attempts) {
      stmt.run(newCadenceId, a.position, a.action_type, a.description, a.instructions, a.delay_days, a.delay_minutes, a.scheduled_time, a.auto_message, a.schedule_mode, a.call_script)
    }
    return newCadenceId
  })
  return trans()
}

// POST /api/global-templates/cadences/:id/apply — body { account_ids: [1,2,3], overwrite?: boolean }
// Se overwrite=true, deleta cópias anteriores (com cloned_from_global_id = this) antes de re-criar.
router.post('/cadences/:id/apply', requireRole('super_admin'), (req, res) => {
  const { account_ids, overwrite } = req.body
  if (!Array.isArray(account_ids) || account_ids.length === 0) return res.status(400).json({ error: 'account_ids array required' })

  const gc = db.prepare('SELECT id FROM global_cadences WHERE id = ? AND is_active = 1').get(req.params.id)
  if (!gc) return res.status(404).json({ error: 'Template nao encontrado' })

  const results = []
  for (const accountId of account_ids) {
    try {
      const acc = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(accountId)
      if (!acc) { results.push({ account_id: accountId, ok: false, error: 'Conta nao existe' }); continue }
      if (overwrite) {
        // Soft-delete copias antigas dessa mesma origem nessa conta
        db.prepare("UPDATE cadences SET is_active = 0, updated_at = datetime('now') WHERE account_id = ? AND cloned_from_global_id = ?").run(accountId, req.params.id)
      }
      const newId = cloneGlobalCadenceToAccount(req.params.id, accountId)
      results.push({ account_id: accountId, account_name: acc.name, ok: true, new_cadence_id: newId })
    } catch (e) {
      results.push({ account_id: accountId, ok: false, error: e.message })
    }
  }
  res.json({ results })
})


// ============================================================
// FOLLOW-UPS GLOBAIS
// ============================================================

// GET /api/global-templates/follow-ups
router.get('/follow-ups', requireRole('super_admin'), (req, res) => {
  const followUps = db.prepare('SELECT * FROM global_follow_ups WHERE is_active = 1 ORDER BY name').all()
  const stmtSteps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position')
  const stmtApplied = db.prepare('SELECT COUNT(*) as n FROM follow_ups WHERE cloned_from_global_id = ?')
  for (const fu of followUps) {
    fu.steps = stmtSteps.all(fu.id)
    fu.applied_count = stmtApplied.get(fu.id).n
  }
  res.json({ follow_ups: followUps })
})

// GET /api/global-templates/follow-ups/:id
router.get('/follow-ups/:id', requireRole('super_admin'), (req, res) => {
  const fu = db.prepare('SELECT * FROM global_follow_ups WHERE id = ?').get(req.params.id)
  if (!fu) return res.status(404).json({ error: 'Template nao encontrado' })
  fu.steps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position').all(fu.id)
  res.json({ follow_up: fu })
})

// POST /api/global-templates/follow-ups — cria (com steps inline)
// Body: { name, description, stop_on_reply, type ('sequence'|'inactivity'), inactivity_days/minutes/mode, variation_delay_seconds, on_reply_action, steps: [{delay_minutes, message_template, schedule_mode, scheduled_at, variations}] }
router.post('/follow-ups', requireRole('super_admin'), (req, res) => {
  const { name, description, stop_on_reply, type, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds, on_reply_action, steps } = req.body
  if (!name) return res.status(400).json({ error: 'Nome obrigatorio' })
  if (!Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: 'pelo menos 1 step obrigatorio' })

  const finalType = type === 'inactivity' ? 'inactivity' : 'sequence'
  const finalMode = inactivity_mode === 'sequence' ? 'sequence' : 'rotation'
  const finalDays = Math.max(1, parseInt(inactivity_days) || 2)
  const finalMins = inactivity_minutes ? Math.max(1, parseInt(inactivity_minutes)) : null
  const finalVarDelay = Math.max(30, parseInt(variation_delay_seconds) || 60)
  const finalOnReply = ['pause', 'roulette', 'assign_user'].includes(on_reply_action) ? on_reply_action : 'pause'

  const trans = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO global_follow_ups (name, description, stop_on_reply, type, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds, on_reply_action, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description || null, stop_on_reply ? 1 : 0, finalType, finalDays, finalMins, finalMode, finalVarDelay, finalOnReply, req.user.id)
    const gfuId = result.lastInsertRowid

    const stmt = db.prepare('INSERT INTO global_follow_up_steps (global_follow_up_id, position, delay_minutes, message_template, schedule_mode, scheduled_at, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
    steps.forEach((s, i) => {
      const variationsJson = Array.isArray(s.variations) ? JSON.stringify(s.variations.map(v => String(v || '').trim()).filter(Boolean)) : null
      stmt.run(gfuId, i + 1, parseInt(s.delay_minutes) || 60, String(s.message_template || ''), s.schedule_mode === 'absolute' ? 'absolute' : 'relative', s.scheduled_at || null, variationsJson)
    })
    return gfuId
  })
  const gfuId = trans()
  const fu = db.prepare('SELECT * FROM global_follow_ups WHERE id = ?').get(gfuId)
  fu.steps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position').all(gfuId)
  res.json({ follow_up: fu })
})

// PUT /api/global-templates/follow-ups/:id — edita metadata + steps
router.put('/follow-ups/:id', requireRole('super_admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM global_follow_ups WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Template nao encontrado' })
  const { name, description, stop_on_reply, is_active, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds, on_reply_action, steps } = req.body

  const sets = [], params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (description !== undefined) { sets.push('description = ?'); params.push(description) }
  if (stop_on_reply !== undefined) { sets.push('stop_on_reply = ?'); params.push(stop_on_reply ? 1 : 0) }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (inactivity_days !== undefined) { sets.push('inactivity_days = ?'); params.push(Math.max(1, parseInt(inactivity_days) || 2)) }
  if (inactivity_minutes !== undefined) { sets.push('inactivity_minutes = ?'); params.push(inactivity_minutes ? Math.max(1, parseInt(inactivity_minutes)) : null) }
  if (inactivity_mode !== undefined) { sets.push('inactivity_mode = ?'); params.push(inactivity_mode === 'sequence' ? 'sequence' : 'rotation') }
  if (variation_delay_seconds !== undefined) { sets.push('variation_delay_seconds = ?'); params.push(Math.max(30, parseInt(variation_delay_seconds) || 60)) }
  if (on_reply_action !== undefined) { sets.push('on_reply_action = ?'); params.push(['pause','roulette','assign_user'].includes(on_reply_action) ? on_reply_action : 'pause') }
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)

  const trans = db.transaction(() => {
    if (sets.length > 1) db.prepare(`UPDATE global_follow_ups SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    if (Array.isArray(steps)) {
      db.prepare('DELETE FROM global_follow_up_steps WHERE global_follow_up_id = ?').run(req.params.id)
      const stmt = db.prepare('INSERT INTO global_follow_up_steps (global_follow_up_id, position, delay_minutes, message_template, schedule_mode, scheduled_at, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
      steps.forEach((s, i) => {
        const variationsJson = Array.isArray(s.variations) ? JSON.stringify(s.variations.map(v => String(v || '').trim()).filter(Boolean)) : null
        stmt.run(req.params.id, i + 1, parseInt(s.delay_minutes) || 60, String(s.message_template || ''), s.schedule_mode === 'absolute' ? 'absolute' : 'relative', s.scheduled_at || null, variationsJson)
      })
    }
  })
  trans()
  const fu = db.prepare('SELECT * FROM global_follow_ups WHERE id = ?').get(req.params.id)
  fu.steps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position').all(req.params.id)
  res.json({ follow_up: fu })
})

// DELETE /api/global-templates/follow-ups/:id — soft delete
router.delete('/follow-ups/:id', requireRole('super_admin'), (req, res) => {
  db.prepare("UPDATE global_follow_ups SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

// GET /api/global-templates/follow-ups/:id/applied-in
router.get('/follow-ups/:id/applied-in', requireRole('super_admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT fu.id as follow_up_id, fu.name as follow_up_name, fu.account_id, a.name as account_name,
           fu.instance_id, wi.instance_name, fu.agent_id, fu.created_at
    FROM follow_ups fu
    LEFT JOIN accounts a ON a.id = fu.account_id
    LEFT JOIN whatsapp_instances wi ON wi.id = fu.instance_id
    WHERE fu.cloned_from_global_id = ?
    ORDER BY a.name
  `).all(req.params.id)
  res.json({ applied: rows })
})

// Helper: clona global_follow_up numa conta com instance/agent mapping
function cloneGlobalFollowUpToAccount(globalFollowUpId, accountId, mapping) {
  const gfu = db.prepare('SELECT * FROM global_follow_ups WHERE id = ?').get(globalFollowUpId)
  if (!gfu) throw new Error('Template global nao encontrado')

  // Valida instance pertence a conta e ta connected
  const inst = db.prepare('SELECT id FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(mapping.instance_id, accountId)
  if (!inst) throw new Error(`instance_id ${mapping.instance_id} nao pertence a conta ${accountId}`)

  let finalAgentId = null
  if (mapping.agent_id) {
    const ag = db.prepare('SELECT id FROM ai_agents WHERE id = ? AND account_id = ?').get(mapping.agent_id, accountId)
    if (!ag) throw new Error(`agent_id ${mapping.agent_id} nao pertence a conta ${accountId}`)
    finalAgentId = ag.id
  }

  let finalStageId = null
  if (mapping.inactivity_stage_id) {
    const stage = db.prepare('SELECT s.id FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ? AND f.account_id = ?').get(mapping.inactivity_stage_id, accountId)
    if (!stage) throw new Error(`inactivity_stage_id ${mapping.inactivity_stage_id} nao pertence a conta ${accountId}`)
    finalStageId = stage.id
  }
  // Se tipo=inactivity e nao tem agent E nao tem stage, erro
  if (gfu.type === 'inactivity' && !finalAgentId && !finalStageId) {
    throw new Error('Follow-up de inatividade precisa de agent_id OU inactivity_stage_id (defina no mapping)')
  }

  const steps = db.prepare('SELECT * FROM global_follow_up_steps WHERE global_follow_up_id = ? ORDER BY position').all(globalFollowUpId)

  const trans = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO follow_ups (
        account_id, name, description, instance_id, stop_on_reply, created_by, type,
        inactivity_stage_id, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds,
        on_reply_action, agent_id, cloned_from_global_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId, gfu.name, gfu.description, mapping.instance_id, gfu.stop_on_reply,
      mapping.created_by || null, gfu.type,
      finalStageId, gfu.inactivity_days, gfu.inactivity_minutes, gfu.inactivity_mode || 'rotation', gfu.variation_delay_seconds,
      gfu.on_reply_action, finalAgentId, globalFollowUpId
    )
    const newFuId = result.lastInsertRowid
    const stmt = db.prepare('INSERT INTO follow_up_steps (follow_up_id, position, delay_minutes, message_template, schedule_mode, scheduled_at, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const s of steps) {
      stmt.run(newFuId, s.position, s.delay_minutes, s.message_template, s.schedule_mode, s.scheduled_at, s.variations)
    }
    return newFuId
  })
  return trans()
}

// POST /api/global-templates/follow-ups/:id/apply
// Body: { mappings: [{account_id, instance_id, agent_id?, inactivity_stage_id?}], overwrite?: boolean }
router.post('/follow-ups/:id/apply', requireRole('super_admin'), (req, res) => {
  const { mappings, overwrite } = req.body
  if (!Array.isArray(mappings) || mappings.length === 0) return res.status(400).json({ error: 'mappings array required' })

  const gfu = db.prepare('SELECT id FROM global_follow_ups WHERE id = ? AND is_active = 1').get(req.params.id)
  if (!gfu) return res.status(404).json({ error: 'Template nao encontrado' })

  const results = []
  for (const m of mappings) {
    try {
      if (!m.account_id || !m.instance_id) { results.push({ account_id: m.account_id, ok: false, error: 'account_id e instance_id obrigatorios' }); continue }
      const acc = db.prepare('SELECT id, name FROM accounts WHERE id = ?').get(m.account_id)
      if (!acc) { results.push({ account_id: m.account_id, ok: false, error: 'Conta nao existe' }); continue }
      if (overwrite) {
        db.prepare("UPDATE follow_ups SET is_active = 0, updated_at = datetime('now') WHERE account_id = ? AND cloned_from_global_id = ?").run(m.account_id, req.params.id)
      }
      const newId = cloneGlobalFollowUpToAccount(req.params.id, m.account_id, { ...m, created_by: req.user.id })
      results.push({ account_id: m.account_id, account_name: acc.name, ok: true, new_follow_up_id: newId })
    } catch (e) {
      results.push({ account_id: m.account_id, ok: false, error: e.message })
    }
  }
  res.json({ results })
})

export default router

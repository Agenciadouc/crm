import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { broadcastSSE } from '../sse.js'

const router = Router()

// Helper: calcula next_run_at do step considerando modo absolute/relative
export function computeNextRun(step, anchorDate) {
  if (step.schedule_mode === 'absolute' && step.scheduled_at) {
    const target = new Date(step.scheduled_at.replace(' ', 'T') + (step.scheduled_at.endsWith('Z') ? '' : 'Z'))
    if (isNaN(target.getTime())) return new Date()
    return target.getTime() < Date.now() ? new Date() : target
  }
  const anchor = anchorDate ? new Date(anchorDate) : new Date()
  return new Date(anchor.getTime() + (step.delay_minutes || 0) * 60_000)
}

function toSqlDate(d) {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19)
}

// Valida e normaliza scheduled_at (aceita ISO ou 'YYYY-MM-DD HH:MM:SS' ou datetime-local 'YYYY-MM-DDTHH:MM')
function normalizeScheduledAt(raw, allowPast = false) {
  if (!raw) return null
  const s = String(raw).replace('T', ' ')
  // Aceita formato com ou sem Z. Tenta parsear como UTC se vier sem TZ.
  const tryDate = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'))
  if (isNaN(tryDate.getTime())) throw new Error('scheduled_at invalido')
  if (!allowPast && tryDate.getTime() < Date.now() - 60_000) throw new Error('scheduled_at precisa ser no futuro')
  return tryDate.toISOString().replace('T', ' ').slice(0, 19)
}

// ─── GET lista de follow-ups da conta ─────────────────────────────────
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })

  const followUps = db.prepare(`
    SELECT fu.*, wi.instance_name as instance_name, wi.status as instance_status,
      (SELECT COUNT(*) FROM follow_up_steps WHERE follow_up_id = fu.id) as steps_count,
      (SELECT COUNT(*) FROM lead_follow_ups WHERE follow_up_id = fu.id AND status = 'active') as active_leads,
      u.name as created_by_name
    FROM follow_ups fu
    LEFT JOIN whatsapp_instances wi ON wi.id = fu.instance_id
    LEFT JOIN users u ON u.id = fu.created_by
    WHERE fu.account_id = ?
    ORDER BY fu.created_at DESC
  `).all(req.accountId)

  // Carrega steps de cada follow-up
  const result = followUps.map(fu => {
    const steps = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
    return { ...fu, steps }
  })
  res.json({ follow_ups: result })
})

// ─── GET follow-up vinculado a um agente (1:1 ou null) ───────────────
// Usado pelo AgentEditorModal pra carregar o follow-up de inatividade do bot.
router.get('/by-agent/:agentId', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const agent = db.prepare('SELECT id FROM ai_agents WHERE id = ? AND account_id = ?').get(req.params.agentId, req.accountId)
  if (!agent) return res.status(404).json({ error: 'Agente nao encontrado' })
  const fu = db.prepare('SELECT * FROM follow_ups WHERE agent_id = ? AND account_id = ?').get(req.params.agentId, req.accountId)
  if (!fu) return res.json({ follow_up: null })
  const steps = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
  res.json({ follow_up: { ...fu, steps } })
})

// ─── GET detalhe ───────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!fu) return res.status(404).json({ error: 'Follow-up nao encontrado' })
  const steps = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
  res.json({ follow_up: { ...fu, steps } })
})

// ─── helpers v3 (validação on-reply + variations) ──────────────────────
function normalizeOnReply(body, accountId) {
  const action = ['pause', 'roulette', 'assign_user'].includes(body.on_reply_action) ? body.on_reply_action : 'pause'
  let userId = null
  if (action === 'assign_user') {
    const uid = parseInt(body.on_reply_user_id)
    if (!uid) throw new Error('on_reply_user_id obrigatorio quando on_reply_action=assign_user')
    const u = db.prepare('SELECT id FROM users WHERE id = ? AND account_id = ? AND is_active = 1').get(uid, accountId)
    if (!u) throw new Error('Atendente alvo invalido ou inativo')
    userId = u.id
  }
  // Acoes adicionais opcionais (independentes do action)
  let stageId = null
  if (body.on_reply_move_to_stage_id) {
    const sid = parseInt(body.on_reply_move_to_stage_id)
    if (!sid) throw new Error('on_reply_move_to_stage_id invalido')
    const s = db.prepare(`
      SELECT s.id FROM funnel_stages s
      JOIN funnels f ON f.id = s.funnel_id
      WHERE s.id = ? AND f.account_id = ?
    `).get(sid, accountId)
    if (!s) throw new Error('Etapa de destino invalida pra essa conta')
    stageId = s.id
  }
  let tagId = null
  if (body.on_reply_add_tag_id) {
    const tid = parseInt(body.on_reply_add_tag_id)
    if (!tid) throw new Error('on_reply_add_tag_id invalido')
    const t = db.prepare('SELECT id FROM tags WHERE id = ? AND account_id = ?').get(tid, accountId)
    if (!t) throw new Error('Tag invalida pra essa conta')
    tagId = t.id
  }
  return { action, userId, stageId, tagId }
}

function normalizeStepVariations(s) {
  // Aceita s.variations como array de strings; armazena JSON ou null
  if (Array.isArray(s.variations)) {
    const cleaned = s.variations.map(v => String(v || '').trim()).filter(Boolean)
    if (cleaned.length > 0) return JSON.stringify(cleaned)
  }
  return null
}

// ─── POST criar (com steps) ────────────────────────────────────────────
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const { name, description, instance_id, stop_on_reply, steps, type, inactivity_stage_id, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds, agent_id } = req.body
  if (!name || !instance_id) return res.status(400).json({ error: 'name e instance_id obrigatorios' })
  if (!Array.isArray(steps) || steps.length === 0) return res.status(400).json({ error: 'pelo menos 1 step obrigatorio' })

  // Valida instance pertence a conta
  const inst = db.prepare('SELECT id FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instance_id, req.accountId)
  if (!inst) return res.status(400).json({ error: 'Instancia invalida pra essa conta' })

  // Valida agente (se vinculado) pertence a conta — usado pra follow-up agent-based
  let finalAgentId = null
  if (agent_id) {
    const ag = db.prepare('SELECT id FROM ai_agents WHERE id = ? AND account_id = ?').get(agent_id, req.accountId)
    if (!ag) return res.status(400).json({ error: 'Agente invalido pra essa conta' })
    finalAgentId = ag.id
  }

  // Validacoes especificas por tipo
  const finalType = type === 'inactivity' ? 'inactivity' : 'sequence'
  let finalInactivityStage = null, finalInactivityDays = 2, finalInactivityMinutes = null, finalInactivityMode = 'rotation', finalVariationDelay = 30

  if (finalType === 'inactivity') {
    finalInactivityMode = inactivity_mode === 'sequence' ? 'sequence' : 'rotation'
    if (finalInactivityMode === 'rotation' && steps.length < 3) return res.status(400).json({ error: 'Modo rotation exige no minimo 3 variacoes de mensagem' })
    if (finalInactivityMode === 'sequence') {
      // cada step precisa ter pelo menos 3 variations OU message_template valido (variation_template eh fallback)
      for (const s of steps) {
        const hasVars = Array.isArray(s.variations) && s.variations.filter(v => String(v || '').trim()).length >= 3
        const hasTpl = s.message_template && s.message_template.trim()
        if (!hasVars && !hasTpl) return res.status(400).json({ error: 'Cada step precisa ter mensagem principal ou no mínimo 3 variações' })
      }
    }
    // Stage obrigatorio APENAS quando NAO eh agent-based.
    // Em agent-based: scanner busca por attendant_id (user_bot), nao por stage.
    if (!finalAgentId) {
      if (!inactivity_stage_id) return res.status(400).json({ error: 'Etapa do funil obrigatoria pra follow-up de inatividade (ou vincule a um agente)' })
      const stage = db.prepare('SELECT s.id FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ? AND f.account_id = ?').get(inactivity_stage_id, req.accountId)
      if (!stage) return res.status(400).json({ error: 'Etapa do funil invalida pra essa conta' })
      finalInactivityStage = inactivity_stage_id
    }
    finalInactivityDays = Math.max(1, parseInt(inactivity_days) || 2)
    if (inactivity_minutes !== undefined && inactivity_minutes !== null && inactivity_minutes !== '') {
      const m = parseInt(inactivity_minutes)
      if (isNaN(m) || m < 1) return res.status(400).json({ error: 'inactivity_minutes invalido' })
      finalInactivityMinutes = m
    }
    finalVariationDelay = Math.max(30, parseInt(variation_delay_seconds) || 60)
  }

  // On-reply
  let onReply
  try { onReply = normalizeOnReply(req.body, req.accountId) }
  catch (e) { return res.status(400).json({ error: e.message }) }

  // Valida cada step
  const normalizedSteps = []
  for (const s of steps) {
    const variationsJson = normalizeStepVariations(s)
    const hasTpl = s.message_template && s.message_template.trim()
    if (!variationsJson && !hasTpl) return res.status(400).json({ error: 'Toda etapa precisa de mensagem ou variações' })
    const stepMode = s.schedule_mode === 'absolute' ? 'absolute' : 'relative'
    let stepScheduledAt = null
    if (finalType === 'sequence' && stepMode === 'absolute') {
      try { stepScheduledAt = normalizeScheduledAt(s.scheduled_at) }
      catch (e) { return res.status(400).json({ error: e.message }) }
    }
    normalizedSteps.push({
      delay_minutes: parseInt(s.delay_minutes) || 0,
      schedule_mode: finalType === 'inactivity' ? 'relative' : stepMode,
      scheduled_at: stepScheduledAt,
      message_template: hasTpl ? s.message_template.trim() : '',
      variations: variationsJson,
    })
  }

  const trans = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO follow_ups (account_id, name, description, instance_id, stop_on_reply, created_by, type, inactivity_stage_id, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds, on_reply_action, on_reply_user_id, on_reply_move_to_stage_id, on_reply_add_tag_id, agent_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.accountId, name, description || null, instance_id, stop_on_reply ? 1 : 0, req.user.id, finalType, finalInactivityStage, finalInactivityDays, finalInactivityMinutes, finalInactivityMode, finalVariationDelay, onReply.action, onReply.userId, onReply.stageId, onReply.tagId, finalAgentId)

    const fuId = result.lastInsertRowid
    const stmt = db.prepare('INSERT INTO follow_up_steps (follow_up_id, position, delay_minutes, message_template, schedule_mode, scheduled_at, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
    normalizedSteps.forEach((s, i) => {
      stmt.run(fuId, i + 1, s.delay_minutes, s.message_template, s.schedule_mode, s.scheduled_at, s.variations)
    })
    return fuId
  })

  const newId = trans()
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(newId)
  const stepsOut = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(newId)
  res.json({ follow_up: { ...fu, steps: stepsOut } })
})

// ─── PUT editar ────────────────────────────────────────────────────────
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!fu) return res.status(404).json({ error: 'Follow-up nao encontrado' })

  const { name, description, instance_id, stop_on_reply, is_active, steps, inactivity_stage_id, inactivity_days, inactivity_minutes, inactivity_mode, variation_delay_seconds } = req.body
  // Tipo nao muda em edit (pra simplificar — se quiser mudar de sequence pra inactivity, cria outro)
  if (instance_id) {
    const inst = db.prepare('SELECT id FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instance_id, req.accountId)
    if (!inst) return res.status(400).json({ error: 'Instancia invalida pra essa conta' })
  }

  const finalType = fu.type || 'sequence'
  let finalInactivityStage = fu.inactivity_stage_id
  let finalInactivityDays = fu.inactivity_days
  let finalInactivityMinutes = fu.inactivity_minutes
  let finalInactivityMode = fu.inactivity_mode || 'rotation'
  let finalVariationDelay = fu.variation_delay_seconds

  if (finalType === 'inactivity') {
    if (inactivity_mode !== undefined) finalInactivityMode = inactivity_mode === 'sequence' ? 'sequence' : 'rotation'
    if (inactivity_stage_id !== undefined) {
      const stage = db.prepare('SELECT s.id FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ? AND f.account_id = ?').get(inactivity_stage_id, req.accountId)
      if (!stage) return res.status(400).json({ error: 'Etapa do funil invalida' })
      finalInactivityStage = inactivity_stage_id
    }
    if (inactivity_days !== undefined) finalInactivityDays = Math.max(1, parseInt(inactivity_days) || 2)
    if (inactivity_minutes !== undefined) {
      if (inactivity_minutes === null || inactivity_minutes === '') {
        finalInactivityMinutes = null
      } else {
        const m = parseInt(inactivity_minutes)
        if (isNaN(m) || m < 1) return res.status(400).json({ error: 'inactivity_minutes invalido' })
        finalInactivityMinutes = m
      }
    }
    if (variation_delay_seconds !== undefined) finalVariationDelay = Math.max(30, parseInt(variation_delay_seconds) || 30)
    if (Array.isArray(steps)) {
      if (finalInactivityMode === 'rotation' && steps.length < 3) return res.status(400).json({ error: 'Modo rotation exige no minimo 3 variacoes' })
      if (finalInactivityMode === 'sequence') {
        for (const s of steps) {
          const hasVars = Array.isArray(s.variations) && s.variations.filter(v => String(v || '').trim()).length >= 3
          const hasTpl = s.message_template && s.message_template.trim()
          if (!hasVars && !hasTpl) return res.status(400).json({ error: 'Cada step precisa ter mensagem principal ou no mínimo 3 variações' })
        }
      }
    }
  }

  // On-reply
  let onReplyAction = fu.on_reply_action || 'pause'
  let onReplyUserId = fu.on_reply_user_id
  let onReplyStageId = fu.on_reply_move_to_stage_id
  let onReplyTagId = fu.on_reply_add_tag_id
  // Roda normalize se qualquer um dos campos on_reply_* foi enviado
  if (req.body.on_reply_action !== undefined || req.body.on_reply_move_to_stage_id !== undefined || req.body.on_reply_add_tag_id !== undefined) {
    try {
      // Preserva action atual se nao mandou
      const body = {
        on_reply_action: req.body.on_reply_action !== undefined ? req.body.on_reply_action : onReplyAction,
        on_reply_user_id: req.body.on_reply_user_id !== undefined ? req.body.on_reply_user_id : onReplyUserId,
        on_reply_move_to_stage_id: req.body.on_reply_move_to_stage_id !== undefined ? req.body.on_reply_move_to_stage_id : onReplyStageId,
        on_reply_add_tag_id: req.body.on_reply_add_tag_id !== undefined ? req.body.on_reply_add_tag_id : onReplyTagId,
      }
      const onReply = normalizeOnReply(body, req.accountId)
      onReplyAction = onReply.action
      onReplyUserId = onReply.userId
      onReplyStageId = onReply.stageId
      onReplyTagId = onReply.tagId
    } catch (e) { return res.status(400).json({ error: e.message }) }
  }

  // Normaliza steps se vier
  let normalizedSteps = null
  if (Array.isArray(steps)) {
    normalizedSteps = []
    for (const s of steps) {
      const variationsJson = normalizeStepVariations(s)
      const hasTpl = s.message_template && s.message_template.trim()
      if (!variationsJson && !hasTpl) return res.status(400).json({ error: 'Toda etapa precisa de mensagem ou variações' })
      const stepMode = s.schedule_mode === 'absolute' ? 'absolute' : 'relative'
      let stepScheduledAt = null
      if (finalType === 'sequence' && stepMode === 'absolute') {
        try { stepScheduledAt = normalizeScheduledAt(s.scheduled_at, true) }  // allowPast em edit
        catch (e) { return res.status(400).json({ error: e.message }) }
      }
      normalizedSteps.push({
        delay_minutes: parseInt(s.delay_minutes) || 0,
        schedule_mode: finalType === 'inactivity' ? 'relative' : stepMode,
        scheduled_at: stepScheduledAt,
        message_template: hasTpl ? s.message_template.trim() : '',
        variations: variationsJson,
      })
    }
  }

  const trans = db.transaction(() => {
    db.prepare(`
      UPDATE follow_ups SET
        name = ?, description = ?, instance_id = ?, stop_on_reply = ?, is_active = ?,
        inactivity_stage_id = ?, inactivity_days = ?, inactivity_minutes = ?, inactivity_mode = ?,
        variation_delay_seconds = ?, on_reply_action = ?, on_reply_user_id = ?, on_reply_move_to_stage_id = ?, on_reply_add_tag_id = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name !== undefined ? name : fu.name,
      description !== undefined ? (description || null) : fu.description,
      instance_id || fu.instance_id,
      stop_on_reply !== undefined ? (stop_on_reply ? 1 : 0) : fu.stop_on_reply,
      is_active !== undefined ? (is_active ? 1 : 0) : fu.is_active,
      finalInactivityStage, finalInactivityDays, finalInactivityMinutes, finalInactivityMode,
      finalVariationDelay, onReplyAction, onReplyUserId, onReplyStageId, onReplyTagId,
      fu.id
    )

    if (normalizedSteps) {
      db.prepare('DELETE FROM follow_up_steps WHERE follow_up_id = ?').run(fu.id)
      const stmt = db.prepare('INSERT INTO follow_up_steps (follow_up_id, position, delay_minutes, message_template, schedule_mode, scheduled_at, variations) VALUES (?, ?, ?, ?, ?, ?, ?)')
      normalizedSteps.forEach((s, i) => {
        stmt.run(fu.id, i + 1, s.delay_minutes, s.message_template, s.schedule_mode, s.scheduled_at, s.variations)
      })
    }
  })

  try { trans() } catch (e) { return res.status(400).json({ error: e.message }) }

  const updated = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(fu.id)
  const stepsOut = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position').all(fu.id)
  res.json({ follow_up: { ...updated, steps: stepsOut } })
})

// ─── DELETE ────────────────────────────────────────────────────────────
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!fu) return res.status(404).json({ error: 'Follow-up nao encontrado' })

  const active = db.prepare("SELECT COUNT(*) as c FROM lead_follow_ups WHERE follow_up_id = ? AND status = 'active'").get(fu.id).c
  if (active > 0 && !req.query.force) {
    return res.status(400).json({ error: `Existem ${active} lead(s) ativos. Pra apagar mesmo assim, use ?force=1 (vai cancelar os ativos).` })
  }
  // Force: cancela todos ativos antes de apagar
  db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason='followup_deleted' WHERE follow_up_id = ? AND status IN ('active','paused')").run(fu.id)
  db.prepare('DELETE FROM follow_ups WHERE id = ?').run(fu.id)
  res.json({ ok: true })
})

// ─── POST atribuir lead a follow-up ────────────────────────────────────
router.post('/:id/assign', (req, res) => {
  const fu = db.prepare('SELECT * FROM follow_ups WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!fu) return res.status(404).json({ error: 'Follow-up nao encontrado' })
  if (!fu.is_active) return res.status(400).json({ error: 'Follow-up esta inativo' })
  if ((fu.type || 'sequence') !== 'sequence') {
    return res.status(400).json({ error: 'Follow-ups de inatividade nao sao atribuidos manualmente. Sistema scan-eia automaticamente.' })
  }

  const { lead_id } = req.body
  if (!lead_id) return res.status(400).json({ error: 'lead_id obrigatorio' })

  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(lead_id, req.accountId)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (lead.is_blocked) return res.status(400).json({ error: 'Lead esta bloqueado/excluido — desbloqueie antes de atribuir follow-up.' })
  if (lead.is_archived) return res.status(400).json({ error: 'Lead esta arquivado — desarquive antes de atribuir follow-up.' })
  if (!lead.is_active) return res.status(400).json({ error: 'Lead esta inativo.' })
  if (!lead.phone) return res.status(400).json({ error: 'Lead sem telefone — impossivel enviar msg.' })

  // Pega step 1
  const firstStep = db.prepare('SELECT * FROM follow_up_steps WHERE follow_up_id = ? ORDER BY position ASC LIMIT 1').get(fu.id)
  if (!firstStep) return res.status(400).json({ error: 'Follow-up sem etapas configuradas' })

  // Se ja tem follow-up ativo nesse lead, cancela primeiro
  db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason='replaced' WHERE lead_id = ? AND status IN ('active', 'paused')").run(lead.id)

  // Calcula next_run_at (usa helper que respeita schedule_mode)
  const nextRunDate = computeNextRun(firstStep, new Date())
  const nextRun = toSqlDate(nextRunDate)

  const result = db.prepare(`
    INSERT INTO lead_follow_ups (lead_id, follow_up_id, current_step_id, status, next_run_at, started_at, assigned_by)
    VALUES (?, ?, ?, 'active', ?, datetime('now'), ?)
  `).run(lead.id, fu.id, firstStep.id, nextRun, req.user.id)

  const lfu = db.prepare('SELECT * FROM lead_follow_ups WHERE id = ?').get(result.lastInsertRowid)
  try { broadcastSSE(lead.account_id, 'followup:assigned', { lead_id: lead.id, follow_up_id: fu.id }) } catch {}
  res.json({ lead_follow_up: lfu })
})

// ─── GET follow-up ativo de um lead (pra exibir no chat) ──────────────
router.get('/lead/:leadId', (req, res) => {
  const leadId = parseInt(req.params.leadId)
  const lfu = db.prepare(`
    SELECT lfu.*, fu.name as follow_up_name, fu.stop_on_reply, fu.instance_id, wi.instance_name,
      cs.position as current_position, cs.message_template as current_message,
      (SELECT COUNT(*) FROM follow_up_steps WHERE follow_up_id = fu.id) as total_steps
    FROM lead_follow_ups lfu
    JOIN follow_ups fu ON fu.id = lfu.follow_up_id
    LEFT JOIN follow_up_steps cs ON cs.id = lfu.current_step_id
    LEFT JOIN whatsapp_instances wi ON wi.id = fu.instance_id
    JOIN leads l ON l.id = lfu.lead_id
    WHERE lfu.lead_id = ? AND l.account_id = ? AND lfu.status IN ('active', 'paused')
    ORDER BY lfu.id DESC LIMIT 1
  `).get(leadId, req.accountId)
  res.json({ lead_follow_up: lfu || null })
})

// ─── POST pausar manual ───────────────────────────────────────────────
router.post('/lead/:lfuId/pause', (req, res) => {
  const lfu = db.prepare('SELECT lfu.* FROM lead_follow_ups lfu JOIN leads l ON l.id = lfu.lead_id WHERE lfu.id = ? AND l.account_id = ?').get(req.params.lfuId, req.accountId)
  if (!lfu) return res.status(404).json({ error: 'Lead follow-up nao encontrado' })
  if (lfu.status !== 'active') return res.status(400).json({ error: 'Follow-up nao esta ativo' })
  db.prepare("UPDATE lead_follow_ups SET status='paused', paused_at=datetime('now'), paused_reason='manual', updated_at=datetime('now') WHERE id=?").run(lfu.id)
  res.json({ ok: true })
})

// ─── POST retomar ─────────────────────────────────────────────────────
router.post('/lead/:lfuId/resume', (req, res) => {
  const lfu = db.prepare('SELECT lfu.* FROM lead_follow_ups lfu JOIN leads l ON l.id = lfu.lead_id WHERE lfu.id = ? AND l.account_id = ?').get(req.params.lfuId, req.accountId)
  if (!lfu) return res.status(404).json({ error: 'Lead follow-up nao encontrado' })
  if (lfu.status !== 'paused') return res.status(400).json({ error: 'Follow-up nao esta pausado' })
  if (!lfu.current_step_id) return res.status(400).json({ error: 'Sem step atual pra retomar' })

  // Recalcula next_run_at — envia agora (proximo tick)
  db.prepare("UPDATE lead_follow_ups SET status='active', paused_at=NULL, paused_reason=NULL, next_run_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(lfu.id)
  res.json({ ok: true })
})

// ─── POST cancelar ────────────────────────────────────────────────────
router.post('/lead/:lfuId/cancel', (req, res) => {
  const lfu = db.prepare('SELECT lfu.* FROM lead_follow_ups lfu JOIN leads l ON l.id = lfu.lead_id WHERE lfu.id = ? AND l.account_id = ?').get(req.params.lfuId, req.accountId)
  if (!lfu) return res.status(404).json({ error: 'Lead follow-up nao encontrado' })
  if (lfu.status === 'completed' || lfu.status === 'cancelled') return res.status(400).json({ error: 'Follow-up ja finalizado' })
  db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason='manual', current_step_id=NULL, next_run_at=NULL, updated_at=datetime('now') WHERE id=?").run(lfu.id)
  res.json({ ok: true })
})

export default router

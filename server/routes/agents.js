import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { callHaiku } from '../services/anthropicClient.js'

const router = Router()

const HANDOFF_REASONS = ['qualified', 'keyword', 'unknown', 'max_messages', 'audio_received']

// ─── Helpers ──────────────────────────────────────────────────────────

function loadAgentFull(agentId) {
  const agent = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId)
  if (!agent) return null
  agent.stages = db.prepare(`
    SELECT s.id, s.name, s.color, s.funnel_id, f.name as funnel_name
    FROM ai_agent_stages a
    JOIN funnel_stages s ON s.id = a.stage_id
    JOIN funnels f ON f.id = s.funnel_id
    WHERE a.agent_id = ?
  `).all(agentId)
  agent.instances = db.prepare(`
    SELECT i.id, i.instance_name, i.status
    FROM ai_agent_instances a
    JOIN whatsapp_instances i ON i.id = a.instance_id
    WHERE a.agent_id = ?
  `).all(agentId)
  agent.handoff_rules = db.prepare(`
    SELECT hr.*, u.name as target_user_name, fs.name as stage_name, t.name as tag_name
    FROM ai_agent_handoff_rules hr
    LEFT JOIN users u ON u.id = hr.target_user_id
    LEFT JOIN funnel_stages fs ON fs.id = hr.move_to_stage_id
    LEFT JOIN tags t ON t.id = hr.add_tag_id
    WHERE hr.agent_id = ?
  `).all(agentId)
  agent.required_fields_arr = (() => {
    try { return JSON.parse(agent.required_fields || '[]') } catch { return [] }
  })()
  return agent
}

function checkAccountFeature(accountId) {
  const acc = db.prepare('SELECT ai_agents_enabled FROM accounts WHERE id = ?').get(accountId)
  return acc && acc.ai_agents_enabled === 1
}

function resetMonthlyTokensIfNeeded(agent) {
  const currentMonth = new Date().toISOString().slice(0, 7) // 'YYYY-MM'
  if (agent.current_month !== currentMonth) {
    db.prepare("UPDATE ai_agents SET tokens_used_this_month = 0, current_month = ? WHERE id = ?").run(currentMonth, agent.id)
    agent.tokens_used_this_month = 0
    agent.current_month = currentMonth
  }
}

// ─── Routes ───────────────────────────────────────────────────────────

// Lista agentes da conta
router.get('/', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  if (!checkAccountFeature(req.accountId)) return res.json({ feature_enabled: false, agents: [] })

  const agents = db.prepare(`
    SELECT a.*, u.name as bot_user_name,
      (SELECT COUNT(*) FROM ai_agent_stages WHERE agent_id = a.id) as stages_count,
      (SELECT COUNT(*) FROM ai_agent_instances WHERE agent_id = a.id) as instances_count
    FROM ai_agents a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.account_id = ?
    ORDER BY a.created_at DESC
  `).all(req.accountId)
  res.json({ feature_enabled: true, agents })
})

// Detalhe (com stages, instances, handoff_rules)
router.get('/:id', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  if (!checkAccountFeature(req.accountId)) return res.status(403).json({ error: 'Recurso nao habilitado nessa conta' })
  const agent = loadAgentFull(req.params.id)
  if (!agent || agent.account_id !== req.accountId) return res.status(404).json({ error: 'Agente nao encontrado' })
  resetMonthlyTokensIfNeeded(agent)
  res.json({ agent })
})

// Criar agente (cria user shadow is_bot=1 + agente + relacionamentos em transacao)
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  if (!checkAccountFeature(req.accountId)) return res.status(403).json({ error: 'Recurso nao habilitado nessa conta' })

  const b = req.body || {}
  if (!b.name || !String(b.name).trim()) return res.status(400).json({ error: 'name obrigatorio' })

  // Validar stages/instances pertencem a conta
  const stageIds = Array.isArray(b.stage_ids) ? b.stage_ids : []
  const instanceIds = Array.isArray(b.instance_ids) ? b.instance_ids : []
  if (stageIds.length > 0) {
    const placeholders = stageIds.map(() => '?').join(',')
    const valid = db.prepare(`SELECT COUNT(*) as c FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id IN (${placeholders}) AND f.account_id = ?`).get(...stageIds, req.accountId)
    if (valid.c !== stageIds.length) return res.status(400).json({ error: 'Alguma etapa nao pertence a essa conta' })
  }
  if (instanceIds.length > 0) {
    const placeholders = instanceIds.map(() => '?').join(',')
    const valid = db.prepare(`SELECT COUNT(*) as c FROM whatsapp_instances WHERE id IN (${placeholders}) AND account_id = ?`).get(...instanceIds, req.accountId)
    if (valid.c !== instanceIds.length) return res.status(400).json({ error: 'Alguma instancia nao pertence a essa conta' })
  }

  const handoffRules = Array.isArray(b.handoff_rules) ? b.handoff_rules : []
  for (const r of handoffRules) {
    if (!HANDOFF_REASONS.includes(r.reason)) return res.status(400).json({ error: `reason invalido: ${r.reason}` })
    if (!['roulette', 'specific_user'].includes(r.target_type)) return res.status(400).json({ error: `target_type invalido: ${r.target_type}` })
  }

  try {
    const newAgentId = db.transaction(() => {
      // 1. Cria user shadow (is_bot=1)
      const botEmail = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@dros-bot.internal`
      const botPwd = bcrypt.hashSync(Math.random().toString(36), 10)
      const userRes = db.prepare(`
        INSERT INTO users (account_id, name, email, password, role, is_active, is_bot)
        VALUES (?, ?, ?, ?, 'atendente', 1, 1)
      `).run(req.accountId, `🤖 ${b.name.trim()}`, botEmail, botPwd)

      // 2. Cria agente
      const agentRes = db.prepare(`
        INSERT INTO ai_agents (
          account_id, user_id, name, is_active, identifies_as_bot,
          persona, knowledge_base, never_mention, qualification_criteria, required_fields,
          responds_to_audio, audio_decline_message,
          max_messages_before_handoff, handoff_keywords,
          activation_mode, required_tag_id, monthly_token_limit, current_month
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.accountId,
        userRes.lastInsertRowid,
        b.name.trim(),
        b.is_active === 0 ? 0 : 1,
        b.identifies_as_bot === 0 ? 0 : 1,
        b.persona || null,
        b.knowledge_base || null,
        b.never_mention || null,
        b.qualification_criteria || null,
        Array.isArray(b.required_fields) ? JSON.stringify(b.required_fields) : null,
        b.responds_to_audio ? 1 : 0,
        b.audio_decline_message || 'Oi! Por enquanto so leio mensagens de texto. Pode digitar pra mim?',
        parseInt(b.max_messages_before_handoff) || 15,
        b.handoff_keywords || 'humano,atendente,vendedor,corretor,pessoa',
        ['default_attendant', 'roulette', 'conditional', 'manual'].includes(b.activation_mode) ? b.activation_mode : 'conditional',
        b.required_tag_id || null,
        parseInt(b.monthly_token_limit) || 500000,
        new Date().toISOString().slice(0, 7)
      )
      const agentId = agentRes.lastInsertRowid

      // 3. Stages
      if (stageIds.length > 0) {
        const stmt = db.prepare('INSERT INTO ai_agent_stages (agent_id, stage_id) VALUES (?, ?)')
        for (const sid of stageIds) stmt.run(agentId, sid)
      }
      // 4. Instances
      if (instanceIds.length > 0) {
        const stmt = db.prepare('INSERT INTO ai_agent_instances (agent_id, instance_id) VALUES (?, ?)')
        for (const iid of instanceIds) stmt.run(agentId, iid)
      }
      // 5. Handoff rules
      if (handoffRules.length > 0) {
        const stmt = db.prepare(`
          INSERT INTO ai_agent_handoff_rules (agent_id, reason, target_type, target_user_id, fallback_to_roulette, move_to_stage_id, add_tag_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const r of handoffRules) {
          stmt.run(agentId, r.reason, r.target_type, r.target_user_id || null, r.fallback_to_roulette === 0 ? 0 : 1, r.move_to_stage_id || null, r.add_tag_id || null)
        }
      }

      return agentId
    })()

    const agent = loadAgentFull(newAgentId)
    res.json({ agent })
  } catch (e) {
    console.error('[POST /agents] error:', e.message)
    res.status(500).json({ error: 'Erro ao criar agente: ' + e.message })
  }
})

// Editar agente
router.put('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  if (!checkAccountFeature(req.accountId)) return res.status(403).json({ error: 'Recurso nao habilitado nessa conta' })

  const existing = db.prepare('SELECT * FROM ai_agents WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!existing) return res.status(404).json({ error: 'Agente nao encontrado' })

  const b = req.body || {}
  const stageIds = Array.isArray(b.stage_ids) ? b.stage_ids : null
  const instanceIds = Array.isArray(b.instance_ids) ? b.instance_ids : null
  const handoffRules = Array.isArray(b.handoff_rules) ? b.handoff_rules : null

  if (handoffRules) {
    for (const r of handoffRules) {
      if (!HANDOFF_REASONS.includes(r.reason)) return res.status(400).json({ error: `reason invalido: ${r.reason}` })
      if (!['roulette', 'specific_user'].includes(r.target_type)) return res.status(400).json({ error: `target_type invalido: ${r.target_type}` })
    }
  }

  try {
    db.transaction(() => {
      // Update campos do agente
      const sets = []
      const params = []
      const fields = {
        name: b.name !== undefined ? String(b.name).trim() : undefined,
        is_active: b.is_active !== undefined ? (b.is_active ? 1 : 0) : undefined,
        identifies_as_bot: b.identifies_as_bot !== undefined ? (b.identifies_as_bot ? 1 : 0) : undefined,
        persona: b.persona,
        knowledge_base: b.knowledge_base,
        never_mention: b.never_mention,
        qualification_criteria: b.qualification_criteria,
        required_fields: b.required_fields !== undefined ? JSON.stringify(b.required_fields) : undefined,
        responds_to_audio: b.responds_to_audio !== undefined ? (b.responds_to_audio ? 1 : 0) : undefined,
        audio_decline_message: b.audio_decline_message,
        max_messages_before_handoff: b.max_messages_before_handoff !== undefined ? (parseInt(b.max_messages_before_handoff) || 15) : undefined,
        handoff_keywords: b.handoff_keywords,
        activation_mode: b.activation_mode && ['default_attendant', 'roulette', 'conditional', 'manual'].includes(b.activation_mode) ? b.activation_mode : undefined,
        required_tag_id: b.required_tag_id !== undefined ? (b.required_tag_id || null) : undefined,
        monthly_token_limit: b.monthly_token_limit !== undefined ? (parseInt(b.monthly_token_limit) || 500000) : undefined,
      }
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) { sets.push(`${k} = ?`); params.push(v) }
      }
      if (sets.length > 0) {
        sets.push("updated_at = datetime('now')")
        params.push(req.params.id)
        db.prepare(`UPDATE ai_agents SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      }

      // Sync stages/instances/handoff_rules se vieram
      if (stageIds) {
        db.prepare('DELETE FROM ai_agent_stages WHERE agent_id = ?').run(req.params.id)
        const stmt = db.prepare('INSERT INTO ai_agent_stages (agent_id, stage_id) VALUES (?, ?)')
        for (const sid of stageIds) stmt.run(req.params.id, sid)
      }
      if (instanceIds) {
        db.prepare('DELETE FROM ai_agent_instances WHERE agent_id = ?').run(req.params.id)
        const stmt = db.prepare('INSERT INTO ai_agent_instances (agent_id, instance_id) VALUES (?, ?)')
        for (const iid of instanceIds) stmt.run(req.params.id, iid)
      }
      if (handoffRules) {
        db.prepare('DELETE FROM ai_agent_handoff_rules WHERE agent_id = ?').run(req.params.id)
        const stmt = db.prepare(`
          INSERT INTO ai_agent_handoff_rules (agent_id, reason, target_type, target_user_id, fallback_to_roulette, move_to_stage_id, add_tag_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        for (const r of handoffRules) {
          stmt.run(req.params.id, r.reason, r.target_type, r.target_user_id || null, r.fallback_to_roulette === 0 ? 0 : 1, r.move_to_stage_id || null, r.add_tag_id || null)
        }
      }

      // Atualiza nome do user shadow tb
      if (fields.name) {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(`🤖 ${fields.name}`, existing.user_id)
      }
    })()

    res.json({ agent: loadAgentFull(req.params.id) })
  } catch (e) {
    console.error('[PUT /agents/:id] error:', e.message)
    res.status(500).json({ error: 'Erro ao editar agente: ' + e.message })
  }
})

// Soft delete (is_active=0). Mantem historico em ai_agent_token_log.
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const existing = db.prepare('SELECT * FROM ai_agents WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!existing) return res.status(404).json({ error: 'Agente nao encontrado' })
  // Soft delete: desativa agente E inativa user shadow (some do dropdown de atendentes)
  db.prepare("UPDATE ai_agents SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id)
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(existing.user_id)
  res.json({ ok: true })
})

// Uso de tokens — gauge consumido X/Y + log das ultimas chamadas
router.get('/:id/usage', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const agent = db.prepare('SELECT * FROM ai_agents WHERE id = ? AND account_id = ?').get(req.params.id, req.accountId)
  if (!agent) return res.status(404).json({ error: 'Agente nao encontrado' })
  resetMonthlyTokensIfNeeded(agent)

  const currentMonth = new Date().toISOString().slice(0, 7)
  const monthStart = `${currentMonth}-01 00:00:00`
  const totalCost = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost_usd,
      COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), 0) as total_tokens
    FROM ai_agent_token_log
    WHERE agent_id = ? AND created_at >= ?
  `).get(req.params.id, monthStart)

  const recentLog = db.prepare(`
    SELECT tl.*, l.name as lead_name
    FROM ai_agent_token_log tl
    LEFT JOIN leads l ON l.id = tl.lead_id
    WHERE tl.agent_id = ?
    ORDER BY tl.id DESC LIMIT 30
  `).all(req.params.id)

  res.json({
    monthly_limit: agent.monthly_token_limit,
    tokens_used_this_month: totalCost.total_tokens,
    cost_usd_this_month: totalCost.cost_usd,
    current_month: agent.current_month,
    recent_log: recentLog,
  })
})

// Sandbox de teste — conversa com Haiku sem disparar WhatsApp.
// Body: { message: 'texto', history: [{role, content}] }
router.post('/:id/test', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const agent = loadAgentFull(req.params.id)
  if (!agent || agent.account_id !== req.accountId) return res.status(404).json({ error: 'Agente nao encontrado' })

  const { message, history = [] } = req.body || {}
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message obrigatorio' })

  // Monta system prompt simples (preview — service real vai ter tools etc)
  const systemPrompt = [
    `Voce e ${agent.name}.`,
    agent.persona ? `Tom: ${agent.persona}` : '',
    agent.identifies_as_bot ? 'Voce e uma IA assistente.' : '',
    '',
    'CONTEXTO DA EMPRESA:',
    agent.knowledge_base || '(nao configurado)',
    '',
    'REGRAS:',
    `- Responda em PT-BR, maximo 2 frases curtas.`,
    agent.never_mention ? `- NUNCA mencione: ${agent.never_mention}` : '',
    `- Se o lead disser palavras como "${agent.handoff_keywords}" → diga "vou te passar pra equipe agora".`,
    agent.qualification_criteria ? `- Considere qualificado quando: ${agent.qualification_criteria}` : '',
    `- Se nao souber algo, diga "vou consultar a equipe" em vez de inventar.`,
  ].filter(Boolean).join('\n')

  // Monta mensagens
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ]

  try {
    const result = await callHaiku({ systemPrompt, messages, maxTokens: 300 })
    res.json({
      response: result.content,
      usage: result.usage,
      cost_usd: result.costUsd,
      stop_reason: result.stopReason,
    })
  } catch (e) {
    console.error('[POST /agents/:id/test] error:', e.message)
    res.status(500).json({ error: 'Erro no sandbox: ' + e.message })
  }
})

export default router

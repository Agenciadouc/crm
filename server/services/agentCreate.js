import bcrypt from 'bcryptjs'
import { AGENT_MODES, normalizeAgentMode } from './copilotMode.js'

// Mesma lista de server/routes/agents.js (nao exportada de la para nao alterar
// nada fora da rota POST / nesta task)
const HANDOFF_REASONS = ['qualified', 'keyword', 'unknown', 'max_messages', 'audio_received']

// Cria o usuario-bot (is_bot=1) + o agente + relacionamentos (stages, instances,
// handoff_rules) em uma unica transacao. Movido verbatim da rota POST /api/agents
// (task 7) para ser reutilizado pela ativacao via entrevista (task 8).
export function createAgentRecord(db, { accountId, body }) {
  const b = body || {}
  if (!b.name || !String(b.name).trim()) return { ok: false, error: 'name obrigatorio' }

  // Validar stages/instances pertencem a conta
  const stageIds = Array.isArray(b.stage_ids) ? b.stage_ids : []
  const instanceIds = Array.isArray(b.instance_ids) ? b.instance_ids : []
  if (stageIds.length > 0) {
    const placeholders = stageIds.map(() => '?').join(',')
    const valid = db.prepare(`SELECT COUNT(*) as c FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id IN (${placeholders}) AND f.account_id = ?`).get(...stageIds, accountId)
    if (valid.c !== stageIds.length) return { ok: false, error: 'Alguma etapa nao pertence a essa conta' }
  }
  if (instanceIds.length > 0) {
    const placeholders = instanceIds.map(() => '?').join(',')
    const valid = db.prepare(`SELECT COUNT(*) as c FROM whatsapp_instances WHERE id IN (${placeholders}) AND account_id = ?`).get(...instanceIds, accountId)
    if (valid.c !== instanceIds.length) return { ok: false, error: 'Alguma instancia nao pertence a essa conta' }
  }

  const handoffRules = Array.isArray(b.handoff_rules) ? b.handoff_rules : []
  for (const r of handoffRules) {
    if (!HANDOFF_REASONS.includes(r.reason)) return { ok: false, error: `reason invalido: ${r.reason}` }
    if (!['roulette', 'specific_user'].includes(r.target_type)) return { ok: false, error: `target_type invalido: ${r.target_type}` }
  }

  if (b.mode !== undefined && !AGENT_MODES.includes(b.mode)) return { ok: false, error: `mode invalido: ${b.mode}` }

  const newAgentId = db.transaction(() => {
    // 1. Cria user shadow (is_bot=1)
    const botEmail = `bot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@dros-bot.internal`
    const botPwd = bcrypt.hashSync(Math.random().toString(36), 10)
    const userRes = db.prepare(`
      INSERT INTO users (account_id, name, email, password, role, is_active, is_bot)
      VALUES (?, ?, ?, ?, 'atendente', 1, 1)
    `).run(accountId, `🤖 ${b.name.trim()}`, botEmail, botPwd)

    // 2. Cria agente
    const agentRes = db.prepare(`
      INSERT INTO ai_agents (
        account_id, user_id, name, is_active, identifies_as_bot,
        persona, knowledge_base, never_mention, qualification_criteria, required_fields,
        responds_to_audio, audio_decline_message,
        max_messages_before_handoff, handoff_keywords,
        activation_mode, required_tag_id, monthly_token_limit, current_month, mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
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
      new Date().toISOString().slice(0, 7),
      normalizeAgentMode(b.mode)
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

  return { ok: true, agentId: newAgentId }
}

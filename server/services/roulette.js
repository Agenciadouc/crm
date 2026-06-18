// Util compartilhado de roleta/round-robin pra escolher atendente.
// Usado por: webhooks.js (lead novo), aiAgent.js (handoff do bot), follow-ups (on-reply reassign).

import db from '../db.js'

/**
 * @param {number} accountId
 * @param {number|null} instanceId
 * @param {Object} [opts]
 * @param {number|null} [opts.excludeUserId] - nao retornar esse user
 * @param {boolean} [opts.excludeBots] - se true, ignora users com is_bot=1 (usado no handoff do bot pra humano)
 * @param {boolean} [opts.useInstanceDefault=true] - tentar instance.default_attendant_id antes do round-robin
 * @returns {number|null} userId selecionado ou null
 */
export function pickFromRoulette(accountId, instanceId, opts = {}) {
  const { excludeUserId = null, excludeBots = false, useInstanceDefault = true } = opts

  const isUserOk = (uid) => {
    if (uid == null) return false
    if (excludeUserId != null && uid === excludeUserId) return false
    if (excludeBots) {
      const u = db.prepare('SELECT is_active, is_bot FROM users WHERE id = ?').get(uid)
      if (!u || !u.is_active || u.is_bot) return false
    }
    return true
  }

  // 1. instance.default_attendant_id (se ativado)
  if (useInstanceDefault && instanceId) {
    const inst = db.prepare('SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
    if (inst?.default_attendant_id && isUserOk(inst.default_attendant_id)) return inst.default_attendant_id
  }

  // 2. round-robin via distribution_rules
  const funnel = db.prepare("SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1").get(accountId)
  if (!funnel) return null
  const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(accountId, funnel.id)
  if (!rule || rule.type !== 'round_robin' || !rule.active_attendants) return null
  try {
    const attendants = JSON.parse(rule.active_attendants).filter(isUserOk)
    if (attendants.length === 0) return null
    const idx = rule.last_assigned_index % attendants.length
    const picked = attendants[idx]
    db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
    return picked
  } catch {
    return null
  }
}

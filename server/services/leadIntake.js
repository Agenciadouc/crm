// Entrada de leads (WhatsApp, Meta Lead Form, site, Google Sheets).
// Movido de routes/webhooks.js sem alterar a logica. Dependencias injetadas para teste.
import { normalizePhone, phoneCompareKey } from './whatsapp/normalize.js'
import { moveLeadToStage } from './stageMove.js'

export function createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange }) {
  function getOrCreateLead(accountId, phone, name, source, waJid, instanceId, opts = {}) {
    phone = normalizePhone(phone)

    // ─── GATE: phone bloqueado nesta conta? Ignora silenciosamente. ───
    // Match por phone exato OU sufixo 8d (mesma logica de dedup). Se houver QUALQUER lead bloqueado
    // pra esse numero, retorna blocked=true e nao processa msg.
    if (phone) {
      const blockedExact = db.prepare("SELECT id FROM leads WHERE account_id = ? AND phone = ? AND is_blocked = 1 LIMIT 1").get(accountId, phone)
      if (blockedExact) return { lead: null, isNew: false, blocked: true }
      const key = phoneCompareKey(phone)
      if (key) {
        const last8 = key.slice(-8)
        const candidates = db.prepare("SELECT phone FROM leads WHERE account_id = ? AND is_blocked = 1 AND phone LIKE ?").all(accountId, '%' + last8)
        if (candidates.some(c => phoneCompareKey(c.phone) === key)) {
          return { lead: null, isNew: false, blocked: true }
        }
      }
    }

    let lead = null
    if (waJid) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, waJid)
    if (!lead && phone) {
      // 1) match exato (rapido, usa index)
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, phone)
      // 2) fallback: busca candidatos por sufixo 8d e compara via phoneCompareKey
      if (!lead) {
        const key = phoneCompareKey(phone)
        if (key) {
          const last8 = key.slice(-8)
          const candidates = db.prepare(`SELECT * FROM leads WHERE account_id = ? AND phone LIKE ? ORDER BY is_archived ASC, created_at DESC`).all(accountId, '%' + last8)
          lead = candidates.find(c => phoneCompareKey(c.phone) === key) || null
        }
      }
    }

    if (lead) {
      // Update instance_id if not set
      if (instanceId && !lead.instance_id) {
        db.prepare('UPDATE leads SET instance_id = ? WHERE id = ?').run(instanceId, lead.id)
      }
      // Se esta arquivado: NAO desarquiva (so manual). Apenas marca has_new_after_archive
      // pra atendente saber que tem msg nova no lead arquivado (badge no /archived)
      if (lead.is_archived) {
        db.prepare("UPDATE leads SET has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
      }
      return { lead, isNew: false }
    }

    // ─── GATE: instancia em modo RESTRITO so processa leads ja cadastrados (form/sheets/Novo chat).
    // Se chegou aqui (lead nao existe ainda) E veio do Evolution webhook (instanceId presente) E instancia eh restrita,
    // ignora silenciosamente. Form/site/sheets passam instanceId=null entao bypassam esse gate.
    if (instanceId) {
      const inst = db.prepare('SELECT lead_intake_mode FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (inst?.lead_intake_mode === 'restricted') {
        return { lead: null, isNew: false, restricted: true }
      }
    }

    // Get default funnel + first stage
    const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(accountId)
    if (!funnel) return { lead: null, isNew: false }
    const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
    if (!firstStage) return { lead: null, isNew: false }

    // Distribution: prefer instance.default_attendant_id, fallback to round-robin/manual
    const attendantId = pickFromRoulette(accountId, instanceId)

    const result = db.prepare(`
      INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(accountId, funnel.id, firstStage.id, attendantId, name || phone || 'Sem nome', phone || null, source, waJid || null, instanceId || null)

    // Log stage history
    db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(result.lastInsertRowid, firstStage.id, 'webhook')

    lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)

    // Lead handoff: se atribuiu via roleta/default, dispara 1a msg + notif (fire-and-forget).
    // Skipa se opts.noAutoHandoff (caller faz manualmente apos aplicar tags/mapping — caso /sheets).
    if (attendantId && !opts.noAutoHandoff) {
      setImmediate(() => {
        notifyAndOpenLead(lead.id, attendantId, { source: 'webhook' })
          .catch(e => console.error('[Handoff webhook]', e.message))
      })
    }

    return { lead, isNew: true }
  }

  // Helper: auto-detect stage from message keywords
  function autoDetectStage(lead, messageText) {
    if (!messageText) return
    const text = messageText.toLowerCase()

    // Get all stages ahead of current
    const currentStage = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(lead.stage_id)
    if (!currentStage) return

    const aheadStages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND position > ? ORDER BY position').all(lead.funnel_id, currentStage.position)

    for (const stage of aheadStages) {
      if (!stage.auto_keywords) continue
      let keywords
      try { keywords = JSON.parse(stage.auto_keywords) } catch { continue }
      if (!Array.isArray(keywords)) continue

      const matched = keywords.some(kw => text.includes(kw.toLowerCase()))
      if (matched) {
        // Porta unica com trava do roteiro; CAPI sai pelo hook. Travado: nao move.
        const mv = moveLeadToStage(db, { lead, toStageId: stage.id, trigger: 'auto_keyword', gate: true })
        if (mv.reason === 'roteiro_gate') console.log('[Roteiro] trava: lead', lead.id, 'auto_keyword ->', stage.id, 'pendentes:', mv.pending.length)
        break // Only advance to first match
      }
    }
  }

  return { getOrCreateLead, autoDetectStage }
}

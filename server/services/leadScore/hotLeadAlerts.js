// Aviso ao gestor: lead Quente/Pronto sem resposta ha >= score_alert_minutes em horario de atendimento (spec 5.5).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { BAND_LABEL } from './compute.js'
import { businessMinutesBetween } from './businessMinutes.js'
import { toSqliteDate } from '../roteiro/time.js'

const ALERT_TYPE = 'lead_quente_sem_resposta'
const DEFAULT_ALERT_MINUTES = 60
const DEFAULT_TZ = 'America/Sao_Paulo'
// Teto da contagem de minutos uteis (para cedo; acima disso mostra "mais de").
const REPORT_CAP_MINUTES = 600

// broadcast(accountId, evento, dados): SSE lead:hot_alert ao criar (injetado pelo scheduler).
export function runHotLeadAlerts(db, { now = new Date(), broadcast = null } = {}) {
  const nowStr = toSqliteDate(now)

  // Resolve sozinho (spec 5.5): a ultima mensagem ja e de saida (respondeu pelo celular,
  // agente de IA, follow-up...) ou o lead nao esta mais quente/pronto.
  const resolved = db.prepare(`
    UPDATE analyst_alerts SET status = 'resolved', resolved_at = ?
    WHERE type = '${ALERT_TYPE}' AND status = 'open' AND lead_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM leads l WHERE l.id = analyst_alerts.lead_id AND (
        COALESCE(l.score_band, '') NOT IN ('quente','pronto')
        OR (SELECT m.direction FROM messages m WHERE m.lead_id = l.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'outbound'
      )
    )
  `).run(nowStr).changes
  // Candidatos: quente/pronto, ativos, nao arquivados, fora de etapa final, sem aviso aberto; ultima mensagem vem junto.
  const leads = db.prepare(`
    SELECT l.id, l.account_id, l.name, l.phone, l.score_band, l.attendant_id,
      COALESCE(l.instance_id, l.last_instance_id) AS inst_id,
      (SELECT m.direction FROM messages m WHERE m.lead_id = l.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_dir,
      (SELECT m.created_at FROM messages m WHERE m.lead_id = l.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_at
    FROM leads l
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    WHERE l.score_band IN ('quente','pronto')
      AND COALESCE(l.is_active, 1) = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(fs.is_terminal, 0) = 0
      AND NOT EXISTS (SELECT 1 FROM analyst_alerts a WHERE a.lead_id = l.id AND a.type = '${ALERT_TYPE}' AND a.status = 'open')
  `).all()

  const accounts = new Map()
  const accountFor = id => {
    if (!accounts.has(id)) accounts.set(id, db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) || {})
    return accounts.get(id)
  }
  const scheduleStmt = db.prepare('SELECT away_schedule_json FROM instance_auto_messages WHERE instance_id = ?')
  // Ja houve aviso (qualquer status) depois da ultima mensagem do cliente: nao repete (dispensado nao volta).
  const alreadyAlerted = db.prepare(`SELECT 1 FROM analyst_alerts WHERE lead_id = ? AND type = '${ALERT_TYPE}' AND created_at >= ? LIMIT 1`)
  const insert = db.prepare(`
    INSERT INTO analyst_alerts (account_id, lead_id, type, severity, title, description, suggested_action, assigned_to_user_id, status, created_at)
    VALUES (?, ?, '${ALERT_TYPE}', 'alta', ?, ?, ?, ?, 'open', ?)
  `)

  let created = 0
  for (const lead of leads) {
    if (lead.last_dir !== 'inbound' || !lead.last_at) continue
    try {
      if (alreadyAlerted.get(lead.id, lead.last_at)) continue
      const account = accountFor(lead.account_id)
      const threshold = account.score_alert_minutes ?? DEFAULT_ALERT_MINUTES
      const schedule = lead.inst_id ? scheduleStmt.get(lead.inst_id)?.away_schedule_json ?? null : null
      const cap = Math.max(threshold, REPORT_CAP_MINUTES)
      const minutes = businessMinutesBetween(schedule, lead.last_at, now, account.timezone || DEFAULT_TZ, { cap })
      if (minutes < threshold) continue
      const capped = minutes >= cap && cap > threshold
      const name = lead.name || lead.phone || 'Lead'
      insert.run(
        lead.account_id, lead.id,
        `${name} está ${BAND_LABEL[lead.score_band]} e sem resposta`,
        `Última mensagem do cliente há ${capped ? 'mais de ' : ''}${minutes} min (horário de atendimento).`,
        'Responda agora: leads respondidos em até 1 hora têm muito mais chance de fechar.',
        lead.attendant_id ?? null,
        nowStr,
      )
      created++
      if (typeof broadcast === 'function') {
        try {
          broadcast(lead.account_id, 'lead:hot_alert', {
            lead_id: lead.id, name, band: lead.score_band, minutes, capped, attendant_id: lead.attendant_id ?? null,
          })
        } catch (e) { console.error('[Termometro] SSE lead:hot_alert:', e.message) }
      }
    } catch (e) {
      console.error('[Termometro] aviso de lead quente', lead.id, e.message)
    }
  }
  return { created, resolved }
}

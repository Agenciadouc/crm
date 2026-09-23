// Engajamento por numero de disparo (spec 10.4): quem recebeu automatico e respondeu em ate 24h, janela de 7 dias.
import { SEND_PROVIDERS } from './whatsapp/numberRole.js'

const MIN_LEADS = 20

export function computeReplyRate(db, instanceId, { days = 7, replyHours = 24 } = {}) {
  const row = db.prepare(`
    WITH first_auto AS (
      SELECT lead_id, MIN(created_at) AS at FROM messages
      WHERE instance_id = ? AND direction = 'outbound' AND sent_by_user_id IS NULL
        AND delivery_status IN ('sent', 'delivered', 'read')
        AND created_at >= datetime('now', ?)
      GROUP BY lead_id
    )
    SELECT COUNT(*) AS reached,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM messages m WHERE m.lead_id = f.lead_id AND m.direction = 'inbound'
          AND m.created_at > f.at AND m.created_at <= datetime(f.at, ?)
      ) THEN 1 ELSE 0 END) AS replied
    FROM first_auto f
  `).get(instanceId, `-${days} days`, `+${replyHours} hours`)
  const reached = row.reached || 0
  const replied = row.replied || 0
  return { reached, replied, rate: reached >= MIN_LEADS ? replied / reached : null }
}

export function checkReplyRates(db) {
  const ph = SEND_PROVIDERS.map(() => '?').join(', ')
  const insts = db.prepare(`
    SELECT wi.id, wi.account_id, wi.instance_name, COALESCE(a.reply_rate_alert_pct, 10) AS pct
    FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id
    WHERE wi.provider IN (${ph})
  `).all(...SEND_PROVIDERS)
  const low = []
  for (const i of insts) {
    const { rate, reached, replied } = computeReplyRate(db, i.id)
    if (rate === null || rate * 100 >= i.pct) continue
    low.push({ accountId: i.account_id, instanceId: i.id, rate })
    const open = db.prepare(`SELECT 1 FROM analyst_alerts WHERE account_id = ? AND type = 'send_number_low_reply'
      AND status = 'open' AND title LIKE ?`).get(i.account_id, `%${i.instance_name}%`)
    if (open) continue
    db.prepare(`INSERT INTO analyst_alerts (account_id, type, severity, title, description, suggested_action)
      VALUES (?, 'send_number_low_reply', 'warning', ?, ?, ?)`).run(
      i.account_id,
      `Pouca gente está respondendo o número ${i.instance_name} — risco de bloqueio`,
      `Nos últimos 7 dias, ${replied} de ${reached} leads responderam em até 24h (${Math.round(rate * 100)}%). Abaixo de ${i.pct}% o WhatsApp pode entender como spam.`,
      'Termine as mensagens com uma pergunta, envie só para quem pediu contato e reduza o volume por alguns dias.')
  }
  return low
}

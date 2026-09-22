// Registro de conexoes dos numeros (base da cobranca futura por numero UzAPI conectado).
export const CONNECTION_EVENTS = ['created', 'connected', 'disconnected', 'removed']

export function logConnectionEvent(db, instance, event) {
  if (!CONNECTION_EVENTS.includes(event)) throw new Error(`invalid_connection_event:${event}`)
  db.prepare('INSERT INTO whatsapp_connection_log (account_id, instance_id, provider, event) VALUES (?, ?, ?, ?)')
    .run(instance.account_id, instance.id, instance.provider || 'evolution', event)
}

// Por conta: quantos numeros UzAPI existem hoje, quantos estao conectados e desde quando a conta usa UzAPI.
export function uzapiUsageByAccount(db) {
  return db.prepare(`
    SELECT a.account_id, a.numbers, a.connected_now, a.oldest_created_at,
      (SELECT MIN(l.created_at) FROM whatsapp_connection_log l
        WHERE l.account_id = a.account_id AND l.provider = 'uzapi' AND l.event = 'created') AS first_created_at
    FROM (
      SELECT account_id, COUNT(*) AS numbers,
        SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected_now,
        MIN(created_at) AS oldest_created_at
      FROM whatsapp_instances WHERE provider = 'uzapi' GROUP BY account_id
    ) a
    ORDER BY a.account_id
  `).all()
}

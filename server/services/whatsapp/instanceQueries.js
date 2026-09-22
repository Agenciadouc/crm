// Consultas por provedor usadas pelas rotinas automaticas. Reconectar, reiniciar e reregistrar webhook
// so existem na Evolution; a UzAPI cuida da propria sessao (e tem a checagem de hora em hora dela).
export const EVOLUTION_ONLY_SQL = "COALESCE(provider, 'evolution') = 'evolution'"

export function listGhostCandidates(db) {
  return db.prepare(`SELECT id, instance_name, api_url, api_key FROM whatsapp_instances WHERE status = 'connected' AND ${EVOLUTION_ONLY_SQL}`).all()
}

export function listDailyCheckInstances(db) {
  return db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    WHERE COALESCE(w.provider, 'evolution') = 'evolution'
  `).all()
}

export function listAdminCheckAll(db) {
  return db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    WHERE COALESCE(w.provider, 'evolution') = 'evolution'
    ORDER BY a.name, w.instance_name
  `).all()
}

// A UzAPI ja recebe o webhook na criacao; reregistrar a cada minuto seria um PUT /instance/update por numero.
export function listWebhookReRegister(db) {
  return db.prepare(`SELECT * FROM whatsapp_instances WHERE status = 'connected' AND ${EVOLUTION_ONLY_SQL}`).all()
}

export function listUzapiInstances(db) {
  return db.prepare("SELECT * FROM whatsapp_instances WHERE provider = 'uzapi'").all()
}

// QR velho: Evolution 2 min (como hoje); UzAPI 5 min (o QR pode chegar pelo aviso e a leitura demora mais).
export function cleanupStaleQRCodes(db) {
  db.prepare(`
    UPDATE whatsapp_instances SET qr_code = NULL
    WHERE qr_code IS NOT NULL AND status = 'connecting'
      AND (
        (${EVOLUTION_ONLY_SQL} AND datetime(updated_at) < datetime('now', '-2 minutes'))
        OR (provider = 'uzapi' AND datetime(updated_at) < datetime('now', '-5 minutes'))
      )
  `).run()
}

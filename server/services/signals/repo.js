// Camada de banco dos sinais de venda por palavra-chave (spec 2026-10-02). Nao importa server/db.js: recebe db.

export function getPrecedingOutboundRun(db, leadId, beforeMessageId) {
  const lastInbound = db.prepare(`
    SELECT MAX(id) as id FROM messages WHERE lead_id = ? AND id < ? AND direction = 'inbound'
  `).get(leadId, beforeMessageId)
  const floorId = lastInbound?.id ?? 0
  return db.prepare(`
    SELECT content, created_at FROM messages
    WHERE lead_id = ? AND id < ? AND id > ? AND direction = 'outbound'
    ORDER BY id ASC
  `).all(leadId, beforeMessageId, floorId)
}

// created_at e normalizado com datetime(?) na gravacao: quem chama pode passar ISO
// ("...T...Z", JS toISOString) ou o formato nativo do SQLite ("YYYY-MM-DD HH:MM:SS")
// -- sem normalizar os dois lados, "2026-10-01T09:43" compara MAIOR que "2026-10-01 15:43"
// (o 'T', 0x54, vem depois do digito '1' na tabela ASCII), quebrando a comparacao por
// string mesmo quando as datas sao validas.
export function recordSignal(db, { accountId, leadId, stageId, signalType, keyword, messageId, createdAt }) {
  db.prepare(`
    INSERT INTO lead_signals (account_id, lead_id, stage_id, signal_type, keyword, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime(?))
  `).run(accountId, leadId, stageId, signalType, keyword, messageId, createdAt)
}

// Confirma (mensagem nova provou que o lead continuou engajando) qualquer sinal 'weak'
// ainda pendente desse lead que esteja dentro da janela de silencio da conta.
export function confirmPendingWeakSignals(db, leadId, ghostHours, nowIso) {
  return db.prepare(`
    UPDATE lead_signals SET confirmed_at = datetime(?)
    WHERE lead_id = ? AND signal_type = 'weak' AND confirmed_at IS NULL
      AND created_at >= datetime(?, '-' || ? || ' hours')
  `).run(nowIso, leadId, nowIso, ghostHours)
}

export function hasSignalLast7d(db, leadId, signalType, nowIso) {
  const row = db.prepare(`
    SELECT 1 FROM lead_signals
    WHERE lead_id = ? AND signal_type = ? AND created_at >= datetime(?, '-7 days')
    LIMIT 1
  `).get(leadId, signalType, nowIso)
  return !!row
}

export function hasConfirmedWeakLast7d(db, leadId, nowIso) {
  const row = db.prepare(`
    SELECT 1 FROM lead_signals
    WHERE lead_id = ? AND signal_type = 'weak' AND confirmed_at IS NOT NULL AND confirmed_at >= datetime(?, '-7 days')
    LIMIT 1
  `).get(leadId, nowIso)
  return !!row
}

// Transcricao do bloco de mensagens do lead (agrupamento de 40s do Copiloto).
//
// Responsabilidade unica: dado o bloco de mensagens inbound do lead, transcrever os
// audios que ainda NAO tem `messages.transcription`, salvar o texto na coluna (cache:
// o dono nao paga duas vezes pelo mesmo audio) e devolver o texto combinado na ordem
// em que o lead mandou.
//
// Testavel: recebe `db` e as funcoes de download/transcricao por parametro.
// NAO importa server/db.js nem deepgramClient.js.

export const AUDIO_FAILED_PLACEHOLDER = '[Audio nao transcrito]'

function isAudio(msg) {
  return msg && msg.media_type === 'audio'
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Carrega o bloco: mensagens inbound do lead a partir de fromMessageId (inclusive), em ordem.
 * Filtra por account_id (multi-tenant).
 */
export function loadInboundBlock(db, { accountId, leadId, fromMessageId }) {
  if (!accountId || !leadId || !fromMessageId) return []
  return db.prepare(`
    SELECT id, content, media_type, transcription, wa_msg_id, media_url
    FROM messages
    WHERE lead_id = ? AND account_id = ? AND direction = 'inbound' AND id >= ?
    ORDER BY id ASC
  `).all(leadId, accountId, fromMessageId)
}

/**
 * Le a ultima mensagem inbound do lead — o webhook acabou de inserir, entao ela e a
 * primeira mensagem do bloco quando o bloco comeca.
 */
export function lastInboundMessageId(db, { accountId, leadId }) {
  if (!accountId || !leadId) return null
  const row = db.prepare(`
    SELECT id FROM messages
    WHERE lead_id = ? AND account_id = ? AND direction = 'inbound'
    ORDER BY id DESC LIMIT 1
  `).get(leadId, accountId)
  return row ? row.id : null
}

/**
 * Transcreve os audios do bloco que ainda nao tem transcricao e devolve o texto combinado.
 *
 * Regras de negocio:
 *  - transcreve TODOS os audios do bloco (sem teto);
 *  - audio que ja tem `transcription` NAO e transcrito de novo (a coluna e cache);
 *  - falha em um audio NAO derruba o bloco: entra como '[Audio nao transcrito]' e segue.
 *
 * @param {Object} db                      - conexao better-sqlite3 (injetada)
 * @param {Object} opts
 * @param {number} opts.accountId          - conta (toda query filtra por account_id)
 * @param {Array}  opts.messages           - bloco na ordem em que o lead mandou
 * @param {Function} opts.fetchAudio       - async (msg) => { buffer, mimetype }
 * @param {Function} opts.transcribe       - async (buffer, { mimetype }) => { ok, transcript, durationSec, costUsd, reason }
 * @param {Function} [opts.onTranscribed]  - (msg, transcript) => void, logo depois de salvar (avisa o Chat aberto)
 * @returns {Promise<{ text: string, transcribed: number, cached: number, failed: number, durationSec: number, costUsd: number }>}
 */
export async function transcribeBlock(db, { accountId, messages, fetchAudio, transcribe, onTranscribed } = {}) {
  const block = Array.isArray(messages) ? messages : []
  const parts = []
  let transcribed = 0
  let cached = 0
  let failed = 0
  let durationSec = 0
  let costUsd = 0

  for (const msg of block) {
    if (!isAudio(msg)) {
      const text = clean(msg && msg.content)
      if (text) parts.push(text)
      continue
    }

    const alreadyDone = clean(msg.transcription)
    if (alreadyDone) {
      cached++
      parts.push(alreadyDone)
      continue
    }

    if (typeof fetchAudio !== 'function' || typeof transcribe !== 'function' || !msg.wa_msg_id) {
      failed++
      parts.push(AUDIO_FAILED_PLACEHOLDER)
      continue
    }

    try {
      const { buffer, mimetype } = await fetchAudio(msg)
      const result = await transcribe(buffer, { mimetype, language: 'pt-BR' })
      const transcript = result && result.ok ? clean(result.transcript) : ''
      if (!transcript) throw new Error((result && result.reason) || 'transcricao vazia')

      db.prepare('UPDATE messages SET transcription = ? WHERE id = ? AND account_id = ?')
        .run(transcript, msg.id, accountId)

      transcribed++
      durationSec += Number(result.durationSec || 0)
      costUsd += Number(result.costUsd || 0)
      parts.push(transcript)

      // Transcricao salva: o Chat aberto ja pode mostrar o texto do audio
      if (typeof onTranscribed === 'function') {
        try { onTranscribed(msg, transcript) } catch (e) { console.error('[BlockTranscriber] onTranscribed:', e && e.message) }
      }
    } catch (e) {
      // Falha de UM audio nao derruba o bloco: marca e segue com o resto.
      failed++
      console.error(`[BlockTranscriber] audio msg=${msg.id} falhou:`, e && e.message)
      parts.push(AUDIO_FAILED_PLACEHOLDER)
    }
  }

  return { text: parts.join('\n'), transcribed, cached, failed, durationSec, costUsd }
}

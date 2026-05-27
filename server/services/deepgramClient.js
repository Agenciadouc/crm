// Cliente Deepgram pra transcrever audios de WhatsApp.
// Nova-3 em PT-BR — $0.0043/min, $200 gratis no signup.
//
// Best-effort: se DEEPGRAM_API_KEY nao tiver no .env ou API cair,
// retorna { ok: false, reason } sem quebrar — aiAgent.js trata o fallback.

import fetch from 'node-fetch'

const ENDPOINT = 'https://api.deepgram.com/v1/listen'
const NOVA3_PRICE_PER_MIN = 0.0043

/**
 * Transcreve audio via Deepgram Nova-3.
 *
 * @param {Buffer|string} audio - audio bytes (Buffer preferencial) ou base64 string
 * @param {Object} [opts]
 * @param {string} [opts.mimetype='audio/ogg'] - mimetype do audio (audio/ogg pra WhatsApp PTT)
 * @param {string} [opts.language='pt-BR'] - idioma
 * @returns {Promise<{ ok: boolean, transcript?: string, durationSec?: number, costUsd?: number, requestId?: string, reason?: string }>}
 */
export async function transcribeAudio(audio, opts = {}) {
  const key = process.env.DEEPGRAM_API_KEY
  if (!key) return { ok: false, reason: 'no_api_key' }

  const buffer = typeof audio === 'string' ? Buffer.from(audio, 'base64') : audio
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_audio' }

  const mimetype = opts.mimetype || 'audio/ogg'
  const language = opts.language || 'pt-BR'
  const url = `${ENDPOINT}?model=nova-3&language=${language}&smart_format=true&punctuate=true`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${key}`,
        'Content-Type': mimetype,
      },
      body: buffer,
      timeout: 30000,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[Deepgram] erro:', res.status, JSON.stringify(data).slice(0, 200))
      return { ok: false, reason: data.err_msg || data.error || `HTTP ${res.status}` }
    }
    const alt = data.results?.channels?.[0]?.alternatives?.[0]
    const transcript = (alt?.transcript || '').trim()
    const durationSec = Number(data.metadata?.duration || 0)
    const costUsd = (durationSec / 60) * NOVA3_PRICE_PER_MIN
    return {
      ok: true,
      transcript,
      durationSec,
      costUsd,
      requestId: data.metadata?.request_id || null,
    }
  } catch (e) {
    console.error('[Deepgram] exception:', e.message)
    return { ok: false, reason: e.message || 'fetch_exception' }
  }
}

/**
 * Baixa audio (base64) da Evolution API e retorna como Buffer.
 * Reusa exatamente o mesmo endpoint que messages.js usa pro front renderizar o player.
 *
 * @param {Object} instance - row de whatsapp_instances (precisa api_url, api_key, instance_name)
 * @param {string} waMsgId - wa_msg_id da mensagem
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
export async function fetchAudioBuffer(instance, waMsgId) {
  if (!instance?.api_url || !instance?.api_key || !instance?.instance_name) {
    throw new Error('instance_missing_credentials')
  }
  if (!waMsgId) throw new Error('wa_msg_id_required')

  const res = await fetch(`${instance.api_url}/chat/getBase64FromMediaMessage/${instance.instance_name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
    body: JSON.stringify({ message: { key: { id: waMsgId } }, convertToMp4: false }),
    timeout: 20000,
  })
  const data = await res.json().catch(() => ({}))
  if (!data.base64) {
    throw new Error(`evolution_no_base64 (status=${res.status})`)
  }
  return {
    buffer: Buffer.from(data.base64, 'base64'),
    mimetype: data.mimetype || 'audio/ogg',
  }
}

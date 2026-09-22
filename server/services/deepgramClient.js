// Cliente Deepgram pra transcrever audios de WhatsApp.
// Nova-3 em PT-BR — $0.0043/min, $200 gratis no signup.
//
// Best-effort: se DEEPGRAM_API_KEY nao tiver no .env ou API cair,
// retorna { ok: false, reason } sem quebrar — aiAgent.js trata o fallback.

import fetch from 'node-fetch'
import { getProvider as defaultGetProvider } from './whatsapp/index.js'

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
 * Baixa o audio de uma mensagem pelo provedor da instancia e retorna como Buffer.
 * Mesmo download usado pelo player do Chat (GET /api/messages/:leadId/media/:msgId).
 *
 * @param {Object} instance - row de whatsapp_instances
 * @param {string|Object} waMsgIdOrMessage - wa_msg_id ou a linha da mensagem ({ wa_msg_id, media_url })
 * @param {Object} [deps] - { getProvider } injetavel para teste
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
export async function fetchAudioBuffer(instance, waMsgIdOrMessage, deps = {}) {
  const getProvider = deps.getProvider || defaultGetProvider
  const isEvolution = !!instance && (instance.provider || 'evolution') === 'evolution'
  if (!instance || (isEvolution && (!instance.api_url || !instance.api_key || !instance.instance_name))) {
    throw new Error('instance_missing_credentials')
  }
  // UzAPI baixa pelo id da midia (media_url); Evolution so usa o wa_msg_id.
  const message = (waMsgIdOrMessage && typeof waMsgIdOrMessage === 'object') ? waMsgIdOrMessage : { wa_msg_id: waMsgIdOrMessage }
  if (!message.wa_msg_id) throw new Error('wa_msg_id_required')
  const media = await getProvider(instance).fetchMedia(instance, message)
  return { buffer: media.buffer, mimetype: media.mimetype || 'audio/ogg' }
}

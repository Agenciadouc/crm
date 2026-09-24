// Adapter uzapi.com.br — MESMAS assinaturas do evolutionAdapter.
// Estado atual: ESQUELETO. Funcoes vao ser preenchidas depois que Fase 1
// (setup conta uzapi + captura formato real da API) estiver feita.
//
// PENDENTE (aguardando dados da Fase 1):
//  - URL base real (ex: https://api.uzapi.com.br ou https://free.uzapi.com.br)
//  - Endpoints exatos (ex: /sendText/{session} vs /message/text)
//  - Formato do header de autenticacao (SessionKey no header? Bearer? Body?)
//  - Formato de resposta (id da msg, ack, shape do erro)
//  - Formato do webhook inbound (pra tradutor em /api/webhooks/uzapi/:slug)
//
// Cada funcao stub joga um erro claro pra ficar impossivel usar antes de ajustar.

const ADMIN_TOKEN = process.env.UZAPI_ADMIN_TOKEN || ''
const API_BASE = process.env.UZAPI_API_BASE || 'https://api.uzapi.com.br'

function notImplemented(fnName) {
  return { ok: false, reason: `uzapi_not_implemented: ${fnName} — completar apos Fase 1 (capturar formato real da API uzapi)` }
}

function throwNotImplemented(fnName) {
  throw new Error(`uzapi.${fnName}() ainda nao implementado. Preencher com dados da Fase 1.`)
}

// ─── Envio ───────────────────────────────────────────────────────────

export async function sendText(instance, { number, text }) {
  return notImplemented('sendText')
}

export async function sendMedia(instance, { number, mediatype, media, mimetype, fileName, caption, delay }) {
  return notImplemented('sendMedia')
}

export async function sendAudio(instance, { number, audio, delay }) {
  return notImplemented('sendAudio')
}

export async function sendPresence(instance, { number, presence, delay = 100, signal }) {
  // best-effort — silencioso
}

export async function markAsRead(instance, { readMessages, signal }) {
  // best-effort — silencioso
}

export async function checkNumbers(instance, numbers, { signal } = {}) {
  return null // sinaliza "nao consegui validar", nao bloqueia envio
}

export async function fetchProfilePicture(instance, number) {
  return null
}

export async function getMediaBase64(instance, { message, convertToMp4 = false }) {
  return null
}

export async function findMessages(instance, { where = {}, page = 1, offset = 20 } = {}) {
  return { records: [] }
}

// ─── Instancia (ciclo de vida) ───────────────────────────────────────

export async function createInstance({ baseUrl, apiKey, instanceName, integration }) {
  throwNotImplemented('createInstance')
}

export async function connectInstance(instance) {
  throwNotImplemented('connectInstance')
}

export async function connectionState(instance) {
  return { state: 'close', error: 'uzapi_not_implemented' }
}

export async function logout(instance) {
  return { ok: false, error: 'uzapi_not_implemented' }
}

export async function deleteInstance(instance, { timeoutMs = 8000 } = {}) {
  return { ok: false, error: 'uzapi_not_implemented' }
}

export async function restartInstance(instance) {
  return { ok: false, error: 'uzapi_not_implemented' }
}

export async function setWebhook(instance, webhookUrl, events) {
  return { ok: false, error: 'uzapi_not_implemented' }
}

export async function fetchInstanceInfo(instance) {
  return null
}

// ─── Config info (usado pra UI mostrar status da conta agência) ──────

export function isConfigured() {
  return !!ADMIN_TOKEN
}

export function getPublicConfig() {
  return {
    apiBase: API_BASE,
    hasAdminToken: !!ADMIN_TOKEN,
  }
}

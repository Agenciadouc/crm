// Gestao dos numeros UzAPI pelo CRM: criar, QR, status, desconectar, reiniciar, excluir.
// Nao importa server/db.js: recebe db e getProvider (testavel com banco em memoria e adaptador falso).
// A Evolution continua com o codigo de sempre em routes/integrations.js.
import { generateWebhookToken } from './schema.js'
import { buildInstanceWebhookUrl } from '../publicUrl.js'
import { buildUzapiConfig, hasEncryptionKey, readUzapiPhoneNumberId } from './providerConfig.js'
import { isUzapiConfigured, getUzapiEnv } from './uzapiClient.js'
import { logConnectionEvent } from './connectionLog.js'

export const PROVIDER_LABELS = Object.freeze({ evolution: 'Evolution', uzapi: 'UzAPI (estável)' })

export class ProviderError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

export function listAvailableProviders(env = process.env) {
  const out = [{ id: 'evolution', label: PROVIDER_LABELS.evolution }]
  if (isUzapiConfigured(env)) out.push({ id: 'uzapi', label: PROVIDER_LABELS.uzapi })
  return out
}

const HIDDEN_ALWAYS = ['provider_config']
const HIDDEN_FOR_ATTENDANT = ['api_url', 'api_key', 'webhook_secret']

export function sanitizeInstance(row, role) {
  if (!row) return row
  const out = { ...row, provider: row.provider || 'evolution' }
  for (const k of HIDDEN_ALWAYS) delete out[k]
  if (role === 'atendente') for (const k of HIDDEN_FOR_ATTENDANT) delete out[k]
  return out
}

function withTimeout(promise, ms, fallback) {
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// resumeBroadcastIfPaused/resumeFollowUpsIfPaused: injetados (routes/broadcasts.js e followUpSender.js), como o
// scheduler faz na Evolution ao reconectar. Padrao sem efeito para testes e chamadores que nao precisam.
export function createInstanceManager({
  db, getProvider, env = process.env, log = console, removeTimeoutMs = 8000,
  resumeBroadcastIfPaused = () => {}, resumeFollowUpsIfPaused = () => {},
}) {
  const byId = (id) => db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
  // Trava de criacao em andamento por conta + nome normalizado (cliques simultaneos no mesmo nome).
  const creating = new Set()
  const creationKey = (accountId, name) => `${accountId}:${String(name || '').trim().toLowerCase()}`
  const nameTaken = () => new ProviderError('instance_name_taken', 'Já existe um número com esse nome nesta conta.', 409)

  async function createUzapiInstance({ accountId, instanceName, leadIntakeMode = 'open' }) {
    if (!isUzapiConfigured(env)) {
      throw new ProviderError('uzapi_not_configured', 'A UzAPI não está configurada no servidor (faltam UZAPI_USERNAME e UZAPI_ACCOUNT_TOKEN).')
    }
    if (!hasEncryptionKey(env)) {
      throw new ProviderError('wa_enc_key_missing', 'Falta a chave WA_ENC_KEY no servidor para guardar o token do número.')
    }
    const lockKey = creationKey(accountId, instanceName)
    if (creating.has(lockKey)) throw nameTaken()
    const existing = db.prepare('SELECT id FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(accountId, instanceName)
    if (existing) throw nameTaken()
    creating.add(lockKey)
    try {
      return await createUzapiInstanceNow({ accountId, instanceName, leadIntakeMode })
    } finally {
      creating.delete(lockKey)
    }
  }

  async function createUzapiInstanceNow({ accountId, instanceName, leadIntakeMode }) {
    const webhookToken = generateWebhookToken()
    const webhookUrl = buildInstanceWebhookUrl({ webhook_token: webhookToken }, env)
    let created
    try {
      created = await getProvider({ provider: 'uzapi' }).createInstance({ name: instanceName, webhookUrl })
    } catch (e) {
      log.error('[UzAPI criar numero]', e.code || '', e.message, e.phoneNumberId ? `phoneNumberId=${e.phoneNumberId}` : '')
      throw new ProviderError(e.code || 'uzapi_create_failed', 'Não foi possível criar o número na UzAPI. Tente de novo em instantes.', 502)
    }
    // Do ponto aqui em diante o numero ja existe na UzAPI: se gravar no banco falhar (indice unico,
    // banco ocupado, cifra), exclui na UzAPI (best-effort) para nao ficar cobrando numero orfao.
    try {
      const providerConfig = buildUzapiConfig(created, env)
      const r = db.prepare(`
        INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, qr_code, lead_intake_mode, warmup_until, provider, provider_config, webhook_token)
        VALUES (?, ?, '', '', 'connecting', ?, ?, datetime('now', '+3 days'), 'uzapi', ?, ?)
      `).run(accountId, instanceName, created.qr || null, leadIntakeMode, providerConfig, webhookToken)
      const instance = byId(r.lastInsertRowid)
      logConnectionEvent(db, instance, 'created')
      return instance
    } catch (e) {
      await cleanupOrphanUzapiInstance(created, instanceName)
      throw new ProviderError('uzapi_create_failed', 'O número foi criado na UzAPI mas não foi possível salvá-lo no CRM. Tente de novo.', 502)
    }
  }

  // Numero criado na UzAPI mas que nao entrou no banco: exclui na UzAPI (best-effort, com tempo
  // limite) para nao gerar cobranca por numero orfao. Nunca loga o token, so o phoneNumberId.
  async function cleanupOrphanUzapiInstance(created, instanceName) {
    let providerConfig = null
    try { providerConfig = buildUzapiConfig(created, env) } catch { /* sem config valida: pula a exclusao */ }
    if (!providerConfig) {
      log.error(`[UzAPI criar numero] falha ao gravar e nao foi possivel montar a config para excluir; exclua manualmente no painel (phoneNumberId=${created.phoneNumberId})`)
      return
    }
    const temp = { id: null, provider: 'uzapi', instance_name: instanceName, provider_config: providerConfig }
    const attempt = Promise.resolve().then(() => getProvider(temp).remove(temp)).catch(e => ({ ok: false, reason: e.message }))
    const r = await withTimeout(attempt, removeTimeoutMs, { ok: false, reason: `timeout ${removeTimeoutMs}ms` })
    if (!r.ok) log.error(`[UzAPI criar numero] falha ao gravar no CRM; exclusao na UzAPI tambem falhou, exclua manualmente no painel (phoneNumberId=${created.phoneNumberId}): ${r.reason}`)
  }

  // Sincrono (chamado pelo webhook). connected: limpa QR, 1a conexao em connected_at; QR: grava e fica connecting.
  function applyConnection(instance, { connection = null, qr = null, phoneNumber = null } = {}) {
    const cur = byId(instance.id)
    if (!cur) return null
    if (connection === 'connected') {
      db.prepare(`
        UPDATE whatsapp_instances SET status = 'connected', qr_code = NULL,
          connected_at = COALESCE(connected_at, datetime('now')),
          phone_number = COALESCE(NULLIF(?, ''), phone_number),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(phoneNumber || '', cur.id)
      if (cur.status !== 'connected') {
        logConnectionEvent(db, cur, 'connected')
        resumePaused(cur)
      }
    } else if (connection === 'disconnected') {
      db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', qr_code = NULL, updated_at = datetime('now') WHERE id = ?").run(cur.id)
      if (cur.status !== 'disconnected') logConnectionEvent(db, cur, 'disconnected')
    } else if (qr && qr !== cur.qr_code) {
      db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qr, cur.id)
    }
    return byId(cur.id)
  }

  // Reconectou: retoma disparos e follow-ups pausados deste numero (erro de um nao impede o outro).
  function resumePaused(inst) {
    try { resumeBroadcastIfPaused(inst.id) } catch (e) { log.error('[UzAPI] retomar disparos:', e.message) }
    try { resumeFollowUpsIfPaused(inst.id) } catch (e) { log.error('[UzAPI] retomar follow-ups:', e.message) }
  }

  // 'connecting' nao rebaixa um numero conectado: so 'disconnected' da UzAPI tira de 'connected'.
  function applyStatus(instance, st) {
    if (st.status === 'connected') return applyConnection(instance, { connection: 'connected', phoneNumber: st.phoneNumber })
    if (st.status === 'disconnected') return applyConnection(instance, { connection: 'disconnected' })
    db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ? AND status NOT IN ('connecting', 'connected')").run(instance.id)
    return byId(instance.id)
  }

  async function safeStatus(instance) {
    try {
      return await getProvider(instance).status(instance)
    } catch (e) {
      return { ok: false, status: null, phoneNumber: null, qr: null, reason: e.code || e.message }
    }
  }

  // Plano B (spec 4.4): sem QR pela API, devolve panel_url para abrir o painel da UzAPI.
  async function refreshQr(instance) {
    const st = await safeStatus(instance)
    if (st.ok && st.status === 'connected') {
      return { instance: applyStatus(instance, st), qr_code: null, status: 'connected' }
    }
    const current = byId(instance.id)
    if (!current) return { instance: null, qr_code: null, status: 'disconnected' }
    // UzAPI fora do ar nao rebaixa numero conectado
    if (!st.ok && current.status === 'connected') return { instance: current, qr_code: null, status: 'connected', error: st.reason || 'provider_error' }
    const qr = st.qr || current.qr_code || null
    if (qr) return { instance: applyConnection(current, { qr }), qr_code: qr, status: 'connecting' }
    db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(current.id)
    return { instance: byId(current.id), qr_code: null, status: 'connecting', panel_url: getUzapiEnv(env).panelUrl }
  }

  async function checkStatus(instance) {
    const st = await safeStatus(instance)
    if (!st.ok || !st.status) return { instance: byId(instance.id), state: null, error: st.reason || 'provider_error' }
    return { instance: applyStatus(instance, st), state: st.status }
  }

  async function disconnect(instance) {
    const r = await getProvider(instance).disconnect(instance)
    if (!r.ok) log.error(`[UzAPI logout] ${instance.instance_name}: ${r.reason}`)
    return { ok: r.ok, instance: applyConnection(instance, { connection: 'disconnected' }) }
  }

  async function restart(instance) {
    return getProvider(instance).restart(instance)
  }

  // Best-effort como na Evolution: numero fantasma (so no CRM) nao pode travar o usuario.
  async function remove(instance) {
    const attempt = Promise.resolve().then(() => getProvider(instance).remove(instance)).catch(e => ({ ok: false, reason: e.message }))
    const r = await withTimeout(attempt, removeTimeoutMs, { ok: false, reason: `timeout ${removeTimeoutMs}ms` })
    if (!r.ok) log.error(`[UzAPI excluir] ${instance.instance_name} (phoneNumberId=${readUzapiPhoneNumberId(instance)}): ${r.reason}`)
    logConnectionEvent(db, instance, 'removed')
    db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(instance.id)
    return { ok: true, providerOk: !!r.ok }
  }

  return { createUzapiInstance, applyConnection, applyStatus, refreshQr, checkStatus, disconnect, restart, remove }
}

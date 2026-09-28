// Recebimento de webhooks de WhatsApp: identifica a instancia e passa o corpo pelo parse do provedor + handler.
import { isValidWebhookToken } from './webhookToken.js'
import { readUzapiPhoneNumberId } from './providerConfig.js'
import { extractMetaPhoneNumberId } from './metaFormat.js'

// Rota nova: POST /api/webhooks/whatsapp/:instanceToken
export function resolveInstanceByToken(db, token) {
  if (!isValidWebhookToken(token)) return { status: 401, error: 'Invalid webhook token' }
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE webhook_token = ?').get(token)
  if (!instance) return { status: 401, error: 'Invalid webhook token' }
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND is_active = 1').get(instance.account_id)
  if (!account) return { status: 404, error: 'Account not found' }
  return { account, instance }
}

// Rota antiga: POST /api/webhooks/evolution/:accountSlug — SEM fallback para a primeira instancia da conta.
export function resolveLegacyEvolutionInstance(db, accountSlug, body, headers) {
  const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(accountSlug)
  if (!account) return { status: 404, error: 'Account not found' }
  const name = body?.instance || body?.instanceName || null
  // Casamento tolerante a caixa e a espaco nas pontas: continua sendo a instancia exata DENTRO da conta
  // (nao reabre o fallback para a primeira instancia), mas nao derruba o recebimento da conta inteira
  // por um "Inst-Teste" ou " inst-teste " vindo do provedor.
  const matches = name
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND lower(trim(instance_name)) = lower(trim(?))').all(account.id, name)
    : []
  // Zero casamentos, ou mais de um (nomes que so diferem por caixa/espaco): recusa em vez de adivinhar.
  if (matches.length !== 1) return { status: 401, error: 'Unknown instance' }
  const instance = matches[0]
  if ((instance.provider || 'evolution') !== 'evolution') return { status: 401, error: 'Unknown instance' }
  if (instance.webhook_secret && headers?.['x-webhook-secret'] !== instance.webhook_secret) {
    return { status: 401, error: 'Invalid webhook secret' }
  }
  return { account, instance }
}

// Rota antiga: POST /api/webhooks/uzapi/:accountSlug — pedido do dono (2026-09-27): numero UzAPI ja
// conectado no upgrade continua recebendo aqui (era isso que a producao registrava no provedor).
// Sem token na URL, entao a instancia e achada pelo phone_number_id do proprio aviso (igual producao
// fazia por uzapi_session) — mesma exigencia de casamento unico do /evolution/:slug, sem fallback
// pra "primeira instancia da conta".
export function resolveLegacyUzapiInstance(db, accountSlug, body, headers) {
  const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(accountSlug)
  if (!account) return { status: 404, error: 'Account not found' }
  const phoneNumberId = extractMetaPhoneNumberId(body)
  // Shape nao reconhecido (sem phone_number_id, ex.: history sync): ignora com 200 pra nao gerar retentativa,
  // igual a producao fazia quando nao conseguia traduzir o aviso.
  if (!phoneNumberId) return { status: 200, ignored: true, note: 'shape uzapi sem phone_number_id, ignorado' }
  const candidates = db.prepare("SELECT * FROM whatsapp_instances WHERE account_id = ? AND provider = 'uzapi'").all(account.id)
  const matches = candidates.filter(i => readUzapiPhoneNumberId(i) === phoneNumberId)
  if (matches.length !== 1) return { status: 401, error: 'Unknown instance' }
  const instance = matches[0]
  if (instance.webhook_secret && headers?.['x-webhook-secret'] !== instance.webhook_secret) {
    return { status: 401, error: 'Invalid webhook secret' }
  }
  return { account, instance }
}

export function processWebhook({ getProvider, handleInboundMessage, handleStatusUpdate, handleConnection, resolveEchoes }, account, instance, req) {
  const provider = getProvider(instance)
  const parsed = provider.parseWebhook(instance, req.body || {}, req.headers || {})
  if ((parsed.connection || parsed.qr) && handleConnection) {
    try {
      handleConnection(instance, { connection: parsed.connection || null, qr: parsed.qr || null })
    } catch (e) {
      console.error('[Webhook connection]', e.message)
    }
  }
  if (parsed.statuses.length > 0) {
    try {
      handleStatusUpdate(account, instance, parsed.statuses)
    } catch (e) {
      console.error('[Webhook messages.update]', e.message)
    }
  }
  let result = { ok: true }
  for (const normalized of parsed.messages) {
    result = handleInboundMessage(account, instance, normalized, { source: 'webhook', req })
  }
  // Eco (resposta dada pelo celular, UzAPI): busca em segundo plano; a resposta ao provedor nao espera.
  if (parsed.echoes && parsed.echoes.length > 0 && resolveEchoes) {
    Promise.resolve()
      .then(() => resolveEchoes(account, instance, parsed.echoes))
      .catch(e => console.error('[Webhook eco]', e.message))
  }
  return result
}

// UzAPI reenvia o aviso em laco se nao receber 2xx: erro interno vira 200 (ja logado). Evolution segue com 500.
export function webhookErrorStatus(instance) {
  return instance && (instance.provider || 'evolution') === 'uzapi' ? 200 : 500
}

// Registrado logo depois do express.json (server/index.js): JSON invalido no webhook de WhatsApp responde 200.
const WHATSAPP_WEBHOOK_PATH = /^(\/crm)?\/api\/webhooks\/whatsapp\//
export function webhookJsonErrorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed' && WHATSAPP_WEBHOOK_PATH.test(req.originalUrl || req.url || '')) {
    console.warn(`[Webhook WhatsApp] JSON invalido ignorado: ${err.message}`)
    return res.status(200).json({ ok: false, error: 'invalid_json' })
  }
  return next(err)
}

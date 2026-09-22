// Segredos do provedor por numero, cifrados com WA_ENC_KEY (32 bytes em hex) e AES-256-GCM (crypto nativo, roda no Node 16).
// Formato: v1:<iv base64>:<tag base64>:<texto cifrado base64>. Trocar WA_ENC_KEY depois torna os tokens ilegiveis.
import crypto from 'crypto'

const PREFIX = 'v1'

function codedError(code) {
  const e = new Error(code)
  e.code = code
  return e
}

function getKey(env) {
  const hex = String(env?.WA_ENC_KEY || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw codedError('wa_enc_key_missing')
  return Buffer.from(hex, 'hex')
}

export function hasEncryptionKey(env = process.env) {
  try { getKey(env); return true } catch { return false }
}

export function encryptSecret(plain, env = process.env) {
  const key = getKey(env)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(box, env = process.env) {
  const parts = String(box || '').split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) throw codedError('wa_secret_invalid')
  const key = getKey(env)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
}

function parseConfig(instance) {
  try { return JSON.parse(instance?.provider_config || '') } catch { return null }
}

// provider_config da UzAPI: { phoneNumberId, instanceToken (cifrado), uzapiInstanceId }
export function buildUzapiConfig({ phoneNumberId, instanceToken, uzapiInstanceId = null }, env = process.env) {
  return JSON.stringify({ phoneNumberId: String(phoneNumberId), instanceToken: encryptSecret(instanceToken, env), uzapiInstanceId: uzapiInstanceId || null })
}

export function readUzapiConfig(instance, env = process.env) {
  const cfg = parseConfig(instance)
  if (!cfg || !cfg.phoneNumberId || !cfg.instanceToken) throw codedError('uzapi_config_missing')
  return { phoneNumberId: String(cfg.phoneNumberId), instanceToken: decryptSecret(cfg.instanceToken, env), uzapiInstanceId: cfg.uzapiInstanceId || null }
}

export function tryReadUzapiConfig(instance, env = process.env) {
  try { return { cfg: readUzapiConfig(instance, env) } } catch (e) { return { error: e.code || e.message } }
}

// So o phone_number_id (para conferir avisos): nao precisa da chave.
export function readUzapiPhoneNumberId(instance) {
  const cfg = parseConfig(instance)
  return cfg && cfg.phoneNumberId ? String(cfg.phoneNumberId) : null
}

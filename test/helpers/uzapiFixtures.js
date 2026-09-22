// Fixtures da UzAPI (avisos reais de 21/09/2026, com telefones e ids mascarados) e utilidades de teste.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildUzapiConfig } from '../../server/services/whatsapp/providerConfig.js'

export const UZAPI_FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'uzapi')

export function loadUzapiFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(UZAPI_FIXTURE_DIR, name), 'utf8'))
}

export function listUzapiFixtures() {
  return fs.readdirSync(UZAPI_FIXTURE_DIR).filter(f => f.endsWith('.json')).sort()
}

export const UZAPI_PNID = '100000000000001'
export const DROS_NUMBER = '554890000001'
export const LEAD_WA_ID = '554890000002'
export const LEAD_PHONE = '5548990000002' // normalizePhone insere o 9 do celular
export const MASKED_PHONES = ['554890000001', '554890000002', '554890000003', '554890000004']

export const UZAPI_TEST_ENV = Object.freeze({
  UZAPI_BASE_URL: 'https://uzapi.test',
  UZAPI_USERNAME: 'dros',
  UZAPI_ACCOUNT_TOKEN: 'CONTA-TESTE',
  UZAPI_PANEL_URL: 'https://painel.uzapi.test',
  WA_ENC_KEY: 'ab'.repeat(32),
  PUBLIC_BASE_URL: 'https://crm.test',
})

// Numero UzAPI pronto no banco de teste (token do numero: TOKEN-INSTANCIA, cifrado com UZAPI_TEST_ENV).
export function insertUzapiInstance(db, accountId, overrides = {}) {
  const id = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider, provider_config, webhook_token, phone_number)
    VALUES (?, ?, '', '', ?, 'uzapi', ?, ?, ?)
  `).run(
    accountId,
    overrides.instance_name || 'uzapi-teste',
    overrides.status || 'connected',
    buildUzapiConfig({ phoneNumberId: overrides.phoneNumberId || UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV),
    overrides.webhook_token || 'c'.repeat(32),
    overrides.phone_number ?? null,
  ).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

export const quietLog = { error() {}, warn() {}, log() {} }

// fetch falso: grava cada chamada e responde com o que o responder devolver.
// responder(url, init, n) -> { status?, json?, bodyText?, buffer?, headers? } | Error
export function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ url, init, body })
    const r = await responder(url, init, calls.length)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    const text = r.bodyText !== undefined ? r.bodyText : (r.json !== undefined ? JSON.stringify(r.json) : '')
    const buf = r.buffer || Buffer.from(text)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      headers: { get: (k) => (r.headers || {})[String(k).toLowerCase()] || null },
    }
  }
  fn.calls = calls
  return fn
}

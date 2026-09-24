import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvolutionSession } from '../server/services/whatsapp/evolutionSession.js'

const inst = { id: 1, instance_name: 'inst teste', api_url: 'http://evo.local/', api_key: 'KEY' }

function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const r = await responder(url, init, calls.length)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    return { ok: status >= 200 && status < 300, status, json: async () => r.json }
  }
  fn.calls = calls
  return fn
}

test('createInstance: POST /instance/create com QR; tira barra final da URL', async () => {
  const f = fakeFetch(() => ({ json: { qrcode: { base64: 'QR1' } } }))
  const r = await createEvolutionSession({ fetch: f }).createInstance({ baseUrl: 'http://evo.local/', apiKey: 'KEY', instanceName: 'nova' })
  assert.equal(f.calls[0].url, 'http://evo.local/instance/create')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.deepEqual(f.calls[0].init.headers, { 'Content-Type': 'application/json', apikey: 'KEY' })
  assert.deepEqual(f.calls[0].body, { instanceName: 'nova', qrcode: true, integration: 'WHATSAPP-BAILEYS' })
  assert.equal(r.qrcode, 'QR1')
})

test('connectInstance: QR aninhado ou direto; nome codificado na URL', async () => {
  const s1 = createEvolutionSession({ fetch: fakeFetch(() => ({ json: { qrcode: { base64: 'A' } } })) })
  assert.equal((await s1.connectInstance(inst)).qrcode, 'A')
  const f = fakeFetch(() => ({ json: { base64: 'B' } }))
  const r = await createEvolutionSession({ fetch: f }).connectInstance(inst)
  assert.equal(r.qrcode, 'B')
  assert.equal(f.calls[0].url, 'http://evo.local/instance/connect/inst%20teste')
  assert.deepEqual(f.calls[0].init.headers, { apikey: 'KEY' })
})

test('connectionState: le instance.state ou state; erro de rede devolve close + error', async () => {
  const s = createEvolutionSession({ fetch: fakeFetch(() => ({ json: { instance: { state: 'open' } } })) })
  assert.equal((await s.connectionState(inst)).state, 'open')
  const s2 = createEvolutionSession({ fetch: fakeFetch(() => ({ json: { state: 'connecting' } })) })
  assert.equal((await s2.connectionState(inst)).state, 'connecting')
  const s3 = createEvolutionSession({ fetch: fakeFetch(() => new Error('ECONNRESET')) })
  const r3 = await s3.connectionState(inst)
  assert.equal(r3.state, 'close')
  assert.equal(r3.error, 'ECONNRESET')
})

test('nenhuma funcao lanca erro: falha de rede vira resultado', async () => {
  const s = createEvolutionSession({ fetch: fakeFetch(() => new Error('down')) })
  assert.deepEqual(await s.connectInstance(inst), { qrcode: null, raw: {}, error: 'down' })
  assert.equal((await s.createInstance({ baseUrl: 'http://x', apiKey: 'K', instanceName: 'n' })).error, 'down')
  assert.equal((await s.logout(inst)).ok, false)
  assert.equal((await s.deleteInstance(inst)).ok, false)
  assert.equal((await s.restartInstance(inst)).ok, false)
  assert.equal(await s.fetchInstanceInfo(inst), null)
})

test('logout, delete e restart: metodo e rota certos; delete aceita 404', async () => {
  const f = fakeFetch((url) => (url.includes('/delete/') ? { status: 404, json: {} } : { json: { ok: 1 } }))
  const s = createEvolutionSession({ fetch: f })
  assert.equal((await s.logout(inst)).ok, true)
  assert.equal(f.calls[0].url, 'http://evo.local/instance/logout/inst%20teste')
  assert.equal(f.calls[0].init.method, 'DELETE')
  const d = await s.deleteInstance(inst, { timeoutMs: 5000 })
  assert.equal(d.ok, true)
  assert.equal(d.status, 404)
  assert.equal(f.calls[1].url, 'http://evo.local/instance/delete/inst%20teste')
  assert.ok(f.calls[1].init.signal, 'delete tem timeout')
  const rs = await s.restartInstance(inst)
  assert.equal(rs.ok, true)
  assert.equal(f.calls[2].url, 'http://evo.local/instance/restart/inst%20teste')
  assert.equal(f.calls[2].init.method, 'POST')
})

test('fetchInstanceInfo: aceita lista ou objeto instance', async () => {
  const s = createEvolutionSession({ fetch: fakeFetch(() => ({ json: [{ ownerJid: '5547@s.whatsapp.net' }] })) })
  assert.deepEqual(await s.fetchInstanceInfo(inst), { ownerJid: '5547@s.whatsapp.net' })
  const f = fakeFetch(() => ({ json: { instance: { owner: 'x' } } }))
  assert.deepEqual(await createEvolutionSession({ fetch: f }).fetchInstanceInfo(inst), { owner: 'x' })
  assert.equal(f.calls[0].url, 'http://evo.local/instance/fetchInstances?instanceName=inst%20teste')
})

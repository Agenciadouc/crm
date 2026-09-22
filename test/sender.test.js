import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createSender, LEAD_DAILY_CAP_DEFAULT, typingDelaySeconds } from '../server/services/whatsapp/sender.js'

function fakeProvider(overrides = {}) {
  const calls = { sendText: [], sendMedia: [], checkNumber: [], sendPresence: [], markRead: [] }
  const p = {
    name: 'fake',
    capabilities: { numberCheck: true, presence: true, ...(overrides.capabilities || {}) },
    async sendText(i, phone, text) { calls.sendText.push([phone, text]); return overrides.sendTextResult || { ok: true, messageId: 'WA1', raw: { key: { id: 'WA1' } } } },
    async sendMedia(i, phone, media) { calls.sendMedia.push([phone, media]); return { ok: true, messageId: 'WAM1', raw: {} } },
    async checkNumber(i, phones, opts) { calls.checkNumber.push([phones, opts]); if (overrides.checkNumber) return overrides.checkNumber(phones); const o = {}; for (const x of phones) o[x] = true; return o },
    async sendPresence(i, phone, state) { calls.sendPresence.push([phone, state]); return { ok: true } },
    async markRead(i, lead, id) { calls.markRead.push([lead.id, id]); return { ok: true } },
  }
  return { provider: p, calls }
}

function setup(providerOverrides) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const { provider, calls } = fakeProvider(providerOverrides)
  const sender = createSender({ db, getProvider: () => provider, sleep: async () => {}, random: () => 0.5 })
  return { db, seed, sender, calls }
}

const humanChat = { skipTyping: true, skipQuota: true, skipBusinessHours: true, skipLeadCap: true, skipHealthCheck: true }

test('cap default e 50', () => {
  assert.equal(LEAD_DAILY_CAP_DEFAULT, 50)
})

test('envio completo: pre-flight, digitando (available/composing/paused) e sendText com numero normalizado', async () => {
  const { seed, sender, calls } = setup()
  const r = await sender.sendViaInstance(seed.instance, '47991351835', 'Ola tudo bem')
  assert.deepEqual(r, { ok: true, wamsgId: 'WA1', raw: { key: { id: 'WA1' } } })
  assert.deepEqual(calls.checkNumber[0][0], ['5547991351835'])
  assert.deepEqual(calls.sendPresence.map(c => c[1]), ['available', 'composing', 'paused'])
  assert.deepEqual(calls.sendText, [['5547991351835', 'Ola tudo bem']])
})

test('sem capabilities numberCheck/presence nao chama pre-flight nem digitando', async () => {
  const { seed, sender, calls } = setup({ capabilities: { numberCheck: false, presence: false } })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x')
  assert.equal(r.ok, true)
  assert.equal(calls.checkNumber.length, 0)
  assert.equal(calls.sendPresence.length, 0)
})

test('telefone vazio', async () => {
  const { seed, sender } = setup()
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '', 'x'), { ok: false, reason: 'phone vazio' })
})

test('instancia pausada bloqueia, exceto com skipHealthCheck', async () => {
  const { seed, sender, calls } = setup()
  const paused = { ...seed.instance, paused_at: '2026-09-15 10:00:00', paused_reason: 'manual' }
  assert.deepEqual(await sender.sendViaInstance(paused, '5547991351835', 'x'), { ok: false, reason: 'instance_paused_manual' })
  assert.equal(calls.sendText.length, 0)
  const r = await sender.sendViaInstance(paused, '5547991351835', 'x', humanChat)
  assert.equal(r.ok, true)
})

test('fora do horario comercial', async () => {
  const { seed, sender } = setup()
  const closed = { ...seed.instance, business_hours_json: JSON.stringify({ sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }) }
  assert.deepEqual(await sender.sendViaInstance(closed, '5547991351835', 'x'), { ok: false, reason: 'outside_business_hours' })
  assert.equal(sender.isInBusinessHours({ business_hours_json: null }), true)
  assert.equal(sender.isInBusinessHours({ business_hours_json: 'nao-json' }), true)
  const h = JSON.stringify({ mon: [{ start: '08:00', end: '18:00' }] })
  assert.equal(sender.isInBusinessHours({ business_hours_json: h }, new Date(2026, 8, 14, 9, 30)), true)
  assert.equal(sender.isInBusinessHours({ business_hours_json: h }, new Date(2026, 8, 14, 19, 0)), false)
})

test('cap por lead usa 50 quando a instancia nao define', async () => {
  const { db, seed, sender } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, delivery_status) VALUES (?, ?, 'outbound', 'x', 'sent')")
  for (let i = 0; i < 49; i++) ins.run(lead.id, seed.account.id)
  const inst = { ...seed.instance, lead_daily_msg_cap: null }
  const ok = await sender.sendViaInstance(inst, lead.phone, 'x', { leadId: lead.id, skipQuota: true, skipTyping: true })
  assert.equal(ok.ok, true)
  ins.run(lead.id, seed.account.id)
  const blocked = await sender.sendViaInstance(inst, lead.phone, 'x', { leadId: lead.id, skipQuota: true, skipTyping: true })
  assert.deepEqual(blocked, { ok: false, reason: 'lead_daily_cap_50' })
})

test('pre-flight false bloqueia com validationFailed e fica em cache', async () => {
  const { seed, sender, calls } = setup({ checkNumber: (phones) => ({ [phones[0]]: false }) })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x', { skipTyping: true })
  assert.deepEqual(r, { ok: false, reason: 'number_not_on_whatsapp', validationFailed: true })
  assert.equal(await sender.checkWhatsAppNumber(seed.instance, '5547991351835'), false)
  assert.equal(calls.checkNumber.length, 1)
  assert.equal(calls.sendText.length, 0)
})

test('pre-flight com erro de rede devolve null, nao cacheia e o envio segue', async () => {
  let n = 0
  const { seed, sender, calls } = setup({ checkNumber: () => { n++; throw new Error('timeout') } })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x', { skipTyping: true })
  assert.equal(r.ok, true)
  assert.equal(await sender.checkWhatsAppNumber(seed.instance, '5547991351835'), null)
  assert.equal(n, 2)
  assert.equal(calls.sendText.length, 1)
})

test('falha do provedor devolve reason e raw', async () => {
  const { seed, sender } = setup({ sendTextResult: { ok: false, messageId: null, reason: 'http_500', raw: { error: 'x' } } })
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '5547991351835', 'x', humanChat), { ok: false, reason: 'http_500', raw: { error: 'x' } })
})

test('excecao do provedor sem raw devolve so reason', async () => {
  const { seed, sender } = setup({ sendTextResult: { ok: false, messageId: null, reason: 'ECONNREFUSED' } })
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '5547991351835', 'x', humanChat), { ok: false, reason: 'ECONNREFUSED' })
})

test('sendMediaViaInstance aplica as mesmas checagens e repassa a midia', async () => {
  const { seed, sender, calls } = setup()
  const media = { type: 'image', base64: 'QUJD', mimetype: 'image/png', fileName: 'f.png', caption: 'legenda' }
  const paused = { ...seed.instance, paused_at: 'x', paused_reason: 'delivered_rate_low' }
  assert.deepEqual(await sender.sendMediaViaInstance(paused, '5547991351835', media), { ok: false, reason: 'instance_paused_delivered_rate_low' })
  const r = await sender.sendMediaViaInstance(seed.instance, '47991351835', media, humanChat)
  assert.deepEqual(r, { ok: true, wamsgId: 'WAM1', raw: {} })
  assert.deepEqual(calls.sendMedia, [['5547991351835', media]])
  assert.deepEqual(calls.checkNumber[0][0], ['5547991351835'])
})

test('checkWhatsAppNumbersBulk devolve Map pelo telefone original', async () => {
  const { seed, sender, calls } = setup({ checkNumber: () => ({ '5547991351835': true, '5547988887777': false }) })
  const m = await sender.checkWhatsAppNumbersBulk(seed.instance, ['47991351835', '5547988887777', '5547991351835'])
  assert.equal(m.get('47991351835'), true)
  assert.equal(m.get('5547988887777'), false)
  assert.equal(m.has('5547991351835'), false) // dedup: o original mantido e o primeiro
  assert.deepEqual(calls.checkNumber[0][1], { timeoutMs: 15000, matchByNumber: true })
})

test('markMessageAsRead usa a ultima inbound do lead e nao quebra (bug da coluna inexistente)', async () => {
  const { db, seed, sender, calls } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', wa_remote_jid: '5547991351835@s.whatsapp.net' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id) VALUES (?, ?, ?, 'x', ?)")
  ins.run(lead.id, seed.account.id, 'inbound', 'IN1')
  ins.run(lead.id, seed.account.id, 'inbound', 'IN2')
  ins.run(lead.id, seed.account.id, 'outbound', 'OUT1')
  await sender.markMessageAsRead(seed.instance, lead)
  assert.deepEqual(calls.markRead, [[lead.id, 'IN2']])
})

test('typingDelaySeconds: 1s a cada 20 caracteres, entre 1 e 15', () => {
  assert.equal(typingDelaySeconds(''), 1)
  assert.equal(typingDelaySeconds('x'.repeat(20)), 1)
  assert.equal(typingDelaySeconds('x'.repeat(21)), 2)
  assert.equal(typingDelaySeconds('x'.repeat(1000)), 15)
})

test('provedor com typingDelay (UzAPI): manda delayTyping no envio; Chat humano (skipTyping) nao manda', async () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const opts = []
  const provider = {
    name: 'uz',
    capabilities: { numberCheck: false, presence: false, typingDelay: true },
    async sendText(i, phone, text, o) { opts.push(o); return { ok: true, messageId: 'U1', raw: {} } },
  }
  const sender = createSender({ db, getProvider: () => provider, sleep: async () => {}, random: () => 0.5 })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x'.repeat(45))
  await sender.sendViaInstance(seed.instance, '5547991351835', 'oi', humanChat)
  assert.deepEqual(r, { ok: true, wamsgId: 'U1', raw: {} })
  assert.deepEqual(opts, [{ delayTyping: 3 }, undefined])
})

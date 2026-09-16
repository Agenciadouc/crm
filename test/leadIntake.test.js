import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createLeadIntake } from '../server/services/leadIntake.js'

const tick = () => new Promise(r => setImmediate(r))

function setup(opts = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, opts)
  const calls = { handoff: [], capi: [], roulette: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: (accountId, instanceId) => { calls.roulette.push([accountId, instanceId]); return opts.rouletteUser ?? null },
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
  })
  return { db, seed, calls, intake }
}

test('cria lead novo no funil padrao, primeira etapa, com historico webhook', () => {
  const { db, seed, intake, calls } = setup()
  const r = intake.getOrCreateLead(seed.account.id, '47991351835', 'Maria', 'whatsapp', '5547991351835@s.whatsapp.net', seed.instance.id)
  assert.equal(r.isNew, true)
  assert.equal(r.lead.phone, '5547991351835')
  assert.equal(r.lead.name, 'Maria')
  assert.equal(r.lead.stage_id, seed.stage1)
  assert.equal(r.lead.instance_id, seed.instance.id)
  assert.ok(r.lead.opted_in_at)
  assert.deepEqual(calls.roulette, [[seed.account.id, seed.instance.id]])
  const h = db.prepare('SELECT * FROM stage_history WHERE lead_id = ?').all(r.lead.id)
  assert.equal(h.length, 1)
  assert.equal(h[0].trigger_type, 'webhook')
})

test('nome vazio usa telefone; sem telefone usa Sem nome', () => {
  const { seed, intake } = setup()
  assert.equal(intake.getOrCreateLead(seed.account.id, '5547911112222', '', 'whatsapp', null, null).lead.name, '5547911112222')
  assert.equal(intake.getOrCreateLead(seed.account.id, null, '', 'whatsapp', '1@lid', null).lead.name, 'Sem nome')
})

test('encontra lead existente por wa_remote_jid, depois telefone exato, depois chave de comparacao', () => {
  const { db, seed, intake } = setup()
  const a = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '4791351835', wa_remote_jid: null })
  const r = intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', '5547991351835@s.whatsapp.net', seed.instance.id)
  assert.equal(r.isNew, false)
  assert.equal(r.lead.id, a.id)
  assert.equal(db.prepare('SELECT instance_id FROM leads WHERE id = ?').get(a.id).instance_id, seed.instance.id)
})

test('lead arquivado nao desarquiva, so marca has_new_after_archive', () => {
  const { db, seed, intake } = setup()
  const a = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', is_archived: 1 })
  intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', null, null)
  const row = db.prepare('SELECT is_archived, has_new_after_archive FROM leads WHERE id = ?').get(a.id)
  assert.deepEqual({ ...row }, { is_archived: 1, has_new_after_archive: 1 })
})

test('telefone bloqueado (exato ou pela chave) devolve blocked', () => {
  const { db, seed, intake } = setup()
  insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '47991351835', is_blocked: 1 })
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', null, null), { lead: null, isNew: false, blocked: true })
})

test('instancia restrita nao cria lead novo', () => {
  const { seed, intake } = setup({ intakeMode: 'restricted' })
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, seed.instance.id), { lead: null, isNew: false, restricted: true })
})

test('sem funil padrao nao cria', () => {
  const { db, seed, intake } = setup()
  db.prepare('UPDATE funnels SET is_default = 0').run()
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, null), { lead: null, isNew: false })
})

test('com atendente da roleta dispara handoff em setImmediate, exceto noAutoHandoff', async () => {
  const { seed, intake, calls } = setup({ rouletteUser: 7 })
  const r = intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, seed.instance.id)
  assert.equal(r.lead.attendant_id, 7)
  assert.equal(calls.handoff.length, 0)
  await tick()
  assert.deepEqual(calls.handoff, [[r.lead.id, 7, { source: 'webhook' }]])
  intake.getOrCreateLead(seed.account.id, '5547933334444', 'Y', 'sheets', null, null, { noAutoHandoff: true })
  await tick()
  assert.equal(calls.handoff.length, 1)
})

test('autoDetectStage avanca para a primeira etapa a frente com palavra-chave e dispara CAPI', () => {
  const { db, seed, intake, calls } = setup({ stage2Keywords: JSON.stringify(['proposta']) })
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  intake.autoDetectStage(lead, 'Segue a PROPOSTA')
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(lead.id).stage_id, seed.stage2)
  const h = db.prepare("SELECT * FROM stage_history WHERE lead_id = ? AND trigger_type = 'auto_keyword'").get(lead.id)
  assert.equal(h.from_stage_id, seed.stage1)
  assert.deepEqual(calls.capi, [[lead.id, seed.stage2, h.id]])
})

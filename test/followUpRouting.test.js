import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { planFollowUpSend, resumeAutomaticFollowUps, needsVarietyCheck } from '../server/services/followUpRouting.js'

function uzapi(db, accountId, status = 'connected') {
  const id = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', ?, 'uzapi')`).run(accountId, status).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('so Evolution: pausa no_send_number', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  assert.deepEqual(planFollowUpSend(db, { lead, followUp: { instance_id: s.instance.id } }), { ok: false, pause: 'no_send_number' })
})

test('sai pelo numero padrao, ignorando follow_ups.instance_id', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const uz = uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  const r = planFollowUpSend(db, { lead, followUp: { instance_id: s.instance.id, optout_footer_enabled: 0 } })
  assert.equal(r.ok, true); assert.equal(r.instance.id, uz.id); assert.equal(r.footer, null)
})

test('descadastrado pausa antes de tudo', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1', opted_out_at: '2026-09-20 10:00:00' })
  assert.deepEqual(planFollowUpSend(db, { lead, followUp: {} }), { ok: false, pause: 'lead_opted_out' })
})

test('rodape opcional por follow-up usa o texto da conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  assert.equal(planFollowUpSend(db, { lead, followUp: { optout_footer_enabled: 1 } }).footer, 'Digite SAIR para não receber mais mensagens.')
  db.prepare("UPDATE accounts SET optout_footer_text = 'Responda SAIR p/ parar' WHERE id = ?").run(s.account.id)
  assert.equal(planFollowUpSend(db, { lead, followUp: { optout_footer_enabled: 1 } }).footer, 'Responda SAIR p/ parar')
})

test('retoma os pausados da conta quando o numero padrao esta conectado', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'no_send_number')").run(lead.id)
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'lead_opted_out')").run(lead.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 0) // sem numero de disparo
  uzapi(db, s.account.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 1)
  const rows = db.prepare('SELECT status, paused_reason FROM lead_follow_ups ORDER BY id').all()
  assert.deepEqual(rows, [{ status: 'active', paused_reason: null }, { status: 'paused', paused_reason: 'lead_opted_out' }])
})

test('needsVarietyCheck: falso so pra inatividade em modo rotation', () => {
  assert.equal(needsVarietyCheck({ type: 'inactivity', inactivityMode: 'rotation' }), false)
  assert.equal(needsVarietyCheck({ type: 'inactivity', inactivityMode: 'sequence' }), true)
  assert.equal(needsVarietyCheck({ type: 'sequence', inactivityMode: null }), true)
})

test('resumeAutomaticFollowUps nao retoma send_failed/send_error por padrao', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'send_failed')").run(lead.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 0)
  const row = db.prepare('SELECT status, paused_reason FROM lead_follow_ups WHERE lead_id = ?').get(lead.id)
  assert.deepEqual(row, { status: 'paused', paused_reason: 'send_failed' })
})

test('resumeAutomaticFollowUps com includeSendFailures retoma send_failed/send_error', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'send_failed')").run(lead.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id, { includeSendFailures: true }), 1)
  const row = db.prepare('SELECT status, paused_reason FROM lead_follow_ups WHERE lead_id = ?').get(lead.id)
  assert.deepEqual(row, { status: 'active', paused_reason: null })
})

test('resumeAutomaticFollowUps: pausa antiga (legado instance_offline) nao volta; recente e no_send_number voltam', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  const ins = db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason, paused_at) VALUES (?, 1, 'paused', ?, datetime('now', ?))")
  const velho = ins.run(lead.id, 'instance_offline', '-30 days').lastInsertRowid
  const velhoRemovido = ins.run(lead.id, 'instance_removed', '-30 days').lastInsertRowid
  const recente = ins.run(lead.id, 'instance_offline', '-1 days').lastInsertRowid
  const semNumeroVelho = ins.run(lead.id, 'no_send_number', '-30 days').lastInsertRowid
  const offlineVelho = ins.run(lead.id, 'send_number_offline', '-30 days').lastInsertRowid
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 3)
  const st = (id) => db.prepare('SELECT status FROM lead_follow_ups WHERE id = ?').get(id).status
  assert.equal(st(velho), 'paused'); assert.equal(st(velhoRemovido), 'paused')
  assert.equal(st(recente), 'active'); assert.equal(st(semNumeroVelho), 'active'); assert.equal(st(offlineVelho), 'active')
})

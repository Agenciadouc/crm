import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { getPrecedingOutboundRun, confirmPendingWeakSignals, recordSignal, hasSignalLast7d, hasConfirmedWeakLast7d } from '../server/services/signals/repo.js'

function lastMessageId(db, leadId) {
  return db.prepare('SELECT id FROM messages WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId).id
}

test('getPrecedingOutboundRun: pega so os outbound depois do ultimo inbound, antes da mensagem dada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 30 })
  addMessage(db, { leadId, direction: 'outbound', content: 'tudo bem?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 10 })
  addMessage(db, { leadId, direction: 'inbound', content: 'pode sim', minutesAgo: 0 })

  const run = getPrecedingOutboundRun(db, leadId, lastMessageId(db, leadId))
  assert.deepEqual(run.map(m => m.content), ['tudo bem?', 'posso te mandar uma proposta?'])
})

test('getPrecedingOutboundRun: sem outbound antes -> array vazio', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 0 })
  const run = getPrecedingOutboundRun(db, leadId, lastMessageId(db, leadId))
  assert.deepEqual(run, [])
})

test('recordSignal + hasSignalLast7d: grava e acha dentro de 7 dias, nao acha fora', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quero comprar' })
  const msgId = lastMessageId(db, leadId)

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'strong', keyword: 'quero comprar', messageId: msgId, createdAt: new Date().toISOString() })
  assert.equal(hasSignalLast7d(db, leadId, 'strong', new Date().toISOString()), true)
  assert.equal(hasSignalLast7d(db, leadId, 'negative', new Date().toISOString()), false)

  db.prepare("UPDATE lead_signals SET created_at = datetime('now', '-10 days') WHERE lead_id = ?").run(leadId)
  assert.equal(hasSignalLast7d(db, leadId, 'strong', new Date().toISOString()), false)
})

test('confirmPendingWeakSignals: confirma so os pendentes dentro da janela, nao mexe no ja confirmado nem no velho demais', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa' })
  const msgId = lastMessageId(db, leadId)
  const now = new Date().toISOString()

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'weak', keyword: 'quanto custa', messageId: msgId, createdAt: now })
  assert.equal(hasConfirmedWeakLast7d(db, leadId, now), false)

  const info = confirmPendingWeakSignals(db, leadId, 24, now)
  assert.equal(info.changes, 1)
  assert.equal(hasConfirmedWeakLast7d(db, leadId, now), true)

  const info2 = confirmPendingWeakSignals(db, leadId, 24, now)
  assert.equal(info2.changes, 0, 'ja confirmado nao deveria mudar de novo')
})

test('confirmPendingWeakSignals: fora da janela de horas nao confirma (fantasma)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa' })
  const msgId = lastMessageId(db, leadId)

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'weak', keyword: 'quanto custa', messageId: msgId, createdAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() })
  const info = confirmPendingWeakSignals(db, leadId, 24, new Date().toISOString())
  assert.equal(info.changes, 0)
  assert.equal(hasConfirmedWeakLast7d(db, leadId, new Date().toISOString()), false)
})

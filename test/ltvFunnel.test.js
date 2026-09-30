import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead } from './helpers/ltvDb.js'
import { ensureRepurchaseFunnel, ensureAllRepurchaseFunnels, stageIdByKey, stageKey, isRepurchaseFunnel, checkStagesUpdate, canDeactivateFunnel } from '../server/services/ltv/funnel.js'
import { moveLeadToFunnel, configureStageMoveHooks } from '../server/services/stageMove.js'
import { bootRoteiroRuntime } from '../server/services/roteiro/runtime.js'

test.afterEach(() => { configureStageMoveHooks({ onMoved: null }) })

test('ensureRepurchaseFunnel cria 6 etapas-chave, motivos e é idempotente', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const f1 = ensureRepurchaseFunnel(db, s.accountId)
  const f2 = ensureRepurchaseFunnel(db, s.accountId)
  assert.equal(f1, f2)
  const f = db.prepare('SELECT * FROM funnels WHERE id = ?').get(f1)
  assert.equal(f.kind, 'recompra'); assert.equal(f.is_default, 0); assert.equal(f.name, 'Recompra')
  const keys = db.prepare('SELECT system_key FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(f1).map(r => r.system_key)
  assert.deepEqual(keys, ['aguardando', 'a_contatar', 'em_conversa', 'comprou', 'nao_agora', 'nao_quer'])
  assert.equal(db.prepare('SELECT repurchase_funnel_id FROM accounts WHERE id = ?').get(s.accountId).repurchase_funnel_id, f1)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_agora'").get(s.accountId).n, 5)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_quer'").get(s.accountId).n, 5)
  assert.equal(isRepurchaseFunnel(db, f1), true); assert.equal(isRepurchaseFunnel(db, s.funnelId), false)
  assert.equal(stageKey(db, stageIdByKey(db, s.accountId, 'comprou')), 'comprou')
  assert.ok(ensureAllRepurchaseFunnels(db) >= 2)
})

test('checkStagesUpdate recusa apagar etapa-chave; canDeactivateFunnel recusa recompra', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const f = ensureRepurchaseFunnel(db, s.accountId)
  const ids = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ?').all(f).map(r => ({ id: r.id }))
  assert.deepEqual(checkStagesUpdate(db, f, ids), { ok: true })
  assert.equal(checkStagesUpdate(db, f, ids.slice(1)).ok, false)
  assert.deepEqual(checkStagesUpdate(db, s.funnelId, []), { ok: true })
  assert.equal(canDeactivateFunnel(db, f), false); assert.equal(canDeactivateFunnel(db, s.funnelId), true)
})

test('moveLeadToFunnel troca funil, grava histórico e não manda CAPI na recompra', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const capi = []
  bootRoteiroRuntime({ db, broadcastSSE: () => {}, triggerCapiForStageChange: (...a) => capi.push(a), schedule: () => {} })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  const f = ensureRepurchaseFunnel(db, s.accountId)
  const to = stageIdByKey(db, s.accountId, 'aguardando')
  const r = moveLeadToFunnel(db, { lead: { id: leadId }, toFunnelId: f, toStageId: to, trigger: 'recompra' })
  assert.equal(r.moved, true)
  const lead = db.prepare('SELECT funnel_id, stage_id FROM leads WHERE id = ?').get(leadId)
  assert.deepEqual({ ...lead }, { funnel_id: f, stage_id: to })
  const h = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY id DESC').get(leadId)
  assert.equal(h.from_stage_id, s.stages.venda); assert.equal(h.to_stage_id, to); assert.equal(h.trigger_type, 'recompra')
  assert.equal(capi.length, 0)
  assert.throws(() => moveLeadToFunnel(db, { lead: { id: leadId }, toFunnelId: f, toStageId: s.stages.novo, trigger: 'recompra' }), /stage_not_in_funnel/)
})

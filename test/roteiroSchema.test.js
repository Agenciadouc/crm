import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'

test('schema do roteiro: tabelas, colunas do lead/conta e idempotente', () => {
  const db = createRoteiroTestDb()
  applyRoteiroSchema(db) // 2a vez nao quebra
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  for (const t of ['roteiro_versions', 'roteiro_questions', 'roteiro_options', 'roteiro_deviations', 'roteiro_variants', 'roteiro_asks', 'lead_answers', 'roteiro_suggestions', 'roteiro_offscript', 'lead_score_daily']) {
    assert.ok(tables.includes(t), t)
  }
  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  for (const c of ['score', 'score_band', 'score_fit', 'score_fit_grade', 'score_engagement', 'score_quadrant', 'score_reasons_json', 'score_prev', 'score_at', 'score_alerted_at', 'roteiro_no_auto_from_stage']) assert.ok(leadCols.includes(c), c)
  const s = seedRoteiroBase(db)
  const acc = db.prepare('SELECT roteiro_min_reply_rate, roteiro_reply_window_h, score_alert_minutes, score_half_life_days FROM accounts WHERE id = ?').get(s.accountId)
  assert.deepEqual(acc, { roteiro_min_reply_rate: 70, roteiro_reply_window_h: 24, score_alert_minutes: 60, score_half_life_days: 7 })
})

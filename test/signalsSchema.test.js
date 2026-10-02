import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb } from './helpers/memoryDb.js'
import { applyKeywordSignalsSchema } from '../server/services/signals/schema.js'

function hasCol(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}

test('applyKeywordSignalsSchema cria colunas e a tabela lead_signals', () => {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  for (const col of ['trigger_keywords', 'weak_keywords', 'strong_keywords', 'negative_keywords']) {
    assert.ok(hasCol(db, 'funnel_stages', col), `funnel_stages.${col} deveria existir`)
  }
  assert.ok(hasCol(db, 'accounts', 'keyword_signal_ghost_hours'), 'accounts.keyword_signal_ghost_hours deveria existir')
  const defaultRow = db.prepare('SELECT keyword_signal_ghost_hours FROM accounts LIMIT 1').get()
  assert.equal(defaultRow?.keyword_signal_ghost_hours ?? 24, 24)

  db.prepare(`INSERT INTO lead_signals (account_id, lead_id, stage_id, signal_type, keyword, message_id, created_at) VALUES (1, 1, 1, 'strong', 'quero comprar', 1, datetime('now'))`).run()
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.equal(row.signal_type, 'strong')
  assert.equal(row.confirmed_at, null)
})

test('applyKeywordSignalsSchema e idempotente (rodar 2x nao quebra)', () => {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  assert.doesNotThrow(() => applyKeywordSignalsSchema(db))
})

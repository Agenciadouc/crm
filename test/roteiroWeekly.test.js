// Revisao semanal do roteiro (spec 2026-10-02 §10): tabela de sugestoes com tipos novos,
// rodada 1x por semana por conta, saneamento e aplicacao.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'

function oldSuggestionsTable(db) {
  db.exec(`DROP TABLE roteiro_suggestions; CREATE TABLE roteiro_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER, question_key TEXT,
    type TEXT NOT NULL CHECK (type IN ('rewrite','seller_phrasing','new_option','new_deviation','reorder')),
    payload_json TEXT NOT NULL, evidence_json TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','testing','applied','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_by INTEGER, decided_at TEXT)`)
}

test('reconstroi roteiro_suggestions mantendo ids e linhas; aceita tipos novos; idempotente', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  oldSuggestionsTable(db)
  db.prepare("INSERT INTO roteiro_suggestions (id, account_id, type, payload_json, status) VALUES (7, ?, 'rewrite', '{}', 'testing')").run(s.accountId)
  assert.throws(() => db.prepare("INSERT INTO roteiro_suggestions (account_id, type, payload_json) VALUES (?, 'new_question', '{}')").run(s.accountId))
  applyRoteiroSchema(db)
  assert.deepEqual(db.prepare('SELECT id, type, status FROM roteiro_suggestions').all(), [{ id: 7, type: 'rewrite', status: 'testing' }])
  for (const t of ['new_question', 'new_profile']) db.prepare("INSERT INTO roteiro_suggestions (account_id, type, payload_json) VALUES (?, ?, '{}')").run(s.accountId, t)
  assert.ok(db.prepare('SELECT id FROM roteiro_suggestions WHERE type = ?').get('new_profile').id > 7)
  applyRoteiroSchema(db)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roteiro_suggestions').get().n, 3)
  db.prepare("INSERT INTO roteiro_weekly_runs (account_id, ran_at) VALUES (?, datetime('now'))").run(s.accountId)
})

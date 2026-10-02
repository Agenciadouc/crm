import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { createLegacyCadenceTables, createCadenceTestDb } from './helpers/cadenceDb.js'
import { applyCadenceSchema, rebuildCadenceAttempts, CADENCE_ACTION_TYPES } from '../server/services/cadence/schema.js'

function legacyDbWithData() {
  const db = createRoteiroTestDb()
  createLegacyCadenceTables(db)
  const s = seedRoteiroBase(db)
  const cad = Number(db.prepare("INSERT INTO cadences (account_id, name) VALUES (?, 'Reativar')").run(s.accountId).lastInsertRowid)
  const ins = db.prepare("INSERT INTO cadence_attempts (id, cadence_id, position, action_type, description, delay_days, auto_message) VALUES (?, ?, ?, ?, ?, ?, ?)")
  ins.run(40, cad, 0, 'visita', 'lixo do apaga-e-recria', 0, null)
  db.prepare('DELETE FROM cadence_attempts WHERE id = 40').run() // sqlite_sequence fica em 40
  ins.run(5, cad, 0, 'mensagem', 'Oi', 0, 'Oi {nome}')
  ins.run(6, cad, 1, 'ligacao', 'Ligar', 2, null)
  ins.run(9, cad, 2, 'whatsapp', 'Lembrete', 4, 'Lembra de mim?')
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, last_executed_attempt_id) VALUES (?, ?, 6, 5)').run(leadId, cad)
  return { db, s, cad, leadId }
}

test('reconstrucao: mesmos ids, ponteiros do lead preservados com FK ligada, sequencia nao volta', () => {
  const { db, cad, leadId } = legacyDbWithData()
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  const r = applyCadenceSchema(db)
  assert.deepEqual(r, { rebuilt: true, count: 3 })
  assert.deepEqual(db.prepare('SELECT id, position, action_type, auto_message FROM cadence_attempts ORDER BY id').all(), [
    { id: 5, position: 0, action_type: 'mensagem', auto_message: 'Oi {nome}' },
    { id: 6, position: 1, action_type: 'ligacao', auto_message: null },
    { id: 9, position: 2, action_type: 'whatsapp', auto_message: 'Lembra de mim?' },
  ])
  const lc = db.prepare('SELECT current_attempt_id, last_executed_attempt_id, kind FROM lead_cadences WHERE lead_id = ?').get(leadId)
  assert.deepEqual(lc, { current_attempt_id: 6, last_executed_attempt_id: 5, kind: 'avulsa' })
  const novo = Number(db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 3, 'email')").run(cad).lastInsertRowid)
  assert.ok(novo > 40, `id novo ${novo} reaproveitou id antigo`)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  // FK continua funcionando depois da troca de tabela
  db.prepare('DELETE FROM cadence_attempts WHERE id = 6').run()
  assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId).current_attempt_id, null)
})

test('reconstrucao e idempotente e o novo CHECK aceita pergunta so com question_key', () => {
  const { db, cad } = legacyDbWithData()
  applyCadenceSchema(db)
  assert.deepEqual(applyCadenceSchema(db), { rebuilt: false, count: null })
  assert.deepEqual(rebuildCadenceAttempts(db), { rebuilt: false, count: null })
  assert.ok(CADENCE_ACTION_TYPES.includes('pergunta'))
  db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type, question_key) VALUES (?, 5, 'pergunta', 'abc123')").run(cad)
  assert.throws(() => db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 6, 'pergunta')").run(cad), /CHECK/)
  assert.throws(() => db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 6, 'telepatia')").run(cad), /CHECK/)
})

test('reconstrucao ignora violacao de FK pre-existente em tabela alheia (lixo antigo do banco)', () => {
  const { db, cad } = legacyDbWithData()
  // simula producao: uma linha orfa numa tabela sem nenhuma relacao com cadence_attempts
  // (ex.: cadencia apontando pra uma conta ja deletada ha muito tempo)
  db.pragma('foreign_keys = OFF')
  db.prepare("INSERT INTO cadences (id, account_id, name) VALUES (999, 888888, 'Orfa')").run()
  db.pragma('foreign_keys = ON')
  assert.ok(db.pragma('foreign_key_check').length > 0, 'pre-condicao: banco tem lixo de FK alheio')
  assert.deepEqual(applyCadenceSchema(db), { rebuilt: true, count: 3 })
  assert.ok(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'cadence_attempts'").get().sql.includes("'pergunta'"))
})

test('reconstrucao recusa rodar dentro de uma transacao aberta (FK fica ligada) e nao muda nada', () => {
  const { db, cad, leadId } = legacyDbWithData()
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  const before = db.prepare('SELECT current_attempt_id, last_executed_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId)
  assert.throws(() => db.transaction(() => rebuildCadenceAttempts(db))(), /transacao/)
  // FK nunca foi desligado de verdade (pragma ignorado dentro da transacao aberta pelo teste)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  const after = db.prepare('SELECT current_attempt_id, last_executed_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId)
  assert.deepEqual(after, before)
  // tabela nao foi trocada: CHECK antigo continua valendo (nao aceita 'pergunta')
  assert.throws(() => db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 9, 'pergunta')").run(cad), /CHECK/)
})

test('colunas novas, tabela de passos feitos e uma cadencia ativa por etapa', () => {
  const db = createCadenceTestDb()
  const s = seedRoteiroBase(db)
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  for (const c of ['funnel_id', 'stage_id']) assert.ok(cols('cadences').includes(c), c)
  assert.ok(cols('cadence_attempts').includes('question_key'))
  for (const c of ['kind', 'stage_id', 'stage_entry_id']) assert.ok(cols('lead_cadences').includes(c), c)
  assert.ok(cols('roteiro_asks').includes('attempt_id'))
  assert.ok(cols('lead_cadence_steps').includes('how'))
  const ins = db.prepare('INSERT INTO cadences (account_id, name, funnel_id, stage_id, is_active) VALUES (?, ?, ?, ?, ?)')
  ins.run(s.accountId, 'Qualificando', s.funnelId, s.stages.qualificando, 1)
  assert.throws(() => ins.run(s.accountId, 'Outra', s.funnelId, s.stages.qualificando, 1), /UNIQUE/)
  ins.run(s.accountId, 'Antiga', s.funnelId, s.stages.qualificando, 0) // inativa pode
  ins.run(s.accountId, 'Avulsa A', null, null, 1)
  ins.run(s.accountId, 'Avulsa B', null, null, 1) // avulsas sem limite
})

test('reconstrucao falhou: lead_cadence_steps, colunas novas e indices ja existem (reconstrucao roda por ultimo)', () => {
  const { db } = legacyDbWithData()
  const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(r => r.name)
  assert.equal(tables().includes('lead_cadence_steps'), false)
  assert.throws(() => applyCadenceSchema(db, { rebuild: () => { throw new Error('disco cheio') } }), /disco cheio/)
  assert.ok(tables().includes('lead_cadence_steps'))
  assert.ok(tables().includes('idx_lead_cadences_lead_kind'))
  const cols = db.prepare('PRAGMA table_info(lead_cadences)').all().map(c => c.name)
  for (const c of ['kind', 'stage_id', 'stage_entry_id', 'notified_attempt_id']) assert.ok(cols.includes(c), c)
  // a tabela antiga continua recusando 'pergunta' (nada meio trocado)
  assert.equal(db.prepare("SELECT sql FROM sqlite_master WHERE name = 'cadence_attempts'").get().sql.includes("'pergunta'"), false)
  // proxima subida: reconstroi normalmente
  assert.deepEqual(applyCadenceSchema(db), { rebuilt: true, count: 3 })
})

// Revisao semanal do roteiro (spec 2026-10-02 §10): tabela de sugestoes com tipos novos,
// rodada 1x por semana por conta, saneamento e aplicacao.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { saveBusiness } from '../server/services/roteiro/profiles.js'
import { runWeeklyReview } from '../server/services/roteiro/weeklyReview.js'
import { runScoreNightly } from '../server/services/leadScore/nightly.js'

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

// ---------------------------------------------------------------- revisao semanal ----

const DAY = 86400000
const NOW = new Date()

function fakeAi(responses) {
  const calls = []
  return {
    calls,
    isAvailable: () => true,
    call: async params => {
      calls.push(params)
      let item = responses.shift()
      if (typeof item === 'function') item = item(params)
      if (item instanceof Error) throw item
      if (!item) throw new Error('sem resposta falsa')
      return { usage: {}, costUsd: 0, ...item }
    },
  }
}
const review = input => ({ toolUses: [{ id: 't', name: 'propose_review', input }] })

function setup({ conversa = true } = {}) {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja] = saveBusiness(db, s.accountId, { business_objective: 'revender limpeza', profiles: [{ name: 'Loja', description: 'mercadinho' }, { name: 'Porta' }] }).profiles
  saveDraft(db, s.accountId, s.funnelId, { questions: [
    { question_key: 'q1', stage_id: s.stages.qualificando, text: 'Quantos clientes?', kind: 'options', spin: 'situation', profile_key: loja.profile_key, options: [{ label: 'Muitos', points: 10 }, { label: 'Poucos', points: 2 }] },
    { question_key: 'q2', stage_id: s.stages.qualificando, text: 'Conte mais', kind: 'text' },
  ] })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  if (conversa) {
    const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
    for (const [d, c] of [['inbound', 'tenho um atacado grande'], ['outbound', 'legal'], ['inbound', 'vende em caixa fechada?']]) addMessage(db, { leadId: lead, direction: d, content: c })
  }
  return { db, s, loja }
}

const proposta = (s, loja) => ({
  new_questions: [
    { funnel_id: s.funnelId, stage_id: s.stages.qualificando, profile_key: loja.profile_key, spin: 'problem', text: 'O que mais falta na prateleira?', options: [{ label: 'Limpeza pesada', points: 10 }, { label: 'Nada', points: 0 }], reason: 'lojistas reclamam de falta', count: 4 },
    { funnel_id: s.funnelId, stage_id: s.stages.novo, profile_key: 'inventado', spin: 'xx', text: 'Em etapa de contato', options: [{ label: 'a', points: 1 }, { label: 'b', points: 0 }], reason: 'r', count: 1 },
    { funnel_id: s.funnelId, stage_id: s.stages.qualificando, text: 'Sem opcoes', options: [{ label: 'so uma', points: 1 }], reason: 'r', count: 1 },
  ],
  new_profiles: [{ name: 'Atacado', description: 'compra em caixa fechada', reason: 'apareceu', count: 3 }, { name: 'LOJA', description: 'repetido', reason: 'r', count: 1 }],
  new_options: [{ question_key: 'q1', label: 'Mais de 100', count: 5 }, { question_key: 'q2', label: 'texto livre', count: 2 }, { question_key: 'q1', label: 'muitos', count: 2 }],
  rewrites: [{ question_key: 'q1', versions: ['Quantas pessoas passam na loja por dia?', 'Sua loja tem muito movimento?'], reason: 'pouca resposta' }, { question_key: 'q2', versions: ['so uma'], reason: 'r' }],
})

test('revisao semanal: chama a IA 1x, grava sugestoes saneadas, registra a rodada e espera 7 dias', async () => {
  const { db, s, loja } = setup()
  let prompt = ''
  const ai = fakeAi([p => { prompt = p.messages[0].content; assert.equal(p.source, 'roteiro_weekly'); return review(proposta(s, loja)) }, review({})])
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai, now: NOW })
  assert.deepEqual(r, { ran: true, created: 5 })
  assert.match(prompt, /tenho um atacado grande/); assert.match(prompt, /Quantos clientes\?/); assert.match(prompt, /revender limpeza/)
  const rows = db.prepare('SELECT type, funnel_id, question_key, payload_json, evidence_json FROM roteiro_suggestions ORDER BY id').all()
  const by = t => rows.filter(x => x.type === t).map(x => ({ ...x, payload: JSON.parse(x.payload_json), evidence: JSON.parse(x.evidence_json) }))
  const qs = by('new_question')
  assert.equal(qs.length, 2)
  assert.deepEqual([qs[0].payload.text, qs[0].payload.profile_key, qs[0].payload.profile_name, qs[0].payload.spin, qs[0].payload.stage_name, qs[0].funnel_id],
    ['O que mais falta na prateleira?', loja.profile_key, 'Loja', 'problem', 'Qualificando', s.funnelId])
  assert.deepEqual([qs[1].payload.stage_id, qs[1].payload.profile_key, qs[1].payload.spin], [s.stages.qualificando, null, null]) // contato -> 1a de conversa
  assert.deepEqual(qs[0].evidence, { source: 'weekly', reason: 'lojistas reclamam de falta', count: 4 })
  assert.deepEqual(by('new_profile').map(x => x.payload), [{ name: 'Atacado', description: 'compra em caixa fechada' }])
  assert.deepEqual(by('new_option').map(x => [x.question_key, x.payload.label, x.payload.count]), [['q1', 'Mais de 100', 5]])
  assert.deepEqual(by('rewrite').map(x => [x.question_key, x.payload.versions.length]), [['q1', 2]])
  assert.ok(db.prepare('SELECT ran_at FROM roteiro_weekly_runs WHERE account_id = ?').get(s.accountId))
  assert.deepEqual(await runWeeklyReview(db, { accountId: s.accountId, ai, now: new Date(NOW.getTime() + 2 * DAY) }), { ran: false, created: 0 })
  assert.equal(ai.calls.length, 1)
  db.prepare("UPDATE messages SET created_at = datetime(created_at, '+8 days')").run() // conversa na semana nova
  const again = await runWeeklyReview(db, { accountId: s.accountId, ai, now: new Date(NOW.getTime() + 8 * DAY) })
  assert.equal(again.ran, true)
  assert.equal(ai.calls.length, 2)
})

test('revisao semanal: nao duplica sugestao ainda sem decisao', async () => {
  const { db, s, loja } = setup()
  await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review(proposta(s, loja))]), now: NOW })
  db.prepare("UPDATE messages SET created_at = datetime(created_at, '+8 days')").run()
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review(proposta(s, loja))]), now: new Date(NOW.getTime() + 8 * DAY) })
  assert.equal(r.created, 0)
})

test('revisao semanal: sem IA, sem roteiro publicado ou sem conversa na semana nao chama a IA', async () => {
  const { db, s } = setup({ conversa: false })
  assert.deepEqual(await runWeeklyReview(db, { accountId: s.accountId, ai: null, now: NOW }), { ran: false, created: 0 })
  const ai = fakeAi([])
  assert.deepEqual(await runWeeklyReview(db, { accountId: s.accountId, ai, now: NOW }), { ran: true, created: 0 }) // sem conversa: registra
  assert.equal(ai.calls.length, 0)
  assert.ok(db.prepare('SELECT 1 FROM roteiro_weekly_runs WHERE account_id = ?').get(s.accountId))
  assert.deepEqual(await runWeeklyReview(db, { accountId: s.otherAccountId, ai, now: NOW }), { ran: false, created: 0 }) // sem roteiro
})

test('revisao semanal: IA falhando registra a rodada e nao grava nada', async (t) => {
  t.mock.method(console, 'error', () => {})
  const { db, s } = setup()
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([new Error('529')]), now: NOW })
  assert.deepEqual(r, { ran: true, created: 0 })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roteiro_suggestions').get().n, 0)
})

test('noturno roda a revisao semanal e soma as sugestoes', async () => {
  const { db, s } = setup()
  const ai = fakeAi([review({ new_profiles: [{ name: 'Atacado', description: 'caixa fechada', reason: 'r', count: 2 }] })])
  // runLearning com IA tambem chama a IA (aprendizado diario): responde vazio para qualquer outra fonte
  const wrapped = { ...ai, call: async p => (p.source === 'roteiro_weekly' ? ai.call(p) : { toolUses: [], usage: {}, costUsd: 0 }) }
  const totals = await runScoreNightly(db, { now: NOW, aiForAccount: id => (id === s.accountId ? wrapped : null) })
  assert.equal(ai.calls.length, 1)
  assert.ok(totals.suggestions >= 1)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM roteiro_suggestions WHERE type = 'new_profile'").get().n, 1)
})

test('toda fonte de IA do roteiro conta no teto do roteiro', async () => {
  const fs = await import('node:fs')
  const { ROTEIRO_SOURCES } = await import('../server/services/aiBudget.js')
  const dir = new URL('../server/services/roteiro/', import.meta.url)
  const found = new Set()
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8')
    for (const m of src.matchAll(/source: '(roteiro_[a-z_]+)'/g)) found.add(m[1])
  }
  assert.ok(found.has('roteiro_weekly') && found.has('roteiro_profiles'))
  for (const s of found) assert.ok(ROTEIRO_SOURCES.includes(s), `${s} fora do teto do roteiro`)
})

test('revisao semanal: sugestao ignorada nos ultimos 90 dias nao volta', async () => {
  const { db, s, loja } = setup()
  await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review(proposta(s, loja))]), now: NOW })
  db.prepare("UPDATE roteiro_suggestions SET status = 'rejected', decided_at = datetime('now')").run()
  db.prepare("UPDATE messages SET created_at = datetime(created_at, '+8 days')").run()
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review(proposta(s, loja))]), now: new Date(NOW.getTime() + 8 * DAY) })
  assert.equal(r.created, 0)
})

test('revisao semanal: perfis novos so ate completar 6', async () => {
  const { db, s, loja } = setup() // ja tem 2 perfis
  saveBusiness(db, s.accountId, { profiles: db.prepare('SELECT profile_key, name FROM roteiro_profiles WHERE account_id = ? ORDER BY position').all(s.accountId).concat([{ name: 'P3' }, { name: 'P4' }, { name: 'P5' }]) })
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review({ new_profiles: [{ name: 'A1' }, { name: 'A2' }, { name: 'A3' }] })]), now: NOW })
  assert.equal(r.created, 1)
  assert.ok(loja)
})

test('revisao semanal: nao sugere reescrita de pergunta em teste A/B', async () => {
  const { db, s } = setup()
  db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, 'q1', 'versao B', 'testing')").run(s.accountId)
  const r = await runWeeklyReview(db, { accountId: s.accountId, ai: fakeAi([review({ rewrites: [{ question_key: 'q1', versions: ['a', 'b'], reason: 'r' }] })]), now: NOW })
  assert.equal(r.created, 0)
})

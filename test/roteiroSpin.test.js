// SPIN no lugar do BANT (spec 2026-10-02 §4, §7): migracao, campos novos, modelo e etapa de contato.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'
import { saveDraft, publish, createSpinDraft, restoreVersion } from '../server/services/roteiro/repo.js'
import { SPIN_QUESTIONS, SPIN_KEYS } from '../server/services/roteiro/spinTemplate.js'
import { isContactStage, conversationStages } from '../server/services/roteiro/stageKind.js'

const opts = [{ label: 'A', points: 5 }, { label: 'B', points: 0 }]

test('migracao bant -> spin: 4 mapeamentos e idempotente', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'text' }] })
  const v = db.prepare('SELECT id FROM roteiro_versions LIMIT 1').get().id
  const ins = db.prepare("INSERT INTO roteiro_questions (version_id, account_id, question_key, stage_id, text, kind, bant) VALUES (?, ?, ?, ?, 'x', 'text', ?)")
  for (const b of ['need', 'timeline', 'authority', 'budget']) ins.run(v, s.accountId, b, s.stages.qualificando, b)
  applyRoteiroSchema(db); applyRoteiroSchema(db)
  const got = Object.fromEntries(db.prepare('SELECT question_key, spin FROM roteiro_questions WHERE bant IS NOT NULL').all().map(r => [r.question_key, r.spin]))
  assert.deepEqual(got, { need: 'problem', timeline: 'situation', authority: 'situation', budget: 'need_payoff' })
})

test('pergunta guarda spin, profile_key e sets_profile_key; recusa fase e perfil invalidos', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'loja', 'Loja', 0)").run(s.accountId)
  const d = saveDraft(db, s.accountId, s.funnelId, { questions: [
    { stage_id: s.stages.qualificando, text: 'Tem loja?', kind: 'options', spin: 'situation', options: [{ label: 'Sim', points: 5, sets_profile_key: 'loja' }, { label: 'Não', points: 0, sets_profile_key: 'xx' }] },
    { stage_id: s.stages.qualificando, text: 'Dói?', kind: 'options', spin: 'problem', profile_key: 'loja', options: opts },
  ] })
  assert.equal(d.questions[0].spin, 'situation')
  assert.equal(d.questions[0].options[0].sets_profile_key, 'loja')
  assert.equal(d.questions[0].options[1].sets_profile_key, null) // perfil inexistente na opcao e descartado
  assert.equal(d.questions[1].profile_key, 'loja')
  assert.equal('bant' in d.questions[0], false)
  assert.throws(() => saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'x', kind: 'text', spin: 'budget' }] }), /Fase SPIN inválida/)
  assert.throws(() => saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'x', kind: 'text', profile_key: 'nao' }] }), /Tipo de cliente inválido/)
  // perfil de outra conta tambem e invalido
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'outra', 'Outra', 0)").run(s.otherAccountId)
  assert.throws(() => saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'x', kind: 'text', profile_key: 'outra' }] }), /Tipo de cliente inválido/)
})

test('restaurar versao com perfil que nao existe mais vira Todos', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'loja', 'Loja', 0)").run(s.accountId)
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'options', profile_key: 'loja', options: [{ label: 'a', points: 1, sets_profile_key: 'loja' }, { label: 'b', points: 0 }] }] })
  const v1 = publish(db, s.accountId, s.funnelId, s.gerenteId)
  saveDraft(db, s.accountId, s.funnelId, { questions: [] }); publish(db, s.accountId, s.funnelId, s.gerenteId)
  db.prepare('DELETE FROM roteiro_profiles').run()
  const d = restoreVersion(db, s.accountId, v1.id)
  assert.equal(d.questions[0].profile_key, null)
  assert.equal(d.questions[0].options[0].sets_profile_key, null)
})

test('modelo SPIN: 6 perguntas de opcoes, ordem S-P-P-I-I-N; createSpinDraft soma so fases que faltam na 1a etapa de conversa', () => {
  assert.deepEqual(SPIN_QUESTIONS.map(q => q.spin), ['situation', 'problem', 'problem', 'implication', 'implication', 'need_payoff'])
  assert.ok(SPIN_QUESTIONS.every(q => q.kind === 'options' && q.required))
  assert.deepEqual(SPIN_KEYS, ['situation', 'problem', 'implication', 'need_payoff'])
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db) // etapas: Novo (contato), Qualificando, Proposta, Venda, Perdido
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.proposta, text: 'Como faz hoje?', kind: 'options', spin: 'situation', options: opts }] })
  const d = createSpinDraft(db, s.accountId, s.funnelId)
  const added = d.questions.filter(q => q.stage_id === s.stages.qualificando)
  assert.deepEqual(added.map(q => q.spin), ['problem', 'problem', 'implication', 'implication', 'need_payoff'])
})

test('stageKind: etapa de contato pelo nome; conversa = nao finais e nao contato', () => {
  const st = (name, is_terminal = false) => ({ name, is_terminal })
  assert.equal(isContactStage(st('Novo Lead')), true)
  assert.equal(isContactStage(st('Contato Feito')), true)
  assert.equal(isContactStage(st('Tentativa 2')), true)
  assert.equal(isContactStage(st('Prospecção')), true)
  assert.equal(isContactStage(st('Entrada')), true)
  assert.equal(isContactStage(st('Atendimento')), false)
  assert.equal(isContactStage(st('Novo cliente', true)), false)
  const all = [st('Novo'), st('Atendimento'), st('Proposta'), st('Venda', true)]
  assert.deepEqual(conversationStages(all).map(s => s.name), ['Atendimento', 'Proposta'])
  assert.deepEqual(conversationStages([st('Novo'), st('Venda', true)]).map(s => s.name), ['Novo'])
})

test('pergunta de um perfil nao define perfil pelas opcoes (sets_profile_key some)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'loja', 'Loja', 0), (?, 'porta', 'Porta', 1)").run(s.accountId, s.accountId)
  const d = saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'options', profile_key: 'loja',
    options: [{ label: 'a', points: 1, sets_profile_key: 'porta' }, { label: 'b', points: 0 }] }] })
  assert.equal(d.questions[0].options[0].sets_profile_key, null)
})

// Perfis de cliente ideal da conta e perfil do lead (spec 2026-10-02 §4-§6).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft } from '../server/services/roteiro/repo.js'
import { appliesToLead, getBusiness, saveBusiness, effectiveProfileKey, setLeadProfile, leadProfileView } from '../server/services/roteiro/profiles.js'

const two = [{ name: 'Loja', description: 'mercadinho, comércio' }, { name: 'Vendedor porta a porta', description: 'renda extra' }]

test('appliesToLead: Todos vale sempre; perfil so para o mesmo perfil', () => {
  assert.equal(appliesToLead({ profile_key: null }, null), true)
  assert.equal(appliesToLead({ profile_key: 'a' }, null), false)
  assert.equal(appliesToLead({ profile_key: 'a' }, 'a'), true)
  assert.equal(appliesToLead({ profile_key: 'a' }, 'b'), false)
})

test('saveBusiness: grava objetivo e perfis, gera chave estavel, limites', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const b = saveBusiness(db, s.accountId, { business_objective: 'revender produtos de limpeza', profiles: two })
  assert.equal(b.business_objective, 'revender produtos de limpeza')
  assert.deepEqual(b.profiles.map(p => p.name), ['Loja', 'Vendedor porta a porta'])
  const key = b.profiles[0].profile_key
  const b2 = saveBusiness(db, s.accountId, { business_objective: 'x', profiles: [{ profile_key: key, name: 'Lojas', description: '' }] })
  assert.equal(b2.profiles[0].profile_key, key)
  assert.equal(b2.profiles[0].name, 'Lojas')
  assert.equal(b2.profiles.length, 1)
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: Array.from({ length: 7 }, (_, i) => ({ name: `P${i}` })) }), /Máximo de 6 tipos de cliente/)
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: [{ name: '' }] }), /nome/i)
  assert.throws(() => saveBusiness(db, s.accountId, { business_objective: 'x'.repeat(301), profiles: [] }), /300/)
  assert.equal(getBusiness(db, s.otherAccountId).profiles.length, 0) // isolado por conta
})

test('apagar perfil usado por pergunta (rascunho ou publicada) e recusado; leads com perfil apagado voltam a NULL', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: two }).profiles
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'text', profile_key: loja.profile_key }] })
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: [porta] }), /Este tipo de cliente tem perguntas/)
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: porta.profile_key, origin: 'manual' })
  saveBusiness(db, s.accountId, { profiles: [loja] })
  assert.equal(db.prepare('SELECT roteiro_profile_key k FROM leads WHERE id = ?').get(lead).k, null)
})

test('apagar perfil citado so numa opcao (define o perfil) tambem e recusado', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: two }).profiles
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'Tem loja?', kind: 'options',
    options: [{ label: 'Sim', points: 1, sets_profile_key: loja.profile_key }, { label: 'Não', points: 0 }] }] })
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: [porta] }), /Este tipo de cliente tem perguntas/)
})

test('setLeadProfile: IA nao troca manual; perfil invalido e recusado; manual aceita null', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: two }).profiles
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  assert.equal(setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: loja.profile_key, origin: 'ia' }).changed, true)
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: porta.profile_key, origin: 'manual' })
  assert.equal(setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: loja.profile_key, origin: 'ia' }).changed, false)
  assert.throws(() => setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: 'zz', origin: 'manual' }), /Tipo de cliente inválido/)
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: null, origin: 'manual' })
  const v = leadProfileView(db, { accountId: s.accountId, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(lead) })
  assert.equal(v.profile_key, null); assert.equal(v.profiles.length, 2)
  assert.throws(() => setLeadProfile(db, { accountId: s.otherAccountId, leadId: lead, profileKey: null, origin: 'manual' }), /Lead não encontrado/)
})

test('perfil efetivo: com 1 perfil na conta, lead sem perfil usa o unico', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  const row = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(lead)
  assert.equal(effectiveProfileKey(db, row()), null)
  const [only] = saveBusiness(db, s.accountId, { profiles: [two[0]] }).profiles
  assert.equal(effectiveProfileKey(db, row()), only.profile_key)
  saveBusiness(db, s.accountId, { profiles: [only, two[1]] })
  assert.equal(effectiveProfileKey(db, row()), only.profile_key) // herdou o perfil unico ao ganhar o 2o
  const novo = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  assert.equal(effectiveProfileKey(db, db.prepare('SELECT * FROM leads WHERE id = ?').get(novo)), null) // lead novo com 2 perfis: ainda nao sabe
})

test('passar de 1 para 2 perfis: leads sem perfil gravado ficam com o perfil unico de antes', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja] = saveBusiness(db, s.accountId, { profiles: [two[0]] }).profiles
  const semPerfil = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  const outraConta = addLead(db, { account_id: s.otherAccountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  const arquivado = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, is_archived: 1 })
  const [, porta] = saveBusiness(db, s.accountId, { profiles: [loja, two[1]] }).profiles
  const row = id => db.prepare('SELECT roteiro_profile_key k, roteiro_profile_origin o FROM leads WHERE id = ?').get(id)
  assert.deepEqual(row(semPerfil), { k: loja.profile_key, o: 'herdado' })
  assert.equal(row(arquivado).k, null) // so leads ativos herdam
  // IA pode trocar um perfil herdado (nao foi escolha de ninguem)
  assert.equal(setLeadProfile(db, { accountId: s.accountId, leadId: semPerfil, profileKey: porta.profile_key, origin: 'ia' }).changed, true)
  assert.deepEqual(row(outraConta), { k: null, o: null })
})

test('perfil unico trocado por outro (o antigo sai): ninguem herda o perfil apagado', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  saveBusiness(db, s.accountId, { profiles: [two[0]] })
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  saveBusiness(db, s.accountId, { profiles: [two[1], { name: 'Atacado' }] })
  assert.equal(db.prepare('SELECT roteiro_profile_key k FROM leads WHERE id = ?').get(lead).k, null)
})

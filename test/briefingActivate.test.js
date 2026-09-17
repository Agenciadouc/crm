import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, setCompiled, addTurn } from '../server/services/briefingStore.js'
import { activateBriefing } from '../server/services/briefingActivate.js'

// Nota: setCompiled mantem o status 'ativo' quando o briefing ja foi ativado,
// e e por isso que a segunda ativacao cai no caminho de ATUALIZAR o agente.

const COMPILADO = {
  name: 'Ana Clara',
  persona: 'Cordial.',
  knowledge_base: 'Vende curso de ingles.',
  never_mention: 'preco',
  qualification_criteria: 'nome e cidade',
  required_fields: ['name', 'city'],
  resumo: { quem_sou: 'a', o_que_sei: 'b', o_que_descubro: ['c'], o_que_nunca_falo: ['d'] },
}

function comBriefingCompilado() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  return { db, accountId, briefingId }
}

test('REGRA DE SEGURANCA: rascunho nao cria linha em ai_agents', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes,
    'entrevistar e compilar NAO podem criar agente')
})

test('ativar cria o agente com os campos compilados e amarra o briefing', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'copilot' })
  assert.equal(r.ok, true)

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.name, 'Ana Clara')
  assert.equal(a.persona, 'Cordial.')
  assert.equal(a.knowledge_base, 'Vende curso de ingles.')
  assert.equal(a.never_mention, 'preco')
  assert.equal(a.qualification_criteria, 'nome e cidade')
  assert.deepEqual(JSON.parse(a.required_fields), ['name', 'city'])
  assert.equal(a.mode, 'copilot')
  assert.equal(a.account_id, accountId)

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, r.agentId)
})

test('o modo pedido e respeitado', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'auto' })
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(r.agentId).mode, 'auto')
})

test('briefing ainda em entrevista nao ativa', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_compilado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('ativar briefing JA ativo atualiza o agente existente, nao cria outro', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const primeira = activateBriefing(db, { accountId, briefingId })
  const totalDepoisDaPrimeira = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c

  // simula o "Corrigir algo": recompila com conteudo novo e ativa de novo
  setCompiled(db, { accountId, briefingId, compiled: { ...COMPILADO, persona: 'Bem mais informal.', never_mention: 'nada' } })
  const segunda = activateBriefing(db, { accountId, briefingId })

  assert.equal(segunda.ok, true)
  assert.equal(segunda.agentId, primeira.agentId, 'tem que ser o MESMO agente')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, totalDepoisDaPrimeira, 'nao pode criar agente novo')

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(primeira.agentId)
  assert.equal(a.persona, 'Bem mais informal.')
  assert.equal(a.never_mention, 'nada')
})

test('atualizar agente existente nao mexe no modo nem no is_active', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'auto' })
  db.prepare('UPDATE ai_agents SET is_active = 0 WHERE id = ?').run(r.agentId)

  setCompiled(db, { accountId, briefingId, compiled: { ...COMPILADO, persona: 'Outra.' } })
  activateBriefing(db, { accountId, briefingId, mode: 'copilot' })

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.persona, 'Outra.', 'o conteudo atualiza')
  assert.equal(a.mode, 'auto', 'o modo escolhido antes NAO pode ser sobrescrito pela correcao')
  assert.equal(a.is_active, 0, 'agente desligado nao pode religar sozinho')
})

test('briefing de outra conta nao ativa', () => {
  const { db, briefingId } = comBriefingCompilado()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId: outra, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_encontrado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('compiled_json corrompido nao cria agente', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  db.prepare('UPDATE agent_briefings SET compiled_json = ? WHERE id = ?').run('{quebrado', briefingId)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'compilado_invalido')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead, seedContaCompleta } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, setCompiled, addTurn } from '../server/services/briefingStore.js'
import { activateBriefing, resolveOndeAtende } from '../server/services/briefingActivate.js'

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

// Conta com funil padrao e instancia: sem isso a ativacao recusa (agente surdo).
function comBriefingCompilado() {
  const db = createTestDb()
  const { accountId, userId } = seedContaCompleta(db)
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

// Conserto 1 (rodada de conserto 1/5): linkAgent devolve false quando o
// briefing desaparece entre o getBriefing do topo e a propria chamada de
// linkAgent. Sem o throw, activateBriefing devolveria {ok:true} com um agente
// is_active=1 no ar e nenhum briefing amarrado a ele. Forcamos o desaparecimento
// com um trigger real do SQLite (nao um mock de funcao) disparado no exato
// instante em que createAgentRecord insere o agente, reproduzindo a janela
// entre o INSERT do agente e a chamada de linkAgent.
test('briefing desaparecendo entre criar o agente e linkAgent desfaz o agente e o usuario-bot', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()

  db.exec(`
    CREATE TRIGGER apaga_briefing_no_meio AFTER INSERT ON ai_agents
    BEGIN
      DELETE FROM agent_briefings WHERE id = ${briefingId};
    END;
  `)

  const antesAgentes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const antesUsuarios = db.prepare('SELECT COUNT(*) c FROM users').get().c

  let r
  try {
    r = activateBriefing(db, { accountId, briefingId })
  } finally {
    db.exec('DROP TRIGGER apaga_briefing_no_meio')
  }

  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_desapareceu')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antesAgentes,
    'agente criado nao pode sobrar quando o briefing desaparece antes do linkAgent')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, antesUsuarios,
    'usuario-bot criado nao pode sobrar quando o briefing desaparece antes do linkAgent')
})

// Conserto 2, item 1: JSON valido mas que reprova validateCompiled (sem a
// chave resumo) e um portao diferente do JSON malformado ja testado acima.
test('compiled_json valido mas que reprova validateCompiled nao cria agente', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const semResumo = { ...COMPILADO }
  delete semResumo.resumo
  db.prepare('UPDATE agent_briefings SET compiled_json = ? WHERE id = ?').run(JSON.stringify(semResumo), briefingId)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'compilado_invalido')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

// Conserto 2, item 2: compiled_json NULL. JSON.parse(null) nao lanca (parseia
// o literal "null"), entao esse caminho passa pelo mesmo portao de
// validateCompiled do teste acima, nao pelo catch do JSON.parse.
test('compiled_json NULL nao cria agente', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  db.prepare('UPDATE agent_briefings SET compiled_json = NULL WHERE id = ?').run(briefingId)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'compilado_invalido')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

// Conserto 2, item 3: prova o rollback do aninhamento com uma falha genuina do
// motor, sem mock. idx_agent_briefings_agente e unico em agent_id. Ocupamos
// com antecedencia, num OUTRO briefing, o id que o PROXIMO agente criado vai
// receber (previsivel porque nada mais insere em ai_agents entre a leitura do
// MAX(id) e a chamada de activateBriefing); quando linkAgent tentar gravar
// esse mesmo id no briefing alvo, o UPDATE colide com o indice unico e lanca
// de verdade. O agente e o usuario-bot criados dentro da transacao de fora
// tem que desaparecer junto com o rollback.
test('rollback do aninhamento: indice unico ocupado desfaz agente e usuario-bot', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()

  const proximoAgentId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM ai_agents').get().n
  const outroBriefingId = createBriefing(db, { accountId, userId: null })
  db.pragma('foreign_keys = OFF')
  db.prepare('UPDATE agent_briefings SET agent_id = ? WHERE id = ?').run(proximoAgentId, outroBriefingId)
  db.pragma('foreign_keys = ON')

  const antesAgentes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const antesUsuarios = db.prepare('SELECT COUNT(*) c FROM users').get().c

  const r = activateBriefing(db, { accountId, briefingId })

  assert.equal(r.ok, false, 'linkAgent tem que falhar por causa do indice unico ja ocupado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antesAgentes,
    'agente criado dentro da transacao nao pode sobrar depois do rollback')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, antesUsuarios,
    'usuario-bot criado dentro da transacao nao pode sobrar depois do rollback')

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.status, 'compilado', 'briefing alvo nao pode ficar marcado como ativo')
  assert.equal(b.agent_id, null)
})

// ---- onde o agente atende (I1) -------------------------------------------
// Defeito que estes testes cobrem: a ativacao criava o agente sem nenhuma linha
// em ai_agent_stages nem em ai_agent_instances. O findAgentForLead (aiAgent.js)
// PULA agente sem etapa e sem instancia, entao a pessoa via "Atendimento
// ligado" e o agente nunca respondia nada.

function comFunilEInstancias() {
  const db = createTestDb()
  const { accountId, userId, stageIds, instanceId } = seedContaCompleta(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  return { db, accountId, briefingId, stageIds, instanceId }
}

test('ativar amarra TODAS as etapas do funil padrao e TODAS as instancias da conta', () => {
  const { db, accountId, briefingId, stageIds, instanceId } = comFunilEInstancias()
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, true)

  const etapas = db.prepare('SELECT stage_id FROM ai_agent_stages WHERE agent_id = ? ORDER BY stage_id').all(r.agentId).map(x => x.stage_id)
  assert.deepEqual(etapas, [...stageIds].sort((a, b) => a - b))
  const instancias = db.prepare('SELECT instance_id FROM ai_agent_instances WHERE agent_id = ?').all(r.agentId).map(x => x.instance_id)
  assert.deepEqual(instancias, [instanceId])
})

test('etapa de funil de OUTRA conta nunca entra', () => {
  const { db, accountId, briefingId } = comFunilEInstancias()
  const outra = seedContaCompleta(db, { accountName: 'Outra' })
  const r = activateBriefing(db, { accountId, briefingId })

  const etapas = db.prepare('SELECT stage_id FROM ai_agent_stages WHERE agent_id = ?').all(r.agentId).map(x => x.stage_id)
  for (const sid of outra.stageIds) assert.ok(!etapas.includes(sid), 'etapa de outra conta nao pode ser amarrada')
  const instancias = db.prepare('SELECT instance_id FROM ai_agent_instances WHERE agent_id = ?').all(r.agentId).map(x => x.instance_id)
  assert.ok(!instancias.includes(outra.instanceId))
})

test('instance_ids explicito manda mais que o padrao de amarrar todas', () => {
  const { db, accountId, briefingId, instanceId } = comFunilEInstancias()
  const outraLinha = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'linha-2', 'connected')").run(accountId).lastInsertRowid)
  const r = activateBriefing(db, { accountId, briefingId, instanceIds: [outraLinha] })
  const instancias = db.prepare('SELECT instance_id FROM ai_agent_instances WHERE agent_id = ?').all(r.agentId).map(x => x.instance_id)
  assert.deepEqual(instancias, [outraLinha])
  assert.ok(!instancias.includes(instanceId))
})

// Conta sem numero ou sem funil: ativar criaria um agente surdo, que aparece
// como "Atendimento ligado" e nunca responde. Recusa antes de criar qualquer coisa.
function semAmarracao({ comInstancia = false, comFunil = false } = {}) {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  if (comInstancia) {
    db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'linha-1', 'connected')").run(accountId)
  }
  if (comFunil) {
    const f = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil', 1, 1)").run(accountId).lastInsertRowid)
    db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Novo', 0)").run(f)
  }
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  return { db, accountId, briefingId }
}

test('conta sem instancia de WhatsApp nao ativa (sem_instancia)', () => {
  const { db, accountId, briefingId } = semAmarracao({ comFunil: true })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'sem_instancia')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('conta sem etapa de funil nao ativa (sem_etapa)', () => {
  const { db, accountId, briefingId } = semAmarracao({ comInstancia: true })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'sem_etapa')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('instance_ids explicito dispensa a checagem de instancia da conta', () => {
  const { db, accountId, briefingId } = semAmarracao({ comFunil: true })
  // Instancia criada depois do seed: a checagem padrao olharia a conta, mas o
  // pedido ja diz qual numero usar.
  const linha = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'linha-x', 'connected')").run(accountId).lastInsertRowid)
  const r = activateBriefing(db, { accountId, briefingId, instanceIds: [linha] })
  assert.equal(r.ok, true)
})

// ---- compilado desatualizado (C1) ------------------------------------------

test('briefing corrigido depois de compilar nao ativa (briefing_desatualizado)', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  addTurn(db, { accountId, briefingId, role: 'user', content: 'pode falar o preco sim' })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_desatualizado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('correcao de agente ativo tambem exige recompilar antes', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const primeira = activateBriefing(db, { accountId, briefingId })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'mais informal' })
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_desatualizado')
  assert.equal(db.prepare('SELECT persona FROM ai_agents WHERE id = ?').get(primeira.agentId).persona, 'Cordial.')
})

test('compilar e ativar deixa o briefing em dia; turno novo volta a pedir recompilar', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  // Carimbos no passado: prova que ativar nao mexe em updated_at sem depender do relogio.
  db.prepare("UPDATE agent_briefings SET updated_at = '2020-01-01 00:00:00', compiled_at = '2020-01-01 00:00:00' WHERE id = ?").run(briefingId)
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, true)
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 0)

  addTurn(db, { accountId, briefingId, role: 'user', content: 'mais uma coisa' })
  assert.equal(getBriefing(db, accountId, briefingId).precisa_recompilar, 1)
})

test('resolveOndeAtende mostra o padrao antes de existir agente e o real depois', () => {
  const { db, accountId, briefingId } = comFunilEInstancias()
  const antes = resolveOndeAtende(db, { accountId, agentId: null })
  assert.deepEqual(antes.etapas, ['Novo', 'Em atendimento'])
  assert.equal(antes.instancias.length, 1)

  const r = activateBriefing(db, { accountId, briefingId })
  const depois = resolveOndeAtende(db, { accountId, agentId: r.agentId })
  assert.deepEqual([...depois.etapas].sort(), ['Em atendimento', 'Novo'])
  assert.deepEqual(depois.instancias, antes.instancias)
})

test('resolveOndeAtende nao mostra agente de outra conta', () => {
  const { db, accountId, briefingId } = comFunilEInstancias()
  const r = activateBriefing(db, { accountId, briefingId })
  const outra = seedContaCompleta(db, { accountName: 'Outra' })
  const visto = resolveOndeAtende(db, { accountId: outra.accountId, agentId: r.agentId })
  assert.deepEqual(visto.etapas, ['Novo', 'Em atendimento'], 'cai no padrao da propria conta, nao no agente alheio')
})

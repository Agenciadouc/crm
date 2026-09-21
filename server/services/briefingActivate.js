// A UNICA transicao que cria o agente. Enquanto o briefing e rascunho ou esta so
// compilado, os campos vivem em agent_briefings.compiled_json e NAO em ai_agents:
// qualquer linha em ai_agents com is_active=1 e varrida pelo processInboundMessage
// e comeca a responder lead de verdade.

import { getBriefing, linkAgent, precisaRecompilar } from './briefingStore.js'
import { createAgentRecord } from './agentCreate.js'
import { validateCompiled } from './agentCompiler.js'

// O agente so responde lead que estiver numa etapa amarrada em ai_agent_stages
// e (quando a mensagem chega por WhatsApp) numa instancia amarrada em
// ai_agent_instances — ver findAgentForLead em aiAgent.js. Nascer sem nenhuma
// das duas significa nascer surdo: a pessoa ve "Atendimento ligado" e o agente
// nunca responde nada.
//
// Decisao (entrevista): amarrar TODAS as etapas do funil padrao da conta e
// TODAS as instancias da conta. O agente nasce em Copiloto, que so SUGERE a
// resposta no Chat e nunca envia sozinho, entao amarrar demais custa no maximo
// um card de sugestao a mais — nunca uma mensagem indevida para um lead.
export function etapasPadraoDaConta(db, accountId) {
  const funil = db.prepare(
    'SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1 ORDER BY id LIMIT 1'
  ).get(accountId)
  // Conta sem funil marcado como padrao (base antiga): pega as etapas de todos
  // os funis ativos dela, em vez de deixar o agente sem etapa nenhuma.
  const rows = funil
    ? db.prepare('SELECT id, name FROM funnel_stages WHERE funnel_id = ? ORDER BY position, id').all(funil.id)
    : db.prepare(`
        SELECT s.id, s.name FROM funnel_stages s
          JOIN funnels f ON f.id = s.funnel_id
         WHERE f.account_id = ? AND f.is_active = 1
         ORDER BY s.funnel_id, s.position, s.id
      `).all(accountId)
  return rows
}

export function instanciasDaConta(db, accountId) {
  return db.prepare(
    'SELECT id, instance_name FROM whatsapp_instances WHERE account_id = ? ORDER BY id'
  ).all(accountId)
}

// O que a tela de resumo mostra em "Onde eu atendo". Briefing que ja virou
// agente mostra o que o agente TEM amarrado; briefing novo mostra o que a
// ativacao VAI amarrar.
export function resolveOndeAtende(db, { accountId, agentId = null }) {
  if (agentId) {
    const dono = db.prepare('SELECT 1 FROM ai_agents WHERE id = ? AND account_id = ?').get(agentId, accountId)
    if (dono) {
      const etapas = db.prepare(`
        SELECT s.name FROM ai_agent_stages a
          JOIN funnel_stages s ON s.id = a.stage_id
         WHERE a.agent_id = ?
      `).all(agentId).map(r => r.name)
      const instancias = db.prepare(`
        SELECT i.instance_name FROM ai_agent_instances a
          JOIN whatsapp_instances i ON i.id = a.instance_id
         WHERE a.agent_id = ? AND i.account_id = ?
      `).all(agentId, accountId).map(r => r.instance_name)
      return { etapas, instancias }
    }
  }
  return {
    etapas: etapasPadraoDaConta(db, accountId).map(r => r.name),
    instancias: instanciasDaConta(db, accountId).map(r => r.instance_name),
  }
}

// Atualiza SO o conteudo que a entrevista produz. Nao toca em mode, is_active,
// instancias, etapas nem handoff: isso e configuracao que a pessoa ja escolheu,
// e uma correcao de texto nao pode religar um agente desligado.
function updateAgentContent(db, { accountId, agentId, c }) {
  const r = db.prepare(`
    UPDATE ai_agents
       SET persona = ?, knowledge_base = ?, never_mention = ?,
           qualification_criteria = ?, required_fields = ?,
           updated_at = datetime('now')
     WHERE id = ? AND account_id = ?
  `).run(
    c.persona, c.knowledge_base, c.never_mention,
    c.qualification_criteria, JSON.stringify(c.required_fields),
    agentId, accountId
  )
  return r.changes > 0
}

export function activateBriefing(db, { accountId, briefingId, mode = 'copilot', instanceIds = [] }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }
  if (briefing.status !== 'compilado' && briefing.status !== 'ativo') {
    return { ok: false, error: 'briefing_nao_compilado' }
  }

  let compiled
  try {
    compiled = JSON.parse(briefing.compiled_json)
  } catch {
    return { ok: false, error: 'compilado_invalido' }
  }
  const check = validateCompiled(compiled)
  if (!check.ok) return { ok: false, error: 'compilado_invalido' }
  const c = check.value

  // Correcao gravada depois da ultima compilacao: ativar agora poria no ar o
  // resumo VELHO, sem a correcao. Tem que recompilar antes.
  if (precisaRecompilar(briefing)) return { ok: false, error: 'briefing_desatualizado' }

  // Briefing ja ativo = correcao de um agente que existe. Atualiza, nao duplica.
  if (briefing.status === 'ativo' && briefing.agent_id) {
    if (!updateAgentContent(db, { accountId, agentId: briefing.agent_id, c })) {
      return { ok: false, error: 'agente_nao_encontrado' }
    }
    return { ok: true, agentId: briefing.agent_id }
  }

  // instanceIds vazio (o caso normal, porque a entrevista ainda nao pergunta o
  // numero) vira TODAS as instancias da conta. Quando vem preenchido, respeita
  // a escolha. Em ambos os casos quem valida a posse e o createAgentRecord.
  const instanciasAlvo = instanceIds.length > 0
    ? instanceIds
    : instanciasDaConta(db, accountId).map(r => r.id)
  const etapasAlvo = etapasPadraoDaConta(db, accountId).map(r => r.id)
  // Sem numero ou sem etapa o agente nasceria surdo. Recusa antes de criar.
  if (instanciasAlvo.length === 0) return { ok: false, error: 'sem_instancia' }
  if (etapasAlvo.length === 0) return { ok: false, error: 'sem_etapa' }

  const run = db.transaction(() => {
    const created = createAgentRecord(db, {
      accountId,
      body: {
        name: c.name,
        persona: c.persona,
        knowledge_base: c.knowledge_base,
        never_mention: c.never_mention,
        qualification_criteria: c.qualification_criteria,
        required_fields: c.required_fields,
        mode,
        stage_ids: etapasAlvo,
        instance_ids: instanciasAlvo,
      },
    })
    if (!created.ok) return created
    // linkAgent devolve false se o briefing desapareceu (ou trocou de conta)
    // entre o getBriefing do topo e aqui. Nesse caso o agente acabou de ser
    // criado com is_active=1 e ninguem o amarrou: lancar forca o rollback da
    // transacao de fora e desfaz o agente e o usuario-bot tambem.
    if (!linkAgent(db, { accountId, briefingId, agentId: created.agentId })) {
      throw new Error('briefing_desapareceu')
    }
    return { ok: true, agentId: created.agentId }
  })

  // createAgentRecord sinaliza erro de DUAS formas: devolvendo { ok:false } nas
  // validacoes, e LANCANDO quando a montagem do INSERT falha (confirmado na
  // Task 7). Sem este catch, a excecao subiria crua ate o Express.
  try {
    return run()
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

// A UNICA transicao que cria o agente. Enquanto o briefing e rascunho ou esta so
// compilado, os campos vivem em agent_briefings.compiled_json e NAO em ai_agents:
// qualquer linha em ai_agents com is_active=1 e varrida pelo processInboundMessage
// e comeca a responder lead de verdade.

import { getBriefing, linkAgent } from './briefingStore.js'
import { createAgentRecord } from './agentCreate.js'
import { validateCompiled } from './agentCompiler.js'

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

  // Briefing ja ativo = correcao de um agente que existe. Atualiza, nao duplica.
  if (briefing.status === 'ativo' && briefing.agent_id) {
    if (!updateAgentContent(db, { accountId, agentId: briefing.agent_id, c })) {
      return { ok: false, error: 'agente_nao_encontrado' }
    }
    return { ok: true, agentId: briefing.agent_id }
  }

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
        instance_ids: instanceIds,
      },
    })
    if (!created.ok) return created
    linkAgent(db, { accountId, briefingId, agentId: created.agentId })
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

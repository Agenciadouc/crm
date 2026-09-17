// Agente que ja existe nao tem briefing. Esta funcao cria um a partir dos campos
// atuais, para que "Conversar com a IA" valha tambem para o que ja esta no ar.
// NAO toca no agente: so le.

import { createBriefing, addSource, setCompiled, linkAgent } from './briefingStore.js'
import { REQUIRED_FIELD_KEYS } from './agentCompiler.js'

function parseRequiredFields(raw) {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter(f => REQUIRED_FIELD_KEYS.includes(f)) : []
  } catch {
    return []
  }
}

export function briefingFromAgent(db, { accountId, agentId, userId }) {
  const agent = db.prepare(
    'SELECT * FROM ai_agents WHERE id = ? AND account_id = ?'
  ).get(agentId, accountId)
  if (!agent) return { ok: false, error: 'agente_nao_encontrado' }

  const existente = db.prepare(
    'SELECT id FROM agent_briefings WHERE agent_id = ? AND account_id = ?'
  ).get(agentId, accountId)
  if (existente) return { ok: true, briefingId: existente.id }

  const requiredFields = parseRequiredFields(agent.required_fields)

  const compiled = {
    name: agent.name,
    persona: agent.persona || 'Cordial e objetiva.',
    knowledge_base: agent.knowledge_base || 'Ainda nao descrito.',
    never_mention: agent.never_mention || 'nada',
    qualification_criteria: agent.qualification_criteria || 'Ainda nao definido.',
    required_fields: requiredFields,
    resumo: {
      quem_sou: agent.persona || 'Atendente da empresa.',
      o_que_sei: agent.knowledge_base || 'Ainda nao descrito.',
      o_que_descubro: requiredFields.length ? requiredFields : ['Ainda nao definido'],
      o_que_nunca_falo: agent.never_mention ? [agent.never_mention] : ['Nada definido'],
    },
  }

  const texto = [
    `Configuracao atual do atendente "${agent.name}":`,
    `Tom de voz: ${agent.persona || '(vazio)'}`,
    `Conhecimento do negocio: ${agent.knowledge_base || '(vazio)'}`,
    `Nunca mencionar: ${agent.never_mention || '(vazio)'}`,
    `Criterio de qualificacao: ${agent.qualification_criteria || '(vazio)'}`,
    `Campos obrigatorios: ${requiredFields.join(', ') || '(nenhum)'}`,
  ].join('\n')

  const run = db.transaction(() => {
    const briefingId = createBriefing(db, { accountId, userId })
    addSource(db, { accountId, briefingId, kind: 'entrevista', content: texto })
    setCompiled(db, { accountId, briefingId, compiled })
    // linkAgent devolve false se o agente ja nao pertencer mais a esta conta
    // entre a checagem do topo e aqui. Lancar forca o rollback e desfaz o
    // briefing recem-criado, em vez de deixar um briefing sem agente amarrado.
    if (!linkAgent(db, { accountId, briefingId, agentId })) {
      throw new Error('falha_ao_amarrar_agente_ao_briefing')
    }
    return briefingId
  })

  // agent_id tem indice unico em agent_briefings: se dois pedidos concorrentes
  // chegarem aqui para o mesmo agente, o segundo linkAgent colide e a
  // transacao lanca. Sem este catch, a excecao subiria crua ate o Express.
  try {
    const briefingId = run()
    return { ok: true, briefingId }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

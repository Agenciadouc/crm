// Agente que ja existe nao tem briefing. Esta funcao cria um a partir dos campos
// atuais, para que "Conversar com a IA" valha tambem para o que ja esta no ar.
// NAO toca no agente: so le.

import { createBriefing, addSource, setCompiled, linkAgent, getBriefing } from './briefingStore.js'
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
    linkAgent(db, { accountId, briefingId, agentId })
    return briefingId
  })

  const briefingId = run()
  // getBriefing confirma que ficou legivel pela conta antes de devolver.
  if (!getBriefing(db, accountId, briefingId)) return { ok: false, error: 'falha_ao_criar' }
  return { ok: true, briefingId }
}

// Analise de venda do Copiloto (spec 3.4): ferramenta obrigatoria, trava de etapa e textos.
// Funcoes puras; saveLeadAnalysis recebe o db por parametro (nao importa server/db.js).

export const ANALYSIS_TOOL_NAME = 'record_analysis'

export const ANALYSIS_TOOL = {
  name: ANALYSIS_TOOL_NAME,
  description: 'OBRIGATORIA em toda resposta: registra a analise da conversa (momento, chance de fechar, trava principal e status de cada criterio de qualificacao).',
  input_schema: {
    type: 'object',
    properties: {
      momento: { type: 'string', description: 'Etapa real da conversa (ex: descoberta, qualificacao, objecao de preco, pronto para proposta)' },
      chance_fechar: { type: 'integer', minimum: 0, maximum: 100, description: 'Chance de fechar a venda, de 0 a 100' },
      trava_principal: { type: 'string', description: 'Objecao ou bloqueio atual. Vazio se nao houver.' },
      criterios: {
        type: 'array',
        description: 'Cada criterio obrigatorio de qualificacao, com status e evidencia',
        items: {
          type: 'object',
          properties: {
            criterio: { type: 'string' },
            status: { type: 'string', enum: ['atendido', 'pendente'] },
            evidencia: { type: 'string', description: 'Trecho da conversa que comprova. Vazio se pendente.' },
          },
          required: ['criterio', 'status'],
        },
      },
    },
    required: ['momento', 'chance_fechar', 'trava_principal', 'criterios'],
  },
}

const LEAD_FIELD_LABELS = { name: 'nome', email: 'email', phone: 'telefone', city: 'cidade', empresa: 'empresa', instagram: 'instagram' }

function cleanText(value, max) {
  const s = String(value == null ? '' : value).trim()
  return s ? s.slice(0, max) : ''
}

export function parseAnalysisInput(input) {
  if (!input || typeof input !== 'object') return null
  const rawChance = Number(input.chance_fechar)
  const closeChance = Number.isFinite(rawChance) ? Math.max(0, Math.min(100, Math.round(rawChance))) : null
  const criteria = Array.isArray(input.criterios)
    ? input.criterios
      .filter(c => c && typeof c === 'object' && cleanText(c.criterio, 200))
      .map(c => ({
        name: cleanText(c.criterio, 200),
        status: String(c.status || '').trim().toLowerCase() === 'atendido' ? 'atendido' : 'pendente',
        evidence: cleanText(c.evidencia, 300),
      }))
    : []
  return {
    moment: cleanText(input.momento, 100) || null,
    closeChance,
    mainBlocker: cleanText(input.trava_principal, 200) || null,
    criteria,
  }
}

export function parseRequiredFields(json) {
  try {
    const arr = JSON.parse(json || '[]')
    return Array.isArray(arr) ? arr.filter(f => typeof f === 'string') : []
  } catch {
    return []
  }
}

export function readLeadCriteria(lead) {
  if (!lead || !lead.ai_criteria_json) return null
  try {
    const arr = JSON.parse(lead.ai_criteria_json)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

export function checkStageGate({ requiredFields = [], lead, criteria, hasQualificationText = false }) {
  const missingFields = requiredFields.filter(f => !cleanText(lead && lead[f], 500))
  const noAnalysis = !Array.isArray(criteria)
  const list = noAnalysis ? [] : criteria
  const pendingCriteria = list.filter(c => c.status !== 'atendido').map(c => c.name)
  const noCriteriaEvaluated = !noAnalysis && hasQualificationText && list.length === 0
  const allowed = missingFields.length === 0 && pendingCriteria.length === 0 && !noAnalysis && !noCriteriaEvaluated
  return { allowed, missingFields, pendingCriteria, noAnalysis, noCriteriaEvaluated }
}

export function formatGateRefusal(gate) {
  const parts = []
  if (gate.missingFields.length > 0) parts.push('campos obrigatorios: ' + gate.missingFields.map(f => LEAD_FIELD_LABELS[f] || f).join(', '))
  if (gate.pendingCriteria.length > 0) parts.push('criterios pendentes: ' + gate.pendingCriteria.join(', '))
  if (gate.noAnalysis) parts.push(`analise da conversa (chame ${ANALYSIS_TOOL_NAME})`)
  if (gate.noCriteriaEvaluated) parts.push('avaliacao dos criterios de qualificacao')
  return `Mudanca recusada: a qualificacao nao esta completa. Falta: ${parts.join('; ')}. Continue a conversa e faca a proxima pergunta de qualificacao.`
}

export function shouldSdrHandoff({ requiredFields = [], lead, criteria, hasQualificationText = false }) {
  const gate = checkStageGate({ requiredFields, lead, criteria, hasQualificationText })
  const hasSomethingToQualify = requiredFields.length > 0 || (Array.isArray(criteria) && criteria.length > 0)
  return gate.allowed && hasSomethingToQualify
}

export function buildQualificationSummary(lead, criteria) {
  const lines = ['Resumo da qualificacao (IA):']
  for (const c of (Array.isArray(criteria) ? criteria : [])) {
    lines.push(`- ${c.name}: ${c.status}${c.evidence ? ` — "${c.evidence}"` : ''}`)
  }
  if (lead && lead.ai_close_chance != null) lines.push(`Chance de fechar: ${lead.ai_close_chance}%`)
  lines.push(`Trava principal: ${(lead && lead.ai_main_blocker) || 'nenhuma'}`)
  return lines.join('\n')
}

export function buildSalesRulesLines(mode) {
  const lines = [
    'REGRAS DE VENDA (obrigatorias):',
    '- NUNCA passe orcamento, preco ou proposta antes de o lead cumprir TODOS os criterios de qualificacao E estar no momento ideal.',
    '- Se o lead insistir no preco antes da hora, use o contorno de objecao da secao CONTEXTO DA EMPRESA quando houver um para essa objecao; se a base nao tiver nada sobre isso, contorne com empatia (explique que precisa entender a necessidade dele para passar o valor certo). Em qualquer caso, siga com a PROXIMA pergunta de qualificacao. Nunca recuse seco.',
    `- Em TODA resposta chame a ferramenta ${ANALYSIS_TOOL_NAME} com: momento (etapa real da conversa), chance_fechar (0 a 100), trava_principal (objecao ou bloqueio atual, ou vazio) e criterios (cada criterio obrigatorio com status atendido ou pendente e a evidencia, um trecho da conversa).`,
    '- Mudar o lead de etapa so e aceito pelo sistema com todos os campos obrigatorios preenchidos e todos os criterios atendidos. Se for recusado, continue perguntando o que falta.',
  ]
  if (mode === 'copilot') lines.push('- Nao transfira o lead: o vendedor humano ja esta na conversa.')
  return lines
}

export function saveLeadAnalysis(db, accountId, leadId, analysis) {
  db.prepare(`
    UPDATE leads
    SET ai_moment = ?, ai_close_chance = ?, ai_main_blocker = ?, ai_criteria_json = ?, ai_msgs_since_analysis = 0
    WHERE id = ? AND account_id = ?
  `).run(analysis.moment, analysis.closeChance, analysis.mainBlocker, JSON.stringify(analysis.criteria || []), leadId, accountId)
}

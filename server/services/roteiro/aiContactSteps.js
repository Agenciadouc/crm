// Montar com IA em etapa de tentativa de contato (spec 2026-10-02 §3: contato nao recebe pergunta):
// a IA monta a sequencia de mensagens e ligacoes ate o cliente responder, a partir do objetivo,
// dos perfis e do briefing do agente. Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { RoteiroError } from './repo.js'
import { getBusiness } from './profiles.js'
import { loadBriefing } from './aiDraft.js'
import { toolInput } from './aiCall.js'

const MAX_STEPS = 8
const MAX_DELAY_DAYS = 30
const AI_FAILED_MESSAGE = 'A IA não respondeu agora. Monte à mão ou tente de novo.'

const SYSTEM_PROMPT = `Você monta a cadência de tentativa de contato de pequenas empresas brasileiras: os passos que o vendedor segue até um lead novo responder no WhatsApp.
Regras:
- Só mensagem (mensagem de WhatsApp) e ligacao. Nada de perguntas de qualificação: elas vêm depois que o cliente responde.
- De 3 a 6 passos, alternando mensagem e ligação. O 1º é uma mensagem no mesmo dia (delay_days 0).
- delay_days é quantos dias depois do passo anterior o passo acontece (0 = mesmo dia).
- Mensagem: curta, simpática, em português do Brasil, pode usar {nome} para o primeiro nome do cliente; termina com algo fácil de responder. A última pode ser de despedida educada ("vou deixar de te chamar...").
- Ligação: title é a ação curta ("Ligar para {nome}"); text é o roteiro da ligação em 1 a 3 frases.
- Use o que o negócio vende e o tipo de cliente para deixar as mensagens específicas.
Use sempre a ferramenta propose_contact_steps.`

const PROPOSE_TOOL = {
  name: 'propose_contact_steps',
  description: 'Propõe os passos (mensagens e ligações) da etapa de tentativa de contato, na ordem.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action_type: { type: 'string', enum: ['mensagem', 'ligacao'] },
            delay_days: { type: 'integer' },
            title: { type: 'string', description: 'Só na ligação: a ação curta.' },
            text: { type: 'string', description: 'Mensagem pronta ou roteiro da ligação.' },
          },
          required: ['action_type', 'delay_days', 'text'],
        },
      },
    },
    required: ['steps'],
  },
}

const str = v => (typeof v === 'string' ? v.trim() : '')

function buildUserContent({ stage, business, briefing }) {
  const parts = [`Etapa: ${stage.name} (tentativa de contato — o lead ainda não respondeu).`, '']
  if (business.business_objective) parts.push(`Objetivo do negócio: ${business.business_objective}`)
  if (business.profiles.length) {
    parts.push('Perfis de cliente ideal:')
    for (const p of business.profiles) parts.push(`- ${p.name}${p.description ? ` — ${p.description}` : ''}`)
  }
  if (briefing) {
    if (briefing.qualification_criteria) parts.push(`Cliente qualificado quando: ${briefing.qualification_criteria}`)
    if (briefing.knowledge_base) parts.push(`Base de conhecimento: ${briefing.knowledge_base}`)
  }
  if (!business.business_objective && !briefing) parts.push('Não há descrição do negócio. Monte uma cadência de contato geral de vendas.')
  return parts.join('\n')
}

export function sanitizeContactStep(raw) {
  const text = str(raw?.text).slice(0, 1000)
  if (!text) return null
  const days = Math.round(Number(raw.delay_days))
  const delay_days = Number.isFinite(days) ? Math.max(0, Math.min(MAX_DELAY_DAYS, days)) : 0
  if (raw.action_type === 'ligacao') {
    return { action_type: 'ligacao', description: str(raw.title).slice(0, 200) || 'Ligar para {nome}', call_script: text, delay_days }
  }
  return { action_type: 'mensagem', auto_message: text, delay_days }
}

export async function buildAiContactSteps(db, { accountId, stage, ai }) {
  let input
  try {
    const result = await ai.call({
      accountId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent({ stage, business: getBusiness(db, accountId), briefing: loadBriefing(db, accountId) }) }],
      tools: [PROPOSE_TOOL],
      toolChoice: { type: 'tool', name: 'propose_contact_steps' },
      maxTokens: 2000,
      source: 'roteiro_draft', // conta no teto de IA do roteiro
    })
    input = toolInput(result, 'propose_contact_steps')
  } catch (e) {
    console.error('[Cadencia] montar contato com IA:', e && e.message)
    input = null
  }
  if (!input) throw new RoteiroError('ai_failed', 502, AI_FAILED_MESSAGE)
  return (Array.isArray(input.steps) ? input.steps : []).map(sanitizeContactStep).filter(Boolean).slice(0, MAX_STEPS)
}

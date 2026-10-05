// "Sugerir com IA" do cartao Negocio e clientes ideais (spec 2026-10-02 §8.5): a IA le as
// conversas reais e o briefing da conta e propoe objetivo + ate 6 perfis. So propoe: quem grava
// e o gestor, no [Salvar]. Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { RoteiroError } from './repo.js'
import { toolInput } from './aiCall.js'
import { sampleConversations } from './conversationSample.js'
import { loadBriefing } from './aiDraft.js'
import { MAX_PROFILES } from './profiles.js'

const AI_FAILED_MESSAGE = 'A IA não respondeu agora. Monte à mão ou tente de novo.'
const str = v => (typeof v === 'string' ? v.trim() : '')

const SYSTEM_PROMPT = `Você ajuda pequenas empresas brasileiras a definir o objetivo do negócio e os perfis de cliente ideal (até 6) a partir das conversas reais de WhatsApp e do briefing.
- business_objective: uma frase curta do que a empresa vende e para quem (ex.: "revender produtos de limpeza").
- Cada perfil: name curto (ex.: "Loja", "Vendedor porta a porta") e description = como reconhecer esse cliente pelas mensagens (palavras que ele usa, situação dele).
- Só crie perfis que aparecem de verdade nas conversas ou no briefing. Na dúvida, menos perfis.
Use sempre a ferramenta propose_profiles.`

const PROPOSE_PROFILES_TOOL = {
  name: 'propose_profiles',
  description: 'Propõe o objetivo do negócio e os perfis de cliente ideal.',
  input_schema: {
    type: 'object',
    properties: {
      business_objective: { type: 'string' },
      profiles: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
      },
    },
    required: ['profiles'],
  },
}

export async function suggestBusiness(db, { accountId, ai }) {
  const sample = sampleConversations(db, { accountId })
  const briefing = loadBriefing(db, accountId)
  const parts = []
  if (briefing) {
    if (briefing.o_que_descubro.length) parts.push(`O que descobrir do cliente: ${briefing.o_que_descubro.join('; ')}`)
    if (briefing.qualification_criteria) parts.push(`Cliente qualificado quando: ${briefing.qualification_criteria}`)
    if (briefing.knowledge_base) parts.push(`Sobre o negócio: ${briefing.knowledge_base}`)
  }
  parts.push(sample.text ? `Conversas reais (${sample.count}):\n${sample.text}` : 'Não há conversas ainda.')

  let input = null
  try {
    const result = await ai.call({
      accountId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
      tools: [PROPOSE_PROFILES_TOOL],
      toolChoice: { type: 'tool', name: 'propose_profiles' },
      maxTokens: 2000,
      source: 'roteiro_profiles',
    })
    input = toolInput(result, 'propose_profiles')
  } catch (e) {
    console.error('[Roteiro] sugerir perfis:', e && e.message)
  }
  if (!input) throw new RoteiroError('ai_failed', 502, AI_FAILED_MESSAGE)

  return {
    business_objective: str(input.business_objective).slice(0, 300) || null,
    profiles: (Array.isArray(input.profiles) ? input.profiles : [])
      .map(p => ({ name: str(p?.name).slice(0, 60), description: str(p?.description).slice(0, 500) }))
      .filter(p => p.name)
      .slice(0, MAX_PROFILES),
  }
}

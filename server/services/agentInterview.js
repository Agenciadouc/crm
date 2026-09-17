// Conduz a entrevista que vira o briefing do agente. Uma pergunta por vez.
// O codigo tem os TEMAS; quem escreve a PERGUNTA e a IA, adaptada ao ramo que
// ela descobrir na primeira resposta. Nenhum ramo de negocio aparece aqui.

import { getBriefing, addTurn } from './briefingStore.js'

export const MAX_PERGUNTAS = 20
export const MAX_TOKENS_BRIEFING = 60000

export const TEMAS = [
  'O que a empresa vende',
  'Quem e o cliente ideal',
  'O que o atendente precisa descobrir do lead antes de passar para o vendedor',
  'O que o atendente nunca pode falar',
  'Como a empresa fala com o cliente (tom de voz)',
  'Em qual numero de WhatsApp o atendente vai trabalhar',
]

const SYSTEM_PROMPT = `Voce esta entrevistando o dono de um negocio para montar um atendente de IA que vai responder os leads dele no WhatsApp.

Faca UMA pergunta por vez, curta, em portugues simples, sem jargao. Responda APENAS com a pergunta, sem numeracao e sem comentario.

O negocio pode ser de QUALQUER ramo. Descubra o ramo na primeira resposta e adapte todas as perguntas seguintes a ele. Nunca presuma um ramo.

Se a ultima resposta foi vaga, pergunte de novo pedindo o detalhe que faltou, em vez de seguir adiante.

TEMAS que a entrevista precisa cobrir, nesta ordem:
${TEMAS.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Ao longo da conversa, quando fizer sentido, ofereca tambem:
- pedir o site da empresa, dizendo que voce le sozinha
- pedir que a pessoa cole qualquer material pronto que ela ja tenha

Quando todos os temas estiverem cobertos, responda exatamente: PRONTO`

export function shouldFinish(briefing, ai) {
  const perguntas = briefing.turns.filter(t => t.role === 'ia').length
  if (perguntas >= MAX_PERGUNTAS) return { finish: true, reason: 'perguntas' }
  if (ai.tokensUsed() >= MAX_TOKENS_BRIEFING) return { finish: true, reason: 'tokens' }
  return { finish: false, reason: null }
}

export async function nextQuestion(db, { accountId, briefingId, ai }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }

  // Teto conferido ANTES de gastar IA.
  const corte = shouldFinish(briefing, ai)
  if (corte.finish) return { ok: true, done: true, reason: corte.reason }

  const messages = briefing.turns.map(t => ({
    role: t.role === 'ia' ? 'assistant' : 'user',
    content: t.content,
  }))
  // A API exige que a conversa comece por 'user'.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: 'Pode comecar a entrevista.' })
  }

  let r
  try {
    r = await ai.ask({ systemPrompt: SYSTEM_PROMPT, messages, maxTokens: 200, source: 'entrevista' })
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }

  const pergunta = String(r.content || '').trim()
  if (!pergunta) return { ok: false, error: 'pergunta_vazia' }
  if (pergunta.toUpperCase() === 'PRONTO') return { ok: true, done: true, reason: 'temas_cobertos' }

  addTurn(db, { accountId, briefingId, role: 'ia', content: pergunta })
  return { ok: true, done: false, question: pergunta }
}

export function answer(db, { accountId, briefingId, text }) {
  const clean = String(text == null ? '' : text).trim()
  if (!clean) return { ok: false, error: 'resposta_vazia' }
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }
  addTurn(db, { accountId, briefingId, role: 'user', content: clean })
  return { ok: true }
}

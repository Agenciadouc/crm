// Conduz a entrevista que vira o briefing do agente. Uma pergunta por vez.
// O codigo tem os TEMAS; quem escreve a PERGUNTA e a IA, adaptada ao ramo que
// ela descobrir na primeira resposta. Nenhum ramo de negocio aparece aqui.

import { getBriefing, addTurn } from './briefingStore.js'

export const MAX_PERGUNTAS = 20
// Teto do briefing INTEIRO (entrevista + fontes + compilacao), spec secao 6.
export const MAX_TOKENS_BRIEFING = 60000
// Fatia do teto guardada para a compilacao final. A entrevista para antes de
// gastar tudo: se ela consumisse o teto inteiro, o briefing terminaria sem
// orcamento para compilar e a pessoa ficaria sem agente nenhum.
export const RESERVA_COMPILACAO = 10000
export const MAX_TOKENS_ENTREVISTA = MAX_TOKENS_BRIEFING - RESERVA_COMPILACAO

export const TEMAS = [
  'O que a empresa vende',
  'Quem e o cliente ideal',
  'O que o atendente precisa descobrir do lead antes de passar para o vendedor',
  'O que o atendente nunca pode falar',
  'Como a empresa fala com o cliente (tom de voz)',
  'Em qual numero de WhatsApp o atendente vai trabalhar',
]

export const SYSTEM_PROMPT = `Voce esta entrevistando o dono de um negocio para montar um atendente de IA que vai responder os leads dele no WhatsApp.

Faca UMA pergunta por vez, curta, em portugues simples, sem jargao. Responda APENAS com a pergunta, sem numeracao e sem comentario.

O negocio pode ser de QUALQUER ramo. Descubra o ramo na primeira resposta e adapte todas as perguntas seguintes a ele. Nunca presuma um ramo.

Se a ultima resposta foi vaga, pergunte de novo pedindo o detalhe que faltou, em vez de seguir adiante.

TEMAS que a entrevista precisa cobrir, nesta ordem:
${TEMAS.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Ao longo da conversa, quando fizer sentido, ofereca tambem:
- pedir o site da empresa, dizendo que voce le sozinha
- pedir que a pessoa cole qualquer material pronto que ela ja tenha

Escreva em portugues do Brasil com acentuacao correta.

Quando todos os temas estiverem cobertos, responda exatamente: PRONTO`

// Le o acumulado PERSISTIDO do briefing (agent_briefings.tokens_used). O
// contador do cliente de IA nao serve: ele e criado por requisicao HTTP e
// sempre vale 0 quando esta checagem roda, entao o teto nunca disparava.
export function shouldFinish(briefing) {
  const perguntas = briefing.turns.filter(t => t.role === 'ia').length
  if (perguntas >= MAX_PERGUNTAS) return { finish: true, reason: 'perguntas' }
  if (Number(briefing.tokens_used || 0) >= MAX_TOKENS_ENTREVISTA) return { finish: true, reason: 'tokens' }
  return { finish: false, reason: null }
}

export async function nextQuestion(db, { accountId, briefingId, ai }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }

  // Teto conferido ANTES de gastar IA.
  const corte = shouldFinish(briefing)
  if (corte.finish) return { ok: true, done: true, reason: corte.reason }

  // Ja existe pergunta no ar esperando resposta: devolve ela em vez de gastar
  // IA de novo. Duas rotas chamam esta funcao (/answer e /next-question, esta
  // ultima com o botao "Tentar de novo" na mao da pessoa), e sem a guarda dois
  // cliques seguidos empilhavam perguntas da IA e queimavam o teto a toa.
  const ultimo = briefing.turns.length ? briefing.turns[briefing.turns.length - 1] : null
  if (ultimo && ultimo.role === 'ia') {
    return { ok: true, done: false, question: ultimo.content, repetida: true }
  }

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
  // Normaliza antes de comparar com o sentinela: tira tudo que nao for letra
  // e maiusculiza, para aceitar variacoes como "Pronto!" ou "PRONTO.", mas
  // sem adivinhar frases que so mencionam a palavra, como "Tudo PRONTO".
  const normalizado = pergunta.toUpperCase().replace(/[^A-Z]/g, '')
  if (normalizado === 'PRONTO') return { ok: true, done: true, reason: 'temas_cobertos' }

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

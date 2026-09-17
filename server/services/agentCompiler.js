// Transforma o briefing (transcricao + fontes) nos campos do ai_agents.
// E o UNICO lugar que conhece o formato do ai_agents. Valida antes de devolver:
// nunca entrega agente meio montado.

import { getBriefing } from './briefingStore.js'

// Mesmas chaves de REQUIRED_FIELDS_OPTS em src/components/AgentEditorModal.tsx:14
export const REQUIRED_FIELD_KEYS = ['name', 'email', 'phone', 'city', 'empresa', 'instagram']

const SYSTEM_PROMPT = `Voce recebe a entrevista que um dono de negocio deu sobre a propria empresa e transforma isso na configuracao de um atendente de IA que vai responder os leads dele no WhatsApp.

O negocio pode ser de QUALQUER ramo. Nao presuma ramo nenhum: use so o que a entrevista disser.

Responda APENAS com um objeto JSON, sem texto antes ou depois, neste formato exato:

{
  "name": "primeiro nome do atendente, brasileiro e comum",
  "persona": "tom de voz em 1 ou 2 frases",
  "knowledge_base": "tudo que o atendente precisa saber do negocio para responder",
  "never_mention": "o que o atendente nunca pode falar, separado por virgula",
  "qualification_criteria": "uma frase: quando o lead esta qualificado",
  "required_fields": ["subconjunto de: name, email, phone, city, empresa, instagram"],
  "resumo": {
    "quem_sou": "uma frase, na voz do atendente",
    "o_que_sei": "uma frase sobre o negocio",
    "o_que_descubro": ["item curto", "item curto"],
    "o_que_nunca_falo": ["item curto"]
  }
}

O campo "resumo" e o que o dono le na tela para aprovar: escreva em portugues simples, sem jargao.`

function parseJsonLoose(text) {
  const raw = String(text == null ? '' : text).trim()
  const semCerca = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(semCerca)
  } catch {
    // ultima tentativa: pegar do primeiro { ate o ultimo }
    const i = semCerca.indexOf('{')
    const j = semCerca.lastIndexOf('}')
    if (i === -1 || j <= i) return null
    try { return JSON.parse(semCerca.slice(i, j + 1)) } catch { return null }
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(x => isNonEmptyString(x))
}

export function validateCompiled(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'nao_e_objeto' }

  for (const k of ['name', 'persona', 'knowledge_base', 'never_mention', 'qualification_criteria']) {
    if (!isNonEmptyString(raw[k])) return { ok: false, error: `campo_invalido:${k}` }
  }
  if (!Array.isArray(raw.required_fields)) return { ok: false, error: 'campo_invalido:required_fields' }
  if (!raw.required_fields.every(f => REQUIRED_FIELD_KEYS.includes(f))) {
    return { ok: false, error: 'campo_invalido:required_fields' }
  }
  // required_fields vazio e valido de proposito: existe negocio que nao
  // precisa coletar nenhum campo estruturado, e o formulario do agente ja
  // aceita zero campos obrigatorios hoje. Nao "consertar" isso de novo.

  const r = raw.resumo
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'campo_invalido:resumo' }
  if (!isNonEmptyString(r.quem_sou)) return { ok: false, error: 'campo_invalido:resumo.quem_sou' }
  if (!isNonEmptyString(r.o_que_sei)) return { ok: false, error: 'campo_invalido:resumo.o_que_sei' }
  // o_que_descubro e o_que_nunca_falo sao a versao legivel de campos que ja
  // sao obrigatorios e nao-vazios (qualification_criteria e never_mention):
  // precisam de pelo menos um item, senao a tela de aprovacao mostra uma
  // secao em branco e o dono aprova um agente meio montado.
  if (!isStringArray(r.o_que_descubro) || r.o_que_descubro.length === 0) {
    return { ok: false, error: 'campo_invalido:resumo.o_que_descubro' }
  }
  if (!isStringArray(r.o_que_nunca_falo) || r.o_que_nunca_falo.length === 0) {
    return { ok: false, error: 'campo_invalido:resumo.o_que_nunca_falo' }
  }

  return {
    ok: true,
    value: {
      name: raw.name.trim(),
      persona: raw.persona.trim(),
      knowledge_base: raw.knowledge_base.trim(),
      never_mention: raw.never_mention.trim(),
      qualification_criteria: raw.qualification_criteria.trim(),
      required_fields: [...new Set(raw.required_fields)],
      resumo: {
        quem_sou: r.quem_sou.trim(),
        o_que_sei: r.o_que_sei.trim(),
        o_que_descubro: [...r.o_que_descubro],
        o_que_nunca_falo: [...r.o_que_nunca_falo],
      },
    },
  }
}

export function buildBriefingText(briefing) {
  const conversa = briefing.turns
    .map(t => `${t.role === 'ia' ? 'PERGUNTA' : 'RESPOSTA'}: ${t.content}`)
    .join('\n')

  const fontes = briefing.sources
    .filter(s => s.status === 'ok' && s.content)
    .map(s => `--- MATERIAL (${s.kind}${s.ref ? ' ' + s.ref : ''}) ---\n${s.content}`)
    .join('\n\n')

  return [`=== ENTREVISTA ===\n${conversa}`, fontes ? `=== MATERIAIS ===\n${fontes}` : '']
    .filter(Boolean).join('\n\n')
}

export async function compileBriefing(db, { accountId, briefingId, ai }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }

  const texto = buildBriefingText(briefing)
  let ultimoErro = 'saida_invalida'

  // Tenta duas vezes: a segunda avisa que a primeira veio fora do formato.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const aviso = tentativa === 1
      ? ''
      : '\n\nATENCAO: sua resposta anterior nao era um JSON valido no formato pedido. Responda SO o JSON.'
    let r
    try {
      r = await ai.ask({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: texto + aviso }],
        maxTokens: 1500,
        source: 'compilacao',
      })
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }

    const parsed = parseJsonLoose(r.content)
    const check = validateCompiled(parsed)
    if (check.ok) return { ok: true, compiled: check.value }
    ultimoErro = 'saida_invalida'
  }

  return { ok: false, error: ultimoErro }
}

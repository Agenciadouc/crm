// Sugestoes com IA do aprendizado noturno (spec 6.3): rewrite, new_option, new_deviation
// e reorder, no maximo `maxCalls` chamadas por conta/noite. Nao duplica sugestao ainda
// sem decisao. Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { getPublishedQuestions, RoteiroError } from './repo.js'
import { activeVariant } from './variants.js'
import { pct } from './metrics.js'
import { resolveNow, shiftFromNow } from './time.js'
import { AI_UNAVAILABLE, toolInput } from './aiCall.js'

export const AI_LEARNING_MAX_CALLS = 5
export const NEW_OPTION_MIN = 5
export const NEW_DEVIATION_MIN = 3
export const REORDER_MIN_GAIN = 15
export const REORDER_MIN_SAMPLE = 10
const WINDOW_DAYS = 90
const MAX_ITEMS = 100

const SYSTEM_PROMPT = `Você ajuda um gestor de vendas a melhorar o roteiro de qualificação usado no WhatsApp.
Escreva em português do Brasil, simples e direto, sem jargão. Se o texto da pergunta tiver {nome}, mantenha {nome}.
Use sempre a ferramenta pedida.`

const norm = t => String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const str = v => (typeof v === 'string' ? v.trim() : '')

const TOOLS = {
  propose_rewrites: {
    name: 'propose_rewrites',
    description: 'Duas versões novas para cada pergunta com pouca resposta.',
    input_schema: {
      type: 'object',
      properties: {
        rewrites: {
          type: 'array',
          items: {
            type: 'object',
            properties: { question_key: { type: 'string' }, versions: { type: 'array', items: { type: 'string' } } },
            required: ['question_key', 'versions'],
          },
        },
      },
      required: ['rewrites'],
    },
  },
  group_answers: {
    name: 'group_answers',
    description: 'Agrupa respostas livres parecidas em uma opção nova.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: { question_key: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' } },
            required: ['question_key', 'label', 'count'],
          },
        },
      },
      required: ['groups'],
    },
  },
  group_offscript: {
    name: 'group_offscript',
    description: 'Agrupa perguntas parecidas dos clientes fora do roteiro em desvios com resposta pronta.',
    input_schema: {
      type: 'object',
      properties: {
        deviations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              triggers: { type: 'string', description: 'Palavras-gatilho separadas por vírgula.' },
              reply_text: { type: 'string' },
              return_question_key: { type: 'string' },
              count: { type: 'integer' },
            },
            required: ['triggers', 'reply_text', 'count'],
          },
        },
      },
      required: ['deviations'],
    },
  },
  explain_reorders: {
    name: 'explain_reorders',
    description: 'Explica em uma frase simples cada troca de ordem sugerida.',
    input_schema: {
      type: 'object',
      properties: {
        explanations: {
          type: 'array',
          items: { type: 'object', properties: { stage_id: { type: 'integer' }, text: { type: 'string' } }, required: ['stage_id', 'text'] },
        },
      },
      required: ['explanations'],
    },
  },
}

export async function runAiLearning(db, { accountId, metricsByFunnel = {}, ai, maxCalls = AI_LEARNING_MAX_CALLS, now } = {}) {
  const out = { created: 0, calls: 0 }
  if (!ai || (typeof ai.isAvailable === 'function' && !ai.isAvailable(accountId))) return out

  const nowStr = resolveNow(db, now)
  const since = shiftFromNow(db, nowStr, `-${WINDOW_DAYS} days`)
  let stopped = false

  // Uma chamada da ferramenta; null se estourou o limite, falhou ou a IA ficou indisponivel.
  async function ask(toolName, content) {
    if (stopped || out.calls >= maxCalls) return null
    out.calls++
    try {
      const result = await ai.call({
        accountId,
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        tools: [TOOLS[toolName]],
        toolChoice: { type: 'tool', name: toolName },
        maxTokens: 1500,
        source: 'roteiro_learning',
      })
      return toolInput(result, toolName)
    } catch (e) {
      if (e && e.code === AI_UNAVAILABLE) stopped = true
      else console.error('[Roteiro] aprendizado IA', toolName, e && e.message)
      return null
    }
  }

  const insert = db.prepare(`
    INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  const pendingOf = db.prepare(`
    SELECT question_key, payload_json, status FROM roteiro_suggestions WHERE account_id = ? AND funnel_id = ? AND type = ? AND status IN ('new','testing')
  `)
  const pendingPayloads = (funnelId, type) => pendingOf.all(accountId, funnelId, type).map(r => {
    let p = {}
    try { p = JSON.parse(r.payload_json) || {} } catch {}
    return { ...r, payload: p }
  })
  const add = (funnelId, questionKey, type, payload, evidence) => {
    insert.run(accountId, funnelId, questionKey, type, JSON.stringify(payload), JSON.stringify(evidence), nowStr)
    out.created++
  }

  for (const funnelKey of Object.keys(metricsByFunnel)) {
    const funnelId = Number(funnelKey)
    const metrics = metricsByFunnel[funnelKey] || []
    let questions
    try {
      questions = getPublishedQuestions(db, accountId, funnelId)
    } catch (e) {
      if (e instanceof RoteiroError) continue
      throw e
    }
    const byKey = new Map(questions.map(q => [q.question_key, q]))
    await suggestRewrites({ funnelId, metrics, byKey })
    await suggestNewOptions({ funnelId, questions })
    await suggestNewDeviations({ funnelId, questions })
    await suggestReorders({ funnelId, metrics, byKey })
  }
  return out

  // --- rewrite: 2 versoes para cada pergunta fraca -------------------------------------
  async function suggestRewrites({ funnelId, metrics, byKey }) {
    const taken = new Set(pendingPayloads(funnelId, 'rewrite').map(r => r.question_key))
    const weak = metrics.filter(m => m.status === 'fraca' && byKey.has(m.question_key) && !taken.has(m.question_key)
      && !activeVariant(db, accountId, m.question_key))
    if (!weak.length) return
    const content = [
      'Estas perguntas do roteiro têm pouca resposta dos clientes. Para cada uma, escreva 2 versões novas, curtas e mais fáceis de responder.',
      ...weak.map(m => `- question_key: ${m.question_key} | "${m.text}" | taxa de resposta: ${m.reply_rate}% em ${m.sent} envios`),
    ].join('\n')
    const input = await ask('propose_rewrites', content)
    if (!input) return
    const byWeak = new Map(weak.map(m => [m.question_key, m]))
    const done = new Set()
    for (const r of Array.isArray(input.rewrites) ? input.rewrites : []) {
      const m = r && byWeak.get(r.question_key)
      if (!m || done.has(m.question_key)) continue
      const current = norm(m.text)
      const versions = [...new Set((Array.isArray(r.versions) ? r.versions : []).map(v => str(v).slice(0, 500)).filter(v => v && norm(v) !== current))]
      if (versions.length < 2) continue
      done.add(m.question_key)
      add(funnelId, m.question_key, 'rewrite', { versions: versions.slice(0, 2), current_rate: m.reply_rate }, { sent: m.sent, reply_rate: m.reply_rate })
    }
  }

  // --- new_option: agrupa >= 5 respostas livres parecidas -------------------------------
  async function suggestNewOptions({ funnelId, questions }) {
    const answersStmt = db.prepare(`
      SELECT answer_text FROM lead_answers
      WHERE account_id = ? AND question_key = ? AND answer_text IS NOT NULL AND TRIM(answer_text) <> '' AND answered_at >= ?
      ORDER BY answered_at DESC LIMIT ?
    `)
    // Pergunta com sugestao de opcao ainda aberta nao volta pra IA (evita o mesmo grupo reescrito).
    const open = new Set(pendingPayloads(funnelId, 'new_option').map(r => r.question_key))
    const candidates = questions
      .filter(q => q.kind === 'text' && !open.has(q.question_key))
      .map(q => ({ q, answers: answersStmt.all(accountId, q.question_key, since, MAX_ITEMS).map(r => r.answer_text.trim()) }))
      .filter(c => c.answers.length >= NEW_OPTION_MIN)
    if (!candidates.length) return
    const content = [
      `Agrupe as respostas livres parecidas de cada pergunta. Só devolva grupos com ${NEW_OPTION_MIN} ou mais respostas; label é o texto curto da opção nova; count é quantas respostas entram no grupo.`,
      ...candidates.map(c => `\nquestion_key: ${c.q.question_key} | "${c.q.text}"\n${c.answers.map(a => `- ${a.slice(0, 200)}`).join('\n')}`),
    ].join('\n')
    const input = await ask('group_answers', content)
    if (!input) return
    const byQ = new Map(candidates.map(c => [c.q.question_key, c]))
    const seen = new Set(pendingPayloads(funnelId, 'new_option').map(r => `${r.question_key}|${norm(r.payload.label)}`))
    for (const g of Array.isArray(input.groups) ? input.groups : []) {
      const c = g && byQ.get(g.question_key)
      const label = str(g?.label).slice(0, 200)
      const count = Math.min(Math.round(Number(g?.count)) || 0, c ? c.answers.length : 0)
      if (!c || !label || count < NEW_OPTION_MIN) continue
      const k = `${c.q.question_key}|${norm(label)}`
      if (seen.has(k)) continue
      seen.add(k)
      add(funnelId, c.q.question_key, 'new_option', { question_key: c.q.question_key, label, count }, { answers: c.answers.length })
    }
  }

  // --- new_deviation: >= 3 perguntas parecidas fora do roteiro ---------------------------
  async function suggestNewDeviations({ funnelId, questions }) {
    // Desvio sugerido ainda aberto no funil: espera a decisao do gestor antes de pedir outro.
    if (pendingPayloads(funnelId, 'new_deviation').length) return
    const found = db.prepare(`
      SELECT o.text, o.lead_id FROM roteiro_offscript o JOIN leads l ON l.id = o.lead_id
      WHERE o.account_id = ? AND l.account_id = o.account_id AND l.funnel_id = ? AND o.detected_at >= ?
      ORDER BY o.detected_at DESC LIMIT ?
    `).all(accountId, funnelId, since, MAX_ITEMS)
    const rows = found.map(r => r.text)
    // Minimo conta leads diferentes: um lead repetindo a pergunta nao vira desvio sozinho.
    const leads = new Set(found.map(r => r.lead_id)).size
    if (leads < NEW_DEVIATION_MIN) return
    const content = [
      `Perguntas dos clientes que não estão no roteiro. Agrupe as parecidas; só devolva grupos com ${NEW_DEVIATION_MIN} ou mais perguntas.`,
      'Para cada grupo: palavras-gatilho separadas por vírgula, uma resposta pronta curta e a question_key da pergunta do roteiro para voltar depois.',
      '',
      'Perguntas do roteiro:',
      ...questions.map(q => `- question_key: ${q.question_key} | "${q.text}"`),
      '',
      'Perguntas dos clientes:',
      ...rows.map(t => `- ${t.slice(0, 200)}`),
    ].join('\n')
    const input = await ask('group_offscript', content)
    if (!input) return
    const keys = new Set(questions.map(q => q.question_key))
    const seen = new Set(pendingPayloads(funnelId, 'new_deviation').map(r => norm(r.payload.triggers)))
    for (const d of Array.isArray(input.deviations) ? input.deviations : []) {
      const triggers = str(d?.triggers).slice(0, 300)
      const replyText = str(d?.reply_text).slice(0, 1000)
      const count = Math.min(Math.round(Number(d?.count)) || 0, leads)
      if (!triggers || !replyText || count < NEW_DEVIATION_MIN || seen.has(norm(triggers))) continue
      seen.add(norm(triggers))
      const returnKey = keys.has(d.return_question_key) ? d.return_question_key : null
      add(funnelId, null, 'new_deviation', { triggers, reply_text: replyText, return_question_key: returnKey, count }, { offscript: rows.length, leads })
    }
  }

  // --- reorder: regra calculada; a IA so redige a explicacao ----------------------------
  async function suggestReorders({ funnelId, metrics, byKey }) {
    const taken = new Set(pendingPayloads(funnelId, 'reorder').map(r => r.payload.stage_id))
    const byStage = new Map()
    for (const m of metrics) {
      if (!byKey.has(m.question_key)) continue
      if (!byStage.has(m.stage_id)) byStage.set(m.stage_id, [])
      byStage.get(m.stage_id).push(m)
    }
    const found = []
    for (const [stageId, list] of byStage) {
      if (taken.has(stageId) || list.length < 2) continue
      const ordered = [...list].sort((a, b) => byKey.get(a.question_key).position - byKey.get(b.question_key).position)
      const best = bestReorder(ordered)
      if (best) found.push({ stageId, ordered, ...best })
    }
    if (!found.length) return
    const content = [
      'Em cada etapa abaixo, uma pergunta teve mais resposta quando foi feita antes de outra. Explique para o gestor, em uma frase simples, por que vale trocar a ordem.',
      ...found.map(f => `- stage_id ${f.stageId}: "${f.moved.text}" teve ${f.rateBefore}% de resposta quando feita antes de "${f.anchor.text}" e ${f.rateAfter}% quando feita depois (ganho de ${f.gain} pontos).`),
    ].join('\n')
    const input = await ask('explain_reorders', content)
    if (!input) return
    const texts = new Map((Array.isArray(input.explanations) ? input.explanations : []).map(e => [Number(e?.stage_id), str(e?.text).slice(0, 500)]))
    for (const f of found) {
      const order = f.ordered.map(m => m.question_key).filter(k => k !== f.moved.question_key)
      order.splice(order.indexOf(f.anchor.question_key), 0, f.moved.question_key)
      const explanation = texts.get(f.stageId)
        || `"${f.moved.text}" teve ${f.gain} pontos a mais de resposta quando feita antes de "${f.anchor.text}".`
      add(funnelId, null, 'reorder', { stage_id: f.stageId, order, gain: f.gain, explanation }, {
        question_key: f.moved.question_key, before_of: f.anchor.question_key,
        before: { sent: f.sentBefore, rate: f.rateBefore }, after: { sent: f.sentAfter, rate: f.rateAfter },
      })
    }
  }

  // Par (anterior A, posterior B) com maior ganho: taxa de B feita antes de A menos feita depois.
  // So leads em que as duas foram enviadas; conta o 1o envio de cada.
  function bestReorder(ordered) {
    const firstAsks = db.prepare(`
      SELECT lead_id, question_key, asked_at, replied_at FROM roteiro_asks a
      WHERE account_id = ? AND question_key = ? AND asked_at >= ? AND asked_at <= ?
        AND id = (SELECT id FROM roteiro_asks b WHERE b.lead_id = a.lead_id AND b.question_key = a.question_key ORDER BY b.asked_at ASC, b.id ASC LIMIT 1)
    `)
    const firstByQ = new Map(ordered.map(m => [m.question_key, new Map(firstAsks.all(accountId, m.question_key, since, nowStr).map(r => [r.lead_id, r]))]))
    let best = null
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = firstByQ.get(ordered[i].question_key)
        const b = firstByQ.get(ordered[j].question_key)
        let sentBefore = 0, repliedBefore = 0, sentAfter = 0, repliedAfter = 0
        for (const [leadId, askB] of b) {
          const askA = a.get(leadId)
          if (!askA || askA.asked_at === askB.asked_at) continue
          if (askB.asked_at < askA.asked_at) { sentBefore++; if (askB.replied_at) repliedBefore++ } else { sentAfter++; if (askB.replied_at) repliedAfter++ }
        }
        if (sentBefore < REORDER_MIN_SAMPLE || sentAfter < REORDER_MIN_SAMPLE) continue
        const rateBefore = pct(repliedBefore, sentBefore)
        const rateAfter = pct(repliedAfter, sentAfter)
        const gain = Math.round((rateBefore - rateAfter) * 10) / 10
        if (gain >= REORDER_MIN_GAIN && (!best || gain > best.gain)) {
          best = { moved: ordered[j], anchor: ordered[i], gain, rateBefore, rateAfter, sentBefore, sentAfter }
        }
      }
    }
    return best
  }
}

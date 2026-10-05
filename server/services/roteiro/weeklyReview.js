// Revisao semanal do roteiro (spec 2026-10-02 §10): 1x por semana por conta com IA e roteiro
// publicado, a IA le as conversas dos ultimos 7 dias e propoe perguntas SPIN novas, perfis novos,
// opcoes novas e reescritas. So vira sugestao (aba de sugestoes): nada muda sozinho.
// Nao importa server/db.js: recebe db e `ai` (ver aiCall.js).
import { getRoteiro } from './repo.js'
import { getBusiness, MAX_PROFILES } from './profiles.js'
import { activeVariant } from './variants.js'
import { sampleConversations } from './conversationSample.js'
import { isContactStage, conversationStages } from './stageKind.js'
import { SPIN_KEYS, SPIN_LABEL } from './spinTemplate.js'
import { toolInput } from './aiCall.js'
import { toSqliteDate } from './time.js'

export const WEEK_DAYS = 7
const LIMITS = { questions: 10, profiles: 3, options: 10, rewrites: 5 }
const REJECTED_MEMORY_DAYS = 90 // sugestao ignorada nao volta nesse prazo
const DAY_MS = 86400000

const str = v => (typeof v === 'string' ? v.trim() : '')
const norm = s => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
const clampPoints = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0 }
const countOf = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : null }

const SYSTEM_PROMPT = `Você revisa toda semana o roteiro de qualificação de vendas (SPIN Selling) de uma pequena empresa brasileira, lendo as conversas reais de WhatsApp da semana.
Proponha só melhorias com base no que os clientes disseram de verdade:
- new_questions: pergunta SPIN que falta (situation, problem, implication, need_payoff) para um perfil, numa etapa "em conversa", com opções tiradas das falas dos clientes (2 a 10; points de -50 a 50).
- new_profiles: tipo de cliente que aparece nas conversas e não está nos perfis cadastrados (name curto, description = como reconhecer).
- new_options: resposta que os clientes dão e não existe nas opções de uma pergunta de opções (use o question_key).
- rewrites: pergunta que os clientes não entendem ou não respondem — 2 versões novas, curtas e simpáticas.
Em reason, explique em uma frase o que viu nas conversas; em count, em quantas conversas viu. Na dúvida, não proponha. Português do Brasil.
Use sempre a ferramenta propose_review.`

const PROPOSE_REVIEW_TOOL = {
  name: 'propose_review',
  description: 'Propõe melhorias no roteiro a partir das conversas da semana.',
  input_schema: {
    type: 'object',
    properties: {
      new_questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            funnel_id: { type: 'integer' }, stage_id: { type: 'integer' }, profile_key: { type: 'string' },
            spin: { type: 'string', enum: SPIN_KEYS }, text: { type: 'string' },
            options: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, points: { type: 'integer' } }, required: ['label', 'points'] } },
            reason: { type: 'string' }, count: { type: 'integer' },
          },
          required: ['stage_id', 'text', 'options'],
        },
      },
      new_profiles: {
        type: 'array',
        items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, reason: { type: 'string' }, count: { type: 'integer' } }, required: ['name'] },
      },
      new_options: {
        type: 'array',
        items: { type: 'object', properties: { question_key: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' } }, required: ['question_key', 'label'] },
      },
      rewrites: {
        type: 'array',
        items: { type: 'object', properties: { question_key: { type: 'string' }, versions: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['question_key', 'versions'] },
      },
    },
  },
}

// Roteiros publicados da conta: etapas e perguntas por funil.
function loadPublished(db, accountId) {
  const funnelIds = db.prepare("SELECT DISTINCT funnel_id FROM roteiro_versions WHERE account_id = ? AND status = 'published'").all(accountId).map(r => r.funnel_id)
  const out = []
  for (const funnelId of funnelIds) {
    let rot
    try { rot = getRoteiro(db, accountId, funnelId) } catch { continue }
    if (!rot.published) continue
    const open = rot.stages.filter(s => !s.is_terminal)
    if (!open.length) continue
    out.push({ funnel: rot.funnel, stages: open, conversation: conversationStages(open), questions: rot.published.questions })
  }
  return out
}

function buildUserContent({ business, roteiros, sample }) {
  const parts = []
  if (business.business_objective) parts.push(`Objetivo do negócio: ${business.business_objective}`)
  if (business.profiles.length) {
    parts.push('Perfis de cliente cadastrados (profile_key):')
    for (const p of business.profiles) parts.push(`- ${p.profile_key}: ${p.name}${p.description ? ` — como reconhecer: ${p.description}` : ''}`)
  } else {
    parts.push('A conta ainda não cadastrou perfis de cliente.')
  }
  const profileName = new Map(business.profiles.map(p => [p.profile_key, p.name]))
  for (const r of roteiros) {
    parts.push('', `Funil ${r.funnel.name} (funnel_id ${r.funnel.id}):`)
    for (const s of r.stages) {
      parts.push(`- stage_id ${s.id}: ${s.name} (${isContactStage(s) ? 'tentativa de contato — sem perguntas' : 'em conversa'})`)
      for (const q of r.questions.filter(x => x.stage_id === s.id)) {
        const meta = [q.spin ? SPIN_LABEL[q.spin] : null, q.profile_key ? `perfil ${profileName.get(q.profile_key) || q.profile_key}` : 'todos'].filter(Boolean).join(', ')
        const opts = q.kind === 'options' ? ` | opções: ${q.options.map(o => o.label).join(' / ')}` : ' | texto livre'
        parts.push(`  - question_key ${q.question_key}: "${q.text}" (${meta})${opts}`)
      }
    }
  }
  parts.push('', `Conversas da semana (${sample.count}):`, sample.text)
  return parts.join('\n')
}

function evidence(raw) {
  return JSON.stringify({ source: 'weekly', reason: str(raw?.reason).slice(0, 300) || null, count: countOf(raw?.count) })
}

export async function runWeeklyReview(db, { accountId, ai, now = new Date() } = {}) {
  const none = { ran: false, created: 0 }
  if (!ai) return none
  const last = db.prepare('SELECT ran_at FROM roteiro_weekly_runs WHERE account_id = ?').get(accountId)
  if (last) {
    const lastMs = Date.parse(String(last.ran_at).replace(' ', 'T') + 'Z')
    if (Number.isFinite(lastMs) && now.getTime() - lastMs < WEEK_DAYS * DAY_MS) return none
  }
  const roteiros = loadPublished(db, accountId)
  if (!roteiros.length) return none

  // Registra antes de chamar a IA: falha nao repete toda noite, tenta de novo na semana que vem.
  db.prepare('INSERT OR REPLACE INTO roteiro_weekly_runs (account_id, ran_at) VALUES (?, ?)').run(accountId, toSqliteDate(now))
  const sample = sampleConversations(db, { accountId, now, days: WEEK_DAYS })
  if (!sample.text) return { ran: true, created: 0 }

  const business = getBusiness(db, accountId)
  let input = null
  try {
    const result = await ai.call({
      accountId,
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent({ business, roteiros, sample }) }],
      tools: [PROPOSE_REVIEW_TOOL],
      toolChoice: { type: 'tool', name: 'propose_review' },
      maxTokens: 4000,
      source: 'roteiro_weekly',
    })
    input = toolInput(result, 'propose_review')
  } catch (e) {
    console.error('[Roteiro] revisao semanal da conta', accountId, e && e.message)
  }
  if (!input) return { ran: true, created: 0 }
  return { ran: true, created: saveProposals(db, { accountId, business, roteiros, input, now }) }
}

function saveProposals(db, { accountId, business, roteiros, input, now }) {
  const nowStr = toSqliteDate(now)
  const profileName = new Map(business.profiles.map(p => [p.profile_key, p.name]))
  const questionsByKey = new Map()
  for (const r of roteiros) for (const q of r.questions) questionsByKey.set(q.question_key, { q, funnelId: r.funnel.id })

  // Sugestoes ainda sem decisao (reescrita em teste A/B tambem conta) e as ignoradas nos
  // ultimos 90 dias: nao repete (senao "Ignorar" nao adianta).
  const rejectedSince = toSqliteDate(new Date(now.getTime() - REJECTED_MEMORY_DAYS * DAY_MS))
  const open = db.prepare(`SELECT type, status, question_key, payload_json FROM roteiro_suggestions
    WHERE account_id = ? AND (status IN ('new','testing') OR (status = 'rejected' AND COALESCE(decided_at, created_at) >= ?))`).all(accountId, rejectedSince)
  const seen = new Set()
  const keyOf = (type, questionKey, payload) => {
    if (type === 'new_question') return `q|${norm(payload.text)}`
    if (type === 'new_profile') return `p|${norm(payload.name)}`
    if (type === 'new_option') return `o|${questionKey}|${norm(payload.label)}`
    if (type === 'rewrite') return `r|${questionKey}`
    return null
  }
  for (const s of open) {
    let p = {}
    try { p = JSON.parse(s.payload_json) || {} } catch {}
    const k = keyOf(s.type, s.question_key, p)
    if (k) seen.add(k)
  }
  const insert = db.prepare(`
    INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  let created = 0
  const add = (type, funnelId, questionKey, payload, raw) => {
    const k = keyOf(type, questionKey, payload)
    if (seen.has(k)) return
    seen.add(k)
    insert.run(accountId, funnelId, questionKey, type, JSON.stringify(payload), evidence(raw), nowStr)
    created++
  }

  db.transaction(() => {
    for (const raw of (Array.isArray(input.new_questions) ? input.new_questions : []).slice(0, LIMITS.questions)) {
      const text = str(raw?.text).slice(0, 500)
      const options = (Array.isArray(raw?.options) ? raw.options : [])
        .map(o => ({ label: str(o?.label).slice(0, 200), points: clampPoints(o?.points) }))
        .filter(o => o.label).slice(0, 10)
      if (!text || options.length < 2) continue
      const r = roteiros.find(x => x.funnel.id === Number(raw.funnel_id)) || (roteiros.length === 1 ? roteiros[0] : null)
      if (!r) continue
      const stage = r.conversation.find(s => s.id === Number(raw.stage_id)) || r.conversation[0]
      const profileKey = raw.profile_key && profileName.has(raw.profile_key) ? raw.profile_key : null
      add('new_question', r.funnel.id, null, {
        stage_id: stage.id, stage_name: stage.name, text, spin: SPIN_KEYS.includes(raw.spin) ? raw.spin : null,
        profile_key: profileKey, profile_name: profileKey ? profileName.get(profileKey) : null, options,
      }, raw)
    }

    // So o que cabe: perfil novo com 6 perfis na conta nunca daria para aplicar.
    const existingNames = new Set(business.profiles.map(p => norm(p.name)))
    const pendingProfiles = open.filter(x => x.type === 'new_profile' && x.status === 'new').length
    let freeSlots = Math.max(0, MAX_PROFILES - business.profiles.length - pendingProfiles)
    for (const raw of (Array.isArray(input.new_profiles) ? input.new_profiles : []).slice(0, LIMITS.profiles)) {
      const name = str(raw?.name).slice(0, 60)
      if (!name || existingNames.has(norm(name)) || freeSlots <= 0) continue
      const before = created
      add('new_profile', null, null, { name, description: str(raw?.description).slice(0, 500) }, raw)
      if (created > before) freeSlots--
    }

    for (const raw of (Array.isArray(input.new_options) ? input.new_options : []).slice(0, LIMITS.options)) {
      const found = questionsByKey.get(raw?.question_key)
      const label = str(raw?.label).slice(0, 200)
      if (!found || found.q.kind !== 'options' || !label) continue
      if (found.q.options.some(o => norm(o.label) === norm(label))) continue
      add('new_option', found.funnelId, found.q.question_key, { question_key: found.q.question_key, label, count: countOf(raw.count) || 0 }, raw)
    }

    for (const raw of (Array.isArray(input.rewrites) ? input.rewrites : []).slice(0, LIMITS.rewrites)) {
      const found = questionsByKey.get(raw?.question_key)
      const versions = (Array.isArray(raw?.versions) ? raw.versions : []).map(v => str(v).slice(0, 500)).filter(Boolean)
      if (!found || versions.length < 2) continue
      // Pergunta em teste A/B: reescrever agora mudaria a versao A no meio do teste.
      if (activeVariant(db, accountId, found.q.question_key)) continue
      add('rewrite', found.funnelId, found.q.question_key, { versions: versions.slice(0, 2), current_rate: null }, raw)
    }
  })()
  return created
}

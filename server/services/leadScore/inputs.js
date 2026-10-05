// Coleta os dados de entrada para computeLeadScore a partir do banco (spec 5.1).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { getPublishedQuestions } from '../roteiro/repo.js'
import { hasSignalLast7d, hasConfirmedWeakLast7d } from '../signals/repo.js'
import { SPIN_LABEL } from '../roteiro/spinTemplate.js'
import { appliesToLead, effectiveProfileKey } from '../roteiro/profiles.js'

const DAY_MS = 86400000

// Datas do SQLite sao 'YYYY-MM-DD HH:MM:SS' em UTC sem timezone -> Date.parse trata como local sem o 'Z'.
export function parseSqliteDate(s) {
  if (!s) return null
  const ms = Date.parse(String(s).replace(' ', 'T') + 'Z')
  return Number.isFinite(ms) ? ms : null
}

export function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function questionShortLabel(q) {
  if (q.spin && SPIN_LABEL[q.spin]) return SPIN_LABEL[q.spin]
  return String(q.text || '').slice(0, 40)
}

// Perfil (0..50 na computeLeadScore): soma das opcoes respondidas x maximo possivel.
// So perguntas do perfil de cliente do lead (spec 2026-10-02 §5).
function buildFit(db, lead) {
  const leadId = lead.id
  const questions = lead.funnel_id ? getPublishedQuestions(db, lead.account_id, lead.funnel_id) : []
  const leadProfile = effectiveProfileKey(db, lead)
  const optionQuestions = questions.filter(q => q.kind === 'options' && appliesToLead(q, leadProfile))
  const answers = db.prepare('SELECT question_key, option_key FROM lead_answers WHERE lead_id = ?').all(leadId)
  const answerByKey = new Map(answers.map(a => [a.question_key, a]))

  let obtained = 0
  let max = 0
  let answeredCount = 0
  const reasons = []
  for (const q of optionQuestions) {
    const points = (q.options || []).map(o => o.points)
    max += Math.max(0, ...points, 0)
    const answer = answerByKey.get(q.question_key)
    if (answer && answer.option_key) {
      answeredCount++
      const opt = (q.options || []).find(o => o.option_key === answer.option_key)
      if (opt) {
        obtained += opt.points
        reasons.push({ texto: `${questionShortLabel(q)}: ${opt.label}`, pontos: opt.points })
      }
    }
  }
  return { obtained, max, answeredCount, totalCount: optionQuestions.length, reasons }
}

// Sequencias de outbound consecutivos (quebradas por qualquer inbound no meio).
function buildOutboundSequences(msgs) {
  const sequences = []
  let current = null
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].direction === 'outbound') {
      if (!current) current = { endIndex: i, endTs: msgs[i]._ts }
      else { current.endIndex = i; current.endTs = msgs[i]._ts }
    } else if (current) {
      sequences.push(current)
      current = null
    }
  }
  if (current) sequences.push(current)
  return sequences
}

// Engajamento (0..50 na computeLeadScore): recencia, rapidez, reciprocidade, intensidade.
function buildEngagement(db, lead, account, nowMs) {
  const rowsDesc = db.prepare('SELECT direction, content, created_at FROM messages WHERE lead_id = ? ORDER BY created_at DESC, id DESC LIMIT 200').all(lead.id)
  const msgs = rowsDesc.slice().reverse().map(m => ({ ...m, _ts: parseSqliteDate(m.created_at) }))

  let daysSinceLastInbound = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === 'inbound' && msgs[i]._ts != null) {
      daysSinceLastInbound = Math.max(0, (nowMs - msgs[i]._ts) / DAY_MS)
      break
    }
  }

  // replyDelaysMin: inbound que vem logo depois de um outbound -> delay ate o ultimo outbound anterior, 5 mais recentes.
  const delays = []
  for (let i = 1; i < msgs.length; i++) {
    if (msgs[i].direction === 'inbound' && msgs[i - 1].direction === 'outbound' && msgs[i]._ts != null && msgs[i - 1]._ts != null) {
      delays.push((msgs[i]._ts - msgs[i - 1]._ts) / 60000)
    }
  }
  const replyDelaysMin = delays.slice(-5)

  // lastOutboundReplied: 5 sequencias de outbound mais recentes, mais nova primeiro.
  const sequences = buildOutboundSequences(msgs)
  const lastFive = sequences.slice(-5).reverse()
  const lastOutboundReplied = lastFive.map(seq => {
    for (let i = seq.endIndex + 1; i < msgs.length; i++) {
      if (msgs[i].direction === 'inbound' && msgs[i]._ts != null && msgs[i]._ts <= seq.endTs + DAY_MS) return true
    }
    return false
  })

  const sevenDaysAgo = nowMs - 7 * DAY_MS
  const nowIso = new Date(nowMs).toISOString()
  const strongSignalLast7d = hasSignalLast7d(db, lead.id, 'strong', nowIso)
  const weakSignalConfirmedLast7d = hasConfirmedWeakLast7d(db, lead.id, nowIso)
  const negativeSignalLast7d = hasSignalLast7d(db, lead.id, 'negative', nowIso)

  const historyRows = db.prepare(`
    SELECT h.created_at, fs_from.position AS from_pos, fs_to.position AS to_pos
    FROM stage_history h
    LEFT JOIN funnel_stages fs_from ON fs_from.id = h.from_stage_id
    LEFT JOIN funnel_stages fs_to ON fs_to.id = h.to_stage_id
    WHERE h.lead_id = ?
  `).all(lead.id)
  const advancedLast7d = historyRows.some(h => {
    const ts = parseSqliteDate(h.created_at)
    return ts != null && ts >= sevenDaysAgo && h.from_pos != null && h.to_pos != null && h.to_pos > h.from_pos
  })

  const halfLifeDays = account && account.score_half_life_days != null ? account.score_half_life_days : 7

  return { daysSinceLastInbound, halfLifeDays, replyDelaysMin, lastOutboundReplied, advancedLast7d, strongSignalLast7d, weakSignalConfirmedLast7d, negativeSignalLast7d }
}

function buildAi(db, leadId, nowMs) {
  const insight = db.prepare('SELECT temperatura_lead, chance_conversao, analyzed_at FROM conversation_insights WHERE lead_id = ?').get(leadId)
  if (!insight || !insight.analyzed_at) return { temperatura: null, chance: null, analyzedDaysAgo: null }
  const ts = parseSqliteDate(insight.analyzed_at)
  if (ts == null) return { temperatura: null, chance: null, analyzedDaysAgo: null }
  return {
    temperatura: insight.temperatura_lead ?? null,
    chance: insight.chance_conversao ?? null,
    analyzedDaysAgo: Math.max(0, (nowMs - ts) / DAY_MS),
  }
}

// Monta o input de computeLeadScore para um lead. null se o lead nao existe.
export function gatherScoreInputs(db, leadId, { now = new Date() } = {}) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead) return null
  const account = db.prepare('SELECT score_half_life_days FROM accounts WHERE id = ?').get(lead.account_id)
  const nowMs = now.getTime()

  return {
    fit: buildFit(db, lead),
    engagement: buildEngagement(db, lead, account, nowMs),
    ai: buildAi(db, leadId, nowMs),
  }
}

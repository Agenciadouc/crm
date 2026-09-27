// Recalculo do termometro por lead: grava no banco e avisa o vendedor quando a faixa sobe (spec 5.1, 5.2, 5.5).
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { computeLeadScore } from './compute.js'
import { gatherScoreInputs } from './inputs.js'

export const SCORE_SCHEDULE_DELAY_MS = 5000
const HOT_BANDS = ['quente', 'pronto']

function sqliteNow(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

// Subiu pra quente/pronto: de frio/morno/sem faixa -> quente/pronto, ou de quente -> pronto.
function roseIntoHot(prevBand, nextBand) {
  if (!HOT_BANDS.includes(nextBand)) return false
  if (prevBand == null || prevBand === 'frio' || prevBand === 'morno') return true
  return prevBand === 'quente' && nextBand === 'pronto'
}

// Recalcula a nota de 1 lead e grava as colunas. null se o lead nao existe ou esta em etapa final (is_terminal).
// onChanged({ lead, score, band }): nota ou faixa mudou (tempo real; o noturno nao passa).
export function recalcLeadScore(db, leadId, { now = new Date(), onBandUp, onChanged } = {}) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead) return null

  const stage = lead.stage_id ? db.prepare('SELECT is_terminal FROM funnel_stages WHERE id = ?').get(lead.stage_id) : null
  if (stage && stage.is_terminal) return null

  const input = gatherScoreInputs(db, leadId, { now })
  if (!input) return null
  const result = computeLeadScore(input)

  const prevScore = lead.score ?? null
  const nowIso = sqliteNow(now)
  db.prepare(`
    UPDATE leads SET score = ?, score_band = ?, score_fit = ?, score_fit_grade = ?, score_engagement = ?,
      score_quadrant = ?, score_reasons_json = ?, score_prev = ?, score_at = ?
    WHERE id = ?
  `).run(result.score, result.band, result.fit, result.fitGrade, result.engagement, result.quadrant, JSON.stringify(result.reasons), prevScore, nowIso, leadId)

  if (typeof onChanged === 'function' && (prevScore !== result.score || (lead.score_band ?? null) !== result.band)) {
    try {
      onChanged({ lead: { id: lead.id, account_id: lead.account_id }, score: result.score, band: result.band })
    } catch (e) { console.error('[Termometro] aviso de nota:', e && e.message) }
  }

  if (roseIntoHot(lead.score_band ?? null, result.band)) {
    const today = nowIso.slice(0, 10)
    const alertedToday = lead.score_alerted_at && String(lead.score_alerted_at).slice(0, 10) === today
    if (!alertedToday) {
      if (typeof onBandUp === 'function') onBandUp({ lead, result })
      db.prepare('UPDATE leads SET score_alerted_at = ? WHERE id = ?').run(nowIso, leadId)
    }
  }

  return result
}

// Agendador com coalescencia: no maximo 1 recalculo por lead por janela (delayMs).
// schedule(id) so cria timer se nao houver um pendente pra esse lead; flushAll roda os pendentes na hora.
export function createScoreScheduler({ db, onBandUp, onChanged, delayMs = SCORE_SCHEDULE_DELAY_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map() // leadId -> handle

  function runOne(leadId) {
    pending.delete(leadId)
    try {
      recalcLeadScore(db, leadId, { onBandUp, onChanged })
    } catch (e) {
      console.error('[Termometro]', e && e.message)
    }
  }

  function schedule(leadId) {
    if (pending.has(leadId)) return
    const handle = setTimer(() => runOne(leadId), delayMs)
    pending.set(leadId, handle)
  }

  function flushAll() {
    const ids = [...pending.keys()]
    for (const id of ids) {
      const handle = pending.get(id)
      if (handle != null) { try { clearTimer(handle) } catch {} }
      runOne(id)
    }
  }

  return { schedule, flushAll }
}

// Singleton de producao: configura 1x na inicializacao, o resto do app so chama scheduleScore(leadId).
let runtimeScheduler = null
let runtimeOnBandUp = null

export function configureScoreRuntime({ db, onBandUp, onChanged }) {
  runtimeOnBandUp = onBandUp || null
  runtimeScheduler = createScoreScheduler({ db, onBandUp, onChanged })
}

// Aviso de faixa subindo configurado na inicializacao (usado pelo recalculo noturno).
export function getRuntimeOnBandUp() {
  return runtimeOnBandUp
}

export function scheduleScore(leadId) {
  if (!runtimeScheduler) return
  runtimeScheduler.schedule(leadId)
}

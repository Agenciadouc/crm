// Medicao do roteiro (spec 3.2, 6.3): taxas por pergunta e por vendedor, taxa de venda por faixa do termometro.
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { getPublishedQuestions } from './repo.js'
import { resolveNow, shiftFromNow } from './time.js'
import { BANDS } from '../leadScore/compute.js'

export const MIN_SAMPLE = 20
export const DEFAULT_MIN_REPLY_RATE = 70

// Percentual com 1 casa (n*100/total evita erro de ponto flutuante); null sem base.
export function pct(n, total) {
  if (!total) return null
  return Math.round((n * 1000) / total) / 10
}

export function accountMinReplyRate(db, accountId) {
  const row = db.prepare('SELECT roteiro_min_reply_rate FROM accounts WHERE id = ?').get(accountId)
  return row?.roteiro_min_reply_rate ?? DEFAULT_MIN_REPLY_RATE
}

function statusFor(sent, replyRate, min) {
  if (sent < MIN_SAMPLE) return 'amostra_pequena'
  return replyRate < min ? 'fraca' : 'ok'
}

// Por vendedor: envios, taxa e ate 3 textos distintos (o mais usado primeiro).
function bySeller(db, accountId, questionKey, since, until) {
  const rows = db.prepare(`
    SELECT a.user_id, u.name, COUNT(*) AS sent, SUM(CASE WHEN a.replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
    FROM roteiro_asks a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.account_id = ? AND a.question_key = ? AND a.asked_at >= ? AND a.asked_at <= ? AND a.user_id IS NOT NULL
    GROUP BY a.user_id
  `).all(accountId, questionKey, since, until)
  const examplesStmt = db.prepare(`
    SELECT text_sent, COUNT(*) AS n FROM roteiro_asks
    WHERE account_id = ? AND question_key = ? AND user_id = ? AND asked_at >= ? AND asked_at <= ?
      AND text_sent IS NOT NULL AND TRIM(text_sent) <> ''
    GROUP BY text_sent ORDER BY n DESC, MAX(asked_at) DESC LIMIT 3
  `)
  return rows
    .map(r => ({
      user_id: r.user_id,
      name: r.name ?? null,
      sent: r.sent,
      reply_rate: pct(r.replied, r.sent),
      examples: examplesStmt.all(accountId, questionKey, r.user_id, since, until).map(e => e.text_sent),
    }))
    .sort((a, b) => (b.reply_rate ?? -1) - (a.reply_rate ?? -1) || b.sent - a.sent)
}

// Taxas de cada pergunta publicada do funil nos ultimos `days` dias.
export function questionMetrics(db, { accountId, funnelId, days = 90, now } = {}) {
  const questions = getPublishedQuestions(db, accountId, funnelId)
  const min = accountMinReplyRate(db, accountId)
  const until = resolveNow(db, now)
  const since = shiftFromNow(db, until, `-${days} days`)
  const totalsStmt = db.prepare(`
    SELECT COUNT(*) AS sent,
      SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN advanced_at IS NOT NULL THEN 1 ELSE 0 END) AS advanced,
      SUM(CASE WHEN bought_at IS NOT NULL THEN 1 ELSE 0 END) AS bought
    FROM roteiro_asks WHERE account_id = ? AND question_key = ? AND asked_at >= ? AND asked_at <= ?
  `)
  return questions.map(q => {
    const t = totalsStmt.get(accountId, q.question_key, since, until)
    const sent = t.sent || 0
    const replyRate = pct(t.replied || 0, sent)
    return {
      question_key: q.question_key,
      text: q.text,
      stage_id: q.stage_id,
      sent,
      reply_rate: replyRate,
      advanced_rate: pct(t.advanced || 0, sent),
      bought_rate: pct(t.bought || 0, sent),
      status: statusFor(sent, replyRate, min),
      by_seller: bySeller(db, accountId, q.question_key, since, until),
    }
  })
}

// Dos leads que estavam em cada faixa ha 30 dias (retrato lead_score_daily), quantos compraram depois.
// warning: Pronto vende igual ou menos que Morno (com >= 10 leads em cada) -> termometro nao separa bem.
export function conversionByBand(db, { accountId, now } = {}) {
  const day = shiftFromNow(db, resolveNow(db, now), '-30 days').slice(0, 10)
  const rows = db.prepare(`
    SELECT d.band, COUNT(*) AS leads,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = d.lead_id AND COALESCE(s.sale_date, s.created_at) >= d.day)
        OR EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages fs ON fs.id = h.to_stage_id
                   WHERE h.lead_id = d.lead_id AND fs.is_conversion = 1 AND h.created_at >= d.day)
        THEN 1 ELSE 0 END) AS bought
    FROM lead_score_daily d
    WHERE d.account_id = ? AND d.day = ?
    GROUP BY d.band
  `).all(accountId, day)
  const byBand = new Map(rows.map(r => [r.band, r]))
  const bands = BANDS.map(band => {
    const r = byBand.get(band)
    const leads = r?.leads || 0
    const bought = r?.bought || 0
    return { band, leads, bought, rate: pct(bought, leads) }
  })
  const pronto = bands.find(b => b.band === 'pronto')
  const morno = bands.find(b => b.band === 'morno')
  const warning = pronto.leads >= 10 && morno.leads >= 10 && pronto.rate <= morno.rate
  return { bands, warning }
}

// Recalculo noturno do termometro (spec 5.2, 6.3): meia-vida por conta, nota de todos os leads ativos em lotes,
// retrato diario (lead_score_daily) e aprendizado do roteiro. Nao importa server/db.js: recebe db.
import { recalcLeadScore, getRuntimeOnBandUp } from './recalc.js'
import { computeHalfLife, accountCycleDays } from './halfLife.js'
import { runLearning } from '../roteiro/learning.js'
import { runWeeklyReview } from '../roteiro/weeklyReview.js'
import { toSqliteDate } from '../roteiro/time.js'

const KEEP_DAYS = 120
const DAY_MS = 86400000

// Libera o event loop entre lotes (o servidor continua atendendo durante o recalculo).
const yieldLoop = () => new Promise(resolve => setImmediate(resolve))

function listAccountIds(db) {
  const hasActive = db.prepare('PRAGMA table_info(accounts)').all().some(c => c.name === 'is_active')
  return db.prepare(`SELECT id FROM accounts${hasActive ? ' WHERE is_active = 1' : ''} ORDER BY id`).all().map(r => r.id)
}

// aiForAccount(accountId) -> adaptador de IA ou null (conta sem chave/orcamento roda sem IA).
export async function runScoreNightly(db, { now = new Date(), batchSize = 200, onBandUp, aiForAccount = null } = {}) {
  const bandUp = onBandUp || getRuntimeOnBandUp() || undefined
  const day = toSqliteDate(now).slice(0, 10)
  const oldestDay = toSqliteDate(new Date(now.getTime() - KEEP_DAYS * DAY_MS)).slice(0, 10)
  const snapshot = db.prepare('INSERT OR REPLACE INTO lead_score_daily (lead_id, account_id, day, score, band) VALUES (?, ?, ?, ?, ?)')
  const totals = { accounts: 0, leads: 0, errors: 0, suggestions: 0 }

  for (const accountId of listAccountIds(db)) {
    try {
      const halfLife = computeHalfLife(accountCycleDays(db, accountId))
      db.prepare('UPDATE accounts SET score_half_life_days = ? WHERE id = ?').run(halfLife, accountId)

      const leadIds = db.prepare(`
        SELECT l.id FROM leads l LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
        WHERE l.account_id = ? AND COALESCE(l.is_active, 1) = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(fs.is_terminal, 0) = 0
        ORDER BY l.id
      `).all(accountId).map(r => r.id)

      for (let i = 0; i < leadIds.length; i += batchSize) {
        for (const leadId of leadIds.slice(i, i + batchSize)) {
          try {
            const result = recalcLeadScore(db, leadId, { now, onBandUp: bandUp })
            if (result) {
              snapshot.run(leadId, accountId, day, result.score, result.band)
              totals.leads++
            }
          } catch (e) {
            totals.errors++
            console.error('[Termometro] noturno lead', leadId, e.message)
          }
        }
        await yieldLoop()
      }

      db.prepare('DELETE FROM lead_score_daily WHERE account_id = ? AND day < ?').run(accountId, oldestDay)

      let ai = null
      try { ai = typeof aiForAccount === 'function' ? aiForAccount(accountId) : null } catch (e) { console.error('[Termometro] IA da conta', accountId, e.message) }
      const learned = await runLearning(db, { accountId, now, ai })
      totals.suggestions += learned.created
      // Revisao semanal (spec 2026-10-02 §10): so com IA; ela mesma confere se ja passou 1 semana.
      if (ai) {
        try {
          const weekly = await runWeeklyReview(db, { accountId, ai, now })
          totals.suggestions += weekly.created
        } catch (e) { console.error('[Roteiro] revisao semanal da conta', accountId, e.message) }
      }
      totals.accounts++
    } catch (e) {
      totals.errors++
      console.error('[Termometro] noturno conta', accountId, e.message)
    }
  }
  return totals
}

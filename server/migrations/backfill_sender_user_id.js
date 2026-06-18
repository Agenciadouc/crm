// Backfill best-effort de messages.sent_by_user_id baseado em sender_name.
// Roda 1x manualmente após deploy V2. Idempotente — só toca msgs onde sent_by_user_id IS NULL.
//
// Match: case-insensitive trim de sender_name == users.name dentro do mesmo account_id,
// para msgs outbound humanas (ai_agent_id IS NULL, follow_up_id IS NULL).
// Se 0 ou 2+ matches no account, deixa NULL — UI mostra "Atendente desconhecido".
//
// Uso:
//   node server/migrations/backfill_sender_user_id.js
//   node server/migrations/backfill_sender_user_id.js --dry-run

import db from '../db.js'

const dryRun = process.argv.includes('--dry-run')

function norm(s) {
  if (!s) return ''
  return String(s).trim().toLowerCase().replace(/\s+/g, ' ')
}

function run() {
  console.log(`[Backfill] sent_by_user_id (dry-run=${dryRun})`)

  // 1. Coleta candidatos: msgs outbound humanas sem atribuição.
  const candidates = db.prepare(`
    SELECT id, lead_id, account_id, sender_name
    FROM messages
    WHERE direction = 'outbound'
      AND ai_agent_id IS NULL
      AND (follow_up_id IS NULL)
      AND sent_by_user_id IS NULL
      AND sender_name IS NOT NULL
      AND TRIM(sender_name) != ''
      AND sender_name != 'Follow-up auto'
      AND sender_name NOT LIKE 'IA%'
      AND sender_name NOT LIKE 'Bot%'
  `).all()

  console.log(`[Backfill] Candidatos encontrados: ${candidates.length}`)
  if (candidates.length === 0) {
    console.log('[Backfill] Nada a fazer.')
    return
  }

  // 2. Cache users por account: account_id => Map(norm_name => [user_id, ...])
  const userCache = new Map()
  function getUsersForAccount(accountId) {
    if (userCache.has(accountId)) return userCache.get(accountId)
    const users = db.prepare(`
      SELECT id, name FROM users
      WHERE (account_id = ? OR account_id IS NULL)
        AND COALESCE(is_bot, 0) = 0
    `).all(accountId)
    const byNormName = new Map()
    for (const u of users) {
      const k = norm(u.name)
      if (!k) continue
      if (!byNormName.has(k)) byNormName.set(k, [])
      byNormName.get(k).push(u.id)
    }
    userCache.set(accountId, byNormName)
    return byNormName
  }

  // 3. Processa
  let matched = 0
  let ambiguous = 0
  let nomatch = 0
  const updateStmt = db.prepare('UPDATE messages SET sent_by_user_id = ? WHERE id = ?')

  const tx = db.transaction(() => {
    for (const m of candidates) {
      const byNorm = getUsersForAccount(m.account_id)
      const hits = byNorm.get(norm(m.sender_name))
      if (!hits || hits.length === 0) {
        nomatch++
        continue
      }
      if (hits.length > 1) {
        ambiguous++
        continue
      }
      if (!dryRun) updateStmt.run(hits[0], m.id)
      matched++
    }
  })
  tx()

  console.log(`[Backfill] matched=${matched} ambiguous=${ambiguous} nomatch=${nomatch}`)
  if (dryRun) console.log('[Backfill] DRY RUN — nenhum UPDATE aplicado.')
  else console.log('[Backfill] OK — UPDATEs aplicados.')
}

run()
process.exit(0)

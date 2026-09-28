// Migracao unica (spec 2026-09-27 §6): cada etapa com perguntas publicadas e sem cadencia da
// etapa ganha a cadencia "<Etapa>" com os passos pergunta na ordem do roteiro; leads ativos
// dessas etapas ganham a lead_cadences kind='etapa'. Nenhuma mensagem sai; nada e apagado.
// Falha isolada por conta; a marca e gravada no fim para nao travar o boot. Recebe db.
import { getPublishedQuestions } from '../roteiro/repo.js'
import { attachLeadsInStage } from './leadCadence.js'
import { acceptsPergunta } from './schema.js'

export const CADENCIA_ETAPA_FLAG = 'cadencia_etapa_migrada'

function migrateAccount(db, accountId, funnelIds) {
  let cadences = 0
  let leads = 0
  const stageStmt = db.prepare('SELECT id, name, is_terminal FROM funnel_stages WHERE funnel_id = ? ORDER BY position')
  const hasCad = db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1')
  const insCad = db.prepare('INSERT INTO cadences (account_id, name, funnel_id, stage_id) VALUES (?, ?, ?, ?)')
  const insStep = db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type, description, question_key) VALUES (?, ?, 'pergunta', ?, ?)")
  for (const funnelId of funnelIds) {
    const questions = getPublishedQuestions(db, accountId, funnelId) // 404 se o funil nao e da conta
    for (const stage of stageStmt.all(funnelId)) {
      if (stage.is_terminal) continue
      const qs = questions.filter(q => q.stage_id === stage.id).sort((a, b) => a.position - b.position)
      if (!qs.length || hasCad.get(stage.id)) continue
      const cadenceId = Number(insCad.run(accountId, stage.name, funnelId, stage.id).lastInsertRowid)
      qs.forEach((q, i) => insStep.run(cadenceId, i, q.text, q.question_key))
      cadences++
      leads += attachLeadsInStage(db, { accountId, cadenceId })
    }
  }
  return { cadences, leads }
}

export function migrateStageCadences(db) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG)) return { accounts: 0, cadences: 0, leads: 0, skipped: true }
  if (!acceptsPergunta(db)) {
    console.error("[Cadencia] migracao adiada: a tabela de passos ainda nao aceita 'pergunta'")
    return { accounts: 0, cadences: 0, leads: 0, skipped: true }
  }
  const rows = db.prepare("SELECT DISTINCT account_id, funnel_id FROM roteiro_versions WHERE status = 'published' ORDER BY account_id, funnel_id").all()
  const byAccount = new Map()
  for (const r of rows) {
    if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, [])
    byAccount.get(r.account_id).push(r.funnel_id)
  }
  let accounts = 0
  let cadences = 0
  let leads = 0
  for (const [accountId, funnelIds] of byAccount) {
    try {
      db.transaction(() => {
        const r = migrateAccount(db, accountId, funnelIds)
        cadences += r.cadences
        leads += r.leads
      })()
      accounts++
    } catch (err) {
      console.error(`[Cadencia] migracao da conta ${accountId}: ${err.message}`)
    }
  }
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CADENCIA_ETAPA_FLAG, new Date().toISOString())
  return { accounts, cadences, leads, skipped: false }
}

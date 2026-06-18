// Script EXECUTOR — dispara welcome pros leads listados pelo CONFERIR.
// Stagger 45s entre cada. Idempotente (so leads sem ai_first_msg_sent_at).
// Variacao automatica: Haiku gera msg unica pra cada lead.

import db from './server/db.js'
import { sendBotWelcomeForSheetsLead } from './server/services/aiAgent.js'

const STAGGER_MS = 45000  // 45s

const account = db.prepare("SELECT id, name FROM accounts WHERE name LIKE '%OXI%' OR name LIKE '%Oxi%' LIMIT 1").get()
if (!account) { console.error('Conta OXI nao encontrada'); process.exit(1) }

const agent = db.prepare("SELECT * FROM ai_agents WHERE account_id = ? AND is_active = 1 ORDER BY id LIMIT 1").get(account.id)
if (!agent) { console.error('Nenhum agente ativo'); process.exit(1) }

if (!agent.send_welcome_for_sheets_leads && !process.argv.includes('--force-flag')) {
  console.error('Flag send_welcome_for_sheets_leads = 0. Use --force-flag pra ligar temporariamente.')
  process.exit(1)
}

const tagDros = db.prepare("SELECT id FROM tags WHERE account_id = ? AND LOWER(name) LIKE '%lead%dros%' LIMIT 1").get(account.id)
const defaultInst = db.prepare("SELECT id, instance_name FROM whatsapp_instances WHERE account_id = ? AND status='connected' ORDER BY id LIMIT 1").get(account.id)
if (!defaultInst) { console.error('Nenhuma instancia conectada'); process.exit(1) }

const leads = db.prepare(`
  SELECT id, name, phone, instance_id
  FROM leads
  WHERE account_id = ? AND attendant_id = ? AND is_active = 1
    AND COALESCE(is_archived, 0) = 0 AND COALESCE(is_blocked, 0) = 0
    AND ai_first_msg_sent_at IS NULL
    AND phone IS NOT NULL AND TRIM(phone) != ''
  ORDER BY id
`).all(account.id, agent.user_id)

console.log(`📋 ${leads.length} leads a processar`)
console.log(`⏱  Tempo total estimado: ${Math.ceil(leads.length * STAGGER_MS / 60000)}min`)
console.log(`🚀 Iniciando em 5s... (Ctrl+C pra abortar)`)
console.log('')
await new Promise(r => setTimeout(r, 5000))

let restoreFlag = false
if (process.argv.includes('--force-flag') && !agent.send_welcome_for_sheets_leads) {
  console.log('🔧 Ligando flag send_welcome_for_sheets_leads temporariamente...')
  db.prepare('UPDATE ai_agents SET send_welcome_for_sheets_leads = 1 WHERE id = ?').run(agent.id)
  restoreFlag = true
}

let okCount = 0, skipCount = 0, errCount = 0
const startedAt = Date.now()

for (let i = 0; i < leads.length; i++) {
  const lead = leads[i]
  const idx = `[${i+1}/${leads.length}]`
  try {
    if (tagDros) db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, tagDros.id)
    const instId = lead.instance_id || defaultInst.id
    const before = db.prepare('SELECT ai_first_msg_sent_at FROM leads WHERE id = ?').get(lead.id)
    await sendBotWelcomeForSheetsLead(lead.id, instId)
    const after = db.prepare('SELECT ai_first_msg_sent_at FROM leads WHERE id = ?').get(lead.id)
    if (after.ai_first_msg_sent_at && !before.ai_first_msg_sent_at) {
      okCount++
      const nome = (lead.name || lead.phone).slice(0, 30)
      console.log(`${idx} ✅ lead=${lead.id} ${nome}`)
    } else {
      skipCount++
      console.log(`${idx} ⏭  lead=${lead.id} SKIP (filtro do findAgentForLead — ver pm2 logs)`)
    }
  } catch (e) {
    errCount++
    console.error(`${idx} ❌ lead=${lead.id} erro: ${e.message}`)
  }

  if (i < leads.length - 1) {
    process.stdout.write(`     aguardando 45s... `)
    await new Promise(r => setTimeout(r, STAGGER_MS))
    process.stdout.write(`\n`)
  }
}

if (restoreFlag) {
  console.log('\n🔧 Restaurando flag pro estado original (0)...')
  db.prepare('UPDATE ai_agents SET send_welcome_for_sheets_leads = 0 WHERE id = ?').run(agent.id)
}

const elapsedMin = Math.round((Date.now() - startedAt) / 60000)
console.log('')
console.log('='.repeat(60))
console.log(`📊 RESUMO`)
console.log('='.repeat(60))
console.log(`✅ Enviados : ${okCount}`)
console.log(`⏭  Skipped  : ${skipCount}`)
console.log(`❌ Erros    : ${errCount}`)
console.log(`📋 Total    : ${leads.length}`)
console.log(`⏱  Tempo    : ${elapsedMin}min`)
console.log('='.repeat(60))
proce

// Script de CONFERENCIA — so lista quem seria processado, NAO envia nada.
//
// Uso: cd /root/crm && node bulk-welcome-CONFERIR.mjs

import db from './server/db.js'

const account = db.prepare("SELECT id, name FROM accounts WHERE name LIKE '%OXI%' OR name LIKE '%Oxi%' LIMIT 1").get()
if (!account) { console.error('Conta OXI nao encontrada'); process.exit(1) }

const agent = db.prepare("SELECT * FROM ai_agents WHERE account_id = ? AND is_active = 1 ORDER BY id LIMIT 1").get(account.id)
if (!agent) { console.error('Nenhum agente ativo'); process.exit(1) }

const tagDros = db.prepare("SELECT id, name FROM tags WHERE account_id = ? AND LOWER(name) LIKE '%lead%dros%' LIMIT 1").get(account.id)
const defaultInst = db.prepare("SELECT id, instance_name FROM whatsapp_instances WHERE account_id = ? AND status='connected' ORDER BY id LIMIT 1").get(account.id)

console.log('='.repeat(70))
console.log('CONFERENCIA — Bulk Welcome OXI Quimica')
console.log('='.repeat(70))
console.log(`Conta:        ${account.name} (id=${account.id})`)
console.log(`Agente:       ${agent.name} (id=${agent.id}, user_bot=${agent.user_id})`)
console.log(`Flag welcome: ${agent.send_welcome_for_sheets_leads ? 'ON ✅' : 'OFF ❌ (use --force-flag no script 2)'}`)
console.log(`Tag DROS:     ${tagDros ? `"${tagDros.name}" (id=${tagDros.id})` : 'NAO encontrada ⚠️'}`)
console.log(`Inst default: ${defaultInst ? `${defaultInst.instance_name} (id=${defaultInst.id})` : 'Nenhuma conectada ❌'}`)
console.log('')

const leads = db.prepare(`
  SELECT l.id, l.name, l.phone, l.instance_id, i.instance_name,
    (SELECT COUNT(*) FROM messages WHERE lead_id = l.id) as msgs,
    (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id) as ultima_msg
  FROM leads l
  LEFT JOIN whatsapp_instances i ON i.id = l.instance_id
  WHERE l.account_id = ? AND l.attendant_id = ? AND l.is_active = 1
    AND COALESCE(l.is_archived, 0) = 0
    AND COALESCE(l.is_blocked, 0) = 0
    AND l.ai_first_msg_sent_at IS NULL
    AND l.phone IS NOT NULL AND TRIM(l.phone) != ''
  ORDER BY l.id
`).all(account.id, agent.user_id)

console.log(`📋 TOTAL DE LEADS A PROCESSAR: ${leads.length}`)
console.log(`⏱  Tempo estimado: ${Math.ceil(leads.length * 45 / 60)}min (stagger 45s)`)
console.log('='.repeat(70))
console.log('')
console.log('# | Lead ID | Nome                          | Phone           | Inst              | Msgs | Última msg')
console.log('-'.repeat(110))

leads.forEach((l, i) => {
  const nome = (l.name || '').padEnd(30).slice(0, 30)
  const phone = (l.phone || '').padEnd(15).slice(0, 15)
  const inst = (l.instance_name || '(usa default)').padEnd(18).slice(0, 18)
  const msgs = String(l.msgs).padStart(4)
  const ultima = l.ultima_msg ? l.ultima_msg.slice(0, 16) : '(nenhuma)'
  console.log(`${String(i+1).padStart(2)} | ${String(l.id).padStart(7)} | ${nome} | ${phone} | ${inst} | ${msgs} | ${ultima}`)
})

console.log('-'.repeat(110))
console.log('')
console.log(`Pra executar o disparo de verdade, roda: node bulk-welcome-EXECUTAR.mjs`)
console.log('(esse arquivo so faz conferencia — nao enviou nada)')
process.exit(0)

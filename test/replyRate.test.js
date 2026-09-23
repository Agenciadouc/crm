import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { computeReplyRate, checkReplyRates } from '../server/services/replyRate.js'

function withBroadcasts(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, instance_id INTEGER);
    CREATE TABLE IF NOT EXISTS broadcast_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT, broadcast_id INTEGER, lead_id INTEGER, phone TEXT, status TEXT, sent_at TEXT)
  `)
  return db
}

function withAlerts(db) {
  db.exec(`CREATE TABLE analyst_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER,
    type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, description TEXT, suggested_action TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  return db
}

function scenario(db, { leads, replies }) {
  withBroadcasts(db)
  const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  for (let i = 0; i < leads; i++) {
    const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: String(5547990000000 + i) })
    db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, delivery_status, created_at)
      VALUES (?, ?, 'outbound', 'oi', ?, 'delivered', datetime('now', '-2 days'))`).run(lead.id, s.account.id, s.instance.id)
    if (i < replies) {
      db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, created_at)
        VALUES (?, ?, 'inbound', 'ola', ?, datetime('now', '-2 days', '+3 hours'))`).run(lead.id, s.account.id, s.instance.id)
    }
  }
  return s
}

test('menos de 20 leads: sem taxa', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 19, replies: 0 })
  assert.deepEqual(computeReplyRate(db, s.instance.id), { reached: 19, replied: 0, rate: null })
})

test('taxa = responderam em 24h / receberam', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 20, replies: 5 })
  assert.deepEqual(computeReplyRate(db, s.instance.id), { reached: 20, replied: 5, rate: 0.25 })
})

test('mensagem manual (sent_by_user_id) nao conta como automatica', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 20, replies: 0 })
  db.prepare('UPDATE messages SET sent_by_user_id = 1').run()
  assert.equal(computeReplyRate(db, s.instance.id).reached, 0)
})

test('abaixo de 10%: cria um alerta so (nao repete)', () => {
  const db = withAlerts(createTestDb()); const s = scenario(db, { leads: 20, replies: 1 })
  const r1 = checkReplyRates(db)
  assert.equal(r1.length, 1)
  assert.equal(r1[0].instanceId, s.instance.id)
  checkReplyRates(db)
  const alerts = db.prepare("SELECT * FROM analyst_alerts WHERE type = 'send_number_low_reply'").all()
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].title, /inst-teste/)
})

test('limite editavel por conta e numero Evolution ignorado', () => {
  const db = withAlerts(createTestDb()); const s = scenario(db, { leads: 20, replies: 5 })
  assert.equal(checkReplyRates(db).length, 0)
  db.prepare('UPDATE accounts SET reply_rate_alert_pct = 30 WHERE id = ?').run(s.account.id)
  assert.equal(checkReplyRates(db).length, 1)
  db.prepare("DELETE FROM analyst_alerts").run()
  db.prepare("UPDATE whatsapp_instances SET provider = 'evolution'").run()
  assert.equal(checkReplyRates(db).length, 0)
})

test('disparos em massa (broadcasts): 20 leads atingidos, 5 responderam', () => {
  const db = createTestDb(); withBroadcasts(db)
  const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  const broadcastId = db.prepare('INSERT INTO broadcasts (account_id, instance_id) VALUES (?, ?)').run(s.account.id, s.instance.id).lastInsertRowid
  for (let i = 0; i < 20; i++) {
    const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: String(5547990000000 + i) })
    db.prepare(`INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone, status, sent_at)
      VALUES (?, ?, ?, 'delivered', datetime('now', '-2 days'))`).run(broadcastId, lead.id, String(5547990000000 + i))
    if (i < 5) {
      db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, created_at)
        VALUES (?, ?, 'inbound', 'ola', ?, datetime('now', '-2 days', '+3 hours'))`).run(lead.id, s.account.id, s.instance.id)
    }
  }
  assert.deepEqual(computeReplyRate(db, s.instance.id), { reached: 20, replied: 5, rate: 0.25 })
})

test('lead atingido por mensagem e disparo em massa conta uma vez', () => {
  const db = createTestDb(); withBroadcasts(db)
  const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  const broadcastId = db.prepare('INSERT INTO broadcasts (account_id, instance_id) VALUES (?, ?)').run(s.account.id, s.instance.id).lastInsertRowid
  // Cria 20 leads para ter rate calculada
  for (let i = 0; i < 20; i++) {
    const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: String(5547990000000 + i) })
    if (i === 0) {
      // Lead 0: recebe mensagem E broadcast
      db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, delivery_status, created_at)
        VALUES (?, ?, 'outbound', 'oi', ?, 'delivered', datetime('now', '-2 days'))`).run(lead.id, s.account.id, s.instance.id)
      db.prepare(`INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone, status, sent_at)
        VALUES (?, ?, ?, 'delivered', datetime('now', '-2 days'))`).run(broadcastId, lead.id, String(5547990000000 + i))
      db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, created_at)
        VALUES (?, ?, 'inbound', 'ola', ?, datetime('now', '-2 days', '+3 hours'))`).run(lead.id, s.account.id, s.instance.id)
    } else {
      // Demais leads: só broadcast
      db.prepare(`INSERT INTO broadcast_recipients (broadcast_id, lead_id, phone, status, sent_at)
        VALUES (?, ?, ?, 'delivered', datetime('now', '-2 days'))`).run(broadcastId, lead.id, String(5547990000000 + i))
    }
  }
  // Deve contar todos os 20 leads uma vez cada (o lead 0 conta de ambas as fontes como um só)
  const result = computeReplyRate(db, s.instance.id)
  assert.equal(result.reached, 20)
  assert.equal(result.replied, 1)
})

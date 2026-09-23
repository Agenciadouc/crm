import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { computeReplyRate, checkReplyRates } from '../server/services/replyRate.js'

function withAlerts(db) {
  db.exec(`CREATE TABLE analyst_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER,
    type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, description TEXT, suggested_action TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  return db
}

function scenario(db, { leads, replies }) {
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

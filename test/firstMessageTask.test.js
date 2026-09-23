import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createFirstMessageTask, sellerFirstMessageInstance } from '../server/services/firstMessageTask.js'

function withTasks(db) {
  db.exec(`CREATE TABLE standalone_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER, assigned_to INTEGER,
    title TEXT NOT NULL, description TEXT, due_datetime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  db.exec('ALTER TABLE leads ADD COLUMN first_msg_sent_at TEXT')
  return db
}

test('cria tarefa para o vendedor com o texto pronto e marca first_msg_sent_at', () => {
  const db = withTasks(createTestDb()); const s = seedBasic(db)
  const user = { id: db.prepare("INSERT INTO users (account_id, name) VALUES (?, 'Joao')").run(s.account.id).lastInsertRowid, name: 'Joao' }
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, name: 'Ana', phone: '5547999990000' })
  const r = createFirstMessageTask(db, { lead, user, text: 'Oi Ana, sou o Joao!' })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(r.id)
  assert.equal(task.account_id, s.account.id)
  assert.equal(task.lead_id, lead.id)
  assert.equal(task.assigned_to, user.id)
  assert.equal(task.title, 'Mandar 1ª mensagem para Ana')
  assert.equal(task.description, 'Oi Ana, sou o Joao!')
  assert.equal(task.status, 'pending')
  assert.ok(task.due_datetime)
  assert.ok(db.prepare('SELECT first_msg_sent_at FROM leads WHERE id = ?').get(lead.id).first_msg_sent_at)
})

test('lead sem nome usa o telefone no titulo', () => {
  const db = withTasks(createTestDb()); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  const r = createFirstMessageTask(db, { lead, user: { id: null, name: '' }, text: 'x' })
  assert.equal(db.prepare('SELECT title FROM standalone_tasks WHERE id = ?').get(r.id).title, 'Mandar 1ª mensagem para 5547999990000')
})

test('sellerFirstMessageInstance: numero de leitura vira tarefa mesmo desconectado; disparo precisa estar conectado', () => {
  const db = createTestDb(); const s = seedBasic(db) // s.instance = Evolution conectada
  assert.equal(sellerFirstMessageInstance(db, s.instance.id).id, s.instance.id)
  db.prepare("UPDATE whatsapp_instances SET status = 'disconnected' WHERE id = ?").run(s.instance.id)
  assert.equal(sellerFirstMessageInstance(db, s.instance.id).id, s.instance.id)
  const uz = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', 'disconnected', 'uzapi')`).run(s.account.id).lastInsertRowid
  assert.equal(sellerFirstMessageInstance(db, uz), null)
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(uz)
  assert.equal(sellerFirstMessageInstance(db, uz).id, uz)
  assert.equal(sellerFirstMessageInstance(db, 9999), null)
  assert.equal(sellerFirstMessageInstance(db, null), null)
})

import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './roteiroDb.js'
import { applyLtvSchema } from '../../server/services/ltv/schema.js'

export { addLead, addMessage }

function addCol(db, table, column, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

export function createLtvTestDb() {
  const db = createRoteiroTestDb()
  addCol(db, 'leads', 'value_estimated', 'REAL')
  addCol(db, 'leads', 'opted_in_at', 'TEXT')
  addCol(db, 'leads', 'opted_out_at', 'TEXT')
  addCol(db, 'funnel_stages', 'color', "TEXT NOT NULL DEFAULT '#FFB300'")
  addCol(db, 'accounts', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
  db.exec(`
    CREATE TABLE IF NOT EXISTS standalone_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER, assigned_to INTEGER,
      title TEXT NOT NULL, description TEXT, due_datetime TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
      created_by INTEGER, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  applyLtvSchema(db)
  return db
}

export function seedLtvBase(db) {
  return seedRoteiroBase(db)
}

export function addSale(db, { accountId, leadId, value = 100, saleDate = '2026-09-01 12:00:00', kind = null, remindDays = null, crossSell = 0, offer = null, product = null, createdBy = null }) {
  return db.prepare(`
    INSERT INTO lead_sales (account_id, lead_id, value, sale_date, notes, created_by, product, sale_kind, remind_days, cross_sell, cross_sell_offer)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `).run(accountId, leadId, value, saleDate, createdBy, product, kind, remindDays, crossSell, offer).lastInsertRowid
}

// test/helpers/leadImportDb.js
import { createCadenceTestDb, seedCadenceBase } from './cadenceDb.js'
import { applyContactSchema } from '../../server/services/contacts/schema.js'
import { registerCityFunctions } from '../../server/services/city.js'

export function createImportTestDb() {
  const db = createCadenceTestDb()
  registerCityFunctions(db)
  applyContactSchema(db)
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  for (const [c, t] of [['notes', 'TEXT'], ['source_detail', 'TEXT'], ['custom_fields', 'TEXT'], ['state', 'TEXT'], ['cpf_cnpj', 'TEXT'],
    ['value_estimated', 'REAL'], ['opted_in_at', 'TEXT'], ['is_blocked', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE leads ADD COLUMN ${c} ${t}`)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#FFB300', UNIQUE(account_id, name));
           CREATE TABLE IF NOT EXISTS lead_tags (lead_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (lead_id, tag_id));`)
  return db
}

export function seedImport(db) {
  const s = seedCadenceBase(db)
  const bia = Number(db.prepare("INSERT INTO users (account_id, name, email, role, is_active) VALUES (?, 'Bia', 'bia@a.local', 'atendente', 1)").run(s.accountId).lastInsertRowid)
  const dest = { funnel_id: s.funnelId, stage_id: s.stages.novo, attendant: { mode: 'none' }, contact_type: 'lead', auto_tag: true }
  return { ...s, biaId: bia, dest }
}

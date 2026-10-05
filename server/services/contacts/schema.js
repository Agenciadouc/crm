// Colunas do tipo de contato (spec 2026-10-05 crm simples §2). Idempotente.
export function applyContactSchema(db) {
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  if (!cols.includes('contact_type')) db.exec('ALTER TABLE leads ADD COLUMN contact_type TEXT')
  if (!cols.includes('contact_type_origin')) db.exec('ALTER TABLE leads ADD COLUMN contact_type_origin TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_contact_type ON leads(account_id, contact_type)')
}

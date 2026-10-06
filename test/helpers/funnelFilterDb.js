import { createLtvTestDb, seedLtvBase, addLead, addSale } from './ltvDb.js'

function addCol(db, table, column, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function hist(db, leadId, fromStageId, toStageId, at) {
  db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, created_at) VALUES (?, ?, ?, ?)').run(leadId, fromStageId, toStageId, at)
}

// Outubro/2026. Maria: chega dia 2 (vendas), 1a compra dia 10 -> recompra, 2a compra dia 25.
// Joao: chega dia 5 e fica em vendas, sem venda. Volta: entra na recompra dia 3, volta pra vendas dia 20.
// Antigo: lead sem stage_history, hoje no funil de vendas.
export function seedMaria(db) {
  addCol(db, 'leads', 'contact_type', "TEXT NOT NULL DEFAULT 'lead'")
  addCol(db, 'leads', 'is_blocked', 'INTEGER NOT NULL DEFAULT 0')
  addCol(db, 'funnel_stages', 'is_qualified', 'INTEGER NOT NULL DEFAULT 0')
  addCol(db, 'funnel_stages', 'is_meeting', 'INTEGER NOT NULL DEFAULT 0')
  const base = seedLtvBase(db)
  const { accountId, otherAccountId, funnelId: vendasFunnelId, stages } = base
  db.prepare("UPDATE funnels SET kind = 'vendas' WHERE id = ?").run(vendasFunnelId)
  const recompraFunnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active, kind) VALUES (?, 'Recompra', 0, 1, 'recompra')").run(accountId).lastInsertRowid)
  const mk = (name, pos, key) => Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, system_key) VALUES (?, ?, ?, ?)').run(recompraFunnelId, name, pos, key).lastInsertRowid)
  const r = { aguardando: mk('Aguardando', 0, 'aguardando'), conversa: mk('Em conversa', 1, 'em_conversa') }

  const maria = addLead(db, { account_id: accountId, funnel_id: recompraFunnelId, stage_id: r.aguardando, name: 'Maria', created_at: '2026-10-02 09:00:00', source: 'whatsapp' })
  hist(db, maria, null, stages.novo, '2026-10-02 09:00:00')
  hist(db, maria, stages.novo, stages.venda, '2026-10-10 10:00:00')
  hist(db, maria, stages.venda, r.aguardando, '2026-10-10 10:00:01')
  addSale(db, { accountId, leadId: maria, value: 1500, saleDate: '2026-10-10 10:00:00' })
  addSale(db, { accountId, leadId: maria, value: 800, saleDate: '2026-10-25 15:00:00' })

  const joao = addLead(db, { account_id: accountId, funnel_id: vendasFunnelId, stage_id: stages.novo, name: 'Joao', created_at: '2026-10-05 09:00:00', source: 'manual' })
  hist(db, joao, null, stages.novo, '2026-10-05 09:00:00')

  const volta = addLead(db, { account_id: accountId, funnel_id: vendasFunnelId, stage_id: stages.qualificando, name: 'Volta', created_at: '2026-09-01 09:00:00' })
  hist(db, volta, null, stages.novo, '2026-09-01 09:00:00')
  hist(db, volta, stages.novo, r.aguardando, '2026-10-03 09:00:00')
  hist(db, volta, r.aguardando, stages.qualificando, '2026-10-20 09:00:00')

  const antigo = addLead(db, { account_id: accountId, funnel_id: vendasFunnelId, stage_id: stages.novo, name: 'Antigo', created_at: '2026-10-07 09:00:00' })

  // Outra conta com lead em outubro (isolamento)
  const fOther = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active, kind) VALUES (?, 'F', 1, 1, 'vendas')").run(otherAccountId).lastInsertRowid)
  const sOther = Number(db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Novo', 0)").run(fOther).lastInsertRowid)
  addLead(db, { account_id: otherAccountId, funnel_id: fOther, stage_id: sOther, name: 'Outro', created_at: '2026-10-03 09:00:00' })

  return { ...base, vendasFunnelId, recompraFunnelId, r, maria, joao, volta, antigo }
}

export { createLtvTestDb, addLead, addSale }

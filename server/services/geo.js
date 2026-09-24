// Estado (UF) do lead para filtros por estado. Pedido do dono (24/09/2026): empresa que atende o Brasil
// todo filtra por estado ou por cidade. Ordem: estado informado > estado da cidade (IBGE) > DDD do telefone
// (desempata cidades com o mesmo nome em estados diferentes, e cobre lead sem cidade).
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { cityKey } from './city.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const data = JSON.parse(readFileSync(resolve(__dirname, 'geo', 'municipios-uf.json'), 'utf8'))

export const UF_NAMES = data.estados // { AC: 'Acre', ... }

const ufByName = new Map(Object.entries(UF_NAMES).map(([uf, name]) => [cityKey(name), uf]))

// cityKey(municipio) -> [UF, ...]
const ufsByCity = new Map()
for (const [uf, cities] of Object.entries(data.municipios)) {
  for (const c of cities) {
    const k = cityKey(c)
    if (!ufsByCity.has(k)) ufsByCity.set(k, [])
    ufsByCity.get(k).push(uf)
  }
}

const DDD_UF = {
  11: 'SP', 12: 'SP', 13: 'SP', 14: 'SP', 15: 'SP', 16: 'SP', 17: 'SP', 18: 'SP', 19: 'SP',
  21: 'RJ', 22: 'RJ', 24: 'RJ', 27: 'ES', 28: 'ES',
  31: 'MG', 32: 'MG', 33: 'MG', 34: 'MG', 35: 'MG', 37: 'MG', 38: 'MG',
  41: 'PR', 42: 'PR', 43: 'PR', 44: 'PR', 45: 'PR', 46: 'PR', 47: 'SC', 48: 'SC', 49: 'SC',
  51: 'RS', 53: 'RS', 54: 'RS', 55: 'RS',
  61: 'DF', 62: 'GO', 64: 'GO', 63: 'TO', 65: 'MT', 66: 'MT', 67: 'MS', 68: 'AC', 69: 'RO',
  71: 'BA', 73: 'BA', 74: 'BA', 75: 'BA', 77: 'BA', 79: 'SE',
  81: 'PE', 87: 'PE', 82: 'AL', 83: 'PB', 84: 'RN', 85: 'CE', 88: 'CE', 86: 'PI', 89: 'PI',
  91: 'PA', 93: 'PA', 94: 'PA', 92: 'AM', 97: 'AM', 95: 'RR', 96: 'AP', 98: 'MA', 99: 'MA',
}

// "sc", "Santa Catarina", "santa catarina" -> "SC"; desconhecido -> null
export function normalizeUF(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  if (!text) return null
  const upper = text.toUpperCase()
  if (UF_NAMES[upper]) return upper
  return ufByName.get(cityKey(text)) || null
}

// DDD do telefone (com ou sem 55 na frente) -> UF
export function ufFromPhone(phone) {
  if (!phone) return null
  let d = String(phone).replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return null
  return DDD_UF[Number(d.slice(0, 2))] || null
}

export function ufsForCity(city) {
  const k = cityKey(city)
  return k ? (ufsByCity.get(k) || []) : []
}

export function resolveUF({ state, city, phone } = {}) {
  const informed = normalizeUF(state)
  if (informed) return informed
  const options = ufsForCity(city)
  if (options.length === 1) return options[0]
  const byPhone = ufFromPhone(phone)
  if (options.length > 1) return byPhone && options.includes(byPhone) ? byPhone : null
  return byPhone
}

// Coluna leads.uf (estado calculado) + gatilhos que recalculam quando cidade/estado/telefone mudam,
// qualquer que seja o caminho que gravou o lead (webhook, planilha, IA, tela). Idempotente.
// Gatilhos TEMPORARIOS (so desta conexao, recriados a cada boot): um gatilho gravado no arquivo chamaria
// lead_uf() tambem em quem abrisse o banco sem ela (script, sqlite3 no servidor, versao antiga do CRM)
// e todo INSERT de lead falharia.
export function applyGeoSchema(db) {
  db.function('lead_uf', { deterministic: true }, (state, city, phone) => resolveUF({ state, city, phone }))
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  if (!cols.includes('uf')) db.exec('ALTER TABLE leads ADD COLUMN uf TEXT')
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leads_account_uf ON leads(account_id, uf);
    DROP TRIGGER IF EXISTS main.trg_leads_uf_insert;
    DROP TRIGGER IF EXISTS main.trg_leads_uf_update;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_leads_uf_insert AFTER INSERT ON main.leads BEGIN
      UPDATE leads SET uf = lead_uf(NEW.state, NEW.city, NEW.phone) WHERE id = NEW.id;
    END;
    CREATE TEMP TRIGGER IF NOT EXISTS trg_leads_uf_update AFTER UPDATE OF city, state, phone ON main.leads BEGIN
      UPDATE leads SET uf = lead_uf(NEW.state, NEW.city, NEW.phone) WHERE id = NEW.id;
    END;
  `)
  return db.prepare('UPDATE leads SET uf = lead_uf(state, city, phone) WHERE uf IS NOT lead_uf(state, city, phone)').run().changes
}

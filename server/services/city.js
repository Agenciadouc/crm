// Cidade do lead: padronizacao na gravacao + chave de comparacao (sem acento/maiuscula)
// para filtros e relatorios por cidade. Decisao do dono (24/09/2026): padronizar tudo.

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

function capitalize(part) {
  return part ? part.charAt(0).toLocaleUpperCase('pt-BR') + part.slice(1) : part
}

// "  são   paulo " -> "São Paulo"; "RIO DE JANEIRO" -> "Rio de Janeiro". Vazio -> null.
export function normalizeCity(value) {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text
    .toLocaleLowerCase('pt-BR')
    .split(' ')
    .map((word, i) => (i > 0 && LOWER_WORDS.has(word)) ? word : word.split('-').map(capitalize).join('-'))
    .join(' ')
}

// Chave de comparacao: sem acento, minuscula, espacos unicos. "São Paulo" e "SAO  PAULO" -> "sao paulo".
export function cityKey(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

// Registra city_key() no SQLite (better-sqlite3) para filtrar/agrupar ignorando acento.
export function registerCityFunctions(db) {
  db.function('city_key', { deterministic: true }, (v) => cityKey(v))
}

// Pedaco de WHERE para filtrar pela cidade escolhida. `alias` = alias da tabela leads na query.
export function cityWhere(alias, city) {
  const key = cityKey(city)
  if (!key) return { sql: '', params: [] }
  return { sql: ` AND city_key(${alias}.city) = ?`, params: [key] }
}

// Forma de exibicao preferida entre variacoes: a mais usada; empate -> a com acento; depois alfabetica.
function pickDisplay(counts) {
  return [...counts.entries()].sort((a, b) =>
    (b[1] - a[1]) ||
    (b[0].normalize('NFD').length - a[0].normalize('NFD').length) ||
    a[0].localeCompare(b[0], 'pt-BR'))[0][0]
}

// Padroniza as cidades ja gravadas (idempotente): normalizeCity em todas e, dentro de cada conta,
// unifica as variacoes de acento pela forma mais usada. Devolve quantos leads mudaram.
export function normalizeExistingCities(db) {
  const rows = db.prepare("SELECT id, account_id, city FROM leads WHERE city IS NOT NULL").all()
  const groups = new Map() // `${account}|${key}` -> Map(display -> count)
  const normalized = rows.map(r => {
    const city = normalizeCity(r.city)
    if (city) {
      const g = `${r.account_id}|${cityKey(city)}`
      if (!groups.has(g)) groups.set(g, new Map())
      const m = groups.get(g)
      m.set(city, (m.get(city) || 0) + 1)
    }
    return { id: r.id, account_id: r.account_id, original: r.city, city }
  })
  const display = new Map([...groups.entries()].map(([g, m]) => [g, pickDisplay(m)]))
  const upd = db.prepare('UPDATE leads SET city = ? WHERE id = ?')
  let changed = 0
  db.transaction(() => {
    for (const r of normalized) {
      const target = r.city ? display.get(`${r.account_id}|${cityKey(r.city)}`) : null
      if (target !== r.original) { upd.run(target, r.id); changed++ }
    }
  })()
  return changed
}

// Cidade para gravar num lead da conta: padroniza e, se a conta ja tem essa cidade escrita de outro
// jeito (ex.: com acento), usa a forma mais usada — assim "sao paulo" entra como "São Paulo".
export function resolveCity(db, accountId, value) {
  const city = normalizeCity(value)
  if (!city || !accountId) return city
  const row = db.prepare(`
    SELECT city FROM leads WHERE account_id = ? AND city_key(city) = ?
    GROUP BY city ORDER BY COUNT(*) DESC, LENGTH(city) DESC LIMIT 1
  `).get(accountId, cityKey(city))
  return row ? row.city : city
}

// Para tabelas ligadas ao lead por lead_id (insights da IA, erros, alertas): "o lead e dessa cidade".
// `leadIdExpr` = coluna com o id do lead, ex.: 'ci.lead_id'. Sem cidade: nada.
export function leadCityExists(leadIdExpr, city) {
  const key = cityKey(city)
  if (!key) return { sql: '', params: [] }
  return { sql: ` AND EXISTS (SELECT 1 FROM leads lc WHERE lc.id = ${leadIdExpr} AND city_key(lc.city) = ?)`, params: [key] }
}

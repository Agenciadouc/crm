# Filtro de Funil (Vendas novas x Recompra) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seletor "Vendas novas · Recompra · Todos" no Chat, Leads, Dashboard, Projeção e Atendimentos, com números classificados pela história (1ª compra = nova; lead conta onde estava no momento).

**Architecture:** Um módulo servidor só (`server/services/funnelFilter.js`) gera todos os trechos SQL do filtro; rotas e serviços só os encaixam. Lógica hoje presa a `db.js` (estatísticas do Dashboard, cascata do funil mensal, agregador de atendimentos) passa para serviços que recebem a conexão, para teste em SQLite de memória. Atendimentos ganha a tabela `attendant_metrics_daily_funnel` (a antiga fica intocada). No front, um hook + componente iguais ao filtro de cidade.

**Tech Stack:** Node 16 + Express 4 + better-sqlite3 (servidor), React 19 + Vite + TS (front), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-filtro-funil-vendas-recompra-design.md`

## Global Constraints

- Valores do filtro: `vendas` | `recompra` | `todos`. Servidor: ausente/inválido = `todos`. Front: padrão `vendas`.
- `todos` tem de dar exatamente o resultado de hoje (Core usa `computeFunnelCascade(accountId, month)` via `server/routes/embed.js`).
- Nenhuma coluna nova em tabela existente; só a tabela nova `attendant_metrics_daily_funnel` (`CREATE TABLE IF NOT EXISTS`, SQLite antigo do CentOS 7).
- Serviços novos NÃO importam `server/db.js` (abre o banco real); recebem a conexão.
- Versões travadas: vite 4, better-sqlite3 10, express 4 (não atualizar dependência).
- Commits em português com `feat:`/`fix:`/`refactor:`/`test:`; sem emoji em código; toda query filtra por conta.
- `dist/` nunca entra em commit (restaurar com `git checkout -- dist && git clean -f dist` após build); `vite.config.ts` local não entra.
- Rodar Node pelo nvm: `export PATH="/c/nvm4w/nodejs:$PATH"` antes de `node`/`npm`.
- Textos de tela: "Vendas novas", "Recompra", "Todos"; aviso de custo: "Investimento é para venda nova".

## Review Focus

1. Lead que nunca teve `stage_history` (importado antigo) — deve cair no funil atual, não sumir de nenhum modo.
2. Duas vendas no mesmo dia/hora do mesmo lead — só uma é "1ª" (desempate por `id`).
3. Conta sem funil Recompra — seletor escondido e servidor tratando como `todos` (nenhum número muda).
4. Lead que volta da Recompra para Vendas — entra uma vez na contagem de "entraram na recompra" e as mensagens depois da volta contam como Vendas.
5. `?funnel=` junto com `?funnel_id=` (Pipeline) — `funnel_id` manda.

---

### Task 1: Núcleo `funnelFilter.js` (servidor)

**Files:**
- Create: `server/services/funnelFilter.js`
- Create: `test/helpers/funnelFilterDb.js`
- Test: `test/funnelFilterSql.test.js`

**Interfaces:**
- Produces:
  - `FUNNEL_FILTERS: string[]`
  - `parseFunnelFilter(query: object|undefined): 'vendas'|'recompra'|'todos'`
  - `kindAtSql(leadIdExpr: string, timeExpr: string): string` (expressão SQL → 'vendas'|'recompra')
  - `firstKindSql(leadIdExpr: string): string`
  - `kindAtWhere(leadIdExpr, timeExpr, filter): string` (`''` em `todos`, senão `" AND <kindAt> = 'x'"`)
  - `currentFunnelWhere(alias: string, filter): string`
  - `leadListFunnelWhere(alias: string, query: object): string` (vazio se `query.funnel_id`)
  - `periodLeadsSql(filter): string` (subquery com colunas `lead_id`, `period_at`)
  - `salesWhere(alias: string, filter): string`
  - `amdSource(filter): string` (tabela/subquery do agregado de atendimentos)
  - `hasRepurchaseFunnel(conn, accountId): boolean`
  - helper de teste `seedMaria(db)` → `{ accountId, otherAccountId, vendasFunnelId, recompraFunnelId, stages, maria, joao, volta }`

- [ ] **Step 1: Helper de teste com o caso da Maria**

`test/helpers/funnelFilterDb.js`:

```js
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
```

- [ ] **Step 2: Testes que falham**

`test/funnelFilterSql.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import {
  parseFunnelFilter, kindAtSql, firstKindSql, kindAtWhere, currentFunnelWhere,
  leadListFunnelWhere, periodLeadsSql, salesWhere, amdSource, hasRepurchaseFunnel,
} from '../server/services/funnelFilter.js'

function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('parseFunnelFilter: valores validos e o resto vira todos', () => {
  assert.equal(parseFunnelFilter({ funnel: 'vendas' }), 'vendas')
  assert.equal(parseFunnelFilter({ funnel: 'RECOMPRA' }), 'recompra')
  assert.equal(parseFunnelFilter({ funnel: 'x' }), 'todos')
  assert.equal(parseFunnelFilter({}), 'todos')
  assert.equal(parseFunnelFilter(undefined), 'todos')
})

test('kindAtSql: funil do lead em cada instante', () => {
  const { db, s } = setup()
  const at = (id, t) => db.prepare(`SELECT ${kindAtSql(String(id), `'${t}'`)} k`).get().k
  assert.equal(at(s.maria, '2026-10-05 00:00:00'), 'vendas')
  assert.equal(at(s.maria, '2026-10-11 00:00:00'), 'recompra')
  assert.equal(at(s.volta, '2026-10-10 00:00:00'), 'recompra')
  assert.equal(at(s.volta, '2026-10-21 00:00:00'), 'vendas')
  assert.equal(at(s.antigo, '2026-10-21 00:00:00'), 'vendas') // sem historico: funil atual
})

test('firstKindSql: funil em que o lead nasceu', () => {
  const { db, s } = setup()
  const k = id => db.prepare(`SELECT ${firstKindSql(String(id))} k`).get().k
  assert.equal(k(s.maria), 'vendas')
  assert.equal(k(s.volta), 'vendas')
  assert.equal(k(s.antigo), 'vendas')
})

test('currentFunnelWhere e leadListFunnelWhere: listas pelo funil atual; funnel_id manda', () => {
  const { db, s } = setup()
  const names = f => db.prepare(`SELECT name FROM leads l WHERE l.account_id = ?${currentFunnelWhere('l', f)} ORDER BY name`).all(s.accountId).map(r => r.name)
  assert.deepEqual(names('vendas'), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(names('recompra'), ['Maria'])
  assert.deepEqual(names('todos'), ['Antigo', 'Joao', 'Maria', 'Volta'])
  assert.equal(leadListFunnelWhere('l', { funnel: 'recompra', funnel_id: '3' }), '')
  assert.equal(leadListFunnelWhere('l', { funnel: 'recompra' }), currentFunnelWhere('l', 'recompra'))
})

test('periodLeadsSql: leads do periodo pela historia', () => {
  const { db, s } = setup()
  const count = f => db.prepare(`
    SELECT COUNT(DISTINCT l.id) c FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id
    WHERE l.account_id = ? AND p.period_at >= '2026-10-01' AND p.period_at < '2026-11-01'`).get(s.accountId).c
  assert.equal(count('vendas'), 3)   // Maria, Joao, Antigo (Volta nasceu em setembro)
  assert.equal(count('recompra'), 2) // Maria (dia 10) e Volta (dia 3), uma vez cada
  assert.equal(count('todos'), 3)    // igual hoje: criados em outubro
})

test('salesWhere: 1a compra e nova, 2a em diante e recompra (desempate por id)', () => {
  const { db, s } = setup()
  const sum = f => db.prepare(`SELECT COALESCE(SUM(ls.value),0) v FROM lead_sales ls WHERE ls.account_id = ?${salesWhere('ls', f)}`).get(s.accountId).v
  assert.equal(sum('vendas'), 1500)
  assert.equal(sum('recompra'), 800)
  assert.equal(sum('todos'), 2300)
  db.prepare("INSERT INTO lead_sales (account_id, lead_id, value, sale_date) VALUES (?, ?, 100, '2026-10-10 10:00:00')").run(s.accountId, s.maria)
  assert.equal(sum('vendas'), 1500) // mesma data: so a de menor id e a 1a
})

test('kindAtWhere: vazio em todos', () => {
  assert.equal(kindAtWhere('l.id', 'x', 'todos'), '')
  assert.match(kindAtWhere('l.id', 'x', 'vendas'), /= 'vendas'/)
})

test('amdSource: tabela antiga em todos, nova filtrada nos outros', () => {
  assert.equal(amdSource('todos'), 'attendant_metrics_daily')
  assert.match(amdSource('recompra'), /attendant_metrics_daily_funnel WHERE funnel_kind = 'recompra'/)
})

test('hasRepurchaseFunnel por conta', () => {
  const { db, s } = setup()
  assert.equal(hasRepurchaseFunnel(db, s.accountId), true)
  assert.equal(hasRepurchaseFunnel(db, s.otherAccountId), false)
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && node --test test/funnelFilterSql.test.js`
Expected: FAIL — `Cannot find module '../server/services/funnelFilter.js'`.

- [ ] **Step 4: Implementar**

`server/services/funnelFilter.js`:

```js
// Filtro de funil dos relatorios e listas: 'vendas' (venda nova) | 'recompra' | 'todos'.
// Unico lugar com a regra (spec 2026-10-05 filtro de funil §3): listas pelo funil ATUAL do lead;
// numeros pela HISTORIA (1a compra = nova; lead conta onde estava no momento).
// Nao importa server/db.js: so devolve trechos SQL; quem precisa do banco recebe a conexao.

export const FUNNEL_FILTERS = ['vendas', 'recompra', 'todos']

export function parseFunnelFilter(query) {
  const v = String((query && query.funnel) || '').trim().toLowerCase()
  return FUNNEL_FILTERS.includes(v) ? v : 'todos'
}

const stageKind = expr => `(SELECT fk.kind FROM funnel_stages s JOIN funnels fk ON fk.id = s.funnel_id WHERE s.id = ${expr})`
const currentKind = leadIdExpr => `(SELECT fk.kind FROM leads lk JOIN funnels fk ON fk.id = lk.funnel_id WHERE lk.id = ${leadIdExpr})`

// Funil do lead no instante: ultima troca ate o instante; se a 1a troca e depois, o funil de onde ela saiu;
// sem historico, o funil atual.
export function kindAtSql(leadIdExpr, timeExpr) {
  return `COALESCE(
    (SELECT ${stageKind('sh.to_stage_id')} FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} AND sh.created_at <= ${timeExpr} ORDER BY sh.created_at DESC, sh.id DESC LIMIT 1),
    (SELECT ${stageKind('sh.from_stage_id')} FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} ORDER BY sh.created_at ASC, sh.id ASC LIMIT 1),
    ${currentKind(leadIdExpr)}, 'vendas')`
}

// Funil em que o lead nasceu (1a linha do historico; sem historico, o funil atual).
export function firstKindSql(leadIdExpr) {
  return `COALESCE(
    (SELECT COALESCE(${stageKind('sh.from_stage_id')}, ${stageKind('sh.to_stage_id')}) FROM stage_history sh WHERE sh.lead_id = ${leadIdExpr} ORDER BY sh.created_at ASC, sh.id ASC LIMIT 1),
    ${currentKind(leadIdExpr)}, 'vendas')`
}

export function kindAtWhere(leadIdExpr, timeExpr, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  return ` AND ${kindAtSql(leadIdExpr, timeExpr)} = '${filter}'`
}

export function currentFunnelWhere(alias, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  return ` AND ${alias}.funnel_id IN (SELECT id FROM funnels WHERE kind = '${filter}')`
}

// Listas (Chat/Leads/export): funnel_id (Pipeline) tem prioridade e e tratado pela rota.
export function leadListFunnelWhere(alias, query) {
  if (query && query.funnel_id) return ''
  return currentFunnelWhere(alias, parseFunnelFilter(query))
}

const RECOMPRA_ENTRIES = `
  SELECT sh.lead_id AS lead_id, sh.created_at AS period_at
  FROM stage_history sh
  JOIN funnel_stages ts ON ts.id = sh.to_stage_id
  JOIN funnels tf ON tf.id = ts.funnel_id AND tf.kind = 'recompra'
  WHERE sh.from_stage_id IS NULL OR COALESCE(${stageKind('sh.from_stage_id')}, '') <> 'recompra'`

// Subquery (lead_id, period_at): quem "conta no periodo". Uso:
// FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id ... COUNT(DISTINCT l.id)
export function periodLeadsSql(filter) {
  if (filter === 'recompra') return RECOMPRA_ENTRIES
  if (filter === 'vendas') return `SELECT lv.id AS lead_id, lv.created_at AS period_at FROM leads lv WHERE ${firstKindSql('lv.id')} = 'vendas'`
  return 'SELECT id AS lead_id, created_at AS period_at FROM leads'
}

// Vendas: 1a do lead = nova; 2a em diante = recompra (ordem por sale_date, desempate por id).
export function salesWhere(alias, filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return ''
  const prior = `SELECT 1 FROM lead_sales sp WHERE sp.lead_id = ${alias}.lead_id AND (sp.sale_date < ${alias}.sale_date OR (sp.sale_date = ${alias}.sale_date AND sp.id < ${alias}.id))`
  return filter === 'vendas' ? ` AND NOT EXISTS (${prior})` : ` AND EXISTS (${prior})`
}

// Agregado diario de atendimentos: tabela antiga em 'todos'; tabela por funil nos outros (spec §5b).
export function amdSource(filter) {
  if (filter !== 'vendas' && filter !== 'recompra') return 'attendant_metrics_daily'
  return `(SELECT * FROM attendant_metrics_daily_funnel WHERE funnel_kind = '${filter}')`
}

export function hasRepurchaseFunnel(conn, accountId) {
  return !!conn.prepare("SELECT 1 FROM funnels WHERE account_id = ? AND kind = 'recompra' AND is_active = 1 LIMIT 1").get(accountId)
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/funnelFilterSql.test.js`
Expected: PASS (9 testes).

- [ ] **Step 6: Commit**

```bash
git add server/services/funnelFilter.js test/helpers/funnelFilterDb.js test/funnelFilterSql.test.js
git commit -m "feat(funil): regras do filtro vendas novas x recompra em um modulo so"
```

---

### Task 2: Listas — `GET /api/leads` e `/export`

**Files:**
- Modify: `server/routes/leads.js:111` (lista) e `:875-882` (export)
- Test: `test/funnelFilterLeadList.test.js`

**Interfaces:**
- Consumes: `leadListFunnelWhere(alias, query)` (Task 1)

- [ ] **Step 1: Teste que falha** — a rota usa o banco real; o teste prova a montagem do WHERE que ela usa, contra a conta da Maria:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { leadListWhere } from '../server/services/funnelFilter.js'

test('leadListWhere: ?funnel filtra pelo funil atual; funnel_id manda', () => {
  const db = createLtvTestDb(); const s = seedMaria(db)
  const run = q => {
    const w = leadListWhere('l', q)
    return db.prepare(`SELECT name FROM leads l WHERE l.account_id = ?${w.sql} ORDER BY name`).all(s.accountId, ...w.params).map(r => r.name)
  }
  assert.deepEqual(run({ funnel: 'recompra' }), ['Maria'])
  assert.deepEqual(run({ funnel: 'vendas' }), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(run({ funnel: 'recompra', funnel_id: String(s.vendasFunnelId) }), ['Antigo', 'Joao', 'Volta'])
  assert.deepEqual(run({}), ['Antigo', 'Joao', 'Maria', 'Volta'])
})
```

- [ ] **Step 2: Rodar** — `node --test test/funnelFilterLeadList.test.js` → FAIL (`leadListWhere` não existe).

- [ ] **Step 3: Implementar** em `funnelFilter.js`:

```js
// WHERE completo de funil para listas: funnel_id (Pipeline) ou ?funnel (Chat/Leads/export).
export function leadListWhere(alias, query) {
  if (query && query.funnel_id) return { sql: ` AND ${alias}.funnel_id = ?`, params: [query.funnel_id] }
  return { sql: currentFunnelWhere(alias, parseFunnelFilter(query)), params: [] }
}
```

Em `server/routes/leads.js`, importar `import { leadListWhere } from '../services/funnelFilter.js'` e trocar, na lista (linha 111) e no export (linha 881):

```js
  if (funnel_id) { where.push('l.funnel_id = ?'); params.push(funnel_id) }
```
por
```js
  { const fw = leadListWhere('l', req.query); if (fw.sql) { where.push(fw.sql.replace(/^ AND /, '')); params.push(...fw.params) } }
```

- [ ] **Step 4: Rodar** — teste novo PASS; `npm test` inteiro PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(leads): lista e exportacao aceitam ?funnel=vendas|recompra|todos"`

---

### Task 3: Estatísticas do Dashboard (`/stats` e `/agents`)

**Files:**
- Create: `server/services/dashboardStats.js`
- Modify: `server/routes/dashboard.js:34-121`
- Test: `test/dashboardStatsFunnel.test.js`

**Interfaces:**
- Consumes: `parseFunnelFilter`, `periodLeadsSql`, `currentFunnelWhere`, `salesWhere` (Task 1)
- Produces: `computeDashboardStats(conn, accountId, query, now = new Date())` → `{ totalLeads, prevTotalLeads, leadsToday, conversionRate, unassigned, byStage, bySource, daily, funnel }`; `computeAgentStats(conn, accountId, query, now)` → `{ agents }`

- [ ] **Step 1: Teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { computeDashboardStats } from '../server/services/dashboardStats.js'

const NOW = new Date('2026-10-31T12:00:00Z')
function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('stats nos tres modos (30 dias ate 31/10)', () => {
  const { db, s } = setup()
  const st = f => computeDashboardStats(db, s.accountId, { days: '30', funnel: f }, NOW)
  assert.equal(st('todos').totalLeads, 3)
  assert.equal(st('vendas').totalLeads, 3)
  assert.equal(st('recompra').totalLeads, 2)
  assert.equal(st('vendas').conversionRate, (1 / 3) * 100)   // 1 primeira venda / 3 leads
  assert.equal(st('recompra').conversionRate, (1 / 2) * 100) // 1 recompra / 2 entradas
  assert.deepEqual(st('recompra').byStage.map(x => x.name), ['Aguardando', 'Em conversa'])
  assert.deepEqual(st('vendas').byStage.map(x => x.name), ['Novo', 'Qualificando', 'Proposta', 'Venda', 'Perdido'])
  assert.equal(st('recompra').funnel, 'recompra')
})

test('stats: outra conta nao vaza e sem ?funnel = todos', () => {
  const { db, s } = setup()
  const a = computeDashboardStats(db, s.accountId, { days: '30' }, NOW)
  const b = computeDashboardStats(db, s.accountId, { days: '30', funnel: 'todos' }, NOW)
  assert.deepEqual(a, b)
  assert.equal(computeDashboardStats(db, s.otherAccountId, { days: '30', funnel: 'vendas' }, NOW).totalLeads, 1)
})
```

- [ ] **Step 2: Rodar** → FAIL (módulo não existe).

- [ ] **Step 3: Implementar** `server/services/dashboardStats.js` movendo o corpo de `/stats` e `/agents` (dashboard.js:34-121), com estas trocas:

```js
import { cityWhere } from './city.js'
import { countsInMetrics } from './contacts/scope.js'
import { parseFunnelFilter, periodLeadsSql, currentFunnelWhere, salesWhere } from './funnelFilter.js'

function leadsWhere(alias, geo) {
  const cw = cityWhere(alias, geo)
  return { sql: `${cw.sql} AND ${countsInMetrics(alias)}`, params: cw.params }
}
const fmt = d => d.toISOString().slice(0, 19).replace('T', ' ')

export function computeDashboardStats(conn, accountId, query, now = new Date()) {
  const f = parseFunnelFilter(query)
  const d = parseInt(query.days || '7')
  const since = new Date(now); since.setDate(since.getDate() - d)
  const prevSince = new Date(since); prevSince.setDate(prevSince.getDate() - d)
  const sinceStr = fmt(since), prevSinceStr = fmt(prevSince), nowStr = fmt(now)
  const cwl = leadsWhere('l', query)
  const P = `FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id WHERE l.account_id = ? AND l.is_archived = 0 AND l.is_blocked = 0`

  const totalLeads = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND p.period_at >= ?${cwl.sql}`).get(accountId, sinceStr, ...cwl.params).c
  const prevTotalLeads = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND p.period_at >= ? AND p.period_at < ?${cwl.sql}`).get(accountId, prevSinceStr, sinceStr, ...cwl.params).c
  const leadsToday = conn.prepare(`SELECT COUNT(DISTINCT l.id) c ${P} AND date(p.period_at) = date(?)${cwl.sql}`).get(accountId, nowStr, ...cwl.params).c

  let conversionRate
  if (f === 'todos') {
    const conv = conn.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN fs.is_conversion = 1 THEN 1 ELSE 0 END) as converted
      FROM leads l JOIN funnel_stages fs ON l.stage_id = fs.id JOIN funnels fk ON fk.id = fs.funnel_id AND fk.kind = 'vendas'
      WHERE l.account_id = ? AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${cwl.sql}`).get(accountId, ...cwl.params)
    conversionRate = conv.total > 0 ? (conv.converted / conv.total) * 100 : 0
  } else {
    const sales = conn.prepare(`
      SELECT COUNT(DISTINCT ls.id) c FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id
      WHERE l.account_id = ? AND l.is_blocked = 0 AND ls.sale_date >= ?${salesWhere('ls', f)}${cwl.sql}`).get(accountId, sinceStr, ...cwl.params).c
    conversionRate = totalLeads > 0 ? (sales / totalLeads) * 100 : 0
  }

  const unassigned = conn.prepare(`SELECT COUNT(*) c FROM leads l WHERE l.account_id = ? AND l.attendant_id IS NULL AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${currentFunnelWhere('l', f)}${cwl.sql}`).get(accountId, ...cwl.params).c

  const funnelPick = f === 'recompra' ? "f.kind = 'recompra'" : 'f.is_default = 1'
  const byStage = conn.prepare(`
    SELECT fs.id, fs.name, fs.color, fs.position, fs.is_conversion, COUNT(l.id) as count
    FROM funnel_stages fs JOIN funnels f ON fs.funnel_id = f.id
    LEFT JOIN leads l ON l.stage_id = fs.id AND l.is_active = 1 AND l.is_archived = 0 AND l.is_blocked = 0${cwl.sql}
    WHERE f.account_id = ? AND ${funnelPick}
    GROUP BY fs.id ORDER BY fs.position`).all(...cwl.params, accountId)

  const bySource = conn.prepare(`SELECT COALESCE(l.source, 'manual') as source, COUNT(DISTINCT l.id) as count ${P} AND p.period_at >= ?${cwl.sql} GROUP BY COALESCE(l.source, 'manual') ORDER BY count DESC`).all(accountId, sinceStr, ...cwl.params)
  const daily = conn.prepare(`SELECT date(p.period_at) as date, COUNT(DISTINCT l.id) as count ${P} AND p.period_at >= ?${cwl.sql} GROUP BY date(p.period_at) ORDER BY date`).all(accountId, sinceStr, ...cwl.params)

  return { totalLeads, prevTotalLeads, leadsToday, conversionRate, unassigned, byStage, bySource, daily, funnel: f }
}
```

Nota: o filtro antigo de `totalLeads`/`bySource`/`daily` não exigia `is_active`; o novo também não (mantém `todos` igual).

`computeAgentStats(conn, accountId, query, now)`: o corpo de `/agents` (dashboard.js:109-118) com `leads_period` contado por `periodLeadsSql(f)` (`SELECT COUNT(DISTINCT l2.id) FROM (${periodLeadsSql(f)}) p2 JOIN leads l2 ON l2.id = p2.lead_id WHERE l2.attendant_id = u.id AND l2.is_archived = 0 AND l2.is_blocked = 0 AND p2.period_at >= ?`), `leads_total` com `currentFunnelWhere('leads', f)` e `conversions` em `todos`/`vendas` igual hoje e em `recompra` = `SELECT COUNT(DISTINCT ls.lead_id) FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id WHERE l.attendant_id = u.id AND ls.sale_date >= ?${salesWhere('ls','recompra')}`.

Na rota (`server/routes/dashboard.js`), trocar os corpos por:

```js
import { computeDashboardStats, computeAgentStats } from '../services/dashboardStats.js'
router.get('/stats', (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  res.json(computeDashboardStats(db, req.accountId, req.query))
})
router.get('/agents', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  res.json(computeAgentStats(db, req.accountId, req.query))
})
```

- [ ] **Step 4: Rodar** — teste novo PASS e `npm test` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): numeros separados por venda nova e recompra"`

---

### Task 4: Funil mensal e Projeção

**Files:**
- Create: `server/services/funnelCascade.js`
- Modify: `server/routes/dashboard.js:878-1187` (helpers viram wrappers; rotas ganham `funnel`)
- Test: `test/funnelCascadeFunnel.test.js`

**Interfaces:**
- Consumes: Task 1
- Produces: `cascadeFor(conn, accountId, yearMonth, city = null, funnel = 'todos')` (mesmo retorno de hoje + `funnel`); `dashboard.js` continua exportando `computeFunnelCascade(accountId, yearMonth, city = null, funnel = 'todos')` (Core/embed sem mudança).

- [ ] **Step 1: Teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { cascadeFor } from '../server/services/funnelCascade.js'

function setup() { const db = createLtvTestDb(); return { db, s: seedMaria(db) } }

test('cascata de outubro nos tres modos', () => {
  const { db, s } = setup()
  const c = f => cascadeFor(db, s.accountId, '2026-10', null, f)
  assert.equal(c('todos').total, 3)
  assert.equal(c('todos').real_revenue, 2300)
  assert.equal(c('vendas').total, 3)
  assert.equal(c('vendas').real_revenue, 1500)
  assert.equal(c('recompra').total, 2)
  assert.equal(c('recompra').won, 1)
  assert.equal(c('recompra').real_revenue, 800)
  assert.equal(c('recompra').qualified, null)
  assert.equal(c('recompra').overall_conversion, 50)
})
```

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar** `server/services/funnelCascade.js` copiando `monthBounds` e `computeFunnelCascade` (dashboard.js:878-1009) com `conn` no lugar de `db` e estas trocas:
  - base: `SELECT COUNT(DISTINCT l.id) c FROM (${periodLeadsSql(f)}) p JOIN leads l ON l.id = p.lead_id WHERE l.account_id = ? AND l.is_active = 1 AND l.is_blocked = 0 AND p.period_at >= ? AND p.period_at < ?${cwl.sql}`;
  - `countPassed` usa a mesma base (`FROM (${periodLeadsSql(f)}) p JOIN leads l ...` + `EXISTS stage_history`), só em `vendas`/`todos`;
  - em `recompra`: `qualified = meeting = null`, `won = SELECT COUNT(DISTINCT ls.lead_id) FROM lead_sales ls JOIN leads l ON l.id = ls.lead_id WHERE l.account_id = ? AND ls.sale_date >= ? AND ls.sale_date < ?${salesWhere('ls','recompra')}${cwl.sql}`, taxas `qualified_rate = meeting_rate = won_rate = null`, `overall_conversion = total > 0 ? won / total * 100 : null`, `config_missing` todo `false`;
  - faturamento: `...AND ls.sale_date >= ? AND ls.sale_date < ?${salesWhere('ls', f)}${cwl.sql}`; fallback legado só quando `f !== 'recompra'`;
  - retorno inclui `funnel: f`.

Em `dashboard.js`: `export { monthBounds } from '../services/funnelCascade.js'` e
```js
export function computeFunnelCascade(accountId, yearMonth, city = null, funnel = 'todos') {
  return cascadeFor(db, accountId, yearMonth, city, funnel)
}
```
Nas rotas `/funil-mensal/:month` e `/projecao`: `const funnel = parseFunnelFilter(req.query)`, passar para `computeFunnelCascade`, e `const hideCost = byCity || funnel === 'recompra'` no lugar de `byCity` em CPL/CAC/ROAS/meta/projeção futura; incluir `by_funnel: funnel` na resposta.

- [ ] **Step 4: Rodar** — PASS; `npm test` PASS (embed continua chamando sem funil).
- [ ] **Step 5: Commit** — `git commit -m "feat(funil-mensal): cascata, faturamento e projecao por venda nova e recompra"`

---

### Task 5: Agregado de atendimentos por funil

**Files:**
- Create: `server/services/attendantMetricsCompute.js`
- Modify: `server/services/attendantMetrics.js` (vira wrapper), `server/db.js` (tabela nova, perto da linha 632)
- Modify: `server/scheduler.js` (preenchimento único de 90 dias)
- Test: `test/attendantMetricsFunnel.test.js`

**Interfaces:**
- Consumes: `kindAtSql`, `firstKindSql` (Task 1)
- Produces: `computeAttendantDay(conn, accountId, userId, dateStr, kind = null)` → objeto com as colunas V1+V2; `upsertFunnelDay(conn, accountId, userId, dateStr, kind, m)`; `ensureFunnelMetricsTable(conn)`; `backfillFunnelMetrics(conn, days = 90, today = new Date())` → `{ done: boolean }` (marca `app_settings` `amd_funnel_backfill_v1`).

- [ ] **Step 1: Teste que falha** (Maria tem atendente, mensagem humana no dia 5 e no dia 26):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, addMessage } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { computeAttendantDay, ensureFunnelMetricsTable, upsertFunnelDay, backfillFunnelMetrics } from '../server/services/attendantMetricsCompute.js'

function setup() {
  const db = createLtvTestDb(); const s = seedMaria(db)
  for (const [t, c] of [['ai_agent_id', 'INTEGER']]) { try { db.exec(`ALTER TABLE messages ADD COLUMN ${t} ${c}`) } catch {} }
  for (const c of ['qualified_at', 'proposal_sent_at']) { try { db.exec(`ALTER TABLE leads ADD COLUMN ${c} TEXT`) } catch {} }
  db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(s.atendenteId, s.maria)
  const msg = (dir, at) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, created_at) VALUES (?, ?, ?, 'x', ?)").run(s.maria, s.accountId, dir, at)
  msg('inbound', '2026-10-05 10:00:00'); msg('outbound', '2026-10-05 10:03:00')
  msg('inbound', '2026-10-26 10:00:00'); msg('outbound', '2026-10-26 10:10:00')
  ensureFunnelMetricsTable(db)
  return { db, s }
}

test('respondidos contam no funil em que o lead estava no inicio do dia', () => {
  const { db, s } = setup()
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-05', 'vendas').leads_responded, 1)
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-05', 'recompra').leads_responded, 0)
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra').leads_responded, 1)
  assert.equal(computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-26', null).leads_responded, 1)
})

test('upsert por funil e preenchimento unico', () => {
  const { db, s } = setup()
  upsertFunnelDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra', computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra'))
  upsertFunnelDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra', computeAttendantDay(db, s.accountId, s.atendenteId, '2026-10-26', 'recompra'))
  assert.equal(db.prepare('SELECT COUNT(*) c FROM attendant_metrics_daily_funnel').get().c, 1)
  db.exec("UPDATE accounts SET attendant_analytics_enabled = 1")
  assert.equal(backfillFunnelMetrics(db, 3, new Date('2026-10-27T12:00:00Z')).done, true)
  assert.equal(backfillFunnelMetrics(db, 3, new Date('2026-10-27T12:00:00Z')).done, false) // ja feito
})
```

(Se `accounts.attendant_analytics_enabled` ou `users.is_bot` faltarem no banco de teste, o Step 3 adiciona via `addCol` no próprio teste: `try { db.exec('ALTER TABLE accounts ADD COLUMN attendant_analytics_enabled INTEGER NOT NULL DEFAULT 0') } catch {}`.)

- [ ] **Step 2: Rodar** → FAIL.

- [ ] **Step 3: Implementar**
  - `attendantMetricsCompute.js`: mover o cálculo de `aggregateAttendantMetricsForDate` (attendantMetrics.js:12-234) para `computeAttendantDay(conn, accountId, userId, dateStr, kind)`, devolvendo um objeto com as 22 colunas. Com `kind`, cada consulta de lead ganha o filtro (validar `dateStr` com `/^\d{4}-\d{2}-\d{2}$/` antes de embutir):
    - leads novos do dia: `AND ${firstKindSql('leads.id')} = '${kind}'`;
    - demais consultas sobre leads (respondidos, conversões, abertas, abandonadas, sem resposta humana, ociosas, qualificação, proposta): `AND ${kindAtSql('l.id', `'${dateStr} 00:00:00'`)} = '${kind}'` (dar alias `l` onde a query usa `leads` sem alias);
    - conversões em `recompra`: contar leads com venda de recompra no dia (`lead_sales ... ${salesWhere('ls','recompra')}`) em vez de etapa `is_conversion`.
  - `ensureFunnelMetricsTable(conn)`:
```js
export function ensureFunnelMetricsTable(conn) {
  conn.exec(`CREATE TABLE IF NOT EXISTS attendant_metrics_daily_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, user_id INTEGER NOT NULL, date TEXT NOT NULL,
    funnel_kind TEXT NOT NULL, leads_assigned INTEGER DEFAULT 0, leads_responded INTEGER DEFAULT 0, leads_converted INTEGER DEFAULT 0,
    ttfr_avg_seconds REAL, tmr_avg_seconds REAL, leads_under_5min INTEGER DEFAULT 0, leads_under_30min INTEGER DEFAULT 0,
    leads_under_1h INTEGER DEFAULT 0, open_conversations INTEGER DEFAULT 0, abandoned_leads INTEGER DEFAULT 0,
    ttfr_human_avg_seconds REAL, ttfr_human_p90_seconds REAL, ttfr_bot_avg_seconds REAL, tmr_human_avg_seconds REAL,
    leads_without_human_response INTEGER DEFAULT 0, leads_idle_24h INTEGER DEFAULT 0, leads_idle_72h INTEGER DEFAULT 0,
    time_to_qualified_avg_seconds REAL, time_to_proposal_avg_seconds REAL, computed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, user_id, date, funnel_kind))`)
  conn.exec('CREATE INDEX IF NOT EXISTS idx_amdf_lookup ON attendant_metrics_daily_funnel(account_id, funnel_kind, date, user_id)')
}
```
  - `upsertFunnelDay`: `INSERT ... ON CONFLICT(account_id, user_id, date, funnel_kind) DO UPDATE SET` todas as colunas (mesmo padrão do upsert atual).
  - `backfillFunnelMetrics(conn, days, today)`: se `app_settings` tem `amd_funnel_backfill_v1`, devolve `{ done: false }`; senão, para cada conta com `is_active = 1 AND attendant_analytics_enabled = 1`, cada usuário ativo não-bot `atendente`/`gerente`, cada dia dos últimos `days` (UTC, até ontem de `today`), grava `vendas` e `recompra`; ao final grava a chave e devolve `{ done: true }`.
  - `attendantMetrics.js`: `aggregateAttendantMetricsForDate` chama `computeAttendantDay(db, ..., null)` e mantém o upsert antigo; depois grava `vendas` e `recompra` com `upsertFunnelDay`. `db.js`: chamar `ensureFunnelMetricsTable(db)` logo após a criação de `attendant_metrics_daily`.
  - `scheduler.js` (na inicialização): `setTimeout(() => { try { backfillFunnelMetrics(db, 90) } catch (e) { console.error('[AMD funnel backfill]', e.message) } }, 60000)`.

- [ ] **Step 4: Rodar** — teste novo PASS; `npm test` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(atendimentos): agregado diario por funil e preenchimento dos ultimos 90 dias"`

---

### Task 6: Rotas de Atendimentos com `?funnel`

**Files:**
- Modify: `server/routes/dashboard.js` — `/attendants` (231), `/conversation-insights` (336), `/overview-v2` (473), `/ranking-v2` (583), `/critical-conversations` (641), `/alerts` (722), `/market-intelligence` (810)
- Test: `test/attendantRoutesFunnel.test.js`

**Interfaces:**
- Consumes: `parseFunnelFilter`, `amdSource`, `kindAtWhere` (Task 1); tabela da Task 5

- [ ] **Step 1: Teste que falha** — prova as duas peças que as rotas encaixam, contra o banco da Maria:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { seedMaria } from './helpers/funnelFilterDb.js'
import { insightFunnelWhere } from '../server/services/funnelFilter.js'

test('insightFunnelWhere: insight conta no funil do lead na data da analise', () => {
  const db = createLtvTestDb(); const s = seedMaria(db)
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, analyzed_at) VALUES (?, ?, '2026-10-26 00:00:00')").run(s.accountId, s.maria)
  db.prepare("INSERT INTO conversation_insights (account_id, lead_id, analyzed_at) VALUES (?, ?, '2026-10-06 00:00:00')").run(s.accountId, s.joao)
  const n = f => db.prepare(`SELECT COUNT(*) c FROM conversation_insights ci WHERE ci.account_id = ?${insightFunnelWhere('ci.lead_id', 'ci.analyzed_at', f)}`).get(s.accountId).c
  assert.equal(n('recompra'), 1)
  assert.equal(n('vendas'), 1)
  assert.equal(n('todos'), 2)
})
```

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar**
  - `funnelFilter.js`: `export const insightFunnelWhere = (leadIdExpr, timeExpr, filter) => kindAtWhere(leadIdExpr, timeExpr, filter)`.
  - Em cada rota listada: `const funnel = parseFunnelFilter(req.query)`;
    - `attendant_metrics_daily` nas consultas → `${amdSource(funnel)}` (com alias `amd` mantido: `LEFT JOIN ${amdSource(funnel)} amd ON ...`; no SLA da overview: `FROM ${amdSource(funnel)} amd WHERE amd.account_id = ? AND amd.date >= date(?)`);
    - `conversation_insights` → `+ insightFunnelWhere('<alias>.lead_id', '<alias>.analyzed_at', funnel)`; `conversation_errors`/`conversation_strengths` → `insightFunnelWhere('<tabela>.lead_id', '<tabela>.created_at', funnel)`; `analyst_alerts` → `insightFunnelWhere('a.lead_id', 'a.created_at', funnel)` (alerta sem lead só em `todos`: `AND a.lead_id IS NOT NULL` quando `funnel !== 'todos'`); follow-ups atrasados e leads quentes em risco → `currentFunnelWhere('l', funnel)`;
    - resposta inclui `by_funnel: funnel`. Coaching semanal não muda.
- [ ] **Step 4: Rodar** — PASS; `npm test` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(atendimentos): cartoes, ranking, criticas, alertas e mercado por funil"`

---

### Task 7: Front — biblioteca, hook, seletor e API

**Files:**
- Create: `src/lib/funnelFilter.js`, `src/lib/funnelFilter.d.ts`, `src/components/FunnelFilter.tsx`
- Modify: `src/lib/api.ts` (fetchers com `cityQ`; `LeadFilters`)
- Test: `test/funnelFilterFront.test.js`

**Interfaces:**
- Produces: `FUNNEL_OPTIONS`, `normalizeFunnel(v)`, `funnelQuery(v)`, `funnelParams(v)`, `leadMatchesFunnel(lead, v, funnels)`, `stagesForFunnel(funnels, v)`; `useFunnelFilter(accountId)` → `[value, setValue, available]`; `<FunnelFilter value onChange available />`; `<FunnelCostNotice funnel />`; fetchers aceitam `funnel?: FunnelValue` como último parâmetro.

- [ ] **Step 1: Teste que falha**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFunnel, funnelQuery, funnelParams, leadMatchesFunnel, stagesForFunnel } from '../src/lib/funnelFilter.js'

const funnels = [
  { id: 1, kind: 'vendas', stages: [{ id: 10, name: 'Novo' }] },
  { id: 2, kind: 'recompra', stages: [{ id: 20, name: 'Aguardando' }] },
  { id: 3, stages: [{ id: 30, name: 'Outro' }] }, // sem kind = vendas
]

test('normalizeFunnel: padrao vendas', () => {
  assert.equal(normalizeFunnel(''), 'vendas')
  assert.equal(normalizeFunnel('recompra'), 'recompra')
  assert.equal(normalizeFunnel('lixo'), 'vendas')
})
test('query e params', () => {
  assert.equal(funnelQuery('recompra'), '&funnel=recompra')
  assert.deepEqual(funnelParams('todos'), { funnel: 'todos' })
})
test('leadMatchesFunnel e stagesForFunnel', () => {
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'recompra', funnels), true)
  assert.equal(leadMatchesFunnel({ funnel_id: 3 }, 'vendas', funnels), true)
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'vendas', funnels), false)
  assert.equal(leadMatchesFunnel({ funnel_id: 2 }, 'todos', funnels), true)
  assert.deepEqual(stagesForFunnel(funnels, 'vendas').map(s => s.id), [10, 30])
  assert.deepEqual(stagesForFunnel(funnels, 'todos').map(s => s.id), [10, 20, 30])
})
```

- [ ] **Step 2: Rodar** → FAIL.
- [ ] **Step 3: Implementar**

`src/lib/funnelFilter.js`:
```js
// Filtro de funil das telas: 'vendas' (Vendas novas) | 'recompra' | 'todos'. Padrao: vendas.
// JS puro com .d.ts ao lado para rodar no `node --test` (mesmo padrao de geoFilter.js).
export const FUNNEL_OPTIONS = [
  { value: 'vendas', label: 'Vendas novas' },
  { value: 'recompra', label: 'Recompra' },
  { value: 'todos', label: 'Todos' },
]
export function normalizeFunnel(v) {
  return FUNNEL_OPTIONS.some(o => o.value === v) ? v : 'vendas'
}
export function funnelQuery(v) { return `&funnel=${normalizeFunnel(v)}` }
export function funnelParams(v) { return { funnel: normalizeFunnel(v) } }
const kindOf = f => (f && f.kind) || 'vendas'
export function leadMatchesFunnel(lead, v, funnels) {
  const want = normalizeFunnel(v)
  if (want === 'todos') return true
  const f = (funnels || []).find(x => x.id === lead?.funnel_id)
  return kindOf(f) === want
}
export function stagesForFunnel(funnels, v) {
  const want = normalizeFunnel(v)
  return (funnels || []).filter(f => want === 'todos' || kindOf(f) === want).flatMap(f => f.stages || [])
}
```
`src/lib/funnelFilter.d.ts` com os tipos (`export type FunnelValue = 'vendas' | 'recompra' | 'todos'` e as assinaturas).

`src/components/FunnelFilter.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { fetchFunnels } from '../lib/api'
import { FUNNEL_OPTIONS, normalizeFunnel, type FunnelValue } from '../lib/funnelFilter.js'

const storageKey = (id: number) => `dros_funnel_filter_${id}`

// Escolha vale para todas as telas da conta (igual ao filtro de cidade). Conta sem funil Recompra:
// available = false e o valor efetivo e 'todos' (nada muda nos numeros).
export function useFunnelFilter(accountId: number | null | undefined): [FunnelValue, (v: FunnelValue) => void, boolean] {
  const [value, setValueState] = useState<FunnelValue>('vendas')
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!accountId) return
    try { setValueState(normalizeFunnel(localStorage.getItem(storageKey(accountId)) || '')) } catch { setValueState('vendas') }
    fetchFunnels(accountId).then(fs => setAvailable(fs.some(f => f.kind === 'recompra'))).catch(() => setAvailable(false))
  }, [accountId])
  const setValue = (v: FunnelValue) => {
    setValueState(v)
    if (accountId) { try { localStorage.setItem(storageKey(accountId), v) } catch {} }
  }
  return [available ? value : 'todos', setValue, available]
}

export default function FunnelFilter({ value, onChange, available }: { value: FunnelValue; onChange: (v: FunnelValue) => void; available: boolean }) {
  if (!available) return null
  return (
    <div className="funnel-filter" role="tablist" aria-label="Funil">
      {FUNNEL_OPTIONS.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value}
          className={`btn btn-sm ${value === o.value ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => onChange(o.value as FunnelValue)}>{o.label}</button>
      ))}
    </div>
  )
}

export function FunnelCostNotice({ funnel }: { funnel: FunnelValue }) {
  if (funnel !== 'recompra') return null
  return <p className="text-muted" style={{ fontSize: 13 }}>Investimento é para venda nova: custo por lead, CAC e ROAS aparecem como "—" na Recompra.</p>
}
```
(Confirmar o nome da função de funis em `src/lib/api.ts` — hoje usada pelo Pipeline — e as classes de botão usadas em `CityFilter.tsx`; usar as mesmas.)

`src/lib/api.ts`: `import { funnelQuery } from './funnelFilter.js'`; em cada fetcher que monta `${cityQ(city)}` (stats, agents, funil mensal, projeção, attendants, overview-v2, ranking-v2, críticas, alertas, mercado, conversation-insights) acrescentar o parâmetro final `funnel?: FunnelValue` e `${funnel ? funnelQuery(funnel) : ''}` na URL; `LeadFilters` ganha `funnel?: string`; `DashboardStats` ganha `funnel?: string`; tipos de resposta com `by_funnel?: string`.

- [ ] **Step 4: Rodar** — teste PASS; `npx tsc --noEmit` sem erros novos (base: 16).
- [ ] **Step 5: Commit** — `git commit -m "feat(front): seletor de funil compartilhado e parametros na API"`

---

### Task 8: Chat e Leads

**Files:**
- Modify: `src/pages/Chat.tsx` (~178 hook; ~377-389 filtros; ~928-933 refiltro SSE; ~1465 `allStages`; ~1626 seletor de etapas; cabeçalho perto do título)
- Modify: `src/pages/Leads.tsx` (~52 hook; ~88 params; ~160/203 etapas; ~181 export)

**Interfaces:**
- Consumes: `useFunnelFilter`, `FunnelFilter`, `funnelParams`, `leadMatchesFunnel`, `stagesForFunnel` (Task 7); `?funnel` em `/api/leads` (Task 2)

- [ ] **Step 1: Chat**
  - `const [funnelFilter, setFunnelFilter, funnelAvailable] = useFunnelFilter(accountId)` ao lado de `useCityFilter`.
  - Nos filtros de `fetchLeads` (~377-389): `...funnelParams(funnelFilter)`; incluir `funnelFilter` nas dependências do efeito que recarrega a lista.
  - Refiltro em tempo real (~928-933): `&& leadMatchesFunnel(lead, funnelFilter, funnels)`.
  - `allStages` (~1465): `const allStages = stagesForFunnel(funnels, funnelFilter)`; ao trocar o funil, limpar etapas selecionadas que não estão mais na lista.
  - Cabeçalho: `<FunnelFilter value={funnelFilter} onChange={setFunnelFilter} available={funnelAvailable} />` ao lado do título "Chat".
- [ ] **Step 2: Leads** — mesmo hook; `...funnelParams(funnelFilter)` nos params da lista (~88) e do export (~181); dropdown de etapas com `stagesForFunnel`; seletor ao lado do título.
- [ ] **Step 3: Verificar** — `npx tsc --noEmit` (sem erros novos) e `npm run build` (ok; depois `git checkout -- dist && git clean -f dist`).
- [ ] **Step 4: Commit** — `git commit -m "feat(chat,leads): filtro de funil na lista, nas etapas e na exportacao"`

---

### Task 9: Dashboard e Projeção

**Files:**
- Modify: `src/pages/Dashboard.tsx` (~33, ~39-40), `src/components/FunilMensal.tsx` (~56), `src/pages/Projecao.tsx` (~46)

- [ ] **Step 1: Dashboard** — hook de funil; passar `funnelFilter` para `fetchDashboardStats`, `fetchAgentStats` e para `<FunilMensal ... funnel={funnelFilter} />` (FunilMensal repassa a `fetchFunilMensal`); seletor ao lado do título; recarregar ao trocar; `<FunnelCostNotice funnel={funnelFilter} />` acima dos cartões de custo; em `recompra`, cartões de etapas "Qualificados/Reuniões" do Funil & ROI mostram "—".
- [ ] **Step 2: Projeção** — hook; `fetchProjecao(..., city, funnelFilter)`; seletor; `FunnelCostNotice`; colunas qualif./reuniões "—" quando `by_funnel === 'recompra'`.
- [ ] **Step 3: Verificar** — `tsc` sem erros novos; build ok (limpar `dist`).
- [ ] **Step 4: Commit** — `git commit -m "feat(dashboard,projecao): seletor vendas novas x recompra"`

---

### Task 10: Atendimentos

**Files:**
- Modify: `src/pages/AttendantAnalytics.tsx` (~208 e cada chamada `fetch*` com `city`)

- [ ] **Step 1:** hook de funil; passar `funnelFilter` a todos os fetchers da tela (overview-v2, ranking-v2, críticas, alertas, mercado, attendants, conversation-insights); seletor ao lado do título "Análise de Atendimentos"; recarregar ao trocar; aba Coaching mostra a nota "O coaching semanal junta vendas novas e recompra." quando `funnelFilter !== 'todos'`.
- [ ] **Step 2: Verificar** — `tsc` sem erros novos; build ok (limpar `dist`).
- [ ] **Step 3: Commit** — `git commit -m "feat(atendimentos): seletor de funil em todas as abas"`

---

### Task 11: Conferência final

- [ ] **Step 1:** `npm test` (todos PASS), `npx tsc --noEmit` (16 erros antigos, nenhum novo), `npm run build` (ok; limpar `dist`).
- [ ] **Step 2:** CRM local (worktree spin, `npm run dev`, http://localhost:5175/crm/), conta BG Imoveis, no Chrome do dono:
  - Chat: trocar Vendas novas/Recompra/Todos e ver a lista e as etapas mudarem; um lead em Recompra só aparece em Recompra/Todos.
  - Leads: idem + Exportar baixa só o funil escolhido.
  - Dashboard: números mudam; em Recompra custo aparece "—" com o aviso; "Todos" igual ao de antes.
  - Projeção e Atendimentos: idem.
  - Conta sem funil Recompra (Kellermann, se não tiver): seletor some.
- [ ] **Step 3:** atualizar a memória (`retomar-crm.md`) com a ponta do ramo e pedir ao dono o ok do push.

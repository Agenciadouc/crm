# LTV, Recompra e Venda Cruzada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada venda passa a dizer se o cliente pode recomprar (ou receber oferta de relacionados); o CRM leva o cliente para um funil "Recompra", lembra o vendedor (ou envia sozinho, se configurado), registra motivos de não comprar e mostra LTV, curva de ritmo A/B/C/D, selos de valor e clientes parados.

**Architecture:** Toda regra nova vive em `server/services/ltv/` (funções que recebem `db`, nunca importam `server/db.js`), com esquema em `applyLtvSchema(db)`. As rotas ficam finas: `leads.js` chama `ltv/sales.js`; o resto vai num router novo `createCustomersRouter(db, deps)` montado em `/api/customers`. O lead muda de funil por uma porta nova `moveLeadToFunnel` em `stageMove.js`. O agendador chama `runLtvTick` a cada hora. No front: componente único `SaleModal`, `OutcomeModal`, bloco "cliente" no painel, página `Clientes`, seção nas Configurações, quadro no Dashboard e filtros em "Mais filtros...".

**Tech Stack:** Node 20 ESM + Express + better-sqlite3; testes `node --test` + `node:assert/strict`; React + TypeScript + Vite; SSE próprio (`server/sse.js`, `src/context/SSEContext.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-29-ltv-recompra-design.md`

## Global Constraints

- Tudo em português do Brasil na interface; toda tela nova tem **explicação com exemplo** (regra "explica com exemplo").
- Prazos de lembrete: exatamente `[7, 15, 30, 45, 60]` dias.
- Curva padrão: A ≤ 30, B ≤ 45, C ≤ 60, acima = D; 1 compra = `'1a'`. Validação: inteiros 1–365, A < B < C.
- Limite de tentativas padrão: 5. Envio automático padrão: desligado.
- Data "hoje" = data de Brasília (UTC−3), formato `YYYY-MM-DD` (`localDate(now)`); tarefas vencem às 09:00 de Brasília = `T12:00:00.000Z`.
- Serviços em `server/services/ltv/` **não importam `server/db.js`** (nem `leadAccess.js`, `leadHandoff.js`, `aiAdapter.js`); o que é de produção entra por injeção ou em arquivos `*Runtime.js` usados só por rotas/agendador.
- Número Evolution (leitura) nunca envia automático; envio automático só por `resolveSendInstance(db, { accountId, kind: 'automatico' })`.
- Lead com `leads.repurchase_opt_out = 1` ou `leads.opted_out_at` preenchido nunca recebe envio automático.
- O funil Recompra nunca é `is_default = 1`, não pode ser desativado e suas 6 etapas com `system_key` não podem ser apagadas.
- Métricas de vendas existentes (Dashboard `/stats` conversões, `/agents`, `attendantMetrics`) contam só `funnels.kind = 'vendas'`. A receita (`lead_sales`) continua somando tudo (recompra é receita).
- Sem trava de roteiro (`gate: false`) em qualquer movimento feito pela recompra; `trigger_type` = `'recompra'`.
- IA da recompra usa o orçamento do roteiro: fonte `'repurchase_offer'` entra em `ROTEIRO_SOURCES`; erro/sem orçamento nunca bloqueia tarefa.
- Comandos: `npm test` (todos), `node --test test/<arquivo>.test.js` (um), `npx tsc --noEmit` (16 erros antigos aceitos — não pode aumentar), `npm run build`.
- Commits pequenos, mensagem em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Não fazer push.

## Review Focus

1. **Venda retroativa** (data da venda há 40 dias com lembrete de 30) → ciclo nasce já vencido, entra direto em "A contatar" com tarefa, sem esperar a rotina. Teste na Task 7.
2. **Rotina rodando duas vezes no mesmo dia / servidor reiniciado** → nenhuma tarefa ou envio duplicado. Teste na Task 8.
3. **Lead responde estando em "Aguardando" no funil Recompra** → NÃO é empurrado para a 2ª etapa pelo auto-avanço antigo do `inboundHandler`. Teste na Task 4.
4. **Apagar a única venda que abriu o ciclo** → ciclo encerrado, tarefa concluída, histórico de tentativas preservado (sale_id vira NULL, não apaga em cascata). Teste na Task 5.
5. **Cliente que disse "não quero mais" compra de novo por conta própria** → venda registra e soma LTV, mas nenhum ciclo abre até alguém clicar [Desfazer]. Teste na Task 5.

---

## File Structure

**Criar (servidor):**
- `server/services/ltv/schema.js` — `applyLtvSchema(db)`, constantes.
- `server/services/ltv/compute.js` — cálculos puros (datas, LTV, curva, selo, mediana, faixas).
- `server/services/ltv/customer.js` — `recalcCustomer`, `recalcAccountCustomers`, `backfillAllCustomers`.
- `server/services/ltv/funnel.js` — funil Recompra, motivos padrão, guardas de funil/etapas.
- `server/services/ltv/cycles.js` — ciclo de recompra (abrir, fechar, desfecho, desfazer, conversa, sincronizar etapa).
- `server/services/ltv/reminder.js` — tarefa do lembrete + sugestão da IA.
- `server/services/ltv/sales.js` — registrar/editar/apagar venda (usado por `leads.js`).
- `server/services/ltv/daily.js` — rotina horária/diária.
- `server/services/ltv/autoSend.js` — envio automático (injeção de `send`).
- `server/services/ltv/autoSendRuntime.js` — `send` de produção (pacer + sender + messages + SSE).
- `server/services/ltv/aiRuntime.js` — `repurchaseAiFor(db, accountId)` de produção.
- `server/services/ltv/metrics.js` — visão geral, lista, recompra, parados, tarefas em massa.
- `server/services/ltv/filters.js` — `customerWhere` para `GET /api/leads`.
- `server/routes/customersRouter.js` — `createCustomersRouter(db, deps)`.

**Criar (testes):** `test/helpers/ltvDb.js`, `test/ltvSchema.test.js`, `test/ltvCompute.test.js`, `test/ltvCustomer.test.js`, `test/ltvFunnel.test.js`, `test/ltvCycles.test.js`, `test/ltvReminder.test.js`, `test/ltvSales.test.js`, `test/ltvDaily.test.js`, `test/ltvMetrics.test.js`, `test/customersHttp.test.js`.

**Modificar (servidor):** `server/db.js` (chamar schema + boot), `server/services/stageMove.js` (`moveLeadToFunnel` + sync de ciclo), `server/services/roteiro/runtime.js` (CAPI fora da recompra; conversa → em_conversa), `server/services/inboundHandler.js` (sem auto-avanço na recompra), `server/services/aiAgent.js` (sem mover etapa na recompra), `server/services/aiBudget.js` (fonte nova), `server/routes/leads.js` (vendas, 409 em etapas de desfecho, filtros), `server/routes/funnels.js` (proteções), `server/routes/dashboard.js` + `server/services/attendantMetrics.js` (só vendas), `server/scheduler.js` (tick), `server/index.js` (montar router).

**Criar (front):** `src/components/SaleModal.tsx`, `src/components/OutcomeModal.tsx`, `src/components/CustomerCard.tsx`, `src/pages/Clientes.tsx`, `src/components/settings/CustomersSettings.tsx`, `src/components/RepurchaseDashboardCard.tsx`, `src/lib/customerFilter.js`.

**Modificar (front):** `src/lib/api.ts`, `src/pages/Chat.tsx`, `src/pages/LeadDetail.tsx`, `src/pages/Pipeline.tsx`, `src/pages/Settings.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Funnels.tsx`, `src/pages/Leads.tsx`, `src/components/MoreFilters.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`, `src/context/SSEContext.tsx`, `src/lib/panelLayout.js`, `src/lib/panelLayout.d.ts`, `server/services/panelLayouts.js`.

---

### Task 1: Esquema do LTV / Recompra

**Files:**
- Create: `server/services/ltv/schema.js`
- Create: `test/helpers/ltvDb.js`
- Test: `test/ltvSchema.test.js`
- Modify: `server/db.js` (perto da linha 1511, depois de `applyPanelLayoutSchema(db)`)

**Interfaces:**
- Produces: `applyLtvSchema(db)`; constantes `REMIND_DAYS`, `SYSTEM_KEYS`, `OPEN_STATUSES`; helper de teste `createLtvTestDb()`, `seedLtvBase(db)` (= `seedRoteiroBase` → `{ accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages, instanceId }`), `addLead(db, fields)` (reexport), `addSale(db, {...}) → saleId`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/ltvSchema.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb } from './helpers/ltvDb.js'
import { applyLtvSchema } from '../server/services/ltv/schema.js'

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)

test('applyLtvSchema cria colunas e tabelas e é idempotente', () => {
  const db = createLtvTestDb()
  applyLtvSchema(db) // 2a vez não quebra
  for (const c of ['product', 'sale_kind', 'remind_days', 'cross_sell', 'cross_sell_offer']) assert.ok(cols(db, 'lead_sales').includes(c), c)
  for (const c of ['ltv', 'purchases', 'last_purchase_at', 'avg_interval_days', 'curve', 'tier_id', 'repurchase_opt_out']) assert.ok(cols(db, 'leads').includes(c), c)
  for (const c of ['repurchase_funnel_id', 'repurchase_max_attempts', 'repurchase_auto_send', 'curve_a_days', 'curve_b_days', 'curve_c_days', 'ltv_daily_on']) assert.ok(cols(db, 'accounts').includes(c), c)
  assert.ok(cols(db, 'funnels').includes('kind'))
  assert.ok(cols(db, 'funnel_stages').includes('system_key'))
  assert.ok(cols(db, 'standalone_tasks').includes('repurchase_cycle_id'))
  for (const t of ['repurchase_cycles', 'repurchase_attempts', 'repurchase_reasons', 'customer_tiers']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t), t)
  }
})

test('só um ciclo aberto por lead', () => {
  const db = createLtvTestDb()
  const ins = db.prepare("INSERT INTO repurchase_cycles (account_id, lead_id, kind, status, remind_at, remind_days) VALUES (1, 1, 'recompra', ?, '2026-10-01', 30)")
  ins.run('aguardando')
  assert.throws(() => ins.run('a_contatar'), /UNIQUE/)
  ins.run('comprou') // fechado não conta
})

test('defaults da conta', () => {
  const db = createLtvTestDb()
  db.prepare("INSERT INTO accounts (id, name) VALUES (99, 'X')").run()
  const a = db.prepare('SELECT * FROM accounts WHERE id = 99').get()
  assert.equal(a.repurchase_max_attempts, 5)
  assert.equal(a.repurchase_auto_send, 0)
  assert.deepEqual([a.curve_a_days, a.curve_b_days, a.curve_c_days], [30, 45, 60])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ltvSchema.test.js`
Expected: FAIL (`Cannot find module .../helpers/ltvDb.js`)

- [ ] **Step 3: Implementar o esquema**

```js
// server/services/ltv/schema.js
// Esquema do LTV / Recompra (spec 2026-09-29 §4). Nao importa server/db.js: recebe db.
export const REMIND_DAYS = [7, 15, 30, 45, 60]
export const SYSTEM_KEYS = ['aguardando', 'a_contatar', 'em_conversa', 'comprou', 'nao_agora', 'nao_quer']
export const OPEN_STATUSES = ['aguardando', 'a_contatar', 'em_conversa']

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
}
function addColumnIfNotExists(db, table, column, type) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyLtvSchema(db) {
  addColumnIfNotExists(db, 'lead_sales', 'product', 'TEXT')
  addColumnIfNotExists(db, 'lead_sales', 'sale_kind', 'TEXT')
  addColumnIfNotExists(db, 'lead_sales', 'remind_days', 'INTEGER')
  addColumnIfNotExists(db, 'lead_sales', 'cross_sell', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'lead_sales', 'cross_sell_offer', 'TEXT')

  addColumnIfNotExists(db, 'funnels', 'kind', "TEXT NOT NULL DEFAULT 'vendas'")
  addColumnIfNotExists(db, 'funnel_stages', 'system_key', 'TEXT')

  addColumnIfNotExists(db, 'accounts', 'repurchase_funnel_id', 'INTEGER')
  addColumnIfNotExists(db, 'accounts', 'repurchase_max_attempts', 'INTEGER NOT NULL DEFAULT 5')
  addColumnIfNotExists(db, 'accounts', 'repurchase_auto_send', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'accounts', 'curve_a_days', 'INTEGER NOT NULL DEFAULT 30')
  addColumnIfNotExists(db, 'accounts', 'curve_b_days', 'INTEGER NOT NULL DEFAULT 45')
  addColumnIfNotExists(db, 'accounts', 'curve_c_days', 'INTEGER NOT NULL DEFAULT 60')
  addColumnIfNotExists(db, 'accounts', 'ltv_daily_on', 'TEXT')

  addColumnIfNotExists(db, 'leads', 'ltv', 'REAL NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'leads', 'purchases', 'INTEGER NOT NULL DEFAULT 0')
  addColumnIfNotExists(db, 'leads', 'last_purchase_at', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'avg_interval_days', 'REAL')
  addColumnIfNotExists(db, 'leads', 'curve', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'tier_id', 'INTEGER')
  addColumnIfNotExists(db, 'leads', 'repurchase_opt_out', 'INTEGER NOT NULL DEFAULT 0')

  addColumnIfNotExists(db, 'standalone_tasks', 'repurchase_cycle_id', 'INTEGER')

  db.exec(`
    CREATE TABLE IF NOT EXISTS repurchase_cycles (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id         INTEGER NOT NULL,
      lead_id            INTEGER NOT NULL,
      sale_id            INTEGER REFERENCES lead_sales(id) ON DELETE SET NULL,
      kind               TEXT NOT NULL CHECK (kind IN ('recompra','cruzada')),
      status             TEXT NOT NULL CHECK (status IN ('aguardando','a_contatar','em_conversa','comprou','nao_agora','nao_quer','encerrado')),
      remind_at          TEXT NOT NULL,
      remind_days        INTEGER NOT NULL,
      attempt            INTEGER NOT NULL DEFAULT 1,
      exhausted          INTEGER NOT NULL DEFAULT 0,
      offer_text         TEXT,
      ai_suggestion      TEXT,
      task_id            INTEGER,
      auto_sent_at       TEXT,
      auto_failed_reason TEXT,
      closed_reason_id   INTEGER,
      closed_at          TEXT,
      closed_by          INTEGER,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_repurchase_cycle_open ON repurchase_cycles(lead_id)
      WHERE status IN ('aguardando','a_contatar','em_conversa');
    CREATE INDEX IF NOT EXISTS idx_repurchase_cycles_due ON repurchase_cycles(account_id, status, remind_at);

    CREATE TABLE IF NOT EXISTS repurchase_attempts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id       INTEGER NOT NULL,
      cycle_id         INTEGER NOT NULL REFERENCES repurchase_cycles(id) ON DELETE CASCADE,
      lead_id          INTEGER NOT NULL,
      attempt          INTEGER NOT NULL,
      kind             TEXT NOT NULL,
      outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('comprou','nao_agora','nao_quer','sem_desfecho')),
      reason_id        INTEGER,
      next_remind_days INTEGER,
      auto             INTEGER NOT NULL DEFAULT 0,
      task_id          INTEGER,
      contacted_at     TEXT,
      decided_at       TEXT,
      decided_by       INTEGER,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (cycle_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_repurchase_attempts_account ON repurchase_attempts(account_id, created_at);

    CREATE TABLE IF NOT EXISTS repurchase_reasons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      grp        TEXT NOT NULL CHECK (grp IN ('nao_agora','nao_quer')),
      label      TEXT NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS customer_tiers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name       TEXT NOT NULL,
      icon       TEXT,
      color      TEXT NOT NULL DEFAULT '#7E57C2',
      min_ltv    REAL NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
}
```

```js
// test/helpers/ltvDb.js
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
```

- [ ] **Step 4: Ligar no `server/db.js`**

Logo depois da chamada `applyPanelLayoutSchema(db)` (linha ~1511), no mesmo estilo try/catch:

```js
import { applyLtvSchema } from './services/ltv/schema.js'   // junto dos outros imports de schema no topo
// ...
try { applyLtvSchema(db) } catch (e) { console.error('[DB] LTV schema:', e.message) }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/ltvSchema.test.js` → PASS. Depois `npm test` → tudo verde.

- [ ] **Step 6: Commit**

```bash
git add server/services/ltv/schema.js test/helpers/ltvDb.js test/ltvSchema.test.js server/db.js
git commit -m "feat(ltv): esquema de recompra, selos, motivos e cache do cliente"
```

---

### Task 2: Cálculos puros (datas, LTV, curva, selo, mediana, faixas)

**Files:**
- Create: `server/services/ltv/compute.js`
- Test: `test/ltvCompute.test.js`

**Interfaces:**
- Produces:
  - `localDate(now: Date) → 'YYYY-MM-DD'` (Brasília)
  - `addDays(date: string, days: number) → 'YYYY-MM-DD'`
  - `daysBetween(a: string, b: string) → number` (b − a, em dias de calendário)
  - `customerStats(sales: {value, sale_date}[], { today, curve: {a,b,c} }) → { ltv, purchases, lastPurchaseAt, avgIntervalDays, curve }`
  - `curveFor({ avgIntervalDays, daysSinceLast }, {a,b,c}) → 'A'|'B'|'C'|'D'|'1a'`
  - `tierFor(ltv, tiers: {id, min_ltv}[]) → id|null`
  - `median(nums) → number|null`
  - `suggestRemindDays({ medianDays, markedDays, cases }) → number|null`
  - `staleBand(daysSinceLast) → null|'30-60'|'61-90'|'91-180'|'181+'`
  - `validateCurve({a,b,c}) → { ok: true } | { ok: false, error }`
  - `dueIso(remindAt: string, now: Date) → string` (ISO do vencimento da tarefa: 09:00 de Brasília no dia; se já passou, agora)

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/ltvCompute.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { localDate, addDays, daysBetween, customerStats, curveFor, tierFor, median, suggestRemindDays, staleBand, validateCurve, dueIso } from '../server/services/ltv/compute.js'

const CURVE = { a: 30, b: 45, c: 60 }

test('localDate usa horário de Brasília', () => {
  assert.equal(localDate(new Date('2026-09-30T02:00:00Z')), '2026-09-29') // 23h de 29/09 em Brasília
  assert.equal(localDate(new Date('2026-09-30T03:00:00Z')), '2026-09-30')
})

test('addDays e daysBetween', () => {
  assert.equal(addDays('2026-09-20 14:00:00', 15), '2026-10-05')
  assert.equal(daysBetween('2026-09-01', '2026-10-01'), 30)
})

test('customerStats sem vendas', () => {
  assert.deepEqual(customerStats([], { today: '2026-09-29', curve: CURVE }), { ltv: 0, purchases: 0, lastPurchaseAt: null, avgIntervalDays: null, curve: null })
})

test('uma compra = 1a', () => {
  const r = customerStats([{ value: 100, sale_date: '2026-09-01 10:00:00' }], { today: '2026-09-10', curve: CURVE })
  assert.equal(r.curve, '1a'); assert.equal(r.ltv, 100); assert.equal(r.purchases, 1); assert.equal(r.lastPurchaseAt, '2026-09-01')
})

test('duas vendas no mesmo dia não criam intervalo', () => {
  const r = customerStats([{ value: 50, sale_date: '2026-09-01 10:00:00' }, { value: 70, sale_date: '2026-09-01 18:00:00' }], { today: '2026-09-02', curve: CURVE })
  assert.equal(r.purchases, 2); assert.equal(r.avgIntervalDays, null); assert.equal(r.curve, '1a'); assert.equal(r.ltv, 120)
})

test('ritmo de 20 dias = A; parado 50 dias cai para C; parado 70 = D', () => {
  const sales = [{ value: 100, sale_date: '2026-07-01' }, { value: 100, sale_date: '2026-07-21' }, { value: 100, sale_date: '2026-08-10' }]
  assert.equal(customerStats(sales, { today: '2026-08-20', curve: CURVE }).curve, 'A')
  assert.equal(customerStats(sales, { today: '2026-09-29', curve: CURVE }).curve, 'C') // 50 dias
  assert.equal(customerStats(sales, { today: '2026-10-19', curve: CURVE }).curve, 'D') // 70 dias
  assert.equal(customerStats(sales, { today: '2026-08-20', curve: CURVE }).avgIntervalDays, 20)
})

test('curveFor limites inclusivos', () => {
  assert.equal(curveFor({ avgIntervalDays: 30, daysSinceLast: 0 }, CURVE), 'A')
  assert.equal(curveFor({ avgIntervalDays: 31, daysSinceLast: 0 }, CURVE), 'B')
  assert.equal(curveFor({ avgIntervalDays: 45, daysSinceLast: 0 }, CURVE), 'B')
  assert.equal(curveFor({ avgIntervalDays: 60, daysSinceLast: 0 }, CURVE), 'C')
  assert.equal(curveFor({ avgIntervalDays: 61, daysSinceLast: 0 }, CURVE), 'D')
  assert.equal(curveFor({ avgIntervalDays: null, daysSinceLast: 5 }, CURVE), '1a')
})

test('tierFor pega o maior alcançado', () => {
  const tiers = [{ id: 1, min_ltv: 2000 }, { id: 2, min_ltv: 5000 }]
  assert.equal(tierFor(1999.99, tiers), null)
  assert.equal(tierFor(2000, tiers), 1)
  assert.equal(tierFor(8000, tiers), 2)
  assert.equal(tierFor(8000, []), null)
})

test('median', () => {
  assert.equal(median([]), null)
  assert.equal(median([5, 1, 3]), 3)
  assert.equal(median([1, 2, 3, 4]), 2.5)
})

test('suggestRemindDays só com 10+ casos e 20% acima', () => {
  assert.equal(suggestRemindDays({ medianDays: 41, markedDays: 30, cases: 9 }), null)
  assert.equal(suggestRemindDays({ medianDays: 35, markedDays: 30, cases: 20 }), null) // 16,7% acima
  assert.equal(suggestRemindDays({ medianDays: 41, markedDays: 30, cases: 20 }), 45)
})

test('staleBand', () => {
  assert.equal(staleBand(29), null); assert.equal(staleBand(30), '30-60'); assert.equal(staleBand(60), '30-60')
  assert.equal(staleBand(61), '61-90'); assert.equal(staleBand(180), '91-180'); assert.equal(staleBand(181), '181+')
})

test('validateCurve', () => {
  assert.deepEqual(validateCurve({ a: 30, b: 45, c: 60 }), { ok: true })
  assert.equal(validateCurve({ a: 45, b: 45, c: 60 }).ok, false)
  assert.equal(validateCurve({ a: 0, b: 45, c: 60 }).ok, false)
  assert.equal(validateCurve({ a: 30, b: 45, c: 400 }).ok, false)
  assert.equal(validateCurve({ a: 1.5, b: 45, c: 60 }).ok, false)
})

test('dueIso: 09h de Brasília no dia, ou agora se já passou', () => {
  assert.equal(dueIso('2026-10-10', new Date('2026-09-29T15:00:00Z')), '2026-10-10T12:00:00.000Z')
  assert.equal(dueIso('2026-09-20', new Date('2026-09-29T15:00:00Z')), '2026-09-29T15:00:00.000Z')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/ltvCompute.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// server/services/ltv/compute.js
// Calculos puros do LTV/recompra (spec §3). Datas de calendario em horario de Brasilia (UTC-3).
import { REMIND_DAYS } from './schema.js'

const DAY_MS = 86400000
const BRT_OFFSET_MS = 3 * 3600000
const round2 = n => Math.round(n * 100) / 100
const round1 = n => Math.round(n * 10) / 10
const dayOnly = s => String(s).slice(0, 10)
const toUtcMidnight = d => Date.parse(dayOnly(d) + 'T00:00:00Z')

export function localDate(now = new Date()) {
  return new Date(now.getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10)
}

export function addDays(date, days) {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(a, b) {
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / DAY_MS)
}

export function curveFor({ avgIntervalDays, daysSinceLast }, { a, b, c }) {
  if (avgIntervalDays == null) return '1a'
  const rhythm = Math.max(avgIntervalDays, daysSinceLast || 0)
  if (rhythm <= a) return 'A'
  if (rhythm <= b) return 'B'
  if (rhythm <= c) return 'C'
  return 'D'
}

export function customerStats(sales, { today, curve }) {
  if (!sales || !sales.length) return { ltv: 0, purchases: 0, lastPurchaseAt: null, avgIntervalDays: null, curve: null }
  const ltv = round2(sales.reduce((s, x) => s + Number(x.value || 0), 0))
  const days = [...new Set(sales.map(s => dayOnly(s.sale_date)))].sort()
  const last = days[days.length - 1]
  let avg = null
  if (days.length >= 2) {
    let total = 0
    for (let i = 1; i < days.length; i++) total += daysBetween(days[i - 1], days[i])
    avg = round1(total / (days.length - 1))
  }
  return {
    ltv,
    purchases: sales.length,
    lastPurchaseAt: last,
    avgIntervalDays: avg,
    curve: curveFor({ avgIntervalDays: avg, daysSinceLast: daysBetween(last, today) }, curve),
  }
}

export function tierFor(ltv, tiers) {
  let best = null
  for (const t of tiers || []) {
    if (ltv >= Number(t.min_ltv) && (!best || Number(t.min_ltv) > Number(best.min_ltv))) best = t
  }
  return best ? best.id : null
}

export function median(nums) {
  if (!nums || !nums.length) return null
  const s = [...nums].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function suggestRemindDays({ medianDays, markedDays, cases }) {
  if (medianDays == null || !markedDays || cases < 10) return null
  if (medianDays <= markedDays * 1.2) return null
  return REMIND_DAYS.reduce((best, d) => (Math.abs(d - medianDays) < Math.abs(best - medianDays) ? d : best), REMIND_DAYS[0])
}

export function staleBand(daysSinceLast) {
  if (daysSinceLast == null || daysSinceLast < 30) return null
  if (daysSinceLast <= 60) return '30-60'
  if (daysSinceLast <= 90) return '61-90'
  if (daysSinceLast <= 180) return '91-180'
  return '181+'
}

export function validateCurve({ a, b, c }) {
  const ok = [a, b, c].every(n => Number.isInteger(n) && n >= 1 && n <= 365)
  if (!ok) return { ok: false, error: 'Use dias inteiros entre 1 e 365.' }
  if (!(a < b && b < c)) return { ok: false, error: 'A precisa ser menor que B, e B menor que C.' }
  return { ok: true }
}

export function dueIso(remindAt, now = new Date()) {
  const due = new Date(dayOnly(remindAt) + 'T12:00:00.000Z')
  return (due.getTime() < now.getTime() ? now : due).toISOString()
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/ltvCompute.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/ltv/compute.js test/ltvCompute.test.js
git commit -m "feat(ltv): calculos de LTV, curva por ritmo, selo e faixas"
```

---

### Task 3: Recalcular o cliente (cache no lead) + backfill no boot

**Files:**
- Create: `server/services/ltv/customer.js`
- Test: `test/ltvCustomer.test.js`
- Modify: `server/db.js` (depois do `applyLtvSchema`)

**Interfaces:**
- Consumes: `customerStats`, `tierFor`, `localDate` (Task 2).
- Produces:
  - `curveConfig(db, accountId) → {a,b,c}`
  - `recalcCustomer(db, leadId, { now } = {}) → { ltv, purchases, lastPurchaseAt, avgIntervalDays, curve, tierId } | null`
  - `recalcAccountCustomers(db, accountId, { now } = {}) → number` (quantos recalculados)
  - `backfillAllCustomers(db, { now } = {}) → number`

- [ ] **Step 1: Teste que falha**

```js
// test/ltvCustomer.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { recalcCustomer, recalcAccountCustomers, backfillAllCustomers, curveConfig } from '../server/services/ltv/customer.js'

const NOW = new Date('2026-09-29T15:00:00Z')

test('recalcCustomer grava LTV, compras, curva e selo no lead', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addSale(db, { accountId: s.accountId, leadId, value: 3000, saleDate: '2026-09-01 10:00:00' })
  addSale(db, { accountId: s.accountId, leadId, value: 2500, saleDate: '2026-09-21 10:00:00' })
  db.prepare("INSERT INTO customer_tiers (account_id, name, min_ltv) VALUES (?, 'Diamante', 5000), (?, 'Premium', 2000)").run(s.accountId, s.accountId)
  const r = recalcCustomer(db, leadId, { now: NOW })
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.ltv, 5500); assert.equal(lead.purchases, 2); assert.equal(lead.last_purchase_at, '2026-09-21')
  assert.equal(lead.avg_interval_days, 20); assert.equal(lead.curve, 'A')
  const diamante = db.prepare("SELECT id FROM customer_tiers WHERE name = 'Diamante'").get().id
  assert.equal(lead.tier_id, diamante); assert.equal(r.tierId, diamante)
})

test('sem vendas zera o cache', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  db.prepare("UPDATE leads SET ltv = 10, purchases = 1, curve = 'A' WHERE id = ?").run(leadId)
  recalcCustomer(db, leadId, { now: NOW })
  const lead = db.prepare('SELECT ltv, purchases, curve, tier_id FROM leads WHERE id = ?').get(leadId)
  assert.deepEqual({ ...lead }, { ltv: 0, purchases: 0, curve: null, tier_id: null })
})

test('curva usa a configuração da conta', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  db.prepare('UPDATE accounts SET curve_a_days = 10, curve_b_days = 15, curve_c_days = 20 WHERE id = ?').run(s.accountId)
  assert.deepEqual(curveConfig(db, s.accountId), { a: 10, b: 15, c: 20 })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addSale(db, { accountId: s.accountId, leadId, saleDate: '2026-09-01' })
  addSale(db, { accountId: s.accountId, leadId, saleDate: '2026-09-21' })
  assert.equal(recalcCustomer(db, leadId, { now: new Date('2026-09-22T15:00:00Z') }).curve, 'C')
})

test('recalcAccountCustomers e backfill só tocam clientes com venda', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const a = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  addSale(db, { accountId: s.accountId, leadId: a, value: 80 })
  assert.equal(recalcAccountCustomers(db, s.accountId, { now: NOW }), 1)
  db.prepare('UPDATE leads SET ltv = 0 WHERE id = ?').run(a)
  assert.equal(backfillAllCustomers(db, { now: NOW }), 1)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(a).ltv, 80)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvCustomer.test.js` → FAIL.

- [ ] **Step 3: Implementar**

```js
// server/services/ltv/customer.js
// Cache do cliente no lead (spec §4.9): LTV, compras, ultima compra, intervalo medio, curva e selo.
import { customerStats, tierFor, localDate } from './compute.js'

export function curveConfig(db, accountId) {
  const a = db.prepare('SELECT curve_a_days, curve_b_days, curve_c_days FROM accounts WHERE id = ?').get(accountId) || {}
  return { a: a.curve_a_days ?? 30, b: a.curve_b_days ?? 45, c: a.curve_c_days ?? 60 }
}

export function recalcCustomer(db, leadId, { now = new Date() } = {}) {
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return null
  const sales = db.prepare('SELECT value, sale_date FROM lead_sales WHERE lead_id = ? ORDER BY sale_date').all(leadId)
  const st = customerStats(sales, { today: localDate(now), curve: curveConfig(db, lead.account_id) })
  const tiers = db.prepare('SELECT id, min_ltv FROM customer_tiers WHERE account_id = ?').all(lead.account_id)
  const tierId = st.purchases ? tierFor(st.ltv, tiers) : null
  db.prepare(`
    UPDATE leads SET ltv = ?, purchases = ?, last_purchase_at = ?, avg_interval_days = ?, curve = ?, tier_id = ?
    WHERE id = ?
  `).run(st.ltv, st.purchases, st.lastPurchaseAt, st.avgIntervalDays, st.curve, tierId, leadId)
  return { ...st, tierId }
}

export function recalcAccountCustomers(db, accountId, { now = new Date() } = {}) {
  const ids = db.prepare(`
    SELECT DISTINCT lead_id AS id FROM lead_sales WHERE account_id = ?
    UNION SELECT id FROM leads WHERE account_id = ? AND purchases > 0
  `).all(accountId, accountId)
  db.transaction(() => { for (const { id } of ids) recalcCustomer(db, id, { now }) })()
  return db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM lead_sales WHERE account_id = ?').get(accountId).n
}

export function backfillAllCustomers(db, { now = new Date() } = {}) {
  let n = 0
  for (const { account_id } of db.prepare('SELECT DISTINCT account_id FROM lead_sales').all()) {
    n += recalcAccountCustomers(db, account_id, { now })
  }
  return n
}
```

- [ ] **Step 4: Backfill no boot** — em `server/db.js`, logo depois do `applyLtvSchema`:

```js
import { backfillAllCustomers } from './services/ltv/customer.js'
// ...
try { const n = backfillAllCustomers(db); if (n) console.log(`[LTV] cache de ${n} clientes recalculado`) } catch (e) { console.error('[LTV] backfill:', e.message) }
```

- [ ] **Step 5: Rodar e ver passar** — `node --test test/ltvCustomer.test.js` → PASS; `npm test` → verde.

- [ ] **Step 6: Commit**

```bash
git add server/services/ltv/customer.js test/ltvCustomer.test.js server/db.js
git commit -m "feat(ltv): cache do cliente no lead (LTV, curva, selo) + backfill no boot"
```

---

### Task 4: Funil Recompra, troca de funil e guardas nos pontos antigos

**Files:**
- Create: `server/services/ltv/funnel.js`
- Modify: `server/services/stageMove.js` (nova export `moveLeadToFunnel`)
- Modify: `server/services/roteiro/runtime.js` (`buildOnMoved`: sem CAPI na recompra)
- Modify: `server/services/inboundHandler.js:366-374` (sem auto-avanço na recompra)
- Modify: `server/services/aiAgent.js:674-679` (agente não move etapa de lead da recompra)
- Modify: `server/db.js` (garantir funil de todas as contas no boot)
- Test: `test/ltvFunnel.test.js`

**Interfaces:**
- Produces:
  - `RECOMPRA_STAGES` (array `{ key, name, color, is_conversion?, is_terminal? }`), `DEFAULT_REASONS`
  - `ensureRepurchaseFunnel(db, accountId) → funnelId` (idempotente; semeia motivos)
  - `ensureAllRepurchaseFunnels(db) → number`
  - `stageIdByKey(db, accountId, key) → number` (garante o funil)
  - `stageKey(db, stageId) → string|null` (system_key)
  - `isRepurchaseFunnel(db, funnelId) → boolean` (tolerante: `false` se a coluna não existir)
  - `checkStagesUpdate(db, funnelId, payloadStages: {id?}[]) → { ok: true } | { ok: false, error }`
  - `canDeactivateFunnel(db, funnelId) → boolean`
  - `moveLeadToFunnel(db, { lead, toFunnelId, toStageId, trigger, userId = null, notes = null, silent = false }) → { moved, fromStageId, toStageId, historyId }` (em `stageMove.js`)

- [ ] **Step 1: Teste que falha**

```js
// test/ltvFunnel.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead } from './helpers/ltvDb.js'
import { ensureRepurchaseFunnel, ensureAllRepurchaseFunnels, stageIdByKey, stageKey, isRepurchaseFunnel, checkStagesUpdate, canDeactivateFunnel } from '../server/services/ltv/funnel.js'
import { moveLeadToFunnel, configureStageMoveHooks } from '../server/services/stageMove.js'
import { bootRoteiroRuntime } from '../server/services/roteiro/runtime.js'

test.afterEach(() => { configureStageMoveHooks({ onMoved: null }) })

test('ensureRepurchaseFunnel cria 6 etapas-chave, motivos e é idempotente', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const f1 = ensureRepurchaseFunnel(db, s.accountId)
  const f2 = ensureRepurchaseFunnel(db, s.accountId)
  assert.equal(f1, f2)
  const f = db.prepare('SELECT * FROM funnels WHERE id = ?').get(f1)
  assert.equal(f.kind, 'recompra'); assert.equal(f.is_default, 0); assert.equal(f.name, 'Recompra')
  const keys = db.prepare('SELECT system_key FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(f1).map(r => r.system_key)
  assert.deepEqual(keys, ['aguardando', 'a_contatar', 'em_conversa', 'comprou', 'nao_agora', 'nao_quer'])
  assert.equal(db.prepare('SELECT repurchase_funnel_id FROM accounts WHERE id = ?').get(s.accountId).repurchase_funnel_id, f1)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_agora'").get(s.accountId).n, 5)
  assert.equal(db.prepare("SELECT COUNT(*) n FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_quer'").get(s.accountId).n, 5)
  assert.equal(isRepurchaseFunnel(db, f1), true); assert.equal(isRepurchaseFunnel(db, s.funnelId), false)
  assert.equal(stageKey(db, stageIdByKey(db, s.accountId, 'comprou')), 'comprou')
  assert.ok(ensureAllRepurchaseFunnels(db) >= 2)
})

test('checkStagesUpdate recusa apagar etapa-chave; canDeactivateFunnel recusa recompra', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const f = ensureRepurchaseFunnel(db, s.accountId)
  const ids = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ?').all(f).map(r => ({ id: r.id }))
  assert.deepEqual(checkStagesUpdate(db, f, ids), { ok: true })
  assert.equal(checkStagesUpdate(db, f, ids.slice(1)).ok, false)
  assert.deepEqual(checkStagesUpdate(db, s.funnelId, []), { ok: true })
  assert.equal(canDeactivateFunnel(db, f), false); assert.equal(canDeactivateFunnel(db, s.funnelId), true)
})

test('moveLeadToFunnel troca funil, grava histórico e não manda CAPI na recompra', () => {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const capi = []
  bootRoteiroRuntime({ db, broadcastSSE: () => {}, triggerCapiForStageChange: (...a) => capi.push(a), schedule: () => {} })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda })
  const f = ensureRepurchaseFunnel(db, s.accountId)
  const to = stageIdByKey(db, s.accountId, 'aguardando')
  const r = moveLeadToFunnel(db, { lead: { id: leadId }, toFunnelId: f, toStageId: to, trigger: 'recompra' })
  assert.equal(r.moved, true)
  const lead = db.prepare('SELECT funnel_id, stage_id FROM leads WHERE id = ?').get(leadId)
  assert.deepEqual({ ...lead }, { funnel_id: f, stage_id: to })
  const h = db.prepare('SELECT * FROM stage_history WHERE lead_id = ? ORDER BY id DESC').get(leadId)
  assert.equal(h.from_stage_id, s.stages.venda); assert.equal(h.to_stage_id, to); assert.equal(h.trigger_type, 'recompra')
  assert.equal(capi.length, 0)
  assert.throws(() => moveLeadToFunnel(db, { lead: { id: leadId }, toFunnelId: f, toStageId: s.stages.novo, trigger: 'recompra' }), /stage_not_in_funnel/)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvFunnel.test.js` → FAIL.

- [ ] **Step 3: Implementar `funnel.js`**

```js
// server/services/ltv/funnel.js
// Funil "Recompra" da conta (spec §6.1) e guardas de funil/etapas (spec §12).
export const RECOMPRA_STAGES = [
  { key: 'aguardando', name: 'Aguardando', color: '#90A4AE' },
  { key: 'a_contatar', name: 'A contatar', color: '#FFB300' },
  { key: 'em_conversa', name: 'Em conversa', color: '#42A5F5' },
  { key: 'comprou', name: 'Comprou de novo', color: '#66BB6A', is_conversion: 1 },
  { key: 'nao_agora', name: 'Não comprou agora', color: '#FF7043' },
  { key: 'nao_quer', name: 'Não quer mais', color: '#8D6E63', is_terminal: 1 },
]

export const DEFAULT_REASONS = {
  nao_agora: ['Achou caro', 'Não precisa agora', 'Sem dinheiro no momento', 'Sem resposta', 'Outro'],
  nao_quer: ['Comprou do concorrente', 'Insatisfeito com a compra', 'Não usa mais o produto', 'Pediu para não ser chamado', 'Outro'],
}

function seedReasons(db, accountId) {
  const has = db.prepare('SELECT 1 FROM repurchase_reasons WHERE account_id = ? LIMIT 1').get(accountId)
  if (has) return
  const ins = db.prepare('INSERT INTO repurchase_reasons (account_id, grp, label, position) VALUES (?, ?, ?, ?)')
  for (const grp of ['nao_agora', 'nao_quer']) DEFAULT_REASONS[grp].forEach((label, i) => ins.run(accountId, grp, label, i))
}

export function ensureRepurchaseFunnel(db, accountId) {
  return db.transaction(() => {
    const acc = db.prepare('SELECT repurchase_funnel_id FROM accounts WHERE id = ?').get(accountId)
    let id = acc?.repurchase_funnel_id
    if (id && !db.prepare("SELECT 1 FROM funnels WHERE id = ? AND account_id = ? AND kind = 'recompra'").get(id, accountId)) id = null
    if (!id) id = db.prepare("SELECT id FROM funnels WHERE account_id = ? AND kind = 'recompra' ORDER BY id LIMIT 1").get(accountId)?.id
    if (!id) {
      id = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active, kind) VALUES (?, 'Recompra', 0, 1, 'recompra')").run(accountId).lastInsertRowid)
      const ins = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, system_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      RECOMPRA_STAGES.forEach((st, i) => ins.run(id, st.name, i, st.color, st.is_conversion || 0, st.is_terminal || 0, st.key))
    }
    db.prepare('UPDATE accounts SET repurchase_funnel_id = ? WHERE id = ?').run(id, accountId)
    seedReasons(db, accountId)
    return id
  })()
}

export function ensureAllRepurchaseFunnels(db) {
  const ids = db.prepare('SELECT id FROM accounts').all()
  for (const { id } of ids) ensureRepurchaseFunnel(db, id)
  return ids.length
}

export function stageIdByKey(db, accountId, key) {
  const funnelId = ensureRepurchaseFunnel(db, accountId)
  return db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? AND system_key = ?').get(funnelId, key)?.id ?? null
}

export function stageKey(db, stageId) {
  try { return db.prepare('SELECT system_key FROM funnel_stages WHERE id = ?').get(stageId)?.system_key ?? null } catch { return null }
}

export function isRepurchaseFunnel(db, funnelId) {
  try { return db.prepare('SELECT kind FROM funnels WHERE id = ?').get(funnelId)?.kind === 'recompra' } catch { return false }
}

export function checkStagesUpdate(db, funnelId, payloadStages) {
  if (!isRepurchaseFunnel(db, funnelId)) return { ok: true }
  const keep = new Set((payloadStages || []).map(s => Number(s.id)).filter(Boolean))
  const system = db.prepare('SELECT id, name FROM funnel_stages WHERE funnel_id = ? AND system_key IS NOT NULL').all(funnelId)
  const missing = system.filter(s => !keep.has(s.id))
  if (missing.length) return { ok: false, error: `A etapa "${missing[0].name}" é usada pela recompra e não pode ser apagada. Você pode renomear ou mudar a cor.` }
  return { ok: true }
}

export function canDeactivateFunnel(db, funnelId) {
  return !isRepurchaseFunnel(db, funnelId)
}
```

- [ ] **Step 4: `moveLeadToFunnel` em `server/services/stageMove.js`** (depois de `moveLeadToStage`)

```js
// Troca de FUNIL (recompra, spec 6.2): sem trava de roteiro, mesmo historico e mesmos hooks da troca de etapa.
export function moveLeadToFunnel(db, { lead, toFunnelId, toStageId, trigger, userId = null, notes = null, silent = false }) {
  const current = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  const targetStage = db.prepare('SELECT id FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(toStageId, toFunnelId)
  if (!targetStage) throw new Error('stage_not_in_funnel')
  if (current.funnel_id === toFunnelId) {
    return moveLeadToStage(db, { lead: current, toStageId, trigger, userId, notes, gate: false, silent })
  }
  const fromStageId = current.stage_id
  let historyId
  db.transaction(() => {
    db.prepare("UPDATE leads SET funnel_id = ?, stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(toFunnelId, toStageId, current.id)
    historyId = db.prepare(`
      INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by, notes) VALUES (?, ?, ?, ?, ?, ?)
    `).run(current.id, fromStageId, toStageId, trigger, userId, notes).lastInsertRowid
  })()
  try { onStageMoved(db, { leadId: current.id, trigger }) } catch (e) { if (!warnMissingCadenceTable(e)) console.error('[Cadencia] troca de funil:', e.message) }
  onMovedHook({ db, lead: current, fromStageId, toStageId, historyId, trigger, silent })
  return { moved: true, fromStageId, toStageId, historyId }
}
```

(Se `moveLeadToStage` não tiver o `try/catch` com `warnMissingCadenceTable` exatamente assim, copie o formato que ele usa em volta de `onStageMoved`.)

- [ ] **Step 5: Sem CAPI na recompra — `server/services/roteiro/runtime.js`, `buildOnMoved`**

Troque a linha do CAPI por:

```js
    try {
      const kind = db.prepare('SELECT f.kind FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id WHERE s.id = ?').get(toStageId)?.kind
      if (kind !== 'recompra') triggerCapiForStageChange(lead.id, toStageId, historyId)
    } catch (e) { console.error('[Roteiro] CAPI:', e.message) }
```

- [ ] **Step 6: Sem auto-avanço na recompra — `server/services/inboundHandler.js:369`**

```js
import { isRepurchaseFunnel } from './ltv/funnel.js'   // no topo
// ...
    if (!isNew && !fromMe && !isRepurchaseFunnel(db, lead.funnel_id)) {
```

Teste: em `test/inboundHandler.test.js`, localize o teste que confere o avanço da 1ª para a 2ª etapa quando o lead responde (procure `stage2`). Copie-o como novo teste `'lead no funil Recompra não avança sozinho ao responder'`: depois do `seedBasic`, rode `applyLtvSchema(db)`, crie `const f = ensureRepurchaseFunnel(db, account.id)`, ponha o lead em `funnel_id = f, stage_id = stageIdByKey(db, account.id, 'aguardando')` e confira que após a mensagem recebida o `stage_id` continua `aguardando`.

- [ ] **Step 7: Agente não mexe na etapa de lead da recompra — `server/services/aiAgent.js:674`**

```js
import { isRepurchaseFunnel } from './ltv/funnel.js'   // no topo
// ...
    const availableStages = isRepurchaseFunnel(db, lead.funnel_id) ? [] : db.prepare(`
      SELECT s.id, s.name FROM funnel_stages s
      JOIN funnels f ON f.id = s.funnel_id
      WHERE f.account_id = ? AND f.is_default = 1
      ORDER BY s.position
    `).all(lead.account_id)
```

(Confira que `aiAgent.js` tem `db` no escopo com esse nome; se usar outro nome, use o dele.)

- [ ] **Step 8: Boot** — em `server/db.js`, depois do backfill:

```js
import { ensureAllRepurchaseFunnels } from './services/ltv/funnel.js'
// ...
try { ensureAllRepurchaseFunnels(db) } catch (e) { console.error('[LTV] funil Recompra:', e.message) }
```

E nos dois lugares que criam conta nova (`server/routes/accounts.js:34-47` e `server/routes/contracts.js:356-369`), logo após criar o funil principal: `ensureRepurchaseFunnel(db, accountId)` (use a variável de id da conta que existe ali).

- [ ] **Step 9: Rodar** — `node --test test/ltvFunnel.test.js test/inboundHandler.test.js test/stageMove.test.js` → PASS; `npm test` → verde.

- [ ] **Step 10: Commit**

```bash
git add server/services/ltv/funnel.js server/services/stageMove.js server/services/roteiro/runtime.js server/services/inboundHandler.js server/services/aiAgent.js server/db.js server/routes/accounts.js server/routes/contracts.js test/ltvFunnel.test.js test/inboundHandler.test.js
git commit -m "feat(ltv): funil Recompra, troca de funil e guardas (CAPI, auto-avanco, agente)"
```

---

### Task 5: Ciclo de recompra (abrir, fechar, desfecho, desfazer, conversa)

**Files:**
- Create: `server/services/ltv/cycles.js`
- Test: `test/ltvCycles.test.js`

**Interfaces:**
- Consumes: `addDays`, `localDate` (T2); `recalcCustomer` (T3); `ensureRepurchaseFunnel`, `stageIdByKey`, `stageKey`, `isRepurchaseFunnel` (T4); `moveLeadToFunnel`, `moveLeadToStage` (stageMove).
- Produces:
  - `openCycleForLead(db, leadId) → cycle|null`
  - `wantsCycle(sale) → boolean`
  - `onSaleCreated(db, { saleId, userId = null, now }) → { cycleId: number|null, dueNow: boolean, optOut: boolean }`
  - `onSaleDeleted(db, { leadId, saleId, now })` — chamar ANTES do `DELETE`
  - `recordOutcome(db, { leadId, outcome: 'nao_agora'|'nao_quer', reasonId, nextDays, userId, now }) → { ok: true, cycle } | { ok: false, status, error }`
  - `undoOptOut(db, { leadId, userId, now }) → { ok: true }`
  - `onMessageExchanged(db, { leadId, now })` — a_contatar → em_conversa
  - `syncCycleWithStage(db, { leadId, toStageId })` — arrastar manual entre aguardando/a_contatar/em_conversa acompanha no ciclo
  - `completeTask(db, taskId, note)` (helper exportado, usado por T6/T8)

- [ ] **Step 1: Teste que falha**

```js
// test/ltvCycles.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { onSaleCreated, onSaleDeleted, recordOutcome, undoOptOut, onMessageExchanged, openCycleForLead, syncCycleWithStage } from '../server/services/ltv/cycles.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function base() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, attendant_id: s.atendenteId })
  return { db, s, leadId }
}
const stageOf = (db, id) => db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(id).stage_id
const reason = (db, accountId, grp) => db.prepare('SELECT id FROM repurchase_reasons WHERE account_id = ? AND grp = ? ORDER BY position LIMIT 1').get(accountId, grp).id

test('venda "pode recomprar" abre ciclo e leva o lead para Aguardando', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-09-29 10:00:00' })
  const r = onSaleCreated(db, { saleId, now: NOW })
  assert.equal(r.dueNow, false)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'aguardando'); assert.equal(c.remind_at, '2026-10-29'); assert.equal(c.kind, 'recompra'); assert.equal(c.attempt, 1)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'aguardando'))
})

test('compra única com oferta abre ciclo "cruzada"; sem oferta não mexe', () => {
  const { db, s, leadId } = base()
  const s1 = addSale(db, { accountId: s.accountId, leadId, kind: 'unica' })
  assert.equal(onSaleCreated(db, { saleId: s1, now: NOW }).cycleId, null)
  assert.equal(stageOf(db, leadId), s.stages.venda)
  const s2 = addSale(db, { accountId: s.accountId, leadId, kind: 'unica', crossSell: 1, remindDays: 15, offer: 'espetos', saleDate: '2026-09-29' })
  onSaleCreated(db, { saleId: s2, now: NOW })
  const c = openCycleForLead(db, leadId)
  assert.equal(c.kind, 'cruzada'); assert.equal(c.offer_text, 'espetos'); assert.equal(c.remind_at, '2026-10-14')
})

test('venda retroativa já vencida volta dueNow', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-10 10:00:00' })
  assert.equal(onSaleCreated(db, { saleId, now: NOW }).dueNow, true)
})

test('nova venda fecha o ciclo aberto como comprou e abre outro', () => {
  const { db, s, leadId } = base()
  const a = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-01' })
  onSaleCreated(db, { saleId: a, now: NOW })
  const first = openCycleForLead(db, leadId)
  db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa' WHERE id = ?").run(first.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, first.id, leadId)
  const b = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 45, saleDate: '2026-09-29' })
  onSaleCreated(db, { saleId: b, now: NOW })
  assert.equal(db.prepare('SELECT status FROM repurchase_cycles WHERE id = ?').get(first.id).status, 'comprou')
  assert.equal(db.prepare('SELECT outcome FROM repurchase_attempts WHERE cycle_id = ?').get(first.id).outcome, 'comprou')
  const now2 = openCycleForLead(db, leadId)
  assert.equal(now2.attempt, 1); assert.equal(now2.remind_days, 45)
})

test('cliente com "não quer mais" compra: soma, mas não abre ciclo', () => {
  const { db, s, leadId } = base()
  db.prepare('UPDATE leads SET repurchase_opt_out = 1 WHERE id = ?').run(leadId)
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  const r = onSaleCreated(db, { saleId, now: NOW })
  assert.equal(r.cycleId, null); assert.equal(r.optOut, true)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(leadId).ltv, 100)
})

test('apagar a venda do ciclo encerra o ciclo e preserva tentativas', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  const c = openCycleForLead(db, leadId)
  const taskId = db.prepare("INSERT INTO standalone_tasks (account_id, lead_id, title, due_datetime) VALUES (?, ?, 'x', '2026-10-01')").run(s.accountId, leadId).lastInsertRowid
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar', task_id = ? WHERE id = ?").run(taskId, c.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, c.id, leadId)
  onSaleDeleted(db, { leadId, saleId, now: NOW })
  db.prepare('DELETE FROM lead_sales WHERE id = ?').run(saleId)
  const after = db.prepare('SELECT status, sale_id FROM repurchase_cycles WHERE id = ?').get(c.id)
  assert.equal(after.status, 'encerrado'); assert.equal(after.sale_id, null)
  assert.equal(db.prepare('SELECT status FROM standalone_tasks WHERE id = ?').get(taskId).status, 'completed')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).n, 1)
})

test('não comprou agora: motivo obrigatório, nova tentativa e volta para Aguardando', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, saleDate: '2026-08-01' })
  onSaleCreated(db, { saleId, now: NOW })
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: null, now: NOW }).ok, false)
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_quer'), now: NOW }).ok, false) // motivo do grupo errado
  const r = recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_agora'), nextDays: 15, userId: s.atendenteId, now: NOW })
  assert.equal(r.ok, true)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.attempt, 2); assert.equal(c.remind_at, '2026-10-14'); assert.equal(c.remind_days, 15); assert.equal(c.status, 'aguardando')
  const att = db.prepare('SELECT * FROM repurchase_attempts WHERE cycle_id = ? AND attempt = 1').get(c.id)
  assert.equal(att.outcome, 'nao_agora'); assert.equal(att.next_remind_days, 15)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'aguardando'))
})

test('não comprou agora sem dias usa o prazo anterior', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 45 })
  onSaleCreated(db, { saleId, now: NOW })
  recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: reason(db, s.accountId, 'nao_agora'), now: NOW })
  assert.equal(openCycleForLead(db, leadId).remind_days, 45)
})

test('não quer mais: fecha, marca opt-out; desfazer reabre em 7 dias', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  assert.equal(recordOutcome(db, { leadId, outcome: 'nao_quer', reasonId: reason(db, s.accountId, 'nao_quer'), userId: s.gerenteId, now: NOW }).ok, true)
  assert.equal(openCycleForLead(db, leadId), null)
  assert.equal(db.prepare('SELECT repurchase_opt_out FROM leads WHERE id = ?').get(leadId).repurchase_opt_out, 1)
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'nao_quer'))
  undoOptOut(db, { leadId, userId: s.gerenteId, now: NOW })
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'aguardando'); assert.equal(c.remind_at, '2026-10-06'); assert.equal(c.attempt, 2)
  assert.equal(db.prepare('SELECT repurchase_opt_out FROM leads WHERE id = ?').get(leadId).repurchase_opt_out, 0)
})

test('sem ciclo aberto recordOutcome devolve 409', () => {
  const { db, leadId } = base()
  const r = recordOutcome(db, { leadId, outcome: 'nao_agora', reasonId: 1, now: NOW })
  assert.equal(r.ok, false); assert.equal(r.status, 409)
})

test('mensagem trocada em A contatar vai para Em conversa', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  const c = openCycleForLead(db, leadId)
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar' WHERE id = ?").run(c.id)
  db.prepare("INSERT INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind) VALUES (?, ?, ?, 1, 'recompra')").run(s.accountId, c.id, leadId)
  db.prepare('UPDATE leads SET stage_id = ? WHERE id = ?').run(stageIdByKey(db, s.accountId, 'a_contatar'), leadId)
  onMessageExchanged(db, { leadId, now: NOW })
  assert.equal(openCycleForLead(db, leadId).status, 'em_conversa')
  assert.equal(stageOf(db, leadId), stageIdByKey(db, s.accountId, 'em_conversa'))
  assert.ok(db.prepare('SELECT contacted_at FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).contacted_at)
  onMessageExchanged(db, { leadId, now: NOW }) // 2a vez não quebra
})

test('arrastar manual para Em conversa acompanha no ciclo', () => {
  const { db, s, leadId } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30 })
  onSaleCreated(db, { saleId, now: NOW })
  syncCycleWithStage(db, { leadId, toStageId: stageIdByKey(db, s.accountId, 'em_conversa') })
  assert.equal(openCycleForLead(db, leadId).status, 'em_conversa')
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvCycles.test.js` → FAIL.

- [ ] **Step 3: Implementar**

```js
// server/services/ltv/cycles.js
// Ciclo de recompra / venda cruzada (spec §5, §6.3). Nao importa server/db.js.
import { addDays, localDate } from './compute.js'
import { recalcCustomer } from './customer.js'
import { ensureRepurchaseFunnel, stageIdByKey, stageKey } from './funnel.js'
import { moveLeadToFunnel, moveLeadToStage } from '../stageMove.js'
import { OPEN_STATUSES, REMIND_DAYS } from './schema.js'

const OPEN_SQL = `status IN (${OPEN_STATUSES.map(s => `'${s}'`).join(',')})`
const nowSql = now => now.toISOString().slice(0, 19).replace('T', ' ')

export function openCycleForLead(db, leadId) {
  return db.prepare(`SELECT * FROM repurchase_cycles WHERE lead_id = ? AND ${OPEN_SQL}`).get(leadId) || null
}

export function wantsCycle(sale) {
  return sale.sale_kind === 'recompra' || (sale.sale_kind === 'unica' && !!sale.cross_sell)
}

export function completeTask(db, taskId, note = null) {
  if (!taskId) return
  db.prepare(`
    UPDATE standalone_tasks SET status = 'completed', completed_at = datetime('now'),
      description = CASE WHEN ? IS NULL THEN description ELSE COALESCE(description, '') || char(10) || ? END
    WHERE id = ? AND status = 'pending'
  `).run(note, note, taskId)
}

function openAttempt(db, cycleId) {
  return db.prepare('SELECT * FROM repurchase_attempts WHERE cycle_id = ? AND outcome IS NULL ORDER BY attempt DESC LIMIT 1').get(cycleId)
}

function moveToKey(db, lead, key, userId = null) {
  const toStageId = stageIdByKey(db, lead.account_id, key)
  const funnelId = ensureRepurchaseFunnel(db, lead.account_id)
  const current = db.prepare('SELECT funnel_id, stage_id FROM leads WHERE id = ?').get(lead.id)
  if (current.stage_id === toStageId) return
  if (current.funnel_id === funnelId) moveLeadToStage(db, { lead: { id: lead.id }, toStageId, trigger: 'recompra', userId, gate: false })
  else moveLeadToFunnel(db, { lead: { id: lead.id }, toFunnelId: funnelId, toStageId, trigger: 'recompra', userId })
}

function inRepurchaseFunnel(db, lead) {
  const f = db.prepare('SELECT funnel_id FROM leads WHERE id = ?').get(lead.id)
  return f && f.funnel_id === ensureRepurchaseFunnel(db, lead.account_id)
}

function closeOnPurchase(db, cycle, now) {
  const att = openAttempt(db, cycle.id)
  if (att) db.prepare('UPDATE repurchase_attempts SET outcome = ?, decided_at = ? WHERE id = ?').run('comprou', nowSql(now), att.id)
  db.prepare("UPDATE repurchase_cycles SET status = 'comprou', closed_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowSql(now), cycle.id)
  completeTask(db, cycle.task_id, 'Cliente comprou de novo.')
}

export function onSaleCreated(db, { saleId, userId = null, now = new Date() }) {
  const sale = db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId)
  const lead = db.prepare('SELECT id, account_id, repurchase_opt_out FROM leads WHERE id = ?').get(sale.lead_id)
  let result = { cycleId: null, dueNow: false, optOut: false }
  db.transaction(() => {
    const prev = openCycleForLead(db, lead.id)
    if (prev) closeOnPurchase(db, prev, now)
    recalcCustomer(db, lead.id, { now })
    if (!wantsCycle(sale)) {
      if (prev && inRepurchaseFunnel(db, lead)) moveToKey(db, lead, 'comprou', userId)
      return
    }
    if (lead.repurchase_opt_out) { result.optOut = true; return }
    const remindAt = addDays(sale.sale_date, sale.remind_days)
    const cycleId = Number(db.prepare(`
      INSERT INTO repurchase_cycles (account_id, lead_id, sale_id, kind, status, remind_at, remind_days, attempt, offer_text)
      VALUES (?, ?, ?, ?, 'aguardando', ?, ?, 1, ?)
    `).run(lead.account_id, lead.id, sale.id, sale.sale_kind === 'recompra' ? 'recompra' : 'cruzada', remindAt, sale.remind_days, sale.cross_sell_offer || null).lastInsertRowid)
    moveToKey(db, lead, 'aguardando', userId)
    result = { cycleId, dueNow: remindAt <= localDate(now), optOut: false }
  })()
  return result
}

export function onSaleDeleted(db, { leadId, saleId, now = new Date() }) {
  const c = db.prepare(`SELECT * FROM repurchase_cycles WHERE lead_id = ? AND sale_id = ? AND ${OPEN_SQL}`).get(leadId, saleId)
  if (!c) return
  db.transaction(() => {
    const att = openAttempt(db, c.id)
    if (att) db.prepare("UPDATE repurchase_attempts SET outcome = 'sem_desfecho', decided_at = ? WHERE id = ?").run(nowSql(now), att.id)
    db.prepare("UPDATE repurchase_cycles SET status = 'encerrado', closed_at = ?, updated_at = datetime('now') WHERE id = ?").run(nowSql(now), c.id)
    completeTask(db, c.task_id, 'Venda apagada.')
  })()
}

export function recordOutcome(db, { leadId, outcome, reasonId, nextDays = null, userId = null, now = new Date() }) {
  if (!['nao_agora', 'nao_quer'].includes(outcome)) return { ok: false, status: 400, error: 'Desfecho inválido.' }
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return { ok: false, status: 404, error: 'Lead não encontrado.' }
  const cycle = openCycleForLead(db, leadId)
  if (!cycle) return { ok: false, status: 409, error: 'Este cliente não tem recompra em andamento.' }
  const reason = reasonId && db.prepare('SELECT * FROM repurchase_reasons WHERE id = ? AND account_id = ? AND grp = ?').get(reasonId, lead.account_id, outcome)
  if (!reason) return { ok: false, status: 400, error: 'Escolha o motivo.' }
  const days = nextDays == null ? cycle.remind_days : Number(nextDays)
  if (outcome === 'nao_agora' && !REMIND_DAYS.includes(days)) return { ok: false, status: 400, error: 'Prazo inválido.' }
  const ts = nowSql(now)
  db.transaction(() => {
    let att = openAttempt(db, cycle.id)
    if (!att) {
      db.prepare('INSERT OR IGNORE INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind, contacted_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(lead.account_id, cycle.id, leadId, cycle.attempt, cycle.kind, ts)
      att = openAttempt(db, cycle.id)
    }
    if (att) {
      db.prepare('UPDATE repurchase_attempts SET outcome = ?, reason_id = ?, next_remind_days = ?, decided_at = ?, decided_by = ? WHERE id = ?')
        .run(outcome, reason.id, outcome === 'nao_agora' ? days : null, ts, userId, att.id)
    }
    completeTask(db, cycle.task_id, outcome === 'nao_agora' ? `Não comprou agora: ${reason.label}` : `Não quer mais: ${reason.label}`)
    if (outcome === 'nao_agora') {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'aguardando', attempt = attempt + 1, remind_at = ?, remind_days = ?, task_id = NULL,
          ai_suggestion = NULL, auto_sent_at = NULL, auto_failed_reason = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(addDays(localDate(now), days), days, cycle.id)
      moveToKey(db, lead, 'aguardando', userId)
    } else {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'nao_quer', closed_reason_id = ?, closed_at = ?, closed_by = ?, task_id = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(reason.id, ts, userId, cycle.id)
      db.prepare('UPDATE leads SET repurchase_opt_out = 1 WHERE id = ?').run(leadId)
      moveToKey(db, lead, 'nao_quer', userId)
    }
  })()
  return { ok: true, cycle: db.prepare('SELECT * FROM repurchase_cycles WHERE id = ?').get(cycle.id) }
}

export function undoOptOut(db, { leadId, userId = null, now = new Date() }) {
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(leadId)
  if (!lead) return { ok: false, status: 404, error: 'Lead não encontrado.' }
  db.transaction(() => {
    db.prepare('UPDATE leads SET repurchase_opt_out = 0 WHERE id = ?').run(leadId)
    const last = db.prepare("SELECT * FROM repurchase_cycles WHERE lead_id = ? AND status = 'nao_quer' ORDER BY id DESC LIMIT 1").get(leadId)
    if (last && !openCycleForLead(db, leadId)) {
      db.prepare(`
        UPDATE repurchase_cycles SET status = 'aguardando', attempt = attempt + 1, remind_at = ?, exhausted = 0,
          closed_reason_id = NULL, closed_at = NULL, closed_by = NULL, updated_at = datetime('now') WHERE id = ?
      `).run(addDays(localDate(now), 7), last.id)
      moveToKey(db, lead, 'aguardando', userId)
    }
  })()
  return { ok: true }
}

export function onMessageExchanged(db, { leadId, now = new Date() }) {
  const c = db.prepare("SELECT * FROM repurchase_cycles WHERE lead_id = ? AND status = 'a_contatar'").get(leadId)
  if (!c) return
  const lead = db.prepare('SELECT id, account_id, stage_id FROM leads WHERE id = ?').get(leadId)
  db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa', updated_at = datetime('now') WHERE id = ?").run(c.id)
  db.prepare('UPDATE repurchase_attempts SET contacted_at = COALESCE(contacted_at, ?) WHERE cycle_id = ? AND attempt = ?').run(nowSql(now), c.id, c.attempt)
  if (stageKey(db, lead.stage_id) === 'a_contatar') moveToKey(db, lead, 'em_conversa')
}

const STATUS_BY_KEY = { aguardando: 'aguardando', a_contatar: 'a_contatar', em_conversa: 'em_conversa' }
export function syncCycleWithStage(db, { leadId, toStageId }) {
  const status = STATUS_BY_KEY[stageKey(db, toStageId)]
  if (!status) return
  db.prepare(`UPDATE repurchase_cycles SET status = ?, updated_at = datetime('now') WHERE lead_id = ? AND ${OPEN_SQL} AND status != ?`).run(status, leadId, status)
}
```

- [ ] **Step 4: Sincronizar arraste manual** — em `server/services/stageMove.js`, dentro de `moveLeadToStage`, logo depois da chamada a `onStageMoved(...)` (fora da transação):

```js
import { syncCycleWithStage } from './ltv/cycles.js'   // topo
// ...
  try { syncCycleWithStage(db, { leadId: current.id, toStageId }) } catch (e) { console.error('[Recompra] sincronizar ciclo:', e.message) }
```

(O import é circular — `cycles.js` importa `stageMove.js` —, mas só usa as funções em tempo de execução; ESM resolve. Se o Node reclamar, mova a chamada para o `buildOnMoved` do `runtime.js`.)

- [ ] **Step 5: Rodar** — `node --test test/ltvCycles.test.js test/stageMove.test.js` → PASS; `npm test` → verde.

- [ ] **Step 6: Commit**

```bash
git add server/services/ltv/cycles.js server/services/stageMove.js test/ltvCycles.test.js
git commit -m "feat(ltv): ciclo de recompra (abrir, fechar, desfechos, desfazer, conversa)"
```

---

### Task 6: Tarefa do lembrete + sugestão da IA

**Files:**
- Create: `server/services/ltv/reminder.js`
- Create: `server/services/ltv/aiRuntime.js`
- Modify: `server/services/aiBudget.js` (fonte nova em `ROTEIRO_SOURCES`)
- Test: `test/ltvReminder.test.js`

**Interfaces:**
- Consumes: `dueIso`, `localDate` (T2); `openCycleForLead`, `completeTask` (T5); `stageIdByKey`, `ensureRepurchaseFunnel` (T4); `moveLeadToStage`; `toolInput` de `roteiro/aiCall.js`.
- Produces:
  - `taskAssignee(db, cycle) → userId|null`
  - `reminderTitle({ kind, leadName, product, remindDays }) → string`
  - `suggestOffer(ai, { accountId, leadId, leadName, product, value, saleDate, notes, offerText, kind }) → Promise<{ products: string[], message: string } | null>`
  - `activateCycle(db, { cycleId, ai = null, now }) → Promise<{ taskId } | { skipped: true } | { exhausted: true }>`
  - `repurchaseAiFor(db, accountId) → ai|null` (em `aiRuntime.js`, produção)
  - Objeto `ai` = `{ call(opts) → Promise<{toolUses}>, isAvailable(accountId) → boolean }` (mesmo formato de `buildRoteiroAi`).

- [ ] **Step 1: Teste que falha**

```js
// test/ltvReminder.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { onSaleCreated, openCycleForLead } from '../server/services/ltv/cycles.js'
import { activateCycle, reminderTitle, taskAssignee } from '../server/services/ltv/reminder.js'

const NOW = new Date('2026-10-29T15:00:00Z')
function setup({ kind = 'recompra', crossSell = 0, offer = null, attendant = true } = {}) {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Maria', attendant_id: attendant ? s.atendenteId : null })
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind, crossSell, offer, remindDays: 30, product: 'Pacote pilates', value: 450, saleDate: '2026-09-29 10:00:00', createdBy: s.gerenteId })
  onSaleCreated(db, { saleId, now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, leadId, cycle: openCycleForLead(db, leadId) }
}
const fakeAi = (input, calls = []) => ({
  isAvailable: () => true,
  call: async (opts) => { calls.push(opts); return { toolUses: [{ name: 'suggest_offer', input }] } },
})

test('reminderTitle', () => {
  assert.equal(reminderTitle({ kind: 'recompra', leadName: 'Maria', product: 'Pilates', remindDays: 30 }), 'Lembrar Maria da recompra (Pilates, 30 dias)')
  assert.equal(reminderTitle({ kind: 'cruzada', leadName: 'João', product: 'Churrasqueira', remindDays: 15 }), 'Oferecer relacionados a João (comprou Churrasqueira)')
  assert.equal(reminderTitle({ kind: 'recompra', leadName: null, product: null, remindDays: 7 }), 'Lembrar cliente da recompra (7 dias)')
})

test('activateCycle cria tarefa, tentativa e move para A contatar', async () => {
  const { db, s, leadId, cycle } = setup()
  const r = await activateCycle(db, { cycleId: cycle.id, now: NOW })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(r.taskId)
  assert.equal(task.title, 'Lembrar Maria da recompra (Pacote pilates, 30 dias)')
  assert.equal(task.assigned_to, s.atendenteId); assert.equal(task.lead_id, leadId); assert.equal(task.repurchase_cycle_id, cycle.id)
  assert.equal(task.due_datetime, '2026-10-29T15:00:00.000Z') // 09h BRT já passou -> agora
  assert.match(task.description, /Tentativa 1 de 5/)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'a_contatar'); assert.equal(c.task_id, r.taskId)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM repurchase_attempts WHERE cycle_id = ?').get(cycle.id).n, 1)
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId).stage_id, stageIdByKey(db, s.accountId, 'a_contatar'))
})

test('activateCycle é idempotente', async () => {
  const { db, cycle } = setup()
  await activateCycle(db, { cycleId: cycle.id, now: NOW })
  assert.deepEqual(await activateCycle(db, { cycleId: cycle.id, now: NOW }), { skipped: true })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks').get().n, 1)
})

test('sem atendente, responsável = quem vendeu', () => {
  const { db, s, cycle } = setup({ attendant: false })
  assert.equal(taskAssignee(db, cycle), s.gerenteId)
})

test('tentativas esgotadas não criam tarefa', async () => {
  const { db, cycle } = setup()
  db.prepare('UPDATE repurchase_cycles SET attempt = 6 WHERE id = ?').run(cycle.id)
  assert.deepEqual(await activateCycle(db, { cycleId: cycle.id, now: NOW }), { exhausted: true })
  assert.equal(db.prepare('SELECT exhausted FROM repurchase_cycles WHERE id = ?').get(cycle.id).exhausted, 1)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks').get().n, 0)
})

test('cruzada sem "o que oferecer" usa sugestão da IA e guarda em ai_suggestion', async () => {
  const { db, cycle } = setup({ kind: 'unica', crossSell: 1 })
  const calls = []
  const r = await activateCycle(db, { cycleId: cycle.id, ai: fakeAi({ products: ['Espetos', 'Tábua'], message: 'Oi Maria!' }, calls), now: NOW })
  assert.equal(calls[0].source, 'repurchase_offer')
  const task = db.prepare('SELECT description FROM standalone_tasks WHERE id = ?').get(r.taskId)
  assert.match(task.description, /Espetos, Tábua/); assert.match(task.description, /Oi Maria!/)
  assert.deepEqual(JSON.parse(db.prepare('SELECT ai_suggestion FROM repurchase_cycles WHERE id = ?').get(cycle.id).ai_suggestion), { products: ['Espetos', 'Tábua'], message: 'Oi Maria!' })
})

test('IA com erro não bloqueia a tarefa', async () => {
  const { db, cycle } = setup({ kind: 'unica', crossSell: 1, offer: 'espetos' })
  const ai = { isAvailable: () => true, call: async () => { throw new Error('boom') } }
  const r = await activateCycle(db, { cycleId: cycle.id, ai, now: NOW })
  assert.ok(r.taskId)
  assert.match(db.prepare('SELECT description FROM standalone_tasks WHERE id = ?').get(r.taskId).description, /espetos/)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvReminder.test.js` → FAIL.

- [ ] **Step 3: Implementar `reminder.js`**

```js
// server/services/ltv/reminder.js
// Tarefa do lembrete de recompra / venda cruzada (spec §7) e sugestao da IA (§7.1).
import { dueIso } from './compute.js'
import { completeTask } from './cycles.js'
import { stageIdByKey, ensureRepurchaseFunnel } from './funnel.js'
import { moveLeadToStage } from '../stageMove.js'
import { toolInput } from '../roteiro/aiCall.js'

const brl = v => `R$ ${Number(v || 0).toFixed(2).replace('.', ',')}`
const brDate = s => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')

export function reminderTitle({ kind, leadName, product, remindDays }) {
  const name = leadName || 'cliente'
  if (kind === 'cruzada') return `Oferecer relacionados a ${name}${product ? ` (comprou ${product})` : ''}`
  return `Lembrar ${name} da recompra (${product ? `${product}, ` : ''}${remindDays} dias)`
}

export function taskAssignee(db, cycle) {
  const lead = db.prepare('SELECT attendant_id FROM leads WHERE id = ?').get(cycle.lead_id)
  if (lead?.attendant_id) return lead.attendant_id
  const sale = cycle.sale_id && db.prepare('SELECT created_by FROM lead_sales WHERE id = ?').get(cycle.sale_id)
  return sale?.created_by || null
}

const SUGGEST_TOOL = {
  name: 'suggest_offer',
  description: 'Sugere produtos relacionados e uma mensagem curta de WhatsApp para o vendedor enviar.',
  input_schema: {
    type: 'object',
    properties: {
      products: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      message: { type: 'string', description: 'Mensagem curta, em português do Brasil, tom amigável, sem inventar preço.' },
    },
    required: ['products', 'message'],
  },
}

export async function suggestOffer(ai, { accountId, leadId, leadName, product, value, saleDate, notes, offerText, kind }) {
  if (!ai || !ai.isAvailable(accountId)) return null
  const pedido = kind === 'cruzada'
    ? 'O cliente fez uma compra única. Sugira 3 a 5 produtos RELACIONADOS ao que ele comprou e escreva a mensagem oferecendo.'
    : 'O cliente costuma recomprar. Escreva a mensagem lembrando da recompra; em "products" repita o produto comprado.'
  const content = [
    pedido,
    `Cliente: ${leadName || 'cliente'}`,
    `Comprou: ${product || 'não informado'} por ${brl(value)} em ${brDate(saleDate)}`,
    notes ? `Observação da venda: ${notes}` : null,
    offerText ? `O vendedor quer oferecer: ${offerText}` : null,
  ].filter(Boolean).join('\n')
  try {
    const result = await ai.call({
      accountId, leadId, maxTokens: 600, source: 'repurchase_offer',
      systemPrompt: 'Você ajuda vendedores brasileiros a reativar clientes pelo WhatsApp. Responda só pela ferramenta.',
      messages: [{ role: 'user', content }],
      tools: [SUGGEST_TOOL], toolChoice: { type: 'tool', name: 'suggest_offer' },
    })
    const input = toolInput(result, 'suggest_offer')
    if (!input || !Array.isArray(input.products) || typeof input.message !== 'string') return null
    return { products: input.products.map(String).slice(0, 5), message: input.message.trim() }
  } catch (e) {
    console.error('[Recompra] sugestao IA:', e.message)
    return null
  }
}

export async function activateCycle(db, { cycleId, ai = null, now = new Date() }) {
  const cycle = db.prepare('SELECT * FROM repurchase_cycles WHERE id = ?').get(cycleId)
  if (!cycle || cycle.status !== 'aguardando' || cycle.exhausted) return { skipped: true }
  const acc = db.prepare('SELECT repurchase_max_attempts FROM accounts WHERE id = ?').get(cycle.account_id)
  const max = acc?.repurchase_max_attempts ?? 5
  if (cycle.attempt > max) {
    db.prepare("UPDATE repurchase_cycles SET exhausted = 1, updated_at = datetime('now') WHERE id = ?").run(cycle.id)
    return { exhausted: true }
  }
  const lead = db.prepare('SELECT id, account_id, name FROM leads WHERE id = ?').get(cycle.lead_id)
  const sale = (cycle.sale_id && db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(cycle.sale_id)) || {}

  const suggestion = cycle.ai_suggestion ? JSON.parse(cycle.ai_suggestion)
    : (!cycle.offer_text || cycle.kind === 'recompra')
      ? await suggestOffer(ai, { accountId: lead.account_id, leadId: lead.id, leadName: lead.name, product: sale.product, value: sale.value, saleDate: sale.sale_date, notes: sale.notes, offerText: cycle.offer_text, kind: cycle.kind })
      : null

  const offer = cycle.offer_text || (cycle.kind === 'cruzada' && suggestion ? suggestion.products.join(', ') : null)
  const description = [
    `Tentativa ${cycle.attempt} de ${max}`,
    `Última compra: ${sale.product || '—'} · ${brl(sale.value)} em ${brDate(sale.sale_date)}`,
    offer ? `O que oferecer: ${offer}` : null,
    suggestion?.message ? `Mensagem pronta:\n${suggestion.message}` : null,
  ].filter(Boolean).join('\n')

  let taskId = null
  const done = db.transaction(() => {
    const fresh = db.prepare('SELECT status FROM repurchase_cycles WHERE id = ?').get(cycle.id)
    if (fresh.status !== 'aguardando') return false
    taskId = Number(db.prepare(`
      INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, repurchase_cycle_id)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(cycle.account_id, cycle.lead_id, taskAssignee(db, cycle), reminderTitle({ kind: cycle.kind, leadName: lead.name, product: sale.product, remindDays: cycle.remind_days }), description, dueIso(cycle.remind_at, now), cycle.id).lastInsertRowid)
    db.prepare('INSERT OR IGNORE INTO repurchase_attempts (account_id, cycle_id, lead_id, attempt, kind, task_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(cycle.account_id, cycle.id, cycle.lead_id, cycle.attempt, cycle.kind, taskId)
    db.prepare(`UPDATE repurchase_cycles SET status = 'a_contatar', task_id = ?, ai_suggestion = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(taskId, suggestion ? JSON.stringify(suggestion) : null, cycle.id)
    const cur = db.prepare('SELECT funnel_id FROM leads WHERE id = ?').get(cycle.lead_id)
    if (cur.funnel_id === ensureRepurchaseFunnel(db, cycle.account_id)) {
      moveLeadToStage(db, { lead: { id: cycle.lead_id }, toStageId: stageIdByKey(db, cycle.account_id, 'a_contatar'), trigger: 'recompra', gate: false })
    }
    return true
  })()
  return done ? { taskId } : { skipped: true }
}

export { completeTask }
```

- [ ] **Step 4: Orçamento e IA de produção**

Em `server/services/aiBudget.js`:

```js
export const ROTEIRO_SOURCES = ['roteiro_extraction', 'roteiro_draft', 'roteiro_learning', 'repurchase_offer']
```

```js
// server/services/ltv/aiRuntime.js
// IA de producao da recompra: mesmo adaptador e orcamento do roteiro. Importa db.js indiretamente (so producao).
import { canRoteiroAi } from '../aiBudget.js'
import { createRoteiroAi } from '../roteiro/aiAdapter.js'

export function repurchaseAiFor(db, accountId) {
  try { return canRoteiroAi(db, accountId).ok ? createRoteiroAi(db) : null } catch { return null }
}
```

- [ ] **Step 5: Rodar** — `node --test test/ltvReminder.test.js` → PASS; `npm test` → verde (confira que testes de `aiBudget` que listam as fontes continuam passando; se um teste compara a lista exata, atualize-o incluindo `'repurchase_offer'`).

- [ ] **Step 6: Commit**

```bash
git add server/services/ltv/reminder.js server/services/ltv/aiRuntime.js server/services/aiBudget.js test/ltvReminder.test.js
git commit -m "feat(ltv): tarefa do lembrete de recompra com sugestao da IA"
```

---

### Task 7: Registrar/editar/apagar venda + desfechos pela rota + conversa

**Files:**
- Create: `server/services/ltv/sales.js`
- Modify: `server/routes/leads.js:665-717` (vendas), `server/routes/leads.js:629` (PUT stage: 409 em desfecho)
- Modify: `server/services/roteiro/runtime.js` (`onInboundSaved` / `onOutboundSaved` chamam `onMessageExchanged`)
- Test: `test/ltvSales.test.js`

**Interfaces:**
- Consumes: T5 (`onSaleCreated`, `onSaleDeleted`), T6 (`activateCycle`), T3 (`recalcCustomer`), T4 (`stageKey`).
- Produces:
  - `validateSaleInput(body, { requireKind = true }) → { ok: true, fields: { value, saleDate, notes, product, saleKind, remindDays, crossSell, offer } } | { ok: false, error }`
  - `registerSale(db, { lead, body, userId, ai = null, now }) → Promise<{ ok: true, sale, total, cycleId, optOut } | { ok: false, status, error }>`
  - `patchSale(db, { lead, saleId, body, userId, ai = null, now }) → Promise<{ ok, sale? , error?, status? }>` (marcar tipo de venda antiga / produto)
  - `deleteSale(db, { lead, saleId, now }) → { ok: true, total }`
  - `outcomeStageBlocked(db, toStageId) → boolean` (true para `nao_agora`/`nao_quer`)

- [ ] **Step 1: Teste que falha**

```js
// test/ltvSales.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { openCycleForLead } from '../server/services/ltv/cycles.js'
import { validateSaleInput, registerSale, patchSale, deleteSale, outcomeStageBlocked } from '../server/services/ltv/sales.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function base() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.proposta, name: 'Ana' })
  return { db, s, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) }
}

test('validateSaleInput', () => {
  assert.equal(validateSaleInput({ value: 0, sale_kind: 'unica' }).ok, false)
  assert.equal(validateSaleInput({ value: 10 }).ok, false) // tipo obrigatório
  assert.equal(validateSaleInput({ value: 10 }, { requireKind: false }).ok, true)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'recompra' }).ok, false) // sem prazo
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'recompra', remind_days: 20 }).ok, false)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'unica', cross_sell: true }).ok, false) // sem prazo
  const ok = validateSaleInput({ value: '99.9', sale_kind: 'unica', cross_sell: true, remind_days: 15, cross_sell_offer: 'espetos', product: 'x'.repeat(300) })
  assert.equal(ok.ok, true); assert.equal(ok.fields.product.length, 200); assert.equal(ok.fields.value, 99.9); assert.equal(ok.fields.crossSell, 1)
  assert.equal(validateSaleInput({ value: 10, sale_kind: 'unica', remind_days: 30 }).fields.remindDays, null) // única sem oferta ignora prazo
})

test('registerSale grava, recalcula e leva para Aguardando', async () => {
  const { db, s, lead } = base()
  const r = await registerSale(db, { lead, body: { value: 450, sale_kind: 'recompra', remind_days: 30, product: 'Pilates' }, userId: s.atendenteId, now: NOW })
  assert.equal(r.ok, true); assert.equal(r.total, 450); assert.ok(r.cycleId)
  const l = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(l.value_estimated, 450); assert.equal(l.ltv, 450); assert.equal(l.stage_id, stageIdByKey(db, s.accountId, 'aguardando'))
  assert.equal(r.sale.product, 'Pilates'); assert.equal(r.sale.sale_kind, 'recompra')
})

test('venda retroativa já vencida cria a tarefa na hora', async () => {
  const { db, s, lead } = base()
  await registerSale(db, { lead, body: { value: 100, sale_kind: 'recompra', remind_days: 30, sale_date: '2026-08-01' }, userId: s.atendenteId, now: NOW })
  assert.equal(openCycleForLead(db, lead.id).status, 'a_contatar')
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks WHERE lead_id = ?').get(lead.id).n, 1)
})

test('patchSale marca tipo em venda antiga e abre ciclo', async () => {
  const { db, s, lead } = base()
  const saleId = addSale(db, { accountId: s.accountId, leadId: lead.id, saleDate: '2026-09-20 10:00:00' })
  const r = await patchSale(db, { lead, saleId, body: { sale_kind: 'recompra', remind_days: 30 }, userId: s.gerenteId, now: NOW })
  assert.equal(r.ok, true)
  assert.equal(openCycleForLead(db, lead.id).remind_at, '2026-10-20')
  const again = await patchSale(db, { lead, saleId, body: { sale_kind: 'unica' }, userId: s.gerenteId, now: NOW })
  assert.equal(again.ok, false); assert.equal(again.status, 409) // tipo já marcado
})

test('deleteSale recalcula e encerra ciclo', async () => {
  const { db, s, lead } = base()
  const r = await registerSale(db, { lead, body: { value: 100, sale_kind: 'recompra', remind_days: 30 }, userId: s.atendenteId, now: NOW })
  const d = deleteSale(db, { lead, saleId: r.sale.id, now: NOW })
  assert.equal(d.total, 0)
  assert.equal(openCycleForLead(db, lead.id), null)
  assert.equal(db.prepare('SELECT ltv FROM leads WHERE id = ?').get(lead.id).ltv, 0)
})

test('outcomeStageBlocked', () => {
  const { db, s } = base()
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'nao_agora')), true)
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'nao_quer')), true)
  assert.equal(outcomeStageBlocked(db, stageIdByKey(db, s.accountId, 'comprou')), false)
  assert.equal(outcomeStageBlocked(db, s.stages.novo), false)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvSales.test.js` → FAIL.

- [ ] **Step 3: Implementar `sales.js`**

```js
// server/services/ltv/sales.js
// Registrar / editar / apagar venda (spec §5). Usado pelas rotas de leads.js.
import { REMIND_DAYS } from './schema.js'
import { onSaleCreated, onSaleDeleted } from './cycles.js'
import { activateCycle } from './reminder.js'
import { recalcCustomer } from './customer.js'
import { stageKey } from './funnel.js'

const clip = (v, n) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n))

export function validateSaleInput(body = {}, { requireKind = true } = {}) {
  const value = parseFloat(body.value)
  if (!Number.isFinite(value) || value <= 0) return { ok: false, error: 'Informe um valor maior que zero.' }
  const saleKind = body.sale_kind ?? null
  if (saleKind == null && requireKind) return { ok: false, error: 'Marque se é compra única ou se pode recomprar.' }
  if (saleKind != null && !['recompra', 'unica'].includes(saleKind)) return { ok: false, error: 'Tipo de venda inválido.' }
  const crossSell = saleKind === 'unica' && (body.cross_sell === true || body.cross_sell === 1 || body.cross_sell === '1') ? 1 : 0
  const needsDays = saleKind === 'recompra' || crossSell === 1
  const remindDays = needsDays ? Number(body.remind_days) : null
  if (needsDays && !REMIND_DAYS.includes(remindDays)) return { ok: false, error: 'Escolha em quantos dias lembrar: 7, 15, 30, 45 ou 60.' }
  return {
    ok: true,
    fields: {
      value,
      saleDate: body.sale_date ? String(body.sale_date).slice(0, 19).replace('T', ' ') : null,
      notes: clip(body.notes, 500),
      product: clip(body.product, 200),
      saleKind, remindDays, crossSell,
      offer: crossSell ? clip(body.cross_sell_offer, 500) : null,
    },
  }
}

function totalOf(db, leadId) {
  const total = db.prepare('SELECT COALESCE(SUM(value), 0) AS t FROM lead_sales WHERE lead_id = ?').get(leadId).t
  db.prepare("UPDATE leads SET value_estimated = ?, updated_at = datetime('now') WHERE id = ?").run(total, leadId)
  return total
}

async function activateIfDue(db, { cycleId, dueNow, ai, now }) {
  if (cycleId && dueNow) await activateCycle(db, { cycleId, ai, now })
}

export async function registerSale(db, { lead, body, userId = null, ai = null, now = new Date() }) {
  const v = validateSaleInput(body)
  if (!v.ok) return { ok: false, status: 400, error: v.error }
  const f = v.fields
  const saleId = Number(db.prepare(`
    INSERT INTO lead_sales (account_id, lead_id, value, sale_date, notes, created_by, product, sale_kind, remind_days, cross_sell, cross_sell_offer)
    VALUES (?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?, ?)
  `).run(lead.account_id, lead.id, f.value, f.saleDate, f.notes, userId, f.product, f.saleKind, f.remindDays, f.crossSell, f.offer).lastInsertRowid)
  const total = totalOf(db, lead.id)
  const r = onSaleCreated(db, { saleId, userId, now })
  await activateIfDue(db, { ...r, ai, now })
  const sale = db.prepare('SELECT s.*, u.name AS created_by_name FROM lead_sales s LEFT JOIN users u ON u.id = s.created_by WHERE s.id = ?').get(saleId)
  return { ok: true, sale, total, cycleId: r.cycleId, optOut: r.optOut }
}

export async function patchSale(db, { lead, saleId, body = {}, userId = null, ai = null, now = new Date() }) {
  const sale = db.prepare('SELECT * FROM lead_sales WHERE id = ? AND lead_id = ?').get(saleId, lead.id)
  if (!sale) return { ok: false, status: 404, error: 'Venda não encontrada.' }
  const product = body.product !== undefined ? clip(body.product, 200) : sale.product
  if (body.sale_kind === undefined) {
    db.prepare('UPDATE lead_sales SET product = ? WHERE id = ?').run(product, saleId)
    return { ok: true, sale: db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId) }
  }
  if (sale.sale_kind) return { ok: false, status: 409, error: 'O tipo desta venda já foi marcado.' }
  const v = validateSaleInput({ ...body, value: sale.value })
  if (!v.ok) return { ok: false, status: 400, error: v.error }
  db.prepare('UPDATE lead_sales SET product = ?, sale_kind = ?, remind_days = ?, cross_sell = ?, cross_sell_offer = ? WHERE id = ?')
    .run(product, v.fields.saleKind, v.fields.remindDays, v.fields.crossSell, v.fields.offer, saleId)
  const latest = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC, id DESC LIMIT 1').get(lead.id)
  // So a venda mais recente abre ciclo (uma antiga nao pode "fechar" a recompra de uma mais nova).
  if (latest.id === saleId) {
    const r = onSaleCreated(db, { saleId, userId, now })
    await activateIfDue(db, { ...r, ai, now })
  }
  return { ok: true, sale: db.prepare('SELECT * FROM lead_sales WHERE id = ?').get(saleId) }
}

export function deleteSale(db, { lead, saleId, now = new Date() }) {
  onSaleDeleted(db, { leadId: lead.id, saleId: Number(saleId), now })
  db.prepare('DELETE FROM lead_sales WHERE id = ? AND lead_id = ?').run(saleId, lead.id)
  const total = totalOf(db, lead.id)
  recalcCustomer(db, lead.id, { now })
  return { ok: true, total }
}

export function outcomeStageBlocked(db, toStageId) {
  return ['nao_agora', 'nao_quer'].includes(stageKey(db, toStageId))
}
```

- [ ] **Step 4: Rotas em `server/routes/leads.js`**

Imports no topo:

```js
import { registerSale, patchSale, deleteSale, outcomeStageBlocked } from '../services/ltv/sales.js'
import { repurchaseAiFor } from '../services/ltv/aiRuntime.js'
```

Substituir o corpo do `POST /:id/sales` (linhas 682–705), mantendo a busca do lead e a checagem de conta que já existem no começo do handler:

```js
router.post('/:id/sales', async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })
  if (req.user.role !== 'super_admin' && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem acesso' })
  try {
    const r = await registerSale(db, { lead, body: req.body || {}, userId: req.user.id, ai: repurchaseAiFor(db, lead.account_id) })
    if (!r.ok) return res.status(r.status).json({ error: r.error })
    try { markBought(db, { leadId: lead.id }); scheduleScore(lead.id) } catch (e) { console.error('[Vendas] roteiro/nota:', e.message) }
    try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id, value_estimated: r.total }) } catch {}
    try { broadcastSSE(lead.account_id, 'customers:updated', { lead_id: lead.id }) } catch {}
    res.json({ sale: r.sale, total: r.total, cycle_id: r.cycleId, opt_out: r.optOut })
  } catch (e) {
    console.error('[Vendas] registrar:', e.message)
    res.status(500).json({ error: 'Erro ao registrar a venda' })
  }
})

// PATCH /:id/sales/:saleId — produto e/ou tipo (venda antiga sem tipo)
router.patch('/:id/sales/:saleId', async (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id)
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado' })
  if (req.user.role !== 'super_admin' && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem acesso' })
  const r = await patchSale(db, { lead, saleId: Number(req.params.saleId), body: req.body || {}, userId: req.user.id, ai: repurchaseAiFor(db, lead.account_id) })
  if (!r.ok) return res.status(r.status).json({ error: r.error })
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  res.json({ sale: r.sale })
})
```

No `DELETE /:id/sales/:saleId` (linhas 708–717), troque o `DELETE` + recálculo por `const r = deleteSale(db, { lead, saleId: req.params.saleId })` e responda `{ ok: true, total: r.total }` (mantendo `requireRole`, checagem de conta e o SSE `lead:updated`).

No `PUT /:id/stage` (linha ~629), antes de mover:

```js
  if (outcomeStageBlocked(db, Number(req.body?.stage_id))) {
    return res.status(409).json({ error: 'Use a janela de desfecho para informar o motivo.', code: 'use_outcome' })
  }
```

- [ ] **Step 5: Conversa → Em conversa** — em `server/services/roteiro/runtime.js`:

```js
import { onMessageExchanged } from '../ltv/cycles.js'   // topo
```

No fim de `onInboundSaved` e de `onOutboundSaved`:

```js
  try { onMessageExchanged(db, { leadId: lead.id }) } catch (e) { console.error('[Recompra] conversa:', e.message) }
```

- [ ] **Step 6: Rodar** — `node --test test/ltvSales.test.js` → PASS; `npm test` → verde (os testes de `runtime`/inbound usam bancos sem as tabelas de recompra: o `try/catch` acima evita quebra — se algum teste falhar por log de erro, é só log; se falhar de fato, adicione `applyLtvSchema(db)` no setup desse teste).

- [ ] **Step 7: Commit**

```bash
git add server/services/ltv/sales.js server/routes/leads.js server/services/roteiro/runtime.js test/ltvSales.test.js
git commit -m "feat(ltv): venda com tipo, produto e lembrete; desfecho protegido; conversa move recompra"
```

---

### Task 8: Rotina diária/horária + envio automático + agendador

**Files:**
- Create: `server/services/ltv/daily.js`
- Create: `server/services/ltv/autoSend.js`
- Create: `server/services/ltv/autoSendRuntime.js`
- Modify: `server/scheduler.js` (tick)
- Test: `test/ltvDaily.test.js`

**Interfaces:**
- Consumes: T2 (`localDate`, `addDays`), T3 (`recalcAccountCustomers`), T5 (`completeTask`), T6 (`activateCycle`), T4 (`stageIdByKey`), `isOptedOut`, `appendOptOutFooter` (`antiban.js`), `broadcastFooter` (`broadcastRouting.js`), `resolveSendInstance` (`whatsapp/resolveSendInstance.js`).
- Produces:
  - `shouldRunDaily(account, now) → boolean` (hora de Brasília ≥ 9 e `ltv_daily_on` ≠ hoje)
  - `runLtvForAccount(db, { accountId, ai, now }) → Promise<{ activated, exhausted }>`
  - `runLtvTick(db, { now, aiForAccount, sendFor, broadcast }) → Promise<void>`
  - `autoSendAvailability(db, accountId, { ai }) → { ok: true, instance } | { ok: false, reason }`
  - `processAutoSends(db, { accountId, ai, send, now }) → Promise<{ sent, failed, waiting }>`
  - `send({ instance, lead, text }) → Promise<{ ok: true } | { ok: false, reason }>` (contrato; produção em `autoSendRuntime.js` como `productionSend`)

- [ ] **Step 1: Teste que falha**

```js
// test/ltvDaily.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { onSaleCreated, openCycleForLead } from '../server/services/ltv/cycles.js'
import { stageIdByKey } from '../server/services/ltv/funnel.js'
import { shouldRunDaily, runLtvForAccount, runLtvTick } from '../server/services/ltv/daily.js'
import { processAutoSends } from '../server/services/ltv/autoSend.js'

const DUE = new Date('2026-10-29T13:00:00Z') // 10h BRT
function setup() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Maria', attendant_id: s.atendenteId })
  const saleId = addSale(db, { accountId: s.accountId, leadId, kind: 'recompra', remindDays: 30, product: 'Pilates', saleDate: '2026-09-29 10:00:00' })
  onSaleCreated(db, { saleId, now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, leadId }
}
const aiOk = { isAvailable: () => true, call: async () => ({ toolUses: [{ name: 'suggest_offer', input: { products: ['Pilates'], message: 'Oi Maria, bora renovar?' } }] }) }

test('shouldRunDaily: a partir das 9h de Brasília, uma vez por dia', () => {
  assert.equal(shouldRunDaily({ ltv_daily_on: null }, new Date('2026-10-29T11:59:00Z')), false) // 8h59
  assert.equal(shouldRunDaily({ ltv_daily_on: null }, new Date('2026-10-29T12:00:00Z')), true)
  assert.equal(shouldRunDaily({ ltv_daily_on: '2026-10-29' }, new Date('2026-10-29T15:00:00Z')), false)
})

test('rotina ativa o ciclo vencido e não duplica ao rodar de novo', async () => {
  const { db, s, leadId } = setup()
  const r1 = await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: DUE })
  assert.equal(r1.activated, 1)
  db.prepare('UPDATE accounts SET ltv_daily_on = NULL').run()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: DUE })
  assert.equal(db.prepare('SELECT COUNT(*) n FROM standalone_tasks WHERE lead_id = ?').get(leadId).n, 1)
  assert.equal(db.prepare('SELECT ltv_daily_on FROM accounts WHERE id = ?').get(s.accountId).ltv_daily_on, '2026-10-29')
})

test('ciclo ainda não vencido fica aguardando', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: new Date('2026-10-20T13:00:00Z') })
  assert.equal(openCycleForLead(db, leadId).status, 'aguardando')
})

test('servidor desligado vários dias: recupera o atrasado', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: null, now: new Date('2026-11-15T13:00:00Z') })
  assert.equal(openCycleForLead(db, leadId).status, 'a_contatar')
})

test('runLtvTick respeita horário, dispara SSE e envio automático só com a chave ligada', async () => {
  const { db, s } = setup()
  const events = []; const sends = []
  const sendFor = () => async ({ text }) => { sends.push(text); return { ok: true } }
  await runLtvTick(db, { now: DUE, aiForAccount: () => aiOk, sendFor, broadcast: (acc, ev) => events.push([acc, ev]) })
  assert.ok(events.some(([acc, ev]) => acc === s.accountId && ev === 'customers:updated'))
  assert.equal(sends.length, 0) // chave desligada
})

test('envio automático: envia, move para Em conversa e troca a tarefa', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(s.instanceId)
  const sent = []
  const r = await processAutoSends(db, {
    accountId: s.accountId, ai: aiOk, now: DUE,
    availability: () => ({ ok: true, instance: { id: s.instanceId } }),
    send: async ({ text }) => { sent.push(text); return { ok: true } },
  })
  assert.equal(r.sent, 1)
  assert.match(sent[0], /bora renovar/)
  const c = openCycleForLead(db, leadId)
  assert.equal(c.status, 'em_conversa'); assert.ok(c.auto_sent_at)
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId).stage_id, stageIdByKey(db, s.accountId, 'em_conversa'))
  const tasks = db.prepare('SELECT title, status FROM standalone_tasks WHERE lead_id = ? ORDER BY id').all(leadId)
  assert.equal(tasks[0].status, 'completed'); assert.match(tasks[1].title, /Acompanhar resposta de Maria/)
  assert.equal(db.prepare('SELECT auto FROM repurchase_attempts WHERE cycle_id = ?').get(c.id).auto, 1)
  const again = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: () => ({ ok: true, instance: { id: 1 } }), send: async () => { throw new Error('não devia') } })
  assert.equal(again.sent, 0)
})

test('envio automático nunca vai para quem mandou SAIR; fora do horário espera', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  const avail = () => ({ ok: true, instance: { id: s.instanceId } })
  const off = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: avail, send: async () => ({ ok: false, reason: 'outside_business_hours' }) })
  assert.equal(off.waiting, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, null)
  db.prepare("UPDATE leads SET opted_out_at = datetime('now') WHERE id = ?").run(leadId)
  const r = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: avail, send: async () => { throw new Error('não devia') } })
  assert.equal(r.failed, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, 'opted_out')
  assert.equal(openCycleForLead(db, leadId).status, 'a_contatar') // tarefa manual continua
})

test('sem número de disparo não envia e registra o motivo', async () => {
  const { db, s, leadId } = setup()
  await runLtvForAccount(db, { accountId: s.accountId, ai: aiOk, now: DUE })
  const r = await processAutoSends(db, { accountId: s.accountId, ai: aiOk, now: DUE, availability: () => ({ ok: false, reason: 'no_send_number' }), send: async () => { throw new Error('não devia') } })
  assert.equal(r.failed, 1)
  assert.equal(openCycleForLead(db, leadId).auto_failed_reason, 'no_send_number')
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvDaily.test.js` → FAIL.

- [ ] **Step 3: Implementar `autoSend.js`**

```js
// server/services/ltv/autoSend.js
// Envio automatico do lembrete (spec §8). `send` e `availability` injetados; producao em autoSendRuntime.js.
import { localDate, addDays } from './compute.js'
import { completeTask } from './cycles.js'
import { stageIdByKey, ensureRepurchaseFunnel } from './funnel.js'
import { moveLeadToStage } from '../stageMove.js'
import { isOptedOut, appendOptOutFooter } from '../antiban.js'
import { broadcastFooter } from '../broadcastRouting.js'
import { resolveSendInstance } from '../whatsapp/resolveSendInstance.js'

export function autoSendAvailability(db, accountId, { ai }) {
  if (!ai || !ai.isAvailable(accountId)) return { ok: false, reason: 'no_ai' }
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  return r.ok ? { ok: true, instance: r.instance } : { ok: false, reason: r.reason }
}

const fail = (db, id, reason) => db.prepare("UPDATE repurchase_cycles SET auto_failed_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id)

export async function processAutoSends(db, { accountId, ai, send, now = new Date(), availability = (d, a, o) => autoSendAvailability(d, a, o) }) {
  const out = { sent: 0, failed: 0, waiting: 0 }
  const cycles = db.prepare(`
    SELECT * FROM repurchase_cycles
    WHERE account_id = ? AND status = 'a_contatar' AND auto_sent_at IS NULL AND auto_failed_reason IS NULL
    ORDER BY remind_at, id
  `).all(accountId)
  for (const c of cycles) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(c.lead_id)
    if (!lead || lead.is_active === 0 || lead.repurchase_opt_out || isOptedOut(lead)) { fail(db, c.id, 'opted_out'); out.failed++; continue }
    const avail = availability(db, accountId, { ai })
    if (!avail.ok) { fail(db, c.id, avail.reason); out.failed++; continue }
    const message = c.ai_suggestion ? JSON.parse(c.ai_suggestion).message : null
    if (!message) { fail(db, c.id, 'no_message'); out.failed++; continue }
    let footer = null
    try { footer = broadcastFooter(db, accountId) } catch { footer = null }
    const text = footer ? appendOptOutFooter(message, footer) : message
    let r
    try { r = await send({ instance: avail.instance, lead, text }) } catch (e) { r = { ok: false, reason: 'send_error' } }
    if (!r.ok) {
      if (r.reason === 'outside_business_hours') { out.waiting++; continue }
      fail(db, c.id, r.reason || 'send_failed'); out.failed++; continue
    }
    const ts = now.toISOString().slice(0, 19).replace('T', ' ')
    db.transaction(() => {
      db.prepare("UPDATE repurchase_cycles SET status = 'em_conversa', auto_sent_at = ?, updated_at = datetime('now') WHERE id = ?").run(ts, c.id)
      db.prepare('UPDATE repurchase_attempts SET auto = 1, contacted_at = COALESCE(contacted_at, ?) WHERE cycle_id = ? AND attempt = ?').run(ts, c.id, c.attempt)
      completeTask(db, c.task_id, 'Mensagem automática enviada.')
      const follow = Number(db.prepare(`
        INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, repurchase_cycle_id)
        SELECT account_id, lead_id, assigned_to, ?, ?, ?, 'pending', repurchase_cycle_id FROM standalone_tasks WHERE id = ?
      `).run(`Acompanhar resposta de ${lead.name || 'cliente'}`, `Mensagem automática enviada:\n${message}`, `${addDays(localDate(now), 2)}T12:00:00.000Z`, c.task_id).lastInsertRowid)
      db.prepare('UPDATE repurchase_cycles SET task_id = ? WHERE id = ?').run(follow, c.id)
      if (lead.funnel_id === ensureRepurchaseFunnel(db, accountId)) {
        moveLeadToStage(db, { lead: { id: lead.id }, toStageId: stageIdByKey(db, accountId, 'em_conversa'), trigger: 'recompra', gate: false })
      }
    })()
    out.sent++
  }
  return out
}
```

(Se `c.task_id` for nulo — não deve acontecer, porque `a_contatar` sempre nasce com tarefa —, o `INSERT ... SELECT` não cria nada; tudo bem.)

- [ ] **Step 4: Implementar `daily.js`**

```js
// server/services/ltv/daily.js
// Rotina da recompra (spec §9): 1x por dia por conta a partir das 9h de Brasilia + envio automatico a cada tick.
import { localDate } from './compute.js'
import { recalcAccountCustomers } from './customer.js'
import { activateCycle } from './reminder.js'
import { processAutoSends } from './autoSend.js'

const brtHour = now => new Date(now.getTime() - 3 * 3600000).getUTCHours()

export function shouldRunDaily(account, now = new Date()) {
  return brtHour(now) >= 9 && account.ltv_daily_on !== localDate(now)
}

export async function runLtvForAccount(db, { accountId, ai = null, now = new Date() }) {
  const today = localDate(now)
  const due = db.prepare("SELECT id FROM repurchase_cycles WHERE account_id = ? AND status = 'aguardando' AND exhausted = 0 AND remind_at <= ? ORDER BY remind_at, id").all(accountId, today)
  let activated = 0, exhausted = 0
  for (const { id } of due) {
    const r = await activateCycle(db, { cycleId: id, ai, now })
    if (r.taskId) activated++
    if (r.exhausted) exhausted++
  }
  recalcAccountCustomers(db, accountId, { now })
  db.prepare('UPDATE accounts SET ltv_daily_on = ? WHERE id = ?').run(today, accountId)
  return { activated, exhausted }
}

export async function runLtvTick(db, { now = new Date(), aiForAccount = () => null, sendFor = () => null, broadcast = () => {} }) {
  const accounts = db.prepare('SELECT * FROM accounts').all().filter(a => a.is_active !== 0)
  for (const a of accounts) {
    try {
      const ai = aiForAccount(a.id)
      if (shouldRunDaily(a, now)) {
        await runLtvForAccount(db, { accountId: a.id, ai, now })
        broadcast(a.id, 'customers:updated', {})
      }
      const send = a.repurchase_auto_send ? sendFor(a.id) : null
      if (send) await processAutoSends(db, { accountId: a.id, ai, send, now })
    } catch (e) {
      console.error(`[Recompra] conta ${a.id}:`, e.message)
    }
  }
}
```

- [ ] **Step 5: `autoSendRuntime.js` (produção)**

```js
// server/services/ltv/autoSendRuntime.js
// Envio de producao da recompra: catraca anti-ban + sendViaInstance + grava em messages + SSE (igual followUpSender).
import db from '../../db.js'
import { sendViaInstance } from '../leadHandoff.js'
import { followUpPacer } from '../whatsapp/sendPacer.js'
import { broadcastSSE } from '../../sse.js'

export function productionSendFor() {
  return async ({ instance, lead, text }) => {
    await followUpPacer.wait(instance.id)
    const r = await sendViaInstance(instance, lead.phone, text, { leadId: lead.id, origin: 'auto' })
    if (!r.ok) return { ok: false, reason: r.validationFailed ? 'number_not_on_whatsapp' : (r.reason || 'send_failed') }
    const msgId = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, delivery_status)
      VALUES (?, ?, 'outbound', ?, 'text', 'Recompra auto', ?, datetime('now'), ?, 'sent')
    `).run(lead.id, lead.account_id, text, r.wamsgId, instance.id).lastInsertRowid
    try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id, message_id: msgId }) } catch {}
    return { ok: true }
  }
}
```

(Confira em `followUpSender.js` o nome exato do export do pacer e o formato do payload do SSE `lead:message`; use o mesmo.)

- [ ] **Step 6: Agendador — `server/scheduler.js`**

```js
import { runLtvTick } from './services/ltv/daily.js'
import { repurchaseAiFor } from './services/ltv/aiRuntime.js'
import { productionSendFor } from './services/ltv/autoSendRuntime.js'
// ...
const LTV_EVERY_TICKS = 10 // a cada 10 min (a rotina diaria se protege sozinha: 1x/dia/conta)
let ltvTickCount = 0
let ltvRunning = false
// dentro de tick(), junto dos outros sub-jobs por contador:
  ltvTickCount++
  if (ltvTickCount >= LTV_EVERY_TICKS && !ltvRunning) {
    ltvTickCount = 0
    ltvRunning = true
    runLtvTick(db, { now: new Date(), aiForAccount: id => repurchaseAiFor(db, id), sendFor: () => productionSendFor(), broadcast: broadcastSSE })
      .catch(e => console.error('[Recompra] tick:', e.message))
      .finally(() => { ltvRunning = false })
  }
```

- [ ] **Step 7: Rodar** — `node --test test/ltvDaily.test.js` → PASS; `npm test` → verde.

- [ ] **Step 8: Commit**

```bash
git add server/services/ltv/daily.js server/services/ltv/autoSend.js server/services/ltv/autoSendRuntime.js server/scheduler.js test/ltvDaily.test.js
git commit -m "feat(ltv): rotina diaria da recompra e envio automatico opcional"
```

---

### Task 9: Métricas (visão geral, clientes, recompra, parados) e filtros de leads

**Files:**
- Create: `server/services/ltv/metrics.js`
- Create: `server/services/ltv/filters.js`
- Test: `test/ltvMetrics.test.js`

**Interfaces:**
- Consumes: T2 (`median`, `suggestRemindDays`, `staleBand`, `daysBetween`, `localDate`, `addDays`).
- Produces (todas recebem `scope = { accountId, attendantId = null, geoSql = '', geoParams = [] }`; `geoSql` vem de `cityWhere('l', query)` e começa com `AND ...` ou é vazio):
  - `overview(db, scope, { from, to, now }) → { clients, ltvAvg, ticketAvg, purchasesAvg, repeatPct, byCurve: {A,B,C,D,'1a'}: {count, ltv}, byTier: [{id,name,icon,color,count,ltv}], repurchase: { medianDays, markedDays, cases, suggestion } }`
  - `listCustomers(db, scope, { curve, tierId, late, optOut, order = 'ltv', limit = 50, offset = 0, now }) → { rows, total }`
  - `repurchaseStats(db, scope, { from, to }) → { contacted, conversa, comprou, naoAgora, naoQuer, reasons: { nao_agora: [{id,label,count}], nao_quer: [...] }, byAttempt: {1,2,3,'4+'}, byKind: { recompra: {total, comprou}, cruzada: {...} }, byAuto: { auto: {...}, manual: {...} } }`
  - `staleStats(db, scope, { now }) → { late: { count, value, rows }, bands: [{ band, curve, tierId, count, ltv }] }`
  - `createStaleTasks(db, { accountId, leadIds, userId, now }) → { created }` (máx. 200)
  - `LATE_SQL(today)` → `{ sql, params }` usado também pelo filtro
  - `customerWhere(alias, query, now) → { sql, params }` (em `filters.js`; `curve`, `tier_id`, `repurchase_late=1`)

Regras:
- "Período" (`from`/`to`, `YYYY-MM-DD`): overview usa vendas no período para ticket; `clients`/`ltvAvg` usam o cache do lead (LTV desde sempre) de quem comprou no período. Sem período = tudo.
- Vendedor (`attendantId`) só enxerga `l.attendant_id = attendantId`.
- Atrasado = ciclo aberto `status IN ('a_contatar','em_conversa') AND remind_at <= today − 3 dias` OU `status = 'aguardando' AND exhausted = 1`.
- Valor parado = soma de `ltv / purchases` (ticket médio) dos atrasados.
- Tempo real de recompra: para cada venda `sale_kind='recompra'` (no período, por `sale_date`), a próxima venda do mesmo lead; dias entre as duas. `markedDays` = mediana dos `remind_days` dessas vendas.

- [ ] **Step 1: Teste que falha**

```js
// test/ltvMetrics.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { recalcAccountCustomers } from '../server/services/ltv/customer.js'
import { onSaleCreated, recordOutcome, openCycleForLead } from '../server/services/ltv/cycles.js'
import { overview, listCustomers, repurchaseStats, staleStats, createStaleTasks } from '../server/services/ltv/metrics.js'
import { customerWhere } from '../server/services/ltv/filters.js'

const NOW = new Date('2026-09-29T15:00:00Z')
function world() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const lead = (name, attendant = s.atendenteId) => addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name, attendant_id: attendant })
  const ana = lead('Ana'); const bia = lead('Bia'); const caio = lead('Caio', s.gerenteId)
  addSale(db, { accountId: s.accountId, leadId: ana, value: 100, saleDate: '2026-08-01', kind: 'recompra', remindDays: 30 })
  addSale(db, { accountId: s.accountId, leadId: ana, value: 300, saleDate: '2026-09-15', kind: 'recompra', remindDays: 30 }) // voltou em 45 dias
  addSale(db, { accountId: s.accountId, leadId: bia, value: 1000, saleDate: '2026-05-01' }) // 1 compra, 151 dias parada
  addSale(db, { accountId: s.accountId, leadId: caio, value: 50, saleDate: '2026-09-20' })
  db.prepare("INSERT INTO customer_tiers (account_id, name, min_ltv) VALUES (?, 'Diamante', 900)").run(s.accountId)
  recalcAccountCustomers(db, s.accountId, { now: NOW })
  return { db, s, ana, bia, caio, scope: { accountId: s.accountId } }
}

test('overview', () => {
  const { db, scope } = world()
  const o = overview(db, scope, { now: NOW })
  assert.equal(o.clients, 3)
  assert.equal(o.ltvAvg, 483.33)
  assert.equal(o.ticketAvg, 362.5)
  assert.equal(o.repeatPct, 33.3)
  assert.equal(o.byCurve['1a'].count, 2)
  assert.equal(o.byTier[0].count, 1)
  assert.equal(o.repurchase.cases, 1); assert.equal(o.repurchase.medianDays, 45); assert.equal(o.repurchase.markedDays, 30)
})

test('vendedor só vê os seus', () => {
  const { db, s } = world()
  assert.equal(overview(db, { accountId: s.accountId, attendantId: s.atendenteId }, { now: NOW }).clients, 2)
  assert.equal(listCustomers(db, { accountId: s.accountId, attendantId: s.atendenteId }, { now: NOW }).total, 2)
})

test('listCustomers filtra por curva e selo e ordena por LTV', () => {
  const { db, scope, bia } = world()
  const all = listCustomers(db, scope, { now: NOW })
  assert.equal(all.rows[0].id, bia)
  assert.equal(listCustomers(db, scope, { curve: '1a', now: NOW }).total, 2)
  const diamante = db.prepare("SELECT id FROM customer_tiers WHERE name = 'Diamante'").get().id
  assert.equal(listCustomers(db, scope, { tierId: diamante, now: NOW }).total, 1)
})

test('repurchaseStats conta desfechos, motivos e tentativa', () => {
  const { db, s, ana, scope } = world()
  const saleId = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC').get(ana).id
  onSaleCreated(db, { saleId, now: NOW })
  const reasonId = db.prepare("SELECT id FROM repurchase_reasons WHERE grp = 'nao_agora' AND account_id = ? ORDER BY position").get(s.accountId).id
  recordOutcome(db, { leadId: ana, outcome: 'nao_agora', reasonId, now: NOW })
  const r = repurchaseStats(db, scope, {})
  assert.equal(r.naoAgora, 1)
  assert.equal(r.reasons.nao_agora.find(x => x.id === reasonId).count, 1)
  assert.equal(r.byKind.recompra.total, 1)
})

test('staleStats: faixas e atrasados', () => {
  const { db, s, ana, scope } = world()
  const st = staleStats(db, scope, { now: NOW })
  const biaBand = st.bands.find(b => b.band === '91-180')
  assert.equal(biaBand.count, 1)
  const saleId = db.prepare('SELECT id FROM lead_sales WHERE lead_id = ? ORDER BY sale_date DESC').get(ana).id
  onSaleCreated(db, { saleId, now: NOW })
  db.prepare("UPDATE repurchase_cycles SET status = 'a_contatar', remind_at = '2026-09-20' WHERE lead_id = ?").run(ana)
  const st2 = staleStats(db, scope, { now: NOW })
  assert.equal(st2.late.count, 1); assert.equal(st2.late.value, 200)
  const w = customerWhere('l', { repurchase_late: '1' }, NOW)
  const n = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE l.account_id = ? ${w.sql}`).get(s.accountId, ...w.params).n
  assert.equal(n, 1)
})

test('createStaleTasks cria no máximo 200 e ignora lead de outra conta', () => {
  const { db, s, bia } = world()
  const other = addLead(db, { account_id: s.otherAccountId, name: 'X' })
  const r = createStaleTasks(db, { accountId: s.accountId, leadIds: [bia, other], userId: s.gerenteId, now: NOW })
  assert.equal(r.created, 1)
  assert.match(db.prepare('SELECT title FROM standalone_tasks WHERE lead_id = ?').get(bia).title, /Reativar Bia/)
  const many = Array.from({ length: 250 }, () => bia)
  assert.equal(createStaleTasks(db, { accountId: s.accountId, leadIds: many, userId: s.gerenteId, now: NOW }).created, 1) // dedup por lead
})
```

(Se `addLead` exigir `funnel_id`/`stage_id` para a conta `otherAccountId`, crie o lead da outra conta com o funil dela conforme o `seedRoteiroBase` — ajuste só o teste.)

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/ltvMetrics.test.js` → FAIL.

- [ ] **Step 3: Implementar `filters.js` e `metrics.js`**

```js
// server/services/ltv/filters.js
// Filtros de cliente em GET /api/leads (spec §10.5): curva, selo e atrasado na recompra.
import { localDate, addDays } from './compute.js'

export function lateSql(alias, today) {
  return {
    sql: `EXISTS (SELECT 1 FROM repurchase_cycles rc WHERE rc.lead_id = ${alias}.id AND (
      (rc.status IN ('a_contatar','em_conversa') AND rc.remind_at <= ?) OR (rc.status = 'aguardando' AND rc.exhausted = 1)))`,
    params: [addDays(today, -3)],
  }
}

export function customerWhere(alias, query = {}, now = new Date()) {
  const parts = []; const params = []
  if (['A', 'B', 'C', 'D', '1a'].includes(query.curve)) { parts.push(`${alias}.curve = ?`); params.push(query.curve) }
  if (query.tier_id && Number(query.tier_id)) { parts.push(`${alias}.tier_id = ?`); params.push(Number(query.tier_id)) }
  if (query.repurchase_late === '1' || query.repurchase_late === 1 || query.repurchase_late === true) {
    const l = lateSql(alias, localDate(now)); parts.push(l.sql); params.push(...l.params)
  }
  return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params }
}
```

```js
// server/services/ltv/metrics.js
// Numeros da tela Clientes (spec §10.2). scope = { accountId, attendantId?, geoSql?, geoParams? }.
import { localDate, daysBetween, median, suggestRemindDays, staleBand, dueIso } from './compute.js'
import { lateSql } from './filters.js'

const r2 = n => Math.round(n * 100) / 100
const r1 = n => Math.round(n * 10) / 10

function base(scope) {
  const where = ['l.account_id = ?', 'l.purchases > 0']
  const params = [scope.accountId]
  if (scope.attendantId) { where.push('l.attendant_id = ?'); params.push(scope.attendantId) }
  return { sql: where.join(' AND ') + (scope.geoSql || ''), params: [...params, ...(scope.geoParams || [])] }
}

function periodSales(from, to) {
  const w = []; const p = []
  if (from) { w.push('date(s.sale_date) >= ?'); p.push(from) }
  if (to) { w.push('date(s.sale_date) <= ?'); p.push(to) }
  return { sql: w.length ? ' AND ' + w.join(' AND ') : '', params: p }
}

export function overview(db, scope, { from = null, to = null, now = new Date() } = {}) {
  const b = base(scope); const per = periodSales(from, to)
  const inPeriod = from || to ? ` AND EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = l.id${per.sql})` : ''
  const leads = db.prepare(`SELECT l.id, l.ltv, l.purchases, l.curve, l.tier_id FROM leads l WHERE ${b.sql}${inPeriod}`).all(...b.params, ...per.params)
  const clients = leads.length
  const sales = db.prepare(`SELECT s.value FROM lead_sales s JOIN leads l ON l.id = s.lead_id WHERE ${b.sql}${per.sql}`).all(...b.params, ...per.params)
  const byCurve = Object.fromEntries(['A', 'B', 'C', 'D', '1a'].map(k => [k, { count: 0, ltv: 0 }]))
  for (const l of leads) if (byCurve[l.curve]) { byCurve[l.curve].count++; byCurve[l.curve].ltv = r2(byCurve[l.curve].ltv + l.ltv) }
  const tiers = db.prepare('SELECT id, name, icon, color, min_ltv FROM customer_tiers WHERE account_id = ? ORDER BY min_ltv DESC').all(scope.accountId)
  const byTier = tiers.map(t => {
    const mine = leads.filter(l => l.tier_id === t.id)
    return { id: t.id, name: t.name, icon: t.icon, color: t.color, count: mine.length, ltv: r2(mine.reduce((s, l) => s + l.ltv, 0)) }
  })
  return {
    clients,
    ltvAvg: clients ? r2(leads.reduce((s, l) => s + l.ltv, 0) / clients) : 0,
    ticketAvg: sales.length ? r2(sales.reduce((s, x) => s + x.value, 0) / sales.length) : 0,
    purchasesAvg: clients ? r1(leads.reduce((s, l) => s + l.purchases, 0) / clients) : 0,
    repeatPct: clients ? r1((leads.filter(l => l.purchases >= 2).length / clients) * 100) : 0,
    byCurve, byTier,
    repurchase: repurchaseTiming(db, scope, { from, to }),
  }
}

function repurchaseTiming(db, scope, { from, to }) {
  const b = base(scope); const per = periodSales(from, to)
  const rows = db.prepare(`
    SELECT s.lead_id, s.sale_date, s.remind_days,
      (SELECT MIN(n.sale_date) FROM lead_sales n WHERE n.lead_id = s.lead_id AND date(n.sale_date) > date(s.sale_date)) AS next_date
    FROM lead_sales s JOIN leads l ON l.id = s.lead_id
    WHERE ${b.sql} AND s.sale_kind = 'recompra'${per.sql}
  `).all(...b.params, ...per.params)
  const done = rows.filter(r => r.next_date)
  const medianDays = median(done.map(r => daysBetween(r.sale_date, r.next_date)))
  const markedDays = median(done.map(r => r.remind_days).filter(Boolean))
  return { medianDays, markedDays, cases: done.length, suggestion: suggestRemindDays({ medianDays, markedDays, cases: done.length }) }
}

export function listCustomers(db, scope, { curve = null, tierId = null, late = false, optOut = false, order = 'ltv', limit = 50, offset = 0, now = new Date() } = {}) {
  const b = base(scope)
  const extra = []; const params = []
  if (curve) { extra.push('l.curve = ?'); params.push(curve) }
  if (tierId) { extra.push('l.tier_id = ?'); params.push(Number(tierId)) }
  if (late) { const x = lateSql('l', localDate(now)); extra.push(x.sql); params.push(...x.params) }
  extra.push(optOut ? 'l.repurchase_opt_out = 1' : 'l.repurchase_opt_out = 0')
  const where = `${b.sql} AND ${extra.join(' AND ')}`
  const orderSql = order === 'last_purchase' ? 'l.last_purchase_at DESC' : 'l.ltv DESC'
  const total = db.prepare(`SELECT COUNT(*) n FROM leads l WHERE ${where}`).get(...b.params, ...params).n
  const rows = db.prepare(`
    SELECT l.id, l.name, l.phone, l.ltv, l.purchases, l.last_purchase_at, l.curve, l.tier_id, l.attendant_id,
      u.name AS attendant_name, t.name AS tier_name, t.icon AS tier_icon, t.color AS tier_color,
      rc.status AS cycle_status, rc.remind_at, rc.attempt, rc.kind AS cycle_kind, rc.exhausted
    FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    LEFT JOIN customer_tiers t ON t.id = l.tier_id
    LEFT JOIN repurchase_cycles rc ON rc.lead_id = l.id AND rc.status IN ('aguardando','a_contatar','em_conversa')
    WHERE ${where}
    ORDER BY ${orderSql}, l.id
    LIMIT ? OFFSET ?
  `).all(...b.params, ...params, Math.min(Number(limit) || 50, 200), Number(offset) || 0)
  return { rows, total }
}

export function repurchaseStats(db, scope, { from = null, to = null } = {}) {
  const w = ['a.account_id = ?']; const p = [scope.accountId]
  if (scope.attendantId) { w.push('l.attendant_id = ?'); p.push(scope.attendantId) }
  if (from) { w.push('date(a.created_at) >= ?'); p.push(from) }
  if (to) { w.push('date(a.created_at) <= ?'); p.push(to) }
  const rows = db.prepare(`SELECT a.* FROM repurchase_attempts a JOIN leads l ON l.id = a.lead_id WHERE ${w.join(' AND ')}${scope.geoSql || ''}`).all(...p, ...(scope.geoParams || []))
  const count = f => rows.filter(f).length
  const reasons = {}
  for (const grp of ['nao_agora', 'nao_quer']) {
    reasons[grp] = db.prepare('SELECT id, label FROM repurchase_reasons WHERE account_id = ? AND grp = ? ORDER BY position').all(scope.accountId, grp)
      .map(r => ({ ...r, count: count(a => a.reason_id === r.id) }))
  }
  const byAttempt = { 1: 0, 2: 0, 3: 0, '4+': 0 }
  for (const a of rows.filter(a => a.outcome === 'comprou')) byAttempt[a.attempt >= 4 ? '4+' : a.attempt]++
  const pair = f => ({ total: count(f), comprou: count(a => f(a) && a.outcome === 'comprou') })
  return {
    contacted: rows.length,
    conversa: count(a => !!a.contacted_at),
    comprou: count(a => a.outcome === 'comprou'),
    naoAgora: count(a => a.outcome === 'nao_agora'),
    naoQuer: count(a => a.outcome === 'nao_quer'),
    reasons, byAttempt,
    byKind: { recompra: pair(a => a.kind === 'recompra'), cruzada: pair(a => a.kind === 'cruzada') },
    byAuto: { auto: pair(a => a.auto === 1), manual: pair(a => a.auto !== 1) },
  }
}

export function staleStats(db, scope, { now = new Date() } = {}) {
  const today = localDate(now)
  const b = base(scope)
  const x = lateSql('l', today)
  const lateRows = db.prepare(`SELECT l.id, l.name, l.ltv, l.purchases, l.curve, l.tier_id, l.last_purchase_at FROM leads l WHERE ${b.sql} AND ${x.sql} ORDER BY l.ltv DESC`).all(...b.params, ...x.params)
  const value = r2(lateRows.reduce((s, l) => s + (l.purchases ? l.ltv / l.purchases : 0), 0))
  const all = db.prepare(`SELECT l.id, l.ltv, l.curve, l.tier_id, l.last_purchase_at FROM leads l WHERE ${b.sql} AND l.repurchase_opt_out = 0`).all(...b.params)
  const map = new Map()
  for (const l of all) {
    const band = staleBand(daysBetween(l.last_purchase_at, today))
    if (!band) continue
    const key = `${band}|${l.curve}|${l.tier_id ?? ''}`
    const cur = map.get(key) || { band, curve: l.curve, tierId: l.tier_id ?? null, count: 0, ltv: 0, leadIds: [] }
    cur.count++; cur.ltv = r2(cur.ltv + l.ltv); cur.leadIds.push(l.id)
    map.set(key, cur)
  }
  return { late: { count: lateRows.length, value, rows: lateRows.slice(0, 200) }, bands: [...map.values()] }
}

export function createStaleTasks(db, { accountId, leadIds, userId = null, now = new Date() }) {
  const ids = [...new Set((leadIds || []).map(Number).filter(Boolean))].slice(0, 200)
  const ins = db.prepare(`
    INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `)
  let created = 0
  db.transaction(() => {
    for (const id of ids) {
      const l = db.prepare('SELECT id, name, attendant_id, last_purchase_at FROM leads WHERE id = ? AND account_id = ?').get(id, accountId)
      if (!l) continue
      ins.run(accountId, l.id, l.attendant_id || userId, `Reativar ${l.name || 'cliente'}`, `Cliente parado desde ${l.last_purchase_at || '—'}.`, dueIso(localDate(now), now), userId)
      created++
    }
  })()
  return { created }
}
```

- [ ] **Step 4: Rodar** — `node --test test/ltvMetrics.test.js` → PASS. Se algum número do teste divergir por arredondamento, recalcule à mão com os dados do `world()` e corrija o **código** se a regra do spec não for seguida; só mude o teste se o número esperado estava errado.

- [ ] **Step 5: Commit**

```bash
git add server/services/ltv/metrics.js server/services/ltv/filters.js test/ltvMetrics.test.js
git commit -m "feat(ltv): metricas de clientes, recompra, parados e filtros"
```

---

### Task 10: Router `/api/customers`, proteções de funil, filtros em Leads e métricas antigas só de vendas

**Files:**
- Create: `server/routes/customersRouter.js`
- Modify: `server/index.js` (montar), `server/routes/leads.js` (`GET /` com `customerWhere`), `server/routes/funnels.js` (proteções), `server/routes/dashboard.js` (linhas 50–55 e 106), `server/services/attendantMetrics.js:80-92`
- Test: `test/customersHttp.test.js`

**Interfaces:**
- Consumes: T3, T4, T5, T9; `validateCurve`; `cityWhere` de `server/services/city.js`; `sendNumberStatus` de `whatsapp/resolveSendInstance.js`.
- Produces: `createCustomersRouter(db, { aiFor = () => null, broadcast = () => {}, now = () => new Date() } = {}) → express.Router` com:
  - `GET /overview?from&to&attendant_id&uf&city` · `GET /list?curve&tier_id&late&opt_out&order&limit&offset` · `GET /repurchase?from&to` · `GET /stale`
  - `POST /stale/tasks { lead_ids: number[] }`
  - `GET /lead/:leadId` → `{ ltv, purchases, lastPurchaseAt, curve, tier, cycle, reasons: {nao_agora, nao_quer}, optOut, maxAttempts }`
  - `POST /lead/:leadId/outcome { outcome, reason_id, next_days? }` · `POST /lead/:leadId/undo-optout`
  - `GET /settings` → `{ curve: {a,b,c}, maxAttempts, autoSend, autoAvailable: { ok, reason } }` · `PUT /settings { curve?, maxAttempts?, autoSend? }` (gestor)
  - `GET /tiers` · `POST /tiers` · `PUT /tiers/:id` · `DELETE /tiers/:id` (gestor; recalcula clientes)
  - `GET /reasons` · `POST /reasons { grp, label }` · `PUT /reasons/:id { label?, is_active?, position? }` (gestor)
- Regras de acesso: `req.accountId` obrigatório; papel `'atendente'` (ou qualquer um fora de `gerente`/`super_admin`) → `attendantId = req.user.id` nas métricas e só pode agir em lead com `attendant_id = req.user.id` (senão 403); rotas de configuração → 403 para não-gestor.

- [ ] **Step 1: Teste que falha**

```js
// test/customersHttp.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createLtvTestDb, seedLtvBase, addLead, addSale } from './helpers/ltvDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createCustomersRouter } from '../server/routes/customersRouter.js'
import { onSaleCreated } from '../server/services/ltv/cycles.js'
import { recalcAccountCustomers } from '../server/services/ltv/customer.js'

function mount(db) {
  return app => app.use('/api/customers', authenticate, scopeToAccount, createCustomersRouter(db, { now: () => new Date('2026-09-29T15:00:00Z') }))
}
function setup() {
  const db = createLtvTestDb(); const s = seedLtvBase(db)
  const mine = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Ana', attendant_id: s.atendenteId })
  const other = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.venda, name: 'Bia', attendant_id: s.gerenteId })
  const sale = addSale(db, { accountId: s.accountId, leadId: mine, kind: 'recompra', remindDays: 30, saleDate: '2026-09-01' })
  addSale(db, { accountId: s.accountId, leadId: other, value: 900 })
  onSaleCreated(db, { saleId: sale, now: new Date('2026-09-29T15:00:00Z') })
  recalcAccountCustomers(db, s.accountId, { now: new Date('2026-09-29T15:00:00Z') })
  return { db, s, mine, other }
}

test('gestor vê todos; atendente só os seus', async () => {
  const { db, s } = setup()
  await withServer(mount(db), async base => {
    const g = await peca(base, { path: `/api/customers/overview?account_id=${s.accountId}`, jwtToken: token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId }) })
    assert.equal(g.status, 200); assert.equal(g.body.clients, 2)
    const a = await peca(base, { path: `/api/customers/overview?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }) })
    assert.equal(a.body.clients, 1)
  })
})

test('desfecho: atendente não mexe em lead de outro', async () => {
  const { db, s, other } = setup()
  await withServer(mount(db), async base => {
    const r = await peca(base, { method: 'POST', path: `/api/customers/lead/${other}/outcome?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }), body: { outcome: 'nao_agora', reason_id: 1 } })
    assert.equal(r.status, 403)
  })
})

test('desfecho pelo dono do lead funciona', async () => {
  const { db, s, mine } = setup()
  const reasonId = db.prepare("SELECT id FROM repurchase_reasons WHERE account_id = ? AND grp = 'nao_agora' ORDER BY position").get(s.accountId).id
  await withServer(mount(db), async base => {
    const r = await peca(base, { method: 'POST', path: `/api/customers/lead/${mine}/outcome?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }), body: { outcome: 'nao_agora', reason_id: reasonId, next_days: 15 } })
    assert.equal(r.status, 200); assert.equal(r.body.cycle.attempt, 2)
  })
})

test('configurações: atendente 403; gestor valida curva e recalcula', async () => {
  const { db, s } = setup()
  await withServer(mount(db), async base => {
    const atd = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const ger = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    assert.equal((await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: atd, body: { maxAttempts: 3 } })).status, 403)
    assert.equal((await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { curve: { a: 50, b: 45, c: 60 } } })).status, 400)
    const ok = await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { curve: { a: 10, b: 20, c: 30 }, maxAttempts: 3 } })
    assert.equal(ok.status, 200); assert.deepEqual(ok.body.curve, { a: 10, b: 20, c: 30 }); assert.equal(ok.body.maxAttempts, 3)
    assert.equal(ok.body.autoAvailable.ok, false) // sem IA no teste
    const on = await peca(base, { method: 'PUT', path: `/api/customers/settings?account_id=${s.accountId}`, jwtToken: ger, body: { autoSend: true } })
    assert.equal(on.status, 409) // não pode ligar sem IA + número de disparo
  })
})

test('selos: criar recalcula o selo dos clientes', async () => {
  const { db, s, other } = setup()
  await withServer(mount(db), async base => {
    const ger = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'POST', path: `/api/customers/tiers?account_id=${s.accountId}`, jwtToken: ger, body: { name: 'Diamante', icon: '💎', color: '#7E57C2', min_ltv: 500 } })
    assert.equal(r.status, 200)
    assert.equal(db.prepare('SELECT tier_id FROM leads WHERE id = ?').get(other).tier_id, r.body.tier.id)
    assert.equal((await peca(base, { method: 'POST', path: `/api/customers/tiers?account_id=${s.accountId}`, jwtToken: ger, body: { name: '', min_ltv: 1 } })).status, 400)
  })
})

test('cartão do lead', async () => {
  const { db, s, mine } = setup()
  await withServer(mount(db), async base => {
    const r = await peca(base, { path: `/api/customers/lead/${mine}?account_id=${s.accountId}`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }) })
    assert.equal(r.status, 200)
    assert.equal(r.body.cycle.status, 'aguardando'); assert.equal(r.body.purchases, 1); assert.equal(r.body.reasons.nao_agora.length, 5)
  })
})
```

(Confira em `test/panelLayoutsHttp.test.js` como o `account_id` chega ao `scopeToAccount` — query ou header — e use o mesmo formato; o de cima assume query.)

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/customersHttp.test.js` → FAIL.

- [ ] **Step 3: Implementar o router**

```js
// server/routes/customersRouter.js
// Tela Clientes, cartao do lead, desfechos e configuracoes da recompra (spec §10, §11).
import { Router } from 'express'
import { cityWhere } from '../services/city.js'
import { validateCurve } from '../services/ltv/compute.js'
import { recalcAccountCustomers } from '../services/ltv/customer.js'
import { recordOutcome, undoOptOut, openCycleForLead } from '../services/ltv/cycles.js'
import { overview, listCustomers, repurchaseStats, staleStats, createStaleTasks } from '../services/ltv/metrics.js'
import { autoSendAvailability } from '../services/ltv/autoSend.js'

const MANAGERS = ['gerente', 'super_admin']

export function createCustomersRouter(db, { aiFor = () => null, broadcast = () => {}, now = () => new Date() } = {}) {
  const router = Router()
  const isManager = req => MANAGERS.includes(req.user.role)
  const managerOnly = (req, res, next) => (isManager(req) ? next() : res.status(403).json({ error: 'Só o gestor pode mudar isso.' }))

  function scopeOf(req) {
    const geo = cityWhere('l', req.query)
    let attendantId = isManager(req) ? (Number(req.query.attendant_id) || null) : req.user.id
    return { accountId: req.accountId, attendantId, geoSql: geo.sql ? ` AND ${geo.sql.replace(/^\s*AND\s+/i, '')}` : '', geoParams: geo.params || [] }
  }
  function leadFor(req, res) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(Number(req.params.leadId), req.accountId)
    if (!lead) { res.status(404).json({ error: 'Lead não encontrado.' }); return null }
    if (!isManager(req) && lead.attendant_id !== req.user.id) { res.status(403).json({ error: 'Sem acesso a este lead.' }); return null }
    return lead
  }
  function settingsOf(accountId) {
    const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
    return {
      curve: { a: a.curve_a_days, b: a.curve_b_days, c: a.curve_c_days },
      maxAttempts: a.repurchase_max_attempts,
      autoSend: !!a.repurchase_auto_send,
      autoAvailable: autoSendAvailability(db, accountId, { ai: aiFor(accountId) }),
    }
  }
  const changed = accountId => { try { broadcast(accountId, 'customers:updated', {}) } catch {} }

  router.use((req, res, next) => (req.accountId ? next() : res.status(400).json({ error: 'account_id required' })))

  router.get('/overview', (req, res) => res.json(overview(db, scopeOf(req), { from: req.query.from || null, to: req.query.to || null, now: now() })))
  router.get('/list', (req, res) => res.json(listCustomers(db, scopeOf(req), {
    curve: req.query.curve || null, tierId: req.query.tier_id || null, late: req.query.late === '1', optOut: req.query.opt_out === '1',
    order: req.query.order, limit: req.query.limit, offset: req.query.offset, now: now(),
  })))
  router.get('/repurchase', (req, res) => res.json(repurchaseStats(db, scopeOf(req), { from: req.query.from || null, to: req.query.to || null })))
  router.get('/stale', (req, res) => res.json(staleStats(db, scopeOf(req), { now: now() })))
  router.post('/stale/tasks', (req, res) => {
    let ids = Array.isArray(req.body?.lead_ids) ? req.body.lead_ids : []
    if (!isManager(req)) {
      ids = ids.filter(id => db.prepare('SELECT 1 FROM leads WHERE id = ? AND attendant_id = ?').get(Number(id), req.user.id))
    }
    const r = createStaleTasks(db, { accountId: req.accountId, leadIds: ids, userId: req.user.id, now: now() })
    res.json(r)
  })

  router.get('/lead/:leadId', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    const tier = lead.tier_id ? db.prepare('SELECT id, name, icon, color FROM customer_tiers WHERE id = ?').get(lead.tier_id) : null
    const cycle = openCycleForLead(db, lead.id)
    const reasons = {}
    for (const grp of ['nao_agora', 'nao_quer']) reasons[grp] = db.prepare('SELECT id, label FROM repurchase_reasons WHERE account_id = ? AND grp = ? AND is_active = 1 ORDER BY position').all(req.accountId, grp)
    const acc = db.prepare('SELECT repurchase_max_attempts FROM accounts WHERE id = ?').get(req.accountId)
    res.json({
      ltv: lead.ltv, purchases: lead.purchases, lastPurchaseAt: lead.last_purchase_at, curve: lead.curve, tier,
      cycle: cycle && { ...cycle, ai_suggestion: cycle.ai_suggestion ? JSON.parse(cycle.ai_suggestion) : null },
      reasons, optOut: !!lead.repurchase_opt_out, maxAttempts: acc?.repurchase_max_attempts ?? 5,
    })
  })
  router.post('/lead/:leadId/outcome', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    const r = recordOutcome(db, { leadId: lead.id, outcome: req.body?.outcome, reasonId: Number(req.body?.reason_id) || null, nextDays: req.body?.next_days ?? null, userId: req.user.id, now: now() })
    if (!r.ok) return res.status(r.status).json({ error: r.error })
    changed(req.accountId); try { broadcast(req.accountId, 'lead:updated', { id: lead.id }) } catch {}
    res.json({ cycle: r.cycle })
  })
  router.post('/lead/:leadId/undo-optout', (req, res) => {
    const lead = leadFor(req, res); if (!lead) return
    undoOptOut(db, { leadId: lead.id, userId: req.user.id, now: now() })
    changed(req.accountId); try { broadcast(req.accountId, 'lead:updated', { id: lead.id }) } catch {}
    res.json({ ok: true })
  })

  router.get('/settings', (req, res) => res.json(settingsOf(req.accountId)))
  router.put('/settings', managerOnly, (req, res) => {
    const b = req.body || {}
    if (b.curve) {
      const c = { a: Number(b.curve.a), b: Number(b.curve.b), c: Number(b.curve.c) }
      const v = validateCurve(c); if (!v.ok) return res.status(400).json({ error: v.error })
      db.prepare('UPDATE accounts SET curve_a_days = ?, curve_b_days = ?, curve_c_days = ? WHERE id = ?').run(c.a, c.b, c.c, req.accountId)
      recalcAccountCustomers(db, req.accountId, { now: now() })
    }
    if (b.maxAttempts !== undefined) {
      const n = Number(b.maxAttempts)
      if (!Number.isInteger(n) || n < 1 || n > 20) return res.status(400).json({ error: 'Tentativas: de 1 a 20.' })
      db.prepare('UPDATE accounts SET repurchase_max_attempts = ? WHERE id = ?').run(n, req.accountId)
    }
    if (b.autoSend !== undefined) {
      if (b.autoSend) {
        const av = autoSendAvailability(db, req.accountId, { ai: aiFor(req.accountId) })
        if (!av.ok) return res.status(409).json({ error: av.reason === 'no_ai' ? 'Ligue a IA da conta para usar lembretes automáticos.' : 'Conecte um número de disparo (UzAPI ou Oficial) para usar lembretes automáticos.', reason: av.reason })
      }
      db.prepare('UPDATE accounts SET repurchase_auto_send = ? WHERE id = ?').run(b.autoSend ? 1 : 0, req.accountId)
    }
    changed(req.accountId)
    res.json(settingsOf(req.accountId))
  })

  function tierBody(b) {
    const name = String(b?.name || '').trim().slice(0, 40)
    const min = Number(b?.min_ltv)
    if (!name) return { error: 'Dê um nome ao selo.' }
    if (!Number.isFinite(min) || min <= 0) return { error: 'Informe o valor mínimo gasto.' }
    return { name, min, icon: b.icon ? String(b.icon).slice(0, 8) : null, color: /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#7E57C2' }
  }
  router.get('/tiers', (req, res) => res.json({ tiers: db.prepare('SELECT * FROM customer_tiers WHERE account_id = ? ORDER BY min_ltv DESC').all(req.accountId) }))
  router.post('/tiers', managerOnly, (req, res) => {
    const t = tierBody(req.body); if (t.error) return res.status(400).json({ error: t.error })
    const id = db.prepare('INSERT INTO customer_tiers (account_id, name, icon, color, min_ltv) VALUES (?, ?, ?, ?, ?)').run(req.accountId, t.name, t.icon, t.color, t.min).lastInsertRowid
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ tier: db.prepare('SELECT * FROM customer_tiers WHERE id = ?').get(id) })
  })
  router.put('/tiers/:id', managerOnly, (req, res) => {
    const t = tierBody(req.body); if (t.error) return res.status(400).json({ error: t.error })
    const r = db.prepare('UPDATE customer_tiers SET name = ?, icon = ?, color = ?, min_ltv = ? WHERE id = ? AND account_id = ?').run(t.name, t.icon, t.color, t.min, Number(req.params.id), req.accountId)
    if (!r.changes) return res.status(404).json({ error: 'Selo não encontrado.' })
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ tier: db.prepare('SELECT * FROM customer_tiers WHERE id = ?').get(Number(req.params.id)) })
  })
  router.delete('/tiers/:id', managerOnly, (req, res) => {
    db.prepare('DELETE FROM customer_tiers WHERE id = ? AND account_id = ?').run(Number(req.params.id), req.accountId)
    recalcAccountCustomers(db, req.accountId, { now: now() }); changed(req.accountId)
    res.json({ ok: true })
  })

  router.get('/reasons', (req, res) => res.json({ reasons: db.prepare('SELECT * FROM repurchase_reasons WHERE account_id = ? ORDER BY grp, position').all(req.accountId) }))
  router.post('/reasons', managerOnly, (req, res) => {
    const grp = req.body?.grp; const label = String(req.body?.label || '').trim().slice(0, 60)
    if (!['nao_agora', 'nao_quer'].includes(grp) || !label) return res.status(400).json({ error: 'Informe o grupo e o motivo.' })
    const pos = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM repurchase_reasons WHERE account_id = ? AND grp = ?').get(req.accountId, grp).p
    const id = db.prepare('INSERT INTO repurchase_reasons (account_id, grp, label, position) VALUES (?, ?, ?, ?)').run(req.accountId, grp, label, pos).lastInsertRowid
    res.json({ reason: db.prepare('SELECT * FROM repurchase_reasons WHERE id = ?').get(id) })
  })
  router.put('/reasons/:id', managerOnly, (req, res) => {
    const cur = db.prepare('SELECT * FROM repurchase_reasons WHERE id = ? AND account_id = ?').get(Number(req.params.id), req.accountId)
    if (!cur) return res.status(404).json({ error: 'Motivo não encontrado.' })
    const label = req.body?.label !== undefined ? String(req.body.label).trim().slice(0, 60) : cur.label
    if (!label) return res.status(400).json({ error: 'O motivo não pode ficar vazio.' })
    const active = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : cur.is_active
    const position = Number.isInteger(req.body?.position) ? req.body.position : cur.position
    db.prepare('UPDATE repurchase_reasons SET label = ?, is_active = ?, position = ? WHERE id = ?').run(label, active, position, cur.id)
    res.json({ reason: db.prepare('SELECT * FROM repurchase_reasons WHERE id = ?').get(cur.id) })
  })

  return router
}
```

(Confira o formato que `cityWhere('l', geo)` devolve — `{ sql, params }` e se o `sql` já vem com `AND` na frente; ajuste o `scopeOf` para que `geoSql` sempre comece com ` AND ` ou seja vazio.)

- [ ] **Step 4: Montar em `server/index.js`** (junto das outras rotas protegidas)

```js
import { createCustomersRouter } from './routes/customersRouter.js'
import { repurchaseAiFor } from './services/ltv/aiRuntime.js'
// ...
app.use('/api/customers', authenticate, scopeToAccount, createCustomersRouter(db, { aiFor: id => repurchaseAiFor(db, id), broadcast: broadcastSSE }))
```

- [ ] **Step 5: Filtros em `GET /api/leads`** — `server/routes/leads.js`, perto das linhas 109–111 onde entram `cityWhere` e `scoreWhere`:

```js
import { customerWhere } from '../services/ltv/filters.js'   // topo
// ...
  const cw2 = customerWhere('l', req.query)
  if (cw2.sql) { where.push(cw2.sql.replace(/^\s*AND\s+/i, '')); params.push(...cw2.params) }
```

(Siga o mesmo jeito que `scoreWhere` é aplicado ali — se ele empurra em `where[]` sem o `AND`, faça igual. Aplique também na rota de `pipeline` que já recebe os filtros de score/cidade, se houver uma separada.)

- [ ] **Step 6: Proteções em `server/routes/funnels.js`**

```js
import { checkStagesUpdate, canDeactivateFunnel } from '../services/ltv/funnel.js'   // topo
```

No `PUT /:id/stages`, antes de qualquer alteração:

```js
  const guard = checkStagesUpdate(db, Number(req.params.id), req.body?.stages || [])
  if (!guard.ok) return res.status(409).json({ error: guard.error })
```

E, no loop de UPDATE das etapas existentes, para etapas com `system_key` não sobrescreva `is_conversion`/`is_terminal` (leia o valor atual e mantenha). No `PUT /:id`:

```js
  if (req.body?.is_active === 0 || req.body?.is_active === false) {
    if (!canDeactivateFunnel(db, Number(req.params.id))) return res.status(409).json({ error: 'O funil Recompra não pode ser desativado.' })
  }
```

Garanta que `GET /` devolva a coluna `kind` (se usa `SELECT *`, já devolve).

- [ ] **Step 7: Métricas antigas só de vendas**

- `server/routes/dashboard.js` `/stats` `convData` (linhas 50–55) e `/agents` (linha 106): na junção com `funnel_stages`, acrescente `JOIN funnels fk ON fk.id = fs.funnel_id AND fk.kind = 'vendas'` (use o alias de etapa que a consulta já usa).
- `server/services/attendantMetrics.js:80-92`: mesma junção. Se o teste de `attendantMetrics` usar um banco sem `funnels.kind`, acrescente `applyLtvSchema(db)` no setup desse teste.

- [ ] **Step 8: Rodar** — `node --test test/customersHttp.test.js` → PASS; `npm test` → verde; `npx tsc --noEmit` → 16 erros antigos.

- [ ] **Step 9: Commit**

```bash
git add server/routes/customersRouter.js server/index.js server/routes/leads.js server/routes/funnels.js server/routes/dashboard.js server/services/attendantMetrics.js test/customersHttp.test.js
git commit -m "feat(ltv): rotas /api/customers, protecoes do funil Recompra e metricas de vendas sem recompra"
```

---

### Task 11: Front — API, `SaleModal` único e vendas com produto/tipo (Chat, ficha, Pipeline)

**Files:**
- Modify: `src/lib/api.ts` (tipos e funções novas; perto da linha 1306)
- Create: `src/components/SaleModal.tsx`
- Modify: `src/pages/Chat.tsx` (modal de venda 2868–2940 e bloco "vendas" 2393), `src/pages/LeadDetail.tsx` (114–200, 660), `src/pages/Pipeline.tsx` (162–215, 456)

**Interfaces:**
- Produces (api.ts):

```ts
export type SaleKind = 'recompra' | 'unica'
export const REMIND_DAYS = [7, 15, 30, 45, 60] as const
export interface LeadSale { id: number; lead_id: number; value: number; sale_date: string; notes: string | null; created_by_name?: string | null;
  product: string | null; sale_kind: SaleKind | null; remind_days: number | null; cross_sell: number; cross_sell_offer: string | null }
export interface NewSaleInput { value: number; sale_date?: string; notes?: string; product?: string; sale_kind: SaleKind; remind_days?: number; cross_sell?: boolean; cross_sell_offer?: string }
export function addLeadSale(leadId: number, accountId: number, input: NewSaleInput): Promise<{ sale: LeadSale; total: number; cycle_id: number | null; opt_out: boolean }>
export function patchLeadSale(leadId: number, accountId: number, saleId: number, input: Partial<NewSaleInput>): Promise<{ sale: LeadSale }>
export interface CustomerCardData { ltv: number; purchases: number; lastPurchaseAt: string | null; curve: 'A'|'B'|'C'|'D'|'1a'|null;
  tier: { id: number; name: string; icon: string | null; color: string } | null;
  cycle: { id: number; kind: 'recompra'|'cruzada'; status: string; remind_at: string; remind_days: number; attempt: number; exhausted: number; offer_text: string | null; ai_suggestion: { products: string[]; message: string } | null; auto_failed_reason: string | null } | null;
  reasons: { nao_agora: { id: number; label: string }[]; nao_quer: { id: number; label: string }[] }; optOut: boolean; maxAttempts: number }
export function fetchCustomerCard(leadId: number, accountId: number): Promise<CustomerCardData>
export function postRepurchaseOutcome(leadId: number, accountId: number, body: { outcome: 'nao_agora'|'nao_quer'; reason_id: number; next_days?: number }): Promise<{ cycle: unknown }>
export function undoRepurchaseOptOut(leadId: number, accountId: number): Promise<{ ok: true }>
```

- Produces (componente): `<SaleModal open leadName accountId leadId defaultDays? aiEnabled? onClose onSaved(total) />` — faz a chamada `addLeadSale` sozinho.

- [ ] **Step 1: api.ts** — atualize `LeadSale`, troque a assinatura de `addLeadSale` para receber `NewSaleInput` (mantenha a URL `POST /api/leads/:id/sales?account_id=`), e adicione as funções acima usando `apiFetch` como as vizinhas. Exemplo:

```ts
export function fetchCustomerCard(leadId: number, accountId: number) {
  return apiFetch<CustomerCardData>(`/api/customers/lead/${leadId}?account_id=${accountId}`)
}
export function postRepurchaseOutcome(leadId: number, accountId: number, body: { outcome: 'nao_agora' | 'nao_quer'; reason_id: number; next_days?: number }) {
  return apiFetch<{ cycle: unknown }>(`/api/customers/lead/${leadId}/outcome?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(body) })
}
```

(Confira como `apiFetch` recebe `body`/headers nas funções vizinhas e copie.)

- [ ] **Step 2: `SaleModal.tsx`**

```tsx
// src/components/SaleModal.tsx
// Registrar venda (spec §5): valor, data, produto, tipo (pode recomprar / compra única) e lembrete.
import { useState } from 'react'
import { addLeadSale, REMIND_DAYS, type SaleKind } from '../lib/api'

interface Props {
  open: boolean; leadId: number; accountId: number; leadName?: string | null
  defaultDays?: number; aiEnabled?: boolean
  onClose: () => void; onSaved: (total: number) => void
}

export default function SaleModal({ open, leadId, accountId, leadName, defaultDays = 30, aiEnabled = false, onClose, onSaved }: Props) {
  const [value, setValue] = useState('')
  const [date, setDate] = useState('')
  const [product, setProduct] = useState('')
  const [notes, setNotes] = useState('')
  const [kind, setKind] = useState<SaleKind>('recompra')
  const [days, setDays] = useState<number>(defaultDays)
  const [cross, setCross] = useState(false)
  const [offer, setOffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null

  async function save() {
    setError(null)
    const v = parseFloat(value.replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) { setError('Informe o valor da venda.'); return }
    setSaving(true)
    try {
      const r = await addLeadSale(leadId, accountId, {
        value: v, sale_date: date || undefined, notes: notes || undefined, product: product || undefined,
        sale_kind: kind,
        remind_days: kind === 'recompra' || cross ? days : undefined,
        cross_sell: kind === 'unica' ? cross : undefined,
        cross_sell_offer: kind === 'unica' && cross ? offer || undefined : undefined,
      })
      onSaved(r.total)
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar a venda.')
    } finally { setSaving(false) }
  }

  const DaysPicker = (
    <div className="sale-days">
      {REMIND_DAYS.map(d => (
        <button key={d} type="button" className={`chip ${days === d ? 'chip-active' : ''}`} onClick={() => setDays(d)}>{d} dias</button>
      ))}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>Registrar venda{leadName ? ` — ${leadName}` : ''}</h3></div>
        <div className="modal-body">
          <label>Valor (R$)<input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} autoFocus /></label>
          <label>Data da venda<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label>Produto/serviço vendido<input maxLength={200} value={product} onChange={e => setProduct(e.target.value)} placeholder="Ex.: Churrasqueira a bafo 60cm" /></label>
          <div className="sale-kind">
            <label><input type="radio" checked={kind === 'recompra'} onChange={() => setKind('recompra')} /> Pode recomprar</label>
            <label><input type="radio" checked={kind === 'unica'} onChange={() => setKind('unica')} /> Compra única</label>
          </div>
          {kind === 'recompra' && (<><div className="hint">Lembrar em:</div>{DaysPicker}<div className="hint">Ex.: pacote de pilates → lembrar em 30 dias para renovar.</div></>)}
          {kind === 'unica' && (
            <>
              <label><input type="checkbox" checked={cross} onChange={e => setCross(e.target.checked)} /> Oferecer produtos relacionados depois</label>
              {cross && (<>
                <div className="hint">Oferecer em:</div>{DaysPicker}
                <label>O que oferecer<input maxLength={500} value={offer} onChange={e => setOffer(e.target.value)} placeholder="Ex.: espetos, tábuas, avental" /></label>
                {aiEnabled && <div className="hint">Deixe vazio e a IA sugere na hora do lembrete.</div>}
              </>)}
              <div className="hint">Ex.: vendeu uma churrasqueira → ofereça espetos e tábuas em 15 dias.</div>
            </>
          )}
          <label>Observação<textarea maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></label>
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar venda'}</button>
        </div>
      </div>
    </div>
  )
}
```

(Use as classes de modal/botão/chip que o `Chat.tsx` já usa no modal de venda atual; se `chip`/`chip-active`/`hint`/`form-error` não existirem no CSS, reaproveite as equivalentes do projeto e acrescente estilos mínimos no mesmo arquivo CSS onde está o modal de venda atual.)

- [ ] **Step 3: Trocar os modais antigos**
- `Chat.tsx`: remova o JSX do modal de venda (2868–2940) e o estado que só ele usa; `openSaleModalForConversion` / `openSaleModalStandalone` passam a abrir `<SaleModal>`; `confirmSaleValue` sai. No `onSaved`, recarregue vendas e cartão do cliente (`fetchLeadSales` + `fetchCustomerCard`). Mantenha o comportamento de hoje ao escolher etapa de conversão: abre a janela; cancelar desfaz a troca de etapa.
- `LeadDetail.tsx`: idem (114–200 e 660).
- `Pipeline.tsx`: em `tryMoveWithSaleCheck` (162), quando a etapa destino tem `is_conversion`, abra `<SaleModal>` (não mais `updateLeadValue`); o card só muda de coluna depois do `onSaved`; `onClose` sem salvar mantém o card onde estava.
- Lista de vendas (Chat bloco "vendas" 2393 e LeadDetail): mostre `product` e o tipo ("Recompra em 30 dias" / "Compra única" / "Única + oferta em 15 dias"); venda com `sale_kind === null` mostra botão **Marcar tipo** que abre um mini-formulário (tipo + dias + oferta) e chama `patchLeadSale`.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` (16 antigos) e `npm run build` → ok. No navegador (CRM local): registrar venda nos 3 tipos pelo Chat; "Marcar tipo" numa venda antiga; arrastar no Pipeline para "Venda" abre a janela nova.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/components/SaleModal.tsx src/pages/Chat.tsx src/pages/LeadDetail.tsx src/pages/Pipeline.tsx src/index.css
git commit -m "feat(ltv/front): janela unica de venda com produto, tipo e lembrete"
```

---

### Task 12: Front — funil Recompra no Pipeline (troca de funil + desfechos) e etapas protegidas

**Files:**
- Create: `src/components/OutcomeModal.tsx`
- Modify: `src/pages/Pipeline.tsx` (69–92 `loadData`, 347–349 seletor, `handleDrop`/`handleMobileMove`), `src/pages/Funnels.tsx:40,149`, `src/pages/Settings.tsx` (seção "Distribuição de Leads": só `kind === 'vendas'`)
- Modify: `src/lib/api.ts` (`Funnel`/`FunnelStage` ganham `kind` e `system_key`)

**Interfaces:**
- Produces: `<OutcomeModal open outcome: 'nao_agora'|'nao_quer' leadId accountId leadName reasons defaultDays onClose onDone />` — chama `postRepurchaseOutcome`.

- [ ] **Step 1: `OutcomeModal.tsx`**

```tsx
// src/components/OutcomeModal.tsx
// "Não comprou agora" (motivo + próxima tentativa) e "Não quer mais" (motivo) — spec §6.3.
import { useState } from 'react'
import { postRepurchaseOutcome, REMIND_DAYS } from '../lib/api'

interface Props {
  open: boolean; outcome: 'nao_agora' | 'nao_quer'; leadId: number; accountId: number; leadName?: string | null
  reasons: { id: number; label: string }[]; defaultDays: number
  onClose: () => void; onDone: () => void
}

export default function OutcomeModal({ open, outcome, leadId, accountId, leadName, reasons, defaultDays, onClose, onDone }: Props) {
  const [reasonId, setReasonId] = useState<number | null>(null)
  const [days, setDays] = useState(defaultDays)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!open) return null
  async function save() {
    if (!reasonId) { setError('Escolha o motivo.'); return }
    setSaving(true); setError(null)
    try {
      await postRepurchaseOutcome(leadId, accountId, { outcome, reason_id: reasonId, next_days: outcome === 'nao_agora' ? days : undefined })
      onDone(); onClose()
    } catch (e: any) { setError(e?.message || 'Não foi possível salvar.') } finally { setSaving(false) }
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>{outcome === 'nao_agora' ? 'Não comprou agora' : 'Não quer mais comprar'}{leadName ? ` — ${leadName}` : ''}</h3></div>
        <div className="modal-body">
          <div className="hint">Por quê?</div>
          <div className="reason-list">
            {reasons.map(r => (
              <label key={r.id}><input type="radio" checked={reasonId === r.id} onChange={() => setReasonId(r.id)} /> {r.label}</label>
            ))}
          </div>
          {outcome === 'nao_agora' ? (
            <>
              <div className="hint">Tentar de novo em:</div>
              <div className="sale-days">
                {REMIND_DAYS.map(d => <button key={d} type="button" className={`chip ${days === d ? 'chip-active' : ''}`} onClick={() => setDays(d)}>{d} dias</button>)}
              </div>
              <div className="hint">Ex.: o cliente disse "me chama mês que vem" → 30 dias.</div>
            </>
          ) : (
            <div className="hint">Este cliente não vai mais receber lembretes nem ofertas. Dá para desfazer depois na ficha dele.</div>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Pipeline — trocar de funil de verdade**
- Guarde o funil escolhido em estado `funnelId` (padrão: o `is_default`), persistido em `localStorage` por conta (`pipeline:funnel:<accountId>`, dentro de try/catch).
- `loadData` busca etapas e leads do `funnelId` escolhido (não mais sempre o padrão); o SSE `lead:updated` recarrega o funil escolhido. O seletor (347–349) passa a chamar `setFunnelId(f.id)`.
- Funil `kind === 'recompra'` aparece no seletor como "🔁 Recompra".

- [ ] **Step 3: Pipeline — desfechos**
- Em `handleDrop` / `handleMobileMove`, se a etapa destino tem `system_key` `nao_agora` ou `nao_quer`: não mova; busque `fetchCustomerCard(leadId)` e abra `<OutcomeModal>` com `reasons[outcome]` e `defaultDays = card.cycle?.remind_days ?? 30`. Em `onDone`, recarregue.
- Se destino é `comprou` (`is_conversion`), já cai no `SaleModal` da Task 11.
- Se o servidor devolver 409 `code: 'use_outcome'` (ex.: outro caminho), mostre a mesma janela.

- [ ] **Step 4: Funnels.tsx** — esconda o botão de lixeira (linha 149) das etapas com `system_key` e mostre o selo "usada pela recompra"; em `removeStage` (40), ignore essas etapas. Mostre a mensagem 409 do servidor se aparecer.

- [ ] **Step 5: Settings.tsx** — na seção "Distribuição de Leads", itere só `funnels.filter(f => (f.kind ?? 'vendas') === 'vendas')`.

- [ ] **Step 6: Verificar** — `npx tsc --noEmit` e `npm run build`. No navegador: trocar para o funil Recompra; arrastar para "Não comprou agora" (motivo obrigatório; volta para Aguardando); "Não quer mais"; tentar apagar etapa-chave em Funis (sem lixeira).

- [ ] **Step 7: Commit**

```bash
git add src/components/OutcomeModal.tsx src/pages/Pipeline.tsx src/pages/Funnels.tsx src/pages/Settings.tsx src/lib/api.ts
git commit -m "feat(ltv/front): funil Recompra no Pipeline com desfechos e etapas protegidas"
```

---

### Task 13: Front — bloco "Cliente" no painel do lead (Chat e ficha)

**Files:**
- Create: `src/components/CustomerCard.tsx`
- Modify: `src/lib/panelLayout.js` (`ATENDIMENTO_BLOCKS` + `'cliente'` logo após `'vendas'`), `src/lib/panelLayout.d.ts` (`AtendimentoBlockId`), `server/services/panelLayouts.js:6-7` (`PANEL_BLOCKS.atendimento`), `src/pages/Chat.tsx:2133` (mapa de blocos), `src/pages/LeadDetail.tsx`, `src/context/SSEContext.tsx:29` (`customers:updated`)
- Test: o teste existente que confere que as listas de blocos do servidor e do front são iguais deve continuar passando.

**Interfaces:**
- Produces: `<CustomerCard leadId accountId leadName onOpenReview?(text) />` — busca `fetchCustomerCard`, escuta `customers:updated` e `lead:updated` do lead, mostra:
  - linha: `{tier.icon} {tier.name} · Curva {curve} · LTV R$ … · N compras · última há X dias` (curva `'1a'` = "1ª compra");
  - status do ciclo: `aguardando` → "Próxima recompra em N dias (dd/mm)"; `a_contatar` → "A contatar — tentativa X de Y"; `em_conversa` → "Em conversa — tentativa X de Y"; `exhausted` → "Tentativas esgotadas"; `optOut` → "Não quer mais [Desfazer]";
  - quando há `cycle.ai_suggestion.message` ou `offer_text`: "O que oferecer: …" e botão **Revisar e enviar** → `onOpenReview(message)`;
  - botões **Comprou de novo** (abre `SaleModal`), **Não comprou agora** e **Não quer mais** (abrem `OutcomeModal`) quando há ciclo aberto;
  - não renderiza nada se `purchases === 0`.

- [ ] **Step 1: Registrar o bloco** nas quatro listas (servidor, `panelLayout.js`, `.d.ts`, mapa no `Chat.tsx`). Rode `npm test` — o teste de paridade de blocos deve passar.

- [ ] **Step 2: `CustomerCard.tsx`** — implemente conforme a interface acima usando `fetchCustomerCard`, `SaleModal`, `OutcomeModal`, `undoRepurchaseOptOut`, `formatBRL` e `useSSE` (mesmo padrão de `Tasks.tsx:54`). Dias desde a última compra: `Math.round((Date.now() - Date.parse(lastPurchaseAt + 'T12:00:00Z')) / 86400000)`.

- [ ] **Step 3: Chat** — no mapa de blocos (2133), `cliente: () => <CustomerCard leadId={lead.id} accountId={accountId} leadName={lead.name} onOpenReview={text => openReview({ title: 'Recompra', initialText: text })} />` (use a assinatura real de `openReview` em `Chat.tsx:549` — ela abre o `StepReviewModal` e envia pelo caminho manual do Chat).

- [ ] **Step 4: LeadDetail** — mostre o `CustomerCard` abaixo das vendas (sem `onOpenReview`).

- [ ] **Step 5: SSE** — acrescente `'customers:updated'` à lista de eventos em `SSEContext.tsx:29`.

- [ ] **Step 6: Verificar** — `npm test`, `npx tsc --noEmit`, `npm run build`. No navegador: cartão aparece no Chat para lead com venda; "Arrumar" lista o bloco "Cliente"; Revisar e enviar abre "Conferir mensagem" com o texto da IA.

- [ ] **Step 7: Commit**

```bash
git add src/components/CustomerCard.tsx src/lib/panelLayout.js src/lib/panelLayout.d.ts server/services/panelLayouts.js src/pages/Chat.tsx src/pages/LeadDetail.tsx src/context/SSEContext.tsx
git commit -m "feat(ltv/front): cartao do cliente no painel do lead"
```

---

### Task 14: Front — tela "Clientes" (4 abas), menu e filtros

**Files:**
- Create: `src/pages/Clientes.tsx`
- Create: `src/lib/customerFilter.js`
- Modify: `src/lib/api.ts` (funções de `/api/customers`), `src/components/Sidebar.tsx` (item "Clientes" junto de Leads/Pipeline, ícone `Crown` ou `Users` do lucide), `src/App.tsx` (rota `/clientes` para todos os usuários, linhas 136–143), `src/components/MoreFilters.tsx`, `src/pages/Leads.tsx:81-88`, `src/pages/Pipeline.tsx:79`

**Interfaces:**
- Consumes: `/api/customers/overview|list|repurchase|stale|stale/tasks|tiers` (Task 10).
- Produces (api.ts): `fetchCustomersOverview(accountId, params)`, `fetchCustomersList(accountId, params)`, `fetchRepurchaseStats(accountId, params)`, `fetchStaleStats(accountId, params)`, `createStaleTasks(accountId, leadIds)`, `fetchTiers(accountId)`; `customerFilter.js`: `useCustomerFilter(accountId) → [filter, setFilter]` (localStorage por conta, try/catch) e `customerParams(filter) → { curve?, tier_id?, repurchase_late? }`.

- [ ] **Step 1: api.ts + customerFilter.js** — funções com `apiFetch` e query string montada como as de Leads (incluindo `geoParams(cityFilter)`).

- [ ] **Step 2: `Clientes.tsx`** — página com cabeçalho (título "Clientes", filtro de período com atalhos "30 dias / 90 dias / 12 meses / Tudo", atendente para gestor, `MoreFilters` para Estado/Cidade) e abas:
  1. **Visão geral** — `metric-card`s: LTV médio, Ticket médio, Compras por cliente, % que recompraram; card "Tempo real de recompra": "Marcaram {markedDays} dias; os clientes voltam em {medianDays} dias" + sugestão quando houver; distribuição por curva (barras simples A/B/C/D/1ª) e por selo. Explicação com exemplo no topo: "Curva A = compra a cada até 30 dias. Ex.: quem compra a cada 20 dias é A; se parar 50 dias, vira C até comprar de novo."
  2. **Clientes** — tabela (nome, curva, selo, LTV, compras, última compra, próxima recompra/status, atendente), filtros curva/selo/atrasado/"não quer mais", ordenar por LTV ou última compra, paginação de 50; clique abre `/chat?lead=<id>` (use a mesma navegação que Leads usa para abrir o Chat).
  3. **Recompra** — funil com números (lembretes → em conversa → comprou / não agora / não quer) e % de cada passo; dois gráficos de barras horizontais dos motivos; "voltou a comprar em qual tentativa" (1ª/2ª/3ª/4ª+); recompra × venda cruzada; automático × manual (só se houver auto). Carregue a skill `dataviz` antes de escrever os gráficos.
  4. **Parados** — card "Atrasados na recompra: N clientes · R$ X parados" + lista; tabela cruzada faixa (30–60, 61–90, 91–180, 180+) × curva × selo com contagem e LTV; seleção por linha/"todos da faixa" → botão **Criar tarefas** (`createStaleTasks`, mostra "N tarefas criadas").
  Estados vazios com exemplo (ex.: "Nenhuma venda com recompra ainda. Ao registrar uma venda, marque 'Pode recomprar'.").
  Escute `customers:updated` para recarregar a aba aberta.

- [ ] **Step 3: Menu e rota** — `Sidebar.tsx`: `<NavLink to="/clientes">` com ícone e texto "Clientes" logo depois de Leads; `App.tsx`: `<Route path="/clientes" element={<Clientes />} />` na área de todos os usuários.

- [ ] **Step 4: "Mais filtros..."** — `MoreFilters.tsx` ganha props opcionais `customer` / `onCustomerChange`: seletor Curva (Todas/A/B/C/D/1ª compra), Selo (lista de `fetchTiers`) e caixa "Atrasado na recompra". `Leads.tsx` e `Pipeline.tsx` espalham `...customerParams(customerFilter)` junto de `geoParams`/`scoreParams`.

- [ ] **Step 5: Verificar** — `npx tsc --noEmit`, `npm run build`. No navegador: as 4 abas com dados do CRM local; vendedor vê só os seus; filtros de Leads/Pipeline funcionam.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clientes.tsx src/lib/customerFilter.js src/lib/api.ts src/components/Sidebar.tsx src/App.tsx src/components/MoreFilters.tsx src/pages/Leads.tsx src/pages/Pipeline.tsx
git commit -m "feat(ltv/front): tela Clientes (visao geral, clientes, recompra, parados) e filtros"
```

---

### Task 15: Front — Configurações "Clientes" e quadro "Recompra" no Dashboard

**Files:**
- Create: `src/components/settings/CustomersSettings.tsx`
- Create: `src/components/RepurchaseDashboardCard.tsx`
- Modify: `src/pages/Settings.tsx` (nova `<section className="dash-section">` só para gestor), `src/pages/Dashboard.tsx` (perto da linha 161), `src/lib/api.ts` (settings/tiers/reasons)

**Interfaces:**
- Consumes: `GET/PUT /api/customers/settings`, CRUD `/tiers`, `/reasons`, `GET /overview`, `GET /stale`, `GET /repurchase`.

- [ ] **Step 1: api.ts** — `fetchCustomerSettings`, `saveCustomerSettings`, `createTier`, `updateTier`, `deleteTier`, `fetchReasons`, `createReason`, `updateReason`.

- [ ] **Step 2: `CustomersSettings.tsx`** — três cartões, salvar automático com "Salvo ✓" (mesmo padrão das telas recentes, ex. a tela de Cadências) e mensagens de erro do servidor via `useInlineNotice`:
  - **Curva por ritmo:** A até [30] · B até [45] · C até [60] · acima = D, com o exemplo do spec §10.1.
  - **Selos de valor:** lista (ícone, nome, cor, "a partir de R$"), [+ Novo selo], editar/apagar; vazio: "Crie selos como 💎 Diamante (a partir de R$ 5.000) para destacar quem mais compra."
  - **Recompra:** limite de tentativas [5]; chave "Lembretes automáticos" — desabilitada com o motivo quando `autoAvailable.ok === false` ("Ligue a IA da conta" / "Conecte um número de disparo (UzAPI ou Oficial)"); texto explicando que a IA escreve e envia sozinha e que as regras anti-bloqueio valem; motivos em dois grupos (renomear, desativar, adicionar, ordenar ↑↓).

- [ ] **Step 3: Settings.tsx** — `{isGerenteOuAdmin && <section className="dash-section"><div className="section-title">Clientes e recompra</div><CustomersSettings accountId={accountId} /></section>}`.

- [ ] **Step 4: `RepurchaseDashboardCard.tsx`** — no padrão de `ConversionByBandCard`: atrasados (nº e valor parado), taxa de recompra do mês (`comprou / contacted` do `repurchaseStats` do mês corrente), clientes com 2+ compras (`repeatPct`), link "Ver clientes" → `/clientes`. Some se a conta não tem nenhum cliente. Incluir em `Dashboard.tsx` perto da linha 161.

- [ ] **Step 5: Verificar** — `npx tsc --noEmit`, `npm run build`. No navegador: mudar curva e ver as letras mudarem na tela Clientes; criar selo "💎 Diamante" e ver no cartão do lead; chave automática desabilitada sem número de disparo; quadro no Dashboard.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/CustomersSettings.tsx src/components/RepurchaseDashboardCard.tsx src/pages/Settings.tsx src/pages/Dashboard.tsx src/lib/api.ts
git commit -m "feat(ltv/front): configuracoes de clientes/recompra e quadro no Dashboard"
```

---

### Task 16: Conferência completa no navegador

**Files:** nenhum código novo (só correções que aparecerem, cada uma com teste quando for de servidor).

- [ ] **Step 1:** `npm test` (todos verdes), `npx tsc --noEmit` (16 antigos), `npm run build`.
- [ ] **Step 2:** Subir o CRM local (ver memória: exportar as 3 linhas "TESTE LOCAL" do `.env`, portas 3002/5175) e percorrer:
  1. Chat → lead no funil de vendas → etapa "Venda" → janela nova → "Pode recomprar 30 dias" → lead aparece no Pipeline "🔁 Recompra / Aguardando".
  2. Venda retroativa (data de 40 dias atrás, 30 dias) → lead já em "A contatar" com tarefa em Tarefas.
  3. Compra única + oferta vazia (conta com IA) → na ativação, tarefa com sugestão; "Revisar e enviar" abre "Conferir mensagem".
  4. Pipeline Recompra: arrastar para "Não comprou agora" (motivo, 15 dias) → volta para Aguardando; "Não quer mais" → cartão mostra [Desfazer].
  5. Responder o cliente pelo Chat com lead em "A contatar" → vai para "Em conversa".
  6. Tela Clientes: 4 abas com números coerentes; login de vendedor vê só os seus.
  7. Configurações: curva, selo, motivos, chave automática (desabilitada sem número de disparo).
  8. Dashboard: quadro Recompra; Leads/Pipeline: filtros Curva/Selo/Atrasado.
  9. Funis: etapa-chave sem lixeira; funil Recompra fora de "Distribuição de Leads".
- [ ] **Step 3:** Atualizar a memória `retomar-crm.md` com a ponta, número de testes e o que falta o dono conferir.
- [ ] **Step 4: Commit** das correções (se houver), mensagem `fix(ltv): ...`.

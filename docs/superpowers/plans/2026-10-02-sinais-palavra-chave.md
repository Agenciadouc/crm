# Sinais de Venda por Palavra-chave em Tempo Real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar em tempo real, por palavra-chave e sem custo de IA, três níveis de sinal de interesse do lead (fraco/forte/negativo) em cada mensagem, alimentar a nota do Termômetro já existente com isso (substituindo o `buyingTermLast7d` raso de hoje) e avançar a etapa do funil sozinho quando o sinal for forte o bastante.

**Architecture:** Função pura de casamento de palavras (`server/services/signals/keywordMatch.js`) + camada de banco isolada (`server/services/signals/repo.js`, recebe `db` por injeção) + motor (`server/services/signals/engine.js`) chamado de um único ponto do webhook (`inboundHandler.js`, ao lado do `onInboundSaved` do Roteiro). **Desvio consciente da spec** (`docs/superpowers/specs/2026-10-02-sinais-palavra-chave-design.md` §4.2/4.4): em vez das colunas `leads.pending_trigger_stage_id`/`pending_trigger_at` (estado mutável de "gatilho armado"), o gatilho é recalculado sem estado a cada mensagem (olha a sequência de mensagens outbound imediatamente anterior); e `lead_signals` ganha uma coluna `confirmed_at` (em vez de inferir "fraco confirmado" só por ausência de outra linha). Resultado funcional idêntico ao aprovado — menos uma tabela de estado mutável pra manter sincronizada, e sem corrida entre múltiplos webhooks concorrentes.

**Tech Stack:** Node 20 local (prod Node 16), Express 4, better-sqlite3 ^10.1.0, ES Modules, `node:test`/`node:assert` nativos (zero dependência nova), React 19 + TypeScript no front.

**Spec:** `docs/superpowers/specs/2026-10-02-sinais-palavra-chave-design.md`

## Global Constraints

- **NÃO adicionar dependências npm** — só o que já existe + builtins do Node.
- **ES Modules** (`import`/`export`, nunca `require`).
- **Multi-tenant**: toda query nova inclui/filtra `account_id` quando a tabela tiver.
- **Sem emojis em código**; commits em português, prefixo `feat:`/`fix:`/`refactor:`.
- **Não importar o singleton `server/db.js` em funções de serviço nem em testes** — tudo recebe `db` por parâmetro (mesma regra desde a Fase 1 original).
- **Reaproveitar, não duplicar**: `moveLeadToStage` (`server/services/stageMove.js`) pro avanço de etapa, `getFunnelStages` (`server/services/roteiro/leadRoteiro.js`) pra pegar a próxima etapa, `scheduleScore` (`server/services/leadScore/recalc.js`) pra recalcular a nota — nenhum desses é reimplementado.
- **Sem `leads.lead_score` novo nem badge separado** — tudo passa pelo Termômetro existente (`server/services/leadScore/`).
- Rodar testes sempre com `export PATH="/c/nvm4w/nodejs:$PATH" && npm test` (Node 20 local; prod é Node 16).

## Review Focus

- Vendedor manda uma pergunta-gatilho e o lead **nunca mais responde** (silêncio total, nem mensagem genérica) — nenhum sinal fraco deve ser gravado nem pontuado, e o motor não pode lançar exceção.
- Lead pergunta preço (fraco) e na mensagem seguinte manda algo que bate em `negative_keywords` (ex. "não quero mais nada") — o fraco é confirmado (ele respondeu) **e** o negativo também é gravado; o resultado líquido na nota tem que refletir o negativo dominando (ele pesa mais), não os dois se cancelando silenciosamente nem só um dos dois sendo considerado.
- Etapa sem nenhuma lista de palavra-chave configurada (`trigger_keywords`/`weak_keywords`/`strong_keywords`/`negative_keywords` todos `NULL`) — motor não pode quebrar, e nenhum sinal falso é gerado.
- Duas contas com `keyword_signal_ghost_hours` diferentes (uma conta não configurou = usa o default 24; outra configurou 48) — a janela usada tem que ser a da conta do lead, nunca um valor fixo no código.
- Mensagem com acento/caixa variada ("QUANTO CUSTA??", "Não Quero mais") tem que casar igual à forma normalizada da palavra-chave cadastrada — testado de ponta a ponta no motor, não só na função pura de matching.

---

### Task 1: Schema — colunas novas e tabela `lead_signals`

**Files:**
- Create: `server/services/signals/schema.js`
- Modify: `server/db.js` (import + chamada, no bloco final junto dos outros `applyXSchema`)
- Modify: `test/helpers/roteiroDb.js` (chamar o novo schema dentro de `createRoteiroTestDb`)
- Test: `test/signalsSchema.test.js`

**Interfaces:**
- Produces:
  - `applyKeywordSignalsSchema(db)` — idempotente, sem retorno.
  - Colunas: `funnel_stages.trigger_keywords/weak_keywords/strong_keywords/negative_keywords` (TEXT, JSON array), `accounts.keyword_signal_ghost_hours` (INTEGER NOT NULL DEFAULT 24).
  - Tabela: `lead_signals(id, account_id, lead_id, stage_id, signal_type, keyword, message_id, confirmed_at, created_at)`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/signalsSchema.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb } from './helpers/memoryDb.js'
import { applyKeywordSignalsSchema } from '../server/services/signals/schema.js'

function hasCol(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)
}

test('applyKeywordSignalsSchema cria colunas e a tabela lead_signals', () => {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  for (const col of ['trigger_keywords', 'weak_keywords', 'strong_keywords', 'negative_keywords']) {
    assert.ok(hasCol(db, 'funnel_stages', col), `funnel_stages.${col} deveria existir`)
  }
  assert.ok(hasCol(db, 'accounts', 'keyword_signal_ghost_hours'), 'accounts.keyword_signal_ghost_hours deveria existir')
  const defaultRow = db.prepare('SELECT keyword_signal_ghost_hours FROM accounts LIMIT 1').get()
  assert.equal(defaultRow?.keyword_signal_ghost_hours ?? 24, 24)

  db.prepare(`INSERT INTO lead_signals (account_id, lead_id, stage_id, signal_type, keyword, message_id, created_at) VALUES (1, 1, 1, 'strong', 'quero comprar', 1, datetime('now'))`).run()
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.equal(row.signal_type, 'strong')
  assert.equal(row.confirmed_at, null)
})

test('applyKeywordSignalsSchema e idempotente (rodar 2x nao quebra)', () => {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  assert.doesNotThrow(() => applyKeywordSignalsSchema(db))
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsSchema.test.js`
Expected: FAIL — `Cannot find module '.../server/services/signals/schema.js'`

- [ ] **Step 3: Implementar o schema**

Criar `server/services/signals/schema.js`:

```js
// Esquema dos Sinais de Venda por Palavra-chave (spec 2026-10-02 §4). Nao importa server/db.js: recebe db.
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)
}
function addColumnIfNotExists(db, table, column, type) {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyKeywordSignalsSchema(db) {
  addColumnIfNotExists(db, 'funnel_stages', 'trigger_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'weak_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'strong_keywords', 'TEXT')
  addColumnIfNotExists(db, 'funnel_stages', 'negative_keywords', 'TEXT')

  addColumnIfNotExists(db, 'accounts', 'keyword_signal_ghost_hours', 'INTEGER NOT NULL DEFAULT 24')

  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      stage_id INTEGER,
      signal_type TEXT NOT NULL CHECK (signal_type IN ('weak', 'strong', 'negative')),
      keyword TEXT,
      message_id INTEGER,
      confirmed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lead_signals_lead ON lead_signals(lead_id, signal_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_lead_signals_pending ON lead_signals(lead_id, signal_type, confirmed_at);
  `)
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsSchema.test.js`
Expected: PASS

- [ ] **Step 5: Ligar no `server/db.js`**

No topo do arquivo, junto dos outros imports de schema (perto de `import { applyLtvSchema } from './services/ltv/schema.js'`):

```js
import { applyKeywordSignalsSchema } from './services/signals/schema.js'
```

No final do arquivo, junto do bloco `try { applyLtvSchema(db) } catch ...`:

```js
try {
  applyKeywordSignalsSchema(db)
} catch (e) {
  console.error('[DB] sinais de palavra-chave (schema):', e.message)
}
```

- [ ] **Step 6: Ligar no helper de teste do Roteiro/Termômetro**

Em `test/helpers/roteiroDb.js`, adicionar o import e a chamada dentro de `createRoteiroTestDb`, logo depois de `applyRoteiroSchema(db)`:

```js
import { applyKeywordSignalsSchema } from '../../server/services/signals/schema.js'
```

```js
  applyRoteiroSchema(db)
  applyKeywordSignalsSchema(db)
  return db
```

- [ ] **Step 7: Rodar a suite inteira pra garantir que nada quebrou**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npm test`
Expected: PASS (todos os testes existentes continuam passando)

- [ ] **Step 8: Commit**

```bash
git add server/db.js server/services/signals/schema.js test/helpers/roteiroDb.js test/signalsSchema.test.js
git commit -m "feat: schema dos sinais de venda por palavra-chave (colunas de etapa, janela da conta, tabela lead_signals)"
```

---

### Task 2: Funções puras de casamento e classificação

**Files:**
- Create: `server/services/signals/keywordMatch.js`
- Test: `test/signalsKeywordMatch.test.js`

**Interfaces:**
- Consumes: nada (funções puras, sem banco).
- Produces:
  - `normalizeText(s: string) -> string`
  - `matchKeyword(text: string, keywords: string[]) -> string | null`
  - `parseKeywordList(json: string | null) -> string[]`
  - `classifyMessage(content: string, { strongKeywords, negativeKeywords, weakKeywords, hasArmedTrigger }) -> { type: 'negative'|'strong'|'weak'|null, keyword: string|null }`
  - `findTriggerKeyword(outboundContents: string[], triggerKeywords: string[]) -> string | null`

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/signalsKeywordMatch.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeText, matchKeyword, parseKeywordList, classifyMessage, findTriggerKeyword } from '../server/services/signals/keywordMatch.js'

test('normalizeText remove acentos, baixa caixa e colapsa espacos', () => {
  assert.equal(normalizeText('  QUANTO   Custa?  '), 'quanto custa?')
  assert.equal(normalizeText('Não Quero'), 'nao quero')
  assert.equal(normalizeText(null), '')
})

test('matchKeyword acha ignorando acento e caixa, ou null', () => {
  assert.equal(matchKeyword('Quanto CUSTA isso?', ['quanto custa']), 'quanto custa')
  assert.equal(matchKeyword('nada a ver', ['quanto custa']), null)
  assert.equal(matchKeyword('qualquer coisa', []), null)
})

test('parseKeywordList: JSON valido vira array, invalido/nulo vira []', () => {
  assert.deepEqual(parseKeywordList('["a","b"]'), ['a', 'b'])
  assert.deepEqual(parseKeywordList(null), [])
  assert.deepEqual(parseKeywordList('nao e json'), [])
  assert.deepEqual(parseKeywordList('{"a":1}'), [])
})

test('classifyMessage: negativo tem prioridade sobre forte', () => {
  const r = classifyMessage('nao quero mais, caro demais', {
    strongKeywords: ['caro demais'], negativeKeywords: ['nao quero mais'], weakKeywords: [], hasArmedTrigger: false,
  })
  assert.deepEqual(r, { type: 'negative', keyword: 'nao quero mais' })
})

test('classifyMessage: forte vale sem gatilho armado', () => {
  const r = classifyMessage('pode fechar, quero comprar', {
    strongKeywords: ['quero comprar'], negativeKeywords: [], weakKeywords: [], hasArmedTrigger: false,
  })
  assert.deepEqual(r, { type: 'strong', keyword: 'quero comprar' })
})

test('classifyMessage: fraco SO conta com gatilho armado', () => {
  const semGatilho = classifyMessage('quanto custa?', {
    strongKeywords: [], negativeKeywords: [], weakKeywords: ['quanto custa'], hasArmedTrigger: false,
  })
  assert.deepEqual(semGatilho, { type: null, keyword: null })

  const comGatilho = classifyMessage('quanto custa?', {
    strongKeywords: [], negativeKeywords: [], weakKeywords: ['quanto custa'], hasArmedTrigger: true,
  })
  assert.deepEqual(comGatilho, { type: 'weak', keyword: 'quanto custa' })
})

test('classifyMessage: nenhuma lista bate -> null (nao quebra com listas vazias)', () => {
  const r = classifyMessage('oi, tudo bem?', { strongKeywords: [], negativeKeywords: [], weakKeywords: [], hasArmedTrigger: true })
  assert.deepEqual(r, { type: null, keyword: null })
})

test('findTriggerKeyword: acha em qualquer mensagem da sequencia outbound, ou null', () => {
  assert.equal(findTriggerKeyword(['oi', 'posso te mandar uma proposta?'], ['posso te mandar uma proposta']), 'posso te mandar uma proposta')
  assert.equal(findTriggerKeyword(['oi', 'tudo bem?'], ['posso te mandar uma proposta']), null)
  assert.equal(findTriggerKeyword([], ['qualquer coisa']), null)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsKeywordMatch.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `server/services/signals/keywordMatch.js`:

```js
// Funcoes puras de casamento e classificacao de sinais por palavra-chave (spec 2026-10-02 §3.1).
// Sem banco, sem efeitos colaterais.

export function normalizeText(s) {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchKeyword(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return null
  const t = normalizeText(text)
  if (!t) return null
  for (const kw of keywords) {
    const nk = normalizeText(kw)
    if (nk && t.includes(nk)) return kw
  }
  return null
}

export function parseKeywordList(json) {
  if (!json) return []
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr.filter(k => typeof k === 'string' && k.trim()) : []
  } catch {
    return []
  }
}

// Ordem de prioridade (spec §3.1): negativo > forte > fraco (so com gatilho armado).
export function classifyMessage(content, { strongKeywords, negativeKeywords, weakKeywords, hasArmedTrigger }) {
  const neg = matchKeyword(content, negativeKeywords)
  if (neg) return { type: 'negative', keyword: neg }

  const strong = matchKeyword(content, strongKeywords)
  if (strong) return { type: 'strong', keyword: strong }

  if (hasArmedTrigger) {
    const weak = matchKeyword(content, weakKeywords)
    if (weak) return { type: 'weak', keyword: weak }
  }

  return { type: null, keyword: null }
}

export function findTriggerKeyword(outboundContents, triggerKeywords) {
  for (const content of outboundContents) {
    const match = matchKeyword(content, triggerKeywords)
    if (match) return match
  }
  return null
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsKeywordMatch.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/signals/keywordMatch.js test/signalsKeywordMatch.test.js
git commit -m "feat: funcoes puras de casamento e classificacao de sinais por palavra-chave"
```

---

### Task 3: Camada de banco (repo) — registrar, confirmar e consultar sinais

**Files:**
- Create: `server/services/signals/repo.js`
- Test: `test/signalsRepo.test.js`

**Interfaces:**
- Consumes: `parseKeywordList` (Task 2, só usado nos testes/fixtures deste arquivo).
- Produces:
  - `getPrecedingOutboundRun(db, leadId, beforeMessageId) -> Array<{ content: string, created_at: string }>`
  - `confirmPendingWeakSignals(db, leadId, ghostHours, nowIso) -> { changes: number }`
  - `recordSignal(db, { accountId, leadId, stageId, signalType, keyword, messageId, createdAt }) -> void`
  - `hasSignalLast7d(db, leadId, signalType, nowIso) -> boolean` (qualquer sinal daquele tipo, usado por forte/negativo)
  - `hasConfirmedWeakLast7d(db, leadId, nowIso) -> boolean`

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/signalsRepo.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { getPrecedingOutboundRun, confirmPendingWeakSignals, recordSignal, hasSignalLast7d, hasConfirmedWeakLast7d } from '../server/services/signals/repo.js'

function lastMessageId(db, leadId) {
  return db.prepare('SELECT id FROM messages WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId).id
}

test('getPrecedingOutboundRun: pega so os outbound depois do ultimo inbound, antes da mensagem dada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 30 })
  addMessage(db, { leadId, direction: 'outbound', content: 'tudo bem?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 10 })
  addMessage(db, { leadId, direction: 'inbound', content: 'pode sim', minutesAgo: 0 })

  const run = getPrecedingOutboundRun(db, leadId, lastMessageId(db, leadId))
  assert.deepEqual(run.map(m => m.content), ['tudo bem?', 'posso te mandar uma proposta?'])
})

test('getPrecedingOutboundRun: sem outbound antes -> array vazio', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'oi', minutesAgo: 0 })
  const run = getPrecedingOutboundRun(db, leadId, lastMessageId(db, leadId))
  assert.deepEqual(run, [])
})

test('recordSignal + hasSignalLast7d: grava e acha dentro de 7 dias, nao acha fora', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  const msgId = (() => { addMessage(db, { leadId, direction: 'inbound', content: 'quero comprar' }); return lastMessageId(db, leadId) })()

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'strong', keyword: 'quero comprar', messageId: msgId, createdAt: "datetime('now')".includes('(') ? null : new Date().toISOString() })
  assert.equal(hasSignalLast7d(db, leadId, 'strong', new Date().toISOString()), true)
  assert.equal(hasSignalLast7d(db, leadId, 'negative', new Date().toISOString()), false)

  db.prepare("UPDATE lead_signals SET created_at = datetime('now', '-10 days') WHERE lead_id = ?").run(leadId)
  assert.equal(hasSignalLast7d(db, leadId, 'strong', new Date().toISOString()), false)
})

test('confirmPendingWeakSignals: confirma so os pendentes dentro da janela, nao mexe no ja confirmado nem no velho demais', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa' })
  const msgId = lastMessageId(db, leadId)
  const now = new Date().toISOString()

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'weak', keyword: 'quanto custa', messageId: msgId, createdAt: now })
  assert.equal(hasConfirmedWeakLast7d(db, leadId, now), false)

  const info = confirmPendingWeakSignals(db, leadId, 24, now)
  assert.equal(info.changes, 1)
  assert.equal(hasConfirmedWeakLast7d(db, leadId, now), true)

  const info2 = confirmPendingWeakSignals(db, leadId, 24, now)
  assert.equal(info2.changes, 0, 'ja confirmado nao deveria mudar de novo')
})

test('confirmPendingWeakSignals: fora da janela de horas nao confirma (fantasma)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa' })
  const msgId = lastMessageId(db, leadId)

  recordSignal(db, { accountId: s.accountId, leadId, stageId: s.stages.novo, signalType: 'weak', keyword: 'quanto custa', messageId: msgId, createdAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() })
  const info = confirmPendingWeakSignals(db, leadId, 24, new Date().toISOString())
  assert.equal(info.changes, 0)
  assert.equal(hasConfirmedWeakLast7d(db, leadId, new Date().toISOString()), false)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsRepo.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `server/services/signals/repo.js`:

```js
// Camada de banco dos sinais de venda por palavra-chave (spec 2026-10-02). Nao importa server/db.js: recebe db.

export function getPrecedingOutboundRun(db, leadId, beforeMessageId) {
  const lastInbound = db.prepare(`
    SELECT MAX(id) as id FROM messages WHERE lead_id = ? AND id < ? AND direction = 'inbound'
  `).get(leadId, beforeMessageId)
  const floorId = lastInbound?.id ?? 0
  return db.prepare(`
    SELECT content, created_at FROM messages
    WHERE lead_id = ? AND id < ? AND id > ? AND direction = 'outbound'
    ORDER BY id ASC
  `).all(leadId, beforeMessageId, floorId)
}

export function recordSignal(db, { accountId, leadId, stageId, signalType, keyword, messageId, createdAt }) {
  db.prepare(`
    INSERT INTO lead_signals (account_id, lead_id, stage_id, signal_type, keyword, message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(accountId, leadId, stageId, signalType, keyword, messageId, createdAt)
}

// Confirma (mensagem nova provou que o lead continuou engajando) qualquer sinal 'weak'
// ainda pendente desse lead que esteja dentro da janela de silencio da conta.
export function confirmPendingWeakSignals(db, leadId, ghostHours, nowIso) {
  return db.prepare(`
    UPDATE lead_signals SET confirmed_at = ?
    WHERE lead_id = ? AND signal_type = 'weak' AND confirmed_at IS NULL
      AND created_at >= datetime(?, '-' || ? || ' hours')
  `).run(nowIso, leadId, nowIso, ghostHours)
}

export function hasSignalLast7d(db, leadId, signalType, nowIso) {
  const row = db.prepare(`
    SELECT 1 FROM lead_signals
    WHERE lead_id = ? AND signal_type = ? AND created_at >= datetime(?, '-7 days')
    LIMIT 1
  `).get(leadId, signalType, nowIso)
  return !!row
}

export function hasConfirmedWeakLast7d(db, leadId, nowIso) {
  const row = db.prepare(`
    SELECT 1 FROM lead_signals
    WHERE lead_id = ? AND signal_type = 'weak' AND confirmed_at IS NOT NULL AND confirmed_at >= datetime(?, '-7 days')
    LIMIT 1
  `).get(leadId, nowIso)
  return !!row
}
```

Nota: no teste de `recordSignal + hasSignalLast7d` o campo `createdAt` fica estranho de propósito (expressão complexa) só pra garantir que a implementação não depende de nenhum formato especial — na prática ele sempre recebe um ISO/SQLite datetime string. Simplifique o teste se achar confuso: `createdAt: new Date().toISOString()` sozinho já basta.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsRepo.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/signals/repo.js test/signalsRepo.test.js
git commit -m "feat: camada de banco dos sinais (registrar, confirmar fraco, consultar por janela)"
```

---

### Task 4: Motor de sinais — classifica, grava e avança etapa

**Files:**
- Create: `server/services/signals/engine.js`
- Test: `test/signalsEngine.test.js`

**Interfaces:**
- Consumes: `parseKeywordList`, `classifyMessage`, `findTriggerKeyword` (Task 2); `getPrecedingOutboundRun`, `confirmPendingWeakSignals`, `recordSignal` (Task 3); `getFunnelStages` (`server/services/roteiro/leadRoteiro.js`, já existe); `moveLeadToStage` (`server/services/stageMove.js`, já existe); `scheduleScore` (`server/services/leadScore/recalc.js`, já existe).
- Produces: `processInboundSignal(db, { account, lead, message }) -> { type: 'negative'|'strong'|'weak'|null, keyword: string|null, advanced: { from, to } | null }`
  - `message` precisa de `{ id, content, created_at }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `test/signalsEngine.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { processInboundSignal } from '../server/services/signals/engine.js'

function setStageKeywords(db, stageId, fields) {
  const cols = Object.keys(fields).map(k => `${k} = ?`).join(', ')
  db.prepare(`UPDATE funnel_stages SET ${cols} WHERE id = ?`).run(...Object.values(fields).map(v => JSON.stringify(v)), stageId)
}

function lastMessage(db, leadId) {
  return db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id DESC LIMIT 1').get(leadId)
}

function account(db, accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

test('forte vale sozinho e avanca de etapa', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['quero comprar'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quero comprar agora' })
  const msg = lastMessage(db, leadId)

  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: { ...db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) }, message: msg })

  assert.equal(result.type, 'strong')
  assert.ok(result.advanced, 'deveria ter avancado de etapa')
  const lead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.stage_id, s.stages.qualificando)
})

test('fraco SEM gatilho armado nao conta nada', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa isso?' })
  const msg = lastMessage(db, leadId)

  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: msg })

  assert.equal(result.type, null)
  assert.equal(result.advanced, null)
  const lead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(leadId)
  assert.equal(lead.stage_id, s.stages.novo)
})

test('fraco com gatilho armado + lead some = nunca confirma (fantasma), sem avanco', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 10 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 5 })
  const weakMsg = lastMessage(db, leadId)
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: weakMsg })
  assert.equal(result.type, 'weak')
  assert.equal(result.advanced, null, 'fraco sozinho (ainda nao confirmado) nao avanca')

  // lead nunca manda outra mensagem: nada mais pra processar, fica pendente pra sempre (fantasma na pratica)
  const pending = db.prepare("SELECT confirmed_at FROM lead_signals WHERE lead_id = ?").get(leadId)
  assert.equal(pending.confirmed_at, null)
})

test('fraco confirmado (lead manda outra mensagem depois) avanca de etapa na mensagem que confirma', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  const acc = account(db, s.accountId)
  const leadRow = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 15 })
  processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  addMessage(db, { leadId, direction: 'inbound', content: 'ainda ta ai?', minutesAgo: 0 })
  const result2 = processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  assert.ok(result2.advanced, 'a segunda mensagem do lead confirma o fraco e avanca')
  assert.equal(leadRow().stage_id, s.stages.qualificando)
})

test('negativo nunca avanca etapa, mesmo tendo sinal forte na mesma etapa', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['caro demais'], negative_keywords: ['caro demais, desisto'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'caro demais, desisto' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })

  assert.equal(result.type, 'negative')
  assert.equal(result.advanced, null)
})

test('fraco confirmado por uma mensagem que TAMBEM e negativa nao avanca (negativo domina a decisao de avanco)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'], negative_keywords: ['nao quero mais nada'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  const acc = account(db, s.accountId)
  const leadRow = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)

  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 20 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 15 })
  processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  addMessage(db, { leadId, direction: 'inbound', content: 'nao quero mais nada', minutesAgo: 0 })
  const result2 = processInboundSignal(db, { account: acc, lead: leadRow(), message: lastMessage(db, leadId) })

  assert.equal(result2.type, 'negative', 'a 2a mensagem em si e classificada como negativa')
  assert.equal(result2.advanced, null, 'mesmo confirmando o fraco pendente, uma mensagem negativa nunca avanca etapa')
  assert.equal(leadRow().stage_id, s.stages.novo, 'etapa nao muda')

  const weakSignal = db.prepare("SELECT confirmed_at FROM lead_signals WHERE lead_id = ? AND signal_type = 'weak'").get(leadId)
  assert.ok(weakSignal.confirmed_at, 'o fraco pendente e confirmado mesmo assim (o lead respondeu, so nao avanca etapa)')
  const negSignal = db.prepare("SELECT 1 FROM lead_signals WHERE lead_id = ? AND signal_type = 'negative'").get(leadId)
  assert.ok(negSignal, 'o sinal negativo tambem fica registrado')
})

test('etapa sem nenhuma lista configurada nao quebra e nao gera sinal', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'oi, tudo bem?' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.deepEqual(result, { type: null, keyword: null, advanced: null })
})

test('acento e caixa variados casam igual (QUANTO CUSTA?? == quanto custa)', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  setStageKeywords(db, s.stages.novo, { strong_keywords: ['não quero mais esperar, pode fechar'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })
  addMessage(db, { leadId, direction: 'inbound', content: 'NAO QUERO MAIS ESPERAR, PODE FECHAR!!' })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.equal(result.type, 'strong')
})

test('janela de silencio e a da conta, nao um valor fixo', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare('UPDATE accounts SET keyword_signal_ghost_hours = 1 WHERE id = ?').run(s.accountId)
  setStageKeywords(db, s.stages.novo, { weak_keywords: ['quanto custa'], trigger_keywords: ['posso te mandar uma proposta'] })
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo, name: 'Lead A' })

  // gatilho ha 2h, janela da conta e so 1h -> nao arma mais
  addMessage(db, { leadId, direction: 'outbound', content: 'posso te mandar uma proposta?', minutesAgo: 120 })
  addMessage(db, { leadId, direction: 'inbound', content: 'quanto custa?', minutesAgo: 0 })
  const result = processInboundSignal(db, { account: account(db, s.accountId), lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId), message: lastMessage(db, leadId) })
  assert.equal(result.type, null, 'gatilho de 2h atras nao deveria mais valer com janela de 1h')
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsEngine.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

Criar `server/services/signals/engine.js`:

```js
// Motor dos sinais de venda por palavra-chave (spec 2026-10-02). Classifica cada mensagem
// inbound, confirma sinais fracos pendentes, grava em lead_signals e avanca a etapa quando
// o sinal e forte o bastante. Nao importa server/db.js: recebe db via os parametros.
import { getFunnelStages } from '../roteiro/leadRoteiro.js'
import { moveLeadToStage } from '../stageMove.js'
import { scheduleScore } from '../leadScore/recalc.js'
import { classifyMessage, findTriggerKeyword, parseKeywordList } from './keywordMatch.js'
import { getPrecedingOutboundRun, confirmPendingWeakSignals, recordSignal } from './repo.js'

function hoursBetween(aIso, bIso) {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 3600000
}

function tryAdvance(db, lead, currentStageId) {
  const stages = getFunnelStages(db, lead.funnel_id)
  const current = stages.find(s => s.id === currentStageId)
  if (!current) return null
  const next = stages.filter(s => s.position > current.position).sort((a, b) => a.position - b.position)[0]
  if (!next || next.is_terminal) return null
  const result = moveLeadToStage(db, { lead, toStageId: next.id, trigger: 'keyword_signal', gate: false })
  if (!result.moved) return null
  return { from: current.id, to: next.id }
}

export function processInboundSignal(db, { account, lead, message }) {
  if (!lead.stage_id) return { type: null, keyword: null, advanced: null }
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!stage) return { type: null, keyword: null, advanced: null }

  const ghostHours = account?.keyword_signal_ghost_hours ?? 24

  // Passo A: confirma sinais fracos pendentes (esta mensagem prova que o lead continuou engajando).
  const confirmInfo = confirmPendingWeakSignals(db, lead.id, ghostHours, message.created_at)
  const confirmedSomething = confirmInfo.changes > 0

  // Passo B: classifica esta mensagem.
  const outboundRun = getPrecedingOutboundRun(db, lead.id, message.id)
    .filter(m => hoursBetween(m.created_at, message.created_at) <= ghostHours)
  const hasArmedTrigger = !!findTriggerKeyword(outboundRun.map(m => m.content), parseKeywordList(stage.trigger_keywords))

  const classification = classifyMessage(message.content, {
    strongKeywords: parseKeywordList(stage.strong_keywords),
    negativeKeywords: parseKeywordList(stage.negative_keywords),
    weakKeywords: parseKeywordList(stage.weak_keywords),
    hasArmedTrigger,
  })

  if (classification.type) {
    recordSignal(db, {
      accountId: account.id, leadId: lead.id, stageId: stage.id,
      signalType: classification.type, keyword: classification.keyword,
      messageId: message.id, createdAt: message.created_at,
    })
  }

  // Negativo nunca avanca etapa (spec §3.4) — mesmo que esta mesma mensagem tambem
  // confirme um sinal fraco pendente (ex.: lead pergunta preco, depois manda "nao quero mais").
  let advanced = null
  if (classification.type !== 'negative' && (classification.type === 'strong' || confirmedSomething)) {
    advanced = tryAdvance(db, lead, stage.id)
  }

  scheduleScore(lead.id)

  return { type: classification.type, keyword: classification.keyword, advanced }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsEngine.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/signals/engine.js test/signalsEngine.test.js
git commit -m "feat: motor dos sinais de palavra-chave (classifica, confirma fraco, avanca etapa)"
```

---

### Task 5: Integração com o Termômetro — `inputs.js`

**Files:**
- Modify: `server/services/leadScore/inputs.js` (remove `BUYING_TERMS`/`hasBuyingTerm`/`buyingTermLast7d`, adiciona os 3 campos novos)
- Modify: `test/leadScoreRecalc.test.js` (troca a asserção de `buyingTermLast7d` pelos campos novos)

**Interfaces:**
- Consumes: `hasSignalLast7d`, `hasConfirmedWeakLast7d` (Task 3).
- Produces: `buildEngagement(...)` passa a devolver `{ ..., strongSignalLast7d, weakSignalConfirmedLast7d, negativeSignalLast7d }` em vez de `buyingTermLast7d`.

- [ ] **Step 1: Atualizar o teste existente pra refletir o novo contrato (vai falhar)**

Em `test/leadScoreRecalc.test.js`, trocar a linha 70 (`assert.equal(input.engagement.buyingTermLast7d, true)`) por:

```js
  assert.equal(input.engagement.strongSignalLast7d, false)
  assert.equal(input.engagement.weakSignalConfirmedLast7d, false)
  assert.equal(input.engagement.negativeSignalLast7d, false)
```

(A mensagem "quanto custa?" do teste original não bate mais em nada automaticamente — não existe mais detecção de termo de compra solta no texto. Isso é esperado e correto: esse teste não armou nenhum sinal via o motor novo, só mandou mensagens cruas.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/leadScoreRecalc.test.js`
Expected: FAIL — `input.engagement.strongSignalLast7d` é `undefined`.

- [ ] **Step 3: Implementar a mudança em `inputs.js`**

Remover de `server/services/leadScore/inputs.js`:
- O array `BUYING_TERMS` (linhas 6-9).
- A função `hasBuyingTerm` (linhas 26-29).
- A linha `const buyingTermLast7d = msgs.some(...)` (linha 113).

Adicionar o import no topo do arquivo:

```js
import { hasSignalLast7d, hasConfirmedWeakLast7d } from '../signals/repo.js'
```

Na função `buildEngagement`, substituir a linha `const buyingTermLast7d = msgs.some(...)` por:

```js
  const nowIso = new Date(nowMs).toISOString()
  const strongSignalLast7d = hasSignalLast7d(db, lead.id, 'strong', nowIso)
  const weakSignalConfirmedLast7d = hasConfirmedWeakLast7d(db, lead.id, nowIso)
  const negativeSignalLast7d = hasSignalLast7d(db, lead.id, 'negative', nowIso)
```

E no `return` da função, trocar `buyingTermLast7d` por `strongSignalLast7d, weakSignalConfirmedLast7d, negativeSignalLast7d`:

```js
  return { daysSinceLastInbound, halfLifeDays, replyDelaysMin, lastOutboundReplied, advancedLast7d, strongSignalLast7d, weakSignalConfirmedLast7d, negativeSignalLast7d }
```

(`buildEngagement(db, lead, account, nowMs)` já recebe `db` e `lead` como parâmetros — linha 81 do arquivo atual — então `lead.id` funciona direto.)

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/leadScoreRecalc.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/services/leadScore/inputs.js test/leadScoreRecalc.test.js
git commit -m "refactor: Termometro troca buyingTermLast7d (raso) pelos sinais de palavra-chave com niveis"
```

---

### Task 6: Integração com o Termômetro — `compute.js`

**Files:**
- Modify: `server/services/leadScore/compute.js`
- Modify: `test/leadScoreCompute.test.js`

**Interfaces:**
- Consumes: `engagement.strongSignalLast7d`, `engagement.weakSignalConfirmedLast7d`, `engagement.negativeSignalLast7d` (Task 5).
- Produces: `computeLeadScore(...)` com a fórmula de `intensity` nova e `engagement` clampado nos dois lados (0 a 50).

- [ ] **Step 1: Atualizar os testes existentes (vão falhar)**

Em `test/leadScoreCompute.test.js`, trocar as 3 ocorrências de `buyingTermLast7d` (linhas 9, 39, 68) pelos 3 campos novos. Exemplo pra linha 9 (estado inicial, tudo falso):

```js
  engagement: { daysSinceLastInbound: null, halfLifeDays: 7, replyDelaysMin: [], lastOutboundReplied: [], advancedLast7d: false, strongSignalLast7d: false, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false },
```

Linha 39 (`buyingTermLast7d: true` dentro de um cenário com `advancedLast7d: true`) vira:

```js
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [5, 3, 8], lastOutboundReplied: [true, true, true, false, true], advancedLast7d: true, strongSignalLast7d: true, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false }
```

Linha 68 (`buyingTermLast7d: false`) vira:

```js
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [1], lastOutboundReplied: [true, true, true, true, true], advancedLast7d: true, strongSignalLast7d: false, weakSignalConfirmedLast7d: false, negativeSignalLast7d: false }
```

Adicionar 4 testes novos no mesmo arquivo (depois dos existentes), usando o helper `base()` que já existe no topo do arquivo (linha 7: `const base = () => ({ fit: ..., engagement: ..., ai: ... })`):

```js
test('intensity: forte sozinho vale 10 (sem avanco de etapa)', () => {
  const i = base()
  i.engagement.strongSignalLast7d = true
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 10)
})

test('intensity: fraco confirmado sozinho vale 5', () => {
  const i = base()
  i.engagement.weakSignalConfirmedLast7d = true
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 5)
})

test('intensity: negativo desconta 10, mesmo com forte confirmado (nao se cancelam escondido, o negativo domina quando e maior)', () => {
  const i = base()
  i.engagement.strongSignalLast7d = true
  i.engagement.negativeSignalLast7d = true
  const r = computeLeadScore(i)
  // forte (+10) com negativo (-10) juntos: intensity liquida 0, engagement so com os outros fatores (0 aqui)
  assert.equal(r.engagement, 0)
})

test('engagement nunca fica negativo mesmo com negativo isolado (piso 0)', () => {
  const i = base()
  i.engagement.negativeSignalLast7d = true
  const r = computeLeadScore(i)
  assert.ok(r.engagement >= 0, `engagement nao pode ser negativo, veio ${r.engagement}`)
  assert.equal(r.engagement, 0)
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/leadScoreCompute.test.js`
Expected: FAIL — `strongSignalLast7d`/etc. ainda não existem em `compute.js`.

- [ ] **Step 3: Implementar a mudança em `compute.js`**

Em `server/services/leadScore/compute.js`, dentro de `computeLeadScore`, trocar o bloco:

```js
  let intensity = 0
  if (e.advancedLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Avançou de etapa nos últimos 7 dias', pontos: 10 }) }
  else if (e.buyingTermLast7d) { intensity = 5; reasons.push({ grupo: 'engajamento', texto: 'Falou de preço, prazo ou pagamento nos últimos 7 dias', pontos: 5 }) }
  const engagement = Math.min(50, recency + speed + reciprocity + intensity)
```

por:

```js
  let intensity = 0
  if (e.advancedLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Avançou de etapa nos últimos 7 dias', pontos: 10 }) }
  else if (e.strongSignalLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Confirmou interesse forte na conversa (ex.: "quero comprar")', pontos: 10 }) }
  else if (e.weakSignalConfirmedLast7d) { intensity = 5; reasons.push({ grupo: 'engajamento', texto: 'Perguntou e continuou conversando depois', pontos: 5 }) }
  if (e.negativeSignalLast7d) { intensity -= 10; reasons.push({ grupo: 'engajamento', texto: 'Sinal negativo na conversa (ex.: "não quero", "caro demais")', pontos: -10 }) }
  const engagement = clamp(recency + speed + reciprocity + intensity, 0, 50)
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/leadScoreCompute.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suite inteira do leadScore**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/leadScore*.test.js test/scoreFilter.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/leadScore/compute.js test/leadScoreCompute.test.js
git commit -m "feat: formula do Termometro usa os niveis de sinal (forte/fraco/negativo) com piso 0 no engajamento"
```

---

### Task 7: Ligar o motor no webhook (inbound)

**Files:**
- Modify: `server/services/inboundHandler.js`
- Test: `test/signalsInboundHandler.test.js`

**Interfaces:**
- Consumes: `processInboundSignal` (Task 4).
- Produces: nenhuma interface nova — efeito colateral (grava sinal + pode avançar etapa) a cada mensagem inbound salva.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/signalsInboundHandler.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { configureStageMoveHooks } from '../server/services/stageMove.js'
import { createInboundHandler } from '../server/services/inboundHandler.js'
import { applyKeywordSignalsSchema } from '../server/services/signals/schema.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede nos testes') } })

function textPayload(text, idSuffix) {
  const p = JSON.parse(JSON.stringify(P.textConversation))
  p.data.message.conversation = text
  p.data.key.id = `3EB0SIGNAL${idSuffix}`
  return p
}

function setup() {
  const db = createTestDb()
  applyKeywordSignalsSchema(db)
  const seed = seedBasic(db)
  db.prepare('UPDATE funnel_stages SET strong_keywords = ? WHERE id = ?').run(JSON.stringify(['quero comprar']), seed.stage1)
  const intake = createLeadIntake({ db, pickFromRoulette: () => null, notifyAndOpenLead: () => Promise.resolve(), triggerCapiForStageChange: () => {} })
  configureStageMoveHooks({ onMoved: null })
  const handler = createInboundHandler({
    db,
    broadcastSSE: () => {},
    triggerCapiForStageChange: () => {},
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: () => Promise.resolve(),
    shouldSendAway: () => false,
    processInboundMessage: () => Promise.resolve(),
    scheduleAiForInbound: () => Promise.resolve(),
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: () => Promise.resolve(),
    sendOptOutConfirmation: () => Promise.resolve(),
  })
  const receive = (payload, opts = {}) => {
    const { messages } = adapter.parseWebhook(seed.instance, payload, {})
    assert.equal(messages.length, 1)
    return handler.handleInboundMessage(seed.account, seed.instance, messages[0], { source: 'webhook', ...opts })
  }
  return { db, seed, receive }
}

test('mensagem inbound que bate palavra forte grava sinal em lead_signals', async () => {
  const { db, receive } = setup()
  await receive(textPayload('quero comprar isso agora', '001'))
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.ok(row, 'deveria ter gravado uma linha em lead_signals')
  assert.equal(row.signal_type, 'strong')
})

test('mensagem outbound (fromMe, enviada pelo celular) nao gera sinal nem quebra', async () => {
  const { db, receive } = setup()
  await receive(P.outboundFromMe)
  const row = db.prepare('SELECT * FROM lead_signals').get()
  assert.equal(row, undefined, 'mensagem do proprio vendedor (fromMe) nao deve gerar sinal')
})
```

`P.outboundFromMe` é o fixture já existente em `test/fixtures/evolution-payloads.js` (usado por `test/inboundHandler.test.js:180`) — tem `key.fromMe: true` embutido no payload, por isso não precisa de nenhuma opção extra no `receive(...)`.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsInboundHandler.test.js`
Expected: FAIL — `lead_signals` vazia (o motor ainda não está plugado).

- [ ] **Step 3: Plugar o motor em `inboundHandler.js`**

No topo do arquivo, junto dos outros imports de serviço:

```js
import { processInboundSignal } from './signals/engine.js'
```

Logo depois da chamada existente a `onInboundSaved` (dentro do bloco `if (!fromMe) { try { onInboundSaved(...) } catch ... }`, por volta da linha 390), adicionar a chamada do motor novo **no mesmo bloco try/catch ou em um próprio** — usar um try/catch próprio pra um erro no motor de sinais nunca derrubar o salvamento da mensagem nem o roteiro:

```js
      if (!fromMe) {
        try {
          onInboundSaved({ db, account, lead, message: { id: Number(insertedMsg.lastInsertRowid), content, media_type: mediaType } })
        } catch (e) { console.error('[Roteiro] inbound:', e?.message) }
        try {
          const savedMsg = db.prepare('SELECT id, content, created_at FROM messages WHERE id = ?').get(insertedMsg.lastInsertRowid)
          processInboundSignal(db, { account, lead, message: savedMsg })
        } catch (e) { console.error('[Sinais] inbound:', e?.message) }
      }
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/signalsInboundHandler.test.js`
Expected: PASS

- [ ] **Step 5: Rodar a suite de webhook/inbound inteira pra garantir que nada quebrou**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx node --test test/inboundHandler.test.js test/inboundPolling.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/services/inboundHandler.js test/signalsInboundHandler.test.js
git commit -m "feat: liga o motor de sinais de palavra-chave no recebimento de mensagem (webhook)"
```

---

### Task 8: Backend — persistir as 4 listas por etapa

**Files:**
- Modify: `server/routes/funnels.js`
- Modify: `src/lib/api.ts` (interface `FunnelStage`)

**Interfaces:**
- Produces: `POST /api/funnels` e `PUT /api/funnels/:id/stages` passam a aceitar e persistir `trigger_keywords`, `weak_keywords`, `strong_keywords`, `negative_keywords` (arrays de string) em cada etapa, do mesmo jeito que `auto_keywords` já funciona.

- [ ] **Step 1: Atualizar `server/routes/funnels.js`**

Na rota `POST /` (linha ~29), trocar:

```js
    const stmt = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, auto_keywords, meta_event_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    stages.forEach((s, i) => {
      stmt.run(funnelId, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null)
    })
```

por:

```js
    const stmt = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, auto_keywords, meta_event_name, trigger_keywords, weak_keywords, strong_keywords, negative_keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    stages.forEach((s, i) => {
      stmt.run(funnelId, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null,
        s.trigger_keywords ? JSON.stringify(s.trigger_keywords) : null, s.weak_keywords ? JSON.stringify(s.weak_keywords) : null,
        s.strong_keywords ? JSON.stringify(s.strong_keywords) : null, s.negative_keywords ? JSON.stringify(s.negative_keywords) : null)
    })
```

Na rota `PUT /:id/stages` (linha ~93), trocar o `UPDATE`:

```js
        db.prepare('UPDATE funnel_stages SET name = ?, position = ?, color = ?, is_conversion = ?, is_terminal = ?, is_qualified = ?, is_meeting = ?, auto_keywords = ?, meta_event_name = ? WHERE id = ?').run(
          s.name, i, s.color || '#FFB300', isConversion, isTerminal, s.is_qualified ? 1 : 0, s.is_meeting ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null, s.id
        )
```

por:

```js
        db.prepare('UPDATE funnel_stages SET name = ?, position = ?, color = ?, is_conversion = ?, is_terminal = ?, is_qualified = ?, is_meeting = ?, auto_keywords = ?, meta_event_name = ?, trigger_keywords = ?, weak_keywords = ?, strong_keywords = ?, negative_keywords = ? WHERE id = ?').run(
          s.name, i, s.color || '#FFB300', isConversion, isTerminal, s.is_qualified ? 1 : 0, s.is_meeting ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null,
          s.trigger_keywords ? JSON.stringify(s.trigger_keywords) : null, s.weak_keywords ? JSON.stringify(s.weak_keywords) : null,
          s.strong_keywords ? JSON.stringify(s.strong_keywords) : null, s.negative_keywords ? JSON.stringify(s.negative_keywords) : null, s.id
        )
```

E o `INSERT` logo abaixo (linha ~97, etapa nova sem `s.id`):

```js
        db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, is_qualified, is_meeting, auto_keywords, meta_event_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          funnel.id, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.is_qualified ? 1 : 0, s.is_meeting ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null
        )
```

por:

```js
        db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, is_qualified, is_meeting, auto_keywords, meta_event_name, trigger_keywords, weak_keywords, strong_keywords, negative_keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          funnel.id, s.name, i, s.color || '#FFB300', s.is_conversion ? 1 : 0, s.is_terminal ? 1 : 0, s.is_qualified ? 1 : 0, s.is_meeting ? 1 : 0, s.auto_keywords ? JSON.stringify(s.auto_keywords) : null, s.meta_event_name || null,
          s.trigger_keywords ? JSON.stringify(s.trigger_keywords) : null, s.weak_keywords ? JSON.stringify(s.weak_keywords) : null,
          s.strong_keywords ? JSON.stringify(s.strong_keywords) : null, s.negative_keywords ? JSON.stringify(s.negative_keywords) : null
        )
```

- [ ] **Step 2: Atualizar a interface no front**

Em `src/lib/api.ts`, achar `export interface FunnelStage { ... auto_keywords: string | null; ... }` e adicionar os 4 campos novos:

```ts
export interface FunnelStage { id: number; funnel_id: number; name: string; position: number; color: string; is_conversion: number; is_terminal: number; is_qualified?: number; is_meeting?: number; auto_keywords: string | null; meta_event_name?: string | null; system_key?: string | null; trigger_keywords?: string | null; weak_keywords?: string | null; strong_keywords?: string | null; negative_keywords?: string | null }
```

- [ ] **Step 3: Rodar a suite inteira (garantir que nada quebrou nas rotas de funil)**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npm test`
Expected: PASS (não há teste HTTP dedicado pra `funnels.js` hoje — a garantia aqui é não ter quebrado nada mais; o `npx tsc --noEmit` do Task 9 cobre o tipo).

- [ ] **Step 4: Commit**

```bash
git add server/routes/funnels.js src/lib/api.ts
git commit -m "feat: persiste as listas de palavra-chave (gatilho/fraco/forte/negativo) por etapa do funil"
```

---

### Task 9: Frontend — editor das listas por etapa

**Files:**
- Modify: `src/pages/Funnels.tsx`

**Interfaces:**
- Consumes: os 4 campos novos de `FunnelStage` (Task 8).
- Produces: UI dentro do modal "Editar Etapas" pra editar as 4 listas, como texto separado por vírgula convertido pra array no `updateStage`.

- [ ] **Step 1: Adicionar os campos no modal de edição de etapa**

Em `src/pages/Funnels.tsx`, logo depois do bloco "Evento Meta" (depois da linha ~191, antes do `</div>` que fecha o card da etapa), adicionar:

```tsx
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 22, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: '#9B96B0' }}>Sinais de venda por palavra-chave (opcional, separe por vírgula):</span>
                    <input
                      className="input" style={{ fontSize: 11 }} placeholder="Gatilho do vendedor — ex: posso te mandar uma proposta"
                      value={(s.trigger_keywords ? JSON.parse(s.trigger_keywords) : []).join(', ')}
                      onChange={e => updateStage(i, 'trigger_keywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                    />
                    <input
                      className="input" style={{ fontSize: 11 }} placeholder="Resposta fraca do lead (só conta com gatilho) — ex: quanto custa, qual o valor"
                      value={(s.weak_keywords ? JSON.parse(s.weak_keywords) : []).join(', ')}
                      onChange={e => updateStage(i, 'weak_keywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                    />
                    <input
                      className="input" style={{ fontSize: 11 }} placeholder="Resposta forte do lead (vale sozinho) — ex: quero comprar, pode fechar"
                      value={(s.strong_keywords ? JSON.parse(s.strong_keywords) : []).join(', ')}
                      onChange={e => updateStage(i, 'strong_keywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                    />
                    <input
                      className="input" style={{ fontSize: 11 }} placeholder="Resposta negativa — ex: não quero, caro demais"
                      value={(s.negative_keywords ? JSON.parse(s.negative_keywords) : []).join(', ')}
                      onChange={e => updateStage(i, 'negative_keywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                    />
                  </div>
```

Nota: `s.trigger_keywords` etc. chegam do backend como string JSON (`'["a","b"]'`) ou `null` — o `JSON.parse` com fallback `[]` trata os dois casos. `updateStage` já aceita qualquer `value: any` (ver assinatura na linha 43), então passar o array direto funciona — o `JSON.stringify` acontece só na hora de salvar, dentro de `funnels.js` (Task 8), exatamente como `auto_keywords` já faz.

- [ ] **Step 2: Checar que compila**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx tsc --noEmit`
Expected: mesma contagem de erros antigos de antes desta tarefa (16, conhecidos — ver memória do projeto), nenhum erro NOVO introduzido por este arquivo.

- [ ] **Step 3: Testar no navegador (manual)**

Rodar `npm run dev` local, abrir Funis → Editar Etapas de um funil de teste, preencher as 4 listas de uma etapa, Salvar, reabrir o modal e confirmar que os valores persistiram.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Funnels.tsx
git commit -m "feat: UI das listas de palavra-chave (gatilho/fraco/forte/negativo) no editor de etapas"
```

---

### Task 10: Backend — configuração da janela de silêncio por conta

**Files:**
- Modify: `server/routes/accounts.js`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces:
  - `GET /api/accounts/:id/keyword-signals` (qualquer papel da própria conta, ou super_admin) → `{ keyword_signal_ghost_hours: number }`.
  - `PUT /api/accounts/:id/keyword-signals` (`gerente`/`super_admin`, só da própria conta) → valida inteiro 1-168, salva, devolve `{ keyword_signal_ghost_hours: number }`.
  - `fetchKeywordSignalSettings(accountId)` / `saveKeywordSignalSettings(accountId, hours)` em `src/lib/api.ts`.

- [ ] **Step 1: Adicionar as rotas em `server/routes/accounts.js`**

Logo depois da rota `/meta-capi` (depois da linha ~135, antes do comentário `// Teste de conexao Meta CAPI`), adicionar:

```js
// Janela de silencio dos Sinais de Venda por Palavra-chave (spec 2026-10-02 §4.3).
router.get('/:id/keyword-signals', (req, res) => {
  const accountId = parseInt(req.params.id)
  if (req.user.role !== 'super_admin' && req.user.account_id !== accountId) {
    return res.status(403).json({ error: 'Sem permissao' })
  }
  const row = db.prepare('SELECT keyword_signal_ghost_hours FROM accounts WHERE id = ?').get(accountId)
  if (!row) return res.status(404).json({ error: 'Conta nao encontrada' })
  res.json(row)
})

router.put('/:id/keyword-signals', requireRole('super_admin', 'gerente'), (req, res) => {
  const accountId = parseInt(req.params.id)
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  if (!account) return res.status(404).json({ error: 'Conta nao encontrada' })
  if (req.user.role === 'gerente' && req.user.account_id !== account.id) {
    return res.status(403).json({ error: 'Sem permissao' })
  }
  const hours = Number(req.body.keyword_signal_ghost_hours)
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    return res.status(400).json({ error: 'Janela deve ser um numero inteiro de 1 a 168 horas.' })
  }
  db.prepare("UPDATE accounts SET keyword_signal_ghost_hours = ?, updated_at = datetime('now') WHERE id = ?").run(hours, accountId)
  const updated = db.prepare('SELECT keyword_signal_ghost_hours FROM accounts WHERE id = ?').get(accountId)
  res.json(updated)
})
```

- [ ] **Step 2: Adicionar as funções no front**

Em `src/lib/api.ts`, perto de `fetchCustomerSettings`/`saveCustomerSettings`:

```ts
export const fetchKeywordSignalSettings = (accountId: number) =>
  apiFetch<{ keyword_signal_ghost_hours: number }>(`/api/accounts/${accountId}/keyword-signals`)
export const saveKeywordSignalSettings = (accountId: number, hours: number) =>
  apiFetch<{ keyword_signal_ghost_hours: number }>(`/api/accounts/${accountId}/keyword-signals`, { method: 'PUT', body: JSON.stringify({ keyword_signal_ghost_hours: hours }) })
```

- [ ] **Step 3: Rodar a suite inteira**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/routes/accounts.js src/lib/api.ts
git commit -m "feat: rota de configuracao da janela de silencio dos sinais de palavra-chave por conta"
```

---

### Task 11: Frontend — tela de configuração da janela de silêncio

**Files:**
- Create: `src/components/settings/SignalSettings.tsx`
- Modify: `src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `fetchKeywordSignalSettings`, `saveKeywordSignalSettings` (Task 10).
- Produces: componente `<SignalSettings accountId={number} />`, renderizado em `Settings.tsx` pra gerente/admin, igual ao `<CustomersSettings accountId={...} />` já é.

- [ ] **Step 1: Criar o componente**

Criar `src/components/settings/SignalSettings.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { fetchKeywordSignalSettings, saveKeywordSignalSettings } from '../../lib/api'
import { InlineNotice, useInlineNotice } from '../InlineNotice'

interface Props { accountId: number }

export default function SignalSettings({ accountId }: Props) {
  const [hours, setHours] = useState('24')
  const [saving, setSaving] = useState(false)
  const notice = useInlineNotice()

  useEffect(() => {
    fetchKeywordSignalSettings(accountId).then(r => setHours(String(r.keyword_signal_ghost_hours))).catch(() => {})
  }, [accountId])

  const save = async () => {
    const n = Number(hours)
    if (!Number.isInteger(n) || n < 1 || n > 168) {
      notice.showError('Valor invalido', new Error('Use um numero inteiro de 1 a 168 horas.'))
      return
    }
    setSaving(true)
    try {
      const r = await saveKeywordSignalSettings(accountId, n)
      setHours(String(r.keyword_signal_ghost_hours))
      notice.showSuccess('Configuracao salva.')
    } catch (e: any) {
      notice.showError('Erro ao salvar', e)
    }
    setSaving(false)
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <p style={{ fontSize: 11, color: '#9B96B0', marginBottom: 8 }}>
          Quando o lead pergunta algo (ex.: preço) e não manda mais nenhuma mensagem depois desse tempo, o sistema entende que ele sumiu e não conta esse sinal como interesse.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12 }}>Janela de silêncio (horas):</label>
          <input
            className="input" type="number" min={1} max={168} style={{ width: 80 }}
            value={hours} onChange={e => setHours(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
        <InlineNotice notice={notice.notice} onClose={notice.clear} />
      </div>
    </div>
  )
}
```

(Segue o mesmo padrão de `CustomersSettings.tsx`: o componente devolve um `<div>` solto com `card`s dentro — quem desenha a seção com título é `Settings.tsx`, não o componente. `useInlineNotice()` devolve `{ notice, showError, showSuccess, clear }`, e `InlineNotice` espera as props `{ notice, onClose, style? }` — ver `src/components/InlineNotice.tsx`.)

- [ ] **Step 2: Renderizar em `Settings.tsx`**

Em `src/pages/Settings.tsx`, importar e renderizar logo depois do bloco "Clientes e recompra" (linha ~286), no mesmo formato de seção e com a mesma condição de permissão:

```tsx
import SignalSettings from '../components/settings/SignalSettings'
```

```tsx
      {isGerenteOuAdmin && accountId && (
        <section className="dash-section">
          <div className="section-title">Sinais de venda por palavra-chave</div>
          <SignalSettings accountId={accountId} />
        </section>
      )}
```

- [ ] **Step 3: Checar que compila**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx tsc --noEmit`
Expected: mesma contagem de erros antigos de antes desta tarefa, nenhum erro novo.

- [ ] **Step 4: Testar no navegador (manual)**

`npm run dev`, entrar em Configurações como gerente/admin, ver o card "Sinais de venda por palavra-chave", mudar o valor, salvar, recarregar a página e confirmar que persistiu.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SignalSettings.tsx src/pages/Settings.tsx
git commit -m "feat: tela de configuracao da janela de silencio dos sinais de palavra-chave"
```

---

### Task 12: Revisão final — suite inteira, build e checagem de tipos

**Files:** nenhum arquivo novo — só validação.

- [ ] **Step 1: Suite de testes completa**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npm test`
Expected: PASS, 100% (nenhuma regressão nos ~1139 testes existentes + os novos desta feature).

- [ ] **Step 2: Checagem de tipos**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npx tsc --noEmit`
Expected: mesma contagem de erros antigos (16, conhecidos, anteriores a esta feature) — nenhum erro novo.

- [ ] **Step 3: Build de produção**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && npm run build`
Expected: build conclui sem erro (aviso de chunk grande é esperado e pré-existente).

- [ ] **Step 4: Conferir que nada ficou órfão**

Run: `grep -rn "buyingTermLast7d\|hasBuyingTerm\|BUYING_TERMS" server/ src/ test/`
Expected: nenhum resultado (tudo foi removido na Task 5).

- [ ] **Step 5: Commit final (se sobrar algo solto, ex. CODEBASE_INDEX.md desatualizado)**

Se o projeto mantiver `CODEBASE_INDEX.md` manualmente (conferir se existe e se outras features o atualizaram em commits recentes de `git log --oneline -- CODEBASE_INDEX.md`), atualizar com os arquivos novos de `server/services/signals/`. Se for gerado automaticamente, pular este passo.

```bash
git add -A
git commit -m "chore: revisao final dos sinais de venda por palavra-chave"
```

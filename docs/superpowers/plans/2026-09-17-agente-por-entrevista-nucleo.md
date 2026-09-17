# Agente de IA por entrevista — Plano 1 (núcleo)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o formulário de 8 abas por uma entrevista conversacional em que a IA pergunta, a pessoa responde em linguagem natural, e a própria IA escreve os campos do agente.

**Architecture:** Três peças novas com uma responsabilidade cada — o entrevistador conduz a conversa, os enriquecedores trazem contexto extra pela mesma interface, o compilador transforma o briefing nos campos do `ai_agents`. O briefing fica salvo (transcrição + fontes), e é ele que faz "Corrigir algo" funcionar conversando em vez de editar campo.

**Tech Stack:** Node 20 local / Node 16 na VPS, ESM, Express 4, better-sqlite3, `node --test`, React 19 + Vite 4, `callHaiku` (Claude Haiku 4.5) via `node-fetch`.

**Spec:** `docs/superpowers/specs/2026-09-17-agente-por-entrevista-design.md` (commit `a15afd4`)

**Branch:** `feat/copiloto-agente-ia`

## Global Constraints

- **Multi-tenant:** toda query filtra por `account_id`. Convenção do `CLAUDE.md`, sem exceção.
- **Versões travadas por Node 16 + CentOS 7:** não subir vite (^4.5.5), better-sqlite3 (^10.1.0), express (^4.21.0), @vitejs/plugin-react (^4.2.1). Nenhuma dependência npm nova neste plano.
- **Commits em português**, prefixo `feat:` / `fix:` / `refactor:` / `test:`. Sem emoji em código.
- **Sem acento em identificador, nome de arquivo, comentário de código e mensagem de commit** — o repositório usa ASCII nessas posições (ver `copilotSchema.js`). Texto que a pessoa lê na tela é PT-BR com acento normal.
- **Nenhuma chamada real de IA em teste.** O cliente de IA é sempre injetado; os testes passam um fake.
- **A entrevista e a compilação usam sempre `ANTHROPIC_API_KEY_DROS`**, ignorando `accounts.ai_key_source`. O atendimento do dia a dia não muda.
- **Regra de segurança inviolável:** nenhuma linha em `ai_agents` até a pessoa clicar em "Ativar". Qualquer agente com `is_active = 1` é varrido pelo `processInboundMessage` e começa a responder lead de verdade.
- **Teto do briefing:** 60.000 tokens e 20 perguntas da IA. Ao bater qualquer um, encerra compilando.
- Rodar a suíte inteira (`npm test`) antes de cada commit; ela está em 223 testes passando e não pode regredir.

---

### Task 1: Schema das três tabelas

**Files:**
- Create: `server/services/agentBriefingSchema.js`
- Modify: `server/db.js` (import no topo, chamada no fim junto de `applyCopilotSchema(db)` na linha 1429)
- Modify: `test/helpers/memoryDb.js` (aplicar o schema novo e acrescentar `ai_agent_token_log`, que as tasks 2 e 7 precisam)
- Test: `test/agentBriefingSchema.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `applyAgentBriefingSchema(db)` — cria `agent_briefings`, `agent_briefing_turns`, `agent_briefing_sources` e seus índices. Idempotente.

- [ ] **Step 1: Write the failing test**

Create `test/agentBriefingSchema.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { applyAgentBriefingSchema } from '../server/services/agentBriefingSchema.js'

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}

test('cria as tres tabelas com as colunas do spec', () => {
  const db = createTestDb()
  assert.deepEqual(columns(db, 'agent_briefings'),
    ['id', 'account_id', 'agent_id', 'status', 'compiled_json', 'created_by', 'created_at', 'updated_at'])
  assert.deepEqual(columns(db, 'agent_briefing_turns'),
    ['id', 'briefing_id', 'position', 'role', 'content', 'created_at'])
  assert.deepEqual(columns(db, 'agent_briefing_sources'),
    ['id', 'briefing_id', 'kind', 'ref', 'content', 'status', 'error', 'created_at'])
})

test('briefing nasce como rascunho sem agente', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const id = db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId).lastInsertRowid
  const row = db.prepare('SELECT status, agent_id FROM agent_briefings WHERE id = ?').get(id)
  assert.equal(row.status, 'entrevistando')
  assert.equal(row.agent_id, null)
})

test('status so aceita os tres valores do spec', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  assert.throws(
    () => db.prepare("INSERT INTO agent_briefings (account_id, created_by, status) VALUES (?, ?, 'sei la')").run(accountId, userId),
    /CHECK constraint failed/
  )
})

test('apagar o briefing leva turnos e fontes junto', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const bid = db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId).lastInsertRowid
  db.prepare("INSERT INTO agent_briefing_turns (briefing_id, position, role, content) VALUES (?, 1, 'ia', 'oi')").run(bid)
  db.prepare("INSERT INTO agent_briefing_sources (briefing_id, kind, content) VALUES (?, 'entrevista', 'texto')").run(bid)
  db.prepare('DELETE FROM agent_briefings WHERE id = ?').run(bid)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefing_turns').get().c, 0)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefing_sources').get().c, 0)
})

test('so pode haver um briefing por agente', () => {
  const db = createTestDb()
  const { accountId, userId, agentId } = seedAccountAndLead(db)
  db.prepare("INSERT INTO agent_briefings (account_id, agent_id, created_by, status) VALUES (?, ?, ?, 'ativo')").run(accountId, agentId, userId)
  assert.throws(
    () => db.prepare("INSERT INTO agent_briefings (account_id, agent_id, created_by, status) VALUES (?, ?, ?, 'ativo')").run(accountId, agentId, userId),
    /UNIQUE constraint failed/
  )
})

test('varios rascunhos sem agente convivem (agent_id nulo nao colide no indice unico)', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId)
  db.prepare('INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)').run(accountId, userId)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefings').get().c, 2)
})

test('aplicar o schema duas vezes nao quebra', () => {
  const db = createTestDb()
  applyAgentBriefingSchema(db)
  applyAgentBriefingSchema(db)
  assert.ok(columns(db, 'agent_briefings').includes('compiled_json'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agentBriefingSchema.test.js`
Expected: FAIL — `Cannot find module '../server/services/agentBriefingSchema.js'`

- [ ] **Step 3: Write the schema module**

Create `server/services/agentBriefingSchema.js`:

```js
// Schema do agente por entrevista (bloco 6). Recebe o db por parametro para ser
// testavel em memoria. Segue o padrao de copilotSchema.js: CREATE TABLE IF NOT EXISTS.

export function applyAgentBriefingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_briefings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id    INTEGER NOT NULL,
      agent_id      INTEGER,
      status        TEXT NOT NULL DEFAULT 'entrevistando'
                      CHECK (status IN ('entrevistando', 'compilado', 'ativo')),
      compiled_json TEXT,
      created_by    INTEGER,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_briefing_turns (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      briefing_id INTEGER NOT NULL,
      position    INTEGER NOT NULL,
      role        TEXT NOT NULL CHECK (role IN ('ia', 'user')),
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (briefing_id) REFERENCES agent_briefings(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_briefing_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      briefing_id INTEGER NOT NULL,
      kind        TEXT NOT NULL
                    CHECK (kind IN ('entrevista', 'site', 'conversas', 'colado')),
      ref         TEXT,
      content     TEXT,
      status      TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'falhou')),
      error       TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (briefing_id) REFERENCES agent_briefings(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_agent_briefings_conta ON agent_briefings(account_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_briefings_agente
      ON agent_briefings(agent_id) WHERE agent_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_agent_briefing_turns_ordem
      ON agent_briefing_turns(briefing_id, position);
    CREATE INDEX IF NOT EXISTS idx_agent_briefing_sources_briefing
      ON agent_briefing_sources(briefing_id);
  `)
}
```

- [ ] **Step 4: Wire the schema into the real boot and into the test helper**

In `server/db.js`, add next to the other schema import at the top (line 6 area):

```js
import { applyAgentBriefingSchema } from './services/agentBriefingSchema.js'
```

and immediately after the existing `applyCopilotSchema(db)` call (line 1429):

```js
applyAgentBriefingSchema(db)
```

In `test/helpers/memoryDb.js`, add the import next to the existing one:

```js
import { applyAgentBriefingSchema } from '../../server/services/agentBriefingSchema.js'
```

Inside `createTestDb`, add `ai_agent_token_log` to the `db.exec` block (the real one lives in `server/db.js`; tasks 2 and 7 need it in memory) — put it right after the `lead_notes` table:

```js
    CREATE TABLE ai_agent_token_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER,
      account_id INTEGER NOT NULL,
      lead_id INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
```

and after `applyCopilotSchema(db)` add:

```js
  applyAgentBriefingSchema(db)
```

**Foreign keys:** o `better-sqlite3` não liga `PRAGMA foreign_keys` sozinho. O teste de cascata acima depende dele. Acrescente `db.pragma('foreign_keys = ON')` logo depois do `new Database(':memory:')` em `createTestDb`. O banco real já liga isso em `server/db.js` — confirme com `grep -n "foreign_keys" server/db.js` e, se não houver, **pare e avise**: ligar no banco real é mudança de comportamento fora do escopo desta task.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/agentBriefingSchema.test.js`
Expected: PASS, 7 testes.

Run: `npm test`
Expected: PASS, 230 testes (223 + 7), 0 falhas.

- [ ] **Step 6: Commit**

```bash
git add server/services/agentBriefingSchema.js server/db.js test/helpers/memoryDb.js test/agentBriefingSchema.test.js
git commit -m "feat: schema do briefing do agente por entrevista"
```

---

### Task 2: Cliente de IA da Dros com registro de custo

**Files:**
- Create: `server/services/drosAi.js`
- Test: `test/drosAi.test.js`

**Interfaces:**
- Consumes: `applyAgentBriefingSchema` (task 1), `callHaiku` de `server/services/anthropicClient.js`.
- Produces:
  - `resolveDrosKey(env = process.env)` -> `string | null`
  - `createDrosAi(db, { accountId, callAi = callHaiku, env = process.env })` -> `{ ask(params), tokensUsed() }`
    - `ask({ systemPrompt, messages, maxTokens })` -> mesma forma de retorno do `callHaiku`; grava em `ai_agent_token_log` com `agent_id = NULL` e o `source` recebido.
    - `tokensUsed()` -> soma dos `usage.total` de todas as chamadas desta instância.

Esta é a peça que garante duas constraints globais de uma vez: a chave é sempre a da Dros, e o custo cai no log que já existe.

- [ ] **Step 1: Write the failing test**

Create `test/drosAi.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { resolveDrosKey, createDrosAi } from '../server/services/drosAi.js'

// Fake do callHaiku: devolve sempre a mesma resposta e registra como foi chamado.
function fakeCallAi(reply = 'ok', usage = { input: 10, output: 5, cacheRead: 0, cacheCreation: 0, total: 15 }) {
  const calls = []
  return {
    calls,
    fn: async (params) => {
      calls.push(params)
      return { content: reply, toolUses: [], usage, costUsd: 0.000025, stopReason: 'end_turn', raw: {} }
    },
  }
}

test('resolveDrosKey le ANTHROPIC_API_KEY_DROS e ignora a chave da conta', () => {
  assert.equal(resolveDrosKey({ ANTHROPIC_API_KEY_DROS: 'sk-dros' }), 'sk-dros')
  assert.equal(resolveDrosKey({ ANTHROPIC_API_KEY_DROS: '   ' }), null)
  assert.equal(resolveDrosKey({}), null)
})

test('ask usa a chave da Dros mesmo com a conta em ai_key_source client', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  db.prepare("UPDATE accounts SET anthropic_api_key = 'sk-do-cliente', ai_key_source = 'client' WHERE id = ?").run(accountId)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  await ai.ask({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'oi' }], source: 'entrevista' })

  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].apiKey, 'sk-dros', 'tem que mandar a chave da Dros explicita')
  assert.equal(fake.calls[0].accountId, null, 'nao pode deixar o callHaiku resolver pela conta')
})

test('ask grava o custo em ai_agent_token_log com agent_id nulo e o source dado', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  await ai.ask({ systemPrompt: 'sys', messages: [{ role: 'user', content: 'oi' }], source: 'entrevista' })

  const row = db.prepare('SELECT * FROM ai_agent_token_log WHERE account_id = ?').get(accountId)
  assert.equal(row.agent_id, null)
  assert.equal(row.source, 'entrevista')
  assert.equal(row.input_tokens, 10)
  assert.equal(row.output_tokens, 5)
  assert.equal(row.lead_id, null)
})

test('tokensUsed soma o total de todas as chamadas', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: { ANTHROPIC_API_KEY_DROS: 'sk-dros' } })

  assert.equal(ai.tokensUsed(), 0)
  await ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' })
  await ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' })
  assert.equal(ai.tokensUsed(), 30)
})

test('sem a chave da Dros, ask falha com erro nomeado e nao chama a IA', async () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const fake = fakeCallAi()
  const ai = createDrosAi(db, { accountId, callAi: fake.fn, env: {} })

  await assert.rejects(
    () => ai.ask({ systemPrompt: 's', messages: [], source: 'entrevista' }),
    /dros_key_missing/
  )
  assert.equal(fake.calls.length, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/drosAi.test.js`
Expected: FAIL — `Cannot find module '../server/services/drosAi.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/drosAi.js`:

```js
// Cliente de IA da entrevista e da compilacao. Usa SEMPRE a chave central da Dros
// (ANTHROPIC_API_KEY_DROS), ignorando accounts.ai_key_source: a conta do cliente
// normalmente ainda nao tem chave quando o primeiro agente e criado.
// O custo cai no ai_agent_token_log que ja existe, com agent_id NULL.

import { callHaiku } from './anthropicClient.js'

export function resolveDrosKey(env = process.env) {
  const key = String((env && env.ANTHROPIC_API_KEY_DROS) || '').trim()
  return key || null
}

export function createDrosAi(db, { accountId, callAi = callHaiku, env = process.env }) {
  let total = 0

  async function ask({ systemPrompt, messages, maxTokens = 600, source }) {
    const key = resolveDrosKey(env)
    if (!key) throw new Error('dros_key_missing')

    const r = await callAi({
      systemPrompt,
      messages,
      maxTokens,
      apiKey: key,
      accountId: null, // explicito: o callHaiku nao deve resolver chave pela conta
    })

    const u = r.usage || {}
    total += u.total || 0
    db.prepare(`
      INSERT INTO ai_agent_token_log
        (agent_id, account_id, lead_id, input_tokens, output_tokens,
         cache_read_tokens, cache_creation_tokens, cost_usd, source)
      VALUES (NULL, ?, NULL, ?, ?, ?, ?, ?, ?)
    `).run(accountId, u.input || 0, u.output || 0, u.cacheRead || 0, u.cacheCreation || 0, r.costUsd || 0, source)

    return r
  }

  return { ask, tokensUsed: () => total }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/drosAi.test.js`
Expected: PASS, 5 testes.

Run: `npm test`
Expected: PASS, 235 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/drosAi.js test/drosAi.test.js
git commit -m "feat: cliente de IA da Dros para entrevista com registro de custo"
```

---

### Task 3: Armazenamento do briefing

**Files:**
- Create: `server/services/briefingStore.js`
- Test: `test/briefingStore.test.js`

**Interfaces:**
- Consumes: schema da task 1.
- Produces (todas recebem `db` e filtram por `accountId`):
  - `createBriefing(db, { accountId, userId })` -> `number` (id)
  - `addTurn(db, { accountId, briefingId, role, content })` -> `number` (position gravada) | `null` (briefing nao e da conta)
  - `addSource(db, { accountId, briefingId, kind, ref = null, content = null, status = 'ok', error = null })` -> `number` (id) | `null` (briefing nao e da conta)
  - `getBriefing(db, accountId, briefingId)` -> `{ ...linha, turns: [], sources: [] } | null`
  - `listDrafts(db, accountId)` -> `[{ id, status, created_at, updated_at, first_answer }]`
  - `setCompiled(db, { accountId, briefingId, compiled })` -> `boolean`
  - `linkAgent(db, { accountId, briefingId, agentId })` -> `boolean` (marca `ativo`)
  - `deleteBriefing(db, accountId, briefingId)` -> `boolean`

`addTurn` calcula a `position` sozinha (último + 1) para o chamador nunca precisar contar.

- [ ] **Step 1: Write the failing test**

Create `test/briefingStore.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  createBriefing, addTurn, addSource, getBriefing,
  listDrafts, setCompiled, linkAgent, deleteBriefing,
} from '../server/services/briefingStore.js'

function setup() {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  return { db, ...seed }
}

test('createBriefing devolve um rascunho sem agente', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'entrevistando')
  assert.equal(b.agent_id, null)
  assert.deepEqual(b.turns, [])
  assert.deepEqual(b.sources, [])
})

test('addTurn numera a posicao sozinho e getBriefing devolve na ordem', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'ia', content: 'O que voce vende?' }), 1)
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'user', content: 'imoveis' }), 2)
  assert.equal(addTurn(db, { accountId, briefingId: id, role: 'ia', content: 'Compra ou aluguel?' }), 3)
  const turns = getBriefing(db, accountId, id).turns
  assert.deepEqual(turns.map(t => t.position), [1, 2, 3])
  assert.deepEqual(turns.map(t => t.role), ['ia', 'user', 'ia'])
  assert.equal(turns[2].content, 'Compra ou aluguel?')
})

test('addSource guarda fonte que deu certo e fonte que falhou', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  addSource(db, { accountId, briefingId: id, kind: 'colado', content: 'tabela de precos' })
  addSource(db, { accountId, briefingId: id, kind: 'site', ref: 'https://x.com', status: 'falhou', error: 'timeout' })
  const sources = getBriefing(db, accountId, id).sources
  assert.equal(sources.length, 2)
  assert.equal(sources[0].status, 'ok')
  assert.equal(sources[1].status, 'falhou')
  assert.equal(sources[1].error, 'timeout')
  assert.equal(sources[1].ref, 'https://x.com')
})

test('getBriefing nao devolve briefing de outra conta', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(getBriefing(db, outra, id), null)
})

test('listDrafts traz so o que nao esta ativo, com a primeira resposta como rotulo', () => {
  const { db, accountId, userId, agentId } = setup()
  const rascunho = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId: rascunho, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId: rascunho, role: 'user', content: 'curso de ingles' })

  const ativo = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId: ativo, compiled: { name: 'X' } })
  linkAgent(db, { accountId, briefingId: ativo, agentId })

  const drafts = listDrafts(db, accountId)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0].id, rascunho)
  assert.equal(drafts[0].first_answer, 'curso de ingles')
})

test('setCompiled guarda o json e muda o status, sem criar agente', () => {
  const { db, accountId, userId } = setup()
  const id = createBriefing(db, { accountId, userId })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  assert.equal(setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Ana', persona: 'direta' } }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'compilado')
  assert.equal(b.agent_id, null)
  assert.equal(JSON.parse(b.compiled_json).persona, 'direta')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes, 'compilar NAO pode criar agente')
})

test('setCompiled de outra conta nao faz nada', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(setCompiled(db, { accountId: outra, briefingId: id, compiled: { name: 'X' } }), false)
  assert.equal(getBriefing(db, accountId, id).status, 'entrevistando')
})

test('recompilar briefing ja ativo atualiza o json mas NAO volta para compilado', () => {
  const { db, accountId, userId, agentId } = setup()
  const id = createBriefing(db, { accountId, userId })
  setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Antes' } })
  linkAgent(db, { accountId, briefingId: id, agentId })

  assert.equal(setCompiled(db, { accountId, briefingId: id, compiled: { name: 'Depois' } }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'ativo', 'sair de ativo faria a ativacao criar um SEGUNDO agente')
  assert.equal(b.agent_id, agentId)
  assert.equal(JSON.parse(b.compiled_json).name, 'Depois')
})

test('linkAgent amarra o agente e marca ativo', () => {
  const { db, accountId, userId, agentId } = setup()
  const id = createBriefing(db, { accountId, userId })
  assert.equal(linkAgent(db, { accountId, briefingId: id, agentId }), true)
  const b = getBriefing(db, accountId, id)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, agentId)
})

test('deleteBriefing apaga e nao apaga o de outra conta', () => {
  const { db, accountId, userId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const id = createBriefing(db, { accountId, userId })
  assert.equal(deleteBriefing(db, outra, id), false)
  assert.equal(deleteBriefing(db, accountId, id), true)
  assert.equal(getBriefing(db, accountId, id), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/briefingStore.test.js`
Expected: FAIL — `Cannot find module '../server/services/briefingStore.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/briefingStore.js`:

```js
// Leitura e escrita do briefing do agente. Recebe o db por parametro.
// Toda funcao que le ou muda um briefing filtra por account_id.

const BRIEFING_COLUMNS = 'id, account_id, agent_id, status, compiled_json, created_by, created_at, updated_at'

export function createBriefing(db, { accountId, userId }) {
  return Number(db.prepare(
    'INSERT INTO agent_briefings (account_id, created_by) VALUES (?, ?)'
  ).run(accountId, userId || null).lastInsertRowid)
}

export function addTurn(db, { accountId, briefingId, role, content }) {
  const insert = db.transaction(() => {
    const last = db.prepare('SELECT MAX(position) AS p FROM agent_briefing_turns WHERE briefing_id = ?').get(briefingId)
    const position = (last && last.p ? last.p : 0) + 1
    db.prepare(
      'INSERT INTO agent_briefing_turns (briefing_id, position, role, content) VALUES (?, ?, ?, ?)'
    ).run(briefingId, position, role, String(content))
    db.prepare("UPDATE agent_briefings SET updated_at = datetime('now') WHERE id = ?").run(briefingId)
    return position
  })
  return insert()
}

export function addSource(db, { accountId, briefingId, kind, ref = null, content = null, status = 'ok', error = null }) {
  const id = db.prepare(
    'INSERT INTO agent_briefing_sources (briefing_id, kind, ref, content, status, error) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(briefingId, kind, ref, content, status, error).lastInsertRowid
  db.prepare("UPDATE agent_briefings SET updated_at = datetime('now') WHERE id = ?").run(briefingId)
  return Number(id)
}

export function getBriefing(db, accountId, briefingId) {
  const row = db.prepare(
    `SELECT ${BRIEFING_COLUMNS} FROM agent_briefings WHERE id = ? AND account_id = ?`
  ).get(briefingId, accountId)
  if (!row) return null
  row.turns = db.prepare(
    'SELECT id, position, role, content, created_at FROM agent_briefing_turns WHERE briefing_id = ? ORDER BY position'
  ).all(briefingId)
  row.sources = db.prepare(
    'SELECT id, kind, ref, content, status, error, created_at FROM agent_briefing_sources WHERE briefing_id = ? ORDER BY id'
  ).all(briefingId)
  return row
}

export function listDrafts(db, accountId) {
  return db.prepare(`
    SELECT b.id, b.status, b.created_at, b.updated_at,
           (SELECT t.content FROM agent_briefing_turns t
             WHERE t.briefing_id = b.id AND t.role = 'user'
             ORDER BY t.position LIMIT 1) AS first_answer
      FROM agent_briefings b
     WHERE b.account_id = ? AND b.status != 'ativo'
     ORDER BY b.updated_at DESC
  `).all(accountId)
}

export function setCompiled(db, { accountId, briefingId, compiled }) {
  // Briefing que ja esta ativo continua ativo: rebaixar para 'compilado' faria a
  // ativacao criar um SEGUNDO agente e deixar o primeiro orfao.
  const r = db.prepare(`
    UPDATE agent_briefings
       SET compiled_json = ?,
           status = CASE WHEN status = 'ativo' THEN 'ativo' ELSE 'compilado' END,
           updated_at = datetime('now')
     WHERE id = ? AND account_id = ?
  `).run(JSON.stringify(compiled), briefingId, accountId)
  return r.changes > 0
}

export function linkAgent(db, { accountId, briefingId, agentId }) {
  const r = db.prepare(`
    UPDATE agent_briefings
       SET agent_id = ?, status = 'ativo', updated_at = datetime('now')
     WHERE id = ? AND account_id = ?
  `).run(agentId, briefingId, accountId)
  return r.changes > 0
}

export function deleteBriefing(db, accountId, briefingId) {
  return db.prepare('DELETE FROM agent_briefings WHERE id = ? AND account_id = ?')
    .run(briefingId, accountId).changes > 0
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/briefingStore.test.js`
Expected: PASS, 10 testes.

Run: `npm test`
Expected: PASS, 245 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/briefingStore.js test/briefingStore.test.js
git commit -m "feat: armazenamento do briefing com transcricao e fontes"
```

---

### Task 4: Fonte "texto colado"

**Files:**
- Create: `server/services/briefingSources/pastedText.js`
- Test: `test/briefingSourcePastedText.test.js`

**Interfaces:**
- Consumes: `addSource` (task 3).
- Produces: `collectPastedText(db, { accountId, briefingId, text })` -> `{ ok: boolean, id?: number, error?: string }`

Esta é a fonte mais simples de todas e existe para **fixar a interface** que `website.js` e `crmHistory.js` vão implementar no Plano 2: toda fonte recebe o `db` e o `briefingId`, grava em `agent_briefing_sources` e devolve `{ ok }` — nunca lança, para que uma fonte quebrada não derrube a entrevista.

- [ ] **Step 1: Write the failing test**

Create `test/briefingSourcePastedText.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing } from '../server/services/briefingStore.js'
import { collectPastedText, MAX_PASTED_CHARS } from '../server/services/briefingSources/pastedText.js'

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  return { db, accountId, briefingId }
}

test('guarda o texto colado como fonte ok', () => {
  const { db, accountId, briefingId } = setup()
  const r = collectPastedText(db, { accountId, briefingId, text: 'Tabela de precos: plano A R$ 500' })
  assert.equal(r.ok, true)
  const sources = getBriefing(db, accountId, briefingId).sources
  assert.equal(sources.length, 1)
  assert.equal(sources[0].kind, 'colado')
  assert.equal(sources[0].status, 'ok')
  assert.match(sources[0].content, /plano A/)
})

test('texto vazio ou so espaco nao vira fonte', () => {
  const { db, accountId, briefingId } = setup()
  assert.equal(collectPastedText(db, { accountId, briefingId, text: '   ' }).ok, false)
  assert.equal(collectPastedText(db, { accountId, briefingId, text: '' }).ok, false)
  assert.equal(collectPastedText(db, { accountId, briefingId, text: null }).ok, false)
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})

test('texto gigante e cortado no teto, nao rejeitado', () => {
  const { db, accountId, briefingId } = setup()
  const r = collectPastedText(db, { accountId, briefingId, text: 'a'.repeat(MAX_PASTED_CHARS + 5000) })
  assert.equal(r.ok, true)
  const s = getBriefing(db, accountId, briefingId).sources[0]
  assert.equal(s.content.length, MAX_PASTED_CHARS)
  assert.equal(s.status, 'ok')
})

test('erro inesperado vira fonte falhou e nao lanca', () => {
  const { db, accountId, briefingId } = setup()
  // briefing inexistente (ou de outra conta) -> addSource devolve null, a fonte nao grava, e nao lanca
  const r = collectPastedText(db, { accountId, briefingId: 999999, text: 'texto' })
  assert.equal(r.ok, false)
  assert.ok(r.error, 'tem que dizer o motivo')
  assert.equal(getBriefing(db, accountId, briefingId).sources.length, 0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/briefingSourcePastedText.test.js`
Expected: FAIL — `Cannot find module '../server/services/briefingSources/pastedText.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/briefingSources/pastedText.js`:

```js
// Fonte "texto colado": material que a pessoa cola na entrevista (apresentacao,
// tabela de precos, FAQ). Fonte NUNCA lanca: devolve { ok:false } para que uma
// fonte quebrada nao derrube a entrevista.

import { addSource } from '../briefingStore.js'

export const MAX_PASTED_CHARS = 20000

export function collectPastedText(db, { accountId, briefingId, text }) {
  // O try envolve TAMBEM a normalizacao: uma entrada cujo toString/valueOf
  // lance nao pode escapar como excecao e derrubar a entrevista inteira.
  try {
    const clean = String(text == null ? '' : text).trim()
    if (!clean) return { ok: false, error: 'texto_vazio' }

    const id = addSource(db, {
      accountId,
      briefingId,
      kind: 'colado',
      content: clean.slice(0, MAX_PASTED_CHARS),
    })
    if (id === null) return { ok: false, error: 'briefing_nao_encontrado' }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/briefingSourcePastedText.test.js`
Expected: PASS, 4 testes.

Run: `npm test`
Expected: PASS, 249 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/briefingSources/pastedText.js test/briefingSourcePastedText.test.js
git commit -m "feat: fonte de briefing por texto colado"
```

---

### Task 5: Compilador do briefing

**Files:**
- Create: `server/services/agentCompiler.js`
- Test: `test/agentCompiler.test.js`

**Interfaces:**
- Consumes: `getBriefing` (task 3), um objeto `ai` com `.ask()` (task 2).
- Produces:
  - `REQUIRED_FIELD_KEYS` -> `['name','email','phone','city','empresa','instagram']` (as mesmas chaves de `AgentEditorModal.tsx:14`)
  - `validateCompiled(raw)` -> `{ ok: true, value } | { ok: false, error }`
  - `compileBriefing(db, { accountId, briefingId, ai })` -> `Promise<{ ok: true, compiled } | { ok: false, error }>`

Forma do compilado (é o que a task 8 grava em `ai_agents` e a task 11 mostra na tela):

```js
{
  name: 'Ana Clara',
  persona: 'Cordial, objetiva, PT-BR informal.',
  knowledge_base: 'A empresa vende ...',
  never_mention: 'preco, prazo exato',
  qualification_criteria: 'Qualificado quando souber nome e cidade',
  required_fields: ['name', 'city'],
  resumo: {
    quem_sou: 'Consultora da sua agencia, direta.',
    o_que_sei: 'Voces fazem gestao de trafego para clinicas.',
    o_que_descubro: ['Se tem clinica propria', 'Quanto ja investe por mes'],
    o_que_nunca_falo: ['Preco (so o vendedor fala)'],
  },
}
```

O compilador **tenta uma vez de novo** quando a saída é inválida (constraint do spec), e nunca devolve `ok: true` com formato errado.

- [ ] **Step 1: Write the failing test**

Create `test/agentCompiler.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, addTurn, addSource } from '../server/services/briefingStore.js'
import { compileBriefing, validateCompiled, REQUIRED_FIELD_KEYS } from '../server/services/agentCompiler.js'

const VALIDO = {
  name: 'Ana Clara',
  persona: 'Cordial e objetiva.',
  knowledge_base: 'Vende curso de ingles online.',
  never_mention: 'preco',
  qualification_criteria: 'Qualificado quando souber nome e cidade',
  required_fields: ['name', 'city'],
  resumo: {
    quem_sou: 'Consultora do curso.',
    o_que_sei: 'Curso de ingles online.',
    o_que_descubro: ['Nivel do aluno'],
    o_que_nunca_falo: ['Preco'],
  },
}

// Fake do drosAi: devolve as respostas na ordem em que foram programadas.
function fakeAi(...replies) {
  const calls = []
  let i = 0
  return {
    calls,
    ask: async (params) => {
      calls.push(params)
      const r = replies[Math.min(i, replies.length - 1)]
      i++
      return { content: typeof r === 'string' ? r : JSON.stringify(r), usage: { total: 10 }, costUsd: 0 }
    },
  }
}

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles online' })
  addSource(db, { accountId, briefingId, kind: 'colado', content: 'ementa do curso' })
  return { db, accountId, briefingId }
}

test('REQUIRED_FIELD_KEYS bate com as opcoes do formulario', () => {
  assert.deepEqual(REQUIRED_FIELD_KEYS, ['name', 'email', 'phone', 'city', 'empresa', 'instagram'])
})

test('validateCompiled aceita a forma do spec', () => {
  const r = validateCompiled(VALIDO)
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'Ana Clara')
})

test('validateCompiled recusa campo faltando, tipo errado e required_field invalido', () => {
  assert.equal(validateCompiled({ ...VALIDO, name: '' }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, persona: 123 }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, required_fields: ['cpf'] }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, resumo: undefined }).ok, false)
  assert.equal(validateCompiled({ ...VALIDO, resumo: { ...VALIDO.resumo, o_que_descubro: 'texto' } }).ok, false)
  assert.equal(validateCompiled(null).ok, false)
  assert.equal(validateCompiled('nao sou objeto').ok, false)
})

test('compila o briefing e manda transcricao e fontes para a IA', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.compiled.name, 'Ana Clara')
  const prompt = JSON.stringify(ai.calls[0].messages)
  assert.match(prompt, /curso de ingles online/, 'a resposta da pessoa tem que ir no prompt')
  assert.match(prompt, /ementa do curso/, 'a fonte colada tem que ir no prompt')
  assert.equal(ai.calls[0].source, 'compilacao')
})

test('saida com cerca de markdown ainda e aceita', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('```json\n' + JSON.stringify(VALIDO) + '\n```')
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.compiled.persona, 'Cordial e objetiva.')
})

test('saida invalida tenta uma vez de novo e aceita a segunda', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('isso nao e json', VALIDO)
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(ai.calls.length, 2)
})

test('duas saidas invalidas devolvem erro e nao inventam agente', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('lixo', 'mais lixo')
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'saida_invalida')
  assert.equal(ai.calls.length, 2, 'tenta no maximo duas vezes')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, 1, 'so o agente semeado')
})

test('briefing de outra conta nao compila', async () => {
  const { db, briefingId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const ai = fakeAi(VALIDO)
  const r = await compileBriefing(db, { accountId: outra, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_encontrado')
  assert.equal(ai.calls.length, 0)
})

test('falha da IA vira erro nomeado, nao excecao', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = { calls: [], ask: async () => { throw new Error('dros_key_missing') } }
  const r = await compileBriefing(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'dros_key_missing')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agentCompiler.test.js`
Expected: FAIL — `Cannot find module '../server/services/agentCompiler.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/agentCompiler.js`:

```js
// Transforma o briefing (transcricao + fontes) nos campos do ai_agents.
// E o UNICO lugar que conhece o formato do ai_agents. Valida antes de devolver:
// nunca entrega agente meio montado.

import { getBriefing } from './briefingStore.js'

// Mesmas chaves de REQUIRED_FIELDS_OPTS em src/components/AgentEditorModal.tsx:14
export const REQUIRED_FIELD_KEYS = ['name', 'email', 'phone', 'city', 'empresa', 'instagram']

const SYSTEM_PROMPT = `Voce recebe a entrevista que um dono de negocio deu sobre a propria empresa e transforma isso na configuracao de um atendente de IA que vai responder os leads dele no WhatsApp.

O negocio pode ser de QUALQUER ramo. Nao presuma ramo nenhum: use so o que a entrevista disser.

Responda APENAS com um objeto JSON, sem texto antes ou depois, neste formato exato:

{
  "name": "primeiro nome do atendente, brasileiro e comum",
  "persona": "tom de voz em 1 ou 2 frases",
  "knowledge_base": "tudo que o atendente precisa saber do negocio para responder",
  "never_mention": "o que o atendente nunca pode falar, separado por virgula",
  "qualification_criteria": "uma frase: quando o lead esta qualificado",
  "required_fields": ["subconjunto de: name, email, phone, city, empresa, instagram"],
  "resumo": {
    "quem_sou": "uma frase, na voz do atendente",
    "o_que_sei": "uma frase sobre o negocio",
    "o_que_descubro": ["item curto", "item curto"],
    "o_que_nunca_falo": ["item curto"]
  }
}

O campo "resumo" e o que o dono le na tela para aprovar: escreva em portugues simples, sem jargao.`

function parseJsonLoose(text) {
  const raw = String(text == null ? '' : text).trim()
  const semCerca = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(semCerca)
  } catch {
    // ultima tentativa: pegar do primeiro { ate o ultimo }
    const i = semCerca.indexOf('{')
    const j = semCerca.lastIndexOf('}')
    if (i === -1 || j <= i) return null
    try { return JSON.parse(semCerca.slice(i, j + 1)) } catch { return null }
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(x => isNonEmptyString(x))
}

export function validateCompiled(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'nao_e_objeto' }

  for (const k of ['name', 'persona', 'knowledge_base', 'never_mention', 'qualification_criteria']) {
    if (!isNonEmptyString(raw[k])) return { ok: false, error: `campo_invalido:${k}` }
  }
  if (!Array.isArray(raw.required_fields)) return { ok: false, error: 'campo_invalido:required_fields' }
  if (!raw.required_fields.every(f => REQUIRED_FIELD_KEYS.includes(f))) {
    return { ok: false, error: 'campo_invalido:required_fields' }
  }

  const r = raw.resumo
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, error: 'campo_invalido:resumo' }
  if (!isNonEmptyString(r.quem_sou)) return { ok: false, error: 'campo_invalido:resumo.quem_sou' }
  if (!isNonEmptyString(r.o_que_sei)) return { ok: false, error: 'campo_invalido:resumo.o_que_sei' }
  if (!isStringArray(r.o_que_descubro)) return { ok: false, error: 'campo_invalido:resumo.o_que_descubro' }
  if (!isStringArray(r.o_que_nunca_falo)) return { ok: false, error: 'campo_invalido:resumo.o_que_nunca_falo' }

  return {
    ok: true,
    value: {
      name: raw.name.trim(),
      persona: raw.persona.trim(),
      knowledge_base: raw.knowledge_base.trim(),
      never_mention: raw.never_mention.trim(),
      qualification_criteria: raw.qualification_criteria.trim(),
      required_fields: [...raw.required_fields],
      resumo: {
        quem_sou: r.quem_sou.trim(),
        o_que_sei: r.o_que_sei.trim(),
        o_que_descubro: [...r.o_que_descubro],
        o_que_nunca_falo: [...r.o_que_nunca_falo],
      },
    },
  }
}

export function buildBriefingText(briefing) {
  const conversa = briefing.turns
    .map(t => `${t.role === 'ia' ? 'PERGUNTA' : 'RESPOSTA'}: ${t.content}`)
    .join('\n')

  const fontes = briefing.sources
    .filter(s => s.status === 'ok' && s.content)
    .map(s => `--- MATERIAL (${s.kind}${s.ref ? ' ' + s.ref : ''}) ---\n${s.content}`)
    .join('\n\n')

  return [`=== ENTREVISTA ===\n${conversa}`, fontes ? `=== MATERIAIS ===\n${fontes}` : '']
    .filter(Boolean).join('\n\n')
}

export async function compileBriefing(db, { accountId, briefingId, ai }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }

  const texto = buildBriefingText(briefing)
  let ultimoErro = 'saida_invalida'

  // Tenta duas vezes: a segunda avisa que a primeira veio fora do formato.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const aviso = tentativa === 1
      ? ''
      : '\n\nATENCAO: sua resposta anterior nao era um JSON valido no formato pedido. Responda SO o JSON.'
    let r
    try {
      r = await ai.ask({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: texto + aviso }],
        maxTokens: 1500,
        source: 'compilacao',
      })
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) }
    }

    const parsed = parseJsonLoose(r.content)
    const check = validateCompiled(parsed)
    if (check.ok) return { ok: true, compiled: check.value }
    ultimoErro = 'saida_invalida'
  }

  return { ok: false, error: ultimoErro }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/agentCompiler.test.js`
Expected: PASS, 9 testes.

Run: `npm test`
Expected: PASS, 258 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentCompiler.js test/agentCompiler.test.js
git commit -m "feat: compilador do briefing em campos do agente"
```

---

### Task 6: Entrevistador

**Files:**
- Create: `server/services/agentInterview.js`
- Test: `test/agentInterview.test.js`

**Interfaces:**
- Consumes: `getBriefing`, `addTurn` (task 3), objeto `ai` com `.ask()` e `.tokensUsed()` (task 2).
- Produces:
  - `TEMAS` -> array dos 6 temas do spec (só os temas; a pergunta é escrita pela IA)
  - `MAX_PERGUNTAS` = `20`, `MAX_TOKENS_BRIEFING` = `60000`
  - `shouldFinish(briefing, ai)` -> `{ finish: boolean, reason: 'perguntas'|'tokens'|null }`
  - `nextQuestion(db, { accountId, briefingId, ai })` -> `Promise<{ ok: true, done: false, question } | { ok: true, done: true, reason } | { ok: false, error }>`
  - `answer(db, { accountId, briefingId, text })` -> `{ ok: boolean, error?: string }`

Os tetos são checados **antes** de gastar mais IA, e ao bater qualquer um a função devolve `done: true` para o chamador compilar. Ela nunca para em silêncio.

- [ ] **Step 1: Write the failing test**

Create `test/agentInterview.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, addTurn } from '../server/services/briefingStore.js'
import {
  TEMAS, MAX_PERGUNTAS, MAX_TOKENS_BRIEFING,
  shouldFinish, nextQuestion, answer,
} from '../server/services/agentInterview.js'

function fakeAi(reply = 'O que sua empresa vende?', tokens = 0) {
  const calls = []
  return {
    calls,
    ask: async (params) => { calls.push(params); return { content: reply, usage: { total: 10 }, costUsd: 0 } },
    tokensUsed: () => tokens,
  }
}

function setup() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  return { db, accountId, briefingId }
}

test('os 6 temas do spec existem e nenhum cita ramo de negocio', () => {
  assert.equal(TEMAS.length, 6)
  const texto = JSON.stringify(TEMAS).toLowerCase()
  for (const ramo of ['imovel', 'imobiliaria', 'clinica', 'curso', 'advogado', 'loja']) {
    assert.ok(!texto.includes(ramo), `o tema nao pode citar o ramo "${ramo}"`)
  }
})

test('tetos sao os do spec', () => {
  assert.equal(MAX_PERGUNTAS, 20)
  assert.equal(MAX_TOKENS_BRIEFING, 60000)
})

test('primeira pergunta e gravada como turno da ia', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('O que sua empresa vende?')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, true)
  assert.equal(r.done, false)
  assert.equal(r.question, 'O que sua empresa vende?')
  const turns = getBriefing(db, accountId, briefingId).turns
  assert.equal(turns.length, 1)
  assert.equal(turns[0].role, 'ia')
})

test('answer grava a resposta da pessoa', () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  assert.equal(answer(db, { accountId, briefingId, text: 'software de gestao' }).ok, true)
  const turns = getBriefing(db, accountId, briefingId).turns
  assert.equal(turns[1].role, 'user')
  assert.equal(turns[1].content, 'software de gestao')
})

test('answer recusa texto vazio e briefing de outra conta', () => {
  const { db, accountId, briefingId } = setup()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  assert.equal(answer(db, { accountId, briefingId, text: '  ' }).ok, false)
  assert.equal(answer(db, { accountId: outra, briefingId, text: 'oi' }).ok, false)
  assert.equal(getBriefing(db, accountId, briefingId).turns.length, 0)
})

test('shouldFinish corta no teto de perguntas', () => {
  const { db, accountId, briefingId } = setup()
  for (let i = 0; i < MAX_PERGUNTAS; i++) addTurn(db, { accountId, briefingId, role: 'ia', content: `p${i}` })
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', 0)), { finish: true, reason: 'perguntas' })
})

test('shouldFinish corta no teto de tokens', () => {
  const { db, accountId, briefingId } = setup()
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', MAX_TOKENS_BRIEFING)), { finish: true, reason: 'tokens' })
})

test('shouldFinish deixa seguir quando esta dentro dos dois tetos', () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'p1' })
  const b = getBriefing(db, accountId, briefingId)
  assert.deepEqual(shouldFinish(b, fakeAi('x', 100)), { finish: false, reason: null })
})

test('no teto, nextQuestion encerra sem gastar IA', async () => {
  const { db, accountId, briefingId } = setup()
  for (let i = 0; i < MAX_PERGUNTAS; i++) addTurn(db, { accountId, briefingId, role: 'ia', content: `p${i}` })
  const ai = fakeAi()
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.done, true)
  assert.equal(r.reason, 'perguntas')
  assert.equal(ai.calls.length, 0, 'nao pode chamar a IA depois de bater o teto')
})

test('a IA recebe os temas e a conversa ate agora', async () => {
  const { db, accountId, briefingId } = setup()
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'consultoria contabil' })
  const ai = fakeAi('Quem e o seu cliente ideal?')
  await nextQuestion(db, { accountId, briefingId, ai })
  const call = ai.calls[0]
  assert.match(call.systemPrompt, /TEMAS/i)
  assert.match(JSON.stringify(call.messages), /consultoria contabil/)
  assert.equal(call.source, 'entrevista')
})

test('IA devolvendo vazio vira erro nomeado e nao grava turno', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = fakeAi('   ')
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'pergunta_vazia')
  assert.equal(getBriefing(db, accountId, briefingId).turns.length, 0)
})

test('falha da IA vira erro nomeado, nao excecao', async () => {
  const { db, accountId, briefingId } = setup()
  const ai = { calls: [], ask: async () => { throw new Error('dros_key_missing') }, tokensUsed: () => 0 }
  const r = await nextQuestion(db, { accountId, briefingId, ai })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'dros_key_missing')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agentInterview.test.js`
Expected: FAIL — `Cannot find module '../server/services/agentInterview.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/agentInterview.js`:

```js
// Conduz a entrevista que vira o briefing do agente. Uma pergunta por vez.
// O codigo tem os TEMAS; quem escreve a PERGUNTA e a IA, adaptada ao ramo que
// ela descobrir na primeira resposta. Nenhum ramo de negocio aparece aqui.

import { getBriefing, addTurn } from './briefingStore.js'

export const MAX_PERGUNTAS = 20
export const MAX_TOKENS_BRIEFING = 60000

export const TEMAS = [
  'O que a empresa vende',
  'Quem e o cliente ideal',
  'O que o atendente precisa descobrir do lead antes de passar para o vendedor',
  'O que o atendente nunca pode falar',
  'Como a empresa fala com o cliente (tom de voz)',
  'Em qual numero de WhatsApp o atendente vai trabalhar',
]

const SYSTEM_PROMPT = `Voce esta entrevistando o dono de um negocio para montar um atendente de IA que vai responder os leads dele no WhatsApp.

Faca UMA pergunta por vez, curta, em portugues simples, sem jargao. Responda APENAS com a pergunta, sem numeracao e sem comentario.

O negocio pode ser de QUALQUER ramo. Descubra o ramo na primeira resposta e adapte todas as perguntas seguintes a ele. Nunca presuma um ramo.

Se a ultima resposta foi vaga, pergunte de novo pedindo o detalhe que faltou, em vez de seguir adiante.

TEMAS que a entrevista precisa cobrir, nesta ordem:
${TEMAS.map((t, i) => `${i + 1}. ${t}`).join('\n')}

Ao longo da conversa, quando fizer sentido, ofereca tambem:
- pedir o site da empresa, dizendo que voce le sozinha
- pedir que a pessoa cole qualquer material pronto que ela ja tenha

Quando todos os temas estiverem cobertos, responda exatamente: PRONTO`

export function shouldFinish(briefing, ai) {
  const perguntas = briefing.turns.filter(t => t.role === 'ia').length
  if (perguntas >= MAX_PERGUNTAS) return { finish: true, reason: 'perguntas' }
  if (ai.tokensUsed() >= MAX_TOKENS_BRIEFING) return { finish: true, reason: 'tokens' }
  return { finish: false, reason: null }
}

export async function nextQuestion(db, { accountId, briefingId, ai }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }

  // Teto conferido ANTES de gastar IA.
  const corte = shouldFinish(briefing, ai)
  if (corte.finish) return { ok: true, done: true, reason: corte.reason }

  const messages = briefing.turns.map(t => ({
    role: t.role === 'ia' ? 'assistant' : 'user',
    content: t.content,
  }))
  // A API exige que a conversa comece por 'user'.
  if (messages.length === 0 || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: 'Pode comecar a entrevista.' })
  }

  let r
  try {
    r = await ai.ask({ systemPrompt: SYSTEM_PROMPT, messages, maxTokens: 200, source: 'entrevista' })
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }

  const pergunta = String(r.content || '').trim()
  if (!pergunta) return { ok: false, error: 'pergunta_vazia' }
  if (pergunta.toUpperCase() === 'PRONTO') return { ok: true, done: true, reason: 'temas_cobertos' }

  addTurn(db, { accountId, briefingId, role: 'ia', content: pergunta })
  return { ok: true, done: false, question: pergunta }
}

export function answer(db, { accountId, briefingId, text }) {
  const clean = String(text == null ? '' : text).trim()
  if (!clean) return { ok: false, error: 'resposta_vazia' }
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }
  addTurn(db, { accountId, briefingId, role: 'user', content: clean })
  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/agentInterview.test.js`
Expected: PASS, 12 testes.

Run: `npm test`
Expected: PASS, 270 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/agentInterview.js test/agentInterview.test.js
git commit -m "feat: entrevistador do agente com tetos de perguntas e tokens"
```

---

### Task 7: Extrair a criação do agente para um serviço

**Files:**
- Create: `server/services/agentCreate.js`
- Modify: `server/routes/agents.js:113-216` (a rota `POST /` passa a chamar o serviço)
- Test: `test/agentCreate.test.js`

**Interfaces:**
- Consumes: nada novo.
- Produces: `createAgentRecord(db, { accountId, body })` -> `{ ok: true, agentId } | { ok: false, error }`

**Refatoração pura: nenhuma mudança de comportamento.** A rota `POST /api/agents` continua respondendo exatamente igual. O objetivo é a task 8 poder criar o agente na ativação sem duplicar 60 linhas.

- [ ] **Step 1: Read the current route and copy its logic verbatim**

Read `server/routes/agents.js:113-216` inteiro antes de mexer. A lógica que sai da rota para o serviço é: validação de `name`, `stage_ids`, `instance_ids`, `handoff_rules`, `mode`, e a transação que cria o usuário-bot e o agente. O que **fica** na rota: `requireRole`, `checkAccountFeature`, `req.accountId` e a resposta HTTP.

- [ ] **Step 2: Write the failing test**

Create `test/agentCreate.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createAgentRecord } from '../server/services/agentCreate.js'

const BODY = {
  name: 'Ana Clara',
  persona: 'Cordial.',
  knowledge_base: 'Vende curso.',
  never_mention: 'preco',
  qualification_criteria: 'nome e cidade',
  required_fields: ['name', 'city'],
  mode: 'copilot',
}

test('cria o agente e o usuario-bot da conta', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const r = createAgentRecord(db, { accountId, body: BODY })
  assert.equal(r.ok, true)
  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.account_id, accountId)
  assert.equal(a.name, 'Ana Clara')
  assert.equal(a.mode, 'copilot')
  assert.equal(a.persona, 'Cordial.')
  assert.equal(JSON.parse(a.required_fields).length, 2)
  const bot = db.prepare('SELECT * FROM users WHERE id = ?').get(a.user_id)
  assert.equal(bot.is_bot, 1)
  assert.equal(bot.account_id, accountId)
})

test('recusa nome vazio e mode invalido sem criar nada', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const antesAgentes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const antesUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c

  assert.equal(createAgentRecord(db, { accountId, body: { ...BODY, name: '  ' } }).ok, false)
  assert.equal(createAgentRecord(db, { accountId, body: { ...BODY, mode: 'sei_la' } }).ok, false)

  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antesAgentes)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM users').get().c, antesUsers, 'nao pode deixar usuario-bot orfao')
})

test('mode ausente cai no padrao auto', () => {
  const db = createTestDb()
  const { accountId } = seedAccountAndLead(db)
  const r = createAgentRecord(db, { accountId, body: { name: 'Sem modo' } })
  assert.equal(r.ok, true)
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(r.agentId).mode, 'auto')
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/agentCreate.test.js`
Expected: FAIL — `Cannot find module '../server/services/agentCreate.js'`

- [ ] **Step 4: Move the logic into the service**

Create `server/services/agentCreate.js` movendo o corpo de `routes/agents.js:117-216` **sem alterar nenhuma linha de lógica**. A assinatura recebe `db` e `{ accountId, body }`; troque `req.accountId` por `accountId` e `req.body` por `body`; troque cada `return res.status(400).json({ error: X })` por `return { ok: false, error: X }`; devolva `{ ok: true, agentId }` no final.

**Notas de fidelidade** (confira uma a uma depois de mover):
- o `required_fields` continua gravado com `JSON.stringify` só quando é array, senão `null`;
- `identifies_as_bot` e `is_active` mantêm a forma `x === 0 ? 0 : 1`;
- os padrões de `audio_decline_message`, `max_messages_before_handoff` (15) e `handoff_keywords` são os mesmos;
- o e-mail do bot continua `bot-${Date.now()}-${random}@dros-bot.internal` e a senha continua um `bcrypt.hashSync` de valor aleatório;
- tudo dentro do mesmo `db.transaction(...)`, para nome inválido não deixar usuário-bot órfão.

- [ ] **Step 5: Make the route call the service**

Em `server/routes/agents.js`, a rota `POST /` fica:

```js
router.post('/', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  if (!checkAccountFeature(req.accountId)) return res.status(403).json({ error: 'Recurso nao habilitado nessa conta' })

  try {
    const r = createAgentRecord(db, { accountId: req.accountId, body: req.body || {} })
    if (!r.ok) return res.status(400).json({ error: r.error })
    res.status(201).json(db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId))
  } catch (e) {
    console.error('[POST /agents] error:', e.message)
    res.status(500).json({ error: 'Erro ao criar agente' })
  }
})
```

Compare a resposta de sucesso com a que a rota devolvia antes (linhas finais do bloco original) e **mantenha a forma exata** — o `AgentEditorModal.tsx` consome esse retorno. Se a rota original devolvia mais do que a linha de `ai_agents` (por exemplo etapas e instâncias), replique isso aqui.

- [ ] **Step 6: Run tests to verify nothing regressed**

Run: `node --test test/agentCreate.test.js`
Expected: PASS, 3 testes.

Run: `npm test`
Expected: PASS, 273 testes, 0 falhas. **Nenhum teste existente pode mudar** — se algum quebrou, a refatoração alterou comportamento; desfaça e refaça.

- [ ] **Step 7: Commit**

```bash
git add server/services/agentCreate.js server/routes/agents.js test/agentCreate.test.js
git commit -m "refactor: extrai criacao do agente da rota para um servico"
```

---

### Task 8: Ativação — a única transição que cria o agente

**Files:**
- Create: `server/services/briefingActivate.js`
- Test: `test/briefingActivate.test.js`

**Interfaces:**
- Consumes: `getBriefing`, `linkAgent` (task 3), `createAgentRecord` (task 7).
- Produces: `activateBriefing(db, { accountId, briefingId, mode = 'copilot', instanceIds = [] })` -> `{ ok: true, agentId } | { ok: false, error }`

Esta task implementa a **regra de segurança inviolável** do spec. Os testes aqui são os mais importantes do plano.

- [ ] **Step 1: Write the failing test**

Create `test/briefingActivate.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { createBriefing, getBriefing, setCompiled, addTurn } from '../server/services/briefingStore.js'
import { activateBriefing } from '../server/services/briefingActivate.js'

// Nota: setCompiled mantem o status 'ativo' quando o briefing ja foi ativado,
// e e por isso que a segunda ativacao cai no caminho de ATUALIZAR o agente.

const COMPILADO = {
  name: 'Ana Clara',
  persona: 'Cordial.',
  knowledge_base: 'Vende curso de ingles.',
  never_mention: 'preco',
  qualification_criteria: 'nome e cidade',
  required_fields: ['name', 'city'],
  resumo: { quem_sou: 'a', o_que_sei: 'b', o_que_descubro: ['c'], o_que_nunca_falo: ['d'] },
}

function comBriefingCompilado() {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso de ingles' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  return { db, accountId, briefingId }
}

test('REGRA DE SEGURANCA: rascunho nao cria linha em ai_agents', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const briefingId = createBriefing(db, { accountId, userId })
  addTurn(db, { accountId, briefingId, role: 'ia', content: 'O que voce vende?' })
  addTurn(db, { accountId, briefingId, role: 'user', content: 'curso' })
  setCompiled(db, { accountId, briefingId, compiled: COMPILADO })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes,
    'entrevistar e compilar NAO podem criar agente')
})

test('ativar cria o agente com os campos compilados e amarra o briefing', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'copilot' })
  assert.equal(r.ok, true)

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.name, 'Ana Clara')
  assert.equal(a.persona, 'Cordial.')
  assert.equal(a.knowledge_base, 'Vende curso de ingles.')
  assert.equal(a.never_mention, 'preco')
  assert.equal(a.qualification_criteria, 'nome e cidade')
  assert.deepEqual(JSON.parse(a.required_fields), ['name', 'city'])
  assert.equal(a.mode, 'copilot')
  assert.equal(a.account_id, accountId)

  const b = getBriefing(db, accountId, briefingId)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, r.agentId)
})

test('o modo pedido e respeitado', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'auto' })
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(r.agentId).mode, 'auto')
})

test('briefing ainda em entrevista nao ativa', () => {
  const db = createTestDb()
  const { accountId, userId } = seedAccountAndLead(db)
  const briefingId = createBriefing(db, { accountId, userId })
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_compilado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('ativar briefing JA ativo atualiza o agente existente, nao cria outro', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const primeira = activateBriefing(db, { accountId, briefingId })
  const totalDepoisDaPrimeira = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c

  // simula o "Corrigir algo": recompila com conteudo novo e ativa de novo
  setCompiled(db, { accountId, briefingId, compiled: { ...COMPILADO, persona: 'Bem mais informal.', never_mention: 'nada' } })
  const segunda = activateBriefing(db, { accountId, briefingId })

  assert.equal(segunda.ok, true)
  assert.equal(segunda.agentId, primeira.agentId, 'tem que ser o MESMO agente')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, totalDepoisDaPrimeira, 'nao pode criar agente novo')

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(primeira.agentId)
  assert.equal(a.persona, 'Bem mais informal.')
  assert.equal(a.never_mention, 'nada')
})

test('atualizar agente existente nao mexe no modo nem no is_active', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  const r = activateBriefing(db, { accountId, briefingId, mode: 'auto' })
  db.prepare('UPDATE ai_agents SET is_active = 0 WHERE id = ?').run(r.agentId)

  setCompiled(db, { accountId, briefingId, compiled: { ...COMPILADO, persona: 'Outra.' } })
  activateBriefing(db, { accountId, briefingId, mode: 'copilot' })

  const a = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(r.agentId)
  assert.equal(a.persona, 'Outra.', 'o conteudo atualiza')
  assert.equal(a.mode, 'auto', 'o modo escolhido antes NAO pode ser sobrescrito pela correcao')
  assert.equal(a.is_active, 0, 'agente desligado nao pode religar sozinho')
})

test('briefing de outra conta nao ativa', () => {
  const { db, briefingId } = comBriefingCompilado()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId: outra, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'briefing_nao_encontrado')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})

test('compiled_json corrompido nao cria agente', () => {
  const { db, accountId, briefingId } = comBriefingCompilado()
  db.prepare('UPDATE agent_briefings SET compiled_json = ? WHERE id = ?').run('{quebrado', briefingId)
  const antes = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  const r = activateBriefing(db, { accountId, briefingId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'compilado_invalido')
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, antes)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/briefingActivate.test.js`
Expected: FAIL — `Cannot find module '../server/services/briefingActivate.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/briefingActivate.js`:

```js
// A UNICA transicao que cria o agente. Enquanto o briefing e rascunho ou esta so
// compilado, os campos vivem em agent_briefings.compiled_json e NAO em ai_agents:
// qualquer linha em ai_agents com is_active=1 e varrida pelo processInboundMessage
// e comeca a responder lead de verdade.

import { getBriefing, linkAgent } from './briefingStore.js'
import { createAgentRecord } from './agentCreate.js'
import { validateCompiled } from './agentCompiler.js'

// Atualiza SO o conteudo que a entrevista produz. Nao toca em mode, is_active,
// instancias, etapas nem handoff: isso e configuracao que a pessoa ja escolheu,
// e uma correcao de texto nao pode religar um agente desligado.
function updateAgentContent(db, { accountId, agentId, c }) {
  const r = db.prepare(`
    UPDATE ai_agents
       SET persona = ?, knowledge_base = ?, never_mention = ?,
           qualification_criteria = ?, required_fields = ?,
           updated_at = datetime('now')
     WHERE id = ? AND account_id = ?
  `).run(
    c.persona, c.knowledge_base, c.never_mention,
    c.qualification_criteria, JSON.stringify(c.required_fields),
    agentId, accountId
  )
  return r.changes > 0
}

export function activateBriefing(db, { accountId, briefingId, mode = 'copilot', instanceIds = [] }) {
  const briefing = getBriefing(db, accountId, briefingId)
  if (!briefing) return { ok: false, error: 'briefing_nao_encontrado' }
  if (briefing.status !== 'compilado' && briefing.status !== 'ativo') {
    return { ok: false, error: 'briefing_nao_compilado' }
  }

  let compiled
  try {
    compiled = JSON.parse(briefing.compiled_json)
  } catch {
    return { ok: false, error: 'compilado_invalido' }
  }
  const check = validateCompiled(compiled)
  if (!check.ok) return { ok: false, error: 'compilado_invalido' }
  const c = check.value

  // Briefing ja ativo = correcao de um agente que existe. Atualiza, nao duplica.
  if (briefing.status === 'ativo' && briefing.agent_id) {
    if (!updateAgentContent(db, { accountId, agentId: briefing.agent_id, c })) {
      return { ok: false, error: 'agente_nao_encontrado' }
    }
    return { ok: true, agentId: briefing.agent_id }
  }

  const run = db.transaction(() => {
    const created = createAgentRecord(db, {
      accountId,
      body: {
        name: c.name,
        persona: c.persona,
        knowledge_base: c.knowledge_base,
        never_mention: c.never_mention,
        qualification_criteria: c.qualification_criteria,
        required_fields: c.required_fields,
        mode,
        instance_ids: instanceIds,
      },
    })
    if (!created.ok) return created
    linkAgent(db, { accountId, briefingId, agentId: created.agentId })
    return { ok: true, agentId: created.agentId }
  })

  // createAgentRecord sinaliza erro de DUAS formas: devolvendo { ok:false } nas
  // validacoes, e LANCANDO quando a montagem do INSERT falha (confirmado na
  // Task 7). Sem este catch, a excecao subiria crua ate o Express.
  try {
    return run()
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/briefingActivate.test.js`
Expected: PASS, 8 testes.

Run: `npm test`
Expected: PASS, 281 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/briefingActivate.js test/briefingActivate.test.js
git commit -m "feat: ativacao do briefing como unica transicao que cria o agente"
```

---

### Task 9: Agente legado vira briefing

**Files:**
- Create: `server/services/briefingFromAgent.js`
- Test: `test/briefingFromAgent.test.js`

**Interfaces:**
- Consumes: `createBriefing`, `addSource`, `setCompiled`, `linkAgent`, `getBriefing` (task 3).
- Produces: `briefingFromAgent(db, { accountId, agentId, userId })` -> `{ ok: true, briefingId } | { ok: false, error }`

Agente que já existe (o "AGENTE IA — OXI QUÍMICA" da conta Dros, por exemplo) não tem briefing. Esta função cria um a partir dos campos atuais, para que "Conversar com a IA" funcione nele também.

- [ ] **Step 1: Write the failing test**

Create `test/briefingFromAgent.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { getBriefing } from '../server/services/briefingStore.js'
import { briefingFromAgent } from '../server/services/briefingFromAgent.js'

function comAgenteConfigurado() {
  const db = createTestDb()
  const seed = seedAccountAndLead(db)
  db.prepare(`
    UPDATE ai_agents
       SET persona = 'Formal e tecnica.',
           knowledge_base = 'Vende produto quimico industrial.',
           never_mention = 'prazo de entrega',
           qualification_criteria = 'Qualificado com CNPJ e volume',
           required_fields = ?
     WHERE id = ?
  `).run(JSON.stringify(['name', 'empresa']), seed.agentId)
  return { db, ...seed }
}

test('cria briefing compilado e amarrado ao agente que ja existe', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(r.ok, true)

  const b = getBriefing(db, accountId, r.briefingId)
  assert.equal(b.status, 'ativo')
  assert.equal(b.agent_id, agentId)

  const c = JSON.parse(b.compiled_json)
  assert.equal(c.persona, 'Formal e tecnica.')
  assert.equal(c.knowledge_base, 'Vende produto quimico industrial.')
  assert.deepEqual(c.required_fields, ['name', 'empresa'])
})

test('guarda os campos atuais como fonte de entrevista', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  const sources = getBriefing(db, accountId, r.briefingId).sources
  assert.equal(sources.length, 1)
  assert.equal(sources[0].kind, 'entrevista')
  assert.match(sources[0].content, /produto quimico industrial/)
})

test('NAO cria agente novo nem mexe no agente existente', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const antes = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId)
  const total = db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c
  briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c, total)
  assert.deepEqual(db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(agentId), antes)
})

test('agente com campos vazios ainda vira briefing utilizavel', () => {
  const db = createTestDb()
  const { accountId, userId, agentId } = seedAccountAndLead(db)
  const r = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(r.ok, true)
  const c = JSON.parse(getBriefing(db, accountId, r.briefingId).compiled_json)
  assert.ok(c.name, 'o nome do agente sempre existe')
  assert.deepEqual(c.required_fields, [])
})

test('agente de outra conta nao vira briefing', () => {
  const { db, userId, agentId } = comAgenteConfigurado()
  const outra = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run('Outra').lastInsertRowid)
  const r = briefingFromAgent(db, { accountId: outra, agentId, userId })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'agente_nao_encontrado')
})

test('agente que ja tem briefing devolve o mesmo, sem duplicar', () => {
  const { db, accountId, userId, agentId } = comAgenteConfigurado()
  const primeiro = briefingFromAgent(db, { accountId, agentId, userId })
  const segundo = briefingFromAgent(db, { accountId, agentId, userId })
  assert.equal(segundo.ok, true)
  assert.equal(segundo.briefingId, primeiro.briefingId)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM agent_briefings').get().c, 1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/briefingFromAgent.test.js`
Expected: FAIL — `Cannot find module '../server/services/briefingFromAgent.js'`

- [ ] **Step 3: Write the implementation**

Create `server/services/briefingFromAgent.js`:

```js
// Agente que ja existe nao tem briefing. Esta funcao cria um a partir dos campos
// atuais, para que "Conversar com a IA" valha tambem para o que ja esta no ar.
// NAO toca no agente: so le.

import { createBriefing, addSource, setCompiled, linkAgent, getBriefing } from './briefingStore.js'
import { REQUIRED_FIELD_KEYS } from './agentCompiler.js'

function parseRequiredFields(raw) {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter(f => REQUIRED_FIELD_KEYS.includes(f)) : []
  } catch {
    return []
  }
}

export function briefingFromAgent(db, { accountId, agentId, userId }) {
  const agent = db.prepare(
    'SELECT * FROM ai_agents WHERE id = ? AND account_id = ?'
  ).get(agentId, accountId)
  if (!agent) return { ok: false, error: 'agente_nao_encontrado' }

  const existente = db.prepare(
    'SELECT id FROM agent_briefings WHERE agent_id = ? AND account_id = ?'
  ).get(agentId, accountId)
  if (existente) return { ok: true, briefingId: existente.id }

  const requiredFields = parseRequiredFields(agent.required_fields)

  const compiled = {
    name: agent.name,
    persona: agent.persona || 'Cordial e objetiva.',
    knowledge_base: agent.knowledge_base || 'Ainda nao descrito.',
    never_mention: agent.never_mention || 'nada',
    qualification_criteria: agent.qualification_criteria || 'Ainda nao definido.',
    required_fields: requiredFields,
    resumo: {
      quem_sou: agent.persona || 'Atendente da empresa.',
      o_que_sei: agent.knowledge_base || 'Ainda nao descrito.',
      o_que_descubro: requiredFields.length ? requiredFields : ['Ainda nao definido'],
      o_que_nunca_falo: agent.never_mention ? [agent.never_mention] : ['Nada definido'],
    },
  }

  const texto = [
    `Configuracao atual do atendente "${agent.name}":`,
    `Tom de voz: ${agent.persona || '(vazio)'}`,
    `Conhecimento do negocio: ${agent.knowledge_base || '(vazio)'}`,
    `Nunca mencionar: ${agent.never_mention || '(vazio)'}`,
    `Criterio de qualificacao: ${agent.qualification_criteria || '(vazio)'}`,
    `Campos obrigatorios: ${requiredFields.join(', ') || '(nenhum)'}`,
  ].join('\n')

  const run = db.transaction(() => {
    const briefingId = createBriefing(db, { accountId, userId })
    addSource(db, { accountId, briefingId, kind: 'entrevista', content: texto })
    setCompiled(db, { accountId, briefingId, compiled })
    linkAgent(db, { accountId, briefingId, agentId })
    return briefingId
  })

  const briefingId = run()
  // getBriefing confirma que ficou legivel pela conta antes de devolver.
  if (!getBriefing(db, accountId, briefingId)) return { ok: false, error: 'falha_ao_criar' }
  return { ok: true, briefingId }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/briefingFromAgent.test.js`
Expected: PASS, 6 testes.

Run: `npm test`
Expected: PASS, 287 testes, 0 falhas.

- [ ] **Step 5: Commit**

```bash
git add server/services/briefingFromAgent.js test/briefingFromAgent.test.js
git commit -m "feat: agente que ja existe vira briefing a partir dos campos atuais"
```

---

### Task 10: Rotas HTTP do briefing

**Files:**
- Create: `server/routes/agentBriefings.js`
- Modify: `server/index.js` (import junto dos outros na linha 31-32; `app.use` junto dos outros na linha 82-83)
- Test: `test/agentBriefingRoutes.test.js`

**Interfaces:**
- Consumes: tasks 2 a 9.
- Produces (todas sob `/api/agent-briefings`, atrás de `authenticate` + `scopeToAccount`):

| Método e rota | Corpo | Devolve |
|---|---|---|
| `POST /` | — | `{ briefing_id, question }` — cria o rascunho e já faz a 1ª pergunta |
| `GET /` | — | `{ drafts: [...] }` |
| `GET /:id` | — | `{ briefing }` com `turns` e `sources` |
| `POST /:id/answer` | `{ text }` | `{ done, question? }` — grava a resposta e pergunta a próxima |
| `POST /:id/paste` | `{ text }` | `{ ok }` |
| `POST /:id/compile` | — | `{ compiled }` |
| `POST /:id/activate` | `{ mode?, instance_ids? }` | `{ agent_id }` |
| `DELETE /:id` | — | `{ ok: true }` |
| `POST /from-agent/:agentId` | — | `{ briefing_id }` |

Mapa de erro -> status: `briefing_nao_encontrado` e `agente_nao_encontrado` -> 404; `dros_key_missing` -> 503; `briefing_nao_compilado` e `compilado_invalido` -> 409; o resto -> 400.

- [ ] **Step 1: Write the failing test**

O projeto testa serviços, não rotas Express com servidor de pé. Para manter a convenção, teste a peça que a rota acrescenta — o mapa de erro para status — exportando-a.

Create `test/agentBriefingRoutes.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statusForError } from '../server/routes/agentBriefings.js'

test('erro de nao encontrado vira 404', () => {
  assert.equal(statusForError('briefing_nao_encontrado'), 404)
  assert.equal(statusForError('agente_nao_encontrado'), 404)
})

test('falta da chave da Dros vira 503, nao 400', () => {
  assert.equal(statusForError('dros_key_missing'), 503)
})

test('estado errado do briefing vira 409', () => {
  assert.equal(statusForError('briefing_nao_compilado'), 409)
  assert.equal(statusForError('compilado_invalido'), 409)
})

test('o resto vira 400', () => {
  assert.equal(statusForError('resposta_vazia'), 400)
  assert.equal(statusForError('saida_invalida'), 400)
  assert.equal(statusForError('qualquer_coisa'), 400)
  assert.equal(statusForError(undefined), 400)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/agentBriefingRoutes.test.js`
Expected: FAIL — `Cannot find module '../server/routes/agentBriefings.js'`

- [ ] **Step 3: Write the route module**

Create `server/routes/agentBriefings.js`:

```js
// API da entrevista que monta o agente. Entrevista e compilacao rodam sempre na
// chave da Dros (drosAi), nao na chave da conta.

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { createDrosAi } from '../services/drosAi.js'
import { createBriefing, getBriefing, listDrafts, setCompiled, deleteBriefing } from '../services/briefingStore.js'
import { nextQuestion, answer } from '../services/agentInterview.js'
import { collectPastedText } from '../services/briefingSources/pastedText.js'
import { compileBriefing } from '../services/agentCompiler.js'
import { activateBriefing } from '../services/briefingActivate.js'
import { briefingFromAgent } from '../services/briefingFromAgent.js'

const router = Router()

export function statusForError(error) {
  if (error === 'briefing_nao_encontrado' || error === 'agente_nao_encontrado') return 404
  if (error === 'dros_key_missing') return 503
  if (error === 'briefing_nao_compilado' || error === 'compilado_invalido') return 409
  return 400
}

function fail(res, error) {
  const status = statusForError(error)
  const msg = error === 'dros_key_missing'
    ? 'A chave de IA da Dros nao esta configurada no servidor (ANTHROPIC_API_KEY_DROS).'
    : error
  return res.status(status).json({ error: msg })
}

function aiFor(req) {
  return createDrosAi(db, { accountId: req.accountId })
}

router.post('/', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const briefingId = createBriefing(db, { accountId: req.accountId, userId: req.user.id })
  const r = await nextQuestion(db, { accountId: req.accountId, briefingId, ai: aiFor(req) })
  if (!r.ok) {
    deleteBriefing(db, req.accountId, briefingId) // nao deixa rascunho morto se a IA nem respondeu
    return fail(res, r.error)
  }
  res.status(201).json({ briefing_id: briefingId, question: r.question, done: r.done })
})

router.get('/', requireRole('super_admin', 'gerente'), (req, res) => {
  res.json({ drafts: listDrafts(db, req.accountId) })
})

router.get('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = getBriefing(db, req.accountId, req.params.id)
  if (!b) return fail(res, 'briefing_nao_encontrado')
  res.json({ briefing: b })
})

router.post('/:id/answer', requireRole('super_admin', 'gerente'), async (req, res) => {
  const gravou = answer(db, { accountId: req.accountId, briefingId: req.params.id, text: (req.body || {}).text })
  if (!gravou.ok) return fail(res, gravou.error)
  const r = await nextQuestion(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req) })
  if (!r.ok) return fail(res, r.error)
  res.json({ done: r.done, question: r.question || null, reason: r.reason || null })
})

router.post('/:id/paste', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = getBriefing(db, req.accountId, req.params.id)
  if (!b) return fail(res, 'briefing_nao_encontrado')
  const r = collectPastedText(db, { accountId: req.accountId, briefingId: b.id, text: (req.body || {}).text })
  if (!r.ok) return fail(res, r.error)
  res.json({ ok: true })
})

router.post('/:id/compile', requireRole('super_admin', 'gerente'), async (req, res) => {
  const r = await compileBriefing(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req) })
  if (!r.ok) return fail(res, r.error)
  setCompiled(db, { accountId: req.accountId, briefingId: req.params.id, compiled: r.compiled })
  res.json({ compiled: r.compiled })
})

router.post('/:id/activate', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = req.body || {}
  const r = activateBriefing(db, {
    accountId: req.accountId,
    briefingId: req.params.id,
    mode: b.mode || 'copilot',
    instanceIds: Array.isArray(b.instance_ids) ? b.instance_ids : [],
  })
  if (!r.ok) return fail(res, r.error)
  res.status(201).json({ agent_id: r.agentId })
})

router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!deleteBriefing(db, req.accountId, req.params.id)) return fail(res, 'briefing_nao_encontrado')
  res.json({ ok: true })
})

router.post('/from-agent/:agentId', requireRole('super_admin', 'gerente'), (req, res) => {
  const r = briefingFromAgent(db, { accountId: req.accountId, agentId: req.params.agentId, userId: req.user.id })
  if (!r.ok) return fail(res, r.error)
  res.json({ briefing_id: r.briefingId })
})

export default router
```

**Confira o import do `requireRole`:** rode `grep -rn "requireRole" server/routes/agents.js | head -1` e use o mesmo caminho de import que essa rota usa. Se o caminho for outro, corrija aqui.

- [ ] **Step 4: Register the routes**

Em `server/index.js`, junto dos outros imports (perto da linha 31):

```js
import agentBriefingRoutes from './routes/agentBriefings.js'
```

e junto dos outros `app.use` (perto da linha 82):

```js
app.use('/api/agent-briefings', authenticate, scopeToAccount, agentBriefingRoutes)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/agentBriefingRoutes.test.js`
Expected: PASS, 4 testes.

Run: `npm test`
Expected: PASS, 291 testes, 0 falhas.

- [ ] **Step 6: Smoke test the running server**

```bash
npm run dev:server
```

Em outro terminal:

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@drosagencia.com.br","password":"dros2026"}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

curl -s -X POST http://localhost:3002/api/agent-briefings -H "Authorization: Bearer $TOKEN"
```

Expected sem `ANTHROPIC_API_KEY_DROS` no `.env`: HTTP 503 com a mensagem sobre a chave da Dros — **não** um 500 nem um stack trace. É esse o comportamento que o spec pede.

- [ ] **Step 7: Commit**

```bash
git add server/routes/agentBriefings.js server/index.js test/agentBriefingRoutes.test.js
git commit -m "feat: rotas da entrevista do agente"
```

---

### Task 11: Cliente de API no front-end

**Files:**
- Modify: `src/lib/api.ts` (acrescentar tipos e funções no fim do arquivo)

**Interfaces:**
- Consumes: as rotas da task 10.
- Produces: `AgentBriefing`, `CompiledAgent`, `BriefingDraft` e as funções `startBriefing`, `answerBriefing`, `retryNextQuestion`, `pasteIntoBriefing`, `compileBriefing`, `activateBriefing`, `fetchBriefing`, `fetchBriefingDrafts`, `deleteBriefing`, `briefingFromAgent`.

Sem teste próprio: o projeto não tem teste de front-end, e essas funções são repasses diretos do `apiFetch`. O que valida é a task 14 (verificação no app rodando).

- [ ] **Step 1: Add the types and functions**

No fim de `src/lib/api.ts`:

```ts
// ── Agente por entrevista (bloco 6) ───────────────────────────
export interface CompiledAgent {
  name: string
  persona: string
  knowledge_base: string
  never_mention: string
  qualification_criteria: string
  required_fields: string[]
  resumo: {
    quem_sou: string
    o_que_sei: string
    o_que_descubro: string[]
    o_que_nunca_falo: string[]
  }
}

export interface BriefingTurn { id: number; position: number; role: 'ia' | 'user'; content: string; created_at: string }
export interface BriefingSource { id: number; kind: 'entrevista' | 'site' | 'conversas' | 'colado'; ref: string | null; content: string | null; status: 'ok' | 'falhou'; error: string | null }
export interface AgentBriefing {
  id: number; account_id: number; agent_id: number | null
  status: 'entrevistando' | 'compilado' | 'ativo'
  compiled_json: string | null; created_at: string; updated_at: string
  turns: BriefingTurn[]; sources: BriefingSource[]
}
export interface BriefingDraft { id: number; status: string; created_at: string; updated_at: string; first_answer: string | null }

export const startBriefing = () =>
  apiFetch<{ briefing_id: number; question: string; done: boolean }>('/api/agent-briefings', { method: 'POST' })

export const answerBriefing = (id: number, text: string) =>
  apiFetch<{ done: boolean; question: string | null; reason: string | null }>(`/api/agent-briefings/${id}/answer`, {
    method: 'POST', body: JSON.stringify({ text }),
  })

// Usada quando a IA falha DEPOIS de a resposta ja ter sido gravada: pede so a
// proxima pergunta, sem reenviar o texto (reenviar duplicaria o turno).
export const retryNextQuestion = (id: number) =>
  apiFetch<{ done: boolean; question: string | null; reason: string | null }>(`/api/agent-briefings/${id}/next-question`, {
    method: 'POST',
  })

export const pasteIntoBriefing = (id: number, text: string) =>
  apiFetch<{ ok: true }>(`/api/agent-briefings/${id}/paste`, { method: 'POST', body: JSON.stringify({ text }) })

export const compileBriefing = (id: number) =>
  apiFetch<{ compiled: CompiledAgent }>(`/api/agent-briefings/${id}/compile`, { method: 'POST' })

export const activateBriefing = (id: number, mode: 'auto' | 'copilot' | 'sdr' = 'copilot', instanceIds: number[] = []) =>
  apiFetch<{ agent_id: number }>(`/api/agent-briefings/${id}/activate`, {
    method: 'POST', body: JSON.stringify({ mode, instance_ids: instanceIds }),
  })

export const fetchBriefing = (id: number) =>
  apiFetch<{ briefing: AgentBriefing }>(`/api/agent-briefings/${id}`).then(r => r.briefing)

export const fetchBriefingDrafts = () =>
  apiFetch<{ drafts: BriefingDraft[] }>('/api/agent-briefings').then(r => r.drafts)

export const deleteBriefing = (id: number) =>
  apiFetch<{ ok: true }>(`/api/agent-briefings/${id}`, { method: 'DELETE' })

export const briefingFromAgent = (agentId: number) =>
  apiFetch<{ briefing_id: number }>(`/api/agent-briefings/from-agent/${agentId}`, { method: 'POST' })
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`
Expected: build conclui sem erro de TypeScript.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: cliente de api da entrevista do agente"
```

---

### Task 12: Tela cheia da entrevista

**Files:**
- Create: `src/pages/AgentInterview.tsx`
- Modify: `src/App.tsx` (rota `/agents/interview/:briefingId?`)

**Interfaces:**
- Consumes: as funções da task 11.
- Produces: a rota `/agents/interview` (nova entrevista) e `/agents/interview/:briefingId` (retomar rascunho). Ao terminar, navega para `/agents/resumo/:briefingId` (task 13).

Tela cheia, não modal — o modal de hoje é justamente o que assusta.

- [ ] **Step 1: Write the page**

Create `src/pages/AgentInterview.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Send, Loader, ClipboardPaste } from 'lucide-react'
import { startBriefing, answerBriefing, retryNextQuestion, fetchBriefing, pasteIntoBriefing, type BriefingTurn } from '../lib/api'

export default function AgentInterview() {
  const navigate = useNavigate()
  const { briefingId: paramId } = useParams()
  const [briefingId, setBriefingId] = useState<number | null>(paramId ? Number(paramId) : null)
  const [turns, setTurns] = useState<BriefingTurn[]>([])
  const [texto, setTexto] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [colando, setColando] = useState(false)
  const [podeTentarDeNovo, setPodeTentarDeNovo] = useState(false)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns, carregando])

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        if (paramId) {
          const b = await fetchBriefing(Number(paramId))
          if (cancelado) return
          setBriefingId(b.id)
          setTurns(b.turns)
        } else {
          const r = await startBriefing()
          if (cancelado) return
          setBriefingId(r.briefing_id)
          setTurns([{ id: 0, position: 1, role: 'ia', content: r.question, created_at: '' }])
        }
      } catch (e: any) {
        if (!cancelado) setErro(e.message || 'Nao consegui comecar a entrevista.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [paramId])

  async function enviar() {
    const t = texto.trim()
    if (!t || !briefingId || carregando) return
    setTexto('')
    setErro(null)
    setTurns(prev => [...prev, { id: -Date.now(), position: prev.length + 1, role: 'user', content: t, created_at: '' }])
    setCarregando(true)
    try {
      const r = await answerBriefing(briefingId, t)
      if (r.done) { navigate(`/agents/resumo/${briefingId}`); return }
      setTurns(prev => [...prev, { id: -Date.now() - 1, position: prev.length + 1, role: 'ia', content: r.question || '', created_at: '' }])
    } catch (e: any) {
      // A resposta ja foi gravada no servidor. Reenviar o texto duplicaria o
      // turno, entao o retry pede SO a proxima pergunta.
      setErro(e.message || 'A IA nao respondeu. Sua resposta esta salva.')
      setPodeTentarDeNovo(true)
    } finally {
      setCarregando(false)
    }
  }

  async function tentarDeNovo() {
    if (!briefingId || carregando) return
    setErro(null)
    setCarregando(true)
    try {
      const r = await retryNextQuestion(briefingId)
      if (r.done) { navigate(`/agents/resumo/${briefingId}`); return }
      setTurns(prev => [...prev, { id: -Date.now() - 2, position: prev.length + 1, role: 'ia', content: r.question || '', created_at: '' }])
      setPodeTentarDeNovo(false)
    } catch (e: any) {
      setErro(e.message || 'A IA continua sem responder. Tente daqui a pouco.')
    } finally {
      setCarregando(false)
    }
  }

  async function colar() {
    const material = texto.trim()
    if (!material || !briefingId) return
    setColando(true)
    try {
      await pasteIntoBriefing(briefingId, material)
      setTexto('')
      setTurns(prev => [...prev, { id: -Date.now(), position: prev.length + 1, role: 'user', content: '(material enviado para a IA ler)', created_at: '' }])
    } catch (e: any) {
      setErro(e.message || 'Nao consegui guardar o material.')
    } finally {
      setColando(false)
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <h1 style={{ marginBottom: 4 }}>Vamos montar seu atendente</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: 24 }}>
        Responda como voce falaria com um funcionario novo. Pode ser informal.
      </p>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {turns.map(t => (
          <div key={t.id} style={{ alignSelf: t.role === 'ia' ? 'flex-start' : 'flex-end', maxWidth: '85%' }}>
            <div style={{
              padding: '12px 16px', borderRadius: 12, fontSize: 15, lineHeight: 1.5,
              background: t.role === 'ia' ? 'var(--bg-elevated)' : 'var(--accent)',
              color: t.role === 'ia' ? 'var(--text-primary)' : '#111',
            }}>{t.content}</div>
          </div>
        ))}
        {carregando && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)' }}>
            <Loader size={14} className="spin" /> pensando...
          </div>
        )}
        <div ref={fimRef} />
      </div>

      {erro && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080', marginBottom: 12 }}>
          <div>{erro}</div>
          {podeTentarDeNovo && (
            <button className="btn btn-sm btn-secondary" style={{ marginTop: 8 }} onClick={tentarDeNovo} disabled={carregando}>
              Tentar de novo
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', paddingTop: 16 }}>
        <textarea
          className="input"
          rows={3}
          value={texto}
          disabled={carregando}
          placeholder="Escreva sua resposta..."
          onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() } }}
          style={{ flex: 1, resize: 'vertical' }}
        />
        <button className="btn btn-secondary" onClick={colar} disabled={colando || carregando || !texto.trim()} title="Enviar como material para a IA ler">
          <ClipboardPaste size={16} />
        </button>
        <button className="btn btn-primary" onClick={enviar} disabled={carregando || !texto.trim()}>
          <Send size={16} />
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
        Enter envia · Shift+Enter quebra linha · o botao da prancheta manda um material inteiro para a IA ler
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

Em `src/App.tsx`, abra o arquivo e siga o padrão das rotas que já existem. Acrescente, dentro do mesmo bloco em que estão as outras rotas autenticadas:

```tsx
<Route path="/agents/interview" element={<AgentInterview />} />
<Route path="/agents/interview/:briefingId" element={<AgentInterview />} />
```

com o import no topo, no mesmo estilo dos outros:

```tsx
import AgentInterview from './pages/AgentInterview'
```

**Se o `App.tsx` usa layout com sidebar**, coloque estas duas rotas **fora** do layout: a entrevista é tela cheia. Se todas as rotas passam pelo layout, deixe dentro e **anote no relatório** que o "tela cheia" ficou parcial — não force uma reestruturação do roteador nesta task.

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AgentInterview.tsx src/App.tsx
git commit -m "feat: tela cheia da entrevista do agente"
```

---

### Task 13: Tela de resumo, ativar e corrigir

**Files:**
- Create: `src/pages/AgentBriefingSummary.tsx`
- Modify: `src/App.tsx` (rota `/agents/resumo/:briefingId`)

**Interfaces:**
- Consumes: `compileBriefing`, `activateBriefing`, `fetchBriefing` (task 11).
- Produces: a rota `/agents/resumo/:briefingId`. "Ativar" cria o agente e vai para `/agents`; "Corrigir algo" volta para `/agents/interview/:briefingId`.

- [ ] **Step 1: Write the page**

Create `src/pages/AgentBriefingSummary.tsx`:

```tsx
import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Loader, Check, MessageSquare, Settings } from 'lucide-react'
import { compileBriefing, activateBriefing, fetchBriefing, type CompiledAgent } from '../lib/api'

export default function AgentBriefingSummary() {
  const navigate = useNavigate()
  const { briefingId } = useParams()
  const id = Number(briefingId)
  const [compiled, setCompiled] = useState<CompiledAgent | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [ativando, setAtivando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    ;(async () => {
      try {
        // Se ja foi compilado antes, aproveita; senao compila agora.
        const b = await fetchBriefing(id)
        if (cancelado) return
        if (b.compiled_json) {
          setCompiled(JSON.parse(b.compiled_json))
        } else {
          const r = await compileBriefing(id)
          if (cancelado) return
          setCompiled(r.compiled)
        }
      } catch (e: any) {
        if (!cancelado) setErro(e.message || 'Nao consegui montar o resumo.')
      } finally {
        if (!cancelado) setCarregando(false)
      }
    })()
    return () => { cancelado = true }
  }, [id])

  async function ativar() {
    setAtivando(true)
    setErro(null)
    try {
      await activateBriefing(id, 'copilot')
      navigate('/agents')
    } catch (e: any) {
      setErro(e.message || 'Nao consegui ativar o atendente.')
      setAtivando(false)
    }
  }

  if (carregando) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 48, textAlign: 'center', color: 'var(--text-secondary)' }}>
        <Loader size={20} className="spin" />
        <p>Montando seu atendente com o que voce contou...</p>
      </div>
    )
  }

  if (erro && !compiled) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 48 }}>
        <div style={{ padding: 16, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080' }}>{erro}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => navigate(`/agents/interview/${id}`)}>
            <MessageSquare size={16} /> Voltar para a conversa
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/agents')}>
            <Settings size={16} /> Ir para ajustes avancados
          </button>
        </div>
      </div>
    )
  }

  const c = compiled!
  const bloco = (titulo: string, corpo: React.ReactNode) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 15, lineHeight: 1.6 }}>{corpo}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 16px' }}>
      <h1>Pronto, montei seu atendente</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: 0, marginBottom: 32 }}>
        Confira se ficou do jeito que voce quer. Se algo estiver errado, e so me falar.
      </p>

      {bloco('Quem eu sou', c.resumo.quem_sou)}
      {bloco('O que eu sei', c.resumo.o_que_sei)}
      {bloco('O que vou descobrir do lead', (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {c.resumo.o_que_descubro.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ))}
      {bloco('O que eu nunca falo', (
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {c.resumo.o_que_nunca_falo.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      ))}

      {erro && (
        <div style={{ padding: 12, borderRadius: 8, background: 'rgba(255,80,80,0.12)', color: '#ff8080', marginBottom: 16 }}>{erro}</div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={ativar} disabled={ativando}>
          {ativando ? <Loader size={16} className="spin" /> : <Check size={16} />} Ta certo, ativar
        </button>
        <button className="btn btn-secondary" onClick={() => navigate(`/agents/interview/${id}`)} disabled={ativando}>
          <MessageSquare size={16} /> Corrigir algo
        </button>
      </div>

      <p style={{ marginTop: 24, fontSize: 13 }}>
        <a href="#" onClick={e => { e.preventDefault(); navigate('/agents') }} style={{ color: 'var(--text-secondary)' }}>
          ajustes avancados &gt;
        </a>
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        O atendente nasce em modo Copiloto: ele so sugere a resposta no Chat, o vendedor revisa e envia.
        Nada e enviado sozinho enquanto voce nao trocar o modo.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

Em `src/App.tsx`, junto das rotas da task 12:

```tsx
import AgentBriefingSummary from './pages/AgentBriefingSummary'
```

```tsx
<Route path="/agents/resumo/:briefingId" element={<AgentBriefingSummary />} />
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AgentBriefingSummary.tsx src/App.tsx
git commit -m "feat: tela de resumo do agente com ativar e corrigir"
```

---

### Task 14: Página Agentes com rascunhos e os dois caminhos

**Files:**
- Modify: `src/pages/Agents.tsx`

**Interfaces:**
- Consumes: `fetchBriefingDrafts`, `deleteBriefing`, `briefingFromAgent` (task 11).
- Produces: nada para outras tasks. É a última.

Mudanças: o botão "+ Novo Agente" passa a levar para a entrevista; os rascunhos aparecem como cartões separados; cada agente existente ganha "Conversar com a IA" ao lado do lápis (que continua abrindo as 8 abas).

- [ ] **Step 1: Read the page first**

Leia `src/pages/Agents.tsx` inteiro (222 linhas) antes de editar. Você precisa ver como os cartões de agente são renderizados e como o `AgentEditorModal` é aberto, para encaixar sem quebrar o que existe.

- [ ] **Step 2: Point "+ Novo Agente" at the interview**

Troque o `onClick` do botão "+ Novo Agente" — que hoje abre o `AgentEditorModal` com agente novo — por `navigate('/agents/interview')`. Acrescente `const navigate = useNavigate()` e o import `import { useNavigate } from 'react-router-dom'` se ainda não houver.

O modal **continua existindo** para editar agente que já existe. Só o caminho de criação muda.

- [ ] **Step 3: Show drafts above the agent list**

Acrescente o estado e a carga junto do carregamento dos agentes que já existe:

```tsx
const [drafts, setDrafts] = useState<BriefingDraft[]>([])

// dentro da mesma funcao que ja carrega os agentes:
fetchBriefingDrafts().then(setDrafts).catch(() => setDrafts([]))
```

com os imports `import { fetchBriefingDrafts, deleteBriefing, briefingFromAgent, type BriefingDraft } from '../lib/api'`.

Renderize acima da lista de agentes:

```tsx
{drafts.length > 0 && (
  <div style={{ marginBottom: 24 }}>
    <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
      Entrevistas em andamento
    </div>
    {drafts.map(d => (
      <div key={d.id} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: 12, marginBottom: 8, borderRadius: 8,
        border: '1px dashed var(--border-medium)', background: 'transparent',
      }}>
        <div>
          <strong style={{ fontSize: 14 }}>Rascunho</strong>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {d.first_answer || 'ainda sem resposta'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm btn-primary" onClick={() => navigate(
            d.status === 'compilado' ? `/agents/resumo/${d.id}` : `/agents/interview/${d.id}`
          )}>Continuar</button>
          <button className="btn btn-sm btn-secondary" onClick={async () => {
            await deleteBriefing(d.id)
            setDrafts(prev => prev.filter(x => x.id !== d.id))
          }}>Apagar</button>
        </div>
      </div>
    ))}
  </div>
)}
```

**Não use `confirm()` no botão Apagar.** O padrão do arquivo pode usar `confirm`; aqui não, porque um diálogo do navegador trava a automação de teste. Se quiser confirmação, faça um segundo clique ("Apagar" -> "Confirmar?") com estado local.

- [ ] **Step 4: Add "Conversar com a IA" to each existing agent card**

No bloco de botões de cada cartão de agente (hoje: lápis e lixeira), acrescente antes do lápis:

```tsx
<button className="btn btn-sm btn-secondary" title="Conversar com a IA para ajustar este atendente"
  onClick={async () => {
    const r = await briefingFromAgent(a.id)
    navigate(`/agents/interview/${r.briefing_id}`)
  }}>
  <MessageSquare size={14} />
</button>
```

com `MessageSquare` acrescentado ao import de `lucide-react` que já existe no arquivo.

- [ ] **Step 5: Verify it compiles**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 6: Verify in the running app**

```bash
npm run build && npm run dev:server
```

Abra `http://localhost:3002/crm/`, entre com `admin@drosagencia.com.br` / `dros2026`, conta **BG Imoveis**, menu **Agentes de IA**.

Confira, nesta ordem:
1. O botão "+ Novo Agente" leva para a tela cheia da entrevista.
2. Sem `ANTHROPIC_API_KEY_DROS` no `.env`, a entrevista mostra a mensagem sobre a chave da Dros — não um erro cru nem tela branca.
3. Com a chave no `.env` (`ANTHROPIC_API_KEY_DROS=sk-ant-...`), reinicie o servidor e responda a entrevista até o fim; confira que chega no resumo.
4. **Antes de clicar em "Ativar"**, rode e confirme que o agente ainda NÃO existe:
   ```bash
   node -e "const db=require('better-sqlite3')('server/data/crm.db',{readonly:true});console.log('agentes:',db.prepare('SELECT COUNT(*) c FROM ai_agents').get().c,'| briefings:',db.prepare('SELECT id,status,agent_id FROM agent_briefings').all())"
   ```
   Esperado: a contagem de agentes é a mesma de antes da entrevista, e o briefing está `compilado` com `agent_id` nulo. **Se um agente já existir aqui, pare: a regra de segurança do spec foi violada.**
5. Clique em "Ativar" e rode o comando de novo: agora existe um agente a mais e o briefing está `ativo` com `agent_id` preenchido.
6. Volte para Agentes, clique no botão de conversa de um agente já existente e confirme que abre a entrevista com o histórico dele.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Agents.tsx
git commit -m "feat: pagina de agentes com rascunhos de entrevista e conversa com a IA"
```

---

## Depois deste plano

**Plano 2 (fontes que faltam):** `briefingSources/website.js` (lê o site da empresa) e `briefingSources/crmHistory.js` (lê as 30 conversas mais recentes que avançaram de etapa, truncadas em 40 mensagens). Ambos implementam a mesma interface fixada na task 4 e entram no briefing pela mesma tabela — o compilador não muda.

**Antes de qualquer deploy:** `ANTHROPIC_API_KEY_DROS` tem que estar no `/root/.env` da VPS, junto do `DEEPGRAM_API_KEY`. Sem ela, o recurso inteiro responde 503.

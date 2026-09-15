# Copiloto — Plano A: Fundação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação do Copiloto e do SDR: seletor Automático / Copiloto / SDR, liga/desliga do agente, pausa da IA por conversa, análise de venda obrigatória gravada no lead, trava de mudança de etapa no código, sugestão da IA na caixa do Chat (com agrupamento de 40s) e passagem do SDR para o vendedor quando a qualificação fecha.

**Architecture:** A lógica nova fica em módulos pequenos e puros em `server/services/` (sem importar `server/db.js`; quem precisa de banco recebe `db` por parâmetro), testados com `node:test` e `better-sqlite3` em memória. O `aiAgent.js` passa a consultar esses módulos para decidir o modo efetivo, registrar a análise, aplicar a trava e escolher entre enviar (`auto`/`sdr`) ou gravar sugestão (`copilot`). O webhook troca a chamada direta da IA por UMA chamada a `scheduleAiForInbound` (arquivo novo), que agrupa mensagens por 40s no Copiloto. O Chat lê a sugestão pendente pela API nova `/api/copilot` e reage ao evento SSE `lead:ai_suggestion`.

**Tech Stack:** Node 16.20.2 (produção) / Node 20 (local), Express 4, better-sqlite3 10, `node:test` + `node:assert/strict`, React 19 + Vite 4 + TypeScript, SSE.

**Spec:** docs/superpowers/specs/2026-09-15-copiloto-agente-ia-design.md

## Global Constraints

- Produção roda Node 16.20.2 no CentOS 7: só APIs disponíveis no Node 16 (nada de `structuredClone`, `fetch` global, `mock.timers` do `node:test`, `--test` com glob).
- Sem dependências novas no `package.json` (só o script `test`).
- Versões travadas: `vite ^4.5.5`, `better-sqlite3 ^10.1.0`, `express ^4.21.0`, `@vitejs/plugin-react ^4.2.1` — não mexer.
- Default no deploy: `ai_agents.mode = 'auto'` e `accounts.ai_key_source = 'client'` (ninguém vira Copiloto/SDR nem troca de chave sozinho).
- As regras de venda, a análise obrigatória e a trava de etapa/qualificação valem em TODOS os modos (`auto`, `copilot`, `sdr`). Decisão do CEO: o robô Automático atual muda de comportamento no deploy (ver Decisão 1).
- No modo Copiloto nada é enviado ao lead sem o vendedor: a IA só grava `ai_suggestions`.
- Toda query nova filtra por conta (`account_id`), inclusive nas funções de serviço.
- Módulos novos testáveis NÃO importam `server/db.js` (ele abre `server/data/crm.db` ao ser importado); recebem `db` por parâmetro.
- Testes: `npm test` (= `node --test test/`), arquivos em `test/*.test.js`, banco `new Database(':memory:')`.
- Mensagens de commit em português com prefixo `feat:` / `fix:` / `refactor:` / `test:`.
- Sem emojis em código (strings de UI podem ter acento; strings de servidor seguem o padrão atual sem acento).
- Mudança em `server/routes/webhooks.js` deve ser mínima (outro plano vai extrair `webhooks.js:422-708` para `server/services/inboundHandler.js`).
- Front: não reorganizar abas do `AgentEditorModal.tsx` (outro plano faz isso); `npm run build` tem que passar.
- Toda rota nova usa `authenticate` + `scopeToAccount` e checa acesso ao lead como as rotas de leads (`canAtendenteAccessLead` para atendente).

## Decisões de desenho (validar com o dono)

1. **Motor de venda em TODOS os modos (decidido pelo CEO).** Regras de venda, análise obrigatória e trava de etapa/qualificação valem em `auto`, `copilot` e `sdr`. O CEO aceita que o robô Automático atual dos clientes mude de comportamento no deploy (passa a registrar análise, contornar preço antes da hora e só mover etapa / transferir como "qualificado" com a qualificação completa; cada resposta pode custar uma chamada extra de IA quando a análise não vier junto). Nas palavras do CEO: o robô é o **"Dros Sales"**, um robô de atendimento da Dros que depois será conectado em qualquer conta; o fluxo é **pré-atendimento → validar os dados do cliente e se está dentro do ICP → passar para o especialista**. `usesSalesEngine(agent)` continua existindo como ponto único de decisão e devolve `true` para todos os modos.
2. **Análise obrigatória sem chamada extra na maioria das vezes.** A ferramenta `record_analysis` vai junto com as outras em `tool_choice: 'auto'`. Se a IA responder texto sem chamar a análise, o código faz UMA chamada forçada (`tool_choice: {type:'tool', name:'record_analysis'}`). Se a IA devolver texto + só a análise, o laço para ali (não gasta outra volta).
3. **Trava vale para `move_stage` e para `transfer_to_human(reason="qualified")`.** Sem análise registrada = recusado. Se o agente tem texto de qualificação e a IA devolveu lista de critérios vazia = recusado.
4. **SDR sem nada para qualificar não passa sozinho.** A passagem automática exige pelo menos 1 campo obrigatório ou 1 critério avaliado, para não entregar o lead na primeira mensagem.
5. **Resumo da qualificação vai como nota do lead** (`lead_notes`, autor = usuário-robô do agente). A notificação de WhatsApp de `notifyAndOpenLead` continua igual (não foi alterada neste plano).
6. **Lead com atendente humano ou já passado (`ai_handed_off_at`)** só é atendido por agentes `copilot`/`sdr`, sempre como Copiloto. Agente `copilot` ignora o modo de ativação (ele não é o atendente).
7. **Copiloto não repete a IA à toa:** se já existe sugestão pendente (nenhuma mensagem nova do lead desde ela), `processInboundMessage` sai sem chamar a IA. Isso evita que o `botAutoRescue` (a cada 30 min) gaste IA de novo no mesmo lead.
8. **`ai_key_source = 'dros'` sem `ANTHROPIC_API_KEY_DROS` no `.env` = sem chave** (não cai na chave do cliente). Só `super_admin` troca, pela aba Identidade do agente (select visível só para ele).
9. **"Há uma sugestão — ver"**: clicar em "ver" troca o texto da caixa pela sugestão.
10. **Grupo de 40s usa o tipo da última mensagem.** Se o bloco tiver um áudio seguido de texto, o áudio não é transcrito naquela análise (o histórico mostra `[Audio]`).
11. **Desligar o atendimento passa os leads na hora (decidido pelo CEO, Task 10).** "Lead com a IA" = ativo, sem `ai_handed_off_at`, com o robô do agente como atendente, ou sem atendente humano e com mensagem enviada por esse agente. "Vendedor responsável" = atendente humano ativo da conversa naquela instância; senão o atendente padrão humano da instância; senão a roleta (via `executeHandoff` sem regra `agent_off`). Todos recebem `ai_handed_off_at`, a nota "IA desligada — assuma a conversa" e a notificação de sempre (`notifyAndOpenLead`). Religar não devolve esses leads para a IA.

---

## Mapa de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `test/helpers/memoryDb.js` | Cria banco em memória com tabelas mínimas (`accounts`, `users`, `ai_agents`, `leads`, `lead_notes`) + schema do Copiloto; semeia conta/usuário/agente/lead. |
| `test/copilotSchema.test.js` | Testa colunas, defaults e idempotência do schema. |
| `server/services/copilotSchema.js` | `applyCopilotSchema(db)`: colunas novas e tabela `ai_suggestions`. |
| `server/services/anthropicKeyPicker.js` | `pickAnthropicKey(account, env)`: escolhe a chave conforme `ai_key_source`. |
| `test/anthropicKeyPicker.test.js` | Testes da escolha de chave. |
| `server/services/copilotMode.js` | Modos do agente: `AGENT_MODES`, `normalizeAgentMode`, `resolveEffectiveMode`, `usesSalesEngine`, `deliveryActionForMode`, `agentAcceptsLead`. |
| `test/copilotMode.test.js` | Testes dos modos. |
| `server/services/salesAnalysis.js` | Ferramenta `record_analysis`, parser, trava de etapa, textos de recusa/resumo/regras de venda, `saveLeadAnalysis(db, ...)`. |
| `test/salesAnalysis.test.js` | Testes do parser, trava, textos e gravação. |
| `server/services/aiSuggestions.js` | CRUD de `ai_suggestions` (criar, ler pendente, resolver, expirar por lead/agente). |
| `server/services/leadAiPause.js` | Pausar/retomar IA numa conversa. |
| `test/aiSuggestions.test.js` | Testes de sugestões e pausa. |
| `server/services/leadDebouncer.js` | `createDebouncer(...)`: timer por chave com cancelamento (puro, timers injetáveis). |
| `test/leadDebouncer.test.js` | Testes do agrupamento com relógio falso. |
| `server/services/copilotScheduler.js` | `scheduleAiForInbound(lead, content, mediaType, instanceId)` + cancelamentos; liga webhook -> IA. |
| `server/routes/copilot.js` | API `/api/copilot`: sugestão pendente, resolver sugestão, pausar/retomar IA. |
| `server/services/agentShutdown.js` | Desligar o atendimento: `AGENT_OFF_NOTE`, `findLeadsHeldByAgent(db, ...)`, `findResponsibleHumanId(db, ...)`. |
| `test/agentShutdown.test.js` | Testes de quais leads estão com a IA e de quem é o vendedor responsável. |

**Modificar**

| Arquivo | O que muda |
|---|---|
| `package.json` | Script `"test": "node --test test/"`. |
| `server/db.js` | Importa e chama `applyCopilotSchema(db)` antes do `export default db` (L1424). |
| `server/services/anthropicClient.js` | `resolveAnthropicKey` (L19-24) usa `pickAnthropicKey`. |
| `server/services/aiAgent.js` | `findAgentForLead` (L42-99), `diagnoseForceAi` (L111-122), `buildSystemPrompt` (L184-250), `getToolsForAgent` (L333-381), `executeTool` (L385-417), `processInboundMessage` (L423-672) (Task 7); nova `releaseLeadsFromAgent` no fim do arquivo (Task 10). |
| `server/routes/webhooks.js` | Import (L7) e bloco da IA (L685-693) viram UMA chamada a `scheduleAiForInbound`. |
| `server/routes/agents.js` | `has_api_key` (L75-76), `mode` no POST (L112-156) e PUT (L204-234), expiração de sugestões ao trocar modo (Task 9) e desligamento completo ao desligar/apagar: `shutdownAgentAttendance` no PUT, toggle-active (L291-299) e DELETE (L346-348) (Task 10). |
| `server/routes/accounts.js` | `ai_key_source` no `PUT /:id` (L67, L96-98). |
| `server/index.js` | Monta `/api/copilot` (L31 import, L81 rota). |
| `src/context/SSEContext.tsx` | Escuta `lead:ai_suggestion` (L29). |
| `src/lib/api.ts` | Tipos (`Account`, `Lead`, `Agent`, `AgentInput`, `AgentMode`, `AiSuggestion`) e fetchers do Copiloto (Task 11); `released_leads` no retorno de `toggleAgentActive` (Task 12). |
| `src/components/AgentEditorModal.tsx` | Interruptor "Atendimento ligado/desligado", seletor "Como a IA atua" e select de chave (super_admin) na aba Identidade. |
| `src/pages/Agents.tsx` | Botão do card vira "Atendimento ligado/desligado", com confirmação e aviso de quantos leads foram para o vendedor. |
| `src/pages/Chat.tsx` | Sugestão na caixa com etiqueta, linha "Há uma sugestão — ver", selo de chance/trava, botão Pausar/Retomar IA, aviso de enviada/editada/descartada, rótulo `ai_qualified` no histórico. |

---

### Task 1: Infra de testes + schema do Copiloto

**Files:**
- Modify: `package.json:6-12` (bloco `scripts`)
- Create: `server/services/copilotSchema.js`
- Modify: `server/db.js:1-4` (imports) e `server/db.js:1424` (`export default db`)
- Create: `test/helpers/memoryDb.js`
- Test: `test/copilotSchema.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `applyCopilotSchema(db: Database): void`
  - `createTestDb(): Database` (em memória, já com schema do Copiloto)
  - `seedAccountAndLead(db, opts?: { accountName?: string }): { accountId: number, userId: number, agentId: number, leadId: number }`
  - Colunas: `ai_agents.mode` (`'auto'`), `accounts.ai_key_source` (`'client'`), `leads.ai_close_chance`, `leads.ai_main_blocker`, `leads.ai_criteria_json`, `leads.ai_moment`, `leads.ai_msgs_since_analysis` (0), `leads.ai_paused_at`, `leads.ai_paused_by`; tabela `ai_suggestions`.

- [ ] **Step 1: Adicionar o script de teste**

Em `package.json`, dentro de `"scripts"`, depois de `"preview": "vite preview"`:

```json
    "preview": "vite preview",
    "test": "node --test test/"
```

- [ ] **Step 2: Criar o helper de banco em memória**

`test/helpers/memoryDb.js`:

```js
// Banco SQLite em memoria para testes. NAO importa server/db.js (ele abre o banco real).
import Database from 'better-sqlite3'
import { applyCopilotSchema } from '../../server/services/copilotSchema.js'

export function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      anthropic_api_key TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      name TEXT NOT NULL
    );
    CREATE TABLE ai_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      name TEXT, email TEXT, phone TEXT, city TEXT, empresa TEXT, instagram TEXT,
      ai_handed_off_at TEXT
    );
    CREATE TABLE lead_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  applyCopilotSchema(db)
  return db
}

export function seedAccountAndLead(db, { accountName = 'Conta Teste' } = {}) {
  const accountId = Number(db.prepare('INSERT INTO accounts (name) VALUES (?)').run(accountName).lastInsertRowid)
  const userId = Number(db.prepare('INSERT INTO users (account_id, name) VALUES (?, ?)').run(accountId, 'Vendedor').lastInsertRowid)
  const agentId = Number(db.prepare('INSERT INTO ai_agents (account_id, user_id, name) VALUES (?, ?, ?)').run(accountId, userId, 'Agente').lastInsertRowid)
  const leadId = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(accountId, 'Lead Teste').lastInsertRowid)
  return { accountId, userId, agentId, leadId }
}
```

Observação: o Node trata qualquer `.js` dentro de `test/` como arquivo de teste; o helper roda como "arquivo sem testes" e não falha.

- [ ] **Step 3: Escrever o teste que falha**

`test/copilotSchema.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { applyCopilotSchema } from '../server/services/copilotSchema.js'

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
}

test('schema cria colunas novas em ai_agents, accounts e leads', () => {
  const db = createTestDb()
  assert.ok(columns(db, 'ai_agents').includes('mode'))
  assert.ok(columns(db, 'accounts').includes('ai_key_source'))
  for (const col of ['ai_close_chance', 'ai_main_blocker', 'ai_criteria_json', 'ai_moment', 'ai_msgs_since_analysis', 'ai_paused_at', 'ai_paused_by']) {
    assert.ok(columns(db, 'leads').includes(col), `faltou leads.${col}`)
  }
})

test('defaults nao mudam comportamento: mode auto, ai_key_source client, contador 0', () => {
  const db = createTestDb()
  const { accountId, agentId, leadId } = seedAccountAndLead(db)
  assert.equal(db.prepare('SELECT mode FROM ai_agents WHERE id = ?').get(agentId).mode, 'auto')
  assert.equal(db.prepare('SELECT ai_key_source FROM accounts WHERE id = ?').get(accountId).ai_key_source, 'client')
  assert.equal(db.prepare('SELECT ai_msgs_since_analysis FROM leads WHERE id = ?').get(leadId).ai_msgs_since_analysis, 0)
})

test('tabela ai_suggestions tem as colunas do spec e defaults pending/reply/ai', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const expected = ['id', 'account_id', 'lead_id', 'agent_id', 'kind', 'source', 'ready_message_id', 'content', 'payload_json', 'status', 'final_content', 'lead_follow_up_id', 'outcome_replied', 'outcome_advanced', 'outcome_checked_at', 'created_at', 'resolved_at', 'resolved_by']
  assert.deepEqual(columns(db, 'ai_suggestions').sort(), [...expected].sort())
  const id = db.prepare('INSERT INTO ai_suggestions (account_id, lead_id, agent_id, content) VALUES (?, ?, ?, ?)').run(accountId, leadId, agentId, 'oi').lastInsertRowid
  const row = db.prepare('SELECT status, kind, source FROM ai_suggestions WHERE id = ?').get(id)
  assert.deepEqual({ ...row }, { status: 'pending', kind: 'reply', source: 'ai' })
})

test('applyCopilotSchema e idempotente', () => {
  const db = createTestDb()
  assert.doesNotThrow(() => applyCopilotSchema(db))
  assert.doesNotThrow(() => applyCopilotSchema(db))
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/copilotSchema.js`.

- [ ] **Step 5: Implementar o schema**

`server/services/copilotSchema.js`:

```js
// Schema do Copiloto (Plano A). Recebe o db por parametro para ser testavel em memoria.
// Segue o padrao de server/db.js: addColumnIfNotExists + CREATE TABLE IF NOT EXISTS.

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}

export function applyCopilotSchema(db) {
  // Como a IA atua: 'auto' (envia sozinha, comportamento atual) | 'copilot' (so sugere) | 'sdr'
  addColumnIfNotExists(db, 'ai_agents', 'mode', "TEXT NOT NULL DEFAULT 'auto'")
  // De onde vem a chave Anthropic: 'client' (accounts.anthropic_api_key) | 'dros' (ANTHROPIC_API_KEY_DROS)
  addColumnIfNotExists(db, 'accounts', 'ai_key_source', "TEXT NOT NULL DEFAULT 'client'")
  // Ultima analise de venda da IA no lead
  addColumnIfNotExists(db, 'leads', 'ai_close_chance', 'INTEGER')
  addColumnIfNotExists(db, 'leads', 'ai_main_blocker', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_criteria_json', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_moment', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_msgs_since_analysis', 'INTEGER DEFAULT 0')
  // Pausa da IA nesta conversa
  addColumnIfNotExists(db, 'leads', 'ai_paused_at', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'ai_paused_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL')

  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id         INTEGER NOT NULL,
      lead_id            INTEGER NOT NULL,
      agent_id           INTEGER,
      kind               TEXT NOT NULL DEFAULT 'reply',
      source             TEXT NOT NULL DEFAULT 'ai',
      ready_message_id   INTEGER,
      content            TEXT NOT NULL,
      payload_json       TEXT,
      status             TEXT NOT NULL DEFAULT 'pending',
      final_content      TEXT,
      lead_follow_up_id  INTEGER,
      outcome_replied    INTEGER,
      outcome_advanced   INTEGER,
      outcome_checked_at TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at        TEXT,
      resolved_by        INTEGER,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_lead ON ai_suggestions(lead_id, status);
    CREATE INDEX IF NOT EXISTS idx_ai_suggestions_account ON ai_suggestions(account_id, created_at);
  `)
}
```

- [ ] **Step 6: Ligar o schema no banco real**

Em `server/db.js`, depois da linha 4 (`import { dirname, resolve } from 'path'`):

```js
import { applyCopilotSchema } from './services/copilotSchema.js'
```

E trocar a última linha (L1424) `export default db` por:

```js
// Copiloto do Agente de IA (modo, chave, analise no lead, pausa, ai_suggestions)
applyCopilotSchema(db)

export default db
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test`
Expected: PASS — `# pass 4`, `# fail 0`.

Run: `node --check server/db.js`
Expected: sem saída (sintaxe OK).

- [ ] **Step 8: Commit**

```bash
git add package.json server/services/copilotSchema.js server/db.js test/helpers/memoryDb.js test/copilotSchema.test.js
git commit -m "feat: schema do copiloto (modo do agente, chave, analise no lead, pausa, ai_suggestions) e infra de testes"
```

---

### Task 2: Chave Anthropic por `ai_key_source`

**Files:**
- Create: `server/services/anthropicKeyPicker.js`
- Modify: `server/services/anthropicClient.js:5-24`
- Modify: `server/services/aiAgent.js:10` (imports), `server/services/aiAgent.js:51` (`findAgentForLead`) e `server/services/aiAgent.js:111` (`diagnoseForceAi`)
- Modify: `server/routes/agents.js:6` (imports) e `server/routes/agents.js:75-76` (`GET /`)
- Test: `test/anthropicKeyPicker.test.js`

**Interfaces:**
- Consumes: coluna `accounts.ai_key_source` (Task 1).
- Produces: `pickAnthropicKey(account: { anthropic_api_key?: string|null, ai_key_source?: string|null } | null, env?: object): string | null`

- [ ] **Step 1: Escrever o teste que falha**

`test/anthropicKeyPicker.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAnthropicKey } from '../server/services/anthropicKeyPicker.js'

test('client (ou vazio) usa a chave da conta, sem espacos', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: '  sk-cliente  ', ai_key_source: 'client' }, {}), 'sk-cliente')
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente' }, {}), 'sk-cliente')
})

test('client sem chave devolve null (sem fallback para a Dros)', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: '   ', ai_key_source: 'client' }, { ANTHROPIC_API_KEY_DROS: 'sk-dros' }), null)
})

test('dros usa ANTHROPIC_API_KEY_DROS', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente', ai_key_source: 'dros' }, { ANTHROPIC_API_KEY_DROS: ' sk-dros ' }), 'sk-dros')
})

test('dros sem a variavel devolve null (nao cai na chave do cliente)', () => {
  assert.equal(pickAnthropicKey({ anthropic_api_key: 'sk-cliente', ai_key_source: 'dros' }, {}), null)
})

test('conta inexistente devolve null', () => {
  assert.equal(pickAnthropicKey(null, { ANTHROPIC_API_KEY_DROS: 'sk-dros' }), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/anthropicKeyPicker.test.js` com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`server/services/anthropicKeyPicker.js`:

```js
// Escolhe a chave Anthropic da conta conforme accounts.ai_key_source.
// 'client' (default): chave propria da conta. 'dros': chave central ANTHROPIC_API_KEY_DROS (/root/.env).
// Sem fallback entre as duas: se a fonte escolhida nao tem chave, a IA nao roda.
export function pickAnthropicKey(account, env = process.env) {
  if (!account) return null
  if (account.ai_key_source === 'dros') {
    const central = String((env && env.ANTHROPIC_API_KEY_DROS) || '').trim()
    return central || null
  }
  const own = String(account.anthropic_api_key || '').trim()
  return own || null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Usar no `resolveAnthropicKey`**

Em `server/services/anthropicClient.js`, depois de `import db from '../db.js'` (L6):

```js
import { pickAnthropicKey } from './anthropicKeyPicker.js'
```

Trocar a função `resolveAnthropicKey` inteira (L19-24) por:

```js
export function resolveAnthropicKey(accountId) {
  if (!accountId) return null
  const acc = db.prepare('SELECT anthropic_api_key, ai_key_source FROM accounts WHERE id = ?').get(accountId)
  return pickAnthropicKey(acc)
}
```

- [ ] **Step 6: Usar nos bloqueios do agente e na lista de agentes**

Em `server/services/aiAgent.js`, depois de `import { transcribeAudio, fetchAudioBuffer } from './deepgramClient.js'` (L10):

```js
import { pickAnthropicKey } from './anthropicKeyPicker.js'
```

Em `findAgentForLead`, trocar:

```js
  if (!account.anthropic_api_key?.trim()) {
```

por:

```js
  if (!pickAnthropicKey(account)) {
```

Em `diagnoseForceAi`, trocar:

```js
  if (!account.anthropic_api_key?.trim()) blockers.push('Conta sem API Anthropic configurada (cadastre o token em Integracoes)')
```

por:

```js
  if (!pickAnthropicKey(account)) blockers.push(account.ai_key_source === 'dros' ? 'Conta usa a chave da Dros, mas ANTHROPIC_API_KEY_DROS nao esta no .env' : 'Conta sem API Anthropic configurada (cadastre o token em Integracoes)')
```

Em `server/routes/agents.js`, depois de `import { replayLastMessagesForAgent } from '../services/aiAgent.js'` (L6):

```js
import { pickAnthropicKey } from '../services/anthropicKeyPicker.js'
```

E trocar L75-76:

```js
  const acc = db.prepare('SELECT anthropic_api_key FROM accounts WHERE id = ?').get(req.accountId)
  const has_api_key = !!acc?.anthropic_api_key?.trim()
```

por:

```js
  const acc = db.prepare('SELECT anthropic_api_key, ai_key_source FROM accounts WHERE id = ?').get(req.accountId)
  const has_api_key = !!pickAnthropicKey(acc)
```

- [ ] **Step 7: Verificar sintaxe e testes**

Run: `node --check server/services/anthropicClient.js && node --check server/services/aiAgent.js && node --check server/routes/agents.js && npm test`
Expected: nenhuma saída dos `--check`; testes `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add server/services/anthropicKeyPicker.js server/services/anthropicClient.js server/services/aiAgent.js server/routes/agents.js test/anthropicKeyPicker.test.js
git commit -m "feat: chave anthropic respeita ai_key_source (cliente ou Dros)"
```

---

### Task 3: Modos do agente (Automático / Copiloto / SDR)

**Files:**
- Create: `server/services/copilotMode.js`
- Test: `test/copilotMode.test.js`

**Interfaces:**
- Consumes: nada (funções puras).
- Produces:
  - `AGENT_MODES: ['auto', 'copilot', 'sdr']`
  - `normalizeAgentMode(value: any): 'auto'|'copilot'|'sdr'` (inválido vira `'auto'`)
  - `resolveEffectiveMode(agent: { mode }, lead: { ai_handed_off_at }, attendantIsHuman?: boolean): 'auto'|'copilot'|'sdr'`
  - `usesSalesEngine(agent: { mode }): boolean` (devolve `true` em todos os modos — decisão do CEO)
  - `deliveryActionForMode(mode: string): 'send'|'suggest'`
  - `agentAcceptsLead(agent: { mode, activation_mode, user_id }, lead: { attendant_id, ai_handed_off_at }, attendantIsHuman: boolean): boolean`

- [ ] **Step 1: Escrever o teste que falha**

`test/copilotMode.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AGENT_MODES, normalizeAgentMode, resolveEffectiveMode, usesSalesEngine,
  deliveryActionForMode, agentAcceptsLead,
} from '../server/services/copilotMode.js'

test('AGENT_MODES e normalizeAgentMode', () => {
  assert.deepEqual(AGENT_MODES, ['auto', 'copilot', 'sdr'])
  assert.equal(normalizeAgentMode('copilot'), 'copilot')
  assert.equal(normalizeAgentMode('sdr'), 'sdr')
  assert.equal(normalizeAgentMode(undefined), 'auto')
  assert.equal(normalizeAgentMode('qualquer'), 'auto')
})

test('resolveEffectiveMode: auto, copilot e sdr antes/depois da passagem', () => {
  assert.equal(resolveEffectiveMode({ mode: 'auto' }, {}), 'auto')
  assert.equal(resolveEffectiveMode({ mode: 'copilot' }, {}), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, { ai_handed_off_at: null }), 'sdr')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, { ai_handed_off_at: '2026-09-15 10:00:00' }), 'copilot')
  assert.equal(resolveEffectiveMode({ mode: 'sdr' }, {}, true), 'copilot')
})

test('usesSalesEngine vale para todos os modos (Dros Sales)', () => {
  assert.equal(usesSalesEngine({ mode: 'auto' }), true)
  assert.equal(usesSalesEngine({}), true)
  assert.equal(usesSalesEngine({ mode: 'copilot' }), true)
  assert.equal(usesSalesEngine({ mode: 'sdr' }), true)
})

test('deliveryActionForMode: passo 13 por modo', () => {
  assert.equal(deliveryActionForMode('auto'), 'send')
  assert.equal(deliveryActionForMode('sdr'), 'send')
  assert.equal(deliveryActionForMode('copilot'), 'suggest')
})

test('agentAcceptsLead: auto mantem as regras atuais de ativacao', () => {
  const agent = { mode: 'auto', user_id: 9 }
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'default_attendant' }, { attendant_id: null }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'default_attendant' }, { attendant_id: 9 }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'roulette' }, { attendant_id: null }, false), false)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'roulette' }, { attendant_id: 9 }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'conditional' }, { attendant_id: null }, false), true)
  assert.equal(agentAcceptsLead({ ...agent, activation_mode: 'manual' }, { attendant_id: 3 }, false), false)
})

test('agentAcceptsLead: lead com humano ou ja passado so aceita copilot/sdr', () => {
  const handed = { attendant_id: 3, ai_handed_off_at: '2026-09-15 10:00:00' }
  assert.equal(agentAcceptsLead({ mode: 'auto', activation_mode: 'conditional', user_id: 9 }, handed, true), false)
  assert.equal(agentAcceptsLead({ mode: 'copilot', activation_mode: 'roulette', user_id: 9 }, handed, true), true)
  assert.equal(agentAcceptsLead({ mode: 'sdr', activation_mode: 'roulette', user_id: 9 }, handed, true), true)
  assert.equal(agentAcceptsLead({ mode: 'auto', activation_mode: 'conditional', user_id: 9 }, { attendant_id: 3 }, true), false)
})

test('agentAcceptsLead: copilot ignora o modo de ativacao', () => {
  assert.equal(agentAcceptsLead({ mode: 'copilot', activation_mode: 'manual', user_id: 9 }, { attendant_id: null }, false), true)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/copilotMode.test.js` com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`server/services/copilotMode.js`:

```js
// Modos do Agente de IA (spec 3.1 e 3.10). Funcoes puras.
// auto    = IA responde sozinha (comportamento atual)
// copilot = IA so sugere; o vendedor envia
// sdr     = IA responde sozinha ate qualificar; depois da passagem vira copilot naquele lead

export const AGENT_MODES = ['auto', 'copilot', 'sdr']

export function normalizeAgentMode(value) {
  return AGENT_MODES.includes(value) ? value : 'auto'
}

export function resolveEffectiveMode(agent, lead, attendantIsHuman = false) {
  const mode = normalizeAgentMode(agent && agent.mode)
  if (mode === 'copilot') return 'copilot'
  if (mode === 'sdr') {
    const humanOwned = !!(lead && lead.ai_handed_off_at) || !!attendantIsHuman
    return humanOwned ? 'copilot' : 'sdr'
  }
  return 'auto'
}

// Regras de venda + analise obrigatoria + trava de etapa/qualificacao.
// Decisao do CEO: valem em todos os modos (robo "Dros Sales": pre-atendimento -> valida dados e ICP -> especialista).
// Mantido como funcao para ser o ponto unico de decisao.
export function usesSalesEngine(_agent) {
  return true
}

// Passo 13 do processInboundMessage: enviar ao lead ou gravar sugestao.
export function deliveryActionForMode(mode) {
  return mode === 'copilot' ? 'suggest' : 'send'
}

// Substitui o trecho de findAgentForLead que decidia pelo atendente e pelo modo de ativacao.
export function agentAcceptsLead(agent, lead, attendantIsHuman) {
  if (!agent || !lead) return false
  const mode = normalizeAgentMode(agent.mode)
  const humanOwned = !!lead.ai_handed_off_at || !!attendantIsHuman
  if (humanOwned) return mode === 'copilot' || mode === 'sdr'
  if (mode === 'copilot') return true
  switch (agent.activation_mode) {
    case 'default_attendant':
      return lead.attendant_id === agent.user_id || !lead.attendant_id
    case 'roulette':
      return lead.attendant_id === agent.user_id
    case 'conditional':
      return true
    case 'manual':
      return lead.attendant_id === agent.user_id
    default:
      return false
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add server/services/copilotMode.js test/copilotMode.test.js
git commit -m "feat: modos do agente de IA (automatico, copiloto, sdr)"
```

---

### Task 4: Análise de venda, trava de etapa e textos

**Files:**
- Create: `server/services/salesAnalysis.js`
- Test: `test/salesAnalysis.test.js`

**Interfaces:**
- Consumes: `createTestDb`, `seedAccountAndLead` (Task 1) só no teste.
- Produces:
  - `ANALYSIS_TOOL_NAME = 'record_analysis'` e `ANALYSIS_TOOL` (definição da ferramenta Anthropic; entrada com `momento`, `chance_fechar`, `trava_principal`, `criterios[{criterio, status, evidencia}]`)
  - `parseAnalysisInput(input): { moment: string|null, closeChance: number|null, mainBlocker: string|null, criteria: Array<{ name: string, status: 'atendido'|'pendente', evidence: string }> } | null`
  - `parseRequiredFields(json: string|null): string[]`
  - `readLeadCriteria(lead): Array<{name,status,evidence}> | null`
  - `checkStageGate({ requiredFields: string[], lead, criteria: array|null, hasQualificationText: boolean }): { allowed: boolean, missingFields: string[], pendingCriteria: string[], noAnalysis: boolean, noCriteriaEvaluated: boolean }`
  - `formatGateRefusal(gate): string`
  - `shouldSdrHandoff({ requiredFields, lead, criteria, hasQualificationText }): boolean`
  - `buildQualificationSummary(lead, criteria): string`
  - `buildSalesRulesLines(mode: string): string[]`
  - `saveLeadAnalysis(db, accountId: number, leadId: number, analysis): void`

- [ ] **Step 1: Escrever o teste que falha**

`test/salesAnalysis.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  ANALYSIS_TOOL, ANALYSIS_TOOL_NAME, parseAnalysisInput, parseRequiredFields, readLeadCriteria,
  checkStageGate, formatGateRefusal, shouldSdrHandoff, buildQualificationSummary,
  buildSalesRulesLines, saveLeadAnalysis,
} from '../server/services/salesAnalysis.js'

test('ANALYSIS_TOOL tem nome e campos obrigatorios do spec', () => {
  assert.equal(ANALYSIS_TOOL.name, ANALYSIS_TOOL_NAME)
  assert.equal(ANALYSIS_TOOL_NAME, 'record_analysis')
  assert.deepEqual(ANALYSIS_TOOL.input_schema.required, ['momento', 'chance_fechar', 'trava_principal', 'criterios'])
})

test('parseAnalysisInput normaliza chance, trava vazia e status', () => {
  const a = parseAnalysisInput({
    momento: ' qualificacao ',
    chance_fechar: 140.6,
    trava_principal: '   ',
    criterios: [
      { criterio: 'Volume mensal', status: 'Atendido', evidencia: '200 litros' },
      { criterio: 'Regiao', status: 'talvez' },
      { status: 'atendido' },
    ],
  })
  assert.deepEqual(a, {
    moment: 'qualificacao',
    closeChance: 100,
    mainBlocker: null,
    criteria: [
      { name: 'Volume mensal', status: 'atendido', evidence: '200 litros' },
      { name: 'Regiao', status: 'pendente', evidence: '' },
    ],
  })
})

test('parseAnalysisInput: chance invalida vira null, negativa vira 0, entrada invalida vira null', () => {
  assert.equal(parseAnalysisInput({ chance_fechar: 'abc', criterios: [] }).closeChance, null)
  assert.equal(parseAnalysisInput({ chance_fechar: -5, criterios: [] }).closeChance, 0)
  assert.equal(parseAnalysisInput(null), null)
  assert.equal(parseAnalysisInput('texto'), null)
})

test('parseRequiredFields e readLeadCriteria toleram JSON ruim', () => {
  assert.deepEqual(parseRequiredFields('["name","city"]'), ['name', 'city'])
  assert.deepEqual(parseRequiredFields('nao-json'), [])
  assert.deepEqual(parseRequiredFields(null), [])
  assert.equal(readLeadCriteria({ ai_criteria_json: null }), null)
  assert.equal(readLeadCriteria({ ai_criteria_json: '{quebrado' }), null)
  assert.deepEqual(readLeadCriteria({ ai_criteria_json: '[{"name":"X","status":"atendido","evidence":""}]' }), [{ name: 'X', status: 'atendido', evidence: '' }])
})

test('trava: campo obrigatorio faltando recusa', () => {
  const gate = checkStageGate({
    requiredFields: ['name', 'city'],
    lead: { name: 'Ana', city: '  ' },
    criteria: [{ name: 'Volume', status: 'atendido', evidence: 'x' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, false)
  assert.deepEqual(gate.missingFields, ['city'])
  assert.match(formatGateRefusal(gate), /campos obrigatorios: cidade/)
})

test('trava: criterio pendente recusa', () => {
  const gate = checkStageGate({
    requiredFields: [],
    lead: {},
    criteria: [{ name: 'Volume', status: 'atendido', evidence: 'x' }, { name: 'Prazo', status: 'pendente', evidence: '' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, false)
  assert.deepEqual(gate.pendingCriteria, ['Prazo'])
  assert.match(formatGateRefusal(gate), /criterios pendentes: Prazo/)
})

test('trava: sem analise recusa; criterios vazios com texto de qualificacao recusa', () => {
  const semAnalise = checkStageGate({ requiredFields: [], lead: {}, criteria: null, hasQualificationText: false })
  assert.equal(semAnalise.allowed, false)
  assert.equal(semAnalise.noAnalysis, true)
  assert.match(formatGateRefusal(semAnalise), /record_analysis/)
  const vazio = checkStageGate({ requiredFields: [], lead: {}, criteria: [], hasQualificationText: true })
  assert.equal(vazio.allowed, false)
  assert.equal(vazio.noCriteriaEvaluated, true)
})

test('trava: tudo atendido libera', () => {
  const gate = checkStageGate({
    requiredFields: ['name'],
    lead: { name: 'Ana' },
    criteria: [{ name: 'Volume', status: 'atendido', evidence: '200 litros' }],
    hasQualificationText: true,
  })
  assert.equal(gate.allowed, true)
})

test('shouldSdrHandoff exige algo para qualificar', () => {
  assert.equal(shouldSdrHandoff({ requiredFields: [], lead: {}, criteria: [], hasQualificationText: false }), false)
  assert.equal(shouldSdrHandoff({ requiredFields: ['name'], lead: { name: 'Ana' }, criteria: [], hasQualificationText: false }), true)
  assert.equal(shouldSdrHandoff({ requiredFields: [], lead: {}, criteria: [{ name: 'V', status: 'atendido', evidence: '' }], hasQualificationText: true }), true)
  assert.equal(shouldSdrHandoff({ requiredFields: ['name'], lead: {}, criteria: [], hasQualificationText: false }), false)
})

test('buildQualificationSummary lista criterios, chance e trava', () => {
  const text = buildQualificationSummary(
    { ai_close_chance: 60, ai_main_blocker: 'preco' },
    [{ name: 'Volume', status: 'atendido', evidence: '200 litros' }],
  )
  assert.match(text, /Resumo da qualificacao/)
  assert.match(text, /Volume: atendido — "200 litros"/)
  assert.match(text, /Chance de fechar: 60%/)
  assert.match(text, /Trava principal: preco/)
})

test('buildSalesRulesLines: regra de preco em todos; copilot nao transfere', () => {
  const sdr = buildSalesRulesLines('sdr').join('\n')
  assert.match(sdr, /NUNCA passe orcamento/)
  assert.match(sdr, /record_analysis/)
  assert.doesNotMatch(sdr, /Nao transfira/)
  assert.match(buildSalesRulesLines('copilot').join('\n'), /Nao transfira/)
})

test('saveLeadAnalysis grava no lead da conta e zera o contador', () => {
  const db = createTestDb()
  const { accountId, leadId } = seedAccountAndLead(db)
  db.prepare('UPDATE leads SET ai_msgs_since_analysis = 4 WHERE id = ?').run(leadId)
  saveLeadAnalysis(db, accountId, leadId, { moment: 'objecao', closeChance: 55, mainBlocker: 'preco', criteria: [{ name: 'Volume', status: 'pendente', evidence: '' }] })
  const row = db.prepare('SELECT ai_moment, ai_close_chance, ai_main_blocker, ai_criteria_json, ai_msgs_since_analysis FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.ai_moment, 'objecao')
  assert.equal(row.ai_close_chance, 55)
  assert.equal(row.ai_main_blocker, 'preco')
  assert.deepEqual(JSON.parse(row.ai_criteria_json), [{ name: 'Volume', status: 'pendente', evidence: '' }])
  assert.equal(row.ai_msgs_since_analysis, 0)
})

test('saveLeadAnalysis nao grava em lead de outra conta', () => {
  const db = createTestDb()
  const { leadId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  saveLeadAnalysis(db, outra.accountId, leadId, { moment: 'x', closeChance: 10, mainBlocker: null, criteria: [] })
  assert.equal(db.prepare('SELECT ai_moment FROM leads WHERE id = ?').get(leadId).ai_moment, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/salesAnalysis.test.js` com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`server/services/salesAnalysis.js`:

```js
// Analise de venda do Copiloto (spec 3.4): ferramenta obrigatoria, trava de etapa e textos.
// Funcoes puras; saveLeadAnalysis recebe o db por parametro (nao importa server/db.js).

export const ANALYSIS_TOOL_NAME = 'record_analysis'

export const ANALYSIS_TOOL = {
  name: ANALYSIS_TOOL_NAME,
  description: 'OBRIGATORIA em toda resposta: registra a analise da conversa (momento, chance de fechar, trava principal e status de cada criterio de qualificacao).',
  input_schema: {
    type: 'object',
    properties: {
      momento: { type: 'string', description: 'Etapa real da conversa (ex: descoberta, qualificacao, objecao de preco, pronto para proposta)' },
      chance_fechar: { type: 'integer', minimum: 0, maximum: 100, description: 'Chance de fechar a venda, de 0 a 100' },
      trava_principal: { type: 'string', description: 'Objecao ou bloqueio atual. Vazio se nao houver.' },
      criterios: {
        type: 'array',
        description: 'Cada criterio obrigatorio de qualificacao, com status e evidencia',
        items: {
          type: 'object',
          properties: {
            criterio: { type: 'string' },
            status: { type: 'string', enum: ['atendido', 'pendente'] },
            evidencia: { type: 'string', description: 'Trecho da conversa que comprova. Vazio se pendente.' },
          },
          required: ['criterio', 'status'],
        },
      },
    },
    required: ['momento', 'chance_fechar', 'trava_principal', 'criterios'],
  },
}

const LEAD_FIELD_LABELS = { name: 'nome', email: 'email', phone: 'telefone', city: 'cidade', empresa: 'empresa', instagram: 'instagram' }

function cleanText(value, max) {
  const s = String(value == null ? '' : value).trim()
  return s ? s.slice(0, max) : ''
}

export function parseAnalysisInput(input) {
  if (!input || typeof input !== 'object') return null
  const rawChance = Number(input.chance_fechar)
  const closeChance = Number.isFinite(rawChance) ? Math.max(0, Math.min(100, Math.round(rawChance))) : null
  const criteria = Array.isArray(input.criterios)
    ? input.criterios
      .filter(c => c && typeof c === 'object' && cleanText(c.criterio, 200))
      .map(c => ({
        name: cleanText(c.criterio, 200),
        status: String(c.status || '').trim().toLowerCase() === 'atendido' ? 'atendido' : 'pendente',
        evidence: cleanText(c.evidencia, 300),
      }))
    : []
  return {
    moment: cleanText(input.momento, 100) || null,
    closeChance,
    mainBlocker: cleanText(input.trava_principal, 200) || null,
    criteria,
  }
}

export function parseRequiredFields(json) {
  try {
    const arr = JSON.parse(json || '[]')
    return Array.isArray(arr) ? arr.filter(f => typeof f === 'string') : []
  } catch {
    return []
  }
}

export function readLeadCriteria(lead) {
  if (!lead || !lead.ai_criteria_json) return null
  try {
    const arr = JSON.parse(lead.ai_criteria_json)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

export function checkStageGate({ requiredFields = [], lead, criteria, hasQualificationText = false }) {
  const missingFields = requiredFields.filter(f => !cleanText(lead && lead[f], 500))
  const noAnalysis = !Array.isArray(criteria)
  const list = noAnalysis ? [] : criteria
  const pendingCriteria = list.filter(c => c.status !== 'atendido').map(c => c.name)
  const noCriteriaEvaluated = !noAnalysis && hasQualificationText && list.length === 0
  const allowed = missingFields.length === 0 && pendingCriteria.length === 0 && !noAnalysis && !noCriteriaEvaluated
  return { allowed, missingFields, pendingCriteria, noAnalysis, noCriteriaEvaluated }
}

export function formatGateRefusal(gate) {
  const parts = []
  if (gate.missingFields.length > 0) parts.push('campos obrigatorios: ' + gate.missingFields.map(f => LEAD_FIELD_LABELS[f] || f).join(', '))
  if (gate.pendingCriteria.length > 0) parts.push('criterios pendentes: ' + gate.pendingCriteria.join(', '))
  if (gate.noAnalysis) parts.push(`analise da conversa (chame ${ANALYSIS_TOOL_NAME})`)
  if (gate.noCriteriaEvaluated) parts.push('avaliacao dos criterios de qualificacao')
  return `Mudanca recusada: a qualificacao nao esta completa. Falta: ${parts.join('; ')}. Continue a conversa e faca a proxima pergunta de qualificacao.`
}

export function shouldSdrHandoff({ requiredFields = [], lead, criteria, hasQualificationText = false }) {
  const gate = checkStageGate({ requiredFields, lead, criteria, hasQualificationText })
  const hasSomethingToQualify = requiredFields.length > 0 || (Array.isArray(criteria) && criteria.length > 0)
  return gate.allowed && hasSomethingToQualify
}

export function buildQualificationSummary(lead, criteria) {
  const lines = ['Resumo da qualificacao (IA):']
  for (const c of (Array.isArray(criteria) ? criteria : [])) {
    lines.push(`- ${c.name}: ${c.status}${c.evidence ? ` — "${c.evidence}"` : ''}`)
  }
  if (lead && lead.ai_close_chance != null) lines.push(`Chance de fechar: ${lead.ai_close_chance}%`)
  lines.push(`Trava principal: ${(lead && lead.ai_main_blocker) || 'nenhuma'}`)
  return lines.join('\n')
}

export function buildSalesRulesLines(mode) {
  const lines = [
    'REGRAS DE VENDA (obrigatorias):',
    '- NUNCA passe orcamento, preco ou proposta antes de o lead cumprir TODOS os criterios de qualificacao E estar no momento ideal.',
    '- Se o lead insistir no preco antes da hora, contorne a objecao com empatia (explique que precisa entender a necessidade dele para passar o valor certo) e siga com a PROXIMA pergunta de qualificacao. Nunca recuse seco.',
    `- Em TODA resposta chame a ferramenta ${ANALYSIS_TOOL_NAME} com: momento (etapa real da conversa), chance_fechar (0 a 100), trava_principal (objecao ou bloqueio atual, ou vazio) e criterios (cada criterio obrigatorio com status atendido ou pendente e a evidencia, um trecho da conversa).`,
    '- Mudar o lead de etapa so e aceito pelo sistema com todos os campos obrigatorios preenchidos e todos os criterios atendidos. Se for recusado, continue perguntando o que falta.',
  ]
  if (mode === 'copilot') lines.push('- Nao transfira o lead: o vendedor humano ja esta na conversa.')
  return lines
}

export function saveLeadAnalysis(db, accountId, leadId, analysis) {
  db.prepare(`
    UPDATE leads
    SET ai_moment = ?, ai_close_chance = ?, ai_main_blocker = ?, ai_criteria_json = ?, ai_msgs_since_analysis = 0
    WHERE id = ? AND account_id = ?
  `).run(analysis.moment, analysis.closeChance, analysis.mainBlocker, JSON.stringify(analysis.criteria || []), leadId, accountId)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add server/services/salesAnalysis.js test/salesAnalysis.test.js
git commit -m "feat: analise de venda obrigatoria e trava de mudanca de etapa por qualificacao"
```

---

### Task 5: Sugestões da IA e pausa por conversa (camada de dados)

**Files:**
- Create: `server/services/aiSuggestions.js`
- Create: `server/services/leadAiPause.js`
- Test: `test/aiSuggestions.test.js`

**Interfaces:**
- Consumes: tabela `ai_suggestions` e colunas `leads.ai_paused_at/ai_paused_by` (Task 1); `createTestDb`, `seedAccountAndLead` (Task 1).
- Produces:
  - `normalizeForCompare(text: string): string`
  - `createReplySuggestion(db, { accountId, leadId, agentId, content, source?: 'ai'|'base', payload?: object|null }): number` (id; expira a pendente anterior do lead)
  - `getPendingSuggestion(db, accountId, leadId): { id, lead_id, agent_id, kind, source, content, status, created_at } | null`
  - `resolveSuggestion(db, { accountId, suggestionId, action: 'sent'|'discarded', finalContent?: string, userId?: number }): { ok: true, suggestion } | { ok: false, error: 'not_found'|'not_pending'|'invalid_action' }`
  - `expirePendingForLead(db, accountId, leadId): number` (quantas expiraram)
  - `expirePendingForAgent(db, accountId, agentId): number[]` (ids dos leads afetados)
  - `pauseAiForLead(db, { accountId, leadId, userId }): string|null` (valor de `ai_paused_at`)
  - `resumeAiForLead(db, { accountId, leadId }): null`

- [ ] **Step 1: Escrever o teste que falha**

`test/aiSuggestions.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import {
  normalizeForCompare, createReplySuggestion, getPendingSuggestion, resolveSuggestion,
  expirePendingForLead, expirePendingForAgent,
} from '../server/services/aiSuggestions.js'
import { pauseAiForLead, resumeAiForLead } from '../server/services/leadAiPause.js'

function statusOf(db, id) {
  return db.prepare('SELECT status FROM ai_suggestions WHERE id = ?').get(id).status
}

test('normalizeForCompare ignora espacos extras', () => {
  assert.equal(normalizeForCompare('  oi,\n  tudo   bem? '), 'oi, tudo bem?')
  assert.equal(normalizeForCompare(null), '')
})

test('createReplySuggestion grava pendente e expira a anterior do mesmo lead', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const first = createReplySuggestion(db, { accountId, leadId, agentId, content: 'primeira' })
  const second = createReplySuggestion(db, { accountId, leadId, agentId, content: 'segunda', source: 'base', payload: { analysis: { closeChance: 40 } } })
  assert.equal(statusOf(db, first), 'expired')
  const pending = getPendingSuggestion(db, accountId, leadId)
  assert.equal(pending.id, second)
  assert.equal(pending.content, 'segunda')
  assert.equal(pending.source, 'base')
  assert.deepEqual(JSON.parse(db.prepare('SELECT payload_json FROM ai_suggestions WHERE id = ?').get(second).payload_json), { analysis: { closeChance: 40 } })
})

test('source invalido vira ai; sem pendente devolve null', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  assert.equal(getPendingSuggestion(db, accountId, leadId), null)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x', source: 'hack' })
  assert.equal(db.prepare('SELECT source FROM ai_suggestions WHERE id = ?').get(id).source, 'ai')
})

test('resolveSuggestion: igual (so espacos diferentes) = sent; diferente = edited', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const a = createReplySuggestion(db, { accountId, leadId, agentId, content: 'Oi, tudo bem?' })
  const r1 = resolveSuggestion(db, { accountId, suggestionId: a, action: 'sent', finalContent: 'Oi,  tudo bem? ', userId })
  assert.equal(r1.ok, true)
  assert.equal(r1.suggestion.status, 'sent')
  assert.equal(r1.suggestion.resolved_by, userId)
  const b = createReplySuggestion(db, { accountId, leadId, agentId, content: 'Oi, tudo bem?' })
  const r2 = resolveSuggestion(db, { accountId, suggestionId: b, action: 'sent', finalContent: 'Oi! Qual o volume por mes?', userId })
  assert.equal(r2.suggestion.status, 'edited')
  assert.equal(r2.suggestion.final_content, 'Oi! Qual o volume por mes?')
})

test('resolveSuggestion: descartar, nao pendente, outra conta e acao invalida', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  assert.deepEqual(resolveSuggestion(db, { accountId: outra.accountId, suggestionId: id, action: 'discarded', userId }), { ok: false, error: 'not_found' })
  assert.deepEqual(resolveSuggestion(db, { accountId, suggestionId: id, action: 'apagar', userId }), { ok: false, error: 'invalid_action' })
  const r = resolveSuggestion(db, { accountId, suggestionId: id, action: 'discarded', userId })
  assert.equal(r.suggestion.status, 'discarded')
  assert.equal(r.suggestion.final_content, null)
  assert.equal(resolveSuggestion(db, { accountId, suggestionId: id, action: 'sent', finalContent: 'x', userId }).error, 'not_pending')
})

test('expirePendingForLead expira so a pendente daquele lead e conta', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId } = seedAccountAndLead(db)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  assert.equal(expirePendingForLead(db, accountId + 999, leadId), 0)
  assert.equal(expirePendingForLead(db, accountId, leadId), 1)
  assert.equal(statusOf(db, id), 'expired')
  assert.equal(expirePendingForLead(db, accountId, leadId), 0)
})

test('expirePendingForAgent devolve os leads afetados e nao mexe em outro agente', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const lead2 = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(accountId, 'Lead 2').lastInsertRowid)
  const agent2 = Number(db.prepare('INSERT INTO ai_agents (account_id, user_id, name) VALUES (?, ?, ?)').run(accountId, userId, 'Agente 2').lastInsertRowid)
  createReplySuggestion(db, { accountId, leadId, agentId, content: 'a' })
  const other = createReplySuggestion(db, { accountId, leadId: lead2, agentId: agent2, content: 'b' })
  assert.deepEqual(expirePendingForAgent(db, accountId, agentId), [leadId])
  assert.equal(statusOf(db, other), 'pending')
})

test('pausar grava quem pausou e expira pendente; retomar limpa', () => {
  const db = createTestDb()
  const { accountId, leadId, agentId, userId } = seedAccountAndLead(db)
  const id = createReplySuggestion(db, { accountId, leadId, agentId, content: 'x' })
  const pausedAt = pauseAiForLead(db, { accountId, leadId, userId })
  assert.ok(pausedAt)
  const row = db.prepare('SELECT ai_paused_at, ai_paused_by FROM leads WHERE id = ?').get(leadId)
  assert.equal(row.ai_paused_by, userId)
  assert.equal(statusOf(db, id), 'expired')
  assert.equal(resumeAiForLead(db, { accountId, leadId }), null)
  const after = db.prepare('SELECT ai_paused_at, ai_paused_by FROM leads WHERE id = ?').get(leadId)
  assert.equal(after.ai_paused_at, null)
  assert.equal(after.ai_paused_by, null)
})

test('pausar lead de outra conta nao altera nada', () => {
  const db = createTestDb()
  const { leadId, userId } = seedAccountAndLead(db)
  const outra = seedAccountAndLead(db, { accountName: 'Outra' })
  assert.equal(pauseAiForLead(db, { accountId: outra.accountId, leadId, userId }), null)
  assert.equal(db.prepare('SELECT ai_paused_at FROM leads WHERE id = ?').get(leadId).ai_paused_at, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/aiSuggestions.test.js` com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar `aiSuggestions.js`**

`server/services/aiSuggestions.js`:

```js
// Sugestoes da IA (tabela ai_suggestions). Recebe o db por parametro. Toda query filtra por conta.
// Status: pending -> sent | edited | discarded | expired

const SUGGESTION_COLUMNS = 'id, account_id, lead_id, agent_id, kind, source, content, status, final_content, created_at, resolved_at, resolved_by'

export function normalizeForCompare(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
}

export function expirePendingForLead(db, accountId, leadId) {
  return db.prepare(`
    UPDATE ai_suggestions SET status = 'expired', resolved_at = datetime('now')
    WHERE account_id = ? AND lead_id = ? AND status = 'pending'
  `).run(accountId, leadId).changes
}

export function expirePendingForAgent(db, accountId, agentId) {
  const leadIds = db.prepare(`
    SELECT DISTINCT lead_id FROM ai_suggestions
    WHERE account_id = ? AND agent_id = ? AND status = 'pending'
  `).all(accountId, agentId).map(r => r.lead_id)
  db.prepare(`
    UPDATE ai_suggestions SET status = 'expired', resolved_at = datetime('now')
    WHERE account_id = ? AND agent_id = ? AND status = 'pending'
  `).run(accountId, agentId)
  return leadIds
}

export function createReplySuggestion(db, { accountId, leadId, agentId, content, source = 'ai', payload = null }) {
  const safeSource = source === 'base' ? 'base' : 'ai'
  const insert = db.transaction(() => {
    expirePendingForLead(db, accountId, leadId)
    return db.prepare(`
      INSERT INTO ai_suggestions (account_id, lead_id, agent_id, kind, source, content, payload_json, status)
      VALUES (?, ?, ?, 'reply', ?, ?, ?, 'pending')
    `).run(accountId, leadId, agentId || null, safeSource, String(content), payload ? JSON.stringify(payload) : null).lastInsertRowid
  })
  return Number(insert())
}

export function getPendingSuggestion(db, accountId, leadId) {
  const row = db.prepare(`
    SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions
    WHERE account_id = ? AND lead_id = ? AND kind = 'reply' AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(accountId, leadId)
  return row || null
}

export function resolveSuggestion(db, { accountId, suggestionId, action, finalContent, userId }) {
  const s = db.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions WHERE id = ? AND account_id = ?`).get(suggestionId, accountId)
  if (!s) return { ok: false, error: 'not_found' }
  if (action !== 'sent' && action !== 'discarded') return { ok: false, error: 'invalid_action' }
  if (s.status !== 'pending') return { ok: false, error: 'not_pending' }
  let status = 'discarded'
  let finalText = null
  if (action === 'sent') {
    finalText = String(finalContent == null ? '' : finalContent)
    status = normalizeForCompare(finalText) === normalizeForCompare(s.content) ? 'sent' : 'edited'
  }
  db.prepare(`
    UPDATE ai_suggestions SET status = ?, final_content = ?, resolved_at = datetime('now'), resolved_by = ?
    WHERE id = ? AND account_id = ?
  `).run(status, finalText, userId || null, s.id, accountId)
  const suggestion = db.prepare(`SELECT ${SUGGESTION_COLUMNS} FROM ai_suggestions WHERE id = ? AND account_id = ?`).get(s.id, accountId)
  return { ok: true, suggestion }
}
```

- [ ] **Step 4: Implementar `leadAiPause.js`**

`server/services/leadAiPause.js`:

```js
// Pausa da IA numa conversa (spec 3.10). Recebe o db por parametro.
import { expirePendingForLead } from './aiSuggestions.js'

export function pauseAiForLead(db, { accountId, leadId, userId }) {
  const res = db.prepare(`
    UPDATE leads SET ai_paused_at = datetime('now'), ai_paused_by = ?
    WHERE id = ? AND account_id = ?
  `).run(userId || null, leadId, accountId)
  if (res.changes === 0) return null
  expirePendingForLead(db, accountId, leadId)
  const row = db.prepare('SELECT ai_paused_at FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  return row ? row.ai_paused_at : null
}

export function resumeAiForLead(db, { accountId, leadId }) {
  db.prepare('UPDATE leads SET ai_paused_at = NULL, ai_paused_by = NULL WHERE id = ? AND account_id = ?').run(leadId, accountId)
  return null
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`).

- [ ] **Step 6: Commit**

```bash
git add server/services/aiSuggestions.js server/services/leadAiPause.js test/aiSuggestions.test.js
git commit -m "feat: sugestoes da IA (ai_suggestions) e pausa da IA por conversa"
```

---

### Task 6: Agrupamento de 40s por lead (debouncer)

**Files:**
- Create: `server/services/leadDebouncer.js`
- Test: `test/leadDebouncer.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `createDebouncer({ delayMs: number, setTimer?: Function, clearTimer?: Function }): { schedule(key, fn, meta?): void, cancel(key): boolean, cancelWhere(predicate: (meta) => boolean): number, has(key): boolean, size(): number }`

- [ ] **Step 1: Escrever o teste que falha**

`test/leadDebouncer.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDebouncer } from '../server/services/leadDebouncer.js'

// Relogio falso compativel com Node 16 (sem mock.timers)
function fakeClock() {
  let nextId = 1
  const timers = new Map()
  return {
    setTimer(fn, ms) { const id = nextId++; timers.set(id, { fn, ms }); return id },
    clearTimer(id) { timers.delete(id) },
    runAll() { const list = [...timers.entries()]; timers.clear(); for (const [, t] of list) t.fn() },
    lastDelay() { const all = [...timers.values()]; return all.length ? all[all.length - 1].ms : null },
    count() { return timers.size },
  }
}

test('nova mensagem do mesmo lead reinicia a espera: so a ultima roda', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(10, () => calls.push('primeira'))
  d.schedule(10, () => calls.push('segunda'))
  assert.equal(clock.count(), 1)
  assert.equal(clock.lastDelay(), 40000)
  clock.runAll()
  assert.deepEqual(calls, ['segunda'])
  assert.equal(d.has(10), false)
})

test('leads diferentes tem timers independentes', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(1, () => calls.push(1))
  d.schedule(2, () => calls.push(2))
  assert.equal(d.size(), 2)
  clock.runAll()
  assert.deepEqual(calls.sort(), [1, 2])
})

test('cancel e cancelWhere por agente', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 40000, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  const calls = []
  d.schedule(1, () => calls.push(1), { agentId: 7 })
  d.schedule(2, () => calls.push(2), { agentId: 7 })
  d.schedule(3, () => calls.push(3), { agentId: 8 })
  assert.equal(d.cancel(1), true)
  assert.equal(d.cancel(1), false)
  assert.equal(d.cancelWhere(meta => meta.agentId === 7), 1)
  clock.runAll()
  assert.deepEqual(calls, [3])
})

test('erro na funcao agendada nao derruba o processo', () => {
  const clock = fakeClock()
  const d = createDebouncer({ delayMs: 10, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
  d.schedule(1, () => { throw new Error('falhou') })
  d.schedule(2, () => Promise.reject(new Error('falhou async')))
  assert.doesNotThrow(() => clock.runAll())
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/leadDebouncer.test.js` com `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implementar**

`server/services/leadDebouncer.js`:

```js
// Timer por chave (lead): cada schedule cancela o anterior da mesma chave.
// Em memoria — a producao roda 1 processo pm2. Timers injetaveis para teste.

export function createDebouncer({ delayMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const entries = new Map() // key -> { handle, meta }

  function schedule(key, fn, meta = {}) {
    const prev = entries.get(key)
    if (prev) clearTimer(prev.handle)
    const handle = setTimer(() => {
      entries.delete(key)
      try {
        const result = fn()
        if (result && typeof result.catch === 'function') {
          result.catch(e => console.error('[Debouncer] erro async:', e && e.message))
        }
      } catch (e) {
        console.error('[Debouncer] erro:', e && e.message)
      }
    }, delayMs)
    entries.set(key, { handle, meta })
  }

  function cancel(key) {
    const entry = entries.get(key)
    if (!entry) return false
    clearTimer(entry.handle)
    entries.delete(key)
    return true
  }

  function cancelWhere(predicate) {
    let cancelled = 0
    for (const [key, entry] of entries) {
      if (predicate(entry.meta)) {
        clearTimer(entry.handle)
        entries.delete(key)
        cancelled++
      }
    }
    return cancelled
  }

  return {
    schedule,
    cancel,
    cancelWhere,
    has: key => entries.has(key),
    size: () => entries.size,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`; o teste de erro imprime `[Debouncer] erro...` no console, é esperado).

- [ ] **Step 5: Commit**

```bash
git add server/services/leadDebouncer.js test/leadDebouncer.test.js
git commit -m "feat: agrupamento de mensagens por lead com timer em memoria"
```

---

### Task 7: Integração no Agente de IA (modo, análise, trava, sugestão, SDR)

**Files:**
- Modify: `server/services/aiAgent.js` — imports (depois de L11 após a Task 2), `findAgentForLead` (L42-99 do original), `diagnoseForceAi` (L117-122), `buildSystemPrompt` (L184-250), `getToolsForAgent` (L333-381), `executeTool` (L385-417), `processInboundMessage` (L423-672)

Observação: o arquivo usa quebra de linha CRLF; use a ferramenta Edit (ela preserva). Os números de linha são do arquivo de produção antes da Task 2; localize cada trecho pelas âncoras de texto indicadas.

**Interfaces:**
- Consumes:
  - Task 2: `pickAnthropicKey(account)`
  - Task 3: `resolveEffectiveMode(agent, lead, attendantIsHuman)`, `usesSalesEngine(agent)`, `deliveryActionForMode(mode)`, `agentAcceptsLead(agent, lead, attendantIsHuman)`
  - Task 4: `ANALYSIS_TOOL`, `ANALYSIS_TOOL_NAME`, `parseAnalysisInput`, `saveLeadAnalysis(db, accountId, leadId, analysis)`, `readLeadCriteria`, `checkStageGate`, `formatGateRefusal`, `buildSalesRulesLines`, `buildQualificationSummary`, `shouldSdrHandoff`, `parseRequiredFields`
  - Task 5: `createReplySuggestion(db, {...})`, `getPendingSuggestion(db, accountId, leadId)`
- Produces:
  - `export function leadHasHumanAttendant(lead): boolean` (novo export, usado na Task 8)
  - `processInboundMessage(lead, msgContent, mediaType, instanceId, _opts)` — mesma assinatura; novos retornos: `{ ok: false, reason: 'paused_for_lead' }`, `{ ok: true, mode, reason: 'suggestion_pending' }`, `{ ok: false, reason: 'token_limit' }` (copiloto), `{ ok: true, mode: 'copilot', suggestion: boolean }`, `{ ok: true, mode }`
  - Evento SSE `lead:ai_suggestion` com `{ lead_id, suggestion_id }`
  - `stage_history.trigger_type = 'ai_qualified'` com `notes = 'Movido pela IA - qualificacao completa'`
  - Nota em `lead_notes` com o resumo da qualificação (autor = `agent.user_id`)

Esta task não tem teste automatizado próprio: `aiAgent.js` importa `server/db.js` (abre o banco real). Toda regra de decisão já está coberta pelos testes das Tasks 3, 4 e 5; aqui só se liga as peças. A verificação é `node --check`, `npm test` e o roteiro manual da Task 14.

- [ ] **Step 1: Imports**

Em `server/services/aiAgent.js`, logo depois de `import { pickAnthropicKey } from './anthropicKeyPicker.js'` (adicionado na Task 2):

```js
import { resolveEffectiveMode, usesSalesEngine, deliveryActionForMode, agentAcceptsLead } from './copilotMode.js'
import {
  ANALYSIS_TOOL, ANALYSIS_TOOL_NAME, parseAnalysisInput, saveLeadAnalysis, readLeadCriteria,
  checkStageGate, formatGateRefusal, buildSalesRulesLines, buildQualificationSummary,
  shouldSdrHandoff, parseRequiredFields,
} from './salesAnalysis.js'
import { createReplySuggestion, getPendingSuggestion } from './aiSuggestions.js'
```

- [ ] **Step 2: Helpers + novo `findAgentForLead`**

Substituir tudo desde a linha `// ─── findAgentForLead ─────────────────────────────────────────────────` até a linha anterior a `// ─── diagnoseForceAi ─────────────────────────────────────────────────` (a função `findAgentForLead` inteira) por:

```js
// Atendente atual do lead e humano (nao bot)?
export function leadHasHumanAttendant(lead) {
  if (!lead || !lead.attendant_id) return false
  const att = getUser(lead.attendant_id)
  return !!(att && !att.is_bot)
}

// Trava de qualificacao (spec 3.4), sempre com o lead lido do banco
function gateForLead(agent, freshLead) {
  return checkStageGate({
    requiredFields: parseRequiredFields(agent.required_fields),
    lead: freshLead,
    criteria: readLeadCriteria(freshLead),
    hasQualificationText: !!(agent.qualification_criteria && agent.qualification_criteria.trim()),
  })
}

// Resumo da qualificacao para o vendedor, como nota do lead (autor = usuario-robo do agente)
function addQualificationNote(agent, freshLead) {
  const text = buildQualificationSummary(freshLead, readLeadCriteria(freshLead))
  db.prepare('INSERT INTO lead_notes (lead_id, user_id, content) VALUES (?, ?, ?)').run(freshLead.id, agent.user_id, text)
}

// ─── findAgentForLead ─────────────────────────────────────────────────

export function findAgentForLead(lead, instanceId, _opts = {}) {
  if (!lead) return null
  // Removido modo force — botao "Forcar IA" agora roda o fluxo NORMAL.
  // Bloqueios sao reportados pelo diagnoseForceAi() na rota /force-ai-respond.

  // 0. Account tem feature gate?
  const account = getAccount(lead.account_id)
  if (!account || !account.ai_agents_enabled) return null
  // Sem chave Anthropic (da conta ou da Dros, conforme ai_key_source), o bot nao roda
  if (!pickAnthropicKey(account)) {
    console.warn(`[AI Agent] conta ${lead.account_id} com agentes habilitados mas SEM API Anthropic — bot nao responde lead ${lead.id}`)
    return null
  }

  // 1. Lead pode receber bot?
  if (lead.is_blocked || lead.is_archived || !lead.is_active) return null

  // 2-3. Lead com humano (handoff anterior ou atendente humano): so agentes copilot/sdr seguem, como Copiloto.
  //      A decisao fica em agentAcceptsLead (copilotMode.js).
  const attendantIsHuman = leadHasHumanAttendant(lead)

  // 4. Busca agentes ativos
  const agents = db.prepare("SELECT * FROM ai_agents WHERE account_id = ? AND is_active = 1 ORDER BY id ASC").all(lead.account_id)

  for (const agent of agents) {
    // Filtro etapa
    const hasStage = db.prepare('SELECT 1 FROM ai_agent_stages WHERE agent_id = ? AND stage_id = ?').get(agent.id, lead.stage_id)
    if (!hasStage) continue
    // Filtro instancia
    if (instanceId) {
      const hasInstance = db.prepare('SELECT 1 FROM ai_agent_instances WHERE agent_id = ? AND instance_id = ?').get(agent.id, instanceId)
      if (!hasInstance) continue
    }
    // Filtro tag obrigatoria
    if (agent.required_tag_id && !leadHasTag(lead.id, agent.required_tag_id)) continue

    // Modo do agente + modo de ativacao
    if (agentAcceptsLead(agent, lead, attendantIsHuman)) return agent
  }
  return null
}
```

- [ ] **Step 3: `diagnoseForceAi` respeita Copiloto e pausa**

Em `diagnoseForceAi`, trocar:

```js
  if (lead.ai_handed_off_at) blockers.push('Lead ja teve handoff anterior (bot transferiu pra humano em ' + lead.ai_handed_off_at + ')')

  if (lead.attendant_id) {
    const att = getUser(lead.attendant_id)
    if (att && !att.is_bot) blockers.push(`Lead tem atendente humano atribuido: ${att.name}`)
  }
```

por:

```js
  // Agentes em copilot/sdr continuam atuando (como Copiloto) em lead com humano ou ja passado
  const hasCopilotAgent = !!db.prepare("SELECT 1 FROM ai_agents WHERE account_id = ? AND is_active = 1 AND mode IN ('copilot', 'sdr') LIMIT 1").get(lead.account_id)
  if (!hasCopilotAgent) {
    if (lead.ai_handed_off_at) blockers.push('Lead ja teve handoff anterior (bot transferiu pra humano em ' + lead.ai_handed_off_at + ')')

    if (lead.attendant_id) {
      const att = getUser(lead.attendant_id)
      if (att && !att.is_bot) blockers.push(`Lead tem atendente humano atribuido: ${att.name}`)
    }
  }
  if (lead.ai_paused_at) blockers.push('IA pausada nesta conversa (use Retomar IA no Chat)')
```

- [ ] **Step 4: `buildSystemPrompt` com modo e regras de venda**

Substituir a função `function buildSystemPrompt(agent, lead, availableTags, availableStages) { ... }` inteira (até a linha anterior a `// ─── buildConversationHistory`) por:

```js
function buildSystemPrompt(agent, lead, availableTags, availableStages, opts = {}) {
  const mode = opts.mode || 'auto'
  const salesEngine = !!opts.salesEngine
  const parts = []
  parts.push(`Voce e ${agent.name}, assistente atendendo leads no WhatsApp.`)
  if (mode === 'copilot') {
    parts.push('Voce escreve a SUGESTAO de resposta que um vendedor humano vai revisar e enviar. Escreva na primeira pessoa, como o vendedor, sem dizer que e IA.')
  }
  if (agent.persona) parts.push(`Tom de voz: ${agent.persona}`)
  if (agent.identifies_as_bot && mode !== 'copilot') parts.push('Voce e uma IA assistente. Pode mencionar isso se perguntado.')
  parts.push('')

  if (agent.knowledge_base) {
    parts.push('CONTEXTO DA EMPRESA:')
    parts.push(agent.knowledge_base)
    parts.push('')
  }

  parts.push('REGRAS RIGIDAS:')
  parts.push('- Responda em PT-BR, MAXIMO 2 frases curtas.')
  parts.push('- Use linguagem natural, evite parecer robotico.')
  parts.push('- UMA pergunta por mensagem. NUNCA dispare 2+ perguntas no mesmo turno.')
  parts.push('- SEMPRE QUE coletar um dado (chamar update_lead_info ou outra tool), a SUA mensagem de texto DEVE conter (a) breve confirmacao + (b) a PROXIMA pergunta. NUNCA encerre com "anotei" ou "ok" sem fazer a proxima pergunta — voce e quem conduz a conversa.')
  parts.push('- Quando o lead informar info pessoal (nome, cidade, empresa, cargo, etc), chame update_lead_info ANTES de responder. Para "cargo" use field="empresa" com valor formatado "Cargo: X - Setor".')
  parts.push('- Se o lead mandar uma mensagem vazia, "ola" ou similar sem contexto novo, NAO encerre — retome de onde parou e pergunte o proximo dado faltante.')
  if (agent.never_mention) parts.push(`- NUNCA mencione: ${agent.never_mention}`)
  if (mode !== 'copilot') {
    if (agent.handoff_keywords) {
      parts.push(`- Se o lead disser uma das palavras "${agent.handoff_keywords}" -> chame transfer_to_human(reason="keyword").`)
    }
    parts.push('- So chame transfer_to_human(reason="unknown") se REALMENTE nao tiver como continuar (ex: lead pergunta algo completamente fora do escopo da empresa). NAO use "unknown" so porque precisa de mais info — pergunte!')
  }
  parts.push('')

  if (agent.qualification_criteria) {
    parts.push('QUALIFICACAO:')
    parts.push(`Considere o lead qualificado quando: ${agent.qualification_criteria}`)
    let requiredFields = []
    try { requiredFields = JSON.parse(agent.required_fields || '[]') } catch {}
    if (requiredFields.length > 0) {
      parts.push(`Campos obrigatorios pra qualificar: ${requiredFields.join(', ')}.`)
      const collected = []
      if (requiredFields.includes('name') && lead.name) collected.push(`nome=${lead.name}`)
      if (requiredFields.includes('email') && lead.email) collected.push(`email=${lead.email}`)
      if (requiredFields.includes('phone') && lead.phone) collected.push(`phone=${lead.phone}`)
      if (requiredFields.includes('city') && lead.city) collected.push(`cidade=${lead.city}`)
      if (requiredFields.includes('empresa') && lead.empresa) collected.push(`empresa=${lead.empresa}`)
      if (requiredFields.includes('instagram') && lead.instagram) collected.push(`instagram=${lead.instagram}`)
      if (collected.length > 0) parts.push(`Ja coletados: ${collected.join('; ')}.`)
    }
    if (!salesEngine) {
      parts.push('Quando qualificar, chame transfer_to_human(reason="qualified") imediatamente.')
    } else if (mode !== 'copilot') {
      parts.push('Fluxo: pre-atendimento -> validar os dados do cliente e se ele esta dentro do perfil ideal (ICP) -> passar para o especialista.')
      parts.push('Quando o lead cumprir todos os criterios, chame transfer_to_human(reason="qualified"). O sistema so aceita com todos os campos obrigatorios e criterios completos.')
    }
    parts.push('')
  }

  if (availableStages && availableStages.length > 0) {
    parts.push('ETAPAS DO FUNIL DISPONIVEIS: ' + availableStages.map(s => `"${s.name}"`).join(', '))
  }
  if (availableTags && availableTags.length > 0) {
    parts.push('TAGS DISPONIVEIS: ' + availableTags.map(t => `"${t.name}"`).join(', '))
  }

  if (salesEngine) {
    parts.push('')
    for (const line of buildSalesRulesLines(mode)) parts.push(line)
  }

  // Anti-ban: variacao humana pra parecer menos previsivel
  parts.push('')
  parts.push('VARIACAO HUMANA (importante pra parecer natural, nao robotico):')
  parts.push('- Varie saudacoes: "Oi!", "Opa!", "E ai!", "Ola"... ou comece DIRETO sem saudacao se ja deu bom dia antes na conversa')
  parts.push('- Nem sempre comece com o nome do lead — humano nao faz isso toda msg')
  parts.push('- Varie comprimento: as vezes 1 frase curta, as vezes 2 frases')
  parts.push('- Use coloquialismos leves quando o tom permitir: "ta", "pra", "ne", "blz", "tmj"')
  parts.push('- Pontuacao natural OK: pode terminar sem ponto final, usar "..." pra pausa')
  parts.push('- NAO use emoji em toda msg — so quando faz sentido (alegria, confirmacao etc)')
  parts.push('- Pode escrever em minuscula ocasionalmente, como humano apressado')

  return parts.filter(Boolean).join('\n')
}
```

- [ ] **Step 5: `getToolsForAgent` com ferramenta de análise**

Substituir a função `function getToolsForAgent(availableTags, availableStages) { ... }` inteira (até a linha anterior a `// ─── executeTool`) por:

```js
function getToolsForAgent(availableTags, availableStages, opts = {}) {
  const tools = [
    {
      name: 'update_lead_info',
      description: 'Salva informacao que o lead informou (nome, email, cidade, empresa, instagram). Use SEMPRE que o lead disser esses dados.',
      input_schema: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['name', 'email', 'city', 'empresa', 'instagram'] },
          value: { type: 'string', description: 'Valor informado pelo lead' },
        },
        required: ['field', 'value'],
      },
    },
    {
      name: 'add_tag',
      description: 'Marca o lead com uma tag (use apenas tags listadas no system).',
      input_schema: {
        type: 'object',
        properties: {
          tag_name: { type: 'string', enum: availableTags.map(t => t.name) },
        },
        required: ['tag_name'],
      },
    },
    {
      name: 'move_stage',
      description: 'Move o lead pra outra etapa do funil (use apenas etapas listadas).',
      input_schema: {
        type: 'object',
        properties: {
          stage_name: { type: 'string', enum: availableStages.map(s => s.name) },
        },
        required: ['stage_name'],
      },
    },
    {
      name: 'transfer_to_human',
      description: 'Transfere o lead pra atendente humano. Use quando: lead pediu humano (reason=keyword), lead esta qualificado (reason=qualified), voce nao soube responder (reason=unknown), ou conversou demais sem qualificar (reason=max_messages).',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['qualified', 'keyword', 'unknown', 'max_messages', 'audio_received', 'other'] },
        },
        required: ['reason'],
      },
    },
  ]
  // Copiloto: o humano ja atende, nao existe transferencia
  const filtered = opts.mode === 'copilot' ? tools.filter(t => t.name !== 'transfer_to_human') : tools
  return opts.salesEngine ? [ANALYSIS_TOOL, ...filtered] : filtered
}
```

- [ ] **Step 6: `executeTool` com análise, trava e copiloto**

Substituir a função `async function executeTool(toolUse, agent, lead, instanceId, availableTags, availableStages) { ... }` inteira (até a linha anterior a `// (sendEvolutionText removido`) por:

```js
async function executeTool(toolUse, agent, lead, instanceId, availableTags, availableStages, ctx = {}) {
  const { name, input } = toolUse
  const mode = ctx.mode || 'auto'
  const salesEngine = !!ctx.salesEngine
  try {
    if (name === ANALYSIS_TOOL_NAME) {
      const analysis = parseAnalysisInput(input)
      if (!analysis) return { handoff: false, message: 'Analise invalida: envie momento, chance_fechar, trava_principal e criterios.' }
      saveLeadAnalysis(db, lead.account_id, lead.id, analysis)
      console.log(`[AI Agent] record_analysis lead=${lead.id} chance=${analysis.closeChance} trava="${analysis.mainBlocker || ''}" criterios=${analysis.criteria.length}`)
      return { handoff: false, analysis, message: 'Analise registrada.' }
    } else if (name === 'update_lead_info') {
      const allowed = ['name', 'email', 'city', 'empresa', 'instagram']
      if (allowed.includes(input.field) && input.value) {
        db.prepare(`UPDATE leads SET ${input.field} = ? WHERE id = ?`).run(String(input.value).substring(0, 200), lead.id)
        console.log(`[AI Agent] update_lead_info lead=${lead.id} ${input.field}="${input.value}"`)
      }
    } else if (name === 'add_tag') {
      const tag = availableTags.find(t => t.name === input.tag_name)
      if (tag) {
        db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, tag.id)
        console.log(`[AI Agent] add_tag lead=${lead.id} tag="${input.tag_name}"`)
      }
    } else if (name === 'move_stage') {
      const stage = availableStages.find(s => s.name === input.stage_name)
      // Le do banco: update_lead_info e record_analysis desta mesma rodada ja gravaram
      const fresh = stage ? getLead(lead.id) : null
      if (stage && fresh && stage.id !== fresh.stage_id) {
        if (salesEngine) {
          const gate = gateForLead(agent, fresh)
          if (!gate.allowed) {
            console.log(`[AI Agent] move_stage RECUSADO lead=${lead.id} -> "${input.stage_name}" faltando=${JSON.stringify(gate)}`)
            return { handoff: false, message: formatGateRefusal(gate) }
          }
        }
        const prev = fresh.stage_id
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
        db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type, notes) VALUES (?, ?, ?, ?, ?)').run(
          lead.id, prev, stage.id,
          salesEngine ? 'ai_qualified' : 'ai_agent',
          salesEngine ? 'Movido pela IA - qualificacao completa' : null
        )
        lead.stage_id = stage.id
        console.log(`[AI Agent] move_stage lead=${lead.id} -> "${input.stage_name}"`)
      }
    } else if (name === 'transfer_to_human') {
      if (mode === 'copilot') return { handoff: false, message: 'Ignorado: o vendedor humano ja esta atendendo este lead.' }
      const reason = input.reason || 'other'
      if (salesEngine && reason === 'qualified') {
        const fresh = getLead(lead.id)
        const gate = gateForLead(agent, fresh)
        if (!gate.allowed) {
          console.log(`[AI Agent] transfer qualified RECUSADO lead=${lead.id}`)
          return { handoff: false, message: formatGateRefusal(gate) }
        }
        addQualificationNote(agent, fresh)
      }
      executeHandoff(agent, lead, reason, instanceId)
      return { handoff: true, reason }
    }
  } catch (e) {
    console.error(`[AI Agent] Erro tool ${name}:`, e.message)
  }
  return { handoff: false }
}
```

- [ ] **Step 7: `processInboundMessage` com pausa, modo, análise forçada, sugestão e SDR**

Substituir a função `export async function processInboundMessage(...) { ... }` inteira (até a linha anterior a `// ─── sendBotWelcomeForSheetsLead`) por:

```js
export async function processInboundMessage(lead, msgContent, mediaType, instanceId, _opts = {}) {
  try {
    console.log(`[AI Agent DEBUG] processInboundMessage chamado lead=${lead?.id} instance=${instanceId} mediaType=${mediaType} content="${(msgContent||'').substring(0,30)}"`)
    // 0. Pausa por conversa (le do banco: o objeto lead pode estar velho, ex: timer de 40s)
    const pauseRow = lead ? db.prepare('SELECT ai_paused_at FROM leads WHERE id = ?').get(lead.id) : null
    if (pauseRow?.ai_paused_at) {
      return { ok: false, reason: 'paused_for_lead' }
    }

    // 1. Encontra agente (respeita todos os filtros — bloqueios sao reportados pelo diagnoseForceAi na rota)
    const agent = findAgentForLead(lead, instanceId)
    if (!agent) {
      return { ok: false, reason: 'no_matching_agent' }
    }
    console.log(`[AI Agent DEBUG] agente encontrado: id=${agent.id} name=${agent.name}`)

    // 1b. Modo efetivo neste lead (auto | copilot | sdr) e se usa regras de venda + analise + trava
    const mode = resolveEffectiveMode(agent, lead, leadHasHumanAttendant(lead))
    const salesEngine = usesSalesEngine(agent)
    const delivery = deliveryActionForMode(mode)

    // 1c. Copiloto: sugestao pendente = nenhuma msg nova do lead desde ela (msg nova expira). Nao gasta IA de novo.
    if (delivery === 'suggest' && getPendingSuggestion(db, lead.account_id, lead.id)) {
      return { ok: true, mode, reason: 'suggestion_pending' }
    }

    // 2. Reset mensal de tokens se mes virou
    resetMonthlyTokensIfNeeded(agent)

    // 3. Checa limite de tokens
    if (agent.tokens_used_this_month >= agent.monthly_token_limit) {
      if (delivery === 'suggest') {
        console.log(`[AI Agent] Limite mensal estourado agent=${agent.id} (copiloto: sem sugestao) lead=${lead.id}`)
        return { ok: false, reason: 'token_limit' }
      }
      console.log(`[AI Agent] Limite mensal estourado agent=${agent.id}, fazendo handoff silencioso`)
      executeHandoff(agent, lead, 'unknown', instanceId)
      return
    }

    // 4. Audio: flag OFF = recusa + handoff; flag ON = transcreve via Deepgram e segue.
    //    No Copiloto nao recusa nem transfere (quem conversa e o vendedor): so fica sem sugestao.
    let sttSec = 0
    let sttCost = 0
    let sttProvider = null

    if (mediaType === 'audio') {
      const declineAndHandoff = async (reason) => {
        const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
        if (inst && inst.status === 'connected') {
          const declineMsg = agent.audio_decline_message || 'Oi! Por enquanto so leio mensagens de texto. Pode digitar pra mim?'
          const sendRes = await sendViaInstance(inst, lead.phone, declineMsg, { leadId: lead.id })
          if (sendRes.ok) {
            db.prepare(`
              INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, ai_agent_id, delivery_status)
              VALUES (?, ?, 'outbound', ?, 'text', 'AI', ?, datetime('now'), ?, ?, 'sent')
            `).run(lead.id, lead.account_id, declineMsg, sendRes.wamsgId, instanceId, agent.id)
            try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
          } else {
            console.warn(`[AI Agent] declineMsg falhou agent=${agent.id} lead=${lead.id}: ${sendRes.reason}`)
          }
        }
        executeHandoff(agent, lead, reason, instanceId)
      }
      const giveUpOnAudio = async (reason) => {
        if (delivery === 'suggest') {
          console.log(`[AI Agent] audio sem transcricao no copiloto lead=${lead.id} (${reason}) — sem sugestao`)
          return
        }
        await declineAndHandoff(reason)
      }

      if (!agent.responds_to_audio) {
        // Flag OFF — comportamento atual preservado (fora do copiloto)
        await giveUpOnAudio('audio_received')
        return
      }

      // Flag ON — baixa audio da Evolution + transcreve via Deepgram + injeta texto
      const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (!inst || inst.status !== 'connected') {
        console.error(`[AI Agent] STT: instancia ${instanceId} indisponivel`)
        await giveUpOnAudio('stt_failed')
        return
      }

      // Pega wa_msg_id da ultima msg de audio inbound do lead
      const lastAudio = db.prepare(`
        SELECT wa_msg_id FROM messages
        WHERE lead_id = ? AND direction = 'inbound' AND media_type = 'audio' AND wa_msg_id IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `).get(lead.id)

      if (!lastAudio?.wa_msg_id) {
        console.error(`[AI Agent] STT: wa_msg_id nao encontrado pra lead=${lead.id}`)
        await giveUpOnAudio('stt_failed')
        return
      }

      try {
        const { buffer, mimetype } = await fetchAudioBuffer(inst, lastAudio.wa_msg_id)
        const result = await transcribeAudio(buffer, { mimetype, language: 'pt-BR' })
        if (!result.ok) throw new Error(result.reason || 'unknown')

        if (!result.transcript.trim()) {
          console.warn(`[AI Agent] STT vazio lead=${lead.id} — handoff`)
          await giveUpOnAudio('audio_received')
          return
        }

        sttSec = result.durationSec
        sttCost = result.costUsd
        sttProvider = 'deepgram'
        console.log(`[AI Agent] STT lead=${lead.id} dur=${sttSec.toFixed(1)}s cost=$${sttCost.toFixed(4)} txt="${result.transcript.slice(0, 80)}${result.transcript.length > 80 ? '...' : ''}"`)

        // Reassign msgContent (parametro) pro Haiku ver o texto transcrito
        msgContent = `[Audio transcrito] ${result.transcript}`
      } catch (e) {
        console.error(`[AI Agent] STT falhou lead=${lead.id}:`, e.message)
        await giveUpOnAudio('stt_failed')
        return
      }
    }

    // 5. Checa max_messages (so quando a IA envia sozinha)
    if (delivery === 'send') {
      const botMsgCount = countBotMessagesInThread(agent, lead.id)
      if (botMsgCount >= agent.max_messages_before_handoff) {
        console.log(`[AI Agent] Max messages atingido agent=${agent.id} lead=${lead.id}`)
        executeHandoff(agent, lead, 'max_messages', instanceId)
        return
      }
    }

    // 6. Carrega tags e etapas disponiveis (pra tools enum)
    const availableTags = db.prepare('SELECT id, name FROM tags WHERE account_id = ?').all(lead.account_id)
    const availableStages = db.prepare(`
      SELECT s.id, s.name FROM funnel_stages s
      JOIN funnels f ON f.id = s.funnel_id
      WHERE f.account_id = ? AND f.is_default = 1
      ORDER BY s.position
    `).all(lead.account_id)

    // 7. Monta system prompt
    const systemPrompt = buildSystemPrompt(agent, lead, availableTags, availableStages, { mode, salesEngine })

    // 8. Monta history (ultimas 10 msgs)
    const history = buildConversationHistory(lead.id, 10)
    // Garante que a ultima msg eh do lead (user)
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: msgContent || '(mensagem vazia)' })
    } else if (mediaType === 'audio' && sttProvider) {
      // Audio foi transcrito (sttProvider setado) — substitui o '[Audio]' que veio do
      // historico DB pela transcricao, senao Haiku ve '[Audio]' e dispara handoff sem motivo.
      history[history.length - 1] = { role: 'user', content: msgContent }
    }

    // 9. Define tools
    const tools = getToolsForAgent(availableTags, availableStages, { mode, salesEngine })
    const toolCtx = { mode, salesEngine }

    // Log de uso de cada chamada. STT loga so na primeira chamada pra nao duplicar.
    let totalTokens = 0
    let totalCost = 0
    let sttLogged = false
    const logUsage = (result) => {
      const withStt = !sttLogged
      sttLogged = true
      db.prepare(`
        INSERT INTO ai_agent_token_log (agent_id, account_id, lead_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, stt_seconds, stt_cost_usd, stt_provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(agent.id, agent.account_id, lead.id, result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheCreation, result.costUsd, withStt ? sttSec : 0, withStt ? sttCost : 0, withStt ? sttProvider : null)
      const iterTokens = result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheCreation
      totalTokens += iterTokens
      totalCost += result.costUsd
      db.prepare("UPDATE ai_agents SET tokens_used_this_month = tokens_used_this_month + ? WHERE id = ?").run(iterTokens, agent.id)
    }

    // 10-12. Multi-turn loop: chama Haiku, executa tools, se nao houver texto e teve tool, chama de novo com tool_results
    const MAX_ITERATIONS = 4
    let workingMessages = [...history]
    let finalText = ''
    let totalToolsExecuted = 0
    let handoffTriggered = false
    let iterationsRun = 0
    let lastAnalysis = null

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterationsRun++
      let result
      try {
        result = await callHaiku({
          systemPrompt,
          messages: workingMessages,
          tools,
          maxTokens: 400,
          toolChoice: 'auto',
          accountId: agent.account_id,
        })
      } catch (e) {
        console.error(`[AI Agent] Erro chamando Haiku agent=${agent.id} iter=${i}:`, e.message)
        break
      }

      logUsage(result)

      // Acumula texto
      if (result.content && result.content.trim()) finalText += (finalText ? ' ' : '') + result.content.trim()

      // Sem tool_uses -> termina
      if (!result.toolUses || result.toolUses.length === 0) break

      // Executa tools (analise primeiro, pra trava de etapa ja enxergar a analise desta rodada)
      const orderedToolUses = [...result.toolUses].sort((a, b) => (a.name === ANALYSIS_TOOL_NAME ? 0 : 1) - (b.name === ANALYSIS_TOOL_NAME ? 0 : 1))
      const toolResults = []
      for (const tu of orderedToolUses) {
        totalToolsExecuted++
        const tr = await executeTool(tu, agent, lead, instanceId, availableTags, availableStages, toolCtx)
        if (tr.handoff) handoffTriggered = true
        if (tr.analysis) lastAnalysis = tr.analysis
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: tr.handoff ? `Handoff executado (reason=${tr.reason}). Termine a conversa.` : (tr.message || 'OK'),
        })
      }

      // Se handoff foi disparado, nao precisa continuar pedindo mais output
      if (handoffTriggered) break

      // Ja tem texto e a unica tool foi a analise: nao gasta outra volta
      if (salesEngine && finalText.trim() && result.toolUses.every(tu => tu.name === ANALYSIS_TOOL_NAME)) break

      // Monta a proxima rodada: adiciona resposta do assistant (text + tool_uses) e o tool_result
      const assistantContent = []
      if (result.content && result.content.trim()) assistantContent.push({ type: 'text', text: result.content })
      for (const tu of result.toolUses) assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      workingMessages = [
        ...workingMessages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ]
    }

    // 12b. Analise obrigatoria: a IA respondeu sem registrar a analise -> uma chamada forcada
    if (salesEngine && !lastAnalysis && !handoffTriggered && finalText.trim()) {
      try {
        const forced = await callHaiku({
          systemPrompt,
          messages: workingMessages,
          tools,
          maxTokens: 400,
          toolChoice: { type: 'tool', name: ANALYSIS_TOOL_NAME },
          accountId: agent.account_id,
        })
        logUsage(forced)
        const tu = (forced.toolUses || []).find(t => t.name === ANALYSIS_TOOL_NAME)
        const analysis = tu ? parseAnalysisInput(tu.input) : null
        if (analysis) {
          saveLeadAnalysis(db, lead.account_id, lead.id, analysis)
          lastAnalysis = analysis
        }
      } catch (e) {
        console.error(`[AI Agent] Analise forcada falhou agent=${agent.id} lead=${lead.id}:`, e.message)
      }
    }
    if (lastAnalysis) {
      try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
    }

    const text = finalText.trim()

    // 13a. Copiloto: grava a sugestao e avisa o Chat. Nada e enviado ao lead.
    if (delivery === 'suggest') {
      if (text) {
        const suggestionId = createReplySuggestion(db, {
          accountId: lead.account_id,
          leadId: lead.id,
          agentId: agent.id,
          content: text,
          source: 'ai',
          payload: lastAnalysis ? { analysis: lastAnalysis } : null,
        })
        try { broadcastSSE(lead.account_id, 'lead:ai_suggestion', { lead_id: lead.id, suggestion_id: suggestionId }) } catch {}
      }
      console.log(`[AI Agent] Processed (copiloto) lead=${lead.id} agent=${agent.id} iters=${iterationsRun} tokens=${totalTokens} cost_usd=${totalCost.toFixed(6)} tools=${totalToolsExecuted} suggestion=${!!text}`)
      return { ok: true, mode, suggestion: !!text }
    }

    // 13b. Automatico / SDR: envia resposta texto (se houver)
    if (text) {
      // Anti-ban: espaca msg do bot se houve outbound recente (<10s) pro mesmo lead.
      // Evita rajada quando lead manda varias inbounds seguidas que disparam respostas em sequencia.
      const lastBotMsg = db.prepare(`
        SELECT created_at FROM messages
        WHERE lead_id = ? AND direction = 'outbound' AND ai_agent_id = ?
        ORDER BY id DESC LIMIT 1
      `).get(lead.id, agent.id)
      if (lastBotMsg?.created_at) {
        const lastMs = new Date(String(lastBotMsg.created_at).replace(' ', 'T') + 'Z').getTime()
        const secondsSince = (Date.now() - lastMs) / 1000
        if (secondsSince < 10) {
          const wait = 2000 + Math.random() * 2000  // 2-4s
          console.log(`[AI Agent] espacando msg do bot lead=${lead.id} wait=${Math.round(wait)}ms (last=${secondsSince.toFixed(1)}s)`)
          await new Promise(r => setTimeout(r, wait))
        }
      }
      const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (inst && inst.status === 'connected') {
        // Anti-ban: marca msg como lida ANTES de responder (humano abre conversa antes)
        try { await markMessageAsRead(inst, lead) } catch {}
        const sendRes = await sendViaInstance(inst, lead.phone, text, { leadId: lead.id })
        if (sendRes.ok) {
          db.prepare(`
            INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, ai_agent_id, delivery_status)
            VALUES (?, ?, 'outbound', ?, 'text', 'AI', ?, datetime('now'), ?, ?, 'sent')
          `).run(lead.id, lead.account_id, text, sendRes.wamsgId, instanceId, agent.id)
          try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
        } else {
          console.error(`[AI Agent] Falha envio agent=${agent.id} lead=${lead.id}: ${sendRes.reason}`)
          return { ok: false, reason: 'send_blocked', sendReason: sendRes.reason }
        }
      } else if (inst && inst.status !== 'connected') {
        return { ok: false, reason: 'instance_disconnected' }
      } else {
        return { ok: false, reason: 'instance_not_found' }
      }
    }

    // 14. SDR: trava liberou -> passa para o vendedor (regra de handoff 'qualified') com resumo
    if (mode === 'sdr' && salesEngine && !handoffTriggered) {
      const fresh = getLead(lead.id)
      if (fresh && !fresh.ai_handed_off_at) {
        const sdrReady = shouldSdrHandoff({
          requiredFields: parseRequiredFields(agent.required_fields),
          lead: fresh,
          criteria: readLeadCriteria(fresh),
          hasQualificationText: !!(agent.qualification_criteria && agent.qualification_criteria.trim()),
        })
        if (sdrReady) {
          addQualificationNote(agent, fresh)
          executeHandoff(agent, fresh, 'qualified', instanceId)
          handoffTriggered = true
          console.log(`[AI Agent] SDR qualificou lead=${lead.id} — passado ao vendedor`)
        }
      }
    }

    console.log(`[AI Agent] Processed lead=${lead.id} agent=${agent.id} mode=${mode} iters=${iterationsRun} tokens=${totalTokens} cost_usd=${totalCost.toFixed(6)} tools=${totalToolsExecuted} handoff=${handoffTriggered} text_len=${finalText.length}`)
    return { ok: true, mode }
  } catch (err) {
    console.error('[AI Agent] processInboundMessage erro:', err.message)
    return { ok: false, reason: 'exception', detail: err.message }
  }
}
```

- [ ] **Step 8: Verificar**

Run: `node --check server/services/aiAgent.js && npm test`
Expected: nenhuma saída do `--check`; testes `# fail 0`.

Run: `git diff --stat server/services/aiAgent.js`
Expected: só `server/services/aiAgent.js` alterado nesta task.

- [ ] **Step 9: Commit**

```bash
git add server/services/aiAgent.js
git commit -m "feat: agente de IA com modo copiloto/sdr, analise obrigatoria, trava de etapa e sugestao"
```

---

### Task 8: Agendador do webhook (agrupamento de 40s no Copiloto)

**Files:**
- Create: `server/services/copilotScheduler.js`
- Modify: `server/routes/webhooks.js:7` (import) e `server/routes/webhooks.js:685-693` (bloco "AI Agent: plug fire-and-forget")

**Interfaces:**
- Consumes:
  - Task 3: `resolveEffectiveMode(agent, lead, attendantIsHuman)`
  - Task 5: `expirePendingForLead(db, accountId, leadId)`
  - Task 6: `createDebouncer({ delayMs })`
  - Task 7: `findAgentForLead(lead, instanceId)`, `processInboundMessage(...)`, `leadHasHumanAttendant(lead)`
- Produces:
  - `COPILOT_GROUP_DELAY_MS = 40000`
  - `scheduleAiForInbound(lead, content: string, mediaType: string, instanceId: number|null): void` (nunca lança erro)
  - `cancelAiTimerForLead(leadId: number): boolean`
  - `cancelAiTimersForAgent(agentId: number): number`

Sobre o plano paralelo: no webhook fica UMA chamada (`scheduleAiForInbound(...)`) dentro do `if` que já existe. Quando o outro plano mover `webhooks.js:422-708` para `server/services/inboundHandler.js`, basta mover essa chamada e o import junto.

Esta task não tem teste automatizado próprio (o agendador importa `aiAgent.js`, que importa `server/db.js`). O comportamento de tempo está coberto pela Task 6; aqui só se liga as peças.

- [ ] **Step 1: Criar o agendador**

`server/services/copilotScheduler.js`:

```js
// Liga a mensagem recebida no webhook ao Agente de IA.
// Copiloto: espera 40s sem nova mensagem do lead e analisa o bloco inteiro (timer em memoria; 1 processo pm2).
// Automatico / SDR: dispara na hora (comportamento atual).
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { findAgentForLead, processInboundMessage, leadHasHumanAttendant } from './aiAgent.js'
import { resolveEffectiveMode } from './copilotMode.js'
import { createDebouncer } from './leadDebouncer.js'
import { expirePendingForLead } from './aiSuggestions.js'

export const COPILOT_GROUP_DELAY_MS = 40 * 1000

const debouncer = createDebouncer({ delayMs: COPILOT_GROUP_DELAY_MS })

function runNow(leadId, content, mediaType, instanceId) {
  // Rele o lead: pode ter mudado durante a espera (pausa, atendente, etapa)
  const fresh = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!fresh) return Promise.resolve()
  return processInboundMessage(fresh, content, mediaType, instanceId)
    .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
}

export function scheduleAiForInbound(lead, content, mediaType, instanceId) {
  try {
    if (!lead) return
    db.prepare('UPDATE leads SET ai_msgs_since_analysis = COALESCE(ai_msgs_since_analysis, 0) + 1 WHERE id = ? AND account_id = ?').run(lead.id, lead.account_id)

    // Nova mensagem do lead expira a sugestao pendente (o Chat limpa a caixa se ela estiver intacta)
    const expired = expirePendingForLead(db, lead.account_id, lead.id)
    if (expired > 0) {
      try { broadcastSSE(lead.account_id, 'lead:ai_suggestion', { lead_id: lead.id }) } catch {}
    }

    if (lead.ai_paused_at) {
      debouncer.cancel(lead.id)
      return
    }

    const agent = findAgentForLead(lead, instanceId)
    const mode = agent ? resolveEffectiveMode(agent, lead, leadHasHumanAttendant(lead)) : 'auto'
    if (mode === 'copilot') {
      debouncer.schedule(lead.id, () => runNow(lead.id, content, mediaType, instanceId), { agentId: agent.id, accountId: lead.account_id })
      return
    }

    setImmediate(() => { runNow(lead.id, content, mediaType, instanceId) })
  } catch (e) {
    console.error('[Copilot] scheduleAiForInbound erro:', e.message)
  }
}

export function cancelAiTimerForLead(leadId) {
  return debouncer.cancel(leadId)
}

export function cancelAiTimersForAgent(agentId) {
  return debouncer.cancelWhere(meta => meta.agentId === agentId)
}
```

- [ ] **Step 2: Trocar o disparo no webhook**

Em `server/routes/webhooks.js`, trocar a linha 7:

```js
import { processInboundMessage, sendBotWelcomeForSheetsLead } from '../services/aiAgent.js'
```

por:

```js
import { sendBotWelcomeForSheetsLead } from '../services/aiAgent.js'
import { scheduleAiForInbound } from '../services/copilotScheduler.js'
```

E trocar o bloco (L685-693):

```js
    // AI Agent: plug fire-and-forget pra bot responder leads inbound (se conta tiver feature)
    // Skip outbound, sem content, sem lead, ou se ja teve handoff pra humano
    if (!fromMe && lead && (content || mediaType === 'audio')) {
      const freshLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
      setImmediate(() => {
        processInboundMessage(freshLead, content || '', mediaType, waInstance?.id || null)
          .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
      })
    }
```

por:

```js
    // AI Agent: agenda a IA (na hora no automatico/SDR; 40s de agrupamento no Copiloto)
    if (!fromMe && lead && (content || mediaType === 'audio')) {
      const freshLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
      scheduleAiForInbound(freshLead, content || '', mediaType, waInstance?.id || null)
    }
```

- [ ] **Step 3: Verificar**

Run: `node --check server/services/copilotScheduler.js && node --check server/routes/webhooks.js && npm test`
Expected: nenhuma saída dos `--check`; testes `# fail 0`.

Run: `git grep -n "processInboundMessage" server/routes/webhooks.js`
Expected: nenhuma linha (o webhook não chama mais a IA direto).

- [ ] **Step 4: Commit**

```bash
git add server/services/copilotScheduler.js server/routes/webhooks.js
git commit -m "feat: webhook agenda a IA com agrupamento de 40s no modo copiloto"
```

---

### Task 9: API do Copiloto, modo do agente e fonte da chave

**Files:**
- Create: `server/routes/copilot.js`
- Modify: `server/index.js:31` (import) e `server/index.js:81` (rota)
- Modify: `server/routes/agents.js` — imports (L1-6), POST `/` (L112-156), PUT `/:id` (L204-234 e L272), `toggle-active` (L291-299), DELETE (L346-348)
- Modify: `server/routes/accounts.js:67` e `server/routes/accounts.js:96-98` (`PUT /:id`)

**Interfaces:**
- Consumes:
  - Task 3: `AGENT_MODES`, `normalizeAgentMode`
  - Task 5: `getPendingSuggestion`, `resolveSuggestion`, `expirePendingForAgent`, `pauseAiForLead`, `resumeAiForLead`
  - Task 8: `cancelAiTimerForLead`, `cancelAiTimersForAgent`
  - `canAtendenteAccessLead(userId, lead)` de `server/services/leadAccess.js`
- Produces (todas com `authenticate` + `scopeToAccount`; o front manda `?account_id=`):
  - `GET /api/copilot/leads/:leadId/suggestion` -> `{ suggestion: AiSuggestion | null }`
  - `POST /api/copilot/suggestions/:id/resolve` body `{ action: 'sent'|'discarded', final_content?: string }` -> `{ suggestion }` (404 `not_found`, 409 `not_pending`, 400 `invalid_action`)
  - `POST /api/copilot/leads/:leadId/pause` -> `{ lead_id, ai_paused_at }`
  - `POST /api/copilot/leads/:leadId/resume` -> `{ lead_id, ai_paused_at: null }`
  - `POST/PUT /api/agents` aceitam `mode` (`auto`|`copilot`|`sdr`, 400 se inválido)
  - `PUT /api/accounts/:id` (só `super_admin`) aceita `ai_key_source` (`client`|`dros`, 400 se inválido)
  - Trocar `mode`, desligar (`is_active` 0 no PUT ou no toggle) ou apagar o agente expira as sugestões pendentes dele, cancela os timers e emite `lead:ai_suggestion` para cada lead afetado

- [ ] **Step 1: Criar a rota do Copiloto**

`server/routes/copilot.js`:

```js
// API do Copiloto: sugestao pendente, resolver sugestao, pausar/retomar IA na conversa.
import { Router } from 'express'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { getPendingSuggestion, resolveSuggestion } from '../services/aiSuggestions.js'
import { pauseAiForLead, resumeAiForLead } from '../services/leadAiPause.js'
import { cancelAiTimerForLead } from '../services/copilotScheduler.js'

const router = Router()

// Mesmo criterio das rotas de leads: conta do usuario (exceto super_admin) + acesso do atendente
function loadAccessibleLead(req, res, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead) { res.status(404).json({ error: 'Lead nao encontrado' }); return null }
  if (req.user.role !== 'super_admin' && lead.account_id !== req.user.account_id) {
    res.status(403).json({ error: 'Sem permissao' }); return null
  }
  if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead)) {
    res.status(403).json({ error: 'Sem permissao' }); return null
  }
  return lead
}

router.get('/leads/:leadId/suggestion', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  res.json({ suggestion: getPendingSuggestion(db, lead.account_id, lead.id) })
})

router.post('/suggestions/:id/resolve', (req, res) => {
  const row = db.prepare('SELECT id, lead_id FROM ai_suggestions WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const lead = loadAccessibleLead(req, res, row.lead_id)
  if (!lead) return
  const { action, final_content } = req.body || {}
  const r = resolveSuggestion(db, { accountId: lead.account_id, suggestionId: row.id, action, finalContent: final_content, userId: req.user.id })
  if (!r.ok) {
    const status = r.error === 'not_found' ? 404 : r.error === 'not_pending' ? 409 : 400
    return res.status(status).json({ error: r.error })
  }
  res.json({ suggestion: r.suggestion })
})

router.post('/leads/:leadId/pause', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  const aiPausedAt = pauseAiForLead(db, { accountId: lead.account_id, leadId: lead.id, userId: req.user.id })
  cancelAiTimerForLead(lead.id)
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  try { broadcastSSE(lead.account_id, 'lead:ai_suggestion', { lead_id: lead.id }) } catch {}
  console.log(`[Copilot] IA pausada lead=${lead.id} por user=${req.user.id}`)
  res.json({ lead_id: lead.id, ai_paused_at: aiPausedAt })
})

router.post('/leads/:leadId/resume', (req, res) => {
  const lead = loadAccessibleLead(req, res, req.params.leadId)
  if (!lead) return
  resumeAiForLead(db, { accountId: lead.account_id, leadId: lead.id })
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
  console.log(`[Copilot] IA retomada lead=${lead.id} por user=${req.user.id}`)
  res.json({ lead_id: lead.id, ai_paused_at: null })
})

export default router
```

- [ ] **Step 2: Montar a rota**

Em `server/index.js`, depois de `import agentRoutes from './routes/agents.js'` (L31):

```js
import copilotRoutes from './routes/copilot.js'
```

E depois de `app.use('/api/agents', authenticate, scopeToAccount, agentRoutes)` (L81):

```js
app.use('/api/copilot', authenticate, scopeToAccount, copilotRoutes)
```

- [ ] **Step 3: `mode` e expiração em `agents.js`**

Em `server/routes/agents.js`, depois do import de `pickAnthropicKey` (Task 2):

```js
import { AGENT_MODES, normalizeAgentMode } from '../services/copilotMode.js'
import { expirePendingForAgent } from '../services/aiSuggestions.js'
import { cancelAiTimersForAgent } from '../services/copilotScheduler.js'
import { broadcastSSE } from '../sse.js'
```

Depois da função `resetMonthlyTokensIfNeeded` (antes de `// ─── Routes`):

```js
// Troca de modo / desligar / apagar: sugestoes pendentes expiram e timers de agrupamento sao cancelados
function expireAgentSuggestions(accountId, agentId) {
  const leadIds = expirePendingForAgent(db, accountId, agentId)
  cancelAiTimersForAgent(Number(agentId))
  for (const leadId of leadIds) {
    try { broadcastSSE(accountId, 'lead:ai_suggestion', { lead_id: leadId }) } catch {}
  }
  return leadIds.length
}
```

No `POST /`, logo depois do laço que valida `handoffRules` (antes de `try {`):

```js
  if (b.mode !== undefined && !AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: `mode invalido: ${b.mode}` })
```

No mesmo POST, trocar o INSERT do agente:

```js
      const agentRes = db.prepare(`
        INSERT INTO ai_agents (
          account_id, user_id, name, is_active, identifies_as_bot,
          persona, knowledge_base, never_mention, qualification_criteria, required_fields,
          responds_to_audio, audio_decline_message,
          max_messages_before_handoff, handoff_keywords,
          activation_mode, required_tag_id, monthly_token_limit, current_month
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
```

por:

```js
      const agentRes = db.prepare(`
        INSERT INTO ai_agents (
          account_id, user_id, name, is_active, identifies_as_bot,
          persona, knowledge_base, never_mention, qualification_criteria, required_fields,
          responds_to_audio, audio_decline_message,
          max_messages_before_handoff, handoff_keywords,
          activation_mode, required_tag_id, monthly_token_limit, current_month, mode
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
```

e trocar o último argumento do `.run(...)`:

```js
        parseInt(b.monthly_token_limit) || 500000,
        new Date().toISOString().slice(0, 7)
      )
```

por:

```js
        parseInt(b.monthly_token_limit) || 500000,
        new Date().toISOString().slice(0, 7),
        normalizeAgentMode(b.mode)
      )
```

No `PUT /:id`, logo depois do bloco `if (handoffRules) { for (...) {...} }` de validação (antes de `try {`):

```js
  if (b.mode !== undefined && !AGENT_MODES.includes(b.mode)) return res.status(400).json({ error: `mode invalido: ${b.mode}` })
```

No objeto `fields`, depois de `welcome_extra_instructions: ...,`:

```js
        mode: b.mode !== undefined ? normalizeAgentMode(b.mode) : undefined,
```

E trocar a linha final de sucesso do PUT:

```js
    res.json({ agent: loadAgentFull(req.params.id) })
```

por:

```js
    const newMode = b.mode !== undefined ? normalizeAgentMode(b.mode) : normalizeAgentMode(existing.mode)
    const modeChanged = normalizeAgentMode(existing.mode) !== newMode
    const turnedOff = b.is_active !== undefined && !b.is_active && existing.is_active === 1
    if (modeChanged || turnedOff) expireAgentSuggestions(req.accountId, existing.id)

    res.json({ agent: loadAgentFull(req.params.id) })
```

No `PATCH /:id/toggle-active`, trocar:

```js
    console.log(`[Bot Toggle] PAUSED agent=${agent.id} by user=${req.user.id}`)
```

por:

```js
    expireAgentSuggestions(agent.account_id, agent.id)
    console.log(`[Bot Toggle] PAUSED agent=${agent.id} by user=${req.user.id}`)
```

No `DELETE /:id`, trocar:

```js
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(existing.user_id)
  res.json({ ok: true })
```

por:

```js
  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(existing.user_id)
  expireAgentSuggestions(req.accountId, existing.id)
  res.json({ ok: true })
```

- [ ] **Step 4: `ai_key_source` em `accounts.js`**

Em `server/routes/accounts.js`, no `PUT /:id` (L67), acrescentar `ai_key_source` no fim da desestruturação:

```js
  const { name, logo_url, is_active, evolution_api_url, evolution_api_key, cnpj, razao_social, segmento, website, instagram, whatsapp_comercial, valor_mensal, contrato_inicio, cidade, estado, observacoes, trabalha_anuncio, investimento_anuncios, meta_pixel_id, meta_capi_token, meta_capi_test_event_code, meta_capi_enabled, meta_page_id, ai_agents_enabled, attendant_analytics_enabled, admin_marks_as_read, anthropic_api_key, analysis_token_limit, ai_key_source } = req.body
```

E depois da linha `if (analysis_token_limit !== undefined) { ... }` (L97):

```js
  if (ai_key_source !== undefined) {
    if (!['client', 'dros'].includes(ai_key_source)) return res.status(400).json({ error: 'ai_key_source invalido' })
    sets.push('ai_key_source = ?'); params.push(ai_key_source)
  }
```

- [ ] **Step 5: Verificar sintaxe e testes**

Run: `node --check server/routes/copilot.js && node --check server/routes/agents.js && node --check server/routes/accounts.js && node --check server/index.js && npm test`
Expected: nenhuma saída dos `--check`; testes `# fail 0`.

- [ ] **Step 6: Verificar a API com o servidor local**

Run (terminal 1): `npm run dev:server`
Expected: `[Dros CRM API] Running on http://localhost:3002` e, na primeira vez, as linhas `[DB] Added column ai_agents.mode` etc.

Run (terminal 2, trocando e-mail/senha por um `super_admin` local, `LEAD` por um lead da conta `ACC`):

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login -H "content-type: application/json" -d '{"email":"admin@local","password":"senha"}' | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).token))")
curl -s "http://localhost:3002/api/copilot/leads/LEAD/suggestion?account_id=ACC" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "http://localhost:3002/api/copilot/leads/LEAD/pause?account_id=ACC" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "http://localhost:3002/api/copilot/leads/LEAD/resume?account_id=ACC" -H "Authorization: Bearer $TOKEN"
curl -s -X POST "http://localhost:3002/api/copilot/suggestions/999999/resolve?account_id=ACC" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"action":"sent","final_content":"x"}'
curl -s -X PUT "http://localhost:3002/api/accounts/ACC" -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" -d '{"ai_key_source":"errado"}'
```

Expected, na ordem: `{"suggestion":null}`; `{"lead_id":LEAD,"ai_paused_at":"2026-..."}`; `{"lead_id":LEAD,"ai_paused_at":null}`; `{"error":"not_found"}`; `{"error":"ai_key_source invalido"}`.

- [ ] **Step 7: Commit**

```bash
git add server/routes/copilot.js server/index.js server/routes/agents.js server/routes/accounts.js
git commit -m "feat: api do copiloto (sugestao, pausa por conversa), modo do agente e fonte da chave da IA"
```

---

### Task 10: Desligar o atendimento — leads da IA vão para o vendedor

**Files:**
- Create: `server/services/agentShutdown.js`
- Modify: `server/services/aiAgent.js` — imports (depois dos imports da Task 7) e nova função `releaseLeadsFromAgent` no fim do arquivo (depois de `replayLastMessagesForAgent`)
- Modify: `server/routes/agents.js` — import de `aiAgent.js` (L6), helper novo depois de `expireAgentSuggestions` (Task 9), `PUT /:id`, `PATCH /:id/toggle-active` e `DELETE /:id` (trechos criados na Task 9)
- Test: `test/agentShutdown.test.js`

**Interfaces:**
- Consumes:
  - Task 1: `createTestDb`, `seedAccountAndLead` (só no teste)
  - Task 7: `executeHandoff(agent, lead, reason, instanceId)` (interna do `aiAgent.js`), `notifyAndOpenLead(leadId, userId, opts)` (já importada no `aiAgent.js`)
  - Task 9: `expireAgentSuggestions(accountId, agentId)` em `agents.js`
- Produces:
  - `AGENT_OFF_NOTE = 'IA desligada — assuma a conversa'`
  - `findLeadsHeldByAgent(db, { accountId: number, agentId: number, agentUserId: number|null }): Lead[]` — leads ativos, não arquivados, não bloqueados, sem `ai_handed_off_at`, que têm o robô do agente como atendente OU (sem atendente / atendente robô) e com mensagem enviada por esse agente
  - `findResponsibleHumanId(db, { accountId: number, leadId: number, instanceId: number|null }): number|null` — atendente humano ativo da conversa naquela instância (`lead_instance_assignments`), senão o atendente padrão humano ativo da instância
  - `export function releaseLeadsFromAgent(agent: { id, account_id, user_id }): { total: number, released: number }` em `aiAgent.js`
  - `shutdownAgentAttendance(agent): { expired_suggestions: number, released_leads: number }` em `agents.js`
  - `PATCH /api/agents/:id/toggle-active` ao desligar responde `{ ok: true, is_active: 0, released_leads: number }`

Regras (spec 3.10, decisão do CEO): desligar o agente (`is_active = 0` pelo PUT, pelo botão do card ou apagando o agente) vale na hora: timers de agrupamento cancelados, sugestões pendentes expiram e cada lead que estava com a IA e ainda não foi passado vai para o vendedor responsável (ou roleta), com `ai_handed_off_at` preenchido, aviso ao vendedor por `notifyAndOpenLead` e nota "IA desligada — assuma a conversa". Trocar só o modo continua apenas expirando sugestões. Religar não devolve esses leads para a IA (eles já foram passados).

- [ ] **Step 1: Escrever o teste que falha**

`test/agentShutdown.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedAccountAndLead } from './helpers/memoryDb.js'
import { AGENT_OFF_NOTE, findLeadsHeldByAgent, findResponsibleHumanId } from '../server/services/agentShutdown.js'

// Colunas e tabelas de atendimento que o helper da Task 1 nao cria
function addAttendanceTables(db) {
  db.exec(`
    ALTER TABLE users ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN attendant_id INTEGER;
    ALTER TABLE leads ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE leads ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content TEXT,
      ai_agent_id INTEGER
    );
    CREATE TABLE whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      default_attendant_id INTEGER
    );
    CREATE TABLE lead_instance_assignments (
      lead_id INTEGER NOT NULL,
      instance_id INTEGER NOT NULL,
      attendant_id INTEGER,
      PRIMARY KEY (lead_id, instance_id)
    );
  `)
}

function setup() {
  const db = createTestDb()
  addAttendanceTables(db)
  const base = seedAccountAndLead(db)
  // O usuario semeado vira o robo do agente
  db.prepare('UPDATE users SET is_bot = 1 WHERE id = ?').run(base.userId)
  const humanId = Number(db.prepare('INSERT INTO users (account_id, name) VALUES (?, ?)').run(base.accountId, 'Vendedora').lastInsertRowid)
  const newLead = (fields = {}) => {
    const id = Number(db.prepare('INSERT INTO leads (account_id, name) VALUES (?, ?)').run(base.accountId, 'Lead').lastInsertRowid)
    for (const [k, v] of Object.entries(fields)) db.prepare(`UPDATE leads SET ${k} = ? WHERE id = ?`).run(v, id)
    return id
  }
  const aiMessage = (leadId) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, ai_agent_id) VALUES (?, ?, 'outbound', 'oi', ?)").run(leadId, base.accountId, base.agentId)
  return { db, ...base, humanId, newLead, aiMessage }
}

const held = (s) => findLeadsHeldByAgent(s.db, { accountId: s.accountId, agentId: s.agentId, agentUserId: s.userId }).map(l => l.id)

test('AGENT_OFF_NOTE tem o texto do spec', () => {
  assert.equal(AGENT_OFF_NOTE, 'IA desligada — assuma a conversa')
})

test('lead com o robo do agente como atendente esta com a IA', () => {
  const s = setup()
  const id = s.newLead({ attendant_id: s.userId })
  assert.deepEqual(held(s), [id])
})

test('lead sem atendente mas com mensagem enviada pelo agente esta com a IA', () => {
  const s = setup()
  const id = s.newLead()
  s.aiMessage(id)
  assert.ok(held(s).includes(id))
  assert.ok(!held(s).includes(s.leadId), 'lead sem atendente e sem mensagem da IA nao entra')
})

test('fica de fora: ja passado, humano atendendo, arquivado, bloqueado, inativo', () => {
  const s = setup()
  const passado = s.newLead({ attendant_id: s.userId, ai_handed_off_at: '2026-09-15 10:00:00' })
  const humano = s.newLead({ attendant_id: s.humanId })
  s.aiMessage(humano)
  const arquivado = s.newLead({ attendant_id: s.userId, is_archived: 1 })
  const bloqueado = s.newLead({ attendant_id: s.userId, is_blocked: 1 })
  const inativo = s.newLead({ attendant_id: s.userId, is_active: 0 })
  const ids = held(s)
  for (const id of [passado, humano, arquivado, bloqueado, inativo]) assert.ok(!ids.includes(id), `lead ${id} nao deveria entrar`)
})

test('lead de outra conta nao entra', () => {
  const s = setup()
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  s.db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(s.userId, outra.leadId)
  assert.ok(!held(s).includes(outra.leadId))
})

test('responsavel: atendente humano da conversa na instancia', () => {
  const s = setup()
  const inst = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, NULL)').run(s.accountId).lastInsertRowid)
  s.db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(s.leadId, inst, s.humanId)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: inst }), s.humanId)
})

test('responsavel: conversa com robo cai no atendente padrao humano da instancia', () => {
  const s = setup()
  const inst = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.humanId).lastInsertRowid)
  s.db.prepare('INSERT INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(s.leadId, inst, s.userId)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: inst }), s.humanId)
})

test('responsavel: sem humano, sem instancia ou instancia de outra conta = null (vai para a roleta)', () => {
  const s = setup()
  const instRobo = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.userId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instRobo }), null)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: null }), null)
  const outra = seedAccountAndLead(s.db, { accountName: 'Outra' })
  const instOutra = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(outra.accountId, s.humanId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instOutra }), null)
  s.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(s.humanId)
  const instInativo = Number(s.db.prepare('INSERT INTO whatsapp_instances (account_id, default_attendant_id) VALUES (?, ?)').run(s.accountId, s.humanId).lastInsertRowid)
  assert.equal(findResponsibleHumanId(s.db, { accountId: s.accountId, leadId: s.leadId, instanceId: instInativo }), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/agentShutdown.test.js` com `ERR_MODULE_NOT_FOUND` para `server/services/agentShutdown.js`.

- [ ] **Step 3: Implementar as consultas**

`server/services/agentShutdown.js`:

```js
// Desligamento do atendimento da IA (spec 3.10). Recebe o db por parametro. Toda query filtra por conta.

export const AGENT_OFF_NOTE = 'IA desligada — assuma a conversa'

// Leads que estavam com a IA e ainda nao foram passados para um humano
export function findLeadsHeldByAgent(db, { accountId, agentId, agentUserId }) {
  return db.prepare(`
    SELECT l.* FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    WHERE l.account_id = ?
      AND l.is_active = 1
      AND COALESCE(l.is_archived, 0) = 0
      AND COALESCE(l.is_blocked, 0) = 0
      AND l.ai_handed_off_at IS NULL
      AND (
        l.attendant_id = ?
        OR (
          (l.attendant_id IS NULL OR u.is_bot = 1)
          AND EXISTS (
            SELECT 1 FROM messages m
            WHERE m.lead_id = l.id AND m.account_id = l.account_id AND m.ai_agent_id = ?
          )
        )
      )
    ORDER BY l.id
  `).all(accountId, agentUserId || -1, agentId)
}

// Vendedor responsavel: atendente humano ativo da conversa naquela instancia; senao o atendente padrao humano da instancia
export function findResponsibleHumanId(db, { accountId, leadId, instanceId }) {
  if (!instanceId) return null
  const assigned = db.prepare(`
    SELECT u.id FROM lead_instance_assignments a
    JOIN leads l ON l.id = a.lead_id
    JOIN users u ON u.id = a.attendant_id
    WHERE a.lead_id = ? AND a.instance_id = ? AND l.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(leadId, instanceId, accountId)
  if (assigned) return assigned.id
  const byDefault = db.prepare(`
    SELECT u.id FROM whatsapp_instances i
    JOIN users u ON u.id = i.default_attendant_id
    WHERE i.id = ? AND i.account_id = ?
      AND u.is_bot = 0 AND u.is_active = 1
  `).get(instanceId, accountId)
  return byDefault ? byDefault.id : null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS (`# fail 0`).

- [ ] **Step 5: Passar os leads no `aiAgent.js`**

Em `server/services/aiAgent.js`, depois de `import { createReplySuggestion, getPendingSuggestion } from './aiSuggestions.js'` (Task 7):

```js
import { AGENT_OFF_NOTE, findLeadsHeldByAgent, findResponsibleHumanId } from './agentShutdown.js'
```

No fim do arquivo (depois do `}` que fecha `replayLastMessagesForAgent`):

```js

// ─── releaseLeadsFromAgent ───────────────────────────────────────────────
// Atendimento desligado (spec 3.10): cada lead que estava com a IA vai para o vendedor
// responsavel (ou roleta, via executeHandoff sem regra 'agent_off'), com aviso e nota.
export function releaseLeadsFromAgent(agent) {
  if (!agent) return { total: 0, released: 0 }
  const leads = findLeadsHeldByAgent(db, { accountId: agent.account_id, agentId: agent.id, agentUserId: agent.user_id })
  let released = 0
  for (const lead of leads) {
    try {
      const instanceId = lead.last_instance_id || lead.instance_id || null
      const responsibleId = findResponsibleHumanId(db, { accountId: lead.account_id, leadId: lead.id, instanceId })
      if (responsibleId) {
        db.prepare("UPDATE leads SET attendant_id = ?, ai_handed_off_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND account_id = ?")
          .run(responsibleId, lead.id, lead.account_id)
        try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}
        setImmediate(() => {
          notifyAndOpenLead(lead.id, responsibleId, { source: 'bot_handoff' })
            .catch(e => console.error('[Agent off handoff]', e.message))
        })
      } else {
        executeHandoff(agent, lead, 'agent_off', instanceId)
      }
      db.prepare('INSERT INTO lead_notes (lead_id, user_id, content) VALUES (?, ?, ?)').run(lead.id, agent.user_id, AGENT_OFF_NOTE)
      released++
    } catch (e) {
      console.error(`[AI Agent] releaseLeadsFromAgent lead=${lead.id}:`, e.message)
    }
  }
  console.log(`[AI Agent] Atendimento desligado agent=${agent.id} leads=${leads.length} passados=${released}`)
  return { total: leads.length, released }
}
```

- [ ] **Step 6: Usar nas rotas de agentes**

Em `server/routes/agents.js`, trocar:

```js
import { replayLastMessagesForAgent } from '../services/aiAgent.js'
```

por:

```js
import { replayLastMessagesForAgent, releaseLeadsFromAgent } from '../services/aiAgent.js'
```

Depois da função `expireAgentSuggestions` (Task 9), trocar:

```js
  return leadIds.length
}
```

por:

```js
  return leadIds.length
}

// Desligar o atendimento: expira sugestoes, cancela timers e passa os leads da IA para o vendedor
function shutdownAgentAttendance(agent) {
  const expired = expireAgentSuggestions(agent.account_id, agent.id)
  const release = releaseLeadsFromAgent(agent)
  return { expired_suggestions: expired, released_leads: release.released }
}
```

No `PUT /:id`, trocar:

```js
    if (modeChanged || turnedOff) expireAgentSuggestions(req.accountId, existing.id)
```

por:

```js
    if (turnedOff) shutdownAgentAttendance(existing)
    else if (modeChanged) expireAgentSuggestions(req.accountId, existing.id)
```

No `PATCH /:id/toggle-active`, trocar:

```js
    expireAgentSuggestions(agent.account_id, agent.id)
    console.log(`[Bot Toggle] PAUSED agent=${agent.id} by user=${req.user.id}`)
    return res.json({ ok: true, is_active: 0 })
```

por:

```js
    const shutdown = shutdownAgentAttendance(agent)
    console.log(`[Bot Toggle] PAUSED agent=${agent.id} by user=${req.user.id} released_leads=${shutdown.released_leads}`)
    return res.json({ ok: true, is_active: 0, released_leads: shutdown.released_leads })
```

No `DELETE /:id`, trocar:

```js
  expireAgentSuggestions(req.accountId, existing.id)
  res.json({ ok: true })
```

por:

```js
  shutdownAgentAttendance(existing)
  res.json({ ok: true })
```

- [ ] **Step 7: Verificar**

Run: `node --check server/services/aiAgent.js && node --check server/routes/agents.js && npm test`
Expected: nenhuma saída dos `--check`; testes `# fail 0`.

Verificação manual (servidor local, `npm run dev:server`): num agente ativo com um lead que tem o robô como atendente (`UPDATE leads SET attendant_id = <user_id do agente>, ai_handed_off_at = NULL WHERE id = <lead>`), chamar `curl -s -X PATCH "http://localhost:3002/api/agents/<agente>/toggle-active?account_id=<conta>" -H "Authorization: Bearer $TOKEN"`.
Expected: `{"ok":true,"is_active":0,"released_leads":1}`; o lead fica com `ai_handed_off_at` preenchido e atendente humano (ou o da roleta); `SELECT content FROM lead_notes WHERE lead_id = <lead> ORDER BY id DESC LIMIT 1` devolve `IA desligada — assuma a conversa`; o log mostra `[AI Agent] Atendimento desligado agent=<agente> leads=1 passados=1`.

- [ ] **Step 8: Commit**

```bash
git add server/services/agentShutdown.js server/services/aiAgent.js server/routes/agents.js test/agentShutdown.test.js
git commit -m "feat: desligar o atendimento passa os leads da IA para o vendedor com aviso"
```

---

### Task 11: Front — tipos, fetchers e evento SSE

**Files:**
- Modify: `src/lib/api.ts:23` (`Account`), `src/lib/api.ts:41` (`Lead`), `src/lib/api.ts:703-762` (`AgentMode`, `Agent`, `AgentInput`), `src/lib/api.ts:820` (fetchers novos depois de `testAgent`)
- Modify: `src/context/SSEContext.tsx:29`

**Interfaces:**
- Consumes: rotas da Task 9.
- Produces:
  - `type AgentMode = 'auto' | 'copilot' | 'sdr'`
  - `interface AiSuggestion { id: number; account_id: number; lead_id: number; agent_id: number | null; kind: 'reply' | 'follow_up'; source: 'ai' | 'base'; content: string; status: 'pending' | 'sent' | 'edited' | 'discarded' | 'expired'; final_content: string | null; created_at: string; resolved_at: string | null; resolved_by: number | null }`
  - `Agent.mode: AgentMode`, `AgentInput.mode?: AgentMode`, `Account.ai_key_source?: 'client' | 'dros'`
  - `Lead.ai_close_chance?`, `ai_main_blocker?`, `ai_moment?`, `ai_criteria_json?`, `ai_paused_at?`, `ai_paused_by?`, `ai_handed_off_at?`
  - `fetchPendingAiSuggestion(leadId: number, accountId: number): Promise<AiSuggestion | null>`
  - `resolveAiSuggestion(id: number, accountId: number, action: 'sent' | 'discarded', finalContent?: string): Promise<{ suggestion: AiSuggestion }>`
  - `pauseLeadAi(leadId: number, accountId: number): Promise<{ lead_id: number; ai_paused_at: string | null }>`
  - `resumeLeadAi(leadId: number, accountId: number): Promise<{ lead_id: number; ai_paused_at: string | null }>`
  - Evento `lead:ai_suggestion` entregue aos `useSSE`

- [ ] **Step 1: Tipos em `api.ts`**

No `Account` (L23), trocar o final da linha:

```ts
admin_marks_as_read?: number; anthropic_api_key?: string | null; analysis_token_limit?: number }
```

por:

```ts
admin_marks_as_read?: number; anthropic_api_key?: string | null; analysis_token_limit?: number; ai_key_source?: 'client' | 'dros' }
```

No `Lead`, trocar a linha:

```ts
  client_ip_address?: string | null; client_user_agent?: string | null
```

por:

```ts
  client_ip_address?: string | null; client_user_agent?: string | null
  ai_close_chance?: number | null; ai_main_blocker?: string | null; ai_moment?: string | null; ai_criteria_json?: string | null
  ai_paused_at?: string | null; ai_paused_by?: number | null; ai_handed_off_at?: string | null
```

Antes de `export interface AgentStage` (L703):

```ts
export type AgentMode = 'auto' | 'copilot' | 'sdr'
```

No `interface Agent`, trocar:

```ts
  activation_mode: AgentActivationMode
  required_tag_id: number | null
  monthly_token_limit: number
  tokens_used_this_month: number
```

por:

```ts
  activation_mode: AgentActivationMode
  mode: AgentMode
  required_tag_id: number | null
  monthly_token_limit: number
  tokens_used_this_month: number
```

No `interface AgentInput`, trocar:

```ts
  activation_mode?: AgentActivationMode
  required_tag_id?: number | null
  monthly_token_limit?: number
```

por:

```ts
  activation_mode?: AgentActivationMode
  mode?: AgentMode
  required_tag_id?: number | null
  monthly_token_limit?: number
```

- [ ] **Step 2: Fetchers do Copiloto**

Logo depois da definição de `export const testAgent = ...` (L819-820):

```ts

// Copiloto: sugestao da IA na caixa do Chat + pausa da IA por conversa
export interface AiSuggestion {
  id: number
  account_id: number
  lead_id: number
  agent_id: number | null
  kind: 'reply' | 'follow_up'
  source: 'ai' | 'base'
  content: string
  status: 'pending' | 'sent' | 'edited' | 'discarded' | 'expired'
  final_content: string | null
  created_at: string
  resolved_at: string | null
  resolved_by: number | null
}
export const fetchPendingAiSuggestion = (leadId: number, accountId: number) =>
  apiFetch<{ suggestion: AiSuggestion | null }>(`/api/copilot/leads/${leadId}/suggestion?account_id=${accountId}`).then(d => d.suggestion)
export const resolveAiSuggestion = (id: number, accountId: number, action: 'sent' | 'discarded', finalContent?: string) =>
  apiFetch<{ suggestion: AiSuggestion }>(`/api/copilot/suggestions/${id}/resolve?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({ action, final_content: finalContent }) })
export const pauseLeadAi = (leadId: number, accountId: number) =>
  apiFetch<{ lead_id: number; ai_paused_at: string | null }>(`/api/copilot/leads/${leadId}/pause?account_id=${accountId}`, { method: 'POST' })
export const resumeLeadAi = (leadId: number, accountId: number) =>
  apiFetch<{ lead_id: number; ai_paused_at: string | null }>(`/api/copilot/leads/${leadId}/resume?account_id=${accountId}`, { method: 'POST' })
```

- [ ] **Step 3: Escutar o evento no SSE**

Em `src/context/SSEContext.tsx` (L29), trocar:

```ts
    const eventTypes = ['lead:created', 'lead:updated', 'lead:message', 'lead:archived', 'lead:unarchived', 'lead:archived-activity', 'broadcast:completed', 'task:updated', 'task:due', 'lead:transfer-requested', 'lead:transfer-accepted', 'lead:transfer-rejected']
```

por:

```ts
    const eventTypes = ['lead:created', 'lead:updated', 'lead:message', 'lead:archived', 'lead:unarchived', 'lead:archived-activity', 'broadcast:completed', 'task:updated', 'task:due', 'lead:transfer-requested', 'lead:transfer-accepted', 'lead:transfer-rejected', 'lead:ai_suggestion']
```

- [ ] **Step 4: Verificar**

Run: `npm run build`
Expected: termina com `✓ built in ...` sem erro.

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: `21` (o `vite build` não checa tipos; o projeto já tem 21 erros de tipo antigos — `import.meta.env` e `AgentEditorModal.tsx` handoff rules). O número não pode subir.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/context/SSEContext.tsx
git commit -m "feat: tipos e chamadas do copiloto no front e evento lead:ai_suggestion"
```

---

### Task 12: Front — Agente: interruptor (modal e card), "Como a IA atua" e chave

**Files:**
- Modify: `src/components/AgentEditorModal.tsx` — imports (L1-10), constantes (antes de L36), estado (L45-54), carga (L117-119 e depois de L168), `handleSave` (L180), handler novo (antes de L238), aba Identidade (L316-340)
- Modify: `src/lib/api.ts` — tipo de retorno de `toggleAgentActive` (L793-798)
- Modify: `src/pages/Agents.tsx` — `handleToggle` (L46, L58, L61) e botão do card (L140-156)

**Interfaces:**
- Consumes: Task 11 (`AgentMode`, `Agent.mode`, `AgentInput.mode`, `Account.ai_key_source`), Task 10 (`toggle-active` devolve `released_leads` ao desligar), `fetchAccount`, `updateAccount`, `toggleAgentActive` (já existem em `api.ts`), `useAuth` (`src/context/AuthContext.tsx`).
- Produces: salva `mode` e `is_active` pelo `updateAgent`/`createAgent` que já existem; `super_admin` salva `ai_key_source` na hora com `updateAccount(accountId, { ai_key_source })`.

- [ ] **Step 1: Imports**

Trocar:

```tsx
import { useEffect, useState } from 'react'
import {
  fetchAgent, createAgent, updateAgent, testAgent, fetchAgentUsage,
```

por:

```tsx
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  fetchAgent, createAgent, updateAgent, testAgent, fetchAgentUsage,
  fetchAccount, updateAccount, type AgentMode,
```

- [ ] **Step 2: Opções do seletor**

Antes de `type Tab = 'identity' | 'when' | 'training' | 'qualification' | 'handoff' | 'audio' | 'followup' | 'cost'`:

```tsx
const AGENT_MODE_OPTS: { value: AgentMode; label: string; desc: string }[] = [
  { value: 'auto', label: 'Automático', desc: 'A IA atende e responde sozinha o tempo todo.' },
  { value: 'copilot', label: 'Copiloto', desc: 'A IA só sugere a resposta na caixa do Chat; o vendedor revisa e envia.' },
  { value: 'sdr', label: 'SDR', desc: 'A IA atende sozinha até o lead estar qualificado, passa para o vendedor e continua como Copiloto.' },
]

```

- [ ] **Step 3: Estado**

Trocar:

```tsx
  const isNew = agentId === 'new'
```

por:

```tsx
  const { user } = useAuth()
  const isNew = agentId === 'new'
```

E trocar:

```tsx
  const [isActive, setIsActive] = useState(true)
```

por:

```tsx
  const [isActive, setIsActive] = useState(true)
  const [mode, setMode] = useState<AgentMode>('auto')
  const [keySource, setKeySource] = useState<'client' | 'dros'>('client')
  const [savingKeySource, setSavingKeySource] = useState(false)
```

- [ ] **Step 4: Carregar modo e fonte da chave**

Trocar:

```tsx
        setActivationMode(a.activation_mode)
```

por:

```tsx
        setActivationMode(a.activation_mode)
        setMode(a.mode || 'auto')
```

E logo depois do fechamento do primeiro `useEffect` (a linha `  }, [agentId, accountId, isNew])`):

```tsx

  // Fonte da chave da IA (so admin da Dros ve e troca)
  useEffect(() => {
    if (user?.role !== 'super_admin') return
    fetchAccount(accountId)
      .then(d => setKeySource(d.account.ai_key_source === 'dros' ? 'dros' : 'client'))
      .catch(() => {})
  }, [accountId, user?.role])
```

- [ ] **Step 5: Salvar o modo**

No `payload` de `handleSave`, trocar:

```tsx
        activation_mode: activationMode,
```

por:

```tsx
        activation_mode: activationMode,
        mode,
```

E antes de `const handleSandbox = async () => {`:

```tsx
  const handleKeySourceChange = async (value: 'client' | 'dros') => {
    const previous = keySource
    setKeySource(value)
    setSavingKeySource(true)
    try {
      await updateAccount(accountId, { ai_key_source: value })
    } catch (e: any) {
      setKeySource(previous)
      alert('Erro ao salvar a chave da IA: ' + (e?.message || ''))
    }
    setSavingKeySource(false)
  }

```

- [ ] **Step 6: Aba Identidade**

Trocar o bloco inteiro da aba (de `{/* ─── Tab: Identidade ─── */}` até o `)}` antes de `{/* ─── Tab: Quando atuar ─── */}`):

```tsx
        {/* ─── Tab: Identidade ─── */}
        {tab === 'identity' && (
          <>
            <div className="form-group">
              <label>Nome do agente *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Ana Clara" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={identifiesAsBot} onChange={e => setIdentifiesAsBot(e.target.checked)} />
                <span>Identifica como IA (recomendado)</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>
                Bot avisa "sou IA assistente". Reduz expectativa do lead e legitima transferência pra humano.
              </small>
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                <span>Ativo</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>Desligue pra pausar o bot sem apagar a configuração.</small>
            </div>
          </>
        )}
```

por:

```tsx
        {/* ─── Tab: Identidade ─── */}
        {tab === 'identity' && (
          <>
            <div className="form-group" style={{ padding: 12, border: `1px solid ${isActive ? 'var(--positive)' : 'var(--border-medium)'}`, borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', margin: 0 }}>
                <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
                <strong>{isActive ? 'Atendimento ligado' : 'Atendimento desligado'}</strong>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>
                Desligado, a IA não responde nem sugere em nenhum lead. Ao salvar, as sugestões pendentes expiram e os leads que estavam com a IA vão para o vendedor responsável (ou roleta) com o aviso "IA desligada — assuma a conversa".
              </small>
            </div>
            <div className="form-group">
              <label>Como a IA atua *</label>
              <div style={{ display: 'grid', gap: 6 }}>
                {AGENT_MODE_OPTS.map(m => (
                  <label key={m.value} style={{ display: 'block', padding: 10, border: `1px solid ${mode === m.value ? 'var(--accent)' : 'var(--border-medium)'}`, borderRadius: 8, cursor: 'pointer', background: mode === m.value ? 'rgba(255,179,0,0.05)' : 'transparent' }}>
                    <input type="radio" name="agent-mode" checked={mode === m.value} onChange={() => setMode(m.value)} style={{ marginRight: 6 }} />
                    <strong>{m.label}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginLeft: 22 }}>{m.desc}</div>
                  </label>
                ))}
              </div>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 4 }}>
                Trocar o modo vale para as próximas mensagens; sugestões pendentes expiram ao salvar.
              </small>
            </div>
            <div className="form-group">
              <label>Nome do agente *</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Ana Clara" />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={identifiesAsBot} onChange={e => setIdentifiesAsBot(e.target.checked)} />
                <span>Identifica como IA (recomendado)</span>
              </label>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 24, display: 'block' }}>
                Bot avisa "sou IA assistente". Reduz expectativa do lead e legitima transferência pra humano. No Copiloto não se aplica.
              </small>
            </div>
            {user?.role === 'super_admin' && (
              <div className="form-group">
                <label>Chave da IA desta conta (só admin Dros)</label>
                <select className="input" value={keySource} disabled={savingKeySource} onChange={e => handleKeySourceChange(e.target.value as 'client' | 'dros')}>
                  <option value="client">Chave do cliente (Integrações)</option>
                  <option value="dros">Chave da Dros</option>
                </select>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block' }}>Vale para todos os agentes da conta. Salva na hora.</small>
              </div>
            )}
          </>
        )}
```

- [ ] **Step 7: Tipo da resposta do liga/desliga**

Em `src/lib/api.ts`, em `toggleAgentActive`, trocar:

```ts
    is_active: number
    replay?: { total: number; will_replay: number }
  }>(`/api/agents/${id}/toggle-active?account_id=${accountId}`, { method: 'PATCH' })
```

por:

```ts
    is_active: number
    replay?: { total: number; will_replay: number }
    released_leads?: number
  }>(`/api/agents/${id}/toggle-active?account_id=${accountId}`, { method: 'PATCH' })
```

- [ ] **Step 8: Interruptor "Atendimento ligado/desligado" no card do agente**

Em `src/pages/Agents.tsx` (`handleToggle`, L46), trocar:

```tsx
      if (!confirm(`Pausar "${a.name}"?\n\nO bot vai parar de responder mensagens. Quando você reativar, ele responde a última msg de cada lead que ficou pendente.`)) return
```

por:

```tsx
      if (!confirm(`Desligar o atendimento de "${a.name}"?\n\nA IA para de responder e de sugerir na hora. Os leads que estavam com ela vão para o vendedor responsável (ou roleta) com o aviso "IA desligada — assuma a conversa".`)) return
```

Trocar (L58):

```tsx
          setToast({ type: 'success', message: `${a.name} reativado` })
```

por:

```tsx
          setToast({ type: 'success', message: `Atendimento de ${a.name} ligado` })
```

Trocar (L61):

```tsx
        setToast({ type: 'success', message: `${a.name} pausado` })
```

por:

```tsx
        const releasedLeads = r.released_leads || 0
        setToast({
          type: 'success',
          message: releasedLeads > 0
            ? `Atendimento de ${a.name} desligado. ${releasedLeads} lead(s) foram para o vendedor com o aviso "IA desligada — assuma a conversa".`
            : `Atendimento de ${a.name} desligado`,
        })
```

E trocar o botão (L140-156):

```tsx
                        <button
                          className="btn btn-sm btn-icon"
                          style={{
                            background: a.is_active ? 'rgba(52,199,89,0.15)' : 'rgba(255,107,107,0.15)',
                            border: `1px solid ${a.is_active ? 'rgba(52,199,89,0.4)' : 'rgba(255,107,107,0.4)'}`,
                            color: a.is_active ? '#34C759' : '#FF6B6B',
                            cursor: togglingId === a.id ? 'wait' : 'pointer',
                            opacity: togglingId === a.id ? 0.6 : 1,
                          }}
                          title={a.is_active
                            ? 'Pausar bot (vai parar de responder)'
                            : 'Reativar bot (responde a última msg dos leads que mandaram durante a pausa)'}
                          onClick={() => handleToggle(a)}
                          disabled={togglingId === a.id}
                        >
                          {a.is_active ? <Power size={11} /> : <PowerOff size={11} />}
                        </button>
```

por:

```tsx
                        <button
                          className="btn btn-sm"
                          style={{
                            background: a.is_active ? 'rgba(52,199,89,0.15)' : 'rgba(255,107,107,0.15)',
                            border: `1px solid ${a.is_active ? 'rgba(52,199,89,0.4)' : 'rgba(255,107,107,0.4)'}`,
                            color: a.is_active ? '#34C759' : '#FF6B6B',
                            cursor: togglingId === a.id ? 'wait' : 'pointer',
                            opacity: togglingId === a.id ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '4px 8px',
                          }}
                          title={a.is_active
                            ? 'Desligar o atendimento: a IA para na hora e os leads dela vão para o vendedor'
                            : 'Ligar o atendimento (responde a última msg dos leads que mandaram enquanto estava desligado)'}
                          onClick={() => handleToggle(a)}
                          disabled={togglingId === a.id}
                        >
                          {a.is_active ? <Power size={11} /> : <PowerOff size={11} />}
                          {a.is_active ? 'Atendimento ligado' : 'Atendimento desligado'}
                        </button>
```

- [ ] **Step 9: Verificar**

Run: `npm run build`
Expected: `✓ built in ...` sem erro.

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: `21` (os mesmos erros de tipo antigos; o número não pode subir).

Verificação manual (`npm run dev`, abrir `http://localhost:5173/crm/`, entrar como `super_admin`, conta Dros, Agentes de IA, editar um agente):
- Aba Identidade mostra no topo "Atendimento ligado" (borda verde) e o seletor com Automático / Copiloto / SDR, com o modo salvo marcado (agentes antigos: Automático).
- Escolher Copiloto, Salvar, reabrir: continua Copiloto.
- Desmarcar "Atendimento ligado", Salvar, reabrir: "Atendimento desligado".
- O select "Chave da IA desta conta" aparece; trocar para "Chave da Dros" e recarregar a página: continua "Chave da Dros". Voltar para "Chave do cliente".
- Entrando como gerente, o select de chave não aparece.
- Na lista de agentes, o card mostra o botão "Atendimento ligado" (verde). Clicar, confirmar: vira "Atendimento desligado" (vermelho) e o aviso informa quantos leads foram para o vendedor. Clicar de novo: volta a "Atendimento ligado" com o aviso "Atendimento de <nome> ligado" (ou o aviso de replay, se houver leads pendentes).

- [ ] **Step 10: Commit**

```bash
git add src/components/AgentEditorModal.tsx src/pages/Agents.tsx src/lib/api.ts
git commit -m "feat: seletor automatico/copiloto/sdr, liga-desliga do atendimento (modal e card) e chave da IA na tela do agente"
```

---

### Task 13: Front — Chat: sugestão na caixa, selo de chance e pausa da IA

**Files:**
- Modify: `src/pages/Chat.tsx` — imports (L12-13), estado (depois de L128), efeitos (depois de L321), `handleSendMsg` (L646-664), `aiEnabledForAccount` (depois de L933), cabeçalho (antes de L1082), acima da caixa (antes de L1198), histórico (L1857)

**Interfaces:**
- Consumes: Task 11 (`AiSuggestion`, `fetchPendingAiSuggestion`, `resolveAiSuggestion`, `pauseLeadAi`, `resumeLeadAi`, campos novos de `Lead`, evento `lead:ai_suggestion`); `useAccount().accounts` (já traz `ai_agents_enabled`).
- Produces: comportamento de tela (sem API nova).

Regras que o código abaixo garante:
- Sugestão só entra na caixa se ela estiver vazia, ou se o texto da caixa ainda for exatamente a sugestão anterior (troca por uma mais nova).
- Se o vendedor já digitou, aparece a linha "Há uma sugestão — ver"; "ver" põe a sugestão na caixa.
- Apagar todo o texto da sugestão = `discarded`. Enviar = `sent` (igual) ou `edited` (a API compara).
- Sugestão que expirou (nova mensagem do lead, pausa, troca de modo) some da caixa só se o texto estiver intacto.
- Trocar de conversa tira da caixa a sugestão intacta da conversa anterior (ela continua pendente no banco e volta ao reabrir).

- [ ] **Step 1: Imports**

Trocar:

```tsx
  fetchReadyMessages, type ReadyMessage,
```

por:

```tsx
  fetchReadyMessages, type ReadyMessage,
  fetchPendingAiSuggestion, resolveAiSuggestion, pauseLeadAi, resumeLeadAi, type AiSuggestion,
```

- [ ] **Step 2: Estado**

Depois de `  const msgInputRef = useRef<HTMLTextAreaElement>(null)`:

```tsx
  // Copiloto: sugestao pendente da IA pro lead aberto
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null)
  const [suggestionInBox, setSuggestionInBox] = useState<AiSuggestion | null>(null)
  const suggestionInBoxRef = useRef<AiSuggestion | null>(null)
  const msgTextRef = useRef('')
  const selectedLeadIdRef = useRef<number | null>(null)
  const [togglingAiPause, setTogglingAiPause] = useState(false)
```

- [ ] **Step 3: Efeitos e funções da sugestão**

Depois de `  useEffect(() => { loadLead() }, [loadLead])`:

```tsx

  // ─── Copiloto: sugestao da IA na caixa de mensagem ───
  useEffect(() => { msgTextRef.current = msgText }, [msgText])

  const placeSuggestionInBox = useCallback((s: AiSuggestion) => {
    suggestionInBoxRef.current = s
    setSuggestionInBox(s)
    setMsgText(s.content)
  }, [])

  const clearSuggestionFromBox = useCallback(() => {
    const inBox = suggestionInBoxRef.current
    suggestionInBoxRef.current = null
    setSuggestionInBox(null)
    // So apaga a caixa se o texto ainda for exatamente a sugestao (nunca apaga o que o vendedor digitou)
    if (inBox && msgTextRef.current === inBox.content) setMsgText('')
  }, [])

  const applyPendingSuggestion = useCallback((s: AiSuggestion | null) => {
    setAiSuggestion(s)
    const inBox = suggestionInBoxRef.current
    if (!s) {
      if (inBox) clearSuggestionFromBox()
      return
    }
    if (inBox && inBox.id === s.id) return
    if (inBox && msgTextRef.current === inBox.content) { placeSuggestionInBox(s); return }
    if (msgTextRef.current.trim() === '') placeSuggestionInBox(s)
  }, [clearSuggestionFromBox, placeSuggestionInBox])

  const loadSuggestion = useCallback(async (leadId: number) => {
    if (!accountId) return
    try {
      const s = await fetchPendingAiSuggestion(leadId, accountId)
      if (leadId !== selectedLeadIdRef.current) return
      applyPendingSuggestion(s)
    } catch {
      // Sem sugestao ou sem acesso: a caixa segue como esta
    }
  }, [accountId, applyPendingSuggestion])

  // Troca de conversa: tira a sugestao intacta da conversa anterior e carrega a pendente da nova
  useEffect(() => {
    selectedLeadIdRef.current = selectedLeadId
    clearSuggestionFromBox()
    setAiSuggestion(null)
    if (selectedLeadId) loadSuggestion(selectedLeadId)
  }, [selectedLeadId, loadSuggestion, clearSuggestionFromBox])

  useSSE('lead:ai_suggestion', useCallback((data: { lead_id: number }) => {
    if (data.lead_id === selectedLeadId) loadSuggestion(data.lead_id)
  }, [selectedLeadId, loadSuggestion]))

  // Apagar todo o texto da sugestao = descartar
  useEffect(() => {
    const inBox = suggestionInBoxRef.current
    if (inBox && msgText.trim() === '' && accountId) {
      suggestionInBoxRef.current = null
      setSuggestionInBox(null)
      setAiSuggestion(null)
      resolveAiSuggestion(inBox.id, accountId, 'discarded').catch(() => {})
    }
  }, [msgText, accountId])
```

- [ ] **Step 4: Enviar avisa a API; botão de pausa**

Trocar a função `handleSendMsg` inteira:

```tsx
  const handleSendMsg = async () => {
    if (!msgText.trim() || !lead || !accountId) return
    // Bloqueia envio se nao ha instancia escolhida (lead novo sem aba ativa)
    const override = sendInstanceOverride || activeConvInstance || undefined
    if (!override) {
      setNotice({ kind: 'error', title: 'Escolha uma instancia', message: 'Clique em "Enviar via" acima do input pra escolher de qual WhatsApp essa mensagem vai sair.' })
      return
    }
    setSending(true)
    try {
      const result = await sendMessage(lead.id, accountId, msgText, override)
      setMessages(prev => [...prev, result.message])
      setMsgText('')
      if (!result.delivered) setNotice({ kind: 'error', title: 'Mensagem nao entregue', message: 'A mensagem foi salva mas NAO foi enviada no WhatsApp. Verifique a conexao da instancia.' })
      setSendInstanceOverride(null)
      loadLeadsList()
    } catch (e: any) { setNotice({ kind: 'error', title: 'Erro ao enviar', message: e?.message || 'Erro desconhecido' }) }
    setSending(false)
  }
```

por:

```tsx
  const handleSendMsg = async () => {
    if (!msgText.trim() || !lead || !accountId) return
    // Bloqueia envio se nao ha instancia escolhida (lead novo sem aba ativa)
    const override = sendInstanceOverride || activeConvInstance || undefined
    if (!override) {
      setNotice({ kind: 'error', title: 'Escolha uma instancia', message: 'Clique em "Enviar via" acima do input pra escolher de qual WhatsApp essa mensagem vai sair.' })
      return
    }
    const sentText = msgText
    const suggestionUsed = suggestionInBoxRef.current
    setSending(true)
    try {
      const result = await sendMessage(lead.id, accountId, sentText, override)
      setMessages(prev => [...prev, result.message])
      if (suggestionUsed) {
        // Zera a referencia ANTES de limpar a caixa, senao o efeito de "apagou = descartou" dispara
        suggestionInBoxRef.current = null
        setSuggestionInBox(null)
        setAiSuggestion(null)
        resolveAiSuggestion(suggestionUsed.id, accountId, 'sent', sentText).catch(() => {})
      }
      setMsgText('')
      if (!result.delivered) setNotice({ kind: 'error', title: 'Mensagem nao entregue', message: 'A mensagem foi salva mas NAO foi enviada no WhatsApp. Verifique a conexao da instancia.' })
      setSendInstanceOverride(null)
      loadLeadsList()
    } catch (e: any) { setNotice({ kind: 'error', title: 'Erro ao enviar', message: e?.message || 'Erro desconhecido' }) }
    setSending(false)
  }

  const handleToggleAiPause = async () => {
    if (!lead || !accountId) return
    setTogglingAiPause(true)
    try {
      const r = lead.ai_paused_at ? await resumeLeadAi(lead.id, accountId) : await pauseLeadAi(lead.id, accountId)
      setLead(prev => (prev && prev.id === r.lead_id ? { ...prev, ai_paused_at: r.ai_paused_at } : prev))
      if (r.ai_paused_at) {
        clearSuggestionFromBox()
        setAiSuggestion(null)
      }
    } catch (e: any) {
      setNotice({ kind: 'error', title: 'Erro na IA desta conversa', message: e?.message || 'Erro desconhecido' })
    }
    setTogglingAiPause(false)
  }
```

- [ ] **Step 5: Conta com IA**

Depois de `  const currentStage = lead ? allStages.find(s => s.id === lead.stage_id) : null`:

```tsx
  const aiEnabledForAccount = !!accounts.find(a => a.id === accountId)?.ai_agents_enabled
```

- [ ] **Step 6: Selo e botão no cabeçalho**

Trocar:

```tsx
                {lead.instance_name && <span style={{ fontSize: 10, color: '#34C759', display: 'flex', alignItems: 'center', gap: 4 }}><Smartphone size={10} />{lead.instance_name}</span>}
```

por:

```tsx
                {lead.ai_close_chance != null && (
                  <span title={lead.ai_moment ? `Momento: ${lead.ai_moment}` : 'Análise da IA'} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(255,179,0,0.12)', color: '#FFB300', whiteSpace: 'nowrap' }}>
                    Chance de fechar {lead.ai_close_chance}% · trava: {lead.ai_main_blocker || 'nenhuma'}
                  </span>
                )}
                {aiEnabledForAccount && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={handleToggleAiPause}
                    disabled={togglingAiPause}
                    title={lead.ai_paused_at ? 'A IA não responde nem sugere nesta conversa' : 'Parar a IA só nesta conversa'}
                    style={{ padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}
                  >
                    {lead.ai_paused_at ? <Play size={12} /> : <Pause size={12} />}
                    {lead.ai_paused_at ? 'Retomar IA' : 'Pausar IA'}
                  </button>
                )}
                {lead.instance_name && <span style={{ fontSize: 10, color: '#34C759', display: 'flex', alignItems: 'center', gap: 4 }}><Smartphone size={10} />{lead.instance_name}</span>}
```

- [ ] **Step 7: Linha "Há uma sugestão" e etiqueta acima da caixa**

Trocar:

```tsx
              <div className="chat-input">
```

por:

```tsx
              {aiSuggestion && suggestionInBox?.id !== aiSuggestion.id && (
                <div style={{ padding: '4px 12px', fontSize: 11, color: '#9B96B0', borderTop: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Bot size={11} style={{ color: '#FFB300' }} />
                  <span>Há uma sugestão —</span>
                  <button onClick={() => placeSuggestionInBox(aiSuggestion)} style={{ background: 'none', border: 'none', color: '#FFB300', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}>ver</button>
                </div>
              )}
              {suggestionInBox && msgText.trim() !== '' && (
                <div style={{ padding: '4px 12px 0', fontSize: 10, color: '#FFB300', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Bot size={10} /> {suggestionInBox.source === 'base' ? 'da base' : 'sugestão da IA'}
                  <span style={{ color: '#6B6580' }}>· Enter envia · apagar descarta</span>
                </div>
              )}
              <div className="chat-input">
```

- [ ] **Step 8: Rótulo no histórico**

Trocar:

```tsx
                        <div style={{ fontSize: 9, color: '#6B6580' }}>{h.trigger_type}{h.user_name ? ` · ${h.user_name}` : ''}</div>
```

por:

```tsx
                        <div style={{ fontSize: 9, color: '#6B6580' }}>{h.trigger_type === 'ai_qualified' ? 'Movido pela IA — qualificação completa' : h.trigger_type}{h.user_name ? ` · ${h.user_name}` : ''}</div>
```

- [ ] **Step 9: Verificar**

Run: `npm run build`
Expected: `✓ built in ...` sem erro.

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: `21` (os mesmos erros de tipo antigos; o número não pode subir).

Verificação manual (`npm run dev`; num terminal à parte, com `sqlite3` ou `node -e`, inserir uma sugestão para simular a IA: `INSERT INTO ai_suggestions (account_id, lead_id, agent_id, content) VALUES (<conta>, <lead>, NULL, 'Oi! Qual o volume por mes?')` e `UPDATE leads SET ai_close_chance = 60, ai_main_blocker = 'preco' WHERE id = <lead>`):
- Abrir a conversa do lead com a caixa vazia: o texto "Oi! Qual o volume por mes?" aparece na caixa com a etiqueta "sugestão da IA".
- No cabeçalho: "Chance de fechar 60% · trava: preco" e o botão "Pausar IA".
- Apagar todo o texto: a etiqueta some; no banco a sugestão fica `discarded`.
- Digitar "teste" na caixa, inserir outra sugestão no banco e trocar para outra conversa e voltar (o texto digitado continua na caixa): aparece "Há uma sugestão — ver" e a caixa mantém "teste"; clicar "ver" põe a sugestão na caixa.
- Editar a sugestão e enviar: no banco fica `edited` com `final_content` igual ao enviado. Enviar sem editar: `sent`.
- Clicar "Pausar IA": vira "Retomar IA", `leads.ai_paused_at` preenchido; clicar de novo limpa.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Chat.tsx
git commit -m "feat: chat mostra sugestao da IA na caixa, selo de chance e botao pausar IA"
```

---

### Task 14: Roteiro de teste ponta a ponta (conta Dros, sem commit)

**Files:** nenhum arquivo muda. Roda depois do deploy de backend + front (comando 3 do `CLAUDE.md`).

**Interfaces:**
- Consumes: tudo das Tasks 1-13.
- Produces: confirmação de que o Plano A funciona sozinho.

- [ ] **Step 1: Deploy — robô Automático passa a vender com qualificação (decisão do CEO)**

No servidor, depois do deploy: `pm2 logs dros-crm --lines 50`.
Expected: linhas `[DB] Added column ai_agents.mode`, `accounts.ai_key_source` e `leads.ai_*` (só na primeira subida), sem erro. Nenhum agente vira Copiloto/SDR sozinho (todos em Automático). Mandar "oi" e depois "quanto custa?" de um número de teste para uma conta com agente ativo em Automático: a IA responde sozinha como antes, mas contorna o preço e faz a próxima pergunta de qualificação; o log mostra `[AI Agent] record_analysis lead=...` e o cabeçalho do Chat desse lead ganha o selo "Chance de fechar X% · trava: Y".

- [ ] **Step 2: Copiloto na conta Dros**

Como `super_admin`, conta Dros: no agente, deixar a chave como está (cliente) ou "Chave da Dros" se `ANTHROPIC_API_KEY_DROS` estiver no `/root/.env`; escolher **Copiloto**, preencher "Critério de qualificação" e Salvar. Com um celular de teste, mandar 2 mensagens seguidas para o WhatsApp da Dros.
Expected: nenhuma resposta sai sozinha; cerca de 40s depois da ÚLTIMA mensagem, a sugestão aparece na caixa do Chat daquele lead com "sugestão da IA" e o selo "Chance de fechar X% · trava: Y" aparece no cabeçalho. No log: `[AI Agent] Processed (copiloto) ... suggestion=true` e `[AI Agent] record_analysis ...`.

- [ ] **Step 3: Nova mensagem expira a sugestão**

Sem enviar, mandar mais uma mensagem do celular.
Expected: a sugestão antiga some da caixa (se não foi editada) e, 40s depois, chega uma nova. Em `ai_suggestions` a antiga fica `expired`.

- [ ] **Step 4: Enviar, editar e descartar**

Enviar uma sugestão sem mexer (`sent`), editar e enviar a próxima (`edited`), apagar a seguinte (`discarded`). Conferir: `SELECT id, status, final_content FROM ai_suggestions WHERE lead_id = <lead> ORDER BY id DESC LIMIT 5`.

- [ ] **Step 5: Trava de etapa**

Pedir preço antes de responder às perguntas de qualificação.
Expected: a sugestão contorna o preço e faz a próxima pergunta; se a IA tentar mover a etapa, o log mostra `move_stage RECUSADO` e a etapa não muda. Depois de responder a tudo, a mudança (se a IA mover) aparece no histórico como "Movido pela IA — qualificação completa".

- [ ] **Step 6: Pausa por conversa e desligar agente**

Clicar "Pausar IA" e mandar mensagem: nenhuma sugestão nova (log sem `Processed`). "Retomar IA" volta a sugerir. Com uma sugestão pendente, desmarcar "Atendimento ligado" e salvar: a sugestão some do Chat e fica `expired`.

Religar o agente em Automático, deixar a IA conversar com um lead novo (sem vendedor) e, na lista de Agentes, clicar no botão "Atendimento ligado" do card e confirmar.
Expected: o botão vira "Atendimento desligado", o aviso diz quantos leads foram para o vendedor; o lead fica com atendente humano (atendente da conversa, atendente padrão da instância ou roleta), recebe a nota "IA desligada — assuma a conversa" e o vendedor recebe a notificação de WhatsApp de sempre. Mandar nova mensagem desse lead: a IA não responde sozinha.

- [ ] **Step 7: SDR**

Trocar o agente para **SDR**, configurar a regra de Handoff "Qualificado" (vendedor de destino e etapa) e usar um lead novo sem atendente humano.
Expected: a IA responde sozinha e faz uma pergunta por mensagem; quando todos os campos obrigatórios e critérios ficam atendidos, o lead vai para o vendedor da regra, aparece a nota "Resumo da qualificacao (IA)" nas notas do lead e, nas próximas mensagens desse lead, a IA só sugere (Copiloto).

---

## Próximos planos (fora do Plano A)

- **Plano B — Entrevista de mapeamento comercial** (spec 3.3): botão "Montar com entrevista", Opus 5, `ai_agents.interview_json`, preenche persona/knowledge_base/never_mention/qualification_criteria/required_fields.
- **Plano C — Base de respostas** (spec 3.9): colunas novas em `ready_messages`, busca sem IA (normalização, sinônimos, nota ≥ 0,6), candidata → oficial, variações, "da base" no Chat, análise obrigatória a cada 5 mensagens usando `leads.ai_msgs_since_analysis` (o contador já é mantido neste plano).
- **Plano D — Follow-up por etapa com IA** (spec 3.5): bloco por etapa na tela do agente, "Criar com IA", `ai_suggestions` tipo `follow_up` no Copiloto, pausa por conversa também no `followUpSender`.
- **Plano E — Aprendizado semanal** (spec 3.6): rotina no `scheduler.js` e "Sugestões de melhoria" com Aprovar/Recusar.
- **Plano F — Medição e custo do mês** (spec 3.7 e 3.8): resumo na tela do agente (base × IA, enviada/editada/descartada, tempo até agir, leads movidos pela IA) e custo do mês só para o admin da Dros.
- **Ainda do spec 3.10, não coberto aqui:** pausar os follow-ups do agente quando o atendimento for desligado (entra junto com o Plano D).
- **Dros Sales como modelo global de agente**, conectável a qualquer conta (reaproveitando o padrão de `globalTemplates.js`).
- **Substituir o agente "AGENTE IA — OXI QUÍMICA" da conta Dros pelo Dros Sales.**
- **Resumo da qualificação na notificação de WhatsApp** do vendedor (hoje vai só como nota do lead; ver Decisão 5).

# Cadência da Etapa — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada etapa do funil tem uma cadência ("cadência da etapa") em que **pergunta** é um tipo de passo; a tela "Qualificação" some e vira parte de "Cadências e Follow-ups"; o Chat ganha a aba Atendimento com termômetro em uma linha e o "Próximo passo"; tudo continua ligado ao motor do roteiro (trava, avanço automático, IA, termômetro, A/B, métricas).

**Architecture:** Caminho 1 da spec: a cadência é a tela, o roteiro continua sendo o motor. Serviços novos em `server/services/cadence/*` (recebem `db`, testáveis com banco em memória): `schema.js` (colunas + reconstrução de `cadence_attempts`), `repo.js` (CRUD com passos atualizados por id + sincronização passo `pergunta` ↔ roteiro publicado), `leadCadence.js` (início/fim na troca de etapa, próximo passo, "feito"), `metrics.js` (envio de passo mensagem vira ask `step-<id>`, métricas por passo), `migrateStageCadences.js` (migração única). As rotas viram fábrica `createCadencesRouter(db, deps)` (padrão de `roteiroRouter.js`) com checagem de conta e de atendente. Front: tela do gestor em `src/pages/cadencias/*`, cartão `NextStepCard` e `ScoreLine` no Chat, lógica pura em `.js` testada com `node --test`.

**Tech Stack:** Node (ESM; produção Node 16), Express 4, better-sqlite3, `node --test`; React + TypeScript + Vite 4; lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-27-cadencia-da-etapa-design.md` (autoridade). Motor que continua valendo: `docs/superpowers/specs/2026-09-25-roteiro-qualificacao-e-termometro-design.md` e `docs/superpowers/plans/2026-09-25-roteiro-e-termometro.md`. Ler a spec antes de cada tarefa.

## Ordem de execução

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 (a numeração já segue as dependências: cada tarefa só consome funções de tarefas anteriores).

## Global Constraints

- Worktree: `C:\Users\RTX-2060\Documents\crm\.worktrees\merge-github` (branch `merge/github-2026-09-24`). Trabalhar só aqui.
- Node local: rodar `export PATH="/c/nvm4w/nodejs:$PATH"` antes de `npm`/`npx`/`node --test`.
- Produção roda **Node 16**: proibido `fetch` global, `Array.prototype.findLast`/`findLastIndex`, `structuredClone`, `Array.prototype.at`, `Object.hasOwn`. HTTP no servidor via `node-fetch`.
- Testes: `node --test test/<arquivo>.test.js`; suíte inteira `npm test` antes de cada commit. Baseline: **909 testes passando**; cada tarefa só soma.
- Typecheck: `npx tsc --noEmit` tem **16 erros pré-existentes**; adicionar **0** novos (comparar a lista ordenada sem linha/coluna). Build: `npx vite build` tem de passar; depois `git restore dist` e apagar asset novo não rastreado.
- Serviços novos **não importam** `server/db.js`: recebem `db`. Só cascas de rota e o boot importam.
- Toda consulta de rota filtra `account_id = req.accountId`; cadência/lead/etapa/funil de outra conta → **404**; atendente sem acesso ao lead (`canAtendenteAccessLead(req.user.id, lead, db)`) → **403**; super_admin sem `account_id` → **400** "Selecione uma conta.".
- Todo texto de tela em **português do Brasil**, simples, sem jargão. Regra **"explica com exemplo"**: tela vazia com exemplo; "?" (`HelpTip`) ao lado de cada título de seção com explicação + exemplo; todo campo com placeholder "ex.: …"; todo número com o porquê (title ou HelpTip).
- **Sem emoji literal** no código (inclui ✓ ▸ ⚙ ↑ ↓ da spec): usar ícones lucide (`Check`, `ChevronRight`, `Settings`, `ArrowUp`, `ArrowDown`, `Snowflake`/`CloudSun`/`Flame`/`Rocket` para as faixas, `Bot` origem IA, `User` origem manual).
- Faixas do termômetro: frio 0–30, morno 31–60, quente 61–85, pronto 86–100. Padrões de conta: `roteiro_min_reply_rate=70`, `roteiro_reply_window_h=24`, `score_alert_minutes=60`.
- Cadências **nunca enviam mensagem sozinhas** (o agendador só avisa `task:due`); follow-ups não mudam.
- Comentários em português, curtos, no estilo do repo. Nunca logar token/segredo.
- Nunca commitar `vite.config.ts` nem `dist/`. **Não dar push.**
- Commits em português com prefixo `feat:`/`fix:`/`refactor:`/`docs:`, terminando com a linha:
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- `CODEBASE_INDEX.md` não existe neste worktree: localizar arquivos com `grep`.

## Review Focus

1. **Reconstruir `cadence_attempts` num banco de produção com `lead_cadences` apontando para ids de passos** (FK ligada, `current_attempt_id` e `last_executed_attempt_id` preenchidos, `sqlite_sequence` alto por causa do antigo "apaga e recria") — ids, ponteiros e contagem ficam iguais, o próximo id novo nunca reaproveita um id antigo, e rodar 2× não faz nada. Teste na Task 1.
2. **Salvar automático com corrida** (duas edições rápidas no mesmo passo, ou edição enquanto o salvamento anterior está no ar) — nunca dois envios juntos, o último texto vence, "Salvo" só aparece depois do último envio, erro mantém o texto e [Tentar de novo] reenvia; no servidor, duas atualizações seguidas no mesmo passo mantêm o id e geram uma versão por mudança. Testes na Task 8 (fila pura) e Task 2 (serviço).
3. **Troca de etapa com lead que tem cadência avulsa ativa** — a avulsa continua ativa no mesmo passo; só a de etapa fecha/abre; aplicar outra avulsa pausa só a avulsa anterior, nunca a de etapa. Teste na Task 3.
4. **Apagar um passo pergunta que está em teste A/B ou já tem respostas** — o teste vira `cancelled`, as respostas ficam (aparecem em "respostas de perguntas antigas"), a trava deixa de exigir a pergunta e desvios que voltavam para ela ficam sem "volta para". Teste na Task 2.
5. **Gestor edita a cadência enquanto o vendedor está com o Chat aberto** — ação do vendedor num passo que sumiu devolve 409 "Esse passo mudou. A tela foi atualizada." sem gravar nada, e a rota do gestor avisa `cadence:updated` para as telas recarregarem. Testes na Task 3 (serviço) e Task 5 (rota + SSE).

---

## Mapa de arquivos

Criar:
- `server/services/cadence/errors.js` — `CadenceError`
- `server/services/cadence/schema.js` — colunas, `lead_cadence_steps`, reconstrução de `cadence_attempts`
- `server/services/cadence/repo.js` — CRUD por id, sincronização com o roteiro, modelos BANT/IA, visão das etapas
- `server/services/cadence/nextStep.js` — cálculo puro do próximo passo
- `server/services/cadence/leadCadence.js` — cadência da etapa no lead
- `server/services/cadence/metrics.js` — envio de passo mensagem, métricas por passo
- `server/services/cadence/migrateStageCadences.js` — migração única
- `server/routes/cadencesRouter.js` — fábrica das rotas
- `test/helpers/cadenceDb.js`, `test/helpers/http.js`
- Testes: `test/cadenceSchema.test.js`, `test/cadenceRepo.test.js`, `test/leadCadence.test.js`, `test/cadenceMetrics.test.js`, `test/cadencesHttp.test.js`, `test/cadenceMigrate.test.js`, `test/stageCadence.test.js`, `test/nextStepView.test.js`
- Front: `src/lib/cadenceApi.ts`, `src/lib/stageCadence.js` + `.d.ts`, `src/lib/nextStep.js` + `.d.ts`, `src/components/score/ConversionByBandCard.tsx`, `src/components/score/ScoreLine.tsx`, `src/components/cadence/NextStepCard.tsx`, `src/components/roteiro/RoteiroNotices.tsx`, `src/pages/cadencias/StageCadences.tsx`, `StepRow.tsx`, `StepPanel.tsx`, `StepInsights.tsx`, `StageDeviations.tsx`, `StageSettings.tsx`, `StageEmpty.tsx`

Modificar: `server/db.js`, `server/routes/cadences.js` (vira casca), `server/routes/tasks.js`, `server/routes/roteiroRouter.js`, `server/routes/leads.js`, `server/routes/messages.js`, `server/services/stageMove.js`, `server/services/roteiro/runtime.js`, `server/services/inboundHandler.js`, `server/services/leadIntake.js`, `src/lib/api.ts`, `src/lib/roteiroApi.ts`, `src/lib/automationTabs.js` (+ `test/automationTabs.test.js`), `src/context/SSEContext.tsx`, `src/pages/CadencesAndFollowUps.tsx`, `src/pages/Cadences.tsx`, `src/pages/Chat.tsx`, `src/pages/LeadDetail.tsx`, `src/pages/Tasks.tsx`, `src/pages/Dashboard.tsx`, `src/components/roteiro/RoteiroCard.tsx`, `src/components/Sidebar.tsx`, `src/App.tsx`.

Apagar: `src/pages/qualificacao/QualificacaoPage.tsx`, `RoteiroEditor.tsx`, `DesempenhoTab.tsx`, `SugestoesTab.tsx` (o `src/lib/roteiroManager.js` fica: a tela nova usa `suggestionWhy`, `SUGGESTION_TITLES`, `testRemainingText`, `testResultText`, `barWidth`, `fmtPct`).

## Decisões de implementação (onde a spec é omissa)

- **D1 — Base da sincronização = versão publicada.** Salvar um passo pergunta monta o conteúdo do roteiro a partir da versão **publicada** (nunca do rascunho), troca só as perguntas daquela etapa e publica se mudou. Rascunhos antigos não publicados da tela "Qualificação" são ignorados (a spec §6 também só migra perguntas publicadas).
- **D2 — "Ordem não gera versão"** vale para mexer passos que não são pergunta; se duas perguntas trocam de lugar entre si, a ordem do roteiro muda e publica (o motor lê a ordem da versão publicada).
- **D3 — Registro de "feito"** fica numa tabela nova `lead_cadence_steps` (uma linha por passo feito/enviado/pulado por `lead_cadences`), e `lead_cadences` ganha `stage_entry_id` (id do `stage_history` da entrada na etapa) para abrir a cadência **uma vez por entrada** sem depender de relógio.
- **D4 — Pular** (botão de Tarefas) conta como concluído para o fluxo em qualquer tipo; "Concluir" numa pergunta pelas Tarefas devolve 400 pedindo a resposta (spec 4.2: pergunta concluída = tem resposta). A trava continua exigindo as obrigatórias.
- **D5 — Cadência da etapa criada depois** pega os leads que já estão na etapa (mesma função da migração, `attachLeadsInStage`).
- **D6 — Pergunta só existe em cadência de etapa**; em avulsa → 400. Cadência da etapa não é apagável nem aplicável à mão (400); some apagando os passos.
- **D7 — Desfazer avanço automático** reabre a `lead_cadences` da etapa de onde o lead saiu (mantém o que já foi feito) em vez de abrir outra.

---

### Task 1: Schema — colunas novas, `lead_cadence_steps` e reconstrução de `cadence_attempts`

**Files:**
- Create: `server/services/cadence/errors.js`, `server/services/cadence/schema.js`, `test/helpers/cadenceDb.js`, `test/cadenceSchema.test.js`
- Modify: `server/db.js` (depois do bloco `migrateLegacyQualifications(db)`, ~linha 1480; import no topo junto de `applyRoteiroSchema`)

**Interfaces:**
- Consumes: `createRoteiroTestDb()`, `seedRoteiroBase(db)`, `addLead(db, fields)` de `test/helpers/roteiroDb.js`.
- Produces:
  - `class CadenceError extends Error { code: string; status: number }` — `new CadenceError(code, status, message)`
  - `CADENCE_ACTION_TYPES = ['mensagem','ligacao','email','reuniao','whatsapp','visita','pergunta']`
  - `rebuildCadenceAttempts(db)` → `{ rebuilt: boolean, count: number | null }`
  - `applyCadenceSchema(db)` → `{ rebuilt: boolean, count: number | null }`
  - Tabela `lead_cadence_steps(id, account_id, lead_cadence_id, lead_id, attempt_id, how ∈ 'enviado'|'feito'|'pulado', done_by, done_at, UNIQUE(lead_cadence_id, attempt_id))`
  - Colunas: `cadences.funnel_id`, `cadences.stage_id`, `cadence_attempts.question_key`, `lead_cadences.kind` (default `'avulsa'`), `lead_cadences.stage_id`, `lead_cadences.stage_entry_id`, `roteiro_asks.attempt_id`; índice único parcial `uq_cadences_stage_active`.
  - Helpers de teste: `createLegacyCadenceTables(db)`, `createCadenceTestDb()` → db, `seedCadenceBase(db)` (= `seedRoteiroBase`), `leadIn(db, s, stageKey, fields?)` → leadId (grava a entrada em `stage_history`), `Q_PRAZO`, `Q_LIVRE`, `publishedRoteiro(db, s)`.

- [ ] **Step 1: `errors.js`**

```js
// Erro de regra da cadencia: a rota devolve { error, code } com o status.
export class CadenceError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'CadenceError'
    this.code = code
    this.status = status
  }
}
```

- [ ] **Step 2: Helper de teste `test/helpers/cadenceDb.js`** (tabelas IGUAIS às de produção antes da mudança, para testar a reconstrução)

```js
// Banco de teste da cadencia da etapa: parte do banco do roteiro e cria as tabelas de
// cadencia como estao em producao hoje (CHECK antigo), para testar a reconstrucao.
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './roteiroDb.js'
import { applyCadenceSchema } from '../../server/services/cadence/schema.js'
import { getRoteiro } from '../../server/services/roteiro/repo.js'

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

export function createLegacyCadenceTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cadences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS cadence_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cadence_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
      action_type TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita')),
      description TEXT, instructions TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position);
    CREATE TABLE IF NOT EXISTS lead_cadences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, cadence_id INTEGER NOT NULL, current_attempt_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
      FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
      FOREIGN KEY (current_attempt_id) REFERENCES cadence_attempts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1, type TEXT, inactivity_stage_id INTEGER
    );
  `)
  for (const [c, t] of [['delay_days', 'INTEGER NOT NULL DEFAULT 0'], ['scheduled_time', 'TEXT'], ['auto_message', 'TEXT'],
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'date'"], ['delay_minutes', 'INTEGER NOT NULL DEFAULT 0'], ['call_script', 'TEXT']]) addCol(db, 'cadence_attempts', c, t)
  for (const [c, t] of [['last_executed_at', 'TEXT'], ['last_executed_attempt_id', 'INTEGER']]) addCol(db, 'lead_cadences', c, t)
}

export function createCadenceTestDb() {
  const db = createRoteiroTestDb()
  createLegacyCadenceTables(db)
  applyCadenceSchema(db)
  return db
}

export const seedCadenceBase = seedRoteiroBase

// Lead parado numa etapa, com a entrada gravada no historico (como as rotas de criacao fazem).
export function leadIn(db, s, stageKey, fields = {}) {
  const id = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages[stageKey], ...fields })
  db.prepare("INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, 'manual')").run(id, s.stages[stageKey])
  return id
}

export const Q_PRAZO = {
  text: 'Para quando é o seu evento, {nome}?', kind: 'options', required: true, bant: 'timeline', ai_hint: null,
  options: [{ label: 'Até 30 dias', points: 15 }, { label: 'Mais de 30 dias', points: 5 }],
}
export const Q_LIVRE = { text: 'Conte mais sobre o evento', kind: 'text', required: false, bant: null, ai_hint: null, options: [] }

export function publishedRoteiro(db, s) {
  return getRoteiro(db, s.accountId, s.funnelId).published
}
```

- [ ] **Step 3: Teste que falha — `test/cadenceSchema.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { createLegacyCadenceTables, createCadenceTestDb } from './helpers/cadenceDb.js'
import { applyCadenceSchema, rebuildCadenceAttempts, CADENCE_ACTION_TYPES } from '../server/services/cadence/schema.js'

function legacyDbWithData() {
  const db = createRoteiroTestDb()
  createLegacyCadenceTables(db)
  const s = seedRoteiroBase(db)
  const cad = Number(db.prepare("INSERT INTO cadences (account_id, name) VALUES (?, 'Reativar')").run(s.accountId).lastInsertRowid)
  const ins = db.prepare("INSERT INTO cadence_attempts (id, cadence_id, position, action_type, description, delay_days, auto_message) VALUES (?, ?, ?, ?, ?, ?, ?)")
  ins.run(40, cad, 0, 'visita', 'lixo do apaga-e-recria', 0, null)
  db.prepare('DELETE FROM cadence_attempts WHERE id = 40').run() // sqlite_sequence fica em 40
  ins.run(5, cad, 0, 'mensagem', 'Oi', 0, 'Oi {nome}')
  ins.run(6, cad, 1, 'ligacao', 'Ligar', 2, null)
  ins.run(9, cad, 2, 'whatsapp', 'Lembrete', 4, 'Lembra de mim?')
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.novo })
  db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, last_executed_attempt_id) VALUES (?, ?, 6, 5)').run(leadId, cad)
  return { db, s, cad, leadId }
}

test('reconstrucao: mesmos ids, ponteiros do lead preservados com FK ligada, sequencia nao volta', () => {
  const { db, cad, leadId } = legacyDbWithData()
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  const r = applyCadenceSchema(db)
  assert.deepEqual(r, { rebuilt: true, count: 3 })
  assert.deepEqual(db.prepare('SELECT id, position, action_type, auto_message FROM cadence_attempts ORDER BY id').all(), [
    { id: 5, position: 0, action_type: 'mensagem', auto_message: 'Oi {nome}' },
    { id: 6, position: 1, action_type: 'ligacao', auto_message: null },
    { id: 9, position: 2, action_type: 'whatsapp', auto_message: 'Lembra de mim?' },
  ])
  const lc = db.prepare('SELECT current_attempt_id, last_executed_attempt_id, kind FROM lead_cadences WHERE lead_id = ?').get(leadId)
  assert.deepEqual(lc, { current_attempt_id: 6, last_executed_attempt_id: 5, kind: 'avulsa' })
  const novo = Number(db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 3, 'email')").run(cad).lastInsertRowid)
  assert.ok(novo > 40, `id novo ${novo} reaproveitou id antigo`)
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  // FK continua funcionando depois da troca de tabela
  db.prepare('DELETE FROM cadence_attempts WHERE id = 6').run()
  assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId).current_attempt_id, null)
})

test('reconstrucao e idempotente e o novo CHECK aceita pergunta so com question_key', () => {
  const { db, cad } = legacyDbWithData()
  applyCadenceSchema(db)
  assert.deepEqual(applyCadenceSchema(db), { rebuilt: false, count: null })
  assert.deepEqual(rebuildCadenceAttempts(db), { rebuilt: false, count: null })
  assert.ok(CADENCE_ACTION_TYPES.includes('pergunta'))
  db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type, question_key) VALUES (?, 5, 'pergunta', 'abc123')").run(cad)
  assert.throws(() => db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 6, 'pergunta')").run(cad), /CHECK/)
  assert.throws(() => db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type) VALUES (?, 6, 'telepatia')").run(cad), /CHECK/)
})

test('colunas novas, tabela de passos feitos e uma cadencia ativa por etapa', () => {
  const db = createCadenceTestDb()
  const s = seedRoteiroBase(db)
  const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  for (const c of ['funnel_id', 'stage_id']) assert.ok(cols('cadences').includes(c), c)
  assert.ok(cols('cadence_attempts').includes('question_key'))
  for (const c of ['kind', 'stage_id', 'stage_entry_id']) assert.ok(cols('lead_cadences').includes(c), c)
  assert.ok(cols('roteiro_asks').includes('attempt_id'))
  assert.ok(cols('lead_cadence_steps').includes('how'))
  const ins = db.prepare('INSERT INTO cadences (account_id, name, funnel_id, stage_id, is_active) VALUES (?, ?, ?, ?, ?)')
  ins.run(s.accountId, 'Qualificando', s.funnelId, s.stages.qualificando, 1)
  assert.throws(() => ins.run(s.accountId, 'Outra', s.funnelId, s.stages.qualificando, 1), /UNIQUE/)
  ins.run(s.accountId, 'Antiga', s.funnelId, s.stages.qualificando, 0) // inativa pode
  ins.run(s.accountId, 'Avulsa A', null, null, 1)
  ins.run(s.accountId, 'Avulsa B', null, null, 1) // avulsas sem limite
})
```

- [ ] **Step 4:** `node --test test/cadenceSchema.test.js` → FAIL (`Cannot find module .../cadence/schema.js`).

- [ ] **Step 5: Implementar `server/services/cadence/schema.js`**

```js
// Cadencia da etapa (spec 2026-09-27 §3): colunas novas, passos feitos por lead e
// cadence_attempts aceitando 'pergunta'. Idempotente. Recebe db (nao importa server/db.js).
export const CADENCE_ACTION_TYPES = ['mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'pergunta']

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function acceptsPergunta(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'cadence_attempts'").get()
  return !!row && row.sql.includes("'pergunta'")
}

const COPY_COLUMNS = 'id, cadence_id, position, action_type, description, instructions, created_at, delay_days, scheduled_time, auto_message, schedule_mode, delay_minutes, call_script'

const NEW_TABLE_SQL = `
  CREATE TABLE cadence_attempts_new (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    cadence_id     INTEGER NOT NULL,
    position       INTEGER NOT NULL DEFAULT 0,
    action_type    TEXT NOT NULL CHECK (action_type IN ('mensagem', 'ligacao', 'email', 'reuniao', 'whatsapp', 'visita', 'pergunta')),
    description    TEXT,
    instructions   TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    delay_days     INTEGER NOT NULL DEFAULT 0,
    scheduled_time TEXT,
    auto_message   TEXT,
    schedule_mode  TEXT NOT NULL DEFAULT 'date',
    delay_minutes  INTEGER NOT NULL DEFAULT 0,
    call_script    TEXT,
    question_key   TEXT,
    FOREIGN KEY (cadence_id) REFERENCES cadences(id) ON DELETE CASCADE,
    CHECK (action_type <> 'pergunta' OR question_key IS NOT NULL)
  )
`

function orphanPointers(db) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM lead_cadences
    WHERE current_attempt_id IS NOT NULL AND current_attempt_id NOT IN (SELECT id FROM cadence_attempts)
  `).get().n
}

// SQLite nao altera CHECK: cria a tabela nova, copia com os MESMOS ids, confere e troca.
// Com FK ligada o DROP apagaria as linhas "de verdade" e o ON DELETE SET NULL zeraria
// lead_cadences.current_attempt_id; PRAGMA foreign_keys nao muda dentro de transacao,
// entao desliga ANTES e religa no finally.
export function rebuildCadenceAttempts(db) {
  if (acceptsPergunta(db)) return { rebuilt: false, count: null }
  // bancos muito antigos: garante as colunas que a copia le
  for (const [c, t] of [['delay_days', 'INTEGER NOT NULL DEFAULT 0'], ['scheduled_time', 'TEXT'], ['auto_message', 'TEXT'],
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'date'"], ['delay_minutes', 'INTEGER NOT NULL DEFAULT 0'], ['call_script', 'TEXT']]) addColumnIfNotExists(db, 'cadence_attempts', c, t)

  const count = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts').get().n
  const seqRow = tableExists(db, 'sqlite_sequence') ? db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'cadence_attempts'").get() : null
  const oldSeq = seqRow ? seqRow.seq : 0
  const orphansBefore = orphanPointers(db)
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec('DROP TABLE IF EXISTS cadence_attempts_new')
      db.exec(NEW_TABLE_SQL)
      db.exec(`INSERT INTO cadence_attempts_new (${COPY_COLUMNS}) SELECT ${COPY_COLUMNS} FROM cadence_attempts`)
      const copied = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts_new').get().n
      if (copied !== count) throw new Error(`copia incompleta de cadence_attempts (${copied} de ${count})`)
      db.exec('DROP TABLE cadence_attempts')
      db.exec('ALTER TABLE cadence_attempts_new RENAME TO cadence_attempts')
      db.exec('CREATE INDEX IF NOT EXISTS idx_cadence_attempts_cadence ON cadence_attempts(cadence_id, position)')
      // id novo nunca reaproveita id antigo (lead_cadences.last_executed_attempt_id nao tem FK)
      db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'cadence_attempts'").run(oldSeq)
      if (orphanPointers(db) !== orphansBefore) throw new Error('lead_cadences perderia o passo atual')
    })()
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
  return { rebuilt: true, count }
}

export function applyCadenceSchema(db) {
  addColumnIfNotExists(db, 'cadences', 'funnel_id', 'INTEGER')
  addColumnIfNotExists(db, 'cadences', 'stage_id', 'INTEGER REFERENCES funnel_stages(id) ON DELETE SET NULL')
  addColumnIfNotExists(db, 'lead_cadences', 'kind', "TEXT NOT NULL DEFAULT 'avulsa'")
  addColumnIfNotExists(db, 'lead_cadences', 'stage_id', 'INTEGER')
  addColumnIfNotExists(db, 'lead_cadences', 'stage_entry_id', 'INTEGER')
  addColumnIfNotExists(db, 'lead_cadences', 'last_executed_at', 'TEXT')
  addColumnIfNotExists(db, 'lead_cadences', 'last_executed_attempt_id', 'INTEGER')
  const result = rebuildCadenceAttempts(db)
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cadences_stage_active ON cadences(stage_id) WHERE stage_id IS NOT NULL AND is_active = 1;
    CREATE INDEX IF NOT EXISTS idx_lead_cadences_lead_kind ON lead_cadences(lead_id, kind, status);
    CREATE TABLE IF NOT EXISTS lead_cadence_steps (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id      INTEGER NOT NULL,
      lead_cadence_id INTEGER NOT NULL REFERENCES lead_cadences(id) ON DELETE CASCADE,
      lead_id         INTEGER NOT NULL,
      attempt_id      INTEGER NOT NULL,
      how             TEXT NOT NULL CHECK (how IN ('enviado', 'feito', 'pulado')),
      done_by         INTEGER,
      done_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (lead_cadence_id, attempt_id)
    );
    CREATE INDEX IF NOT EXISTS idx_lead_cadence_steps_attempt ON lead_cadence_steps(attempt_id, done_at);
  `)
  if (tableExists(db, 'roteiro_asks')) addColumnIfNotExists(db, 'roteiro_asks', 'attempt_id', 'INTEGER')
  return result
}
```

- [ ] **Step 6: Ligar no boot — `server/db.js`**. No topo, junto de `import { applyRoteiroSchema } ...`: `import { applyCadenceSchema } from './services/cadence/schema.js'`. Depois do bloco `try { migrateLegacyQualifications(db) } catch ...` e antes de `export default db`:

```js
// Cadencia da etapa: colunas novas, passos feitos e cadence_attempts aceitando 'pergunta'
// (reconstroi a tabela mantendo os ids; idempotente).
try {
  const r = applyCadenceSchema(db)
  if (r.rebuilt) console.log(`[DB] cadence_attempts reconstruida: ${r.count} passos, ids mantidos`)
} catch (err) {
  console.error('[DB] cadencia da etapa (schema) FALHOU:', err.message)
}
```

- [ ] **Step 7:** `node --test test/cadenceSchema.test.js` → PASS (3). `npm test` → 912 passando.
- [ ] **Step 8: Commit**

```bash
git add server/services/cadence/errors.js server/services/cadence/schema.js server/db.js test/helpers/cadenceDb.js test/cadenceSchema.test.js
git commit -m "feat(cadencia): schema da cadencia da etapa e reconstrucao de cadence_attempts mantendo ids

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Serviço da cadência — CRUD por id, sincronização pergunta ↔ roteiro, modelos e visão das etapas

**Files:**
- Create: `server/services/cadence/repo.js`, `test/cadenceRepo.test.js`

**Interfaces:**
- Consumes: `CadenceError` (Task 1); `CADENCE_ACTION_TYPES` (Task 1); de `server/services/roteiro/repo.js`: `getRoteiro(db, accountId, funnelId)`, `saveDraft(db, accountId, funnelId, {questions, deviations})`, `publish(db, accountId, funnelId, userId)`, `newKey()`, `RoteiroError`; `BANT_QUESTIONS` de `roteiro/bantTemplate.js`; `buildAiDraft(db, {accountId, funnelId, ai})` de `roteiro/aiDraft.js`; `applySuggestion(db, {accountId, suggestionId, userId})`, `confirmVariant(db, {accountId, variantId, userId})` de `roteiro/learning.js`.
- Produces (todas recebem `db` primeiro; lançam `CadenceError` ou `RoteiroError` com `.status`):
  - `getCadence(db, accountId, cadenceId)` → `Cadence` = linha de `cadences` + `attempts: Step[]`, onde `Step` = linha de `cadence_attempts` + `question: RoteiroQuestion | null` (da versão publicada)
  - `listCadences(db, accountId, { kind?: 'avulsa' | 'etapa' })` → `Cadence[]` (só ativas)
  - `createCadence(db, accountId, { name?, description?, stageId?, attempts? })` → `Cadence` (com `stageId`: nome padrão = nome da etapa; 404 etapa de outra conta; 400 etapa final; 409 "Esta etapa já tem cadência."; `attempts` não aceita `pergunta`)
  - `updateCadence(db, accountId, cadenceId, { name?, description?, is_active? })` → `Cadence`
  - `deleteCadence(db, accountId, cadenceId)` → `{ ok: true }` (etapa → 400)
  - `addStep(db, accountId, cadenceId, input, { userId? })` → `{ cadence, step_id, published }`; `input = { action_type, description?, instructions?, auto_message?, call_script?, delay_days?, delay_minutes?, schedule_mode?, scheduled_time?, position?, question?: QuestionInput, question_key? }`
  - `updateStep(db, accountId, cadenceId, attemptId, patch, { userId? })` → `{ cadence, step_id, published }`
  - `deleteStep(db, accountId, cadenceId, attemptId, { userId? })` → `{ cadence, published }`
  - `reorderSteps(db, accountId, cadenceId, attemptIds: number[], { userId? })` → `{ cadence, published }`
  - `replaceAttemptsById(db, accountId, cadenceId, attempts)` → `Cadence` (só avulsa; itens com `id` atualizam, sem `id` entram, ausentes saem)
  - `syncStageQuestions(db, accountId, cadenceId, { overrides?: Map<string, QuestionInput>, deviations?: Deviation[] | null, userId? })` → `{ published: boolean }`
  - `sameRoteiroContent(a, b)` → boolean (compara `{questions, deviations}`)
  - `saveDeviations(db, accountId, funnelId, deviations, { userId? })` → `{ deviations, published }`
  - `addQuestionSteps(db, accountId, { stageId, questions: QuestionInput[], userId? })` → `Cadence` (cria a cadência da etapa se faltar)
  - `bantStepQuestions(db, accountId, funnelId)` → `QuestionInput[]` (só as BANT que o funil ainda não tem)
  - `aiStepQuestions(db, accountId, { funnelId, stageId, ai })` → `Promise<QuestionInput[]>` (422 "A IA não sugeriu perguntas para esta etapa. Tente o modelo BANT.")
  - `pullFromRoteiro(db, accountId, funnelId)` → `number[]` (ids de cadências que mudaram)
  - `applySuggestionLive(db, accountId, suggestionId, { userId? })` → `{ published: true, funnel_id, cadence_ids }`
  - `confirmVariantLive(db, accountId, variantId, { userId? })` → resultado de `confirmVariant` + `cadence_ids`
  - `getStageView(db, accountId, funnelId)` → `{ funnel: {id,name}, stages: StageView[], deviations: Deviation[], questions: {question_key, text, stage_id}[] }`, `StageView = { id, name, position, is_terminal, cadence: Cadence | null, summary: { steps, questions }, followups: {id, name}[] }`
  - `QuestionInput = { text, kind: 'text'|'options', required, bant, ai_hint, options: {option_key?, label, points, position?}[] }`

- [ ] **Step 1: Testes que falham — `test/cadenceRepo.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO, Q_LIVRE, publishedRoteiro } from './helpers/cadenceDb.js'
import {
  createCadence, getCadence, listCadences, updateCadence, deleteCadence, addStep, updateStep, deleteStep, reorderSteps,
  replaceAttemptsById, saveDeviations, addQuestionSteps, bantStepQuestions, aiStepQuestions, applySuggestionLive, getStageView,
} from '../server/services/cadence/repo.js'
import { CadenceError } from '../server/services/cadence/errors.js'
import { getLeadRoteiro, saveAnswer, checkRoteiroGate } from '../server/services/roteiro/leadRoteiro.js'

const versions = (db, s) => db.prepare("SELECT COUNT(*) AS n FROM roteiro_versions WHERE account_id = ? AND status IN ('published','archived')").get(s.accountId).n
const stageCad = (db, s, key = 'qualificando') => createCadence(db, s.accountId, { stageId: s.stages[key] })
const stageQuestions = (db, s, key = 'qualificando') => publishedRoteiro(db, s).questions.filter(q => q.stage_id === s.stages[key]).sort((a, b) => a.position - b.position)

test('avulsa: passos atualizados por id mantem ids e o ponteiro do lead', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem', auto_message: 'Oi' }, { action_type: 'ligacao', description: 'Ligar' }] })
  const [a1, a2] = c.attempts
  const leadId = leadIn(db, s, 'novo')
  db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id) VALUES (?, ?, ?)').run(leadId, c.id, a1.id)
  const r = replaceAttemptsById(db, s.accountId, c.id, [{ id: a1.id, action_type: 'mensagem', auto_message: 'Oi de novo' }, { action_type: 'visita', description: 'Visitar' }])
  assert.equal(r.attempts[0].id, a1.id)
  assert.equal(r.attempts[0].auto_message, 'Oi de novo')
  assert.equal(r.attempts.length, 2)
  assert.ok(!r.attempts.some(a => a.id === a2.id))
  assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE lead_id = ?').get(leadId).current_attempt_id, a1.id)
  assert.deepEqual(listCadences(db, s.accountId, { kind: 'avulsa' }).map(x => x.id), [c.id])
  assert.throws(() => getCadence(db, s.otherAccountId, c.id), e => e instanceof CadenceError && e.status === 404)
})

test('cadencia da etapa: uma ativa por etapa, etapa final, outra conta, nao apaga', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  assert.deepEqual([c.name, c.stage_id, c.funnel_id], ['Qualificando', s.stages.qualificando, s.funnelId])
  assert.throws(() => stageCad(db, s), e => e.status === 409 && e.message === 'Esta etapa já tem cadência.')
  assert.throws(() => stageCad(db, s, 'venda'), e => e.status === 400 && /finais/.test(e.message))
  assert.throws(() => createCadence(db, s.otherAccountId, { stageId: s.stages.novo }), e => e.status === 404)
  assert.throws(() => deleteCadence(db, s.accountId, c.id), e => e.status === 400)
  updateCadence(db, s.accountId, c.id, { is_active: 0 })
  assert.notEqual(stageCad(db, s).id, c.id) // inativa libera a etapa
  assert.throws(() => updateCadence(db, s.accountId, c.id, { is_active: 1 }), e => e.status === 409)
  assert.deepEqual(listCadences(db, s.accountId, { kind: 'etapa' }).length, 1)
})

test('passo pergunta vira pergunta publicada; salvar igual nao gera versao', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const r = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO })
  assert.equal(r.published, true)
  const step = r.cadence.attempts.find(a => a.id === r.step_id)
  assert.equal(step.description, Q_PRAZO.text)
  assert.equal(step.question.text, Q_PRAZO.text)
  assert.deepEqual(stageQuestions(db, s).map(q => [q.question_key, q.position]), [[step.question_key, 0]])
  const v = versions(db, s)
  const again = updateStep(db, s.accountId, c.id, step.id, { question: step.question })
  assert.equal(again.published, false)
  assert.equal(versions(db, s), v)
})

test('ordem: mexer so em mensagem nao publica; trocar perguntas de lugar publica', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const p1 = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const m = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Oi {nome}' }).step_id
  const p2 = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const v = versions(db, s)
  assert.equal(reorderSteps(db, s.accountId, c.id, [m, p1, p2]).published, false)
  assert.equal(updateStep(db, s.accountId, c.id, m, { auto_message: 'Olá {nome}', delay_days: 1 }).published, false)
  assert.equal(updateStep(db, s.accountId, c.id, m, { action_type: 'whatsapp' }).published, false)
  assert.equal(versions(db, s), v)
  assert.equal(reorderSteps(db, s.accountId, c.id, [m, p2, p1]).published, true)
  const keys = getCadence(db, s.accountId, c.id).attempts.filter(a => a.action_type === 'pergunta').map(a => a.question_key)
  assert.deepEqual(stageQuestions(db, s).map(q => q.question_key), keys)
  assert.throws(() => reorderSteps(db, s.accountId, c.id, [m, p1]), e => e.status === 409)
})

test('apagar pergunta com resposta e teste A/B: cancela o teste, resposta fica, trava solta, desvio sem volta', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const stepId = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const key = getCadence(db, s.accountId, c.id).attempts[0].question_key
  saveDeviations(db, s.accountId, s.funnelId, [{ triggers: 'preço, valor', reply_text: 'Depende do tamanho.', return_question_key: key }])
  const leadId = leadIn(db, s, 'qualificando')
  const outro = leadIn(db, s, 'qualificando')
  const optionKey = stageQuestions(db, s)[0].options[0].option_key
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'manual' })
  db.prepare("INSERT INTO roteiro_variants (account_id, question_key, text, status) VALUES (?, ?, 'Versão B', 'testing')").run(s.accountId, key)
  const lead = id => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
  assert.equal(checkRoteiroGate(db, lead(outro), s.stages.proposta).ok, false)
  const r = deleteStep(db, s.accountId, c.id, stepId)
  assert.equal(r.published, true)
  assert.equal(db.prepare('SELECT status FROM roteiro_variants WHERE question_key = ?').get(key).status, 'cancelled')
  assert.equal(db.prepare('SELECT option_key FROM lead_answers WHERE lead_id = ? AND question_key = ?').get(leadId, key).option_key, optionKey)
  assert.ok(getLeadRoteiro(db, { accountId: s.accountId, leadId }).legacy_answers.some(a => a.question_key === key))
  assert.equal(checkRoteiroGate(db, lead(outro), s.stages.proposta).ok, true)
  assert.equal(publishedRoteiro(db, s).deviations[0].return_question_key, null)
})

test('pergunta fora do roteiro da etapa, pergunta em avulsa e opcoes invalidas nao gravam nada', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  assert.throws(() => addStep(db, s.accountId, c.id, { action_type: 'pergunta', question_key: 'naoexiste' }),
    e => e.status === 400 && e.message === 'Esta pergunta não está no roteiro da etapa.')
  const av = createCadence(db, s.accountId, { name: 'Avulsa' })
  assert.throws(() => addStep(db, s.accountId, av.id, { action_type: 'pergunta', question: Q_LIVRE }), e => e.status === 400)
  assert.throws(() => addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: { ...Q_PRAZO, options: [{ label: 'Só uma', points: 1 }] } }), e => e.status === 400)
  assert.equal(getCadence(db, s.accountId, c.id).attempts.length, 0)
  assert.equal(publishedRoteiro(db, s), null)
  const ok = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  assert.throws(() => updateStep(db, s.accountId, c.id, ok.step_id, { action_type: 'mensagem' }), e => e.status === 400)
  assert.throws(() => updateStep(db, s.accountId, av.id, ok.step_id, { description: 'x' }), e => e.status === 404)
})

test('duas edicoes seguidas no mesmo passo: fica a ultima, id igual, uma versao por mudanca', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  const id = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const optionKeys = stageQuestions(db, s)[0].options.map(o => o.option_key)
  const opts = Q_PRAZO.options.map((o, i) => ({ ...o, option_key: optionKeys[i] }))
  const v = versions(db, s)
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: opts, text: 'Para quando é a festa?' } })
  updateStep(db, s.accountId, c.id, id, { question: { ...Q_PRAZO, options: opts, text: 'Para quando é a festa, {nome}?' } })
  assert.equal(versions(db, s), v + 2)
  const q = stageQuestions(db, s)[0]
  assert.equal(q.text, 'Para quando é a festa, {nome}?')
  assert.deepEqual(q.options.map(o => o.option_key), optionKeys) // respostas antigas continuam valendo
  assert.equal(getCadence(db, s.accountId, c.id).attempts[0].id, id)
})

test('modelo BANT e IA: cria a cadencia da etapa e so poe o que falta', async () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const bant = bantStepQuestions(db, s.accountId, s.funnelId)
  assert.equal(bant.length, 4)
  const cad = addQuestionSteps(db, s.accountId, { stageId: s.stages.novo, questions: bant })
  assert.equal(cad.stage_id, s.stages.novo)
  assert.equal(cad.attempts.length, 4)
  assert.equal(bantStepQuestions(db, s.accountId, s.funnelId).length, 0)
  const ai = { call: async () => ({ toolUses: [{ name: 'propose_roteiro', input: { questions: [
    { stage_id: s.stages.proposta, text: 'Qual a data do evento?', kind: 'text', required: true },
    { stage_id: s.stages.qualificando, text: 'Quantos convidados?', kind: 'text' },
  ], deviations: [] } }] }) }
  const fromAi = await aiStepQuestions(db, s.accountId, { funnelId: s.funnelId, stageId: s.stages.proposta, ai })
  assert.deepEqual(fromAi.map(q => q.text), ['Qual a data do evento?'])
  await assert.rejects(aiStepQuestions(db, s.accountId, { funnelId: s.funnelId, stageId: s.stages.venda, ai }), e => e.status === 422)
  addQuestionSteps(db, s.accountId, { stageId: s.stages.proposta, questions: fromAi })
  // o rascunho que a IA montou para o funil inteiro nao vaza para o publicado
  assert.ok(!publishedRoteiro(db, s).questions.some(q => q.text === 'Quantos convidados?'))
})

test('sugestao de reordenar aplicada ja vale: roteiro publicado e vagas de pergunta da cadencia', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_PRAZO })
  const m = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Catálogo' }).step_id
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  const [k1, k2] = stageQuestions(db, s).map(q => q.question_key)
  const sid = Number(db.prepare("INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json) VALUES (?, ?, NULL, 'reorder', ?)")
    .run(s.accountId, s.funnelId, JSON.stringify({ stage_id: s.stages.qualificando, order: [k2, k1] })).lastInsertRowid)
  const r = applySuggestionLive(db, s.accountId, sid)
  assert.deepEqual(r.cadence_ids, [c.id])
  assert.deepEqual(stageQuestions(db, s).map(q => q.question_key), [k2, k1])
  const steps = getCadence(db, s.accountId, c.id).attempts
  assert.deepEqual(steps.map(a => a.question_key || a.id), [k2, m, k1]) // mensagem nao sai do lugar
})

test('desvios: publica so quando muda; visao das etapas traz resumo e follow-up da etapa', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = stageCad(db, s)
  addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE })
  addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' })
  const d = [{ triggers: 'preço', reply_text: 'Depende do tamanho.', return_question_key: null }]
  assert.equal(saveDeviations(db, s.accountId, s.funnelId, d).published, true)
  assert.equal(saveDeviations(db, s.accountId, s.funnelId, d).published, false)
  db.prepare("INSERT INTO follow_ups (account_id, name, is_active, type, inactivity_stage_id) VALUES (?, 'Sumiu na qualificação', 1, 'inactivity', ?)").run(s.accountId, s.stages.qualificando)
  const view = getStageView(db, s.accountId, s.funnelId)
  const q = view.stages.find(x => x.id === s.stages.qualificando)
  assert.deepEqual(q.summary, { steps: 2, questions: 1 })
  assert.deepEqual(q.followups.map(f => f.name), ['Sumiu na qualificação'])
  assert.equal(view.stages.find(x => x.id === s.stages.novo).cadence, null)
  assert.equal(view.deviations.length, 1)
  assert.throws(() => getStageView(db, s.otherAccountId, s.funnelId), e => e.status === 404)
})
```

- [ ] **Step 2:** `node --test test/cadenceRepo.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `server/services/cadence/repo.js`**

```js
// Cadencias (da etapa e avulsas): CRUD com passos atualizados por id e sincronizacao dos
// passos 'pergunta' com o roteiro (spec 2026-09-27 §3.1-3.4, §4.3). A cadencia e a tela;
// o roteiro publicado continua sendo o motor. Recebe db (nao importa server/db.js).
import { getRoteiro, saveDraft, publish, newKey } from '../roteiro/repo.js'
import { BANT_QUESTIONS } from '../roteiro/bantTemplate.js'
import { buildAiDraft } from '../roteiro/aiDraft.js'
import { applySuggestion, confirmVariant } from '../roteiro/learning.js'
import { CADENCE_ACTION_TYPES } from './schema.js'
import { CadenceError } from './errors.js'

const QUESTION_NOT_IN_STAGE = 'Esta pergunta não está no roteiro da etapa.'

function strOrNull(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function nonNegInt(v) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function loadCadenceRow(db, accountId, cadenceId) {
  const c = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ?').get(cadenceId, accountId)
  if (!c) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  return c
}

function loadAttempts(db, cadenceId) {
  return db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(cadenceId)
}

function loadStageForAccount(db, accountId, stageId) {
  const st = db.prepare(`
    SELECT s.id, s.name, s.funnel_id, s.is_terminal FROM funnel_stages s JOIN funnels f ON f.id = s.funnel_id
    WHERE s.id = ? AND f.account_id = ?
  `).get(stageId, accountId)
  if (!st) throw new CadenceError('not_found', 404, 'Etapa não encontrada.')
  if (st.is_terminal) throw new CadenceError('invalid', 400, 'Etapas finais (venda/perdido) não têm cadência.')
  return st
}

// Base de toda sincronizacao: a versao PUBLICADA (decisao D1). Rascunho nao entra.
function publishedContent(db, accountId, funnelId) {
  const rot = getRoteiro(db, accountId, funnelId)
  const p = rot.published
  return { rot, content: p ? { questions: p.questions, deviations: p.deviations } : { questions: [], deviations: [] } }
}

function withSteps(db, accountId, c) {
  const attempts = loadAttempts(db, c.id)
  let byKey = new Map()
  if (c.funnel_id && attempts.some(a => a.action_type === 'pergunta')) {
    byKey = new Map(publishedContent(db, accountId, c.funnel_id).content.questions.map(q => [q.question_key, q]))
  }
  return { ...c, attempts: attempts.map(a => ({ ...a, question: a.question_key ? (byKey.get(a.question_key) || null) : null })) }
}

export function getCadence(db, accountId, cadenceId) {
  return withSteps(db, accountId, loadCadenceRow(db, accountId, cadenceId))
}

export function listCadences(db, accountId, { kind } = {}) {
  let where = 'account_id = ? AND is_active = 1'
  if (kind === 'avulsa') where += ' AND stage_id IS NULL'
  if (kind === 'etapa') where += ' AND stage_id IS NOT NULL'
  return db.prepare(`SELECT * FROM cadences WHERE ${where} ORDER BY name`).all(accountId).map(c => withSteps(db, accountId, c))
}

function normalizeStep(a, { isStage }) {
  const actionType = a.action_type || 'mensagem'
  if (!CADENCE_ACTION_TYPES.includes(actionType)) throw new CadenceError('invalid', 400, 'Tipo de passo inválido.')
  if (actionType === 'pergunta' && !isStage) throw new CadenceError('invalid', 400, 'Pergunta só entra na cadência de uma etapa.')
  return {
    action_type: actionType,
    description: strOrNull(a.description),
    instructions: strOrNull(a.instructions),
    auto_message: strOrNull(a.auto_message),
    call_script: strOrNull(a.call_script),
    scheduled_time: strOrNull(a.scheduled_time),
    delay_days: nonNegInt(a.delay_days),
    delay_minutes: nonNegInt(a.delay_minutes),
    schedule_mode: a.schedule_mode === 'duration' ? 'duration' : 'date',
  }
}

function insertStepRow(db, cadenceId, step, position, questionKey = null) {
  return Number(db.prepare(`
    INSERT INTO cadence_attempts (cadence_id, position, action_type, description, instructions, auto_message, call_script, scheduled_time, delay_days, delay_minutes, schedule_mode, question_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(cadenceId, position, step.action_type, step.description, step.instructions, step.auto_message, step.call_script,
    step.scheduled_time, step.delay_days, step.delay_minutes, step.schedule_mode, questionKey).lastInsertRowid)
}

function updateStepRow(db, id, step, position = null) {
  db.prepare(`
    UPDATE cadence_attempts SET action_type = ?, description = ?, instructions = ?, auto_message = ?, call_script = ?,
      scheduled_time = ?, delay_days = ?, delay_minutes = ?, schedule_mode = ?, position = COALESCE(?, position)
    WHERE id = ?
  `).run(step.action_type, step.description, step.instructions, step.auto_message, step.call_script,
    step.scheduled_time, step.delay_days, step.delay_minutes, step.schedule_mode, position, id)
}

function renumber(db, cadenceId) {
  const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
  loadAttempts(db, cadenceId).forEach((a, i) => { if (a.position !== i) upd.run(i, a.id) })
}

function touch(db, cadenceId) {
  db.prepare("UPDATE cadences SET updated_at = datetime('now') WHERE id = ?").run(cadenceId)
}

export function createCadence(db, accountId, { name, description = null, stageId = null, attempts = [] } = {}) {
  let stage = null
  if (stageId != null) {
    stage = loadStageForAccount(db, accountId, stageId)
    if (db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1').get(stage.id)) {
      throw new CadenceError('stage_taken', 409, 'Esta etapa já tem cadência.')
    }
  }
  const finalName = strOrNull(name) || (stage && stage.name)
  if (!finalName) throw new CadenceError('invalid', 400, 'Nome obrigatório.')
  const steps = (Array.isArray(attempts) ? attempts : []).map(a => normalizeStep(a, { isStage: false }))
  let id
  db.transaction(() => {
    id = Number(db.prepare('INSERT INTO cadences (account_id, name, description, funnel_id, stage_id) VALUES (?, ?, ?, ?, ?)')
      .run(accountId, finalName, strOrNull(description), stage ? stage.funnel_id : null, stage ? stage.id : null).lastInsertRowid)
    steps.forEach((st, i) => insertStepRow(db, id, st, i))
  })()
  return getCadence(db, accountId, id)
}

export function updateCadence(db, accountId, cadenceId, { name, description, is_active } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const sets = []
  const params = []
  if (name !== undefined) {
    const n = strOrNull(name)
    if (!n) throw new CadenceError('invalid', 400, 'Nome obrigatório.')
    sets.push('name = ?'); params.push(n)
  }
  if (description !== undefined) { sets.push('description = ?'); params.push(strOrNull(description)) }
  if (is_active !== undefined) {
    const on = is_active ? 1 : 0
    if (on && c.stage_id && db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1 AND id <> ?').get(c.stage_id, c.id)) {
      throw new CadenceError('stage_taken', 409, 'Esta etapa já tem cadência.')
    }
    sets.push('is_active = ?'); params.push(on)
  }
  if (!sets.length) throw new CadenceError('invalid', 400, 'Nada para atualizar.')
  sets.push("updated_at = datetime('now')")
  db.prepare(`UPDATE cadences SET ${sets.join(', ')} WHERE id = ?`).run(...params, c.id)
  return getCadence(db, accountId, c.id)
}

export function deleteCadence(db, accountId, cadenceId) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (c.stage_id) throw new CadenceError('invalid', 400, 'A cadência da etapa não pode ser apagada. Apague os passos dela.')
  db.prepare("UPDATE cadences SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(c.id)
  return { ok: true }
}

function projectQuestion(q) {
  const opts = q.kind === 'options' ? (q.options || []) : []
  return [q.question_key, q.stage_id, q.position, String(q.text || '').trim(), q.kind, !!q.required, q.bant ?? null,
    (typeof q.ai_hint === 'string' && q.ai_hint.trim()) || null,
    opts.map((o, i) => [o.option_key ?? null, String(o.label || '').trim(), Number(o.points), Number.isInteger(o.position) ? o.position : i])]
}
function projectDeviation(d, i) {
  return [String(d.triggers || '').trim(), String(d.reply_text || '').trim(), d.return_question_key ?? null, i]
}
export function sameRoteiroContent(a, b) {
  const qs = x => JSON.stringify(x.questions.map(projectQuestion).sort((p, q) => (p[1] - q[1]) || (p[2] - q[2]) || (p[0] < q[0] ? -1 : 1)))
  const ds = x => JSON.stringify([...x.deviations].sort((p, q) => (p.position ?? 0) - (q.position ?? 0)).map(projectDeviation))
  return qs(a) === qs(b) && ds(a) === ds(b)
}

function mirrorDescriptions(db, steps, questions) {
  const upd = db.prepare('UPDATE cadence_attempts SET description = ? WHERE id = ?')
  const byKey = new Map(questions.map(q => [q.question_key, q]))
  for (const a of steps) {
    const q = byKey.get(a.question_key)
    if (q && a.description !== q.text) upd.run(q.text, a.id)
  }
}

// Passos 'pergunta' da cadencia da etapa, na ordem, SAO as perguntas da etapa no roteiro.
// Publica so quando o conteudo muda (spec 3.4; decisoes D1/D2).
export function syncStageQuestions(db, accountId, cadenceId, { overrides = new Map(), deviations = null, userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (!c.stage_id || !c.funnel_id) return { published: false }
  const { rot, content } = publishedContent(db, accountId, c.funnel_id)
  const baseByKey = new Map(content.questions.map(q => [q.question_key, q]))
  const steps = c.is_active ? loadAttempts(db, c.id).filter(a => a.action_type === 'pergunta') : []
  const stageQuestions = steps.map((a, idx) => {
    const base = baseByKey.get(a.question_key)
    const patch = overrides.get(a.question_key)
    if (!base && !patch) throw new CadenceError('invalid', 400, QUESTION_NOT_IN_STAGE)
    const m = { ...(base || { kind: 'text', required: false, bant: null, ai_hint: null, options: [] }), ...(patch || {}) }
    return {
      question_key: a.question_key, stage_id: c.stage_id, position: idx,
      text: m.text, kind: m.kind, required: !!m.required, bant: m.bant ?? null, ai_hint: m.ai_hint ?? null,
      options: m.kind === 'options' ? (m.options || []) : [],
    }
  })
  const others = content.questions.filter(q => q.stage_id !== c.stage_id)
  const allKeys = new Set(others.map(q => q.question_key).concat(stageQuestions.map(q => q.question_key)))
  const devs = (deviations || content.deviations).map((d, idx) => ({
    triggers: d.triggers, reply_text: d.reply_text, position: idx,
    return_question_key: d.return_question_key && allKeys.has(d.return_question_key) ? d.return_question_key : null,
  }))
  const next = { questions: others.concat(stageQuestions), deviations: devs }
  if (!rot.published && !next.questions.length && !next.deviations.length) return { published: false }
  if (rot.published && sameRoteiroContent(rot.published, next)) {
    mirrorDescriptions(db, steps, stageQuestions)
    return { published: false }
  }
  saveDraft(db, accountId, c.funnel_id, next) // valida texto/opcoes/pontos (RoteiroError 400)
  const version = publish(db, accountId, c.funnel_id, userId)
  mirrorDescriptions(db, steps, version.questions.filter(q => q.stage_id === c.stage_id))
  return { published: true }
}

function assertQuestionInStage(db, accountId, c, questionKey) {
  const { content } = publishedContent(db, accountId, c.funnel_id)
  if (!content.questions.some(q => q.question_key === questionKey && q.stage_id === c.stage_id)) {
    throw new CadenceError('invalid', 400, QUESTION_NOT_IN_STAGE)
  }
  if (db.prepare('SELECT 1 FROM cadence_attempts WHERE cadence_id = ? AND question_key = ?').get(c.id, questionKey)) {
    throw new CadenceError('invalid', 400, 'Esta pergunta já está em outro passo.')
  }
}

export function addStep(db, accountId, cadenceId, input = {}, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const step = normalizeStep(input, { isStage: !!c.stage_id })
  let stepId
  let published = false
  db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts WHERE cadence_id = ?').get(c.id).n
    const position = Number.isInteger(input.position) ? Math.max(0, Math.min(input.position, count)) : count
    db.prepare('UPDATE cadence_attempts SET position = position + 1 WHERE cadence_id = ? AND position >= ?').run(c.id, position)
    let questionKey = null
    const overrides = new Map()
    if (step.action_type === 'pergunta') {
      if (input.question_key) {
        questionKey = String(input.question_key)
        assertQuestionInStage(db, accountId, c, questionKey)
      } else {
        questionKey = newKey()
        overrides.set(questionKey, input.question || {})
      }
    }
    stepId = insertStepRow(db, c.id, step, position, questionKey)
    renumber(db, c.id)
    if (questionKey) published = syncStageQuestions(db, accountId, c.id, { overrides, userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), step_id: stepId, published }
}

function loadStep(db, c, attemptId) {
  const row = db.prepare('SELECT * FROM cadence_attempts WHERE id = ? AND cadence_id = ?').get(attemptId, c.id)
  if (!row) throw new CadenceError('step_changed', 404, 'Passo não encontrado. A tela foi atualizada.')
  return row
}

export function updateStep(db, accountId, cadenceId, attemptId, patch = {}, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const row = loadStep(db, c, attemptId)
  const nextType = patch.action_type || row.action_type
  if (nextType !== row.action_type && (nextType === 'pergunta' || row.action_type === 'pergunta')) {
    throw new CadenceError('invalid', 400, 'Não dá para trocar pergunta por outro tipo. Apague o passo e crie outro.')
  }
  const step = normalizeStep({ ...row, ...patch, action_type: nextType }, { isStage: !!c.stage_id })
  let published = false
  db.transaction(() => {
    updateStepRow(db, row.id, step)
    if (row.action_type === 'pergunta' && patch.question) {
      published = syncStageQuestions(db, accountId, c.id, { overrides: new Map([[row.question_key, patch.question]]), userId }).published
    }
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), step_id: row.id, published }
}

export function deleteStep(db, accountId, cadenceId, attemptId, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const row = loadStep(db, c, attemptId)
  let published = false
  db.transaction(() => {
    db.prepare('DELETE FROM cadence_attempts WHERE id = ?').run(row.id) // FK zera lead_cadences.current_attempt_id
    renumber(db, c.id)
    if (row.action_type === 'pergunta') published = syncStageQuestions(db, accountId, c.id, { userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), published }
}

export function reorderSteps(db, accountId, cadenceId, attemptIds, { userId = null } = {}) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  const current = loadAttempts(db, c.id).map(a => a.id)
  const ids = (Array.isArray(attemptIds) ? attemptIds : []).map(Number)
  if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every(id => current.includes(id))) {
    throw new CadenceError('step_changed', 409, 'A lista de passos mudou. A tela foi atualizada.')
  }
  let published = false
  db.transaction(() => {
    const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
    ids.forEach((id, i) => upd.run(i, id))
    if (c.stage_id) published = syncStageQuestions(db, accountId, c.id, { userId }).published
    touch(db, c.id)
  })()
  return { cadence: getCadence(db, accountId, c.id), published }
}

export function replaceAttemptsById(db, accountId, cadenceId, attempts) {
  const c = loadCadenceRow(db, accountId, cadenceId)
  if (c.stage_id) throw new CadenceError('invalid', 400, 'Edite a cadência da etapa pela tela da etapa.')
  if (!Array.isArray(attempts)) throw new CadenceError('invalid', 400, 'Lista de passos obrigatória.')
  const existing = new Set(loadAttempts(db, c.id).map(a => a.id))
  db.transaction(() => {
    const keep = new Set()
    attempts.forEach((a, i) => {
      const step = normalizeStep(a, { isStage: false })
      const id = Number(a.id)
      if (id && existing.has(id)) { updateStepRow(db, id, step, i); keep.add(id) }
      else keep.add(insertStepRow(db, c.id, step, i))
    })
    const del = db.prepare('DELETE FROM cadence_attempts WHERE id = ?')
    for (const id of existing) if (!keep.has(id)) del.run(id)
    touch(db, c.id)
  })()
  return getCadence(db, accountId, c.id)
}

export function saveDeviations(db, accountId, funnelId, deviations, { userId = null } = {}) {
  if (!Array.isArray(deviations)) throw new CadenceError('invalid', 400, 'Lista de desvios obrigatória.')
  const { rot, content } = publishedContent(db, accountId, funnelId)
  const next = {
    questions: content.questions,
    deviations: deviations.map((d, i) => ({ triggers: d.triggers, reply_text: d.reply_text, return_question_key: d.return_question_key || null, position: i })),
  }
  if (rot.published && sameRoteiroContent(rot.published, next)) return { deviations: rot.published.deviations, published: false }
  saveDraft(db, accountId, funnelId, next)
  const v = publish(db, accountId, funnelId, userId)
  return { deviations: v.deviations, published: true }
}

export function addQuestionSteps(db, accountId, { stageId, questions, userId = null }) {
  const stage = loadStageForAccount(db, accountId, stageId)
  if (!Array.isArray(questions) || !questions.length) throw new CadenceError('invalid', 400, 'Nenhuma pergunta para adicionar.')
  let cadenceId
  db.transaction(() => {
    const existing = db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1 AND account_id = ?').get(stage.id, accountId)
    cadenceId = existing ? existing.id : createCadence(db, accountId, { stageId: stage.id }).id
    let pos = db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts WHERE cadence_id = ?').get(cadenceId).n
    const overrides = new Map()
    const step = normalizeStep({ action_type: 'pergunta' }, { isStage: true })
    for (const q of questions) {
      const key = newKey()
      overrides.set(key, q)
      insertStepRow(db, cadenceId, { ...step, description: strOrNull(q.text) }, pos++, key)
    }
    syncStageQuestions(db, accountId, cadenceId, { overrides, userId })
    touch(db, cadenceId)
  })()
  return getCadence(db, accountId, cadenceId)
}

function toQuestionInput(q) {
  return {
    text: q.text, kind: q.kind, required: !!q.required, bant: q.bant ?? null, ai_hint: q.ai_hint ?? null,
    options: (q.options || []).map((o, i) => ({ label: o.label, points: o.points, position: i })),
  }
}

export function bantStepQuestions(db, accountId, funnelId) {
  const { content } = publishedContent(db, accountId, funnelId)
  const used = new Set(content.questions.map(q => q.bant).filter(Boolean))
  return BANT_QUESTIONS.filter(b => !used.has(b.bant)).map(b => toQuestionInput({ ...b, ai_hint: null }))
}

// Montar com IA (spec 5.1): usa o gerador do roteiro e fica so com as perguntas desta etapa.
// O rascunho do funil que ele grava e ignorado (sincronizacao parte do publicado, D1).
export async function aiStepQuestions(db, accountId, { funnelId, stageId, ai }) {
  const draft = await buildAiDraft(db, { accountId, funnelId, ai })
  const qs = draft.questions.filter(q => q.stage_id === Number(stageId))
  if (!qs.length) throw new CadenceError('ai_empty', 422, 'A IA não sugeriu perguntas para esta etapa. Tente o modelo BANT.')
  return qs.map(toQuestionInput)
}

function rankOf(order, key) {
  const i = order.indexOf(key)
  return i === -1 ? order.length : i
}

// Depois de uma mudanca feita direto no roteiro (sugestao aplicada, A/B confirmado): as vagas
// de pergunta de cada cadencia da etapa recebem as perguntas na ordem publicada e o texto espelho.
export function pullFromRoteiro(db, accountId, funnelId) {
  const { content } = publishedContent(db, accountId, funnelId)
  const touched = []
  const cads = db.prepare('SELECT * FROM cadences WHERE account_id = ? AND funnel_id = ? AND stage_id IS NOT NULL AND is_active = 1').all(accountId, funnelId)
  const upd = db.prepare('UPDATE cadence_attempts SET position = ? WHERE id = ?')
  for (const c of cads) {
    const stageQs = content.questions.filter(q => q.stage_id === c.stage_id).sort((a, b) => a.position - b.position)
    const order = stageQs.map(q => q.question_key)
    const slots = loadAttempts(db, c.id).filter(a => a.action_type === 'pergunta')
    const sorted = slots.slice().sort((a, b) => rankOf(order, a.question_key) - rankOf(order, b.question_key))
    let changed = false
    slots.forEach((slot, i) => {
      if (sorted[i].id !== slot.id) { changed = true; upd.run(slot.position, sorted[i].id) }
    })
    mirrorDescriptions(db, slots, stageQs)
    if (changed) { touch(db, c.id); touched.push(c.id) }
  }
  return touched
}

// [Aplicar] na tela nova: sem botao Publicar, a sugestao ja entra no ar.
export function applySuggestionLive(db, accountId, suggestionId, { userId = null } = {}) {
  let result
  db.transaction(() => {
    const { draft } = applySuggestion(db, { accountId, suggestionId, userId })
    const funnelId = db.prepare('SELECT funnel_id FROM roteiro_versions WHERE id = ?').get(draft.id).funnel_id
    publish(db, accountId, funnelId, userId)
    result = { published: true, funnel_id: funnelId, cadence_ids: pullFromRoteiro(db, accountId, funnelId) }
  })()
  return result
}

export function confirmVariantLive(db, accountId, variantId, { userId = null } = {}) {
  let result
  db.transaction(() => {
    const r = confirmVariant(db, { accountId, variantId, userId })
    const funnelId = r.version ? db.prepare('SELECT funnel_id FROM roteiro_versions WHERE id = ?').get(r.version.id).funnel_id : null
    result = { ...r, cadence_ids: funnelId ? pullFromRoteiro(db, accountId, funnelId) : [] }
  })()
  return result
}

export function getStageView(db, accountId, funnelId) {
  const rot = getRoteiro(db, accountId, funnelId) // 404 se o funil nao e da conta
  const cadStmt = db.prepare('SELECT * FROM cadences WHERE account_id = ? AND stage_id = ? AND is_active = 1')
  const fuStmt = db.prepare('SELECT id, name FROM follow_ups WHERE account_id = ? AND inactivity_stage_id = ? AND is_active = 1 ORDER BY id')
  const stages = rot.stages.map(st => {
    const row = cadStmt.get(accountId, st.id)
    const cadence = row ? withSteps(db, accountId, row) : null
    const steps = cadence ? cadence.attempts.length : 0
    const questions = cadence ? cadence.attempts.filter(a => a.action_type === 'pergunta').length : 0
    return { id: st.id, name: st.name, position: st.position, is_terminal: st.is_terminal, cadence, summary: { steps, questions }, followups: fuStmt.all(accountId, st.id) }
  })
  const pub = rot.published
  return {
    funnel: rot.funnel,
    stages,
    deviations: pub ? pub.deviations : [],
    questions: pub ? pub.questions.map(q => ({ question_key: q.question_key, text: q.text, stage_id: q.stage_id })) : [],
  }
}
```

Nota para o implementador: `getRoteiro` lança `RoteiroError('not_found', 404)` para funil de outra conta — o teste checa só `status === 404`, que as duas classes têm.

- [ ] **Step 4:** `node --test test/cadenceRepo.test.js` → PASS (10). Se `saveDraft` rejeitar `options` com `option_key: undefined`, confira que `normalizeQuestion` já faz `o.option_key || newKey()` (faz). `npm test` → 922 passando.
- [ ] **Step 5: Commit**

```bash
git add server/services/cadence/repo.js test/cadenceRepo.test.js
git commit -m "feat(cadencia): passos por id e pergunta sincronizada com o roteiro publicado

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Cadência da etapa no lead — início/fim na troca de etapa, próximo passo, "feito", avulsa junto

**Files:**
- Create: `server/services/cadence/nextStep.js`, `server/services/cadence/leadCadence.js`, `test/leadCadence.test.js`
- Modify: `server/services/stageMove.js` (chamar `onStageMoved` depois da transação), `server/routes/roteiroRouter.js` (PUT answers → `refreshLeadStageCadence`), `server/services/roteiro/runtime.js` (`bootRoteiroAi` → `refreshLeadStageCadence` quando a IA salva resposta), `server/routes/leads.js` (~linha 222, depois do `INSERT INTO stage_history` do lead novo), `server/services/inboundHandler.js` (~linha 162, depois do `INSERT INTO stage_history ... 'polling'`), `server/services/leadIntake.js` (~linha 81, depois do `INSERT INTO stage_history ... 'webhook'`)

**Interfaces:**
- Consumes: `CadenceError` (Task 1); `createCadence`, `addStep`, `deleteStep`, `getCadence` (Task 2, só nos testes); `getLeadRoteiro(db, {accountId, leadId})` de `roteiro/leadRoteiro.js`; `activeDeviationForLead(db, {accountId, lead, now})` de `roteiro/deviations.js`.
- Produces:
  - `nextStep.js` (puro): `stepState(step, ctx)` → `{ state: 'feito'|'aguardando'|'pendente', how: 'respondida'|'enviado'|'feito'|'pulado'|null }`; `computeNext(steps, ctx)` → `{ states: {id, state, how}[], nextAttemptId: number|null, doneCount, total }`; `ctx = { answeredKeys: Set<string>, askedKeys: Set<string>, doneByAttempt: Map<number, {how}> }`
  - `leadCadence.js`:
    - `ensureStageCadence(db, { leadId })` → linha de `lead_cadences` ativa (kind `'etapa'`) ou `null`
    - `onStageMoved(db, { leadId, trigger })` → void
    - `refreshLeadCadence(db, { leadCadenceId })` → linha atualizada
    - `refreshLeadStageCadence(db, { leadId })` → linha ou `null`
    - `refreshLeadsOfCadence(db, cadenceId)` → número de linhas atualizadas
    - `attachLeadsInStage(db, { accountId, cadenceId })` → número de leads com a cadência ativa
    - `getLeadStageCadence(db, { accountId, leadId, role? })` → `LeadStageCadence`
    - `markStepDone(db, { accountId, leadId, attemptId, how, userId? })` → `{ lead_cadence_id, kind }`
    - `completeCurrentStep(db, { accountId, leadCadenceId, how: 'feito'|'pulado', userId? })` → `{ completed: boolean, nextAttempt: Attempt|null, lead: {account_id, attendant_id} }`
    - `assignAvulsa(db, { accountId, cadenceId, leadId })` → linha de `lead_cadences`
    - `advanceAvulsa(db, leadCadenceId)` → `{ completed, nextAttempt }`
    - `leadCadenceView(db, leadCadenceId)` → linha com `cadence_name, action_type, attempt_*` (formato da antiga `GET /lead/:leadId`)
  - `LeadStageCadence = { lead_id, stage: {id, name}|null, lead_cadence: {id, cadence_id, cadence_name, status, started_at}|null, steps: LeadStep[], next_attempt_id: number|null, done_count, total, deviation: ActiveDeviation|null, can_force: boolean }`
  - `LeadStep = { attempt_id, position, action_type, description, instructions, auto_message, call_script, delay_days, question_key, state, how, done_at, done_by_name, question: QState|null }` (`QState` = formato de `getLeadRoteiro`)

- [ ] **Step 1: Testes que falham — `test/leadCadence.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO, publishedRoteiro } from './helpers/cadenceDb.js'
import { createCadence, addStep, deleteStep, getCadence } from '../server/services/cadence/repo.js'
import { computeNext } from '../server/services/cadence/nextStep.js'
import {
  ensureStageCadence, getLeadStageCadence, markStepDone, assignAvulsa, completeCurrentStep,
  refreshLeadsOfCadence, refreshLeadStageCadence, attachLeadsInStage,
} from '../server/services/cadence/leadCadence.js'
import { configureStageMoveHooks, moveLeadToStage } from '../server/services/stageMove.js'
import { saveAnswer } from '../server/services/roteiro/leadRoteiro.js'
import { maybeAutoAdvance, undoAutoAdvance } from '../server/services/roteiro/autoAdvance.js'
import { recordAsk } from '../server/services/roteiro/asks.js'

test.afterEach(() => configureStageMoveHooks({ onMoved: null }))

function setup() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const q = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, q.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const mensagem = addStep(db, s.accountId, q.id, { action_type: 'mensagem', auto_message: 'Te mando o catálogo, {nome}' }).step_id
  const p = createCadence(db, s.accountId, { stageId: s.stages.proposta })
  const ligacao = addStep(db, s.accountId, p.id, { action_type: 'ligacao', description: 'Ligar para apresentar a proposta' }).step_id
  const key = getCadence(db, s.accountId, q.id).attempts[0].question_key
  const optionKey = publishedRoteiro(db, s).questions.find(x => x.question_key === key).options[0].option_key
  return { db, s, q, p, pergunta, mensagem, ligacao, key, optionKey }
}
const leadRow = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)
const etapaRows = (db, leadId) => db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' ORDER BY id").all(leadId)
const move = (db, leadId, stageId, trigger = 'manual') => moveLeadToStage(db, { lead: leadRow(db, leadId), toStageId: stageId, trigger, gate: false })
const last = xs => xs[xs.length - 1]

test('proximo passo (puro): IA responde conta; enviada sem resposta continua sendo a proxima; pulado conta', () => {
  const steps = [{ id: 1, action_type: 'pergunta', question_key: 'k1' }, { id: 2, action_type: 'mensagem', question_key: null }, { id: 3, action_type: 'ligacao', question_key: null }]
  const ctx = (o = {}) => ({ answeredKeys: new Set(), askedKeys: new Set(), doneByAttempt: new Map(), ...o })
  assert.equal(computeNext(steps, ctx()).nextAttemptId, 1)
  const waiting = computeNext(steps, ctx({ askedKeys: new Set(['k1']) }))
  assert.equal(waiting.nextAttemptId, 1)
  assert.equal(waiting.states[0].state, 'aguardando')
  assert.equal(computeNext(steps, ctx({ answeredKeys: new Set(['k1']) })).nextAttemptId, 2)
  const r = computeNext(steps, ctx({ answeredKeys: new Set(['k1']), doneByAttempt: new Map([[2, { how: 'enviado' }], [3, { how: 'pulado' }]]) }))
  assert.deepEqual([r.nextAttemptId, r.doneCount, r.total], [null, 3, 3])
})

test('entrar na etapa abre a cadencia dela; sair fecha e abre a da nova; etapa final so fecha', () => {
  const { db, s, q, pergunta, ligacao } = setup()
  const leadId = leadIn(db, s, 'novo')
  move(db, leadId, s.stages.qualificando)
  let rows = etapaRows(db, leadId)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].cadence_id, rows[0].status, rows[0].current_attempt_id, rows[0].stage_id], [q.id, 'active', pergunta, s.stages.qualificando])
  move(db, leadId, s.stages.proposta)
  rows = etapaRows(db, leadId)
  assert.deepEqual(rows.map(r => r.status), ['completed', 'active'])
  assert.equal(rows[1].current_attempt_id, ligacao)
  move(db, leadId, s.stages.perdido)
  assert.deepEqual(etapaRows(db, leadId).map(r => r.status), ['completed', 'completed'])
})

test('lead novo e volta para a mesma etapa: abre uma vez por entrada (ensure idempotente)', () => {
  const { db, s, q } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  ensureStageCadence(db, { leadId })
  assert.equal(etapaRows(db, leadId).length, 1)
  move(db, leadId, s.stages.novo)
  move(db, leadId, s.stages.qualificando)
  assert.deepEqual(etapaRows(db, leadId).map(r => [r.cadence_id, r.status]), [[q.id, 'completed'], [q.id, 'active']])
})

test('desfazer o avanco automatico reabre a cadencia da etapa de onde saiu, com o que ja foi feito', () => {
  const { db, s, key, optionKey, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const first = ensureStageCadence(db, { leadId })
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'manual' })
  const adv = maybeAutoAdvance(db, { accountId: s.accountId, leadId })
  assert.equal(adv.to, s.stages.proposta)
  undoAutoAdvance(db, { accountId: s.accountId, leadId })
  const active = etapaRows(db, leadId).filter(r => r.status === 'active')
  assert.equal(active.length, 1)
  assert.equal(active[0].id, first.id)
  assert.equal(active[0].current_attempt_id, mensagem)
  const view = getLeadStageCadence(db, { accountId: s.accountId, leadId })
  assert.deepEqual(view.steps.map(x => x.state), ['feito', 'pendente'])
  assert.equal(view.steps[0].question.answer.option_key, optionKey)
})

test('etapa e avulsa juntas: troca de etapa nao mexe na avulsa; nova avulsa pausa so a avulsa', () => {
  const { db, s, q } = setup()
  const av = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem', auto_message: 'Sumiu?' }, { action_type: 'ligacao' }] })
  const av2 = createCadence(db, s.accountId, { name: 'Pós-evento', attempts: [{ action_type: 'mensagem' }] })
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const a = assignAvulsa(db, { accountId: s.accountId, cadenceId: av.id, leadId })
  assert.equal(a.kind, 'avulsa')
  assert.equal(etapaRows(db, leadId)[0].status, 'active')
  move(db, leadId, s.stages.proposta)
  const avRow = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(a.id)
  assert.deepEqual([avRow.status, avRow.current_attempt_id], ['active', av.attempts[0].id])
  assignAvulsa(db, { accountId: s.accountId, cadenceId: av2.id, leadId })
  assert.equal(db.prepare('SELECT status FROM lead_cadences WHERE id = ?').get(a.id).status, 'paused')
  assert.equal(last(etapaRows(db, leadId)).status, 'active')
  assert.throws(() => assignAvulsa(db, { accountId: s.accountId, cadenceId: q.id, leadId }), e => e.status === 400)
  assert.throws(() => assignAvulsa(db, { accountId: s.otherAccountId, cadenceId: av.id, leadId }), e => e.status === 404)
})

test('feito: pergunta so com resposta; resposta da IA conclui; ultimo passo fecha a cadencia', () => {
  const { db, s, pergunta, mensagem, key, optionKey } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  assert.throws(() => markStepDone(db, { accountId: s.accountId, leadId, attemptId: pergunta, how: 'feito' }), e => e.status === 400)
  markStepDone(db, { accountId: s.accountId, leadId, attemptId: mensagem, how: 'feito' })
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, pergunta)
  recordAsk(db, { accountId: s.accountId, leadId, questionKey: key, textSent: 'Para quando?', source: 'button' })
  assert.equal(getLeadStageCadence(db, { accountId: s.accountId, leadId }).steps[0].state, 'aguardando')
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: key, optionKey, origin: 'ia', evidence: 'dia 10' })
  refreshLeadStageCadence(db, { leadId })
  assert.equal(etapaRows(db, leadId)[0].status, 'completed')
})

test('passo apagado com o Chat aberto -> 409 sem gravar; lead de outra conta -> 404', () => {
  const { db, s, q, pergunta, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  deleteStep(db, s.accountId, q.id, mensagem)
  assert.throws(() => markStepDone(db, { accountId: s.accountId, leadId, attemptId: mensagem, how: 'feito' }),
    e => e.status === 409 && e.message === 'Esse passo mudou. A tela foi atualizada.')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadence_steps WHERE lead_id = ?').get(leadId).n, 0)
  assert.throws(() => markStepDone(db, { accountId: s.otherAccountId, leadId, attemptId: pergunta, how: 'pulado' }), e => e.status === 404)
  assert.throws(() => getLeadStageCadence(db, { accountId: s.otherAccountId, leadId }), e => e.status === 404)
})

test('apagar o passo atual: refreshLeadsOfCadence aponta para o proximo', () => {
  const { db, s, q, pergunta, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  deleteStep(db, s.accountId, q.id, pergunta)
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, null) // FK zerou
  assert.equal(refreshLeadsOfCadence(db, q.id), 1)
  assert.equal(etapaRows(db, leadId)[0].current_attempt_id, mensagem)
})

test('cadencia da etapa sem passos: a troca so fecha a anterior', () => {
  const { db, s } = setup()
  createCadence(db, s.accountId, { stageId: s.stages.novo })
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  move(db, leadId, s.stages.novo)
  assert.deepEqual(etapaRows(db, leadId).map(r => r.status), ['completed'])
})

test('Tarefas: concluir e pular pela mesma regra; outra conta -> 404; avulsa segue o jeito antigo', () => {
  const { db, s, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const lc = ensureStageCadence(db, { leadId })
  assert.throws(() => completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: lc.id, how: 'feito' }), e => e.status === 400)
  const r = completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: lc.id, how: 'pulado' })
  assert.deepEqual([r.completed, r.nextAttempt.id], [false, mensagem])
  assert.throws(() => completeCurrentStep(db, { accountId: s.otherAccountId, leadCadenceId: lc.id, how: 'feito' }), e => e.status === 404)
  const av = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem' }, { action_type: 'ligacao' }] })
  const a = assignAvulsa(db, { accountId: s.accountId, cadenceId: av.id, leadId })
  const r2 = completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: a.id, how: 'feito' })
  assert.deepEqual([r2.completed, r2.nextAttempt.id], [false, av.attempts[1].id])
  assert.equal(completeCurrentStep(db, { accountId: s.accountId, leadCadenceId: a.id, how: 'feito' }).completed, true)
})

test('cadencia criada depois pega quem ja esta na etapa (menos arquivado)', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const l1 = leadIn(db, s, 'novo'); const l2 = leadIn(db, s, 'novo'); leadIn(db, s, 'novo', { is_archived: 1 })
  const c = createCadence(db, s.accountId, { stageId: s.stages.novo })
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 0) // sem passos nao abre
  addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' })
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 2)
  assert.equal(attachLeadsInStage(db, { accountId: s.accountId, cadenceId: c.id }), 2) // idempotente
  assert.equal(etapaRows(db, l1).length + etapaRows(db, l2).length, 2)
})

test('visao do lead: passos com estado, pergunta com QState e can_force pelo papel', () => {
  const { db, s, pergunta } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  const v = getLeadStageCadence(db, { accountId: s.accountId, leadId, role: 'atendente' }) // ensure preguicoso
  assert.equal(v.stage.id, s.stages.qualificando)
  assert.equal(v.next_attempt_id, pergunta)
  assert.deepEqual(v.steps.map(x => x.action_type), ['pergunta', 'mensagem'])
  assert.equal(v.steps[0].question.text_for_lead, 'Para quando é o seu evento, Lead?')
  assert.equal(v.can_force, false)
  assert.equal(getLeadStageCadence(db, { accountId: s.accountId, leadId, role: 'gerente' }).can_force, true)
  const semEtapa = getLeadStageCadence(db, { accountId: s.accountId, leadId: leadIn(db, s, 'novo') })
  assert.deepEqual([semEtapa.lead_cadence, semEtapa.steps], [null, []])
})
```

Nota: `text_for_lead` troca `{nome}` pelo primeiro nome do lead (`addLead` usa `name: 'Lead'`). Se `questionTextForLead` deixar vírgula/espaço diferente, ajuste o esperado ao que `resolveLeadName` produz — não mude o serviço do roteiro.

- [ ] **Step 2:** `node --test test/leadCadence.test.js` → FAIL (módulos não existem).

- [ ] **Step 3: `server/services/cadence/nextStep.js`**

```js
// Proximo passo da cadencia da etapa (spec 4.2), puro: primeiro passo, na ordem, ainda nao
// concluido. Pergunta concluida = tem resposta (vendedor ou IA); enviada sem resposta =
// 'aguardando' (continua sendo o proximo). Mensagem/ligacao/etc = registro em lead_cadence_steps.
export function stepState(step, { answeredKeys, askedKeys, doneByAttempt }) {
  const done = doneByAttempt.get(step.id)
  if (done) return { state: 'feito', how: done.how }
  if (step.action_type === 'pergunta') {
    if (answeredKeys.has(step.question_key)) return { state: 'feito', how: 'respondida' }
    if (askedKeys.has(step.question_key)) return { state: 'aguardando', how: null }
  }
  return { state: 'pendente', how: null }
}

export function computeNext(steps, ctx) {
  const states = steps.map(s => ({ id: s.id, ...stepState(s, ctx) }))
  const next = states.find(x => x.state !== 'feito')
  return {
    states,
    nextAttemptId: next ? next.id : null,
    doneCount: states.filter(x => x.state === 'feito').length,
    total: steps.length,
  }
}
```

- [ ] **Step 4: `server/services/cadence/leadCadence.js`**

```js
// Cadencia da etapa no lead (spec 2026-09-27 §3.3, §4.1, §4.2): abre ao entrar na etapa,
// fecha ao sair, calcula o proximo passo e registra "feito". Avulsas seguem o jeito antigo
// (passo a passo pela posicao). Recebe db (nao importa server/db.js nem stageMove.js).
import { CadenceError } from './errors.js'
import { computeNext } from './nextStep.js'
import { getLeadRoteiro } from '../roteiro/leadRoteiro.js'
import { activeDeviationForLead } from '../roteiro/deviations.js'

const MANAGER_ROLES = ['gerente', 'super_admin']
const DONE_HOWS = ['enviado', 'feito', 'pulado']

function loadLead(db, accountId, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new CadenceError('not_found', 404, 'Lead não encontrado.')
  return lead
}

function activeEtapa(db, leadId) {
  return db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' AND status = 'active' ORDER BY id DESC LIMIT 1").get(leadId) || null
}

function stepsOf(db, cadenceId) {
  return db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(cadenceId)
}

// Entrada atual do lead na etapa = ultimo stage_history para ela (0 quando nao ha historico).
function stageEntryId(db, lead) {
  const row = db.prepare('SELECT MAX(id) AS id FROM stage_history WHERE lead_id = ? AND to_stage_id = ?').get(lead.id, lead.stage_id)
  return row && row.id ? row.id : 0
}

function inList(keys) {
  return keys.map(() => '?').join(',')
}

function ctxFor(db, lc, steps) {
  const keys = steps.filter(s => s.question_key).map(s => s.question_key)
  const answeredKeys = new Set(keys.length
    ? db.prepare(`SELECT question_key FROM lead_answers WHERE lead_id = ? AND question_key IN (${inList(keys)})`).all(lc.lead_id, ...keys).map(r => r.question_key)
    : [])
  const askedKeys = new Set(keys.length
    ? db.prepare(`SELECT DISTINCT question_key FROM roteiro_asks WHERE lead_id = ? AND asked_at >= ? AND question_key IN (${inList(keys)})`).all(lc.lead_id, lc.started_at, ...keys).map(r => r.question_key)
    : [])
  const doneRows = db.prepare('SELECT attempt_id, how, done_at, done_by FROM lead_cadence_steps WHERE lead_cadence_id = ?').all(lc.id)
  return { answeredKeys, askedKeys, doneByAttempt: new Map(doneRows.map(r => [r.attempt_id, r])) }
}

function close(db, leadCadenceId) {
  db.prepare("UPDATE lead_cadences SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(leadCadenceId)
}

export function refreshLeadCadence(db, { leadCadenceId }) {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(leadCadenceId)
  if (!lc || lc.status !== 'active' || lc.kind !== 'etapa') return lc || null
  const steps = stepsOf(db, lc.cadence_id)
  if (!steps.length) return lc // sem passos: fica aberta, sem passo atual (spec 9)
  const { nextAttemptId } = computeNext(steps, ctxFor(db, lc, steps))
  if (nextAttemptId === null) {
    db.prepare(`UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'),
      last_executed_attempt_id = COALESCE(current_attempt_id, last_executed_attempt_id), updated_at = datetime('now') WHERE id = ?`).run(lc.id)
  } else if (nextAttemptId !== lc.current_attempt_id) {
    if (lc.current_attempt_id) {
      // ancora do prazo do proximo passo = agora (mesma regra de tasks.js/scheduler)
      db.prepare(`UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?,
        updated_at = datetime('now') WHERE id = ?`).run(nextAttemptId, lc.current_attempt_id, lc.id)
    } else {
      db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(nextAttemptId, lc.id)
    }
  }
  return db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(lc.id)
}

export function refreshLeadStageCadence(db, { leadId }) {
  const lc = activeEtapa(db, leadId)
  return lc ? refreshLeadCadence(db, { leadCadenceId: lc.id }) : null
}

export function refreshLeadsOfCadence(db, cadenceId) {
  const rows = db.prepare("SELECT id FROM lead_cadences WHERE cadence_id = ? AND kind = 'etapa' AND status = 'active'").all(cadenceId)
  for (const r of rows) refreshLeadCadence(db, { leadCadenceId: r.id })
  return rows.length
}

// Abre a cadencia da etapa atual do lead, uma vez por entrada na etapa (decisao D3).
export function ensureStageCadence(db, { leadId }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead || !lead.stage_id || lead.is_active === 0) return null
  const stage = db.prepare('SELECT id, is_terminal FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!stage || stage.is_terminal) return null
  const cad = db.prepare('SELECT * FROM cadences WHERE stage_id = ? AND is_active = 1 AND account_id = ?').get(stage.id, lead.account_id)
  const active = activeEtapa(db, lead.id)
  if (active && cad && active.cadence_id === cad.id) return refreshLeadCadence(db, { leadCadenceId: active.id })
  if (active) close(db, active.id)
  if (!cad || !db.prepare('SELECT 1 FROM cadence_attempts WHERE cadence_id = ? LIMIT 1').get(cad.id)) return null
  const entry = stageEntryId(db, lead)
  if (db.prepare("SELECT 1 FROM lead_cadences WHERE lead_id = ? AND cadence_id = ? AND kind = 'etapa' AND COALESCE(stage_entry_id, 0) = ?").get(lead.id, cad.id, entry)) return null
  const id = Number(db.prepare("INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, kind, stage_id, stage_entry_id) VALUES (?, ?, NULL, 'etapa', ?, ?)")
    .run(lead.id, cad.id, stage.id, entry).lastInsertRowid)
  return refreshLeadCadence(db, { leadCadenceId: id })
}

// Porta unica da troca de etapa (stageMove) chama aqui: fecha a de etapa e abre a da nova.
// Desfazer o avanco automatico reabre a da etapa de onde o lead saiu (decisao D7).
export function onStageMoved(db, { leadId, trigger }) {
  const active = activeEtapa(db, leadId)
  if (active) close(db, active.id)
  if (trigger === 'roteiro_undo') {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
    const back = lead && db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' AND stage_id = ? AND id <> ? ORDER BY id DESC LIMIT 1")
      .get(leadId, lead.stage_id, active ? active.id : 0)
    if (back) {
      db.prepare("UPDATE lead_cadences SET status = 'active', stage_entry_id = ?, updated_at = datetime('now') WHERE id = ?").run(stageEntryId(db, lead), back.id)
      refreshLeadCadence(db, { leadCadenceId: back.id })
      return
    }
  }
  ensureStageCadence(db, { leadId })
}

export function attachLeadsInStage(db, { accountId, cadenceId }) {
  const cad = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ? AND stage_id IS NOT NULL AND is_active = 1').get(cadenceId, accountId)
  if (!cad) return 0
  const leads = db.prepare('SELECT id FROM leads WHERE account_id = ? AND stage_id = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(is_archived, 0) = 0').all(accountId, cad.stage_id)
  let n = 0
  for (const l of leads) {
    ensureStageCadence(db, { leadId: l.id })
    if (db.prepare("SELECT 1 FROM lead_cadences WHERE lead_id = ? AND cadence_id = ? AND kind = 'etapa' AND status = 'active'").get(l.id, cad.id)) n++
  }
  return n
}

export function advanceAvulsa(db, leadCadenceId) {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(leadCadenceId)
  const cur = lc.current_attempt_id ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(lc.current_attempt_id) : null
  const pos = cur ? cur.position : -1
  const next = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? AND position > ? ORDER BY position LIMIT 1').get(lc.cadence_id, pos) || null
  if (next) {
    db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(next.id, lc.current_attempt_id, lc.id)
  } else {
    db.prepare("UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(lc.current_attempt_id, lc.id)
  }
  return { completed: !next, nextAttempt: next }
}

export function markStepDone(db, { accountId, leadId, attemptId, how = 'feito', userId = null }) {
  if (!DONE_HOWS.includes(how)) throw new CadenceError('invalid', 400, 'Ação inválida.')
  const lead = loadLead(db, accountId, leadId)
  const row = db.prepare(`
    SELECT ca.*, lc.id AS lc_id, lc.kind AS lc_kind, lc.current_attempt_id AS lc_current
    FROM cadence_attempts ca JOIN lead_cadences lc ON lc.cadence_id = ca.cadence_id
    WHERE ca.id = ? AND lc.lead_id = ? AND lc.status = 'active' ORDER BY lc.id DESC LIMIT 1
  `).get(attemptId, lead.id)
  if (!row) throw new CadenceError('step_changed', 409, 'Esse passo mudou. A tela foi atualizada.')
  if (row.action_type === 'pergunta' && how !== 'pulado') {
    throw new CadenceError('invalid', 400, 'A pergunta fica feita quando tem resposta. Use [Já sei a resposta].')
  }
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO lead_cadence_steps (account_id, lead_cadence_id, lead_id, attempt_id, how, done_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, row.lc_id, lead.id, row.id, how, userId)
    if (row.lc_kind === 'etapa') refreshLeadCadence(db, { leadCadenceId: row.lc_id })
    else if (row.lc_current === row.id) advanceAvulsa(db, row.lc_id)
  })()
  return { lead_cadence_id: row.lc_id, kind: row.lc_kind }
}

// Concluir/Pular pela tela de Tarefas: mesma regra do Chat, com conta conferida.
export function completeCurrentStep(db, { accountId, leadCadenceId, how, userId = null }) {
  const lc = db.prepare('SELECT lc.*, l.account_id, l.attendant_id FROM lead_cadences lc JOIN leads l ON l.id = lc.lead_id WHERE lc.id = ? AND l.account_id = ?')
    .get(leadCadenceId, accountId)
  if (!lc) throw new CadenceError('not_found', 404, 'Tarefa não encontrada.')
  if (lc.status !== 'active') throw new CadenceError('invalid', 400, 'Cadência não está ativa.')
  if (!lc.current_attempt_id) throw new CadenceError('step_changed', 409, 'Esse passo mudou. A tela foi atualizada.')
  markStepDone(db, { accountId, leadId: lc.lead_id, attemptId: lc.current_attempt_id, how, userId })
  const after = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(lc.id)
  const completed = after.status === 'completed'
  const nextAttempt = !completed && after.current_attempt_id ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(after.current_attempt_id) : null
  return { completed, nextAttempt, lead: { account_id: lc.account_id, attendant_id: lc.attendant_id } }
}

export function assignAvulsa(db, { accountId, cadenceId, leadId }) {
  const cad = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ? AND is_active = 1').get(cadenceId, accountId)
  if (!cad) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  if (cad.stage_id) throw new CadenceError('invalid', 400, 'A cadência da etapa começa sozinha quando o lead entra na etapa.')
  const lead = loadLead(db, accountId, leadId)
  const first = db.prepare('SELECT id FROM cadence_attempts WHERE cadence_id = ? ORDER BY position LIMIT 1').get(cad.id)
  let id
  db.transaction(() => {
    db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE lead_id = ? AND status = 'active' AND kind = 'avulsa'").run(lead.id)
    id = Number(db.prepare("INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, kind) VALUES (?, ?, ?, 'avulsa')")
      .run(lead.id, cad.id, first ? first.id : null).lastInsertRowid)
  })()
  return db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(id)
}

// Formato antigo de GET /cadences/lead/:leadId (Chat, aba Info): passo atual com os dados dele.
export function leadCadenceView(db, leadCadenceId) {
  return db.prepare(`
    SELECT lc.*, c.name as cadence_name, ca.action_type, ca.description as attempt_description, ca.instructions as attempt_instructions,
      ca.auto_message as attempt_message, ca.call_script as attempt_script, ca.position as attempt_position, ca.delay_days,
      ca.scheduled_time, ca.schedule_mode, ca.delay_minutes,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    LEFT JOIN cadences c ON c.id = lc.cadence_id
    LEFT JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    WHERE lc.id = ?
  `).get(leadCadenceId) || null
}

export function getLeadStageCadence(db, { accountId, leadId, role = null }) {
  const lead = loadLead(db, accountId, leadId)
  ensureStageCadence(db, { leadId: lead.id }) // lead novo ou cadencia criada depois
  const stage = lead.stage_id ? db.prepare('SELECT id, name FROM funnel_stages WHERE id = ?').get(lead.stage_id) : null
  const base = {
    lead_id: lead.id,
    stage: stage ? { id: stage.id, name: stage.name } : null,
    deviation: activeDeviationForLead(db, { accountId, lead }),
    can_force: MANAGER_ROLES.includes(role),
  }
  let lc = activeEtapa(db, lead.id)
  if (!lc && lead.stage_id) {
    lc = db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' AND stage_id = ? ORDER BY id DESC LIMIT 1").get(lead.id, lead.stage_id) || null
  }
  if (!lc) return { ...base, lead_cadence: null, steps: [], next_attempt_id: null, done_count: 0, total: 0 }
  const cad = db.prepare('SELECT id, name FROM cadences WHERE id = ?').get(lc.cadence_id)
  const steps = stepsOf(db, lc.cadence_id)
  const ctx = ctxFor(db, lc, steps)
  const { states, nextAttemptId, doneCount, total } = computeNext(steps, ctx)
  const roteiro = getLeadRoteiro(db, { accountId, leadId: lead.id })
  const qByKey = new Map(roteiro.stages.flatMap(st => st.questions).map(q => [q.question_key, q]))
  const nameOf = db.prepare('SELECT name FROM users WHERE id = ?')
  return {
    ...base,
    lead_cadence: { id: lc.id, cadence_id: lc.cadence_id, cadence_name: cad ? cad.name : null, status: lc.status, started_at: lc.started_at },
    steps: steps.map((st, i) => {
      const done = ctx.doneByAttempt.get(st.id) || null
      const by = done && done.done_by ? nameOf.get(done.done_by) : null
      return {
        attempt_id: st.id, position: st.position, action_type: st.action_type, description: st.description, instructions: st.instructions,
        auto_message: st.auto_message, call_script: st.call_script, delay_days: st.delay_days, question_key: st.question_key,
        state: states[i].state, how: states[i].how, done_at: done ? done.done_at : null, done_by_name: by ? by.name : null,
        question: st.question_key ? (qByKey.get(st.question_key) || null) : null,
      }
    }),
    next_attempt_id: lc.status === 'active' ? nextAttemptId : null,
    done_count: doneCount,
    total,
  }
}
```

- [ ] **Step 5: Porta única — `server/services/stageMove.js`**. Import no topo: `import { onStageMoved } from './cadence/leadCadence.js'`. Em `moveLeadToStage`, logo depois do `db.transaction(() => { ... })()` e **antes** do `try { onMovedHook(...) }`:

```js
  // Cadencia da etapa: fecha a da etapa anterior e abre a da nova (spec 2026-09-27 §4.1).
  // Fora da transacao: se falhar, a troca de etapa continua valendo.
  try {
    onStageMoved(db, { leadId: current.id, trigger })
  } catch (e) {
    console.error('[stageMove] cadencia da etapa:', e.message)
  }
```

(`stageMove.js` é chamado por testes antigos com `createRoteiroTestDb()`, sem tabelas de cadência: o `try` evita quebrar; o erro vai para o log. Se o log poluir a saída do `npm test`, troque o `console.error` por `if (!/no such table/.test(e.message)) console.error(...)`.)

- [ ] **Step 6: Respostas refrescam o próximo passo.**
  - `server/routes/roteiroRouter.js`: `import { refreshLeadStageCadence } from '../services/cadence/leadCadence.js'`; em `PUT /leads/:leadId/answers/:questionKey`, logo depois de `markAnswered(...)`:

```js
      try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { console.error('[Cadencia] proximo passo:', e.message) }
```

  - `server/services/roteiro/runtime.js`: mesmo import; dentro de `bootRoteiroAi` → `run`, no `if (r.saved.length) { ... }`, antes do `scheduleFn`:

```js
      if (r.saved.length) {
        try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { console.error('[Cadencia] proximo passo:', e.message) }
        try { scheduleFn(lead.id) } catch (e) { console.error('[Roteiro] agendar nota:', e.message) }
      }
```

- [ ] **Step 7: Lead novo já entra com a cadência da etapa.** Nos 3 lugares que criam lead, logo depois do `INSERT INTO stage_history` do lead novo (import `ensureStageCadence` de `../services/cadence/leadCadence.js` ou `./cadence/leadCadence.js`):
  - `server/routes/leads.js` (depois de `const histRes = db.prepare('INSERT INTO stage_history ...').run(result.lastInsertRowid, firstStage.id, 'manual', req.user.id)`):
  - `server/services/inboundHandler.js` (depois de `const histRes = db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(lead.id, stage.id, 'polling')`):
  - `server/services/leadIntake.js` (depois de `db.prepare('INSERT INTO stage_history ...').run(result.lastInsertRowid, firstStage.id, 'webhook')`):

```js
    try { ensureStageCadence(db, { leadId: Number(result.lastInsertRowid) }) } catch (e) { console.error('[Cadencia] etapa do lead novo:', e.message) }
```

- [ ] **Step 8:** `node --test test/leadCadence.test.js` → PASS (12). `node --test test/stageMove.test.js test/roteiroHttp.test.js test/roteiroAi.test.js test/roteiroRuntime.test.js test/leadIntake.test.js test/inboundHandler.test.js` → todos passando. `npm test` → 934 passando.
- [ ] **Step 9: Commit**

```bash
git add server/services/cadence/nextStep.js server/services/cadence/leadCadence.js server/services/stageMove.js server/routes/roteiroRouter.js server/services/roteiro/runtime.js server/routes/leads.js server/services/inboundHandler.js server/services/leadIntake.js test/leadCadence.test.js
git commit -m "feat(cadencia): cadencia da etapa abre e fecha na troca de etapa e calcula o proximo passo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Envio de passo mensagem (ask `step-<id>`) e métricas por passo

**Files:**
- Create: `server/services/cadence/metrics.js`, `test/cadenceMetrics.test.js`
- Modify: `server/services/roteiro/runtime.js` (`roteiroOnChatSend` aceita `attemptId`), `server/routes/messages.js` (`roteiroAfterChatSend` repassa `req.body.cadence_attempt_id` nos envios de texto ~linha 174 e mídia ~linha 283)

**Interfaces:**
- Consumes: `markStepDone` (Task 3); `recordAsk(db, {...})`, `markReplied(db, {leadId, windowHours, now})` de `roteiro/asks.js`; `questionMetrics(db, {accountId, funnelId, days, now})`, `pct(n, total)`, `accountMinReplyRate(db, accountId)`, `MIN_SAMPLE` de `roteiro/metrics.js`; `resolveNow`, `shiftFromNow` de `roteiro/time.js`.
- Produces:
  - `stepAskKey(attemptId)` → `'step-<id>'`
  - `recordStepSend(db, { lead, attemptId, userId?, messageId?, content? })` → `askId | null` (grava ask com `source='button'` e `attempt_id`, marca o passo `enviado`)
  - `stepMetrics(db, { accountId, cadenceId, days = 90, now? })` → `StepMetric[]`, com `StepMetric = { attempt_id, kind: 'resposta', sent, reply_rate, advanced_rate, bought_rate, status: 'ok'|'fraca'|'amostra_pequena', by_seller } | { attempt_id, kind: 'feitas', done, reached }`
  - `roteiroOnChatSend(db, { lead, userId, content, messageId, questionKey, attemptId })` — com `attemptId` grava o envio do passo e manda SSE `lead:cadence { lead_id }`
  - Corpo de `POST /api/messages/:leadId` (texto e mídia) aceita `cadence_attempt_id`.

- [ ] **Step 1: Testes que falham — `test/cadenceMetrics.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_LIVRE } from './helpers/cadenceDb.js'
import { createCadence, addStep, getCadence } from '../server/services/cadence/repo.js'
import { ensureStageCadence } from '../server/services/cadence/leadCadence.js'
import { recordStepSend, stepMetrics, stepAskKey } from '../server/services/cadence/metrics.js'
import { markReplied, recordAsk } from '../server/services/roteiro/asks.js'
import { bootRoteiroRuntime, roteiroOnChatSend } from '../server/services/roteiro/runtime.js'
import { toSqliteDate } from '../server/services/roteiro/time.js'

const NOW = new Date('2026-09-27T12:00:00Z')

function setup() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const c = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, c.id, { action_type: 'pergunta', question: Q_LIVRE }).step_id
  const mensagem = addStep(db, s.accountId, c.id, { action_type: 'mensagem', auto_message: 'Segue o catálogo' }).step_id
  const ligacao = addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' }).step_id
  return { db, s, c, pergunta, mensagem, ligacao }
}
const lead = (db, id) => db.prepare('SELECT * FROM leads WHERE id = ?').get(id)

test('enviar pelo botao do passo mensagem grava ask step-<id> e marca o passo como enviado', () => {
  const { db, s, mensagem, pergunta } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const askId = recordStepSend(db, { lead: lead(db, leadId), attemptId: mensagem, userId: s.atendenteId, content: 'Segue o catálogo' })
  const ask = db.prepare('SELECT * FROM roteiro_asks WHERE id = ?').get(askId)
  assert.deepEqual([ask.question_key, ask.attempt_id, ask.source, ask.user_id], [stepAskKey(mensagem), mensagem, 'button', s.atendenteId])
  assert.equal(db.prepare('SELECT how FROM lead_cadence_steps WHERE attempt_id = ? AND lead_id = ?').get(mensagem, leadId).how, 'enviado')
  // pergunta nao passa por aqui; lead de outra conta / passo fora da cadencia do lead -> null, nada gravado
  assert.equal(recordStepSend(db, { lead: lead(db, leadId), attemptId: pergunta }), null)
  const outro = leadIn(db, s, 'novo')
  assert.equal(recordStepSend(db, { lead: lead(db, outro), attemptId: mensagem }), null)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM roteiro_asks').get().n, 1)
})

test('metrica da mensagem pelo mesmo calculo das perguntas; ligacao = feitas X de Y', () => {
  const { db, s, c, mensagem, ligacao } = setup()
  for (let i = 0; i < 20; i++) {
    const leadId = leadIn(db, s, 'qualificando')
    ensureStageCadence(db, { leadId })
    recordStepSend(db, { lead: lead(db, leadId), attemptId: mensagem, content: 'Segue o catálogo' })
    if (i < 10) markReplied(db, { leadId, windowHours: 24 })
    if (i < 3) db.prepare("INSERT INTO lead_cadence_steps (account_id, lead_cadence_id, lead_id, attempt_id, how) SELECT ?, id, ?, ?, 'feito' FROM lead_cadences WHERE lead_id = ?").run(s.accountId, leadId, ligacao, leadId)
  }
  const m = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id })
  const msg = m.find(x => x.attempt_id === mensagem)
  assert.deepEqual([msg.kind, msg.sent, msg.reply_rate, msg.status], ['resposta', 20, 50, 'fraca'])
  const lig = m.find(x => x.attempt_id === ligacao)
  assert.deepEqual([lig.kind, lig.done, lig.reached], ['feitas', 3, 20])
  assert.throws(() => stepMetrics(db, { accountId: s.otherAccountId, cadenceId: c.id }), e => e.status === 404)
})

test('metrica da pergunta vem do roteiro (questionMetrics) e janela de 90 dias', () => {
  const { db, s, c, pergunta } = setup()
  const key = getCadence(db, s.accountId, c.id).attempts[0].question_key
  const leadId = leadIn(db, s, 'qualificando')
  recordAsk(db, { accountId: s.accountId, leadId, questionKey: key, textSent: 'Conte mais', source: 'button' })
  db.prepare('UPDATE roteiro_asks SET asked_at = ?').run(toSqliteDate(new Date(NOW.getTime() - 5 * 86400000)))
  const m = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id, now: NOW }).find(x => x.attempt_id === pergunta)
  assert.deepEqual([m.kind, m.sent, m.status], ['resposta', 1, 'amostra_pequena'])
  const old = stepMetrics(db, { accountId: s.accountId, cadenceId: c.id, days: 3, now: NOW }).find(x => x.attempt_id === pergunta)
  assert.equal(old.sent, 0)
})

test('envio do Chat com cadence_attempt_id avisa lead:cadence', () => {
  const { db, s, mensagem } = setup()
  const leadId = leadIn(db, s, 'qualificando')
  ensureStageCadence(db, { leadId })
  const sent = []
  bootRoteiroRuntime({ db, broadcastSSE: (acc, ev, data) => sent.push([acc, ev, data]), triggerCapiForStageChange: () => {}, schedule: () => {} })
  roteiroOnChatSend(db, { lead: lead(db, leadId), userId: s.atendenteId, content: 'Segue', messageId: null, questionKey: null, attemptId: mensagem })
  assert.deepEqual(sent.filter(x => x[1] === 'lead:cadence'), [[s.accountId, 'lead:cadence', { lead_id: leadId }]])
})

test('messages.js repassa cadence_attempt_id nos dois envios (texto e midia)', () => {
  const src = fs.readFileSync(new URL('../server/routes/messages.js', import.meta.url), 'utf8')
  assert.equal((src.match(/attemptId: req\.body\.cadence_attempt_id/g) || []).length, 2)
  assert.match(src, /roteiroOnChatSend\(db, \{ lead, userId, content, messageId, questionKey: questionKey \|\| null, attemptId: attemptId \|\| null \}\)/)
})
```

- [ ] **Step 2:** `node --test test/cadenceMetrics.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: `server/services/cadence/metrics.js`**

```js
// Metrica por passo da cadencia (spec 3.5): mensagem enviada pelo botao do passo vira um
// ask 'step-<id>' e ganha "respondem X%" pelo mesmo calculo das perguntas; ligacao/visita/
// reuniao/e-mail = "feitas X de Y leads". Recebe db.
import { recordAsk } from '../roteiro/asks.js'
import { questionMetrics, pct, accountMinReplyRate, MIN_SAMPLE } from '../roteiro/metrics.js'
import { resolveNow, shiftFromNow } from '../roteiro/time.js'
import { markStepDone } from './leadCadence.js'
import { CadenceError } from './errors.js'

const MESSAGE_TYPES = ['mensagem', 'whatsapp']

export const stepAskKey = attemptId => `step-${attemptId}`

export function recordStepSend(db, { lead, attemptId, userId = null, messageId = null, content = null }) {
  const id = Number(attemptId)
  if (!Number.isInteger(id) || id <= 0) return null
  const row = db.prepare(`
    SELECT ca.id, ca.action_type FROM cadence_attempts ca
    JOIN lead_cadences lc ON lc.cadence_id = ca.cadence_id
    JOIN cadences c ON c.id = ca.cadence_id
    WHERE ca.id = ? AND lc.lead_id = ? AND lc.status = 'active' AND c.account_id = ?
  `).get(id, lead.id, lead.account_id)
  if (!row || !MESSAGE_TYPES.includes(row.action_type)) return null
  let askId
  db.transaction(() => {
    askId = recordAsk(db, { accountId: lead.account_id, leadId: lead.id, questionKey: stepAskKey(id), textSent: content, messageId, userId, source: 'button' })
    db.prepare('UPDATE roteiro_asks SET attempt_id = ? WHERE id = ?').run(id, askId)
    markStepDone(db, { accountId: lead.account_id, leadId: lead.id, attemptId: id, how: 'enviado', userId })
  })()
  return askId
}

export function stepMetrics(db, { accountId, cadenceId, days = 90, now } = {}) {
  const c = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ?').get(cadenceId, accountId)
  if (!c) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  const until = resolveNow(db, now)
  const since = shiftFromNow(db, until, `-${days} days`)
  const min = accountMinReplyRate(db, accountId)
  const steps = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(c.id)
  const byQuestion = c.funnel_id && steps.some(s => s.action_type === 'pergunta')
    ? new Map(questionMetrics(db, { accountId, funnelId: c.funnel_id, days, now }).map(m => [m.question_key, m]))
    : new Map()
  const totals = db.prepare(`
    SELECT COUNT(*) AS sent,
      SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN advanced_at IS NOT NULL THEN 1 ELSE 0 END) AS advanced,
      SUM(CASE WHEN bought_at IS NOT NULL THEN 1 ELSE 0 END) AS bought
    FROM roteiro_asks WHERE account_id = ? AND question_key = ? AND asked_at >= ? AND asked_at <= ?
  `)
  const doneStmt = db.prepare("SELECT COUNT(DISTINCT lead_id) AS n FROM lead_cadence_steps WHERE attempt_id = ? AND how IN ('feito','enviado') AND done_at >= ? AND done_at <= ?")
  const reached = db.prepare('SELECT COUNT(DISTINCT lead_id) AS n FROM lead_cadences WHERE cadence_id = ? AND started_at >= ? AND started_at <= ?').get(c.id, since, until).n
  return steps.map(s => {
    if (s.action_type === 'pergunta') {
      const m = byQuestion.get(s.question_key)
      return {
        attempt_id: s.id, kind: 'resposta', sent: m ? m.sent : 0, reply_rate: m ? m.reply_rate : null,
        advanced_rate: m ? m.advanced_rate : null, bought_rate: m ? m.bought_rate : null,
        status: m ? m.status : 'amostra_pequena', by_seller: m ? m.by_seller : [],
      }
    }
    if (MESSAGE_TYPES.includes(s.action_type)) {
      const t = totals.get(accountId, stepAskKey(s.id), since, until)
      const sent = t.sent || 0
      const replyRate = pct(t.replied || 0, sent)
      const status = sent < MIN_SAMPLE ? 'amostra_pequena' : (replyRate < min ? 'fraca' : 'ok')
      return {
        attempt_id: s.id, kind: 'resposta', sent, reply_rate: replyRate,
        advanced_rate: pct(t.advanced || 0, sent), bought_rate: pct(t.bought || 0, sent), status, by_seller: [],
      }
    }
    return { attempt_id: s.id, kind: 'feitas', done: doneStmt.get(s.id, since, until).n, reached }
  })
}
```

Nota: `lead_cadence_steps.done_at` e `lead_cadences.started_at` usam `datetime('now')`; no teste de "feitas" não se passa `now`, então a janela termina no relógio real.

- [ ] **Step 4: `server/services/roteiro/runtime.js`** — `import { recordStepSend } from '../cadence/metrics.js'` e trocar a assinatura/início de `roteiroOnChatSend`:

```js
// Envio pelo Chat: com attemptId (botao [Enviar] do passo mensagem) registra o envio do passo;
// com questionKey (botao) grava o ask com a variante vigente; sem nenhum, tenta reconhecer a
// pergunta digitada entre as pendentes da etapa atual. Devolve { question_key, text } ou null.
export function roteiroOnChatSend(db, { lead, userId = null, content, messageId = null, questionKey = null, attemptId = null }) {
  if (attemptId) {
    try {
      if (recordStepSend(db, { lead, attemptId, userId, messageId, content })) {
        broadcastFn(lead.account_id, 'lead:cadence', { lead_id: lead.id })
      }
    } catch (e) { console.error('[Cadencia] envio do passo:', e.message) }
    return null
  }
  const roteiro = getLeadRoteiro(db, { accountId: lead.account_id, leadId: lead.id })
  // ... resto igual
```

(Ciclo de import: `metrics.js` → `leadCadence.js` → `roteiro/leadRoteiro.js`; `runtime.js` já importa `leadRoteiro.js`; nenhum desses importa `runtime.js`. Ok.)

- [ ] **Step 5: `server/routes/messages.js`**

```js
function roteiroAfterChatSend({ lead, userId, content, messageId, questionKey, attemptId }) {
  try {
    onOutboundSaved({ db, lead })
    return roteiroOnChatSend(db, { lead, userId, content, messageId, questionKey: questionKey || null, attemptId: attemptId || null })
  } catch (e) {
    console.error('[Roteiro] envio do chat:', e.message)
    return null
  }
}
```

e nas duas chamadas (texto e mídia) acrescentar `attemptId: req.body.cadence_attempt_id` ao objeto, ex.:

```js
      ? roteiroAfterChatSend({ lead, userId: req.user.id, content, messageId: message.id, questionKey: req.body.roteiro_question_key, attemptId: req.body.cadence_attempt_id })
```

- [ ] **Step 6:** `node --test test/cadenceMetrics.test.js test/roteiroRuntime.test.js test/messagesRouteScope.test.js` → PASS. `npm test` → 939 passando.
- [ ] **Step 7: Commit**

```bash
git add server/services/cadence/metrics.js server/services/roteiro/runtime.js server/routes/messages.js test/cadenceMetrics.test.js
git commit -m "feat(cadencia): envio do passo mensagem conta como ask e metricas por passo

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Rotas das cadências — conta 404, atendente 403, passos por id, rotas do lead; Tarefas pela mesma regra

**Files:**
- Create: `server/routes/cadencesRouter.js`, `test/helpers/http.js`, `test/cadencesHttp.test.js`
- Modify: `server/routes/cadences.js` (vira casca), `server/routes/tasks.js` (`/:lcId/complete` e `/:lcId/skip`), `server/routes/roteiroRouter.js` (nada além da Task 3)

**Interfaces:**
- Consumes: tudo de `cadence/repo.js` (Task 2), `cadence/leadCadence.js` (Task 3), `stepMetrics` (Task 4); `canAtendenteAccessLead(userId, lead, db)` de `services/leadAccess.js`; `pickAnthropicKey(account)` de `services/anthropicKeyPicker.js`; `RoteiroError`.
- Produces — `createCadencesRouter(db, { ai = null, broadcast = () => {} } = {})`, montado em `/api/cadences` (mesmo `app.use` de hoje). Rotas (erros sempre `{ error, code }`):
  - Qualquer papel: `GET /?kind=avulsa|etapa` → `{ cadences }`; `GET /:id` → `{ cadence }`
  - Gestor (`gerente`, `super_admin`; atendente → 403):
    - `POST /` body `{ name?, description?, stage_id?, attempts? }` → `{ cadence }` (+ `attachLeadsInStage` quando é de etapa)
    - `PUT /:id` body `{ name?, description?, is_active? }` → `{ cadence }`
    - `DELETE /:id` → `{ ok: true }`
    - `PUT /:id/attempts` body `{ attempts }` → `{ cadence }` (avulsa, por id)
    - `POST /:id/steps` body `StepInput` → `{ cadence, step_id, published }`
    - `PATCH /:id/steps/:attemptId` body `StepPatch` → `{ cadence, step_id, published }`
    - `DELETE /:id/steps/:attemptId` → `{ cadence, published }`
    - `PUT /:id/steps/order` body `{ attempt_ids }` → `{ cadence, published }`
    - `GET /:id/metrics?days=90` → `{ steps: StepMetric[] }`
    - `GET /stage-view?funnel_id=` → `StageView` de `getStageView`
    - `PUT /funnels/:funnelId/deviations` body `{ deviations }` → `{ deviations, published }`
    - `POST /funnels/:funnelId/stages/:stageId/template` body `{ mode: 'bant' | 'ia' }` → `{ cadence }` (IA sem chave → 503 "A IA não está ligada nesta conta."; IA falhou → 502; nada para a etapa → 422)
    - `POST /suggestions/:id/apply` → `{ published, funnel_id, cadence_ids }`
    - `POST /variants/:id/confirm` → `{ published, version?, cadence_ids }`
    - Toda mudança de passo/cadência de etapa manda SSE `cadence:updated { cadence_id, stage_id }` e roda `refreshLeadsOfCadence` + `attachLeadsInStage`.
  - Vendedor (atendente só com acesso ao lead):
    - `POST /:id/assign` body `{ lead_id }` → `{ leadCadence }` (avulsa)
    - `PUT /lead-cadence/:lcId/advance` → `{ leadCadence }` (avulsa; formato `leadCadenceView`)
    - `DELETE /lead-cadence/:lcId` → `{ ok: true }` (só avulsa; etapa → 400)
    - `GET /lead/:leadId` → `{ leadCadence }` (**só a avulsa ativa**)
    - `GET /lead/:leadId/stage` → `LeadStageCadence`
    - `POST /lead/:leadId/steps/:attemptId/done` body `{ how: 'feito' | 'pulado' }` → `LeadStageCadence` (+ SSE `lead:cadence { lead_id }`)
  - Tarefas: `POST /api/tasks/:lcId/complete` e `/:lcId/skip` passam por `completeCurrentStep` (conta 404; resposta igual à de hoje: `{ ok, completed, nextStep }` / `{ ok }`).
  - Helpers de teste `test/helpers/http.js`: `token({ id, role, accountId })`, `peca(base, { method, path, jwtToken, body })` → `{ status, body }`, `withServer(mount, fn)`.

- [ ] **Step 1: `test/helpers/http.js`** (mesmo `peca` de `test/roteiroHttp.test.js`, reaproveitável)

```js
// Sobe um router num Express nu, porta efemera, e faz requisicoes cruas com node:http
// (sem fetch global — producao e Node 16). Padrao de test/roteiroHttp.test.js.
import http from 'node:http'
import express from 'express'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../../server/middleware/auth.js'

export function token({ id, role, accountId = null }) {
  return jwt.sign({ id, role, account_id: accountId }, JWT_SECRET)
}

export function peca(base, { method = 'GET', path = '/', jwtToken, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(base + path)
    const dados = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: {
        'Content-Type': 'application/json',
        ...(jwtToken ? { Authorization: `Bearer ${jwtToken}` } : {}),
        ...(dados ? { 'Content-Length': dados.length } : {}),
      },
    }, res => {
      let bruto = ''
      res.setEncoding('utf8')
      res.on('data', c => { bruto += c })
      res.on('end', () => {
        let json = null
        try { json = bruto ? JSON.parse(bruto) : null } catch { json = null }
        resolve({ status: res.statusCode, body: json })
      })
    })
    req.on('error', reject)
    if (dados) req.write(dados)
    req.end()
  })
}

// mount(app) registra as rotas; fn({ base }) roda os pedidos.
export async function withServer(mount, fn) {
  const app = express()
  app.use(express.json())
  mount(app)
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn({ base }) } finally { await new Promise(r => server.close(r)) }
}
```

- [ ] **Step 2: Testes que falham — `test/cadencesHttp.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO } from './helpers/cadenceDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createCadencesRouter } from '../server/routes/cadencesRouter.js'
import { createCadence, addStep, getCadence } from '../server/services/cadence/repo.js'
import { ensureStageCadence, assignAvulsa } from '../server/services/cadence/leadCadence.js'

async function comServidor(fn) {
  const db = createCadenceTestDb()
  const s = seedCadenceBase(db)
  const sent = []
  const broadcast = (acc, ev, data) => sent.push([acc, ev, data])
  await withServer(app => app.use('/api/cadences', authenticate, scopeToAccount, createCadencesRouter(db, { broadcast })), ({ base }) => fn({ db, s, base, sent }))
}

function montar(db, s) {
  const etapa = createCadence(db, s.accountId, { stageId: s.stages.qualificando })
  const pergunta = addStep(db, s.accountId, etapa.id, { action_type: 'pergunta', question: Q_PRAZO }).step_id
  const mensagem = addStep(db, s.accountId, etapa.id, { action_type: 'mensagem', auto_message: 'Catálogo' }).step_id
  const avulsa = createCadence(db, s.accountId, { name: 'Reativar', attempts: [{ action_type: 'mensagem' }, { action_type: 'ligacao' }] })
  const leadId = leadIn(db, s, 'qualificando', { attendant_id: s.atendenteId })
  const lcEtapa = ensureStageCadence(db, { leadId })
  const lcAvulsa = assignAvulsa(db, { accountId: s.accountId, cadenceId: avulsa.id, leadId })
  return { etapa, pergunta, mensagem, avulsa, leadId, lcEtapa, lcAvulsa }
}

test('gestor de outra conta recebe 404 em toda rota por id e nada muda', async () => {
  await comServidor(async ({ db, s, base }) => {
    const m = montar(db, s)
    const intruso = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Intruso', 'i@b.local', 'gerente')").run(s.otherAccountId).lastInsertRowid)
    const t = token({ id: intruso, role: 'gerente', accountId: s.otherAccountId })
    const casos = [
      ['GET', `/api/cadences/${m.etapa.id}`], ['PUT', `/api/cadences/${m.avulsa.id}`, { name: 'Hack' }], ['DELETE', `/api/cadences/${m.avulsa.id}`],
      ['PUT', `/api/cadences/${m.avulsa.id}/attempts`, { attempts: [] }], ['POST', `/api/cadences/${m.etapa.id}/steps`, { action_type: 'ligacao' }],
      ['PATCH', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, { auto_message: 'x' }], ['DELETE', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`],
      ['PUT', `/api/cadences/${m.etapa.id}/steps/order`, { attempt_ids: [m.mensagem, m.pergunta] }], ['GET', `/api/cadences/${m.etapa.id}/metrics`],
      ['POST', `/api/cadences/${m.avulsa.id}/assign`, { lead_id: m.leadId }], ['PUT', `/api/cadences/lead-cadence/${m.lcAvulsa.id}/advance`],
      ['DELETE', `/api/cadences/lead-cadence/${m.lcAvulsa.id}`], ['GET', `/api/cadences/lead/${m.leadId}`], ['GET', `/api/cadences/lead/${m.leadId}/stage`],
      ['POST', `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, { how: 'feito' }], ['GET', `/api/cadences/stage-view?funnel_id=${s.funnelId}`],
      ['PUT', `/api/cadences/funnels/${s.funnelId}/deviations`, { deviations: [] }],
    ]
    for (const [method, path, body] of casos) {
      const r = await peca(base, { method, path, jwtToken: t, body })
      assert.equal(r.status, 404, `${method} ${path} -> ${r.status}`)
    }
    assert.equal(getCadence(db, s.accountId, m.avulsa.id).name, 'Reativar')
    assert.equal(getCadence(db, s.accountId, m.etapa.id).attempts.length, 2)
    assert.equal(db.prepare('SELECT status FROM lead_cadences WHERE id = ?').get(m.lcAvulsa.id).status, 'active')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lead_cadence_steps').get().n, 0)
  })
})

test('atendente: 403 nas rotas do gestor e em lead que nao acessa; le a lista', async () => {
  await comServidor(async ({ db, s, base }) => {
    const m = montar(db, s)
    const t = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    for (const [method, path, body] of [
      ['POST', '/api/cadences', { name: 'X' }], ['PATCH', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, { auto_message: 'x' }],
      ['DELETE', `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`], ['GET', `/api/cadences/stage-view?funnel_id=${s.funnelId}`],
      ['POST', `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.novo}/template`, { mode: 'bant' }],
    ]) {
      assert.equal((await peca(base, { method, path, jwtToken: t, body })).status, 403, `${method} ${path}`)
    }
    assert.equal((await peca(base, { path: '/api/cadences?kind=avulsa', jwtToken: t })).body.cadences.length, 1)
    const alheio = leadIn(db, s, 'qualificando') // sem atendente
    for (const [method, path, body] of [
      ['GET', `/api/cadences/lead/${alheio}/stage`], ['POST', `/api/cadences/${m.avulsa.id}/assign`, { lead_id: alheio }],
      ['POST', `/api/cadences/lead/${alheio}/steps/${m.mensagem}/done`, { how: 'feito' }],
    ]) {
      assert.equal((await peca(base, { method, path, jwtToken: t, body })).status, 403, `${method} ${path}`)
    }
    const meu = await peca(base, { path: `/api/cadences/lead/${m.leadId}/stage`, jwtToken: t })
    assert.equal(meu.status, 200)
    assert.equal(meu.body.next_attempt_id, m.pergunta)
  })
})

test('PATCH do passo por id mantem o id e o ponteiro do lead e avisa cadence:updated', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const m = montar(db, s)
    const t = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'PATCH', path: `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, jwtToken: t, body: { auto_message: 'Segue o catálogo, {nome}' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.step_id, m.mensagem)
    assert.equal(r.body.published, false)
    assert.equal(db.prepare('SELECT current_attempt_id FROM lead_cadences WHERE id = ?').get(m.lcEtapa.id).current_attempt_id, m.pergunta)
    assert.deepEqual(sent.filter(x => x[1] === 'cadence:updated'), [[s.accountId, 'cadence:updated', { cadence_id: m.etapa.id, stage_id: s.stages.qualificando }]])
    const bad = await peca(base, { method: 'POST', path: `/api/cadences/${m.etapa.id}/steps`, jwtToken: t, body: { action_type: 'pergunta', question_key: 'naoexiste' } })
    assert.deepEqual([bad.status, bad.body.error], [400, 'Esta pergunta não está no roteiro da etapa.'])
  })
})

test('vendedor: Feito avanca e avisa lead:cadence; passo apagado -> 409; GET /lead/:id so traz a avulsa', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const m = montar(db, s)
    const tv = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const feito = await peca(base, { method: 'POST', path: `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, jwtToken: tv, body: { how: 'feito' } })
    assert.equal(feito.status, 200)
    assert.equal(feito.body.steps.find(x => x.attempt_id === m.mensagem).state, 'feito')
    assert.ok(sent.some(x => x[1] === 'lead:cadence' && x[2].lead_id === m.leadId))
    await peca(base, { method: 'DELETE', path: `/api/cadences/${m.etapa.id}/steps/${m.mensagem}`, jwtToken: tg })
    const velho = await peca(base, { method: 'POST', path: `/api/cadences/lead/${m.leadId}/steps/${m.mensagem}/done`, jwtToken: tv, body: { how: 'feito' } })
    assert.deepEqual([velho.status, velho.body.error], [409, 'Esse passo mudou. A tela foi atualizada.'])
    const av = await peca(base, { path: `/api/cadences/lead/${m.leadId}`, jwtToken: tv })
    assert.equal(av.body.leadCadence.cadence_id, m.avulsa.id)
    assert.equal((await peca(base, { method: 'DELETE', path: `/api/cadences/lead-cadence/${m.lcEtapa.id}`, jwtToken: tv })).status, 400)
  })
})

test('super_admin sem conta -> 400; modelo BANT pela rota cria a cadencia da etapa', async () => {
  await comServidor(async ({ db, s, base }) => {
    const ts = token({ id: 1, role: 'super_admin' })
    assert.equal((await peca(base, { path: '/api/cadences', jwtToken: ts })).status, 400)
    const tg = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const r = await peca(base, { method: 'POST', path: `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.novo}/template`, jwtToken: tg, body: { mode: 'bant' } })
    assert.equal(r.status, 200)
    assert.equal(r.body.cadence.attempts.length, 4)
    const ia = await peca(base, { method: 'POST', path: `/api/cadences/funnels/${s.funnelId}/stages/${s.stages.proposta}/template`, jwtToken: tg, body: { mode: 'ia' } })
    assert.deepEqual([ia.status, ia.body.error], [503, 'A IA não está ligada nesta conta.'])
  })
})

test('tasks.js conclui e pula pelo servico com conta conferida', () => {
  const src = fs.readFileSync(new URL('../server/routes/tasks.js', import.meta.url), 'utf8')
  assert.equal((src.match(/completeCurrentStep\(db, \{ accountId: req\.accountId/g) || []).length, 2)
  assert.doesNotMatch(src, /SELECT \* FROM lead_cadences WHERE id = \?'\)\.get\(req\.params\.lcId\)/)
})
```

- [ ] **Step 3:** `node --test test/cadencesHttp.test.js` → FAIL (módulo não existe).

- [ ] **Step 4: `server/routes/cadencesRouter.js`**

```js
// Rotas das cadencias (spec 2026-09-27 §5.1, §7): toda operacao por id confere a conta (404),
// atendente so mexe em lead que acessa (403). Nao importa server/db.js (cadences.js injeta).
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { RoteiroError } from '../services/roteiro/repo.js'
import { CadenceError } from '../services/cadence/errors.js'
import {
  listCadences, getCadence, createCadence, updateCadence, deleteCadence, replaceAttemptsById,
  addStep, updateStep, deleteStep, reorderSteps, getStageView, saveDeviations,
  addQuestionSteps, bantStepQuestions, aiStepQuestions, applySuggestionLive, confirmVariantLive,
} from '../services/cadence/repo.js'
import {
  attachLeadsInStage, refreshLeadsOfCadence, getLeadStageCadence, markStepDone,
  assignAvulsa, advanceAvulsa, leadCadenceView,
} from '../services/cadence/leadCadence.js'
import { stepMetrics } from '../services/cadence/metrics.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { pickAnthropicKey } from '../services/anthropicKeyPicker.js'

const MANAGER_ROLES = ['super_admin', 'gerente']

export function createCadencesRouter(db, { ai = null, broadcast = () => {} } = {}) {
  const router = Router()
  const manager = requireRole(...MANAGER_ROLES)

  function fail(res, e) {
    if (e instanceof CadenceError || e instanceof RoteiroError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Cadencias] erro:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }
  function send(accountId, event, data) {
    try { broadcast(accountId, event, data) } catch (e) { console.error('[Cadencias] SSE:', e.message) }
  }
  function leadScoped(req, leadId) {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, req.accountId)
    if (!lead) throw new CadenceError('not_found', 404, 'Lead não encontrado.')
    if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead, db)) throw new CadenceError('forbidden', 403, 'Sem permissão.')
    return lead
  }
  function lcScoped(req, lcId) {
    const lc = db.prepare('SELECT lc.* FROM lead_cadences lc JOIN leads l ON l.id = lc.lead_id WHERE lc.id = ? AND l.account_id = ?').get(lcId, req.accountId)
    if (!lc) throw new CadenceError('not_found', 404, 'Cadência do lead não encontrada.')
    leadScoped(req, lc.lead_id)
    return lc
  }
  // Mudou a cadencia da etapa: leads nela recalculam o passo atual e as telas recarregam.
  function afterStageChange(req, cadence) {
    if (!cadence.stage_id) return
    try {
      refreshLeadsOfCadence(db, cadence.id)
      attachLeadsInStage(db, { accountId: req.accountId, cadenceId: cadence.id })
    } catch (e) { console.error('[Cadencias] leads da etapa:', e.message) }
    send(req.accountId, 'cadence:updated', { cadence_id: cadence.id, stage_id: cadence.stage_id })
  }
  function funnelScoped(req, funnelId) {
    if (!db.prepare('SELECT 1 FROM funnels WHERE id = ? AND account_id = ?').get(funnelId, req.accountId)) throw new CadenceError('not_found', 404, 'Funil não encontrado.')
  }

  router.use((req, res, next) => {
    if (req.user.role === 'super_admin' && !req.accountId) return res.status(400).json({ error: 'Selecione uma conta.' })
    next()
  })

  // ------------------------------------------------ gestor (rotas fixas antes de /:id) ----
  router.get('/stage-view', manager, (req, res) => {
    try {
      if (!req.query.funnel_id) throw new CadenceError('invalid', 400, 'Informe o funil.')
      res.json(getStageView(db, req.accountId, req.query.funnel_id))
    } catch (e) { fail(res, e) }
  })

  router.put('/funnels/:funnelId/deviations', manager, (req, res) => {
    try {
      funnelScoped(req, req.params.funnelId)
      const r = saveDeviations(db, req.accountId, req.params.funnelId, req.body?.deviations, { userId: req.user.id })
      if (r.published) send(req.accountId, 'cadence:updated', { funnel_id: Number(req.params.funnelId) })
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.post('/funnels/:funnelId/stages/:stageId/template', manager, async (req, res) => {
    try {
      funnelScoped(req, req.params.funnelId)
      const mode = req.body?.mode
      let questions
      if (mode === 'bant') {
        questions = bantStepQuestions(db, req.accountId, req.params.funnelId)
        if (!questions.length) throw new CadenceError('invalid', 400, 'As 4 perguntas do modelo BANT já estão no funil.')
      } else if (mode === 'ia') {
        const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId)
        if (!ai || !pickAnthropicKey(account)) return res.status(503).json({ error: 'A IA não está ligada nesta conta.' })
        questions = await aiStepQuestions(db, req.accountId, { funnelId: req.params.funnelId, stageId: req.params.stageId, ai })
      } else {
        throw new CadenceError('invalid', 400, 'Modelo inválido.')
      }
      const cadence = addQuestionSteps(db, req.accountId, { stageId: req.params.stageId, questions, userId: req.user.id })
      afterStageChange(req, cadence)
      res.json({ cadence: getCadence(db, req.accountId, cadence.id) })
    } catch (e) { fail(res, e) }
  })

  router.post('/suggestions/:id/apply', manager, (req, res) => {
    try {
      const r = applySuggestionLive(db, req.accountId, req.params.id, { userId: req.user.id })
      for (const id of r.cadence_ids) afterStageChange(req, getCadence(db, req.accountId, id))
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.post('/variants/:id/confirm', manager, (req, res) => {
    try {
      const r = confirmVariantLive(db, req.accountId, req.params.id, { userId: req.user.id })
      for (const id of r.cadence_ids) afterStageChange(req, getCadence(db, req.accountId, id))
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  // -------------------------------------------------------------- vendedor (fixas) ----
  router.get('/lead/:leadId', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      const lc = db.prepare("SELECT id FROM lead_cadences WHERE lead_id = ? AND status = 'active' AND kind = 'avulsa' ORDER BY started_at DESC, id DESC LIMIT 1").get(lead.id)
      res.json({ leadCadence: lc ? leadCadenceView(db, lc.id) : null })
    } catch (e) { fail(res, e) }
  })

  router.get('/lead/:leadId/stage', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      res.json(getLeadStageCadence(db, { accountId: req.accountId, leadId: lead.id, role: req.user.role }))
    } catch (e) { fail(res, e) }
  })

  router.post('/lead/:leadId/steps/:attemptId/done', (req, res) => {
    try {
      const lead = leadScoped(req, req.params.leadId)
      const how = req.body?.how === 'pulado' ? 'pulado' : 'feito'
      markStepDone(db, { accountId: req.accountId, leadId: lead.id, attemptId: Number(req.params.attemptId), how, userId: req.user.id })
      send(req.accountId, 'lead:cadence', { lead_id: lead.id })
      res.json(getLeadStageCadence(db, { accountId: req.accountId, leadId: lead.id, role: req.user.role }))
    } catch (e) { fail(res, e) }
  })

  router.put('/lead-cadence/:lcId/advance', (req, res) => {
    try {
      const lc = lcScoped(req, req.params.lcId)
      if (lc.kind === 'etapa') throw new CadenceError('invalid', 400, 'Use Feito no próximo passo da etapa.')
      if (lc.status !== 'active') throw new CadenceError('invalid', 400, 'Cadência não está ativa.')
      advanceAvulsa(db, lc.id)
      res.json({ leadCadence: leadCadenceView(db, lc.id) })
    } catch (e) { fail(res, e) }
  })

  router.delete('/lead-cadence/:lcId', (req, res) => {
    try {
      const lc = lcScoped(req, req.params.lcId)
      if (lc.kind === 'etapa') throw new CadenceError('invalid', 400, 'A cadência da etapa fecha sozinha quando o lead muda de etapa.')
      db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(lc.id)
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  // ------------------------------------------------------------------ lista e por id ----
  router.get('/', (req, res) => {
    try {
      const kind = req.query.kind === 'avulsa' || req.query.kind === 'etapa' ? req.query.kind : undefined
      res.json({ cadences: listCadences(db, req.accountId, { kind }) })
    } catch (e) { fail(res, e) }
  })

  router.post('/', manager, (req, res) => {
    try {
      const b = req.body || {}
      const cadence = createCadence(db, req.accountId, { name: b.name, description: b.description, stageId: b.stage_id ?? null, attempts: b.attempts || [] })
      afterStageChange(req, cadence)
      res.json({ cadence: getCadence(db, req.accountId, cadence.id) })
    } catch (e) { fail(res, e) }
  })

  router.get('/:id', (req, res) => {
    try { res.json({ cadence: getCadence(db, req.accountId, req.params.id) }) } catch (e) { fail(res, e) }
  })

  router.put('/:id', manager, (req, res) => {
    try {
      const cadence = updateCadence(db, req.accountId, req.params.id, req.body || {})
      afterStageChange(req, cadence)
      res.json({ cadence })
    } catch (e) { fail(res, e) }
  })

  router.delete('/:id', manager, (req, res) => {
    try { res.json(deleteCadence(db, req.accountId, req.params.id)) } catch (e) { fail(res, e) }
  })

  router.put('/:id/attempts', manager, (req, res) => {
    try { res.json({ cadence: replaceAttemptsById(db, req.accountId, req.params.id, req.body?.attempts) }) } catch (e) { fail(res, e) }
  })

  router.post('/:id/steps', manager, (req, res) => {
    try {
      const r = addStep(db, req.accountId, req.params.id, req.body || {}, { userId: req.user.id })
      afterStageChange(req, r.cadence)
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.put('/:id/steps/order', manager, (req, res) => {
    try {
      const r = reorderSteps(db, req.accountId, req.params.id, req.body?.attempt_ids, { userId: req.user.id })
      afterStageChange(req, r.cadence)
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.patch('/:id/steps/:attemptId', manager, (req, res) => {
    try {
      const r = updateStep(db, req.accountId, req.params.id, Number(req.params.attemptId), req.body || {}, { userId: req.user.id })
      afterStageChange(req, r.cadence)
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.delete('/:id/steps/:attemptId', manager, (req, res) => {
    try {
      const r = deleteStep(db, req.accountId, req.params.id, Number(req.params.attemptId), { userId: req.user.id })
      afterStageChange(req, r.cadence)
      res.json(r)
    } catch (e) { fail(res, e) }
  })

  router.get('/:id/metrics', manager, (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 90))
      res.json({ steps: stepMetrics(db, { accountId: req.accountId, cadenceId: req.params.id, days }) })
    } catch (e) { fail(res, e) }
  })

  router.post('/:id/assign', (req, res) => {
    try {
      const leadId = req.body?.lead_id
      if (!leadId) throw new CadenceError('invalid', 400, 'Informe o lead.')
      const lead = leadScoped(req, leadId)
      getCadence(db, req.accountId, req.params.id) // 404 antes de qualquer escrita
      const lc = assignAvulsa(db, { accountId: req.accountId, cadenceId: req.params.id, leadId: lead.id })
      res.json({ leadCadence: lc })
    } catch (e) { fail(res, e) }
  })

  return router
}
```

Ordem importa: `/stage-view`, `/funnels/...`, `/suggestions/...`, `/variants/...`, `/lead/...`, `/lead-cadence/...` ficam **antes** de `/:id`; `/:id/steps/order` antes de `/:id/steps/:attemptId`. Nota do teste de 404: `POST /:id/assign` de outro gestor dá 404 no `leadScoped` (lead é da conta A); `GET /stage-view` dá 404 pelo `getRoteiro`.

- [ ] **Step 5: `server/routes/cadences.js` vira casca** (conteúdo inteiro):

```js
// Casca de producao das rotas de cadencias: injeta o banco real, a IA do roteiro e o SSE.
// Toda a logica (e os testes HTTP) vive em cadencesRouter.js, que recebe db.
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { createCadencesRouter } from './cadencesRouter.js'
import { createRoteiroAi } from '../services/roteiro/aiAdapter.js'

export default createCadencesRouter(db, { ai: createRoteiroAi(db), broadcast: broadcastSSE })
```

- [ ] **Step 6: `server/routes/tasks.js`** — `import { completeCurrentStep } from '../services/cadence/leadCadence.js'` e `import { CadenceError } from '../services/cadence/errors.js'`. Substituir o corpo de `POST /:lcId/complete`:

```js
router.post('/:lcId/complete', (req, res) => {
  let r
  try {
    r = completeCurrentStep(db, { accountId: req.accountId, leadCadenceId: req.params.lcId, how: 'feito', userId: req.user.id })
  } catch (e) {
    if (e instanceof CadenceError) return res.status(e.status).json({ error: e.message, code: e.code })
    throw e
  }
  broadcastSSE(r.lead.account_id, 'task:updated', { lead_cadence_id: Number(req.params.lcId), attendant_id: r.lead.attendant_id })
  let nextStep = null
  if (r.nextAttempt) {
    // Anchor for the newly-current step is NOW (we just completed the previous one)
    const nowIso = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const n = r.nextAttempt
    const due = computeDueDatetime({ startedAt: nowIso, lastExecutedAt: nowIso, delay_days: n.delay_days, scheduled_time: n.scheduled_time, schedule_mode: n.schedule_mode, delay_minutes: n.delay_minutes })
    nextStep = { position: n.position, action_type: n.action_type, description: n.description, delay_days: n.delay_days, scheduled_time: n.scheduled_time, schedule_mode: n.schedule_mode, delay_minutes: n.delay_minutes, due_datetime: due.toISOString() }
  }
  res.json({ ok: true, completed: r.completed, nextStep })
})
```

e o de `POST /:lcId/skip`:

```js
router.post('/:lcId/skip', (req, res) => {
  let r
  try {
    r = completeCurrentStep(db, { accountId: req.accountId, leadCadenceId: req.params.lcId, how: 'pulado', userId: req.user.id })
  } catch (e) {
    if (e instanceof CadenceError) return res.status(e.status).json({ error: e.message, code: e.code })
    throw e
  }
  broadcastSSE(r.lead.account_id, 'task:updated', { lead_cadence_id: Number(req.params.lcId), attendant_id: r.lead.attendant_id })
  res.json({ ok: true })
})
```

(`req.accountId` é nulo para super_admin sem `?account_id` → `completeCurrentStep` devolve 404, como as outras rotas de conta.)

- [ ] **Step 7:** `node --test test/cadencesHttp.test.js` → PASS (6). `npm test` → 945 passando.
- [ ] **Step 8: Commit**

```bash
git add server/routes/cadencesRouter.js server/routes/cadences.js server/routes/tasks.js test/helpers/http.js test/cadencesHttp.test.js
git commit -m "fix(cadencia): rotas de cadencias conferem a conta e o atendente; passos salvos por id

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Migração única — perguntas publicadas viram cadências da etapa

**Files:**
- Create: `server/services/cadence/migrateStageCadences.js`, `test/cadenceMigrate.test.js`
- Modify: `server/db.js` (logo depois do bloco `applyCadenceSchema` da Task 1)

**Interfaces:**
- Consumes: `getPublishedQuestions(db, accountId, funnelId)` de `roteiro/repo.js`; `attachLeadsInStage(db, {accountId, cadenceId})` (Task 3).
- Produces: `CADENCIA_ETAPA_FLAG = 'cadencia_etapa_migrada'`; `migrateStageCadences(db)` → `{ accounts, cadences, leads, skipped }`.

- [ ] **Step 1: Testes que falham — `test/cadenceMigrate.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCadenceTestDb, seedCadenceBase, leadIn, Q_PRAZO, Q_LIVRE } from './helpers/cadenceDb.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { migrateStageCadences, CADENCIA_ETAPA_FLAG } from '../server/services/cadence/migrateStageCadences.js'

function publicarRoteiro(db, s) {
  saveDraft(db, s.accountId, s.funnelId, { questions: [
    { ...Q_PRAZO, stage_id: s.stages.qualificando, position: 0 },
    { ...Q_LIVRE, stage_id: s.stages.qualificando, position: 1 },
    { ...Q_LIVRE, text: 'Qual o orçamento?', stage_id: s.stages.proposta, position: 0 },
  ], deviations: [] })
  return publish(db, s.accountId, s.funnelId, null)
}

test('cria a cadencia de cada etapa com as perguntas na ordem e abre para os leads ativos', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const pub = publicarRoteiro(db, s)
  const l1 = leadIn(db, s, 'qualificando'); leadIn(db, s, 'qualificando', { is_archived: 1 }); leadIn(db, s, 'venda')
  const antiga = Number(db.prepare("INSERT INTO cadences (account_id, name) VALUES (?, 'Antiga')").run(s.accountId).lastInsertRowid)
  const avulsaLc = Number(db.prepare('INSERT INTO lead_cadences (lead_id, cadence_id) VALUES (?, ?)').run(l1, antiga).lastInsertRowid)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.accounts, r.cadences, r.leads, r.skipped], [1, 2, 1, false])
  const q = db.prepare('SELECT * FROM cadences WHERE stage_id = ?').get(s.stages.qualificando)
  assert.equal(q.name, 'Qualificando')
  const keys = db.prepare('SELECT question_key, action_type, description FROM cadence_attempts WHERE cadence_id = ? ORDER BY position').all(q.id)
  const esperadas = pub.questions.filter(x => x.stage_id === s.stages.qualificando).sort((a, b) => a.position - b.position)
  assert.deepEqual(keys.map(k => [k.question_key, k.action_type, k.description]), esperadas.map(x => [x.question_key, 'pergunta', x.text]))
  assert.equal(db.prepare("SELECT kind FROM lead_cadences WHERE id = ?").get(avulsaLc).kind, 'avulsa')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_cadences WHERE kind = 'etapa'").get().n, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM roteiro_versions WHERE account_id = ? AND status IN ('published','archived')").get(s.accountId).n, 1) // nao publica de novo
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG))
})

test('rodar 2x nao duplica (com e sem a marca)', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  publicarRoteiro(db, s)
  leadIn(db, s, 'qualificando')
  migrateStageCadences(db)
  assert.equal(migrateStageCadences(db).skipped, true)
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(CADENCIA_ETAPA_FLAG)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.cadences, r.skipped], [0, false])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadences WHERE stage_id IS NOT NULL').get().n, 2)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM lead_cadences WHERE kind = 'etapa'").get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cadence_attempts').get().n, 3)
})

test('falha de uma conta nao trava as outras e a marca fica gravada', () => {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  publicarRoteiro(db, s)
  // versao publicada da conta B apontando para um funil que nao e dela -> getPublishedQuestions lanca 404
  db.prepare("INSERT INTO roteiro_versions (account_id, funnel_id, version, status) VALUES (?, ?, 1, 'published')").run(s.otherAccountId, s.funnelId)
  const r = migrateStageCadences(db)
  assert.deepEqual([r.accounts, r.cadences], [1, 2])
  assert.ok(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG))
})
```

- [ ] **Step 2:** `node --test test/cadenceMigrate.test.js` → FAIL.

- [ ] **Step 3: `server/services/cadence/migrateStageCadences.js`**

```js
// Migracao unica (spec 2026-09-27 §6): cada etapa com perguntas publicadas e sem cadencia da
// etapa ganha a cadencia "<Etapa>" com os passos pergunta na ordem do roteiro; leads ativos
// dessas etapas ganham a lead_cadences kind='etapa'. Nenhuma mensagem sai; nada e apagado.
// Falha isolada por conta; a marca e gravada no fim para nao travar o boot. Recebe db.
import { getPublishedQuestions } from '../roteiro/repo.js'
import { attachLeadsInStage } from './leadCadence.js'

export const CADENCIA_ETAPA_FLAG = 'cadencia_etapa_migrada'

function migrateAccount(db, accountId, funnelIds) {
  let cadences = 0
  let leads = 0
  const stageStmt = db.prepare('SELECT id, name, is_terminal FROM funnel_stages WHERE funnel_id = ? ORDER BY position')
  const hasCad = db.prepare('SELECT id FROM cadences WHERE stage_id = ? AND is_active = 1')
  const insCad = db.prepare('INSERT INTO cadences (account_id, name, funnel_id, stage_id) VALUES (?, ?, ?, ?)')
  const insStep = db.prepare("INSERT INTO cadence_attempts (cadence_id, position, action_type, description, question_key) VALUES (?, ?, 'pergunta', ?, ?)")
  for (const funnelId of funnelIds) {
    const questions = getPublishedQuestions(db, accountId, funnelId) // 404 se o funil nao e da conta
    for (const stage of stageStmt.all(funnelId)) {
      if (stage.is_terminal) continue
      const qs = questions.filter(q => q.stage_id === stage.id).sort((a, b) => a.position - b.position)
      if (!qs.length || hasCad.get(stage.id)) continue
      const cadenceId = Number(insCad.run(accountId, stage.name, funnelId, stage.id).lastInsertRowid)
      qs.forEach((q, i) => insStep.run(cadenceId, i, q.text, q.question_key))
      cadences++
      leads += attachLeadsInStage(db, { accountId, cadenceId })
    }
  }
  return { cadences, leads }
}

export function migrateStageCadences(db) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(CADENCIA_ETAPA_FLAG)) return { accounts: 0, cadences: 0, leads: 0, skipped: true }
  const rows = db.prepare("SELECT DISTINCT account_id, funnel_id FROM roteiro_versions WHERE status = 'published' ORDER BY account_id, funnel_id").all()
  const byAccount = new Map()
  for (const r of rows) {
    if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, [])
    byAccount.get(r.account_id).push(r.funnel_id)
  }
  let accounts = 0
  let cadences = 0
  let leads = 0
  for (const [accountId, funnelIds] of byAccount) {
    try {
      db.transaction(() => {
        const r = migrateAccount(db, accountId, funnelIds)
        cadences += r.cadences
        leads += r.leads
      })()
      accounts++
    } catch (err) {
      console.error(`[Cadencia] migracao da conta ${accountId}: ${err.message}`)
    }
  }
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(CADENCIA_ETAPA_FLAG, new Date().toISOString())
  return { accounts, cadences, leads, skipped: false }
}
```

Nota: no teste 1, `leads` = 1 porque só o lead não arquivado em "Qualificando" abre (Proposta tem cadência mas nenhum lead). No teste 3, a conta B falha antes de criar qualquer coisa (transação desfeita).

- [ ] **Step 4: `server/db.js`** — `import { migrateStageCadences } from './services/cadence/migrateStageCadences.js'` no topo; depois do bloco `applyCadenceSchema` (Task 1):

```js
// Perguntas publicadas do roteiro viram cadencias da etapa (uma vez; marca em app_settings).
try {
  const r = migrateStageCadences(db)
  if (!r.skipped && r.cadences) console.log(`[Cadencia] migracao: ${r.cadences} cadencias de etapa, ${r.leads} leads, ${r.accounts} contas`)
} catch (err) {
  console.error('[Cadencia] migracao das cadencias da etapa:', err.message)
}
```

- [ ] **Step 5:** `node --test test/cadenceMigrate.test.js` → PASS (3). `npm test` → 948 passando.
- [ ] **Step 6: Commit**

```bash
git add server/services/cadence/migrateStageCadences.js server/db.js test/cadenceMigrate.test.js
git commit -m "feat(cadencia): migra as perguntas publicadas para a cadencia de cada etapa

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Dashboard — "Taxa de venda por faixa do termômetro"

**Files:**
- Create: `src/components/score/ConversionByBandCard.tsx`
- Modify: `server/routes/roteiroRouter.js` (rota nova), `test/roteiroHttp.test.js` (+1 teste), `src/lib/roteiroApi.ts` (`fetchConversionByBand`), `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `conversionByBand(db, {accountId, now})` de `roteiro/metrics.js` (já importado no router); `BAND_META` de `src/lib/score.ts`; `barWidth`, `fmtPct` de `src/lib/roteiroManager.js`; `HelpTip`.
- Produces: `GET /api/roteiro/conversion-by-band` (gestor) → `{ bands: {band, leads, bought, rate}[], warning: boolean }`; `fetchConversionByBand(accountId): Promise<ConversionByBand>` com `export type ConversionByBand = RoteiroPerformance['conversion']`; `<ConversionByBandCard accountId={number} />`.

- [ ] **Step 1: Teste que falha** — em `test/roteiroHttp.test.js` (usa `comServidor`, `peca`, `token`, `seedRoteiroBase` já importados lá):

```js
test('GET /conversion-by-band: gestor ve as 4 faixas; atendente recebe 403', async () => {
  await comServidor(async ({ db, base }) => {
    const { accountId, gerenteId, atendenteId } = seedRoteiroBase(db)
    const r = await peca(base, { path: '/api/roteiro/conversion-by-band', jwtToken: token({ id: gerenteId, role: 'gerente', accountId }) })
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.bands.map(b => b.band), ['frio', 'morno', 'quente', 'pronto'])
    assert.equal(r.body.warning, false)
    const a = await peca(base, { path: '/api/roteiro/conversion-by-band', jwtToken: token({ id: atendenteId, role: 'atendente', accountId }) })
    assert.equal(a.status, 403)
  })
})
```

- [ ] **Step 2:** `node --test test/roteiroHttp.test.js` → FAIL (404 na rota).
- [ ] **Step 3: Rota** — em `server/routes/roteiroRouter.js`, logo depois de `router.get('/performance', ...)`:

```js
  // Quadro do Dashboard (spec 2026-09-27 §5.2): nao depende de funil.
  router.get('/conversion-by-band', manager, (req, res) => {
    try {
      res.json(conversionByBand(db, { accountId: req.accountId, now: now() }))
    } catch (e) { fail(res, e) }
  })
```

- [ ] **Step 4: `src/lib/roteiroApi.ts`** (depois de `fetchPerformance`):

```ts
export type ConversionByBand = RoteiroPerformance['conversion']
export const fetchConversionByBand = (accountId: number) =>
  apiFetch<ConversionByBand>(`/api/roteiro/conversion-by-band?account_id=${accountId}`)
```

- [ ] **Step 5: `src/components/score/ConversionByBandCard.tsx`** (textos iguais aos da antiga aba Desempenho):

```tsx
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3 } from 'lucide-react'
import { fetchConversionByBand, type ConversionByBand } from '../../lib/roteiroApi'
import { BAND_META } from '../../lib/score'
import { barWidth, fmtPct } from '../../lib/roteiroManager.js'
import HelpTip from '../HelpTip'

// Quadro "Taxa de venda por faixa do termometro" (spec 2026-09-27 §5.2): mora no Dashboard.
export default function ConversionByBandCard({ accountId }: { accountId: number }) {
  const [data, setData] = useState<ConversionByBand | null>(null)
  const [error, setError] = useState(false)
  const load = useCallback(() => {
    setError(false)
    fetchConversionByBand(accountId).then(setData).catch(() => setError(true))
  }, [accountId])
  useEffect(() => { load() }, [load])

  const bands = data?.bands || []
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <BarChart3 size={15} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 14, fontFamily: 'var(--font-heading)', margin: 0 }}>Taxa de venda por faixa do termômetro</h3>
        <HelpTip title="Taxa de venda por faixa" width={320}>
          Pega os leads de cada faixa de 30 dias atrás e mostra quantos compraram depois. Se o termômetro funciona, Pronto vende mais que Quente, que vende mais que Morno. Ex.: 10 leads Pronto, 4 compraram = 40%.
        </HelpTip>
      </div>
      {error && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Não deu para carregar agora. <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Tentar de novo</button>
        </p>
      )}
      {!error && !data && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Carregando...</p>}
      {data?.warning && (
        <div role="alert" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', marginBottom: 10, borderRadius: 'var(--radius-sm)', background: 'var(--warning-bg)', border: '1px solid var(--warning)', fontSize: 13 }}>
          <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
          O termômetro não está separando bem quem compra. Revise os pontos das opções.
        </div>
      )}
      {data && !bands.some(b => b.leads > 0) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Ainda sem dados. O quadro precisa de 30 dias de termômetro guardado. Ex.: se hoje 10 leads estão Quentes, daqui a 30 dias você vê quantos deles compraram.
        </p>
      )}
      {data && bands.some(b => b.leads > 0) && (
        <div style={{ display: 'grid', gap: 8 }}>
          {bands.map(b => {
            const meta = BAND_META[b.band]
            const Icon = meta.icon
            return (
              <div key={b.band} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) 1fr auto', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14} style={{ color: meta.color }} /> {meta.label}</span>
                <div style={{ height: 10, background: 'var(--bg-secondary)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: `${barWidth(b.rate)}%`, height: '100%', background: meta.color }} />
                </div>
                <span title={`${b.bought} de ${b.leads} leads ${meta.label} de 30 dias atrás compraram depois`} style={{ whiteSpace: 'nowrap' }}>
                  {fmtPct(b.rate)} <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>({b.bought} de {b.leads})</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: `src/pages/Dashboard.tsx`** — `import ConversionByBandCard from '../components/score/ConversionByBandCard'`; como última seção antes do `</div>` final do `return`:

```tsx
      {(user?.role === 'gerente' || user?.role === 'super_admin') && (
        <section className="dash-section">
          <ConversionByBandCard accountId={accountId} />
        </section>
      )}
```

(A rota `/dashboard` já é só de gestor em `App.tsx`; a condição protege se isso mudar.)

- [ ] **Step 7:** `node --test test/roteiroHttp.test.js` → PASS. `npx tsc --noEmit` → 16 erros (lista igual). `npx vite build` → ok (depois `git restore dist` e apagar asset novo). `npm test` → 949.
- [ ] **Step 8: Commit**

```bash
git add server/routes/roteiroRouter.js test/roteiroHttp.test.js src/lib/roteiroApi.ts src/components/score/ConversionByBandCard.tsx src/pages/Dashboard.tsx
git commit -m "feat(dashboard): taxa de venda por faixa do termometro sai da Qualificacao e vai para o Dashboard

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tela do gestor dentro de "Cadências e Follow-ups" (e a "Qualificação" sai)

**Files:**
- Create: `src/lib/cadenceApi.ts`, `src/lib/stageCadence.js`, `src/lib/stageCadence.d.ts`, `test/stageCadence.test.js`, `src/pages/cadencias/StageCadences.tsx`, `src/pages/cadencias/StepRow.tsx`, `src/pages/cadencias/StepPanel.tsx`, `src/pages/cadencias/StepInsights.tsx`, `src/pages/cadencias/StageDeviations.tsx`, `src/pages/cadencias/StageSettings.tsx`, `src/pages/cadencias/StageEmpty.tsx`
- Modify: `src/lib/api.ts` (`fetchCadences(accountId, kind?)`), `src/pages/Cadences.tsx` (prop `avulsasOnly`), `src/pages/CadencesAndFollowUps.tsx`, `src/lib/automationTabs.js` + `test/automationTabs.test.js` (`/qualifications` → manuais), `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/roteiro/RoteiroCard.tsx` (link do estado vazio)
- Delete: `src/pages/qualificacao/QualificacaoPage.tsx`, `RoteiroEditor.tsx`, `DesempenhoTab.tsx`, `SugestoesTab.tsx`

**Interfaces:**
- Consumes: rotas da Task 5; `fetchSuggestions`, `suggestionAction`, `variantAction`, `fetchRoteiroSettings`, `saveRoteiroSettings`, tipos `RoteiroQuestion`, `RoteiroDeviation`, `RoteiroSuggestion`, `RoteiroTest`, `SellerMetric`, `QState`, `ActiveDeviation`, `BantKey`, `RoteiroQuestionKind`, `RoteiroSettings` de `roteiroApi.ts`; `suggestionWhy`, `SUGGESTION_TITLES`, `testRemainingText`, `testResultText`, `fmtPct` de `roteiroManager.js`; `fetchFunnels` de `api.ts`; `HelpTip`, `ConfirmDialog({ title, children, confirmLabel, busyLabel, cancelLabel, danger, busy, onConfirm, onCancel })`; `automationUrl`, `AUTOMATION_PATH` de `automationTabs.js`; `useSSE(event, handler)` de `SSEContext`.
- Produces:
  - `src/lib/cadenceApi.ts`: tipos `StepType`, `CadenceStep`, `StageCadence`, `StageView`, `StageViewStage`, `QuestionInput`, `StepInput`, `StepPatch`, `StepSaveResult`, `StepMetric`, `LeadStep`, `LeadStageCadence`; funções `fetchStageView(funnelId, accountId)`, `createStageCadence(stageId, accountId)`, `addCadenceStep(cadenceId, accountId, input)`, `updateCadenceStep(cadenceId, stepId, accountId, patch)`, `deleteCadenceStep(cadenceId, stepId, accountId)`, `reorderCadenceSteps(cadenceId, accountId, attemptIds)`, `fetchStepMetrics(cadenceId, accountId)`, `saveStageDeviations(funnelId, accountId, deviations)`, `stageTemplate(funnelId, stageId, accountId, mode)`, `applySuggestionLive(id, accountId)`, `confirmVariantLive(id, accountId)`, `fetchLeadStageCadence(leadId, accountId)`, `markLeadStepDone(leadId, attemptId, accountId, how?)`
  - `src/lib/stageCadence.js` (puro, testado): `STEP_TYPES`, `stepLabel(type)`, `stageChipLabel(stage)`, `stepShortText(step, max?)`, `stepDayText(step)`, `metricBadge(metric)`, `metricWhy(metric, {windowH, minRate})`, `moveStep(ids, id, dir)`, `dropStep(ids, dragId, overId)`, `formFromStep(step)`, `stepPatchFor(type, form)`, `createSaveQueue(opts)`, `saveStatusLabel(status)`, `readyDeviations(list)`, `suggestionsForStep(suggestions, step)`, `stageSuggestions(suggestions, stageId)`, `deviationSuggestions(suggestions, funnelId)`, `testForStep(tests, step)`, `stageFromSearch(search, stages)`

- [ ] **Step 1: Testes que falham — `test/stageCadence.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stageChipLabel, stepShortText, stepDayText, metricBadge, metricWhy, moveStep, dropStep, formFromStep, stepPatchFor,
  createSaveQueue, saveStatusLabel, readyDeviations, suggestionsForStep, stageSuggestions, testForStep, stageFromSearch,
} from '../src/lib/stageCadence.js'

function fakeTimers() {
  let fn = null
  return { setTimer: f => { fn = f; return 1 }, clearTimer: () => { fn = null }, fire: () => { const f = fn; fn = null; return f ? f() : undefined } }
}
function deferred() {
  let resolve, reject
  const p = new Promise((r, j) => { resolve = r; reject = j })
  return { p, resolve, reject }
}
const tick = () => new Promise(r => setImmediate(r))

test('chip da etapa: passos e perguntas no singular e plural', () => {
  assert.equal(stageChipLabel({ name: 'Novo Lead', summary: { steps: 4, questions: 2 } }), 'Novo Lead · 4 passos · 2 perguntas')
  assert.equal(stageChipLabel({ name: 'Proposta', summary: { steps: 1, questions: 1 } }), 'Proposta · 1 passo · 1 pergunta')
  assert.equal(stageChipLabel({ name: 'Visita', summary: { steps: 3, questions: 0 } }), 'Visita · 3 passos')
  assert.equal(stageChipLabel({ name: 'Negociação', summary: { steps: 0, questions: 0 } }), 'Negociação · sem passos')
})

test('linha do passo: texto curto e dia', () => {
  assert.equal(stepShortText({ action_type: 'pergunta', question: { text: 'Para quando é o seu evento, {nome}?' }, description: 'x' }), 'Para quando é o seu evento, {nome}?')
  assert.equal(stepShortText({ action_type: 'mensagem', auto_message: 'Oi {nome}, segue o catálogo com todos os preços e fotos dos salões', description: null }, 30), 'Oi {nome}, segue o catálogo c…')
  assert.equal(stepShortText({ action_type: 'ligacao', description: null, instructions: null }), 'Ligação')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 0 }), 'mesmo dia')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 1 }), '+1 dia')
  assert.equal(stepDayText({ schedule_mode: 'date', delay_days: 3 }), '+3 dias')
  assert.equal(stepDayText({ schedule_mode: 'duration', delay_minutes: 90 }), '+1h30')
  assert.equal(stepDayText({ schedule_mode: 'duration', delay_minutes: 20 }), '+20 min')
})

test('selo da metrica e o porque', () => {
  assert.equal(metricBadge(null), null)
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 0, reply_rate: null, status: 'amostra_pequena' }), { text: 'sem envios ainda', tone: 'muted' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 8, reply_rate: 62.5, status: 'amostra_pequena' }), { text: 'respondem 63% · poucos envios', tone: 'muted' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 40, reply_rate: 45, status: 'fraca' }), { text: 'respondem 45% · fraca', tone: 'bad' })
  assert.deepEqual(metricBadge({ kind: 'resposta', sent: 40, reply_rate: 80, status: 'ok' }), { text: 'respondem 80%', tone: 'good' })
  assert.deepEqual(metricBadge({ kind: 'feitas', done: 12, reached: 30 }), { text: 'feitas 12 de 30 leads', tone: 'muted' })
  assert.equal(metricWhy({ kind: 'resposta', sent: 40, reply_rate: 45, status: 'fraca' }, { windowH: 24, minRate: 70 }),
    'De 40 envios nos últimos 90 dias, 45% tiveram resposta em até 24h. Abaixo de 70% conta como fraca.')
  assert.equal(metricWhy({ kind: 'feitas', done: 12, reached: 30 }, { windowH: 24, minRate: 70 }),
    'Dos 30 leads que entraram nesta cadência nos últimos 90 dias, 12 tiveram este passo marcado como feito.')
})

test('ordem: subir/descer e arrastar', () => {
  assert.deepEqual(moveStep([1, 2, 3], 2, -1), [2, 1, 3])
  assert.deepEqual(moveStep([1, 2, 3], 3, 1), [1, 2, 3])
  assert.deepEqual(dropStep([1, 2, 3, 4], 1, 3), [2, 3, 1, 4])
  assert.deepEqual(dropStep([1, 2, 3, 4], 4, 2), [1, 4, 2, 3])
  assert.deepEqual(dropStep([1, 2], 1, 1), [1, 2])
})

test('formulario da pergunta: valida antes de mandar e guarda option_key', () => {
  const step = { action_type: 'pergunta', delay_days: 0, question: { text: 'Para quando?', kind: 'options', required: true, bant: 'timeline', ai_hint: null,
    options: [{ option_key: 'a1', label: 'Até 30 dias', points: 15 }, { option_key: 'b2', label: 'Mais de 30 dias', points: 5 }] } }
  const form = formFromStep(step)
  const ok = stepPatchFor('pergunta', form)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.patch.question.options.map(o => [o.option_key, o.label, o.points]), [['a1', 'Até 30 dias', 15], ['b2', 'Mais de 30 dias', 5]])
  assert.deepEqual(stepPatchFor('pergunta', { ...form, text: '  ' }), { ok: false, reason: 'Escreva a pergunta.' })
  assert.deepEqual(stepPatchFor('pergunta', { ...form, options: [form.options[0], { label: '', points: '' }] }),
    { ok: false, reason: 'Coloque pelo menos 2 opções (ex.: "Até 30 dias" e "Mais de 30 dias").' })
  assert.deepEqual(stepPatchFor('pergunta', { ...form, options: [form.options[0], { ...form.options[1], points: '99' }] }),
    { ok: false, reason: 'Os pontos vão de -50 a 50 (ex.: 15).' })
  const livre = stepPatchFor('pergunta', { ...form, kind: 'text' })
  assert.deepEqual(livre.patch.question.options, [])
  const msg = stepPatchFor('mensagem', formFromStep({ action_type: 'mensagem', auto_message: 'Oi', delay_days: 2 }))
  assert.deepEqual(msg, { ok: true, patch: { auto_message: 'Oi', delay_days: 2 } })
  const lig = stepPatchFor('ligacao', { ...formFromStep({ action_type: 'ligacao', delay_days: 1 }), description: 'Ligar', call_script: '1) Oi' })
  assert.deepEqual(lig, { ok: true, patch: { description: 'Ligar', instructions: null, call_script: '1) Oi', delay_days: 1 } })
})

test('fila de salvamento: duas edicoes rapidas viram um envio so, com o texto final', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  const q = createSaveQueue({ save: p => { sent.push(p); return Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('a'); q.push('ab')
  await t.fire(); await tick()
  assert.deepEqual(sent, ['ab'])
  assert.equal(st[st.length - 1], 'salvo')
})

test('fila de salvamento: editar durante o envio nunca manda dois juntos e Salvo so vem no fim', async () => {
  const t = fakeTimers(); const sent = []; const st = []; const d1 = deferred()
  const q = createSaveQueue({ save: p => { sent.push(p); return sent.length === 1 ? d1.p : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('v1'); t.fire()
  q.push('v2'); t.fire()
  assert.deepEqual(sent, ['v1'])
  assert.ok(!st.includes('salvo'))
  assert.equal(q.busy(), true)
  d1.resolve(); await tick(); await tick()
  assert.deepEqual(sent, ['v1', 'v2'])
  assert.equal(st[st.length - 1], 'salvo')
  assert.equal(q.busy(), false)
})

test('fila de salvamento: erro guarda o ultimo texto e Tentar de novo reenvia', async () => {
  const t = fakeTimers(); const sent = []; const st = []
  let fail = true
  const q = createSaveQueue({ save: p => { sent.push(p); return fail ? Promise.reject(new Error('rede')) : Promise.resolve() }, onStatus: s => st.push(s), ...t })
  q.push('texto'); t.fire(); await tick(); await tick()
  assert.equal(st[st.length - 1], 'erro')
  fail = false
  await q.retry(); await tick()
  assert.deepEqual(sent, ['texto', 'texto'])
  assert.equal(st[st.length - 1], 'salvo')
  assert.deepEqual([saveStatusLabel('salvando'), saveStatusLabel('salvo'), saveStatusLabel('erro'), saveStatusLabel('idle')], ['Salvando…', 'Salvo', 'Não salvou.', ''])
})

test('desvios prontos, sugestoes por passo/etapa, teste A/B do passo e etapa pela URL', () => {
  assert.deepEqual(readyDeviations([{ triggers: 'preço', reply_text: 'Depende' }, { triggers: ' ', reply_text: 'x' }]).length, 1)
  const sug = [
    { id: 1, type: 'rewrite', question_key: 'k1', payload: {} },
    { id: 2, type: 'reorder', question_key: null, payload: { stage_id: 7 } },
    { id: 3, type: 'new_deviation', question_key: null, payload: {} },
    { id: 4, type: 'new_option', question_key: 'k2', payload: {} },
  ]
  assert.deepEqual(suggestionsForStep(sug, { question_key: 'k1' }).map(s => s.id), [1])
  assert.deepEqual(suggestionsForStep(sug, { question_key: null }), [])
  assert.deepEqual(stageSuggestions(sug, 7).map(s => s.id), [2])
  const tests = [{ id: 9, question_key: 'k1', status: 'won', decided: true }, { id: 10, question_key: 'k1', status: 'testing', decided: false }]
  assert.equal(testForStep(tests, { question_key: 'k1' }).id, 10)
  const stages = [{ id: 1, is_terminal: false }, { id: 2, is_terminal: false }, { id: 3, is_terminal: true }]
  assert.equal(stageFromSearch('?aba=manuais&etapa=2', stages), 2)
  assert.equal(stageFromSearch('?etapa=3', stages), 1)
  assert.equal(stageFromSearch('', stages), 1)
})
```

- [ ] **Step 2:** `node --test test/stageCadence.test.js` → FAIL.

- [ ] **Step 3: `src/lib/stageCadence.js`**

```js
// Logica pura da tela "Cadencia da etapa" (spec 2026-09-27 §5.1). JS puro com .d.ts ao lado:
// roda no node --test e e importado pelo front.

export const STEP_TYPES = [
  { value: 'pergunta', label: 'Pergunta' }, { value: 'mensagem', label: 'Mensagem' }, { value: 'ligacao', label: 'Ligação' },
  { value: 'visita', label: 'Visita' }, { value: 'reuniao', label: 'Reunião' }, { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
]
const LABELS = Object.fromEntries(STEP_TYPES.map(t => [t.value, t.label]))
export const stepLabel = type => LABELS[type] || type

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function stageChipLabel(stage) {
  const { steps, questions } = stage.summary || { steps: 0, questions: 0 }
  if (!steps) return `${stage.name} · sem passos`
  return [stage.name, plural(steps, 'passo', 'passos'), questions ? plural(questions, 'pergunta', 'perguntas') : null].filter(Boolean).join(' · ')
}

function cut(text, max) {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function stepShortText(step, max = 60) {
  let text = ''
  if (step.action_type === 'pergunta') text = (step.question && step.question.text) || step.description
  else if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') text = step.auto_message || step.description
  else text = step.description || step.instructions
  return cut(text || stepLabel(step.action_type), max)
}

export function stepDayText(step) {
  if (step.schedule_mode === 'duration') {
    const m = step.delay_minutes || 0
    if (m < 60) return `+${m} min`
    const h = Math.floor(m / 60)
    const rest = m % 60
    return rest ? `+${h}h${String(rest).padStart(2, '0')}` : `+${h}h`
  }
  const d = step.delay_days || 0
  if (!d) return 'mesmo dia'
  return d === 1 ? '+1 dia' : `+${d} dias`
}

export function metricBadge(m) {
  if (!m) return null
  if (m.kind === 'feitas') return { text: `feitas ${m.done} de ${m.reached} leads`, tone: 'muted' }
  if (!m.sent) return { text: 'sem envios ainda', tone: 'muted' }
  const rate = `respondem ${Math.round(m.reply_rate || 0)}%`
  if (m.status === 'amostra_pequena') return { text: `${rate} · poucos envios`, tone: 'muted' }
  if (m.status === 'fraca') return { text: `${rate} · fraca`, tone: 'bad' }
  return { text: rate, tone: 'good' }
}

export function metricWhy(m, { windowH, minRate }) {
  if (!m) return ''
  if (m.kind === 'feitas') return `Dos ${m.reached} leads que entraram nesta cadência nos últimos 90 dias, ${m.done} tiveram este passo marcado como feito.`
  if (!m.sent) return 'Ainda ninguém enviou este passo pelo botão do Chat nos últimos 90 dias.'
  const base = `De ${m.sent} envios nos últimos 90 dias, ${Math.round(m.reply_rate || 0)}% tiveram resposta em até ${windowH}h.`
  if (m.status === 'amostra_pequena') return `${base} Com menos de 20 envios ainda é cedo para julgar.`
  return `${base} Abaixo de ${minRate}% conta como fraca.`
}

export function moveStep(ids, id, dir) {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids.slice()
  const out = ids.slice()
  out[i] = ids[j]
  out[j] = id
  return out
}

export function dropStep(ids, dragId, overId) {
  if (dragId === overId) return ids.slice()
  const out = ids.filter(x => x !== dragId)
  const at = out.indexOf(overId)
  if (at < 0) return ids.slice()
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(overId)
  out.splice(from < to ? at + 1 : at, 0, dragId)
  return out
}

export function formFromStep(step) {
  const q = step.question || null
  return {
    text: q ? q.text : '',
    required: q ? !!q.required : false,
    kind: q ? q.kind : 'text',
    options: q ? q.options.map(o => ({ option_key: o.option_key, label: o.label, points: String(o.points) })) : [],
    bant: q ? q.bant : null,
    ai_hint: q && q.ai_hint ? q.ai_hint : '',
    auto_message: step.auto_message || '',
    description: step.description || '',
    instructions: step.instructions || '',
    call_script: step.call_script || '',
    delay_days: step.delay_days || 0,
  }
}

const orNull = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Monta o PATCH do passo; pergunta so vai quando esta valida (senao o servidor recusaria
// e o gestor veria "Nao salvou" a cada tecla).
export function stepPatchFor(type, form) {
  const delay = Math.max(0, parseInt(form.delay_days, 10) || 0)
  if (type === 'pergunta') {
    const text = String(form.text || '').trim()
    if (!text) return { ok: false, reason: 'Escreva a pergunta.' }
    let options = []
    if (form.kind === 'options') {
      const filled = form.options.filter(o => String(o.label || '').trim())
      if (filled.length < 2) return { ok: false, reason: 'Coloque pelo menos 2 opções (ex.: "Até 30 dias" e "Mais de 30 dias").' }
      if (filled.length > 10) return { ok: false, reason: 'No máximo 10 opções.' }
      options = []
      for (let i = 0; i < filled.length; i++) {
        const o = filled[i]
        const points = Number(String(o.points).trim() === '' ? 0 : o.points)
        if (!Number.isInteger(points) || points < -50 || points > 50) return { ok: false, reason: 'Os pontos vão de -50 a 50 (ex.: 15).' }
        options.push({ ...(o.option_key ? { option_key: o.option_key } : {}), label: o.label.trim(), points, position: i })
      }
    }
    return {
      ok: true,
      patch: { delay_days: delay, question: { text, kind: form.kind, required: !!form.required, bant: form.bant || null, ai_hint: orNull(form.ai_hint), options } },
    }
  }
  if (type === 'mensagem' || type === 'whatsapp') return { ok: true, patch: { auto_message: orNull(form.auto_message), delay_days: delay } }
  return { ok: true, patch: { description: orNull(form.description), instructions: orNull(form.instructions), call_script: orNull(form.call_script), delay_days: delay } }
}

// Salvar automatico (spec 4.3): manda 500 ms depois da ultima mudanca; nunca dois envios ao
// mesmo tempo; o ultimo texto vence; erro guarda o texto para [Tentar de novo].
export function createSaveQueue({ save, delayMs = 500, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let latest
  let hasLatest = false
  let inFlight = false
  let lastFailed
  let hasFailed = false
  const status = s => { try { onStatus(s) } catch { /* tela ja saiu */ } }

  function run() {
    timer = null
    if (!hasLatest || inFlight) return Promise.resolve()
    const payload = latest
    hasLatest = false
    inFlight = true
    status('salvando')
    // save chamado na hora (sincrono): o proximo push ja ve o envio no ar
    let pending
    try { pending = Promise.resolve(save(payload)) } catch (e) { pending = Promise.reject(e) }
    return pending.then(
      () => { inFlight = false; hasFailed = false; if (hasLatest) return run(); status('salvo') },
      () => { inFlight = false; if (hasLatest) return run(); lastFailed = payload; hasFailed = true; status('erro') },
    )
  }
  function push(payload) {
    latest = payload
    hasLatest = true
    hasFailed = false
    status('pendente')
    if (timer) clearTimer(timer)
    timer = setTimer(run, delayMs)
  }
  function flush() {
    if (timer) { clearTimer(timer); timer = null }
    return run()
  }
  function retry() {
    if (hasFailed && !hasLatest) { latest = lastFailed; hasLatest = true; hasFailed = false }
    return flush()
  }
  const busy = () => inFlight || hasLatest
  return { push, flush, retry, busy }
}

export function saveStatusLabel(status) {
  if (status === 'salvando') return 'Salvando…'
  if (status === 'salvo') return 'Salvo'
  if (status === 'erro') return 'Não salvou.'
  return ''
}

export const readyDeviations = list => (list || []).filter(d => String(d.triggers || '').trim() && String(d.reply_text || '').trim())

export function suggestionsForStep(suggestions, step) {
  if (!step || !step.question_key) return []
  return (suggestions || []).filter(s => s.question_key === step.question_key && s.type !== 'reorder' && s.type !== 'new_deviation')
}
export const stageSuggestions = (suggestions, stageId) => (suggestions || []).filter(s => s.type === 'reorder' && s.payload && Number(s.payload.stage_id) === Number(stageId))
export const deviationSuggestions = (suggestions, funnelId) => (suggestions || []).filter(s => s.type === 'new_deviation' && (s.funnel_id == null || Number(s.funnel_id) === Number(funnelId)))
export function testForStep(tests, step) {
  if (!step || !step.question_key) return null
  return (tests || []).find(t => t.question_key === step.question_key && (t.status === 'testing' || !t.decided)) || null
}

export function stageFromSearch(search, stages) {
  const want = Number(new URLSearchParams(search || '').get('etapa'))
  const open = (stages || []).filter(s => !s.is_terminal)
  const hit = open.find(s => s.id === want)
  return hit ? hit.id : (open[0] ? open[0].id : null)
}
```

- [ ] **Step 4: `src/lib/stageCadence.d.ts`**

```ts
import type { CadenceStep, StepMetric, StepPatch, StepType, StageViewStage } from './cadenceApi'
import type { RoteiroSuggestion, RoteiroTest } from './roteiroApi'

export const STEP_TYPES: { value: StepType; label: string }[]
export function stepLabel(type: string): string
export function stageChipLabel(stage: Pick<StageViewStage, 'name' | 'summary'>): string
export function stepShortText(step: Partial<CadenceStep> & { action_type: string }, max?: number): string
export function stepDayText(step: { schedule_mode?: string; delay_days?: number; delay_minutes?: number }): string
export function metricBadge(m: StepMetric | null | undefined): { text: string; tone: 'good' | 'bad' | 'muted' } | null
export function metricWhy(m: StepMetric | null | undefined, opts: { windowH: number; minRate: number }): string
export function moveStep(ids: number[], id: number, dir: -1 | 1): number[]
export function dropStep(ids: number[], dragId: number, overId: number): number[]
export interface OptionForm { option_key?: string; label: string; points: string }
export interface StepForm {
  text: string; required: boolean; kind: 'text' | 'options'; options: OptionForm[]; bant: string | null; ai_hint: string
  auto_message: string; description: string; instructions: string; call_script: string; delay_days: number | string
}
export function formFromStep(step: Partial<CadenceStep>): StepForm
export function stepPatchFor(type: StepType, form: StepForm): { ok: true; patch: StepPatch } | { ok: false; reason: string }
export type SaveStatus = 'idle' | 'pendente' | 'salvando' | 'salvo' | 'erro'
export interface SaveQueue<P> { push(payload: P): void; flush(): Promise<void>; retry(): Promise<void>; busy(): boolean }
export function createSaveQueue<P>(opts: {
  save: (payload: P) => Promise<unknown>; delayMs?: number; onStatus?: (s: SaveStatus) => void
  setTimer?: (fn: () => void, ms: number) => any; clearTimer?: (t: any) => void
}): SaveQueue<P>
export function saveStatusLabel(status: SaveStatus): string
export function readyDeviations<D extends { triggers: string; reply_text: string }>(list: D[] | null | undefined): D[]
export function suggestionsForStep(suggestions: RoteiroSuggestion[], step: { question_key: string | null } | null): RoteiroSuggestion[]
export function stageSuggestions(suggestions: RoteiroSuggestion[], stageId: number): RoteiroSuggestion[]
export function deviationSuggestions(suggestions: RoteiroSuggestion[], funnelId: number): RoteiroSuggestion[]
export function testForStep(tests: RoteiroTest[], step: { question_key: string | null } | null): RoteiroTest | null
export function stageFromSearch(search: string, stages: { id: number; is_terminal: boolean }[]): number | null
```

- [ ] **Step 5:** `node --test test/stageCadence.test.js` → PASS (9).

- [ ] **Step 6: `src/lib/cadenceApi.ts`**

```ts
// Chamadas de /api/cadences (cadencia da etapa e avulsas). Todas levam ?account_id=.
// Formatos conferidos em server/routes/cadencesRouter.js e server/services/cadence/*.
import { apiFetch } from './api'
import type { RoteiroQuestion, RoteiroDeviation, QState, ActiveDeviation, BantKey, RoteiroQuestionKind, SellerMetric } from './roteiroApi'

export type StepType = 'pergunta' | 'mensagem' | 'ligacao' | 'email' | 'reuniao' | 'whatsapp' | 'visita'

export interface CadenceStep {
  id: number; cadence_id: number; position: number; action_type: StepType
  description: string | null; instructions: string | null; auto_message: string | null; call_script: string | null
  scheduled_time: string | null; delay_days: number; delay_minutes: number; schedule_mode: 'date' | 'duration'
  question_key: string | null; question: RoteiroQuestion | null
}
export interface StageCadence {
  id: number; account_id: number; name: string; description: string | null; is_active: number
  funnel_id: number | null; stage_id: number | null; attempts: CadenceStep[]
}
export interface StageViewStage {
  id: number; name: string; position: number; is_terminal: boolean; cadence: StageCadence | null
  summary: { steps: number; questions: number }; followups: { id: number; name: string }[]
}
export interface StageView {
  funnel: { id: number; name: string }; stages: StageViewStage[]; deviations: RoteiroDeviation[]
  questions: { question_key: string; text: string; stage_id: number }[]
}
export interface QuestionInput {
  text: string; kind: RoteiroQuestionKind; required: boolean; bant: BantKey | null; ai_hint: string | null
  options: { option_key?: string; label: string; points: number; position?: number }[]
}
export interface StepInput {
  action_type: StepType; description?: string | null; instructions?: string | null; auto_message?: string | null
  call_script?: string | null; delay_days?: number; position?: number; question?: QuestionInput
}
export type StepPatch = Partial<Omit<StepInput, 'position'>>
export interface StepSaveResult { cadence: StageCadence; step_id: number; published: boolean }
export type StepMetric =
  | { attempt_id: number; kind: 'resposta'; sent: number; reply_rate: number | null; advanced_rate: number | null; bought_rate: number | null; status: 'ok' | 'fraca' | 'amostra_pequena'; by_seller: SellerMetric[] }
  | { attempt_id: number; kind: 'feitas'; done: number; reached: number }

export interface LeadStep {
  attempt_id: number; position: number; action_type: StepType; description: string | null; instructions: string | null
  auto_message: string | null; call_script: string | null; delay_days: number; question_key: string | null
  state: 'feito' | 'aguardando' | 'pendente'; how: 'respondida' | 'enviado' | 'feito' | 'pulado' | null
  done_at: string | null; done_by_name: string | null; question: QState | null
}
export interface LeadStageCadence {
  lead_id: number; stage: { id: number; name: string } | null
  lead_cadence: { id: number; cadence_id: number; cadence_name: string | null; status: 'active' | 'completed' | 'paused'; started_at: string } | null
  steps: LeadStep[]; next_attempt_id: number | null; done_count: number; total: number
  deviation: ActiveDeviation | null; can_force: boolean
}

const acc = (accountId: number) => `account_id=${accountId}`
const post = (body?: unknown): RequestInit => ({ method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const fetchStageView = (funnelId: number, accountId: number) =>
  apiFetch<StageView>(`/api/cadences/stage-view?funnel_id=${funnelId}&${acc(accountId)}`)
export const createStageCadence = (stageId: number, accountId: number) =>
  apiFetch<{ cadence: StageCadence }>(`/api/cadences?${acc(accountId)}`, post({ stage_id: stageId })).then(d => d.cadence)
export const addCadenceStep = (cadenceId: number, accountId: number, input: StepInput) =>
  apiFetch<StepSaveResult>(`/api/cadences/${cadenceId}/steps?${acc(accountId)}`, post(input))
export const updateCadenceStep = (cadenceId: number, stepId: number, accountId: number, patch: StepPatch) =>
  apiFetch<StepSaveResult>(`/api/cadences/${cadenceId}/steps/${stepId}?${acc(accountId)}`, { method: 'PATCH', body: JSON.stringify(patch) })
export const deleteCadenceStep = (cadenceId: number, stepId: number, accountId: number) =>
  apiFetch<{ cadence: StageCadence; published: boolean }>(`/api/cadences/${cadenceId}/steps/${stepId}?${acc(accountId)}`, { method: 'DELETE' })
export const reorderCadenceSteps = (cadenceId: number, accountId: number, attemptIds: number[]) =>
  apiFetch<{ cadence: StageCadence; published: boolean }>(`/api/cadences/${cadenceId}/steps/order?${acc(accountId)}`, { method: 'PUT', body: JSON.stringify({ attempt_ids: attemptIds }) })
export const fetchStepMetrics = (cadenceId: number, accountId: number) =>
  apiFetch<{ steps: StepMetric[] }>(`/api/cadences/${cadenceId}/metrics?${acc(accountId)}`).then(d => d.steps)
export const saveStageDeviations = (funnelId: number, accountId: number, deviations: RoteiroDeviation[]) =>
  apiFetch<{ deviations: RoteiroDeviation[]; published: boolean }>(`/api/cadences/funnels/${funnelId}/deviations?${acc(accountId)}`, { method: 'PUT', body: JSON.stringify({ deviations }) })
export const stageTemplate = (funnelId: number, stageId: number, accountId: number, mode: 'bant' | 'ia') =>
  apiFetch<{ cadence: StageCadence }>(`/api/cadences/funnels/${funnelId}/stages/${stageId}/template?${acc(accountId)}`, post({ mode })).then(d => d.cadence)
export const applySuggestionLive = (id: number, accountId: number) =>
  apiFetch<{ published: true; funnel_id: number; cadence_ids: number[] }>(`/api/cadences/suggestions/${id}/apply?${acc(accountId)}`, post())
export const confirmVariantLive = (id: number, accountId: number) =>
  apiFetch<{ published: boolean; cadence_ids: number[] }>(`/api/cadences/variants/${id}/confirm?${acc(accountId)}`, post())
export const fetchLeadStageCadence = (leadId: number, accountId: number) =>
  apiFetch<LeadStageCadence>(`/api/cadences/lead/${leadId}/stage?${acc(accountId)}`)
export const markLeadStepDone = (leadId: number, attemptId: number, accountId: number, how: 'feito' | 'pulado' = 'feito') =>
  apiFetch<LeadStageCadence>(`/api/cadences/lead/${leadId}/steps/${attemptId}/done?${acc(accountId)}`, post({ how }))
```

- [ ] **Step 7: `src/lib/api.ts`** — `fetchCadences` ganha o filtro:

```ts
export const fetchCadences = (accountId: number, kind?: 'avulsa' | 'etapa') => apiFetch<{ cadences: Cadence[] }>(`/api/cadences?account_id=${accountId}${kind ? `&kind=${kind}` : ''}`).then(d => d.cadences)
```

e `Cadence` ganha `stage_id?: number | null; funnel_id?: number | null`.

- [ ] **Step 8: `src/pages/cadencias/StepRow.tsx`** — uma linha por passo.

```tsx
import { ArrowDown, ArrowUp, Lock, MessageCircle, Phone, Mail, Video, MapPin, HelpCircle, type LucideIcon } from 'lucide-react'
import type { CadenceStep, StepMetric } from '../../lib/cadenceApi'
import { stepLabel, stepShortText, stepDayText, metricBadge, metricWhy } from '../../lib/stageCadence.js'

export const STEP_ICONS: Record<string, LucideIcon> = { pergunta: HelpCircle, mensagem: MessageCircle, whatsapp: MessageCircle, ligacao: Phone, email: Mail, reuniao: Video, visita: MapPin }
const TONE = { good: 'var(--positive)', bad: 'var(--negative)', muted: 'var(--text-muted)' } as const

interface Props {
  step: CadenceStep; index: number; metric: StepMetric | undefined; windowH: number; minRate: number
  selected: boolean; first: boolean; last: boolean
  onSelect: () => void; onMove: (dir: -1 | 1) => void
  onDragStart: () => void; onDropHere: () => void
}

export default function StepRow({ step, index, metric, windowH, minRate, selected, first, last, onSelect, onMove, onDragStart, onDropHere }: Props) {
  const Icon = STEP_ICONS[step.action_type] || MessageCircle
  const badge = metricBadge(metric)
  return (
    <div
      role="button" tabIndex={0} draggable
      onDragStart={onDragStart} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onDropHere() }}
      onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect() }}
      style={{ display: 'grid', gridTemplateColumns: '24px 110px 1fr auto auto auto', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
        background: selected ? 'var(--bg-hover)' : 'transparent', border: `1px solid ${selected ? 'var(--border-accent)' : 'var(--border-subtle)'}`, fontSize: 13 }}
    >
      <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{index + 1}.</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14} /> {stepLabel(step.action_type)}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {stepShortText(step)}
        {step.action_type === 'pergunta' && step.question?.required && (
          <span title="Obrigatória: trava a mudança de etapa até ter resposta" style={{ marginLeft: 6, fontSize: 11, color: 'var(--negative)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Lock size={11} /> obrigatória
          </span>
        )}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{stepDayText(step)}</span>
      <span title={metricWhy(metric, { windowH, minRate })} style={{ fontSize: 11, whiteSpace: 'nowrap', color: badge ? TONE[badge.tone] : 'var(--text-muted)' }}>{badge?.text || ''}</span>
      <span style={{ display: 'inline-flex', gap: 2 }} onClick={e => e.stopPropagation()}>
        <button type="button" className="btn btn-secondary btn-sm" disabled={first} aria-label="Subir passo" onClick={() => onMove(-1)}><ArrowUp size={12} /></button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={last} aria-label="Descer passo" onClick={() => onMove(1)}><ArrowDown size={12} /></button>
      </span>
    </div>
  )
}
```

- [ ] **Step 9: `src/pages/cadencias/StepPanel.tsx`** — painel do passo com salvar automático. Props:

```ts
interface Props {
  accountId: number
  stageId: number
  cadenceId: number | null          // null = etapa sem cadencia ainda (cria no 1o salvamento)
  step: CadenceStep | { id: null; action_type: StepType; position: number } // id null = passo novo
  onSaved: (r: StepSaveResult) => void // devolve a cadencia inteira atualizada
  onCreatedCadence: (cadenceId: number) => void
  onDeleted: (cadence: StageCadence) => void
  children?: ReactNode              // StepInsights embaixo
}
```

Código central (o resto é JSX de campos com os textos abaixo):

```tsx
  const [form, setForm] = useState<StepForm>(() => formFromStep(step as any))
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [hint, setHint] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const stepIdRef = useRef<number | null>(step.id)
  const cadenceIdRef = useRef<number | null>(cadenceId)
  const queueRef = useRef<SaveQueue<StepPatch> | null>(null)

  // Fila por passo: troca de passo (id) recria; texto so reinicia quando o passo muda.
  useEffect(() => {
    stepIdRef.current = step.id
    setForm(formFromStep(step as any))
    setStatus('idle'); setHint(null)
    const q = createSaveQueue<StepPatch>({
      onStatus: setStatus,
      save: async patch => {
        if (cadenceIdRef.current == null) {
          const cad = await createStageCadence(stageId, accountId)
          cadenceIdRef.current = cad.id
          onCreatedCadence(cad.id)
        }
        if (stepIdRef.current == null) {
          const r = await addCadenceStep(cadenceIdRef.current, accountId, { action_type: step.action_type, position: step.position, ...patch })
          stepIdRef.current = r.step_id
          onSaved(r)
        } else {
          onSaved(await updateCadenceStep(cadenceIdRef.current, stepIdRef.current, accountId, patch))
        }
      },
    })
    queueRef.current = q
    return () => { q.flush() } // saiu do passo com mudanca pendente: manda na hora
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id ?? `novo-${step.position}-${step.action_type}`])

  const change = (patch: Partial<StepForm>) => {
    const next = { ...form, ...patch }
    setForm(next)
    const built = stepPatchFor(step.action_type, next)
    if (!built.ok) { setHint(built.reason); return }
    setHint(null)
    queueRef.current?.push(built.patch)
  }
```

Status (no topo do painel, à direita): `status === 'salvando'` → texto `saveStatusLabel('salvando')`; `'salvo'` → `<Check size={12} /> Salvo`; `'erro'` → `Não salvou.` + botão **"Tentar de novo"** (`queueRef.current?.retry()`), e o texto digitado continua no campo. `hint` aparece embaixo do campo em `var(--warning)`.

Campos e textos (verbatim):
- **Pergunta**: rótulo "Pergunta"; textarea placeholder `ex.: Para quando é o seu evento, {nome}?`; chave "Obrigatória (trava a etapa)" + HelpTip "Com a chave ligada, o lead só passa para a próxima etapa quando esta pergunta tiver resposta. Ex.: sem saber a data do evento, não dá para mandar proposta."; "Respostas" com rádios "Livre" / "Opções" + HelpTip "Com opções, cada resposta soma pontos no termômetro (Perfil). Ex.: \"Até 30 dias\" = 15 pontos, \"Mais de 3 meses\" = 0."; cada opção: nome (placeholder `ex.: Até 30 dias`) + pontos (placeholder `ex.: 15`) + botão X (aria-label "Tirar opção"); botão "+ Opção" (ícone `Plus`); ao escolher "Opções" com lista vazia, entram 2 linhas vazias. "Mais opções" (recolhido, `ChevronDown`/`ChevronUp`): "Dica para a IA" placeholder `ex.: procure a data do evento na conversa, mesmo escrita por extenso`; "BANT" select Nenhum/Orçamento/Quem decide/Necessidade/Prazo (`null`/`budget`/`authority`/`need`/`timeline`) + HelpTip "Marque qual das 4 perguntas clássicas de venda esta pergunta cobre. Ex.: \"Para quando você precisa?\" = Prazo.".
- **Mensagem / WhatsApp**: "Mensagem" textarea placeholder `ex.: Oi {nome}, segue o catálogo com os preços`.
- **Ligação / Visita / Reunião / E-mail**: "Descrição" placeholder `ex.: Ligar para apresentar a proposta`; "Instruções" placeholder `ex.: pergunte se a data ainda está de pé`; só em ligação: "Roteiro da ligação" placeholder `ex.: 1) Cumprimente 2) Confirme a data 3) Ofereça a visita`.
- **Todos**: "Dia" (número ≥ 0) placeholder `ex.: 0` + HelpTip "Quantos dias depois de entrar na etapa este passo vira tarefa. Ex.: 0 = no mesmo dia, 2 = dois dias depois.".
- Botão "Apagar passo" (`Trash2`, só com `step.id`) → `ConfirmDialog` título "Apagar este passo?", `danger`, confirmLabel "Apagar"; corpo para pergunta: "As respostas que os clientes já deram ficam guardadas na ficha do lead. Se esta pergunta estiver em teste A/B, o teste é cancelado."; para os outros: "O passo sai da cadência de todos os leads desta etapa.". Confirmar: `await queueRef.current?.flush()` e depois `deleteCadenceStep(...)` → `onDeleted(r.cadence)`.

- [ ] **Step 10: `src/pages/cadencias/StepInsights.tsx`** — métrica, sugestões e teste A/B no próprio passo.

```ts
interface Props {
  accountId: number; step: CadenceStep; metric: StepMetric | undefined; windowH: number; minRate: number
  suggestions: RoteiroSuggestion[]   // ja filtradas por suggestionsForStep
  test: RoteiroTest | null           // testForStep
  onChanged: () => void              // recarrega visao + sugestoes
}
```

Conteúdo:
- Título "Como este passo está indo" + HelpTip "Resposta = o cliente respondeu em até {windowH}h depois do envio. Ex.: 45% quer dizer que de cada 20 clientes, 9 responderam." (troque `{windowH}` pelo número). Linha com `metricBadge` + `metricWhy`. Se `metric.kind === 'resposta'` e `by_seller.length`: até 3 linhas `"<nome>: <fmtPct(rate)> em <sent> envios"`.
- Cada sugestão: título `SUGGESTION_TITLES[s.type]`, frase `suggestionWhy(s)`, texto proposto (`s.payload.text` ou `s.payload.versions?.[0]` ou `s.payload.label`), botões **[Testar A/B]** (só `rewrite`/`seller_phrasing`; `suggestionAction(s.id, accountId, 'test')`), **[Aplicar]** (`applySuggestionLive(s.id, accountId)`), **[Ignorar]** (`suggestionAction(s.id, accountId, 'reject')`); depois de cada um, `onChanged()`. Erro do servidor aparece embaixo do cartão.
- Teste A/B: `test.status === 'testing'` → "Testando a versão B: \"<test.text>\"" + `testResultText(test)` + `testRemainingText(test)`; `won`/`lost` sem decisão → `testResultText(test)` + **[Usar a vencedora]** (só `won`; `confirmVariantLive`) + **[Manter a atual]** (`variantAction(test.id, accountId, 'keep')`).
- Sem métrica e sem sugestão: "Ainda sem números. Eles aparecem quando os vendedores usarem os botões do Chat. Ex.: 20 envios desta pergunta já mostram a taxa de resposta."

- [ ] **Step 11: `src/pages/cadencias/StageDeviations.tsx`** — desvios do funil, recolhido.

```ts
interface Props {
  accountId: number; funnelId: number; deviations: RoteiroDeviation[]
  questions: { question_key: string; text: string; stage_id: number }[]
  suggestions: RoteiroSuggestion[]   // deviationSuggestions
  onSaved: (deviations: RoteiroDeviation[]) => void; onChanged: () => void
}
```

- Cabeçalho clicável "Se o cliente perguntar…" (`ChevronDown`/`ChevronUp`) + contador "(N)" + HelpTip "Respostas prontas para quando o cliente sai do roteiro. Ex.: se ele perguntar \"quanto custa?\", o vendedor vê a sugestão \"Depende do número de convidados; me conta quantos são?\" e volta para a pergunta do roteiro.".
- Lista local (estado); cada item: "Palavras que o cliente usa" placeholder `ex.: preço, valor, quanto custa`; "Resposta sugerida" placeholder `ex.: Depende do número de convidados. Quantos são?`; "Depois volte para" select "Nenhuma" + perguntas; X "Tirar desvio". Item incompleto mostra "Incompleto: preencha as palavras e a resposta para salvar.". "+ Desvio".
- Salvar automático com `createSaveQueue` (uma fila para a lista): a cada mudança, `push(readyDeviations(lista))` → `saveStageDeviations(funnelId, accountId, lista)` → `onSaved(r.deviations)`; mesmo indicador de status do StepPanel.
- Sugestão `new_deviation`: aviso "A IA sugere um desvio novo:" + gatilhos/resposta + [Aplicar] (`applySuggestionLive`) [Ignorar] (`suggestionAction(..., 'reject')`), depois `onChanged()`.
- Vazio: "Nenhum desvio ainda. Ex.: quando o cliente perguntar de preço, sugerir \"Depende do número de convidados\" e voltar para a pergunta do orçamento."

- [ ] **Step 12: `src/pages/cadencias/StageSettings.tsx`** — popover do ícone `Settings`.

```ts
interface Props { accountId: number; onClose: () => void; onSaved: (s: RoteiroSettings) => void }
```

Carrega `fetchRoteiroSettings`; 3 campos numéricos, salvos juntos por **[Salvar]** (`saveRoteiroSettings`; mostra o erro 400 do servidor):
- "Resposta mínima (%)" placeholder `ex.: 70` + HelpTip "Abaixo disso o passo aparece como \"fraca\". Ex.: 70% = de cada 10 clientes que recebem a pergunta, pelo menos 7 respondem."
- "Prazo para responder (horas)" placeholder `ex.: 24` + HelpTip "Resposta depois disso não conta na taxa. Ex.: 24h = o cliente respondeu até o dia seguinte."
- "Aviso de lead quente (minutos)" placeholder `ex.: 60` + HelpTip "Lead quente sem resposta do vendedor por mais que isso gera aviso. Ex.: 60 = avisa depois de 1 hora sem resposta."
- Botões "Salvar" e "Fechar". Fecha com Esc e clique fora.

- [ ] **Step 13: `src/pages/cadencias/StageEmpty.tsx`**

```ts
interface Props {
  accountId: number; funnelId: number; stage: StageViewStage
  onCadence: (cadence: StageCadence) => void   // modelo/IA criaram os passos
  onAddStep: (type: StepType) => void          // abre o painel de passo novo
}
```

- Texto: "Esta etapa ainda não tem passos." e "Exemplo: 1º Pergunta \"Para quando é o seu evento, {nome}?\" · 2º Mensagem \"Segue o catálogo\" · 3º Ligação no dia 2."
- **[Começar com modelo]** → `stageTemplate(funnelId, stage.id, accountId, 'bant')` + HelpTip "Coloca as 4 perguntas clássicas de venda: necessidade, orçamento, quem decide e prazo (só as que o funil ainda não tem)."
- **[Montar com IA]** (ícone `Sparkles`) → `stageTemplate(..., 'ia')`; se a mensagem de erro for "A IA não está ligada nesta conta.", o botão fica desligado com title "Ligue a IA em Integrações > IA" e aparece a mesma frase embaixo; outro erro aparece como veio.
- **[+ Passo]** abre o menu de tipos (mesmo menu do cabeçalho).

- [ ] **Step 14: `src/pages/cadencias/StageCadences.tsx`** — a tela.

Estado e carga:

```tsx
export default function StageCadences() {
  const { accountId } = useAccount()
  const location = useLocation()
  const navigate = useNavigate()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [funnelId, setFunnelId] = useState<number | null>(null)
  const [view, setView] = useState<StageView | null>(null)
  const [stageId, setStageId] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | 'novo' | null>(null)
  const [newStep, setNewStep] = useState<{ action_type: StepType; position: number } | null>(null)
  const [metrics, setMetrics] = useState<StepMetric[]>([])
  const [sugs, setSugs] = useState<RoteiroSuggestions>({ suggestions: [], tests: [] })
  const [settings, setSettings] = useState<RoteiroSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dragRef = useRef<number | null>(null)

  useEffect(() => {
    if (!accountId) return
    fetchFunnels(accountId).then(fs => {
      const active = fs.filter(f => f.is_active)
      setFunnels(active)
      setFunnelId((active.find(f => f.is_default) || active[0])?.id ?? null)
    })
    fetchRoteiroSettings(accountId).then(setSettings).catch(() => {})
  }, [accountId])

  const loadView = useCallback(() => {
    if (!accountId || !funnelId) return
    fetchStageView(funnelId, accountId).then(v => {
      setView(v)
      setStageId(prev => prev && v.stages.some(s => s.id === prev && !s.is_terminal) ? prev : stageFromSearch(location.search, v.stages))
    }).catch(e => setError(e.message))
    fetchSuggestions(accountId).then(setSugs).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, funnelId])
  useEffect(() => { loadView() }, [loadView])
  // Outro gestor mexeu: recarrega a lista (o painel aberto guarda o texto local pelo id do passo)
  useSSE('cadence:updated', useCallback(() => loadView(), [loadView]))

  const stage = view?.stages.find(s => s.id === stageId) || null
  const cadence = stage?.cadence || null
  useEffect(() => {
    if (!cadence || !accountId) { setMetrics([]); return }
    fetchStepMetrics(cadence.id, accountId).then(setMetrics).catch(() => setMetrics([]))
  }, [cadence?.id, accountId])

  // Salvou um passo: troca so a cadencia desta etapa (sem recarregar tudo)
  const putCadence = (c: StageCadence) => setView(v => v && ({
    ...v,
    stages: v.stages.map(s => s.id === c.stage_id ? { ...s, cadence: c, summary: { steps: c.attempts.length, questions: c.attempts.filter(a => a.action_type === 'pergunta').length } } : s),
  }))
```

Ações:
- Escolher etapa: `setStageId(id)`, `setSelected(null)`, `navigate(\`${AUTOMATION_PATH}?aba=manuais&etapa=${id}\`, { replace: true })`.
- [+ Passo] → menu `STEP_TYPES` → `setNewStep({ action_type, position: cadence?.attempts.length ?? 0 })`, `setSelected('novo')`.
- Subir/descer: `ids = cadence.attempts.map(a => a.id)`; `reorderCadenceSteps(cadence.id, accountId, moveStep(ids, id, dir))` → `putCadence(r.cadence)`; erro (409) → `setError(msg)` + `loadView()`.
- Arrastar: `onDragStart` guarda `dragRef.current = step.id`; `onDropHere` → `dropStep(ids, dragRef.current, step.id)` → mesma chamada.
- `StepPanel` recebe `onSaved={r => { putCadence(r.cadence); if (selected === 'novo') { setSelected(r.step_id); setNewStep(null) } }}`, `onCreatedCadence={() => {}}`, `onDeleted={c => { putCadence(c); setSelected(null) }}`, e como `children` o `StepInsights` com `suggestionsForStep(sugs.suggestions, step)` e `testForStep(sugs.tests, step)`, `onChanged={loadView}`.

Layout e textos (verbatim):
- Linha do topo: "Funil" + select (`f.name` + " (padrão)" quando `is_default`); à direita botão `Settings` (aria-label "Configurações do roteiro") que abre `StageSettings`.
- Título "Cadência de cada etapa" + HelpTip "Cada etapa do funil tem uma cadência: os passos que o vendedor segue, na ordem, enquanto o lead está nela. Ela começa sozinha quando o lead entra na etapa e fecha quando ele sai. Ex.: em Qualificando, 1º perguntar para quando é o evento, 2º mandar o catálogo, 3º ligar no dia 2."
- Chips (botões) com `stageChipLabel(stage)`; etapa final desligada com title "Etapa final — não tem cadência".
- Sem funil: "Esta conta ainda não tem funil. Crie um em Funis para montar as cadências. Ex.: Novo Lead → Qualificando → Proposta → Venda."
- Aviso de ordem (`stageSuggestions(sugs.suggestions, stage.id)`): "A IA sugere mudar a ordem das perguntas desta etapa." + `suggestionWhy(s)` + [Aplicar] (`applySuggestionLive` → `loadView`) [Ignorar].
- Etapa com passos: cabeçalho "Passos" + HelpTip "Clique num passo para editar. Pergunta obrigatória (cadeado) trava a mudança de etapa até ter resposta. O selo mostra como o passo está indo: ex.: \"respondem 45% · fraca\" quer dizer que menos da metade responde." + botão "+ Passo"; lista de `StepRow`; painel `StepPanel` do passo escolhido (à direita no desktop, embaixo no celular).
- Etapa sem passos: `StageEmpty`.
- `StageDeviations` (recolhido) com `deviationSuggestions(sugs.suggestions, funnelId)`.
- Linha do follow-up: "Follow-up automático desta etapa:" + (`stage.followups[0].name` + link "ver") ou ("nenhum" + link "criar"); os dois links vão para `automationUrl('automaticas', '')`.
- Erro geral: faixa com o texto do servidor e botão "Fechar".

- [ ] **Step 15: `src/pages/Cadences.tsx`** — prop `avulsasOnly`:
  - assinatura: `export default function Cadences({ embedded = false, avulsasOnly = false }: { embedded?: boolean; avulsasOnly?: boolean } = {})`
  - em `load`: `fetchCadences(accountId, avulsasOnly ? 'avulsa' : undefined)`.
  - quando `avulsasOnly`, o título da seção vira "Avulsas" + HelpTip "Cadências que o vendedor aplica à mão num lead, fora da etapa. Ex.: \"Reativar cliente sumido\": mensagem no dia 0, ligação no dia 2." (manter o resto da tela como está).

- [ ] **Step 16: `src/pages/CadencesAndFollowUps.tsx`** — a aba `manuais` passa a se chamar "Cadências (o vendedor faz)" e renderiza:

```tsx
      {aba === 'manuais' ? (
        <>
          <StageCadences />
          <div style={{ marginTop: 24 }}><Cadences embedded avulsasOnly /></div>
        </>
      ) : <FollowUps embedded />}
```

- [ ] **Step 17: Rotas e menu.**
  - `src/lib/automationTabs.js`: `const LEGACY = { '/cadences': 'manuais', '/follow-ups': 'automaticas', '/qualifications': 'manuais' }`.
  - `test/automationTabs.test.js` (+1):

```js
test('legacyAutomationRedirect: /qualifications vai para a aba das cadencias das etapas', () => {
  assert.equal(legacyAutomationRedirect('/qualifications', ''), '/cadencias-e-follow-ups?aba=manuais')
})
```

  - `src/App.tsx`: tirar `import QualificacaoPage ...`; trocar a rota por `<Route path="/qualifications" element={<LegacyAutomationRedirect />} />`.
  - `src/components/Sidebar.tsx`: apagar a linha do `NavLink to="/qualifications"` e tirar `ClipboardList` do import se não for mais usado.
  - `src/components/roteiro/RoteiroCard.tsx` (estado vazio do gestor): `<Link to="/qualifications">` → `<Link to={`${AUTOMATION_PATH}?aba=manuais`}>` com texto "Montar a cadência das etapas"; texto do vendedor: "Peça ao gestor para montar em Cadências. Ex.: ele cadastra \"Para quando é o seu evento?\" e a pergunta aparece aqui para você fazer."
  - `git rm src/pages/qualificacao/QualificacaoPage.tsx src/pages/qualificacao/RoteiroEditor.tsx src/pages/qualificacao/DesempenhoTab.tsx src/pages/qualificacao/SugestoesTab.tsx`. `grep -rn "qualificacao/" src` → nada.

- [ ] **Step 18:** `node --test test/stageCadence.test.js test/automationTabs.test.js test/roteiroManager.test.js` → PASS. `npx tsc --noEmit` → 16 (lista igual). `npx vite build` → ok (`git restore dist`, apagar asset novo). Sem emoji: `grep -nP "[\x{2600}-\x{27BF}\x{1F300}-\x{1FAFF}]" src/pages/cadencias src/lib/stageCadence.js src/lib/cadenceApi.ts` → nada. `npm test` → 959.
- [ ] **Step 19: Commit**

```bash
git add src/lib/cadenceApi.ts src/lib/stageCadence.js src/lib/stageCadence.d.ts test/stageCadence.test.js src/pages/cadencias src/lib/api.ts src/pages/Cadences.tsx src/pages/CadencesAndFollowUps.tsx src/lib/automationTabs.js test/automationTabs.test.js src/App.tsx src/components/Sidebar.tsx src/components/roteiro/RoteiroCard.tsx
# os 4 arquivos de src/pages/qualificacao ja foram para o stage pelo git rm do Step 17
git commit -m "feat(cadencia): tela da cadencia de cada etapa com salvar automatico; Qualificacao sai do menu

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Chat — abas Atendimento | Notas | Info, termômetro em uma linha, próximo passo; ficha do lead; Tarefas

**Files:**
- Create: `src/lib/nextStep.js`, `src/lib/nextStep.d.ts`, `test/nextStepView.test.js`, `src/components/score/ScoreLine.tsx`, `src/components/cadence/NextStepCard.tsx`, `src/components/roteiro/RoteiroNotices.tsx`
- Modify: `src/pages/Chat.tsx`, `src/lib/api.ts` (`sendMessage` + `cadenceAttemptId`), `src/context/SSEContext.tsx`, `src/components/roteiro/RoteiroCard.tsx` (usa `RoteiroNotices`), `src/pages/LeadDetail.tsx`, `src/pages/Tasks.tsx`

**Interfaces:**
- Consumes: `fetchLeadStageCadence`, `markLeadStepDone`, `LeadStageCadence`, `LeadStep` (Task 8); `saveLeadAnswer(leadId, accountId, questionKey, body)`, `undoAdvance(leadId, accountId)`, `RoteiroOffscript`, `ActiveDeviation` de `roteiroApi.ts`; `AnswerEditor({ kind, options, initialText, currentOption, saving, error, onSave, onCancel })`; `ScoreThermometer({leadId, accountId})`; `fetchLeadScore(leadId, accountId)`, `BAND_META`, `isScoreBand`; `STEP_ICONS` de `pages/cadencias/StepRow.tsx`; `applyMessageVars` de `lib/messageVars`.
- Produces:
  - `src/lib/nextStep.js`: `splitSteps(data)` → `{ next, after, done }`; `stepTitle(step)`; `afterLine(after)`; `nextActions(step)` → `('perguntar'|'ja_sei'|'enviar'|'feito')[]`; `doneText(step)`; `doneOrigin(step)` → `'ia'|'vendedor'|null`; `deviationLine(deviation)`
  - `<ScoreLine leadId accountId />`; `<NextStepCard leadId accountId mode onAsk onSendStep canManage? />`; `RoteiroNotices.tsx`: `AdvanceBanner`, `DeviationBox`, `OffscriptBox`
  - `sendMessage(leadId, accountId, content, instance_id?, roteiroQuestionKey?, cadenceAttemptId?)` (manda `cadence_attempt_id`)
  - SSE registrado: `'lead:cadence'`, `'cadence:updated'`

- [ ] **Step 1: Testes que falham — `test/nextStepView.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitSteps, stepTitle, afterLine, nextActions, doneText, doneOrigin, deviationLine } from '../src/lib/nextStep.js'

const q = (over = {}) => ({ text_for_lead: 'Para quando é o seu evento, Ana?', kind: 'options', answer: null, last_ask: null, ...over })
const data = {
  next_attempt_id: 2,
  steps: [
    { attempt_id: 1, action_type: 'pergunta', state: 'feito', how: 'respondida', question: q({ answer: { option_label: 'Até 30 dias', answer_text: null, origin: 'ia', answered_by_name: null } }) },
    { attempt_id: 2, action_type: 'mensagem', state: 'pendente', auto_message: 'Segue o catálogo, {nome}', description: null },
    { attempt_id: 3, action_type: 'ligacao', state: 'pendente', description: 'Ligar para confirmar a data' },
    { attempt_id: 4, action_type: 'pergunta', state: 'aguardando', question: q({ text_for_lead: 'Quantos convidados?' }) },
    { attempt_id: 5, action_type: 'visita', state: 'pendente', description: 'Visita ao salão' },
  ],
}

test('divide em proximo, depois (2) e feitos', () => {
  const r = splitSteps(data)
  assert.equal(r.next.attempt_id, 2)
  assert.deepEqual(r.after.map(s => s.attempt_id), [3, 4])
  assert.deepEqual(r.done.map(s => s.attempt_id), [1])
  assert.deepEqual(splitSteps({ steps: [], next_attempt_id: null }), { next: null, after: [], done: [] })
})

test('titulo, linha do depois e botoes por tipo', () => {
  assert.equal(stepTitle(data.steps[0]), 'Para quando é o seu evento, Ana?')
  assert.equal(stepTitle(data.steps[1]), 'Segue o catálogo, {nome}')
  assert.equal(afterLine(splitSteps(data).after), 'Depois: Ligação: Ligar para confirmar a data · Pergunta: Quantos convidados?')
  assert.equal(afterLine([]), '')
  assert.deepEqual(nextActions({ action_type: 'pergunta', state: 'pendente' }), ['perguntar', 'ja_sei'])
  assert.deepEqual(nextActions({ action_type: 'pergunta', state: 'aguardando' }), ['ja_sei'])
  assert.deepEqual(nextActions({ action_type: 'mensagem', state: 'pendente' }), ['enviar', 'feito'])
  assert.deepEqual(nextActions({ action_type: 'whatsapp', state: 'pendente' }), ['enviar', 'feito'])
  assert.deepEqual(nextActions({ action_type: 'visita', state: 'pendente' }), ['feito'])
})

test('feitos: resposta salva e origem; desvio em uma linha', () => {
  assert.equal(doneText(data.steps[0]), 'Até 30 dias')
  assert.equal(doneOrigin(data.steps[0]), 'ia')
  assert.equal(doneText({ action_type: 'mensagem', how: 'enviado' }), 'Enviada')
  assert.equal(doneText({ action_type: 'ligacao', how: 'feito' }), 'Feito')
  assert.equal(doneText({ action_type: 'pergunta', how: 'pulado', question: q() }), 'Pulado')
  assert.equal(doneOrigin({ action_type: 'mensagem', how: 'enviado' }), null)
  assert.equal(deviationLine({ triggers: 'preço, valor', reply_text: 'Depende' }), 'Ele perguntou de preço')
})
```

- [ ] **Step 2:** `node --test test/nextStepView.test.js` → FAIL.

- [ ] **Step 3: `src/lib/nextStep.js`**

```js
// Logica pura do cartao "Proximo passo" do Chat (spec 2026-09-27 §5.3). JS puro com .d.ts.
const LABELS = { pergunta: 'Pergunta', mensagem: 'Mensagem', whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', reuniao: 'Reunião', visita: 'Visita' }
export const stepTypeLabel = t => LABELS[t] || t

function cut(text, max) {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function splitSteps(data) {
  const steps = (data && data.steps) || []
  const next = steps.find(s => s.attempt_id === (data && data.next_attempt_id)) || null
  const idx = next ? steps.indexOf(next) : -1
  const after = idx >= 0 ? steps.slice(idx + 1).filter(s => s.state !== 'feito').slice(0, 2) : []
  const done = steps.filter(s => s.state === 'feito')
  return { next, after, done }
}

export function stepTitle(step) {
  if (step.action_type === 'pergunta') return (step.question && step.question.text_for_lead) || step.description || 'Pergunta'
  if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') return step.auto_message || step.description || stepTypeLabel(step.action_type)
  return step.description || step.instructions || stepTypeLabel(step.action_type)
}

export function afterLine(after) {
  if (!after || !after.length) return ''
  return `Depois: ${after.map(s => `${stepTypeLabel(s.action_type)}: ${cut(stepTitle(s), 40)}`).join(' · ')}`
}

export function nextActions(step) {
  if (!step) return []
  if (step.action_type === 'pergunta') return step.state === 'aguardando' ? ['ja_sei'] : ['perguntar', 'ja_sei']
  if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') return ['enviar', 'feito']
  return ['feito']
}

export function doneText(step) {
  if (step.how === 'pulado') return 'Pulado'
  if (step.action_type === 'pergunta') {
    const a = step.question && step.question.answer
    return a ? (a.option_label || a.answer_text || '') : ''
  }
  if (step.how === 'enviado') return 'Enviada'
  return 'Feito'
}

export function doneOrigin(step) {
  const a = step.action_type === 'pergunta' && step.question && step.question.answer
  if (!a || step.how === 'pulado') return null
  return a.origin === 'ia' ? 'ia' : 'vendedor'
}

export function deviationLine(deviation) {
  const subject = String((deviation && deviation.triggers) || '').split(',')[0].trim()
  return subject ? `Ele perguntou de ${subject}` : 'Ele saiu do roteiro'
}
```

`src/lib/nextStep.d.ts`:

```ts
import type { LeadStageCadence, LeadStep } from './cadenceApi'
import type { RoteiroDeviation } from './roteiroApi'
export function stepTypeLabel(t: string): string
export function splitSteps(data: Pick<LeadStageCadence, 'steps' | 'next_attempt_id'> | null | undefined): { next: LeadStep | null; after: LeadStep[]; done: LeadStep[] }
export function stepTitle(step: Partial<LeadStep> & { action_type: string }): string
export function afterLine(after: LeadStep[]): string
export type NextAction = 'perguntar' | 'ja_sei' | 'enviar' | 'feito'
export function nextActions(step: Pick<LeadStep, 'action_type' | 'state'> | null): NextAction[]
export function doneText(step: Partial<LeadStep> & { action_type: string }): string
export function doneOrigin(step: Partial<LeadStep> & { action_type: string }): 'ia' | 'vendedor' | null
export function deviationLine(deviation: Pick<RoteiroDeviation, 'triggers'> | null | undefined): string
```

- [ ] **Step 4:** `node --test test/nextStepView.test.js` → PASS (3).

- [ ] **Step 5: `src/components/roteiro/RoteiroNotices.tsx`** — extrair de `RoteiroCard.tsx` (sem mudar texto nem estilo) os três blocos `advanceBanner`, `deviationBox`, `offscriptBox`:

```ts
export function AdvanceBanner(props: { toName: string; fromName: string; undoing: boolean; onUndo: () => void }): JSX.Element
export function DeviationBox(props: { deviation: ActiveDeviation; onUse: (text: string) => void; title?: string }): JSX.Element
export function OffscriptBox(props: { offscript: RoteiroOffscript; onUse: (text: string) => void; onClose: () => void }): JSX.Element
```

`DeviationBox` usa `title ?? 'Desvio detectado'` no cabeçalho (o NextStepCard passa `deviationLine(deviation)`), e no corpo troca "O cliente saiu do roteiro. Resposta sugerida:" por "sugestão:" quando `title` vem. `RoteiroCard` passa a usar os três (JSX idêntico ao de hoje).

- [ ] **Step 6: `src/components/score/ScoreLine.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Thermometer } from 'lucide-react'
import { fetchLeadScore, type LeadScore } from '../../lib/api'
import { BAND_META, isScoreBand } from '../../lib/score'
import { useSSE } from '../../context/SSEContext'
import ScoreThermometer from './ScoreThermometer'

// Termometro em 1 linha (spec 2026-09-27 §5.3): icone da faixa, nota, faixa e "porque";
// clique abre o termometro completo ali mesmo.
export default function ScoreLine({ leadId, accountId }: { leadId: number; accountId: number }) {
  const [score, setScore] = useState<LeadScore | null>(null)
  const [open, setOpen] = useState(false)
  const leadRef = useRef(leadId)
  leadRef.current = leadId
  const load = useCallback(() => {
    const req = leadId
    fetchLeadScore(req, accountId).then(s => { if (leadRef.current === req) setScore(s) }).catch(() => {})
  }, [leadId, accountId])
  useEffect(() => { setScore(null); setOpen(false); load() }, [load])
  useSSE('lead:score', useCallback((d: any) => { if (Number(d?.lead_id) === leadId) load() }, [leadId, load]))

  const band = score && isScoreBand(score.band) ? score.band : null
  const meta = band ? BAND_META[band] : null
  const Icon = meta ? meta.icon : Thermometer
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Ver o porquê da nota"
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12 }}
      >
        <Icon size={14} style={{ color: meta ? meta.color : 'var(--text-muted)' }} />
        {score && score.score != null ? (
          <><b style={{ fontVariantNumeric: 'tabular-nums' }}>{score.score}</b><span style={{ color: meta ? meta.color : 'var(--text-secondary)' }}>{meta ? meta.label : ''}</span></>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Termômetro: ainda sem nota</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-muted)', fontSize: 11 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} porquê
        </span>
      </button>
      {open && <div style={{ marginTop: 6 }}><ScoreThermometer key={leadId} leadId={leadId} accountId={accountId} /></div>}
    </div>
  )
}
```

- [ ] **Step 7: `src/components/cadence/NextStepCard.tsx`** — props:

```ts
interface Props {
  leadId: number
  accountId: number
  mode: 'chat' | 'full'                     // full = ficha do lead: todos os passos com estado
  onAsk: (text: string, questionKey: string | null) => void       // [Perguntar] / [Usar]
  onSendStep: (text: string, attemptId: number) => void           // [Enviar] do passo mensagem
  canManage?: boolean                        // gestor: link para montar a cadencia
}
```

Comportamento:
- Carrega `fetchLeadStageCadence(leadId, accountId)` com o mesmo guarda de resposta atrasada do `RoteiroCard` (token + `leadRef`). Recarrega em silêncio nos SSE `lead:cadence`, `lead:roteiro`, `lead:updated` (id ou `bulk`), `lead:message` do lead e `cadence:updated` (qualquer).
- `lead:roteiro` com `advanced` → `AdvanceBanner` (igual ao RoteiroCard); com `offscript` → `OffscriptBox`.
- [Perguntar] → `onAsk(step.question.text_for_lead, step.question_key)`. [Já sei a resposta] → abre `AnswerEditor` do `step.question`; salvar = `saveLeadAnswer(...)`; se voltar `advanced`, mostra o `AdvanceBanner`; recarrega. [Desfazer] = `undoAdvance`.
- [Enviar] → `onSendStep(step.auto_message || step.description || '', step.attempt_id)`. [Feito] → `markLeadStepDone(leadId, step.attempt_id, accountId)`; a resposta já é o estado novo. Erro 409 mostra o texto do servidor ("Esse passo mudou. A tela foi atualizada.") e recarrega.
- Ligação com `call_script`: link "Ver roteiro da ligação" abre o texto embaixo.

Textos (verbatim) no modo `chat`:
- Cabeçalho "Próximo passo" (ícone `Play`) + HelpTip "O que fazer agora com este cliente, na ordem da cadência da etapa. Pergunta fica feita quando tem resposta (sua ou da IA); mensagem fica feita quando você envia pelo botão ou marca Feito. Ex.: 1º perguntar para quando é o evento, 2º mandar o catálogo." + à direita "N de M" (`done_count`/`total`, ícone `Check`).
- Cartão do próximo: ícone do tipo (`STEP_ICONS`) + `stepTypeLabel` + (pergunta obrigatória: `Lock` "obrigatória"); texto `stepTitle(next)`; linha de estado quando `state === 'aguardando'`: `Hourglass` "aguardando resposta" (ou `MessageSquareReply` "cliente respondeu — anote a resposta" quando `question.last_ask.replied_at`); botões conforme `nextActions(next)`: "Perguntar" (`Send`), "Já sei a resposta", "Enviar" (`Send`), "Feito" (`Check`).
- `afterLine(after)` numa linha cinza.
- "Feitos (N)" recolhido (`CheckCircle2` + `ChevronDown`/`ChevronUp`): cada item = `stepTypeLabel` + `stepTitle` + `doneText`; origem `Bot` "IA" / `User` `done_by_name || question.answer.answered_by_name || 'Vendedor'`; pergunta tem lápis (`Pencil`, aria-label "Corrigir a resposta") que abre o `AnswerEditor`. Resposta da IA aparece como "IA respondeu: <doneText> " + botão "corrigir".
- Desvio: `DeviationBox` com `title={deviationLine(deviation)}` → "Ele perguntou de preço → sugestão: … [Usar]" (o "→" é texto, não emoji).
- Tudo feito: `CheckCircle2` "Tudo feito nesta etapa. Mude a etapa quando o cliente avançar."
- Sem cadência (`lead_cadence === null`): "Esta etapa ainda não tem cadência." + gestor: "Monte os passos — ex.: 1º perguntar \"Para quando é o seu evento?\", 2º mandar o catálogo." + `<Link to={`${AUTOMATION_PATH}?aba=manuais&etapa=${stage.id}`}>Montar a cadência desta etapa</Link>`; vendedor: "Peça ao gestor para montar em Cadências. Ex.: ele cadastra \"Para quando é o seu evento?\" e o passo aparece aqui."
- Erro de carga: "Não deu para carregar o próximo passo. [Tentar de novo]".

No modo `full` (ficha): título "Cadência da etapa: <stage.name>" e a lista inteira de passos na ordem, cada um com `Check` (feito), `Hourglass` (aguardando) ou bolinha (pendente), `stepTitle` e `doneText`; o próximo destacado com os mesmos botões.

- [ ] **Step 8: `src/lib/api.ts` e `src/context/SSEContext.tsx`**

```ts
export const sendMessage = (leadId: number, accountId: number, content: string, instance_id?: number, roteiroQuestionKey?: string | null, cadenceAttemptId?: number | null) =>
  apiFetch<SendResult>(`/api/messages/${leadId}?account_id=${accountId}`, { method: 'POST', body: JSON.stringify({
    content, instance_id,
    ...(roteiroQuestionKey ? { roteiro_question_key: roteiroQuestionKey } : {}),
    ...(cadenceAttemptId ? { cadence_attempt_id: cadenceAttemptId } : {}),
  }) })
```

Em `SSEContext.tsx`, acrescentar `'lead:cadence', 'cadence:updated'` ao array `eventTypes`.

- [ ] **Step 9: `src/pages/Chat.tsx`**
  - Tipos: `rightTab: 'atendimento' | 'notes' | 'info'` (padrão `'atendimento'`); `mobileTab: 'conversas' | 'chat' | 'atendimento' | 'info'`; `switchMobileTab` sincroniza `atendimento`/`info` com `setRightTab`.
  - Estado novo `const [cadenceStepKey, setCadenceStepKey] = useState<number | null>(null)` com as mesmas regras de limpeza de `roteiroAskKey` (texto apagado, troca de conversa, mensagem pronta escolhida, sugestão da IA posta na caixa).
  - `handleStepSend = useCallback((text: string, attemptId: number) => { handleRoteiroAsk(applyMessageVars(text, { nome: lead?.name || '' /* mesmos campos usados em setCadenceMsgText */ }), null); setCadenceStepKey(attemptId) }, [...])` — usar exatamente o mesmo objeto de variáveis que a linha ~374 (`applyMessageVars(lc.attempt_message, {...})`) já monta.
  - Em `handleSendMsg`: `const stepKey = cadenceStepKey`; `sendMessage(lead.id, accountId, sentText, override, askKey, stepKey)`; depois do envio, `if (sameLead) setCadenceStepKey(null)`.
  - Abas do painel direito:

```tsx
              {(['atendimento', 'notes', 'info'] as const).map(tab => (
                <button key={tab} className={`btn btn-sm ${rightTab === tab ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setRightTab(tab)} style={{ flex: 1, fontSize: 11 }}>
                  {tab === 'atendimento' && <><ListChecks size={11} /> Atendimento</>}
                  {tab === 'notes' && <><StickyNote size={11} /> Notas ({notes.length})</>}
                  {tab === 'info' && <><User size={11} /> Info</>}
                </button>
              ))}
```

  - Aba **Atendimento** (nova, nesta ordem): `<ScoreLine key={lead.id} leadId={lead.id} accountId={accountId} />`; linha "Etapa: **<nome>**" + botão "mudar" que mostra o `select` de etapa já existente (`handleStageChange`, trava do roteiro igual); `<NextStepCard key={lead.id} leadId={lead.id} accountId={accountId} mode="chat" onAsk={handleRoteiroAsk} onSendStep={handleStepSend} canManage={user?.role === 'gerente' || user?.role === 'super_admin'} />`; a barra "Você perguntou …? [Sim] [Não]" continua onde está (em cima da caixa de mensagem).
  - Aba **Info**: tirar `ScoreThermometer`, `RoteiroCard` e o select de etapa daqui; manter Atendente, Vendas, Informações (observações), Tags, a caixa de cadências (a aba interna "Manuais" passa a se chamar "Avulsa") e Follow-ups.
  - Aba **Histórico** removida: apagar o bloco `rightTab === 'history'`, o botão "Histórico" da barra de baixo do celular (vira "Atendimento", ícone `ListChecks`, `switchMobileTab('atendimento')`) e o estado/fetch de `history` se ficar sem uso (o histórico continua na ficha do lead).
- [ ] **Step 10: `src/pages/LeadDetail.tsx`** — na aba "Qualificação" (renomear o rótulo para "Cadência e respostas"): primeiro `<NextStepCard key={`cad-${lead.id}`} leadId={lead.id} accountId={accountId} mode="full" onAsk={askInChat} onSendStep={(text) => askInChat(text, null)} canManage={canForce} />`, depois o `RoteiroCard mode="full"` de hoje (respostas de todas as etapas). O `ScoreThermometer` completo já está no topo da coluna esquerda (Task 15 anterior) — conferir.
- [ ] **Step 11: `src/pages/Tasks.tsx`** — `ACTION_ICONS.pergunta = HelpCircle`, `ACTION_LABELS.pergunta = 'Pergunta'`; no tratamento de erro de concluir, mostrar a mensagem do servidor (a 400 diz "A pergunta fica feita quando tem resposta. Use [Já sei a resposta].").
- [ ] **Step 12:** `node --test test/nextStepView.test.js test/roteiroView.test.js` → PASS. `npx tsc --noEmit` → 16 (lista igual). `npx vite build` → ok (`git restore dist`, apagar asset novo). Sem emoji novo (mesmo `grep -nP` da Task 8 nos arquivos novos). `npm test` → 962.
- [ ] **Step 13: Commit**

```bash
git add src/lib/nextStep.js src/lib/nextStep.d.ts test/nextStepView.test.js src/components/score/ScoreLine.tsx src/components/cadence/NextStepCard.tsx src/components/roteiro/RoteiroNotices.tsx src/components/roteiro/RoteiroCard.tsx src/pages/Chat.tsx src/lib/api.ts src/context/SSEContext.tsx src/pages/LeadDetail.tsx src/pages/Tasks.tsx
git commit -m "feat(chat): aba Atendimento com termometro em uma linha e proximo passo da cadencia da etapa

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Conferência final no navegador com o dono

**Files:** nenhum arquivo novo; correções pequenas que aparecerem viram commits `fix:` separados.

**Interfaces:**
- Consumes: tudo das Tasks 1–9.
- Produces: lista de achados (o que o dono aprovou / pediu para mudar), sem push.

- [ ] **Step 1: Suíte e build.** `export PATH="/c/nvm4w/nodejs:$PATH"`; `npm test` → 962 passando, 0 falha; `npx tsc --noEmit` → 16 erros, lista igual à de antes; `npx vite build` → ok; `git restore dist`; `git status` sem `dist/` nem `vite.config.ts` no stage.
- [ ] **Step 2: Subir local** com uma **cópia** do banco (nunca o de produção) e conferir no log do boot: "cadence_attempts reconstruida: N passos, ids mantidos" e "[Cadencia] migracao: X cadencias de etapa…" só na 1ª vez; reiniciar e confirmar que não aparece de novo.
- [ ] **Step 3: Roteiro do dono (Cadências e Follow-ups → aba Cadências)** — conferir e anotar:
  1. Chips das etapas com "N passos · M perguntas"; etapa final desligada.
  2. Clicar numa pergunta, mudar o texto: aparece "Salvando…" e depois "Salvo" com o ícone de check; recarregar a página e o texto está lá.
  3. Tirar a internet (DevTools → Offline), editar: "Não salvou. [Tentar de novo]" com o texto mantido; voltar a rede e clicar em Tentar de novo.
  4. Trocar "Livre" ↔ "Opções" com 1 opção só: aparece o aviso de "pelo menos 2 opções" e nada é salvo.
  5. Reordenar com as setas e arrastando; apagar um passo (confirmação com o texto certo).
  6. Etapa vazia: [Começar com modelo] cria 4 perguntas; [Montar com IA] sem IA mostra "Ligue a IA em Integrações > IA".
  7. "Se o cliente perguntar…" salva sozinho; link do follow-up da etapa abre a aba Automáticas.
  8. Ícone de configurações: os 3 números com o "?" explicando com exemplo.
  9. Menu sem "Qualificação"; abrir `/crm/qualifications` cai na aba Cadências.
- [ ] **Step 4: Roteiro do dono (Chat)** — com um lead numa etapa com cadência:
  1. Abas Atendimento | Notas | Info; sem Histórico (também no celular).
  2. Termômetro em uma linha; clicar em "porquê" abre o completo.
  3. Próximo passo pergunta: [Perguntar] põe o texto na caixa; depois do envio aparece "aguardando resposta" e só [Já sei a resposta].
  4. Próximo passo mensagem: [Enviar] põe o texto com o nome do cliente; enviado, o passo vai para "Feitos" como "Enviada"; [Feito] também conclui.
  5. Resposta pela IA aparece em Feitos com o robô e [corrigir].
  6. Responder a última obrigatória: faixa "Avançou para X [Desfazer]"; Desfazer volta e o próximo passo continua de onde estava.
  7. Em outra aba do navegador, o gestor apaga o passo que o vendedor está vendo: o cartão recarrega; clicar em [Feito] antes dele recarregar mostra "Esse passo mudou. A tela foi atualizada.".
  8. Aplicar uma cadência avulsa pela aba Info e mudar a etapa: a avulsa continua.
  9. Dashboard mostra "Taxa de venda por faixa do termômetro".
  10. Ficha do lead: termômetro completo, cadência da etapa inteira e respostas de todas as etapas.
- [ ] **Step 5:** Anotar os pedidos do dono numa lista única; corrigir cada um num commit `fix(...)` com teste quando for lógica; repetir o Step 1 no fim. Não dar push.

---

## Self-review (feito ao escrever o plano)

**Cobertura da spec:**
- §2.1 cadência por etapa + pergunta como passo → Tasks 1, 2; tela Qualificação sai → Task 8.
- §2.2 follow-up à parte, link na etapa → Task 2 (`followups` na visão), Task 8.
- §2.3 métricas e sugestões no passo → Tasks 4, 5 (`/metrics`, `/suggestions/:id/apply`, `/variants/:id/confirm`), Task 8 (`StepInsights`).
- §2.4 / §5.3 Chat Atendimento | Notas | Info, termômetro em linha, próximo passo, "Depois", "Feitos", IA respondeu, avanço com Desfazer, desvio, reconhecimento → Task 9.
- §2.5 / §4.1 começa sozinha na entrada, fecha na saída, finais só fecham, nunca envia → Task 3 (+ lead novo, cadência criada depois).
- §2.6 roteiro continua motor → Tasks 2, 3 (sincronização; trava/avanço/IA intactos).
- §2.7 / §4.3 salvar automático 500 ms, "Salvo", erro com Tentar de novo, versão só quando pergunta muda → Task 2 (servidor), Task 8 (fila).
- §3.1 `funnel_id`, `stage_id`, índice único parcial → Task 1; regra 409 → Task 2.
- §3.2 CHECK com 'pergunta', `question_key`, reconstrução idempotente com mesmos ids, passos por id → Tasks 1, 2, 5.
- §3.3 `kind`, `stage_id`, etapa + avulsa → Tasks 1, 3, 5.
- §3.4 sincronização e publicar só quando muda; desvios na tela da etapa → Task 2, Task 8.
- §3.5 `roteiro_asks.attempt_id`, ask `step-<id>`, "feitas X de Y" → Tasks 1, 4.
- §4.2 próximo passo (pergunta respondida/aguardando; mensagem enviada/Feito; último passo completa) → Task 3; trava/avanço/"falta saber"/forçar continuam (código do roteiro não muda).
- §5.1 tela do gestor inteira → Task 8. §5.2 Dashboard → Task 7. §5.4 ficha → Task 9. §5.5 menu + redirect → Task 8.
- §6 migração 1–5 → Task 1 (passo 1), Task 6 (passos 2–5).
- §7 conta 404 em todas as rotas por id + atendente → Task 5 (e Tarefas).
- §9 erros: passo falhou (Task 8), `question_key` inválida 400 (Tasks 2, 5), etapa com cadência sem passos (Task 3), migração por conta (Task 6).
- §10 testes: todos listados nas Tasks 1–9; conferência no navegador → Task 10.

**Placeholders:** nenhum "TBD"/"similar a"; todo passo de código tem o código ou, nos componentes grandes, props exatas + textos literais + as funções puras testadas que eles usam.

**Consistência de tipos/nomes:** `CadenceError(code, status, message)` (T1) usado em T2–T6; `getCadence/createCadence/addStep/updateStep/deleteStep/reorderSteps` (T2) usados com as mesmas assinaturas em T3–T5; `ensureStageCadence/onStageMoved/refreshLeadStageCadence/refreshLeadsOfCadence/attachLeadsInStage/getLeadStageCadence/markStepDone/completeCurrentStep/assignAvulsa/advanceAvulsa/leadCadenceView` (T3) usados em T4–T6; `recordStepSend/stepMetrics/stepAskKey` (T4) usados em T5; formatos `LeadStageCadence`/`LeadStep`/`StepMetric` iguais no servidor (T3/T4) e em `cadenceApi.ts` (T8); `createSaveQueue` → `{push, flush, retry, busy}` igual no teste, no `.js` e no `.d.ts`.

**Review Focus → testes:** (1) T1 `reconstrucao: mesmos ids...`; (2) T8 `fila de salvamento: ...` (3 testes) + T2 `duas edicoes seguidas...`; (3) T3 `etapa e avulsa juntas...`; (4) T2 `apagar pergunta com resposta e teste A/B...`; (5) T3 `passo apagado com o Chat aberto -> 409...` + T5 `PATCH do passo ... avisa cadence:updated` e `vendedor: ... passo apagado -> 409`.

# Roteiro de Qualificação + Termômetro — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Roteiro de qualificação por etapa (trava, avanço automático, medição, sugestões, A/B) e termômetro do lead (nota 0–100 Perfil × Engajamento, filtros, ordem, avisos), explicados com exemplo em toda tela.

**Architecture:** Duas famílias de serviços que recebem `db` (testáveis com banco em memória): `server/services/roteiro/*` e `server/services/leadScore/*`, mais `server/services/stageMove.js` como porta única de troca de etapa. Rotas novas num router-fábrica (`createRoteiroRouter(db, deps)`). A nota fica gravada em colunas de `leads` para filtro/ordem rápidos. Frontend em componentes novos pequenos, encaixados no Chat/Leads/Pipeline/LeadDetail.

**Tech Stack:** Node 20 (ESM), Express, better-sqlite3, `node --test`; React 18 + TypeScript + Vite; lucide-react; IA via `server/services/anthropicClient.js` (`callHaiku`).

**Spec:** `docs/superpowers/specs/2026-09-25-roteiro-qualificacao-e-termometro-design.md` — ler antes de cada tarefa; os números (faixas, pesos, prazos) vêm de lá.

## Ordem de execução

1 → 2 → 4 → 3 → 5 → 6 → 7 → 8 → 9 → 11 → 12 → 10 → 13 → 14 → 15 → 16 → 17 (algumas tarefas consomem funções de tarefas de número maior; esta ordem respeita as dependências).

## Global Constraints

- Node do projeto: `export PATH="/c/nvm4w/nodejs:$PATH"` antes de `npm test` / `npx vite build` (Node 20).
- Rodar testes: `npm test` (todos) ou `node --test test/<arquivo>.test.js`.
- Todo texto de tela em **português do Brasil**, linguagem simples, sem jargão; regra "explica com exemplo" (spec §1): tela vazia com exemplo, "?" com explicação + exemplo, placeholder de exemplo em todo campo, porquê de todo número.
- Faixas: `frio` 0–30, `morno` 31–60, `quente` 61–85, `pronto` 86–100. Perfil letra: A ≥38, B 25–37, C 13–24, D ≤12. Engajamento alto ≥25.
- Padrões de conta: `roteiro_min_reply_rate=70`, `roteiro_reply_window_h=24`, `score_alert_minutes=60`, `score_half_life_days=7`.
- Toda consulta de rota filtra `account_id = req.accountId`; lead/funil de outra conta → 404.
- Serviços novos NÃO importam `server/db.js` (recebem `db`); só as cascas de rota e o boot importam.
- Comentários de código em português, curtos, no estilo do repo. Sem `console.log` de token/segredo.
- Não mexer em `vite.config.ts` nem em `dist/` nos commits.
- Commits terminam com: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`

## Review Focus

1. **Lead sem funil/etapa ou funil sem roteiro publicado** — tudo (cartão, trava, nota) funciona: sem trava, Perfil 0 "desconhecido", cartão com tela vazia. Teste em Task 5 e Task 2.
2. **Mover para etapa anterior ou para etapa final** — nunca trava; voltar etapa não dispara avanço automático. Teste em Task 6.
3. **Resposta da IA chegando depois de correção manual** — manual prevalece. Teste em Task 5.
4. **Atendente de outra conta / lead de outra conta** nas rotas novas — 404. Teste em Task 10.
5. **Recálculo em rajada** (10 mensagens seguidas) — no máximo um cálculo por lead a cada 5 s; aviso ao vendedor 1×/dia. Teste em Task 3.

---

## Mapa de arquivos

Criar:
- `server/services/roteiro/schema.js` — tabelas e colunas (`applyRoteiroSchema`)
- `server/services/roteiro/repo.js` — rascunho, publicar, versões, validação, perguntas publicadas
- `server/services/roteiro/bantTemplate.js` — modelo BANT
- `server/services/roteiro/leadRoteiro.js` — roteiro do lead, respostas, gate, avanço automático, desfazer
- `server/services/roteiro/variants.js` — sorteio A/B e texto vigente
- `server/services/roteiro/recognize.js` — reconhecer pergunta digitada
- `server/services/roteiro/asks.js` — registro e marcos dos envios
- `server/services/roteiro/deviations.js` — casar desvio cadastrado
- `server/services/roteiro/metrics.js` — taxas por pergunta/vendedor, taxa de venda por faixa
- `server/services/roteiro/learning.js` — sugestões noturnas + avaliação A/B
- `server/services/roteiro/aiExtract.js`, `aiDraft.js`, `aiLearning.js` — partes com IA
- `server/services/roteiro/migrateLegacy.js` — qualificação antiga → roteiro
- `server/services/stageMove.js` — porta única de troca de etapa
- `server/services/leadScore/compute.js` (pura), `halfLife.js`, `inputs.js`, `recalc.js`, `nightly.js`, `hotLeadAlerts.js`, `businessMinutes.js`, `filters.js`
- `server/routes/roteiroRouter.js` (fábrica) + `server/routes/roteiro.js` (casca)
- `test/helpers/roteiroDb.js` + testes por serviço
- Front: `src/lib/roteiroApi.ts`, `src/lib/score.ts`, `src/components/score/ScoreBadge.tsx`, `ScoreThermometer.tsx`, `ScoreToasts.tsx`, `src/components/MoreFilters.tsx`, `src/components/roteiro/RoteiroCard.tsx`, `StageGateModal.tsx`, `RecognizedQuestionBar.tsx`, `HelpTip.tsx`, `src/pages/qualificacao/QualificacaoPage.tsx`, `RoteiroEditor.tsx`, `DesempenhoTab.tsx`, `SugestoesTab.tsx`

Modificar: `server/db.js`, `server/index.js`, `server/routes/leads.js`, `server/routes/messages.js`, `server/routes/qualifications.js`, `server/services/inboundHandler.js`, `server/services/leadIntake.js`, `server/services/aiAgent.js`, `server/services/conversationAnalyzer.js`, `server/scheduler.js`, `src/context/SSEContext.tsx`, `src/pages/Chat.tsx`, `src/pages/Leads.tsx`, `src/pages/Pipeline.tsx`, `src/pages/LeadDetail.tsx`, `src/components/CityFilter.tsx` (usado dentro de MoreFilters), `src/components/Sidebar.tsx`, `src/App.tsx`, `src/lib/api.ts`.

---

### Task 1: Schema + banco de teste

**Files:**
- Create: `server/services/roteiro/schema.js`, `test/helpers/roteiroDb.js`, `test/roteiroSchema.test.js`
- Modify: `server/db.js` (chamar `applyRoteiroSchema(db)` junto dos outros `apply*Schema`, ~linha 1461–1473)

**Interfaces:**
- Produces: `applyRoteiroSchema(db)`; helper de teste `createRoteiroTestDb()` → `db`; `seedRoteiroBase(db)` → `{ accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages: { novo, qualificando, proposta, venda, perdido }, instanceId }`; `addLead(db, fields)` → `leadId`; `addMessage(db, { leadId, direction, content, minutesAgo, userId })` → `messageId`.

- [ ] **Step 1: Teste**

```js
// test/roteiroSchema.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'

test('schema do roteiro: tabelas, colunas do lead/conta e idempotente', () => {
  const db = createRoteiroTestDb()
  applyRoteiroSchema(db) // 2a vez nao quebra
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
  for (const t of ['roteiro_versions', 'roteiro_questions', 'roteiro_options', 'roteiro_deviations', 'roteiro_variants', 'roteiro_asks', 'lead_answers', 'roteiro_suggestions', 'roteiro_offscript', 'lead_score_daily']) {
    assert.ok(tables.includes(t), t)
  }
  const leadCols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  for (const c of ['score', 'score_band', 'score_fit', 'score_fit_grade', 'score_engagement', 'score_quadrant', 'score_reasons_json', 'score_prev', 'score_at', 'score_alerted_at', 'roteiro_no_auto_from_stage']) assert.ok(leadCols.includes(c), c)
  const s = seedRoteiroBase(db)
  const acc = db.prepare('SELECT roteiro_min_reply_rate, roteiro_reply_window_h, score_alert_minutes, score_half_life_days FROM accounts WHERE id = ?').get(s.accountId)
  assert.deepEqual(acc, { roteiro_min_reply_rate: 70, roteiro_reply_window_h: 24, score_alert_minutes: 60, score_half_life_days: 7 })
})
```

- [ ] **Step 2:** `node --test test/roteiroSchema.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `schema.js`**

```js
// Tabelas do Roteiro de Qualificacao e colunas do Termometro (spec 7.1). Idempotente.
function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
}

export function applyRoteiroSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS roteiro_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      funnel_id INTEGER NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
      published_at TEXT, published_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_versions_funnel ON roteiro_versions(account_id, funnel_id, status);
    CREATE TABLE IF NOT EXISTS roteiro_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES roteiro_versions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      stage_id INTEGER NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('text','options')),
      required INTEGER NOT NULL DEFAULT 0,
      bant TEXT,
      ai_hint TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_questions_version ON roteiro_questions(version_id, stage_id, position);
    CREATE TABLE IF NOT EXISTS roteiro_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES roteiro_questions(id) ON DELETE CASCADE,
      option_key TEXT NOT NULL,
      label TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS roteiro_deviations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_id INTEGER NOT NULL REFERENCES roteiro_versions(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL,
      triggers TEXT NOT NULL,
      reply_text TEXT NOT NULL,
      return_question_key TEXT,
      position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS roteiro_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('testing','won','lost','cancelled')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      suggestion_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS roteiro_asks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'A',
      text_sent TEXT,
      message_id INTEGER,
      user_id INTEGER,
      source TEXT NOT NULL CHECK (source IN ('button','recognized','ia')),
      asked_at TEXT NOT NULL DEFAULT (datetime('now')),
      replied_at TEXT, answered_at TEXT, advanced_at TEXT, bought_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_roteiro_asks_lead ON roteiro_asks(lead_id, asked_at);
    CREATE INDEX IF NOT EXISTS idx_roteiro_asks_q ON roteiro_asks(account_id, question_key, asked_at);
    CREATE TABLE IF NOT EXISTS lead_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      question_key TEXT NOT NULL,
      option_key TEXT,
      answer_text TEXT,
      origin TEXT NOT NULL CHECK (origin IN ('ia','manual')),
      evidence TEXT,
      answered_by INTEGER,
      answered_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(lead_id, question_key)
    );
    CREATE TABLE IF NOT EXISTS roteiro_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      funnel_id INTEGER,
      question_key TEXT,
      type TEXT NOT NULL CHECK (type IN ('rewrite','seller_phrasing','new_option','new_deviation','reorder')),
      payload_json TEXT NOT NULL,
      evidence_json TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','testing','applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      decided_by INTEGER, decided_at TEXT
    );
    CREATE TABLE IF NOT EXISTS roteiro_offscript (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lead_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_score_daily (
      lead_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      score INTEGER NOT NULL,
      band TEXT NOT NULL,
      PRIMARY KEY (lead_id, day)
    );
  `)
  for (const [c, t] of [
    ['score', 'INTEGER'], ['score_band', 'TEXT'], ['score_fit', 'INTEGER'], ['score_fit_grade', 'TEXT'],
    ['score_engagement', 'INTEGER'], ['score_quadrant', 'TEXT'], ['score_reasons_json', 'TEXT'],
    ['score_prev', 'INTEGER'], ['score_at', 'TEXT'], ['score_alerted_at', 'TEXT'], ['roteiro_no_auto_from_stage', 'INTEGER'],
  ]) addColumnIfNotExists(db, 'leads', c, t)
  for (const [c, t] of [
    ['roteiro_min_reply_rate', 'INTEGER NOT NULL DEFAULT 70'], ['roteiro_reply_window_h', 'INTEGER NOT NULL DEFAULT 24'],
    ['score_alert_minutes', 'INTEGER NOT NULL DEFAULT 60'], ['score_half_life_days', 'REAL NOT NULL DEFAULT 7'],
  ]) addColumnIfNotExists(db, 'accounts', c, t)
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(account_id, score)') } catch {}
}
```

- [ ] **Step 4: `test/helpers/roteiroDb.js`** — parte de `createTestDb()` de `./memoryDb.js`, completa as colunas/tabelas que o roteiro usa e aplica o schema:

```js
import { createTestDb } from './memoryDb.js'
import { applyRoteiroSchema } from '../../server/services/roteiro/schema.js'

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

export function createRoteiroTestDb() {
  const db = createTestDb()
  for (const [c, t] of [['is_conversion', 'INTEGER NOT NULL DEFAULT 0'], ['is_terminal', 'INTEGER NOT NULL DEFAULT 0'], ['auto_keywords', 'TEXT']]) addCol(db, 'funnel_stages', c, t)
  for (const [c, t] of [['funnel_id', 'INTEGER'], ['stage_id', 'INTEGER'], ['attendant_id', 'INTEGER'], ['instance_id', 'INTEGER'], ['last_instance_id', 'INTEGER'],
    ['is_active', 'INTEGER NOT NULL DEFAULT 1'], ['is_archived', 'INTEGER NOT NULL DEFAULT 0'], ['last_inbound_at', 'TEXT'], ['uf', 'TEXT'], ['source', 'TEXT'],
    ['created_at', "TEXT NOT NULL DEFAULT (datetime('now'))"], ['updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))"]]) addCol(db, 'leads', c, t)
  addCol(db, 'users', 'primary_instance_id', 'INTEGER')
  db.exec(`
    CREATE TABLE IF NOT EXISTS stage_history (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, from_stage_id INTEGER, to_stage_id INTEGER, trigger_type TEXT DEFAULT 'manual', triggered_by INTEGER, notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lead_sales (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER NOT NULL, value REAL, sale_date TEXT, notes TEXT, created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS conversation_insights (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, lead_id INTEGER UNIQUE, analyzed_at TEXT, summary TEXT, temperatura_lead TEXT, chance_conversao INTEGER);
    CREATE TABLE IF NOT EXISTS analyst_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER, insight_id INTEGER, type TEXT NOT NULL, severity TEXT, title TEXT, description TEXT, suggested_action TEXT, assigned_to_user_id INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), resolved_at TEXT);
    CREATE TABLE IF NOT EXISTS instance_auto_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id INTEGER UNIQUE, away_schedule_json TEXT);
    CREATE TABLE IF NOT EXISTS qualification_sequences (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, question TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS lead_qualifications (id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, sequence_id INTEGER NOT NULL, answer TEXT, answered_at TEXT, answered_by INTEGER, UNIQUE(lead_id, sequence_id));
    CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  applyRoteiroSchema(db)
  return db
}

export function seedRoteiroBase(db) {
  const accountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta A')").run().lastInsertRowid)
  const otherAccountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta B')").run().lastInsertRowid)
  const gerenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestora', 'g@a.local', 'gerente')").run(accountId).lastInsertRowid)
  const atendenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Ana', 'ana@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const funnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Funil', 1, 1)").run(accountId).lastInsertRowid)
  const mk = (name, position, conv = 0, term = 0) => Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, ?, ?, ?, ?)').run(funnelId, name, position, conv, term).lastInsertRowid)
  const stages = { novo: mk('Novo', 0), qualificando: mk('Qualificando', 1), proposta: mk('Proposta', 2), venda: mk('Venda', 3, 1, 1), perdido: mk('Perdido', 4, 0, 1) }
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'n1', 'connected')").run(accountId).lastInsertRowid)
  return { accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages, instanceId }
}

export function addLead(db, fields) {
  const f = { name: 'Lead', phone: '5548999990000', ...fields }
  const cols = Object.keys(f)
  return Number(db.prepare(`INSERT INTO leads (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map(c => f[c])).lastInsertRowid)
}

export function addMessage(db, { leadId, direction, content = 'oi', minutesAgo = 0, userId = null }) {
  const lead = db.prepare('SELECT account_id FROM leads WHERE id = ?').get(leadId)
  return Number(db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, sent_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, datetime('now', ?))`)
    .run(leadId, lead.account_id, direction, content, userId, `-${minutesAgo} minutes`).lastInsertRowid)
}
```

- [ ] **Step 5: Chamar no boot** — em `server/db.js`, ao lado de `applyCopilotSchema(db)` / `applyAgentBriefingSchema(db)`: `import { applyRoteiroSchema } from './services/roteiro/schema.js'` e `applyRoteiroSchema(db)` (depois de `leads`/`accounts` existirem).
- [ ] **Step 6:** `node --test test/roteiroSchema.test.js` → PASS; `npm test` → tudo verde.
- [ ] **Step 7: Commit** `feat(roteiro): schema do roteiro e do termometro + banco de teste`

---

### Task 2: Calculadora do termômetro (pura) + meia-vida

**Files:** Create `server/services/leadScore/compute.js`, `server/services/leadScore/halfLife.js`, `test/leadScoreCompute.test.js`

**Interfaces:**
- Produces:
  - `BANDS = ['frio','morno','quente','pronto']`; `bandFor(score)`; `fitGrade(fit)`; `quadrantFor(fitGrade, engagement)` → `'atender_agora'|'reaquecer'|'qualificar'|'baixa'`
  - `computeLeadScore(input)` com `input = { fit: { obtained, max, answeredCount, totalCount, reasons: [{texto, pontos}] }, engagement: { daysSinceLastInbound: number|null, halfLifeDays, replyDelaysMin: number[], lastOutboundReplied: boolean[], advancedLast7d, buyingTermLast7d }, ai: { temperatura: 'frio'|'morno'|'quente'|null, chance: number|null, analyzedDaysAgo: number|null } }` → `{ score, band, fit, fitGrade, engagement, engagementHigh, aiAdjust, quadrant, reasons: [{grupo, texto, pontos}] }`
  - `computeHalfLife(cycleDays: number[])` → número (dias)

- [ ] **Step 1: Testes**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeLeadScore, bandFor, fitGrade, quadrantFor } from '../server/services/leadScore/compute.js'
import { computeHalfLife } from '../server/services/leadScore/halfLife.js'

const base = () => ({
  fit: { obtained: 0, max: 0, answeredCount: 0, totalCount: 0, reasons: [] },
  engagement: { daysSinceLastInbound: null, halfLifeDays: 7, replyDelaysMin: [], lastOutboundReplied: [], advancedLast7d: false, buyingTermLast7d: false },
  ai: { temperatura: null, chance: null, analyzedDaysAgo: null },
})

test('faixas, letra e matriz', () => {
  assert.deepEqual([0, 30, 31, 60, 61, 85, 86, 100].map(bandFor), ['frio', 'frio', 'morno', 'morno', 'quente', 'quente', 'pronto', 'pronto'])
  assert.deepEqual([50, 38, 37, 25, 24, 13, 12, 0].map(fitGrade), ['A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'])
  assert.equal(quadrantFor('A', 25), 'atender_agora')
  assert.equal(quadrantFor('B', 24), 'reaquecer')
  assert.equal(quadrantFor('C', 30), 'qualificar')
  assert.equal(quadrantFor('D', 0), 'baixa')
})

test('lead sem nada: nota 0, frio, perfil D desconhecido', () => {
  const r = computeLeadScore(base())
  assert.equal(r.score, 0); assert.equal(r.band, 'frio'); assert.equal(r.fitGrade, 'D')
  assert.ok(r.reasons.some(x => x.grupo === 'perfil' && /desconhecido/.test(x.texto)))
})

test('perfil proporcional, com pontos negativos e sem passar de 0..50', () => {
  const i = base(); i.fit = { obtained: 36, max: 60, answeredCount: 3, totalCount: 4, reasons: [{ texto: 'Orçamento: acima de R$20 mil', pontos: 30 }] }
  assert.equal(computeLeadScore(i).fit, 30)
  i.fit.obtained = -10
  assert.equal(computeLeadScore(i).fit, 0)
  i.fit.obtained = 80
  assert.equal(computeLeadScore(i).fit, 50)
})

test('engajamento: recencia com meia-vida, rapidez, reciprocidade, intensidade', () => {
  const i = base()
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [5, 3, 8], lastOutboundReplied: [true, true, true, false, true], advancedLast7d: true, buyingTermLast7d: true }
  const r = computeLeadScore(i)
  assert.equal(r.engagement, 20 + 10 + 8 + 10) // 48
  i.engagement.daysSinceLastInbound = 7 // uma meia-vida: 10
  i.engagement.replyDelaysMin = [120] // < 6h: 4
  i.engagement.advancedLast7d = false // termo de compra: 5
  assert.equal(computeLeadScore(i).engagement, 10 + 4 + 8 + 5)
  i.engagement.replyDelaysMin = []
  i.engagement.daysSinceLastInbound = null
  assert.equal(computeLeadScore(i).engagement, 0 + 0 + 8 + 5)
})

test('rapidez usa a mediana', () => {
  const i = base(); i.engagement.replyDelaysMin = [2, 500, 30] // mediana 30 min -> 7
  assert.equal(computeLeadScore(i).engagement, 7)
})

test('ajuste da IA so com analise de ate 7 dias', () => {
  const i = base(); i.ai = { temperatura: 'quente', chance: 80, analyzedDaysAgo: 2 }
  assert.equal(computeLeadScore(i).aiAdjust, 15)
  i.ai = { temperatura: 'frio', chance: 10, analyzedDaysAgo: 1 }
  assert.equal(computeLeadScore(i).aiAdjust, -15)
  i.ai.analyzedDaysAgo = 8
  assert.equal(computeLeadScore(i).aiAdjust, 0)
})

test('nota final limitada a 0..100 e porque ordenado por grupo', () => {
  const i = base()
  i.fit = { obtained: 60, max: 60, answeredCount: 4, totalCount: 4, reasons: [{ texto: 'Orçamento: acima de R$20 mil', pontos: 30 }] }
  i.engagement = { daysSinceLastInbound: 0, halfLifeDays: 7, replyDelaysMin: [1], lastOutboundReplied: [true, true, true, true, true], advancedLast7d: true, buyingTermLast7d: false }
  i.ai = { temperatura: 'quente', chance: 90, analyzedDaysAgo: 0 }
  const r = computeLeadScore(i)
  assert.equal(r.score, 100); assert.equal(r.band, 'pronto'); assert.equal(r.quadrant, 'atender_agora')
  assert.deepEqual([...new Set(r.reasons.map(x => x.grupo))], ['perfil', 'engajamento', 'ia'])
})

test('meia-vida: menos de 5 vendas = 7; 30% da mediana; limites 2..30', () => {
  assert.equal(computeHalfLife([10, 20]), 7)
  assert.equal(computeHalfLife([10, 20, 30, 40, 50]), 9) // mediana 30 -> 9
  assert.equal(computeHalfLife([1, 1, 1, 2, 3]), 2)
  assert.equal(computeHalfLife([200, 200, 300, 300, 400]), 30)
})
```

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar `compute.js`**

```js
// Termometro do lead (spec 5.1): nota 0..100 = Perfil (0..50) + Engajamento (0..50) + ajuste IA (-15..+15). Pura.
export const BANDS = ['frio', 'morno', 'quente', 'pronto']
export const BAND_LABEL = { frio: 'Frio', morno: 'Morno', quente: 'Quente', pronto: 'Pronto p/ fechar' }
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

export function bandFor(score) {
  if (score >= 86) return 'pronto'
  if (score >= 61) return 'quente'
  if (score >= 31) return 'morno'
  return 'frio'
}
export function fitGrade(fit) {
  if (fit >= 38) return 'A'
  if (fit >= 25) return 'B'
  if (fit >= 13) return 'C'
  return 'D'
}
export const ENGAGEMENT_HIGH = 25
export function quadrantFor(grade, engagement) {
  const goodFit = grade === 'A' || grade === 'B'
  const high = engagement >= ENGAGEMENT_HIGH
  if (goodFit) return high ? 'atender_agora' : 'reaquecer'
  return high ? 'qualificar' : 'baixa'
}
function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function fmtDays(d) {
  if (d < 1) return 'hoje'
  const n = Math.round(d)
  return n === 1 ? 'há 1 dia' : `há ${n} dias`
}

export function computeLeadScore(input) {
  const reasons = []
  const { fit: f, engagement: e, ai } = input

  // Perfil
  let fit = 0
  if (f.max > 0) fit = clamp(Math.round(50 * f.obtained / f.max), 0, 50)
  for (const r of f.reasons || []) reasons.push({ grupo: 'perfil', texto: r.texto, pontos: r.pontos })
  if (f.answeredCount === 0) reasons.push({ grupo: 'perfil', texto: `Perfil ainda desconhecido (0 de ${f.totalCount} respondidas)`, pontos: 0 })

  // Engajamento
  let recency = 0
  if (e.daysSinceLastInbound != null) {
    recency = Math.round(20 * Math.pow(0.5, e.daysSinceLastInbound / (e.halfLifeDays || 7)))
    reasons.push({ grupo: 'engajamento', texto: `Última mensagem do cliente ${fmtDays(e.daysSinceLastInbound)}`, pontos: recency })
  } else {
    reasons.push({ grupo: 'engajamento', texto: 'O cliente ainda não mandou mensagem', pontos: 0 })
  }
  let speed = 0
  if (e.replyDelaysMin.length > 0) {
    const md = median(e.replyDelaysMin)
    speed = md < 10 ? 10 : md < 60 ? 7 : md < 360 ? 4 : 1
    const label = md < 10 ? 'menos de 10 min' : md < 60 ? 'menos de 1 hora' : md < 360 ? 'menos de 6 horas' : 'mais de 6 horas'
    reasons.push({ grupo: 'engajamento', texto: `Responde em ${label}`, pontos: speed })
  }
  const replied = (e.lastOutboundReplied || []).slice(0, 5).filter(Boolean).length
  const reciprocity = replied * 2
  if ((e.lastOutboundReplied || []).length > 0) {
    reasons.push({ grupo: 'engajamento', texto: `Respondeu ${replied} das últimas ${Math.min(5, e.lastOutboundReplied.length)} mensagens`, pontos: reciprocity })
  }
  let intensity = 0
  if (e.advancedLast7d) { intensity = 10; reasons.push({ grupo: 'engajamento', texto: 'Avançou de etapa nos últimos 7 dias', pontos: 10 }) }
  else if (e.buyingTermLast7d) { intensity = 5; reasons.push({ grupo: 'engajamento', texto: 'Falou de preço, prazo ou pagamento nos últimos 7 dias', pontos: 5 }) }
  const engagement = Math.min(50, recency + speed + reciprocity + intensity)

  // IA
  let aiAdjust = 0
  if (ai && ai.analyzedDaysAgo != null && ai.analyzedDaysAgo <= 7) {
    if (ai.temperatura === 'quente') { aiAdjust += 10; reasons.push({ grupo: 'ia', texto: 'IA: conversa quente', pontos: 10 }) }
    if (ai.temperatura === 'frio') { aiAdjust -= 10; reasons.push({ grupo: 'ia', texto: 'IA: conversa fria', pontos: -10 }) }
    if (ai.chance != null && ai.chance >= 70) { aiAdjust += 5; reasons.push({ grupo: 'ia', texto: `IA: chance de fechar ${ai.chance}%`, pontos: 5 }) }
    if (ai.chance != null && ai.chance <= 20) { aiAdjust -= 5; reasons.push({ grupo: 'ia', texto: `IA: chance de fechar ${ai.chance}%`, pontos: -5 }) }
  }

  const score = clamp(fit + engagement + aiAdjust, 0, 100)
  const grade = fitGrade(fit)
  const order = { perfil: 0, engajamento: 1, ia: 2 }
  reasons.sort((a, b) => order[a.grupo] - order[b.grupo])
  return { score, band: bandFor(score), fit, fitGrade: grade, engagement, engagementHigh: engagement >= ENGAGEMENT_HIGH, aiAdjust, quadrant: quadrantFor(grade, engagement), reasons }
}
```

**Atenção:** o teste de reciprocidade da spec usa as últimas 5 (`[true,true,true,false,true]` = 4 × 2 = 8).

- [ ] **Step 4: Implementar `halfLife.js`**

```js
// Meia-vida do esfriamento (spec 5.1): 30% do ciclo mediano de venda da conta, entre 2 e 30 dias; <5 vendas = 7.
export function computeHalfLife(cycleDays) {
  const xs = (cycleDays || []).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
  if (xs.length < 5) return 7
  const m = Math.floor(xs.length / 2)
  const med = xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2
  return Math.max(2, Math.min(30, Math.round(0.3 * med)))
}

// Ciclos (dias) dos ultimos 180 dias: criacao do lead -> primeira venda (lead_sales ou entrada em etapa de conversao).
export function accountCycleDays(db, accountId) {
  const rows = db.prepare(`
    SELECT l.id, l.created_at,
      MIN(COALESCE(
        (SELECT MIN(s.sale_date) FROM lead_sales s WHERE s.lead_id = l.id),
        (SELECT MIN(h.created_at) FROM stage_history h JOIN funnel_stages fs ON fs.id = h.to_stage_id WHERE h.lead_id = l.id AND fs.is_conversion = 1)
      )) AS won_at
    FROM leads l WHERE l.account_id = ? GROUP BY l.id
  `).all(accountId)
  const now = Date.now()
  const out = []
  for (const r of rows) {
    if (!r.won_at || !r.created_at) continue
    const won = Date.parse(r.won_at.replace(' ', 'T') + (r.won_at.length <= 10 ? 'T00:00:00Z' : 'Z'))
    const created = Date.parse(r.created_at.replace(' ', 'T') + 'Z')
    if (!Number.isFinite(won) || !Number.isFinite(created)) continue
    if (now - won > 180 * 86400000) continue
    out.push(Math.max(0, (won - created) / 86400000))
  }
  return out
}
```

Adicionar teste de `accountCycleDays` no mesmo arquivo usando `createRoteiroTestDb`/`seedRoteiroBase`/`addLead` + `lead_sales` (2 leads com venda 10 e 20 dias após criação → `[10, 20]` em qualquer ordem).

- [ ] **Step 5:** testes → PASS. **Step 6: Commit** `feat(termometro): calculadora pura da nota e meia-vida`

---

### Task 3: Coleta, recálculo, gravação e aviso ao vendedor

**Files:** Create `server/services/leadScore/inputs.js`, `server/services/leadScore/recalc.js`, `test/leadScoreRecalc.test.js`

**Interfaces:**
- Consumes: `computeLeadScore`, `getPublishedQuestions(db, accountId, funnelId)` (Task 4 — enquanto Task 4 não existe, `inputs.js` importa de `../roteiro/repo.js`; **executar Task 4 antes desta** se a ordem de execução permitir; o executor deve implementar Task 4 primeiro. Ordem final: 1, 2, 4, 3, 5…)
- Produces:
  - `gatherScoreInputs(db, leadId, { now = new Date() } = {})` → input da `computeLeadScore` ou `null` (lead não existe)
  - `recalcLeadScore(db, leadId, { now, onBandUp })` → resultado gravado ou `null`. Grava `score, score_band, score_fit, score_fit_grade, score_engagement, score_quadrant, score_reasons_json, score_prev (= score anterior), score_at`. Se a faixa subiu para `quente`/`pronto` e `score_alerted_at` não é de hoje (data UTC), chama `onBandUp({ lead, result })` e grava `score_alerted_at`. Leads em etapa `is_terminal`: não recalcula (retorna null).
  - `createScoreScheduler({ db, onBandUp, delayMs = 5000, setTimer = setTimeout })` → `{ schedule(leadId), flushAll() }` — no máximo 1 recálculo por lead por janela.
  - Módulo-singleton para produção: `configureScoreRuntime({ db, onBandUp })` e `scheduleScore(leadId)` (no-op se não configurado).

- [ ] **Step 1: Testes** (usar `createRoteiroTestDb`, `seedRoteiroBase`, `addLead`, `addMessage`; publicar roteiro com `saveDraft` + `publish` da Task 4 com 1 pergunta de opções "Orçamento" [até 5 mil: 0, 5–20 mil: 15, acima de 20 mil: 30] na etapa qualificando; gravar `lead_answers` com a opção de 30):
  - `gatherScoreInputs`: `fit.obtained=30`, `fit.max=30`, `answeredCount=1`, reasons contém `'Orçamento: acima de R$20 mil'`; `daysSinceLastInbound≈0` com inbound agora; `replyDelaysMin` calcula inbound após outbound (outbound há 30 min, inbound há 25 → 5); `lastOutboundReplied` do mais recente para o mais antigo; `buyingTermLast7d` true com inbound "quanto custa?"; `advancedLast7d` true com `stage_history` de 2 dias; `ai` lê `conversation_insights` (analyzed_at há 1 dia → `analyzedDaysAgo` 1); `halfLifeDays` lê `accounts.score_half_life_days`.
  - `recalcLeadScore`: grava colunas, `score_prev` recebe a nota anterior no 2º cálculo; subir para quente chama `onBandUp` 1 vez e não chama de novo no mesmo dia; lead em etapa `venda` (terminal) → retorna `null` e não grava.
  - `createScoreScheduler`: 10 `schedule(id)` seguidos com `setTimer` falso → 1 recálculo quando o timer dispara.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implementar `inputs.js`** — consultas:
  - lead + stage (`is_terminal`) + funil; perguntas publicadas via `getPublishedQuestions`; respostas `lead_answers` do lead.
  - `fit`: para cada pergunta `kind='options'`: `max += Math.max(0, ...points)`; se há resposta com `option_key` → `obtained += option.points`, reason `{texto: \`${pergunta_curta}: ${option.label}\`, pontos}` onde `pergunta_curta` = `bant` traduzido (`budget`→'Orçamento', `authority`→'Quem decide', `need`→'Necessidade', `timeline`→'Prazo') ou o texto da pergunta cortado em 40 caracteres. `totalCount` = nº de perguntas de opções; `answeredCount` = nº respondidas.
  - mensagens do lead (últimas 200, ordem cronológica): `daysSinceLastInbound` do último inbound; `replyDelaysMin`: para cada inbound que vem logo depois de um outbound, `(inbound - último outbound anterior)` em minutos, pegar os 5 mais recentes; `lastOutboundReplied`: agrupar outbound consecutivos em sequências; para as 5 sequências mais recentes (da mais nova para a mais velha) → `true` se existe inbound até 24h depois do último outbound da sequência (sequência com menos de 24h e sem resposta ainda conta como `false`).
  - `buyingTermLast7d`: inbound dos últimos 7 dias contendo (sem acento, minúsculas) algum de `['preco','valor','quanto custa','orcamento','prazo','pagamento','pix','boleto','parcel','contrato','fechar','comprar']`.
  - `advancedLast7d`: existe `stage_history` do lead nos últimos 7 dias com `to_stage.position > from_stage.position`.
  - `ai`: `conversation_insights` do lead.
  - datas SQLite (`YYYY-MM-DD HH:MM:SS`, UTC): converter com `Date.parse(s.replace(' ', 'T') + 'Z')`.
- [ ] **Step 4: Implementar `recalc.js`** conforme interface; `score_reasons_json = JSON.stringify(reasons)`.
- [ ] **Step 5:** PASS; `npm test` verde. **Step 6: Commit** `feat(termometro): coleta, recalculo por lead e aviso de faixa`

---

### Task 4: Repositório do roteiro (rascunho, publicar, versões, BANT)

**Files:** Create `server/services/roteiro/repo.js`, `server/services/roteiro/bantTemplate.js`, `test/roteiroRepo.test.js`

**Interfaces:**
- Produces:
  - `newKey()` → string aleatória 12 hex (`crypto.randomBytes(6).toString('hex')`)
  - `getRoteiro(db, accountId, funnelId)` → `{ funnel, stages: [{id,name,position,is_terminal,is_conversion}], draft: Version|null, published: Version|null, versions: [{id, version, status, published_at}] }` onde `Version = { id, version, status, published_at, questions: Question[], deviations: Deviation[] }`, `Question = { question_key, stage_id, position, text, kind, required: boolean, bant: string|null, ai_hint: string|null, options: [{option_key, label, points, position}] }`, `Deviation = { triggers, reply_text, return_question_key, position }`. Lança `RoteiroError('not_found', 404)` se funil não é da conta.
  - `saveDraft(db, accountId, funnelId, { questions, deviations })` → draft salvo (substitui tudo do rascunho). Valida: texto não vazio (≤ 500), kind válido, opções (tipo opções) com 2..10 itens e label não vazio, pontos inteiros −50..50, `stage_id` pertence ao funil e não é final, `bant` ∈ `budget|authority|need|timeline|null`, desvio com `triggers` e `reply_text` não vazios. Mantém `question_key`/`option_key` enviados; gera se ausentes. Erros: `RoteiroError('invalid', 400, mensagemEmPortugues)`.
  - `publish(db, accountId, funnelId, userId)` → versão publicada nova (copia o rascunho; a publicada anterior vira `archived`; `version = max+1`; rascunho continua existindo como cópia editável). Sem rascunho → `RoteiroError('no_draft', 400, 'Não há rascunho para publicar.')`.
  - `restoreVersion(db, accountId, versionId)` → rascunho substituído pelo conteúdo daquela versão.
  - `createBantDraft(db, accountId, funnelId)` → rascunho = rascunho atual (ou publicado) + 4 perguntas BANT (de `bantTemplate.js`) na 1ª etapa não final, obrigatórias, se ainda não existirem perguntas com aqueles `bant`.
  - `getPublishedQuestions(db, accountId, funnelId)` → `Question[]` da versão publicada (vazio se não há).
  - `getPublishedDeviations(db, accountId, funnelId)` → `Deviation[]`.
  - `class RoteiroError extends Error { constructor(code, status, message) }`
- `bantTemplate.js` exporta `BANT_QUESTIONS`:

```js
export const BANT_QUESTIONS = [
  { bant: 'need', text: 'O que você quer resolver com isso, {nome}?', kind: 'options', required: true,
    options: [{ label: 'Tem um problema claro e urgente', points: 15 }, { label: 'Quer melhorar algo que já tem', points: 8 }, { label: 'Só pesquisando', points: 0 }] },
  { bant: 'budget', text: 'Você já tem uma faixa de investimento em mente?', kind: 'options', required: true,
    options: [{ label: 'Sim, dentro do nosso preço', points: 15 }, { label: 'Sim, mas abaixo do nosso preço', points: 5 }, { label: 'Ainda não definiu', points: 0 }] },
  { bant: 'authority', text: 'Além de você, mais alguém participa dessa decisão?', kind: 'options', required: true,
    options: [{ label: 'Decide sozinho(a)', points: 15 }, { label: 'Decide com outra pessoa', points: 8 }, { label: 'Outra pessoa decide', points: 2 }] },
  { bant: 'timeline', text: 'Para quando você precisa disso?', kind: 'options', required: true,
    options: [{ label: 'Até 30 dias', points: 15 }, { label: 'De 1 a 3 meses', points: 8 }, { label: 'Mais de 3 meses / sem prazo', points: 0 }] },
]
```

- [ ] **Step 1: Testes:** salvar rascunho com 2 perguntas (1 texto, 1 opções) e 1 desvio → `getRoteiro` devolve com keys geradas; salvar de novo com as mesmas keys mantém as keys; validação (texto vazio, opções com 1 item, pontos 60, etapa final, etapa de outro funil) → `RoteiroError` 400 com mensagem em pt; `publish` → versão 1 publicada, `getPublishedQuestions` retorna 2; editar rascunho não muda a publicada; publicar de novo → versão 2, versão 1 `archived`; `restoreVersion(v1)` → rascunho com conteúdo da v1; `createBantDraft` adiciona 4 perguntas na etapa "Novo"… (1ª não final, position menor) e chamar 2× não duplica; funil de outra conta → 404.
- [ ] **Step 2:** FAIL. **Step 3:** Implementar (transações `db.transaction`). **Step 4:** PASS. **Step 5: Commit** `feat(roteiro): rascunho, publicacao, versoes e modelo BANT`

---

### Task 5: Roteiro do lead, respostas e trava

**Files:** Create `server/services/roteiro/variants.js`, `server/services/roteiro/leadRoteiro.js`, `test/leadRoteiro.test.js`

**Interfaces:**
- Consumes: `getPublishedQuestions`, `getPublishedDeviations` (Task 4).
- Produces:
  - `variants.js`: `variantFor(leadId, questionKey)` → `'A'|'B'` (`crypto.createHash('sha1').update(\`${leadId}:${questionKey}\`).digest()[0] % 2 ? 'B' : 'A'`); `activeVariant(db, accountId, questionKey)` → linha `roteiro_variants` com status `testing` ou `null`; `questionTextForLead(db, { accountId, leadId, question, leadName })` → `{ text, variant }` (B só se há teste ativo e sorteio B; troca `{nome}` pelo primeiro nome ou remove `, {nome}`/`{nome}` se sem nome).
  - `leadRoteiro.js`:
    - `getLeadRoteiro(db, { accountId, leadId })` → `{ funnel_id, stage_id, has_roteiro, stages: [{ id, name, position, is_terminal, is_current, questions: [QState] }], next_question_key, progress: { answered, total }, legacy_answers: [{question_key, answer_text, answered_at}] }` com `QState = { question_key, text, text_for_lead, variant, kind, required, bant, options, answer: { option_key, option_label, answer_text, origin, evidence, answered_by, answered_by_name, answered_at } | null, last_ask: { asked_at, replied_at } | null }`. `progress` conta a etapa atual. `next_question_key`: 1ª pendente da etapa atual, obrigatórias antes, por `position`. `legacy_answers`: respostas cujo `question_key` não está mais na versão publicada. Lead de outra conta → `RoteiroError('not_found', 404)`.
    - `pendingRequired(db, { accountId, lead, fromStageId, toStageId })` → perguntas obrigatórias sem resposta das etapas com `position >= from.position && position < to.position` (só se `to.position > from.position`).
    - `checkRoteiroGate(db, lead, toStageId)` → `{ ok: true } | { ok: false, pending: [{ question_key, text, stage_id, stage_name, kind, options }] }`. `ok` se destino `is_terminal`, se destino é anterior/igual, se não há roteiro publicado.
    - `saveAnswer(db, { accountId, leadId, questionKey, optionKey = null, answerText = null, origin, evidence = null, userId = null })` → `{ answer, skipped: boolean }`. Regras: pergunta deve existir na publicada (senão 400 `'Esta pergunta não está mais no roteiro.'`); opções → `optionKey` válido; texto → `answerText` não vazio (≤ 1000). `origin='ia'` **não sobrescreve** resposta `manual` (retorna `skipped: true`). Manual sobrescreve IA. Grava `updated_at`. Limpa `leads.roteiro_no_auto_from_stage` (resposta nova libera avanço automático).
- [ ] **Step 1: Testes:** sem roteiro publicado → `has_roteiro:false`, gate ok; com roteiro (qualificando: Q1 obrigatória opções, Q2 recomendada texto; proposta: Q3 obrigatória texto): lead em "novo"→ mover para "proposta" pendentes = Q1 (etapas novo..qualificando); mover para "venda" ok (final); mover para "novo" (voltar) ok; `next_question_key` = Q1 na etapa qualificando; salvar Q1 manual → gate para proposta ok; IA depois de manual → skipped; manual depois de IA sobrescreve e origem vira manual; `optionKey` inválido → 400; pergunta removida da publicada → aparece em `legacy_answers`; lead de outra conta → 404; `text_for_lead` troca `{nome}` por primeiro nome ("Maria Souza" → "Maria") e sem nome remove `, {nome}`; `variantFor` estável (mesmo resultado 2×) e distribui ~50% em 200 leads (entre 70 e 130 'B').
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** PASS. **Step 5: Commit** `feat(roteiro): roteiro do lead, respostas e trava de etapa`

---

### Task 6: Porta única de troca de etapa + avanço automático + desfazer

**Files:** Create `server/services/stageMove.js`, `test/stageMove.test.js`; Modify `server/services/roteiro/leadRoteiro.js` (adicionar `maybeAutoAdvance`, `undoAutoAdvance`)

**Interfaces:**
- Consumes: `checkRoteiroGate`, `pendingRequired`.
- Produces:
  - `configureStageMoveHooks({ onMoved })` — `onMoved({ db, lead, fromStageId, toStageId, historyId, trigger })` (produção: CAPI, recálculo, asks, SSE). Padrão no-op.
  - `moveLeadToStage(db, { lead, toStageId, trigger, userId = null, notes = null, force = false, gate = true })` → `{ moved: true, fromStageId, toStageId, historyId } | { moved: false, reason: 'same_stage' } | { moved: false, reason: 'roteiro_gate', pending }`. Valida que a etapa pertence ao funil do lead (senão lança `Error('stage_not_in_funnel')`). Com `gate` e sem `force`, consulta `checkRoteiroGate`. UPDATE `leads SET stage_id=?, updated_at=datetime('now')`; INSERT `stage_history(lead_id, from_stage_id, to_stage_id, trigger_type, triggered_by, notes)`; chama `onMoved`.
  - `leadRoteiro.maybeAutoAdvance(db, { accountId, leadId, userId })` → `{ from, to, to_name } | null`: etapa atual tem ≥1 obrigatória, todas respondidas, `roteiro_no_auto_from_stage != stage_id`, próxima etapa (menor `position` maior que a atual) existe e não é final → `moveLeadToStage(..., trigger:'roteiro_auto', gate:false)`.
  - `leadRoteiro.undoAutoAdvance(db, { accountId, leadId, userId })` → volta para `from_stage_id` do último `stage_history` com `trigger_type='roteiro_auto'` se o lead ainda está no `to_stage_id` dele; grava `trigger_type='roteiro_undo'` e `leads.roteiro_no_auto_from_stage = from_stage_id`. Sem avanço para desfazer → `RoteiroError('nothing_to_undo', 400, 'Não há avanço automático para desfazer.')`.
- [ ] **Step 1: Testes:** move normal grava histórico e chama hook; mesma etapa → `same_stage`; travado → `roteiro_gate` com pendentes e **não** grava; `force` grava com `notes`; etapa de outro funil lança; auto-avanço após responder última obrigatória (qualificando → proposta, trigger `roteiro_auto`); não avança se a próxima é final; não avança se etapa sem obrigatórias; desfazer volta e marca; depois de desfazer, `maybeAutoAdvance` não avança de novo; após `saveAnswer` novo (que limpa a marca) avança.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5: Commit** `feat(roteiro): porta unica de troca de etapa, avanco automatico e desfazer`

---

### Task 7: Reconhecimento, envios (asks) e desvios

**Files:** Create `server/services/roteiro/recognize.js`, `asks.js`, `deviations.js`, `test/roteiroAsks.test.js`

**Interfaces:**
- Produces:
  - `recognize.js`: `normalizeWords(text)` → `string[]` (minúsculas, sem acento via `normalize('NFD').replace(/[̀-ͯ]/g,'')`, só `[a-z0-9 ]`, remove stopwords pt `['voce','para','com','que','qual','quais','uma','um','seu','sua','seus','suas','dos','das','nos','nas','por','mais','isso','esse','essa','tem','ter','como','ja','nao','sim','sobre','pra','pro','quem','quando','onde','nome']` e palavras < 3 letras); `recognizeQuestion(text, questions: [{question_key, text}])` → `{ question_key, text, similarity } | null` (similaridade = |interseção| / |palavras da pergunta| ≥ 0,6; pega a maior; `{nome}` removido antes).
  - `asks.js`: `recordAsk(db, { accountId, leadId, questionKey, variant = 'A', textSent, messageId = null, userId = null, source })` → id; `markReplied(db, { leadId, windowHours })` (asks abertos do lead com `asked_at >= now - window` recebem `replied_at=now`); `markAnswered(db, { leadId, questionKey })` (ask mais recente sem `answered_at`); `markAdvanced(db, { leadId })` (asks dos últimos 7 dias sem `advanced_at`); `markBought(db, { leadId })` (últimos 30 dias sem `bought_at`).
  - `deviations.js`: `matchDeviation(text, deviations)` → deviation | null (algum gatilho, normalizado, contido no texto normalizado); `activeDeviationForLead(db, { accountId, lead })` → desvio casado com o último inbound das últimas 24h que ainda não teve outbound depois, com `{ ...deviation, return_question_text }`, ou `null`.
- [ ] **Step 1: Testes:** "Me conta, qual o prazo do seu evento?" reconhece "Qual o prazo do seu evento, {nome}?" ; "Bom dia!" → null; similaridade abaixo de 0,6 → null; markReplied só dentro da janela (ask de 30h atrás com janela 24 não marca); markAnswered/Advanced/Bought nos intervalos; `matchDeviation('Quanto CUSTA?', [{triggers:'preço, quanto custa'}])` casa; `activeDeviationForLead` some depois que sai outbound.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): reconhecimento de pergunta, registro de envios e desvios`

---

### Task 8: Ligar no servidor (rotas existentes, entrada de mensagens, vendas, IA, agendador)

**Files:** Modify `server/routes/leads.js`, `server/routes/messages.js`, `server/services/inboundHandler.js`, `server/services/leadIntake.js`, `server/services/aiAgent.js`, `server/services/conversationAnalyzer.js`, `server/index.js`; Create `server/services/roteiro/runtime.js`, `test/roteiroRuntime.test.js`

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7.
- Produces: `server/services/roteiro/runtime.js` com `bootRoteiroRuntime({ db, broadcastSSE, triggerCapiForStageChange })` que:
  1. `configureScoreRuntime({ db, onBandUp })` — `onBandUp` faz `broadcastSSE(lead.account_id, 'lead:score_up', { lead_id, name, score, band, attendant_id })`.
  2. `configureStageMoveHooks({ onMoved })` — `onMoved`: `triggerCapiForStageChange(lead.id, toStageId, historyId)` SEMPRE (todo caminho que passa a usar `moveLeadToStage` deixa de chamar CAPI por conta própria, para não duplicar); `markAdvanced`; se destino `is_conversion` → `markBought`; `scheduleScore(lead.id)`; `broadcastSSE(accountId, 'lead:updated', { id: lead.id })`.
  3. exporta `onInboundSaved({ db, account, lead, message })` → `markReplied` (janela da conta), `scheduleScore`, `enqueueAiExtract` (no-op até Task 13), e `onOutboundSaved({ db, lead })` → `scheduleScore`, resolve `analyst_alerts` abertos `type='lead_quente_sem_resposta'` do lead (`status='resolved', resolved_at=now`).
- Mudanças:
  - `server/index.js`: após criar app, `bootRoteiroRuntime({ db, broadcastSSE, triggerCapiForStageChange })`.
  - `leads.js PUT /:id/stage` (:591): checar `lead.account_id === req.accountId` (404 se não); usar `moveLeadToStage(db, { lead, toStageId: stage_id, trigger: 'manual', userId: req.user.id, notes, force: !!force_reason && role ∈ gerente/super_admin, gate: true })`; `force_reason` de atendente → 403 `'Só o gestor pode avançar sem as respostas.'`; `reason:'roteiro_gate'` → `409 { code: 'roteiro_gate', error: 'Faltam perguntas obrigatórias para avançar.', pending }`; manter `ai_handed_off_at` e demais efeitos atuais; `notes` gravado = `force_reason` quando forçado com `trigger:'forced'`.
  - `leads.js POST /bulk/stage` (:1090): mover um a um com `moveLeadToStage(..., trigger:'manual', gate:true)`; resposta passa a incluir `blocked: [{ id, name, pending_count }]` e `moved` (contagem).
  - `leads.js POST /:id/sales` (:631): após inserir, `markBought(db, { leadId })` + `scheduleScore`.
  - `messages.js POST /:leadId` (:87) e mídia: após inserir a mensagem outbound, se `req.body.roteiro_question_key` → `recordAsk(..., source: 'button', variant: variantFor(...), messageId)`; senão, se texto, `recognizeQuestion` contra as pendentes da etapa atual (via `getLeadRoteiro`) → incluir `recognized_question` na resposta JSON. Chamar `onOutboundSaved`.
  - `POST /api/roteiro/leads/:leadId/asks` (Task 10) confirma o reconhecido.
  - `inboundHandler.js` após o insert do inbound (~:379-383, só `direction='inbound'`): `onInboundSaved(...)` dentro de try/catch que só loga.
  - `leadIntake.js autoDetectStage` (:96) e follow-up `on_reply_move` (`inboundHandler.js:448`) e `aiAgent.js` (:360 e :473): trocar UPDATE+INSERT manual por `moveLeadToStage(..., gate: true, trigger: <o mesmo trigger_type de hoje>)`; se travado, não move (log `[Roteiro] trava: ...`). Manter os demais efeitos (CAPI passa a sair pelo hook).
  - `conversationAnalyzer.js` após upsert do insight (~:636): `scheduleScore(leadId)`.
- [ ] **Step 1: Testes** (`test/roteiroRuntime.test.js`, com banco de teste e `broadcastSSE`/CAPI falsos): `onMoved` chama CAPI, marca advanced, marca bought em etapa de conversão, agenda nota; `onInboundSaved` marca replied; `onOutboundSaved` resolve alerta aberto. Rodar a suíte inteira para garantir que os testes existentes de inboundHandler/leads/aiAgent seguem verdes (ajustar mocks se precisarem de `configureStageMoveHooks` no-op — padrão já é no-op).
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): trava e termometro ligados nas rotas, mensagens, vendas e IA`

---

### Task 9: Filtros, ordem e nota na API de leads

**Files:** Create `server/services/leadScore/filters.js`, `test/leadScoreFilters.test.js`; Modify `server/routes/leads.js` (lista :101/:127, export :809, novo `GET /:id/score`)

**Interfaces:**
- Produces: `scoreWhere(alias, query)` → `{ sql: string, params: any[] }` para `score_bands` (lista separada por vírgula ∩ BANDS), `score_min` (0..100), `fit=AB` (`score_fit_grade IN ('A','B')`), `engagement=high` (`score_engagement >= 25`). `scoreOrder(alias, query)` → `'alias.score IS NULL, alias.score DESC, COALESCE(alias.last_inbound_at, alias.updated_at) DESC'` quando `sort=score`, senão `null`.
- `GET /api/leads` e `/export`: somar `scoreWhere` ao WHERE (como `cityWhere`), ordem por `scoreOrder` quando pedido; incluir colunas `score, score_band, score_fit_grade, score_engagement, score_quadrant, score_prev` na seleção (e no CSV: "Termômetro", "Faixa").
- `GET /api/leads/:id/score` → `{ score, band, fit, fit_grade, engagement, quadrant, reasons, score_prev, score_at }` (checar conta; atendente com `canAtendenteAccessLead`); se `score_at` nulo, calcula na hora com `recalcLeadScore`.
- [ ] **Step 1: Testes** de `scoreWhere`/`scoreOrder` (valores inválidos ignorados; bandas desconhecidas descartadas; `score_min=abc` ignorado). **Step 2–4.** **Step 5: Commit** `feat(termometro): filtro por faixa/nota/perfil/engajamento e ordem por nota`

---

### Task 10: Rotas do roteiro (gestor e vendedor)

**Files:** Create `server/routes/roteiroRouter.js`, `server/routes/roteiro.js`, `test/roteiroHttp.test.js`; Modify `server/index.js` (montar `/api/roteiro` com `authenticate, scopeToAccount` como os outros)

**Interfaces:** rotas exatamente como spec §7.3; fábrica `createRoteiroRouter(db, { ai = null, now = () => new Date() } = {})`. Gestor (`requireRole('super_admin','gerente')`): `GET /funnels/:funnelId`, `PUT /funnels/:funnelId/draft`, `POST /funnels/:funnelId/publish`, `POST /versions/:id/restore`, `POST /funnels/:funnelId/bant-template`, `POST /funnels/:funnelId/ai-draft` (503 `{error:'A IA não está ligada nesta conta.'}` se `ai` nulo ou conta sem chave — implementação real na Task 13), `GET /performance?funnel_id`, `GET /settings`, `PUT /settings` (`min_reply_rate` 10..100, `reply_window_h` 1..168, `alert_minutes` 5..1440), `GET /suggestions`, `POST /suggestions/:id/test|apply|reject`, `POST /variants/:id/confirm|keep`. Vendedor (qualquer papel, atendente só leads que acessa via `canAtendenteAccessLead`): `GET /leads/:leadId` (inclui `deviation` de `activeDeviationForLead` e `can_force` pelo papel), `PUT /leads/:leadId/answers/:questionKey` (body `{option_key|answer_text}` → `saveAnswer(origin:'manual')` + `markAnswered` + `maybeAutoAdvance` + `scheduleScore`; resposta `{ roteiro, advanced }`), `POST /leads/:leadId/asks` (body `{question_key, message_id}` → `recordAsk(source:'recognized')`), `POST /leads/:leadId/undo-advance`, `GET /leads/:leadId/gate?to_stage_id`. `RoteiroError` → `res.status(e.status).json({ error: e.message, code: e.code })`.
  - Endpoints de desempenho/sugestões usam serviços da Task 12; até lá devolvem `{ questions: [] }` / `{ suggestions: [], tests: [] }` — **executar Task 12 antes desta** se possível (ordem final: …, 11, 12, 10, 13 …); o executor da Task 10 importa as funções reais.
- [ ] **Step 1: Testes HTTP** (padrão de `test/agentBriefingHttp.test.js`: express nu + `authenticate` + `scopeToAccount` + fábrica, `http.createServer().listen(0)`, JWT com `JWT_SECRET`): gestor salva rascunho, publica, lê; atendente recebe 403 nas rotas de gestor; atendente lê roteiro do próprio lead e responde; responder última obrigatória devolve `advanced`; undo; gate devolve pendentes; **lead e funil de outra conta → 404** (gestor da conta B tentando conta A); `PUT /settings` fora da faixa → 400.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): rotas do gestor e do vendedor`

---

### Task 11: Migração da qualificação antiga

**Files:** Create `server/services/roteiro/migrateLegacy.js`, `test/roteiroMigrate.test.js`; Modify `server/db.js` (chamar após `applyRoteiroSchema`), `server/routes/qualifications.js` (rotas `GET /lead/:leadId` e `POST /lead/:leadId/answer` leem/gravam `lead_answers` via `question_key = 'legacy-' + sequence_id`)

**Interfaces:** `migrateLegacyQualifications(db)` → `{ accounts, questions, answers }`; idempotente via `app_settings` key `roteiro_legacy_migrated=1`. Para cada conta com `qualification_sequences` ativas e com funil padrão (`is_default=1`, senão o de menor id): se o funil ainda não tem versão publicada, cria draft+published (versão 1) com as perguntas (`question_key='legacy-'+id`, texto, `kind='text'`, `required=0`, 1ª etapa não final, `position`); `lead_qualifications` com `answer` não vazio → `lead_answers` (`origin='manual'`, `answered_by`, `answered_at`), `INSERT OR IGNORE`.
- [ ] **Step 1: Testes:** migra perguntas/respostas; 2ª execução não duplica; conta com roteiro já publicado não é tocada; conta sem funil é pulada.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): migra a qualificacao antiga para o roteiro`

---

### Task 12: Medição, sugestões sem IA, A/B, noite e avisos ao gestor

**Files:** Create `server/services/roteiro/metrics.js`, `learning.js`, `server/services/leadScore/nightly.js`, `hotLeadAlerts.js`, `businessMinutes.js`, tests `test/roteiroMetrics.test.js`, `test/roteiroLearning.test.js`, `test/leadScoreNightly.test.js`, `test/hotLeadAlerts.test.js`; Modify `server/scheduler.js`

**Interfaces:**
- `metrics.js`: `questionMetrics(db, { accountId, funnelId, days = 90, now })` → `[{ question_key, text, stage_id, sent, reply_rate (0..100|null), advanced_rate, bought_rate, status: 'ok'|'fraca'|'amostra_pequena', by_seller: [{ user_id, name, sent, reply_rate, examples: string[] (até 3 text_sent distintos) }] }]` (fraca: `sent >= 20 && reply_rate < min`; `amostra_pequena`: `sent < 20`; `replied` = `replied_at` não nulo); `conversionByBand(db, { accountId, now })` → `[{ band, leads, bought, rate }]` para as 4 faixas usando `lead_score_daily` do dia `now - 30d` (leads com snapshot naquele dia) e se tiveram `lead_sales` ou entrada em `is_conversion` depois; + `warning: boolean` (rate pronto ≤ rate morno com ≥ 10 leads em cada).
- `learning.js`: `runLearning(db, { accountId, now, ai = null })` → `{ created }`: para cada funil com roteiro publicado, `questionMetrics`; para cada fraca com vendedor (≥10 envios, taxa ≥ mínimo) cria `seller_phrasing` (payload `{ text: exemplo mais frequente, seller_name, seller_rate, current_rate }`) se não existe sugestão `new`/`testing` do mesmo tipo e pergunta; depois `evaluateAbTests(db, { accountId, now })`; com `ai` chama `runAiLearning` (Task 13).
  - `startAbTest(db, { accountId, suggestionId, userId })` → cria `roteiro_variants(status 'testing', text = payload.text)` se não há teste ativo na pergunta (senão 409 `'Esta pergunta já está em teste.'`); sugestão → `testing`.
  - `evaluateAbTests(db, { accountId, now })`: para cada variante `testing`: conta asks A e B desde `started_at` (variant), taxa de resposta de cada; termina se ambos ≥ 30 ou 30 dias; vencedora B se `rateB - rateA >= 5`, A se `rateA - rateB >= 5`, senão empate; grava `status` da variante `won` (B venceu) / `lost` (A venceu ou empate) com `ended_at`; cria `analyst_alerts(type 'roteiro_ab_resultado', severity 'media', title 'Teste A/B terminou', description em pt com as taxas)`.
  - `confirmVariant(db, { accountId, variantId, userId })`: se `won`, troca o texto da pergunta no rascunho (mesmo `question_key`) e `publish`; sugestão ligada → `applied`. `keepCurrent` → sugestão `rejected`.
  - `applySuggestion(db, { accountId, suggestionId, userId })`: `rewrite`/`seller_phrasing` → troca texto no rascunho; `new_option` → adiciona opção `{label, points: 0}`; `new_deviation` → adiciona desvio; `reorder` → aplica `payload.order` (lista de question_key por etapa). Status `applied`. `rejectSuggestion` → `rejected`.
- `businessMinutes.js`: `businessMinutesBetween(scheduleJson, fromDate, toDate, tz = 'America/Sao_Paulo')` → minutos dentro das faixas (`{mon:[{start:'08:00',end:'18:00'}], ...}` chaves `sun..sat`); `null`/inválido → minutos corridos. Iterar minuto a minuto limitado a 7 dias (≤ 10080 iterações) usando `Intl.DateTimeFormat` com `timeZone` para dia/hora locais.
- `hotLeadAlerts.js`: `runHotLeadAlerts(db, { now })` → `{ created }`: leads `score_band IN ('quente','pronto')`, ativos, não arquivados, etapa não final, cuja última mensagem é inbound; minutos úteis desde ela (schedule da instância `COALESCE(lead.instance_id, lead.last_instance_id)` via `instance_auto_messages.away_schedule_json`) ≥ `accounts.score_alert_minutes`; sem alerta `open` do tipo para o lead → cria `analyst_alerts(type 'lead_quente_sem_resposta', severity 'alta', title \`${nome} está ${Faixa} e sem resposta\`, description 'Última mensagem do cliente há X min (horário de atendimento).', suggested_action 'Responda agora: leads respondidos em até 1 hora têm muito mais chance de fechar.', assigned_to_user_id = attendant_id)`.
- `nightly.js`: `runScoreNightly(db, { now, batchSize = 200 })`: para cada conta: `score_half_life_days = computeHalfLife(accountCycleDays(...))`; recalcula leads ativos não arquivados de etapa não final em lotes (try/catch por lead); grava `lead_score_daily` (INSERT OR REPLACE com dia UTC) para todos com nota; apaga snapshots > 120 dias; depois `runLearning` por conta (com `ai` se a conta tiver chave e `canAnalyze`).
- `scheduler.js`: dentro de `runNightlyAnalysis()` (depois da análise de conversas) chamar `runScoreNightly(db, { now: new Date(), ai })` em try/catch; no `tick()` chamar `runHotLeadAlerts(db, { now: new Date() })` a cada 5 ticks (contador), em try/catch.
- [ ] **Step 1: Testes** para cada função (datas controladas com `now`; asks inseridos com `asked_at` explícito): fraca × amostra pequena × ok; por vendedor com exemplos; seller_phrasing criado e não duplicado; A/B: B vence com +5, empate com +3, termina por 30 dias; confirmVariant publica nova versão com o texto B; businessMinutes: sexta 17:30 → segunda 08:30 com horário 08–18 = 60; sem horário = corrido; hot alert criado 1 vez, não cria para lead respondido.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): medicao, sugestoes, teste A/B, noite do termometro e aviso de lead quente`

---

### Task 13: Partes com IA (extração, montar com IA, sugestões com IA)

**Files:** Create `server/services/roteiro/aiExtract.js`, `aiDraft.js`, `aiLearning.js`, tests `test/roteiroAi.test.js`; Modify `server/services/roteiro/runtime.js` (`enqueueAiExtract` real), `server/routes/roteiroRouter.js` (`ai-draft`), `server/services/roteiro/learning.js`

**Interfaces:**
- Todas recebem `ai = { call: async ({ accountId, systemPrompt, messages, tools, toolChoice, maxTokens, source }) => ({ toolUses, usage, costUsd }) }`. Produção: adaptador em `runtime.js` sobre `callHaiku` + `resolveAnthropicKey(accountId)` + INSERT em `ai_agent_token_log` com `source`, e `canAnalyze(accountId)` (de `conversationAnalyzer.js`) antes de chamar (se falso, não chama).
- `aiExtract.js`: `extractAnswers(db, { accountId, leadId, ai })` → `{ saved: [question_key], offscript: {question, suggested_reply}|null }`. Monta com as pendentes da etapa atual (texto, opções com `option_key`, `ai_hint`) + últimas 20 mensagens (`Cliente:`/`Vendedor:`). Ferramenta `record_answers` (`input_schema`: `answers: [{question_key, option_key?, text?, evidence}]`, `off_script?: {question, suggested_reply}`), `toolChoice: {type:'tool', name:'record_answers'}`. Ignora `question_key`/`option_key` desconhecidos; evidence obrigatória (≤ 300). `saveAnswer(origin:'ia')` + `markAnswered` + `maybeAutoAdvance`. Off-script: se `matchDeviation` com a pergunta do cliente → nada; senão grava `roteiro_offscript`. Retorna offscript para o front via SSE `lead:roteiro` `{lead_id, offscript}`. Coalescência: `createExtractQueue({ delayMs: 120000 })` por lead (mesmo padrão do scheduler da Task 3).
- `aiDraft.js`: `buildAiDraft(db, { accountId, funnelId, ai })` → rascunho salvo (via `saveDraft`). Entrada: `agent_briefings.compiled_json` mais recente da conta com status `compilado`/`ativo` (resumo, qualification_criteria, required_fields), `summary` de até 20 `conversation_insights` de leads que compraram, etapas não finais do funil (id, nome). Ferramenta `propose_roteiro` → `{ questions: [{stage_id, text, kind, required, bant?, ai_hint?, options?: [{label, points}]}], deviations: [{triggers, reply_text, return_question_index?}] }`. Garante as 4 BANT (se a IA não trouxe, completa com `BANT_QUESTIONS`). Descarta `stage_id` inválido (vai para a 1ª não final). Erro da IA → `RoteiroError('ai_failed', 502, 'A IA não respondeu agora. Monte à mão ou tente de novo.')`.
- `aiLearning.js`: `runAiLearning(db, { accountId, metricsByFunnel, ai, maxCalls = 5 })` → cria sugestões `rewrite` (payload `{ versions: [texto1, texto2], current_rate }`; o front testa a `versions[0]` ou a escolhida → `startAbTest` aceita `payload.text` ou `payload.versions[i]` via body `{ version_index }`), `new_option` (agrupando ≥ 5 `lead_answers.answer_text` de perguntas texto dos últimos 90 dias: ferramenta devolve `[{question_key, label, count}]`), `new_deviation` (`roteiro_offscript` ≥ 3 parecidas nos últimos 90 dias: `{triggers, reply_text, return_question_key, count}`), `reorder` (quando `metrics` mostra ganho ≥ 15 pts: a IA só redige a explicação; a regra é calculada: payload `{ stage_id, order: [question_key...], gain }`). Máx. `maxCalls` chamadas.
- [ ] **Step 1: Testes com IA falsa** (fila de respostas por `source`): extrai resposta de opções e texto; ignora chave inválida; não sobrescreve manual; auto-avanço após extração; offscript sem desvio grava `roteiro_offscript`; `buildAiDraft` completa BANT e corrige etapa inválida; IA falhando → 502; `canAnalyze` falso → não chama; `runAiLearning` respeita `maxCalls` e não duplica sugestões `new`.
- [ ] **Step 2–4.** **Step 5: Commit** `feat(roteiro): IA extrai respostas, monta rascunho e sugere melhorias`

---

### Task 14: Frontend — termômetro, filtros, ordem e avisos

**Files:** Create `src/lib/score.ts`, `src/components/score/ScoreBadge.tsx`, `src/components/score/ScoreThermometer.tsx`, `src/components/score/ScoreToasts.tsx`, `src/components/HelpTip.tsx`, `src/components/MoreFilters.tsx`, `src/lib/scoreFilter.js`, `test/scoreFilter.test.js`; Modify `src/lib/api.ts`, `src/context/SSEContext.tsx`, `src/pages/Leads.tsx`, `src/pages/Pipeline.tsx`, `src/pages/Chat.tsx`, `src/components/Layout*` (onde fica o layout autenticado — procurar onde `SystemNoticeBanner` é renderizado e colocar `ScoreToasts` ao lado)

**Interfaces:**
- `src/lib/score.ts`: `type ScoreBand = 'frio'|'morno'|'quente'|'pronto'`; `BAND_META: Record<ScoreBand, { label: string, emoji: string, color: string, range: string }>` (`frio: {label:'Frio', emoji:'🧊', color:'#5DADE2', range:'0–30'}`, `morno: {'Morno','🌤','#FBBC04','31–60'}`, `quente: {'Quente','🔥','#FF7A45','61–85'}`, `pronto: {'Pronto p/ fechar','🚀','#34C759','86–100'}`); `QUADRANT_META` (`atender_agora: 'Atender agora — tem perfil e está conversando'`, `reaquecer: 'Reaquecer — tem perfil, mas esfriou'`, `qualificar: 'Qualificar melhor — conversa bastante, perfil ainda fraco'`, `baixa: 'Baixa prioridade — pouco perfil e pouca conversa'`).
- `src/lib/scoreFilter.js` (JS puro testável): `encodeScoreFilter({bands, min, fit, engagement})` → string para localStorage; `parseScoreFilter(str)`; `scoreParams(filter)` → `{ score_bands?, score_min?, fit?, engagement? }`; `isScoreFilterActive(filter)`; `scoreFilterLabel(filter)` → ex.: `'Quente, Pronto · nota ≥ 70'`.
- `ScoreBadge({ score, band, prev, size='sm' })`: `🔥 72 ↑` com cor da faixa; `title` = "Termômetro 72 — Quente. Passe o mouse no lead para ver o porquê." Sem nota: `—` cinza com title "Ainda sem termômetro".
- `ScoreThermometer({ leadId, accountId })`: busca `GET /api/leads/:id/score`, recarrega em SSE `lead:updated`/`lead:score_up` do lead; mostra nota grande, faixa, 2 barras ("Perfil B · 30/50 — tem cara de comprador?" e "Engajamento 38/50 — está interessado agora?"), ação da matriz, lista do porquê (`+30 Orçamento: acima de R$20 mil` verde / negativos vermelhos), "calculado há X min", e `HelpTip` explicando com exemplo: "A nota soma Perfil (respostas do roteiro), Engajamento (como o cliente está respondendo) e um ajuste da IA. Ex.: orçamento acima de R$20 mil (+30) e respondeu hoje (+20) = 50, Morno. Se ele responder rápido e avançar de etapa, vira Quente."
- `HelpTip({ title, children })`: ícone `?` (lucide `HelpCircle` 13px) que abre popover (clique) com texto; fecha em clique fora/Esc.
- `MoreFilters`: substitui o uso direto de `CityFilter` nas telas: botão "Mais filtros..." (com contador de filtros ativos) abrindo painel com seção **Local** (o conteúdo atual do `CityFilter` — reaproveitar o componente internamente) e seção **Termômetro** (chips das 4 faixas, campo "Nota mínima" com placeholder "ex.: 70", checkboxes "Só perfil A/B" e "Só engajamento alto", HelpTip "Ex.: marque Quente e Pronto para ver quem está mais perto de comprar"). Estado persistido por conta em localStorage (`scoreFilter:<accountId>`), try/catch.
- Leads: nova coluna "Termômetro" (depois de Etapa) com `ScoreBadge`; clique no cabeçalho alterna `sort=score`; filtros enviados via `scoreParams`; CSV idem.
- Pipeline: `ScoreBadge` no cartão desktop (:369-395) e mobile (:235); filtros via `scoreParams`.
- Chat: `ScoreBadge` na lista de conversas ao lado do nome; seletor "Ordenar: Mais recentes | Termômetro" acima da lista (quando Termômetro: envia `sort=score` e, no `filteredLeads`, ordena por `score` desc antes do critério atual — não reordenar não lidos primeiro nesse modo); `ScoreThermometer` no topo da aba Info do painel direito (:1614, antes do seletor de etapa); filtros via `scoreParams`.
- `ScoreToasts`: escuta `lead:score_up`; mostra toast só se `attendant_id === user.id` ou (sem atendente e usuário é gerente/admin): "🔥 Maria passou para Quente (72). Responda agora — quem responde em até 1 hora vende muito mais." + [Abrir conversa] (navega `/chat?lead_id=`); some em 12 s; empilha no máximo 3.
- `SSEContext.tsx`: adicionar `'lead:score_up'`, `'lead:roteiro'`, `'lead:read'`, `'message:status'` à lista.
- `api.ts`: tipos `LeadScore` e `fetchLeadScore(leadId, accountId)`; `WhatsApp`… incluir campos `score, score_band, score_prev, score_fit_grade, score_engagement, score_quadrant` no tipo `Lead`.
- [ ] **Step 1: Teste JS** `test/scoreFilter.test.js` (encode/parse ida e volta, params, label, inválidos).
- [ ] **Step 2–4:** implementar; `npx tsc --noEmit` sem erros NOVOS nos arquivos tocados (os 16 antigos continuam); `npx vite build` ok.
- [ ] **Step 5: Commit** `feat(termometro): selo, termometro com o porque, filtros, ordem e avisos na tela`

---

### Task 15: Frontend — roteiro no Chat, na ficha e trava

**Files:** Create `src/lib/roteiroApi.ts`, `src/components/roteiro/RoteiroCard.tsx`, `src/components/roteiro/StageGateModal.tsx`, `src/components/roteiro/RecognizedQuestionBar.tsx`; Modify `src/pages/Chat.tsx`, `src/pages/LeadDetail.tsx`, `src/pages/Pipeline.tsx`, `src/pages/Leads.tsx` (ação em massa de etapa), `src/lib/api.ts` (`moveLeadStage` passa `force_reason` e trata 409)

**Interfaces:**
- `roteiroApi.ts`: tipos espelhando §Task 5 (`LeadRoteiro`, `QState`) e funções `fetchLeadRoteiro(leadId, accountId)`, `saveLeadAnswer(leadId, accountId, questionKey, { option_key?, answer_text? })` → `{ roteiro, advanced }`, `confirmAsk(leadId, accountId, questionKey, messageId)`, `undoAdvance(leadId, accountId)`, `fetchGate(leadId, accountId, toStageId)`; gestor: `fetchRoteiro(funnelId)`, `saveDraft`, `publishRoteiro`, `restoreVersion`, `bantTemplate`, `aiDraft`, `fetchPerformance`, `fetchRoteiroSettings`, `saveRoteiroSettings`, `fetchSuggestions`, `suggestionAction(id, 'test'|'apply'|'reject', body?)`, `variantAction(id, 'confirm'|'keep')`. Todas passam `account_id` como as demais do `api.ts` (seguir o padrão de `apiFetch` com conta — **super_admin precisa do account_id**).
- `moveLeadStage`: em 409 `code==='roteiro_gate'` lança erro tipado `RoteiroGateError { pending }`.
- `RoteiroCard({ leadId, accountId, mode: 'chat'|'full', onAsk(text, questionKey), canForce })`: layout da spec §4.1 (cabeçalho com etapa + progresso; ▶ Pergunte agora; Pendentes; Respondidas recolhível; desvio com [Usar] → `onAsk(reply_text)`); responder inline (texto: textarea com placeholder de exemplo "ex.: quer para o casamento em março"; opções: botões); origem com ícone 🤖/👤 e trecho da IA em itálico; lápis corrige. Após salvar: se `advanced`, faixa verde "✅ Avançou para 'X' — todas as perguntas de 'Y' respondidas. [Desfazer]". Tela vazia: "Este funil ainda não tem roteiro." + (gestor) link "Montar roteiro" / (vendedor) "Peça ao gestor para montar em Qualificação." Modo `full`: todas as etapas + "Respostas de perguntas antigas". Recarrega em SSE `lead:updated`/`lead:roteiro` do lead; `lead:roteiro` com `offscript` mostra aviso de desvio da IA.
- `StageGateModal({ leadId, accountId, toStage, pending, canForce, onDone(moved: boolean), onAsk(text, questionKey) })`: título "Para avançar para 'X' falta saber:"; por pendente: [Escrever a resposta] (abre input/opções inline, salva com `saveLeadAnswer`) e [Perguntar agora] (fecha e chama `onAsk`); quando todas respondidas, tenta mover de novo automaticamente; gestor: "Avançar mesmo assim" com textarea obrigatória "Motivo (ex.: cliente já chegou decidido, fechou por telefone)".
- `RecognizedQuestionBar({ question, onYes, onNo })`: barra acima da caixa de mensagem: "Você perguntou '<texto>'? [✓ Sim] [Não]".
- Chat: `RoteiroCard` logo abaixo do `ScoreThermometer`; `onAsk` coloca texto na caixa de mensagem (mesmo estado do input atual) e guarda `pendingQuestionKey` que vai no `POST /api/messages/:leadId` como `roteiro_question_key` (limpa após enviar ou se o texto for apagado); resposta do envio com `recognized_question` mostra `RecognizedQuestionBar` → Sim chama `confirmAsk`. `handleStageChange`/`doMoveStage` (:941/:974): capturar `RoteiroGateError` → abrir `StageGateModal`.
- LeadDetail: aba "Qualificação" (:526-580) passa a renderizar `RoteiroCard mode='full'`; troca de etapa (:271) trata `RoteiroGateError` com o modal (onAsk navega para `/chat?lead_id=`).
- Pipeline: drop (:351) trata `RoteiroGateError` (reverte o cartão e abre modal; onAsk navega para o Chat).
- Leads (em massa): mostra resultado "12 movidos · 3 travados por perguntas pendentes" com lista de nomes linkados.
- [ ] **Step 1:** implementar; **Step 2:** `npx tsc --noEmit` (sem erros novos) e `npx vite build`; **Step 3: Commit** `feat(roteiro): cartao do roteiro no Chat e na ficha, trava com caminho para destravar`

---

### Task 16: Frontend — tela do gestor "Qualificação"

**Files:** Create `src/pages/qualificacao/QualificacaoPage.tsx`, `RoteiroEditor.tsx`, `DesempenhoTab.tsx`, `SugestoesTab.tsx`; Modify `src/App.tsx` (rota `/qualifications` passa a renderizar `QualificacaoPage`), `src/components/Sidebar.tsx` (manter item "Qualificação" — texto com acento), apagar `src/pages/Qualifications.tsx`

**Interfaces / conteúdo:**
- `QualificacaoPage`: título "Qualificação" + HelpTip ("O roteiro diz ao vendedor o que perguntar em cada etapa. As respostas alimentam o termômetro do lead. Ex.: na etapa Qualificando, pergunte orçamento, prazo e quem decide."); abas Roteiro | Desempenho | Sugestões e testes (aba na URL `?tab=`); seletor de funil (lista de funis da conta, padrão o `is_default`).
- `RoteiroEditor`: colunas por etapa (rolagem horizontal no mobile); cartões editáveis (texto com placeholder "ex.: Para quando você precisa disso, {nome}?", obrigatória/recomendada, tipo, opções com pontos (placeholder "ex.: Até 30 dias" / pontos "ex.: 15"), BANT (select "Nenhum/Orçamento/Quem decide/Necessidade/Prazo"), dica para a IA (placeholder "ex.: aceite respostas como 'mês que vem' = De 1 a 3 meses")); botões mover ↑/↓ e "mover para etapa" (select) — arrastar é opcional; "+ Pergunta" por etapa; lista de desvios com gatilhos (placeholder "ex.: preço, valor, quanto custa"), resposta (placeholder "ex.: Consigo te passar o valor certinho assim que entender o tamanho do evento. Quantos convidados?"), "volte para" (select de pergunta). Barra "Mudanças não publicadas" com [Salvar rascunho] [Publicar]; "Versões anteriores" com [Restaurar]; tela vazia com exemplo + [Começar com modelo BANT] + [Montar com IA] (desabilitado com title "Ligue a IA em Integrações > IA" quando a conta não tem IA — usar `account.ai` já disponível no app ou `GET /roteiro/funnels/:id` retornar `ai_available`); indicador "Perfil máximo deste roteiro: N pontos".
- `DesempenhoTab`: configurações (mínimo %, prazo h, aviso min) com HelpTips e exemplo; tabela de perguntas (status colorido com legenda "🟢 ok · 🔴 fraca · ⚪ amostra pequena (menos de 20 envios)"); abrir pergunta → por vendedor + exemplos + botão "Usar o jeito de <nome> como versão B" (cria sugestão seller_phrasing e inicia teste via rotas); quadro "Taxa de venda por faixa" com aviso quando `warning`.
- `SugestoesTab`: cartões com número que justifica (ex.: "Esta pergunta perde 38% dos clientes (taxa 62% em 45 envios). A versão abaixo teve 81% com a Ana."), ações; testes em andamento com barras A × B e dias restantes; resultados com [Confirmar vencedora]/[Manter a atual]. Tela vazia: "Ainda sem sugestões. Elas aparecem depois que as perguntas forem enviadas algumas vezes (a análise roda toda madrugada)."
- [ ] **Step 1:** implementar; **Step 2:** tsc sem erros novos + build; **Step 3: Commit** `feat(roteiro): tela do gestor com roteiro, desempenho e sugestoes`

---

### Task 17: Verificação final

- [ ] `npm test` inteiro verde; `npx tsc --noEmit` só com os 16 erros antigos; `npx vite build` ok.
- [ ] Subir o CRM local (servidor + vite, `.env` exportado) e conferir no navegador (o dono faz o login): Qualificação (criar BANT, editar, publicar, desempenho vazio explicado), Chat (termômetro, cartão do roteiro, perguntar, responder, avanço automático + desfazer, trava ao mudar etapa, reconhecimento), Leads (coluna, ordenar, filtros), Pipeline (selo, trava no arrastar), ficha do lead.
- [ ] Anotar e corrigir o que falhar; commit final.

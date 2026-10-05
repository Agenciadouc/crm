# SPIN — Entrega 2: Revisão Semanal Automática — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma vez por semana, por conta com IA, a IA lê as conversas dos últimos 7 dias e sugere perguntas SPIN novas, perfis novos, opções novas e reescritas — tudo na aba de sugestões, nada muda sozinho.

**Architecture:** Serviço novo `server/services/roteiro/weeklyReview.js`, chamado pelo job noturno (`leadScore/nightly.js`) depois do aprendizado diário; guarda a última rodada em `roteiro_weekly_runs`. As sugestões entram na tabela existente `roteiro_suggestions` (reconstruída para aceitar os tipos `new_question` e `new_profile`). Aplicar `new_question` soma a pergunta à cadência da etapa e publica (mesmo caminho do `addQuestionSteps`); aplicar `new_profile` cria o perfil.

**Tech Stack:** igual à Entrega 1 (Node 16 em produção, better-sqlite3, React + TS).

**Spec:** `docs/superpowers/specs/2026-10-02-spin-selling-design.md` §10 (e §3.9, §11, §12).

## Global Constraints

- Banco antigo do servidor: só `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` e reconstrução de tabela (cria nova, copia com os mesmos ids, troca o nome) — mesmo padrão de `rebuildCadenceAttempts`.
- Roda 1x por semana por conta (7 dias desde a última rodada), só conta com IA ligada (`aiForAccount` devolve adaptador) e com roteiro publicado; usa o orçamento de IA do roteiro (o adaptador já confere).
- Só conversas da própria conta (`sampleConversations(db, { accountId, days: 7 })`).
- Não duplica sugestão ainda sem decisão (`status = 'new'`) do mesmo tipo e mesmo conteúdo.
- Nada muda sozinho: só sugestões. Texto da tela: "da revisão semanal".
- Máximo 6 perfis por conta continua valendo ao aplicar `new_profile`.

## Review Focus

- Banco de produção com `roteiro_suggestions` cheia e `roteiro_variants.suggestion_id` apontando para ela — a reconstrução mantém ids e linhas (Tarefa 1).
- IA devolvendo etapa de contato/final, perfil inexistente, pergunta sem opções ou lixo — vira sugestão saneada ou é descartada, nunca erro (Tarefa 2).
- Aplicar `new_profile` quando a conta já tem 6 perfis — mensagem clara, sugestão continua "nova" (Tarefa 3).
- Aplicar `new_question` numa etapa cuja cadência ainda não existe — cria a cadência da etapa (Tarefa 3).
- Conta sem conversas na semana — registra a rodada e não chama a IA (Tarefa 2).

---

### Task 1: Tabela de sugestões aceita os tipos novos + registro das rodadas

**Files:**
- Modify: `server/services/roteiro/schema.js`
- Test: `test/roteiroWeekly.test.js` (novo)

**Interfaces:**
- Produces: `SUGGESTION_TYPES` (lista com `new_question`, `new_profile`), `rebuildSuggestionsIfNeeded(db) → { rebuilt: boolean, count: number|null }` (chamada no fim de `applyRoteiroSchema`); tabela `roteiro_weekly_runs (account_id INTEGER PRIMARY KEY, ran_at TEXT NOT NULL)`.

- [ ] **Step 1: Teste que falha:**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'

function oldSuggestionsTable(db) {
  db.exec(`DROP TABLE roteiro_suggestions; CREATE TABLE roteiro_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER, question_key TEXT,
    type TEXT NOT NULL CHECK (type IN ('rewrite','seller_phrasing','new_option','new_deviation','reorder')),
    payload_json TEXT NOT NULL, evidence_json TEXT,
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','testing','applied','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_by INTEGER, decided_at TEXT)`)
}

test('reconstroi roteiro_suggestions mantendo ids e linhas; aceita tipos novos; idempotente', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  oldSuggestionsTable(db)
  db.prepare("INSERT INTO roteiro_suggestions (id, account_id, type, payload_json, status) VALUES (7, ?, 'rewrite', '{}', 'testing')").run(s.accountId)
  assert.throws(() => db.prepare("INSERT INTO roteiro_suggestions (account_id, type, payload_json) VALUES (?, 'new_question', '{}')").run(s.accountId))
  applyRoteiroSchema(db)
  assert.deepEqual(db.prepare('SELECT id, type, status FROM roteiro_suggestions').all(), [{ id: 7, type: 'rewrite', status: 'testing' }])
  for (const t of ['new_question', 'new_profile']) db.prepare("INSERT INTO roteiro_suggestions (account_id, type, payload_json) VALUES (?, ?, '{}')").run(s.accountId, t)
  assert.ok(db.prepare('SELECT id FROM roteiro_suggestions WHERE type = ?').get('new_profile').id > 7)
  applyRoteiroSchema(db)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roteiro_suggestions').get().n, 3)
  db.prepare("INSERT INTO roteiro_weekly_runs (account_id, ran_at) VALUES (?, datetime('now'))").run(s.accountId)
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/roteiroWeekly.test.js`.
- [ ] **Step 3: Implementar** em `schema.js`: mudar o CHECK do `CREATE TABLE IF NOT EXISTS roteiro_suggestions` para `type IN ('rewrite','seller_phrasing','new_option','new_deviation','reorder','new_question','new_profile')`; criar `roteiro_weekly_runs`; função:

```js
export const SUGGESTION_TYPES = ['rewrite', 'seller_phrasing', 'new_option', 'new_deviation', 'reorder', 'new_question', 'new_profile']
const SUGGESTION_COLUMNS = 'id, account_id, funnel_id, question_key, type, payload_json, evidence_json, status, created_at, decided_by, decided_at'

// SQLite nao altera CHECK: cria a tabela nova, copia com os MESMOS ids, confere e troca.
// Nenhuma FK aponta para roteiro_suggestions (roteiro_variants.suggestion_id e so numero).
export function rebuildSuggestionsIfNeeded(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'roteiro_suggestions'").get()
  if (!row || row.sql.includes("'new_profile'")) return { rebuilt: false, count: null }
  const count = db.prepare('SELECT COUNT(*) AS n FROM roteiro_suggestions').get().n
  const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'roteiro_suggestions'").get()
  db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS roteiro_suggestions_new')
    db.exec(`CREATE TABLE roteiro_suggestions_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER, question_key TEXT,
      type TEXT NOT NULL CHECK (type IN (${SUGGESTION_TYPES.map(t => `'${t}'`).join(',')})),
      payload_json TEXT NOT NULL, evidence_json TEXT,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','testing','applied','rejected')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), decided_by INTEGER, decided_at TEXT)`)
    db.exec(`INSERT INTO roteiro_suggestions_new (${SUGGESTION_COLUMNS}) SELECT ${SUGGESTION_COLUMNS} FROM roteiro_suggestions`)
    const copied = db.prepare('SELECT COUNT(*) AS n FROM roteiro_suggestions_new').get().n
    if (copied !== count) throw new Error(`copia incompleta de roteiro_suggestions (${copied} de ${count})`)
    db.exec('DROP TABLE roteiro_suggestions')
    db.exec('ALTER TABLE roteiro_suggestions_new RENAME TO roteiro_suggestions')
    if (seqRow) db.prepare("UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = 'roteiro_suggestions'").run(seqRow.seq)
  })()
  return { rebuilt: true, count }
}
```

  e no fim de `applyRoteiroSchema`: `try { const r = rebuildSuggestionsIfNeeded(db); if (r.rebuilt) console.log(\`[Roteiro] roteiro_suggestions reconstruida: \${r.count} sugestoes\`) } catch (e) { console.error('[Roteiro] reconstrucao de roteiro_suggestions FALHOU (sugestoes novas serao recusadas):', e.message) }`.
- [ ] **Step 4: Rodar** — `npm test` verde.
- [ ] **Step 5: Commit** — `feat(roteiro): sugestoes aceitam pergunta e perfil novos; registro da revisao semanal`

---

### Task 2: A revisão semanal

**Files:**
- Create: `server/services/roteiro/weeklyReview.js`
- Modify: `server/services/leadScore/nightly.js`
- Test: `test/roteiroWeekly.test.js`

**Interfaces:**
- Consumes: `sampleConversations` (E1), `getBusiness`, `getRoteiro`, `isContactStage`, `SPIN_KEYS`, `toolInput`, `resolveNow`.
- Produces: `WEEK_DAYS = 7`; `runWeeklyReview(db, { accountId, ai, now }) → Promise<{ ran: boolean, created: number }>`; nightly soma `created` em `totals.suggestions`.

Payloads gravados (`evidence_json` sempre com `{ source: 'weekly', reason, count }`):
- `new_question`: `funnel_id`, `payload { stage_id, stage_name, text, spin, profile_key, profile_name, options: [{ label, points }] }`.
- `new_profile`: `funnel_id: null`, `payload { name, description }`.
- `new_option`: `question_key`, `funnel_id`, `payload { question_key, label, count }` (formato do aprendizado diário).
- `rewrite`: `question_key`, `funnel_id`, `payload { versions: [string, string], current_rate: null }` (formato do aprendizado diário; segue para A/B como hoje).

- [ ] **Step 1: Testes que falham** (IA falsa como em `roteiroAi.test.js`):
  1. Primeira rodada com conversas da semana → chama a IA uma vez (source `roteiro_weekly`), grava as 4 espécies saneadas, registra `roteiro_weekly_runs`; segunda chamada no mesmo dia → `{ ran: false }` sem chamar; 8 dias depois → roda de novo.
  2. Saneamento: pergunta em etapa de contato/final/inexistente vai para a 1ª etapa de conversa; `profile_key` inexistente vira `null`; pergunta com menos de 2 opções é descartada; `spin` inválido vira `null`; perfil novo com nome igual (sem acento/maiúscula) a um existente é descartado; opção nova para pergunta inexistente ou de texto é descartada; reescrita com menos de 2 versões é descartada.
  3. Não duplica: sugestão `new` igual (mesmo tipo + texto/nome/rótulo normalizado) já existente → não grava de novo.
  4. Sem IA (`ai: null`), sem roteiro publicado, ou sem conversas na semana → não chama a IA; sem conversas registra a rodada.
  5. IA falha → `{ ran: true, created: 0 }`, rodada registrada (tenta na semana que vem), erro só no log.
  6. Nightly: `runScoreNightly(db, { now, aiForAccount: () => ai })` chama a revisão semanal e soma `suggestions`.

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `weeklyReview.js`: carrega roteiro publicado de cada funil da conta (`SELECT DISTINCT funnel_id FROM roteiro_versions WHERE account_id = ? AND status = 'published'`), lista perguntas (key, etapa, perfil, fase, texto, opções) e etapas marcadas contato/conversa; prompt com objetivo, perfis, roteiro atual e a amostra; ferramenta `propose_review` com `new_questions[{ funnel_id, stage_id, profile_key, spin, text, options[{label, points}], reason, count }]`, `new_profiles[{ name, description, reason, count }]`, `new_options[{ question_key, label, count }]`, `rewrites[{ question_key, versions[], reason }]`; `maxTokens: 4000`; limites: até 10 perguntas, 3 perfis, 10 opções, 5 reescritas por rodada. Registro da rodada com `INSERT OR REPLACE` antes de chamar a IA. Nightly: depois do `runLearning`, `if (ai) { const w = await runWeeklyReview(db, { accountId, ai, now }); totals.suggestions += w.created }` dentro de `try/catch` próprio.
- [ ] **Step 4: Rodar** — `npm test` verde.
- [ ] **Step 5: Commit** — `feat(roteiro): revisao semanal da IA com perguntas, perfis, opcoes e reescritas`

---

### Task 3: Aplicar pergunta nova e perfil novo

**Files:**
- Modify: `server/services/cadence/repo.js` (`applySuggestionLive`), `server/services/roteiro/learning.js` (`applySuggestion` recusa os tipos novos com 400 "Aplique pela tela de Cadências.")
- Test: `test/cadenceRepo.test.js`, `test/cadencesHttp.test.js`

**Interfaces:**
- Produces: `applySuggestionLive` → `new_question`: `addQuestionSteps(db, accountId, { stageId: p.stage_id, questions: [{ text, kind: 'options', required: false, spin, profile_key (só se ainda existir), ai_hint: null, options }] , userId })`, marca `applied`, devolve `{ published: true, funnel_id, cadence_ids: [cadence.id] }`; `new_profile`: `saveBusiness` com os perfis atuais + o novo (erro "Máximo de 6 perfis." mantém a sugestão `new`), marca `applied`, devolve `{ published: false, funnel_id: null, cadence_ids: [] }`.

- [ ] **Step 1: Testes que falham:** aplicar `new_question` numa etapa sem cadência cria a cadência com o passo pergunta e publica (pergunta aparece no publicado e na cadência); com perfil apagado nesse meio tempo vira "Todos"; aplicar `new_profile` cria o perfil; com 6 perfis → 400 "Máximo de 6 perfis." e sugestão continua `new`; sugestão de outra conta → 404; já decidida → 409; rota `POST /api/cadences/suggestions/:id/apply` devolve 200 e manda `cadence:updated`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (dentro da transação de `applySuggestionLive`, antes do caminho antigo: lê a sugestão; `status !== 'new'` → 409 "Essa sugestão já foi decidida."; despacha por tipo; marca com `UPDATE roteiro_suggestions SET status = 'applied', decided_by = ?, decided_at = datetime('now')`).
- [ ] **Step 4: Rodar** — `npm test` verde.
- [ ] **Step 5: Commit** — `feat(cadencias): aplicar pergunta nova e perfil novo da revisao semanal`

---

### Task 4: Telas das sugestões da revisão semanal

**Files:**
- Modify: `src/lib/roteiroApi.ts` (`SuggestionType` + `'new_question' | 'new_profile'`), `src/lib/roteiroManager.js` (`SUGGESTION_TITLES` e `suggestionWhy` para os 2 tipos novos e texto "da revisão semanal" quando `evidence.source === 'weekly'`), `src/lib/stageCadence.js(.d.ts)` (`newQuestionSuggestions(suggestions, stageId)` e `newProfileSuggestions(suggestions)`), `src/pages/cadencias/StageCadences.tsx` (cartões de pergunta nova na etapa, como os de "Trocar a ordem", com [Aplicar]/[Ignorar]), `src/pages/cadencias/BusinessProfilesCard.tsx` (perfis sugeridos com [Criar perfil]/[Ignorar], recarrega depois)
- Test: `test/stageCadence.test.js`, `test/roteiroManager.test.js`

- [ ] **Step 1: Testes que falham:** filtros por etapa/tipo; `suggestionWhy` de `new_question` = `Da revisão semanal: <reason> Ex.: "<text>" (<Fase>, perfil <nome ou Todos>).`; de `new_profile` = `Da revisão semanal: <reason> Apareceu em <count> conversas.`; `new_option`/`rewrite` com `evidence.source === 'weekly'` começam com "Da revisão semanal:".
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as telas (aplicar = `applySuggestionLive`; ignorar = `suggestionAction(id, accountId, 'reject')`).
- [ ] **Step 4: Rodar** — `npm test`, `npx tsc --noEmit` (16 antigos), `npm run build`.
- [ ] **Step 5: Commit** — `feat(cadencias): sugestoes da revisao semanal na tela`

---

### Task 5: Conferência final

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build`; revisão final da branch por revisor novo; corrigir críticos/importantes com TDD; conferir no navegador (sugestão semanal inserida à mão no banco local aparece e aplica); atualizar memória; push só com ok do dono.

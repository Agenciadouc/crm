# SPIN por Perfil de Cliente Ideal — Entrega 1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o BANT pelo SPIN Selling no roteiro, com perguntas por perfil de cliente ideal, identificação do perfil do lead (IA, opção de descoberta, manual) e "Montar com IA" lendo as conversas reais da conta.

**Architecture:** O roteiro continua sendo o motor (versões publicadas em `roteiro_*`); a cadência da etapa continua sendo a tela. Entra uma regra única `appliesToLead(question, leadProfileKey)` em `server/services/roteiro/profiles.js`, aplicada em todo lugar que trata perguntas de UM lead. Perfis ficam numa tabela nova `roteiro_profiles` por conta; o lead guarda `roteiro_profile_key` + origem. A IA de montar ganha uma amostra de conversas reais (`conversationSample.js`) e marca etapas de contato × conversa (`stageKind.js`).

**Tech Stack:** Node 20 (produção roda Node 16 — nada de `fetch` global nem sintaxe nova), Express, better-sqlite3 (SQLite antigo do servidor: só `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN`), React + TypeScript (Vite), testes `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-02-spin-selling-design.md` (seções 3 a 9, 11, 12 = Entrega 1).

## Global Constraints

- Banco: nada de `DROP COLUMN`/`RENAME COLUMN`; tudo idempotente no boot. A coluna `roteiro_questions.bant` fica morta (não ler, não escrever).
- Chaves SPIN: `situation | problem | implication | need_payoff`; rótulos: Situação / Problema / Implicação / Necessidade de Solução.
- Máximo 6 perfis por conta; nome até 60; "como reconhecer" até 500; objetivo do negócio até 300 caracteres.
- Erros exatos: "Fase SPIN inválida." · "Perfil inválido." · "Máximo de 6 perfis." · "Este perfil tem perguntas. Mude ou apague as perguntas antes." · "A IA não respondeu agora. Monte à mão ou tente de novo."
- Tudo isolado por conta (`account_id`); nada lê conversa de outra conta.
- Texto de tela em PT-BR, com exemplo (regra "explica com exemplo" do CRM).
- Servidor e front sobem juntos: o campo `bant` some da API e vira `spin`.
- Conta com 0 perfis: tudo igual a hoje. Conta com 1 perfil: esse perfil vale para todo lead sem perfil (perfil efetivo), sem pergunta de descoberta.

## Review Focus

- Perfil apagado/alterado com leads que já têm respostas — as respostas ficam guardadas, só deixam de contar; nada pode quebrar (testado na Tarefa 2 e Tarefa 3).
- Restaurar versão antiga do roteiro que cita perfil que não existe mais — deve restaurar com o perfil virando "Todos", não dar 400 (Tarefa 1).
- IA devolvendo `profile_key` inventado ou tentando trocar perfil marcado à mão — ignora (Tarefa 4).
- Conversa com nome/telefone do lead no texto — o nome e o telefone saem trocados por `[cliente]`/`[telefone]` antes de ir para a IA (Tarefa 5).
- Lead em etapa de conversa com perguntas de outro perfil na cadência — passo "não se aplica": não vira próximo passo, não trava, não conta no total (Tarefa 3).

---

## Mapa de arquivos

| Arquivo | O que faz |
|---|---|
| `server/services/roteiro/schema.js` (mod) | colunas novas, tabela `roteiro_profiles`, migração bant→spin |
| `server/services/roteiro/spinTemplate.js` (novo, substitui `bantTemplate.js`) | modelo SPIN de 6 perguntas + `SPIN_KEYS`, `SPIN_LABEL`, `SPIN_ORDER` |
| `server/services/roteiro/stageKind.js` (novo) | `isContactStage`, `conversationStages` |
| `server/services/roteiro/profiles.js` (novo) | CRUD de perfis, `appliesToLead`, perfil efetivo do lead, `setLeadProfile` |
| `server/services/roteiro/repo.js` (mod) | `spin`, `profile_key`, `sets_profile_key`; `createSpinDraft` |
| `server/services/roteiro/leadRoteiro.js` (mod) | filtra por perfil; `saveAnswer` grava perfil pela opção |
| `server/services/roteiro/autoAdvance.js` (mod) | só obrigatórias aplicáveis |
| `server/services/cadence/nextStep.js`, `leadCadence.js` (mod) | passo "não se aplica" |
| `server/services/leadScore/inputs.js` (mod) | Perfil só das aplicáveis; rótulo SPIN |
| `server/services/roteiro/aiExtract.js` (mod) | IA identifica perfil na mesma chamada |
| `server/services/roteiro/conversationSample.js` (novo) | amostra de conversas reais da conta |
| `server/services/roteiro/aiDraft.js` (mod) | SPIN por perfil, etapas de contato, conversas reais |
| `server/services/roteiro/aiProfiles.js` (novo) | "Sugerir com IA" objetivo + perfis |
| `server/services/cadence/repo.js` (mod) | `spinStepQuestions`, `projectQuestion`, stage-view com `is_contact` e `profiles` |
| `server/routes/roteiroRouter.js`, `cadencesRouter.js`, `roteiro.js` (mod) | rotas de perfis, perfil do lead, `/spin-template`, modo `'spin'` |
| `src/lib/roteiroApi.ts`, `cadenceApi.ts`, `stageCadence.js(.d.ts)`, `roteiroManager.js(.d.ts)` (mod) | tipos e chamadas |
| `src/pages/cadencias/BusinessProfilesCard.tsx` (novo) | cartão "Negócio e clientes ideais" |
| `src/pages/cadencias/StepPanel.tsx`, `StageEmpty.tsx`, `StepRow.tsx`, `StageCadences.tsx` (mod) | Fase SPIN, Perfil, define perfil, selo, aviso de etapa de contato |
| `src/components/roteiro/LeadProfileSelect.tsx` (novo) | seletor "Perfil do lead" (Chat e ficha) |
| `src/pages/Chat.tsx`, `src/pages/LeadDetail.tsx` (mod) | encaixe do seletor |

---

### Task 1: Dados, modelo SPIN, etapa de contato e repositório

**Files:**
- Create: `server/services/roteiro/spinTemplate.js`, `server/services/roteiro/stageKind.js`
- Delete: `server/services/roteiro/bantTemplate.js`
- Modify: `server/services/roteiro/schema.js`, `server/services/roteiro/repo.js`, `server/services/roteiro/migrateLegacy.js`, `server/routes/roteiroRouter.js`, `server/services/cadence/repo.js` (só a importação/`projectQuestion`/`toQuestionInput`/`spinStepQuestions`), `server/routes/cadencesRouter.js`
- Test: `test/roteiroSpin.test.js` (novo); atualizar `test/roteiroRepo.test.js`, `test/cadenceRepo.test.js`, `test/cadencesHttp.test.js`, `test/helpers/cadenceDb.js`, `test/roteiroHttp.test.js` e demais que usam `bant`

**Interfaces:**
- Produces: `SPIN_KEYS`, `SPIN_LABEL`, `SPIN_ORDER`, `SPIN_QUESTIONS` (spinTemplate.js); `isContactStage(stage)`, `conversationStages(stages)` (stageKind.js); pergunta da API = `{ question_key, stage_id, position, text, kind, required, spin, profile_key, ai_hint, options: [{ option_key, label, points, position, sets_profile_key }] }`; `createSpinDraft(db, accountId, funnelId)`; `spinStepQuestions(db, accountId, funnelId)`; tabela `roteiro_profiles`; colunas `accounts.business_objective`, `roteiro_questions.spin|profile_key`, `roteiro_options.sets_profile_key`, `leads.roteiro_profile_key|roteiro_profile_origin`.

- [ ] **Step 1: Teste que falha** — `test/roteiroSpin.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase } from './helpers/roteiroDb.js'
import { applyRoteiroSchema } from '../server/services/roteiro/schema.js'
import { saveDraft, publish, getRoteiro, createSpinDraft, restoreVersion } from '../server/services/roteiro/repo.js'
import { SPIN_QUESTIONS, SPIN_KEYS } from '../server/services/roteiro/spinTemplate.js'
import { isContactStage, conversationStages } from '../server/services/roteiro/stageKind.js'

const opts = [{ label: 'A', points: 5 }, { label: 'B', points: 0 }]

test('migracao bant -> spin: 4 mapeamentos e idempotente', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'text' }] })
  const v = db.prepare('SELECT id FROM roteiro_versions LIMIT 1').get().id
  const ins = db.prepare("INSERT INTO roteiro_questions (version_id, account_id, question_key, stage_id, text, kind, bant) VALUES (?, ?, ?, ?, 'x', 'text', ?)")
  for (const b of ['need', 'timeline', 'authority', 'budget']) ins.run(v, s.accountId, b, s.stages.qualificando, b)
  applyRoteiroSchema(db); applyRoteiroSchema(db)
  const got = Object.fromEntries(db.prepare('SELECT question_key, spin FROM roteiro_questions WHERE bant IS NOT NULL').all().map(r => [r.question_key, r.spin]))
  assert.deepEqual(got, { need: 'problem', timeline: 'situation', authority: 'situation', budget: 'need_payoff' })
})

test('pergunta guarda spin, profile_key e sets_profile_key; recusa fase e perfil invalidos', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'loja', 'Loja', 0)").run(s.accountId)
  const d = saveDraft(db, s.accountId, s.funnelId, { questions: [
    { stage_id: s.stages.qualificando, text: 'Tem loja?', kind: 'options', spin: 'situation', options: [{ label: 'Sim', points: 5, sets_profile_key: 'loja' }, { label: 'Não', points: 0, sets_profile_key: 'xx' }] },
    { stage_id: s.stages.qualificando, text: 'Dói?', kind: 'options', spin: 'problem', profile_key: 'loja', options: opts },
  ] })
  assert.equal(d.questions[0].spin, 'situation')
  assert.equal(d.questions[0].options[0].sets_profile_key, 'loja')
  assert.equal(d.questions[0].options[1].sets_profile_key, null) // perfil inexistente na opcao e descartado
  assert.equal(d.questions[1].profile_key, 'loja')
  assert.equal('bant' in d.questions[0], false)
  assert.throws(() => saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'x', kind: 'text', spin: 'budget' }] }), /Fase SPIN inválida/)
  assert.throws(() => saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'x', kind: 'text', profile_key: 'nao' }] }), /Perfil inválido/)
})

test('restaurar versao com perfil que nao existe mais vira Todos', () => {
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db)
  db.prepare("INSERT INTO roteiro_profiles (account_id, profile_key, name, position) VALUES (?, 'loja', 'Loja', 0)").run(s.accountId)
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'text', profile_key: 'loja' }] })
  const v1 = publish(db, s.accountId, s.funnelId, s.gerenteId)
  saveDraft(db, s.accountId, s.funnelId, { questions: [] }); publish(db, s.accountId, s.funnelId, s.gerenteId)
  db.prepare('DELETE FROM roteiro_profiles').run()
  const d = restoreVersion(db, s.accountId, v1.id)
  assert.equal(d.questions[0].profile_key, null)
})

test('modelo SPIN: 6 perguntas de opcoes, ordem S-P-P-I-I-N; createSpinDraft soma so fases que faltam na 1a etapa de conversa', () => {
  assert.deepEqual(SPIN_QUESTIONS.map(q => q.spin), ['situation', 'problem', 'problem', 'implication', 'implication', 'need_payoff'])
  assert.ok(SPIN_QUESTIONS.every(q => q.kind === 'options' && q.required))
  assert.deepEqual(SPIN_KEYS, ['situation', 'problem', 'implication', 'need_payoff'])
  const db = createRoteiroTestDb()
  const s = seedRoteiroBase(db) // etapas: Novo (contato), Qualificando, Proposta, Venda, Perdido
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.proposta, text: 'Como faz hoje?', kind: 'options', spin: 'situation', options: opts }] })
  const d = createSpinDraft(db, s.accountId, s.funnelId)
  const added = d.questions.filter(q => q.stage_id === s.stages.qualificando)
  assert.deepEqual(added.map(q => q.spin), ['problem', 'problem', 'implication', 'implication', 'need_payoff'])
})

test('stageKind: etapa de contato pelo nome; conversa = nao finais e nao contato', () => {
  const st = (name, is_terminal = false) => ({ name, is_terminal })
  assert.equal(isContactStage(st('Novo Lead')), true)
  assert.equal(isContactStage(st('Contato Feito')), true)
  assert.equal(isContactStage(st('Tentativa 2')), true)
  assert.equal(isContactStage(st('Prospecção')), true)
  assert.equal(isContactStage(st('Entrada')), true)
  assert.equal(isContactStage(st('Atendimento')), false)
  assert.equal(isContactStage(st('Novo cliente', true)), false)
  const all = [st('Novo'), st('Atendimento'), st('Proposta'), st('Venda', true)]
  assert.deepEqual(conversationStages(all).map(s => s.name), ['Atendimento', 'Proposta'])
  assert.deepEqual(conversationStages([st('Novo'), st('Venda', true)]).map(s => s.name), ['Novo'])
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/roteiroSpin.test.js` → FAIL (módulos inexistentes).

- [ ] **Step 3: Implementar.**

`server/services/roteiro/spinTemplate.js`:

```js
// Modelo SPIN (Situacao, Problema, Implicacao, Necessidade de Solucao) — spec 2026-10-02 §7.1.
export const SPIN_KEYS = ['situation', 'problem', 'implication', 'need_payoff']
export const SPIN_LABEL = { situation: 'Situação', problem: 'Problema', implication: 'Implicação', need_payoff: 'Necessidade de Solução' }
export const SPIN_ORDER = Object.fromEntries(SPIN_KEYS.map((k, i) => [k, i]))

const q = (spin, text, options) => ({ spin, text, kind: 'options', required: true, options: options.map(([label, points]) => ({ label, points })) })

export const SPIN_QUESTIONS = [
  q('situation', 'Como você resolve isso hoje, {nome}?', [['Já uso algo e não estou satisfeito(a)', 10], ['Faço de um jeito improvisado', 8], ['Ainda não faço nada', 3]]),
  q('problem', 'O que mais te incomoda na forma como está hoje?', [['Atrapalha o dia a dia, é urgente', 15], ['Incomoda, mas dá pra levar', 8], ['Nada em especial, só pesquisando', 0]]),
  q('problem', 'Isso já aconteceu outras vezes ou foi algo pontual?', [['Acontece sempre', 12], ['Às vezes', 6], ['Foi só uma vez', 0]]),
  q('implication', 'E se continuar assim pelos próximos meses, o que isso te causa?', [['Perco dinheiro/clientes/tempo', 15], ['Fica chato, mas não muda muito', 5], ['Nada', 0]]),
  q('implication', 'Isso afeta mais alguém além de você (família, equipe, sócio)?', [['Sim, afeta outras pessoas', 10], ['Um pouco', 5], ['Só a mim', 2]]),
  q('need_payoff', 'Se isso estivesse resolvido, o que mudaria pra você? Quanto valeria resolver agora?', [['Mudaria muito, quero resolver já', 15], ['Seria bom, mas sem pressa', 6], ['Não mudaria muito', 0]]),
]

// Perguntas do modelo cujas fases ainda nao aparecem em `questions` (roteiro todo).
export function missingSpinQuestions(questions) {
  const used = new Set((questions || []).map(x => x.spin).filter(Boolean))
  return SPIN_QUESTIONS.filter(x => !used.has(x.spin))
}
```

`server/services/roteiro/stageKind.js`:

```js
// Etapa de tentativa de contato x etapa de conversa (spec 2026-10-02 §7.2): pelo nome.
const CONTACT_WORDS = ['novo', 'nova', 'contato', 'tentativa', 'prospec', 'entrada']
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function isContactStage(stage) {
  if (!stage || stage.is_terminal) return false
  const n = norm(stage.name)
  return CONTACT_WORDS.some(w => n.includes(w))
}

// Nao finais e nao de contato, na ordem; se nao sobrar nenhuma, todas as nao finais.
export function conversationStages(stages) {
  const open = (stages || []).filter(s => !s.is_terminal)
  const conv = open.filter(s => !isContactStage(s))
  return conv.length ? conv : open
}
```

`schema.js` — dentro de `applyRoteiroSchema`, depois dos `addColumnIfNotExists` atuais:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS roteiro_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      profile_key TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, profile_key)
    );
  `)
  addColumnIfNotExists(db, 'accounts', 'business_objective', 'TEXT')
  addColumnIfNotExists(db, 'roteiro_questions', 'spin', 'TEXT')
  addColumnIfNotExists(db, 'roteiro_questions', 'profile_key', 'TEXT')
  addColumnIfNotExists(db, 'roteiro_options', 'sets_profile_key', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'roteiro_profile_key', 'TEXT')
  addColumnIfNotExists(db, 'leads', 'roteiro_profile_origin', 'TEXT')
  // BANT -> SPIN (spec 2026-10-02 §4): so etiqueta; texto/opcoes/pontos/respostas iguais. Idempotente.
  db.exec(`UPDATE roteiro_questions SET spin = CASE bant WHEN 'need' THEN 'problem' WHEN 'timeline' THEN 'situation'
    WHEN 'authority' THEN 'situation' WHEN 'budget' THEN 'need_payoff' END WHERE spin IS NULL AND bant IS NOT NULL`)
```

`repo.js`:
- importar `SPIN_KEYS, missingSpinQuestions` de `./spinTemplate.js` e `conversationStages` de `./stageKind.js`; apagar `BANT_*`.
- `loadVersionContent`: pergunta com `spin: q.spin ?? null, profile_key: q.profile_key ?? null` (sem `bant`); opção com `sets_profile_key: o.sets_profile_key ?? null`.
- função nova `profileKeysOf(db, accountId)` → `new Set(SELECT profile_key FROM roteiro_profiles WHERE account_id = ?)`.
- `normalizeQuestion(q, stageMap, profileKeys)`:

```js
  const spin = q.spin ?? null
  if (spin !== null && !SPIN_KEYS.includes(spin)) throw new RoteiroError('invalid', 400, 'Fase SPIN inválida.')
  const profileKey = q.profile_key ?? null
  if (profileKey !== null && !profileKeys.has(profileKey)) throw new RoteiroError('invalid', 400, 'Perfil inválido.')
  // ...nas opcoes:
  sets_profile_key: o.sets_profile_key && profileKeys.has(o.sets_profile_key) ? o.sets_profile_key : null,
  // ...no retorno: spin, profile_key: profileKey (sem bant)
```

- `replaceVersionContent`: INSERT de pergunta com colunas `spin, profile_key` no lugar de `bant`; INSERT de opção com `sets_profile_key`.
- `saveDraft`: `const profileKeys = profileKeysOf(db, accountId)` e passa para `normalizeQuestion`.
- `restoreVersion`: antes de gravar, `content.questions` com `profile_key` fora de `profileKeysOf` vira `null` (opções com `sets_profile_key` fora → `null`), e grava via `saveDraft` em vez de `replaceVersionContent` direto (mantém validação).
- `createBantDraft` → `createSpinDraft`: alvo = `conversationStages(stages)[0]`; `missing = missingSpinQuestions(base.questions)`; perguntas novas com `spin`, `profile_key: null`.

`migrateLegacy.js`: `bant: null` → `spin: null, profile_key: null`.

`roteiroRouter.js`: importar `createSpinDraft`; rota `POST /funnels/:funnelId/spin-template` no lugar de `/bant-template`.

`cadence/repo.js`: importar `missingSpinQuestions` de `../roteiro/spinTemplate.js` (tirar `BANT_QUESTIONS`); `projectQuestion` usa `q.spin ?? null, q.profile_key ?? null` e cada opção `[..., o.sets_profile_key ?? null]`; base de `syncStageQuestions` `{ kind: 'text', required: false, spin: null, profile_key: null, ai_hint: null, options: [] }` e saída com `spin: m.spin ?? null, profile_key: m.profile_key ?? null`; `toQuestionInput` com `spin`, `profile_key: q.profile_key ?? null` e opções com `sets_profile_key: o.sets_profile_key ?? null`; `bantStepQuestions` → `spinStepQuestions` (usa `missingSpinQuestions(content.questions)`); mensagem do `aiStepQuestions` vazia: "A IA não sugeriu perguntas para esta etapa. Tente o modelo SPIN.". `keepOptionKeys` não muda (o `...o` leva o `sets_profile_key`).

`cadencesRouter.js`: `mode === 'spin'` → `spinStepQuestions`; vazio → `'As fases do modelo SPIN já estão no funil.'`.

- [ ] **Step 4: Atualizar testes antigos** — trocar `bant: 'timeline'` etc. por `spin` equivalente (`timeline/authority`→`situation`, `need`→`problem`, `budget`→`need_payoff`), `bant-template`→`spin-template`, `mode: 'bant'`→`'spin'`, contagens de 4 para 6 perguntas do modelo, mensagens BANT → SPIN. Rodar `grep -rn "bant" test server` até sobrar só `schema.js` (coluna morta + migração) e o teste de migração.

- [ ] **Step 5: Rodar** — `npm test` → tudo verde.

- [ ] **Step 6: Commit** — `git add -A server test && git commit -m "feat(roteiro): SPIN no lugar do BANT, perfis no banco e etapa de contato"`

---

### Task 2: Perfis da conta e perfil do lead

**Files:**
- Create: `server/services/roteiro/profiles.js`
- Modify: `server/routes/roteiroRouter.js`, `server/routes/roteiro.js`
- Test: `test/roteiroProfiles.test.js` (novo), `test/roteiroHttp.test.js` (rotas)

**Interfaces:**
- Consumes: tabela `roteiro_profiles`, colunas do lead (Task 1), `RoteiroError`, `newKey`.
- Produces:
  - `appliesToLead(question, leadProfileKey) → boolean`
  - `listProfiles(db, accountId) → [{ profile_key, name, description, position }]`
  - `getBusiness(db, accountId) → { business_objective, profiles }`
  - `saveBusiness(db, accountId, { business_objective, profiles }) → getBusiness(...)` (lista inteira; perfis fora da lista são apagados)
  - `effectiveProfileKey(db, lead) → string|null` (perfil do lead; senão o único perfil da conta; senão null)
  - `setLeadProfile(db, { accountId, leadId, profileKey, origin }) → { changed: boolean }` (`origin` `'ia'` não troca perfil `'manual'`)
  - `leadProfileView(db, { accountId, lead }) → { profile_key, origin, effective_key, profiles: [{ profile_key, name }] }`
  - Rotas: `GET /api/roteiro/profiles`, `PUT /api/roteiro/profiles` (gestor); `GET|PUT /api/roteiro/leads/:leadId/roteiro-profile` (vendedor com acesso ou gestor); PUT do lead → `refreshLeadStageCadence`, `scheduleScore`, SSE `lead:cadence {lead_id}`.

- [ ] **Step 1: Teste que falha** — `test/roteiroProfiles.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead } from './helpers/roteiroDb.js'
import { saveDraft } from '../server/services/roteiro/repo.js'
import { appliesToLead, getBusiness, saveBusiness, effectiveProfileKey, setLeadProfile, leadProfileView } from '../server/services/roteiro/profiles.js'

const two = [{ name: 'Loja', description: 'mercadinho, comércio' }, { name: 'Vendedor porta a porta', description: 'renda extra' }]

test('appliesToLead: Todos vale sempre; perfil so para o mesmo perfil', () => {
  assert.equal(appliesToLead({ profile_key: null }, null), true)
  assert.equal(appliesToLead({ profile_key: 'a' }, null), false)
  assert.equal(appliesToLead({ profile_key: 'a' }, 'a'), true)
  assert.equal(appliesToLead({ profile_key: 'a' }, 'b'), false)
})

test('saveBusiness: grava objetivo e perfis, gera chave estavel, limites', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const b = saveBusiness(db, s.accountId, { business_objective: 'revender produtos de limpeza', profiles: two })
  assert.equal(b.business_objective, 'revender produtos de limpeza')
  assert.deepEqual(b.profiles.map(p => p.name), ['Loja', 'Vendedor porta a porta'])
  const key = b.profiles[0].profile_key
  const b2 = saveBusiness(db, s.accountId, { business_objective: 'x', profiles: [{ profile_key: key, name: 'Lojas', description: '' }] })
  assert.equal(b2.profiles[0].profile_key, key)
  assert.equal(b2.profiles.length, 1)
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: Array.from({ length: 7 }, (_, i) => ({ name: `P${i}` })) }), /Máximo de 6 perfis/)
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: [{ name: '' }] }), /nome/i)
  assert.equal(getBusiness(db, s.otherAccountId).profiles.length, 0) // isolado por conta
})

test('apagar perfil usado por pergunta (rascunho ou publicada) e recusado; leads com perfil apagado voltam a NULL', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: two }).profiles
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'q', kind: 'text', profile_key: loja.profile_key }] })
  assert.throws(() => saveBusiness(db, s.accountId, { profiles: [porta] }), /Este perfil tem perguntas/)
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: porta.profile_key, origin: 'manual' })
  saveBusiness(db, s.accountId, { profiles: [loja] })
  assert.equal(db.prepare('SELECT roteiro_profile_key k FROM leads WHERE id = ?').get(lead).k, null)
})

test('setLeadProfile: IA nao troca manual; perfil invalido e recusado; manual aceita null', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: two }).profiles
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  assert.equal(setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: loja.profile_key, origin: 'ia' }).changed, true)
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: porta.profile_key, origin: 'manual' })
  assert.equal(setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: loja.profile_key, origin: 'ia' }).changed, false)
  assert.throws(() => setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: 'zz', origin: 'manual' }), /Perfil inválido/)
  setLeadProfile(db, { accountId: s.accountId, leadId: lead, profileKey: null, origin: 'manual' })
  const v = leadProfileView(db, { accountId: s.accountId, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(lead) })
  assert.equal(v.profile_key, null); assert.equal(v.profiles.length, 2)
})

test('perfil efetivo: com 1 perfil na conta, lead sem perfil usa o unico', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  const row = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(lead)
  assert.equal(effectiveProfileKey(db, row()), null)
  const [only] = saveBusiness(db, s.accountId, { profiles: [two[0]] }).profiles
  assert.equal(effectiveProfileKey(db, row()), only.profile_key)
  saveBusiness(db, s.accountId, { profiles: [only, two[1]] })
  assert.equal(effectiveProfileKey(db, row()), null)
})
```

Mais, em `test/roteiroHttp.test.js`: GET/PUT `/profiles` (atendente → 403; super_admin sem conta → 400; PUT com 7 perfis → 400 "Máximo de 6 perfis."); PUT `/leads/:id/roteiro-profile` (atendente sem acesso → 403; `{ profile_key: 'zz' }` → 400 "Perfil inválido."; válido → 200 com `origin: 'manual'`).

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/roteiroProfiles.test.js`.

- [ ] **Step 3: Implementar** `server/services/roteiro/profiles.js`:

```js
// Perfis de cliente ideal da conta e perfil do lead (spec 2026-10-02 §4-§6). Recebe db.
import { RoteiroError, newKey } from './repo.js'

export const MAX_PROFILES = 6
const str = v => (typeof v === 'string' ? v.trim() : '')

export function appliesToLead(question, leadProfileKey) {
  return !question.profile_key || question.profile_key === leadProfileKey
}

export function listProfiles(db, accountId) {
  return db.prepare('SELECT profile_key, name, description, position FROM roteiro_profiles WHERE account_id = ? ORDER BY position ASC, id ASC').all(accountId)
}

export function getBusiness(db, accountId) {
  const row = db.prepare('SELECT business_objective FROM accounts WHERE id = ?').get(accountId)
  if (!row) throw new RoteiroError('not_found', 404, 'Conta não encontrada.')
  return { business_objective: row.business_objective ?? null, profiles: listProfiles(db, accountId) }
}

// Chaves de perfil citadas em perguntas/opcoes de rascunho ou publicado da conta.
function usedProfileKeys(db, accountId) {
  const rows = db.prepare(`
    SELECT q.profile_key AS k FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id
    WHERE v.account_id = ? AND v.status IN ('draft','published') AND q.profile_key IS NOT NULL
    UNION SELECT o.sets_profile_key FROM roteiro_options o JOIN roteiro_questions q ON q.id = o.question_id
    JOIN roteiro_versions v ON v.id = q.version_id
    WHERE v.account_id = ? AND v.status IN ('draft','published') AND o.sets_profile_key IS NOT NULL
  `).all(accountId, accountId)
  return new Set(rows.map(r => r.k))
}

export function saveBusiness(db, accountId, { business_objective = null, profiles = [] } = {}) {
  const objective = str(business_objective)
  if (objective.length > 300) throw new RoteiroError('invalid', 400, 'O objetivo do negócio pode ter até 300 caracteres.')
  if (!Array.isArray(profiles)) throw new RoteiroError('invalid', 400, 'Lista de perfis obrigatória.')
  if (profiles.length > MAX_PROFILES) throw new RoteiroError('invalid', 400, 'Máximo de 6 perfis.')
  const current = new Set(listProfiles(db, accountId).map(p => p.profile_key))
  const clean = profiles.map((p, i) => {
    const name = str(p?.name)
    if (!name || name.length > 60) throw new RoteiroError('invalid', 400, 'Cada perfil precisa de um nome (até 60 caracteres).')
    const description = str(p?.description)
    if (description.length > 500) throw new RoteiroError('invalid', 400, '"Como reconhecer" pode ter até 500 caracteres.')
    const key = p?.profile_key && current.has(p.profile_key) ? p.profile_key : newKey()
    return { profile_key: key, name, description: description || null, position: i }
  })
  const keep = new Set(clean.map(p => p.profile_key))
  const removed = [...current].filter(k => !keep.has(k))
  const used = usedProfileKeys(db, accountId)
  if (removed.some(k => used.has(k))) throw new RoteiroError('in_use', 400, 'Este perfil tem perguntas. Mude ou apague as perguntas antes.')
  db.transaction(() => {
    db.prepare('UPDATE accounts SET business_objective = ? WHERE id = ?').run(objective || null, accountId)
    const del = db.prepare('DELETE FROM roteiro_profiles WHERE account_id = ? AND profile_key = ?')
    const clearLeads = db.prepare('UPDATE leads SET roteiro_profile_key = NULL, roteiro_profile_origin = NULL WHERE account_id = ? AND roteiro_profile_key = ?')
    for (const k of removed) { del.run(accountId, k); clearLeads.run(accountId, k) }
    const up = db.prepare(`INSERT INTO roteiro_profiles (account_id, profile_key, name, description, position) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(account_id, profile_key) DO UPDATE SET name = excluded.name, description = excluded.description,
      position = excluded.position, updated_at = datetime('now')`)
    for (const p of clean) up.run(accountId, p.profile_key, p.name, p.description, p.position)
  })()
  return getBusiness(db, accountId)
}

export function effectiveProfileKey(db, lead) {
  if (!lead) return null
  if (lead.roteiro_profile_key) return lead.roteiro_profile_key
  const rows = db.prepare('SELECT profile_key FROM roteiro_profiles WHERE account_id = ? LIMIT 2').all(lead.account_id)
  return rows.length === 1 ? rows[0].profile_key : null
}

export function setLeadProfile(db, { accountId, leadId, profileKey, origin }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new RoteiroError('not_found', 404, 'Lead não encontrado.')
  const key = profileKey || null
  if (key && !db.prepare('SELECT 1 FROM roteiro_profiles WHERE account_id = ? AND profile_key = ?').get(accountId, key)) {
    throw new RoteiroError('invalid', 400, 'Perfil inválido.')
  }
  if (origin === 'ia' && lead.roteiro_profile_origin === 'manual') return { changed: false }
  if (origin === 'ia' && !key) return { changed: false }
  if ((lead.roteiro_profile_key || null) === key && (lead.roteiro_profile_origin || null) === (key ? origin : null)) return { changed: false }
  db.prepare('UPDATE leads SET roteiro_profile_key = ?, roteiro_profile_origin = ? WHERE id = ?').run(key, key ? origin : null, lead.id)
  return { changed: true }
}

export function leadProfileView(db, { accountId, lead }) {
  return {
    profile_key: lead.roteiro_profile_key ?? null,
    origin: lead.roteiro_profile_origin ?? null,
    effective_key: effectiveProfileKey(db, lead),
    profiles: listProfiles(db, accountId).map(p => ({ profile_key: p.profile_key, name: p.name })),
  }
}
```

Rotas em `roteiroRouter.js` (`createRoteiroRouter(db, { ai, now, broadcast = () => {} })`):

```js
  router.get('/profiles', manager, (req, res) => {
    try { res.json(getBusiness(db, req.accountId)) } catch (e) { fail(res, e) }
  })
  router.put('/profiles', manager, (req, res) => {
    try { res.json(saveBusiness(db, req.accountId, { business_objective: req.body?.business_objective ?? null, profiles: req.body?.profiles })) } catch (e) { fail(res, e) }
  })
  router.get('/leads/:leadId/roteiro-profile', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId); assertLeadAccess(req, lead)
      res.json(leadProfileView(db, { accountId: req.accountId, lead }))
    } catch (e) { fail(res, e) }
  })
  router.put('/leads/:leadId/roteiro-profile', (req, res) => {
    try {
      const lead = getLeadScoped(req.accountId, req.params.leadId); assertLeadAccess(req, lead)
      const r = setLeadProfile(db, { accountId: req.accountId, leadId: lead.id, profileKey: req.body?.profile_key ?? null, origin: 'manual' })
      if (r.changed) {
        try { refreshLeadStageCadence(db, { leadId: lead.id }) } catch (e) { if (!warnMissingCadenceTable(e)) console.error('[Cadencia] proximo passo:', e.message) }
        scheduleScore(lead.id)
        try { broadcast(req.accountId, 'lead:cadence', { lead_id: lead.id }) } catch {}
      }
      res.json(leadProfileView(db, { accountId: req.accountId, lead: getLeadScoped(req.accountId, lead.id) }))
    } catch (e) { fail(res, e) }
  })
```

`server/routes/roteiro.js`: passar `broadcast: broadcastSSE` (importar de `../sse.js`).

- [ ] **Step 4: Rodar** — `node --test test/roteiroProfiles.test.js test/roteiroHttp.test.js` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(roteiro): perfis de cliente ideal da conta e perfil do lead"` (com `git add` dos arquivos novos).

---

### Task 3: Regra "pergunta vale para o lead" em todo lugar

**Files:**
- Modify: `server/services/roteiro/leadRoteiro.js`, `server/services/roteiro/autoAdvance.js`, `server/services/cadence/nextStep.js`, `server/services/cadence/leadCadence.js`, `server/services/leadScore/inputs.js`
- Test: `test/roteiroPerfilLead.test.js` (novo)

**Interfaces:**
- Consumes: `appliesToLead`, `effectiveProfileKey`, `setLeadProfile` (Task 2); `SPIN_LABEL` (Task 1).
- Produces: `getLeadRoteiro` devolve só perguntas aplicáveis + campos `profile: { key, origin }`; `pendingRequired` / `checkRoteiroGate` / `maybeAutoAdvance` / `buildFit` só aplicáveis; passo da cadência com `not_applicable: true` (fora do próximo passo e do total); `saveAnswer` grava o perfil quando a opção tem `sets_profile_key` (origem = origem da resposta; não troca manual) e devolve `profile_changed: boolean`.

- [ ] **Step 1: Teste que falha** — `test/roteiroPerfilLead.test.js` (usa `createCadenceTestDb`, `seedCadenceBase`, `leadIn` de `./helpers/cadenceDb.js`, `addQuestionSteps` de cadence/repo, `getLeadRoteiro`, `checkRoteiroGate`, `saveAnswer`, `maybeAutoAdvance`, `getLeadStageCadence`, `gatherScoreInputs`):

```js
// cenario: Qualificando tem 3 perguntas obrigatorias de opcoes:
//   D (Todos, descoberta: opcao "Tenho loja" -> loja, "Vendo de porta em porta" -> porta)
//   L (perfil loja), P (perfil porta)
function cenario() {
  const db = createCadenceTestDb(); const s = seedCadenceBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja' }, { name: 'Porta' }] }).profiles
  const o = (label, points, sets = null) => ({ label, points, ...(sets ? { sets_profile_key: sets } : {}) })
  addQuestionSteps(db, s.accountId, { stageId: s.stages.qualificando, questions: [
    { text: 'Você tem loja ou vende de porta em porta?', kind: 'options', required: true, spin: 'situation', options: [o('Tenho loja', 5, loja.profile_key), o('Vendo de porta em porta', 5, porta.profile_key)] },
    { text: 'Quantos clientes passam na loja?', kind: 'options', required: true, spin: 'situation', profile_key: loja.profile_key, options: [o('Muitos', 10), o('Poucos', 2)] },
    { text: 'Quantas casas visita por dia?', kind: 'options', required: true, spin: 'situation', profile_key: porta.profile_key, options: [o('Mais de 20', 10), o('Menos', 2)] },
  ] })
  const leadId = leadIn(db, s, 'qualificando')
  const keys = getRoteiro(db, s.accountId, s.funnelId).published.questions.map(q => q.question_key)
  return { db, s, loja, porta, leadId, keys }
}

test('lead sem perfil ve so as perguntas Todos; com perfil ve Todos + as dele', () => {
  const { db, s, loja, leadId } = cenario()
  const qs = () => getLeadRoteiro(db, { accountId: s.accountId, leadId }).stages.find(x => x.is_current).questions.map(q => q.text)
  assert.deepEqual(qs(), ['Você tem loja ou vende de porta em porta?'])
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  assert.deepEqual(qs(), ['Você tem loja ou vende de porta em porta?', 'Quantos clientes passam na loja?'])
})

test('opcao com sets_profile_key grava o perfil; nao troca perfil manual', () => {
  const { db, s, loja, porta, leadId, keys } = cenario()
  const q = getRoteiro(db, s.accountId, s.funnelId).published.questions[0]
  const r = saveAnswer(db, { accountId: s.accountId, leadId, questionKey: keys[0], optionKey: q.options[0].option_key, origin: 'ia', evidence: 'tenho um mercadinho' })
  assert.equal(r.profile_changed, true)
  assert.equal(db.prepare('SELECT roteiro_profile_key k, roteiro_profile_origin o FROM leads WHERE id = ?').get(leadId).k, loja.profile_key)
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: porta.profile_key, origin: 'manual' })
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: keys[0], optionKey: q.options[0].option_key, origin: 'manual', userId: s.gerenteId })
  assert.equal(db.prepare('SELECT roteiro_profile_key k FROM leads WHERE id = ?').get(leadId).k, porta.profile_key)
})

test('trava e avanco automatico so contam obrigatorias aplicaveis', () => {
  const { db, s, loja, leadId, keys } = cenario()
  const pub = getRoteiro(db, s.accountId, s.funnelId).published.questions
  const lead = () => db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: keys[0], optionKey: pub[0].options[0].option_key, origin: 'manual' }) // vira loja
  assert.equal(checkRoteiroGate(db, lead(), s.stages.proposta).pending.map(p => p.text).join(), 'Quantos clientes passam na loja?')
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: keys[1], optionKey: pub[1].options[0].option_key, origin: 'manual' })
  assert.equal(checkRoteiroGate(db, lead(), s.stages.proposta).ok, true) // pergunta da porta nao trava
  assert.ok(maybeAutoAdvance(db, { accountId: s.accountId, leadId }))
})

test('cadencia: passo de outro perfil nao vira proximo passo e nao conta no total', () => {
  const { db, s, loja, leadId } = cenario()
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  const v = getLeadStageCadence(db, { accountId: s.accountId, leadId })
  assert.equal(v.total, 2)
  assert.equal(v.steps.find(st => st.description === 'Quantas casas visita por dia?').not_applicable, true)
})

test('termometro: Perfil soma so as aplicaveis e o motivo usa o rotulo SPIN', () => {
  const { db, s, loja, leadId, keys } = cenario()
  const pub = getRoteiro(db, s.accountId, s.funnelId).published.questions
  setLeadProfile(db, { accountId: s.accountId, leadId, profileKey: loja.profile_key, origin: 'manual' })
  saveAnswer(db, { accountId: s.accountId, leadId, questionKey: keys[1], optionKey: pub[1].options[0].option_key, origin: 'manual' })
  const fit = gatherScoreInputs(db, leadId).fit
  assert.equal(fit.totalCount, 2); assert.equal(fit.max, 15)
  assert.deepEqual(fit.reasons, [{ texto: 'Situação: Muitos', pontos: 10 }])
})
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.**

`leadRoteiro.js`:
- importar `appliesToLead, effectiveProfileKey, setLeadProfile` de `./profiles.js`. Atenção ao ciclo: `profiles.js` importa só `repo.js`, sem ciclo.
- `buildQState`: trocar `bant` por `spin: question.spin ?? null, profile_key: question.profile_key ?? null`.
- `getLeadRoteiro`: `const leadProfile = effectiveProfileKey(db, lead)`; `const questions = safeGetPublishedQuestions(...).filter(q => appliesToLead(q, leadProfile))`; `has_roteiro` continua olhando o roteiro todo (`allQuestions.length > 0`); `publishedKeys` (respostas órfãs) usa o roteiro todo; devolve também `profile: { key: leadProfile, origin: lead.roteiro_profile_origin ?? null }`.
- `pendingRequired`: `const leadProfile = effectiveProfileKey(db, lead)` e filtro `q.required && appliesToLead(q, leadProfile)`.
- `checkRoteiroGate`: sem mudança além da chamada (já delega a `pendingRequired`).
- `saveAnswer`: depois do upsert, se a opção escolhida tem `sets_profile_key`, `const pr = setLeadProfile(db, { accountId, leadId, profileKey: option.sets_profile_key, origin })` (origem `'manual'` só troca se o perfil atual não for manual de outra escolha: regra — resposta manual com perfil manual já gravado não troca; implemente `if (lead.roteiro_profile_origin !== 'manual')`); devolve `{ answer, skipped: false, profile_changed: !!pr?.changed }`.

`autoAdvance.js`: `const leadProfile = effectiveProfileKey(db, lead)`; `requiredInStage = questions.filter(q => q.stage_id === lead.stage_id && q.required && appliesToLead(q, leadProfile))`.

`nextStep.js`:

```js
const skipped = (step, x) => (step.orphan || step.not_applicable) && x.state !== 'feito'
export function computeNext(steps, ctx) {
  const states = steps.map(s => ({ id: s.id, ...stepState(s, ctx) }))
  const counts = states.filter((x, i) => !skipped(steps[i], x))
  ...
}
```

(atualizar o comentário do topo: "Pergunta de outro perfil (step.not_applicable) segue a mesma regra da órfã".)

`leadCadence.js`:
- `loadSteps` guarda o perfil da pergunta: `const byKey = new Map(safeGetPublishedQuestions(...).map(q => [q.question_key, q.profile_key ?? null]))`; passo = `{ ...s, orphan: s.action_type === 'pergunta' && !byKey.has(s.question_key), question_profile_key: byKey.get(s.question_key) ?? null }`.
- nova `forLead(db, leadId, steps)`: lê o lead, `p = effectiveProfileKey(db, lead)`, devolve `steps.map(s => ({ ...s, not_applicable: s.action_type === 'pergunta' && !s.orphan && !appliesToLead({ profile_key: s.question_profile_key }, p) }))`.
- `refreshLeadCadence` e `getLeadStageCadence`: `const steps = forLead(db, lc.lead_id, stepsOf(...))`; na saída de `getLeadStageCadence` incluir `not_applicable: st.not_applicable`.

`inputs.js`: `import { SPIN_LABEL } from '../roteiro/spinTemplate.js'` e `effectiveProfileKey, appliesToLead` de `../roteiro/profiles.js`; `questionShortLabel` usa `SPIN_LABEL[q.spin]`; `buildFit(db, lead)` recebe o lead e filtra `optionQuestions` por `appliesToLead(q, effectiveProfileKey(db, lead))`; `gatherScoreInputs` chama `buildFit(db, lead)`.

- [ ] **Step 4: Rodar** — `npm test` → verde (ajustar testes que esperavam `bant` no QState para `spin`).
- [ ] **Step 5: Commit** — `git commit -am "feat(roteiro): perguntas valem por perfil do lead (trava, avanco, cadencia, termometro)"`

---

### Task 4: IA identifica o perfil do lead

**Files:**
- Modify: `server/services/roteiro/aiExtract.js`, `server/services/roteiro/runtime.js`
- Test: `test/roteiroAi.test.js` (casos novos)

**Interfaces:**
- Consumes: `listProfiles`, `setLeadProfile` (Task 2); `getLeadRoteiro` já filtrado (Task 3).
- Produces: `extractAnswers` → `{ saved, offscript, advanced, profile_set: string|null }`; roda também quando não há pendentes mas o lead precisa de perfil (sem perfil, conta com 2+ perfis).

- [ ] **Step 1: Teste que falha** — em `test/roteiroAi.test.js`:

```js
test('extracao: IA marca o perfil com evidencia; nao troca manual; ignora perfil inventado', async () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const [loja, porta] = saveBusiness(db, s.accountId, { profiles: [{ name: 'Loja', description: 'mercadinho' }, { name: 'Porta', description: 'renda extra' }] }).profiles
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.qualificando, text: 'Quantos clientes?', kind: 'text', profile_key: loja.profile_key }] })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  const leadId = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  addMessage(db, { leadId, direction: 'inbound', content: 'tenho um mercadinho no centro' })
  const ai = fakeAi({ roteiro_extraction: [
    p => { assert.match(p.messages[0].content, /Loja/); assert.match(p.messages[0].content, /mercadinho/); return tool('record_answers', { answers: [], profile_key: loja.profile_key, profile_evidence: 'tenho um mercadinho' }) },
    tool('record_answers', { answers: [], profile_key: 'inventado', profile_evidence: 'x' }),
  ] })
  const r = await extractAnswers(db, { accountId: s.accountId, leadId, ai })
  assert.equal(r.profile_set, loja.profile_key)
  assert.equal(db.prepare('SELECT roteiro_profile_origin o FROM leads WHERE id = ?').get(leadId).o, 'ia')
  // ja tem perfil: proxima extracao nao manda perfis (nao ha pendente da loja respondida? ha: "Quantos clientes?")
  db.prepare("UPDATE leads SET roteiro_profile_key = ?, roteiro_profile_origin = 'manual' WHERE id = ?").run(porta.profile_key, leadId)
  const r2 = await extractAnswers(db, { accountId: s.accountId, leadId, ai: fakeAi({}) })
  assert.equal(r2.profile_set, null) // sem pendentes do perfil porta e perfil manual: nem chama a IA
})
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** em `aiExtract.js`:
- `needsProfile = !lead.roteiro_profile_key && profiles.length >= 2` (`profiles = listProfiles(db, accountId)`; lead lido do banco no começo).
- Sai cedo só se `!pending.length && !needsProfile`.
- Ferramenta: quando `needsProfile`, `RECORD_ANSWERS_TOOL` ganha `profile_key: { type: 'string', enum: profiles.map(p => p.profile_key) }` e `profile_evidence: { type: 'string' }` (montar a ferramenta por chamada: `buildTool({ profiles })`).
- Conteúdo: se `needsProfile`, antes das perguntas:

```js
'Perfis de cliente (marque profile_key só com evidência clara nas mensagens do CLIENTE; na dúvida, não marque):',
profiles.map(p => `- profile_key: ${p.profile_key} = "${p.name}"${p.description ? ` — como reconhecer: ${p.description}` : ''}`).join('\n'),
```

  e regra no system prompt: "- profile_key/profile_evidence: só se pedido; evidence é o trecho exato do cliente."
- Depois das respostas: `let profileSet = null; if (needsProfile && profiles.some(p => p.profile_key === input.profile_key) && str(input.profile_evidence)) { if (setLeadProfile(db, { accountId, leadId, profileKey: input.profile_key, origin: 'ia' }).changed) profileSet = input.profile_key }`.
- `advanced` passa a rodar se `saved.length || profileSet`.
- Retorno com `profile_set: profileSet`; `empty` com `profile_set: null`.

`runtime.js` (`bootRoteiroAi`): condição de "nada mudou" vira `!r.saved.length && !r.offscript && !r.profile_set`; refresh da cadência + nota quando `r.saved.length || r.profile_set`; SSE `lead:cadence {lead_id}` quando `r.profile_set`.

- [ ] **Step 4: Rodar** — `node --test test/roteiroAi.test.js` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(roteiro): IA identifica o perfil do lead na mesma extracao"`

---

### Task 5: Amostra de conversas reais da conta

**Files:**
- Create: `server/services/roteiro/conversationSample.js`
- Test: `test/roteiroConversationSample.test.js`

**Interfaces:**
- Produces: `sampleConversations(db, { accountId, now = new Date(), days = 90, caps = { bought: 20, advanced: 10, other: 10 }, maxChars = 60000 }) → { text: string, count: number, counts: { bought, advanced, other } }` (texto vazio quando não há conversa). A Entrega 2 chama com `days: 7`.

- [ ] **Step 1: Teste que falha:**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRoteiroTestDb, seedRoteiroBase, addLead, addMessage } from './helpers/roteiroDb.js'
import { sampleConversations } from '../server/services/roteiro/conversationSample.js'

function conversa(db, s, { name = 'Maria Souza', phone = '5548999112233', stage = 'qualificando', msgs = 3, accountId = s.accountId, funnelId = s.funnelId, stageId } = {}) {
  const id = addLead(db, { account_id: accountId, funnel_id: funnelId, stage_id: stageId ?? s.stages[stage], name, phone })
  addMessage(db, { leadId: id, direction: 'outbound', content: 'Oi Maria, tudo bem?', minutesAgo: 30 })
  addMessage(db, { leadId: id, direction: 'inbound', content: 'Oi! Meu fone é 48 99911-2233, sou a Maria', minutesAgo: 20 })
  for (let i = 2; i < msgs; i++) addMessage(db, { leadId: id, direction: 'inbound', content: 'x'.repeat(400), minutesAgo: 10 })
  return id
}

test('so da conta, sem nome/telefone, cortes de 300 e cabecalho com resultado', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const comprou = conversa(db, s)
  db.prepare('INSERT INTO lead_sales (account_id, lead_id, value) VALUES (?, ?, 100)').run(s.accountId, comprou)
  const otherFunnel = Number(db.prepare("INSERT INTO funnels (account_id, name) VALUES (?, 'F')").run(s.otherAccountId).lastInsertRowid)
  conversa(db, s, { accountId: s.otherAccountId, funnelId: otherFunnel, stageId: null, name: 'Outra Conta' })
  const r = sampleConversations(db, { accountId: s.accountId })
  assert.equal(r.count, 1); assert.equal(r.counts.bought, 1)
  assert.match(r.text, /resultado: comprou/)
  assert.match(r.text, /etapa atual: Qualificando/)
  assert.match(r.text, /Vendedor: Oi \[cliente\], tudo bem\?/)
  assert.doesNotMatch(r.text, /Maria|99911|Outra Conta/)
  assert.ok(r.text.split('\n').every(l => l.length <= 320))
})

test('filtros: precisa de 1 recebida e 3 mensagens nos ultimos 90 dias; prioridade e teto', () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  conversa(db, s, { msgs: 2 }) // so 2 mensagens: fora
  const adv = conversa(db, s, { name: 'Ana Lima', phone: '5511988887777' })
  db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id) VALUES (?, ?, ?)').run(adv, s.stages.novo, s.stages.qualificando)
  for (let i = 0; i < 3; i++) conversa(db, s, { name: `Zé ${i}`, phone: `55119000000${i}` })
  const r = sampleConversations(db, { accountId: s.accountId, caps: { bought: 20, advanced: 10, other: 2 } })
  assert.deepEqual(r.counts, { bought: 0, advanced: 1, other: 2 })
  assert.match(r.text.split('### ')[1], /resultado: avançou/) // maior prioridade primeiro
  const small = sampleConversations(db, { accountId: s.accountId, maxChars: 1500 })
  assert.ok(small.text.length <= 1500); assert.ok(small.count >= 1); assert.equal(small.counts.advanced, 1) // corta as de menor prioridade
})
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** `conversationSample.js`:

```js
// Amostra de conversas reais da PROPRIA conta para a IA do roteiro (spec 2026-10-02 §8.1).
// Sem nome/telefone do lead. Recebe db (nao importa server/db.js).
import { toSqliteDate } from './time.js'

const PER_CONVERSATION = 30
const PER_MESSAGE = 300
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasTranscription(db) {
  try { return db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'transcription') } catch { return false }
}

function redactor(lead) {
  const names = String(lead.name || '').split(/\s+/).filter(w => w.length >= 3)
  const digits = String(lead.phone || '').replace(/\D/g, '')
  const tail = digits.slice(-8)
  const nameRe = names.length ? new RegExp(`\\b(${names.map(esc).join('|')})\\b`, 'gi') : null
  return text => {
    let t = text
    if (tail.length === 8) {
      const loose = tail.split('').join('[\\s.-]?')
      t = t.replace(new RegExp(`[+\\d()\\s.-]*${loose}`, 'g'), ' [telefone]')
    }
    if (nameRe) t = t.replace(nameRe, '[cliente]')
    return t.replace(/\s+/g, ' ').trim()
  }
}

export function sampleConversations(db, { accountId, now = new Date(), days = 90, caps = { bought: 20, advanced: 10, other: 10 }, maxChars = 60000 } = {}) {
  const since = toSqliteDate(new Date(now.getTime() - days * 86400000))
  const content = hasTranscription(db) ? "COALESCE(NULLIF(TRIM(m.transcription), ''), m.content)" : 'm.content'
  const leads = db.prepare(`
    SELECT l.id, l.name, l.phone, fs.name AS stage_name, MAX(m.created_at) AS last_at,
      EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = l.id AND s.account_id = l.account_id)
        OR EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages c ON c.id = h.to_stage_id WHERE h.lead_id = l.id AND c.is_conversion = 1) AS bought,
      EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages a ON a.id = h.from_stage_id JOIN funnel_stages b ON b.id = h.to_stage_id
        WHERE h.lead_id = l.id AND b.position > a.position) AS advanced
    FROM leads l JOIN messages m ON m.lead_id = l.id AND m.account_id = l.account_id
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    WHERE l.account_id = ? AND m.created_at >= ? AND TRIM(COALESCE(${content}, '')) <> ''
    GROUP BY l.id
    HAVING COUNT(*) >= 3 AND SUM(m.direction = 'inbound') >= 1
    ORDER BY last_at DESC, l.id DESC
  `).all(accountId, since)

  const groups = { bought: [], advanced: [], other: [] }
  for (const l of leads) {
    const g = l.bought ? 'bought' : l.advanced ? 'advanced' : 'other'
    if (groups[g].length < (caps[g] ?? 0)) groups[g].push(l)
  }
  const label = { bought: 'comprou', advanced: 'avançou', other: 'não avançou' }
  const msgStmt = db.prepare(`SELECT m.direction, ${content} AS text FROM messages m
    WHERE m.lead_id = ? AND m.created_at >= ? AND TRIM(COALESCE(${content}, '')) <> ''
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
  const blocks = []
  for (const g of ['bought', 'advanced', 'other']) {
    for (const l of groups[g]) {
      const clean = redactor(l)
      const lines = msgStmt.all(l.id, since, PER_CONVERSATION).reverse()
        .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Vendedor'}: ${clean(String(m.text)).slice(0, PER_MESSAGE)}`)
      blocks.push({ g, text: `### Conversa — resultado: ${label[g]} | etapa atual: ${l.stage_name || '—'}\n${lines.join('\n')}` })
    }
  }
  // Teto: corta as de menor prioridade (fim da lista) primeiro.
  while (blocks.length && blocks.reduce((n, b) => n + b.text.length + 2, 0) > maxChars) blocks.pop()
  const counts = { bought: 0, advanced: 0, other: 0 }
  for (const b of blocks) counts[b.g]++
  return { text: blocks.map(b => b.text).join('\n\n'), count: blocks.length, counts }
}
```

(Se uma única conversa sozinha passar do teto, ela também sai — o resultado fica vazio e a IA monta pelo briefing.)

- [ ] **Step 4: Rodar** — PASS.
- [ ] **Step 5: Commit** — `git add server/services/roteiro/conversationSample.js test/roteiroConversationSample.test.js && git commit -m "feat(roteiro): amostra de conversas reais da conta para a IA"`

---

### Task 6: "Montar com IA" em SPIN por perfil, lendo conversas reais

**Files:**
- Modify: `server/services/roteiro/aiDraft.js`
- Test: `test/roteiroAi.test.js` (casos do buildAiDraft atualizados + novos)

**Interfaces:**
- Consumes: `sampleConversations` (Task 5), `listProfiles`/`getBusiness` (Task 2), `isContactStage`/`conversationStages`, `SPIN_*`/`missingSpinQuestions` (Task 1).
- Produces: `buildAiDraft(db, { accountId, funnelId, ai })` (mesma assinatura) e `loadBriefing(db, accountId)` exportado (Task 7 reaproveita), `orderStageQuestions(questions, profiles)` exportado.

- [ ] **Step 1: Teste que falha** — trocar os testes BANT do `buildAiDraft` por:

```js
test('montar com IA: SPIN por perfil, descoberta primeiro, contato realocado, fase faltando completada, conversas no prompt', async () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db) // Novo = contato; Qualificando/Proposta = conversa
  const [loja, porta] = saveBusiness(db, s.accountId, { business_objective: 'revender limpeza', profiles: [{ name: 'Loja', description: 'mercadinho' }, { name: 'Porta', description: 'renda extra' }] }).profiles
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  addMessage(db, { leadId: lead, direction: 'inbound', content: 'quero revender no meu mercadinho' })
  addMessage(db, { leadId: lead, direction: 'outbound', content: 'que legal' })
  addMessage(db, { leadId: lead, direction: 'inbound', content: 'qual o preço da caixa?' })
  const o = (l, p, sets) => ({ label: l, points: p, ...(sets ? { sets_profile_key: sets } : {}) })
  let prompt = ''
  const ai = fakeAi({ roteiro_draft: [p => { prompt = p.messages[0].content; assert.equal(p.maxTokens, 8000); return tool('propose_roteiro', { questions: [
    { stage_id: s.stages.novo, text: 'Na etapa de contato', kind: 'options', spin: 'problem', profile_key: loja.profile_key, options: [o('a', 1), o('b', 0)] },
    { stage_id: s.stages.qualificando, text: 'Quantas casas?', kind: 'options', spin: 'situation', profile_key: porta.profile_key, options: [o('a', 1), o('b', 0)] },
    { stage_id: s.stages.qualificando, text: 'Loja ou porta?', kind: 'options', spin: 'situation', options: [o('Loja', 5, loja.profile_key), o('Porta', 5, porta.profile_key), o('x', 0, 'inventado')] },
    { stage_id: s.stages.qualificando, text: 'Perfil inventado', kind: 'text', profile_key: 'nao-existe' },
  ], deviations: [] }) }] })
  const d = await buildAiDraft(db, { accountId: s.accountId, funnelId: s.funnelId, ai })
  assert.match(prompt, /Novo.*tentativa de contato — sem perguntas/)
  assert.match(prompt, /Qualificando.*em conversa — perguntas SPIN/)
  assert.match(prompt, /revender limpeza/); assert.match(prompt, /mercadinho/); assert.match(prompt, /qual o preço da caixa/)
  assert.equal(d.questions.some(q => q.stage_id === s.stages.novo), false)
  const qual = d.questions.filter(q => q.stage_id === s.stages.qualificando).sort((a, b) => a.position - b.position)
  assert.equal(qual[0].text, 'Loja ou porta?') // descoberta primeiro
  assert.deepEqual(qual[0].options.map(x => x.sets_profile_key), [loja.profile_key, porta.profile_key, null])
  assert.equal(d.questions.find(q => q.text === 'Perfil inventado').profile_key, null)
  const fases = new Set(d.questions.map(q => q.spin))
  for (const k of ['situation', 'problem', 'implication', 'need_payoff']) assert.ok(fases.has(k), k)
  // ordem: Todos (descoberta, depois por fase) -> Loja -> Porta
  const idx = t => qual.findIndex(q => q.text === t)
  assert.ok(idx('Na etapa de contato') < idx('Quantas casas?'))
})

test('montar com IA sem conversas e sem briefing: monta mesmo assim', async () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const ai = fakeAi({ roteiro_draft: [p => { assert.match(p.messages[0].content, /roteiro SPIN geral/); return tool('propose_roteiro', { questions: [], deviations: [] }) }] })
  const d = await buildAiDraft(db, { accountId: s.accountId, funnelId: s.funnelId, ai })
  assert.equal(d.questions.length, 6) // modelo SPIN inteiro completou as fases
})
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** em `aiDraft.js`:
- `SYSTEM_PROMPT` novo:

```
Você monta roteiros de qualificação de vendas pelo WhatsApp em SPIN Selling para pequenas empresas brasileiras.
Regras:
- SPIN: situation (fatos do cliente hoje), problem (onde dói), implication (o que o problema custa se continuar), need_payoff (o cliente fala o ganho de resolver). Marque o campo spin.
- Só coloque perguntas em etapas "em conversa". Etapas "tentativa de contato" não recebem perguntas.
- Em cada etapa de conversa, para cada perfil: poucas de situation, mais de problem, mais de implication, 1 ou 2 de need_payoff, nessa ordem. Pergunta que vale para todos os perfis fica sem profile_key.
- Se houver 2 ou mais perfis: no começo da 1ª etapa de conversa, 1 pergunta de situation sem profile_key que descobre o perfil, com sets_profile_key em cada opção.
- Opções e palavras tiradas das falas reais dos clientes nas conversas. Perguntas curtas, simpáticas, objetivas, uma coisa por vez, em português do Brasil. Pode usar {nome}.
- Perguntas de opções têm de 2 a 10 opções; points vai de -50 a 50 (mais pontos = cliente mais perto de comprar). Prefira perguntas de opções.
- required = true só para o que é indispensável para avançar de etapa.
- ai_hint é uma dica curta de como reconhecer a resposta na conversa.
- deviations são perguntas comuns do cliente fora da ordem (ex.: preço): triggers são palavras separadas por vírgula; reply_text é a resposta pronta; return_question_index é o índice (0 = primeira) da pergunta para voltar ao roteiro.
Use sempre a ferramenta propose_roteiro.
```

- `PROPOSE_TOOL`: pergunta com `spin: { enum: SPIN_KEYS }`, `profile_key: { type: 'string' }`, opções com `sets_profile_key: { type: 'string' }` (sem `bant`).
- `loadBriefing` (exportado) inclui `knowledge_base: str(c.knowledge_base).slice(0, 4000)`.
- `buildUserContent({ briefing, business, sample, stages })`:

```js
  const parts = ['Etapas do funil:']
  for (const s of stages) parts.push(`- stage_id ${s.id}: ${s.name} (${isContactStage(s) ? 'tentativa de contato — sem perguntas' : 'em conversa — perguntas SPIN'})`)
  parts.push('')
  if (business.business_objective) parts.push(`Objetivo do negócio: ${business.business_objective}`)
  if (business.profiles.length) {
    parts.push('Perfis de cliente ideal (use o profile_key):')
    for (const p of business.profiles) parts.push(`- profile_key ${p.profile_key}: ${p.name}${p.description ? ` — como reconhecer: ${p.description}` : ''}`)
  } else parts.push('A conta não cadastrou perfis: todas as perguntas valem para todos (sem profile_key).')
  parts.push('')
  if (briefing) { /* o que descobrir / critério / campos (como hoje) + base de conhecimento */ }
  if (sample.text) parts.push(`Conversas reais da conta (${sample.count}):`, sample.text)
  if (!briefing && !sample.text) parts.push('Não há briefing nem conversas. Monte um roteiro SPIN geral de vendas.')
```

- `sanitizeQuestion(raw, { stageIds, fallbackStageId, profileKeys })`: etapa fora de `stageIds` (que agora são só as de conversa) → `fallbackStageId` (1ª de conversa); `spin` só em opções e só em `SPIN_KEYS` (pode repetir); `profile_key` fora de `profileKeys` → `null`; opções levam `sets_profile_key` só se existir em `profileKeys`.
- Depois de sanear: `for (const mq of missingSpinQuestions(questions)) questions.push({ ...mq, question_key: newKey(), stage_id: firstConvId, profile_key: null, ai_hint: null, options: mq.options.map((o, i) => ({ label: o.label, points: o.points, position: i, sets_profile_key: null })) })`.
- Ordem final por etapa — exportar:

```js
// Descoberta de perfil (Todos com sets_profile_key) primeiro; depois Todos, depois cada perfil na
// ordem cadastrada; dentro de cada grupo pela ordem SPIN (sem fase no fim); estavel.
export function orderStageQuestions(questions, profiles) {
  const rankProfile = new Map(profiles.map((p, i) => [p.profile_key, i + 1]))
  const isDiscovery = q => !q.profile_key && (q.options || []).some(o => o.sets_profile_key)
  const key = (q, i) => [isDiscovery(q) ? 0 : 1, q.profile_key ? (rankProfile.get(q.profile_key) ?? 99) : 0, q.spin ? SPIN_ORDER[q.spin] : 9, i]
  const cmp = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0 }
  return questions.map((q, i) => ({ q, k: key(q, i) })).sort((a, b) => cmp(a.k, b.k)).map(x => x.q)
}
```

  aplicar por etapa e numerar `position` 0..n.
- `maxTokens: 8000`; `MAX_QUESTIONS` sobe para 60.
- O `keyByIndex` (desvios) continua funcionando sobre o índice original da IA.

- [ ] **Step 4: Rodar** — `npm test` → verde.
- [ ] **Step 5: Commit** — `git commit -am "feat(roteiro): Montar com IA em SPIN por perfil lendo conversas reais"`

---

### Task 7: "Sugerir com IA" do objetivo e perfis + visão de etapa com perfis

**Files:**
- Create: `server/services/roteiro/aiProfiles.js`
- Modify: `server/routes/roteiroRouter.js`, `server/services/cadence/repo.js` (`getStageView`)
- Test: `test/roteiroAi.test.js`, `test/roteiroHttp.test.js`, `test/cadenceRepo.test.js`

**Interfaces:**
- Produces: `suggestBusiness(db, { accountId, ai }) → { business_objective: string|null, profiles: [{ name, description }] }` (não grava); rota `POST /api/roteiro/profiles/suggest` (gestor; 503 "A IA não está ligada nesta conta." sem IA/chave; 502 com a mensagem padrão se a IA falhar); `getStageView` devolve `stages[].is_contact` e `profiles: [{ profile_key, name }]`.

- [ ] **Step 1: Teste que falha:**

```js
test('sugerir perfis: le conversas e briefing, corta em 6 e nos limites, nao grava', async () => {
  const db = createRoteiroTestDb(); const s = seedRoteiroBase(db)
  const lead = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando })
  for (const [d, c] of [['inbound', 'tenho um mercadinho'], ['outbound', 'ok'], ['inbound', 'quanto custa?']]) addMessage(db, { leadId: lead, direction: d, content: c })
  const many = Array.from({ length: 8 }, (_, i) => ({ name: `Perfil ${i} ${'x'.repeat(80)}`, description: 'y'.repeat(600) }))
  const ai = fakeAi({ roteiro_profiles: [p => { assert.match(p.messages[0].content, /mercadinho/); return tool('propose_profiles', { business_objective: 'z'.repeat(400), profiles: many }) }] })
  const r = await suggestBusiness(db, { accountId: s.accountId, ai })
  assert.equal(r.profiles.length, 6); assert.equal(r.profiles[0].name.length, 60); assert.equal(r.profiles[0].description.length, 500)
  assert.equal(r.business_objective.length, 300)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roteiro_profiles').get().n, 0)
  await assert.rejects(suggestBusiness(db, { accountId: s.accountId, ai: fakeAi({ roteiro_profiles: [new Error('x')] }) }), /A IA não respondeu agora/)
})
```

e em `cadenceRepo.test.js`: `getStageView` marca `is_contact` true em "Novo" e false em "Qualificando", e lista `profiles` da conta.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** `aiProfiles.js`:

```js
// "Sugerir com IA" do cartao Negocio e clientes ideais (spec 2026-10-02 §8.5): propoe, nao grava.
import { RoteiroError } from './repo.js'
import { toolInput } from './aiCall.js'
import { sampleConversations } from './conversationSample.js'
import { loadBriefing } from './aiDraft.js'

const AI_FAILED_MESSAGE = 'A IA não respondeu agora. Monte à mão ou tente de novo.'
const str = v => (typeof v === 'string' ? v.trim() : '')
const SYSTEM_PROMPT = `Você ajuda pequenas empresas brasileiras a definir o objetivo do negócio e os perfis de cliente ideal (até 6) a partir das conversas reais de WhatsApp e do briefing.
- business_objective: uma frase curta do que a empresa vende e para quem (ex.: "revender produtos de limpeza").
- Cada perfil: name curto (ex.: "Loja", "Vendedor porta a porta") e description = como reconhecer esse cliente pelas mensagens (palavras que ele usa, situação dele).
- Só crie perfis que aparecem de verdade nas conversas ou no briefing. Na dúvida, menos perfis.
Use sempre a ferramenta propose_profiles.`
const TOOL = {
  name: 'propose_profiles',
  description: 'Propõe o objetivo do negócio e os perfis de cliente ideal.',
  input_schema: { type: 'object', properties: {
    business_objective: { type: 'string' },
    profiles: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] } },
  }, required: ['profiles'] },
}

export async function suggestBusiness(db, { accountId, ai }) {
  const sample = sampleConversations(db, { accountId })
  const briefing = loadBriefing(db, accountId)
  const parts = []
  if (briefing) {
    if (briefing.o_que_descubro.length) parts.push(`O que descobrir do cliente: ${briefing.o_que_descubro.join('; ')}`)
    if (briefing.qualification_criteria) parts.push(`Cliente qualificado quando: ${briefing.qualification_criteria}`)
    if (briefing.knowledge_base) parts.push(`Sobre o negócio: ${briefing.knowledge_base}`)
  }
  parts.push(sample.text ? `Conversas reais (${sample.count}):\n${sample.text}` : 'Não há conversas ainda.')
  let input = null
  try {
    const result = await ai.call({ accountId, systemPrompt: SYSTEM_PROMPT, messages: [{ role: 'user', content: parts.join('\n\n') }],
      tools: [TOOL], toolChoice: { type: 'tool', name: 'propose_profiles' }, maxTokens: 2000, source: 'roteiro_profiles' })
    input = toolInput(result, 'propose_profiles')
  } catch (e) { console.error('[Roteiro] sugerir perfis:', e && e.message) }
  if (!input) throw new RoteiroError('ai_failed', 502, AI_FAILED_MESSAGE)
  return {
    business_objective: str(input.business_objective).slice(0, 300) || null,
    profiles: (Array.isArray(input.profiles) ? input.profiles : [])
      .map(p => ({ name: str(p?.name).slice(0, 60), description: str(p?.description).slice(0, 500) }))
      .filter(p => p.name).slice(0, 6),
  }
}
```

Rota (mesmo padrão do `/ai-draft`):

```js
  router.post('/profiles/suggest', manager, async (req, res) => {
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.accountId)
    if (!ai || !pickAnthropicKey(account)) return res.status(503).json({ error: 'A IA não está ligada nesta conta.', code: 'ai_off' })
    try { res.json(await suggestBusiness(db, { accountId: req.accountId, ai })) } catch (e) { fail(res, e) }
  })
```

(declarar antes de qualquer rota `/profiles/:x` — não há outra.)

`getStageView`: importar `isContactStage` e `listProfiles`; cada etapa ganha `is_contact: isContactStage(st)`; retorno ganha `profiles: listProfiles(db, accountId).map(p => ({ profile_key: p.profile_key, name: p.name }))`.

- [ ] **Step 4: Rodar** — `npm test` → verde.
- [ ] **Step 5: Commit** — `git commit -am "feat(roteiro): sugerir objetivo e perfis com IA; etapa de contato e perfis na tela de cadencias"` (com `git add` do arquivo novo).

---

### Task 8: Telas do gestor (Cadências)

**Files:**
- Create: `src/pages/cadencias/BusinessProfilesCard.tsx`
- Modify: `src/lib/roteiroApi.ts`, `src/lib/cadenceApi.ts`, `src/lib/stageCadence.js`, `src/lib/stageCadence.d.ts`, `src/lib/roteiroManager.js`, `src/lib/roteiroManager.d.ts`, `src/pages/cadencias/StepPanel.tsx`, `src/pages/cadencias/StageEmpty.tsx`, `src/pages/cadencias/StepRow.tsx`, `src/pages/cadencias/StageCadences.tsx`
- Test: `test/stageCadence.test.js`, `test/roteiroManager.test.js`

**Interfaces:**
- Consumes: rotas das Tasks 2 e 7; `stage-view` com `is_contact` e `profiles`.
- Produces (front): `SpinKey = 'situation' | 'problem' | 'implication' | 'need_payoff'`, `SPIN_OPTIONS` (valor + rótulo, em `stageCadence.js`), `RoteiroProfile { profile_key, name, description, position }`, `fetchBusiness`, `saveBusiness`, `suggestBusiness`, `fetchLeadProfile`, `saveLeadProfile` (em `roteiroApi.ts`); form do passo com `spin`, `profile_key` e opção com `sets_profile_key`.

- [ ] **Step 1: Teste que falha** — em `test/stageCadence.test.js`:

```js
test('formFromStep/stepPatchFor levam spin, profile_key e sets_profile_key', () => {
  const step = { action_type: 'pergunta', delay_days: 0, question: { text: 'Tem loja?', kind: 'options', required: true, spin: 'situation', profile_key: null, ai_hint: null,
    options: [{ option_key: 'a', label: 'Sim', points: 5, sets_profile_key: 'loja' }, { option_key: 'b', label: 'Não', points: 0, sets_profile_key: null }] } }
  const form = formFromStep(step)
  assert.equal(form.spin, 'situation'); assert.equal(form.profile_key, null); assert.equal(form.options[0].sets_profile_key, 'loja')
  const r = stepPatchFor('pergunta', { ...form, profile_key: 'porta' })
  assert.equal(r.patch.question.spin, 'situation'); assert.equal(r.patch.question.profile_key, 'porta')
  assert.deepEqual(r.patch.question.options.map(o => o.sets_profile_key), ['loja', null])
  assert.equal('bant' in r.patch.question, false)
})
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar.**
- `stageCadence.js`: `export const SPIN_OPTIONS = [{ value: 'situation', label: 'Situação' }, { value: 'problem', label: 'Problema' }, { value: 'implication', label: 'Implicação' }, { value: 'need_payoff', label: 'Necessidade de Solução' }]`; `formFromStep` com `spin: q ? (q.spin ?? null) : null, profile_key: q ? (q.profile_key ?? null) : null` e opções com `sets_profile_key: o.sets_profile_key ?? null`; `stepPatchFor` manda `spin: form.spin || null, profile_key: form.profile_key || null` e cada opção `sets_profile_key: o.sets_profile_key || null`. `.d.ts` igual.
- `roteiroManager.js(.d.ts)`: `bant` → `spin` + `profile_key` (lib antiga; só manter compilando e testes verdes).
- `roteiroApi.ts`: `BantKey` → `SpinKey`; `bant` → `spin` + `profile_key: string | null` em `QState` e `RoteiroQuestion`; `RoteiroOption` ganha `sets_profile_key?: string | null` (em `src/lib/api.ts` se o tipo estiver lá); `LeadRoteiroBase` ganha `profile: { key: string | null; origin: 'ia' | 'manual' | null }`; `bantTemplate` → `spinTemplate` (`/spin-template`); novas:

```ts
export interface RoteiroProfile { profile_key: string; name: string; description: string | null; position: number }
export interface Business { business_objective: string | null; profiles: RoteiroProfile[] }
export const fetchBusiness = (accountId: number) => apiFetch<Business>(`/api/roteiro/profiles?account_id=${accountId}`)
export const saveBusiness = (accountId: number, body: { business_objective: string | null; profiles: { profile_key?: string; name: string; description: string | null }[] }) =>
  apiFetch<Business>(`/api/roteiro/profiles?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(body) })
export const suggestBusiness = (accountId: number) =>
  apiFetch<{ business_objective: string | null; profiles: { name: string; description: string }[] }>(`/api/roteiro/profiles/suggest?account_id=${accountId}`, { method: 'POST' })
export interface LeadProfileView { profile_key: string | null; origin: 'ia' | 'manual' | null; effective_key: string | null; profiles: { profile_key: string; name: string }[] }
export const fetchLeadProfile = (leadId: number, accountId: number) => apiFetch<LeadProfileView>(`${lp(leadId)}/roteiro-profile?account_id=${accountId}`)
export const saveLeadProfile = (leadId: number, accountId: number, profileKey: string | null) =>
  apiFetch<LeadProfileView>(`${lp(leadId)}/roteiro-profile?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ profile_key: profileKey }) })
```

- `cadenceApi.ts`: `QuestionInput` com `spin: SpinKey | null; profile_key: string | null` e opções com `sets_profile_key?: string | null`; `StageViewStage.is_contact: boolean`; `StageView.profiles: { profile_key: string; name: string }[]`; `stageTemplate(..., mode: 'spin' | 'ia')`; `LeadStep.not_applicable?: boolean`.
- `StepPanel.tsx`: recebe prop `profiles: { profile_key: string; name: string }[]`. Fora do "Mais opções", logo abaixo de "Obrigatória": 
  - campo **Fase SPIN** (select `step-spin`: Nenhuma + `SPIN_OPTIONS`) com `HelpTip`: "Situação = como o cliente faz hoje (ex.: "Como você resolve isso hoje?"). Problema = onde dói (ex.: "O que mais te incomoda?"). Implicação = o que custa se continuar (ex.: "E se continuar assim, o que acontece?"). Necessidade de Solução = o cliente fala o ganho (ex.: "Se estivesse resolvido, o que mudaria?")."
  - campo **Perfil** (select `step-profile`: "Todos" + perfis) só quando `profiles.length > 0`, HelpTip: "Para qual cliente ideal esta pergunta vale. Ex.: "Quantos clientes passam na loja?" só para o perfil Loja. "Todos" vale para qualquer lead."
  - em cada opção, quando `profiles.length >= 2` e o Perfil da pergunta é "Todos": select compacto "define o perfil" (vazio = "—") com `aria-label` `Esta resposta define o perfil (opção N)` e `title` "Opcional: quem escolher esta resposta passa a ser deste perfil. Ex.: "Tenho loja" → Loja".
  - remover o select BANT de "Mais opções".
- `StageEmpty.tsx`: modo `'bant'` → `'spin'`, botão "Começar com modelo SPIN", HelpTip: "Coloca 6 perguntas de venda SPIN: como o cliente faz hoje, o que incomoda (2), o que isso custa (2) e quanto vale resolver. Só as fases que o funil ainda não tem."; quando `stage.is_contact`, aviso acima dos botões: "Etapa de tentativa de contato: normalmente sem perguntas. Use mensagens e ligações até o cliente responder. Ex.: 1º Mensagem "Oi {nome}, vi seu cadastro" · 2º Ligação no dia 1."
- `StepRow.tsx`: prop `profileName?: string | null`; selo pequeno (`fontSize: 11`, borda `var(--border-subtle)`, `borderRadius: 'var(--radius-full)'`, padding `1px 7px`) com o nome do perfil quando a pergunta tem `profile_key`; título "Pergunta só para o perfil X".
- `BusinessProfilesCard.tsx` (props `accountId`, `onSaved(profiles)`): carrega `fetchBusiness`; cartão `className="card"` no topo de `StageCadences` com título "Negócio e clientes ideais" + HelpTip "Conte o que a empresa vende e quem são os clientes ideais. A IA usa isso para montar as perguntas certas para cada tipo de cliente. Ex.: Ustulimp — objetivo "revender produtos de limpeza"; perfis "Loja" (mercadinho, comércio, compra pra prateleira) e "Vendedor porta a porta" (renda extra, vende de casa em casa)."; campo Objetivo (input, maxLength 300, placeholder "ex.: revender produtos de limpeza"); lista de perfis (nome maxLength 60 placeholder "ex.: Loja", "Como reconhecer" maxLength 500 placeholder "ex.: tem mercadinho ou comércio, compra pra prateleira", botão tirar); [+ Perfil] (desligado com 6, `title` "Máximo de 6 perfis"); [Sugerir com IA] (preenche o formulário; mostra `AI_OFF_TEXT` quando `isAiOff`); [Salvar] (mostra "Salvo" por 3 s; erro do servidor em vermelho, ex.: "Este perfil tem perguntas..."). Começa recolhido quando já tem perfis (mostra "Objetivo · N perfis" e botão Editar); aberto quando vazio.
- `StageCadences.tsx`: renderiza `<BusinessProfilesCard accountId={accountId} onSaved={() => loadView()} />` acima dos chips de etapas; passa `profiles={view.profiles}` ao `StepPanel` e `profileName` ao `StepRow` (`view.profiles.find(p => p.profile_key === step.question?.profile_key)?.name`).

- [ ] **Step 4: Rodar** — `npm test` e `npx tsc --noEmit` (continuar com os 16 erros antigos, nenhum novo) e `npm run build`.
- [ ] **Step 5: Commit** — `git commit -am "feat(cadencias): fase SPIN, perfil por pergunta e cartao Negocio e clientes ideais"` (com `git add` do arquivo novo).

---

### Task 9: Perfil do lead no Chat e na ficha

**Files:**
- Create: `src/components/roteiro/LeadProfileSelect.tsx`
- Modify: `src/pages/Chat.tsx` (bloco `etapa` da aba Atendimento), `src/pages/LeadDetail.tsx` (ao lado do `ScoreThermometer`)

**Interfaces:**
- Consumes: `fetchLeadProfile`, `saveLeadProfile` (Task 8); SSE `lead:cadence`.
- Produces: `<LeadProfileSelect leadId accountId compact? />` — some quando a conta não tem perfis.

- [ ] **Step 1: Implementar** `LeadProfileSelect.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import HelpTip from '../HelpTip'
import { useSSE } from '../../context/SSEContext'
import { fetchLeadProfile, saveLeadProfile, type LeadProfileView } from '../../lib/roteiroApi'

// Perfil de cliente ideal do lead (spec 2026-10-02 §6, §9): IA identifica, vendedor corrige.
export default function LeadProfileSelect({ leadId, accountId }: { leadId: number; accountId: number }) {
  const [view, setView] = useState<LeadProfileView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => { fetchLeadProfile(leadId, accountId).then(setView).catch(() => setView(null)) }, [leadId, accountId])
  useEffect(() => { load() }, [load])
  useSSE('lead:cadence', useCallback((d: any) => { if (Number(d?.lead_id) === leadId) load() }, [leadId, load]))
  if (!view || !view.profiles.length) return null
  const change = async (key: string) => {
    setBusy(true); setError(null)
    try { setView(await saveLeadProfile(leadId, accountId, key || null)) } catch (e) { setError(e instanceof Error ? e.message : 'Erro.') } finally { setBusy(false) }
  }
  const auto = !view.profile_key && view.effective_key
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }} htmlFor={`lead-profile-${leadId}`}>
        Perfil do lead
        {view.origin === 'ia' && <span style={{ color: 'var(--text-muted)' }}>· identificado pela IA</span>}
        <HelpTip title="Perfil do lead">Que tipo de cliente ideal ele é. As perguntas da cadência mudam conforme o perfil. Ex.: quem diz "tenho um mercadinho" é Loja. A IA marca sozinha; se errar, troque aqui.</HelpTip>
      </label>
      <select id={`lead-profile-${leadId}`} className="select" disabled={busy} value={view.profile_key || ''} onChange={e => change(e.target.value)}>
        <option value="">{auto ? `${view.profiles.find(p => p.profile_key === view.effective_key)?.name} (único perfil)` : 'Ainda não sei'}</option>
        {view.profiles.map(p => <option key={p.profile_key} value={p.profile_key}>{p.name}</option>)}
      </select>
      {error && <div style={{ fontSize: 11, color: 'var(--negative)' }}>{error}</div>}
    </div>
  )
}
```

(Conferir o caminho e nome reais do hook de SSE usado em `NextStepCard.tsx` e usar o mesmo import.)

- `Chat.tsx`: dentro do cartão do bloco `etapa`, abaixo do `<select>` de etapa: `<div style={{ marginTop: 8 }}><LeadProfileSelect key={`perfil-${lead.id}`} leadId={lead.id} accountId={accountId} /></div>` (sem novo bloco → não mexe no "Arrumar"/`panel_layouts`).
- `LeadDetail.tsx`: logo abaixo do `ScoreThermometer`: `{accountId && <LeadProfileSelect key={`perfil-${lead.id}`} leadId={lead.id} accountId={accountId} />}`.

- [ ] **Step 2: Rodar** — `npx tsc --noEmit` (16 antigos), `npm run build` ok, `npm test` verde.
- [ ] **Step 3: Commit** — `git commit -am "feat(chat): seletor Perfil do lead no Atendimento e na ficha"` (com `git add` do arquivo novo).

---

### Task 10: Conferência final

- [ ] **Step 1:** `npm test` (tudo verde), `npx tsc --noEmit` (só os 16 antigos), `npm run build` ok; `grep -rn "bant" server src` → só `schema.js` (coluna morta + migração).
- [ ] **Step 2:** Revisão final da branch por revisor novo (modelo mais capaz) contra a spec §3-§9, §11, §12; corrigir críticos/importantes com TDD.
- [ ] **Step 3:** Conferir no navegador (CRM local, conta de teste): cartão "Negócio e clientes ideais" (salvar, limite 6, apagar perfil em uso → mensagem), etapa "Novo" com aviso de contato, "Começar com modelo SPIN" em Qualificando (6 perguntas), Fase SPIN/Perfil/define perfil no painel do passo, selo do perfil na lista, Chat → seletor "Perfil do lead" troca as perguntas da cadência, ficha do lead mostra o perfil e o Termômetro com motivo "Situação: ...".
- [ ] **Step 4:** Atualizar a memória `retomar-crm.md`; push só com o ok do dono.

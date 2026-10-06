# Funil que anda sozinho — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada etapa do funil de Vendas ganha um "papel" (novo, contato, atendimento, qualificado, proposta, venda, perdido) e o lead avança sozinho, só para a frente, quando acontece o evento do papel, com [Desfazer].

**Architecture:** coluna `funnel_stages.stage_role` + `funnels.roles_confirmed_at` (o funil só anda sozinho depois do "de-para" confirmado). Um motor único `server/services/autoFunnel/engine.js` (`tryAutoRole`) recebe "aconteceu o evento X do papel Y" e decide se move, sempre pela porta `moveLeadToStage` com `trigger = 'auto_<papel>'`. Os ganchos (mensagem humana, resposta do lead, ligação feita, perguntas respondidas, cliente ideal, proposta enviada, venda) só chamam o motor. Telas: Funis (papéis + de-para) e Chat (aviso "Movido para X · Desfazer" + botões "É cliente ideal" / "Proposta enviada").

**Tech Stack:** Node 20 local (produção Node 16), Express 4, better-sqlite3, React 19 + TS + Vite 4. Testes: `node --test test/` (rodar com `export PATH="/c/nvm4w/nodejs:$PATH"`).

**Spec:** `docs/superpowers/specs/2026-10-05-crm-simples-design.md` §3 (e §1 regras de usabilidade, §2 tipo de contato).

## Global Constraints

- Só avança: se o lead já está na etapa do gatilho ou depois dela (posição), nada muda.
- O gatilho leva direto à etapa do papel, mesmo pulando etapas no meio.
- Toda mudança automática passa por `moveLeadToStage` com `trigger = 'auto_<papel>'` e entra no `stage_history`.
- Papel `perdido` nunca é automático.
- Só funil `kind = 'vendas'` com `roles_confirmed_at` preenchido anda sozinho; Recompra continua com as regras do LTV.
- Só contato com `canAutomate(lead)` (lead/cliente) anda sozinho; revendedor/interno não.
- De-para não muda nenhum lead de etapa.
- Conta sem de-para continua exatamente como hoje (inclusive a regra antiga "1ª resposta: 1ª etapa → 2ª etapa").
- Tela sem jargão; exemplo em cada "?"; mudança automática mostra "Desfazer" em vez de travar.
- Mensagens de commit em português (`feat:`/`fix:`), sem emojis no código, toda query filtra por conta.
- Nunca commitar `vite.config.ts`, `dist/`, `.env`, `server/data/crm.db`.
- Falha no automático nunca derruba o fluxo que o chamou (envio, webhook, venda): só loga.

## Review Focus

1. Mensagem do lead chega na conta com funil confirmado → a regra antiga "1ª→2ª etapa" NÃO pode rodar junto (moveria duas vezes / para a etapa errada). Teste na Tarefa 4.
2. Gestor desfaz e, na mensagem seguinte, o lead volta a ser movido para a mesma etapa → bloquear o mesmo papel enquanto o lead estiver na etapa para onde voltou. Teste na Tarefa 2.
3. De-para com papéis fora de ordem (ex.: Qualificado numa etapa antes de Atendimento) ou a mesma etapa em dois papéis → recusar com mensagem clara. Teste na Tarefa 3.
4. Lead em etapa final (Venda/Perdido) ou em etapa extra depois do papel → nada muda. Teste na Tarefa 2.
5. Editor de etapas (PUT /funnels/:id/stages) salva e apaga o papel das etapas → o papel precisa sobreviver ao salvar. Teste na Tarefa 1.

---

## Fora deste plano (outros blocos do CRM simples)

- IA detectar proposta/orçamento enviado na conversa (§8.4) — entra no bloco "Atividades lidas pela IA"; aqui a proposta é pelo botão.
- Tela "Meu dia", Performance, detecção automática do tipo de contato.
- Mensagens que chegam pelo caminho de "polling" (`handlePolledMessage`) não disparam o automático (esse caminho já não tem nenhum gancho hoje).

## Estrutura de arquivos

- Create `server/services/autoFunnel/roles.js` — lista de papéis, schema, sugestão do de-para, funil padrão.
- Create `server/services/autoFunnel/engine.js` — `tryAutoRole`, `undoAutoMove`, `rolesActive`, hook de SSE.
- Create `server/services/autoFunnel/mapping.js` — `getRoleMap`, `confirmRoleMap`.
- Create `server/routes/autoFunnelRouter.js` — rotas do de-para, desfazer, cliente ideal, proposta enviada.
- Modify `server/db.js`, `server/index.js`, `server/routes/funnels.js`, `server/routes/accounts.js`, `server/routes/contracts.js`, `server/routes/messages.js`, `server/routes/leads.js`, `server/routes/cadencesRouter.js`, `server/routes/taskCadenceRouter.js`, `server/services/inboundHandler.js`, `server/services/aiAgent.js`, `server/services/cadence/leadCadence.js`, `server/services/roteiro/autoAdvance.js`, `server/services/roteiro/stageKind.js`.
- Create `test/helpers/autoFunnelDb.js`, `test/autoFunnelEngine.test.js`, `test/autoFunnelMapping.test.js`, `test/autoFunnelHttp.test.js`, `test/autoFunnelHooks.test.js`.
- Create `src/lib/autoFunnelApi.ts`, `src/components/funnel/RoleMapModal.tsx`, `src/components/funnel/AutoMoveNotice.tsx`, `src/components/funnel/FunnelQuickActions.tsx`; Modify `src/pages/Funnels.tsx`, `src/pages/Chat.tsx`, `src/lib/api.ts` (tipo `FunnelStage`).

---

### Task 1: Papéis no banco + funil padrão novo

**Files:**
- Create: `server/services/autoFunnel/roles.js`
- Create: `test/helpers/autoFunnelDb.js`
- Create: `test/autoFunnelMapping.test.js` (primeiros testes; a Tarefa 3 completa)
- Modify: `server/db.js` (chamar `applyFunnelRolesSchema(db)` junto dos outros `apply*Schema` no fim do arquivo)
- Modify: `server/routes/accounts.js:35-50`, `server/routes/contracts.js:393-406` (usar `createDefaultSalesFunnel`)
- Modify: `server/routes/funnels.js` POST `/` (aceitar `stage_role` por etapa)
- Modify: `server/services/roteiro/stageKind.js` (papel manda quando existe)

**Interfaces:**
- Produces:
  - `ROLE_ORDER: string[]` = `['novo','contato','atendimento','qualificado','proposta','venda','perdido']`
  - `ROLE_LABELS: Record<string,{name,color,when}>`
  - `applyFunnelRolesSchema(db): void` — `funnel_stages.stage_role TEXT`, `funnels.roles_confirmed_at TEXT`, `leads.auto_block_stage_id INTEGER`, `leads.auto_block_role TEXT`
  - `createDefaultSalesFunnel(db, accountId, { name = 'Funil Principal', isDefault = 1 } = {}): number` (id do funil, já confirmado)
  - `suggestRoleMap(stages): Record<role, stageId|null>`
  - `test/helpers/autoFunnelDb.js`: `createAutoFunnelTestDb()`, `seedAutoFunnel(db) -> { accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages:{novo,contato,atendimento,qualificado,proposta,venda,perdido}, instanceId }`, `leadAt(db, s, roleKey, fields={}) -> leadId`

- [ ] **Step 1: Escrever o helper de teste**

```js
// test/helpers/autoFunnelDb.js
// Banco de teste do funil que anda sozinho: LTV (funnels.kind) + tipo de contato + papeis.
import { createLtvTestDb } from './ltvDb.js'
import { createLegacyCadenceTables } from './cadenceDb.js'
import { applyCadenceSchema } from '../../server/services/cadence/schema.js'
import { applyContactSchema } from '../../server/services/contacts/schema.js'
import { applyFunnelRolesSchema, createDefaultSalesFunnel } from '../../server/services/autoFunnel/roles.js'
import { addLead } from './roteiroDb.js'

export function createAutoFunnelTestDb() {
  const db = createLtvTestDb()
  for (const [c, t] of [['is_qualified', 'INTEGER NOT NULL DEFAULT 0'], ['is_meeting', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!db.prepare('PRAGMA table_info(funnel_stages)').all().some(x => x.name === c)) db.exec(`ALTER TABLE funnel_stages ADD COLUMN ${c} ${t}`)
  }
  for (const c of ['proposal_sent_at', 'qualified_at']) {
    if (!db.prepare('PRAGMA table_info(leads)').all().some(x => x.name === c)) db.exec(`ALTER TABLE leads ADD COLUMN ${c} TEXT`)
  }
  createLegacyCadenceTables(db)
  applyCadenceSchema(db)
  applyContactSchema(db)
  applyFunnelRolesSchema(db)
  return db
}

export function seedAutoFunnel(db) {
  const accountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta A')").run().lastInsertRowid)
  const otherAccountId = Number(db.prepare("INSERT INTO accounts (name) VALUES ('Conta B')").run().lastInsertRowid)
  const gerenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Gestora', 'g@a.local', 'gerente')").run(accountId).lastInsertRowid)
  const atendenteId = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Ana', 'ana@a.local', 'atendente')").run(accountId).lastInsertRowid)
  const funnelId = createDefaultSalesFunnel(db, accountId)
  const stages = {}
  for (const r of db.prepare('SELECT id, stage_role FROM funnel_stages WHERE funnel_id = ?').all(funnelId)) stages[r.stage_role] = r.id
  const instanceId = Number(db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, status) VALUES (?, 'n1', 'connected')").run(accountId).lastInsertRowid)
  return { accountId, otherAccountId, gerenteId, atendenteId, funnelId, stages, instanceId }
}

export function leadAt(db, s, roleKey, fields = {}) {
  return addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages[roleKey], ...fields })
}
```

- [ ] **Step 2: Escrever os testes que falham**

```js
// test/autoFunnelMapping.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutoFunnelTestDb, seedAutoFunnel } from './helpers/autoFunnelDb.js'
import { ROLE_ORDER, suggestRoleMap, applyFunnelRolesSchema } from '../server/services/autoFunnel/roles.js'
import { isContactStage } from '../server/services/roteiro/stageKind.js'

test('funil padrao novo nasce com 7 etapas, papeis na ordem e confirmado', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const rows = db.prepare('SELECT name, stage_role, position, is_conversion, is_terminal, is_qualified FROM funnel_stages WHERE funnel_id = ? ORDER BY position').all(s.funnelId)
  assert.deepEqual(rows.map(r => r.stage_role), ROLE_ORDER)
  assert.deepEqual(rows.map(r => r.name), ['Novo Lead', 'Contato Feito', 'Atendimento', 'Qualificado', 'Orçamento/Proposta', 'Venda', 'Perdido'])
  assert.deepEqual(rows.map(r => [r.is_conversion, r.is_terminal]).slice(5), [[1, 1], [0, 1]])
  assert.equal(rows[3].is_qualified, 1)
  assert.ok(db.prepare('SELECT roles_confirmed_at FROM funnels WHERE id = ?').get(s.funnelId).roles_confirmed_at)
  applyFunnelRolesSchema(db) // idempotente
})

test('sugestao do de-para: funil antigo da conta (7 etapas de antes)', () => {
  const st = (id, name, position, extra = {}) => ({ id, name, position, is_conversion: 0, is_terminal: 0, is_qualified: 0, ...extra })
  const map = suggestRoleMap([
    st(1, 'Novo Lead', 0), st(2, 'Em Atendimento', 1), st(3, 'Qualificado', 2), st(4, 'Visita Agendada', 3),
    st(5, 'Proposta', 4), st(6, 'Venda', 5, { is_conversion: 1, is_terminal: 1 }), st(7, 'Perdido', 6, { is_terminal: 1 }),
  ])
  assert.deepEqual(map, { novo: 1, contato: null, atendimento: 2, qualificado: 3, proposta: 5, venda: 6, perdido: 7 })
})

test('sugestao do de-para: nomes livres usam marcas e a 1a etapa vira novo', () => {
  const map = suggestRoleMap([
    { id: 10, name: 'Entrada', position: 0 }, { id: 11, name: 'Tentando contato', position: 1 }, { id: 12, name: 'Negociando', position: 2 },
    { id: 13, name: 'Bom perfil', position: 3, is_qualified: 1 }, { id: 14, name: 'Orçamento enviado', position: 4 },
    { id: 15, name: 'Fechou', position: 5, is_conversion: 1, is_terminal: 1 }, { id: 16, name: 'Desistiu', position: 6, is_terminal: 1 },
  ])
  assert.deepEqual(map, { novo: 10, contato: 11, atendimento: 12, qualificado: 13, proposta: 14, venda: 15, perdido: 16 })
})

test('etapa com papel: o papel manda no tipo (contato x conversa), nao o nome', () => {
  assert.equal(isContactStage({ name: 'Atendimento', stage_role: 'contato', is_terminal: 0 }), true)
  assert.equal(isContactStage({ name: 'Contato Feito', stage_role: 'atendimento', is_terminal: 0 }), false)
  assert.equal(isContactStage({ name: 'Novo Lead', stage_role: null, is_terminal: 0 }), true) // sem papel: pelo nome
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/autoFunnelMapping.test.js`
Expected: FAIL — `Cannot find module '.../autoFunnel/roles.js'`.

- [ ] **Step 4: Implementar `roles.js`**

```js
// server/services/autoFunnel/roles.js
// Papeis das etapas do funil de Vendas (spec 2026-10-05 crm simples §3). A regra e do papel;
// o nome e livre. Nao importa server/db.js: recebe db.
export const ROLE_ORDER = ['novo', 'contato', 'atendimento', 'qualificado', 'proposta', 'venda', 'perdido']

export const ROLE_LABELS = {
  novo: { name: 'Novo Lead', color: '#FFB300', when: 'o lead chega' },
  contato: { name: 'Contato Feito', color: '#F5B041', when: 'o vendedor manda a 1ª mensagem ou registra uma ligação' },
  atendimento: { name: 'Atendimento', color: '#5DADE2', when: 'o cliente responde depois de um contato' },
  qualificado: { name: 'Qualificado', color: '#9B59B6', when: 'as perguntas obrigatórias foram respondidas ou o vendedor marca "É cliente ideal"' },
  proposta: { name: 'Orçamento/Proposta', color: '#FF6B8A', when: 'o vendedor marca "Proposta enviada"' },
  venda: { name: 'Venda', color: '#34C759', when: 'a venda é registrada' },
  perdido: { name: 'Perdido', color: '#FF6B6B', when: 'só à mão, com motivo' },
}

function addCol(db, table, col, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
}

export function applyFunnelRolesSchema(db) {
  addCol(db, 'funnel_stages', 'stage_role', 'TEXT')
  addCol(db, 'funnels', 'roles_confirmed_at', 'TEXT')
  addCol(db, 'leads', 'auto_block_stage_id', 'INTEGER')
  addCol(db, 'leads', 'auto_block_role', 'TEXT')
}

// Flags fixas por papel: venda = conversao + final; perdido = final; qualificado = qualificado.
export function roleFlags(role) {
  return {
    is_conversion: role === 'venda' ? 1 : 0,
    is_terminal: role === 'venda' || role === 'perdido' ? 1 : 0,
    is_qualified: role === 'qualificado' ? 1 : 0,
  }
}

export function createDefaultSalesFunnel(db, accountId, { name = 'Funil Principal', isDefault = 1 } = {}) {
  let funnelId
  db.transaction(() => {
    funnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, roles_confirmed_at) VALUES (?, ?, ?, datetime('now'))")
      .run(accountId, name, isDefault).lastInsertRowid)
    const ins = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, is_qualified, stage_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    ROLE_ORDER.forEach((role, i) => {
      const f = roleFlags(role)
      ins.run(funnelId, ROLE_LABELS[role].name, i, ROLE_LABELS[role].color, f.is_conversion, f.is_terminal, f.is_qualified, role)
    })
  })()
  return funnelId
}

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const NAME_HINTS = {
  novo: ['novo', 'nova', 'entrada'],
  contato: ['contato', 'tentativa', 'tentando', 'prospec'],
  atendimento: ['atend', 'convers', 'negoci'],
  qualificado: ['qualific'],
  proposta: ['propost', 'orcament'],
}

// Para cada papel, a etapa mais parecida (marcas primeiro, depois nome); cada etapa num papel so.
// Sem etapa de novo pelo nome, a 1a etapa nao final vira novo.
export function suggestRoleMap(stages) {
  const list = [...(stages || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const used = new Set()
  const map = Object.fromEntries(ROLE_ORDER.map(r => [r, null]))
  const take = (role, pred) => {
    if (map[role]) return
    const s = list.find(x => !used.has(x.id) && pred(x))
    if (s) { map[role] = s.id; used.add(s.id) }
  }
  take('venda', s => s.is_conversion)
  take('perdido', s => s.is_terminal && !s.is_conversion)
  take('qualificado', s => s.is_qualified)
  for (const role of ['novo', 'contato', 'atendimento', 'qualificado', 'proposta']) {
    take(role, s => !s.is_terminal && NAME_HINTS[role].some(w => norm(s.name).includes(w)))
  }
  take('novo', s => !s.is_terminal)
  return map
}
```

E em `server/services/roteiro/stageKind.js`, primeira linha de `isContactStage` depois do `if (!stage || stage.is_terminal) return false`:

```js
  if (stage.stage_role) return stage.stage_role === 'novo' || stage.stage_role === 'contato'
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/autoFunnelMapping.test.js`
Expected: PASS (4 testes).

- [ ] **Step 6: Ligar no boot e nos lugares que criam funil**

`server/db.js`: ao lado das outras chamadas `apply*Schema(db)` do fim do arquivo:

```js
import { applyFunnelRolesSchema } from './services/autoFunnel/roles.js'
// ...
applyFunnelRolesSchema(db)
```

`server/routes/accounts.js` (bloco das linhas 35-50) e `server/routes/contracts.js` (bloco 393-406): trocar a criação inline do funil + `stageStmt` por:

```js
import { createDefaultSalesFunnel } from '../services/autoFunnel/roles.js'
// ...
createDefaultSalesFunnel(db, result.lastInsertRowid)   // accounts.js
createDefaultSalesFunnel(db, accountId)                // contracts.js
```

(manter o `ensureRepurchaseFunnel` logo depois, como está).

`server/routes/funnels.js` POST `/`: incluir `stage_role` no INSERT e marcar confirmado quando vier algum papel válido:

```js
import { ROLE_ORDER } from '../services/autoFunnel/roles.js'
// no INSERT: acrescentar a coluna stage_role e o valor
//   ROLE_ORDER.includes(s.stage_role) ? s.stage_role : null
// depois do forEach:
if (Array.isArray(stages) && stages.some(s => ROLE_ORDER.includes(s.stage_role))) {
  db.prepare("UPDATE funnels SET roles_confirmed_at = datetime('now') WHERE id = ?").run(funnelId)
}
```

O PUT `/:id/stages` NÃO lista `stage_role` no UPDATE (fica como está) — o papel sobrevive ao salvar. Etapa nova criada pelo editor nasce sem papel.

- [ ] **Step 7: Teste do Review Focus 5 (papel sobrevive ao editor)**

Acrescentar em `test/autoFunnelMapping.test.js`:

```js
import fs from 'node:fs'
test('PUT /funnels/:id/stages nao mexe em stage_role (UPDATE nao lista a coluna)', () => {
  const src = fs.readFileSync(new URL('../server/routes/funnels.js', import.meta.url), 'utf8')
  const update = src.match(/UPDATE funnel_stages SET[^']*/)[0]
  assert.ok(!update.includes('stage_role'))
})
```

Run: `node --test test/autoFunnelMapping.test.js` → PASS. Run `npm test` → tudo verde.

- [ ] **Step 8: Commit**

```bash
git add server/services/autoFunnel/roles.js server/services/roteiro/stageKind.js server/db.js server/routes/accounts.js server/routes/contracts.js server/routes/funnels.js test/helpers/autoFunnelDb.js test/autoFunnelMapping.test.js
git commit -m "feat(funil): papeis das etapas e funil padrao de 7 etapas confirmado"
```

---

### Task 2: Motor — avançar por papel e desfazer

**Files:**
- Create: `server/services/autoFunnel/engine.js`
- Create: `test/autoFunnelEngine.test.js`

**Interfaces:**
- Consumes: `moveLeadToStage(db, { lead, toStageId, trigger, userId, gate })` de `server/services/stageMove.js`; `canAutomate(lead)` de `server/services/contacts/scope.js`; `ROLE_ORDER` (Tarefa 1).
- Produces:
  - `rolesActive(db, funnelId): boolean` — funil `kind='vendas'` (ou sem kind) com `roles_confirmed_at`.
  - `tryAutoRole(db, { leadId, role, userId = null }): null | { from, to, to_name, role, history_id }` — nunca lança.
  - `undoAutoMove(db, { accountId, leadId, userId = null }): { from, to, to_name }` — lança `AutoFunnelError` 404/400.
  - `configureAutoFunnel({ broadcast })` — SSE `lead:auto_moved { lead_id, history_id, role, from_name, to_name, attendant_id }`.
  - `class AutoFunnelError extends Error { code, status }`

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/autoFunnelEngine.test.js
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createAutoFunnelTestDb, seedAutoFunnel, leadAt } from './helpers/autoFunnelDb.js'
import { tryAutoRole, undoAutoMove, rolesActive, configureAutoFunnel } from '../server/services/autoFunnel/engine.js'
import { configureStageMoveHooks } from '../server/services/stageMove.js'

afterEach(() => { configureAutoFunnel({ broadcast: null }); configureStageMoveHooks({ onMoved: null }) })
const stageOf = (db, id) => db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(id).stage_id

test('avanca so para a frente, pulando etapas, com trigger auto_<papel> e SSE', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const sent = []; configureAutoFunnel({ broadcast: (acc, ev, d) => sent.push([acc, ev, d]) })
  const id = leadAt(db, s, 'novo')
  const r = tryAutoRole(db, { leadId: id, role: 'proposta' })
  assert.equal(r.to, s.stages.proposta)
  assert.equal(stageOf(db, id), s.stages.proposta)
  assert.equal(db.prepare('SELECT trigger_type FROM stage_history WHERE id = ?').get(r.history_id).trigger_type, 'auto_proposta')
  assert.ok(db.prepare('SELECT proposal_sent_at FROM leads WHERE id = ?').get(id).proposal_sent_at)
  assert.deepEqual(sent.map(x => x[1]), ['lead:auto_moved'])
  assert.equal(sent[0][2].to_name, 'Orçamento/Proposta')
  assert.equal(tryAutoRole(db, { leadId: id, role: 'atendimento' }), null) // nunca volta
  assert.equal(tryAutoRole(db, { leadId: id, role: 'proposta' }), null)    // ja esta
  assert.equal(stageOf(db, id), s.stages.proposta)
})

test('nao anda: etapa final, perdido, revendedor/interno, Recompra, funil sem de-para, outra etapa extra depois', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const vendido = leadAt(db, s, 'venda')
  assert.equal(tryAutoRole(db, { leadId: vendido, role: 'venda' }), null)
  const novo = leadAt(db, s, 'novo')
  assert.equal(tryAutoRole(db, { leadId: novo, role: 'perdido' }), null)
  const interno = leadAt(db, s, 'novo', { contact_type: 'interno' })
  assert.equal(tryAutoRole(db, { leadId: interno, role: 'contato' }), null)
  db.prepare('UPDATE funnels SET roles_confirmed_at = NULL WHERE id = ?').run(s.funnelId)
  assert.equal(rolesActive(db, s.funnelId), false)
  assert.equal(tryAutoRole(db, { leadId: novo, role: 'contato' }), null)
  db.prepare("UPDATE funnels SET roles_confirmed_at = datetime('now'), kind = 'recompra' WHERE id = ?").run(s.funnelId)
  assert.equal(tryAutoRole(db, { leadId: novo, role: 'contato' }), null)
  assert.equal(stageOf(db, novo), s.stages.novo)
})

test('etapa extra sem papel: pula por cima so se o lead estiver antes dela', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  db.prepare('UPDATE funnel_stages SET position = position + 1 WHERE funnel_id = ? AND position >= 4').run(s.funnelId)
  const visita = Number(db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Visita Agendada', 4)").run(s.funnelId).lastInsertRowid)
  const naVisita = leadAt(db, s, 'novo'); db.prepare('UPDATE leads SET stage_id = ? WHERE id = ?').run(visita, naVisita)
  assert.equal(tryAutoRole(db, { leadId: naVisita, role: 'atendimento' }), null)
  assert.equal(tryAutoRole(db, { leadId: naVisita, role: 'proposta' }).to, s.stages.proposta)
})

test('desfazer volta para a etapa de antes e bloqueia o mesmo papel ate sair dali', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const id = leadAt(db, s, 'novo')
  tryAutoRole(db, { leadId: id, role: 'contato' })
  const u = undoAutoMove(db, { accountId: s.accountId, leadId: id, userId: s.gerenteId })
  assert.equal(u.to, s.stages.novo)
  assert.equal(stageOf(db, id), s.stages.novo)
  assert.equal(db.prepare("SELECT trigger_type FROM stage_history WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(id).trigger_type, 'auto_undo')
  assert.equal(tryAutoRole(db, { leadId: id, role: 'contato' }), null)            // mesmo papel: bloqueado
  assert.equal(tryAutoRole(db, { leadId: id, role: 'atendimento' }).to, s.stages.atendimento) // outro papel: anda
  assert.throws(() => undoAutoMove(db, { accountId: s.otherAccountId, leadId: id }), e => e.status === 404)
  db.prepare('UPDATE leads SET stage_id = ? WHERE id = ?').run(s.stages.qualificado, id) // mexeu a mao
  assert.throws(() => undoAutoMove(db, { accountId: s.accountId, leadId: id }), e => e.status === 400)
})

test('erro dentro do motor nao lanca (devolve null)', () => {
  const db = createAutoFunnelTestDb(); seedAutoFunnel(db)
  assert.equal(tryAutoRole(db, { leadId: 99999, role: 'contato' }), null)
  assert.equal(tryAutoRole(db, { leadId: 'x', role: 'nao-existe' }), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/autoFunnelEngine.test.js`
Expected: FAIL — módulo `engine.js` não existe.

- [ ] **Step 3: Implementar `engine.js`**

```js
// server/services/autoFunnel/engine.js
// Motor do funil que anda sozinho (spec 2026-10-05 crm simples §3): "aconteceu o evento do
// papel X" -> move o lead para a etapa do papel, so para a frente, pela porta moveLeadToStage.
// Nao importa server/db.js: recebe db.
import { moveLeadToStage } from '../stageMove.js'
import { canAutomate } from '../contacts/scope.js'
import { ROLE_ORDER } from './roles.js'

export class AutoFunnelError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status }
}

let broadcast = null
export function configureAutoFunnel({ broadcast: b = null } = {}) { broadcast = b }

const AUTO_ROLES = ROLE_ORDER.filter(r => r !== 'perdido')

export function rolesActive(db, funnelId) {
  if (!funnelId) return false
  const f = db.prepare('SELECT * FROM funnels WHERE id = ?').get(funnelId)
  return !!(f && f.roles_confirmed_at && (f.kind || 'vendas') === 'vendas')
}

function move(db, { leadId, role, userId }) {
  if (!AUTO_ROLES.includes(role)) return null
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead || !lead.funnel_id || !lead.stage_id || !canAutomate(lead)) return null
  if (!rolesActive(db, lead.funnel_id)) return null
  if (lead.auto_block_stage_id === lead.stage_id && lead.auto_block_role === role) return null
  const current = db.prepare('SELECT * FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  const target = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND stage_role = ?').get(lead.funnel_id, role)
  if (!current || !target || current.is_terminal) return null
  if (target.position <= current.position) return null // so para a frente
  const r = moveLeadToStage(db, { lead, toStageId: target.id, trigger: `auto_${role}`, userId, gate: false })
  if (!r.moved) return null
  if (role === 'qualificado') db.prepare("UPDATE leads SET qualified_at = COALESCE(qualified_at, datetime('now')) WHERE id = ?").run(lead.id)
  if (role === 'proposta') db.prepare("UPDATE leads SET proposal_sent_at = COALESCE(proposal_sent_at, datetime('now')) WHERE id = ?").run(lead.id)
  const out = { from: current.id, to: target.id, to_name: target.name, role, history_id: r.historyId }
  try {
    broadcast?.(lead.account_id, 'lead:auto_moved', { lead_id: lead.id, history_id: r.historyId, role, from_name: current.name, to_name: target.name, attendant_id: lead.attendant_id ?? null })
  } catch (e) { console.error('[Funil auto] SSE:', e?.message) }
  return out
}

// Nunca lanca: quem chama (envio, webhook, venda) nao pode cair por causa do automatico.
export function tryAutoRole(db, { leadId, role, userId = null }) {
  try {
    return move(db, { leadId: Number(leadId), role, userId })
  } catch (e) {
    console.error('[Funil auto]', role, e?.message)
    return null
  }
}

export function undoAutoMove(db, { accountId, leadId, userId = null }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new AutoFunnelError('not_found', 404, 'Lead não encontrado.')
  const last = db.prepare("SELECT * FROM stage_history WHERE lead_id = ? ORDER BY id DESC LIMIT 1").get(lead.id)
  if (!last || !String(last.trigger_type || '').startsWith('auto_') || last.trigger_type === 'auto_undo' || last.to_stage_id !== lead.stage_id) {
    throw new AutoFunnelError('nothing_to_undo', 400, 'Não há mudança automática para desfazer.')
  }
  const role = last.trigger_type.slice('auto_'.length)
  db.transaction(() => {
    moveLeadToStage(db, { lead, toStageId: last.from_stage_id, trigger: 'auto_undo', userId, gate: false })
    db.prepare('UPDATE leads SET auto_block_stage_id = ?, auto_block_role = ? WHERE id = ?').run(last.from_stage_id, role, lead.id)
  })()
  const back = db.prepare('SELECT name FROM funnel_stages WHERE id = ?').get(last.from_stage_id)
  return { from: lead.stage_id, to: last.from_stage_id, to_name: back?.name || '' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/autoFunnelEngine.test.js` → PASS (5 testes). Se `undoAutoMove` em lead movido à mão falhar por pegar a última linha errada, conferir que o UPDATE manual do teste não grava histórico (por isso a regra compara `to_stage_id` com a etapa atual).

- [ ] **Step 5: Ligar o SSE no boot**

`server/index.js`, logo depois de `bootRoteiroRuntime(...)` (linha 57):

```js
import { configureAutoFunnel } from './services/autoFunnel/engine.js'
// ...
configureAutoFunnel({ broadcast: broadcastSSE })
```

- [ ] **Step 6: Commit**

```bash
git add server/services/autoFunnel/engine.js server/index.js test/autoFunnelEngine.test.js
git commit -m "feat(funil): motor que avanca o lead pelo papel da etapa, com desfazer"
```

---

### Task 3: De-para + rotas (desfazer, cliente ideal, proposta enviada)

**Files:**
- Create: `server/services/autoFunnel/mapping.js`
- Create: `server/routes/autoFunnelRouter.js`
- Modify: `server/index.js` (montar `/api/auto-funnel`)
- Modify: `test/autoFunnelMapping.test.js`
- Create: `test/autoFunnelHttp.test.js`

**Interfaces:**
- Consumes: `suggestRoleMap`, `roleFlags`, `ROLE_ORDER`, `ROLE_LABELS` (Tarefa 1); `tryAutoRole`, `undoAutoMove`, `AutoFunnelError` (Tarefa 2).
- Produces:
  - `getRoleMap(db, { accountId, funnelId }) -> { funnel_id, confirmed: boolean, stages: [{id,name,position,stage_role}], map: Record<role, stageId|null>, labels: ROLE_LABELS }` — `map` = papéis gravados se confirmado, senão a sugestão.
  - `confirmRoleMap(db, { accountId, funnelId, map }) -> mesmo formato de getRoleMap` — `map[role]` = id da etapa ou `null` (= criar etapa nova).
  - Rotas (todas `authenticate, scopeToAccount`):
    - `GET /api/auto-funnel/funnels/:funnelId/roles` (gestor)
    - `PUT /api/auto-funnel/funnels/:funnelId/roles` body `{ map }` (gestor) → SSE `funnels:updated { funnel_id }`
    - `POST /api/auto-funnel/leads/:leadId/undo` (gestor ou atendente com acesso) → `{ from, to, to_name }`
    - `POST /api/auto-funnel/leads/:leadId/ideal` → `{ moved: result|null }`
    - `POST /api/auto-funnel/leads/:leadId/proposal-sent` → `{ moved: result|null }` (grava `proposal_sent_at` mesmo se não mover)

- [ ] **Step 1: Testes do de-para que falham**

Acrescentar em `test/autoFunnelMapping.test.js`:

```js
import { getRoleMap, confirmRoleMap } from '../server/services/autoFunnel/mapping.js'

function funilAntigo(db, accountId) {
  const funnelId = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Antigo', 0, 1)").run(accountId).lastInsertRowid)
  const mk = (name, pos, conv = 0, term = 0) => Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, is_conversion, is_terminal) VALUES (?, ?, ?, ?, ?)').run(funnelId, name, pos, conv, term).lastInsertRowid)
  return { funnelId, ids: { novo: mk('Novo Lead', 0), atend: mk('Em Atendimento', 1), qual: mk('Qualificado', 2), visita: mk('Visita Agendada', 3), prop: mk('Proposta', 4), venda: mk('Venda', 5, 1, 1), perdido: mk('Perdido', 6, 0, 1) } }
}

test('de-para: sugere, confirma, cria papel que falta no lugar certo e nao muda lead', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const { funnelId, ids } = funilAntigo(db, s.accountId)
  const lead = Number(db.prepare('INSERT INTO leads (account_id, funnel_id, stage_id, name) VALUES (?, ?, ?, ?)').run(s.accountId, funnelId, ids.visita, 'L').lastInsertRowid)
  const before = getRoleMap(db, { accountId: s.accountId, funnelId })
  assert.equal(before.confirmed, false)
  assert.equal(before.map.contato, null)
  const after = confirmRoleMap(db, { accountId: s.accountId, funnelId, map: before.map })
  assert.equal(after.confirmed, true)
  assert.deepEqual(after.stages.map(x => [x.name, x.stage_role]), [
    ['Novo Lead', 'novo'], ['Contato Feito', 'contato'], ['Em Atendimento', 'atendimento'], ['Qualificado', 'qualificado'],
    ['Visita Agendada', null], ['Proposta', 'proposta'], ['Venda', 'venda'], ['Perdido', 'perdido'],
  ])
  assert.deepEqual(after.stages.map(x => x.position), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(lead).stage_id, ids.visita)
  assert.equal(db.prepare('SELECT is_qualified FROM funnel_stages WHERE id = ?').get(ids.qual).is_qualified, 1)
})

test('de-para recusa: ordem trocada, etapa repetida, etapa de outro funil, funil de outra conta, Recompra', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const { funnelId, ids } = funilAntigo(db, s.accountId)
  const base = { novo: ids.novo, contato: null, atendimento: ids.atend, qualificado: ids.qual, proposta: ids.prop, venda: ids.venda, perdido: ids.perdido }
  const err = (map, fid = funnelId, acc = s.accountId) => { try { confirmRoleMap(db, { accountId: acc, funnelId: fid, map }); return null } catch (e) { return e } }
  assert.match(err({ ...base, qualificado: ids.novo, novo: ids.qual }).message, /ordem/)
  assert.match(err({ ...base, proposta: ids.qual }).message, /mesma etapa/)
  assert.equal(err({ ...base, contato: s.stages.contato }).status, 400)
  assert.equal(err(base, funnelId, s.otherAccountId).status, 404)
  db.prepare("UPDATE funnels SET kind = 'recompra' WHERE id = ?").run(funnelId)
  assert.equal(err(base).status, 400)
  assert.equal(db.prepare('SELECT roles_confirmed_at FROM funnels WHERE id = ?').get(funnelId).roles_confirmed_at, null)
})
```

Run: `node --test test/autoFunnelMapping.test.js` → FAIL (módulo `mapping.js` não existe).

- [ ] **Step 2: Implementar `mapping.js`**

```js
// server/services/autoFunnel/mapping.js
// De-para (spec §3): para cada papel, a etapa atual mais parecida; o gestor confere e confirma.
// Papel sem etapa ganha etapa nova no lugar certo. Nenhum lead muda de etapa.
import { ROLE_ORDER, ROLE_LABELS, roleFlags, suggestRoleMap } from './roles.js'
import { AutoFunnelError } from './engine.js'

function loadFunnel(db, accountId, funnelId) {
  const f = db.prepare('SELECT * FROM funnels WHERE id = ? AND account_id = ?').get(funnelId, accountId)
  if (!f) throw new AutoFunnelError('not_found', 404, 'Funil não encontrado.')
  if ((f.kind || 'vendas') !== 'vendas') throw new AutoFunnelError('invalid', 400, 'O funil Recompra já anda sozinho pelas regras de recompra.')
  return f
}
const stagesOf = (db, funnelId) => db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? ORDER BY position, id').all(funnelId)

export function getRoleMap(db, { accountId, funnelId }) {
  const f = loadFunnel(db, accountId, funnelId)
  const stages = stagesOf(db, f.id)
  const confirmed = !!f.roles_confirmed_at
  const map = confirmed
    ? Object.fromEntries(ROLE_ORDER.map(r => [r, stages.find(s => s.stage_role === r)?.id ?? null]))
    : suggestRoleMap(stages)
  return {
    funnel_id: f.id, confirmed, labels: ROLE_LABELS, map,
    stages: stages.map(s => ({ id: s.id, name: s.name, position: s.position, stage_role: s.stage_role ?? null })),
  }
}

export function confirmRoleMap(db, { accountId, funnelId, map }) {
  const f = loadFunnel(db, accountId, funnelId)
  const stages = stagesOf(db, f.id)
  const byId = new Map(stages.map(s => [s.id, s]))
  const clean = {}
  for (const role of ROLE_ORDER) {
    const v = map?.[role]
    if (v === null || v === undefined || v === '') { clean[role] = null; continue }
    const id = Number(v)
    if (!byId.has(id)) throw new AutoFunnelError('invalid', 400, 'Uma das etapas escolhidas não é deste funil.')
    clean[role] = id
  }
  const chosen = Object.values(clean).filter(Boolean)
  if (new Set(chosen).size !== chosen.length) throw new AutoFunnelError('invalid', 400, 'A mesma etapa foi escolhida para dois papéis. Ex.: "Proposta" só pode ser Orçamento/Proposta.')
  const ordered = ROLE_ORDER.filter(r => r !== 'perdido' && clean[r]).map(r => byId.get(clean[r]).position)
  if (ordered.some((p, i) => i > 0 && p <= ordered[i - 1])) {
    throw new AutoFunnelError('invalid', 400, 'A ordem das etapas não bate com a ordem da venda. Ex.: Qualificado precisa vir depois de Atendimento.')
  }
  db.transaction(() => {
    db.prepare('UPDATE funnel_stages SET stage_role = NULL WHERE funnel_id = ?').run(f.id)
    const setRole = db.prepare('UPDATE funnel_stages SET stage_role = ? WHERE id = ?')
    const setFlags = db.prepare('UPDATE funnel_stages SET is_conversion = ?, is_terminal = ? WHERE id = ?')
    const setQualified = db.prepare('UPDATE funnel_stages SET is_qualified = 1 WHERE id = ?')
    let anchor = -1 // posicao da ultima etapa com papel ja colocada
    for (const role of ROLE_ORDER) {
      let id = clean[role]
      if (!id) {
        const pos = role === 'perdido'
          ? db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM funnel_stages WHERE funnel_id = ?').get(f.id).p
          : anchor + 1
        db.prepare('UPDATE funnel_stages SET position = position + 1 WHERE funnel_id = ? AND position >= ?').run(f.id, pos)
        const fl = roleFlags(role)
        id = Number(db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, is_qualified) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(f.id, ROLE_LABELS[role].name, pos, ROLE_LABELS[role].color, fl.is_conversion, fl.is_terminal, fl.is_qualified).lastInsertRowid)
      }
      setRole.run(role, id)
      if (role === 'venda' || role === 'perdido') { const fl = roleFlags(role); setFlags.run(fl.is_conversion, fl.is_terminal, id) }
      if (role === 'qualificado') setQualified.run(id)
      anchor = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(id).position
    }
    // posicoes 0..n sem buracos
    db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position, id').all(f.id)
      .forEach((s, i) => db.prepare('UPDATE funnel_stages SET position = ? WHERE id = ?').run(i, s.id))
    db.prepare("UPDATE funnels SET roles_confirmed_at = datetime('now') WHERE id = ?").run(f.id)
  })()
  return getRoleMap(db, { accountId, funnelId: f.id })
}
```

Run: `node --test test/autoFunnelMapping.test.js` → PASS.

- [ ] **Step 3: Testes HTTP que falham**

```js
// test/autoFunnelHttp.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAutoFunnelTestDb, seedAutoFunnel, leadAt } from './helpers/autoFunnelDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createAutoFunnelRouter } from '../server/routes/autoFunnelRouter.js'
import { tryAutoRole } from '../server/services/autoFunnel/engine.js'

async function comServidor(fn) {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const sent = []
  await withServer(app => app.use('/api/auto-funnel', authenticate, scopeToAccount, createAutoFunnelRouter(db, { broadcast: (a, e, d) => sent.push([a, e, d]) })),
    ({ base }) => fn({ db, s, base, sent }))
}
const stageOf = (db, id) => db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(id).stage_id

test('cliente ideal, proposta enviada e desfazer pelo Chat', async () => {
  await comServidor(async ({ db, s, base }) => {
    const ana = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    const id = leadAt(db, s, 'atendimento', { attendant_id: s.atendenteId })
    let r = await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/ideal`, jwtToken: ana })
    assert.equal(r.status, 200); assert.equal(stageOf(db, id), s.stages.qualificado)
    r = await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/proposal-sent`, jwtToken: ana })
    assert.equal(r.body.moved.to, s.stages.proposta)
    r = await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/undo`, jwtToken: ana })
    assert.equal(r.status, 200); assert.equal(stageOf(db, id), s.stages.qualificado)
    r = await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/undo`, jwtToken: ana })
    assert.equal(r.status, 400)
  })
})

test('atendente sem acesso ao lead e outra conta: 403/404; de-para so gestor', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const outroAt = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'Bia', 'b@a.local', 'atendente')").run(s.accountId).lastInsertRowid)
    const id = leadAt(db, s, 'novo', { attendant_id: s.atendenteId })
    tryAutoRole(db, { leadId: id, role: 'contato' })
    const bia = token({ id: outroAt, role: 'atendente', accountId: s.accountId })
    assert.equal((await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/undo`, jwtToken: bia })).status, 403)
    const intruso = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'X', 'x@b.local', 'gerente')").run(s.otherAccountId).lastInsertRowid)
    const tx = token({ id: intruso, role: 'gerente', accountId: s.otherAccountId })
    assert.equal((await peca(base, { method: 'POST', path: `/api/auto-funnel/leads/${id}/ideal`, jwtToken: tx })).status, 404)
    assert.equal((await peca(base, { path: `/api/auto-funnel/funnels/${s.funnelId}/roles`, jwtToken: tx })).status, 404)
    const ana = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    assert.equal((await peca(base, { path: `/api/auto-funnel/funnels/${s.funnelId}/roles`, jwtToken: ana })).status, 403)
    const g = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const got = await peca(base, { path: `/api/auto-funnel/funnels/${s.funnelId}/roles`, jwtToken: g })
    assert.equal(got.body.confirmed, true)
    const put = await peca(base, { method: 'PUT', path: `/api/auto-funnel/funnels/${s.funnelId}/roles`, jwtToken: g, body: { map: got.body.map } })
    assert.equal(put.status, 200)
    assert.ok(sent.some(x => x[1] === 'funnels:updated'))
    assert.equal(stageOf(db, id), s.stages.contato) // de-para nao mexe em lead
  })
})
```

Run: `node --test test/autoFunnelHttp.test.js` → FAIL (router não existe).

- [ ] **Step 4: Implementar o router**

```js
// server/routes/autoFunnelRouter.js
// Funil que anda sozinho: de-para (gestor) e acoes do Chat (desfazer, cliente ideal, proposta enviada).
import { Router } from 'express'
import { requireRole } from '../middleware/auth.js'
import { canAtendenteAccessLead } from '../services/leadAccess.js'
import { AutoFunnelError, tryAutoRole, undoAutoMove } from '../services/autoFunnel/engine.js'
import { getRoleMap, confirmRoleMap } from '../services/autoFunnel/mapping.js'

export function createAutoFunnelRouter(db, { broadcast = () => {} } = {}) {
  const router = Router()
  const manager = requireRole('super_admin', 'gerente')
  const fail = (res, e) => {
    if (e instanceof AutoFunnelError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Funil auto] rota:', e)
    return res.status(500).json({ error: 'Ocorreu um erro ao processar o pedido.' })
  }
  const leadScoped = (req) => {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(req.params.leadId, req.accountId)
    if (!lead) throw new AutoFunnelError('not_found', 404, 'Lead não encontrado.')
    if (req.user.role === 'atendente' && !canAtendenteAccessLead(req.user.id, lead, db)) throw new AutoFunnelError('forbidden', 403, 'Sem permissão.')
    return lead
  }
  const updated = (lead) => { try { broadcast(lead.account_id, 'lead:updated', { id: lead.id }) } catch {} }

  router.get('/funnels/:funnelId/roles', manager, (req, res) => {
    try { res.json(getRoleMap(db, { accountId: req.accountId, funnelId: Number(req.params.funnelId) })) } catch (e) { fail(res, e) }
  })
  router.put('/funnels/:funnelId/roles', manager, (req, res) => {
    try {
      const r = confirmRoleMap(db, { accountId: req.accountId, funnelId: Number(req.params.funnelId), map: req.body?.map })
      try { broadcast(req.accountId, 'funnels:updated', { funnel_id: r.funnel_id }) } catch {}
      res.json(r)
    } catch (e) { fail(res, e) }
  })
  router.post('/leads/:leadId/undo', (req, res) => {
    try {
      const lead = leadScoped(req)
      const r = undoAutoMove(db, { accountId: req.accountId, leadId: lead.id, userId: req.user.id })
      updated(lead); res.json(r)
    } catch (e) { fail(res, e) }
  })
  router.post('/leads/:leadId/ideal', (req, res) => {
    try {
      const lead = leadScoped(req)
      res.json({ moved: tryAutoRole(db, { leadId: lead.id, role: 'qualificado', userId: req.user.id }) })
    } catch (e) { fail(res, e) }
  })
  router.post('/leads/:leadId/proposal-sent', (req, res) => {
    try {
      const lead = leadScoped(req)
      db.prepare("UPDATE leads SET proposal_sent_at = COALESCE(proposal_sent_at, datetime('now')), updated_at = datetime('now') WHERE id = ?").run(lead.id)
      res.json({ moved: tryAutoRole(db, { leadId: lead.id, role: 'proposta', userId: req.user.id }) })
    } catch (e) { fail(res, e) }
  })
  return router
}
```

Nota: o banco de teste pode não ter `leads.updated_at`; o `createRoteiroTestDb` já adiciona (`updated_at`), então o UPDATE funciona nos dois.

`server/index.js`, junto dos outros `app.use('/api/...')`:

```js
import { createAutoFunnelRouter } from './routes/autoFunnelRouter.js'
app.use('/api/auto-funnel', authenticate, scopeToAccount, createAutoFunnelRouter(db, { broadcast: broadcastSSE }))
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/autoFunnelHttp.test.js test/autoFunnelMapping.test.js` → PASS. `npm test` → verde.

- [ ] **Step 6: Commit**

```bash
git add server/services/autoFunnel/mapping.js server/routes/autoFunnelRouter.js server/index.js test/autoFunnelMapping.test.js test/autoFunnelHttp.test.js
git commit -m "feat(funil): de-para dos papeis e rotas de desfazer, cliente ideal e proposta enviada"
```

---

### Task 4: Ganchos de Contato Feito e Atendimento

**Files:**
- Modify: `server/services/autoFunnel/engine.js` (funções de evento)
- Modify: `server/services/inboundHandler.js:370-397` (resposta do lead, eco do celular, regra antiga)
- Modify: `server/routes/messages.js:14-22` (`roteiroAfterChatSend`)
- Modify: `server/services/aiAgent.js` (depois dos 3 `INSERT INTO messages` de saída: ~599, ~859, ~1016)
- Modify: `server/services/cadence/leadCadence.js` (`markStepDone` devolve `action_type`)
- Modify: `server/routes/cadencesRouter.js:158` e `server/routes/taskCadenceRouter.js:33` (ligação feita)
- Create: `test/autoFunnelHooks.test.js`

**Interfaces:**
- Consumes: `tryAutoRole`, `rolesActive` (Tarefa 2).
- Produces (em `engine.js`):
  - `onContactMade(db, { leadId, userId = null })` → `tryAutoRole(..., 'contato')`
  - `onLeadReplied(db, { leadId, messageId })` → `tryAutoRole(..., 'atendimento')` só se existe mensagem de saída antes de `messageId`
  - `markStepDone(...)` passa a devolver `{ lead_cadence_id, kind, action_type }`

- [ ] **Step 1: Testes que falham**

```js
// test/autoFunnelHooks.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createAutoFunnelTestDb, seedAutoFunnel, leadAt } from './helpers/autoFunnelDb.js'
import { addMessage } from './helpers/roteiroDb.js'
import { onContactMade, onLeadReplied } from '../server/services/autoFunnel/engine.js'

const stageOf = (db, id) => db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(id).stage_id

test('1a mensagem do vendedor: Novo Lead -> Contato Feito; de novo nao muda', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const id = leadAt(db, s, 'novo')
  assert.equal(onContactMade(db, { leadId: id, userId: s.atendenteId }).to, s.stages.contato)
  assert.equal(onContactMade(db, { leadId: id }), null)
  assert.equal(db.prepare('SELECT triggered_by FROM stage_history WHERE lead_id = ?').get(id).triggered_by, s.atendenteId)
})

test('resposta do lead so vira Atendimento se houve contato antes', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const primeiro = leadAt(db, s, 'novo')
  const m1 = addMessage(db, { leadId: primeiro, direction: 'inbound' }) // lead escreveu primeiro
  assert.equal(onLeadReplied(db, { leadId: primeiro, messageId: m1 }), null)
  assert.equal(stageOf(db, primeiro), s.stages.novo)
  addMessage(db, { leadId: primeiro, direction: 'outbound', userId: s.atendenteId })
  onContactMade(db, { leadId: primeiro })
  const m3 = addMessage(db, { leadId: primeiro, direction: 'inbound' })
  assert.equal(onLeadReplied(db, { leadId: primeiro, messageId: m3 }).to, s.stages.atendimento)
})

test('inboundHandler: com funil confirmado a regra antiga 1a->2a etapa nao roda', () => {
  const src = fs.readFileSync(new URL('../server/services/inboundHandler.js', import.meta.url), 'utf8')
  assert.match(src, /!rolesActive\(db, lead\.funnel_id\)/)
  assert.match(src, /onLeadReplied\(db,/)
  assert.match(src, /onContactMade\(db,/)
})
```

Run: `node --test test/autoFunnelHooks.test.js` → FAIL (`onContactMade` não exportado).

- [ ] **Step 2: Funções de evento em `engine.js`**

```js
// Evento "o vendedor (ou agente) falou com o lead": mensagem humana, eco do celular, ligacao feita.
export function onContactMade(db, { leadId, userId = null }) {
  return tryAutoRole(db, { leadId, role: 'contato', userId })
}

// Evento "o lead respondeu": so conta se houve contato antes (mensagem de saida anterior).
// Lead que escreve primeiro continua em Novo Lead ate o vendedor falar.
export function onLeadReplied(db, { leadId, messageId }) {
  try {
    const before = db.prepare("SELECT 1 FROM messages WHERE lead_id = ? AND direction = 'outbound' AND id < ? LIMIT 1").get(leadId, messageId)
    if (!before) return null
  } catch (e) { console.error('[Funil auto] resposta:', e?.message); return null }
  return tryAutoRole(db, { leadId, role: 'atendimento' })
}
```

Run: os 2 primeiros testes passam; o 3º ainda falha.

- [ ] **Step 3: Ligar no `inboundHandler.js`**

Importar no topo: `import { rolesActive, onContactMade, onLeadReplied } from './autoFunnel/engine.js'`.

Linha ~370 — regra antiga só sem papéis:

```js
    if (!isNew && !fromMe && !isRepurchaseFunnel(db, lead.funnel_id) && !rolesActive(db, lead.funnel_id)) {
```

Bloco depois do INSERT (~382-397) — acrescentar dentro do `if (!fromMe) {...}`, depois do try do `processInboundSignal`:

```js
        if (!isNew) {
          try { onLeadReplied(db, { leadId: lead.id, messageId: Number(insertedMsg.lastInsertRowid) }) } catch (e) { console.error('[Funil auto] inbound:', e?.message) }
        }
```

E logo depois do `if (!fromMe) {...}`, um `else` para o eco do celular (vendedor digitou no aparelho):

```js
      else {
        try { onContactMade(db, { leadId: lead.id }) } catch (e) { console.error('[Funil auto] eco:', e?.message) }
      }
```

- [ ] **Step 4: Ligar no envio do Chat, no agente e na ligação**

`server/routes/messages.js`, dentro de `roteiroAfterChatSend`, antes do `try`:

```js
import { onContactMade } from '../services/autoFunnel/engine.js'
// ...
  onContactMade(db, { leadId: lead.id, userId })
```

`server/services/aiAgent.js`: importar `onContactMade` de `./autoFunnel/engine.js` e, logo depois de cada um dos 3 `INSERT INTO messages ... ai_agent_id` de saída (linhas ~599, ~859, ~1016), uma linha usando a variável do lead daquele trecho (conferir o nome local: `lead.id` ou `leadId`):

```js
              onContactMade(db, { leadId: lead.id })
```

`server/services/cadence/leadCadence.js` `markStepDone`: trocar o `return` final por

```js
  return { lead_cadence_id: row.lc_id, kind: row.lc_kind, action_type: row.action_type }
```

`server/routes/cadencesRouter.js` (rota `POST /lead/:leadId/steps/:attemptId/done`, ~158): depois de chamar `markStepDone(...)`, guardar o retorno em `done` e acrescentar:

```js
      if (done.action_type === 'ligacao' && how === 'feito') onContactMade(db, { leadId: lead.id, userId: req.user.id })
```

(usar o nome local da variável de `how`/`lead` daquela rota; importar `onContactMade` de `../services/autoFunnel/engine.js`).

`server/routes/taskCadenceRouter.js` (`/:lcId/complete`, ~33): `completeCurrentStep` já devolve `nextAttempt`; pegar o passo atual ANTES de concluir:

```js
      const atual = db.prepare('SELECT ca.action_type, lc.lead_id FROM lead_cadences lc JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id WHERE lc.id = ?').get(req.params.lcId)
      // ... completeCurrentStep(...) como hoje ...
      if (atual?.action_type === 'ligacao') onContactMade(db, { leadId: atual.lead_id, userId: req.user.id })
```

- [ ] **Step 5: Teste da ligação**

Acrescentar em `test/autoFunnelHooks.test.js` (usa o router de cadências, que é fábrica):

```js
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createCadencesRouter } from '../server/routes/cadencesRouter.js'
import { createCadence, addStep } from '../server/services/cadence/repo.js'
import { ensureStageCadence } from '../server/services/cadence/leadCadence.js'

test('ligacao marcada como feita na cadencia de Novo Lead leva para Contato Feito', async () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const c = createCadence(db, s.accountId, { stageId: s.stages.novo })
  const lig = addStep(db, s.accountId, c.id, { action_type: 'ligacao', description: 'Ligar' }).step_id
  const id = leadAt(db, s, 'novo', { attendant_id: s.atendenteId })
  ensureStageCadence(db, { leadId: id })
  await withServer(app => app.use('/api/cadences', authenticate, scopeToAccount, createCadencesRouter(db)), async ({ base }) => {
    const r = await peca(base, { method: 'POST', path: `/api/cadences/lead/${id}/steps/${lig}/done`, jwtToken: token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId }), body: { how: 'feito' } })
    assert.equal(r.status, 200)
  })
  assert.equal(stageOf(db, id), s.stages.contato)
})
```


- [ ] **Step 6: Rodar tudo**

Run: `node --test test/autoFunnelHooks.test.js` → PASS. `npm test` → verde (testes antigos do inbound devem continuar passando: as contas de teste deles não têm papéis confirmados).

- [ ] **Step 7: Commit**

```bash
git add server/services/autoFunnel/engine.js server/services/inboundHandler.js server/routes/messages.js server/services/aiAgent.js server/services/cadence/leadCadence.js server/routes/cadencesRouter.js server/routes/taskCadenceRouter.js test/autoFunnelHooks.test.js
git commit -m "feat(funil): contato feito e atendimento automaticos (mensagem, eco, agente, ligacao, resposta)"
```

---

### Task 5: Qualificado pelas perguntas + Venda pela venda registrada

**Files:**
- Modify: `server/services/roteiro/autoAdvance.js` (`maybeAutoAdvance`)
- Modify: `server/routes/leads.js:705-722` (POST `/:id/sales`)
- Modify: `test/autoFunnelHooks.test.js`

**Interfaces:**
- Consumes: `rolesActive`, `tryAutoRole` (Tarefa 2).
- Produces: `markAsCustomer(db, leadId): void` em `engine.js` (spec §3: venda garante `contact_type = 'cliente'`; só troca `NULL`/`'lead'`, origem `'auto'`).
- Produces: `maybeAutoAdvance` com funil confirmado: só avança a partir de etapa `atendimento` e vai direto para a etapa `qualificado` (trigger continua `'roteiro_auto'`, para o aviso e o [Desfazer] do roteiro que já existem continuarem funcionando). Sem papéis: igual a hoje.

- [ ] **Step 1: Testes que falham**

```js
import { maybeAutoAdvance } from '../server/services/roteiro/autoAdvance.js'
import { saveDraft, publish } from '../server/services/roteiro/repo.js'
import { markAsCustomer } from '../server/services/autoFunnel/engine.js'

test('perguntas obrigatorias de Atendimento respondidas: vai direto para Qualificado mesmo com etapa extra no meio', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  db.prepare('UPDATE funnel_stages SET position = position + 1 WHERE funnel_id = ? AND position >= 3').run(s.funnelId)
  db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Visita', 3)").run(s.funnelId)
  saveDraft(db, s.accountId, s.funnelId, { questions: [{ stage_id: s.stages.atendimento, text: 'Para quando?', kind: 'text', required: true }], deviations: [] })
  publish(db, s.accountId, s.funnelId, s.gerenteId)
  const key = db.prepare("SELECT question_key FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id WHERE v.status = 'published'").get().question_key
  const id = leadAt(db, s, 'atendimento')
  db.prepare("INSERT INTO lead_answers (account_id, lead_id, question_key, answer_text, origin) VALUES (?, ?, ?, ?, 'manual')").run(s.accountId, id, key, 'semana que vem')
  const r = maybeAutoAdvance(db, { accountId: s.accountId, leadId: id })
  assert.equal(r.to, s.stages.qualificado)
  assert.ok(db.prepare('SELECT qualified_at FROM leads WHERE id = ?').get(id).qualified_at)
})

test('rota de venda chama o papel venda antes de registrar', () => {
  const src = fs.readFileSync(new URL('../server/routes/leads.js', import.meta.url), 'utf8')
  const rota = src.slice(src.indexOf("router.post('/:id/sales'"), src.indexOf("router.patch('/:id/sales/:saleId'"))
  assert.ok(rota.indexOf("role: 'venda'") > -1 && rota.indexOf("role: 'venda'") < rota.indexOf('registerSale('))
  assert.match(rota, /markAsCustomer\(db, lead\.id\)/)
})

test('venda marca o contato como cliente, sem passar por cima de revendedor/interno', () => {
  const db = createAutoFunnelTestDb(); const s = seedAutoFunnel(db)
  const a = leadAt(db, s, 'proposta'); const b = leadAt(db, s, 'proposta', { contact_type: 'revendedor' })
  markAsCustomer(db, a); markAsCustomer(db, b)
  assert.deepEqual(db.prepare('SELECT contact_type, contact_type_origin FROM leads WHERE id = ?').get(a), { contact_type: 'cliente', contact_type_origin: 'auto' })
  assert.equal(db.prepare('SELECT contact_type FROM leads WHERE id = ?').get(b).contact_type, 'revendedor')
})
```

Run: `node --test test/autoFunnelHooks.test.js` → FAIL (vai para "Visita", não para Qualificado; rota sem papel venda).

- [ ] **Step 2: `autoAdvance.js`**

Importar `import { rolesActive } from '../autoFunnel/engine.js'` e trocar o cálculo de `nextStage` por:

```js
  let nextStage
  if (rolesActive(db, lead.funnel_id)) {
    // Funil com papeis: as obrigatorias levam de Atendimento direto para Qualificado.
    if (currentStage.stage_role !== 'atendimento') return null
    nextStage = stages.find(s => s.stage_role === 'qualificado')
    if (!nextStage || nextStage.position <= currentStage.position) return null
  } else {
    nextStage = stages
      .filter(s => s.position > currentStage.position)
      .sort((a, b) => a.position - b.position)[0]
    if (!nextStage || nextStage.is_terminal) return null
  }
```

E, depois do `if (!result.moved) return null`:

```js
  if (nextStage.stage_role === 'qualificado') db.prepare("UPDATE leads SET qualified_at = COALESCE(qualified_at, datetime('now')) WHERE id = ?").run(leadId)
```

Conferir que `getFunnelStages` (em `leadRoteiro.js`) faz `SELECT *` (para trazer `stage_role`); se listar colunas, acrescentar `stage_role`.

- [ ] **Step 3: Rota de venda**

`server/routes/leads.js`, dentro do `try` da rota `POST /:id/sales`, antes de `registerSale(...)`:

```js
    tryAutoRole(db, { leadId: lead.id, role: 'venda', userId: req.user.id })
```

e, depois de `if (!r.ok) return ...`:

```js
    try { markAsCustomer(db, lead.id) } catch (e) { console.error('[Funil auto] cliente:', e.message) }
```

com `import { tryAutoRole, markAsCustomer } from '../services/autoFunnel/engine.js'` no topo. Em `engine.js`:

```js
// Venda registrada: o contato vira cliente (spec §3), sem passar por cima de revendedor/interno.
export function markAsCustomer(db, leadId) {
  db.prepare("UPDATE leads SET contact_type = 'cliente', contact_type_origin = 'auto' WHERE id = ? AND (contact_type IS NULL OR contact_type = 'lead')").run(leadId)
}
```

 Como `tryAutoRole` move para a etapa Venda (conversão), o hook já existente manda o CAPI e o `markBought`; em seguida `registerSale` segue igual (venda "pode recomprar" leva para Recompra/Aguardando como hoje). Lead que já estava em Venda (fluxo do Chat que abre a venda ao escolher a etapa) não muda.

- [ ] **Step 4: Rodar tudo**

Run: `node --test test/autoFunnelHooks.test.js` → PASS. `npm test` → verde (os testes antigos do roteiro usam funil sem papéis: comportamento antigo).

- [ ] **Step 5: Commit**

```bash
git add server/services/roteiro/autoAdvance.js server/routes/leads.js server/services/autoFunnel/engine.js test/autoFunnelHooks.test.js
git commit -m "feat(funil): qualificado pelas perguntas obrigatorias e venda registrada leva para Venda"
```

---

### Task 6: Tela Funis — papéis e de-para

**Files:**
- Create: `src/lib/autoFunnelApi.ts`
- Create: `src/components/funnel/RoleMapModal.tsx`
- Modify: `src/lib/api.ts` (tipo `FunnelStage` ganha `stage_role?: string | null`; `Funnel` ganha `roles_confirmed_at?: string | null`)
- Modify: `src/pages/Funnels.tsx`

**Interfaces:**
- Consumes: rotas da Tarefa 3.
- Produces:
  - `autoFunnelApi.ts`: `type RoleKey = 'novo'|'contato'|'atendimento'|'qualificado'|'proposta'|'venda'|'perdido'`; `interface RoleMap { funnel_id: number; confirmed: boolean; map: Record<RoleKey, number|null>; stages: {id:number;name:string;position:number;stage_role:RoleKey|null}[]; labels: Record<RoleKey,{name:string;color:string;when:string}> }`; `fetchRoleMap(funnelId, accountId)`, `saveRoleMap(funnelId, accountId, map)`, `undoAutoMove(leadId, accountId)`, `markIdealCustomer(leadId, accountId)`, `markProposalSent(leadId, accountId)`.

- [ ] **Step 1: `autoFunnelApi.ts`** (mesmo padrão de `src/lib/cadenceApi.ts`: `apiFetch`, `post`, `acc`)

```ts
import { apiFetch } from './api'

export type RoleKey = 'novo' | 'contato' | 'atendimento' | 'qualificado' | 'proposta' | 'venda' | 'perdido'
export const ROLE_ORDER: RoleKey[] = ['novo', 'contato', 'atendimento', 'qualificado', 'proposta', 'venda', 'perdido']
export interface RoleMap {
  funnel_id: number; confirmed: boolean
  map: Record<RoleKey, number | null>
  stages: { id: number; name: string; position: number; stage_role: RoleKey | null }[]
  labels: Record<RoleKey, { name: string; color: string; when: string }>
}
export interface AutoMove { from: number; to: number; to_name: string; role?: RoleKey; history_id?: number }

const acc = (accountId: number) => `account_id=${accountId}`
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

export const fetchRoleMap = (funnelId: number, accountId: number) => apiFetch<RoleMap>(`/api/auto-funnel/funnels/${funnelId}/roles?${acc(accountId)}`)
export const saveRoleMap = (funnelId: number, accountId: number, map: Record<RoleKey, number | null>) =>
  apiFetch<RoleMap>(`/api/auto-funnel/funnels/${funnelId}/roles?${acc(accountId)}`, send('PUT', { map }))
export const undoAutoMove = (leadId: number, accountId: number) => apiFetch<AutoMove>(`/api/auto-funnel/leads/${leadId}/undo?${acc(accountId)}`, send('POST'))
export const markIdealCustomer = (leadId: number, accountId: number) => apiFetch<{ moved: AutoMove | null }>(`/api/auto-funnel/leads/${leadId}/ideal?${acc(accountId)}`, send('POST'))
export const markProposalSent = (leadId: number, accountId: number) => apiFetch<{ moved: AutoMove | null }>(`/api/auto-funnel/leads/${leadId}/proposal-sent?${acc(accountId)}`, send('POST'))
```

Antes de escrever, abrir `src/lib/cadenceApi.ts` e copiar exatamente como ele importa `apiFetch` e monta `post()`/`acc()` (se `apiFetch` vier de outro arquivo ou `post` já existir exportado, usar o existente em vez de `send`).

- [ ] **Step 2: `RoleMapModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { fetchRoleMap, saveRoleMap, ROLE_ORDER, type RoleKey, type RoleMap } from '../../lib/autoFunnelApi'

// De-para: para cada passo da venda, qual etapa do funil e. "Criar etapa nova" cria no lugar certo.
// Nenhum lead muda de etapa ao confirmar.
export default function RoleMapModal({ funnelId, accountId, onClose, onSaved }: { funnelId: number; accountId: number; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<RoleMap | null>(null)
  const [map, setMap] = useState<Record<RoleKey, number | null> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    fetchRoleMap(funnelId, accountId).then(d => { setData(d); setMap(d.map) }).catch(e => setError(e instanceof Error ? e.message : 'Erro.'))
  }, [funnelId, accountId])

  const save = async () => {
    if (!map) return
    setSaving(true); setError(null)
    try { await saveRoleMap(funnelId, accountId, map); onSaved() } catch (e) { setError(e instanceof Error ? e.message : 'Erro.') } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <h3 style={{ marginTop: 0 }}>Funil que anda sozinho</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Diga qual etapa do seu funil é cada passo da venda. Depois disso o CRM muda o lead de etapa sozinho (sempre para a frente, com "Desfazer").
          Ex.: quando o vendedor manda a 1ª mensagem, o lead vai para "Contato Feito". Nenhum lead muda de etapa agora.
        </p>
        {!data || !map ? <div style={{ padding: 16 }}>{error || 'Carregando…'}</div> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {ROLE_ORDER.map(role => (
              <label key={role} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, alignItems: 'center' }}>
                <span>
                  <b>{data.labels[role].name}</b>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>entra quando {data.labels[role].when}</span>
                </span>
                <select className="select" value={map[role] ?? ''} onChange={e => setMap({ ...map, [role]: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Criar etapa nova "{data.labels[role].name}"</option>
                  {data.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            ))}
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Etapas que não aparecem em nenhum passo (ex.: "Visita Agendada") continuam no funil; o automático só passa por cima delas quando o lead está antes.</p>
          </div>
        )}
        {error && data && <div style={{ color: 'var(--negative)', fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={!map || saving} onClick={save}>{saving ? 'Salvando…' : 'Confirmar'}</button>
        </div>
      </div>
    </div>
  )
}
```

(As classes `modal-overlay`/`modal`/`modal-actions` são as mesmas de `src/components/ConfirmDialog.tsx`.)

- [ ] **Step 3: `Funnels.tsx`**

Para cada funil com `kind !== 'recompra'`:
- Sem `roles_confirmed_at`: faixa amarela no topo do cartão: "Este funil ainda não anda sozinho. O lead só muda de etapa à mão. **[Usar o funil padrão]**" (abre `RoleMapModal`; ao salvar, recarrega os funis).
- Com `roles_confirmed_at`: linha verde "Anda sozinho ✓ · [Ajustar passos]" (mesmo modal).
- Ao lado do nome de cada etapa com `stage_role`, um chip pequeno com `ROLE_LABELS[role].name` e `title` = "Entra quando …" (copiar os textos de `when` de `roles.js` para uma constante no front, ou usar `fetchRoleMap` só quando o modal abre — preferir constante local `ROLE_WHEN` em `autoFunnelApi.ts` para não fazer pedido por funil).
- `handleCreate` (linhas 24-35): o modelo do funil novo passa a ser as 7 etapas com `stage_role` (mesmos nomes/cores/flags de `ROLE_LABELS`), e o POST já confirma (Tarefa 1).

- [ ] **Step 4: Conferir tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → mesmo número de antes (16 erros antigos; nenhum em `Funnels.tsx`, `RoleMapModal.tsx`, `autoFunnelApi.ts`).
Run: `npm run build` → ok. Depois: `git checkout -- dist && git clean -fd dist` (dist nunca entra em commit).

- [ ] **Step 5: Commit**

```bash
git add src/lib/autoFunnelApi.ts src/components/funnel/RoleMapModal.tsx src/lib/api.ts src/pages/Funnels.tsx
git commit -m "feat(funil): tela de Funis mostra os passos da venda e o de-para"
```

---

### Task 7: Chat — aviso "Movido para X · Desfazer" e botões rápidos

**Files:**
- Create: `src/components/funnel/AutoMoveNotice.tsx`
- Create: `src/components/funnel/FunnelQuickActions.tsx`
- Modify: `src/pages/Chat.tsx` (cartão "Funil e etapa", ~2195-2208)

**Interfaces:**
- Consumes: `undoAutoMove`, `markIdealCustomer`, `markProposalSent` (Tarefa 6); SSE `lead:auto_moved { lead_id, history_id, role, from_name, to_name }` (Tarefa 2); `useSSE` de `src/context/SSEContext.tsx`.

- [ ] **Step 1: `AutoMoveNotice.tsx`**

```tsx
import { useState } from 'react'
import { useSSE } from '../../context/SSEContext'
import { undoAutoMove } from '../../lib/autoFunnelApi'

// Mudanca automatica do lead aberto: "Movido para X · [Desfazer]" (some em 30 s ou ao desfazer).
export default function AutoMoveNotice({ leadId, accountId, onChanged }: { leadId: number; accountId: number; onChanged: () => void }) {
  const [move, setMove] = useState<{ to_name: string; from_name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useSSE('lead:auto_moved', (d: { lead_id: number; to_name: string; from_name: string }) => {
    if (d.lead_id !== leadId) return
    setMove({ to_name: d.to_name, from_name: d.from_name }); setError(null)
    window.setTimeout(() => setMove(m => (m && m.to_name === d.to_name ? null : m)), 30000)
  })
  if (!move) return null
  const undo = async () => {
    try { await undoAutoMove(leadId, accountId); setMove(null); onChanged() } catch (e) { setError(e instanceof Error ? e.message : 'Erro.') }
  }
  return (
    <div style={{ fontSize: 12, background: 'var(--bg-hover)', borderRadius: 6, padding: '6px 10px', marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Movido para <b>{move.to_name}</b> (estava em {move.from_name})</span>
      <button type="button" className="btn btn-secondary btn-sm" onClick={undo}>Desfazer</button>
      {error && <span style={{ color: 'var(--negative)' }}>{error}</span>}
    </div>
  )
}
```

`useSSE(event, handler)` registra no `useEffect` com `handler` como dependência: envolver o callback em `useCallback([leadId])` para não reinscrever a cada render.

- [ ] **Step 2: `FunnelQuickActions.tsx`**

```tsx
import { useState } from 'react'
import HelpTip from '../HelpTip'
import { markIdealCustomer, markProposalSent } from '../../lib/autoFunnelApi'

interface Stage { id: number; position: number; stage_role?: string | null }

// Botoes do Chat que fazem o funil andar: so aparecem se o funil tem os passos e o lead esta antes deles.
export default function FunnelQuickActions({ leadId, accountId, stages, currentStageId, onChanged }: { leadId: number; accountId: number; stages: Stage[]; currentStageId: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = stages.find(s => s.id === currentStageId)
  const at = (role: string) => stages.find(s => s.stage_role === role)
  const qual = at('qualificado'); const prop = at('proposta')
  if (!current) return null
  const showIdeal = !!qual && current.position < qual.position
  const showProposal = !!prop && current.position < prop.position
  if (!showIdeal && !showProposal) return null
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await fn(); onChanged() } catch (e) { setError(e instanceof Error ? e.message : 'Erro.') } finally { setBusy(false) }
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
      {showIdeal && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => markIdealCustomer(leadId, accountId))}>É cliente ideal</button>}
      {showProposal && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run(() => markProposalSent(leadId, accountId))}>Proposta enviada</button>}
      <HelpTip title="Fazer o funil andar">Marque o que aconteceu e o lead vai para a etapa certa sozinho. Ex.: mandou o orçamento pelo WhatsApp → "Proposta enviada" leva para Orçamento/Proposta.</HelpTip>
      {error && <span style={{ fontSize: 12, color: 'var(--negative)' }}>{error}</span>}
    </div>
  )
}
```

- [ ] **Step 3: Montar no Chat**

Em `src/pages/Chat.tsx`, dentro do cartão "Funil e etapa", logo depois do `</select>` (~2206):

```tsx
                    <AutoMoveNotice leadId={lead.id} accountId={accountId} onChanged={() => loadLead({ silent: true })} />
                    {funnels.find(f => f.id === lead.funnel_id)?.roles_confirmed_at && (
                      <FunnelQuickActions leadId={lead.id} accountId={accountId} stages={allStages.filter(s => s.funnel_id === lead.funnel_id)} currentStageId={lead.stage_id} onChanged={() => loadLead({ silent: true })} />
                    )}
```

Usar os nomes reais do Chat para `accountId` e `loadLead` (procurar `loadLead(` e o id da conta usado nas outras chamadas de API do arquivo). Atualizar o texto do `help` do `PanelTitle` desse cartão para: "Em que funil e em que ponto da venda o cliente está. O CRM muda sozinho quando acontece algo (ex.: o cliente respondeu → Atendimento) e mostra Desfazer. Se faltar uma pergunta obrigatória, abre a janela "Falta saber"."

- [ ] **Step 4: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → mesmo número de antes. `npm run build` → ok; restaurar `dist` (`git checkout -- dist && git clean -fd dist`).

- [ ] **Step 5: Commit**

```bash
git add src/components/funnel/AutoMoveNotice.tsx src/components/funnel/FunnelQuickActions.tsx src/pages/Chat.tsx
git commit -m "feat(chat): aviso de mudanca automatica com Desfazer e botoes cliente ideal/proposta enviada"
```

---

### Task 8: Conferência no navegador

**Files:** nenhum (só correções se aparecer problema, cada uma com teste e commit próprio).

- [ ] **Step 1:** `npm test` verde; `npx tsc --noEmit` = 16 antigos; `npm run build` ok (restaurar `dist`).
- [ ] **Step 2:** subir o CRM local (exportar as 3 linhas "TESTE LOCAL" do fim de `crm/.env`, `npm run dev`, http://localhost:5175/crm/), conta de teste.
- [ ] **Step 3:** Funis: funil antigo mostra a faixa amarela → [Usar o funil padrão] → o modal sugere os passos → confirmar → aparece "Contato Feito" criada entre Novo Lead e Em Atendimento; nenhum lead mudou de etapa; chips dos papéis aparecem.
- [ ] **Step 4:** Chat num lead em Novo Lead: mandar mensagem (ou, sem WhatsApp conectado, marcar a ligação da cadência como feita) → vai para Contato Feito e aparece "Movido para Contato Feito · Desfazer" → Desfazer volta; mandar de novo não move outra vez.
- [ ] **Step 5:** "É cliente ideal" → Qualificado; "Proposta enviada" → Orçamento/Proposta; registrar venda → Venda (e Recompra quando "pode recomprar").
- [ ] **Step 6:** Lead tipo "Interno" não anda; funil Recompra não mostra faixa nem botões.
- [ ] **Step 7:** Atualizar a memória (`retomar-crm.md`) com a ponta do ramo e o que ficou.

# Papéis dos números + anti-banimento — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolution vira número de leitura (só resposta manual); UzAPI/Oficial viram número de disparo (todo envio automático sai pelo número padrão da conta); e todo envio automático segue as 4 regras anti-banimento da UzAPI.

**Architecture:** Uma função pura decide o papel pelo provedor (`numberRole`). Um escolhedor central (`resolveSendInstance`) devolve o número de saída para envios automáticos; uma trava no `sender.js` recusa automático em número de leitura. As regras anti-ban moram em módulos pequenos e testáveis (`antiban.js`, `sendPacer.js`, `replyRate.js`) com `db` injetado; os arquivos antigos que importam o banco real (`followUpSender.js`, `broadcasts.js`, `leadHandoff.js`, `aiAgent.js`) só ganham a ligação.

**Tech Stack:** Node 16 + Express 4 + better-sqlite3 (ESM `.js`), `node --test`; React 19 + Vite 4 + TypeScript no front; libs puras do front em `src/lib/*.js` com `.d.ts` ao lado.

**Spec:** `docs/superpowers/specs/2026-09-23-papeis-dos-numeros-e-anti-ban-design.md`

## Global Constraints

- Node 16: nada de API que exija Node 18+ (sem `fetch` global novo, sem `structuredClone`, sem `Array.prototype.findLast`).
- Não mexer em versões de dependências (vite ^4.5.5, better-sqlite3 ^10.1.0, express ^4.21.0).
- Commits em português, prefixo `feat:`/`fix:`/`refactor:`/`test:`; sem emojis no código; terminar com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Branch `feat/provedor-uzapi`. **Sem push, sem deploy.**
- Não commitar: `vite.config.ts`, `dist/`, `*.mjs` da raiz, `.env`. Sempre `git add` de arquivos nomeados, nunca `git add -A`/`.`.
- Provedores: `evolution` (ou vazio) = leitura; `uzapi` e `cloud_api` = disparo; qualquer outro = leitura.
- Palavras de descadastro (mensagem inteira, sem acento/pontuação, minúsculas): `sair`, `parar`, `pare`, `cancelar`, `descadastrar`, `stop`.
- Textos padrão: rodapé `"Digite SAIR para não receber mais mensagens."`; confirmação `"Pronto! Você não vai mais receber nossas mensagens automáticas."`.
- Intervalo entre follow-ups no mesmo número: sorteio de **5 a 20 segundos**.
- Taxa de resposta: janela de **7 dias**, resposta em até **24h**, mínimo **20 leads**, limite padrão **10%** (editável por conta).
- Avisos de tela: `no_send_number` → "Envios automáticos desligados — conecte UzAPI ou Oficial para liberar"; `send_number_offline` → "O número de disparos está desconectado — os envios automáticos estão parados".
- Rodar os testes com Node 20 do nvm (`C:\nvm4w\nodejs`): `npm test`. Base atual: 545 testes passando; `npx tsc --noEmit` tem 15 erros antigos (não pode aumentar).

## Review Focus

1. Conta com **um único número UzAPI** — ele precisa responder manual E automático, e o agente precisa rodar nele (Task 2 e Task 6 cobrem com teste).
2. Número padrão **apagado ou trocado de conta** (`default_send_instance_id` apontando para id inexistente ou de outra conta) — deve cair para outro número de disparo da conta, nunca usar número alheio (Task 2).
3. Lead que manda **"Sair."**, **"SAIR!"**, **"sáir"** conta como descadastro; **"vou sair agora"** e **"sair?"** com mais texto não contam (Task 3).
4. **Vários follow-ups vencendo juntos** no mesmo número saem um de cada vez com 5–20s entre eles; em números diferentes não se bloqueiam (Task 4).
5. Resposta manual no chat **por número Evolution** continua funcionando com a trava ligada (Task 5: `origin: 'manual'` passa).

---

### Task 1: Papel do número + colunas novas no banco

**Files:**
- Create: `server/services/whatsapp/numberRole.js`
- Modify: `server/services/whatsapp/schema.js` (fim de `migrateWhatsappProviderSchema`)
- Test: `test/numberRole.test.js`

**Interfaces:**
- Produces: `numberRole(instance) -> 'leitura' | 'disparo'`; `isSendRole(instance) -> boolean`; `SEND_PROVIDERS` (array). Colunas: `accounts.default_send_instance_id`, `accounts.optout_footer_enabled` (default 1), `accounts.optout_footer_text`, `accounts.optout_confirm_text`, `accounts.reply_rate_alert_pct` (default 10), `leads.opted_out_at`, `follow_ups.optout_footer_enabled` (default 0).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/numberRole.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberRole, isSendRole, SEND_PROVIDERS } from '../server/services/whatsapp/numberRole.js'
import { createTestDb } from './helpers/db.js'

test('papel pelo provedor', () => {
  assert.equal(numberRole({ provider: 'evolution' }), 'leitura')
  assert.equal(numberRole({ provider: '' }), 'leitura')
  assert.equal(numberRole({}), 'leitura')
  assert.equal(numberRole(null), 'leitura')
  assert.equal(numberRole({ provider: 'custom' }), 'leitura')
  assert.equal(numberRole({ provider: 'uzapi' }), 'disparo')
  assert.equal(numberRole({ provider: 'cloud_api' }), 'disparo')
  assert.equal(isSendRole({ provider: 'uzapi' }), true)
  assert.equal(isSendRole({ provider: 'evolution' }), false)
  assert.deepEqual(SEND_PROVIDERS, ['uzapi', 'cloud_api'])
})

test('migracao cria as colunas novas (idempotente)', () => {
  const db = createTestDb()
  const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name)
  for (const c of ['default_send_instance_id', 'optout_footer_enabled', 'optout_footer_text', 'optout_confirm_text', 'reply_rate_alert_pct']) {
    assert.ok(cols('accounts').includes(c), c)
  }
  assert.ok(cols('leads').includes('opted_out_at'))
  assert.ok(cols('follow_ups').includes('optout_footer_enabled'))
  const acc = db.prepare("INSERT INTO accounts (name, slug) VALUES ('A', 'a')").run().lastInsertRowid
  const row = db.prepare('SELECT optout_footer_enabled, reply_rate_alert_pct FROM accounts WHERE id = ?').get(acc)
  assert.equal(row.optout_footer_enabled, 1)
  assert.equal(row.reply_rate_alert_pct, 10)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/numberRole.test.js`
Expected: FAIL com `Cannot find module .../numberRole.js`

- [ ] **Step 3: Implementar**

```js
// server/services/whatsapp/numberRole.js
// Papel do numero pelo provedor escolhido na conexao (spec secao 3).
// leitura = Evolution: le conversas e so envia o que humano digitou. disparo = UzAPI/Oficial: todo envio automatico.
export const SEND_PROVIDERS = ['uzapi', 'cloud_api']

export function numberRole(instance) {
  const p = instance && instance.provider
  return SEND_PROVIDERS.includes(p) ? 'disparo' : 'leitura'
}

export function isSendRole(instance) {
  return numberRole(instance) === 'disparo'
}
```

No fim de `migrateWhatsappProviderSchema(db)` em `server/services/whatsapp/schema.js`, antes do fechamento da função, acrescentar:

```js
  // Papeis dos numeros + anti-ban (spec 2026-09-23). opted_out_at ja existe em producao (db.js); aqui garante nos testes.
  addColumnIfNotExists(db, 'accounts', 'default_send_instance_id', 'INTEGER')
  addColumnIfNotExists(db, 'accounts', 'optout_footer_enabled', 'INTEGER NOT NULL DEFAULT 1')
  addColumnIfNotExists(db, 'accounts', 'optout_footer_text', 'TEXT')
  addColumnIfNotExists(db, 'accounts', 'optout_confirm_text', 'TEXT')
  addColumnIfNotExists(db, 'accounts', 'reply_rate_alert_pct', 'INTEGER NOT NULL DEFAULT 10')
  addColumnIfNotExists(db, 'leads', 'opted_out_at', 'TEXT')
  addColumnIfNotExists(db, 'follow_ups', 'optout_footer_enabled', 'INTEGER NOT NULL DEFAULT 0')
```

Conferir que `migrateWhatsappProviderSchema` roda no boot depois de `accounts`, `leads` e `follow_ups` existirem: `grep -n "migrateWhatsappProviderSchema" server/db.js`. Se ela rodar antes da criação de `follow_ups`, mover a chamada para depois (a tabela precisa existir para o `ALTER`).

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/numberRole.test.js` → PASS. Depois `npm test` → todos passam (545 + 2).

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/numberRole.js server/services/whatsapp/schema.js test/numberRole.test.js
git commit -m "feat: papel do numero pelo provedor (leitura x disparo) e colunas anti-ban"
```

---

### Task 2: Escolhedor de número de saída e número padrão

**Files:**
- Create: `server/services/whatsapp/resolveSendInstance.js`
- Test: `test/resolveSendInstance.test.js`

**Interfaces:**
- Consumes: `numberRole`, `SEND_PROVIDERS` (Task 1).
- Produces:
  - `getDefaultSendInstance(db, accountId) -> instance | null` (número padrão válido, conectado ou não)
  - `resolveSendInstance(db, { accountId, kind, conversationInstanceId }) -> { ok: true, instance } | { ok: false, reason: 'no_send_number' | 'send_number_offline' | 'no_conversation_number' }`
  - `setDefaultSendInstance(db, accountId, instanceId) -> { ok: true } | { ok: false, reason: 'not_found' | 'not_send_role' }`
  - `sendNumberStatus(db, accountId) -> { ok, reason, instance: { id, instance_name, provider, status } | null }`

Regra do padrão (substitui "vira padrão ao conectar/remover" sem ganchos): se `accounts.default_send_instance_id` aponta para número **da mesma conta** e de **papel disparo**, é ele; senão, o número de disparo da conta de menor id; senão nenhum.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/resolveSendInstance.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { getDefaultSendInstance, resolveSendInstance, setDefaultSendInstance, sendNumberStatus } from '../server/services/whatsapp/resolveSendInstance.js'

function addInstance(db, accountId, { provider = 'uzapi', status = 'connected', name = 'disp' } = {}) {
  const id = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, ?, 'http://x', 'K', ?, ?)`).run(accountId, name, status, provider).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('so Evolution: automatico sem numero (no_send_number); manual usa o numero da conversa', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }), { ok: false, reason: 'no_send_number' })
  const m = resolveSendInstance(db, { accountId: s.account.id, kind: 'manual', conversationInstanceId: s.instance.id })
  assert.equal(m.ok, true); assert.equal(m.instance.id, s.instance.id)
})

test('manual sem numero da conversa', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'manual' }), { ok: false, reason: 'no_conversation_number' })
})

test('conta com um UzAPI so: ele e o padrao e faz o automatico', () => {
  const db = createTestDb(); const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  const r = resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' })
  assert.equal(r.ok, true); assert.equal(r.instance.id, s.instance.id)
})

test('Evolution + UzAPI: automatico sai pela UzAPI', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const uz = addInstance(db, s.account.id)
  assert.equal(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }).instance.id, uz.id)
})

test('padrao desconectado: send_number_offline (nao cai para outro nem para Evolution)', () => {
  const db = createTestDb(); const s = seedBasic(db)
  addInstance(db, s.account.id, { status: 'disconnected' })
  assert.deepEqual(resolveSendInstance(db, { accountId: s.account.id, kind: 'automatico' }), { ok: false, reason: 'send_number_offline' })
})

test('sem padrao escolhido: menor id de disparo; Tornar padrao troca', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const a = addInstance(db, s.account.id, { name: 'a' })
  const b = addInstance(db, s.account.id, { name: 'b' })
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, b.id), { ok: true })
  assert.equal(getDefaultSendInstance(db, s.account.id).id, b.id)
})

test('Tornar padrao recusa Evolution e numero de outra conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, s.instance.id), { ok: false, reason: 'not_send_role' })
  const other = db.prepare("INSERT INTO accounts (name, slug) VALUES ('B', 'b')").run().lastInsertRowid
  const alheio = addInstance(db, other)
  assert.deepEqual(setDefaultSendInstance(db, s.account.id, alheio.id), { ok: false, reason: 'not_found' })
})

test('padrao apagado ou de outra conta: cai para o proximo de disparo da propria conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const a = addInstance(db, s.account.id, { name: 'a' })
  const other = db.prepare("INSERT INTO accounts (name, slug) VALUES ('B', 'b')").run().lastInsertRowid
  const alheio = addInstance(db, other)
  db.prepare('UPDATE accounts SET default_send_instance_id = ? WHERE id = ?').run(alheio.id, s.account.id)
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
  db.prepare('UPDATE accounts SET default_send_instance_id = 9999 WHERE id = ?').run(s.account.id)
  assert.equal(getDefaultSendInstance(db, s.account.id).id, a.id)
})

test('status para a tela', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(sendNumberStatus(db, s.account.id), { ok: false, reason: 'no_send_number', instance: null })
  const uz = addInstance(db, s.account.id, { status: 'disconnected', name: 'Disparos' })
  assert.deepEqual(sendNumberStatus(db, s.account.id), {
    ok: false, reason: 'send_number_offline',
    instance: { id: uz.id, instance_name: 'Disparos', provider: 'uzapi', status: 'disconnected' },
  })
  db.prepare("UPDATE whatsapp_instances SET status = 'connected' WHERE id = ?").run(uz.id)
  assert.equal(sendNumberStatus(db, s.account.id).ok, true)
  assert.equal(sendNumberStatus(db, s.account.id).reason, null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/resolveSendInstance.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// server/services/whatsapp/resolveSendInstance.js
// Escolhedor central do numero de saida (spec secoes 4, 5 e 9).
import { SEND_PROVIDERS } from './numberRole.js'

const PLACEHOLDERS = SEND_PROVIDERS.map(() => '?').join(', ')

export function getDefaultSendInstance(db, accountId) {
  if (!accountId) return null
  const acc = db.prepare('SELECT default_send_instance_id FROM accounts WHERE id = ?').get(accountId)
  if (acc && acc.default_send_instance_id) {
    const chosen = db.prepare(`SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ? AND provider IN (${PLACEHOLDERS})`)
      .get(acc.default_send_instance_id, accountId, ...SEND_PROVIDERS)
    if (chosen) return chosen
  }
  return db.prepare(`SELECT * FROM whatsapp_instances WHERE account_id = ? AND provider IN (${PLACEHOLDERS}) ORDER BY id LIMIT 1`)
    .get(accountId, ...SEND_PROVIDERS) || null
}

export function resolveSendInstance(db, { accountId, kind, conversationInstanceId = null }) {
  if (kind === 'manual') {
    const inst = conversationInstanceId
      ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(conversationInstanceId, accountId)
      : null
    return inst ? { ok: true, instance: inst } : { ok: false, reason: 'no_conversation_number' }
  }
  const inst = getDefaultSendInstance(db, accountId)
  if (!inst) return { ok: false, reason: 'no_send_number' }
  if (inst.status !== 'connected') return { ok: false, reason: 'send_number_offline' }
  return { ok: true, instance: inst }
}

export function setDefaultSendInstance(db, accountId, instanceId) {
  const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(instanceId, accountId)
  if (!inst) return { ok: false, reason: 'not_found' }
  if (!SEND_PROVIDERS.includes(inst.provider)) return { ok: false, reason: 'not_send_role' }
  db.prepare('UPDATE accounts SET default_send_instance_id = ? WHERE id = ?').run(inst.id, accountId)
  return { ok: true }
}

export function sendNumberStatus(db, accountId) {
  const inst = getDefaultSendInstance(db, accountId)
  if (!inst) return { ok: false, reason: 'no_send_number', instance: null }
  const instance = { id: inst.id, instance_name: inst.instance_name, provider: inst.provider, status: inst.status }
  if (inst.status !== 'connected') return { ok: false, reason: 'send_number_offline', instance }
  return { ok: true, reason: null, instance }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/resolveSendInstance.test.js` → PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/resolveSendInstance.js test/resolveSendInstance.test.js
git commit -m "feat: escolhedor central do numero de saida e numero padrao de disparos"
```

---

### Task 3: Regras puras anti-ban (descadastro, rodapé, variação, pergunta)

**Files:**
- Create: `server/services/antiban.js`
- Test: `test/antiban.test.js`

**Interfaces:**
- Produces:
  - `OPTOUT_WORDS` (array), `isOptOutMessage(text) -> boolean`
  - `isOptedOut(lead) -> boolean` (mesma regra de `routes/broadcasts.js:75`)
  - `DEFAULT_OPTOUT_FOOTER`, `DEFAULT_OPTOUT_CONFIRM` (strings)
  - `appendOptOutFooter(text, footer) -> string` (não duplica se o texto já termina com o rodapé)
  - `LEAD_VARS` (array), `checkStepVariety({ message_template, variations }) -> { ok: true } | { ok: false, error: string }`

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/antiban.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isOptOutMessage, isOptedOut, appendOptOutFooter, checkStepVariety,
  DEFAULT_OPTOUT_FOOTER, DEFAULT_OPTOUT_CONFIRM, OPTOUT_WORDS,
} from '../server/services/antiban.js'

test('palavras de descadastro: mensagem inteira, sem acento/pontuacao/caixa', () => {
  for (const t of ['sair', 'SAIR', 'Sair.', ' sair! ', 'sáir', 'Parar', 'pare', 'CANCELAR', 'descadastrar', 'Stop']) {
    assert.equal(isOptOutMessage(t), true, t)
  }
  for (const t of ['vou sair agora', 'sair?? quando', 'saindo', '', null, undefined, 'não quero sair']) {
    assert.equal(isOptOutMessage(t), false, String(t))
  }
  assert.deepEqual(OPTOUT_WORDS, ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop'])
})

test('lead descadastrado: opted_out_at mais novo que opted_in_at', () => {
  assert.equal(isOptedOut({ opted_out_at: null }), false)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-20 10:00:00' }), true)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-20 10:00:00', opted_in_at: '2026-09-21 10:00:00' }), false)
  assert.equal(isOptedOut({ opted_out_at: '2026-09-22 10:00:00', opted_in_at: '2026-09-21 10:00:00' }), true)
  assert.equal(isOptedOut(null), false)
})

test('rodape SAIR', () => {
  assert.equal(DEFAULT_OPTOUT_FOOTER, 'Digite SAIR para não receber mais mensagens.')
  assert.equal(DEFAULT_OPTOUT_CONFIRM, 'Pronto! Você não vai mais receber nossas mensagens automáticas.')
  assert.equal(appendOptOutFooter('Oi Ana', DEFAULT_OPTOUT_FOOTER), 'Oi Ana\n\nDigite SAIR para não receber mais mensagens.')
  const once = appendOptOutFooter('Oi', DEFAULT_OPTOUT_FOOTER)
  assert.equal(appendOptOutFooter(once, DEFAULT_OPTOUT_FOOTER), once)
  assert.equal(appendOptOutFooter('Oi', ''), 'Oi')
  assert.equal(appendOptOutFooter('Oi', null), 'Oi')
})

test('variacao do passo de follow-up: 2+ variacoes OU variavel do lead', () => {
  assert.deepEqual(checkStepVariety({ message_template: 'Oi {{nome}}, tudo bem?' }), { ok: true })
  assert.deepEqual(checkStepVariety({ message_template: 'Oi {{primeiro_nome}}' }), { ok: true })
  assert.deepEqual(checkStepVariety({ variations: ['Oi', 'Ola'] }), { ok: true })
  assert.deepEqual(checkStepVariety({ variations: JSON.stringify(['Oi', 'Ola']) }), { ok: true })
  const bad = checkStepVariety({ message_template: 'Oi, tudo bem?' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /variação|\{\{nome\}\}/)
  assert.equal(checkStepVariety({ variations: ['Oi', '  '] }).ok, false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/antiban.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// server/services/antiban.js
// Regras puras anti-banimento (spec secao 10, apresentacao da UzAPI).
export const OPTOUT_WORDS = ['sair', 'parar', 'pare', 'cancelar', 'descadastrar', 'stop']
export const DEFAULT_OPTOUT_FOOTER = 'Digite SAIR para não receber mais mensagens.'
export const DEFAULT_OPTOUT_CONFIRM = 'Pronto! Você não vai mais receber nossas mensagens automáticas.'
export const LEAD_VARS = ['{{nome}}', '{{name}}', '{{primeiro_nome}}', '{{first_name}}', '{{empresa}}', '{{cidade}}']

function normalizeWord(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
}

// So a palavra sozinha conta ("vou sair agora" nao descadastra).
export function isOptOutMessage(text) {
  const w = normalizeWord(text)
  return OPTOUT_WORDS.includes(w)
}

export function isOptedOut(lead) {
  if (!lead || !lead.opted_out_at) return false
  return !lead.opted_in_at || lead.opted_out_at > lead.opted_in_at
}

export function appendOptOutFooter(text, footer) {
  const base = String(text || '')
  const f = String(footer || '').trim()
  if (!f) return base
  if (base.trimEnd().endsWith(f)) return base
  return `${base}\n\n${f}`
}

function parseVariations(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) {
    try { const arr = JSON.parse(v); return Array.isArray(arr) ? arr : [] } catch { return [] }
  }
  return []
}

export function checkStepVariety(step) {
  const vars = parseVariations(step && step.variations).map(x => String(x || '').trim()).filter(Boolean)
  if (vars.length >= 2) return { ok: true }
  const texts = [step && step.message_template, ...vars].map(t => String(t || ''))
  if (texts.some(t => LEAD_VARS.some(v => t.includes(v)))) return { ok: true }
  return { ok: false, error: 'Mensagem igual para todos aumenta o risco de bloqueio: adicione uma variação ou use {{nome}}.' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/antiban.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/antiban.js test/antiban.test.js
git commit -m "feat: regras anti-ban puras (palavra SAIR, rodape, variacao do follow-up)"
```

---

### Task 4: Catraca de intervalo 5–20s por número

**Files:**
- Create: `server/services/whatsapp/sendPacer.js`
- Test: `test/sendPacer.test.js`

**Interfaces:**
- Produces: `createSendPacer({ sleep, random, nowMs, minMs = 5000, maxMs = 20000 }) -> { wait(key): Promise<void> }` e o objeto compartilhado `followUpPacer` (instância única usada pelos follow-ups).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/sendPacer.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSendPacer } from '../server/services/whatsapp/sendPacer.js'

function fakeClock() {
  let t = 1_000_000
  const sleeps = []
  return {
    nowMs: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
    advance: (ms) => { t += ms },
    sleeps,
  }
}

test('primeiro envio no numero nao espera', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  assert.deepEqual(c.sleeps, [])
})

test('envios seguidos no mesmo numero: espera sorteada entre 5s e 20s', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await Promise.all([p.wait(1), p.wait(1), p.wait(1)])
  assert.deepEqual(c.sleeps, [5000, 5000])

  const c2 = fakeClock()
  const p2 = createSendPacer({ sleep: c2.sleep, nowMs: c2.nowMs, random: () => 0.999999 })
  await p2.wait(1); await p2.wait(1)
  assert.deepEqual(c2.sleeps, [20000])
})

test('se ja passou tempo suficiente, nao espera', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  c.advance(30000)
  await p.wait(1)
  assert.deepEqual(c.sleeps, [])
})

test('numeros diferentes nao se bloqueiam', async () => {
  const c = fakeClock()
  const p = createSendPacer({ sleep: c.sleep, nowMs: c.nowMs, random: () => 0 })
  await Promise.all([p.wait(1), p.wait(2)])
  assert.deepEqual(c.sleeps, [])
})

test('erro no sleep nao trava a fila do numero', async () => {
  const c = fakeClock()
  let fail = true
  const p = createSendPacer({ sleep: async (ms) => { if (fail) { fail = false; throw new Error('x') } return c.sleep(ms) }, nowMs: c.nowMs, random: () => 0 })
  await p.wait(1)
  await assert.rejects(p.wait(1))
  await p.wait(1)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/sendPacer.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// server/services/whatsapp/sendPacer.js
// Catraca anti-ban (spec 10.7): entre dois envios automaticos no mesmo numero, espera sorteada de 5 a 20s.
// Serializa por chave (id do numero); numeros diferentes andam em paralelo.
const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function createSendPacer({ sleep = defaultSleep, random = Math.random, nowMs = () => Date.now(), minMs = 5000, maxMs = 20000 } = {}) {
  const chains = new Map()
  const lastAt = new Map()

  function wait(key) {
    const prev = chains.get(key) || Promise.resolve()
    const next = prev.then(async () => {
      const last = lastAt.get(key)
      if (last != null) {
        const gap = minMs + Math.floor(random() * (maxMs - minMs + 1))
        const remaining = last + gap - nowMs()
        if (remaining > 0) await sleep(Math.min(remaining, maxMs))
      }
      lastAt.set(key, nowMs())
    })
    chains.set(key, next.catch(() => {}))
    return next
  }

  return { wait }
}

export const followUpPacer = createSendPacer()
```

Observação para o teste `random: () => 0.999999`: `5000 + floor(0.999999 * 15001) = 5000 + 15000 = 20000`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/sendPacer.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/sendPacer.js test/sendPacer.test.js
git commit -m "feat: catraca de 5 a 20s entre envios automaticos no mesmo numero"
```

---

### Task 5: Trava no envio (automático nunca sai por número de leitura)

**Files:**
- Modify: `server/services/whatsapp/sender.js` (`sendViaInstance`, `sendMediaViaInstance`)
- Modify: `server/routes/messages.js:120-123` e `:229-231` (passar `origin: 'manual'`)
- Test: `test/sender.test.js` (acrescentar testes no fim)

**Interfaces:**
- Consumes: `numberRole` (Task 1).
- Produces: opção `origin: 'manual' | 'auto'` (padrão `'auto'`) em `sendViaInstance(instance, phone, text, opts)` e `sendMediaViaInstance(instance, phone, media, opts)`; recusa `{ ok: false, reason: 'auto_on_read_number' }`.

- [ ] **Step 1: Escrever o teste que falha** (no fim de `test/sender.test.js`; o `seed.instance` do helper é Evolution)

```js
test('trava: automatico com lead em numero de leitura (Evolution) e recusado', async () => {
  const { seed, sender, calls } = setup()
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'oi', { ...humanChat, leadId: 1 })
  assert.deepEqual(r, { ok: false, reason: 'auto_on_read_number' })
  assert.equal(calls.sendText.length, 0)
  const m = await sender.sendMediaViaInstance(seed.instance, '5547991351835', { type: 'image', caption: 'x' }, { ...humanChat, leadId: 1 })
  assert.deepEqual(m, { ok: false, reason: 'auto_on_read_number' })
  assert.equal(calls.sendMedia.length, 0)
})

test('trava: manual em numero de leitura passa', async () => {
  const { seed, sender, calls } = setup()
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'oi', { ...humanChat, leadId: 1, origin: 'manual' })
  assert.equal(r.ok, true)
  assert.equal(calls.sendText.length, 1)
})

test('trava: sem lead (aviso interno ao vendedor) passa', async () => {
  const { seed, sender } = setup()
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'aviso', humanChat)
  assert.equal(r.ok, true)
})

test('trava: automatico em numero de disparo passa', async () => {
  const { seed, sender } = setup()
  const uz = { ...seed.instance, provider: 'uzapi' }
  const r = await sender.sendViaInstance(uz, '5547991351835', 'oi', { ...humanChat, leadId: 1 })
  assert.equal(r.ok, true)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/sender.test.js` → os 2 testes de recusa FALHAM (hoje envia).

Atenção: testes antigos de `sender.test.js` que passam `leadId` com `seed.instance` (Evolution) sem `origin` vão passar a ser recusados. Rodar e listar quais quebram; nesses, trocar a instância por `{ ...seed.instance, provider: 'uzapi' }` (o teste é sobre cap/quota, não sobre papel). Não mudar o que eles verificam.

- [ ] **Step 3: Implementar**

Em `server/services/whatsapp/sender.js`, importar no topo:

```js
import { numberRole } from './numberRole.js'
```

Dentro de `createSender`, antes de `sendViaInstance`:

```js
  // Trava (spec secao 8): envio automatico para lead nunca sai por numero de leitura (Evolution).
  function readNumberBlock(instance, opts) {
    if ((opts.origin || 'auto') === 'manual') return null
    if (!opts.leadId) return null
    if (numberRole(instance) !== 'leitura') return null
    console.warn(`[Trava] envio automatico recusado inst=${instance && instance.instance_name} lead=${opts.leadId} (numero de leitura)`)
    return { ok: false, reason: 'auto_on_read_number' }
  }
```

E como primeira linha de `sendViaInstance` e de `sendMediaViaInstance`:

```js
    const blocked = readNumberBlock(instance, opts)
    if (blocked) return blocked
```

Em `server/routes/messages.js`, nas duas chamadas do chat (texto `:120` e mídia `:229`), acrescentar `origin: 'manual',` ao objeto de opções. Conferir com `grep -n "origin: 'manual'" server/routes/messages.js` → 2 linhas.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test` → tudo passa.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/sender.js server/routes/messages.js test/sender.test.js
git commit -m "feat: trava - envio automatico para lead nao sai por numero de leitura"
```

---

### Task 6: Entrada de mensagens — agente/ausência só no número de disparo + palavra SAIR

**Files:**
- Modify: `server/services/inboundHandler.js` (bloco de auto-mensagens `:291-331`, bloco do agente `:451-458`, novo bloco SAIR)
- Modify: `server/services/inboundRuntime.js` (nova dependência `sendOptOutConfirmation`)
- Modify: `test/helpers/inboundSetup.js` (dependência falsa nova)
- Modify: `test/inboundHandler.test.js` (testes do agente passam a usar número UzAPI; testes novos)

**Interfaces:**
- Consumes: `numberRole` (Task 1), `isOptOutMessage`, `DEFAULT_OPTOUT_CONFIRM` (Task 3).
- Produces: nova dependência de `createInboundHandler`: `sendOptOutConfirmation({ lead, instance, account, text }) -> Promise`. Retorno de `handleInboundMessage` ganha `optedOut: true` quando descadastra.

- [ ] **Step 1: Ajustar os testes existentes**

Em `test/inboundHandler.test.js`, o `setup()` usa `seed.instance` (Evolution). Os testes que esperam `calls.ai.length === 1` (texto de lead novo, ~linha 75; áudio, ~linha 111) passariam a falhar com a regra nova. Neles, logo depois de `const { db, seed, calls, receive } = setup()`, acrescentar:

```js
  asSendNumber(db, seed)
```

com este helper no topo do arquivo (abaixo de `const tick = ...`):

```js
// Numero de disparo (UzAPI): o agente e as auto-mensagens so rodam nele (spec secao 6).
function asSendNumber(db, seed) {
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(seed.instance.id)
  seed.instance.provider = 'uzapi'
}
// Mesmo payload de texto da Evolution com outro conteudo e outro id.
let seq = 0
function textPayload(text) {
  const p = JSON.parse(JSON.stringify(P.textConversation))
  p.data.message.conversation = text
  p.data.key.id = `3EB0OPTOUT${String(++seq).padStart(6, '0')}`
  return p
}
```

No `setup()`, acrescentar `optout: []` ao objeto `calls` e a dependência (antes do `...depOverrides`):

```js
    sendOptOutConfirmation: (...a) => { calls.optout.push(a); return Promise.resolve() },
```

Em `test/helpers/inboundSetup.js`, acrescentar `optout: []` em `calls` e a mesma dependência no `createInboundHandler`.

- [ ] **Step 2: Escrever os testes novos** (no fim de `test/inboundHandler.test.js`)

```js
test('numero de leitura (Evolution): grava a mensagem mas nao chama o agente', async () => {
  const { db, calls, receive } = setup()
  receive(P.textConversation)
  await tick()
  assert.equal(calls.ai.length, 0)
  assert.equal(msgs(db)[0].content, 'Oi, quero saber o preco')
})

test('numero de leitura: nao agenda boas-vindas nem ausencia', async () => {
  const cfg = { greeting_enabled: 1, greeting_text: 'Ola', away_text: 'Fechado' }
  const { calls, receive } = setup({}, { getInstanceConfig: () => cfg, shouldSendAway: () => true })
  receive(P.textConversation)
  await new Promise(r => setTimeout(r, 2100))
  assert.equal(calls.autoMsg.length, 0)
})

test('numero de disparo: agenda boas-vindas e ausencia como antes', async () => {
  const cfg = { greeting_enabled: 1, greeting_text: 'Ola', away_text: 'Fechado' }
  const { db, seed, calls, receive } = setup({}, { getInstanceConfig: () => cfg, shouldSendAway: () => true })
  asSendNumber(db, seed)
  receive(P.textConversation)
  await new Promise(r => setTimeout(r, 2100))
  assert.deepEqual(calls.autoMsg.map(c => c[0].type).sort(), ['away', 'greeting'])
})

test('lead manda "Sair." no numero de disparo: descadastra, cancela follow-ups, confirma e nao chama o agente', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  receive(P.textConversation)
  await tick()
  const [lead] = leads(db)
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status) VALUES (?, 1, 'active')").run(lead.id)
  calls.ai.length = 0
  const r = receive(textPayload('Sair.'))
  assert.deepEqual(r, { ok: true, optedOut: true })
  assert.ok(db.prepare('SELECT opted_out_at FROM leads WHERE id = ?').get(lead.id).opted_out_at)
  assert.deepEqual(
    db.prepare('SELECT status, paused_reason FROM lead_follow_ups WHERE lead_id = ?').get(lead.id),
    { status: 'cancelled', paused_reason: 'lead_opted_out' },
  )
  assert.equal(calls.optout.length, 1)
  assert.equal(calls.optout[0][0].text, 'Pronto! Você não vai mais receber nossas mensagens automáticas.')
  assert.equal(calls.optout[0][0].instance.id, seed.instance.id)
  await tick()
  assert.equal(calls.ai.length, 0)
})

test('SAIR no numero de leitura: descadastra mas nao responde nada', async () => {
  const { db, calls, receive } = setup()
  receive(textPayload('SAIR'))
  assert.ok(leads(db)[0].opted_out_at)
  assert.equal(calls.optout.length, 0)
})

test('"vou sair agora" nao descadastra', async () => {
  const { db, receive } = setup()
  receive(textPayload('vou sair agora'))
  assert.equal(leads(db)[0].opted_out_at, null)
})

test('confirmacao usa o texto da conta quando existe', async () => {
  const { db, seed, calls, receive } = setup()
  asSendNumber(db, seed)
  db.prepare("UPDATE accounts SET optout_confirm_text = 'Ok, removido.' WHERE id = ?").run(seed.account.id)
  receive(textPayload('parar'))
  assert.equal(calls.optout[0][0].text, 'Ok, removido.')
})
```

Os testes de boas-vindas/ausência esperam 2,1 s porque o handler agenda com `setTimeout` de 1 s e 2 s. Conferir o nome exato do campo `type` no objeto passado a `sendAutoMessage` (`sendAutoMessage({ leadId, instanceId, type, text, accountId })` em `inboundHandler.js:302` e `:318`).

- [ ] **Step 3: Rodar e ver falhar**

Run: `node --test test/inboundHandler.test.js` → os testes novos falham.

- [ ] **Step 4: Implementar em `server/services/inboundHandler.js`**

No topo:

```js
import { numberRole } from './whatsapp/numberRole.js'
import { isOptOutMessage, DEFAULT_OPTOUT_CONFIRM } from './antiban.js'
```

Em `createInboundHandler(deps)`, desestruturar também `sendOptOutConfirmation = () => Promise.resolve()`.

Logo no início de `handleInboundMessage`, depois de `const leadName = ...`:

```js
    const isSendNumber = numberRole(waInstance) === 'disparo'
    const optingOut = !fromMe && isOptOutMessage(content)
```

Bloco de auto-mensagens: trocar `if (!fromMe && waInstance) {` por:

```js
    if (!fromMe && waInstance && isSendNumber && !optingOut) {
```

Antes do bloco do agente (`// AI Agent: plug fire-and-forget`), inserir:

```js
    // Descadastro pela palavra SAIR (spec 10.2): marca, cancela follow-ups e confirma so no numero de disparo.
    if (optingOut && lead) {
      db.prepare("UPDATE leads SET opted_out_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(lead.id)
      db.prepare(`UPDATE lead_follow_ups SET status = 'cancelled', paused_reason = 'lead_opted_out', next_run_at = NULL,
        updated_at = datetime('now') WHERE lead_id = ? AND status IN ('active', 'paused')`).run(lead.id)
      console.log(`[OptOut] lead=${lead.id} descadastrado pela palavra "${content}"`)
      if (isSendNumber) {
        const acc = db.prepare('SELECT optout_confirm_text FROM accounts WHERE id = ?').get(account.id)
        const text = (acc && acc.optout_confirm_text && acc.optout_confirm_text.trim()) || DEFAULT_OPTOUT_CONFIRM
        Promise.resolve(sendOptOutConfirmation({ lead, instance: waInstance, account, text }))
          .catch(e => console.error('[OptOut] confirmacao:', e && e.message))
      }
    }
```

Condição do agente: trocar `if (!fromMe && lead && (content || mediaType === 'audio')) {` por:

```js
    if (!fromMe && lead && isSendNumber && !optingOut && (content || mediaType === 'audio')) {
```

No `return { ok: true }` final, devolver `{ ok: true, ...(optingOut && lead ? { optedOut: true } : {}) }`.

- [ ] **Step 5: Ligar a dependência real em `server/services/inboundRuntime.js`**

Importar `sendViaInstance` de `./leadHandoff.js` (junto de `notifyAndOpenLead`) e acrescentar:

```js
// Confirmacao do descadastro (spec 10.2): uma mensagem, pelo numero de disparo onde o lead escreveu.
async function sendOptOutConfirmation({ lead, instance, text }) {
  const phone = lead.phone || String(lead.wa_remote_jid || '').replace(/@.*$/, '')
  if (!phone) return
  const r = await sendViaInstance(instance, phone, text, { leadId: lead.id, skipBusinessHours: true, skipLeadCap: true })
  if (r.ok) {
    db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, instance_id)
      VALUES (?, ?, 'outbound', ?, 'text', 'Descadastro auto', ?, ?)`).run(lead.id, lead.account_id, text, r.wamsgId || null, instance.id)
  }
}
```

e passar `sendOptOutConfirmation` no objeto de `createInboundHandler({...})`.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test` → tudo passa.

- [ ] **Step 7: Commit**

```bash
git add server/services/inboundHandler.js server/services/inboundRuntime.js test/helpers/inboundSetup.js test/inboundHandler.test.js
git commit -m "feat: agente e ausencia so no numero de disparo; descadastro pela palavra SAIR"
```

---

### Task 7: Follow-ups — número padrão, descadastro, catraca, retomada por conta, variação obrigatória

**Files:**
- Create: `server/services/followUpRouting.js`
- Modify: `server/services/followUpSender.js` (`sendFollowUpMessage` `:84-124`, `resumeFollowUpsIfPaused` `:228-243`)
- Modify: `server/routes/follow-ups.js` (`POST /` `:131-138`, `PUT /:id` `:233-237`, validação de passos `:189-191` e `:305-307`)
- Modify: `server/services/whatsapp/instanceManager.js` (`resumePaused` recebe a instância inteira — já recebe; nada a mudar se `resumeFollowUpsIfPaused` aceitar o id)
- Test: `test/followUpRouting.test.js`

**Interfaces:**
- Consumes: `resolveSendInstance` (Task 2), `isOptedOut`, `checkStepVariety`, `appendOptOutFooter`, `DEFAULT_OPTOUT_FOOTER` (Task 3), `followUpPacer` (Task 4).
- Produces:
  - `planFollowUpSend(db, { lead, followUp }) -> { ok: true, instance, footer: string|null } | { ok: false, pause: 'lead_opted_out' | 'no_send_number' | 'send_number_offline' }`
  - `resumeAutomaticFollowUps(db, accountId) -> number` (retoma os pausados por `no_send_number`/`send_number_offline`/`instance_offline`/`instance_removed` da conta, se o número padrão estiver conectado)

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/followUpRouting.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { planFollowUpSend, resumeAutomaticFollowUps } from '../server/services/followUpRouting.js'

function uzapi(db, accountId, status = 'connected') {
  const id = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', ?, 'uzapi')`).run(accountId, status).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('so Evolution: pausa no_send_number', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  assert.deepEqual(planFollowUpSend(db, { lead, followUp: { instance_id: s.instance.id } }), { ok: false, pause: 'no_send_number' })
})

test('sai pelo numero padrao, ignorando follow_ups.instance_id', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const uz = uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  const r = planFollowUpSend(db, { lead, followUp: { instance_id: s.instance.id, optout_footer_enabled: 0 } })
  assert.equal(r.ok, true); assert.equal(r.instance.id, uz.id); assert.equal(r.footer, null)
})

test('descadastrado pausa antes de tudo', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1', opted_out_at: '2026-09-20 10:00:00' })
  assert.deepEqual(planFollowUpSend(db, { lead, followUp: {} }), { ok: false, pause: 'lead_opted_out' })
})

test('rodape opcional por follow-up usa o texto da conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  uzapi(db, s.account.id)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  assert.equal(planFollowUpSend(db, { lead, followUp: { optout_footer_enabled: 1 } }).footer, 'Digite SAIR para não receber mais mensagens.')
  db.prepare("UPDATE accounts SET optout_footer_text = 'Responda SAIR p/ parar' WHERE id = ?").run(s.account.id)
  assert.equal(planFollowUpSend(db, { lead, followUp: { optout_footer_enabled: 1 } }).footer, 'Responda SAIR p/ parar')
})

test('retoma os pausados da conta quando o numero padrao esta conectado', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '1' })
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'no_send_number')").run(lead.id)
  db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, paused_reason) VALUES (?, 1, 'paused', 'lead_opted_out')").run(lead.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 0) // sem numero de disparo
  uzapi(db, s.account.id)
  assert.equal(resumeAutomaticFollowUps(db, s.account.id), 1)
  const rows = db.prepare('SELECT status, paused_reason FROM lead_follow_ups ORDER BY id').all()
  assert.deepEqual(rows, [{ status: 'active', paused_reason: null }, { status: 'paused', paused_reason: 'lead_opted_out' }])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/followUpRouting.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `server/services/followUpRouting.js`**

```js
// Decisao pura do envio de follow-up (spec secoes 5, 9 e 10): numero padrao, descadastro e rodape.
import { resolveSendInstance } from './whatsapp/resolveSendInstance.js'
import { isOptedOut, DEFAULT_OPTOUT_FOOTER } from './antiban.js'

export const RESUMABLE_REASONS = ['no_send_number', 'send_number_offline', 'instance_offline', 'instance_removed', 'send_failed', 'send_error']

export function planFollowUpSend(db, { lead, followUp }) {
  if (isOptedOut(lead)) return { ok: false, pause: 'lead_opted_out' }
  const r = resolveSendInstance(db, { accountId: lead.account_id, kind: 'automatico' })
  if (!r.ok) return { ok: false, pause: r.reason }
  let footer = null
  if (followUp && followUp.optout_footer_enabled) {
    const acc = db.prepare('SELECT optout_footer_text FROM accounts WHERE id = ?').get(lead.account_id)
    footer = (acc && acc.optout_footer_text && acc.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER
  }
  return { ok: true, instance: r.instance, footer }
}

export function resumeAutomaticFollowUps(db, accountId) {
  const r = resolveSendInstance(db, { accountId, kind: 'automatico' })
  if (!r.ok) return 0
  const ph = RESUMABLE_REASONS.map(() => '?').join(', ')
  const res = db.prepare(`
    UPDATE lead_follow_ups SET status = 'active', paused_at = NULL, paused_reason = NULL,
      next_run_at = datetime('now'), updated_at = datetime('now')
    WHERE status = 'paused' AND paused_reason IN (${ph})
      AND lead_id IN (SELECT id FROM leads WHERE account_id = ?)
  `).run(...RESUMABLE_REASONS, accountId)
  return res.changes
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/followUpRouting.test.js` → PASS.

- [ ] **Step 5: Ligar em `server/services/followUpSender.js`**

Imports no topo:

```js
import { planFollowUpSend, resumeAutomaticFollowUps } from './followUpRouting.js'
import { appendOptOutFooter } from './antiban.js'
import { followUpPacer } from './whatsapp/sendPacer.js'
```

Substituir o bloco `const instance = followUp.instance_id ? ... ` até o fim do `if (instance.status !== 'connected') {...}` (linhas ~84-95) por:

```js
    // Numero de saida = numero padrao de disparos da conta (spec secao 5); descadastro pausa (spec 10.1).
    const plan = planFollowUpSend(db, { lead, followUp })
    if (!plan.ok) {
      pauseLeadFollowUp(leadFollowUpId, plan.pause)
      console.log(`[FollowUp] Pausado lead=${lead.id} — ${plan.pause}`)
      return
    }
    const instance = plan.instance
```

Depois de `const text = applyMessageVars(rawText, buildVarContext(lead, attendant))`, trocar por:

```js
    const text = plan.footer
      ? appendOptOutFooter(applyMessageVars(rawText, buildVarContext(lead, attendant)), plan.footer)
      : applyMessageVars(rawText, buildVarContext(lead, attendant))

    // Catraca anti-ban (spec 10.7): 5 a 20s entre follow-ups no mesmo numero.
    await followUpPacer.wait(instance.id)
```

Trocar o corpo de `resumeFollowUpsIfPaused(instanceId)` por:

```js
export function resumeFollowUpsIfPaused(instanceId) {
  const inst = db.prepare('SELECT account_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!inst) return
  const n = resumeAutomaticFollowUps(db, inst.account_id)
  if (n > 0) console.log(`[FollowUp] Retomando ${n} follow-up(s) — numero ${instanceId} conectou (conta ${inst.account_id})`)
}
```

(O `sending.has` do lock continua valendo; a catraca fica depois do lock, então o mesmo `lead_follow_up` nunca é enviado duas vezes.)

- [ ] **Step 6: Rotas de follow-up (`server/routes/follow-ups.js`)**

Import no topo: `import { checkStepVariety } from '../services/antiban.js'` e `import { getDefaultSendInstance } from '../services/whatsapp/resolveSendInstance.js'`.

`POST /` (`:133-138`): `instance_id` deixa de ser obrigatório. Trocar
`if (!name || !instance_id) return res.status(400).json({ error: 'name e instance_id obrigatorios' })` por:

```js
  if (!name) return res.status(400).json({ error: 'name obrigatorio' })
  // Historico: grava o numero padrao de disparos (o envio usa sempre o padrao do momento — spec secao 5).
  const sendInst = getDefaultSendInstance(db, req.accountId)
  const finalInstanceId = instance_id || (sendInst && sendInst.id) || null
```
e, na validação `const inst = ...get(instance_id, req.accountId)` logo abaixo, validar só `if (instance_id)`; no `INSERT` trocar `instance_id` por `finalInstanceId`. Conferir que a coluna `follow_ups.instance_id` aceita NULL: `grep -n "CREATE TABLE IF NOT EXISTS follow_ups" -A8 server/db.js`. Se for `NOT NULL`, usar `finalInstanceId || 0` **não** — em vez disso, devolver 400 com `'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar'` quando `finalInstanceId` for nulo.

Aceitar `optout_footer_enabled` no body do `POST` e do `PUT` e gravar na coluna nova (`optout_footer_enabled ? 1 : 0`; no `PUT`, manter o valor atual se não vier).

Validação ⑥ nos dois lugares onde hoje está `if (!variationsJson && !hasTpl) return res.status(400)...` (`:191` e `:307`), logo depois:

```js
      const variety = checkStepVariety({ message_template: s.message_template, variations: variationsJson })
      if (!variety.ok) return res.status(400).json({ error: `Etapa ${i + 1}: ${variety.error}` })
```
(usar o nome real da variável de índice do laço; conferir lendo o laço.)

- [ ] **Step 7: Rodar tudo**

Run: `npm test` → tudo passa. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 15.

- [ ] **Step 8: Commit**

```bash
git add server/services/followUpRouting.js server/services/followUpSender.js server/routes/follow-ups.js test/followUpRouting.test.js
git commit -m "feat: follow-ups pelo numero padrao, respeitam descadastro, catraca 5-20s e variacao obrigatoria"
```

---

### Task 8: Disparos em massa — número padrão, rodapé SAIR, retomada por conta

**Files:**
- Create: `server/services/broadcastRouting.js`
- Modify: `server/routes/broadcasts.js` (`POST /` `:28-66`, `runBroadcastLoopInner` `:161-176` e `:230-238`, montagem do texto `:250-258`, `resumeBroadcastIfPaused` `:316-322`)
- Test: `test/broadcastRouting.test.js`

**Interfaces:**
- Consumes: `resolveSendInstance`, `getDefaultSendInstance` (Task 2), `appendOptOutFooter`, `DEFAULT_OPTOUT_FOOTER` (Task 3).
- Produces:
  - `broadcastFooter(db, accountId) -> string | null`
  - `pauseReasonText(reason) -> string` (texto do aviso para `paused_reason`)
  - `NO_SEND_REASONS` = os dois textos de aviso (para a retomada achar os pausados)

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/broadcastRouting.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { broadcastFooter, pauseReasonText, NO_SEND_REASONS } from '../server/services/broadcastRouting.js'

test('rodape ligado por padrao com o texto padrao; desligavel; texto da conta', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.equal(broadcastFooter(db, s.account.id), 'Digite SAIR para não receber mais mensagens.')
  db.prepare("UPDATE accounts SET optout_footer_text = 'SAIR = parar' WHERE id = ?").run(s.account.id)
  assert.equal(broadcastFooter(db, s.account.id), 'SAIR = parar')
  db.prepare('UPDATE accounts SET optout_footer_enabled = 0 WHERE id = ?').run(s.account.id)
  assert.equal(broadcastFooter(db, s.account.id), null)
})

test('textos de pausa', () => {
  assert.equal(pauseReasonText('no_send_number'), 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar')
  assert.equal(pauseReasonText('send_number_offline'), 'O número de disparos está desconectado — os envios automáticos estão parados')
  assert.deepEqual(NO_SEND_REASONS, [pauseReasonText('no_send_number'), pauseReasonText('send_number_offline')])
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/broadcastRouting.test.js` → FAIL.

- [ ] **Step 3: Implementar `server/services/broadcastRouting.js`**

```js
// Disparos em massa: rodape SAIR e textos de pausa (spec secoes 9 e 10.3).
import { DEFAULT_OPTOUT_FOOTER } from './antiban.js'

const REASON_TEXT = {
  no_send_number: 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar',
  send_number_offline: 'O número de disparos está desconectado — os envios automáticos estão parados',
}

export const NO_SEND_REASONS = [REASON_TEXT.no_send_number, REASON_TEXT.send_number_offline]

export function pauseReasonText(reason) {
  return REASON_TEXT[reason] || String(reason || '')
}

export function broadcastFooter(db, accountId) {
  const acc = db.prepare('SELECT optout_footer_enabled, optout_footer_text FROM accounts WHERE id = ?').get(accountId)
  if (!acc || !acc.optout_footer_enabled) return null
  return (acc.optout_footer_text && acc.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Ligar em `server/routes/broadcasts.js`**

Imports:

```js
import { resolveSendInstance, getDefaultSendInstance } from '../services/whatsapp/resolveSendInstance.js'
import { broadcastFooter, pauseReasonText, NO_SEND_REASONS } from '../services/broadcastRouting.js'
import { appendOptOutFooter } from '../services/antiban.js'
```

`POST /` (`:34-36`): trocar a validação do `instance_id` do body por:

```js
  // Numero de saida = numero padrao de disparos (spec secao 5). O instance_id do body e ignorado.
  const sendInst = getDefaultSendInstance(db, req.accountId)
  if (!sendInst) return res.status(400).json({ error: pauseReasonText('no_send_number') })
  const instance = sendInst
```
e no `INSERT` usar `instance.id` no lugar de `instance_id`.

`runBroadcastLoopInner`: trocar o bloco que busca `instance` por `broadcast.instance_id` e pausa (`:165-176`) por:

```js
  const resolved = resolveSendInstance(db, { accountId: broadcast.account_id, kind: 'automatico' })
  if (!resolved.ok) {
    const reason = pauseReasonText(resolved.reason)
    db.prepare("UPDATE broadcasts SET paused_at = datetime('now'), paused_reason = ? WHERE id = ?").run(reason, broadcastId)
    broadcastSSE(broadcast.account_id, 'broadcast:paused', { id: broadcastId, reason })
    return
  }
  const instance = resolved.instance
  if (broadcast.instance_id !== instance.id) {
    db.prepare('UPDATE broadcasts SET instance_id = ? WHERE id = ?').run(instance.id, broadcastId)
  }
  const footer = broadcastFooter(db, broadcast.account_id)
```

Dentro do `while`, trocar o re-check `liveInstance` (`:233-238`) por:

```js
    const live = resolveSendInstance(db, { accountId: broadcast.account_id, kind: 'automatico' })
    if (!live.ok) {
      const reason = pauseReasonText(live.reason)
      db.prepare("UPDATE broadcasts SET paused_at = datetime('now'), paused_reason = ? WHERE id = ?").run(reason, broadcastId)
      broadcastSSE(broadcast.account_id, 'broadcast:paused', { id: broadcastId, reason })
      return
    }
    const liveInstance = live.instance
```

Depois de montar `text` (`:250-258`), acrescentar: `const finalText = footer ? appendOptOutFooter(text, footer) : text` e passar `finalText` no `sendViaInstance`.

`resumeBroadcastIfPaused(instanceId)`: trocar a consulta para achar os disparos pausados da **conta** do número:

```js
export function resumeBroadcastIfPaused(instanceId) {
  const inst = db.prepare('SELECT account_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
  if (!inst) return
  const paused = db.prepare(`SELECT * FROM broadcasts WHERE account_id = ? AND status = 'sending' AND paused_at IS NOT NULL
    AND (instance_id = ? OR paused_reason IN (?, ?))`).all(inst.account_id, instanceId, ...NO_SEND_REASONS)
  for (const b of paused) {
    console.log(`[Broadcast] Retomando disparo "${b.name}" (id=${b.id}) — numero ${instanceId} conectou`)
    runBroadcastLoop(b.id).catch(err => console.error('[Broadcast] Resume error:', err))
  }
}
```

(Pausa manual pelo usuário continua não sendo retomada: ela tem outro `paused_reason` e o número não mudou.) Conferir: `grep -n "paused_reason = 'manual'\|pauseBroadcast" server/routes/broadcasts.js` — se a pausa manual gravar `paused_reason` com `instance_id` igual, manter o comportamento atual (hoje `resumeBroadcastIfPaused` já retoma tudo que está pausado naquele número; não piorar).

- [ ] **Step 6: Rodar tudo** — `npm test` → passa.

- [ ] **Step 7: Commit**

```bash
git add server/services/broadcastRouting.js server/routes/broadcasts.js test/broadcastRouting.test.js
git commit -m "feat: disparos pelo numero padrao, rodape SAIR e retomada por conta"
```

---

### Task 9: Passagem ao vendedor vira tarefa (Evolution) + boas-vindas do agente pelo número padrão

**Files:**
- Create: `server/services/firstMessageTask.js`
- Modify: `server/services/leadHandoff.js:91-117`
- Modify: `server/services/aiAgent.js:912-918` (`sendBotWelcomeForSheetsLead`)
- Test: `test/firstMessageTask.test.js`

**Interfaces:**
- Consumes: `numberRole` (Task 1), `resolveSendInstance` (Task 2).
- Produces: `createFirstMessageTask(db, { lead, user, text }) -> { id }` (cria `standalone_tasks` e marca `leads.first_msg_sent_at`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/firstMessageTask.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createFirstMessageTask } from '../server/services/firstMessageTask.js'

function withTasks(db) {
  db.exec(`CREATE TABLE standalone_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER, assigned_to INTEGER,
    title TEXT NOT NULL, description TEXT, due_datetime TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_by INTEGER, completed_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  db.exec('ALTER TABLE leads ADD COLUMN first_msg_sent_at TEXT')
  return db
}

test('cria tarefa para o vendedor com o texto pronto e marca first_msg_sent_at', () => {
  const db = withTasks(createTestDb()); const s = seedBasic(db)
  const user = { id: db.prepare("INSERT INTO users (account_id, name) VALUES (?, 'Joao')").run(s.account.id).lastInsertRowid, name: 'Joao' }
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, name: 'Ana', phone: '5547999990000' })
  const r = createFirstMessageTask(db, { lead, user, text: 'Oi Ana, sou o Joao!' })
  const task = db.prepare('SELECT * FROM standalone_tasks WHERE id = ?').get(r.id)
  assert.equal(task.account_id, s.account.id)
  assert.equal(task.lead_id, lead.id)
  assert.equal(task.assigned_to, user.id)
  assert.equal(task.title, 'Mandar 1ª mensagem para Ana')
  assert.equal(task.description, 'Oi Ana, sou o Joao!')
  assert.equal(task.status, 'pending')
  assert.ok(task.due_datetime)
  assert.ok(db.prepare('SELECT first_msg_sent_at FROM leads WHERE id = ?').get(lead.id).first_msg_sent_at)
})

test('lead sem nome usa o telefone no titulo', () => {
  const db = withTasks(createTestDb()); const s = seedBasic(db)
  const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: '5547999990000' })
  const r = createFirstMessageTask(db, { lead, user: { id: null, name: '' }, text: 'x' })
  assert.equal(db.prepare('SELECT title FROM standalone_tasks WHERE id = ?').get(r.id).title, 'Mandar 1ª mensagem para 5547999990000')
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// server/services/firstMessageTask.js
// Passagem ao vendedor em numero de leitura (Evolution): a 1a mensagem vira tarefa com texto pronto (spec secao 7).
export function createFirstMessageTask(db, { lead, user, text }) {
  const who = (lead && (lead.name || lead.phone)) || 'lead'
  const r = db.prepare(`INSERT INTO standalone_tasks (account_id, lead_id, assigned_to, title, description, due_datetime, status)
    VALUES (?, ?, ?, ?, ?, datetime('now'), 'pending')`)
    .run(lead.account_id, lead.id, (user && user.id) || null, `Mandar 1ª mensagem para ${who}`, text)
  db.prepare("UPDATE leads SET first_msg_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(lead.id)
  return { id: r.lastInsertRowid }
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Ligar em `server/services/leadHandoff.js`**

Imports: `import { numberRole } from './whatsapp/numberRole.js'` e `import { createFirstMessageTask } from './firstMessageTask.js'`.

Dentro de `if (text.trim()) {` (`:98`), antes do `const r = await sendViaInstance(vendInst, ...)`, inserir:

```js
            if (numberRole(vendInst) === 'leitura') {
              // Numero do vendedor e Evolution (leitura): nao envia sozinho, vira tarefa (spec secao 7).
              createFirstMessageTask(db, { lead, user, text })
              console.log(`[Handoff] 1a msg lead=${lead.id} virou tarefa para ${user.name} (numero de leitura)`)
            } else {
```
e fechar o `else` depois do bloco `if (r.ok) {...} else {...}` existente (o envio atual fica dentro do `else`, sem mudar).

- [ ] **Step 6: Boas-vindas do agente (`server/services/aiAgent.js:912-918`)**

Import: `import { resolveSendInstance } from './whatsapp/resolveSendInstance.js'`.

Trocar:

```js
    const targetInstId = lead.instance_id || instanceId
    if (!targetInstId) { ... }
    const inst = db.prepare("SELECT * FROM whatsapp_instances WHERE id = ? AND status = 'connected'").get(targetInstId)
    if (!inst) { ... }
```

por:

```js
    // Boas-vindas e envio automatico: sai pelo numero padrao de disparos (spec secao 5).
    const resolved = resolveSendInstance(db, { accountId: lead.account_id, kind: 'automatico' })
    if (!resolved.ok) {
      console.log(`[Bot Welcome] SKIP lead=${leadId} — ${resolved.reason}`)
      return
    }
    const inst = resolved.instance
```

Ler as linhas logo abaixo e trocar usos de `targetInstId` por `inst.id`. As outras chamadas de `sendViaInstance` do agente (`:557`, `:817`) respondem no número onde o lead escreveu; a Task 6 garante que o agente só roda em número de disparo, e a trava (Task 5) cobre o resto. Não mexer nelas.

- [ ] **Step 7: Rodar tudo** — `npm test` → passa.

- [ ] **Step 8: Commit**

```bash
git add server/services/firstMessageTask.js server/services/leadHandoff.js server/services/aiAgent.js test/firstMessageTask.test.js
git commit -m "feat: 1a mensagem da passagem vira tarefa no numero de leitura; boas-vindas do agente pelo numero padrao"
```

---

### Task 10: Taxa de resposta por número de disparo + alerta

**Files:**
- Create: `server/services/replyRate.js`
- Modify: `server/scheduler.js` (chamada diária, no mesmo bloco da análise noturna)
- Test: `test/replyRate.test.js`

**Interfaces:**
- Consumes: `SEND_PROVIDERS` (Task 1).
- Produces:
  - `computeReplyRate(db, instanceId, { days = 7, replyHours = 24, now = null }) -> { reached: number, replied: number, rate: number | null }` (`rate` é `null` com menos de 20 leads)
  - `checkReplyRates(db) -> Array<{ accountId, instanceId, rate }>` (grava um `analyst_alerts` tipo `send_number_low_reply` por número abaixo do limite, no máximo 1 aberto por número)

"Envio automático" = mensagem `outbound` no número com `sent_by_user_id IS NULL` e `delivery_status IN ('sent','delivered','read')`. "Respondeu" = existe `inbound` do mesmo lead até 24h depois do primeiro automático da janela.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/replyRate.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { computeReplyRate, checkReplyRates } from '../server/services/replyRate.js'

function withAlerts(db) {
  db.exec(`CREATE TABLE analyst_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lead_id INTEGER,
    type TEXT NOT NULL, severity TEXT NOT NULL, title TEXT NOT NULL, description TEXT, suggested_action TEXT,
    status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')))`)
  return db
}

function scenario(db, { leads, replies }) {
  const s = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET provider = 'uzapi' WHERE id = ?").run(s.instance.id)
  for (let i = 0; i < leads; i++) {
    const lead = insertLead(db, { account_id: s.account.id, funnel_id: s.funnelId, stage_id: s.stage1, phone: String(5547990000000 + i) })
    db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, delivery_status, created_at)
      VALUES (?, ?, 'outbound', 'oi', ?, 'delivered', datetime('now', '-2 days'))`).run(lead.id, s.account.id, s.instance.id)
    if (i < replies) {
      db.prepare(`INSERT INTO messages (lead_id, account_id, direction, content, instance_id, created_at)
        VALUES (?, ?, 'inbound', 'ola', ?, datetime('now', '-2 days', '+3 hours'))`).run(lead.id, s.account.id, s.instance.id)
    }
  }
  return s
}

test('menos de 20 leads: sem taxa', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 19, replies: 0 })
  assert.deepEqual(computeReplyRate(db, s.instance.id), { reached: 19, replied: 0, rate: null })
})

test('taxa = responderam em 24h / receberam', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 20, replies: 5 })
  assert.deepEqual(computeReplyRate(db, s.instance.id), { reached: 20, replied: 5, rate: 0.25 })
})

test('mensagem manual (sent_by_user_id) nao conta como automatica', () => {
  const db = createTestDb(); const s = scenario(db, { leads: 20, replies: 0 })
  db.prepare('UPDATE messages SET sent_by_user_id = 1').run()
  assert.equal(computeReplyRate(db, s.instance.id).reached, 0)
})

test('abaixo de 10%: cria um alerta so (nao repete)', () => {
  const db = withAlerts(createTestDb()); const s = scenario(db, { leads: 20, replies: 1 })
  const r1 = checkReplyRates(db)
  assert.equal(r1.length, 1)
  assert.equal(r1[0].instanceId, s.instance.id)
  checkReplyRates(db)
  const alerts = db.prepare("SELECT * FROM analyst_alerts WHERE type = 'send_number_low_reply'").all()
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].title, /inst-teste/)
})

test('limite editavel por conta e numero Evolution ignorado', () => {
  const db = withAlerts(createTestDb()); const s = scenario(db, { leads: 20, replies: 5 })
  assert.equal(checkReplyRates(db).length, 0)
  db.prepare('UPDATE accounts SET reply_rate_alert_pct = 30 WHERE id = ?').run(s.account.id)
  assert.equal(checkReplyRates(db).length, 1)
  db.prepare("DELETE FROM analyst_alerts").run()
  db.prepare("UPDATE whatsapp_instances SET provider = 'evolution'").run()
  assert.equal(checkReplyRates(db).length, 0)
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementar**

```js
// server/services/replyRate.js
// Engajamento por numero de disparo (spec 10.4): quem recebeu automatico e respondeu em ate 24h, janela de 7 dias.
import { SEND_PROVIDERS } from './whatsapp/numberRole.js'

const MIN_LEADS = 20

export function computeReplyRate(db, instanceId, { days = 7, replyHours = 24 } = {}) {
  const row = db.prepare(`
    WITH first_auto AS (
      SELECT lead_id, MIN(created_at) AS at FROM messages
      WHERE instance_id = ? AND direction = 'outbound' AND sent_by_user_id IS NULL
        AND delivery_status IN ('sent', 'delivered', 'read')
        AND created_at >= datetime('now', ?)
      GROUP BY lead_id
    )
    SELECT COUNT(*) AS reached,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM messages m WHERE m.lead_id = f.lead_id AND m.direction = 'inbound'
          AND m.created_at > f.at AND m.created_at <= datetime(f.at, ?)
      ) THEN 1 ELSE 0 END) AS replied
    FROM first_auto f
  `).get(instanceId, `-${days} days`, `+${replyHours} hours`)
  const reached = row.reached || 0
  const replied = row.replied || 0
  return { reached, replied, rate: reached >= MIN_LEADS ? replied / reached : null }
}

export function checkReplyRates(db) {
  const ph = SEND_PROVIDERS.map(() => '?').join(', ')
  const insts = db.prepare(`
    SELECT wi.id, wi.account_id, wi.instance_name, COALESCE(a.reply_rate_alert_pct, 10) AS pct
    FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id
    WHERE wi.provider IN (${ph})
  `).all(...SEND_PROVIDERS)
  const low = []
  for (const i of insts) {
    const { rate, reached, replied } = computeReplyRate(db, i.id)
    if (rate === null || rate * 100 >= i.pct) continue
    low.push({ accountId: i.account_id, instanceId: i.id, rate })
    const open = db.prepare(`SELECT 1 FROM analyst_alerts WHERE account_id = ? AND type = 'send_number_low_reply'
      AND status = 'open' AND title LIKE ?`).get(i.account_id, `%${i.instance_name}%`)
    if (open) continue
    db.prepare(`INSERT INTO analyst_alerts (account_id, type, severity, title, description, suggested_action)
      VALUES (?, 'send_number_low_reply', 'warning', ?, ?, ?)`).run(
      i.account_id,
      `Pouca gente está respondendo o número ${i.instance_name} — risco de bloqueio`,
      `Nos últimos 7 dias, ${replied} de ${reached} leads responderam em até 24h (${Math.round(rate * 100)}%). Abaixo de ${i.pct}% o WhatsApp pode entender como spam.`,
      'Termine as mensagens com uma pergunta, envie só para quem pediu contato e reduza o volume por alguns dias.')
  }
  return low
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Ligar no scheduler**

Em `server/scheduler.js`, importar `import { checkReplyRates } from './services/replyRate.js'` e, dentro da função da análise noturna (procurar `// ─── Nightly Analysis`), acrescentar no começo do corpo:

```js
  try {
    const low = checkReplyRates(db)
    if (low.length) console.log(`[ReplyRate] ${low.length} numero(s) de disparo com pouca resposta`)
  } catch (e) { console.error('[ReplyRate] erro:', e.message) }
```

- [ ] **Step 6: Rodar tudo** — `npm test` → passa.

- [ ] **Step 7: Commit**

```bash
git add server/services/replyRate.js server/scheduler.js test/replyRate.test.js
git commit -m "feat: taxa de resposta por numero de disparo com alerta diario"
```

---

### Task 11: Rotas para a tela (status, tornar padrão, ajustes anti-ban, papel na lista)

**Files:**
- Create: `server/services/antibanSettings.js`
- Modify: `server/routes/integrations.js` (novas rotas antes de `router.get('/whatsapp/:id/status'...)`, e `GET /whatsapp` `:95-96`)
- Test: `test/antibanSettings.test.js`

**Interfaces:**
- Consumes: `numberRole` (Task 1), `sendNumberStatus`, `setDefaultSendInstance`, `getDefaultSendInstance` (Task 2), `computeReplyRate` (Task 10), `DEFAULT_OPTOUT_FOOTER`, `DEFAULT_OPTOUT_CONFIRM` (Task 3).
- Produces:
  - `getAntibanSettings(db, accountId) -> { optout_footer_enabled: boolean, optout_footer_text: string, optout_confirm_text: string, reply_rate_alert_pct: number }`
  - `saveAntibanSettings(db, accountId, body) -> { ok: true, settings } | { ok: false, error }`
  - `decorateInstances(db, accountId, rows) -> rows` com `role`, `is_default_send`, `reply_rate` (`{ reached, replied, rate }` só para disparo)
  - Rotas: `GET /api/integrations/whatsapp/send-number-status`, `PUT /api/integrations/whatsapp/default-send-instance` (`{ instance_id }`, só `super_admin`/`gerente`), `GET` e `PUT /api/integrations/antiban-settings` (PUT só `super_admin`/`gerente`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/antibanSettings.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { getAntibanSettings, saveAntibanSettings, decorateInstances } from '../server/services/antibanSettings.js'

test('padroes quando a conta nao configurou', () => {
  const db = createTestDb(); const s = seedBasic(db)
  assert.deepEqual(getAntibanSettings(db, s.account.id), {
    optout_footer_enabled: true,
    optout_footer_text: 'Digite SAIR para não receber mais mensagens.',
    optout_confirm_text: 'Pronto! Você não vai mais receber nossas mensagens automáticas.',
    reply_rate_alert_pct: 10,
  })
})

test('salva e valida', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const r = saveAntibanSettings(db, s.account.id, { optout_footer_enabled: false, optout_footer_text: '  SAIR p/ parar ', optout_confirm_text: '', reply_rate_alert_pct: 15 })
  assert.equal(r.ok, true)
  assert.deepEqual(r.settings, {
    optout_footer_enabled: false, optout_footer_text: 'SAIR p/ parar',
    optout_confirm_text: 'Pronto! Você não vai mais receber nossas mensagens automáticas.', reply_rate_alert_pct: 15,
  })
  assert.equal(saveAntibanSettings(db, s.account.id, { reply_rate_alert_pct: 0 }).ok, false)
  assert.equal(saveAntibanSettings(db, s.account.id, { reply_rate_alert_pct: 90 }).ok, false)
  assert.equal(saveAntibanSettings(db, s.account.id, { optout_footer_text: 'x'.repeat(201) }).ok, false)
})

test('lista de numeros ganha papel e padrao', () => {
  const db = createTestDb(); const s = seedBasic(db)
  const uzId = db.prepare(`INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider)
    VALUES (?, 'disp', 'http://x', 'K', 'connected', 'uzapi')`).run(s.account.id).lastInsertRowid
  const rows = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY id').all(s.account.id)
  const out = decorateInstances(db, s.account.id, rows)
  assert.equal(out[0].role, 'leitura'); assert.equal(out[0].is_default_send, false); assert.equal(out[0].reply_rate, null)
  assert.equal(out[1].role, 'disparo'); assert.equal(out[1].is_default_send, true)
  assert.deepEqual(out[1].reply_rate, { reached: 0, replied: 0, rate: null })
  assert.equal(out[1].id, uzId)
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementar `server/services/antibanSettings.js`**

```js
// Ajustes anti-ban da conta e dados extras da lista de numeros (spec secoes 4, 10 e 11).
import { numberRole } from './whatsapp/numberRole.js'
import { getDefaultSendInstance } from './whatsapp/resolveSendInstance.js'
import { computeReplyRate } from './replyRate.js'
import { DEFAULT_OPTOUT_FOOTER, DEFAULT_OPTOUT_CONFIRM } from './antiban.js'

const MAX_TEXT = 200

export function getAntibanSettings(db, accountId) {
  const a = db.prepare(`SELECT optout_footer_enabled, optout_footer_text, optout_confirm_text, reply_rate_alert_pct
    FROM accounts WHERE id = ?`).get(accountId) || {}
  return {
    optout_footer_enabled: a.optout_footer_enabled == null ? true : !!a.optout_footer_enabled,
    optout_footer_text: (a.optout_footer_text && a.optout_footer_text.trim()) || DEFAULT_OPTOUT_FOOTER,
    optout_confirm_text: (a.optout_confirm_text && a.optout_confirm_text.trim()) || DEFAULT_OPTOUT_CONFIRM,
    reply_rate_alert_pct: a.reply_rate_alert_pct == null ? 10 : a.reply_rate_alert_pct,
  }
}

export function saveAntibanSettings(db, accountId, body = {}) {
  const cur = getAntibanSettings(db, accountId)
  const footer = body.optout_footer_text === undefined ? cur.optout_footer_text : String(body.optout_footer_text || '').trim()
  const confirm = body.optout_confirm_text === undefined ? cur.optout_confirm_text : String(body.optout_confirm_text || '').trim()
  const pct = body.reply_rate_alert_pct === undefined ? cur.reply_rate_alert_pct : Number(body.reply_rate_alert_pct)
  if (footer.length > MAX_TEXT || confirm.length > MAX_TEXT) return { ok: false, error: `Textos com no máximo ${MAX_TEXT} caracteres` }
  if (!Number.isInteger(pct) || pct < 1 || pct > 50) return { ok: false, error: 'O limite da taxa de resposta deve ficar entre 1% e 50%' }
  const enabled = body.optout_footer_enabled === undefined ? cur.optout_footer_enabled : !!body.optout_footer_enabled
  db.prepare(`UPDATE accounts SET optout_footer_enabled = ?, optout_footer_text = ?, optout_confirm_text = ?, reply_rate_alert_pct = ?
    WHERE id = ?`).run(enabled ? 1 : 0, footer || null, confirm || null, pct, accountId)
  return { ok: true, settings: getAntibanSettings(db, accountId) }
}

export function decorateInstances(db, accountId, rows) {
  const def = getDefaultSendInstance(db, accountId)
  return rows.map(r => {
    const role = numberRole(r)
    return {
      ...r,
      role,
      is_default_send: !!def && def.id === r.id,
      reply_rate: role === 'disparo' ? computeReplyRate(db, r.id) : null,
    }
  })
}
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: Rotas em `server/routes/integrations.js`**

Imports:

```js
import { sendNumberStatus, setDefaultSendInstance } from '../services/whatsapp/resolveSendInstance.js'
import { getAntibanSettings, saveAntibanSettings, decorateInstances } from '../services/antibanSettings.js'
```

`GET /whatsapp` (`:95-96`): trocar `res.json({ instances: rows.map(r => safe(r, req)) })` por
`res.json({ instances: decorateInstances(db, req.accountId, rows).map(r => ({ ...safe(r, req), role: r.role, is_default_send: r.is_default_send, reply_rate: r.reply_rate })) })`.
No ramo do atendente (`:92`), fazer o mesmo com `decorateInstances(db, req.accountId, [row])[0]`.

Novas rotas, colocadas **antes** de `router.get('/whatsapp/:id/status'` (para `send-number-status` não cair no `:id`):

```js
// ─── Numero padrao de disparos (spec secoes 4 e 9) ───
router.get('/whatsapp/send-number-status', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  res.json(sendNumberStatus(db, req.accountId))
})

router.put('/whatsapp/default-send-instance', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const r = setDefaultSendInstance(db, req.accountId, Number(req.body && req.body.instance_id))
  if (!r.ok) {
    const msg = r.reason === 'not_send_role' ? 'Só números UzAPI ou Oficial podem ser o padrão de disparos' : 'Número não encontrado'
    return res.status(400).json({ error: msg })
  }
  res.json({ ok: true, status: sendNumberStatus(db, req.accountId) })
})

// ─── Ajustes anti-ban da conta (spec secao 10) ───
router.get('/antiban-settings', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  res.json({ settings: getAntibanSettings(db, req.accountId) })
})

router.put('/antiban-settings', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const r = saveAntibanSettings(db, req.accountId, req.body || {})
  if (!r.ok) return res.status(400).json({ error: r.error })
  res.json({ settings: r.settings })
})
```

Conferir a ordem: `grep -n "router\.\(get\|put\)('/whatsapp/" server/routes/integrations.js` — as duas novas precisam vir antes de qualquer `'/whatsapp/:id...'` do mesmo verbo.

- [ ] **Step 6: Rodar tudo** — `npm test` → passa.

- [ ] **Step 7: Commit**

```bash
git add server/services/antibanSettings.js server/routes/integrations.js test/antibanSettings.test.js
git commit -m "feat: rotas de status do numero de disparos, tornar padrao e ajustes anti-ban"
```

---

### Task 12: Front — regras puras, API e faixa de aviso

**Files:**
- Create: `src/lib/antiban.js`, `src/lib/antiban.d.ts`
- Create: `src/components/SendNumberBanner.tsx`
- Modify: `src/lib/api.ts` (tipos e funções novas; `WhatsAppInstance` ganha campos)
- Test: `test/antibanFront.test.js`

**Interfaces:**
- Produces (front):
  - `isSendProvider(provider) -> boolean`, `roleLabel(role) -> 'Leitura' | 'Disparo'`, `sendStatusMessage(reason) -> string | null`, `lacksQuestion(text) -> boolean`, `needsVariety({ message_template, variations }) -> boolean` (mesma regra da Task 3), `formatReplyRate(rr) -> string | null`
  - `api.ts`: `fetchSendNumberStatus(accountId)`, `setDefaultSendInstance(accountId, instanceId)`, `fetchAntibanSettings(accountId)`, `saveAntibanSettings(accountId, data)`; tipos `SendNumberStatus`, `AntibanSettings`; `WhatsAppInstance` ganha `role?: 'leitura' | 'disparo'; is_default_send?: boolean; reply_rate?: { reached: number; replied: number; rate: number | null } | null`
  - `<SendNumberBanner accountId={number} />` — mostra "Sai por: {nome}" quando ok, ou a faixa com o texto do motivo (neutra para `no_send_number`, vermelha para `send_number_offline`), com link "Ir para Integrações".

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/antibanFront.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSendProvider, roleLabel, sendStatusMessage, lacksQuestion, needsVariety, formatReplyRate } from '../src/lib/antiban.js'

test('provedor de disparo', () => {
  assert.equal(isSendProvider('uzapi'), true)
  assert.equal(isSendProvider('cloud_api'), true)
  assert.equal(isSendProvider('evolution'), false)
  assert.equal(isSendProvider(undefined), false)
  assert.equal(roleLabel('disparo'), 'Disparo')
  assert.equal(roleLabel('leitura'), 'Leitura')
})

test('textos do aviso', () => {
  assert.equal(sendStatusMessage('no_send_number'), 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar')
  assert.equal(sendStatusMessage('send_number_offline'), 'O número de disparos está desconectado — os envios automáticos estão parados')
  assert.equal(sendStatusMessage(null), null)
})

test('dica da pergunta', () => {
  assert.equal(lacksQuestion('Oi, tudo bem?'), false)
  assert.equal(lacksQuestion('Oi, tudo bem'), true)
  assert.equal(lacksQuestion(''), false)
})

test('variacao: mesma regra do servidor', () => {
  assert.equal(needsVariety({ message_template: 'Oi {{nome}}' }), false)
  assert.equal(needsVariety({ variations: ['a', 'b'] }), false)
  assert.equal(needsVariety({ variations: '["a","b"]' }), false)
  assert.equal(needsVariety({ message_template: 'Oi' }), true)
  assert.equal(needsVariety({ message_template: '' }), false) // passo vazio: outra validacao cuida
})

test('taxa de resposta para o selo', () => {
  assert.equal(formatReplyRate(null), null)
  assert.equal(formatReplyRate({ reached: 5, replied: 1, rate: null }), null)
  assert.equal(formatReplyRate({ reached: 40, replied: 10, rate: 0.25 }), '25% responderam (7 dias)')
})
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test test/antibanFront.test.js` → FAIL.

- [ ] **Step 3: Implementar `src/lib/antiban.js`**

```js
// Regras puras anti-ban e papeis dos numeros na tela. JS puro com .d.ts ao lado para rodar no `node --test`.
const SEND_PROVIDERS = ['uzapi', 'cloud_api']
const LEAD_VARS = ['{{nome}}', '{{name}}', '{{primeiro_nome}}', '{{first_name}}', '{{empresa}}', '{{cidade}}']
const STATUS_TEXT = {
  no_send_number: 'Envios automáticos desligados — conecte UzAPI ou Oficial para liberar',
  send_number_offline: 'O número de disparos está desconectado — os envios automáticos estão parados',
}

export function isSendProvider(provider) {
  return SEND_PROVIDERS.includes(provider)
}

export function roleLabel(role) {
  return role === 'disparo' ? 'Disparo' : 'Leitura'
}

export function sendStatusMessage(reason) {
  return reason ? (STATUS_TEXT[reason] || null) : null
}

export function lacksQuestion(text) {
  const t = String(text || '').trim()
  return t.length > 0 && !t.includes('?')
}

function parseVariations(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v.trim()) { try { const a = JSON.parse(v); return Array.isArray(a) ? a : [] } catch { return [] } }
  return []
}

export function needsVariety(step) {
  const vars = parseVariations(step && step.variations).map(x => String(x || '').trim()).filter(Boolean)
  const tpl = String((step && step.message_template) || '').trim()
  if (!tpl && vars.length === 0) return false
  if (vars.length >= 2) return false
  return ![tpl, ...vars].some(t => LEAD_VARS.some(v => t.includes(v)))
}

export function formatReplyRate(rr) {
  if (!rr || rr.rate == null) return null
  return `${Math.round(rr.rate * 100)}% responderam (7 dias)`
}
```

`src/lib/antiban.d.ts`:

```ts
export function isSendProvider(provider: string | null | undefined): boolean
export function roleLabel(role: 'leitura' | 'disparo' | string | null | undefined): 'Leitura' | 'Disparo'
export function sendStatusMessage(reason: string | null | undefined): string | null
export function lacksQuestion(text: string | null | undefined): boolean
export function needsVariety(step: { message_template?: string | null; variations?: string[] | string | null }): boolean
export function formatReplyRate(rr: { reached: number; replied: number; rate: number | null } | null | undefined): string | null
```

- [ ] **Step 4: Rodar e ver passar** — PASS.

- [ ] **Step 5: `src/lib/api.ts`**

Estender `WhatsAppInstance` (linha 64) com `; role?: 'leitura' | 'disparo'; is_default_send?: boolean; reply_rate?: { reached: number; replied: number; rate: number | null } | null`.

Depois de `createWhatsAppInstance` (linha ~426):

```ts
export interface SendNumberStatus {
  ok: boolean
  reason: 'no_send_number' | 'send_number_offline' | null
  instance: { id: number; instance_name: string; provider: string; status: string } | null
}
export interface AntibanSettings {
  optout_footer_enabled: boolean
  optout_footer_text: string
  optout_confirm_text: string
  reply_rate_alert_pct: number
}
export const fetchSendNumberStatus = (accountId: number) =>
  apiFetch<SendNumberStatus>(`/api/integrations/whatsapp/send-number-status?account_id=${accountId}`)
export const setDefaultSendInstance = (accountId: number, instanceId: number) =>
  apiFetch<{ ok: true; status: SendNumberStatus }>(`/api/integrations/whatsapp/default-send-instance?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ instance_id: instanceId }) })
export const fetchAntibanSettings = (accountId: number) =>
  apiFetch<{ settings: AntibanSettings }>(`/api/integrations/antiban-settings?account_id=${accountId}`).then(d => d.settings)
export const saveAntibanSettings = (accountId: number, data: Partial<AntibanSettings>) =>
  apiFetch<{ settings: AntibanSettings }>(`/api/integrations/antiban-settings?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify(data) }).then(d => d.settings)
```

- [ ] **Step 6: `src/components/SendNumberBanner.tsx`**

Antes de escrever, abrir `src/components/InlineNotice.tsx` e usar o mesmo estilo (cores e raio) para a faixa. Componente:

```tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Smartphone } from 'lucide-react'
import { fetchSendNumberStatus, type SendNumberStatus } from '../lib/api'
import { sendStatusMessage } from '../lib/antiban.js'

// Numero de saida dos envios automaticos (spec secoes 9 e 11). onStatus permite a tela bloquear o botao de envio.
export default function SendNumberBanner({ accountId, onStatus }: { accountId: number; onStatus?: (s: SendNumberStatus) => void }) {
  const [status, setStatus] = useState<SendNumberStatus | null>(null)
  useEffect(() => {
    let alive = true
    fetchSendNumberStatus(accountId).then(s => { if (alive) { setStatus(s); onStatus?.(s) } }).catch(() => {})
    return () => { alive = false }
  }, [accountId])
  if (!status) return null
  if (status.ok && status.instance) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#34C759' }}>
        <Smartphone size={14} /> Sai por: <strong>{status.instance.instance_name}</strong>
      </div>
    )
  }
  const offline = status.reason === 'send_number_offline'
  return (
    <div role="status" style={{
      padding: 10, borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between',
      background: offline ? 'rgba(255,107,107,0.08)' : 'rgba(142,142,147,0.10)', color: offline ? '#FF6B6B' : 'var(--text-secondary, #8E8E93)',
    }}>
      <span>{sendStatusMessage(status.reason)}</span>
      <Link to="/integrations">Ir para Integrações</Link>
    </div>
  )
}
```

Conferir o caminho real da rota de Integrações no `src/App.tsx` (`grep -n "integrations" src/App.tsx`) e ajustar o `to`. Conferir que `lucide-react` e `react-router-dom` já são usados no projeto (`grep -rn "from 'lucide-react'" src | head -1`).

- [ ] **Step 7: Verificar**

Run: `npm test` → passa. `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 15.

- [ ] **Step 8: Commit**

```bash
git add src/lib/antiban.js src/lib/antiban.d.ts src/components/SendNumberBanner.tsx src/lib/api.ts test/antibanFront.test.js
git commit -m "feat: regras anti-ban na tela, API do numero de disparos e faixa de aviso"
```

---

### Task 13: Telas — Disparos, Follow-ups, Integrações, Agente, Mensagens automáticas, Configurações

**Files:**
- Modify: `src/pages/Messages.tsx` (criação de disparo: `:43`, `:78-81`, `:174`, `:186`, `:371-395`, `:479`, `:638`)
- Modify: `src/pages/FollowUps.tsx` (editor: `:80`, `:135`, `:229`, `:272`, `:495`; modal de aplicar `:786-827`)
- Modify: `src/pages/integrations/WhatsAppCard.tsx` (selos e botão)
- Modify: `src/components/AgentEditorModal.tsx:420-430` (lista de números)
- Modify: `src/components/NumberSettingsModal.tsx` (bloco de mensagens automáticas)
- Modify: `src/pages/Settings.tsx` (novo cartão "Proteção contra bloqueio")

**Interfaces:**
- Consumes: tudo da Task 12.

Tela não tem teste automático no projeto; cada passo termina com `npx tsc --noEmit` (15 erros) e a verificação no navegador da Task 14.

- [ ] **Step 1: Disparos (`src/pages/Messages.tsx`)**
  - Remover o estado `newInstanceId` e o carregamento que o preenche; remover o seletor/avisos das linhas `:371-395`.
  - No lugar, renderizar `<SendNumberBanner accountId={accountId} onStatus={s => setSendOk(s.ok)} />` com `const [sendOk, setSendOk] = useState(false)`.
  - `createBroadcast` deixa de mandar `instance_id` (o servidor ignora). Trocar `!newInstanceId` por `!sendOk` nas condições de `:174` e `:479`.
  - Resumo (`:638`): "Número de saída: número padrão de disparos".
  - Prévia da mensagem: se `fetchAntibanSettings` disser `optout_footer_enabled`, mostrar o rodapé em cinza embaixo da prévia ("será adicionado: {texto}").
  - Dica ⑤: abaixo do campo da mensagem principal, se `lacksQuestion(newTemplate)`, mostrar em texto pequeno: "Mensagens que terminam com uma pergunta recebem mais respostas — e isso protege o número".
  - Clonar disparo (`:242`): remover o `setNewInstanceId`.

- [ ] **Step 2: Follow-ups (`src/pages/FollowUps.tsx`)**
  - Editor: remover o seletor de número (`:495`) e a validação `'Instância obrigatória'` (`:229`); não mandar `instance_id` no salvar (`:272`). Colocar `<SendNumberBanner accountId={accountId} />` no topo do editor.
  - Novo checkbox "Adicionar 'Digite SAIR…' no fim das mensagens" ligado ao campo `optout_footer_enabled` (padrão desligado), enviado no salvar.
  - Em cada passo: dica ⑤ com `lacksQuestion(texto)`; aviso ⑥ com `needsVariety({ message_template, variations })` → texto vermelho "Mensagem igual para todos — adicione uma variação ou {{nome}}" (o servidor recusa ao salvar; o aviso adianta).
  - Lista de follow-ups: mostrar o mesmo aviso ⑥ nos follow-ups cujos passos falham na regra (passos antigos continuam enviando).
  - Modal de aplicar (`:786-827`): remover o seletor de número; manter o envio para a rota sem `instance_id` se a rota aceitar — conferir a rota `POST /:id/assign` em `server/routes/follow-ups.js:376`; se ela exigir `instance_id`, mandar o id de `fetchSendNumberStatus(...).instance?.id` e bloquear o botão com a faixa quando não houver.

- [ ] **Step 3: Integrações (`src/pages/integrations/WhatsAppCard.tsx`)**
  - Em cada número, ao lado do provedor, selo `roleLabel(instance.role)` ("Leitura" cinza / "Disparo" azul).
  - Se `instance.is_default_send`: selo verde "Padrão de disparos".
  - Se `instance.role === 'disparo' && !instance.is_default_send`: botão "Tornar padrão" (só para `gerente`/`super_admin` — usar a mesma checagem de papel que o card já usa para "Excluir"), que chama `setDefaultSendInstance` e recarrega a lista; erro vai para o `InlineNotice` do card (sem `alert`).
  - Se `formatReplyRate(instance.reply_rate)` existir: texto pequeno com a taxa; se a taxa estiver abaixo do limite da conta (`fetchAntibanSettings`), cor amarela e "risco de bloqueio".
  - No topo da seção de WhatsApp: `<SendNumberBanner accountId={accountId} />`.

- [ ] **Step 4: Agente (`src/components/AgentEditorModal.tsx:420-430`)**
  - A lista de números com checkbox mostra só `isSendProvider(i.provider)`.
  - Se `instanceIds` contém algum número que não é de disparo, mostrar acima da lista: "Este agente estava ligado a um número de leitura; agora ele só atende números de disparo" e não reenviar esses ids no salvar (filtrar `instanceIds` pelos de disparo ao montar o body da `:220`).
  - Se não houver nenhum número de disparo: texto "Conecte um número UzAPI ou Oficial para o agente atender".

- [ ] **Step 5: Mensagens automáticas (`src/components/NumberSettingsModal.tsx`)**
  - Se `!isSendProvider(instance.provider)`: o bloco de saudação/ausência fica desabilitado (`disabled` nos campos, opacidade reduzida) com o texto "Mensagens automáticas só saem pelo número de disparos". O resto do modal (1ª mensagem, horários etc.) continua igual.

- [ ] **Step 6: Configurações (`src/pages/Settings.tsx`)**
  - Novo cartão "Proteção contra bloqueio" (só `gerente`/`super_admin`), carregado com `fetchAntibanSettings`:
    - checkbox "Adicionar rodapé de saída nos disparos" + campo do texto do rodapé;
    - campo "Resposta quando o lead pede para sair";
    - número "Avisar quando a taxa de resposta ficar abaixo de (%)" (1 a 50).
  - Botão Salvar chama `saveAntibanSettings`; sucesso/erro com `InlineNotice` (sem `alert`).

- [ ] **Step 7: Verificar tipos e build**

Run: `npx tsc --noEmit 2>&1 | grep -c "error TS"` → 15. `npm run build` → sucesso. `npm test` → passa.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Messages.tsx src/pages/FollowUps.tsx src/pages/integrations/WhatsAppCard.tsx src/components/AgentEditorModal.tsx src/components/NumberSettingsModal.tsx src/pages/Settings.tsx
git commit -m "feat: telas com numero padrao de disparos, papeis dos numeros e protecao contra bloqueio"
```

---

### Task 14: Verificação final no navegador

**Files:** nenhum (só conferência). Se algo quebrar, corrigir no arquivo da task dona e commitar como `fix:`.

- [ ] **Step 1: Subir o dev local**

Mesmo jeito do teste da UzAPI (memória do projeto): exportar `UZAPI_USERNAME`, `UZAPI_ACCOUNT_TOKEN` (falso) e `WA_ENC_KEY` a partir das linhas "TESTE LOCAL" do fim de `crm/.env`, e rodar `npm run dev`. Portas 3002 (API) e 5175 (tela). Ao terminar, matar os `node` pelos PIDs dessas portas (o `TaskStop` não mata os filhos).

- [ ] **Step 2: Conferir, numa conta só com Evolution**
  - Disparos e Follow-ups mostram "Envios automáticos desligados — conecte UzAPI ou Oficial para liberar" e não deixam criar disparo.
  - Integrações: número com selo "Leitura".
  - Número Evolution: bloco de mensagens automáticas desabilitado com a explicação.

- [ ] **Step 3: Conferir, criando um número UzAPI na mesma conta** (fica "connecting" sem credencial real — para ver "conectado", marcar no banco local: `UPDATE whatsapp_instances SET status='connected' WHERE provider='uzapi'`)
  - Selo "Disparo" e "Padrão de disparos"; faixa troca para "Sai por: {nome}".
  - Criar um segundo UzAPI conectado → aparece "Tornar padrão"; clicar troca o selo.
  - Desconectar o padrão no banco (`status='disconnected'`) → faixa vermelha "O número de disparos está desconectado…".
  - Configurações: cartão "Proteção contra bloqueio" salva e recarrega os valores.
  - Editor de follow-up: passo "Oi, tudo bem" sem variação mostra o aviso e o servidor recusa ao salvar; "Oi {{nome}}, tudo bem?" salva sem aviso nem dica.

- [ ] **Step 4: Números finais**

Run: `npm test` (anotar total), `npx tsc --noEmit 2>&1 | grep -c "error TS"` (= 15), `npm run build` (ok). `git status --short` deve mostrar só as mudanças locais que nunca entram em commit (`vite.config.ts`, `dist/`, `*.mjs`, `.env`).

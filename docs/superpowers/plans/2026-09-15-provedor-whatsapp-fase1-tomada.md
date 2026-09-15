# Provedor de WhatsApp — Fase 1: Tomada padrão Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a "tomada" única de WhatsApp (`server/services/whatsapp/`) com o adaptador Evolution, extrair a regra de negócio do recebimento para `inboundHandler`, trocar o webhook por um token por número e aplicar as correções do spec §3/§4.7, sem mudar o comportamento das instâncias Evolution existentes.

**Architecture:** Todo envio, recebimento, mídia e checagem de número passa por `getProvider(instance)`, que devolve um adaptador (só `evolution` nesta fase). As regras de anti-ban ficam em `whatsapp/sender.js` (antes da tomada) e a regra de negócio do recebimento fica em `services/inboundHandler.js`; os dois recebem dependências injetadas (`db`, `fetch`, SSE, IA etc.) para serem testados com `better-sqlite3` `:memory:` e `fetch` falso, sem importar `server/db.js`. Arquivos `*Runtime`/`leadHandoff.js` fazem a ligação com o banco real.

**Tech Stack:** Node 16.20.2 (produção) / Node 20 (local), Express 4, better-sqlite3 10, node-fetch 3, `node:test` + `node:assert/strict`.

**Spec:** docs/superpowers/specs/2026-09-15-provedor-whatsapp-design.md

## Global Constraints

- Node 16.20.2 em produção (CentOS 7): nada de API que exija Node 18+ (sem `fetch` global, sem `AbortSignal.timeout` em código novo, sem `t.mock` do `node:test`).
- Sem dependências novas no `package.json` (só o script `test`).
- Versões travadas do CLAUDE.md: vite ^4.5.5, better-sqlite3 ^10.1.0, express ^4.21.0, @vitejs/plugin-react ^4.2.1.
- Evolution sem mudança de comportamento: mesmas rotas HTTP, mesmos corpos, mesmos registros em `leads`/`messages` (exceções listadas em "Decisões para validar").
- `whatsapp_instances.provider` default `'evolution'`; instância sem `provider` é tratada como `'evolution'`.
- Commits em português com prefixo `feat:` / `fix:` / `refactor:` / `test:`.
- Sem emojis em código novo (emojis já existentes em textos gravados no banco são movidos como estão; nos testes usar escapes `\u{...}`).
- Toda query nova filtra por conta (`account_id`) ou por uma chave que já pertence a uma conta (id da instância/lead já validado).
- Testes nunca importam `server/db.js` nem módulos que o importam (`leadHandoff.js`, `inboundRuntime.js`, rotas, `scheduler.js`).
- Deploy fora do horário comercial, com plano de volta (`git checkout <commit anterior> && pm2 restart dros-crm`).
- Outro agente trabalha em paralelo no mesmo repositório (plano do Copiloto): antes de cada tarefa rodar `git pull`/`git status` e nunca reverter mudanças que não são desta tarefa.

---

## Decisões para validar (resumo; o detalhe está nas tarefas)

1. **Duas normalizações de telefone continuam existindo** em `normalize.js`: `normalizePhone` (recebimento/dedup, insere o 9) e `normalizeForSend` (envio, só acrescenta 55, igual ao `_normalizePhone` atual). Unificar mudaria o número de envio de telefones com 12 dígitos.
2. **`NormalizedMessage.type`** segue o spec, mas o adaptador Evolution também emite os valores legados `'system'`, `'poll'` e `'view_once'`, porque são gravados hoje em `messages.media_type` e o front usa.
3. **Polling** entra pelo mesmo `handleInboundMessage(..., { source: 'polling' })`, que desvia para `handlePolledMessage` com a lógica atual do polling preservada (não dispara IA, auto-mensagem, parada de follow-up, `notifyAndOpenLead`, foto de perfil, não mexe em `unread_count`; desarquiva o lead; distribuição por `default_attendant_id`/round-robin). O parse passa a ser o mesmo do webhook, com filtro de tipos igual ao atual (só `text`, `image`, `video`, `audio`, `document`, `sticker`). Diferenças aceitas: legenda de imagem/vídeo vira o conteúdo (antes `[Imagem]`), textos editados/botões/mensagens temporárias passam a ser importados, `wa_timestamp` passa a ser ISO (antes número; a coluna só é escrita, nunca lida).
4. **Rota antiga `/evolution/:accountSlug` sem fallback:** instância não encontrada pelo nome devolve **401** e loga (antes caía na primeira instância da conta).
5. **Mídia pelo Chat** usa `sendMediaViaInstance` com as mesmas flags do texto do Chat (`skipTyping`, `skipQuota`, `skipBusinessHours`, `skipLeadCap`, `skipHealthCheck`), ou seja, na prática só o pre-flight roda, como hoje. Resposta não-JSON da Evolution vira envio `failed` gravado (antes 500 sem gravar).
6. **`handleStatusUpdate`** passa a filtrar `messages` por `account_id` (antes buscava só por `wa_msg_id`). O bloco movido do recebimento mantém o `SELECT id FROM messages WHERE wa_msg_id = ?` sem conta, para ser "mover sem alterar".
7. **Health por URL:** a Evolution só é considerada fora do ar quando a requisição à raiz da `api_url` falha (mesma regra de hoje, que ignora o status HTTP); instâncias de uma URL fora do ar são puladas e as de outras URLs continuam sendo checadas.
8. **Download de mídia** (`GET /api/messages/:leadId/media/:msgId`) ganha a checagem de conta que faltava (403) e o fallback `message.instance_id` → `lead.instance_id` → primeira instância conectada da conta, sempre dentro da conta do lead.
9. **Gestão de sessão** (criar/QR/status/logout/delete/restart, GhostDetect, verificação diária, `admin.js`) continua no lugar nesta fase: só existe Evolution. As fases 2/3 precisam filtrar esses pontos por provedor.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `package.json` | Modificar | script `test` (se ainda não existir) |
| `test/helpers/db.js` | Criar | banco `:memory:` com as tabelas usadas pelo fluxo de WhatsApp + seed |
| `test/fixtures/evolution-payloads.js` | Criar | payloads reais da Evolution (webhook e polling) |
| `server/services/whatsapp/normalize.js` | Criar | normalização de telefone BR e JID |
| `server/services/whatsapp/schema.js` | Criar | colunas `provider`, `provider_config`, `webhook_token` + backfill |
| `server/services/whatsapp/webhookToken.js` | Criar | validar/garantir token por instância |
| `server/services/publicUrl.js` | Criar | `PUBLIC_BASE_URL` e montagem das URLs públicas |
| `server/services/whatsapp/evolution.js` | Criar | adaptador Evolution (parse + transporte) |
| `server/services/whatsapp/index.js` | Criar | `getProvider(instance)` |
| `server/services/whatsapp/sender.js` | Criar | anti-ban + `sendViaInstance` + `sendMediaViaInstance` + cache de número + `markMessageAsRead` |
| `server/services/whatsapp/resolveInstance.js` | Criar | instância para download de mídia |
| `server/services/leadIntake.js` | Criar | `getOrCreateLead` e `autoDetectStage` (movidos de `webhooks.js`) |
| `server/services/inboundHandler.js` | Criar | `handleInboundMessage`, `handleStatusUpdate`, `handlePolledMessage` |
| `server/services/inboundRuntime.js` | Criar | liga `leadIntake` e `inboundHandler` às dependências reais |
| `server/services/whatsapp/webhookFlow.js` | Criar | resolver instância do webhook (token/legado) e processar o corpo |
| `server/services/whatsapp/webhookRegistration.js` | Criar | registrar o webhook da instância com a URL nova |
| `server/services/whatsapp/evolutionHealth.js` | Criar | checar se cada `api_url` responde |
| `server/db.js` | Modificar | chamar `migrateWhatsappProviderSchema(db)` |
| `server/services/leadHandoff.js` | Modificar | remover anti-ban/envio e reexportar do `sender` |
| `server/services/deepgramClient.js` | Modificar | `fetchAudioBuffer` via provedor |
| `server/routes/messages.js` | Modificar | mídia via `sendMediaViaInstance`, download via provedor, normalização única |
| `server/routes/leads.js` | Modificar | foto de perfil via provedor |
| `server/routes/webhooks.js` | Modificar | rota nova por token, rota antiga sem fallback, parse+handler |
| `server/routes/integrations.js` | Modificar | `/public-config`, token na criação, registro do webhook novo |
| `server/scheduler.js` | Modificar | health por `api_url`, polling via handler, reregistro com URL nova |
| `src/lib/api.ts` | Modificar | `fetchPublicConfig` |
| `src/pages/Integrations.tsx` | Modificar | URL do Sheets a partir do `public_base_url` |

### Task 1: Infra de testes e normalização de telefone

**Files:**
- Modify: `package.json:6-12` (bloco `scripts`)
- Create: `server/services/whatsapp/normalize.js`
- Test: `test/normalize.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizePhone(p: string|null|undefined): string|null|undefined` — regra de `webhooks.js:30` / `scheduler.js:156`.
  - `normalizeForSend(phone: string|null|undefined): string` — regra de `leadHandoff.js:60`.
  - `phoneCompareKey(p: string): string` — regra de `webhooks.js:42`.
  - `stripJid(jid: string): string`
  - `jidToSendNumber(jid: string): string` — regra de `messages.js:111-114` e `:224-227`.

- [ ] **Step 1: Adicionar o script de teste (idempotente)**

Abrir `package.json`. **Se `scripts.test` ainda não existir** (o plano do Copiloto pode ter criado), acrescentar a linha depois de `"preview"`:

```json
    "preview": "vite preview",
    "test": "node --test test/"
```

Se já existir com `node --test test/`, não mexer. Criar a pasta `test/` se não existir.

- [ ] **Step 2: Escrever o teste que falha**

Criar `test/normalize.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizePhone, normalizeForSend, phoneCompareKey, stripJid, jidToSendNumber,
} from '../server/services/whatsapp/normalize.js'

test('normalizePhone: formatos BR viram 55 + DDD + 9 digitos', () => {
  assert.equal(normalizePhone('5547991351835'), '5547991351835')
  assert.equal(normalizePhone('554791351835'), '5547991351835')
  assert.equal(normalizePhone('47991351835'), '5547991351835')
  assert.equal(normalizePhone('4791351835'), '5547991351835')
  assert.equal(normalizePhone('+55 (47) 99135-1835'), '5547991351835')
})

test('normalizePhone: formato desconhecido volta como digitos, vazio volta igual', () => {
  assert.equal(normalizePhone('123'), '123')
  assert.equal(normalizePhone(''), '')
  assert.equal(normalizePhone(null), null)
  assert.equal(normalizePhone(undefined), undefined)
})

test('normalizeForSend: so acrescenta 55, nao insere o 9 (comportamento atual do envio)', () => {
  assert.equal(normalizeForSend('47991351835'), '5547991351835')
  assert.equal(normalizeForSend('4791351835'), '554791351835')
  assert.equal(normalizeForSend('554791351835'), '554791351835')
  assert.equal(normalizeForSend('5547991351835'), '5547991351835')
  assert.equal(normalizeForSend(''), '')
  assert.equal(normalizeForSend(null), '')
})

test('phoneCompareKey: DDD + 8 digitos finais', () => {
  assert.equal(phoneCompareKey('5547991351835'), '4791351835')
  assert.equal(phoneCompareKey('47991351835'), '4791351835')
  assert.equal(phoneCompareKey('4791351835'), '4791351835')
  assert.equal(phoneCompareKey(''), '')
})

test('stripJid e jidToSendNumber', () => {
  assert.equal(stripJid('5547991351835@s.whatsapp.net'), '5547991351835')
  assert.equal(stripJid('5547991351835@c.us'), '5547991351835')
  assert.equal(stripJid('123456789@lid'), '123456789')
  assert.equal(jidToSendNumber('554791351835@s.whatsapp.net'), '5547991351835')
  assert.equal(jidToSendNumber('47991351835'), '5547991351835')
  assert.equal(jidToSendNumber('123@lid'), '123')
  assert.equal(jidToSendNumber(''), '')
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `Cannot find module` / `ERR_MODULE_NOT_FOUND` para `server/services/whatsapp/normalize.js`.

- [ ] **Step 4: Implementar**

Criar `server/services/whatsapp/normalize.js`:

```js
// Normalizacao de telefone BR usada por todo o fluxo de WhatsApp.
// Antes duplicada em leadHandoff.js:60, webhooks.js:30, scheduler.js:156 e messages.js:111/224.

// Forma canonica de recebimento/dedup: 55 + DDD + 9 digitos (insere o 9 quando falta).
export function normalizePhone(p) {
  if (!p) return p
  p = String(p).replace(/[^\d]/g, '')
  if (p.startsWith('55') && p.length === 13) return p
  if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
  if (!p.startsWith('55') && p.length === 11) return '55' + p
  if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
  return p // formato desconhecido: devolve so os digitos
}

// Forma usada no envio (igual ao antigo _normalizePhone de leadHandoff.js):
// so acrescenta 55 em numeros de 10-11 digitos, NAO insere o 9.
export function normalizeForSend(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')
}

// Chave canonica de comparacao: DDD + 8 digitos finais (sem 55, sem 9 inicial de celular).
export function phoneCompareKey(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d.length === 10 ? d : d.slice(-10)
}

export function stripJid(jid) {
  return String(jid || '').replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '')
}

// JID ou telefone do lead -> numero para envio pelo Chat (messages.js).
export function jidToSendNumber(jid) {
  return normalizePhone(stripJid(jid).replace(/[^\d]/g, ''))
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS em todos os testes de `test/normalize.test.js`.

- [ ] **Step 6: Commit**

```bash
git add package.json test/normalize.test.js server/services/whatsapp/normalize.js
git commit -m "test: infra node:test e normalizacao de telefone unica para o WhatsApp"
```

---

### Task 2: Colunas do provedor e token do webhook por instância

**Files:**
- Create: `test/helpers/db.js`
- Create: `server/services/whatsapp/schema.js`
- Create: `server/services/whatsapp/webhookToken.js`
- Modify: `server/db.js:1-4` (import) e depois da linha `372` (fim do backfill de `warmup_until`)
- Test: `test/whatsappSchema.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `createTestDb({ migrate?: boolean }): Database` e `seedBasic(db, opts?): { account, instance, funnelId, stage1, stage2 }` em `test/helpers/db.js`.
  - `WHATSAPP_PROVIDERS: string[]`, `generateWebhookToken(): string` (32 hex), `migrateWhatsappProviderSchema(db): void` em `schema.js`.
  - `isValidWebhookToken(token: unknown): boolean`, `ensureWebhookToken(db, instance): instanceRow` em `webhookToken.js`.

- [ ] **Step 1: Criar o helper de banco de teste**

Criar `test/helpers/db.js` (colunas espelham as usadas pelo fluxo de WhatsApp em `server/db.js`; sem chaves estrangeiras para simplificar):

```js
import Database from 'better-sqlite3'
import { migrateWhatsappProviderSchema } from '../../server/services/whatsapp/schema.js'

export function createTestDb({ migrate = true } = {}) {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'atendente', is_active INTEGER NOT NULL DEFAULT 1, is_bot INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE funnels (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE funnel_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, funnel_id INTEGER NOT NULL, name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0, auto_keywords TEXT
    );
    CREATE TABLE leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER NOT NULL,
      stage_id INTEGER NOT NULL, attendant_id INTEGER, name TEXT, phone TEXT, source TEXT, source_detail TEXT,
      wa_remote_jid TEXT, instance_id INTEGER, last_instance_id INTEGER,
      is_archived INTEGER NOT NULL DEFAULT 0, archived_at TEXT, has_new_after_archive INTEGER NOT NULL DEFAULT 0,
      is_blocked INTEGER NOT NULL DEFAULT 0, opted_in_at TEXT, ctwa_clid TEXT,
      trabalha_anuncio INTEGER NOT NULL DEFAULT 0, client_ip_address TEXT,
      profile_pic_url TEXT, profile_pic_updated_at TEXT, unread_count INTEGER NOT NULL DEFAULT 0,
      last_inbound_at TEXT, ai_handed_off_at TEXT, is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
      direction TEXT NOT NULL, content TEXT, media_type TEXT DEFAULT 'text', media_url TEXT,
      sender_name TEXT, wa_msg_id TEXT, wa_timestamp TEXT, instance_id INTEGER, sent_by_user_id INTEGER,
      delivery_status TEXT NOT NULL DEFAULT 'sent', delivered_at TEXT, read_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE stage_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, from_stage_id INTEGER,
      to_stage_id INTEGER NOT NULL, trigger_type TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE whatsapp_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, instance_name TEXT NOT NULL,
      api_url TEXT NOT NULL, api_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'disconnected',
      phone_number TEXT, webhook_secret TEXT, default_attendant_id INTEGER,
      lead_intake_mode TEXT NOT NULL DEFAULT 'open', hourly_send_limit INTEGER, daily_send_limit INTEGER,
      warmup_until TEXT, business_hours_json TEXT, lead_daily_msg_cap INTEGER DEFAULT 50,
      paused_at TEXT, paused_reason TEXT, health_check_window_min INTEGER DEFAULT 120,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE lead_instance_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, instance_id INTEGER NOT NULL,
      attendant_id INTEGER, UNIQUE(lead_id, instance_id)
    );
    CREATE TABLE distribution_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, funnel_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'manual', last_assigned_index INTEGER NOT NULL DEFAULT 0,
      active_attendants TEXT, updated_at TEXT
    );
    CREATE TABLE follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, instance_id INTEGER,
      stop_on_reply INTEGER NOT NULL DEFAULT 1, on_reply_action TEXT NOT NULL DEFAULT 'pause',
      on_reply_user_id INTEGER, on_reply_move_to_stage_id INTEGER, on_reply_add_tag_id INTEGER
    );
    CREATE TABLE lead_follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, follow_up_id INTEGER NOT NULL,
      current_step_id INTEGER, status TEXT NOT NULL DEFAULT 'active', next_run_at TEXT,
      paused_at TEXT, paused_reason TEXT, updated_at TEXT
    );
    CREATE TABLE lead_tags (lead_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (lead_id, tag_id));
  `)
  if (migrate) migrateWhatsappProviderSchema(db)
  return db
}

export const TEST_TOKEN = 'a'.repeat(32)

// Conta + funil padrao com 2 etapas + 1 instancia Evolution conectada.
export function seedBasic(db, opts = {}) {
  const accountId = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Conta Teste', 'conta-teste')").run().lastInsertRowid
  const funnelId = db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active) VALUES (?, 'Principal', 1, 1)").run(accountId).lastInsertRowid
  const stage1 = db.prepare("INSERT INTO funnel_stages (funnel_id, name, position) VALUES (?, 'Novo Lead', 0)").run(funnelId).lastInsertRowid
  const stage2 = db.prepare("INSERT INTO funnel_stages (funnel_id, name, position, auto_keywords) VALUES (?, 'Em Atendimento', 1, ?)").run(funnelId, opts.stage2Keywords || null).lastInsertRowid
  const instanceId = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, webhook_token, lead_intake_mode, default_attendant_id)
    VALUES (?, 'inst-teste', 'http://evo.local', 'KEY', 'connected', ?, ?, ?)
  `).run(accountId, TEST_TOKEN, opts.intakeMode || 'open', opts.defaultAttendantId || null).lastInsertRowid
  return {
    account: db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId),
    instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId),
    funnelId, stage1, stage2,
  }
}

export function insertLead(db, fields) {
  const cols = Object.keys(fields)
  const r = db.prepare(`INSERT INTO leads (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => fields[c]))
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lastInsertRowid)
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `test/whatsappSchema.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb } from './helpers/db.js'
import { migrateWhatsappProviderSchema, generateWebhookToken, WHATSAPP_PROVIDERS } from '../server/services/whatsapp/schema.js'
import { isValidWebhookToken, ensureWebhookToken } from '../server/services/whatsapp/webhookToken.js'

function insertLegacyInstance(db, name) {
  db.prepare("INSERT OR IGNORE INTO accounts (id, name, slug) VALUES (1, 'A', 'a')").run()
  return db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key) VALUES (1, ?, 'http://evo', 'k')").run(name).lastInsertRowid
}

test('migracao adiciona provider (default evolution), provider_config e webhook_token nas instancias existentes', () => {
  const db = createTestDb({ migrate: false })
  insertLegacyInstance(db, 'um')
  insertLegacyInstance(db, 'dois')
  migrateWhatsappProviderSchema(db)
  const rows = db.prepare('SELECT * FROM whatsapp_instances ORDER BY id').all()
  assert.equal(rows.length, 2)
  for (const r of rows) {
    assert.equal(r.provider, 'evolution')
    assert.equal(r.provider_config, null)
    assert.match(r.webhook_token, /^[a-f0-9]{32}$/)
  }
  assert.notEqual(rows[0].webhook_token, rows[1].webhook_token)
})

test('migracao e idempotente e nao troca tokens ja gerados', () => {
  const db = createTestDb({ migrate: false })
  insertLegacyInstance(db, 'um')
  migrateWhatsappProviderSchema(db)
  const before = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  migrateWhatsappProviderSchema(db)
  const after = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  assert.equal(after, before)
})

test('instancia nova sem provider recebe evolution', () => {
  const db = createTestDb()
  const id = insertLegacyInstance(db, 'nova')
  assert.equal(db.prepare('SELECT provider FROM whatsapp_instances WHERE id = ?').get(id).provider, 'evolution')
})

test('token unico por indice', () => {
  const db = createTestDb()
  insertLegacyInstance(db, 'x')
  const tok = db.prepare('SELECT webhook_token FROM whatsapp_instances').get().webhook_token
  const id2 = insertLegacyInstance(db, 'y')
  assert.throws(() => db.prepare('UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ?').run(tok, id2), /UNIQUE/)
})

test('generateWebhookToken, isValidWebhookToken e lista de provedores', () => {
  assert.match(generateWebhookToken(), /^[a-f0-9]{32}$/)
  assert.equal(isValidWebhookToken('a'.repeat(32)), true)
  assert.equal(isValidWebhookToken('A'.repeat(32)), false)
  assert.equal(isValidWebhookToken('abc'), false)
  assert.equal(isValidWebhookToken(null), false)
  assert.deepEqual(WHATSAPP_PROVIDERS, ['evolution', 'cloud_api', 'custom'])
})

test('ensureWebhookToken gera token quando falta e preserva quando existe', () => {
  const db = createTestDb()
  const id = insertLegacyInstance(db, 'sem-token')
  db.prepare('UPDATE whatsapp_instances SET webhook_token = NULL WHERE id = ?').run(id)
  const semToken = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
  const comToken = ensureWebhookToken(db, semToken)
  assert.match(comToken.webhook_token, /^[a-f0-9]{32}$/)
  const denovo = ensureWebhookToken(db, comToken)
  assert.equal(denovo.webhook_token, comToken.webhook_token)
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/whatsapp/schema.js`.

- [ ] **Step 4: Implementar `schema.js`**

Criar `server/services/whatsapp/schema.js`:

```js
import crypto from 'crypto'

export const WHATSAPP_PROVIDERS = ['evolution', 'cloud_api', 'custom']

function addColumnIfNotExists(db, table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[DB] Added column ${table}.${column}`)
  }
}

// 32 caracteres hexadecimais (16 bytes aleatorios)
export function generateWebhookToken() {
  return crypto.randomBytes(16).toString('hex')
}

// Colunas do provedor por numero (spec secao 6). Idempotente; roda no boot.
export function migrateWhatsappProviderSchema(db) {
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider', "TEXT NOT NULL DEFAULT 'evolution'")
  addColumnIfNotExists(db, 'whatsapp_instances', 'provider_config', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'webhook_token', 'TEXT')
  const missing = db.prepare("SELECT id FROM whatsapp_instances WHERE webhook_token IS NULL OR webhook_token = ''").all()
  const update = db.prepare('UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ?')
  for (const row of missing) update.run(generateWebhookToken(), row.id)
  if (missing.length > 0) console.log(`[db] migration: webhook_token gerado para ${missing.length} instancias`)
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_instances_webhook_token ON whatsapp_instances(webhook_token)')
}
```

- [ ] **Step 5: Implementar `webhookToken.js`**

Criar `server/services/whatsapp/webhookToken.js`:

```js
import { generateWebhookToken } from './schema.js'

const TOKEN_RE = /^[a-f0-9]{32}$/

export function isValidWebhookToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token)
}

// Garante que a instancia tem webhook_token (instancias criadas antes do boot com a migracao).
export function ensureWebhookToken(db, instance) {
  if (instance.webhook_token) return instance
  db.prepare("UPDATE whatsapp_instances SET webhook_token = ? WHERE id = ? AND (webhook_token IS NULL OR webhook_token = '')")
    .run(generateWebhookToken(), instance.id)
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/whatsappSchema.test.js` e `test/normalize.test.js`.

- [ ] **Step 7: Ligar a migração no boot**

Em `server/db.js`, acrescentar ao bloco de imports do topo (depois da linha 4):

```js
import { migrateWhatsappProviderSchema } from './services/whatsapp/schema.js'
```

E logo depois do `try { ... } catch (e) { console.warn('[db] warmup backfill:', e.message) }` (linha 372), inserir:

```js
// Provedor de WhatsApp por numero: provider (default evolution), provider_config e webhook_token por instancia
migrateWhatsappProviderSchema(db)
```

- [ ] **Step 8: Conferir o boot com o banco local**

Run: `node --input-type=module -e "const m = await import('./server/db.js'); console.log(m.default.prepare('SELECT COUNT(*) n FROM whatsapp_instances WHERE webhook_token IS NULL').get()); process.exit(0)"`
Expected: imprime `{ n: 0 }` (e, na primeira vez, `[DB] Added column whatsapp_instances.provider` etc.).

- [ ] **Step 9: Commit**

```bash
git add test/helpers/db.js test/whatsappSchema.test.js server/services/whatsapp/schema.js server/services/whatsapp/webhookToken.js server/db.js
git commit -m "feat: colunas provider, provider_config e webhook_token por instancia de WhatsApp"
```

---

### Task 3: Domínio público em `PUBLIC_BASE_URL` (backend e front)

**Files:**
- Create: `server/services/publicUrl.js`
- Modify: `server/routes/integrations.js:1-6` (import) e depois da linha `42` (nova rota)
- Modify: `src/lib/api.ts:410` (nova função ao lado de `fetchEvolutionConfig`)
- Modify: `src/pages/Integrations.tsx:52-56` (estado), bloco de `useEffect` de carga, linhas `790`, `791`, `838`
- Test: `test/publicUrl.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `DEFAULT_PUBLIC_BASE_URL = 'https://drosagencia.com.br/crm'`
  - `getPublicBaseUrl(env?: object): string` (sem barra final; lê `env` na hora da chamada, porque o `dotenv.config` do `server/index.js` roda depois dos imports ESM)
  - `buildInstanceWebhookUrl(instance: { webhook_token: string }, env?: object): string` → `<base>/api/webhooks/whatsapp/<token>`; lança `Error('instance_without_webhook_token')` sem token
  - `GET /api/integrations/public-config` → `{ public_base_url: string }`
  - Front: `fetchPublicConfig(): Promise<{ public_base_url: string }>`

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/publicUrl.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PUBLIC_BASE_URL, getPublicBaseUrl, buildInstanceWebhookUrl } from '../server/services/publicUrl.js'

test('getPublicBaseUrl usa o default quando a env nao existe ou esta vazia', () => {
  assert.equal(DEFAULT_PUBLIC_BASE_URL, 'https://drosagencia.com.br/crm')
  assert.equal(getPublicBaseUrl({}), 'https://drosagencia.com.br/crm')
  assert.equal(getPublicBaseUrl({ PUBLIC_BASE_URL: '   ' }), 'https://drosagencia.com.br/crm')
})

test('getPublicBaseUrl respeita a env e tira barras finais', () => {
  assert.equal(getPublicBaseUrl({ PUBLIC_BASE_URL: 'https://crm.cliente.com.br/crm///' }), 'https://crm.cliente.com.br/crm')
})

test('buildInstanceWebhookUrl monta a URL por token', () => {
  const env = { PUBLIC_BASE_URL: 'https://x.com/crm/' }
  assert.equal(buildInstanceWebhookUrl({ webhook_token: 'b'.repeat(32) }, env), `https://x.com/crm/api/webhooks/whatsapp/${'b'.repeat(32)}`)
  assert.throws(() => buildInstanceWebhookUrl({ webhook_token: null }, env), /instance_without_webhook_token/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/publicUrl.js`.

- [ ] **Step 3: Implementar**

Criar `server/services/publicUrl.js`:

```js
// Dominio publico do CRM (antes fixo em integrations.js:68,394, scheduler.js:319 e Integrations.tsx:790,838).
// Le a env na hora da chamada: em ESM os imports rodam antes do dotenv.config do server/index.js.
export const DEFAULT_PUBLIC_BASE_URL = 'https://drosagencia.com.br/crm'

export function getPublicBaseUrl(env = process.env) {
  const raw = String(env.PUBLIC_BASE_URL || '').trim()
  return (raw || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '')
}

export function buildInstanceWebhookUrl(instance, env = process.env) {
  if (!instance || !instance.webhook_token) throw new Error('instance_without_webhook_token')
  return `${getPublicBaseUrl(env)}/api/webhooks/whatsapp/${instance.webhook_token}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/publicUrl.test.js`.

- [ ] **Step 5: Rota `/public-config`**

Em `server/routes/integrations.js`, acrescentar aos imports do topo:

```js
import { getPublicBaseUrl } from '../services/publicUrl.js'
```

E logo depois da rota `router.put('/evolution-config', ...)` (termina na linha 42), inserir:

```js
// ─── Dominio publico do CRM (usado pelo front para montar URLs de webhook) ───
router.get('/public-config', (req, res) => {
  res.json({ public_base_url: getPublicBaseUrl() })
})
```

(A rota fica sob `authenticate` + `scopeToAccount` em `server/index.js:71`; `scopeToAccount` não bloqueia, só define `req.accountId`.)

- [ ] **Step 6: Função no front**

Em `src/lib/api.ts`, logo abaixo da linha 411 (`saveEvolutionConfig`), acrescentar:

```ts
export const fetchPublicConfig = () => apiFetch<{ public_base_url: string }>('/api/integrations/public-config')
```

- [ ] **Step 7: Usar no `Integrations.tsx`**

1. Na lista de imports de `'../lib/api'` (linhas 4-12), acrescentar `fetchPublicConfig,` depois de `apiFetch,`.
2. Depois da linha 55 (`const [scriptCopied, setScriptCopied] = useState(false)`), acrescentar:

```tsx
  const [publicBaseUrl, setPublicBaseUrl] = useState('https://drosagencia.com.br/crm')
  useEffect(() => {
    fetchPublicConfig()
      .then(c => { if (c?.public_base_url) setPublicBaseUrl(c.public_base_url) })
      .catch(() => {})
  }, [])
```

3. Linha 790: trocar `value={`https://drosagencia.com.br/crm/api/webhooks/sheets/${accountSlug}`}` por `value={`${publicBaseUrl}/api/webhooks/sheets/${accountSlug}`}`.
4. Linha 791: trocar `navigator.clipboard.writeText(`https://drosagencia.com.br/crm/api/webhooks/sheets/${accountSlug}`)` por `navigator.clipboard.writeText(`${publicBaseUrl}/api/webhooks/sheets/${accountSlug}`)`.
5. Linha 838 (dentro do template do Apps Script): trocar `const WEBHOOK_URL = 'https://drosagencia.com.br/crm/api/webhooks/sheets/${accountSlug}';` por `const WEBHOOK_URL = '${publicBaseUrl}/api/webhooks/sheets/${accountSlug}';`.

- [ ] **Step 8: Conferir tipos do front**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String "Integrations.tsx|lib/api.ts"`
Expected: nenhuma linha nova de erro citando `publicBaseUrl` ou `fetchPublicConfig` (se o projeto já tiver erros antigos nesses arquivos, rode o mesmo comando antes de editar e compare as listas; não use `git stash`, porque outro agente trabalha no mesmo repositório). Não rodar `npm run build` para commit: `dist/` é gerado no servidor.

Run: `Select-String -Path src/pages/Integrations.tsx -Pattern "drosagencia.com.br/crm/api"`
Expected: nenhuma ocorrência.

- [ ] **Step 9: Commit**

```bash
git add server/services/publicUrl.js test/publicUrl.test.js server/routes/integrations.js src/lib/api.ts src/pages/Integrations.tsx
git commit -m "fix: dominio publico do CRM via PUBLIC_BASE_URL e /api/integrations/public-config"
```

---

### Task 4: Adaptador Evolution — parse do webhook e `getProvider`

**Files:**
- Create: `test/fixtures/evolution-payloads.js`
- Create: `server/services/whatsapp/evolution.js`
- Create: `server/services/whatsapp/index.js`
- Test: `test/evolutionParse.test.js`

**Interfaces:**
- Consumes: `normalizePhone` (Task 1).
- Produces (em `evolution.js`):
  - `EVOLUTION_CAPABILITIES = { qr: true, presence: true, readReceipts: true, numberCheck: true, templates: false, window24h: false, polling: true }`
  - `EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE']`
  - `parseEvolutionRecord(data: object, opts?: { log?: Function|null, instanceName?: string }): NormalizedMessage[]` (0 ou 1 item)
  - `parseEvolutionStatuses(data: object|object[]): NormalizedStatus[]`
  - `createEvolutionAdapter({ fetch }): Adapter` com, nesta tarefa, `name`, `capabilities`, `parseWebhook(instance, body, headers)`, `parsePolledRecord(instance, record)`
  - `evolutionAdapter` (instância com `node-fetch`)
- Produces (em `index.js`): `getProvider(instance): Adapter` (lança `Error('unknown_whatsapp_provider:<nome>')`), `listProviders(): string[]`
- Tipos (spec §4.1):
  - `NormalizedMessage = { phone, remoteId, fromMe, messageId, pushName, timestamp, type, text, mediaRef, adReferral? }` onde `type` ∈ `'text'|'image'|'audio'|'video'|'document'|'sticker'|'location'|'contact'|'reaction'|'unknown'` e, só na Evolution, os legados `'system'|'poll'|'view_once'`; `remoteId` é o JID de dedup (`<phone>@s.whatsapp.net` ou `<id>@lid`); `text` é o conteúdo que vai para `messages.content`; `mediaRef` vai para `messages.media_url`; `adReferral` é o `externalAdReply` (`{ sourceType, sourceUrl, ctwaClid, title, body, ... }`).
  - `NormalizedStatus = { messageId, status: 'sent'|'delivered'|'read'|'failed', timestamp }`

Regra desta tarefa: o parse é cópia de `server/routes/webhooks.js:227-416`, trocando os `return res.json(...)` por `return []` e os `console.log` por `log` (desligável no polling). `webhooks.js` ainda não muda.

- [ ] **Step 1: Criar os payloads reais**

Criar `test/fixtures/evolution-payloads.js`:

```js
// Payloads no formato enviado pela Evolution API v2 (webhook global/instancia), derivados do parse atual.
const base = (data, event = 'messages.upsert') => ({
  event,
  instance: 'inst-teste',
  data,
  destination: 'https://drosagencia.com.br/crm/api/webhooks/evolution/conta-teste',
  date_time: '2025-09-15T08:00:00.000Z',
  sender: '5547900000000@s.whatsapp.net',
  server_url: 'http://127.0.0.1:8080',
  apikey: 'KEY',
})

export const TS = 1757934000 // 2025-09-15T11:00:00.000Z
export const TS_ISO = '2025-09-15T11:00:00.000Z'

export const textConversation = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60001' },
  pushName: 'Maria Silva',
  status: 'DELIVERY_ACK',
  message: { conversation: 'Oi, quero saber o preco', messageContextInfo: { deviceListMetadataVersion: 2 } },
  messageType: 'conversation',
  messageTimestamp: TS,
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  source: 'android',
})

export const extendedText12Digits = base({
  key: { remoteJid: '554791351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60002' },
  pushName: 'Maria Silva',
  message: { extendedTextMessage: { text: 'Vi o site de voces', previewType: 0, contextInfo: { entryPointConversionSource: 'global_search_new_chat' } } },
  messageType: 'extendedTextMessage',
  messageTimestamp: TS,
  source: 'ios',
})

export const audioPtt = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60003' },
  pushName: 'Maria Silva',
  message: {
    audioMessage: {
      url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc',
      mimetype: 'audio/ogg; codecs=opus', fileLength: '12345', seconds: 7, ptt: true,
      mediaKey: 'bWVkaWFrZXk=', fileSha256: 'c2hh', fileEncSha256: 'ZW5j', directPath: '/v/t62.7117-24/audio-0003.enc',
    },
  },
  messageType: 'audioMessage',
  messageTimestamp: TS,
})

export const imageWithCaption = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60004' },
  pushName: 'Maria Silva',
  message: {
    imageMessage: {
      url: 'https://mmg.whatsapp.net/o1/v/t62.7118-24/image-0004.enc',
      mimetype: 'image/jpeg', caption: 'Esse modelo', width: 1080, height: 1350, fileLength: '98765',
    },
  },
  messageType: 'imageMessage',
  messageTimestamp: TS,
})

export const documentPdf = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60005' },
  pushName: 'Maria Silva',
  message: {
    documentMessage: {
      url: 'https://mmg.whatsapp.net/v/t62.7119-24/doc-0005.enc',
      mimetype: 'application/pdf', title: 'orcamento', fileName: 'orcamento.pdf', pageCount: 2, fileLength: '45678',
    },
  },
  messageType: 'documentMessage',
  messageTimestamp: TS,
})

export const reaction = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60006' },
  pushName: 'Maria Silva',
  message: {
    reactionMessage: {
      key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0001' },
      text: '\u{1F44D}', senderTimestampMs: '1757934000123',
    },
  },
  messageType: 'reactionMessage',
  messageTimestamp: TS,
})

export const revoke = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60007' },
  pushName: 'Maria Silva',
  message: { protocolMessage: { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60001' }, type: 'REVOKE' } },
  messageType: 'protocolMessage',
  messageTimestamp: TS,
})

export const ctwaAd = base({
  key: { remoteJid: '5547977776666@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60008' },
  pushName: 'Carla Anuncio',
  message: { extendedTextMessage: { text: 'P9 Ola, vi o anuncio e quero agendar' } },
  contextInfo: {
    externalAdReply: {
      title: 'Pilates experimental', body: 'Agende sua aula', mediaType: 1,
      thumbnailUrl: 'https://scontent.xx.fbcdn.net/thumb.jpg', sourceType: 'ad', sourceId: '120210000000000000',
      sourceUrl: 'https://fb.me/abc123', containsAutoReply: false, renderLargerThumbnail: true,
      showAdAttribution: true, ctwaClid: 'Afc123XYZ',
    },
  },
  messageType: 'extendedTextMessage',
  messageTimestamp: TS,
})

export const lidWithPushName = base({
  key: { remoteJid: '123456789012345@lid', fromMe: false, id: '3EB0A1B2C3D4E5F60009' },
  pushName: 'Joao Lid',
  message: { conversation: 'Bom dia' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const lidWithoutPushName = base({
  key: { remoteJid: '123456789012345@lid', fromMe: false, id: '3EB0A1B2C3D4E5F60010' },
  pushName: '',
  message: { conversation: 'Bom dia' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const lidWithSenderPn = base({
  key: { remoteJid: '987654321098765@lid', senderPn: '5547988887777@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60011' },
  pushName: 'Pedro Pn',
  message: { conversation: 'Tudo bem?' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const groupMessage = base({
  key: { remoteJid: '120363025246125486@g.us', participant: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60012' },
  pushName: 'Maria Silva',
  message: { conversation: 'Mensagem no grupo' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const statusBroadcast = base({
  key: { remoteJid: 'status@broadcast', participant: '5547991351835@s.whatsapp.net', fromMe: false, id: '3EB0A1B2C3D4E5F60013' },
  pushName: 'Maria Silva',
  message: { imageMessage: { url: 'https://mmg.whatsapp.net/status.enc', mimetype: 'image/jpeg' } },
  messageType: 'imageMessage',
  messageTimestamp: TS,
})

export const outboundFromMe = base({
  key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0002' },
  pushName: 'Atendente Loja',
  message: { conversation: 'Segue a proposta' },
  messageType: 'conversation',
  messageTimestamp: TS,
})

export const statusUpdateRead = base({
  keyId: 'BAE5OUTBOUND0001',
  remoteJid: '5547991351835@s.whatsapp.net',
  fromMe: true,
  participant: '5547991351835@s.whatsapp.net',
  status: 'READ',
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  messageId: 'cmf0000000000000000000001',
}, 'messages.update')

export const statusUpdateArrayNumeric = base([
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0001' }, update: { status: 2 } },
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0003' }, update: { status: 1 } },
  { key: { remoteJid: '5547991351835@s.whatsapp.net', fromMe: true, id: 'BAE5OUTBOUND0004' }, update: { status: 0 } },
], 'MESSAGES_UPDATE')

// Registro devolvido por POST /chat/findMessages (polling): mesmo formato do data do upsert.
export const polledRecordText = {
  id: 'cmf0000000000000000000099',
  key: { id: '3EB0POLL00000001', fromMe: false, remoteJid: '5547966665555@s.whatsapp.net' },
  pushName: 'Lia Polling',
  messageType: 'conversation',
  message: { conversation: 'Mensagem perdida' },
  messageTimestamp: TS,
  instanceId: '8f1c2d3e-0000-4000-8000-000000000001',
  source: 'android',
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `test/evolutionParse.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import {
  createEvolutionAdapter, parseEvolutionRecord, parseEvolutionStatuses, EVOLUTION_CAPABILITIES,
} from '../server/services/whatsapp/evolution.js'
import { getProvider, listProviders } from '../server/services/whatsapp/index.js'

const inst = { id: 1, instance_name: 'inst-teste', api_url: 'http://evo.local', api_key: 'KEY', provider: 'evolution' }
const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('fetch nao deveria ser chamado') } })
const quiet = { log: null }
const one = (payload) => {
  const r = adapter.parseWebhook(inst, payload, {})
  assert.equal(r.statuses.length, 0)
  assert.equal(r.messages.length, 1)
  return r.messages[0]
}

test('texto (conversation)', () => {
  assert.deepEqual(one(P.textConversation), {
    phone: '5547991351835', remoteId: '5547991351835@s.whatsapp.net', fromMe: false,
    messageId: '3EB0A1B2C3D4E5F60001', pushName: 'Maria Silva', timestamp: P.TS_ISO,
    type: 'text', text: 'Oi, quero saber o preco', mediaRef: null,
  })
})

test('extendedText com numero de 12 digitos ganha o 9', () => {
  const m = one(P.extendedText12Digits)
  assert.equal(m.phone, '5547991351835')
  assert.equal(m.remoteId, '5547991351835@s.whatsapp.net')
  assert.equal(m.type, 'text')
  assert.equal(m.text, 'Vi o site de voces')
  assert.equal(m.adReferral, undefined)
})

test('audio', () => {
  const m = one(P.audioPtt)
  assert.equal(m.type, 'audio')
  assert.equal(m.text, '[Audio]')
  assert.equal(m.mediaRef, 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc')
})

test('imagem com legenda', () => {
  const m = one(P.imageWithCaption)
  assert.equal(m.type, 'image')
  assert.equal(m.text, 'Esse modelo')
  assert.equal(m.mediaRef, 'https://mmg.whatsapp.net/o1/v/t62.7118-24/image-0004.enc')
})

test('documento usa o nome do arquivo', () => {
  const m = one(P.documentPdf)
  assert.equal(m.type, 'document')
  assert.equal(m.text, 'orcamento.pdf')
})

test('reacao', () => {
  const m = one(P.reaction)
  assert.equal(m.type, 'reaction')
  assert.equal(m.text, '\u{1F44D} (reacao)')
  assert.equal(m.mediaRef, null)
})

test('protocolMessage REVOKE vira system', () => {
  const m = one(P.revoke)
  assert.equal(m.type, 'system')
  assert.equal(m.text, '\u{1F6AB} Mensagem apagada')
})

test('anuncio CTWA traz o externalAdReply do nivel root', () => {
  const m = one(P.ctwaAd)
  assert.equal(m.text, 'P9 Ola, vi o anuncio e quero agendar')
  assert.equal(m.adReferral.ctwaClid, 'Afc123XYZ')
  assert.equal(m.adReferral.sourceType, 'ad')
  assert.equal(m.adReferral.sourceUrl, 'https://fb.me/abc123')
  assert.equal(m.adReferral.title, 'Pilates experimental')
})

test('@lid com pushName usa o LID como identificador', () => {
  const m = one(P.lidWithPushName)
  assert.equal(m.phone, '123456789012345')
  assert.equal(m.remoteId, '123456789012345@lid')
  assert.equal(m.pushName, 'Joao Lid')
})

test('@lid sem pushName e ignorado', () => {
  assert.deepEqual(adapter.parseWebhook(inst, P.lidWithoutPushName, {}), { messages: [], statuses: [] })
})

test('@lid com senderPn usa o telefone real', () => {
  const m = one(P.lidWithSenderPn)
  assert.equal(m.phone, '5547988887777')
  assert.equal(m.remoteId, '5547988887777@s.whatsapp.net')
})

test('grupo e status@broadcast sao filtrados', () => {
  assert.deepEqual(adapter.parseWebhook(inst, P.groupMessage, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, P.statusBroadcast, {}), { messages: [], statuses: [] })
})

test('fromMe', () => {
  const m = one(P.outboundFromMe)
  assert.equal(m.fromMe, true)
  assert.equal(m.pushName, 'Atendente Loja')
})

test('status update (objeto com keyId e string READ)', () => {
  const r = adapter.parseWebhook(inst, P.statusUpdateRead, {})
  assert.equal(r.messages.length, 0)
  assert.equal(r.statuses.length, 1)
  assert.equal(r.statuses[0].messageId, 'BAE5OUTBOUND0001')
  assert.equal(r.statuses[0].status, 'read')
  assert.match(r.statuses[0].timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('status update (array numerico, evento maiusculo): 0 e ignorado', () => {
  const r = parseEvolutionStatuses(P.statusUpdateArrayNumeric.data)
  assert.deepEqual(r.map(s => [s.messageId, s.status]), [['BAE5OUTBOUND0001', 'delivered'], ['BAE5OUTBOUND0003', 'sent']])
  assert.equal(adapter.parseWebhook(inst, P.statusUpdateArrayNumeric, {}).statuses.length, 2)
})

test('evento desconhecido ou sem data nao gera nada', () => {
  assert.deepEqual(adapter.parseWebhook(inst, { event: 'connection.update', data: { state: 'open' } }, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, { event: 'messages.upsert' }, {}), { messages: [], statuses: [] })
  assert.deepEqual(adapter.parseWebhook(inst, {}, {}), { messages: [], statuses: [] })
})

test('tipos extras: localizacao, contato, enquete, visualizacao unica, desconhecido', () => {
  const rec = (message) => parseEvolutionRecord({ key: { remoteJid: '5547991351835@s.whatsapp.net', id: 'X' }, pushName: 'M', message, messageTimestamp: P.TS }, quiet)[0]
  assert.equal(rec({ locationMessage: { degreesLatitude: -26.9, degreesLongitude: -48.6 } }).type, 'location')
  const c = rec({ contactMessage: { displayName: 'Ana', vcard: 'BEGIN:VCARD\nFN:Ana\nTEL;type=CELL;waid=5547911112222:+55 47 91111-2222\nEND:VCARD' } })
  assert.equal(c.type, 'contact')
  assert.equal(c.mediaRef, '5547911112222')
  assert.equal(rec({ pollCreationMessageV3: { name: 'Horario' } }).type, 'poll')
  assert.equal(rec({ viewOnceMessageV2: { message: {} } }).type, 'view_once')
  const u = rec({ newsletterAdminInviteMessage: { newsletterJid: 'x' } })
  assert.equal(u.type, 'unknown')
  assert.equal(u.text, '[newsletterAdminInviteMessage]')
})

test('parsePolledRecord usa o mesmo parse sem log', () => {
  const [m] = adapter.parsePolledRecord(inst, P.polledRecordText)
  assert.equal(m.phone, '5547966665555')
  assert.equal(m.messageId, '3EB0POLL00000001')
  assert.equal(m.text, 'Mensagem perdida')
})

test('capabilities e getProvider', () => {
  assert.deepEqual(adapter.capabilities, EVOLUTION_CAPABILITIES)
  assert.equal(EVOLUTION_CAPABILITIES.polling, true)
  assert.equal(getProvider({ provider: 'evolution' }).name, 'evolution')
  assert.equal(getProvider({}).name, 'evolution')
  assert.equal(getProvider({ provider: null }).name, 'evolution')
  assert.throws(() => getProvider({ provider: 'cloud_api' }), /unknown_whatsapp_provider:cloud_api/)
  assert.deepEqual(listProviders(), ['evolution'])
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/whatsapp/evolution.js`.

- [ ] **Step 4: Implementar o parse em `evolution.js`**

Criar `server/services/whatsapp/evolution.js`:

```js
// Adaptador Evolution API (Baileys). Codigo movido de webhooks.js, leadHandoff.js, messages.js,
// deepgramClient.js, leads.js e scheduler.js SEM mudar as requisicoes nem a interpretacao.
import nodeFetch from 'node-fetch'
import { normalizePhone } from './normalize.js'

export const EVOLUTION_CAPABILITIES = Object.freeze({
  qr: true, presence: true, readReceipts: true, numberCheck: true, templates: false, window24h: false, polling: true,
})

export const EVOLUTION_WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE']

// Evolution v2+ coloca contextInfo.externalAdReply no nivel root (data.contextInfo);
// versoes antigas colocavam dentro de message.<tipo>.contextInfo. Cobre os 2 formatos.
function getCtwaInfo(message, dataRoot) {
  const ctxs = [
    dataRoot?.contextInfo,
    message.extendedTextMessage?.contextInfo,
    message.imageMessage?.contextInfo,
    message.videoMessage?.contextInfo,
    message.audioMessage?.contextInfo,
    message.documentMessage?.contextInfo,
    message.stickerMessage?.contextInfo,
    message.contextInfo,
  ].filter(Boolean)
  for (const ctx of ctxs) {
    const ad = ctx.externalAdReply
    if (ad) return ad
  }
  return null
}

// Um registro Baileys (data do messages.upsert ou item do findMessages) -> 0 ou 1 NormalizedMessage.
// Copia de webhooks.js:229-416.
export function parseEvolutionRecord(data, opts = {}) {
  const log = opts.log === undefined ? console.log : opts.log
  if (!data || typeof data !== 'object') return []

  const remoteJid = data.key?.remoteJid || ''
  const senderPn = data.key?.senderPn || data.senderPn || ''
  const fromMe = data.key?.fromMe || false
  const msgId = data.key?.id || ''
  const pushName = data.pushName || ''
  const timestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString()

  const msg = data.message || {}
  let content = ''
  let mediaType = 'text'
  let mediaUrl = null
  let mediaCaption = ''
  if (msg.conversation) {
    content = msg.conversation
  } else if (msg.extendedTextMessage?.text) {
    content = msg.extendedTextMessage.text
  } else if (msg.imageMessage) {
    mediaType = 'image'; mediaUrl = msg.imageMessage.url || null; mediaCaption = msg.imageMessage.caption || ''; content = mediaCaption || '[Imagem]'
  } else if (msg.videoMessage) {
    mediaType = 'video'; mediaUrl = msg.videoMessage.url || null; mediaCaption = msg.videoMessage.caption || ''; content = mediaCaption || '[Video]'
  } else if (msg.audioMessage) {
    mediaType = 'audio'; mediaUrl = msg.audioMessage.url || null; content = '[Audio]'
  } else if (msg.documentMessage) {
    mediaType = 'document'; mediaUrl = msg.documentMessage.url || null; content = msg.documentMessage.fileName || '[Documento]'
  } else if (msg.stickerMessage) {
    mediaType = 'sticker'; mediaUrl = msg.stickerMessage.url || null; content = '[Sticker]'
  } else if (msg.reactionMessage) {
    // Lead reagiu a uma mensagem com emoji
    const emoji = msg.reactionMessage.text || '❤️'
    content = `${emoji} (reacao)`
    mediaType = 'reaction'
  } else if (msg.locationMessage || msg.liveLocationMessage) {
    // Localizacao compartilhada
    const loc = msg.locationMessage || msg.liveLocationMessage
    const lat = loc.degreesLatitude
    const lng = loc.degreesLongitude
    const name = loc.name || ''
    content = name ? `\u{1F4CD} ${name}` : (lat && lng ? `\u{1F4CD} Localizacao: ${lat}, ${lng}` : '\u{1F4CD} Localizacao compartilhada')
    mediaType = 'location'
  } else if (msg.contactMessage || msg.contactsArrayMessage) {
    // Contato(s) compartilhado(s): nome + telefones do vCard (prefere waid=)
    const contactsRaw = msg.contactsArrayMessage?.contacts?.length
      ? msg.contactsArrayMessage.contacts
      : (msg.contactMessage ? [msg.contactMessage] : [])
    const parsed = contactsRaw.map(c => {
      const name = c?.displayName || ''
      const vcard = c?.vcard || ''
      const phones = []
      vcard.split(/\r?\n/).forEach(line => {
        if (!/^TEL/i.test(line)) return
        const waidMatch = line.match(/waid=(\d+)/i)
        if (waidMatch) { phones.push(waidMatch[1]); return }
        const afterColon = line.split(':').slice(1).join(':').trim()
        const digits = afterColon.replace(/\D/g, '')
        if (digits) phones.push(digits)
      })
      return { name, phones: [...new Set(phones)] }
    }).filter(p => p.name || p.phones.length > 0)

    mediaType = 'contact'
    if (parsed.length === 0) {
      content = '\u{1F464} Contato compartilhado'
    } else if (parsed.length === 1) {
      const c = parsed[0]
      const phoneStr = c.phones[0] || ''
      content = phoneStr
        ? `\u{1F464} ${c.name || 'Contato'} — ${phoneStr}`
        : `\u{1F464} Contato: ${c.name}`
      mediaUrl = phoneStr || null
    } else {
      const parts = parsed.map(c => c.phones[0] ? `${c.name || 'Contato'} (${c.phones[0]})` : (c.name || 'Contato'))
      content = `\u{1F464} ${parsed.length} contatos: ${parts.join(' | ')}`
      mediaUrl = parsed.find(p => p.phones[0])?.phones[0] || null
    }
  } else if (msg.protocolMessage?.type === 0 || msg.protocolMessage?.type === 'REVOKE') {
    content = '\u{1F6AB} Mensagem apagada'
    mediaType = 'system'
  } else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) {
    const poll = msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3
    content = poll?.name ? `\u{1F4CA} Enquete: ${poll.name}` : '\u{1F4CA} Enquete'
    mediaType = 'poll'
  } else if (msg.pollUpdateMessage) {
    content = '\u{1F4CA} Voto em enquete'
    mediaType = 'poll'
  } else if (msg.editedMessage || msg.protocolMessage?.editedMessage) {
    const edited = msg.editedMessage || msg.protocolMessage?.editedMessage
    const newText = edited?.message?.conversation || edited?.message?.extendedTextMessage?.text || ''
    content = newText ? `✏️ ${newText}` : '✏️ Mensagem editada'
  } else if (msg.buttonsResponseMessage) {
    content = msg.buttonsResponseMessage.selectedDisplayText || msg.buttonsResponseMessage.selectedButtonId || '[Botao clicado]'
  } else if (msg.listResponseMessage) {
    content = msg.listResponseMessage.title || msg.listResponseMessage.singleSelectReply?.selectedRowId || '[Opcao selecionada]'
  } else if (msg.templateButtonReplyMessage) {
    content = msg.templateButtonReplyMessage.selectedDisplayText || '[Botao de template]'
  } else if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) {
    content = '\u{1F441}️ Mensagem de visualizacao unica'
    mediaType = 'view_once'
  } else if (msg.ephemeralMessage) {
    const inner = msg.ephemeralMessage.message || {}
    if (inner.conversation) content = inner.conversation
    else if (inner.extendedTextMessage?.text) content = inner.extendedTextMessage.text
    else content = '⏱️ Mensagem temporaria'
  }
  if (!content && Object.keys(msg).length > 0) {
    const tipo = Object.keys(msg).filter(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage')[0] || 'desconhecido'
    if (log) log(`[Webhook] Tipo de mensagem nao tratado: ${tipo}`, JSON.stringify(msg).substring(0, 200))
    content = `[${tipo}]`
    mediaType = 'unknown'
  }

  const adInfo = getCtwaInfo(msg, data)

  // DEBUG TEMPORARIO herdado de webhooks.js:387-391 (agora identifica a instancia em vez do slug)
  if (log && !fromMe && (adInfo || (content && content.startsWith('P9')))) {
    log(`[CTWA DEBUG] instance=${opts.instanceName || '?'} content="${(content || '').substring(0, 60)}" adInfo=${JSON.stringify(adInfo)} dataContextInfo=${JSON.stringify(data.contextInfo || null)} msgKeys=${Object.keys(msg).slice(0, 8).join(',')}`)
  }

  // Ignora grupos, status e listas de transmissao
  if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('status@')) {
    return []
  }

  // Prefere senderPn (telefone real) ao remoteJid (pode ser @lid)
  const realJid = senderPn || remoteJid
  let phone = ''
  let dedupJid = ''
  if (senderPn) {
    phone = normalizePhone(senderPn.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
    dedupJid = `${phone}@s.whatsapp.net`
  } else if (realJid.endsWith('@lid')) {
    if (!pushName) return []
    phone = realJid.replace('@lid', '')
    dedupJid = realJid
  } else {
    phone = normalizePhone(realJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
    dedupJid = `${phone}@s.whatsapp.net`
  }
  if (!phone) return []

  const normalized = {
    phone,
    remoteId: dedupJid,
    fromMe: !!fromMe,
    messageId: msgId,
    pushName,
    timestamp,
    type: mediaType,
    text: content,
    mediaRef: mediaUrl,
  }
  if (adInfo) normalized.adReferral = adInfo
  return [normalized]
}

// messages.update: 1=SERVER_ACK(sent), 2=DELIVERY_ACK(delivered), 3=READ, 4=PLAYED. Copia de webhooks.js:199-210.
export function parseEvolutionStatuses(data) {
  const rawUpdates = data ? (Array.isArray(data) ? data : [data]) : []
  const out = []
  for (const upd of rawUpdates) {
    const waMsgId = upd?.key?.id || upd?.keyId
    if (!waMsgId) continue
    const statusRaw = upd.status ?? upd.update?.status
    let status = null
    if (statusRaw === 'DELIVERY_ACK' || statusRaw === 2) status = 'delivered'
    else if (statusRaw === 'READ' || statusRaw === 'PLAYED' || statusRaw === 3 || statusRaw === 4) status = 'read'
    else if (statusRaw === 'SERVER_ACK' || statusRaw === 1) status = 'sent'
    if (!status) continue
    out.push({ messageId: waMsgId, status, timestamp: new Date().toISOString() })
  }
  return out
}

export function createEvolutionAdapter({ fetch }) {
  return {
    name: 'evolution',
    capabilities: EVOLUTION_CAPABILITIES,

    parseWebhook(instance, body) {
      const event = body?.event
      const data = body?.data
      if (event === 'messages.update' || event === 'MESSAGES_UPDATE') {
        return { messages: [], statuses: parseEvolutionStatuses(data) }
      }
      if (event !== 'messages.upsert' || !data) return { messages: [], statuses: [] }
      return { messages: parseEvolutionRecord(data, { instanceName: instance?.instance_name }), statuses: [] }
    },

    parsePolledRecord(instance, record) {
      return parseEvolutionRecord(record, { log: null })
    },
  }
}

export const evolutionAdapter = createEvolutionAdapter({ fetch: nodeFetch })
```

Nota para quem executa: os textos com emoji acima estão escritos com escapes `\u{...}`; confira cada um contra as linhas 256-340 de `server/routes/webhooks.js` (por exemplo, `'❤️'` = `'❤️'`, `'📍'` = `'\u{1F4CD}'`, `'👤'` = `'\u{1F464}'`, `'—'` = `'—'`, `'🚫'` = `'\u{1F6AB}'`, `'📊'` = `'\u{1F4CA}'`, `'✏️'` = `'✏️'`, `'👁️'` = `'\u{1F441}️'`, `'⏱️'` = `'⏱️'`). O valor gravado no banco precisa ser o mesmo byte a byte. O parâmetro `fetch` do factory só passa a ser usado na Task 5.

- [ ] **Step 5: Implementar `index.js`**

Criar `server/services/whatsapp/index.js`:

```js
// A "tomada": escolhe o adaptador pelo provider da instancia. Sem provider = evolution.
import { evolutionAdapter } from './evolution.js'

const registry = new Map([
  ['evolution', evolutionAdapter],
])

export function getProvider(instance) {
  const name = (instance && instance.provider) || 'evolution'
  const adapter = registry.get(name)
  if (!adapter) throw new Error(`unknown_whatsapp_provider:${name}`)
  return adapter
}

export function listProviders() {
  return [...registry.keys()]
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/evolutionParse.test.js` (e nos anteriores).

- [ ] **Step 7: Commit**

```bash
git add test/fixtures/evolution-payloads.js test/evolutionParse.test.js server/services/whatsapp/evolution.js server/services/whatsapp/index.js
git commit -m "feat: adaptador Evolution com parse do webhook normalizado e getProvider"
```

---

### Task 5: Adaptador Evolution — transporte (envio, presença, número, leitura, mídia, foto, webhook, polling)

**Files:**
- Modify: `server/services/whatsapp/evolution.js` (substituir a função `createEvolutionAdapter` inteira)
- Test: `test/evolutionTransport.test.js`

**Interfaces:**
- Consumes: `normalizeForSend` (Task 1), `EVOLUTION_CAPABILITIES`, `EVOLUTION_WEBHOOK_EVENTS`, `parseEvolutionRecord`, `parseEvolutionStatuses` (Task 4).
- Produces (métodos do adaptador; `phone` já chega normalizado pelo chamador):
  - `sendText(instance, phone, text): Promise<{ ok, messageId, reason?, raw? }>` — copia `leadHandoff.js:434-452`
  - `sendMedia(instance, phone, { type, base64?, url?, mimetype, fileName, caption }): Promise<{ ok, messageId, reason?, raw? }>` — copia `messages.js:242-264`
  - `sendPresence(instance, phone, state): Promise<{ ok }>` — copia `leadHandoff.js:226-237`
  - `checkNumber(instance, phones: string[], { timeoutMs?, matchByNumber? }): Promise<{ [phone]: true|false|null }>` — lança em erro de rede/timeout; `!res.ok` ou resposta não-array devolve tudo `null` — copia `leadHandoff.js:262-289` (único) e `:321-357` (lista, `matchByNumber: true`)
  - `markRead(instance, lead, messageId): Promise<{ ok }>` — corrige `leadHandoff.js:137` usando `lead.wa_remote_jid`
  - `fetchMedia(instance, message: { wa_msg_id }): Promise<{ buffer: Buffer, mimetype: string|null }>` — lança `Error('evolution_no_base64 (status=N)')` com `code = 'media_not_found'` quando não há base64
  - `fetchProfilePictureUrl(instance, phone): Promise<string|null>` — copia `webhooks.js:17-25` / `leads.js:662-668`
  - `registerWebhook(instance, url, events = EVOLUTION_WEBHOOK_EVENTS): Promise<void>`
  - `fetchRecentMessages(instance, { limit? }): Promise<object[]|null>` — copia `scheduler.js:169-177`; `null` quando `!r.ok` ou não é array

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/evolutionTransport.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEvolutionAdapter, EVOLUTION_WEBHOOK_EVENTS } from '../server/services/whatsapp/evolution.js'

const inst = { id: 1, instance_name: 'inst-teste', api_url: 'http://evo.local', api_key: 'KEY' }

function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined })
    const r = await responder(url, init, calls.length)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => { if (r.bodyText !== undefined) return JSON.parse(r.bodyText); return r.json },
    }
  }
  fn.calls = calls
  return fn
}

test('sendText: rota, headers e corpo iguais ao codigo atual; sucesso devolve messageId', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'WAMSG1' }, status: 'PENDING' } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendText(inst, '5547991351835', 'Ola')
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendText/inst-teste')
  assert.equal(f.calls[0].init.method, 'POST')
  assert.deepEqual(f.calls[0].init.headers, { 'Content-Type': 'application/json', apikey: 'KEY' })
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', text: 'Ola' })
  assert.equal(r.ok, true)
  assert.equal(r.messageId, 'WAMSG1')
  assert.deepEqual(r.raw, { key: { id: 'WAMSG1' }, status: 'PENDING' })
})

test('sendText: recusa com exists=false vira number_not_on_whatsapp', async () => {
  const f = fakeFetch(() => ({ status: 400, json: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: 'x', number: '5547' }] } } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendText(inst, '5547', 'Ola')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'number_not_on_whatsapp')
  assert.ok(r.raw)
})

test('sendText: erro sem corpo JSON vira http_<status>; excecao vira mensagem', async () => {
  const f1 = fakeFetch(() => ({ status: 502, bodyText: '<html>' }))
  const r1 = await createEvolutionAdapter({ fetch: f1 }).sendText(inst, '1', 'x')
  assert.equal(r1.reason, 'http_502')
  const f2 = fakeFetch(() => new Error('ECONNREFUSED'))
  const r2 = await createEvolutionAdapter({ fetch: f2 }).sendText(inst, '1', 'x')
  assert.deepEqual(r2, { ok: false, messageId: null, reason: 'ECONNREFUSED' })
})

test('sendMedia: audio usa sendWhatsAppAudio com encoding', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'AUD1' } } }))
  const r = await createEvolutionAdapter({ fetch: f }).sendMedia({ ...inst, instance_name: 'inst teste' }, '5547991351835', { type: 'audio', base64: 'QUJD', mimetype: 'audio/ogg', fileName: 'a.ogg' })
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendWhatsAppAudio/inst%20teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', audio: 'QUJD', encoding: true })
  assert.equal(r.messageId, 'AUD1')
})

test('sendMedia: imagem usa sendMedia; caption vazia nao vai no corpo', async () => {
  const f = fakeFetch(() => ({ json: { key: { id: 'IMG1' } } }))
  await createEvolutionAdapter({ fetch: f }).sendMedia(inst, '5547991351835', { type: 'image', base64: 'QUJD', mimetype: 'image/png', fileName: 'foto.png', caption: '' })
  assert.equal(f.calls[0].url, 'http://evo.local/message/sendMedia/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', mediatype: 'image', media: 'QUJD', mimetype: 'image/png', fileName: 'foto.png' })
})

test('sendPresence', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  const r = await createEvolutionAdapter({ fetch: f }).sendPresence(inst, '5547991351835', 'composing')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/sendPresence/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835', presence: 'composing', delay: 100 })
  assert.ok(f.calls[0].init.signal)
  assert.deepEqual(r, { ok: true })
  const r2 = await createEvolutionAdapter({ fetch: fakeFetch(() => new Error('x')) }).sendPresence(inst, '1', 'paused')
  assert.deepEqual(r2, { ok: false })
})

test('checkNumber: numero unico usa data[0].exists', async () => {
  const f = fakeFetch(() => ({ json: [{ exists: false, jid: '5547@s.whatsapp.net', number: '9999' }] }))
  const r = await createEvolutionAdapter({ fetch: f }).checkNumber(inst, ['5547991351835'])
  assert.equal(f.calls[0].url, 'http://evo.local/chat/whatsappNumbers/inst-teste')
  assert.deepEqual(f.calls[0].body, { numbers: ['5547991351835'] })
  assert.deepEqual(r, { '5547991351835': false })
})

test('checkNumber: lista casa por number; ausente fica null', async () => {
  const f = fakeFetch(() => ({ json: [{ exists: true, number: '5547991351835' }, { exists: false, number: '+55 47 98888-7777' }] }))
  const r = await createEvolutionAdapter({ fetch: f }).checkNumber(inst, ['5547991351835', '5547988887777', '5547900000000'], { matchByNumber: true })
  assert.deepEqual(r, { '5547991351835': true, '5547988887777': false, '5547900000000': null })
})

test('checkNumber: http erro ou corpo nao-array -> tudo null; erro de rede lanca', async () => {
  const a = createEvolutionAdapter({ fetch: fakeFetch(() => ({ status: 500, json: {} })) })
  assert.deepEqual(await a.checkNumber(inst, ['1', '2'], { matchByNumber: true }), { 1: null, 2: null })
  const b = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { error: 'x' } })) })
  assert.deepEqual(await b.checkNumber(inst, ['1']), { 1: null })
  const c = createEvolutionAdapter({ fetch: fakeFetch(() => new Error('timeout')) })
  await assert.rejects(() => c.checkNumber(inst, ['1']), /timeout/)
})

test('markRead usa leads.wa_remote_jid (corrige coluna inexistente em messages)', async () => {
  const f = fakeFetch(() => ({ json: { message: 'Read messages', read: 'success' } }))
  const r = await createEvolutionAdapter({ fetch: f }).markRead(inst, { id: 9, phone: '5547991351835', wa_remote_jid: '123456789012345@lid' }, 'MSG9')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/markMessageAsRead/inst-teste')
  assert.deepEqual(f.calls[0].body, { read_messages: [{ remoteJid: '123456789012345@lid', fromMe: false, id: 'MSG9' }] })
  assert.deepEqual(r, { ok: true })
})

test('markRead sem wa_remote_jid monta o JID pelo telefone; sem nada nao chama', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  const a = createEvolutionAdapter({ fetch: f })
  await a.markRead(inst, { phone: '47991351835', wa_remote_jid: null }, 'M1')
  assert.equal(f.calls[0].body.read_messages[0].remoteJid, '5547991351835@s.whatsapp.net')
  assert.deepEqual(await a.markRead(inst, { phone: null, wa_remote_jid: null }, 'M2'), { ok: false })
  assert.equal(f.calls.length, 1)
})

test('fetchMedia devolve buffer e mimetype; sem base64 lanca media_not_found', async () => {
  const f = fakeFetch(() => ({ json: { base64: Buffer.from('ola').toString('base64'), mimetype: 'audio/ogg; codecs=opus' } }))
  const r = await createEvolutionAdapter({ fetch: f }).fetchMedia(inst, { wa_msg_id: 'AUD9' })
  assert.equal(f.calls[0].url, 'http://evo.local/chat/getBase64FromMediaMessage/inst-teste')
  assert.deepEqual(f.calls[0].body, { message: { key: { id: 'AUD9' } }, convertToMp4: false })
  assert.equal(r.buffer.toString(), 'ola')
  assert.equal(r.mimetype, 'audio/ogg; codecs=opus')
  const g = fakeFetch(() => ({ status: 404, json: { error: 'not found' } }))
  await assert.rejects(() => createEvolutionAdapter({ fetch: g }).fetchMedia(inst, { wa_msg_id: 'X' }), (e) => e.code === 'media_not_found' && /evolution_no_base64 \(status=404\)/.test(e.message))
})

test('fetchProfilePictureUrl', async () => {
  const f = fakeFetch(() => ({ json: { wuid: 'x', profilePictureUrl: 'https://pps.whatsapp.net/p.jpg' } }))
  const url = await createEvolutionAdapter({ fetch: f }).fetchProfilePictureUrl(inst, '5547991351835')
  assert.equal(f.calls[0].url, 'http://evo.local/chat/fetchProfilePictureUrl/inst-teste')
  assert.deepEqual(f.calls[0].body, { number: '5547991351835' })
  assert.equal(url, 'https://pps.whatsapp.net/p.jpg')
  const g = fakeFetch(() => ({ json: {} }))
  assert.equal(await createEvolutionAdapter({ fetch: g }).fetchProfilePictureUrl(inst, '1'), null)
})

test('registerWebhook assina MESSAGES_UPSERT e MESSAGES_UPDATE', async () => {
  const f = fakeFetch(() => ({ json: {} }))
  await createEvolutionAdapter({ fetch: f }).registerWebhook({ ...inst, instance_name: 'inst teste' }, 'https://x/crm/api/webhooks/whatsapp/tok')
  assert.deepEqual(EVOLUTION_WEBHOOK_EVENTS, ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'])
  assert.equal(f.calls[0].url, 'http://evo.local/webhook/set/inst%20teste')
  assert.deepEqual(f.calls[0].body, { webhook: { url: 'https://x/crm/api/webhooks/whatsapp/tok', enabled: true, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] } })
})

test('fetchRecentMessages aceita os 3 formatos de resposta', async () => {
  const rec = { key: { id: 'A', remoteJid: '1@s.whatsapp.net' } }
  const a = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { messages: { total: 1, records: [rec] } } })) })
  assert.deepEqual(await a.fetchRecentMessages(inst), [rec])
  const b = createEvolutionAdapter({ fetch: fakeFetch(() => ({ json: { messages: [rec] } })) })
  assert.deepEqual(await b.fetchRecentMessages(inst), [rec])
  const f = fakeFetch(() => ({ json: [rec] }))
  assert.deepEqual(await createEvolutionAdapter({ fetch: f }).fetchRecentMessages(inst, { limit: 200 }), [rec])
  assert.equal(f.calls[0].url, 'http://evo.local/chat/findMessages/inst-teste')
  assert.deepEqual(f.calls[0].body, { where: {}, limit: 200 })
  const c = createEvolutionAdapter({ fetch: fakeFetch(() => ({ status: 500, json: {} })) })
  assert.equal(await c.fetchRecentMessages(inst), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `TypeError: ... .sendText is not a function` (e similares) em `test/evolutionTransport.test.js`.

- [ ] **Step 3: Implementar**

Em `server/services/whatsapp/evolution.js`:

1. Trocar o import de normalização por:

```js
import { normalizePhone, normalizeForSend } from './normalize.js'
```

2. Acrescentar, antes de `createEvolutionAdapter`:

```js
const jsonHeaders = (instance) => ({ 'Content-Type': 'application/json', apikey: instance.api_key })

// Interpretacao da resposta de envio (leadHandoff.js:442-449)
function interpretSendResponse(res, data) {
  if (!data?.key?.id) {
    const reason = data?.response?.message?.[0]?.exists === false
      ? 'number_not_on_whatsapp'
      : (data?.error || data?.message || `http_${res.status}`)
    return { ok: false, messageId: null, reason: String(reason).substring(0, 200), raw: data }
  }
  return { ok: true, messageId: data.key.id, raw: data }
}
```

3. Substituir a função `createEvolutionAdapter` inteira por:

```js
export function createEvolutionAdapter({ fetch }) {
  return {
    name: 'evolution',
    capabilities: EVOLUTION_CAPABILITIES,

    async sendText(instance, phone, text) {
      try {
        const res = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
          method: 'POST',
          headers: jsonHeaders(instance),
          body: JSON.stringify({ number: phone, text }),
        })
        const data = await res.json().catch(() => ({}))
        return interpretSendResponse(res, data)
      } catch (e) {
        return { ok: false, messageId: null, reason: e.message }
      }
    },

    async sendMedia(instance, phone, media) {
      const { type, base64, url, mimetype, fileName, caption } = media
      const name = encodeURIComponent(instance.instance_name)
      let endpoint, payload
      if (type === 'audio') {
        endpoint = `${instance.api_url}/message/sendWhatsAppAudio/${name}`
        payload = { number: phone, audio: base64 || url, encoding: true }
      } else {
        endpoint = `${instance.api_url}/message/sendMedia/${name}`
        payload = { number: phone, mediatype: type, media: base64 || url, mimetype, fileName, caption: caption || undefined }
      }
      try {
        const res = await fetch(endpoint, { method: 'POST', headers: jsonHeaders(instance), body: JSON.stringify(payload) })
        const data = await res.json().catch(() => ({}))
        return interpretSendResponse(res, data)
      } catch (e) {
        return { ok: false, messageId: null, reason: e.message }
      }
    },

    async sendPresence(instance, phone, state) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      try {
        const res = await fetch(`${instance.api_url}/chat/sendPresence/${instance.instance_name}`, {
          method: 'POST',
          headers: jsonHeaders(instance),
          body: JSON.stringify({ number: phone, presence: state, delay: 100 }),
          signal: controller.signal,
        })
        return { ok: !!res.ok }
      } catch {
        return { ok: false }
      } finally {
        clearTimeout(timer)
      }
    },

    // Lanca em erro de rede/timeout (o chamador nao cacheia). HTTP != 2xx ou corpo invalido -> tudo null.
    async checkNumber(instance, phones, opts = {}) {
      const timeoutMs = opts.timeoutMs || 3000
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      let res
      try {
        res = await fetch(`${instance.api_url}/chat/whatsappNumbers/${instance.instance_name}`, {
          method: 'POST',
          headers: jsonHeaders(instance),
          body: JSON.stringify({ numbers: phones }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      const out = {}
      for (const p of phones) out[p] = null
      if (!res.ok) return out
      const data = await res.json().catch(() => null)
      if (!Array.isArray(data)) return out
      if (!opts.matchByNumber) {
        if (data.length > 0 && phones.length > 0) out[phones[0]] = !!data[0].exists
        return out
      }
      const byNumber = new Map()
      for (const item of data) {
        const num = String(item.number || '').replace(/[^\d]/g, '')
        if (num) byNumber.set(num, !!item.exists)
      }
      for (const p of phones) if (byNumber.has(p)) out[p] = byNumber.get(p)
      return out
    },

    async markRead(instance, lead, messageId) {
      const remoteJid = lead?.wa_remote_jid || (lead?.phone ? `${normalizeForSend(lead.phone)}@s.whatsapp.net` : null)
      if (!remoteJid || !messageId) return { ok: false }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      try {
        const res = await fetch(`${instance.api_url}/chat/markMessageAsRead/${instance.instance_name}`, {
          method: 'POST',
          headers: jsonHeaders(instance),
          body: JSON.stringify({ read_messages: [{ remoteJid, fromMe: false, id: messageId }] }),
          signal: controller.signal,
        })
        return { ok: !!res.ok }
      } catch {
        return { ok: false }
      } finally {
        clearTimeout(timer)
      }
    },

    async fetchMedia(instance, message) {
      const res = await fetch(`${instance.api_url}/chat/getBase64FromMediaMessage/${instance.instance_name}`, {
        method: 'POST',
        headers: jsonHeaders(instance),
        body: JSON.stringify({ message: { key: { id: message.wa_msg_id } }, convertToMp4: false }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data?.base64) {
        const err = new Error(`evolution_no_base64 (status=${res.status})`)
        err.code = 'media_not_found'
        throw err
      }
      return { buffer: Buffer.from(data.base64, 'base64'), mimetype: data.mimetype || null }
    },

    async fetchProfilePictureUrl(instance, phone) {
      const r = await fetch(`${instance.api_url}/chat/fetchProfilePictureUrl/${instance.instance_name}`, {
        method: 'POST',
        headers: jsonHeaders(instance),
        body: JSON.stringify({ number: phone }),
      })
      const data = await r.json()
      return data?.profilePictureUrl || null
    },

    async registerWebhook(instance, url, events = EVOLUTION_WEBHOOK_EVENTS) {
      await fetch(`${instance.api_url}/webhook/set/${encodeURIComponent(instance.instance_name)}`, {
        method: 'POST',
        headers: jsonHeaders(instance),
        body: JSON.stringify({ webhook: { url, enabled: true, events } }),
      })
    },

    async fetchRecentMessages(instance, opts = {}) {
      const r = await fetch(`${instance.api_url}/chat/findMessages/${encodeURIComponent(instance.instance_name)}`, {
        method: 'POST',
        headers: jsonHeaders(instance),
        body: JSON.stringify({ where: {}, limit: opts.limit || 200 }),
      })
      if (!r.ok) return null
      const data = await r.json()
      const messages = data?.messages?.records || data?.messages || data || []
      return Array.isArray(messages) ? messages : null
    },

    parseWebhook(instance, body) {
      const event = body?.event
      const data = body?.data
      if (event === 'messages.update' || event === 'MESSAGES_UPDATE') {
        return { messages: [], statuses: parseEvolutionStatuses(data) }
      }
      if (event !== 'messages.upsert' || !data) return { messages: [], statuses: [] }
      return { messages: parseEvolutionRecord(data, { instanceName: instance?.instance_name }), statuses: [] }
    },

    parsePolledRecord(instance, record) {
      return parseEvolutionRecord(record, { log: null })
    },
  }
}
```

Notas: os `encodeURIComponent` aparecem exatamente onde o código atual já usa (mídia, webhook/set, findMessages) e não aparecem onde o código atual não usa (sendText, presença, número, leitura, mídia recebida, foto), para não mudar URL de nenhuma instância. A opção `timeout` do `node-fetch` usada hoje em `deepgramClient.js` não existe na v3 (é ignorada), por isso não é repassada.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/evolutionTransport.test.js` e `test/evolutionParse.test.js`.

- [ ] **Step 5: Commit**

```bash
git add server/services/whatsapp/evolution.js test/evolutionTransport.test.js
git commit -m "feat: adaptador Evolution com envio, presenca, numero, leitura, midia e webhook"
```

---

### Task 6: Envio com anti-ban pela tomada (`sender.js`) e `leadHandoff.js` delegando

**Files:**
- Create: `server/services/whatsapp/sender.js`
- Modify: `server/services/leadHandoff.js:7-8` (imports) e `:37-453` (remover e reexportar)
- Test: `test/sender.test.js`

**Interfaces:**
- Consumes: `normalizeForSend` (Task 1); `getProvider(instance)` e o contrato de adaptador (Tasks 4-5).
- Produces:
  - `LEAD_DAILY_CAP_DEFAULT = 50`
  - `createSender({ db, getProvider, sleep?, random?, now?, nowMs? })` → objeto com:
    - `sendViaInstance(instance, phone, text, opts?): Promise<{ ok, wamsgId?, reason?, validationFailed?, raw? }>` (mesmas `opts` de hoje: `leadId`, `skipValidation`, `skipTyping`, `skipQuota`, `skipBusinessHours`, `skipLeadCap`, `skipHealthCheck`)
    - `sendMediaViaInstance(instance, phone, media: { type, base64?, url?, mimetype, fileName, caption? }, opts?)`: mesmo retorno
    - `checkWhatsAppNumber(instance, phone): Promise<true|false|null>`
    - `checkWhatsAppNumbersBulk(instance, phones): Promise<Map<string, true|false|null>>`
    - `markMessageAsRead(instance, lead): Promise<void>`
    - `isInBusinessHours(instance, at?: Date): boolean`, `checkLeadCap(instance, leadId)`, `checkInstanceHealth(instance)`, `checkSendQuota(instance)` (expostos para teste)
  - `leadHandoff.js` continua exportando `sendViaInstance`, `checkWhatsAppNumber`, `checkWhatsAppNumbersBulk`, `markMessageAsRead` (mesmos nomes para `broadcasts.js`, `autoMessages.js`, `aiAgent.js`, `followUpSender.js`, `messages.js`) e passa a exportar `sendMediaViaInstance`.

Comportamento: ordem das checagens igual a `leadHandoff.js:381-432` (telefone → pausa → horário → cap por lead → saúde → pre-flight → quota → digitando → envio). Mudanças: pre-flight só se `capabilities.numberCheck`; "digitando" só se `capabilities.presence`; cap default 50 (era 5, e o banco já usa 50); `markMessageAsRead` busca só `wa_msg_id` (a coluna `wa_remote_jid` não existe em `messages`) e o JID vem do lead no adaptador.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/sender.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createSender, LEAD_DAILY_CAP_DEFAULT } from '../server/services/whatsapp/sender.js'

function fakeProvider(overrides = {}) {
  const calls = { sendText: [], sendMedia: [], checkNumber: [], sendPresence: [], markRead: [] }
  const p = {
    name: 'fake',
    capabilities: { numberCheck: true, presence: true, ...(overrides.capabilities || {}) },
    async sendText(i, phone, text) { calls.sendText.push([phone, text]); return overrides.sendTextResult || { ok: true, messageId: 'WA1', raw: { key: { id: 'WA1' } } } },
    async sendMedia(i, phone, media) { calls.sendMedia.push([phone, media]); return { ok: true, messageId: 'WAM1', raw: {} } },
    async checkNumber(i, phones, opts) { calls.checkNumber.push([phones, opts]); if (overrides.checkNumber) return overrides.checkNumber(phones); const o = {}; for (const x of phones) o[x] = true; return o },
    async sendPresence(i, phone, state) { calls.sendPresence.push([phone, state]); return { ok: true } },
    async markRead(i, lead, id) { calls.markRead.push([lead.id, id]); return { ok: true } },
  }
  return { provider: p, calls }
}

function setup(providerOverrides) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const { provider, calls } = fakeProvider(providerOverrides)
  const sender = createSender({ db, getProvider: () => provider, sleep: async () => {}, random: () => 0.5 })
  return { db, seed, sender, calls }
}

const humanChat = { skipTyping: true, skipQuota: true, skipBusinessHours: true, skipLeadCap: true, skipHealthCheck: true }

test('cap default e 50', () => {
  assert.equal(LEAD_DAILY_CAP_DEFAULT, 50)
})

test('envio completo: pre-flight, digitando (available/composing/paused) e sendText com numero normalizado', async () => {
  const { seed, sender, calls } = setup()
  const r = await sender.sendViaInstance(seed.instance, '47991351835', 'Ola tudo bem')
  assert.deepEqual(r, { ok: true, wamsgId: 'WA1', raw: { key: { id: 'WA1' } } })
  assert.deepEqual(calls.checkNumber[0][0], ['5547991351835'])
  assert.deepEqual(calls.sendPresence.map(c => c[1]), ['available', 'composing', 'paused'])
  assert.deepEqual(calls.sendText, [['5547991351835', 'Ola tudo bem']])
})

test('sem capabilities numberCheck/presence nao chama pre-flight nem digitando', async () => {
  const { seed, sender, calls } = setup({ capabilities: { numberCheck: false, presence: false } })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x')
  assert.equal(r.ok, true)
  assert.equal(calls.checkNumber.length, 0)
  assert.equal(calls.sendPresence.length, 0)
})

test('telefone vazio', async () => {
  const { seed, sender } = setup()
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '', 'x'), { ok: false, reason: 'phone vazio' })
})

test('instancia pausada bloqueia, exceto com skipHealthCheck', async () => {
  const { seed, sender, calls } = setup()
  const paused = { ...seed.instance, paused_at: '2026-09-15 10:00:00', paused_reason: 'manual' }
  assert.deepEqual(await sender.sendViaInstance(paused, '5547991351835', 'x'), { ok: false, reason: 'instance_paused_manual' })
  assert.equal(calls.sendText.length, 0)
  const r = await sender.sendViaInstance(paused, '5547991351835', 'x', humanChat)
  assert.equal(r.ok, true)
})

test('fora do horario comercial', async () => {
  const { seed, sender } = setup()
  const closed = { ...seed.instance, business_hours_json: JSON.stringify({ sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] }) }
  assert.deepEqual(await sender.sendViaInstance(closed, '5547991351835', 'x'), { ok: false, reason: 'outside_business_hours' })
  assert.equal(sender.isInBusinessHours({ business_hours_json: null }), true)
  assert.equal(sender.isInBusinessHours({ business_hours_json: 'nao-json' }), true)
  const h = JSON.stringify({ mon: [{ start: '08:00', end: '18:00' }] })
  assert.equal(sender.isInBusinessHours({ business_hours_json: h }, new Date(2026, 8, 14, 9, 30)), true)
  assert.equal(sender.isInBusinessHours({ business_hours_json: h }, new Date(2026, 8, 14, 19, 0)), false)
})

test('cap por lead usa 50 quando a instancia nao define', async () => {
  const { db, seed, sender } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, delivery_status) VALUES (?, ?, 'outbound', 'x', 'sent')")
  for (let i = 0; i < 49; i++) ins.run(lead.id, seed.account.id)
  const inst = { ...seed.instance, lead_daily_msg_cap: null }
  const ok = await sender.sendViaInstance(inst, lead.phone, 'x', { leadId: lead.id, skipQuota: true, skipTyping: true })
  assert.equal(ok.ok, true)
  ins.run(lead.id, seed.account.id)
  const blocked = await sender.sendViaInstance(inst, lead.phone, 'x', { leadId: lead.id, skipQuota: true, skipTyping: true })
  assert.deepEqual(blocked, { ok: false, reason: 'lead_daily_cap_50' })
})

test('pre-flight false bloqueia com validationFailed e fica em cache', async () => {
  const { seed, sender, calls } = setup({ checkNumber: (phones) => ({ [phones[0]]: false }) })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x', { skipTyping: true })
  assert.deepEqual(r, { ok: false, reason: 'number_not_on_whatsapp', validationFailed: true })
  assert.equal(await sender.checkWhatsAppNumber(seed.instance, '5547991351835'), false)
  assert.equal(calls.checkNumber.length, 1)
  assert.equal(calls.sendText.length, 0)
})

test('pre-flight com erro de rede devolve null, nao cacheia e o envio segue', async () => {
  let n = 0
  const { seed, sender, calls } = setup({ checkNumber: () => { n++; throw new Error('timeout') } })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x', { skipTyping: true })
  assert.equal(r.ok, true)
  assert.equal(await sender.checkWhatsAppNumber(seed.instance, '5547991351835'), null)
  assert.equal(n, 2)
  assert.equal(calls.sendText.length, 1)
})

test('falha do provedor devolve reason e raw', async () => {
  const { seed, sender } = setup({ sendTextResult: { ok: false, messageId: null, reason: 'http_500', raw: { error: 'x' } } })
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '5547991351835', 'x', humanChat), { ok: false, reason: 'http_500', raw: { error: 'x' } })
})

test('excecao do provedor sem raw devolve so reason', async () => {
  const { seed, sender } = setup({ sendTextResult: { ok: false, messageId: null, reason: 'ECONNREFUSED' } })
  assert.deepEqual(await sender.sendViaInstance(seed.instance, '5547991351835', 'x', humanChat), { ok: false, reason: 'ECONNREFUSED' })
})

test('sendMediaViaInstance aplica as mesmas checagens e repassa a midia', async () => {
  const { seed, sender, calls } = setup()
  const media = { type: 'image', base64: 'QUJD', mimetype: 'image/png', fileName: 'f.png', caption: 'legenda' }
  const paused = { ...seed.instance, paused_at: 'x', paused_reason: 'delivered_rate_low' }
  assert.deepEqual(await sender.sendMediaViaInstance(paused, '5547991351835', media), { ok: false, reason: 'instance_paused_delivered_rate_low' })
  const r = await sender.sendMediaViaInstance(seed.instance, '47991351835', media, humanChat)
  assert.deepEqual(r, { ok: true, wamsgId: 'WAM1', raw: {} })
  assert.deepEqual(calls.sendMedia, [['5547991351835', media]])
  assert.deepEqual(calls.checkNumber[0][0], ['5547991351835'])
})

test('checkWhatsAppNumbersBulk devolve Map pelo telefone original', async () => {
  const { seed, sender, calls } = setup({ checkNumber: () => ({ '5547991351835': true, '5547988887777': false }) })
  const m = await sender.checkWhatsAppNumbersBulk(seed.instance, ['47991351835', '5547988887777', '5547991351835'])
  assert.equal(m.get('47991351835'), true)
  assert.equal(m.get('5547988887777'), false)
  assert.equal(m.has('5547991351835'), false) // dedup: o original mantido e o primeiro
  assert.deepEqual(calls.checkNumber[0][1], { timeoutMs: 15000, matchByNumber: true })
})

test('markMessageAsRead usa a ultima inbound do lead e nao quebra (bug da coluna inexistente)', async () => {
  const { db, seed, sender, calls } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', wa_remote_jid: '5547991351835@s.whatsapp.net' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id) VALUES (?, ?, ?, 'x', ?)")
  ins.run(lead.id, seed.account.id, 'inbound', 'IN1')
  ins.run(lead.id, seed.account.id, 'inbound', 'IN2')
  ins.run(lead.id, seed.account.id, 'outbound', 'OUT1')
  await sender.markMessageAsRead(seed.instance, lead)
  assert.deepEqual(calls.markRead, [[lead.id, 'IN2']])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/whatsapp/sender.js`.

- [ ] **Step 3: Implementar `sender.js`**

Criar `server/services/whatsapp/sender.js` (código movido de `leadHandoff.js:37-453`; as únicas trocas são `fetch` → provedor, `setTimeout` de espera → `sleep`, `Math.random` → `random`, `Date.now()` → `nowMs()`, cap 5 → 50):

```js
// Envio de WhatsApp com protecoes anti-ban, independente do provedor.
// Movido de leadHandoff.js. Dependencias injetadas para testar com better-sqlite3 :memory:.
import { normalizeForSend } from './normalize.js'

export const LEAD_DAILY_CAP_DEFAULT = 50

const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 2000
const QUOTA_DEFAULT_PER_HOUR = 100
const QUOTA_DEFAULT_PER_DAY = 800
// Dia 1 = 5% do quota, dia 2 = 20%, dia 3 = 50%. Dia 4+ = 100%.
const WARMUP_MULTIPLIERS = [0.05, 0.20, 0.50]
const TYPING_MIN_MS = 1200
const TYPING_MAX_MS = 5000

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms))

export function createSender({ db, getProvider, sleep = defaultSleep, random = Math.random, now = () => new Date(), nowMs = () => Date.now() }) {
  // Cache do pre-flight: Map<"instId:numero", { exists, expires }>
  const numberCache = new Map()

  function cachePut(key, exists) {
    if (numberCache.size > CACHE_MAX) {
      const half = Math.floor(CACHE_MAX / 2)
      const keys = Array.from(numberCache.keys()).slice(0, half)
      for (const k of keys) numberCache.delete(k)
    }
    numberCache.set(key, { exists, expires: nowMs() + CACHE_TTL_MS })
  }

  function cacheGet(key) {
    const v = numberCache.get(key)
    if (!v) return undefined
    if (nowMs() > v.expires) { numberCache.delete(key); return undefined }
    return v.exists
  }

  // business_hours_json: {sun:[{start:"08:00",end:"21:00"}], mon:[...], ...}; null = 24/7; dia sem slots = fechado.
  function isInBusinessHours(instance, at = now()) {
    if (!instance.business_hours_json) return true
    let schedule = null
    try { schedule = JSON.parse(instance.business_hours_json) } catch { return true }
    if (!schedule || typeof schedule !== 'object') return true
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
    const slots = schedule[dayKeys[at.getDay()]]
    if (!Array.isArray(slots) || slots.length === 0) return false
    const cur = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    return slots.some(s => s?.start && s?.end && cur >= s.start && cur <= s.end)
  }

  function checkLeadCap(instance, leadId) {
    if (!leadId) return { ok: true }
    const cap = instance.lead_daily_msg_cap || LEAD_DAILY_CAP_DEFAULT
    const count = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE lead_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 day')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(leadId)?.n || 0
    if (count >= cap) return { ok: false, reason: `lead_daily_cap_${cap}`, count, cap }
    return { ok: true, count, cap }
  }

  // Metrica: (total - failed) / total na janela; <70% auto-pausa. Minimo 20 msgs.
  function checkInstanceHealth(instance) {
    if (instance.paused_at && instance.paused_reason === 'manual') {
      return { ok: false, reason: 'manually_paused' }
    }
    const windowMin = instance.health_check_window_min || 120
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-${windowMin} minutes')
        AND delivery_status IN ('sent','delivered','read','failed')
    `).get(instance.id)
    if ((stats?.total || 0) < 20) return { ok: true, total: stats?.total || 0 }
    const failedRate = (stats.failed || 0) / stats.total
    const okRate = 1 - failedRate
    if (okRate < 0.70) {
      db.prepare("UPDATE whatsapp_instances SET paused_at = datetime('now'), paused_reason = 'delivered_rate_low' WHERE id = ?").run(instance.id)
      console.warn(`[Health] inst=${instance.instance_name} AUTO-PAUSED ok_rate=${(okRate * 100).toFixed(0)}% (failed=${stats.failed}/${stats.total})`)
      return { ok: false, reason: 'auto_paused_low_delivery', rate: okRate, failed: stats.failed, total: stats.total }
    }
    return { ok: true, rate: okRate, total: stats.total }
  }

  // Marca a ultima inbound do lead como lida (humano abre a conversa antes de responder). Best-effort.
  async function markMessageAsRead(instance, lead) {
    if (!lead || !instance) return
    let provider
    try { provider = getProvider(instance) } catch { return }
    if (!provider.markRead) return
    const lastMsg = db.prepare(`
      SELECT wa_msg_id FROM messages
      WHERE lead_id = ? AND direction = 'inbound' AND wa_msg_id IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).get(lead.id)
    if (!lastMsg?.wa_msg_id) return
    try { await provider.markRead(instance, lead, lastMsg.wa_msg_id) } catch {}
  }

  function checkSendQuota(instance) {
    const hourlyLimit = instance.hourly_send_limit || QUOTA_DEFAULT_PER_HOUR
    const dailyLimit = instance.daily_send_limit || QUOTA_DEFAULT_PER_DAY
    let effectiveHourly = hourlyLimit
    let effectiveDaily = dailyLimit
    if (instance.warmup_until) {
      const warmupEndMs = new Date(instance.warmup_until.replace(' ', 'T') + 'Z').getTime()
      if (warmupEndMs > nowMs()) {
        const refDate = instance.created_at || instance.warmup_until
        const createdMs = new Date(String(refDate).replace(' ', 'T') + 'Z').getTime()
        const daysIn = Math.max(0, Math.floor((nowMs() - createdMs) / 86400000))
        const mult = WARMUP_MULTIPLIERS[Math.min(daysIn, WARMUP_MULTIPLIERS.length - 1)]
        effectiveHourly = Math.max(1, Math.floor(hourlyLimit * mult))
        effectiveDaily = Math.max(1, Math.floor(dailyLimit * mult))
      }
    }
    const hourCount = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 hour')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(instance.id)?.n || 0
    if (hourCount >= effectiveHourly) {
      return { ok: false, reason: `quota_hourly_${effectiveHourly}`, hourCount, limit: effectiveHourly }
    }
    const dayCount = db.prepare(`
      SELECT COUNT(*) as n FROM messages
      WHERE instance_id = ? AND direction = 'outbound'
        AND created_at >= datetime('now', '-1 day')
        AND delivery_status IN ('sent', 'delivered', 'read')
    `).get(instance.id)?.n || 0
    if (dayCount >= effectiveDaily) {
      return { ok: false, reason: `quota_daily_${effectiveDaily}`, dayCount, limit: effectiveDaily }
    }
    return { ok: true, effectiveHourly, effectiveDaily, hourCount, dayCount }
  }

  // Sequencia humana: online -> digitando (tempo proporcional ao texto, jitter +-25%) -> parou -> envia.
  async function simulateTyping(instance, provider, phone, text) {
    const number = normalizeForSend(phone)
    if (!number) return
    const baseRaw = 800 + (text || '').length * 25
    const base = Math.max(TYPING_MIN_MS, Math.min(TYPING_MAX_MS, baseRaw))
    const jitter = 0.75 + random() * 0.5
    const ms = Math.round(base * jitter)
    const presence = (state) => Promise.resolve().then(() => provider.sendPresence(instance, number, state)).catch(() => {})
    await presence('available')
    await sleep(300 + random() * 200)
    await presence('composing')
    await sleep(ms)
    await presence('paused')
    await sleep(100 + random() * 100)
  }

  // true (existe), false (nao existe), null (erro/timeout ou provedor sem checagem). Cache 5 min.
  async function checkWhatsAppNumber(instance, phone) {
    const number = normalizeForSend(phone)
    if (!number) return false
    const cacheKey = `${instance.id}:${number}`
    const cached = cacheGet(cacheKey)
    if (cached !== undefined) return cached
    let provider
    try { provider = getProvider(instance) } catch { return null }
    if (!provider.checkNumber) return null
    try {
      const map = await provider.checkNumber(instance, [number], { timeoutMs: 3000 })
      const exists = map[number] === undefined ? null : map[number]
      cachePut(cacheKey, exists)
      return exists
    } catch {
      return null
    }
  }

  async function checkWhatsAppNumbersBulk(instance, phones) {
    const result = new Map()
    if (!phones || phones.length === 0) return result
    const normalizedToOriginal = new Map()
    for (const p of phones) {
      const n = normalizeForSend(p)
      if (n && !normalizedToOriginal.has(n)) normalizedToOriginal.set(n, p)
    }
    const toQuery = []
    for (const n of normalizedToOriginal.keys()) {
      const cached = cacheGet(`${instance.id}:${n}`)
      if (cached !== undefined) result.set(normalizedToOriginal.get(n), cached)
      else toQuery.push(n)
    }
    if (toQuery.length === 0) return result
    let provider
    try { provider = getProvider(instance) } catch { provider = null }
    if (!provider || !provider.checkNumber) {
      for (const n of toQuery) result.set(normalizedToOriginal.get(n), null)
      return result
    }
    try {
      const map = await provider.checkNumber(instance, toQuery, { timeoutMs: 15000, matchByNumber: true })
      for (const n of toQuery) {
        const exists = map[n] === undefined ? null : map[n]
        cachePut(`${instance.id}:${n}`, exists)
        result.set(normalizedToOriginal.get(n), exists)
      }
      return result
    } catch {
      for (const n of toQuery) result.set(normalizedToOriginal.get(n), null)
      return result
    }
  }

  // Checagens comuns a texto e midia. Devolve { ok:false, result } ou { ok:true, number, provider }.
  async function runSendGuards(instance, phone, typingText, opts) {
    const number = normalizeForSend(phone)
    if (!number) return { ok: false, result: { ok: false, reason: 'phone vazio' } }
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, result: { ok: false, reason: e.message } } }

    if (instance.paused_at && !opts.skipHealthCheck) {
      return { ok: false, result: { ok: false, reason: `instance_paused_${instance.paused_reason || 'unknown'}` } }
    }
    if (!opts.skipBusinessHours && !isInBusinessHours(instance)) {
      return { ok: false, result: { ok: false, reason: 'outside_business_hours' } }
    }
    if (!opts.skipLeadCap && opts.leadId) {
      const c = checkLeadCap(instance, opts.leadId)
      if (!c.ok) {
        console.warn(`[LeadCap] inst=${instance.instance_name} lead=${opts.leadId} bloqueado: ${c.reason} (count=${c.count}/${c.cap})`)
        return { ok: false, result: { ok: false, reason: c.reason } }
      }
    }
    if (!opts.skipHealthCheck) {
      const h = checkInstanceHealth(instance)
      if (!h.ok) return { ok: false, result: { ok: false, reason: h.reason } }
    }
    if (!opts.skipValidation && provider.capabilities?.numberCheck) {
      const exists = await checkWhatsAppNumber(instance, phone)
      if (exists === false) {
        console.log(`[Pre-flight] phone=${number} inst=${instance.instance_name} exists=false — bloqueando envio`)
        return { ok: false, result: { ok: false, reason: 'number_not_on_whatsapp', validationFailed: true } }
      }
    }
    if (!opts.skipQuota) {
      const q = checkSendQuota(instance)
      if (!q.ok) {
        console.warn(`[Quota] inst=${instance.instance_name} bloqueado: ${q.reason} (count=${q.hourCount ?? q.dayCount}/${q.limit})`)
        return { ok: false, result: { ok: false, reason: q.reason } }
      }
    }
    if (!opts.skipTyping && provider.capabilities?.presence && provider.sendPresence) {
      await simulateTyping(instance, provider, phone, typingText)
    }
    return { ok: true, number, provider }
  }

  function mapProviderResult(r) {
    if (!r.ok) return r.raw !== undefined ? { ok: false, reason: r.reason, raw: r.raw } : { ok: false, reason: r.reason }
    return { ok: true, wamsgId: r.messageId, raw: r.raw }
  }

  async function sendViaInstance(instance, phone, text, opts = {}) {
    const guard = await runSendGuards(instance, phone, text, opts)
    if (!guard.ok) return guard.result
    return mapProviderResult(await guard.provider.sendText(instance, guard.number, text))
  }

  async function sendMediaViaInstance(instance, phone, media, opts = {}) {
    const guard = await runSendGuards(instance, phone, media?.caption || '', opts)
    if (!guard.ok) return guard.result
    if (!guard.provider.sendMedia) return { ok: false, reason: 'media_not_supported' }
    return mapProviderResult(await guard.provider.sendMedia(instance, guard.number, media))
  }

  return {
    sendViaInstance, sendMediaViaInstance, checkWhatsAppNumber, checkWhatsAppNumbersBulk, markMessageAsRead,
    isInBusinessHours, checkLeadCap, checkInstanceHealth, checkSendQuota,
  }
}
```

Nota: o texto de log `'— bloqueando envio'` contém travessão (não é emoji) e é o mesmo de hoje.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/sender.test.js`.

- [ ] **Step 5: `leadHandoff.js` passa a delegar**

Em `server/services/leadHandoff.js`:

1. Trocar as linhas 7-8 (`import db from '../db.js'` e `import fetch from 'node-fetch'`) por:

```js
import db from '../db.js'
import { getProvider } from './whatsapp/index.js'
import { createSender } from './whatsapp/sender.js'
```

2. Apagar tudo da linha 37 (`// ─── Pre-flight: valida se numero existe no WhatsApp via Evolution`) até a linha 453 (fechamento de `sendViaInstance`) e colocar no lugar:

```js
// Envio e anti-ban moram em whatsapp/sender.js (independente do provedor).
// Reexportados aqui para manter os imports de broadcasts.js, autoMessages.js, aiAgent.js, followUpSender.js e messages.js.
const sender = createSender({ db, getProvider })
export const sendViaInstance = sender.sendViaInstance
export const sendMediaViaInstance = sender.sendMediaViaInstance
export const checkWhatsAppNumber = sender.checkWhatsAppNumber
export const checkWhatsAppNumbersBulk = sender.checkWhatsAppNumbersBulk
export const markMessageAsRead = sender.markMessageAsRead
```

3. Conferir que `getNotifierInstanceId`, `renderTemplate`, `SOURCE_LABELS` e `notifyAndOpenLead` continuam intactos.

- [ ] **Step 6: Conferir que o servidor importa sem erro**

Run: `node --input-type=module -e "const m = await import('./server/services/leadHandoff.js'); console.log(typeof m.sendViaInstance, typeof m.sendMediaViaInstance, typeof m.checkWhatsAppNumbersBulk, typeof m.markMessageAsRead, typeof m.notifyAndOpenLead); process.exit(0)"`
Expected: `function function function function function`

Run: `Select-String -Path server/services/leadHandoff.js -Pattern "fetch\(|api_url"`
Expected: nenhuma ocorrência.

- [ ] **Step 7: Commit**

```bash
git add server/services/whatsapp/sender.js test/sender.test.js server/services/leadHandoff.js
git commit -m "refactor: envio com anti-ban pela tomada de WhatsApp, cap por lead 50 e markRead corrigido"
```

---

### Task 7: Mídia pela tomada (envio com checagens, download pela instância da mensagem, transcrição e foto de perfil)

**Files:**
- Create: `server/services/whatsapp/resolveInstance.js`
- Modify: `server/routes/messages.js:1-4` (imports), `:110-114`, `:168-195`, `:224-268`
- Modify: `server/services/deepgramClient.js:7` (import) e `:64-92` (`fetchAudioBuffer`)
- Modify: `server/routes/leads.js:2` (import de `node-fetch`) e `:653-674`
- Test: `test/mediaResolve.test.js`

**Interfaces:**
- Consumes: `jidToSendNumber` (Task 1); `getProvider` e `fetchMedia`/`fetchProfilePictureUrl` (Tasks 4-5); `sendMediaViaInstance`, `sendViaInstance` via `leadHandoff.js` (Task 6).
- Produces:
  - `resolveMediaInstance(db, message: { instance_id }, lead: { account_id, instance_id }): instanceRow|null` — `message.instance_id` → `lead.instance_id` → primeira instância `connected` da conta; sempre `account_id = lead.account_id`.
  - `fetchAudioBuffer(instance, waMsgId, deps?: { getProvider? }): Promise<{ buffer: Buffer, mimetype: string }>` (mesma assinatura de hoje + `deps` opcional).

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/mediaResolve.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { resolveMediaInstance } from '../server/services/whatsapp/resolveInstance.js'
import { fetchAudioBuffer } from '../server/services/deepgramClient.js'

function addInstance(db, accountId, name, status = 'connected') {
  const id = db.prepare("INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status) VALUES (?, ?, 'http://evo', 'k', ?)").run(accountId, name, status).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('usa a instancia da mensagem antes da instancia do lead', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const outra = addInstance(db, account.id, 'outra')
  const r = resolveMediaInstance(db, { instance_id: outra.id }, { account_id: account.id, instance_id: instance.id })
  assert.equal(r.id, outra.id)
})

test('mensagem antiga sem instance_id cai na instancia do lead', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  addInstance(db, account.id, 'outra')
  assert.equal(resolveMediaInstance(db, { instance_id: null }, { account_id: account.id, instance_id: instance.id }).id, instance.id)
})

test('sem nenhuma, primeira conectada da conta; instancia de outra conta nunca e usada', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  db.prepare("INSERT INTO accounts (name, slug) VALUES ('Outra', 'outra')").run()
  const alheia = addInstance(db, 2, 'alheia')
  const r = resolveMediaInstance(db, { instance_id: alheia.id }, { account_id: account.id, instance_id: null })
  assert.equal(r.account_id, account.id)
  assert.equal(r.instance_name, 'inst-teste')
})

test('nada encontrado devolve null', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET status = 'disconnected'").run()
  assert.equal(resolveMediaInstance(db, { instance_id: null }, { account_id: account.id, instance_id: null }), null)
})

test('fetchAudioBuffer busca pela tomada e mantem mimetype default', async () => {
  const inst = { id: 1, provider: 'evolution', api_url: 'http://evo', api_key: 'k', instance_name: 'i' }
  const calls = []
  const getProvider = () => ({ fetchMedia: async (i, m) => { calls.push(m); return { buffer: Buffer.from('abc'), mimetype: null } } })
  const r = await fetchAudioBuffer(inst, 'AUD1', { getProvider })
  assert.deepEqual(calls, [{ wa_msg_id: 'AUD1' }])
  assert.equal(r.buffer.toString(), 'abc')
  assert.equal(r.mimetype, 'audio/ogg')
})

test('fetchAudioBuffer valida credenciais da Evolution e wa_msg_id', async () => {
  const getProvider = () => ({ fetchMedia: async () => ({ buffer: Buffer.from(''), mimetype: 'audio/ogg' }) })
  await assert.rejects(() => fetchAudioBuffer({ api_url: '', api_key: 'k', instance_name: 'i' }, 'X', { getProvider }), /instance_missing_credentials/)
  await assert.rejects(() => fetchAudioBuffer(null, 'X', { getProvider }), /instance_missing_credentials/)
  await assert.rejects(() => fetchAudioBuffer({ api_url: 'u', api_key: 'k', instance_name: 'i' }, '', { getProvider }), /wa_msg_id_required/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `resolveInstance.js` e falha no teste de `fetchAudioBuffer` (ainda chama `node-fetch`).

- [ ] **Step 3: Implementar `resolveInstance.js`**

Criar `server/services/whatsapp/resolveInstance.js`:

```js
// Instancia usada para baixar a midia de uma mensagem.
// Antes usava lead.instance_id (messages.js:175-178), o que falha quando o lead conversa por mais de um numero.
export function resolveMediaInstance(db, message, lead) {
  if (!message || !lead) return null
  const byId = (id) => (id
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND account_id = ?').get(id, lead.account_id)
    : null)
  return byId(message.instance_id)
    || byId(lead.instance_id)
    || db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? ORDER BY id LIMIT 1').get(lead.account_id, 'connected')
    || null
}
```

- [ ] **Step 4: `fetchAudioBuffer` pela tomada**

Em `server/services/deepgramClient.js`, depois da linha 7 (`import fetch from 'node-fetch'`, que continua sendo usada por `transcribeAudio`), acrescentar:

```js
import { getProvider as defaultGetProvider } from './whatsapp/index.js'
```

E substituir o bloco das linhas 64-92 (comentário + `fetchAudioBuffer`) por:

```js
/**
 * Baixa o audio de uma mensagem pelo provedor da instancia e retorna como Buffer.
 * Mesmo download usado pelo player do Chat (GET /api/messages/:leadId/media/:msgId).
 *
 * @param {Object} instance - row de whatsapp_instances
 * @param {string} waMsgId - wa_msg_id da mensagem
 * @param {Object} [deps] - { getProvider } injetavel para teste
 * @returns {Promise<{ buffer: Buffer, mimetype: string }>}
 */
export async function fetchAudioBuffer(instance, waMsgId, deps = {}) {
  const getProvider = deps.getProvider || defaultGetProvider
  const isEvolution = !!instance && (instance.provider || 'evolution') === 'evolution'
  if (!instance || (isEvolution && (!instance.api_url || !instance.api_key || !instance.instance_name))) {
    throw new Error('instance_missing_credentials')
  }
  if (!waMsgId) throw new Error('wa_msg_id_required')
  const media = await getProvider(instance).fetchMedia(instance, { wa_msg_id: waMsgId })
  return { buffer: media.buffer, mimetype: media.mimetype || 'audio/ogg' }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/mediaResolve.test.js`.

- [ ] **Step 6: `messages.js` — imports e normalização única**

1. Trocar as linhas 1-4 por:

```js
import { Router, json as jsonBodyParser } from 'express'
import db from '../db.js'
import { sendViaInstance, sendMediaViaInstance } from '../services/leadHandoff.js'
import { getProvider } from '../services/whatsapp/index.js'
import { resolveMediaInstance } from '../services/whatsapp/resolveInstance.js'
import { jidToSendNumber } from '../services/whatsapp/normalize.js'
```

(`node-fetch` e `checkWhatsAppNumber` deixam de ser usados neste arquivo.)

2. Linhas 110-114 (envio de texto): substituir o comentário e as 4 linhas `let number = ...` / `if (number.startsWith...` por:

```js
    // Normalize number for sending
    const number = jidToSendNumber(jid)
```

- [ ] **Step 7: `messages.js` — download de mídia pela instância da mensagem**

Substituir a rota das linhas 168-195 por:

```js
// Fetch media on-demand from the WhatsApp provider (returns base64 data URL)
router.get('/:leadId/media/:msgId', async (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND lead_id = ?').get(req.params.msgId, req.params.leadId)
    if (!message || !message.wa_msg_id) return res.status(404).json({ error: 'Mensagem nao encontrada' })
    if (message.media_type === 'text') return res.status(400).json({ error: 'Sem midia' })

    const lead = db.prepare('SELECT account_id, instance_id FROM leads WHERE id = ?').get(message.lead_id)
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
    if (req.accountId && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem permissao' })

    const instance = resolveMediaInstance(db, message, lead)
    if (!instance) return res.status(400).json({ error: 'Sem instancia WhatsApp' })

    let media
    try {
      media = await getProvider(instance).fetchMedia(instance, message)
    } catch (e) {
      if (e.code === 'media_not_found') return res.status(404).json({ error: 'Midia nao encontrada na Evolution' })
      throw e
    }

    const mimeMap = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', document: 'application/pdf', sticker: 'image/webp' }
    const mime = media.mimetype || mimeMap[message.media_type] || 'application/octet-stream'
    res.json({ dataUrl: `data:${mime};base64,${media.buffer.toString('base64')}`, mime, type: message.media_type })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 8: `messages.js` — envio de mídia pelo `sendMediaViaInstance`**

Na rota `POST /:leadId/media`, substituir das linhas 224 até 268 (de `let number = jid.replace(...)` até o `console.error` de falha) por:

```js
    const number = jidToSendNumber(jid)
    const fileName = file_name || `arquivo.${mime.split('/')[1] || 'bin'}`
    const content = caption || file_name || `[${mediaType}]`

    // Mesmas checagens do texto do Chat (humano): skip anti-ban de volume; pre-flight de numero continua.
    const sendRes = await sendMediaViaInstance(instance, number, { type: mediaType, base64, mimetype: mime, fileName, caption }, {
      skipTyping: true, skipQuota: true, skipBusinessHours: true, skipLeadCap: true, skipHealthCheck: true,
    })

    if (sendRes.validationFailed) {
      console.log(`[Messages/Media] phone=${number} inst=${instance.instance_name} exists=false — bloqueando envio`)
      const result = db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, media_type, instance_id, sent_by_user_id, delivery_status)
        VALUES (?, ?, 'outbound', ?, ?, NULL, ?, ?, ?, 'failed')
      `).run(lead.id, lead.account_id, content, req.user.name, mediaType, instance.id, req.user.id)
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
      return res.status(200).json({ message, delivered: false, instance: { id: instance.id, name: instance.instance_name }, error: 'Numero nao tem WhatsApp. Midia nao foi enviada.' })
    }

    const delivered = !!sendRes.ok
    if (!delivered) {
      console.error(`[Messages/Media] Failed for ${jid} via ${instance.instance_name}: ${sendRes.reason}`, JSON.stringify(sendRes.raw || {}).substring(0, 300))
    }
```

E no restante da rota (antigas linhas 270-276): apagar a linha `const content = caption || file_name || \`[${mediaType}]\`` (já declarada acima) e trocar `sendData?.key?.id || null` por `sendRes.wamsgId || null` no `INSERT`.

- [ ] **Step 9: Foto de perfil pela tomada em `leads.js`**

1. Em `server/routes/leads.js`, trocar o import de `node-fetch` (linha 2, único uso é a foto de perfil) por:

```js
import { getProvider } from '../services/whatsapp/index.js'
```

2. Nas linhas 661-670, substituir o `try { const r = await fetch(...) ... res.json({ profile_pic_url: url }) }` por:

```js
  try {
    const provider = getProvider(instance)
    if (!provider.fetchProfilePictureUrl) return res.json({ profile_pic_url: lead.profile_pic_url || null })
    const url = await provider.fetchProfilePictureUrl(instance, lead.phone)
    db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(url, lead.id)
    res.json({ profile_pic_url: url })
  } catch (err) {
```

(o `catch` existente continua igual).

- [ ] **Step 10: Conferências**

Run: `npm test`
Expected: PASS em todos.

Run: `node --input-type=module -e "await import('./server/routes/messages.js'); await import('./server/routes/leads.js'); await import('./server/services/deepgramClient.js'); console.log('ok'); process.exit(0)"`
Expected: `ok`

Run: `Select-String -Path server/routes/messages.js,server/routes/leads.js,server/services/deepgramClient.js -Pattern "api_url\}"`
Expected: nenhuma ocorrência.

Teste manual (local ou após deploy): no Chat, abrir um áudio recebido (player carrega), enviar uma imagem para um lead (chega e aparece com ✓) e enviar mídia para um número sem WhatsApp (mensagem gravada como falha com o aviso "Numero nao tem WhatsApp").

- [ ] **Step 11: Commit**

```bash
git add server/services/whatsapp/resolveInstance.js test/mediaResolve.test.js server/routes/messages.js server/services/deepgramClient.js server/routes/leads.js
git commit -m "fix: midia pela instancia da mensagem, envio de midia com checagens e transcricao pela tomada"
```

---

### Task 8: Mover `getOrCreateLead` e `autoDetectStage` para `leadIntake.js`

**Files:**
- Create: `server/services/leadIntake.js`
- Create: `server/services/inboundRuntime.js`
- Modify: `server/routes/webhooks.js:1-11` (imports) e `:29-168` (remover as funções movidas)
- Test: `test/leadIntake.test.js`

**Interfaces:**
- Consumes: `normalizePhone`, `phoneCompareKey` (Task 1).
- Produces:
  - `createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange })` → `{ getOrCreateLead(accountId, phone, name, source, waJid, instanceId, opts?): { lead, isNew, blocked?, restricted? }, autoDetectStage(lead, messageText): void }`
  - `inboundRuntime.js`: `export const leadIntake` (ligado ao banco real).

Regra: mover o corpo das funções **sem alterar** (só o `normalizePhone`/`phoneCompareKey` passam a vir de `normalize.js`). Os testes abaixo descrevem o comportamento atual lido em `webhooks.js:50-168`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/leadIntake.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createLeadIntake } from '../server/services/leadIntake.js'

const tick = () => new Promise(r => setImmediate(r))

function setup(opts = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, opts)
  const calls = { handoff: [], capi: [], roulette: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: (accountId, instanceId) => { calls.roulette.push([accountId, instanceId]); return opts.rouletteUser ?? null },
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
  })
  return { db, seed, calls, intake }
}

test('cria lead novo no funil padrao, primeira etapa, com historico webhook', () => {
  const { db, seed, intake, calls } = setup()
  const r = intake.getOrCreateLead(seed.account.id, '47991351835', 'Maria', 'whatsapp', '5547991351835@s.whatsapp.net', seed.instance.id)
  assert.equal(r.isNew, true)
  assert.equal(r.lead.phone, '5547991351835')
  assert.equal(r.lead.name, 'Maria')
  assert.equal(r.lead.stage_id, seed.stage1)
  assert.equal(r.lead.instance_id, seed.instance.id)
  assert.ok(r.lead.opted_in_at)
  assert.deepEqual(calls.roulette, [[seed.account.id, seed.instance.id]])
  const h = db.prepare('SELECT * FROM stage_history WHERE lead_id = ?').all(r.lead.id)
  assert.equal(h.length, 1)
  assert.equal(h[0].trigger_type, 'webhook')
})

test('nome vazio usa telefone; sem telefone usa Sem nome', () => {
  const { seed, intake } = setup()
  assert.equal(intake.getOrCreateLead(seed.account.id, '5547911112222', '', 'whatsapp', null, null).lead.name, '5547911112222')
  assert.equal(intake.getOrCreateLead(seed.account.id, null, '', 'whatsapp', '1@lid', null).lead.name, 'Sem nome')
})

test('encontra lead existente por wa_remote_jid, depois telefone exato, depois chave de comparacao', () => {
  const { db, seed, intake } = setup()
  const a = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '4791351835', wa_remote_jid: null })
  const r = intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', '5547991351835@s.whatsapp.net', seed.instance.id)
  assert.equal(r.isNew, false)
  assert.equal(r.lead.id, a.id)
  assert.equal(db.prepare('SELECT instance_id FROM leads WHERE id = ?').get(a.id).instance_id, seed.instance.id)
})

test('lead arquivado nao desarquiva, so marca has_new_after_archive', () => {
  const { db, seed, intake } = setup()
  const a = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', is_archived: 1 })
  intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', null, null)
  const row = db.prepare('SELECT is_archived, has_new_after_archive FROM leads WHERE id = ?').get(a.id)
  assert.deepEqual({ ...row }, { is_archived: 1, has_new_after_archive: 1 })
})

test('telefone bloqueado (exato ou pela chave) devolve blocked', () => {
  const { db, seed, intake } = setup()
  insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '47991351835', is_blocked: 1 })
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547991351835', 'X', 'whatsapp', null, null), { lead: null, isNew: false, blocked: true })
})

test('instancia restrita nao cria lead novo', () => {
  const { seed, intake } = setup({ intakeMode: 'restricted' })
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, seed.instance.id), { lead: null, isNew: false, restricted: true })
})

test('sem funil padrao nao cria', () => {
  const { db, seed, intake } = setup()
  db.prepare('UPDATE funnels SET is_default = 0').run()
  assert.deepEqual(intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, null), { lead: null, isNew: false })
})

test('com atendente da roleta dispara handoff em setImmediate, exceto noAutoHandoff', async () => {
  const { seed, intake, calls } = setup({ rouletteUser: 7 })
  const r = intake.getOrCreateLead(seed.account.id, '5547911112222', 'X', 'whatsapp', null, seed.instance.id)
  assert.equal(r.lead.attendant_id, 7)
  assert.equal(calls.handoff.length, 0)
  await tick()
  assert.deepEqual(calls.handoff, [[r.lead.id, 7, { source: 'webhook' }]])
  intake.getOrCreateLead(seed.account.id, '5547933334444', 'Y', 'sheets', null, null, { noAutoHandoff: true })
  await tick()
  assert.equal(calls.handoff.length, 1)
})

test('autoDetectStage avanca para a primeira etapa a frente com palavra-chave e dispara CAPI', () => {
  const { db, seed, intake, calls } = setup({ stage2Keywords: JSON.stringify(['proposta']) })
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  intake.autoDetectStage(lead, 'Segue a PROPOSTA')
  assert.equal(db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(lead.id).stage_id, seed.stage2)
  const h = db.prepare("SELECT * FROM stage_history WHERE lead_id = ? AND trigger_type = 'auto_keyword'").get(lead.id)
  assert.equal(h.from_stage_id, seed.stage1)
  assert.deepEqual(calls.capi, [[lead.id, seed.stage2, h.id]])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/leadIntake.js`.

- [ ] **Step 3: Implementar movendo o código**

Criar `server/services/leadIntake.js`. O corpo de `getOrCreateLead` é **recortado** de `server/routes/webhooks.js:50-137` e o de `autoDetectStage` de `:139-168`, sem alterar nenhuma linha interna:

```js
// Entrada de leads (WhatsApp, Meta Lead Form, site, Google Sheets).
// Movido de routes/webhooks.js sem alterar a logica. Dependencias injetadas para teste.
import { normalizePhone, phoneCompareKey } from './whatsapp/normalize.js'

export function createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange }) {
  function getOrCreateLead(accountId, phone, name, source, waJid, instanceId, opts = {}) {
    phone = normalizePhone(phone)

    // ─── GATE: phone bloqueado nesta conta? Ignora silenciosamente. ───
    if (phone) {
      const blockedExact = db.prepare("SELECT id FROM leads WHERE account_id = ? AND phone = ? AND is_blocked = 1 LIMIT 1").get(accountId, phone)
      if (blockedExact) return { lead: null, isNew: false, blocked: true }
      const key = phoneCompareKey(phone)
      if (key) {
        const last8 = key.slice(-8)
        const candidates = db.prepare("SELECT phone FROM leads WHERE account_id = ? AND is_blocked = 1 AND phone LIKE ?").all(accountId, '%' + last8)
        if (candidates.some(c => phoneCompareKey(c.phone) === key)) {
          return { lead: null, isNew: false, blocked: true }
        }
      }
    }

    let lead = null
    if (waJid) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, waJid)
    if (!lead && phone) {
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, phone)
      if (!lead) {
        const key = phoneCompareKey(phone)
        if (key) {
          const last8 = key.slice(-8)
          const candidates = db.prepare(`SELECT * FROM leads WHERE account_id = ? AND phone LIKE ? ORDER BY is_archived ASC, created_at DESC`).all(accountId, '%' + last8)
          lead = candidates.find(c => phoneCompareKey(c.phone) === key) || null
        }
      }
    }

    if (lead) {
      if (instanceId && !lead.instance_id) {
        db.prepare('UPDATE leads SET instance_id = ? WHERE id = ?').run(instanceId, lead.id)
      }
      if (lead.is_archived) {
        db.prepare("UPDATE leads SET has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
      }
      return { lead, isNew: false }
    }

    // ─── GATE: instancia em modo RESTRITO so processa leads ja cadastrados.
    if (instanceId) {
      const inst = db.prepare('SELECT lead_intake_mode FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (inst?.lead_intake_mode === 'restricted') {
        return { lead: null, isNew: false, restricted: true }
      }
    }

    const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(accountId)
    if (!funnel) return { lead: null, isNew: false }
    const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
    if (!firstStage) return { lead: null, isNew: false }

    const attendantId = pickFromRoulette(accountId, instanceId)

    const result = db.prepare(`
      INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(accountId, funnel.id, firstStage.id, attendantId, name || phone || 'Sem nome', phone || null, source, waJid || null, instanceId || null)

    db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(result.lastInsertRowid, firstStage.id, 'webhook')

    lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)

    if (attendantId && !opts.noAutoHandoff) {
      setImmediate(() => {
        notifyAndOpenLead(lead.id, attendantId, { source: 'webhook' })
          .catch(e => console.error('[Handoff webhook]', e.message))
      })
    }

    return { lead, isNew: true }
  }

  function autoDetectStage(lead, messageText) {
    if (!messageText) return
    const text = messageText.toLowerCase()
    const currentStage = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(lead.stage_id)
    if (!currentStage) return
    const aheadStages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND position > ? ORDER BY position').all(lead.funnel_id, currentStage.position)
    for (const stage of aheadStages) {
      if (!stage.auto_keywords) continue
      let keywords
      try { keywords = JSON.parse(stage.auto_keywords) } catch { continue }
      if (!Array.isArray(keywords)) continue
      const matched = keywords.some(kw => text.includes(kw.toLowerCase()))
      if (matched) {
        const oldStageId = lead.stage_id
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
        const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
          lead.id, oldStageId, stage.id, 'auto_keyword'
        )
        triggerCapiForStageChange(lead.id, stage.id, histRes.lastInsertRowid)
        break
      }
    }
  }

  return { getOrCreateLead, autoDetectStage }
}
```

(Ao recortar, manter também os comentários originais das linhas 53-55, 72-74, 86-91, 98-100, 108, 114, 122 e 127-128 se preferir; eles foram encurtados acima só por espaço. Nenhuma instrução executável pode mudar.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/leadIntake.test.js`.

- [ ] **Step 5: Ligação com o banco real**

Criar `server/services/inboundRuntime.js`:

```js
// Liga os servicos de entrada (leadIntake, inboundHandler) as dependencias reais (banco, SSE, CAPI, IA).
// Nao importar nos testes.
import db from '../db.js'
import { triggerCapiForStageChange } from './metaCapi.js'
import { pickFromRoulette } from './roulette.js'
import { notifyAndOpenLead } from './leadHandoff.js'
import { createLeadIntake } from './leadIntake.js'

export const leadIntake = createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange })
```

- [ ] **Step 6: `webhooks.js` usa o módulo novo**

Em `server/routes/webhooks.js`:

1. Acrescentar depois da linha 9 (`import { notifyAndOpenLead } ...`):

```js
import { normalizePhone } from '../services/whatsapp/normalize.js'
import { leadIntake } from '../services/inboundRuntime.js'
```

2. Apagar as linhas 29-168 (de `// Helper: get or create lead from phone` até o fim de `autoDetectStage`) e colocar no lugar:

```js
const { getOrCreateLead, autoDetectStage } = leadIntake
```

3. Os imports `pickFromRoulette` e `notifyAndOpenLead` continuam em uso pelo bloco de follow-up e pela rota `/sheets` até a Task 10; não remover agora.

- [ ] **Step 7: Conferências**

Run: `npm test`
Expected: PASS em todos.

Run: `node --input-type=module -e "await import('./server/routes/webhooks.js'); console.log('ok'); process.exit(0)"`
Expected: `ok`

- [ ] **Step 8: Commit**

```bash
git add server/services/leadIntake.js server/services/inboundRuntime.js test/leadIntake.test.js server/routes/webhooks.js
git commit -m "refactor: getOrCreateLead e autoDetectStage movidos para leadIntake com testes"
```

---

### Task 9: `inboundHandler.js` — regra de negócio do recebimento (bloco movido) e status de entrega

**Files:**
- Create: `server/services/inboundHandler.js`
- Modify: `server/services/inboundRuntime.js` (ligar o handler)
- Test: `test/inboundHandler.test.js`

**Interfaces:**
- Consumes: `createLeadIntake` (Task 8); `NormalizedMessage`/`NormalizedStatus` e `createEvolutionAdapter().parseWebhook` (Task 4) nos testes.
- Produces:
  - `detectAdSource(ad: object|null): string|null` (copia `webhooks.js:370-383`)
  - `createInboundHandler(deps)` onde `deps = { db, broadcastSSE, triggerCapiForStageChange, getInstanceConfig, wasAutoMsgSentRecently, sendAutoMessage, shouldSendAway, processInboundMessage, pickFromRoulette, notifyAndOpenLead, getOrCreateLead, autoDetectStage, fetchAndSaveProfilePic }` (e `scheduleAiForInbound` se o plano do Copiloto já tiver entrado) → `{ handleInboundMessage, handleStatusUpdate }`
  - `handleInboundMessage(account, waInstance, normalized, opts?: { source?: 'webhook'|'polling', req?: { headers, ip } }): { ok: true, blocked?: true, restricted?: true }` (síncrono, como o handler atual)
  - `handleStatusUpdate(account, waInstance, statuses: NormalizedStatus[]): number` (quantas mensagens mudaram)
  - `inboundRuntime.js`: `export const handleInboundMessage`, `export const handleStatusUpdate`

**Regra de extração ("mover bloco sem alterar"):** o corpo de `handleInboundMessage` é o trecho `server/routes/webhooks.js:422-708` recortado **do arquivo atual** (não deste plano), com só duas trocas mecânicas: `return res.json(X)` → `return X` e `res.json({ ok: true })` final → `return { ok: true }`. As variáveis que o bloco usa (`fromMe`, `msgId`, `pushName`, `timestamp`, `content`, `mediaType`, `mediaUrl`, `adInfo`, `adSourceLabel`, `phone`, `dedupJid`, `isLid`, `leadName`, `waInstance`, `account`, `req`) são declaradas antes do bloco a partir de `normalized`, com os mesmos nomes, e as dependências são desestruturadas com os mesmos nomes dos imports atuais — por isso nenhuma linha do bloco muda.

**ATENÇÃO — plano do Copiloto em paralelo:** ele troca a chamada da IA (hoje `webhooks.js:685-693`, `processInboundMessage(freshLead, content || '', mediaType, waInstance?.id || null)`) por uma chamada a `scheduleAiForInbound(lead, content, mediaType, instanceId)` de `server/services/copilotScheduler.js`. Ao executar esta tarefa:
- Se `webhooks.js` **ainda** tiver `processInboundMessage` nesse ponto: mover como está (código abaixo).
- Se **já** tiver `scheduleAiForInbound`: mover a linha nova exatamente como está, acrescentar `scheduleAiForInbound` à desestruturação de `deps` e, na Task 10, importar `scheduleAiForInbound` de `./copilotScheduler.js` no `inboundRuntime.js` e passá-lo em `deps`. Os testes abaixo já fornecem os dois fakes (`processInboundMessage` e `scheduleAiForInbound`) gravando no mesmo array, então passam nos dois casos.
- Nunca reescrever a lógica da IA nesta tarefa; qualquer divergência além dessa linha deve ser reportada antes de seguir.

- [ ] **Step 1: Escrever o teste de regressão que falha**

Criar `test/inboundHandler.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { createInboundHandler, detectAdSource } from '../server/services/inboundHandler.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede nos testes') } })
const tick = () => new Promise(r => setImmediate(r))

function setup(seedOpts = {}, depOverrides = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, seedOpts)
  const calls = { sse: [], capi: [], ai: [], handoff: [], profilePic: [], autoMsg: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: () => null,
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
  })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: (...a) => { calls.autoMsg.push(a); return Promise.resolve() },
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    scheduleAiForInbound: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => null,
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: (...a) => { calls.profilePic.push(a); return Promise.resolve() },
    ...depOverrides,
  })
  const receive = (payload, opts = {}) => {
    const { messages } = adapter.parseWebhook(seed.instance, payload, {})
    assert.equal(messages.length, 1)
    return handler.handleInboundMessage(seed.account, seed.instance, messages[0], { source: 'webhook', ...opts })
  }
  return { db, seed, calls, handler, receive }
}

const leads = (db) => db.prepare('SELECT * FROM leads ORDER BY id').all()
const msgs = (db) => db.prepare('SELECT * FROM messages ORDER BY id').all()

test('texto de lead novo: lead, mensagem, contadores, atribuicao, SSE, CAPI, IA e foto', async () => {
  const { db, seed, calls, receive } = setup()
  const r = receive(P.textConversation, { req: { headers: { 'x-forwarded-for': '127.0.0.1' }, ip: '127.0.0.1' } })
  assert.deepEqual(r, { ok: true })
  const [lead] = leads(db)
  assert.equal(lead.name, 'Maria Silva')
  assert.equal(lead.phone, '5547991351835')
  assert.equal(lead.source, 'whatsapp')
  assert.equal(lead.wa_remote_jid, '5547991351835@s.whatsapp.net')
  assert.equal(lead.instance_id, seed.instance.id)
  assert.equal(lead.last_instance_id, seed.instance.id)
  assert.equal(lead.stage_id, seed.stage1)
  assert.equal(lead.unread_count, 1)
  assert.ok(lead.last_inbound_at)
  assert.equal(lead.client_ip_address, null)
  const [m] = msgs(db)
  assert.deepEqual(
    { direction: m.direction, content: m.content, media_type: m.media_type, media_url: m.media_url, sender_name: m.sender_name, wa_msg_id: m.wa_msg_id, wa_timestamp: m.wa_timestamp, instance_id: m.instance_id, account_id: m.account_id },
    { direction: 'inbound', content: 'Oi, quero saber o preco', media_type: 'text', media_url: null, sender_name: 'Maria Silva', wa_msg_id: '3EB0A1B2C3D4E5F60001', wa_timestamp: P.TS_ISO, instance_id: seed.instance.id, account_id: seed.account.id },
  )
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lead_instance_assignments WHERE lead_id = ? AND instance_id = ?').get(lead.id, seed.instance.id).n, 1)
  assert.deepEqual(calls.capi, [[lead.id, seed.stage1, null]])
  assert.equal(calls.sse[0][1], 'lead:created')
  assert.deepEqual(calls.profilePic, [[seed.instance, '5547991351835', lead.id]])
  await tick()
  assert.equal(calls.ai.length, 1)
  assert.equal(calls.ai[0][0].id, lead.id)
  assert.equal(calls.ai[0][1], 'Oi, quero saber o preco')
  assert.equal(calls.ai[0][2], 'text')
  assert.equal(calls.ai[0][3], seed.instance.id)
})

test('mesma mensagem duas vezes: nao duplica, mas a segunda conta como resposta (avanca etapa) como hoje', () => {
  const { db, seed, receive } = setup()
  receive(P.textConversation)
  receive(P.textConversation)
  assert.equal(msgs(db).length, 1)
  const [lead] = leads(db)
  assert.equal(lead.stage_id, seed.stage2)
  assert.equal(lead.unread_count, 1)
})

test('lead existente responde: sai de Novo Lead para Em Atendimento com CAPI', () => {
  const { db, seed, calls, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', name: '5547991351835', source: 'whatsapp' })
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.stage_id, seed.stage2)
  assert.equal(row.name, 'Maria Silva')
  const h = db.prepare("SELECT * FROM stage_history WHERE lead_id = ? AND trigger_type = 'webhook'").get(lead.id)
  assert.deepEqual(calls.capi.at(-1), [lead.id, seed.stage2, h.id])
})

test('audio: media_type audio, conteudo [Audio], media_url e IA com mediaType audio', async () => {
  const { db, calls, receive } = setup()
  receive(P.audioPtt)
  const [m] = msgs(db)
  assert.equal(m.media_type, 'audio')
  assert.equal(m.content, '[Audio]')
  assert.equal(m.media_url, 'https://mmg.whatsapp.net/v/t62.7117-24/audio-0003.enc')
  await tick()
  assert.equal(calls.ai[0][2], 'audio')
})

test('imagem, documento, reacao e apagada gravam o mesmo que o webhook atual', () => {
  const { db, receive } = setup()
  receive(P.imageWithCaption)
  receive(P.documentPdf)
  receive(P.reaction)
  receive(P.revoke)
  assert.deepEqual(msgs(db).map(m => [m.media_type, m.content]), [
    ['image', 'Esse modelo'],
    ['document', 'orcamento.pdf'],
    ['reaction', '\u{1F44D} (reacao)'],
    ['system', '\u{1F6AB} Mensagem apagada'],
  ])
})

test('mensagem enviada pelo celular (fromMe): outbound, sem contador, sem IA, palavra-chave avanca etapa', async () => {
  const { db, seed, calls, receive } = setup({ stage2Keywords: JSON.stringify(['proposta']) })
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835', name: 'Maria', source: 'whatsapp' })
  receive(P.outboundFromMe)
  const [m] = msgs(db)
  assert.equal(m.direction, 'outbound')
  assert.equal(m.sender_name, '')
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.unread_count, 0)
  assert.equal(row.name, 'Maria')
  assert.equal(row.stage_id, seed.stage2)
  await tick()
  assert.equal(calls.ai.length, 0)
})

test('anuncio CTWA em lead novo: fonte Facebook Pago, ctwa_clid, trabalha_anuncio; sem source_detail', () => {
  const { db, receive } = setup()
  receive(P.ctwaAd)
  const [lead] = leads(db)
  assert.equal(lead.source, 'Facebook Pago')
  assert.equal(lead.ctwa_clid, 'Afc123XYZ')
  assert.equal(lead.trabalha_anuncio, 1)
  assert.equal(lead.source_detail, null)
})

test('anuncio CTWA em lead existente com fonte whatsapp: atualiza fonte e detalhe', () => {
  const { db, seed, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547977776666', name: 'Carla', source: 'whatsapp' })
  receive(P.ctwaAd)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.source, 'Facebook Pago')
  assert.equal(row.source_detail, 'Pilates experimental — Agende sua aula')
})

test('detectAdSource', () => {
  assert.equal(detectAdSource(null), null)
  assert.equal(detectAdSource({ sourceUrl: 'https://www.instagram.com/p/x' }), 'Instagram')
  assert.equal(detectAdSource({ sourceType: 'ad', sourceUrl: 'https://fb.me/x' }), 'Facebook Pago')
  assert.equal(detectAdSource({ ctwaClid: 'abc' }), 'Meta Pago')
  assert.equal(detectAdSource({ sourceUrl: 'https://google.com' }), null)
})

test('@lid com pushName cria lead sem telefone; lead existente com mesmo nome recebe o LID', () => {
  const a = setup()
  a.receive(P.lidWithPushName)
  const [novo] = leads(a.db)
  assert.equal(novo.phone, null)
  assert.equal(novo.wa_remote_jid, '123456789012345@lid')
  assert.equal(novo.name, 'Joao Lid')

  const b = setup()
  const existente = insertLead(b.db, { account_id: b.seed.account.id, funnel_id: b.seed.funnelId, stage_id: b.seed.stage1, phone: '5547955554444', name: 'Joao Lid', source: 'whatsapp' })
  b.receive(P.lidWithPushName)
  assert.equal(leads(b.db).length, 1)
  assert.equal(b.db.prepare('SELECT wa_remote_jid FROM leads WHERE id = ?').get(existente.id).wa_remote_jid, '123456789012345@lid')
})

test('lead bloqueado e instancia restrita nao gravam nada', () => {
  const a = setup()
  insertLead(a.db, { account_id: a.seed.account.id, funnel_id: a.seed.funnelId, stage_id: a.seed.stage1, phone: '5547991351835', is_blocked: 1 })
  assert.deepEqual(a.receive(P.textConversation), { ok: true, blocked: true })
  assert.equal(msgs(a.db).length, 0)

  const b = setup({ intakeMode: 'restricted' })
  assert.deepEqual(b.receive(P.textConversation), { ok: true, restricted: true })
  assert.equal(leads(b.db).length, 0)
})

test('lead arquivado: grava, nao desarquiva, nao soma contador, SSE de atividade arquivada', () => {
  const { db, seed, calls, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage2, phone: '5547991351835', name: 'Maria', source: 'whatsapp', is_archived: 1 })
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.is_archived, 1)
  assert.equal(row.has_new_after_archive, 1)
  assert.equal(row.unread_count, 0)
  assert.ok(row.last_inbound_at)
  assert.equal(msgs(db).length, 1)
  assert.equal(calls.sse.at(-1)[1], 'lead:archived-activity')
})

test('resposta do lead cancela follow-up com stop_on_reply', () => {
  const { db, seed, receive } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage2, phone: '5547991351835', name: 'Maria', source: 'whatsapp' })
  const fu = db.prepare('INSERT INTO follow_ups (account_id, instance_id, stop_on_reply) VALUES (?, ?, 1)').run(seed.account.id, seed.instance.id).lastInsertRowid
  const lfu = db.prepare("INSERT INTO lead_follow_ups (lead_id, follow_up_id, status, next_run_at) VALUES (?, ?, 'active', datetime('now'))").run(lead.id, fu).lastInsertRowid
  receive(P.textConversation)
  const row = db.prepare('SELECT * FROM lead_follow_ups WHERE id = ?').get(lfu)
  assert.equal(row.status, 'cancelled')
  assert.equal(row.paused_reason, 'lead_replied')
  assert.equal(row.next_run_at, null)
})

test('handleStatusUpdate: promove, nunca regride e respeita a conta', () => {
  const { db, seed, calls, handler } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id, delivery_status) VALUES (?, ?, 'outbound', 'x', ?, 'sent')")
  const own = ins.run(lead.id, seed.account.id, 'BAE5OUTBOUND0001').lastInsertRowid
  const alheia = ins.run(lead.id, 999, 'BAE5OUTBOUND0009').lastInsertRowid

  const parsed = adapter.parseWebhook(seed.instance, P.statusUpdateRead, {})
  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, parsed.statuses), 1)
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(own)
  assert.equal(row.delivery_status, 'read')
  assert.ok(row.read_at)
  assert.deepEqual(calls.sse.at(-1), [seed.account.id, 'message:status', { message_id: own, lead_id: lead.id, status: 'read' }])

  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, [{ messageId: 'BAE5OUTBOUND0001', status: 'delivered', timestamp: 'x' }]), 0)
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(own).delivery_status, 'read')

  assert.equal(handler.handleStatusUpdate(seed.account, seed.instance, [{ messageId: 'BAE5OUTBOUND0009', status: 'read', timestamp: 'x' }]), 0)
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(alheia).delivery_status, 'sent')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/inboundHandler.js`.

- [ ] **Step 3: Implementar `inboundHandler.js`**

Criar `server/services/inboundHandler.js`. Entre as marcas `INICIO DO BLOCO MOVIDO` e `FIM DO BLOCO MOVIDO` vai o recorte de `server/routes/webhooks.js:422-708` do arquivo atual, só com as trocas `return res.json(X)` → `return X`. O código abaixo é esse recorte como está hoje:

```js
// Regra de negocio do recebimento de mensagens de WhatsApp, independente do provedor.
// Movida de routes/webhooks.js (bloco 422-708 e status 197-225). Dependencias injetadas para teste.

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 }

// Copia de webhooks.js:370-383
export function detectAdSource(ad) {
  if (!ad) return null
  const src = String(ad.sourceType || '').toLowerCase()
  const url = String(ad.sourceUrl || '').toLowerCase()
  const isPaid = src === 'ad' || src === 'cta_url' || !!ad.ctwaClid
  let platform = ''
  if (url.includes('instagram')) platform = 'Instagram'
  else if (url.includes('facebook') || url.includes('fb.') || url.includes('fb.me')) platform = 'Facebook'
  if (!platform && ad.ctwaClid) platform = 'Meta'
  if (!platform) return null
  return isPaid ? `${platform} Pago` : platform
}

export function createInboundHandler(deps) {
  const {
    db,
    broadcastSSE,
    triggerCapiForStageChange,
    getInstanceConfig,
    wasAutoMsgSentRecently,
    sendAutoMessage,
    shouldSendAway,
    processInboundMessage,
    pickFromRoulette,
    notifyAndOpenLead,
    getOrCreateLead,
    autoDetectStage,
    fetchAndSaveProfilePic,
  } = deps

  // Callback de status (delivered/read). Idempotente: nunca regride (read > delivered > sent).
  function handleStatusUpdate(account, waInstance, statuses) {
    let changed = 0
    for (const s of statuses || []) {
      const newStatus = s.status
      let timestampCol = null
      if (newStatus === 'delivered') timestampCol = 'delivered_at'
      else if (newStatus === 'read') timestampCol = 'read_at'
      else if (newStatus !== 'sent') continue
      const msg = db.prepare('SELECT id, lead_id, account_id, delivery_status FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(s.messageId, account.id)
      if (!msg) continue
      if ((STATUS_RANK[newStatus] || 0) <= (STATUS_RANK[msg.delivery_status] || 0)) continue
      const sets = ['delivery_status = ?']
      const params = [newStatus]
      if (timestampCol) sets.push(`${timestampCol} = COALESCE(${timestampCol}, datetime('now'))`)
      params.push(msg.id)
      db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
      changed++
      try { broadcastSSE(msg.account_id, 'message:status', { message_id: msg.id, lead_id: msg.lead_id, status: newStatus }) } catch {}
    }
    return changed
  }

  function handleInboundMessage(account, waInstance, normalized, opts = {}) {
    // Variaveis com os mesmos nomes usados pelo bloco original
    const req = opts.req || { headers: {}, ip: undefined }
    const fromMe = !!normalized.fromMe
    const msgId = normalized.messageId || ''
    const pushName = normalized.pushName || ''
    const timestamp = normalized.timestamp
    const content = normalized.text || ''
    const mediaType = normalized.type
    const mediaUrl = normalized.mediaRef == null ? null : normalized.mediaRef
    const phone = normalized.phone
    const dedupJid = normalized.remoteId
    const isLid = String(dedupJid || '').endsWith('@lid')
    const adInfo = normalized.adReferral || null
    const adSourceLabel = detectAdSource(adInfo)
    // Quando fromMe=true, o pushName e o nome de quem ENVIOU (atendente), nao do lead.
    const leadName = fromMe ? '' : pushName

    // ───────── INICIO DO BLOCO MOVIDO (webhooks.js:422-708) ─────────
    // Get or create lead
    let lead, isNew
    if (isLid) {
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ?').get(account.id, dedupJid)
      if (!lead && leadName) {
        lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ?').get(account.id, leadName)
        if (lead) {
          db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
        }
      }
      if (!lead && fromMe) {
        return { ok: true }
      }
      if (!lead) {
        const sourceForNew = adSourceLabel || 'whatsapp'
        const r = getOrCreateLead(account.id, null, leadName, sourceForNew, dedupJid, waInstance?.id || null)
        if (r.blocked) {
          console.log(`[Webhook] Msg ignorada — phone bloqueado na conta ${account.slug}`)
          return { ok: true, blocked: true }
        }
        if (r.restricted) {
          console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (lead novo nao processado)`)
          return { ok: true, restricted: true }
        }
        lead = r.lead; isNew = r.isNew
      } else {
        if (lead.is_blocked) {
          console.log(`[Webhook] Msg ignorada — lead ${lead.id} bloqueado na conta ${account.slug}`)
          return { ok: true, blocked: true }
        }
        if (lead.is_archived && !fromMe) {
          db.prepare("UPDATE leads SET has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
        }
        isNew = false
      }
    } else {
      const sourceForNew = adSourceLabel || 'whatsapp'
      const r = getOrCreateLead(account.id, phone, leadName, sourceForNew, dedupJid, waInstance?.id || null)
      if (r.blocked) {
        console.log(`[Webhook] Msg ignorada — phone ${phone} bloqueado na conta ${account.slug}`)
        return { ok: true, blocked: true }
      }
      if (r.restricted) {
        console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (phone ${phone} nao cadastrado)`)
        return { ok: true, restricted: true }
      }
      lead = r.lead; isNew = r.isNew
    }
    if (!lead) return { ok: true }

    if (adSourceLabel && lead.source === 'whatsapp') {
      db.prepare("UPDATE leads SET source = ? WHERE id = ?").run(adSourceLabel, lead.id)
      if (adInfo?.title || adInfo?.body) {
        const detail = [adInfo.title, adInfo.body].filter(Boolean).join(' — ').substring(0, 250)
        db.prepare("UPDATE leads SET source_detail = COALESCE(source_detail, ?) WHERE id = ?").run(detail, lead.id)
      }
    }

    if (adInfo?.ctwaClid && !lead.ctwa_clid) {
      db.prepare("UPDATE leads SET ctwa_clid = ? WHERE id = ?").run(adInfo.ctwaClid, lead.id)
      lead.ctwa_clid = adInfo.ctwaClid
    }

    if (adInfo) {
      const adSrcType = String(adInfo.sourceType || '').toLowerCase()
      const adSrcUrl = String(adInfo.sourceUrl || '').toLowerCase()
      const isFromAd = !!(
        adInfo.ctwaClid ||
        adSrcType === 'ad' || adSrcType === 'cta_url' ||
        /facebook|instagram|fb\.|fb\.me|google|meta/.test(adSrcUrl)
      )
      if (isFromAd) {
        db.prepare('UPDATE leads SET trabalha_anuncio = 1 WHERE id = ? AND (trabalha_anuncio IS NULL OR trabalha_anuncio = 0)').run(lead.id)
      }
    }

    if (isNew || !lead.client_ip_address) {
      const reqIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip
      if (isNew) console.log(`[IP DEBUG] lead=${lead.id} xff=${req.headers['x-forwarded-for'] || 'none'} xri=${req.headers['x-real-ip'] || 'none'} req.ip=${req.ip}`)
      if (reqIp && reqIp !== '::1' && reqIp !== '127.0.0.1' && !reqIp.startsWith('::ffff:127.')) {
        db.prepare("UPDATE leads SET client_ip_address = COALESCE(client_ip_address, ?) WHERE id = ?").run(reqIp, lead.id)
        lead.client_ip_address = reqIp
      }
    }

    if (isNew) {
      triggerCapiForStageChange(lead.id, lead.stage_id, null)
    }

    if (!fromMe && waInstance) {
      try {
        const autoCfg = getInstanceConfig(waInstance.id)
        if (autoCfg) {
          if (isNew && autoCfg.greeting_enabled && autoCfg.greeting_text) {
            const greetCooldown = autoCfg.greeting_cooldown_hours || 24
            if (!wasAutoMsgSentRecently(lead.id, 'greeting', greetCooldown)) {
              setTimeout(() => {
                sendAutoMessage({
                  leadId: lead.id,
                  instanceId: waInstance.id,
                  type: 'greeting',
                  text: autoCfg.greeting_text,
                  accountId: account.id,
                }).catch(e => console.error('[AutoMsg greeting] async:', e?.message))
              }, 2000)
            }
          }
          if (autoCfg.away_text && shouldSendAway(autoCfg, new Date())) {
            const cooldown = autoCfg.away_cooldown_hours || 4
            if (!wasAutoMsgSentRecently(lead.id, 'away', cooldown)) {
              setTimeout(() => {
                sendAutoMessage({
                  leadId: lead.id,
                  instanceId: waInstance.id,
                  type: 'away',
                  text: autoCfg.away_text,
                  accountId: account.id,
                }).catch(e => console.error('[AutoMsg away] async:', e?.message))
              }, 1000)
            }
          }
        }
      } catch (e) {
        console.error('[AutoMsg] erro no hook:', e?.message)
      }
    }

    if (waInstance && (isNew || !lead.profile_pic_url)) {
      fetchAndSaveProfilePic(waInstance, phone, lead.id)
    }

    if (!isNew && !fromMe) {
      const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(lead.funnel_id)
      const secondStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1 OFFSET 1').get(lead.funnel_id)
      if (firstStage && secondStage && lead.stage_id === firstStage.id) {
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(secondStage.id, lead.id)
        const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
          lead.id, firstStage.id, secondStage.id, 'webhook'
        )
        triggerCapiForStageChange(lead.id, secondStage.id, histRes.lastInsertRowid)
      }
    }

    const existing = msgId ? db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(msgId) : null
    if (!existing) {
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, media_type, media_url, sender_name, wa_msg_id, wa_timestamp, instance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, mediaUrl, fromMe ? '' : pushName, msgId || null, timestamp, waInstance?.id || null)
      if (!fromMe) {
        if (!lead.is_archived) {
          db.prepare("UPDATE leads SET unread_count = unread_count + 1, last_inbound_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(lead.id)
        } else {
          db.prepare("UPDATE leads SET last_inbound_at = datetime('now') WHERE id = ?").run(lead.id)
        }
      }
      if (waInstance?.id) {
        db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(waInstance.id, lead.id)
        db.prepare(`
          INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
          VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
        `).run(lead.id, waInstance.id, waInstance.id)
      }
    }

    if (fromMe && content) autoDetectStage(lead, content)

    if (!fromMe && lead) {
      const activeFu = db.prepare(`
        SELECT lfu.id, fu.on_reply_action, fu.on_reply_user_id, fu.on_reply_move_to_stage_id, fu.on_reply_add_tag_id, fu.instance_id
        FROM lead_follow_ups lfu
        JOIN follow_ups fu ON fu.id = lfu.follow_up_id
        WHERE lfu.lead_id = ? AND lfu.status = 'active' AND fu.stop_on_reply = 1
        LIMIT 1
      `).get(lead.id)
      if (activeFu) {
        db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason='lead_replied', current_step_id=NULL, next_run_at=NULL, updated_at=datetime('now') WHERE id=?").run(activeFu.id)
        console.log(`[FollowUp] Cancelado lead=${lead.id} (respondeu)`)

        const action = activeFu.on_reply_action || 'pause'
        let newAttendantId = null
        if (action === 'assign_user' && activeFu.on_reply_user_id) {
          const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(activeFu.on_reply_user_id)
          if (u) newAttendantId = u.id
        } else if (action === 'roulette') {
          newAttendantId = pickFromRoulette(account.id, activeFu.instance_id)
        }
        if (newAttendantId) {
          const newUser = db.prepare('SELECT is_bot FROM users WHERE id = ?').get(newAttendantId)
          const clearAi = newUser?.is_bot === 1 ? ", ai_handed_off_at = NULL" : ""
          db.prepare(`UPDATE leads SET attendant_id = ?${clearAi}, updated_at = datetime('now') WHERE id = ?`).run(newAttendantId, lead.id)
          try { broadcastSSE(account.id, 'lead:updated', { id: lead.id }) } catch {}
          console.log(`[FollowUp] Reatribuido lead=${lead.id} -> user=${newAttendantId} (action=${action})`)
          if (newUser?.is_bot !== 1) {
            setImmediate(() => {
              notifyAndOpenLead(lead.id, newAttendantId, { source: 'followup_reply' })
                .catch(e => console.error('[Handoff followup]', e.message))
            })
          }
        }

        if (activeFu.on_reply_move_to_stage_id) {
          const freshLead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(lead.id)
          if (freshLead && freshLead.stage_id !== activeFu.on_reply_move_to_stage_id) {
            const prev = freshLead.stage_id
            db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(activeFu.on_reply_move_to_stage_id, lead.id)
            const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(lead.id, prev, activeFu.on_reply_move_to_stage_id, 'followup_reply')
            try { triggerCapiForStageChange(lead.id, activeFu.on_reply_move_to_stage_id, histRes.lastInsertRowid) } catch (e) { console.error('[FollowUp CAPI]', e.message) }
            console.log(`[FollowUp] Stage lead=${lead.id} ${prev} -> ${activeFu.on_reply_move_to_stage_id}`)
          }
        }

        if (activeFu.on_reply_add_tag_id) {
          db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, activeFu.on_reply_add_tag_id)
          console.log(`[FollowUp] Tag adicionada lead=${lead.id} tag=${activeFu.on_reply_add_tag_id}`)
        }
      }
    }

    if (leadName && (!lead.name || lead.name === lead.phone || lead.name === 'Sem nome')) {
      db.prepare('UPDATE leads SET name = ? WHERE id = ?').run(leadName, lead.id)
    }

    // AI Agent: plug fire-and-forget pra bot responder leads inbound (se conta tiver feature)
    // (linha que o plano do Copiloto troca por scheduleAiForInbound — mover como estiver no arquivo)
    if (!fromMe && lead && (content || mediaType === 'audio')) {
      const freshLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
      setImmediate(() => {
        processInboundMessage(freshLead, content || '', mediaType, waInstance?.id || null)
          .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
      })
    }

    if (isNew) {
      broadcastSSE(account.id, 'lead:created', db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id))
    } else {
      const current = db.prepare('SELECT is_archived FROM leads WHERE id = ?').get(lead.id)
      if (current?.is_archived) {
        if (!fromMe) {
          db.prepare('UPDATE leads SET has_new_after_archive = 1 WHERE id = ?').run(lead.id)
          try { broadcastSSE(account.id, 'lead:archived-activity', { id: lead.id }) } catch {}
        }
      } else {
        broadcastSSE(account.id, 'lead:message', { leadId: lead.id, message: content, direction: fromMe ? 'outbound' : 'inbound' })
      }
    }
    // ───────── FIM DO BLOCO MOVIDO ─────────

    return { ok: true }
  }

  return { handleInboundMessage, handleStatusUpdate }
}
```

Notas: (1) os comentários do bloco original foram encurtados neste plano por espaço; ao recortar do arquivo, mantenha-os. (2) Os `console.log` com `—` (travessão) são os mesmos de hoje. (3) Em `handleStatusUpdate`, a única mudança consciente é `AND account_id = ?` (ver "Decisões para validar" item 6). (4) No teste "texto de lead novo", o `x-forwarded-for` `127.0.0.1` reproduz o caso real (Evolution na mesma VPS) e por isso `client_ip_address` fica `null`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/inboundHandler.test.js` e em todos os anteriores. Se algum teste de regressão falhar, **não ajustar o teste**: comparar o bloco movido com `webhooks.js:422-708` e corrigir o recorte.

- [ ] **Step 5: Ligar o handler às dependências reais**

Substituir o conteúdo de `server/services/inboundRuntime.js` por:

```js
// Liga os servicos de entrada (leadIntake, inboundHandler) as dependencias reais (banco, SSE, CAPI, IA).
// Nao importar nos testes.
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { triggerCapiForStageChange } from './metaCapi.js'
import { pickFromRoulette } from './roulette.js'
import { notifyAndOpenLead } from './leadHandoff.js'
import { getInstanceConfig, wasAutoMsgSentRecently, sendAutoMessage, shouldSendAway } from './autoMessages.js'
import { processInboundMessage } from './aiAgent.js'
import { getProvider } from './whatsapp/index.js'
import { createLeadIntake } from './leadIntake.js'
import { createInboundHandler } from './inboundHandler.js'

export const leadIntake = createLeadIntake({ db, pickFromRoulette, notifyAndOpenLead, triggerCapiForStageChange })

// Foto de perfil em background (antes webhooks.js:14-27), agora pelo provedor.
async function fetchAndSaveProfilePic(instance, phone, leadId) {
  if (!instance || !phone || !leadId) return
  try {
    const provider = getProvider(instance)
    if (!provider.fetchProfilePictureUrl) return
    const url = await provider.fetchProfilePictureUrl(instance, phone)
    if (url) {
      db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(url, leadId)
    }
  } catch {}
}

const handler = createInboundHandler({
  db,
  broadcastSSE,
  triggerCapiForStageChange,
  getInstanceConfig,
  wasAutoMsgSentRecently,
  sendAutoMessage,
  shouldSendAway,
  processInboundMessage,
  pickFromRoulette,
  notifyAndOpenLead,
  getOrCreateLead: leadIntake.getOrCreateLead,
  autoDetectStage: leadIntake.autoDetectStage,
  fetchAndSaveProfilePic,
})

export const handleInboundMessage = handler.handleInboundMessage
export const handleStatusUpdate = handler.handleStatusUpdate
```

Se o Copiloto já tiver entrado (ver ATENÇÃO acima), acrescentar `import { scheduleAiForInbound } from './copilotScheduler.js'` e `scheduleAiForInbound,` no objeto passado a `createInboundHandler`.

- [ ] **Step 6: Conferir import**

Run: `node --input-type=module -e "const m = await import('./server/services/inboundRuntime.js'); console.log(typeof m.handleInboundMessage, typeof m.handleStatusUpdate); process.exit(0)"`
Expected: `function function`

- [ ] **Step 7: Commit**

```bash
git add server/services/inboundHandler.js server/services/inboundRuntime.js test/inboundHandler.test.js
git commit -m "refactor: regra de negocio do recebimento extraida para inboundHandler com regressao por payloads reais"
```

---

### Task 10: Webhook por token, rota antiga sem fallback e `webhooks.js` usando parse + handler

**Files:**
- Create: `server/services/whatsapp/webhookFlow.js`
- Modify: `server/routes/webhooks.js` — imports (topo), apagar `fetchAndSaveProfilePic` (antigas linhas 13-27) e substituir a rota `router.post('/evolution/:accountSlug', ...)` inteira (antigas linhas 170-715, do comentário `// Evolution API webhook` até o `})` antes de `// Meta Lead Form webhook`)
- Test: `test/webhookFlow.test.js`

**Interfaces:**
- Consumes: `isValidWebhookToken` (Task 2), `getProvider`/`parseWebhook` (Task 4), `handleInboundMessage`/`handleStatusUpdate`/`leadIntake` de `inboundRuntime.js` (Task 9).
- Produces:
  - `resolveInstanceByToken(db, token): { account, instance } | { status: 401|404, error: string }`
  - `resolveLegacyEvolutionInstance(db, accountSlug, body, headers): { account, instance } | { status: 401|404, error: string }` — sem fallback para a primeira instância; recusa instância com `provider` diferente de `evolution`; mantém a checagem de `webhook_secret`.
  - `processWebhook({ getProvider, handleInboundMessage, handleStatusUpdate }, account, instance, req): { ok: true, ... }`
  - Rotas: `POST /api/webhooks/whatsapp/:instanceToken` e `POST /api/webhooks/evolution/:accountSlug` (mesmo processamento). O `GET` de verificação da Meta fica para a fase 3.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/webhookFlow.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, TEST_TOKEN } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook } from '../server/services/whatsapp/webhookFlow.js'

test('token valido resolve instancia e conta', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const r = resolveInstanceByToken(db, TEST_TOKEN)
  assert.equal(r.instance.id, instance.id)
  assert.equal(r.account.id, account.id)
})

test('token com formato invalido ou inexistente devolve 401', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveInstanceByToken(db, 'abc'), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, 'b'.repeat(32)), { status: 401, error: 'Invalid webhook token' })
  assert.deepEqual(resolveInstanceByToken(db, undefined), { status: 401, error: 'Invalid webhook token' })
})

test('conta inativa devolve 404', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare('UPDATE accounts SET is_active = 0').run()
  assert.deepEqual(resolveInstanceByToken(db, TEST_TOKEN), { status: 404, error: 'Account not found' })
})

test('rota antiga: resolve pelo nome da instancia no corpo', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}).instance.id, instance.id)
  assert.equal(resolveLegacyEvolutionInstance(db, 'conta-teste', { instanceName: 'inst-teste' }, {}).instance.id, instance.id)
})

test('rota antiga: sem fallback para a primeira instancia da conta', () => {
  const db = createTestDb()
  seedBasic(db)
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'nao-existe' }, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', {}, {}), { status: 401, error: 'Unknown instance' })
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'outra-conta', { instance: 'inst-teste' }, {}), { status: 404, error: 'Account not found' })
})

test('rota antiga: webhook_secret e provedor', () => {
  const db = createTestDb()
  seedBasic(db)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = 's3cr3t'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Invalid webhook secret' })
  assert.ok(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, { 'x-webhook-secret': 's3cr3t' }).instance)
  db.prepare("UPDATE whatsapp_instances SET webhook_secret = NULL, provider = 'custom'").run()
  assert.deepEqual(resolveLegacyEvolutionInstance(db, 'conta-teste', { instance: 'inst-teste' }, {}), { status: 401, error: 'Unknown instance' })
})

function flowDeps() {
  const calls = { inbound: [], status: [] }
  const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede') } })
  return {
    calls,
    deps: {
      getProvider: () => adapter,
      handleInboundMessage: (account, instance, normalized, opts) => { calls.inbound.push({ normalized, opts }); return { ok: true } },
      handleStatusUpdate: (account, instance, statuses) => { calls.status.push(statuses); return statuses.length },
    },
  }
}

test('processWebhook: upsert chama o handler com source webhook e o req', () => {
  const { calls, deps } = flowDeps()
  const req = { body: P.textConversation, headers: { a: 1 }, ip: '1.2.3.4' }
  const r = processWebhook(deps, { id: 1 }, { id: 2 }, req)
  assert.deepEqual(r, { ok: true })
  assert.equal(calls.inbound.length, 1)
  assert.equal(calls.inbound[0].normalized.messageId, '3EB0A1B2C3D4E5F60001')
  assert.equal(calls.inbound[0].opts.source, 'webhook')
  assert.equal(calls.inbound[0].opts.req, req)
  assert.equal(calls.status.length, 0)
})

test('processWebhook: update chama so o status; grupo nao chama nada', () => {
  const a = flowDeps()
  assert.deepEqual(processWebhook(a.deps, { id: 1 }, { id: 2 }, { body: P.statusUpdateRead, headers: {} }), { ok: true })
  assert.equal(a.calls.status.length, 1)
  assert.equal(a.calls.inbound.length, 0)
  const b = flowDeps()
  assert.deepEqual(processWebhook(b.deps, { id: 1 }, { id: 2 }, { body: P.groupMessage, headers: {} }), { ok: true })
  assert.equal(b.calls.inbound.length + b.calls.status.length, 0)
})

test('processWebhook: devolve o resultado do handler (blocked/restricted)', () => {
  const { deps } = flowDeps()
  deps.handleInboundMessage = () => ({ ok: true, blocked: true })
  assert.deepEqual(processWebhook(deps, { id: 1 }, { id: 2 }, { body: P.textConversation, headers: {} }), { ok: true, blocked: true })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `server/services/whatsapp/webhookFlow.js`.

- [ ] **Step 3: Implementar `webhookFlow.js`**

Criar `server/services/whatsapp/webhookFlow.js`:

```js
// Recebimento de webhooks de WhatsApp: identifica a instancia e passa o corpo pelo parse do provedor + handler.
import { isValidWebhookToken } from './webhookToken.js'

// Rota nova: POST /api/webhooks/whatsapp/:instanceToken
export function resolveInstanceByToken(db, token) {
  if (!isValidWebhookToken(token)) return { status: 401, error: 'Invalid webhook token' }
  const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE webhook_token = ?').get(token)
  if (!instance) return { status: 401, error: 'Invalid webhook token' }
  const account = db.prepare('SELECT * FROM accounts WHERE id = ? AND is_active = 1').get(instance.account_id)
  if (!account) return { status: 404, error: 'Account not found' }
  return { account, instance }
}

// Rota antiga: POST /api/webhooks/evolution/:accountSlug — SEM fallback para a primeira instancia da conta.
export function resolveLegacyEvolutionInstance(db, accountSlug, body, headers) {
  const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(accountSlug)
  if (!account) return { status: 404, error: 'Account not found' }
  const name = body?.instance || body?.instanceName || null
  const instance = name
    ? db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(account.id, name)
    : null
  if (!instance || (instance.provider || 'evolution') !== 'evolution') return { status: 401, error: 'Unknown instance' }
  if (instance.webhook_secret && headers?.['x-webhook-secret'] !== instance.webhook_secret) {
    return { status: 401, error: 'Invalid webhook secret' }
  }
  return { account, instance }
}

export function processWebhook({ getProvider, handleInboundMessage, handleStatusUpdate }, account, instance, req) {
  const provider = getProvider(instance)
  const parsed = provider.parseWebhook(instance, req.body || {}, req.headers || {})
  if (parsed.statuses.length > 0) {
    try {
      handleStatusUpdate(account, instance, parsed.statuses)
    } catch (e) {
      console.error('[Webhook messages.update]', e.message)
    }
  }
  let result = { ok: true }
  for (const normalized of parsed.messages) {
    result = handleInboundMessage(account, instance, normalized, { source: 'webhook', req })
  }
  return result
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/webhookFlow.test.js` e todos os anteriores.

- [ ] **Step 5: Trocar as rotas em `webhooks.js`**

Antes de editar, rodar `git diff HEAD -- server/routes/webhooks.js` e `git log -3 -- server/routes/webhooks.js`: se o plano do Copiloto mexeu na chamada da IA depois da Task 9, confirmar que `inboundHandler.js` recebeu a mesma mudança antes de apagar o bloco daqui.

1. Imports do topo de `server/routes/webhooks.js` passam a ser:

```js
import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { triggerCapiForStageChange } from '../services/metaCapi.js'
import { sendBotWelcomeForSheetsLead } from '../services/aiAgent.js'
import { notifyAndOpenLead } from '../services/leadHandoff.js'
import { getProvider } from '../services/whatsapp/index.js'
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook } from '../services/whatsapp/webhookFlow.js'
import { leadIntake, handleInboundMessage, handleStatusUpdate } from '../services/inboundRuntime.js'
```

(`fetch` continua em uso pela rota `/meta-leads`; `broadcastSSE`, `triggerCapiForStageChange`, `sendBotWelcomeForSheetsLead` e `notifyAndOpenLead` continuam em uso por `/meta-leads`, `/site` e `/sheets`. Saem `getInstanceConfig`/`wasAutoMsgSentRecently`/`sendAutoMessage`/`shouldSendAway`, `processInboundMessage`, `pickFromRoulette` e `normalizePhone`, que só eram usados no bloco movido. Conferir com `Select-String -Path server/routes/webhooks.js -Pattern "pickFromRoulette|processInboundMessage|getInstanceConfig|normalizePhone"` → nenhuma ocorrência depois do passo 3.)

2. Apagar a função `fetchAndSaveProfilePic` (antigas linhas 13-27; agora vive em `inboundRuntime.js`).

3. Substituir a rota `router.post('/evolution/:accountSlug', ...)` inteira por:

```js
const webhookDeps = { getProvider, handleInboundMessage, handleStatusUpdate }

// WhatsApp webhook por numero (qualquer provedor). O token identifica a instancia; sem fallback.
router.post('/whatsapp/:instanceToken', (req, res) => {
  try {
    const r = resolveInstanceByToken(db, req.params.instanceToken)
    if (r.error) {
      console.warn(`[Webhook WhatsApp] ${r.status} ${r.error} ip=${req.ip}`)
      return res.status(r.status).json({ error: r.error })
    }
    return res.json(processWebhook(webhookDeps, r.account, r.instance, req))
  } catch (err) {
    console.error('[Webhook WhatsApp]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Evolution API webhook (URL antiga por conta). Mantida para instancias ainda nao reregistradas.
router.post('/evolution/:accountSlug', (req, res) => {
  try {
    const r = resolveLegacyEvolutionInstance(db, req.params.accountSlug, req.body || {}, req.headers || {})
    if (r.error) {
      console.warn(`[Webhook Evolution] ${r.status} ${r.error} account=${req.params.accountSlug} instance=${req.body?.instance || req.body?.instanceName || '-'}`)
      return res.status(r.status).json({ error: r.error })
    }
    return res.json(processWebhook(webhookDeps, r.account, r.instance, req))
  } catch (err) {
    console.error('[Webhook Evolution]', err.message)
    res.status(500).json({ error: err.message })
  }
})
```

4. Confirmar que a linha `const { getOrCreateLead, autoDetectStage } = leadIntake` (Task 8) continua logo abaixo de `const router = Router()`; `autoDetectStage` deixa de ser usado em `webhooks.js` — trocar a linha por `const { getOrCreateLead } = leadIntake`.

- [ ] **Step 6: Teste de fumaça da rota com o servidor local**

Run (terminal 1): `npm run dev:server`

Run (terminal 2):
```powershell
$tok = node --input-type=module -e "const m = await import('./server/db.js'); const r = m.default.prepare('SELECT webhook_token FROM whatsapp_instances LIMIT 1').get(); console.log(r ? r.webhook_token : ''); process.exit(0)"
Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/webhooks/whatsapp/$tok" -ContentType 'application/json' -Body '{"event":"connection.update","data":{"state":"open"}}'
try { Invoke-RestMethod -Method Post -Uri "http://localhost:3002/api/webhooks/whatsapp/abc" -ContentType 'application/json' -Body '{}' } catch { $_.Exception.Response.StatusCode.value__ }
try { Invoke-RestMethod -Method Post -Uri "http://localhost:3002/crm/api/webhooks/evolution/slug-que-nao-existe" -ContentType 'application/json' -Body '{}' } catch { $_.Exception.Response.StatusCode.value__ }
```
Expected: primeira chamada `ok : True` (se houver instância local; sem instância, pular), segunda `401`, terceira `404`. Encerrar o servidor.

- [ ] **Step 7: Commit**

```bash
git add server/services/whatsapp/webhookFlow.js test/webhookFlow.test.js server/routes/webhooks.js
git commit -m "fix: webhook de WhatsApp por token da instancia e rota antiga sem fallback para a primeira instancia"
```

---

### Task 11: Polling pelo mesmo parse e pelo handler, preservando o comportamento atual do polling

**Files:**
- Modify: `server/services/inboundHandler.js` (nova função `handlePolledMessage` e desvio no início de `handleInboundMessage`)
- Modify: `server/scheduler.js:1-11` (imports) e `:150-312` (`pollMissedMessages`)
- Test: `test/inboundPolling.test.js`

**Interfaces:**
- Consumes: `createInboundHandler` (Task 9), `parsePolledRecord`, `fetchRecentMessages`, `capabilities.polling` (Tasks 4-5), `getProvider`.
- Produces:
  - `handleInboundMessage(account, instance, normalized, { source: 'polling' })` → `{ ok: true, imported: true } | { ok: true, skipped: string } | { ok: true, blocked: true } | { ok: true, restricted: true }`
  - `scheduler.pollMissedMessages()` só para instâncias cujo provedor tem `capabilities.polling`.

**Decisão registrada para validação (ver "Decisões para validar" item 3):** o polling NÃO passa a se comportar como o webhook. `handlePolledMessage` é a lógica de `scheduler.js:180-303` movida: dedup por `wa_msg_id`, busca de lead por `wa_remote_jid OR phone`, bloqueio só em lead encontrado, LID por `pushName`, **desarquiva**, modo restrito, criação com `default_attendant_id` ou round-robin de `distribution_rules`, histórico `polling`, SSE `lead:created` + CAPI, grava a mensagem **sem** `media_url`, `last_instance_id`, atribuição e SSE `lead:message`. Não chama IA, auto-mensagem, parada de follow-up, `notifyAndOpenLead`, foto de perfil, avanço de etapa nem `unread_count`. Só importa os tipos que o polling importava (`text`, `image`, `video`, `audio`, `document`, `sticker`); reação e demais tipos continuam ignorados. O que muda por usar o parse único: legenda vira conteúdo de imagem/vídeo, textos editados/botões/temporárias entram como texto, `wa_timestamp` em ISO, e mensagens de `@lid` com `senderPn` em `key` também são reconhecidas.

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/inboundPolling.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as P from './fixtures/evolution-payloads.js'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createEvolutionAdapter } from '../server/services/whatsapp/evolution.js'
import { createLeadIntake } from '../server/services/leadIntake.js'
import { createInboundHandler } from '../server/services/inboundHandler.js'

const adapter = createEvolutionAdapter({ fetch: async () => { throw new Error('sem rede') } })
const tick = () => new Promise(r => setImmediate(r))

function setup(seedOpts = {}) {
  const db = createTestDb()
  const seed = seedBasic(db, seedOpts)
  const calls = { sse: [], capi: [], ai: [], handoff: [], profilePic: [], autoMsg: [], roulette: 0 }
  const intake = createLeadIntake({ db, pickFromRoulette: () => null, notifyAndOpenLead: () => Promise.resolve(), triggerCapiForStageChange: () => {} })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: (...a) => { calls.capi.push(a) },
    getInstanceConfig: () => { throw new Error('polling nao deve ler auto-mensagens') },
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: (...a) => { calls.autoMsg.push(a); return Promise.resolve() },
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    scheduleAiForInbound: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => { calls.roulette++; return 99 },
    notifyAndOpenLead: (...a) => { calls.handoff.push(a); return Promise.resolve() },
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: (...a) => { calls.profilePic.push(a); return Promise.resolve() },
  })
  const poll = (record, instance = seed.instance) => {
    const list = adapter.parsePolledRecord(instance, record)
    return list.map(n => handler.handleInboundMessage(seed.account, instance, n, { source: 'polling' }))
  }
  return { db, seed, calls, poll }
}

test('lead novo pelo polling: atendente padrao da instancia, historico polling, sem IA/handoff/foto/contador', async () => {
  const { db, seed, calls, poll } = setup({ defaultAttendantId: 5 })
  assert.deepEqual(poll(P.polledRecordText), [{ ok: true, imported: true }])
  const lead = db.prepare('SELECT * FROM leads').get()
  assert.equal(lead.name, 'Lia Polling')
  assert.equal(lead.phone, '5547966665555')
  assert.equal(lead.source, 'whatsapp')
  assert.equal(lead.attendant_id, 5)
  assert.equal(lead.wa_remote_jid, '5547966665555@s.whatsapp.net')
  assert.equal(lead.instance_id, seed.instance.id)
  assert.equal(lead.last_instance_id, seed.instance.id)
  assert.equal(lead.unread_count, 0)
  assert.equal(db.prepare('SELECT trigger_type FROM stage_history WHERE lead_id = ?').get(lead.id).trigger_type, 'polling')
  const m = db.prepare('SELECT * FROM messages').get()
  assert.deepEqual(
    { direction: m.direction, content: m.content, media_type: m.media_type, media_url: m.media_url, sender_name: m.sender_name, wa_msg_id: m.wa_msg_id, wa_timestamp: m.wa_timestamp },
    { direction: 'inbound', content: 'Mensagem perdida', media_type: 'text', media_url: null, sender_name: 'Lia Polling', wa_msg_id: '3EB0POLL00000001', wa_timestamp: P.TS_ISO },
  )
  assert.deepEqual(calls.sse.map(s => s[1]), ['lead:created', 'lead:message'])
  assert.deepEqual(calls.sse[1][2], { lead_id: lead.id })
  assert.equal(calls.capi.length, 1)
  assert.equal(calls.roulette, 0)
  await tick()
  assert.equal(calls.ai.length + calls.handoff.length + calls.profilePic.length + calls.autoMsg.length, 0)
})

test('sem atendente padrao usa round-robin de distribution_rules', () => {
  const { db, seed, poll } = setup()
  db.prepare("INSERT INTO distribution_rules (account_id, funnel_id, type, last_assigned_index, active_attendants) VALUES (?, ?, 'round_robin', 1, '[7,8]')").run(seed.account.id, seed.funnelId)
  poll(P.polledRecordText)
  assert.equal(db.prepare('SELECT attendant_id FROM leads').get().attendant_id, 8)
  assert.equal(db.prepare('SELECT last_assigned_index FROM distribution_rules').get().last_assigned_index, 2)
})

test('lead arquivado e desarquivado pelo polling (comportamento atual)', () => {
  const { db, seed, poll } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547966665555', name: 'Lia', source: 'whatsapp', is_archived: 1, archived_at: '2026-09-01 10:00:00' })
  poll(P.polledRecordText)
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
  assert.equal(row.is_archived, 0)
  assert.equal(row.archived_at, null)
  assert.equal(row.has_new_after_archive, 1)
  assert.equal(row.stage_id, seed.stage1)
  assert.equal(row.name, 'Lia')
})

test('reacao e mensagem ja gravada sao ignoradas', () => {
  const { db, poll } = setup()
  assert.deepEqual(poll(P.reaction.data), [{ ok: true, skipped: 'type_reaction' }])
  poll(P.polledRecordText)
  assert.deepEqual(poll(P.polledRecordText), [{ ok: true, skipped: 'exists' }])
  assert.equal(db.prepare('SELECT COUNT(*) n FROM messages').get().n, 1)
})

test('grupo nem chega ao handler; modo restrito e lead bloqueado nao gravam', () => {
  const a = setup()
  assert.deepEqual(a.poll(P.groupMessage.data), [])
  const b = setup({ intakeMode: 'restricted' })
  assert.deepEqual(b.poll(P.polledRecordText), [{ ok: true, restricted: true }])
  assert.equal(b.db.prepare('SELECT COUNT(*) n FROM leads').get().n, 0)
  const c = setup()
  insertLead(c.db, { account_id: c.seed.account.id, funnel_id: c.seed.funnelId, stage_id: c.seed.stage1, phone: '5547966665555', is_blocked: 1 })
  assert.deepEqual(c.poll(P.polledRecordText), [{ ok: true, blocked: true }])
  assert.equal(c.db.prepare('SELECT COUNT(*) n FROM messages').get().n, 0)
})

test('@lid com pushName liga ao lead de mesmo nome', () => {
  const { db, seed, poll } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547955554444', name: 'Joao Lid', source: 'whatsapp' })
  poll(P.lidWithPushName.data)
  assert.equal(db.prepare('SELECT wa_remote_jid FROM leads WHERE id = ?').get(lead.id).wa_remote_jid, '123456789012345@lid')
  assert.equal(db.prepare('SELECT lead_id FROM messages').get().lead_id, lead.id)
})

test('imagem: legenda vira conteudo e media_url nao e gravada no polling', () => {
  const { db, poll } = setup()
  poll(P.imageWithCaption.data)
  const m = db.prepare('SELECT media_type, content, media_url FROM messages').get()
  assert.deepEqual({ ...m }, { media_type: 'image', content: 'Esse modelo', media_url: null })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `test/inboundPolling.test.js` (o handler ainda trata como webhook: `getInstanceConfig` lança, resultado sem `imported`).

- [ ] **Step 3: Implementar `handlePolledMessage`**

Em `server/services/inboundHandler.js`:

1. Logo abaixo de `const STATUS_RANK = ...`, acrescentar:

```js
// Tipos que o polling ja importava (scheduler.js:213-222). Demais tipos continuam so pelo webhook.
const POLLING_IMPORTED_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker'])
```

2. Dentro de `createInboundHandler`, antes de `function handleInboundMessage`, acrescentar:

```js
  // Logica do polling movida de scheduler.js:180-303, preservada de proposito:
  // nao dispara IA, auto-mensagem, parada de follow-up, handoff, foto, avanco de etapa nem unread_count;
  // desarquiva o lead; distribui por default_attendant_id ou round-robin.
  function handlePolledMessage(account, inst, normalized) {
    const msgId = normalized.messageId
    if (!msgId) return { ok: true, skipped: 'no_id' }
    if (!POLLING_IMPORTED_TYPES.has(normalized.type)) return { ok: true, skipped: `type_${normalized.type}` }
    const exists = db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(msgId)
    if (exists) return { ok: true, skipped: 'exists' }

    const phone = normalized.phone
    const dedupJid = normalized.remoteId
    const isLid = String(dedupJid || '').endsWith('@lid')
    const fromMe = !!normalized.fromMe
    const pushName = normalized.pushName || ''
    const timestamp = normalized.timestamp || null
    const content = normalized.text || ''
    const mediaType = normalized.type
    if (!content && mediaType === 'text') return { ok: true, skipped: 'empty' }

    let lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND (wa_remote_jid = ? OR phone = ?) ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(account.id, dedupJid, phone)

    if (lead && lead.is_blocked) {
      console.log(`[Polling] Msg ignorada — lead ${lead.id} bloqueado`)
      return { ok: true, blocked: true }
    }

    if (!lead && isLid && pushName) {
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ? AND is_blocked = 0 ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(account.id, pushName)
      if (lead) {
        db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
      }
    }

    if (lead && lead.is_archived) {
      db.prepare("UPDATE leads SET is_archived = 0, archived_at = NULL, has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
      lead.is_archived = 0
      console.log(`[Polling] Desarquivado lead ${lead.id} (${lead.name}) — recebeu mensagem nova`)
    }

    if (!lead) {
      if (inst.lead_intake_mode === 'restricted') {
        console.log(`[Polling] Msg ignorada — instancia ${inst.instance_name} em modo restrito (lead novo nao criado)`)
        return { ok: true, restricted: true }
      }
      const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(account.id)
      if (!funnel) return { ok: true, skipped: 'no_funnel' }
      const stage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
      if (!stage) return { ok: true, skipped: 'no_stage' }
      const leadPhone = isLid ? null : phone

      let attendantId = inst.default_attendant_id || null
      if (!attendantId) {
        const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(account.id, funnel.id)
        if (rule && rule.type === 'round_robin' && rule.active_attendants) {
          try {
            const attendants = JSON.parse(rule.active_attendants)
            if (attendants.length > 0) {
              const idx = rule.last_assigned_index % attendants.length
              attendantId = attendants[idx]
              db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
            }
          } catch {}
        }
      }

      const result = db.prepare("INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").run(
        account.id, funnel.id, stage.id, attendantId, pushName || phone || 'Sem nome', leadPhone, 'whatsapp', dedupJid, inst.id
      )
      lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
      const histRes = db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(lead.id, stage.id, 'polling')
      broadcastSSE(account.id, 'lead:created', lead)
      triggerCapiForStageChange(lead.id, stage.id, histRes.lastInsertRowid)
    }

    db.prepare('INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, fromMe ? '' : pushName, msgId, timestamp, inst.id
    )
    db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(inst.id, lead.id)
    db.prepare(`
      INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
      VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
    `).run(lead.id, inst.id, inst.id)

    broadcastSSE(account.id, 'lead:message', { lead_id: lead.id })
    return { ok: true, imported: true }
  }
```

3. Na primeira linha do corpo de `handleInboundMessage` (antes de `const req = ...`), acrescentar:

```js
    if (opts.source === 'polling') return handlePolledMessage(account, waInstance, normalized)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/inboundPolling.test.js` e `test/inboundHandler.test.js` (o caminho do webhook não muda).

- [ ] **Step 5: `scheduler.js` usa provedor + handler**

1. Em `server/scheduler.js`, trocar a linha 7 (`import { triggerCapiForStageChange } from './services/metaCapi.js'`, único uso era o polling) por:

```js
import { getProvider } from './services/whatsapp/index.js'
import { handleInboundMessage } from './services/inboundRuntime.js'
```

2. Substituir a função inteira das linhas 150-312 (comentário `// ─── Polling backup: fetch missed messages from Evolution` até o fim de `pollMissedMessages`) por:

```js
// ─── Polling backup: busca mensagens perdidas nos provedores que suportam (Evolution) ────────
// Mesmo parse do webhook + handleInboundMessage com source 'polling' (logica do polling preservada no handler).
async function pollMissedMessages() {
  const instances = db.prepare("SELECT wi.*, a.id as acc_id, a.slug FROM whatsapp_instances wi JOIN accounts a ON a.id = wi.account_id WHERE wi.status = 'connected'").all()
  if (!instances.length) return

  for (const inst of instances) {
    try {
      let provider
      try { provider = getProvider(inst) } catch { continue }
      if (!provider.capabilities?.polling || !provider.fetchRecentMessages || !provider.parsePolledRecord) continue

      const messages = await provider.fetchRecentMessages(inst, { limit: 200 })
      if (!Array.isArray(messages)) continue

      const account = { id: inst.acc_id, slug: inst.slug }
      let imported = 0
      for (const m of messages) {
        for (const normalized of provider.parsePolledRecord(inst, m)) {
          const r = handleInboundMessage(account, inst, normalized, { source: 'polling' })
          if (r && r.imported) imported++
        }
      }

      if (imported > 0) console.log(`[Polling] ${inst.instance_name}: imported ${imported} missed messages`)
      else console.log(`[Polling] ${inst.instance_name}: ${messages.length} msgs checked, all synced`)
    } catch (err) {
      console.error(`[Polling] ${inst.instance_name}: error — ${err.message}`)
    }
  }
}
```

Nota: `SELECT wi.*, a.id as acc_id` mantém `inst.id` como id da instância (igual a hoje).

- [ ] **Step 6: Conferências**

Run: `npm test`
Expected: PASS em todos.

Run: `node --input-type=module -e "const m = await import('./server/scheduler.js'); console.log(typeof m.runPollNow); process.exit(0)"`
Expected: `function`

Run: `Select-String -Path server/scheduler.js -Pattern "normalizePhone|findMessages|triggerCapiForStageChange"`
Expected: nenhuma ocorrência.

- [ ] **Step 7: Commit**

```bash
git add server/services/inboundHandler.js server/scheduler.js test/inboundPolling.test.js
git commit -m "refactor: polling usa o parse do provedor e o inboundHandler preservando o comportamento atual"
```

---

### Task 12: Reregistro do webhook com a URL nova (2 eventos) e health por `api_url`

**Files:**
- Create: `server/services/whatsapp/webhookRegistration.js`
- Create: `server/services/whatsapp/evolutionHealth.js`
- Modify: `server/routes/integrations.js` — imports (topo), helper `registerEvolutionWebhook` (`:66-79`), criação (`:97-104`, `:120-135`), connect (`:175-177`), setup-webhook (`:388-401`)
- Modify: `server/scheduler.js` — `checkWhatsAppInstances` (`:16-30`) e `reRegisterWebhooks` (`:314-327`)
- Test: `test/webhookRegistration.test.js`

**Interfaces:**
- Consumes: `generateWebhookToken` (Task 2), `ensureWebhookToken` (Task 2), `buildInstanceWebhookUrl` (Task 3), `getProvider` + `registerWebhook` (Tasks 4-5).
- Produces:
  - `createWebhookRegistrar({ db, getProvider, env? })` → `{ registerInstanceWebhook(instance): Promise<{ ok: boolean, url: string|null, reason?: string }> }`
  - `apiUrlKey(apiUrl): string` e `checkApiUrlsAlive(instances, fetchImpl, { timeoutMs? }): Promise<Map<string, boolean>>` — `false` só quando a requisição à raiz lança (mesma regra de `scheduler.js:22-28`, que ignora o status HTTP).

- [ ] **Step 1: Escrever o teste que falha**

Criar `test/webhookRegistration.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, TEST_TOKEN } from './helpers/db.js'
import { createWebhookRegistrar } from '../server/services/whatsapp/webhookRegistration.js'
import { apiUrlKey, checkApiUrlsAlive } from '../server/services/whatsapp/evolutionHealth.js'

const env = { PUBLIC_BASE_URL: 'https://crm.exemplo.com/crm' }

test('registra a URL por token no provedor', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  const calls = []
  const provider = { registerWebhook: async (i, url) => { calls.push([i.id, url]) } }
  const r = await createWebhookRegistrar({ db, getProvider: () => provider, env }).registerInstanceWebhook(instance)
  assert.deepEqual(r, { ok: true, url: `https://crm.exemplo.com/crm/api/webhooks/whatsapp/${TEST_TOKEN}` })
  assert.deepEqual(calls, [[instance.id, r.url]])
})

test('gera token antes de registrar quando a instancia nao tem', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  db.prepare('UPDATE whatsapp_instances SET webhook_token = NULL WHERE id = ?').run(instance.id)
  const semToken = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id)
  const provider = { registerWebhook: async () => {} }
  const r = await createWebhookRegistrar({ db, getProvider: () => provider, env }).registerInstanceWebhook(semToken)
  const salvo = db.prepare('SELECT webhook_token FROM whatsapp_instances WHERE id = ?').get(instance.id).webhook_token
  assert.match(salvo, /^[a-f0-9]{32}$/)
  assert.equal(r.url, `https://crm.exemplo.com/crm/api/webhooks/whatsapp/${salvo}`)
})

test('provedor sem registerWebhook ou erro de rede nao lanca', async () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  const a = await createWebhookRegistrar({ db, getProvider: () => ({}), env }).registerInstanceWebhook(instance)
  assert.deepEqual(a, { ok: false, url: null, reason: 'provider_without_webhook_registration' })
  const b = await createWebhookRegistrar({ db, getProvider: () => ({ registerWebhook: async () => { throw new Error('ECONNREFUSED') } }), env }).registerInstanceWebhook(instance)
  assert.equal(b.ok, false)
  assert.equal(b.reason, 'ECONNREFUSED')
  assert.match(b.url, /\/api\/webhooks\/whatsapp\//)
})

test('apiUrlKey tira barras finais', () => {
  assert.equal(apiUrlKey('http://evo:8080///'), 'http://evo:8080')
  assert.equal(apiUrlKey(null), '')
})

test('checkApiUrlsAlive: uma chamada por URL; so excecao marca como fora do ar', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    if (url.startsWith('http://caiu')) throw new Error('ECONNREFUSED')
    return { ok: false, status: 500 }
  }
  const instances = [
    { api_url: 'http://evo-a:8080/' },
    { api_url: 'http://evo-a:8080' },
    { api_url: 'http://caiu:8080' },
    { api_url: '' },
  ]
  const alive = await checkApiUrlsAlive(instances, fakeFetch)
  assert.deepEqual(calls, ['http://evo-a:8080/', 'http://caiu:8080/'])
  assert.equal(alive.get('http://evo-a:8080'), true)
  assert.equal(alive.get('http://caiu:8080'), false)
  assert.equal(alive.has(''), false)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `webhookRegistration.js` e `evolutionHealth.js`.

- [ ] **Step 3: Implementar**

Criar `server/services/whatsapp/webhookRegistration.js`:

```js
// Registra no provedor o webhook exclusivo da instancia: <PUBLIC_BASE_URL>/api/webhooks/whatsapp/<webhook_token>.
// Usado na criacao/conexao da instancia (integrations.js) e no reregistro periodico (scheduler.js).
import { ensureWebhookToken } from './webhookToken.js'
import { buildInstanceWebhookUrl } from '../publicUrl.js'

export function createWebhookRegistrar({ db, getProvider, env = process.env }) {
  async function registerInstanceWebhook(instance) {
    let provider
    try { provider = getProvider(instance) } catch (e) { return { ok: false, url: null, reason: e.message } }
    if (!provider.registerWebhook) return { ok: false, url: null, reason: 'provider_without_webhook_registration' }
    const withToken = ensureWebhookToken(db, instance)
    const url = buildInstanceWebhookUrl(withToken, env)
    try {
      await provider.registerWebhook(withToken, url)
      return { ok: true, url }
    } catch (e) {
      return { ok: false, url, reason: e.message }
    }
  }
  return { registerInstanceWebhook }
}
```

Criar `server/services/whatsapp/evolutionHealth.js`:

```js
// Health da Evolution por URL da instancia (antes usava so process.env.EVOLUTION_API_URL).
export function apiUrlKey(apiUrl) {
  return String(apiUrl || '').replace(/\/+$/, '')
}

// Mesma regra de hoje: qualquer resposta HTTP conta como "no ar"; so erro de rede/timeout conta como fora.
export async function checkApiUrlsAlive(instances, fetchImpl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 5000
  const result = new Map()
  const bases = [...new Set((instances || []).map(i => apiUrlKey(i.api_url)).filter(Boolean))]
  for (const base of bases) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      await fetchImpl(`${base}/`, { signal: controller.signal })
      result.set(base, true)
    } catch {
      result.set(base, false)
    } finally {
      clearTimeout(timer)
    }
  }
  return result
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS em `test/webhookRegistration.test.js` e em todos os anteriores.

- [ ] **Step 5: `integrations.js` registra a URL nova**

1. Acrescentar aos imports do topo de `server/routes/integrations.js`:

```js
import { getProvider } from '../services/whatsapp/index.js'
import { generateWebhookToken } from '../services/whatsapp/schema.js'
import { createWebhookRegistrar } from '../services/whatsapp/webhookRegistration.js'
```

2. Substituir o helper `registerEvolutionWebhook` (linhas 66-79) por:

```js
// Helper: registra no provedor o webhook exclusivo da instancia (URL por token, MESSAGES_UPSERT + MESSAGES_UPDATE)
const webhookRegistrar = createWebhookRegistrar({ db, getProvider })
async function registerInstanceWebhook(instance) {
  const r = await webhookRegistrar.registerInstanceWebhook(instance)
  if (r.ok) console.log(`[Evolution Webhook] Set for ${instance.instance_name} → ${r.url}`)
  else console.error('[Evolution Webhook Setup]', instance.instance_name, r.reason)
  return r
}
```

3. No caminho de instância já existente (linhas 99-104), trocar:

```js
    db.prepare("UPDATE whatsapp_instances SET api_url = ?, api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, existing.id)
    await registerEvolutionWebhook(baseUrl, api_key, instance_name, account.slug)
    const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id)
    return res.json({ instance })
```

por:

```js
    db.prepare("UPDATE whatsapp_instances SET api_url = ?, api_key = ?, updated_at = datetime('now') WHERE id = ?").run(baseUrl, api_key, existing.id)
    const instance = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id)
    await registerInstanceWebhook(instance)
    return res.json({ instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id) })
```

4. No `INSERT` da criação (linhas 121-123), incluir o token:

```js
  const result = db.prepare(
    "INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, qr_code, lead_intake_mode, warmup_until, provider, webhook_token) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+3 days'), 'evolution', ?)"
  ).run(req.accountId, instance_name, baseUrl, api_key, qrCode ? 'connecting' : 'disconnected', qrCode, lead_intake_mode, generateWebhookToken())
```

5. Linha 135: trocar `await registerEvolutionWebhook(baseUrl, api_key, instance_name, account.slug)` por `await registerInstanceWebhook(instance)`.

6. Na rota connect (linhas 175-177), trocar:

```js
    const account = db.prepare('SELECT slug FROM accounts WHERE id = ?').get(instance.account_id)
    if (account?.slug) await registerEvolutionWebhook(instance.api_url, instance.api_key, instance.instance_name, account.slug)
```

por:

```js
    await registerInstanceWebhook(instance)
```

7. Substituir o corpo da rota `POST /whatsapp/:id/setup-webhook` (linhas 389-401) por:

```js
router.post('/whatsapp/:id/setup-webhook', requireRole('super_admin', 'gerente', 'atendente'), async (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const r = await registerInstanceWebhook(instance)
  if (!r.ok) return res.status(500).json({ error: r.reason || 'Falha ao registrar webhook', webhookUrl: r.url })
  res.json({ ok: true, webhookUrl: r.url })
})
```

(Mudança: antes o erro de rede era engolido e a rota respondia `ok`; agora responde 500 com o motivo, e o front já mostra `alert('Erro ao reconfigurar webhook: ...')` em `Integrations.tsx:238-240`.)

Run: `Select-String -Path server/routes/integrations.js -Pattern "registerEvolutionWebhook|drosagencia"`
Expected: nenhuma ocorrência.

- [ ] **Step 6: `scheduler.js` — health por URL e reregistro com URL nova**

1. Acrescentar aos imports de `server/scheduler.js` (junto dos adicionados na Task 11):

```js
import { createWebhookRegistrar } from './services/whatsapp/webhookRegistration.js'
import { apiUrlKey, checkApiUrlsAlive } from './services/whatsapp/evolutionHealth.js'
```

2. Substituir o início de `checkWhatsAppInstances` (linhas 17-31: do `async function checkWhatsAppInstances() {` até `for (const inst of instances) {`) por:

```js
async function checkWhatsAppInstances() {
  // Health por URL de cada instancia (antes: so process.env.EVOLUTION_API_URL). Gestao de sessao so existe na Evolution.
  const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status IN ('connected', 'connecting')").all()
    .filter(i => (i.provider || 'evolution') === 'evolution')
  const aliveByUrl = await checkApiUrlsAlive(instances, fetch)
  for (const [url, alive] of aliveByUrl) {
    if (!alive) console.error(`[Health] Evolution API is DOWN at ${url}/ — cannot check instances`)
  }

  for (const inst of instances) {
    if (!aliveByUrl.get(apiUrlKey(inst.api_url))) continue
```

(o restante do laço, das linhas 32-78, fica igual.)

3. Substituir `reRegisterWebhooks` (linhas 314-327) por:

```js
// ─── Re-register webhooks on every health check (URL por token + MESSAGES_UPSERT/MESSAGES_UPDATE) ─────
const webhookRegistrar = createWebhookRegistrar({ db, getProvider })
async function reRegisterWebhooks() {
  const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status = 'connected'").all()
  for (const inst of instances) {
    try {
      const r = await webhookRegistrar.registerInstanceWebhook(inst)
      if (!r.ok && r.reason !== 'provider_without_webhook_registration') {
        console.error(`[Webhook re-register] ${inst.instance_name}: ${r.reason}`)
      }
    } catch {}
  }
}
```

Run: `Select-String -Path server/scheduler.js -Pattern "EVOLUTION_API_URL|drosagencia|webhooks/evolution"`
Expected: nenhuma ocorrência.

- [ ] **Step 7: Conferências**

Run: `npm test`
Expected: PASS em todos.

Run: `node --input-type=module -e "await import('./server/scheduler.js'); await import('./server/routes/integrations.js'); console.log('ok'); process.exit(0)"`
Expected: `ok`

Teste manual (em ambiente com Evolution): em Integrações, clicar em "Reconfigurar webhook" de um número; conferir no painel da Evolution (`GET <api_url>/webhook/find/<instancia>`) que a URL é `.../crm/api/webhooks/whatsapp/<token>` e os eventos são `MESSAGES_UPSERT` e `MESSAGES_UPDATE`; mandar uma mensagem de teste para o número e ver o lead/mensagem no Chat; enviar uma mensagem pelo CRM e ver o ✓✓ virar lido quando o destinatário abrir.

- [ ] **Step 8: Commit**

```bash
git add server/services/whatsapp/webhookRegistration.js server/services/whatsapp/evolutionHealth.js test/webhookRegistration.test.js server/routes/integrations.js server/scheduler.js
git commit -m "fix: webhook reregistrado com URL por token e status de entrega; health da Evolution por URL da instancia"
```

---

### Task 13: Verificação final, homologação e deploy com plano de volta

**Files:**
- Nenhum arquivo de código. (Opcional: acrescentar `PUBLIC_BASE_URL` em `/root/.env` no servidor.)

**Interfaces:**
- Consumes: tudo das Tasks 1-12.
- Produces: fase 1 em produção, com o caminho de volta testado.

- [ ] **Step 1: Suíte completa e varredura local**

Run: `npm test`
Expected: PASS em `normalize`, `whatsappSchema`, `publicUrl`, `evolutionParse`, `evolutionTransport`, `sender`, `mediaResolve`, `leadIntake`, `inboundHandler`, `webhookFlow`, `inboundPolling`, `webhookRegistration`; `# fail 0`.

Run: `Get-ChildItem -Recurse -Path server -Filter *.js | Select-String -Pattern "drosagencia.com.br/crm|EVOLUTION_API_URL \|\||wa_remote_jid FROM messages"`
Expected: só `server/services/publicUrl.js` (default) e nenhuma outra.

Run: `Select-String -Path server/routes/*.js,server/services/*.js,server/scheduler.js -Pattern "/message/sendText/|/message/sendMedia/|/chat/getBase64FromMediaMessage/|/chat/markMessageAsRead/|/chat/whatsappNumbers/|/chat/sendPresence/|/chat/findMessages/|/webhook/set/"`
Expected: nenhuma ocorrência (tudo isso agora só existe em `server/services/whatsapp/evolution.js`).

- [ ] **Step 2: Subir local e rodar o roteiro de regressão manual**

Run: `npm run dev`

Com uma instância Evolution de teste apontando o webhook para o CRM local (ou em homologação), conferir:
1. Mensagem de texto de número novo cria lead no funil padrão, aparece no Chat com contador e dispara a IA quando a conta tem agente.
2. Áudio recebido: player carrega no Chat; se a IA transcreve áudio, a transcrição aparece no log `[AI Agent] STT`.
3. Imagem com legenda e PDF recebidos aparecem com legenda/nome do arquivo.
4. Mensagem enviada pelo Chat recebe ✓, e ✓✓/lido chegam pelo webhook (`MESSAGES_UPDATE`).
5. Envio de imagem pelo Chat para número sem WhatsApp grava falha com o aviso.
6. Lead de anúncio (mensagem "P9 ..." de campanha) fica com fonte "Facebook Pago"/"Instagram Pago".
7. Integrações → "Sincronizar agora" roda o polling sem erro (`[Polling] ... all synced`).
8. Integrações → Google Planilhas mostra a URL com o domínio de `PUBLIC_BASE_URL`.
9. `POST /api/webhooks/evolution/<slug>` com `instance` inexistente responde 401 e nada é gravado.

- [ ] **Step 3: Revisar o histórico antes de enviar**

Run: `git log --oneline -15` e `git status`
Expected: 12 commits desta fase em sequência, sem arquivos de `dist/` e sem mudanças do plano do Copiloto misturadas em commits desta fase.

- [ ] **Step 4: Deploy fora do horário comercial (depois das 21h ou antes das 7h, horário de Brasília)**

Anotar o commit atual do servidor **antes** de atualizar:

```bash
cd /root/crm && git rev-parse HEAD > /root/crm-antes-provedor-fase1.txt && cat /root/crm-antes-provedor-fase1.txt
```

Opcional (só se o domínio for diferente do padrão): acrescentar em `/root/.env` a linha `PUBLIC_BASE_URL=https://drosagencia.com.br/crm`.

Atualizar (tem mudança de front, então é o comando 3 do CLAUDE.md) e rodar os testes no Node 16 do servidor antes de reiniciar:

```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && npm test && npm run build && pm2 restart dros-crm
```

Se `npm test` falhar no servidor, **não** rodar o restante: `git checkout $(cat /root/crm-antes-provedor-fase1.txt)` e avisar.

- [ ] **Step 5: Acompanhar os primeiros 15 minutos**

```bash
pm2 logs dros-crm --lines 300 --nostream | grep -E "Added column whatsapp_instances|webhook_token gerado|Evolution Webhook\] Set|Webhook WhatsApp\]|Webhook Evolution\] 40|Webhook re-register|\[Polling\].*error|Tipo de mensagem nao tratado"
```

Esperado: colunas criadas e tokens gerados uma vez; em até 5 minutos, `[Evolution Webhook] Set for <instancia> → .../api/webhooks/whatsapp/<token>` para cada número conectado; nenhum `[Webhook WhatsApp] 401` repetido; mensagens novas chegando no Chat de pelo menos 2 contas diferentes; ✓✓ atualizando.

Um `[Webhook Evolution] 401 Unknown instance` isolado logo após o deploy é esperado (webhook global antigo ainda apontando para a URL por conta); se persistir para uma instância real depois de 10 minutos, clicar em "Reconfigurar webhook" dela.

- [ ] **Step 6: Plano de volta (se algo der errado)**

```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git checkout $(cat /root/crm-antes-provedor-fase1.txt) && npm install && npm run build && pm2 restart dros-crm
```

Depois da volta: as colunas novas ficam no banco e são ignoradas pelo código antigo; o `reRegisterWebhooks` antigo recoloca a URL `/api/webhooks/evolution/<slug>` em até 5 minutos (para acelerar, "Reconfigurar webhook" em cada número). Mensagens recebidas no intervalo são recuperadas pelo polling (30 s).

- [ ] **Step 7: Registrar o resultado**

Anotar no resumo do dia: horário do deploy, commit, contas verificadas e qualquer 401 observado. Não há commit de código nesta tarefa.

---

## Próximos planos (fora desta fase)

- **Fase 2 — Adaptador de API de terceiros (`customHttp.js`):** configuração em `provider_config` com segredos criptografados (`WA_ENC_KEY`), modelo de corpo para texto/mídia, caminho do ID na resposta, formato do telefone, "Capturar exemplo" com mapeamento por clique, URL de download de mídia com `{{media_id}}`, botão Testar, bloqueio de ativação com mapeamento incompleto, segredo opcional por header/campo no webhook.
- **Fase 3 — API Oficial da Meta (`cloudApi.js`):** `GET /api/webhooks/whatsapp/:instanceToken` com `hub.challenge`, validação `X-Hub-Signature-256` com o App Secret, envio de texto/mídia/template, `markRead` oficial, download por `media_id`, tabela `wa_templates` sincronizada, janela de 24h com `reason = 'window_closed'` no Chat e nos envios automáticos.
- **Fase 4 — Telas agrupadas:** Integrações em 4 cards (WhatsApp, Entrada de leads, Meta, IA), editor do agente em 4 abas (aba Geral compartilhada com o Copiloto), remoção das duplicidades (follow-up de inatividade, "Primeira mensagem", agendas).
- **Pendências técnicas que as fases 2/3 precisam tratar:** filtrar por provedor a gestão de sessão (`integrations.js` connect/status/QR/logout/delete/restart/test, `admin.js:10`, GhostDetect `scheduler.js:436`, verificação diária `scheduler.js:688`, `syncInstancePhoneIfMissing`); troca de provedor com pausa → reconfigura → testa → reativa; decidir o destino de `webhook_secret` (hoje nunca é gravado) e das credenciais Evolution por conta (`accounts.evolution_api_url/key`).

## Autorrevisão (feita ao fechar o plano)

- **Cobertura do spec (fase 1):** §4.1 tomada/`getProvider`/`normalize` → Tasks 1, 4, 5; interface e tipos `NormalizedMessage`/`NormalizedStatus` → Task 4; §4.2 envio e `sendMediaViaInstance` → Tasks 6, 7; §4.3 rota por token, rota antiga sem fallback, `handleInboundMessage`/`handleStatusUpdate`, polling por `capabilities.polling` → Tasks 9, 10, 11; §4.6 webhook com token e `MESSAGES_UPSERT` + `MESSAGES_UPDATE`, `markRead` por `leads.wa_remote_jid`, health por `api_url` → Tasks 5, 6, 12; §4.7 `PUBLIC_BASE_URL` + `/public-config`, mídia pela `message.instance_id`, cap único 50 → Tasks 3, 6, 7; §6 `provider`/`provider_config`/`webhook_token` → Task 2; §7 token inválido → 401 sem gravar e com log → Task 10; §8 testes com payloads reais (texto, extendedText, áudio, imagem, documento, reação, revoke, CTWA, `@lid` com e sem pushName, `senderPn`, grupo, status) → Tasks 4, 9, 11; §9 deploy fora do horário e volta → Task 13; `deepgramClient.fetchAudioBuffer` via provedor → Task 7.
- **Placeholders:** varrido; sem "TBD"/"TODO"/"tratar erros adequadamente"/"similar à Task". Os trechos "mover sem alterar" trazem o código completo e a instrução de conferir contra as linhas do arquivo real.
- **Consistência de nomes:** `normalizePhone`/`normalizeForSend`/`jidToSendNumber`/`phoneCompareKey` (Task 1) usados nas Tasks 4-8; `createEvolutionAdapter`, `parsePolledRecord`, `fetchRecentMessages`, `registerWebhook`, `EVOLUTION_WEBHOOK_EVENTS` (Tasks 4-5) usados nas Tasks 10-12; `createSender` e as reexportações de `leadHandoff.js` (Task 6) usadas na Task 7; `createLeadIntake` (Task 8) e `createInboundHandler` com `{ source: 'polling' }` (Tasks 9, 11) usados em `inboundRuntime.js` e `scheduler.js`; `ensureWebhookToken`/`generateWebhookToken` (Task 2) e `buildInstanceWebhookUrl` (Task 3) usados na Task 12; `resolveInstanceByToken`/`resolveLegacyEvolutionInstance`/`processWebhook` (Task 10).
- **Correções feitas na revisão:** removidos comentários de instrução ("COPIAR as linhas...") de dentro do código da Task 4; `handleStatusUpdate` com filtro de conta registrado como decisão; import de `triggerCapiForStageChange` removido do `scheduler.js` só na Task 11 (único uso era o polling); `leads.js` troca o import de `node-fetch` (único uso era a foto de perfil).


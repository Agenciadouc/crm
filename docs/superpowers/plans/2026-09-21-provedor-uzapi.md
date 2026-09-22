# Provedor UzAPI (servidor) — Plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** permitir que um número de WhatsApp do CRM use a UzAPI como provedor, com criação, QR, recebimento, envio, desconexão, reinício e exclusão feitos pelo CRM, sem mudar nada para os números da Evolution.

**Arquitetura:** a UzAPI entra pela mesma "tomada" (`server/services/whatsapp/`), com um adaptador próprio (`uzapi.js` + `uzapiSession.js` + `uzapiClient.js`) e uma leitura de avisos **formato Meta** pura (`metaFormat.js`), que depois serve à API Oficial. O token do número fica cifrado em `provider_config` (`providerConfig.js`, AES-256-GCM). A gestão dos números UzAPI mora em `instanceManager.js` (sem importar `server/db.js`, testável com banco em memória); as rotas de `integrations.js` só perguntam o provedor e delegam. As rotinas automáticas da Evolution passam a ignorar números UzAPI e ganham uma checagem de hora em hora própria.

**Tecnologias:** Node (ESM), Express 4, better-sqlite3, `node-fetch` 3 (inclusive `FormData`/`Blob` dele para o multipart), `crypto` nativo, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-21-provedor-uzapi-design.md` (base: `docs/superpowers/specs/2026-09-15-provedor-whatsapp-design.md`; achados reais: `docs/superpowers/specs/uzapi-achados-etapa0.md`). Leia os três antes de começar.

**Fora deste plano:** as telas (Integrações > WhatsApp com escolha do provedor, selo, botão do plano B) são de outro plano, escrito em paralelo. Este plano entrega o servidor e respeita o contrato abaixo.

## Global Constraints

- Produção roda Node 16 (spec 4.5 / spec de provedores seção 10): **nenhuma dependência nova**. HTTP com `node-fetch` 3 (já é dependência); multipart com `FormData`/`Blob` exportados pelo próprio `node-fetch`; criptografia com `crypto` nativo.
- `.env`: `UZAPI_BASE_URL` (padrão `https://api.uzapi.com.br`), `UZAPI_USERNAME`, `UZAPI_ACCOUNT_TOKEN`, `WA_ENC_KEY` (32 bytes em hex; sem ela não dá para criar número UzAPI), `UZAPI_PANEL_URL` (link do plano B), `PUBLIC_BASE_URL`.
- Conta UzAPI **única da Dros**: credencial só no `.env`, nunca no banco nem por conta de cliente.
- Escolha de provedor **por número**; números atuais continuam `provider='evolution'` e o código da Evolution não muda de comportamento.
- `GET /whatsapp` **nunca** devolve `provider_config`; sempre devolve `provider`.
- Webhook protegido pelo token de 32 hex na URL (`/api/webhooks/whatsapp/:instanceToken`); a UzAPI não assina. Aviso com `phone_number_id` diferente do número é descartado.
- Erro interno em aviso da UzAPI responde **200** (a UzAPI reenviaria em laço); JSON inválido também responde 200.
- Nunca copiar tokens reais para código, testes, fixtures ou commits. Fixtures só com números mascarados (`5548900000NN`) e `phone_number_id` mascarado (`100000000000001`): com o usuário e o `phone_number_id` reais a UzAPI entrega o token do número sem senha (falha de segurança dela, spec 3).
- Textos que o usuário vê (mensagens de erro das rotas) em PT-BR **com acentos**; comentários de código seguem o padrão do repo (PT sem acento).
- Commits locais em português, pequenos, um por tarefa. **Sem push, sem deploy.** Nunca adicionar `dist/`, `package-lock.json`, `vite.config.ts` nem os `*.mjs` soltos da raiz (há mudanças não relacionadas no working tree): sempre `git add` com os caminhos exatos listados em cada tarefa. Siga a regra de atribuição de commit da sessão.
- Comandos assumem Git Bash na raiz do repo (`C:\Users\RTX-2060\Documents\crm`) com Node 20: rode `export PATH="/c/nvm4w/nodejs:$PATH"` uma vez por terminal. Suíte inteira: `npm test` (hoje: 356 testes, 0 falhas). Um arquivo: `node --test test/<arquivo>.test.js`.

---

## Contrato de API (combinado com o plano do front)

Todas as rotas abaixo ficam em `server/routes/integrations.js`, montado em **`/api/integrations`** com `authenticate` + `scopeToAccount` (o front manda `?account_id=<id>` como já faz hoje). Formato de erro de todas: `{ "error": "<mensagem em PT-BR>", "code": "<codigo>" }`.

### `GET /api/integrations/whatsapp`
Sem mudança de caminho. Cada instância ganha `provider` e perde `provider_config`.
```json
{
  "instances": [
    {
      "id": 12, "account_id": 3, "instance_name": "Loja Centro",
      "provider": "uzapi",
      "status": "connecting", "qr_code": null, "phone_number": null,
      "connected_at": null, "lead_intake_mode": "open", "webhook_token": "…32 hex…",
      "api_url": "", "api_key": ""
    },
    { "id": 5, "instance_name": "Vendas", "provider": "evolution", "status": "connected", "...": "..." }
  ]
}
```
`provider` ∈ `'uzapi' | 'evolution'`. Atendente continua recebendo sem `api_url`, `api_key`, `webhook_secret`.

### `GET /api/integrations/whatsapp/providers` (nova)
```json
{ "providers": [ { "id": "evolution", "label": "Evolution" }, { "id": "uzapi", "label": "UzAPI (estável)" } ], "default": "evolution" }
```
`uzapi` só aparece se `UZAPI_USERNAME` e `UZAPI_ACCOUNT_TOKEN` estiverem no `.env`. Todos os papéis podem ler.

### `POST /api/integrations/whatsapp`
Corpo: `{ "instance_name": "Loja Centro", "lead_intake_mode": "open", "provider": "uzapi" }` (`provider` opcional, padrão `"evolution"`).
- 200 → `{ "instance": { …mesmo formato da lista… } }`. Para UzAPI o número nasce `status:"connecting"`; o front chama em seguida `POST …/:id/qrcode`.
- 400 `code: "invalid_provider"` | `"uzapi_not_configured"` | `"wa_enc_key_missing"`; 409 `code: "instance_name_taken"`; 502 `code: "uzapi_create_failed"` | `"uzapi_create_incomplete"` | `"provider_auth"`.

### `POST /api/integrations/whatsapp/:id/qrcode` (e `POST …/:id/connect`, mesmo formato)
```json
{ "instance": { "...": "..." }, "qr_code": "data:image/png;base64,…", "status": "connecting" }
```
```json
{ "instance": { "...": "..." }, "qr_code": null, "status": "connecting", "panel_url": "https://uzapi.com.br" }
```
- `qr_code`: `string | null`. Pode ser imagem (`data:image/...` ou base64 puro de PNG) **ou** o texto cru do QR do WhatsApp (ex.: começa com `2@`); o front detecta pelo prefixo e, se for texto, gera a imagem.
- `status`: `'connecting' | 'connected'` (quando já conectado, `qr_code` vem `null` e não há `panel_url`).
- `panel_url`: **só UzAPI e só quando `qr_code` é `null`** (plano B: botão "Abrir QR no painel da UzAPI"). O status continua sendo atualizado pelo aviso `connection`.
- Evolution: mesmo formato, sem `panel_url` (continua com `instance` para o front atual não quebrar).

### Demais rotas de número (formato atual mantido; passam a atender UzAPI)
- `GET …/whatsapp/:id/status` → `{ instance, state }` (UzAPI: `state` ∈ `connected|connecting|disconnected|null`, com `error` quando a UzAPI não respondeu).
- `POST …/whatsapp/:id/disconnect` → `{ ok: true }`; `DELETE …/whatsapp/:id` → `{ ok: true }`; `POST …/whatsapp/:id/restart` → `{ ok: true, response }`; `POST …/whatsapp/:id/test` → `{ success, status }`.

### Outras rotas novas
- `GET /api/admin/uzapi-usage` (super_admin) → `{ "accounts": [ { "account_id": 3, "numbers": 2, "connected_now": 1, "oldest_created_at": "2026-09-21 10:00:00", "first_created_at": "2026-09-20 08:00:00" } ] }` (base da cobrança futura).
- `GET /api/media-temp/:token` (pública, sem login) → o arquivo, por até 10 minutos (reserva do envio de mídia).
- Webhook: `POST /api/webhooks/whatsapp/:instanceToken` (caminho que já existe; o CRM configura na UzAPI ao criar o número).

---

## Estrutura de arquivos

**Novos (servidor):**
| Arquivo | Responsabilidade |
|---|---|
| `server/services/whatsapp/metaFormat.js` | Lê avisos no formato Meta (mensagens, statuses, ecos, conexão, QR). Puro. |
| `server/services/whatsapp/providerConfig.js` | Cifra/decifra segredos (AES-256-GCM, `WA_ENC_KEY`); monta e lê o `provider_config` da UzAPI. |
| `server/services/whatsapp/uzapiClient.js` | HTTP da UzAPI: URL base, Bearer, tempo limite, download, tradução de erro em `reason`. |
| `server/services/whatsapp/uzapi.js` | Adaptador UzAPI: envio, mídia, leitura do aviso, busca de eco. Registra na tomada. |
| `server/services/whatsapp/uzapiSession.js` | Sessão do número na UzAPI: criar, status/QR, webhook, logout, reiniciar, excluir. |
| `server/services/whatsapp/connectionLog.js` | Registro `created/connected/disconnected/removed` e resumo de uso por conta. |
| `server/services/whatsapp/instanceManager.js` | Gestão dos números UzAPI pelo CRM + lista de provedores + `sanitizeInstance`. |
| `server/services/whatsapp/uzapiEcho.js` | Grava como enviada a resposta dada pelo celular (eco). |
| `server/services/whatsapp/instanceQueries.js` | Consultas por provedor usadas pelas rotinas automáticas + limpeza de QR. |
| `server/services/whatsapp/uzapiStatusSync.js` | Checagem de hora em hora dos números UzAPI. |
| `server/services/mediaTemp.js` | Arquivo temporário (10 min) para enviar mídia por link. |
| `server/routes/mediaTemp.js` | Rota pública `GET /api/media-temp/:token`. |

**Modificados (servidor):** `server/services/whatsapp/schema.js`, `server/services/whatsapp/index.js`, `server/services/whatsapp/webhookFlow.js`, `server/services/whatsapp/sender.js`, `server/services/inboundHandler.js`, `server/services/deepgramClient.js`, `server/services/aiAgent.js`, `server/services/copilotBlock.js`, `server/services/blockTranscriber.js`, `server/routes/messages.js`, `server/routes/webhooks.js`, `server/routes/integrations.js`, `server/routes/admin.js`, `server/scheduler.js`, `server/index.js`, `.env.example`, `.gitignore`.

**Testes novos:** `test/uzapiFixtures.test.js`, `test/connectionLog.test.js`, `test/providerConfig.test.js`, `test/metaFormat.test.js`, `test/uzapiAdapter.test.js`, `test/uzapiSession.test.js`, `test/mediaTemp.test.js`, `test/instanceManager.test.js`, `test/uzapiEcho.test.js`, `test/instanceQueries.test.js`; helpers `test/helpers/uzapiFixtures.js`, `test/helpers/inboundSetup.js`; fixtures `test/fixtures/uzapi/*.json`.

**Testes modificados:** `test/whatsappSchema.test.js`, `test/evolutionParse.test.js`, `test/sender.test.js`, `test/inboundHandler.test.js`, `test/mediaResolve.test.js`, `test/copilotBlock.test.js`, `test/webhookFlow.test.js`.

---

### Tarefa 1: Fixtures reais mascaradas + helper de testes

**Arquivos:**
- Criar (fora do repo, descartável): `$TMPDIR/mask-uzapi.mjs`
- Criar: `test/fixtures/uzapi/*.json` (13 capturas mascaradas + 3 sintéticas)
- Criar: `test/helpers/uzapiFixtures.js`
- Teste: `test/uzapiFixtures.test.js`

**Interfaces:**
- Produz (`test/helpers/uzapiFixtures.js`): `UZAPI_FIXTURE_DIR`, `loadUzapiFixture(name) → object`, `listUzapiFixtures() → string[]`, constantes `UZAPI_PNID = '100000000000001'`, `DROS_NUMBER = '554890000001'`, `LEAD_WA_ID = '554890000002'`, `LEAD_PHONE = '5548990000002'` (o `normalizePhone` insere o 9), `UZAPI_TEST_ENV` (objeto de env falso), `fakeFetch(responder)` (fetch falso que grava `calls`), `quietLog`.

Mapa das capturas (a pasta `C:\Users\RTX-2060\Documents\uzapi-capturas-2026-09-21\` tem 001..023; usamos estas):

| Captura | Fixture | O que é |
|---|---|---|
| 002 | `connection-connected.json` | aviso `connection: connected` |
| 003 | `status-echo-read-by-lead.json` | status `read`, `recipient_id:""` de resposta dada pelo celular |
| 004 | `message-text.json` | texto recebido "Teste 1" |
| 005 | `message-audio.json` | áudio recebido (só `id`) |
| 006 | `message-image.json` | foto recebida sem legenda |
| 007 | `status-read-by-self.json` | leitura feita pelo próprio número (`recipient_id` preenchido) |
| 008 | `status-echo-delivered.json` | eco: `delivered`, `recipient_id:""` |
| 009 | `status-echo-read.json` | eco: `read` do mesmo id |
| 010 | `message-document.json` | PDF recebido |
| 012 | `status-sent-delivered.json` | `delivered` de mensagem enviada pela API (`3EB…`) |
| 014 | `status-played-by-self.json` | `played` feito pelo próprio número |
| 015 | `group-image.json` | foto em grupo (deve ser descartada) |
| 016 | `group-text.json` | texto em grupo (deve ser descartado) |

- [ ] **Passo 1: Criar o script de máscara fora do repo**

O script não tem nenhum dado real escrito nele: acha telefones, nomes e ids pela estrutura do JSON. Salve em `$TMPDIR/mask-uzapi.mjs` (no Git Bash, `echo $TMPDIR`; **não** salve dentro do repo):

```js
// Copia as capturas reais da UzAPI para test/fixtures/uzapi/ trocando todo dado pessoal.
// Nao tem nenhum dado real escrito aqui: telefones, nomes e ids sao achados e trocados pela estrutura do JSON.
// Uso: node mask-uzapi.mjs <pasta-das-capturas> <pasta-de-saida>
import fs from 'fs'
import path from 'path'

const [src, out] = process.argv.slice(2)
if (!src || !out) throw new Error('uso: node mask-uzapi.mjs <capturas> <saida>')

const FILES = {
  '002': 'connection-connected.json',
  '003': 'status-echo-read-by-lead.json',
  '004': 'message-text.json',
  '005': 'message-audio.json',
  '006': 'message-image.json',
  '007': 'status-read-by-self.json',
  '008': 'status-echo-delivered.json',
  '009': 'status-echo-read.json',
  '010': 'message-document.json',
  '012': 'status-sent-delivered.json',
  '014': 'status-played-by-self.json',
  '015': 'group-image.json',
  '016': 'group-text.json',
}
const PHONE_RE = /^55\d{10,11}$/
const pad2 = (n) => String(n).padStart(2, '0')

const bodies = fs.readdirSync(src).sort()
  .filter(f => FILES[f.slice(0, 3)])
  .map(f => ({ dest: FILES[f.slice(0, 3)], body: JSON.parse(fs.readFileSync(path.join(src, f), 'utf8')).body }))

// 1a passada: o numero da Dros (display_phone_number) vira o 01; os demais telefones, na ordem em que aparecem.
const phones = new Map()
const addPhone = (p) => { if (PHONE_RE.test(p) && !phones.has(p)) phones.set(p, `5548900000${pad2(phones.size + 1)}`) }
const walk = (node, fn, key = null, parent = null) => {
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, fn, i, node))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, fn, k, node)
  else fn(node, key, parent)
}
for (const { body } of bodies) walk(body, (v, k) => { if (k === 'display_phone_number') addPhone(String(v)) })
for (const { body } of bodies) walk(body, (v) => { if (typeof v === 'string') addPhone(v) })

// 2a passada: troca telefones, ids do numero, grupo, nomes, nome de arquivo e textos de grupo.
for (const { body } of bodies) {
  for (const entry of body.entry || []) {
    if (entry.id) entry.id = '200000000000001'
    for (const change of entry.changes || []) {
      const value = change.value || {}
      if (value.metadata?.phone_number_id) value.metadata.phone_number_id = '100000000000001'
      for (const m of value.messages || []) {
        if (m.group_id) m.group_id = '120363000000000001@g.us'
        if (m.document?.filename) m.document.filename = 'documento.pdf'
        if (m.isGroup) {
          if (m.text?.body) m.text.body = 'texto de grupo'
          for (const t of ['image', 'video', 'document']) if (m[t]?.caption) m[t].caption = 'legenda de grupo'
        }
      }
    }
  }
  walk(body, (v, k, parent) => { if (typeof v === 'string' && phones.has(v)) parent[k] = phones.get(v) })
  walk(body, (v, k, parent) => {
    if (k === 'name' && typeof v === 'string' && v.trim()) {
      const owner = (Array.isArray(body.entry) ? body.entry : []).flatMap(e => e.changes || []).flatMap(c => c.value?.contacts || []).find(c => c.profile === parent)
      parent[k] = owner ? `Contato ${owner.wa_id.slice(-2)}` : 'Contato'
    }
  })
}

fs.mkdirSync(out, { recursive: true })
for (const { dest, body } of bodies) {
  const text = JSON.stringify(body, null, 2)
  for (const real of phones.keys()) if (text.includes(real)) throw new Error(`${dest}: sobrou telefone real`)
  for (const m of text.match(/\b55\d{10,11}\b/g) || []) {
    if (![...phones.values()].includes(m)) throw new Error(`${dest}: telefone nao mascarado`)
  }
  fs.writeFileSync(path.join(out, dest), text + '\n')
  console.log('ok', dest)
}
console.log('telefones trocados:', phones.size)
```

- [ ] **Passo 2: Gerar as fixtures**

Run: `node "$TMPDIR/mask-uzapi.mjs" "/c/Users/RTX-2060/Documents/uzapi-capturas-2026-09-21" test/fixtures/uzapi`
Expected: 13 linhas `ok …json` e `telefones trocados: 4`.

Confira à mão `test/fixtures/uzapi/message-text.json`; deve ficar assim (só o corpo, sem headers):
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "200000000000001",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "554890000001", "phone_number_id": "100000000000001" },
            "contacts": [ { "profile": { "name": "Contato 02" }, "wa_id": "554890000002" } ],
            "messages": [
              { "from": "554890000002", "id": "2A2ACD4E776A27C10B00", "isGroup": false,
                "text": { "body": "Teste 1" }, "timestamp": "1790022408", "type": "text" }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```
(O script grava com indentação de 2 espaços, uma chave por linha; o conteúdo é este.) Depois apague `$TMPDIR/mask-uzapi.mjs`.

- [ ] **Passo 3: Criar as 3 fixtures sintéticas (formato não capturado)**

`test/fixtures/uzapi/connection-desconnected.synthetic.json` (exemplo da documentação da UzAPI, com a grafia dela):
```json
{
  "_nota": "SINTETICO: copiado do exemplo da documentacao da UzAPI (evento connection desconnected), phone_number_id mascarado.",
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "", "phone_number_id": "100000000000001" },
            "status": [ { "connection": "desconnected" } ]
          },
          "field": "connection"
        }
      ]
    }
  ]
}
```

`test/fixtures/uzapi/authentication-qr.synthetic.json` (hipótese — spec 9.3 ainda não confirmou o formato):
```json
{
  "_nota": "HIPOTESE: formato do aviso authentication nao confirmado (spec 9.3). O leitor procura o QR por nome de campo.",
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": { "display_phone_number": "", "phone_number_id": "100000000000001" },
            "qrcode": "2@QR-DE-TESTE-NAO-E-REAL,abcdefghijklmnopqrstuvwxyz"
          },
          "field": "authentication"
        }
      ]
    }
  ]
}
```

`test/fixtures/uzapi/chats-get-echo.synthetic.json` (montado dos achados da etapa 0: `data.data.Info` + `Message.ExtendedTextMessage.text`, Chat `@lid`):
```json
{
  "_nota": "SINTETICO: resposta de POST /chats {action:get} montada a partir de uzapi-achados-etapa0.md. Confirmar com a conta ativa.",
  "data": {
    "data": {
      "Info": { "ID": "2A286AC5064891EF4DE7", "Chat": "123456789012345@lid", "IsFromMe": true, "Timestamp": "2026-09-21T20:27:57Z" },
      "Message": { "ExtendedTextMessage": { "text": "Resposta pelo celular" } }
    }
  }
}
```

- [ ] **Passo 4: Escrever o helper `test/helpers/uzapiFixtures.js`**

```js
// Fixtures da UzAPI (avisos reais de 21/09/2026, com telefones e ids mascarados) e utilidades de teste.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export const UZAPI_FIXTURE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'uzapi')

export function loadUzapiFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(UZAPI_FIXTURE_DIR, name), 'utf8'))
}

export function listUzapiFixtures() {
  return fs.readdirSync(UZAPI_FIXTURE_DIR).filter(f => f.endsWith('.json')).sort()
}

export const UZAPI_PNID = '100000000000001'
export const DROS_NUMBER = '554890000001'
export const LEAD_WA_ID = '554890000002'
export const LEAD_PHONE = '5548990000002' // normalizePhone insere o 9 do celular
export const MASKED_PHONES = ['554890000001', '554890000002', '554890000003', '554890000004']

export const UZAPI_TEST_ENV = Object.freeze({
  UZAPI_BASE_URL: 'https://uzapi.test',
  UZAPI_USERNAME: 'dros',
  UZAPI_ACCOUNT_TOKEN: 'CONTA-TESTE',
  UZAPI_PANEL_URL: 'https://painel.uzapi.test',
  WA_ENC_KEY: 'ab'.repeat(32),
  PUBLIC_BASE_URL: 'https://crm.test',
})

export const quietLog = { error() {}, warn() {}, log() {} }

// fetch falso: grava cada chamada e responde com o que o responder devolver.
// responder(url, init, n) -> { status?, json?, bodyText?, buffer?, headers? } | Error
export function fakeFetch(responder) {
  const calls = []
  const fn = async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ url, init, body })
    const r = await responder(url, init, calls.length)
    if (r instanceof Error) throw r
    const status = r.status ?? 200
    const text = r.bodyText !== undefined ? r.bodyText : (r.json !== undefined ? JSON.stringify(r.json) : '')
    const buf = r.buffer || Buffer.from(text)
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      headers: { get: (k) => (r.headers || {})[String(k).toLowerCase()] || null },
    }
  }
  fn.calls = calls
  return fn
}
```

- [ ] **Passo 5: Escrever o teste das fixtures `test/uzapiFixtures.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { UZAPI_FIXTURE_DIR, listUzapiFixtures, loadUzapiFixture, MASKED_PHONES, UZAPI_PNID } from './helpers/uzapiFixtures.js'

test('fixtures da UzAPI: 16 arquivos, todos JSON validos', () => {
  const files = listUzapiFixtures()
  assert.equal(files.length, 16)
  for (const f of files) assert.doesNotThrow(() => loadUzapiFixture(f), f)
})

test('fixtures da UzAPI: so telefones mascarados e phone_number_id mascarado (nada de dado real)', () => {
  for (const f of listUzapiFixtures()) {
    const text = fs.readFileSync(path.join(UZAPI_FIXTURE_DIR, f), 'utf8')
    for (const m of text.match(/\b55\d{10,11}\b/g) || []) assert.ok(MASKED_PHONES.includes(m), `${f}: telefone ${m} nao mascarado`)
    for (const m of text.match(/"phone_number_id":\s*"(\d*)"/g) || []) assert.ok(m.includes(UZAPI_PNID), `${f}: phone_number_id nao mascarado`)
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}/.test(text), `${f}: parece conter um JWT`)
  }
})
```

- [ ] **Passo 6: Rodar o teste**

Run: `node --test test/uzapiFixtures.test.js`
Expected: PASS (2 testes). Se "telefone … nao mascarado" aparecer, **não** commite: refaça o Passo 2.

- [ ] **Passo 7: Commit**

```bash
git add test/fixtures/uzapi test/helpers/uzapiFixtures.js test/uzapiFixtures.test.js
git commit -m "test: fixtures reais da UzAPI com dados mascarados"
```

---

### Tarefa 2: Esquema do banco + registro de conexões

**Arquivos:**
- Modificar: `server/services/whatsapp/schema.js`
- Criar: `server/services/whatsapp/connectionLog.js`
- Modificar: `test/whatsappSchema.test.js:57`
- Teste: `test/connectionLog.test.js`

**Interfaces:**
- Produz: `WHATSAPP_PROVIDERS = ['evolution', 'uzapi', 'cloud_api', 'custom']`; colunas `whatsapp_instances.qr_code` (garantida) e `whatsapp_instances.connected_at`; tabelas `whatsapp_connection_log(id, account_id, instance_id, provider, event, created_at)` e `media_temp(token, file_path, mimetype, expires_at)`.
- Produz (`connectionLog.js`): `CONNECTION_EVENTS`, `logConnectionEvent(db, instance, event) → void` (lança `invalid_connection_event:<x>`), `uzapiUsageByAccount(db) → [{ account_id, numbers, connected_now, oldest_created_at, first_created_at }]`.

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/whatsappSchema.test.js`, troque a linha 57 por:
```js
  assert.deepEqual(WHATSAPP_PROVIDERS, ['evolution', 'uzapi', 'cloud_api', 'custom'])
```
e acrescente no fim do arquivo:
```js
test('migracao garante qr_code e connected_at e cria whatsapp_connection_log e media_temp (idempotente)', () => {
  const db = createTestDb()
  migrateWhatsappProviderSchema(db)
  const cols = db.prepare('PRAGMA table_info(whatsapp_instances)').all().map(c => c.name)
  assert.ok(cols.includes('qr_code'))
  assert.ok(cols.includes('connected_at'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(t => t.name)
  assert.ok(tables.includes('whatsapp_connection_log'))
  assert.ok(tables.includes('media_temp'))
})
```

Crie `test/connectionLog.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { CONNECTION_EVENTS, logConnectionEvent, uzapiUsageByAccount } from '../server/services/whatsapp/connectionLog.js'

function insertUzapi(db, accountId, { name, status = 'connected', createdAt, token }) {
  const id = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider, provider_config, webhook_token, created_at)
    VALUES (?, ?, '', '', ?, 'uzapi', '{}', ?, ?)
  `).run(accountId, name, status, token, createdAt).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}

test('eventos aceitos', () => {
  assert.deepEqual(CONNECTION_EVENTS, ['created', 'connected', 'disconnected', 'removed'])
})

test('logConnectionEvent grava conta, numero, provedor e evento', () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const inst = insertUzapi(db, account.id, { name: 'loja', createdAt: '2026-09-21 10:00:00', token: 'c'.repeat(32) })
  logConnectionEvent(db, inst, 'created')
  const rows = db.prepare('SELECT account_id, instance_id, provider, event FROM whatsapp_connection_log').all()
  assert.deepEqual(rows, [{ account_id: account.id, instance_id: inst.id, provider: 'uzapi', event: 'created' }])
})

test('logConnectionEvent recusa evento desconhecido', () => {
  const db = createTestDb()
  const { instance } = seedBasic(db)
  assert.throws(() => logConnectionEvent(db, instance, 'pago'), /invalid_connection_event:pago/)
})

test('uzapiUsageByAccount: numeros UzAPI por conta, conectados agora e desde quando; ignora Evolution', () => {
  const db = createTestDb()
  const { account } = seedBasic(db) // ja tem 1 numero Evolution
  const outra = db.prepare("INSERT INTO accounts (name, slug) VALUES ('Outra', 'outra')").run().lastInsertRowid
  const a = insertUzapi(db, account.id, { name: 'a', status: 'connected', createdAt: '2026-09-21 10:00:00', token: 'c'.repeat(32) })
  insertUzapi(db, account.id, { name: 'b', status: 'connecting', createdAt: '2026-09-22 09:00:00', token: 'd'.repeat(32) })
  db.prepare("INSERT INTO whatsapp_connection_log (account_id, instance_id, provider, event, created_at) VALUES (?, ?, 'uzapi', 'created', '2026-09-20 08:00:00')").run(account.id, a.id)
  const rows = uzapiUsageByAccount(db)
  assert.deepEqual(rows, [{
    account_id: account.id, numbers: 2, connected_now: 1,
    oldest_created_at: '2026-09-21 10:00:00', first_created_at: '2026-09-20 08:00:00',
  }])
  assert.equal(rows.some(r => r.account_id === outra), false)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/whatsappSchema.test.js test/connectionLog.test.js`
Expected: FAIL — `WHATSAPP_PROVIDERS` diferente, tabelas ausentes e `Cannot find module '…/connectionLog.js'`.

- [ ] **Passo 3: Implementar**

Em `server/services/whatsapp/schema.js`, troque a linha do `WHATSAPP_PROVIDERS` por:
```js
export const WHATSAPP_PROVIDERS = ['evolution', 'uzapi', 'cloud_api', 'custom']
```
e, dentro de `migrateWhatsappProviderSchema`, logo depois de `addColumnIfNotExists(db, 'whatsapp_instances', 'webhook_token', 'TEXT')`, acrescente:
```js
  // qr_code ja existe em producao (db.js); aqui garante nos bancos de teste. connected_at = 1a conexao (cobranca futura).
  addColumnIfNotExists(db, 'whatsapp_instances', 'qr_code', 'TEXT')
  addColumnIfNotExists(db, 'whatsapp_instances', 'connected_at', 'TEXT')
  db.exec(`
    CREATE TABLE IF NOT EXISTS whatsapp_connection_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      instance_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      event TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wa_conn_log_account ON whatsapp_connection_log(account_id, provider);
    CREATE TABLE IF NOT EXISTS media_temp (
      token TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      mimetype TEXT,
      expires_at TEXT NOT NULL
    );
  `)
```

Crie `server/services/whatsapp/connectionLog.js`:
```js
// Registro de conexoes dos numeros (base da cobranca futura por numero UzAPI conectado).
export const CONNECTION_EVENTS = ['created', 'connected', 'disconnected', 'removed']

export function logConnectionEvent(db, instance, event) {
  if (!CONNECTION_EVENTS.includes(event)) throw new Error(`invalid_connection_event:${event}`)
  db.prepare('INSERT INTO whatsapp_connection_log (account_id, instance_id, provider, event) VALUES (?, ?, ?, ?)')
    .run(instance.account_id, instance.id, instance.provider || 'evolution', event)
}

// Por conta: quantos numeros UzAPI existem hoje, quantos estao conectados e desde quando a conta usa UzAPI.
export function uzapiUsageByAccount(db) {
  return db.prepare(`
    SELECT a.account_id, a.numbers, a.connected_now, a.oldest_created_at,
      (SELECT MIN(l.created_at) FROM whatsapp_connection_log l
        WHERE l.account_id = a.account_id AND l.provider = 'uzapi' AND l.event = 'created') AS first_created_at
    FROM (
      SELECT account_id, COUNT(*) AS numbers,
        SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected_now,
        MIN(created_at) AS oldest_created_at
      FROM whatsapp_instances WHERE provider = 'uzapi' GROUP BY account_id
    ) a
    ORDER BY a.account_id
  `).all()
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/whatsappSchema.test.js test/connectionLog.test.js`
Expected: PASS.

- [ ] **Passo 5: Suíte inteira**

Run: `npm test`
Expected: todos passam, 0 falhas.

- [ ] **Passo 6: Commit**

```bash
git add server/services/whatsapp/schema.js server/services/whatsapp/connectionLog.js test/whatsappSchema.test.js test/connectionLog.test.js
git commit -m "feat: esquema do provedor UzAPI e registro de conexoes por numero"
```

---

### Tarefa 3: `providerConfig` — segredos cifrados

**Arquivos:**
- Criar: `server/services/whatsapp/providerConfig.js`
- Modificar: `test/helpers/uzapiFixtures.js` (acrescentar `insertUzapiInstance`)
- Modificar: `.env.example`
- Teste: `test/providerConfig.test.js`

**Interfaces:**
- Consome: `UZAPI_TEST_ENV`, `UZAPI_PNID` (Tarefa 1).
- Produz: `hasEncryptionKey(env) → boolean`, `encryptSecret(plain, env) → 'v1:<iv>:<tag>:<ct>'`, `decryptSecret(box, env) → string`, `buildUzapiConfig({ phoneNumberId, instanceToken, uzapiInstanceId }, env) → string (JSON)`, `readUzapiConfig(instance, env) → { phoneNumberId, instanceToken, uzapiInstanceId }` (lança `code='uzapi_config_missing'`), `tryReadUzapiConfig(instance, env) → { cfg } | { error }`, `readUzapiPhoneNumberId(instance) → string | null` (não decifra).
- Produz (helper): `insertUzapiInstance(db, accountId, overrides) → row` (token do número `TOKEN-INSTANCIA`, `webhook_token` padrão `'c'.repeat(32)`).

- [ ] **Passo 1: Escrever o teste que falha** — `test/providerConfig.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encryptSecret, decryptSecret, hasEncryptionKey, buildUzapiConfig, readUzapiConfig, tryReadUzapiConfig, readUzapiPhoneNumberId,
} from '../server/services/whatsapp/providerConfig.js'
import { UZAPI_TEST_ENV as ENV, UZAPI_PNID } from './helpers/uzapiFixtures.js'

test('cifra e decifra; o texto cifrado nao contem o segredo e muda a cada vez', () => {
  const a = encryptSecret('eyJ-token-da-instancia', ENV)
  const b = encryptSecret('eyJ-token-da-instancia', ENV)
  assert.match(a, /^v1:[^:]+:[^:]+:[^:]+$/)
  assert.ok(!a.includes('eyJ-token'))
  assert.notEqual(a, b)
  assert.equal(decryptSecret(a, ENV), 'eyJ-token-da-instancia')
})

test('sem WA_ENC_KEY (ou com tamanho errado) nao cifra', () => {
  assert.equal(hasEncryptionKey({}), false)
  assert.equal(hasEncryptionKey({ WA_ENC_KEY: 'abc' }), false)
  assert.equal(hasEncryptionKey(ENV), true)
  assert.throws(() => encryptSecret('x', {}), (e) => e.code === 'wa_enc_key_missing')
})

test('texto adulterado, chave errada ou formato invalido falham', () => {
  const box = encryptSecret('segredo', ENV)
  const parts = box.split(':')
  parts[3] = Buffer.from('outra coisa').toString('base64')
  assert.throws(() => decryptSecret(parts.join(':'), ENV))
  assert.throws(() => decryptSecret(box, { WA_ENC_KEY: 'cd'.repeat(32) }))
  assert.throws(() => decryptSecret('lixo', ENV), /wa_secret_invalid/)
})

test('provider_config da UzAPI: grava o token cifrado e le de volta', () => {
  const json = buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA', uzapiInstanceId: 'loja' }, ENV)
  assert.ok(!json.includes('TOKEN-INSTANCIA'))
  assert.deepEqual(readUzapiConfig({ provider_config: json }, ENV), { phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA', uzapiInstanceId: 'loja' })
  assert.deepEqual(tryReadUzapiConfig({ provider_config: json }, ENV).cfg.instanceToken, 'TOKEN-INSTANCIA')
  assert.equal(readUzapiPhoneNumberId({ provider_config: json }), UZAPI_PNID)
})

test('provider_config ausente ou invalido', () => {
  assert.throws(() => readUzapiConfig({ provider_config: null }, ENV), (e) => e.code === 'uzapi_config_missing')
  assert.deepEqual(tryReadUzapiConfig({ provider_config: '{' }, ENV), { error: 'uzapi_config_missing' })
  assert.equal(readUzapiPhoneNumberId({ provider_config: null }), null)
  assert.equal(readUzapiPhoneNumberId(null), null)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/providerConfig.test.js`
Expected: FAIL — `Cannot find module '…/providerConfig.js'`.

- [ ] **Passo 3: Implementar** — `server/services/whatsapp/providerConfig.js`

```js
// Segredos do provedor por numero, cifrados com WA_ENC_KEY (32 bytes em hex) e AES-256-GCM (crypto nativo, roda no Node 16).
// Formato: v1:<iv base64>:<tag base64>:<texto cifrado base64>. Trocar WA_ENC_KEY depois torna os tokens ilegiveis.
import crypto from 'crypto'

const PREFIX = 'v1'

function codedError(code) {
  const e = new Error(code)
  e.code = code
  return e
}

function getKey(env) {
  const hex = String(env?.WA_ENC_KEY || '').trim()
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw codedError('wa_enc_key_missing')
  return Buffer.from(hex, 'hex')
}

export function hasEncryptionKey(env = process.env) {
  try { getKey(env); return true } catch { return false }
}

export function encryptSecret(plain, env = process.env) {
  const key = getKey(env)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return [PREFIX, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(box, env = process.env) {
  const parts = String(box || '').split(':')
  if (parts.length !== 4 || parts[0] !== PREFIX) throw codedError('wa_secret_invalid')
  const key = getKey(env)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
}

function parseConfig(instance) {
  try { return JSON.parse(instance?.provider_config || '') } catch { return null }
}

// provider_config da UzAPI: { phoneNumberId, instanceToken (cifrado), uzapiInstanceId }
export function buildUzapiConfig({ phoneNumberId, instanceToken, uzapiInstanceId = null }, env = process.env) {
  return JSON.stringify({ phoneNumberId: String(phoneNumberId), instanceToken: encryptSecret(instanceToken, env), uzapiInstanceId: uzapiInstanceId || null })
}

export function readUzapiConfig(instance, env = process.env) {
  const cfg = parseConfig(instance)
  if (!cfg || !cfg.phoneNumberId || !cfg.instanceToken) throw codedError('uzapi_config_missing')
  return { phoneNumberId: String(cfg.phoneNumberId), instanceToken: decryptSecret(cfg.instanceToken, env), uzapiInstanceId: cfg.uzapiInstanceId || null }
}

export function tryReadUzapiConfig(instance, env = process.env) {
  try { return { cfg: readUzapiConfig(instance, env) } } catch (e) { return { error: e.code || e.message } }
}

// So o phone_number_id (para conferir avisos): nao precisa da chave.
export function readUzapiPhoneNumberId(instance) {
  const cfg = parseConfig(instance)
  return cfg && cfg.phoneNumberId ? String(cfg.phoneNumberId) : null
}
```

- [ ] **Passo 4: Acrescentar `insertUzapiInstance` ao helper**

No fim de `test/helpers/uzapiFixtures.js`, acrescente (e o import no topo do arquivo):
```js
import { buildUzapiConfig } from '../../server/services/whatsapp/providerConfig.js'
```
```js
// Numero UzAPI pronto no banco de teste (token do numero: TOKEN-INSTANCIA, cifrado com UZAPI_TEST_ENV).
export function insertUzapiInstance(db, accountId, overrides = {}) {
  const id = db.prepare(`
    INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, provider, provider_config, webhook_token, phone_number)
    VALUES (?, ?, '', '', ?, 'uzapi', ?, ?, ?)
  `).run(
    accountId,
    overrides.instance_name || 'uzapi-teste',
    overrides.status || 'connected',
    buildUzapiConfig({ phoneNumberId: overrides.phoneNumberId || UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV),
    overrides.webhook_token || 'c'.repeat(32),
    overrides.phone_number ?? null,
  ).lastInsertRowid
  return db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
}
```

- [ ] **Passo 5: Documentar as variáveis em `.env.example`** (acrescente no fim)

```
# === WhatsApp pela UzAPI (conta unica da Dros) ===
# Painel da UzAPI > Meu Perfil: nome de usuario e "Token da API" (token da CONTA, nao o do numero).
# Sem os dois, a opcao "UzAPI (estavel)" nao aparece para os clientes.
UZAPI_BASE_URL=https://api.uzapi.com.br
UZAPI_USERNAME=
UZAPI_ACCOUNT_TOKEN=
# Link aberto pelo botao "Abrir QR no painel da UzAPI" quando o QR nao vier pela API.
UZAPI_PANEL_URL=https://uzapi.com.br
# Chave que cifra os tokens dos numeros no banco (32 bytes em hex). Gere com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Sem ela nao da para criar numero UzAPI. NUNCA troque depois de criar numeros (os tokens ficam ilegiveis).
WA_ENC_KEY=
# Dominio publico do CRM (webhooks dos numeros e links temporarios de midia)
PUBLIC_BASE_URL=https://drosagencia.com.br/crm
```

- [ ] **Passo 6: Rodar e ver passar**

Run: `node --test test/providerConfig.test.js test/uzapiFixtures.test.js`
Expected: PASS.

- [ ] **Passo 7: Commit**

```bash
git add server/services/whatsapp/providerConfig.js test/providerConfig.test.js test/helpers/uzapiFixtures.js .env.example
git commit -m "feat: token do numero UzAPI guardado cifrado no provider_config"
```

---

### Tarefa 4: `metaFormat` — leitura dos avisos formato Meta

**Arquivos:**
- Criar: `server/services/whatsapp/metaFormat.js`
- Teste: `test/metaFormat.test.js`

**Interfaces:**
- Consome: `normalizePhone` (`normalize.js`), fixtures (Tarefa 1).
- Produz: `extractQr(obj) → string | null`; `parseMetaMessage(m, contacts) → NormalizedMessage | null`; `parseMetaStatus(s) → { messageId, status, timestamp, recipientId, outboundOnly: true } | null`; `parseMetaWebhook(body, { phoneNumberId?, log? }) → { messages, statuses, echoes: [{ messageId, phone, timestamp }], connection: 'connected'|'disconnected'|null, qr: string|null, ignored: number }`.

- [ ] **Passo 1: Escrever o teste que falha** — `test/metaFormat.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMetaWebhook, extractQr } from '../server/services/whatsapp/metaFormat.js'
import { loadUzapiFixture as F, UZAPI_PNID, DROS_NUMBER, LEAD_WA_ID, LEAD_PHONE } from './helpers/uzapiFixtures.js'

const parse = (body) => parseMetaWebhook(body, { phoneNumberId: UZAPI_PNID, log: null })

const wrap = (message, contacts = [{ profile: { name: 'Contato 02' }, wa_id: LEAD_WA_ID }]) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: DROS_NUMBER, phone_number_id: UZAPI_PNID },
    contacts,
    messages: [{ from: LEAD_WA_ID, id: 'SYN1', isGroup: false, timestamp: '1790022408', ...message }],
  } }] }],
})

test('texto recebido (aviso real): telefone normalizado, nome, id e hora', () => {
  const r = parse(F('message-text.json'))
  assert.deepEqual(r.messages, [{
    phone: LEAD_PHONE, remoteId: `${LEAD_PHONE}@s.whatsapp.net`, fromMe: false,
    messageId: '2A2ACD4E776A27C10B00', pushName: 'Contato 02', timestamp: '2026-09-21T20:26:48.000Z',
    mediaRef: null, type: 'text', text: 'Teste 1',
  }])
  assert.deepEqual(r.statuses, [])
  assert.deepEqual(r.echoes, [])
  assert.equal(r.connection, null)
})

test('audio, foto e documento reais: mediaRef = id da midia; foto sem legenda vira [Imagem]; documento usa o nome', () => {
  const audio = parse(F('message-audio.json')).messages[0]
  assert.equal(audio.type, 'audio')
  assert.equal(audio.text, '[Audio]')
  assert.equal(audio.mediaRef, '582578164494741')
  assert.equal(audio.timestamp, '2026-09-21T20:27:04.000Z')
  const img = parse(F('message-image.json')).messages[0]
  assert.equal(img.type, 'image')
  assert.equal(img.text, '[Imagem]')
  assert.equal(img.mediaRef, '004874887872726')
  const doc = parse(F('message-document.json')).messages[0]
  assert.equal(doc.type, 'document')
  assert.equal(doc.text, 'documento.pdf')
  assert.equal(doc.mediaRef, '946384130837237')
  assert.equal(doc.fileName, 'documento.pdf')
})

test('mensagens de grupo sao descartadas', () => {
  assert.deepEqual(parse(F('group-image.json')).messages, [])
  assert.deepEqual(parse(F('group-text.json')).messages, [])
  assert.deepEqual(parse(wrap({ from: '120363000000000001@g.us', type: 'text', text: { body: 'x' } })).messages, [])
})

test('status delivered/read de mensagem enviada: vira NormalizedStatus e tambem candidato a eco (recipient_id vazio)', () => {
  const r = parse(F('status-sent-delivered.json'))
  assert.deepEqual(r.statuses, [{ messageId: '3EB03F3FB62BE08FFAA771', status: 'delivered', timestamp: '2026-09-21T20:28:54.000Z', recipientId: '', outboundOnly: true }])
  assert.deepEqual(r.echoes, [{ messageId: '3EB03F3FB62BE08FFAA771', phone: LEAD_PHONE, timestamp: '2026-09-21T20:28:54.000Z' }])
})

test('resposta dada pelo celular (so status, recipient_id vazio): eco com o telefone do lead', () => {
  for (const f of ['status-echo-delivered.json', 'status-echo-read.json']) {
    const r = parse(F(f))
    assert.equal(r.echoes.length, 1, f)
    assert.equal(r.echoes[0].messageId, '2A286AC5064891EF4DE7')
    assert.equal(r.echoes[0].phone, LEAD_PHONE)
  }
  assert.equal(parse(F('status-echo-read-by-lead.json')).echoes[0].messageId, '3B612B564A8E2CFE7929')
})

test('leitura feita pelo proprio numero (recipient_id preenchido): status outboundOnly, sem eco; played vira read', () => {
  const read = parse(F('status-read-by-self.json'))
  assert.deepEqual(read.statuses, [{ messageId: '2A2ACD4E776A27C10B00', status: 'read', timestamp: '2026-09-21T20:27:36.000Z', recipientId: LEAD_WA_ID, outboundOnly: true }])
  assert.deepEqual(read.echoes, [])
  const played = parse(F('status-played-by-self.json'))
  assert.equal(played.statuses[0].status, 'read')
  assert.deepEqual(played.echoes, [])
})

test('connection: connected (real) e desconnected (grafia da UzAPI) viram connected/disconnected', () => {
  assert.equal(parse(F('connection-connected.json')).connection, 'connected')
  assert.equal(parse(F('connection-desconnected.synthetic.json')).connection, 'disconnected')
  assert.equal(parse(F('connection-connected.json')).qr, null)
})

test('authentication: QR achado pelo nome do campo (hipotese)', () => {
  assert.equal(parse(F('authentication-qr.synthetic.json')).qr, '2@QR-DE-TESTE-NAO-E-REAL,abcdefghijklmnopqrstuvwxyz')
  assert.equal(extractQr({ data: { qrCode: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' } }), 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE')
  assert.equal(extractQr({ code: 123 }), null)
  assert.equal(extractQr({ qr: 'curto' }), null)
})

test('phone_number_id diferente do numero: aviso inteiro descartado', () => {
  const body = F('message-text.json')
  body.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999'
  const r = parse(body)
  assert.deepEqual(r.messages, [])
  assert.equal(r.ignored, 1)
})

test('lote com varios entry: percorre todos', () => {
  const body = { object: 'whatsapp_business_account', entry: [
    ...F('message-text.json').entry, ...F('status-echo-delivered.json').entry, ...F('connection-connected.json').entry,
  ] }
  const r = parse(body)
  assert.equal(r.messages.length, 1)
  assert.equal(r.statuses.length, 1)
  assert.equal(r.echoes.length, 1)
  assert.equal(r.connection, 'connected')
})

test('tipos sinteticos: video, sticker, localizacao, contato, reacao, botao, lista e desconhecido', () => {
  const one = (m) => parse(wrap(m)).messages[0]
  assert.deepEqual([one({ type: 'video', video: { caption: '', id: 'V1' } }).text, one({ type: 'video', video: { id: 'V1' } }).mediaRef], ['[Video]', 'V1'])
  assert.deepEqual([one({ type: 'sticker', sticker: { id: 'S1' } }).type, one({ type: 'sticker', sticker: { id: 'S1' } }).text], ['sticker', '[Sticker]'])
  assert.equal(one({ type: 'location', location: { latitude: -23.3194284, longitude: -51.1185137, name: '' } }).text, '\u{1F4CD} Localizacao: -23.3194284, -51.1185137')
  assert.equal(one({ type: 'location', location: { name: 'Clinica' } }).text, '\u{1F4CD} Clinica')
  const contact = one({ type: 'contacts', contacts: [{ name: { formatted_name: 'Fulano' }, phones: [{ phone: '+55 11 3000-0000' }] }] })
  assert.deepEqual([contact.type, contact.text, contact.mediaRef], ['contact', '\u{1F464} Fulano — 551130000000', '551130000000'])
  assert.equal(one({ type: 'reaction', reaction: { emoji: '😮', message_id: 'X' } }).text, '😮 (reacao)')
  assert.deepEqual([one({ type: 'button_reply', interactive: { button_reply: { id: 'b1', title: 'Sim' } } }).type, one({ type: 'button_reply', interactive: { button_reply: { id: 'b1', title: 'Sim' } } }).text], ['text', 'Sim'])
  assert.equal(one({ type: 'button_reply', interactive: { type: 'list_reply', list_reply: { id: 'r2', title: 'Opcao 2' } } }).text, 'Opcao 2')
  assert.deepEqual([one({ type: 'order' }).type, one({ type: 'order' }).text], ['unknown', '[order]'])
})

test('corpo invalido nao lanca', () => {
  for (const b of [null, undefined, 'x', {}, { entry: 'x' }, { entry: [{ changes: [{ field: 'messages', value: null }] }] }]) {
    assert.deepEqual(parseMetaWebhook(b, { log: null }).messages, [])
  }
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/metaFormat.test.js`
Expected: FAIL — `Cannot find module '…/metaFormat.js'`.

- [ ] **Passo 3: Implementar** — `server/services/whatsapp/metaFormat.js`

```js
// Leitura de avisos no formato da Cloud API da Meta (object/entry/changes/value).
// Puro (sem rede, sem banco): serve a UzAPI agora e a API Oficial (fase 3 do spec de provedores) depois.
import { normalizePhone } from './normalize.js'

const STATUS_MAP = { sent: 'sent', delivered: 'delivered', read: 'read', played: 'read', failed: 'failed', deleted: 'deleted' }
// "desconnected" e a grafia da UzAPI
const CONNECTION_MAP = { connected: 'connected', desconnected: 'disconnected', disconnected: 'disconnected' }
const QR_KEYS = ['qrcode', 'qrCode', 'qr_code', 'qr', 'base64', 'code']

function toIso(ts) {
  const n = parseInt(ts, 10)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString()
}

function isGroupMessage(m) {
  const from = String(m.from || '')
  return m.isGroup === true || !!m.group_id || from.includes('@g.us') || from.includes('broadcast')
}

// Procura um QR (texto do WhatsApp ou imagem base64) por nome de campo, ate 4 niveis.
export function extractQr(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null
  for (const k of QR_KEYS) {
    const v = obj[k]
    if (typeof v === 'string' && v.length >= 20) return v
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const found = extractQr(v, depth + 1)
      if (found) return found
    }
  }
  return null
}

function contactText(m) {
  const list = Array.isArray(m.contacts) ? m.contacts : []
  const parsed = list.map(c => ({
    name: c?.name?.formatted_name || c?.name?.first_name || '',
    phone: String(c?.phones?.[0]?.wa_id || c?.phones?.[0]?.phone || '').replace(/[^\d]/g, ''),
  })).filter(c => c.name || c.phone)
  if (parsed.length === 0) return { text: '\u{1F464} Contato compartilhado', mediaRef: null }
  if (parsed.length === 1) {
    const c = parsed[0]
    return { text: c.phone ? `\u{1F464} ${c.name || 'Contato'} — ${c.phone}` : `\u{1F464} Contato: ${c.name}`, mediaRef: c.phone || null }
  }
  const parts = parsed.map(c => c.phone ? `${c.name || 'Contato'} (${c.phone})` : (c.name || 'Contato'))
  return { text: `\u{1F464} ${parsed.length} contatos: ${parts.join(' | ')}`, mediaRef: parsed.find(c => c.phone)?.phone || null }
}

// value.messages[i] -> NormalizedMessage (mesmos textos de placeholder da Evolution) ou null (grupo/sem remetente).
export function parseMetaMessage(m, contacts = []) {
  if (!m || typeof m !== 'object' || isGroupMessage(m)) return null
  const digits = String(m.from || '').replace(/[^\d]/g, '')
  if (!digits || !m.id) return null
  const phone = normalizePhone(digits)
  const contact = (contacts || []).find(c => String(c?.wa_id || '') === String(m.from)) || null
  const base = {
    phone,
    remoteId: `${phone}@s.whatsapp.net`,
    fromMe: false,
    messageId: String(m.id),
    pushName: contact?.profile?.name || '',
    timestamp: toIso(m.timestamp),
    mediaRef: null,
  }
  switch (m.type) {
    case 'text': return { ...base, type: 'text', text: m.text?.body || '' }
    case 'image': return { ...base, type: 'image', text: m.image?.caption || '[Imagem]', mediaRef: m.image?.id || null }
    case 'video': return { ...base, type: 'video', text: m.video?.caption || '[Video]', mediaRef: m.video?.id || null }
    case 'audio': return { ...base, type: 'audio', text: '[Audio]', mediaRef: m.audio?.id || null }
    case 'document': return {
      ...base, type: 'document', text: m.document?.caption || m.document?.filename || '[Documento]',
      mediaRef: m.document?.id || null, fileName: m.document?.filename || null,
    }
    case 'sticker': return { ...base, type: 'sticker', text: '[Sticker]', mediaRef: m.sticker?.id || null }
    case 'location': {
      const l = m.location || {}
      const text = l.name
        ? `\u{1F4CD} ${l.name}`
        : (l.latitude && l.longitude ? `\u{1F4CD} Localizacao: ${l.latitude}, ${l.longitude}` : '\u{1F4CD} Localizacao compartilhada')
      return { ...base, type: 'location', text }
    }
    case 'contacts': return { ...base, type: 'contact', ...contactText(m) }
    case 'reaction': return { ...base, type: 'reaction', text: `${m.reaction?.emoji || '❤️'} (reacao)` }
    case 'button': return { ...base, type: 'text', text: m.button?.text || '[Botao clicado]' }
    case 'interactive':
    case 'button_reply':
    case 'list_reply': {
      const r = m.interactive?.button_reply || m.interactive?.list_reply
      return { ...base, type: 'text', text: r?.title || '[Opcao selecionada]' }
    }
    default: return { ...base, type: 'unknown', text: `[${m.type || 'desconhecido'}]` }
  }
}

// outboundOnly: o handleStatusUpdate so aplica em mensagem ENVIADA pelo CRM
// (a UzAPI manda tambem a leitura que o proprio numero faz das recebidas).
export function parseMetaStatus(s) {
  const status = STATUS_MAP[s?.status]
  if (!s?.id || !status) return null
  return { messageId: String(s.id), status, timestamp: toIso(s.timestamp), recipientId: String(s.recipient_id || ''), outboundOnly: true }
}

export function parseMetaWebhook(body, opts = {}) {
  const log = opts.log === undefined ? console.warn : opts.log
  const out = { messages: [], statuses: [], echoes: [], connection: null, qr: null, ignored: 0 }
  if (!body || typeof body !== 'object' || !Array.isArray(body.entry)) return out
  for (const entry of body.entry) {
    for (const change of (entry?.changes || [])) {
      const value = change?.value || {}
      const pnid = String(value.metadata?.phone_number_id || '')
      if (opts.phoneNumberId && pnid !== String(opts.phoneNumberId)) {
        out.ignored++
        if (log) log(`[metaFormat] phone_number_id "${pnid}" nao e o do numero — aviso descartado`)
        continue
      }
      if (change.field === 'connection') {
        const raw = Array.isArray(value.status) ? value.status[0]?.connection : value.status?.connection
        if (CONNECTION_MAP[raw]) out.connection = CONNECTION_MAP[raw]
        const qr = extractQr(value)
        if (qr) out.qr = qr
        continue
      }
      if (change.field === 'authentication') {
        const qr = extractQr(value)
        if (qr) out.qr = qr
        continue
      }
      if (change.field !== 'messages') continue
      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      for (const m of (Array.isArray(value.messages) ? value.messages : [])) {
        const n = parseMetaMessage(m, contacts)
        if (n) out.messages.push(n)
      }
      const ownNumber = String(value.metadata?.display_phone_number || '')
      for (const s of (Array.isArray(value.statuses) ? value.statuses : [])) {
        const n = parseMetaStatus(s)
        if (!n) continue
        out.statuses.push(n)
        // recipient_id vazio = mensagem que SAIU do numero (pela API ou pelo celular). O eco filtra as que o CRM ja tem.
        if (n.recipientId !== '') continue
        const waId = String(contacts[0]?.wa_id || '').replace(/[^\d]/g, '')
        if (waId && waId !== ownNumber) out.echoes.push({ messageId: n.messageId, phone: normalizePhone(waId), timestamp: n.timestamp })
      }
    }
  }
  return out
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/metaFormat.test.js`
Expected: PASS (12 testes).

- [ ] **Passo 5: Commit**

```bash
git add server/services/whatsapp/metaFormat.js test/metaFormat.test.js
git commit -m "feat: leitura de avisos no formato Meta (UzAPI agora, API Oficial depois)"
```

---

### Tarefa 5: Cliente HTTP + adaptador UzAPI (envio, mídia, leitura, eco) na tomada

**Arquivos:**
- Criar: `server/services/whatsapp/uzapiClient.js`
- Criar: `server/services/whatsapp/uzapi.js`
- Modificar: `server/services/whatsapp/index.js`
- Modificar: `test/evolutionParse.test.js:154`
- Teste: `test/uzapiAdapter.test.js`

**Interfaces:**
- Consome: `tryReadUzapiConfig`, `readUzapiPhoneNumberId` (Tarefa 3); `parseMetaWebhook` (Tarefa 4); `fakeFetch`, `UZAPI_TEST_ENV`, `insertUzapiInstance` (Tarefas 1 e 3).
- Produz (`uzapiClient.js`): `DEFAULT_UZAPI_BASE_URL`, `DEFAULT_UZAPI_PANEL_URL`, `getUzapiEnv(env) → { baseUrl, username, accountToken, panelUrl }`, `isUzapiConfigured(env) → boolean`, `phonePath(phoneNumberId, suffix) → string`, `createUzapiClient({ fetch, env, timeoutMs }) → { request(method, path, { token, json, form, timeout }) → { ok, status, data, error? }, download(url, { timeout }) → { ok, status, buffer?, contentType? } }`, `reasonFromResponse(r) → string` (`provider_auth` em 401/403, `provider_error` em 5xx/rede).
- Produz (`uzapi.js`): `UZAPI_CAPABILITIES`, `parseChatMessage(data, { phone, messageId }) → NormalizedMessage | null`, `createUzapiAdapter({ fetch, env, FormData, Blob, getMediaTemp, log })`, `configureUzapiMediaTemp(mediaTemp)`, `uzapiAdapter`. Métodos: `sendText(instance, phone, text, opts?) → { ok, messageId, reason?, raw? }`, `sendMedia(instance, phone, { type, base64, url, mimetype, fileName, caption })`, `fetchMedia(instance, message) → { buffer, mimetype }` (lança `code='media_not_found'`), `parseWebhook(instance, body, headers)`, `fetchMessageById(instance, messageId, { phone }) → NormalizedMessage | null`.
- `getProvider({ provider: 'uzapi' })` passa a devolver o adaptador; `listProviders()` → `['evolution', 'uzapi']`.

- [ ] **Passo 1: Escrever o teste que falha** — `test/uzapiAdapter.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FormData } from 'node-fetch'
import { createUzapiAdapter, parseChatMessage, UZAPI_CAPABILITIES } from '../server/services/whatsapp/uzapi.js'
import { reasonFromResponse, getUzapiEnv, isUzapiConfigured } from '../server/services/whatsapp/uzapiClient.js'
import { buildUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { getProvider, listProviders } from '../server/services/whatsapp/index.js'
import { fakeFetch, quietLog, loadUzapiFixture, UZAPI_TEST_ENV, UZAPI_PNID, LEAD_PHONE } from './helpers/uzapiFixtures.js'

const BASE = 'https://uzapi.test/dros/v1'
const inst = { id: 7, account_id: 1, provider: 'uzapi', instance_name: 'Loja', provider_config: buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV) }
const make = (f, extra = {}) => createUzapiAdapter({ fetch: f, env: UZAPI_TEST_ENV, log: quietLog, ...extra })
const ok201 = (messageId = '3EB0AAA111') => ({ status: 201, json: { status: 'success', queueId: 'q1', messageId, messages: [{ id: 'wamid.x' }] } })

test('capabilities: sem presenca, sem checagem de numero, sem polling; com digitando embutido', () => {
  assert.deepEqual(UZAPI_CAPABILITIES, { qr: true, presence: false, readReceipts: false, numberCheck: false, templates: false, window24h: false, polling: false, typingDelay: true })
})

test('tomada: uzapi registrado ao lado da evolution', () => {
  assert.equal(getProvider({ provider: 'uzapi' }).name, 'uzapi')
  assert.deepEqual(listProviders(), ['evolution', 'uzapi'])
})

test('env: URL base padrao e "configurado" so com usuario e token da conta', () => {
  assert.equal(getUzapiEnv({}).baseUrl, 'https://api.uzapi.com.br')
  assert.equal(getUzapiEnv({ UZAPI_BASE_URL: 'https://x.test/' }).baseUrl, 'https://x.test')
  assert.equal(isUzapiConfigured({ UZAPI_USERNAME: 'u' }), false)
  assert.equal(isUzapiConfigured(UZAPI_TEST_ENV), true)
})

test('sendText: POST /{usuario}/v1/{pnid}/messages com Bearer do numero; 201 devolve o messageId (o id que volta nos status)', async () => {
  const f = fakeFetch(() => ok201())
  const r = await make(f).sendText(inst, '5548990000002', 'Ola')
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/messages`)
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.equal(f.calls[0].init.headers['Content-Type'], 'application/json')
  assert.ok(f.calls[0].init.signal)
  assert.deepEqual(f.calls[0].body, { to: '5548990000002', type: 'text', text: { body: 'Ola' } })
  assert.equal(r.ok, true)
  assert.equal(r.messageId, '3EB0AAA111')
})

test('sendText: delayTyping vai no corpo quando pedido', async () => {
  const f = fakeFetch(() => ok201())
  await make(f).sendText(inst, '5548990000002', 'Ola', { delayTyping: 3 })
  assert.equal(f.calls[0].body.delayTyping, 3)
})

test('sendText: erros viram reason (401 provider_auth, 5xx e rede provider_error, 400 com mensagem) e nunca lancam', async () => {
  const cases = [
    [() => ({ status: 401, json: { message: 'Unauthorized' } }), 'provider_auth'],
    [() => ({ status: 502, bodyText: '<html>' }), 'provider_error'],
    [() => new Error('ECONNRESET'), 'provider_error'],
    [() => ({ status: 400, json: { message: ['to invalido'] } }), 'to invalido'],
    [() => ({ status: 201, json: { status: 'success' } }), 'provider_no_message_id'],
  ]
  for (const [responder, reason] of cases) {
    const r = await make(fakeFetch(responder)).sendText(inst, '1', 'x')
    assert.equal(r.ok, false)
    assert.equal(r.reason, reason)
  }
  const semConfig = await make(fakeFetch(() => ok201())).sendText({ id: 9, provider: 'uzapi', provider_config: null }, '1', 'x')
  assert.deepEqual(semConfig, { ok: false, messageId: null, reason: 'uzapi_config_missing' })
})

test('reasonFromResponse', () => {
  assert.equal(reasonFromResponse({ status: 403, data: null }), 'provider_auth')
  assert.equal(reasonFromResponse({ status: 0, data: null, error: 'timeout' }), 'provider_error')
  assert.equal(reasonFromResponse({ status: 404, data: null }), 'http_404')
})

test('sendMedia com url: envia por link', async () => {
  const f = fakeFetch(() => ok201('3EBIMG'))
  const r = await make(f).sendMedia(inst, '5548990000002', { type: 'image', url: 'https://x.test/a.jpg', caption: 'Veja' })
  assert.deepEqual(f.calls[0].body, { to: '5548990000002', type: 'image', image: { link: 'https://x.test/a.jpg', caption: 'Veja' } })
  assert.equal(r.messageId, '3EBIMG')
})

test('sendMedia com base64: sobe em /media (multipart) e envia pelo id; documento leva filename e legenda', async () => {
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 201, json: { id: 'MEDIA123' } } : ok201('3EBDOC'))
  const r = await make(f).sendMedia(inst, '5548990000002', { type: 'document', base64: Buffer.from('%PDF').toString('base64'), mimetype: 'application/pdf', fileName: 'proposta.pdf', caption: 'Segue' })
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/media`)
  assert.ok(f.calls[0].body instanceof FormData)
  assert.equal(f.calls[0].body.get('messaging_product'), 'whatsapp')
  assert.equal(f.calls[0].body.get('file').name, 'proposta.pdf')
  assert.equal(f.calls[0].body.get('file').type, 'application/pdf')
  assert.equal(f.calls[0].init.headers['Content-Type'], undefined, 'o multipart define o proprio Content-Type')
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'document', document: { id: 'MEDIA123', caption: 'Segue', filename: 'proposta.pdf' } })
  assert.equal(r.messageId, '3EBDOC')
})

test('sendMedia de audio: sem legenda (chega como mensagem de voz)', async () => {
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 201, json: { id: 'AUD9' } } : ok201('3EBAUD'))
  await make(f).sendMedia(inst, '5548990000002', { type: 'audio', base64: 'T2dnUw==', mimetype: 'audio/ogg', fileName: 'a.ogg', caption: 'nao vai' })
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'audio', audio: { id: 'AUD9' } })
})

test('sendMedia: subida falhou -> link temporario do CRM; sem link temporario -> erro', async () => {
  const put = []
  const mediaTemp = { put: (buf, mime) => { put.push([buf.toString(), mime]); return 'https://crm.test/api/media-temp/' + 'f'.repeat(32) } }
  const f = fakeFetch((url) => url.endsWith('/media') ? { status: 500, json: {} } : ok201('3EBLINK'))
  const r = await make(f, { getMediaTemp: () => mediaTemp }).sendMedia(inst, '5548990000002', { type: 'image', base64: Buffer.from('JPG').toString('base64'), mimetype: 'image/jpeg' })
  assert.deepEqual(put, [['JPG', 'image/jpeg']])
  assert.deepEqual(f.calls[1].body, { to: '5548990000002', type: 'image', image: { link: 'https://crm.test/api/media-temp/' + 'f'.repeat(32) } })
  assert.equal(r.messageId, '3EBLINK')
  const semReserva = await make(fakeFetch(() => ({ status: 500, json: {} }))).sendMedia(inst, '1', { type: 'image', base64: 'QQ==' })
  assert.deepEqual(semReserva, { ok: false, messageId: null, reason: 'provider_error' })
})

test('fetchMedia: pega a url pelo media id (media_url da mensagem) e baixa o arquivo sem mandar token para a url', async () => {
  const f = fakeFetch((url) => url === `${BASE}/582578164494741`
    ? { json: { url: 'https://uzapi.test/v1/100000000000001/arquivo.ogg', mime_type: 'audio/ogg; codecs=opus' } }
    : { buffer: Buffer.from('OGGDATA'), headers: { 'content-type': 'audio/ogg' } })
  const r = await make(f).fetchMedia(inst, { wa_msg_id: '2AF1064222DEF32AAEBA', media_url: '582578164494741' })
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.equal(f.calls[1].url, 'https://uzapi.test/v1/100000000000001/arquivo.ogg')
  assert.equal(f.calls[1].init.headers, undefined)
  assert.equal(r.buffer.toString(), 'OGGDATA')
  assert.equal(r.mimetype, 'audio/ogg; codecs=opus')
})

test('fetchMedia: sem media id ou midia inexistente lanca media_not_found', async () => {
  const a = make(fakeFetch(() => ({ status: 404, json: {} })))
  await assert.rejects(() => a.fetchMedia(inst, { wa_msg_id: 'X' }), (e) => e.code === 'media_not_found')
  await assert.rejects(() => a.fetchMedia(inst, { wa_msg_id: 'X', media_url: 'M1' }), (e) => e.code === 'media_not_found')
})

test('parseWebhook: confere o phone_number_id do numero', () => {
  const a = make(fakeFetch(() => ok201()))
  assert.equal(a.parseWebhook(inst, loadUzapiFixture('message-text.json'), {}).messages.length, 1)
  const outro = { ...inst, provider_config: buildUzapiConfig({ phoneNumberId: '999999999999999', instanceToken: 'T' }, UZAPI_TEST_ENV) }
  assert.equal(a.parseWebhook(outro, loadUzapiFixture('message-text.json'), {}).messages.length, 0)
  assert.deepEqual(a.parseWebhook({ id: 1, provider_config: null }, loadUzapiFixture('message-text.json'), {}).messages, [])
})

test('fetchMessageById: POST /chats action get e devolve a mensagem como enviada (fromMe) no telefone dado', async () => {
  const f = fakeFetch(() => ({ json: loadUzapiFixture('chats-get-echo.synthetic.json') }))
  const r = await make(f).fetchMessageById(inst, '2A286AC5064891EF4DE7', { phone: LEAD_PHONE })
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/chats`)
  assert.deepEqual(f.calls[0].body, { type: 'chats', action: 'get', chats: { message_id: '2A286AC5064891EF4DE7' } })
  assert.deepEqual(r, {
    phone: LEAD_PHONE, remoteId: `${LEAD_PHONE}@s.whatsapp.net`, fromMe: true, messageId: '2A286AC5064891EF4DE7',
    pushName: '', timestamp: '2026-09-21T20:27:57.000Z', type: 'text', text: 'Resposta pelo celular', mediaRef: null,
  })
  assert.equal(await make(fakeFetch(() => ({ status: 401, json: {} }))).fetchMessageById(inst, 'X', { phone: LEAD_PHONE }), null)
})

test('parseChatMessage: Conversation, imagem sem texto e mensagem que nao e do numero', () => {
  const conv = parseChatMessage({ data: { Info: { ID: 'A1', IsFromMe: true }, Message: { Conversation: 'oi' } } }, { phone: LEAD_PHONE, messageId: 'A1' })
  assert.equal(conv.text, 'oi')
  const img = parseChatMessage({ data: { data: { Info: { IsFromMe: true }, Message: { imageMessage: { caption: '' } } } } }, { phone: LEAD_PHONE, messageId: 'A2' })
  assert.deepEqual([img.type, img.text, img.messageId], ['image', '[Imagem]', 'A2'])
  assert.equal(parseChatMessage({ data: { data: { Info: { IsFromMe: false }, Message: { Conversation: 'x' } } } }, { phone: LEAD_PHONE, messageId: 'A3' }), null)
  assert.equal(parseChatMessage({}, { phone: LEAD_PHONE, messageId: 'A4' }), null)
})
```

Em `test/evolutionParse.test.js`, troque a linha 154 por:
```js
  assert.deepEqual(listProviders(), ['evolution', 'uzapi'])
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/uzapiAdapter.test.js test/evolutionParse.test.js`
Expected: FAIL — `Cannot find module '…/uzapi.js'` e `listProviders` diferente.

- [ ] **Passo 3: Implementar** — `server/services/whatsapp/uzapiClient.js`

```js
// HTTP da UzAPI: https://api.uzapi.com.br/{usuario}/v1/<caminho>, Authorization: Bearer.
// Le o env na hora da chamada (em ESM os imports rodam antes do dotenv.config do server/index.js).
export const DEFAULT_UZAPI_BASE_URL = 'https://api.uzapi.com.br'
export const DEFAULT_UZAPI_PANEL_URL = 'https://uzapi.com.br'
export const UZAPI_API_VERSION = 'v1'

export function getUzapiEnv(env = process.env) {
  return {
    baseUrl: String(env.UZAPI_BASE_URL || DEFAULT_UZAPI_BASE_URL).trim().replace(/\/+$/, ''),
    username: String(env.UZAPI_USERNAME || '').trim(),
    accountToken: String(env.UZAPI_ACCOUNT_TOKEN || '').trim(),
    panelUrl: String(env.UZAPI_PANEL_URL || DEFAULT_UZAPI_PANEL_URL).trim(),
  }
}

export function isUzapiConfigured(env = process.env) {
  const e = getUzapiEnv(env)
  return !!(e.username && e.accountToken)
}

export function phonePath(phoneNumberId, suffix) {
  return `${encodeURIComponent(phoneNumberId)}/${suffix}`
}

// { ok, status, data } -> reason curto para o chamador (mesma ideia do adaptador da Evolution)
export function reasonFromResponse(r) {
  if (r.status === 401 || r.status === 403) return 'provider_auth'
  if (!r.status || r.status >= 500) return 'provider_error'
  const msg = r.data?.message || r.data?.error
  if (msg) return String(Array.isArray(msg) ? msg.join('; ') : msg).substring(0, 200)
  return `http_${r.status}`
}

export function createUzapiClient({ fetch, env = process.env, timeoutMs = 15000 }) {
  // path relativo a /{usuario}/v1/ (sem barra inicial)
  async function request(method, path, { token, json, form, timeout = timeoutMs } = {}) {
    const e = getUzapiEnv(env)
    const url = `${e.baseUrl}/${encodeURIComponent(e.username)}/${UZAPI_API_VERSION}/${path}`
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    let body
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json) } else if (form) body = form
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal })
      const text = await res.text().catch(() => '')
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }
      return { ok: !!res.ok, status: res.status, data }
    } catch (err) {
      return { ok: false, status: 0, data: null, error: err.name === 'AbortError' ? 'timeout' : err.message }
    } finally {
      clearTimeout(timer)
    }
  }

  // A url de midia da UzAPI e publica e ja vem decifrada: baixa SEM token (nunca mandar o Bearer para fora).
  async function download(url, { timeout = 30000 } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal })
      if (!res.ok) return { ok: false, status: res.status }
      const buffer = Buffer.from(await res.arrayBuffer())
      return { ok: true, status: res.status, buffer, contentType: res.headers?.get?.('content-type') || null }
    } catch (err) {
      return { ok: false, status: 0, error: err.message }
    } finally {
      clearTimeout(timer)
    }
  }

  return { request, download }
}
```

- [ ] **Passo 4: Implementar** — `server/services/whatsapp/uzapi.js`

```js
// Adaptador UzAPI. A UzAPI imita a Cloud API da Meta (envio /{pnid}/messages, avisos entry/changes/value),
// mas por baixo e WhatsApp Web. A leitura dos avisos fica em metaFormat.js (reaproveitavel pela API Oficial).
// Envio nunca lanca: devolve { ok:false, reason } como o adaptador da Evolution.
import nodeFetch, { FormData as NodeFormData, Blob as NodeBlob } from 'node-fetch'
import { createUzapiClient, phonePath, reasonFromResponse } from './uzapiClient.js'
import { tryReadUzapiConfig, readUzapiPhoneNumberId } from './providerConfig.js'
import { parseMetaWebhook } from './metaFormat.js'

export const UZAPI_CAPABILITIES = Object.freeze({
  qr: true, presence: false, readReceipts: false, numberCheck: false, templates: false, window24h: false, polling: false, typingDelay: true,
})

const MEDIA_TYPES = ['image', 'video', 'audio', 'document', 'sticker']
const PLACEHOLDER = { image: '[Imagem]', video: '[Video]', audio: '[Audio]', document: '[Documento]', sticker: '[Sticker]' }

// Resposta de POST /{pnid}/chats { action:'get' } (formato whatsmeow) -> NormalizedMessage fromMe.
// O Chat vem como @lid, por isso o telefone vem de fora (contacts[0].wa_id do aviso de status).
export function parseChatMessage(data, { phone, messageId }) {
  const d = data?.data?.data || data?.data || data || {}
  const info = d.Info || d.info || {}
  const msg = d.Message || d.message || {}
  if (info.IsFromMe === false) return null
  const pick = (k) => msg[k] || msg[k.charAt(0).toLowerCase() + k.slice(1)]
  let type = 'text'
  let text = pick('Conversation') || pick('ExtendedTextMessage')?.text || ''
  if (!text) {
    const found = [['ImageMessage', 'image'], ['VideoMessage', 'video'], ['AudioMessage', 'audio'], ['DocumentMessage', 'document'], ['StickerMessage', 'sticker']]
      .find(([k]) => pick(k))
    if (!found) return null
    type = found[1]
    const inner = pick(found[0])
    text = inner.caption || inner.fileName || PLACEHOLDER[type]
  }
  const ts = info.Timestamp ? new Date(info.Timestamp) : null
  return {
    phone,
    remoteId: `${phone}@s.whatsapp.net`,
    fromMe: true,
    messageId: String(info.ID || info.Id || messageId),
    pushName: '',
    timestamp: ts && !isNaN(ts.getTime()) ? ts.toISOString() : new Date().toISOString(),
    type,
    text,
    mediaRef: null,
  }
}

export function createUzapiAdapter({ fetch, env = process.env, FormData = NodeFormData, Blob = NodeBlob, getMediaTemp = () => null, log = console }) {
  const client = createUzapiClient({ fetch, env })
  const config = (instance) => tryReadUzapiConfig(instance, env)

  async function postMessage(instance, payload) {
    const { cfg, error } = config(instance)
    if (error) return { ok: false, messageId: null, reason: error }
    const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'messages'), { token: cfg.instanceToken, json: payload })
    if (r.ok && r.data?.messageId) return { ok: true, messageId: String(r.data.messageId), raw: r.data }
    const reason = r.ok ? 'provider_no_message_id' : reasonFromResponse(r)
    if (reason === 'provider_auth') log.error(`[UzAPI] envio recusado com 401/403 (instancia ${instance.id}) — token do numero revogado?`)
    return r.data == null ? { ok: false, messageId: null, reason } : { ok: false, messageId: null, reason, raw: r.data }
  }

  async function uploadMedia(instance, buffer, mimetype, fileName) {
    const { cfg, error } = config(instance)
    if (error) return { id: null, reason: error }
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('file', new Blob([buffer], { type: mimetype || 'application/octet-stream' }), fileName || 'arquivo')
    const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'media'), { token: cfg.instanceToken, form, timeout: 60000 })
    const id = r.ok ? (r.data?.id || r.data?.media_id || r.data?.mediaId || null) : null
    return id ? { id: String(id) } : { id: null, reason: r.ok ? 'provider_no_media_id' : reasonFromResponse(r) }
  }

  return {
    name: 'uzapi',
    capabilities: UZAPI_CAPABILITIES,

    async sendText(instance, phone, text, opts = {}) {
      const payload = { to: phone, type: 'text', text: { body: text } }
      if (opts && opts.delayTyping) payload.delayTyping = opts.delayTyping
      return postMessage(instance, payload)
    },

    // base64 -> sobe em /media e envia por id; se a subida falhar, envia por link temporario do CRM (spec 4.5).
    async sendMedia(instance, phone, media = {}) {
      const { type, base64, url, mimetype, fileName, caption } = media
      const waType = MEDIA_TYPES.includes(type) ? type : 'document'
      const extra = {}
      if (caption && waType !== 'audio' && waType !== 'sticker') extra.caption = caption
      if (waType === 'document' && fileName) extra.filename = fileName
      if (url && !base64) return postMessage(instance, { to: phone, type: waType, [waType]: { link: url, ...extra } })
      if (!base64) return { ok: false, messageId: null, reason: 'media_empty' }
      const buffer = Buffer.from(String(base64).replace(/^data:[^;]+;base64,/, ''), 'base64')
      const up = await uploadMedia(instance, buffer, mimetype, fileName)
      if (up.id) return postMessage(instance, { to: phone, type: waType, [waType]: { id: up.id, ...extra } })
      const mediaTemp = getMediaTemp()
      if (!mediaTemp) return { ok: false, messageId: null, reason: up.reason || 'media_upload_failed' }
      log.warn(`[UzAPI] subida de midia falhou (${up.reason}); enviando por link temporario`)
      const link = mediaTemp.put(buffer, mimetype || 'application/octet-stream')
      return postMessage(instance, { to: phone, type: waType, [waType]: { link, ...extra } })
    },

    // message.media_url guarda o id da midia gravado na chegada (mediaRef).
    async fetchMedia(instance, message) {
      const notFound = (why) => { const e = new Error(`uzapi_media_not_found (${why})`); e.code = 'media_not_found'; return e }
      const mediaId = message?.media_url
      if (!mediaId) throw notFound('sem id da midia')
      const { cfg, error } = config(instance)
      if (error) throw notFound(error)
      const meta = await client.request('GET', encodeURIComponent(mediaId), { token: cfg.instanceToken })
      if (!meta.ok || !meta.data?.url) throw notFound(`status=${meta.status}`)
      const file = await client.download(meta.data.url)
      if (!file.ok) throw notFound(`download status=${file.status}`)
      return { buffer: file.buffer, mimetype: meta.data.mime_type || file.contentType || null }
    },

    // headers: a UzAPI nao assina; a protecao e o token na URL + a conferencia do phone_number_id.
    parseWebhook(instance, body, headers) {
      const phoneNumberId = readUzapiPhoneNumberId(instance)
      if (!phoneNumberId) {
        log.warn(`[UzAPI] instancia ${instance?.id} sem phone_number_id — aviso descartado`)
        return { messages: [], statuses: [], echoes: [], connection: null, qr: null, ignored: 0 }
      }
      return parseMetaWebhook(body, { phoneNumberId, log: (m) => log.warn(m) })
    },

    // Resposta dada pelo celular: a UzAPI so manda o status; o conteudo vem daqui.
    async fetchMessageById(instance, messageId, { phone } = {}) {
      const { cfg, error } = config(instance)
      if (error || !messageId || !phone) return null
      const r = await client.request('POST', phonePath(cfg.phoneNumberId, 'chats'), {
        token: cfg.instanceToken,
        json: { type: 'chats', action: 'get', chats: { message_id: messageId } },
      })
      if (!r.ok) {
        log.warn(`[UzAPI] busca da mensagem ${messageId} falhou: ${reasonFromResponse(r)}`)
        return null
      }
      return parseChatMessage(r.data, { phone, messageId })
    },
  }
}

let mediaTempRef = null
// Chamado no boot (server/index.js): liga a reserva de envio de midia por link temporario.
export function configureUzapiMediaTemp(mediaTemp) {
  mediaTempRef = mediaTemp
}

export const uzapiAdapter = createUzapiAdapter({ fetch: nodeFetch, getMediaTemp: () => mediaTempRef })
```

- [ ] **Passo 5: Registrar na tomada** — `server/services/whatsapp/index.js`

```js
// A "tomada": escolhe o adaptador pelo provider da instancia. Sem provider = evolution.
import { evolutionAdapter } from './evolution.js'
import { uzapiAdapter } from './uzapi.js'

const registry = new Map([
  ['evolution', evolutionAdapter],
  ['uzapi', uzapiAdapter],
])
```
(o resto do arquivo fica igual).

- [ ] **Passo 6: Rodar e ver passar**

Run: `node --test test/uzapiAdapter.test.js test/evolutionParse.test.js`
Expected: PASS.

- [ ] **Passo 7: Suíte inteira**

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 8: Commit**

```bash
git add server/services/whatsapp/uzapiClient.js server/services/whatsapp/uzapi.js server/services/whatsapp/index.js test/uzapiAdapter.test.js test/evolutionParse.test.js
git commit -m "feat: adaptador UzAPI na tomada (envio, midia, avisos e eco)"
```

---

### Tarefa 6: Sessão do número na UzAPI (criar, status/QR, webhook, logout, reiniciar, excluir)

**Arquivos:**
- Criar: `server/services/whatsapp/uzapiSession.js`
- Modificar: `server/services/whatsapp/uzapi.js` (import + espalhar os métodos da sessão)
- Teste: `test/uzapiSession.test.js`

**Interfaces:**
- Consome: `createUzapiClient`, `getUzapiEnv`, `phonePath`, `reasonFromResponse` (Tarefa 5); `tryReadUzapiConfig` (Tarefa 3); `extractQr` (Tarefa 4).
- Produz: `UZAPI_WEBHOOK_EVENTS`, `mapDeploymentStatus(d) → 'connected'|'connecting'|'disconnected'`, `extractInstanceCredentials(data) → { phoneNumberId, instanceToken, uzapiInstanceId }`, `createUzapiSession({ client, env, log })` com: `createInstance({ name, webhookUrl }) → { phoneNumberId, instanceToken, uzapiInstanceId, qr }` (lança com `code` ∈ `uzapi_not_configured|provider_auth|uzapi_create_failed|uzapi_create_incomplete`), `status(instance) → { ok, status, phoneNumber, qr, reason? }` (não lança), `getQr(instance) → { ok, qr, status, reason? }`, `registerWebhook(instance, url)` (lança em falha), `disconnect/restart/remove(instance) → { ok, reason? }` (não lançam). Todos passam a existir no `uzapiAdapter`.

- [ ] **Passo 1: Escrever o teste que falha** — `test/uzapiSession.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUzapiAdapter } from '../server/services/whatsapp/uzapi.js'
import { mapDeploymentStatus, extractInstanceCredentials, UZAPI_WEBHOOK_EVENTS } from '../server/services/whatsapp/uzapiSession.js'
import { buildUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { fakeFetch, quietLog, UZAPI_TEST_ENV, UZAPI_PNID } from './helpers/uzapiFixtures.js'

const BASE = 'https://uzapi.test/dros/v1'
const inst = { id: 7, provider: 'uzapi', instance_name: 'Loja', provider_config: buildUzapiConfig({ phoneNumberId: UZAPI_PNID, instanceToken: 'TOKEN-INSTANCIA' }, UZAPI_TEST_ENV) }
const make = (f, env = UZAPI_TEST_ENV) => createUzapiAdapter({ fetch: f, env, log: quietLog })
const WEBHOOK = 'https://crm.test/api/webhooks/whatsapp/' + 'c'.repeat(32)

test('eventos do webhook: sem grupos e sem historico', () => {
  assert.deepEqual({ ...UZAPI_WEBHOOK_EVENTS }, { authentication: true, connection: true, message_status: true, group_messages: false, group_events: false, history: false })
})

test('createInstance: POST /instance/add com o token da CONTA, QRCode e o webhook do numero', async () => {
  const f = fakeFetch(() => ({ status: 201, json: { phone_number_id: '100000000000009', token: 'TOKEN-NOVO' } }))
  const r = await make(f).createInstance({ name: 'Loja Centro', webhookUrl: WEBHOOK })
  assert.equal(f.calls[0].url, `${BASE}/instance/add`)
  assert.equal(f.calls[0].init.method, 'POST')
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer CONTA-TESTE')
  assert.deepEqual(f.calls[0].body, { name: 'Loja Centro', authenticationMethod: 'QRCode', webhook: WEBHOOK, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } })
  assert.deepEqual(r, { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null, qr: null })
})

test('createInstance: resposta embrulhada em data e sem token -> busca o token em GET /{pnid}/instance com o token da conta', async () => {
  const f = fakeFetch((url) => url.endsWith('/instance/add')
    ? { status: 201, json: { data: { phoneNumberId: 100000000000009, name: 'Loja Centro' } } }
    : { json: { deploymentStatus: 'pending', token: 'TOKEN-BUSCADO' } })
  const r = await make(f).createInstance({ name: 'Loja Centro', webhookUrl: WEBHOOK })
  assert.equal(f.calls[1].url, `${BASE}/100000000000009/instance`)
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer CONTA-TESTE')
  assert.deepEqual(r, { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-BUSCADO', uzapiInstanceId: 'Loja Centro', qr: null })
})

test('createInstance: erros com codigo', async () => {
  await assert.rejects(() => make(fakeFetch(() => ({ json: {} })), { ...UZAPI_TEST_ENV, UZAPI_ACCOUNT_TOKEN: '' }).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_not_configured')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 401, json: {} }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'provider_auth')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 409, json: { message: 'ja existe' } }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_create_failed')
  await assert.rejects(() => make(fakeFetch(() => ({ status: 201, json: { ok: true } }))).createInstance({ name: 'x', webhookUrl: WEBHOOK }), (e) => e.code === 'uzapi_create_incomplete')
})

test('extractInstanceCredentials aceita os nomes de campo provaveis', () => {
  assert.deepEqual(extractInstanceCredentials({ phone_number_id: '1', token: 't' }), { phoneNumberId: '1', instanceToken: 't', uzapiInstanceId: null })
  assert.deepEqual(extractInstanceCredentials({ data: { phoneNumberId: 2, accessToken: 'a', name: 'n' } }), { phoneNumberId: '2', instanceToken: 'a', uzapiInstanceId: 'n' })
  assert.deepEqual(extractInstanceCredentials(null), { phoneNumberId: null, instanceToken: null, uzapiInstanceId: null })
})

test('mapDeploymentStatus', () => {
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'connected', isAuthenticated: true }), 'connected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'running', isAuthenticated: true }), 'connected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'desconnected', isAuthenticated: true }), 'disconnected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'stopped' }), 'disconnected')
  assert.equal(mapDeploymentStatus({ deploymentStatus: 'pending', isAuthenticated: false }), 'connecting')
  assert.equal(mapDeploymentStatus({}), 'connecting')
})

test('status: GET /{pnid}/instance com o token do numero; devolve status, telefone e QR (se vier)', async () => {
  const f = fakeFetch(() => ({ json: { deploymentStatus: 'connected', isAuthenticated: true, phoneNumber: '554890000001', token: 'NAO-USAR' } }))
  const r = await make(f).status(inst)
  assert.equal(f.calls[0].url, `${BASE}/${UZAPI_PNID}/instance`)
  assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-INSTANCIA')
  assert.deepEqual(r, { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null })
  const q = await make(fakeFetch(() => ({ json: { deploymentStatus: 'pending', qrcode: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' } }))).getQr(inst)
  assert.deepEqual(q, { ok: true, qr: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE', status: 'connecting', reason: undefined })
})

test('status: erro da UzAPI ou numero sem config nao lanca', async () => {
  assert.deepEqual(await make(fakeFetch(() => ({ status: 500, json: {} }))).status(inst), { ok: false, status: null, phoneNumber: null, qr: null, reason: 'provider_error' })
  assert.equal((await make(fakeFetch(() => ({ json: {} }))).status({ id: 1, provider_config: null })).reason, 'uzapi_config_missing')
})

test('registerWebhook: le a instancia e faz PUT /instance/update mantendo os demais campos', async () => {
  const f = fakeFetch((url, init) => init.method === 'GET'
    ? { json: { name: 'Loja', authenticationMethod: 'QRCode', autoRejectCall: true, answerMissedCall: 'Ligo depois', webhook: 'https://antigo' } }
    : { status: 201, json: {} })
  await make(f).registerWebhook(inst, WEBHOOK)
  assert.equal(f.calls[1].url, `${BASE}/${UZAPI_PNID}/instance/update`)
  assert.equal(f.calls[1].init.method, 'PUT')
  assert.deepEqual(f.calls[1].body, { authenticationMethod: 'QRCode', webhook: WEBHOOK, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS }, name: 'Loja', autoRejectCall: true, answerMissedCall: 'Ligo depois' })
  await assert.rejects(() => make(fakeFetch((u, i) => i.method === 'GET' ? { json: {} } : { status: 500, json: {} })).registerWebhook(inst, WEBHOOK), /uzapi_update_failed/)
})

test('disconnect, restart e remove: rotas e metodos certos; falha vira ok:false', async () => {
  const f = fakeFetch(() => ({ status: 201, json: {} }))
  const a = make(f)
  assert.deepEqual(await a.disconnect(inst), { ok: true })
  assert.deepEqual(await a.restart(inst), { ok: true })
  assert.deepEqual(await a.remove(inst), { ok: true })
  assert.deepEqual(f.calls.map(c => [c.init.method, c.url]), [
    ['POST', `${BASE}/${UZAPI_PNID}/instance/logout`],
    ['POST', `${BASE}/${UZAPI_PNID}/instance/restart`],
    ['DELETE', `${BASE}/${UZAPI_PNID}/instance/delete`],
  ])
  assert.deepEqual(await make(fakeFetch(() => ({ status: 409, json: { message: 'instancia nao existe' } }))).remove(inst), { ok: false, reason: 'instancia nao existe' })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/uzapiSession.test.js`
Expected: FAIL — `Cannot find module '…/uzapiSession.js'`.

- [ ] **Passo 3: Implementar** — `server/services/whatsapp/uzapiSession.js`

```js
// Sessao do numero na UzAPI: criar, status/QR, webhook, logout, reiniciar, excluir.
// Criar usa o token da CONTA da Dros (.env); o resto usa o token do NUMERO (cifrado no provider_config).
// GET /{pnid}/instance devolve o token do numero: nunca logar a resposta crua.
import { getUzapiEnv, phonePath, reasonFromResponse } from './uzapiClient.js'
import { tryReadUzapiConfig } from './providerConfig.js'
import { extractQr } from './metaFormat.js'

export const UZAPI_WEBHOOK_EVENTS = Object.freeze({
  authentication: true, connection: true, message_status: true, group_messages: false, group_events: false, history: false,
})

const DISCONNECTED_STATES = ['desconnected', 'disconnected', 'logout', 'loggedout', 'stopped', 'deleted', 'failed', 'error']

export function mapDeploymentStatus(d) {
  const s = String(d?.deploymentStatus || '').toLowerCase()
  if (DISCONNECTED_STATES.includes(s)) return 'disconnected'
  if (d?.isAuthenticated === true || s === 'connected') return 'connected'
  return 'connecting'
}

// Algumas respostas vem embrulhadas em { data: {...} }
function unwrap(data) {
  if (data && typeof data.data === 'object' && data.data !== null && !Array.isArray(data.data)) return { ...data, ...data.data }
  return data && typeof data === 'object' ? data : {}
}

// Formato da resposta de /instance/add ainda nao confirmado (spec 9): aceita os nomes provaveis.
export function extractInstanceCredentials(data) {
  const d = unwrap(data)
  const phoneNumberId = d.phone_number_id ?? d.phoneNumberId ?? d.instanceId ?? d.id ?? null
  const instanceToken = d.token ?? d.accessToken ?? d.access_token ?? d.apiKey ?? d.jwt ?? null
  return {
    phoneNumberId: phoneNumberId == null ? null : String(phoneNumberId),
    instanceToken: instanceToken == null ? null : String(instanceToken),
    uzapiInstanceId: d.name ? String(d.name) : null,
  }
}

function codedError(code, message = code) {
  const e = new Error(message)
  e.code = code
  return e
}

export function createUzapiSession({ client, env = process.env, log = console }) {
  async function status(instance) {
    const { cfg, error } = tryReadUzapiConfig(instance, env)
    if (error) return { ok: false, status: null, phoneNumber: null, qr: null, reason: error }
    const r = await client.request('GET', phonePath(cfg.phoneNumberId, 'instance'), { token: cfg.instanceToken })
    if (!r.ok) return { ok: false, status: null, phoneNumber: null, qr: null, reason: reasonFromResponse(r) }
    const d = unwrap(r.data)
    return { ok: true, status: mapDeploymentStatus(d), phoneNumber: String(d.phoneNumber || '').replace(/[^\d]/g, '') || null, qr: extractQr(d) }
  }

  async function simple(instance, method, suffix) {
    const { cfg, error } = tryReadUzapiConfig(instance, env)
    if (error) return { ok: false, reason: error }
    const r = await client.request(method, phonePath(cfg.phoneNumberId, suffix), { token: cfg.instanceToken })
    return r.ok ? { ok: true } : { ok: false, reason: reasonFromResponse(r) }
  }

  return {
    async createInstance({ name, webhookUrl }) {
      const e = getUzapiEnv(env)
      if (!e.username || !e.accountToken) throw codedError('uzapi_not_configured')
      const body = { name, authenticationMethod: 'QRCode', webhook: webhookUrl, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } }
      const r = await client.request('POST', 'instance/add', { token: e.accountToken, json: body, timeout: 30000 })
      if (!r.ok) {
        const reason = reasonFromResponse(r)
        throw codedError(reason === 'provider_auth' ? 'provider_auth' : 'uzapi_create_failed', `uzapi_create_failed: ${reason}`)
      }
      let creds = extractInstanceCredentials(r.data)
      if (creds.phoneNumberId && !creds.instanceToken) {
        const more = await client.request('GET', phonePath(creds.phoneNumberId, 'instance'), { token: e.accountToken })
        creds = { ...creds, instanceToken: extractInstanceCredentials(more.data).instanceToken }
      }
      if (!creds.phoneNumberId || !creds.instanceToken) {
        log.error(`[UzAPI] /instance/add sem phone_number_id ou token; campos recebidos: ${Object.keys(unwrap(r.data)).join(',')}`)
        throw codedError('uzapi_create_incomplete')
      }
      return { ...creds, qr: extractQr(unwrap(r.data)) }
    },

    status,

    async getQr(instance) {
      const st = await status(instance)
      return { ok: st.ok, qr: st.qr, status: st.status, reason: st.reason }
    },

    async registerWebhook(instance, url) {
      const { cfg, error } = tryReadUzapiConfig(instance, env)
      if (error) throw codedError(error)
      const cur = await client.request('GET', phonePath(cfg.phoneNumberId, 'instance'), { token: cfg.instanceToken })
      const d = unwrap(cur.data)
      const body = { authenticationMethod: d.authenticationMethod || 'QRCode', webhook: url, webhookEvents: { ...UZAPI_WEBHOOK_EVENTS } }
      for (const k of ['name', 'appVersion', 'autoRejectCall', 'answerMissedCall']) {
        if (d[k] !== undefined && d[k] !== null) body[k] = d[k]
      }
      const r = await client.request('PUT', phonePath(cfg.phoneNumberId, 'instance/update'), { token: cfg.instanceToken, json: body })
      if (!r.ok) throw codedError('uzapi_update_failed', `uzapi_update_failed: ${reasonFromResponse(r)}`)
    },

    disconnect: (instance) => simple(instance, 'POST', 'instance/logout'),
    restart: (instance) => simple(instance, 'POST', 'instance/restart'),
    remove: (instance) => simple(instance, 'DELETE', 'instance/delete'),
  }
}
```

- [ ] **Passo 4: Ligar a sessão no adaptador** — `server/services/whatsapp/uzapi.js`

Acrescente o import:
```js
import { createUzapiSession } from './uzapiSession.js'
```
e, no objeto devolvido por `createUzapiAdapter`, logo depois de `capabilities: UZAPI_CAPABILITIES,`, acrescente:
```js
    ...createUzapiSession({ client, env, log }),
```

- [ ] **Passo 5: Rodar e ver passar**

Run: `node --test test/uzapiSession.test.js test/uzapiAdapter.test.js`
Expected: PASS.

- [ ] **Passo 6: Commit**

```bash
git add server/services/whatsapp/uzapiSession.js server/services/whatsapp/uzapi.js test/uzapiSession.test.js
git commit -m "feat: sessao do numero na UzAPI (criar, status, QR, webhook, logout, reiniciar, excluir)"
```

---

### Tarefa 7: Link temporário de mídia (reserva do envio)

**Arquivos:**
- Criar: `server/services/mediaTemp.js`
- Criar: `server/routes/mediaTemp.js`
- Modificar: `server/index.js`
- Modificar: `.gitignore`
- Teste: `test/mediaTemp.test.js`

**Interfaces:**
- Consome: tabela `media_temp` (Tarefa 2); `getPublicBaseUrl` (`server/services/publicUrl.js`); `configureUzapiMediaTemp` (Tarefa 5).
- Produz: `MEDIA_TEMP_TTL_MS = 600000`, `createMediaTemp({ db, dir, env, nowMs }) → { put(buffer, mimetype) → url, get(token) → { buffer, mimetype } | null, cleanup() → number }`; `createMediaTempRouter(mediaTemp) → express.Router` (`GET /:token`).

- [ ] **Passo 1: Escrever o teste que falha** — `test/mediaTemp.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import http from 'node:http'
import express from 'express'
import { createTestDb } from './helpers/db.js'
import { createMediaTemp, MEDIA_TEMP_TTL_MS } from '../server/services/mediaTemp.js'
import { createMediaTempRouter } from '../server/routes/mediaTemp.js'

function setup() {
  const db = createTestDb()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-temp-'))
  let now = Date.parse('2026-09-22T12:00:00Z')
  const mt = createMediaTemp({ db, dir, env: { PUBLIC_BASE_URL: 'https://crm.test' }, nowMs: () => now })
  return { db, dir, mt, advance: (ms) => { now += ms } }
}
const tokenOf = (url) => url.split('/').pop()

test('put grava o arquivo e devolve a URL publica com token de 32 hex; get devolve o conteudo', () => {
  const { mt, dir } = setup()
  const url = mt.put(Buffer.from('JPGDATA'), 'image/jpeg')
  assert.match(url, /^https:\/\/crm\.test\/api\/media-temp\/[a-f0-9]{32}$/)
  assert.equal(fs.readdirSync(dir).length, 1)
  const f = mt.get(tokenOf(url))
  assert.equal(f.buffer.toString(), 'JPGDATA')
  assert.equal(f.mimetype, 'image/jpeg')
})

test('10 minutos: o link expira e o arquivo e apagado', () => {
  const { mt, dir, advance } = setup()
  const url = mt.put(Buffer.from('X'), 'image/png')
  advance(MEDIA_TEMP_TTL_MS - 1000)
  assert.ok(mt.get(tokenOf(url)))
  advance(2000)
  assert.equal(mt.get(tokenOf(url)), null)
  assert.equal(fs.readdirSync(dir).length, 0)
})

test('token invalido ou desconhecido devolve null', () => {
  const { mt } = setup()
  assert.equal(mt.get('../../etc/passwd'), null)
  assert.equal(mt.get('f'.repeat(32)), null)
  assert.equal(mt.get(undefined), null)
})

test('cleanup apaga os vencidos e mantem os validos', () => {
  const { mt, db, advance } = setup()
  mt.put(Buffer.from('A'), 'image/png')
  advance(MEDIA_TEMP_TTL_MS + 1)
  const novo = mt.put(Buffer.from('B'), 'image/png')
  assert.equal(mt.cleanup(), 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_temp').get().n, 1)
  assert.ok(mt.get(tokenOf(novo)))
})

test('rota GET /api/media-temp/:token serve o arquivo com o tipo certo e 404 quando nao existe', async () => {
  const { mt } = setup()
  const url = mt.put(Buffer.from('OGG'), 'audio/ogg')
  const app = express()
  app.use('/api/media-temp', createMediaTempRouter(mt))
  const server = http.createServer(app)
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const ok = await fetch(`${base}/api/media-temp/${tokenOf(url)}`)
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('content-type'), 'audio/ogg')
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.equal(await ok.text(), 'OGG')
    const nf = await fetch(`${base}/api/media-temp/${'0'.repeat(32)}`)
    assert.equal(nf.status, 404)
  } finally {
    await new Promise(r => server.close(r))
  }
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/mediaTemp.test.js`
Expected: FAIL — `Cannot find module '…/mediaTemp.js'`.

- [ ] **Passo 3: Implementar** — `server/services/mediaTemp.js`

```js
// Arquivo temporario servido por link publico por no maximo 10 minutos.
// So e usado quando a subida de midia para a UzAPI falha (spec 4.5): a UzAPI baixa pelo link e envia.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { getPublicBaseUrl } from './publicUrl.js'

export const MEDIA_TEMP_TTL_MS = 10 * 60 * 1000
const TOKEN_RE = /^[a-f0-9]{32}$/

export function createMediaTemp({ db, dir, env = process.env, nowMs = () => Date.now() }) {
  function removeRow(row) {
    try { fs.unlinkSync(row.file_path) } catch {}
    db.prepare('DELETE FROM media_temp WHERE token = ?').run(row.token)
  }

  function put(buffer, mimetype) {
    fs.mkdirSync(dir, { recursive: true })
    const token = crypto.randomBytes(16).toString('hex')
    const filePath = path.join(dir, token)
    fs.writeFileSync(filePath, buffer)
    db.prepare('INSERT INTO media_temp (token, file_path, mimetype, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, filePath, mimetype || 'application/octet-stream', new Date(nowMs() + MEDIA_TEMP_TTL_MS).toISOString())
    return `${getPublicBaseUrl(env)}/api/media-temp/${token}`
  }

  function get(token) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
    const row = db.prepare('SELECT * FROM media_temp WHERE token = ?').get(token)
    if (!row) return null
    if (Date.parse(row.expires_at) <= nowMs()) { removeRow(row); return null }
    try {
      return { buffer: fs.readFileSync(row.file_path), mimetype: row.mimetype }
    } catch {
      removeRow(row)
      return null
    }
  }

  function cleanup() {
    const rows = db.prepare('SELECT * FROM media_temp WHERE expires_at <= ?').all(new Date(nowMs()).toISOString())
    for (const row of rows) removeRow(row)
    return rows.length
  }

  return { put, get, cleanup }
}
```

`server/routes/mediaTemp.js`:
```js
// GET /api/media-temp/:token — publico (a UzAPI baixa daqui). Token aleatorio de 32 hex, validade de 10 minutos.
import { Router } from 'express'

export function createMediaTempRouter(mediaTemp) {
  const router = Router()
  router.get('/:token', (req, res) => {
    const file = mediaTemp.get(req.params.token)
    if (!file) return res.status(404).json({ error: 'Arquivo expirado ou inexistente' })
    res.set('Content-Type', file.mimetype || 'application/octet-stream')
    res.set('Cache-Control', 'no-store')
    res.send(file.buffer)
  })
  return router
}
```

- [ ] **Passo 4: Ligar no servidor** — `server/index.js`

Acrescente aos imports (junto dos outros, depois de `import { recoverPendingBroadcasts } from './routes/broadcasts.js'`):
```js
import { createMediaTemp } from './services/mediaTemp.js'
import { createMediaTempRouter } from './routes/mediaTemp.js'
import { configureUzapiMediaTemp } from './services/whatsapp/uzapi.js'
```
Logo depois de `app.use('/api/webhooks', webhookRoutes)`, acrescente:
```js
// Link temporario de midia (reserva do envio pela UzAPI). Publico; arquivos em server/data/media-temp por 10 min.
const mediaTemp = createMediaTemp({ db, dir: resolve(__dirname, 'data', 'media-temp') })
configureUzapiMediaTemp(mediaTemp)
app.use('/api/media-temp', createMediaTempRouter(mediaTemp))
setInterval(() => {
  try { mediaTemp.cleanup() } catch (e) { console.error('[MediaTemp] limpeza:', e.message) }
}, 60 * 1000)
```

Em `.gitignore`, acrescente a linha:
```
server/data/media-temp/
```

- [ ] **Passo 5: Rodar e ver passar**

Run: `node --test test/mediaTemp.test.js && node --check server/index.js`
Expected: PASS e nenhuma saída do `--check`.

- [ ] **Passo 6: Commit**

```bash
git add server/services/mediaTemp.js server/routes/mediaTemp.js server/index.js .gitignore test/mediaTemp.test.js
git commit -m "feat: link temporario de midia para o envio pela UzAPI"
```

---

### Tarefa 8: Envio com "digitando" embutido + status só em mensagem enviada

**Arquivos:**
- Modificar: `server/services/whatsapp/sender.js`
- Modificar: `server/services/inboundHandler.js:45-70` (`handleStatusUpdate`)
- Teste: `test/sender.test.js`, `test/inboundHandler.test.js`

**Interfaces:**
- Produz: `typingDelaySeconds(text) → 1..15` (1 s a cada 20 caracteres); `sendViaInstance` passa `{ delayTyping }` como 4º argumento de `provider.sendText` quando `capabilities.typingDelay` e não `skipTyping` (senão passa `undefined`).
- Produz: `handleStatusUpdate` respeita `status.outboundOnly === true` (só atualiza mensagem `direction='outbound'`). Evolution não manda o campo → comportamento igual ao de hoje.

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/sender.test.js`, troque o import do sender por:
```js
import { createSender, LEAD_DAILY_CAP_DEFAULT, typingDelaySeconds } from '../server/services/whatsapp/sender.js'
```
e acrescente no fim:
```js
test('typingDelaySeconds: 1s a cada 20 caracteres, entre 1 e 15', () => {
  assert.equal(typingDelaySeconds(''), 1)
  assert.equal(typingDelaySeconds('x'.repeat(20)), 1)
  assert.equal(typingDelaySeconds('x'.repeat(21)), 2)
  assert.equal(typingDelaySeconds('x'.repeat(1000)), 15)
})

test('provedor com typingDelay (UzAPI): manda delayTyping no envio; Chat humano (skipTyping) nao manda', async () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const opts = []
  const provider = {
    name: 'uz',
    capabilities: { numberCheck: false, presence: false, typingDelay: true },
    async sendText(i, phone, text, o) { opts.push(o); return { ok: true, messageId: 'U1', raw: {} } },
  }
  const sender = createSender({ db, getProvider: () => provider, sleep: async () => {}, random: () => 0.5 })
  const r = await sender.sendViaInstance(seed.instance, '5547991351835', 'x'.repeat(45))
  await sender.sendViaInstance(seed.instance, '5547991351835', 'oi', humanChat)
  assert.deepEqual(r, { ok: true, wamsgId: 'U1', raw: {} })
  assert.deepEqual(opts, [{ delayTyping: 3 }, undefined])
})
```

Em `test/inboundHandler.test.js`, acrescente no fim:
```js
test('status com outboundOnly (UzAPI) nao mexe em mensagem RECEBIDA; sem o campo (Evolution) segue igual', () => {
  const { db, seed, handler } = setup()
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, phone: '5547991351835' })
  const ins = (id, direction) => db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id, delivery_status) VALUES (?, ?, ?, 'x', ?, 'sent')").run(lead.id, seed.account.id, direction, id)
  ins('IN1', 'inbound')
  ins('OUT1', 'outbound')
  ins('IN2', 'inbound')
  const changed = handler.handleStatusUpdate(seed.account, seed.instance, [
    { messageId: 'IN1', status: 'read', outboundOnly: true },
    { messageId: 'OUT1', status: 'read', outboundOnly: true },
    { messageId: 'IN2', status: 'read' },
  ])
  const st = (id) => db.prepare('SELECT delivery_status FROM messages WHERE wa_msg_id = ?').get(id).delivery_status
  assert.equal(changed, 2)
  assert.equal(st('IN1'), 'sent')
  assert.equal(st('OUT1'), 'read')
  assert.equal(st('IN2'), 'read')
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/sender.test.js test/inboundHandler.test.js`
Expected: FAIL — `typingDelaySeconds` não exportado; `changed` = 3 e `IN1` = `read`.

- [ ] **Passo 3: Implementar**

Em `server/services/whatsapp/sender.js`, logo depois de `const defaultSleep = …`, acrescente:
```js
// "Digitando" embutido no envio (UzAPI: delayTyping em segundos, 1 a 15): 1s a cada 20 caracteres.
export function typingDelaySeconds(text) {
  const n = String(text || '').length
  return Math.min(15, Math.max(1, Math.ceil(n / 20)))
}
```
e troque `sendViaInstance` por:
```js
  async function sendViaInstance(instance, phone, text, opts = {}) {
    const guard = await runSendGuards(instance, phone, text, opts)
    if (!guard.ok) return guard.result
    const sendOpts = (!opts.skipTyping && guard.provider.capabilities?.typingDelay)
      ? { delayTyping: typingDelaySeconds(text) }
      : undefined
    return mapProviderResult(await guard.provider.sendText(instance, guard.number, text, sendOpts))
  }
```

Em `server/services/inboundHandler.js`, dentro de `handleStatusUpdate`, troque:
```js
        const msg = db.prepare('SELECT id, lead_id, account_id, delivery_status FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(s.messageId, account.id)
        if (!msg) continue
```
por:
```js
        const msg = db.prepare('SELECT id, lead_id, account_id, delivery_status, direction FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(s.messageId, account.id)
        if (!msg) continue
        // UzAPI manda tambem a leitura que o proprio numero faz das recebidas: so vale para mensagem enviada.
        if (s.outboundOnly && msg.direction !== 'outbound') continue
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/sender.test.js test/inboundHandler.test.js`
Expected: PASS.

- [ ] **Passo 5: Suíte inteira**

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 6: Commit**

```bash
git add server/services/whatsapp/sender.js server/services/inboundHandler.js test/sender.test.js test/inboundHandler.test.js
git commit -m "feat: digitando embutido no envio e status so em mensagem enviada"
```

---

### Tarefa 9: Transcrição de áudio pelo id da mídia (UzAPI)

**Arquivos:**
- Modificar: `server/services/deepgramClient.js:74-83` (`fetchAudioBuffer`)
- Modificar: `server/services/aiAgent.js:593-606`
- Modificar: `server/services/blockTranscriber.js:24-31` (`loadInboundBlock`)
- Modificar: `server/services/copilotBlock.js:76`
- Modificar: `server/routes/messages.js:185`
- Teste: `test/mediaResolve.test.js`, `test/copilotBlock.test.js`

**Interfaces:**
- Produz: `fetchAudioBuffer(instance, waMsgIdOrMessage, deps)` aceita o `wa_msg_id` (texto, como hoje) **ou** a linha da mensagem `{ wa_msg_id, media_url }`; repassa o objeto para `provider.fetchMedia`. A Evolution continua usando só `wa_msg_id`.
- `loadInboundBlock` passa a trazer `media_url`; `copilotBlock` chama `fetchAudio(inst, { wa_msg_id, media_url })` quando há `media_url`, senão `fetchAudio(inst, wa_msg_id)` como hoje.

- [ ] **Passo 1: Escrever os testes que falham**

Em `test/mediaResolve.test.js`, acrescente no fim:
```js
test('fetchAudioBuffer aceita a linha da mensagem (UzAPI precisa do media_url) e nao exige credencial da Evolution', async () => {
  const inst = { id: 2, provider: 'uzapi', api_url: '', api_key: '', instance_name: 'uz' }
  const calls = []
  const getProvider = () => ({ fetchMedia: async (i, m) => { calls.push(m); return { buffer: Buffer.from('ogg'), mimetype: 'audio/ogg; codecs=opus' } } })
  const r = await fetchAudioBuffer(inst, { wa_msg_id: 'AUD1', media_url: '582578164494741' }, { getProvider })
  assert.deepEqual(calls, [{ wa_msg_id: 'AUD1', media_url: '582578164494741' }])
  assert.equal(r.mimetype, 'audio/ogg; codecs=opus')
  await assert.rejects(() => fetchAudioBuffer(inst, { media_url: 'X' }, { getProvider }), /wa_msg_id_required/)
})
```

Em `test/copilotBlock.test.js`, acrescente no fim:
```js
test('audio com media_url (UzAPI): fetchAudio recebe wa_msg_id e media_url', async () => {
  const { db, seed, instanceId, deps, calls } = setup()
  const first = Number(db.prepare(`
    INSERT INTO messages (lead_id, account_id, direction, content, media_type, wa_msg_id, media_url)
    VALUES (?, ?, 'inbound', '[Audio]', 'audio', 'A9', '582578164494741')
  `).run(seed.leadId, seed.accountId).lastInsertRowid)

  await runBlock(db, { leadId: seed.leadId, instanceId, blockStartMessageId: first, fallback: {}, ...deps })

  assert.deepEqual(calls.fetchAudio[0].waMsgId, { wa_msg_id: 'A9', media_url: '582578164494741' })
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/mediaResolve.test.js test/copilotBlock.test.js`
Expected: FAIL — `fetchMedia` recebe `{ wa_msg_id: [object] }` e `fetchAudio` recebe `'A9'`.

- [ ] **Passo 3: Implementar**

`server/services/deepgramClient.js` — troque o corpo de `fetchAudioBuffer` (mantenha o JSDoc, trocando `@param {string} waMsgId` por `@param {string|Object} waMsgIdOrMessage - wa_msg_id ou a linha da mensagem ({ wa_msg_id, media_url })`):
```js
export async function fetchAudioBuffer(instance, waMsgIdOrMessage, deps = {}) {
  const getProvider = deps.getProvider || defaultGetProvider
  const isEvolution = !!instance && (instance.provider || 'evolution') === 'evolution'
  if (!instance || (isEvolution && (!instance.api_url || !instance.api_key || !instance.instance_name))) {
    throw new Error('instance_missing_credentials')
  }
  // UzAPI baixa pelo id da midia (media_url); Evolution so usa o wa_msg_id.
  const message = (waMsgIdOrMessage && typeof waMsgIdOrMessage === 'object') ? waMsgIdOrMessage : { wa_msg_id: waMsgIdOrMessage }
  if (!message.wa_msg_id) throw new Error('wa_msg_id_required')
  const media = await getProvider(instance).fetchMedia(instance, message)
  return { buffer: media.buffer, mimetype: media.mimetype || 'audio/ogg' }
}
```

`server/services/aiAgent.js` — troque:
```js
      const lastAudio = db.prepare(`
        SELECT wa_msg_id FROM messages
```
por:
```js
      const lastAudio = db.prepare(`
        SELECT wa_msg_id, media_url FROM messages
```
e troque `await fetchAudioBuffer(inst, lastAudio.wa_msg_id)` por `await fetchAudioBuffer(inst, lastAudio)`.

`server/services/blockTranscriber.js` — em `loadInboundBlock`, troque `SELECT id, content, media_type, transcription, wa_msg_id` por `SELECT id, content, media_type, transcription, wa_msg_id, media_url`.

`server/services/copilotBlock.js` — troque a linha
```js
    fetchAudio: canTranscribe ? (msg => fetchAudio(inst, msg.wa_msg_id)) : null,
```
por
```js
    fetchAudio: canTranscribe
      ? (msg => fetchAudio(inst, msg.media_url ? { wa_msg_id: msg.wa_msg_id, media_url: msg.media_url } : msg.wa_msg_id))
      : null,
```
e, no JSDoc do mesmo arquivo, troque `async (instance, waMsgId) => { buffer, mimetype }` por `async (instance, waMsgIdOrMessage) => { buffer, mimetype }`.

`server/routes/messages.js` — troque `'Midia nao encontrada na Evolution'` por `'Mídia não encontrada no provedor do WhatsApp'`.

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/mediaResolve.test.js test/copilotBlock.test.js test/blockTranscriber.test.js`
Expected: PASS.

- [ ] **Passo 5: Suíte inteira**

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 6: Commit**

```bash
git add server/services/deepgramClient.js server/services/aiAgent.js server/services/blockTranscriber.js server/services/copilotBlock.js server/routes/messages.js test/mediaResolve.test.js test/copilotBlock.test.js
git commit -m "feat: transcricao de audio pelo id da midia (UzAPI)"
```

---

### Tarefa 10: `instanceManager` — gestão dos números UzAPI pelo CRM

**Arquivos:**
- Criar: `server/services/whatsapp/instanceManager.js`
- Teste: `test/instanceManager.test.js`

**Interfaces:**
- Consome: `generateWebhookToken` (`schema.js`); `buildInstanceWebhookUrl` (`publicUrl.js`); `buildUzapiConfig`, `hasEncryptionKey` (Tarefa 3); `isUzapiConfigured`, `getUzapiEnv` (Tarefa 5); `logConnectionEvent` (Tarefa 2); adaptador com `createInstance`, `status`, `disconnect`, `restart`, `remove` (Tarefa 6).
- Produz: `PROVIDER_LABELS`, `ProviderError(code, message, status)`, `listAvailableProviders(env) → [{ id, label }]`, `sanitizeInstance(row, role) → row sem provider_config (+ sem api_url/api_key/webhook_secret para atendente), com provider`, `createInstanceManager({ db, getProvider, env, log, removeTimeoutMs })` com:
  - `createUzapiInstance({ accountId, instanceName, leadIntakeMode }) → row` (lança `ProviderError`)
  - `applyConnection(instance, { connection, qr, phoneNumber }) → row` (síncrono; usado pelo webhook)
  - `applyStatus(instance, { status, phoneNumber }) → row`
  - `refreshQr(instance) → { instance, qr_code, status, panel_url? }`
  - `checkStatus(instance) → { instance, state, error? }`
  - `disconnect(instance) → { ok, instance }`, `restart(instance) → { ok, reason? }`, `remove(instance) → { ok: true, providerOk }`

- [ ] **Passo 1: Escrever o teste que falha** — `test/instanceManager.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { createInstanceManager, listAvailableProviders, sanitizeInstance, ProviderError } from '../server/services/whatsapp/instanceManager.js'
import { readUzapiConfig } from '../server/services/whatsapp/providerConfig.js'
import { UZAPI_TEST_ENV, quietLog, insertUzapiInstance } from './helpers/uzapiFixtures.js'

function fakeUzapi(overrides = {}) {
  const calls = { createInstance: [], status: [], disconnect: [], restart: [], remove: [] }
  const adapter = {
    name: 'uzapi',
    async createInstance(args) {
      calls.createInstance.push(args)
      if (overrides.createInstance) return overrides.createInstance(args)
      return { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null, qr: null }
    },
    async status(i) { calls.status.push(i.id); return overrides.status ? overrides.status(i) : { ok: true, status: 'connecting', phoneNumber: null, qr: null } },
    async disconnect(i) { calls.disconnect.push(i.id); return { ok: true } },
    async restart(i) { calls.restart.push(i.id); return { ok: true } },
    async remove(i) { calls.remove.push(i.id); return overrides.remove ? overrides.remove(i) : { ok: true } },
  }
  return { adapter, calls }
}

function setup(overrides = {}, env = UZAPI_TEST_ENV) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const { adapter, calls } = fakeUzapi(overrides)
  const manager = createInstanceManager({ db, getProvider: () => adapter, env, log: quietLog, removeTimeoutMs: 50 })
  return { db, seed, manager, calls }
}
const row = (db, id) => db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)
const logs = (db) => db.prepare('SELECT instance_id, provider, event FROM whatsapp_connection_log ORDER BY id').all()

test('criar numero UzAPI: cria na UzAPI com o webhook do numero, grava provider/config cifrada, aquecimento e registro', async () => {
  const { db, seed, manager, calls } = setup()
  const inst = await manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Loja Centro', leadIntakeMode: 'open' })
  assert.equal(calls.createInstance.length, 1)
  assert.equal(calls.createInstance[0].name, 'Loja Centro')
  assert.equal(calls.createInstance[0].webhookUrl, `https://crm.test/api/webhooks/whatsapp/${inst.webhook_token}`)
  assert.match(inst.webhook_token, /^[a-f0-9]{32}$/)
  assert.equal(inst.provider, 'uzapi')
  assert.equal(inst.api_url, '')
  assert.equal(inst.api_key, '')
  assert.equal(inst.status, 'connecting')
  assert.ok(inst.warmup_until)
  assert.ok(!inst.provider_config.includes('TOKEN-NOVO'))
  assert.deepEqual(readUzapiConfig(inst, UZAPI_TEST_ENV), { phoneNumberId: '100000000000009', instanceToken: 'TOKEN-NOVO', uzapiInstanceId: null })
  assert.deepEqual(logs(db), [{ instance_id: inst.id, provider: 'uzapi', event: 'created' }])
})

test('criar numero UzAPI: sem credenciais da Dros, sem WA_ENC_KEY, nome repetido ou falha na UzAPI -> ProviderError e nada gravado', async () => {
  const cases = [
    [{ ...UZAPI_TEST_ENV, UZAPI_ACCOUNT_TOKEN: '' }, {}, 'uzapi_not_configured', 400],
    [{ ...UZAPI_TEST_ENV, WA_ENC_KEY: '' }, {}, 'wa_enc_key_missing', 400],
    [UZAPI_TEST_ENV, { createInstance: () => { const e = new Error('x'); e.code = 'uzapi_create_failed'; throw e } }, 'uzapi_create_failed', 502],
  ]
  for (const [env, overrides, code, status] of cases) {
    const { db, seed, manager } = setup(overrides, env)
    await assert.rejects(() => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'Nova' }), (e) => e instanceof ProviderError && e.code === code && e.status === status)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM whatsapp_instances WHERE provider = 'uzapi'").get().n, 0)
  }
  const { seed, manager, calls } = setup()
  await assert.rejects(() => manager.createUzapiInstance({ accountId: seed.account.id, instanceName: 'inst-teste' }), (e) => e.code === 'instance_name_taken' && e.status === 409)
  assert.equal(calls.createInstance.length, 0)
})

test('applyConnection: connected limpa QR, grava connected_at e telefone e registra uma vez; disconnected registra', () => {
  const { db, seed, manager } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  db.prepare("UPDATE whatsapp_instances SET qr_code = 'QR' WHERE id = ?").run(inst.id)
  const a = manager.applyConnection(inst, { connection: 'connected', phoneNumber: '554890000001' })
  assert.equal(a.status, 'connected')
  assert.equal(a.qr_code, null)
  assert.equal(a.phone_number, '554890000001')
  assert.ok(a.connected_at)
  const b = manager.applyConnection(a, { connection: 'connected' })
  assert.equal(b.connected_at, a.connected_at)
  assert.equal(b.phone_number, '554890000001')
  manager.applyConnection(b, { connection: 'disconnected' })
  assert.deepEqual(logs(db).map(l => l.event), ['connected', 'disconnected'])
  assert.equal(row(db, inst.id).status, 'disconnected')
})

test('applyConnection com QR: grava o QR e fica connecting', () => {
  const { db, seed, manager } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'disconnected' })
  const r = manager.applyConnection(inst, { qr: '2@QR-DE-TESTE-NAO-E-REAL,abcdefghij' })
  assert.equal(r.qr_code, '2@QR-DE-TESTE-NAO-E-REAL,abcdefghij')
  assert.equal(r.status, 'connecting')
})

test('refreshQr: conectado, com QR, sem QR (plano B com panel_url) e UzAPI fora do ar', async () => {
  let st = { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null }
  const { db, seed, manager } = setup({ status: () => { if (st instanceof Error) throw st; return st } })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  assert.deepEqual((({ qr_code, status }) => ({ qr_code, status }))(await manager.refreshQr(inst)), { qr_code: null, status: 'connected' })

  db.prepare("UPDATE whatsapp_instances SET status = 'connecting' WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE' }
  const withQr = await manager.refreshQr(row(db, inst.id))
  assert.equal(withQr.qr_code, 'data:image/png;base64,AAAABBBBCCCCDDDDEEEE')
  assert.equal(withQr.panel_url, undefined)

  db.prepare("UPDATE whatsapp_instances SET qr_code = NULL WHERE id = ?").run(inst.id)
  st = { ok: true, status: 'connecting', phoneNumber: null, qr: null }
  const planB = await manager.refreshQr(row(db, inst.id))
  assert.deepEqual([planB.qr_code, planB.status, planB.panel_url], [null, 'connecting', 'https://painel.uzapi.test'])

  st = new Error('ECONNREFUSED')
  const down = await manager.refreshQr(row(db, inst.id))
  assert.equal(down.panel_url, 'https://painel.uzapi.test')
})

test('checkStatus: aplica o status da UzAPI; erro da UzAPI nao derruba o numero', async () => {
  let st = { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null }
  const { db, seed, manager } = setup({ status: () => st })
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connecting' })
  const a = await manager.checkStatus(inst)
  assert.deepEqual([a.state, a.instance.status], ['connected', 'connected'])
  st = { ok: false, status: null, reason: 'provider_error' }
  const b = await manager.checkStatus(row(db, inst.id))
  assert.deepEqual([b.state, b.error, b.instance.status], [null, 'provider_error', 'connected'])
})

test('disconnect: logout na UzAPI e numero desconectado', async () => {
  const { db, seed, manager, calls } = setup()
  const inst = insertUzapiInstance(db, seed.account.id, { status: 'connected' })
  const r = await manager.disconnect(inst)
  assert.deepEqual(calls.disconnect, [inst.id])
  assert.equal(r.instance.status, 'disconnected')
})

test('remove: exclui na UzAPI (best-effort, com tempo limite), registra removed e apaga a linha', async () => {
  const { db, seed, manager, calls } = setup({ remove: () => new Promise(() => {}) })
  const inst = insertUzapiInstance(db, seed.account.id)
  const r = await manager.remove(inst)
  assert.deepEqual(r, { ok: true, providerOk: false })
  assert.deepEqual(calls.remove, [inst.id])
  assert.equal(row(db, inst.id), undefined)
  assert.deepEqual(logs(db).map(l => l.event), ['removed'])
})

test('listAvailableProviders: UzAPI so com usuario e token da conta', () => {
  assert.deepEqual(listAvailableProviders({}), [{ id: 'evolution', label: 'Evolution' }])
  assert.deepEqual(listAvailableProviders(UZAPI_TEST_ENV), [{ id: 'evolution', label: 'Evolution' }, { id: 'uzapi', label: 'UzAPI (estável)' }])
})

test('sanitizeInstance: nunca provider_config; atendente tambem sem api_url/api_key/webhook_secret; provider sempre presente', () => {
  const r = { id: 1, provider: 'uzapi', provider_config: '{"x":1}', api_url: '', api_key: '', webhook_secret: null, status: 'connected' }
  assert.deepEqual(sanitizeInstance(r, 'gerente'), { id: 1, provider: 'uzapi', api_url: '', api_key: '', webhook_secret: null, status: 'connected' })
  assert.deepEqual(sanitizeInstance(r, 'atendente'), { id: 1, provider: 'uzapi', status: 'connected' })
  assert.equal(sanitizeInstance({ id: 2, provider: null }, 'gerente').provider, 'evolution')
  assert.equal(sanitizeInstance(null, 'gerente'), null)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/instanceManager.test.js`
Expected: FAIL — `Cannot find module '…/instanceManager.js'`.

- [ ] **Passo 3: Implementar** — `server/services/whatsapp/instanceManager.js`

```js
// Gestao dos numeros UzAPI pelo CRM: criar, QR, status, desconectar, reiniciar, excluir.
// Nao importa server/db.js: recebe db e getProvider (testavel com banco em memoria e adaptador falso).
// A Evolution continua com o codigo de sempre em routes/integrations.js.
import { generateWebhookToken } from './schema.js'
import { buildInstanceWebhookUrl } from '../publicUrl.js'
import { buildUzapiConfig, hasEncryptionKey } from './providerConfig.js'
import { isUzapiConfigured, getUzapiEnv } from './uzapiClient.js'
import { logConnectionEvent } from './connectionLog.js'

export const PROVIDER_LABELS = Object.freeze({ evolution: 'Evolution', uzapi: 'UzAPI (estável)' })

export class ProviderError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}

export function listAvailableProviders(env = process.env) {
  const out = [{ id: 'evolution', label: PROVIDER_LABELS.evolution }]
  if (isUzapiConfigured(env)) out.push({ id: 'uzapi', label: PROVIDER_LABELS.uzapi })
  return out
}

const HIDDEN_ALWAYS = ['provider_config']
const HIDDEN_FOR_ATTENDANT = ['api_url', 'api_key', 'webhook_secret']

export function sanitizeInstance(row, role) {
  if (!row) return row
  const out = { ...row, provider: row.provider || 'evolution' }
  for (const k of HIDDEN_ALWAYS) delete out[k]
  if (role === 'atendente') for (const k of HIDDEN_FOR_ATTENDANT) delete out[k]
  return out
}

function withTimeout(promise, ms, fallback) {
  let timer
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export function createInstanceManager({ db, getProvider, env = process.env, log = console, removeTimeoutMs = 8000 }) {
  const byId = (id) => db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(id)

  async function createUzapiInstance({ accountId, instanceName, leadIntakeMode = 'open' }) {
    if (!isUzapiConfigured(env)) {
      throw new ProviderError('uzapi_not_configured', 'A UzAPI não está configurada no servidor (faltam UZAPI_USERNAME e UZAPI_ACCOUNT_TOKEN).')
    }
    if (!hasEncryptionKey(env)) {
      throw new ProviderError('wa_enc_key_missing', 'Falta a chave WA_ENC_KEY no servidor para guardar o token do número.')
    }
    const existing = db.prepare('SELECT id FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(accountId, instanceName)
    if (existing) throw new ProviderError('instance_name_taken', 'Já existe um número com esse nome nesta conta.', 409)

    const webhookToken = generateWebhookToken()
    const webhookUrl = buildInstanceWebhookUrl({ webhook_token: webhookToken }, env)
    let created
    try {
      created = await getProvider({ provider: 'uzapi' }).createInstance({ name: instanceName, webhookUrl })
    } catch (e) {
      log.error('[UzAPI criar numero]', e.code || '', e.message)
      throw new ProviderError(e.code || 'uzapi_create_failed', 'Não foi possível criar o número na UzAPI. Tente de novo em instantes.', 502)
    }
    const r = db.prepare(`
      INSERT INTO whatsapp_instances (account_id, instance_name, api_url, api_key, status, qr_code, lead_intake_mode, warmup_until, provider, provider_config, webhook_token)
      VALUES (?, ?, '', '', 'connecting', ?, ?, datetime('now', '+3 days'), 'uzapi', ?, ?)
    `).run(accountId, instanceName, created.qr || null, leadIntakeMode, buildUzapiConfig(created, env), webhookToken)
    const instance = byId(r.lastInsertRowid)
    logConnectionEvent(db, instance, 'created')
    return instance
  }

  // Sincrono (chamado pelo webhook). connected: limpa QR, 1a conexao em connected_at; QR: grava e fica connecting.
  function applyConnection(instance, { connection = null, qr = null, phoneNumber = null } = {}) {
    const cur = byId(instance.id)
    if (!cur) return null
    if (connection === 'connected') {
      db.prepare(`
        UPDATE whatsapp_instances SET status = 'connected', qr_code = NULL,
          connected_at = COALESCE(connected_at, datetime('now')),
          phone_number = COALESCE(NULLIF(?, ''), phone_number),
          updated_at = datetime('now')
        WHERE id = ?
      `).run(phoneNumber || '', cur.id)
      if (cur.status !== 'connected') logConnectionEvent(db, cur, 'connected')
    } else if (connection === 'disconnected') {
      db.prepare("UPDATE whatsapp_instances SET status = 'disconnected', qr_code = NULL, updated_at = datetime('now') WHERE id = ?").run(cur.id)
      if (cur.status !== 'disconnected') logConnectionEvent(db, cur, 'disconnected')
    } else if (qr && qr !== cur.qr_code) {
      db.prepare("UPDATE whatsapp_instances SET qr_code = ?, status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(qr, cur.id)
    }
    return byId(cur.id)
  }

  function applyStatus(instance, st) {
    if (st.status === 'connected') return applyConnection(instance, { connection: 'connected', phoneNumber: st.phoneNumber })
    if (st.status === 'disconnected') return applyConnection(instance, { connection: 'disconnected' })
    db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ? AND status != 'connecting'").run(instance.id)
    return byId(instance.id)
  }

  async function safeStatus(instance) {
    try {
      return await getProvider(instance).status(instance)
    } catch (e) {
      return { ok: false, status: null, phoneNumber: null, qr: null, reason: e.code || e.message }
    }
  }

  // Plano B (spec 4.4): sem QR pela API, devolve panel_url para abrir o painel da UzAPI.
  async function refreshQr(instance) {
    const st = await safeStatus(instance)
    if (st.ok && st.status === 'connected') {
      return { instance: applyStatus(instance, st), qr_code: null, status: 'connected' }
    }
    const current = byId(instance.id)
    const qr = st.qr || current.qr_code || null
    if (qr) return { instance: applyConnection(current, { qr }), qr_code: qr, status: 'connecting' }
    db.prepare("UPDATE whatsapp_instances SET status = 'connecting', updated_at = datetime('now') WHERE id = ?").run(current.id)
    return { instance: byId(current.id), qr_code: null, status: 'connecting', panel_url: getUzapiEnv(env).panelUrl }
  }

  async function checkStatus(instance) {
    const st = await safeStatus(instance)
    if (!st.ok || !st.status) return { instance: byId(instance.id), state: null, error: st.reason || 'provider_error' }
    return { instance: applyStatus(instance, st), state: st.status }
  }

  async function disconnect(instance) {
    const r = await getProvider(instance).disconnect(instance)
    if (!r.ok) log.error(`[UzAPI logout] ${instance.instance_name}: ${r.reason}`)
    return { ok: r.ok, instance: applyConnection(instance, { connection: 'disconnected' }) }
  }

  async function restart(instance) {
    return getProvider(instance).restart(instance)
  }

  // Best-effort como na Evolution: numero fantasma (so no CRM) nao pode travar o usuario.
  async function remove(instance) {
    const attempt = Promise.resolve().then(() => getProvider(instance).remove(instance)).catch(e => ({ ok: false, reason: e.message }))
    const r = await withTimeout(attempt, removeTimeoutMs, { ok: false, reason: `timeout ${removeTimeoutMs}ms` })
    if (!r.ok) log.error(`[UzAPI excluir] ${instance.instance_name}: ${r.reason}`)
    logConnectionEvent(db, instance, 'removed')
    db.prepare('DELETE FROM whatsapp_instances WHERE id = ?').run(instance.id)
    return { ok: true, providerOk: !!r.ok }
  }

  return { createUzapiInstance, applyConnection, applyStatus, refreshQr, checkStatus, disconnect, restart, remove }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/instanceManager.test.js`
Expected: PASS (10 testes).

- [ ] **Passo 5: Commit**

```bash
git add server/services/whatsapp/instanceManager.js test/instanceManager.test.js
git commit -m "feat: gestao dos numeros UzAPI pelo CRM (criar, QR com plano B, status, excluir)"
```

---

### Tarefa 11: Webhook — conexão, QR, eco das respostas pelo celular, 200 em erro

**Arquivos:**
- Criar: `server/services/whatsapp/uzapiEcho.js`
- Criar: `test/helpers/inboundSetup.js`
- Modificar: `server/services/whatsapp/webhookFlow.js`
- Modificar: `server/routes/webhooks.js:8-31`
- Modificar: `server/index.js` (handler de JSON inválido)
- Teste: `test/uzapiEcho.test.js`, `test/webhookFlow.test.js`

**Interfaces:**
- Consome: `createInstanceManager` (Tarefa 10), `createUzapiAdapter`, `parseChatMessage` (Tarefa 5), `handleInboundMessage`/`handleStatusUpdate` (`inboundRuntime.js`), fixtures.
- Produz: `createEchoResolver({ db, getProvider, handleInboundMessage, delayMs = 5000, wait, log }) → { resolveEchoes(account, instance, echoes) → Promise<number> }` (espera `delayMs` para o CRM terminar de gravar o que ele mesmo enviou; ignora id já existente na conta; não busca o mesmo id duas vezes ao mesmo tempo).
- Produz (`webhookFlow.js`): `processWebhook(deps, account, instance, req)` com deps opcionais `handleConnection(instance, { connection, qr })` e `resolveEchoes(account, instance, echoes)` (disparado sem esperar); `webhookErrorStatus(instance) → 200 | 500`; `webhookJsonErrorHandler(err, req, res, next)`.
- Produz (helper de teste): `createTestInboundHandler(db) → { handler, calls }`.

- [ ] **Passo 1: Criar o helper `test/helpers/inboundSetup.js`**

```js
// Handler de entrada real (leadIntake + inboundHandler) com dependencias externas falsas: sem IA, sem SSE, sem CAPI.
import { createLeadIntake } from '../../server/services/leadIntake.js'
import { createInboundHandler } from '../../server/services/inboundHandler.js'

export function createTestInboundHandler(db) {
  const calls = { sse: [], ai: [] }
  const intake = createLeadIntake({
    db,
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    triggerCapiForStageChange: () => {},
  })
  const handler = createInboundHandler({
    db,
    broadcastSSE: (...a) => { calls.sse.push(a) },
    triggerCapiForStageChange: () => {},
    getInstanceConfig: () => null,
    wasAutoMsgSentRecently: () => false,
    sendAutoMessage: () => Promise.resolve(),
    shouldSendAway: () => false,
    processInboundMessage: (...a) => { calls.ai.push(a); return Promise.resolve() },
    pickFromRoulette: () => null,
    notifyAndOpenLead: () => Promise.resolve(),
    getOrCreateLead: intake.getOrCreateLead,
    autoDetectStage: intake.autoDetectStage,
    fetchAndSaveProfilePic: () => Promise.resolve(),
  })
  return { handler, calls }
}
```

- [ ] **Passo 2: Escrever os testes que falham**

`test/uzapiEcho.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic, insertLead } from './helpers/db.js'
import { createTestInboundHandler } from './helpers/inboundSetup.js'
import { insertUzapiInstance, loadUzapiFixture, LEAD_PHONE, quietLog } from './helpers/uzapiFixtures.js'
import { createEchoResolver } from '../server/services/whatsapp/uzapiEcho.js'
import { parseChatMessage } from '../server/services/whatsapp/uzapi.js'

const ECHO_ID = '2A286AC5064891EF4DE7'

function setup({ wait = async () => {}, fetchImpl } = {}) {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const lead = insertLead(db, { account_id: seed.account.id, funnel_id: seed.funnelId, stage_id: seed.stage1, name: 'Lead', phone: LEAD_PHONE, wa_remote_jid: `${LEAD_PHONE}@s.whatsapp.net` })
  const { handler } = createTestInboundHandler(db)
  const fetched = []
  const provider = {
    async fetchMessageById(inst, id, { phone }) {
      fetched.push([id, phone])
      if (fetchImpl) return fetchImpl(id, phone)
      return parseChatMessage(loadUzapiFixture('chats-get-echo.synthetic.json'), { phone, messageId: id })
    },
  }
  const resolver = createEchoResolver({ db, getProvider: () => provider, handleInboundMessage: handler.handleInboundMessage, delayMs: 0, wait, log: quietLog })
  return { db, seed, instance, lead, resolver, fetched }
}

test('eco: resposta dada pelo celular vira mensagem ENVIADA no lead do telefone', async () => {
  const { db, seed, instance, lead, resolver, fetched } = setup()
  const n = await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  assert.equal(n, 1)
  assert.deepEqual(fetched, [[ECHO_ID, LEAD_PHONE]])
  const msgs = db.prepare('SELECT * FROM messages').all()
  assert.equal(msgs.length, 1)
  assert.equal(msgs[0].lead_id, lead.id)
  assert.equal(msgs[0].direction, 'outbound')
  assert.equal(msgs[0].content, 'Resposta pelo celular')
  assert.equal(msgs[0].wa_msg_id, ECHO_ID)
  assert.equal(msgs[0].instance_id, instance.id)
})

test('eco: o mesmo id de novo (delivered e depois read) nao duplica nem busca de novo', async () => {
  const { db, seed, instance, resolver, fetched } = setup()
  await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  const n = await resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  assert.equal(n, 0)
  assert.equal(fetched.length, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1)
})

test('eco: status de mensagem que o proprio CRM enviou (ja gravada) nao e buscado', async () => {
  const { db, seed, instance, lead, resolver, fetched } = setup()
  db.prepare("INSERT INTO messages (lead_id, account_id, direction, content, wa_msg_id) VALUES (?, ?, 'outbound', 'via API', '3EB03F3FB62BE08FFAA771')").run(lead.id, seed.account.id)
  assert.equal(await resolver.resolveEchoes(seed.account, instance, [{ messageId: '3EB03F3FB62BE08FFAA771', phone: LEAD_PHONE }]), 0)
  assert.deepEqual(fetched, [])
})

test('eco: dois avisos do mesmo id ao mesmo tempo buscam uma vez so', async () => {
  let open
  const gate = new Promise(r => { open = r })
  const { seed, instance, resolver, fetched } = setup({ wait: () => gate })
  const p1 = resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  const p2 = resolver.resolveEchoes(seed.account, instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }])
  open()
  const [a, b] = await Promise.all([p1, p2])
  assert.equal(a + b, 1)
  assert.equal(fetched.length, 1)
})

test('eco: busca sem resultado ou com erro nao grava nada e nao lanca', async () => {
  const vazio = setup({ fetchImpl: () => null })
  assert.equal(await vazio.resolver.resolveEchoes(vazio.seed.account, vazio.instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }]), 0)
  const erro = setup({ fetchImpl: () => { throw new Error('boom') } })
  assert.equal(await erro.resolver.resolveEchoes(erro.seed.account, erro.instance, [{ messageId: ECHO_ID, phone: LEAD_PHONE }]), 0)
  assert.equal(erro.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
})
```

Em `test/webhookFlow.test.js`, troque a linha de import do `webhookFlow.js` por:
```js
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook, webhookErrorStatus, webhookJsonErrorHandler } from '../server/services/whatsapp/webhookFlow.js'
```
acrescente os imports:
```js
import { createTestInboundHandler } from './helpers/inboundSetup.js'
import { createUzapiAdapter } from '../server/services/whatsapp/uzapi.js'
import { insertUzapiInstance, loadUzapiFixture, LEAD_PHONE, UZAPI_TEST_ENV, quietLog } from './helpers/uzapiFixtures.js'
```
(`createTestDb` e `seedBasic` já vêm do import de `./helpers/db.js` que o arquivo tem) e, no fim do arquivo:
```js
test('processWebhook: conexao/QR vao para handleConnection; ecos vao para resolveEchoes sem travar a resposta', async () => {
  const provider = { parseWebhook: () => ({ messages: [], statuses: [], echoes: [{ messageId: 'E1', phone: '5548990000002' }], connection: 'connected', qr: null }) }
  const conn = []
  const echoes = []
  const r = processWebhook({
    getProvider: () => provider,
    handleInboundMessage: () => ({ ok: true }),
    handleStatusUpdate: () => 0,
    handleConnection: (inst, info) => { conn.push([inst.id, info]) },
    resolveEchoes: async (acc, inst, list) => { echoes.push(list) },
  }, { id: 1 }, { id: 9 }, { body: {} })
  assert.deepEqual(r, { ok: true })
  assert.deepEqual(conn, [[9, { connection: 'connected', qr: null }]])
  await new Promise(res => setImmediate(res))
  assert.deepEqual(echoes, [[{ messageId: 'E1', phone: '5548990000002' }]])
})

test('UzAPI ponta a ponta: texto real cria lead e mensagem; leitura do proprio numero nao mexe na recebida; outro phone_number_id nao grava', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const adapter = createUzapiAdapter({ fetch: async () => { throw new Error('sem rede nos testes') }, env: UZAPI_TEST_ENV, log: quietLog })
  const { handler } = createTestInboundHandler(db)
  const deps = { getProvider: () => adapter, handleInboundMessage: handler.handleInboundMessage, handleStatusUpdate: handler.handleStatusUpdate }

  processWebhook(deps, seed.account, instance, { body: loadUzapiFixture('message-text.json'), headers: {} })
  const lead = db.prepare('SELECT * FROM leads WHERE phone = ?').get(LEAD_PHONE)
  assert.equal(lead.name, 'Contato 02')
  const msg = db.prepare('SELECT * FROM messages WHERE wa_msg_id = ?').get('2A2ACD4E776A27C10B00')
  assert.equal(msg.direction, 'inbound')
  assert.equal(msg.content, 'Teste 1')
  assert.equal(msg.instance_id, instance.id)

  processWebhook(deps, seed.account, instance, { body: loadUzapiFixture('status-read-by-self.json'), headers: {} })
  assert.equal(db.prepare('SELECT delivery_status FROM messages WHERE id = ?').get(msg.id).delivery_status, msg.delivery_status)

  const body = loadUzapiFixture('message-audio.json')
  body.entry[0].changes[0].value.metadata.phone_number_id = '999999999999999'
  processWebhook(deps, seed.account, instance, { body, headers: {} })
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE wa_msg_id = '2AF1064222DEF32AAEBA'").get().n, 0)
})

test('UzAPI ponta a ponta: audio real grava o id da midia em media_url', () => {
  const db = createTestDb()
  const seed = seedBasic(db)
  const instance = insertUzapiInstance(db, seed.account.id)
  const adapter = createUzapiAdapter({ fetch: async () => { throw new Error('sem rede nos testes') }, env: UZAPI_TEST_ENV, log: quietLog })
  const { handler } = createTestInboundHandler(db)
  processWebhook({ getProvider: () => adapter, handleInboundMessage: handler.handleInboundMessage, handleStatusUpdate: handler.handleStatusUpdate },
    seed.account, instance, { body: loadUzapiFixture('message-audio.json'), headers: {} })
  const msg = db.prepare("SELECT * FROM messages WHERE wa_msg_id = '2AF1064222DEF32AAEBA'").get()
  assert.deepEqual([msg.media_type, msg.media_url], ['audio', '582578164494741'])
})

test('webhookErrorStatus: UzAPI recebe 200 em erro interno (evita reenvio em laco); Evolution segue 500', () => {
  assert.equal(webhookErrorStatus({ provider: 'uzapi' }), 200)
  assert.equal(webhookErrorStatus({ provider: 'evolution' }), 500)
  assert.equal(webhookErrorStatus(null), 500)
})

test('webhookJsonErrorHandler: JSON invalido no webhook de WhatsApp vira 200; outros erros seguem', () => {
  const res = { code: null, body: null, status(c) { this.code = c; return this }, json(b) { this.body = b; return this } }
  let passed = null
  const parseErr = Object.assign(new Error('Unexpected token'), { type: 'entity.parse.failed' })
  webhookJsonErrorHandler(parseErr, { originalUrl: '/crm/api/webhooks/whatsapp/' + 'a'.repeat(32) }, res, (e) => { passed = e })
  assert.deepEqual([res.code, res.body, passed], [200, { ok: false, error: 'invalid_json' }, null])
  webhookJsonErrorHandler(parseErr, { originalUrl: '/api/leads' }, res, (e) => { passed = e })
  assert.equal(passed, parseErr)
})
```

- [ ] **Passo 3: Rodar e ver falhar**

Run: `node --test test/uzapiEcho.test.js test/webhookFlow.test.js`
Expected: FAIL — `Cannot find module '…/uzapiEcho.js'` e `webhookErrorStatus` não exportado.

- [ ] **Passo 4: Implementar** — `server/services/whatsapp/uzapiEcho.js`

```js
// Resposta digitada no celular do numero: a UzAPI nao manda a mensagem, so o status (recipient_id vazio,
// telefone do lead em contacts[0].wa_id). Aqui busca o conteudo e grava como mensagem ENVIADA (fromMe).
// Espera delayMs antes de checar: o status da mensagem que o PROPRIO CRM acabou de enviar pode chegar
// antes do INSERT do chamador; depois da espera, id ja existente = nao e eco.
export function createEchoResolver({ db, getProvider, handleInboundMessage, delayMs = 5000, wait = (ms) => new Promise(r => setTimeout(r, ms)), log = console }) {
  const inFlight = new Set()
  const known = (accountId, id) => !!db.prepare('SELECT 1 FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(id, accountId)

  async function resolveEchoes(account, instance, echoes) {
    let provider
    try { provider = getProvider(instance) } catch { return 0 }
    if (!provider.fetchMessageById || !Array.isArray(echoes) || echoes.length === 0) return 0
    const key = (e) => `${account.id}:${e.messageId}`
    const seen = new Set()
    const todo = echoes.filter(e => {
      if (!e?.messageId || !e.phone || seen.has(e.messageId)) return false
      seen.add(e.messageId)
      return !inFlight.has(key(e)) && !known(account.id, e.messageId)
    })
    if (todo.length === 0) return 0
    for (const e of todo) inFlight.add(key(e))
    let saved = 0
    try {
      await wait(delayMs)
      for (const e of todo) {
        if (known(account.id, e.messageId)) continue
        try {
          const normalized = await provider.fetchMessageById(instance, e.messageId, { phone: e.phone })
          if (!normalized) continue
          handleInboundMessage(account, instance, {
            ...normalized, phone: e.phone, remoteId: `${e.phone}@s.whatsapp.net`, messageId: e.messageId, fromMe: true,
          }, { source: 'webhook' })
          saved++
        } catch (err) {
          log.error(`[UzAPI eco] ${e.messageId}: ${err.message}`)
        }
      }
    } finally {
      for (const e of todo) inFlight.delete(key(e))
    }
    return saved
  }

  return { resolveEchoes }
}
```

`server/services/whatsapp/webhookFlow.js` — troque `processWebhook` inteiro por:
```js
export function processWebhook({ getProvider, handleInboundMessage, handleStatusUpdate, handleConnection, resolveEchoes }, account, instance, req) {
  const provider = getProvider(instance)
  const parsed = provider.parseWebhook(instance, req.body || {}, req.headers || {})
  if ((parsed.connection || parsed.qr) && handleConnection) {
    try {
      handleConnection(instance, { connection: parsed.connection || null, qr: parsed.qr || null })
    } catch (e) {
      console.error('[Webhook connection]', e.message)
    }
  }
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
  // Eco (resposta dada pelo celular, UzAPI): busca em segundo plano; a resposta ao provedor nao espera.
  if (parsed.echoes && parsed.echoes.length > 0 && resolveEchoes) {
    Promise.resolve()
      .then(() => resolveEchoes(account, instance, parsed.echoes))
      .catch(e => console.error('[Webhook eco]', e.message))
  }
  return result
}

// UzAPI reenvia o aviso em laco se nao receber 2xx: erro interno vira 200 (ja logado). Evolution segue com 500.
export function webhookErrorStatus(instance) {
  return instance && (instance.provider || 'evolution') === 'uzapi' ? 200 : 500
}

// Registrado logo depois do express.json (server/index.js): JSON invalido no webhook de WhatsApp responde 200.
const WHATSAPP_WEBHOOK_PATH = /^(\/crm)?\/api\/webhooks\/whatsapp\//
export function webhookJsonErrorHandler(err, req, res, next) {
  if (err && err.type === 'entity.parse.failed' && WHATSAPP_WEBHOOK_PATH.test(req.originalUrl || req.url || '')) {
    console.warn(`[Webhook WhatsApp] JSON invalido ignorado: ${err.message}`)
    return res.status(200).json({ ok: false, error: 'invalid_json' })
  }
  return next(err)
}
```

- [ ] **Passo 5: Ligar na rota** — `server/routes/webhooks.js`

Troque a linha de import do `webhookFlow.js` por:
```js
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook, webhookErrorStatus } from '../services/whatsapp/webhookFlow.js'
import { createInstanceManager } from '../services/whatsapp/instanceManager.js'
import { createEchoResolver } from '../services/whatsapp/uzapiEcho.js'
```
Troque `const webhookDeps = { getProvider, handleInboundMessage, handleStatusUpdate }` por:
```js
const instanceManager = createInstanceManager({ db, getProvider })
const echoResolver = createEchoResolver({ db, getProvider, handleInboundMessage })

// Aviso de conexao/QR (UzAPI). Conectou sem telefone conhecido: busca o status para preencher phone_number.
function handleConnection(instance, info) {
  const updated = instanceManager.applyConnection(instance, info)
  if (info.connection === 'connected' && updated && !updated.phone_number) {
    instanceManager.checkStatus(updated).catch(e => console.error('[UzAPI status]', e.message))
  }
  return updated
}

const webhookDeps = { getProvider, handleInboundMessage, handleStatusUpdate, handleConnection, resolveEchoes: echoResolver.resolveEchoes }
```
Troque a rota `router.post('/whatsapp/:instanceToken', …)` inteira por:
```js
// WhatsApp webhook por numero (qualquer provedor). O token identifica a instancia; sem fallback.
router.post('/whatsapp/:instanceToken', (req, res) => {
  let instance = null
  try {
    const r = resolveInstanceByToken(db, req.params.instanceToken)
    if (r.error) {
      console.warn(`[Webhook WhatsApp] ${r.status} ${r.error} ip=${req.ip}`)
      return res.status(r.status).json({ error: r.error })
    }
    instance = r.instance
    return res.json(processWebhook(webhookDeps, r.account, r.instance, req))
  } catch (err) {
    console.error('[Webhook WhatsApp]', err.message)
    const status = webhookErrorStatus(instance)
    res.status(status).json(status === 200 ? { ok: false } : { error: err.message })
  }
})
```

- [ ] **Passo 6: JSON inválido** — `server/index.js`

Acrescente o import:
```js
import { webhookJsonErrorHandler } from './services/whatsapp/webhookFlow.js'
```
e, logo depois de `app.use(express.json({ limit: '5mb' }))`:
```js
// JSON invalido no webhook de WhatsApp: 200 + log (a UzAPI reenviaria em laco). Demais rotas seguem com o erro padrao.
app.use(webhookJsonErrorHandler)
```

- [ ] **Passo 7: Rodar e ver passar**

Run: `node --test test/uzapiEcho.test.js test/webhookFlow.test.js && node --check server/routes/webhooks.js && node --check server/index.js`
Expected: PASS e nenhuma saída dos `--check`.

- [ ] **Passo 8: Suíte inteira**

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 9: Commit**

```bash
git add server/services/whatsapp/uzapiEcho.js server/services/whatsapp/webhookFlow.js server/routes/webhooks.js server/index.js test/helpers/inboundSetup.js test/uzapiEcho.test.js test/webhookFlow.test.js
git commit -m "feat: webhook da UzAPI com conexao, QR, eco das respostas pelo celular e 200 em erro"
```

---

### Tarefa 12: Rotas de Integrações por provedor + uso por conta (admin)

**Arquivos:**
- Modificar: `server/routes/integrations.js`
- Modificar: `server/routes/admin.js`

**Interfaces:**
- Consome: `createInstanceManager`, `listAvailableProviders`, `sanitizeInstance`, `ProviderError` (Tarefa 10); `uzapiUsageByAccount` (Tarefa 2).
- Produz: exatamente o **Contrato de API** do topo deste plano.

A lógica nova já está testada em `instanceManager.test.js`; aqui as rotas só perguntam o provedor e delegam. `integrations.js` importa `server/db.js` e `scheduler.js`, por isso a verificação é por `node --check`, `grep` e pela suíte inteira.

- [ ] **Passo 1: Imports e ajudantes** — no topo de `server/routes/integrations.js`

Acrescente aos imports:
```js
import { createInstanceManager, listAvailableProviders, sanitizeInstance, ProviderError } from '../services/whatsapp/instanceManager.js'
```
Logo depois de `const router = Router()`:
```js
// Provedor por numero: UzAPI delega ao instanceManager; Evolution segue com o codigo de sempre.
const manager = createInstanceManager({ db, getProvider })
const isUzapi = (instance) => (instance?.provider || 'evolution') === 'uzapi'
const safe = (row, req) => sanitizeInstance(row, req.user.role)

function sendProviderError(res, err) {
  if (err instanceof ProviderError) return res.status(err.status).json({ error: err.message, code: err.code })
  console.error('[WhatsApp provedor]', err.message)
  return res.status(502).json({ error: 'Falha ao falar com o provedor do WhatsApp.', code: 'provider_error' })
}

// Se atendente criou, vira dono automatico (primary_instance_id + default_attendant_id).
function makeAttendantOwner(req, instance) {
  if (req.user.role !== 'atendente') return
  db.prepare("UPDATE users SET primary_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(instance.id, req.user.id)
  db.prepare("UPDATE whatsapp_instances SET default_attendant_id = ?, updated_at = datetime('now') WHERE id = ?").run(req.user.id, instance.id)
  console.log(`[integrations] Atendente ${req.user.id} virou dono da instancia recem-criada ${instance.id}`)
}
```

- [ ] **Passo 2: Lista e provedores**

Em `GET /whatsapp`, troque
```js
    const { api_url, api_key, webhook_secret, ...safe } = row
    return res.json({ instances: [safe] })
```
por
```js
    return res.json({ instances: [sanitizeInstance(row, 'atendente')] })
```
e troque `res.json({ instances: rows })` por `res.json({ instances: rows.map(r => safe(r, req)) })`.

Logo depois do fim de `GET /whatsapp`, acrescente:
```js
// ─── Provedores disponiveis para novos numeros (UzAPI so com credenciais da Dros no .env) ───
router.get('/whatsapp/providers', requireRole('super_admin', 'gerente', 'atendente'), (req, res) => {
  res.json({ providers: listAvailableProviders(), default: 'evolution' })
})
```

- [ ] **Passo 3: Criar número (`POST /whatsapp`)**

Logo depois da validação de `lead_intake_mode` (linha `if (!['open', 'restricted'].includes(lead_intake_mode)) …`), acrescente:
```js
  const provider = req.body.provider || 'evolution'
  if (!['evolution', 'uzapi'].includes(provider)) {
    return res.status(400).json({ error: 'Provedor inválido (use evolution ou uzapi).', code: 'invalid_provider' })
  }
  if (provider === 'uzapi') {
    try {
      const created = await manager.createUzapiInstance({ accountId: req.accountId, instanceName: instance_name, leadIntakeMode: lead_intake_mode })
      makeAttendantOwner(req, created)
      return res.json({ instance: safe(db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(created.id), req) })
    } catch (err) {
      return sendProviderError(res, err)
    }
  }
```
No resto do handler (Evolution): troque o bloco `if (req.user.role === 'atendente') { … }` por `makeAttendantOwner(req, instance)`; troque `return res.json({ instance: db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id) })` por `return res.json({ instance: safe(db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(existing.id), req) })`; e o `res.json({ instance })` final por `res.json({ instance: safe(instance, req) })`.

- [ ] **Passo 4: QR / conectar**

Em `POST /whatsapp/:id/connect`, logo depois de `if (!instance) return`, acrescente:
```js
  if (isUzapi(instance)) {
    try {
      const r = await manager.refreshQr(instance)
      return res.json({ ...r, instance: safe(r.instance, req) })
    } catch (err) {
      return sendProviderError(res, err)
    }
  }
```
e troque o `res.json({ instance: updated })` do mesmo handler por `res.json({ instance: safe(updated, req), qr_code: updated.qr_code, status: updated.status })`.

Em `POST /whatsapp/:id/qrcode`, faça o mesmo: acrescente o mesmo bloco `if (isUzapi(instance)) { … }` depois de `if (!instance) return`, e troque o `res.json({ instance: updated })` por `res.json({ instance: safe(updated, req), qr_code: updated.qr_code, status: updated.status })`.

- [ ] **Passo 5: Status, desconectar, excluir, reiniciar, testar**

`GET /whatsapp/:id/status` — depois de `if (!instance) return`:
```js
  if (isUzapi(instance)) {
    const r = await manager.checkStatus(instance)
    return res.json({ instance: safe(r.instance, req), state: r.state, error: r.error })
  }
```
e troque os dois `res.json({ instance: … })` do caminho Evolution por `res.json({ instance: safe(updated, req), state })` e `res.json({ instance: safe(db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instance.id), req), error: err.message })`.

`POST /whatsapp/:id/disconnect` — depois de `if (!instance) return`:
```js
  if (isUzapi(instance)) {
    try {
      await manager.disconnect(instance)
      return res.json({ ok: true })
    } catch (err) {
      return sendProviderError(res, err)
    }
  }
```

`DELETE /whatsapp/:id` — depois de `if (!instance) return`:
```js
  if (isUzapi(instance)) {
    await manager.remove(instance)
    return res.json({ ok: true })
  }
```

`POST /whatsapp/:id/restart` — depois de `if (!instance) return`:
```js
  if (isUzapi(instance)) {
    try {
      const r = await manager.restart(instance)
      if (!r.ok) return res.status(502).json({ error: 'A UzAPI não reiniciou o número: ' + r.reason, code: 'provider_error' })
      return res.json({ ok: true, response: r })
    } catch (err) {
      return sendProviderError(res, err)
    }
  }
```

`POST /whatsapp/:id/test` — depois de `if (!instance) return`:
```js
  if (isUzapi(instance)) {
    const r = await manager.checkStatus(instance)
    return res.json({ success: r.instance.status === 'connected', status: r.instance.status, error: r.error })
  }
```

- [ ] **Passo 6: Demais respostas com instância + sync de telefone só na Evolution**

Troque `res.json({ instance: updated })` por `res.json({ instance: safe(updated, req) })` em `PUT /whatsapp/:id/first-msg-template`, `PUT /whatsapp/:id/mode` e `PUT /whatsapp/:id/attendant`.

Em `POST /whatsapp/sync-phones`, troque a consulta por:
```js
  const insts = db.prepare("SELECT * FROM whatsapp_instances WHERE status='connected' AND (phone_number IS NULL OR phone_number = '') AND COALESCE(provider, 'evolution') = 'evolution'").all()
```

- [ ] **Passo 7: Uso UzAPI por conta** — `server/routes/admin.js`

Acrescente o import:
```js
import { uzapiUsageByAccount } from '../services/whatsapp/connectionLog.js'
```
e, antes de `export default router`:
```js
// ─── Numeros UzAPI por conta e desde quando (base da cobranca futura) ───
router.get('/uzapi-usage', requireRole('super_admin'), (req, res) => {
  res.json({ accounts: uzapiUsageByAccount(db) })
})
```

- [ ] **Passo 8: Verificar**

Run: `node --check server/routes/integrations.js && node --check server/routes/admin.js`
Expected: nenhuma saída.

Run: `grep -n "json({ instance" server/routes/integrations.js`
Expected: **toda** linha listada contém `safe(` ou `sanitizeInstance(` (nenhuma resposta devolve a linha crua com `provider_config`).

Run: `grep -n "instances: rows" server/routes/integrations.js`
Expected: só a linha com `rows.map(r => safe(r, req))`.

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 9: Commit**

```bash
git add server/routes/integrations.js server/routes/admin.js
git commit -m "feat: rotas de numero por provedor (UzAPI) sem expor provider_config"
```

---

### Tarefa 13: Rotinas automáticas — Evolution ignora UzAPI + checagem de hora em hora

**Arquivos:**
- Criar: `server/services/whatsapp/instanceQueries.js`
- Criar: `server/services/whatsapp/uzapiStatusSync.js`
- Modificar: `server/scheduler.js`
- Modificar: `server/routes/admin.js:10-16`
- Teste: `test/instanceQueries.test.js`

**Interfaces:**
- Consome: `createInstanceManager` (Tarefa 10); `insertUzapiInstance`, `UZAPI_TEST_ENV`, `quietLog` (helpers).
- Produz (`instanceQueries.js`): `EVOLUTION_ONLY_SQL`, `listGhostCandidates(db)`, `listDailyCheckInstances(db)`, `listAdminCheckAll(db)`, `listWebhookReRegister(db)`, `listUzapiInstances(db)`, `cleanupStaleQRCodes(db)` (Evolution: 2 min; UzAPI: 5 min).
- Produz (`uzapiStatusSync.js`): `createUzapiStatusSync({ db, getProvider, manager, log }) → { run() → Promise<number> }` (só corrige `status`/`phone_number`; nunca reinicia nem pede QR).

- [ ] **Passo 1: Escrever o teste que falha** — `test/instanceQueries.test.js`

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedBasic } from './helpers/db.js'
import { insertUzapiInstance, UZAPI_TEST_ENV, quietLog } from './helpers/uzapiFixtures.js'
import * as Q from '../server/services/whatsapp/instanceQueries.js'
import { createUzapiStatusSync } from '../server/services/whatsapp/uzapiStatusSync.js'
import { createInstanceManager } from '../server/services/whatsapp/instanceManager.js'

const ids = (rows) => rows.map(r => r.id)

test('rotinas da Evolution (GhostDetect, checagem diaria, check-all, reregistro de webhook) ignoram numeros UzAPI', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id)
  assert.deepEqual(ids(Q.listGhostCandidates(db)), [instance.id])
  assert.deepEqual(ids(Q.listDailyCheckInstances(db)), [instance.id])
  assert.deepEqual(ids(Q.listAdminCheckAll(db)), [instance.id])
  assert.deepEqual(ids(Q.listWebhookReRegister(db)), [instance.id])
  assert.deepEqual(ids(Q.listUzapiInstances(db)), [uz.id])
  assert.equal(Q.listDailyCheckInstances(db)[0].account_name, 'Conta Teste')
})

test('cleanupStaleQRCodes: Evolution perde o QR apos 2 min; UzAPI so apos 5 min', () => {
  const db = createTestDb()
  const { account, instance } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connecting' })
  db.prepare("UPDATE whatsapp_instances SET qr_code = 'QR', status = 'connecting', updated_at = datetime('now', '-3 minutes')").run()
  Q.cleanupStaleQRCodes(db)
  const qr = (id) => db.prepare('SELECT qr_code FROM whatsapp_instances WHERE id = ?').get(id).qr_code
  assert.equal(qr(instance.id), null)
  assert.equal(qr(uz.id), 'QR')
  db.prepare("UPDATE whatsapp_instances SET updated_at = datetime('now', '-6 minutes') WHERE id = ?").run(uz.id)
  Q.cleanupStaleQRCodes(db)
  assert.equal(qr(uz.id), null)
})

test('checagem de hora em hora: corrige status e telefone dos numeros UzAPI sem reiniciar nem pedir QR', async () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connecting' })
  const calls = []
  const adapter = {
    async status(i) { calls.push(['status', i.id]); return { ok: true, status: 'connected', phoneNumber: '554890000001', qr: null } },
    async restart() { calls.push(['restart']); return { ok: true } },
    async getQr() { calls.push(['getQr']); return { ok: true } },
  }
  const getProvider = () => adapter
  const manager = createInstanceManager({ db, getProvider, env: UZAPI_TEST_ENV, log: quietLog })
  const sync = createUzapiStatusSync({ db, getProvider, manager, log: quietLog })
  assert.equal(await sync.run(), 1)
  assert.deepEqual(calls, [['status', uz.id]])
  const row = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(uz.id)
  assert.deepEqual([row.status, row.phone_number], ['connected', '554890000001'])
  assert.ok(row.connected_at)
  assert.equal(await sync.run(), 0, 'sem diferenca, nao mexe')
})

test('checagem de hora em hora: erro da UzAPI nao muda nada', async () => {
  const db = createTestDb()
  const { account } = seedBasic(db)
  const uz = insertUzapiInstance(db, account.id, { status: 'connected' })
  const adapter = { async status() { return { ok: false, status: null, reason: 'provider_error' } } }
  const manager = createInstanceManager({ db, getProvider: () => adapter, env: UZAPI_TEST_ENV, log: quietLog })
  const sync = createUzapiStatusSync({ db, getProvider: () => adapter, manager, log: quietLog })
  assert.equal(await sync.run(), 0)
  assert.equal(db.prepare('SELECT status FROM whatsapp_instances WHERE id = ?').get(uz.id).status, 'connected')
})
```

- [ ] **Passo 2: Rodar e ver falhar**

Run: `node --test test/instanceQueries.test.js`
Expected: FAIL — `Cannot find module '…/instanceQueries.js'`.

- [ ] **Passo 3: Implementar**

`server/services/whatsapp/instanceQueries.js`:
```js
// Consultas por provedor usadas pelas rotinas automaticas. Reconectar, reiniciar e reregistrar webhook
// so existem na Evolution; a UzAPI cuida da propria sessao (e tem a checagem de hora em hora dela).
export const EVOLUTION_ONLY_SQL = "COALESCE(provider, 'evolution') = 'evolution'"

export function listGhostCandidates(db) {
  return db.prepare(`SELECT id, instance_name, api_url, api_key FROM whatsapp_instances WHERE status = 'connected' AND ${EVOLUTION_ONLY_SQL}`).all()
}

export function listDailyCheckInstances(db) {
  return db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    WHERE COALESCE(w.provider, 'evolution') = 'evolution'
  `).all()
}

export function listAdminCheckAll(db) {
  return db.prepare(`
    SELECT w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name
    FROM whatsapp_instances w
    JOIN accounts a ON a.id = w.account_id
    WHERE COALESCE(w.provider, 'evolution') = 'evolution'
    ORDER BY a.name, w.instance_name
  `).all()
}

// A UzAPI ja recebe o webhook na criacao; reregistrar a cada minuto seria um PUT /instance/update por numero.
export function listWebhookReRegister(db) {
  return db.prepare(`SELECT * FROM whatsapp_instances WHERE status = 'connected' AND ${EVOLUTION_ONLY_SQL}`).all()
}

export function listUzapiInstances(db) {
  return db.prepare("SELECT * FROM whatsapp_instances WHERE provider = 'uzapi'").all()
}

// QR velho: Evolution 2 min (como hoje); UzAPI 5 min (o QR pode chegar pelo aviso e a leitura demora mais).
export function cleanupStaleQRCodes(db) {
  db.prepare(`
    UPDATE whatsapp_instances SET qr_code = NULL
    WHERE qr_code IS NOT NULL AND status = 'connecting'
      AND (
        (${EVOLUTION_ONLY_SQL} AND datetime(updated_at) < datetime('now', '-2 minutes'))
        OR (provider = 'uzapi' AND datetime(updated_at) < datetime('now', '-5 minutes'))
      )
  `).run()
}
```

`server/services/whatsapp/uzapiStatusSync.js`:
```js
// Checagem de hora em hora dos numeros UzAPI (spec 4.7): so corrige status e telefone.
// Nunca reinicia nem pede QR: quem cuida da sessao e a UzAPI; o aviso "connection" cobre o tempo real.
import { listUzapiInstances } from './instanceQueries.js'

export function createUzapiStatusSync({ db, getProvider, manager, log = console }) {
  async function run() {
    let changed = 0
    for (const inst of listUzapiInstances(db)) {
      try {
        const st = await getProvider(inst).status(inst)
        if (!st || !st.ok || !st.status) continue
        const samePhone = !st.phoneNumber || st.phoneNumber === inst.phone_number
        if (st.status === inst.status && samePhone) continue
        manager.applyStatus(inst, st)
        changed++
      } catch (e) {
        log.error(`[UzAPI checagem] ${inst.instance_name}: ${e.message}`)
      }
    }
    return changed
  }
  return { run }
}
```

- [ ] **Passo 4: Rodar e ver passar**

Run: `node --test test/instanceQueries.test.js`
Expected: PASS.

- [ ] **Passo 5: Ligar no scheduler** — `server/scheduler.js`

Acrescente aos imports:
```js
import { listGhostCandidates, listDailyCheckInstances, listWebhookReRegister, cleanupStaleQRCodes as cleanupStaleQRCodesByProvider } from './services/whatsapp/instanceQueries.js'
import { createUzapiStatusSync } from './services/whatsapp/uzapiStatusSync.js'
import { createInstanceManager } from './services/whatsapp/instanceManager.js'
```
Em `reRegisterWebhooks`, troque `const instances = db.prepare("SELECT * FROM whatsapp_instances WHERE status = 'connected'").all()` por `const instances = listWebhookReRegister(db)`.

Troque o corpo de `cleanupStaleQRCodes` por:
```js
function cleanupStaleQRCodes() {
  cleanupStaleQRCodesByProvider(db)
}
```
(e o comentário acima dela por `// ─── Clean up stale QR codes (Evolution 2 min, UzAPI 5 min) ──────────────`).

Em `detectGhostInstancesAndRestart`, troque `const instances = db.prepare("SELECT id, instance_name, api_url, api_key FROM whatsapp_instances WHERE status = 'connected'").all()` por `const instances = listGhostCandidates(db)`.

Em `dailyInstanceHealthCheck`, troque a atribuição inteira `const instances = db.prepare(...).all()` (o SELECT de `w.id, w.instance_name, w.api_url, w.api_key, w.status, a.name as account_name` com `JOIN accounts`) por `const instances = listDailyCheckInstances(db)`.

Logo antes de `export function startScheduler()`, acrescente:
```js
// ─── UzAPI: checagem de hora em hora (so status/telefone) ─────────
const uzapiStatusSync = createUzapiStatusSync({ db, getProvider, manager: createInstanceManager({ db, getProvider }) })
```
e, dentro de `startScheduler`, antes de `scheduleDailyHealthCheck()`:
```js
  // Numeros UzAPI: confere status/telefone de hora em hora (sem reiniciar, sem QR)
  setInterval(() => {
    uzapiStatusSync.run().catch(e => console.error('[UzAPI checagem]', e.message))
  }, 60 * 60 * 1000)
```

- [ ] **Passo 6: Check-all do admin** — `server/routes/admin.js`

Acrescente o import:
```js
import { listAdminCheckAll } from '../services/whatsapp/instanceQueries.js'
```
e, em `/instances/check-all`, troque a atribuição inteira `const instances = db.prepare(...).all()` (o SELECT com `JOIN accounts` e `ORDER BY a.name, w.instance_name`) por `const instances = listAdminCheckAll(db)`.

- [ ] **Passo 7: Verificar**

Run: `node --check server/scheduler.js && node --check server/routes/admin.js`
Expected: nenhuma saída.

Run: `grep -n "FROM whatsapp_instances" server/scheduler.js`
Expected: sobram só as consultas que já filtram provedor ou capacidade (`checkWhatsAppInstances` filtra `evolution` em JS; `pollMissedMessages` filtra `capabilities.polling`; `processScheduledBroadcasts` e `autoResumePausedInstances` não falam com o provedor).

Run: `npm test`
Expected: 0 falhas.

- [ ] **Passo 8: Commit**

```bash
git add server/services/whatsapp/instanceQueries.js server/services/whatsapp/uzapiStatusSync.js server/scheduler.js server/routes/admin.js test/instanceQueries.test.js
git commit -m "feat: rotinas da Evolution ignoram UzAPI e checagem de hora em hora dos numeros UzAPI"
```

---

### Tarefa 14: Verificação final + roteiro com a conta UzAPI ativa

**Arquivos:** nenhum novo (só ajustes se a conta ativa mostrar formato diferente).

- [ ] **Passo 1: Regressão completa**

Run: `npm test`
Expected: os 356 testes antigos + os novos, **0 falhas**.

- [ ] **Passo 2: Nada de segredo ou dado real no que foi commitado**

Run: `git diff --stat <hash do commit deste plano> HEAD` e confira que só aparecem arquivos deste plano (nada de `dist/`, `package-lock.json`, `vite.config.ts`, `*.mjs` da raiz).
Run: `git grep -nE "eyJ[A-Za-z0-9_-]{20,}" -- server test` → Expected: nenhuma linha.
Run: `node --test test/uzapiFixtures.test.js` → Expected: PASS.

- [ ] **Passo 3: Sintaxe de todos os arquivos de servidor tocados**

Run: `for f in server/index.js server/scheduler.js server/routes/*.js server/services/whatsapp/*.js server/services/mediaTemp.js; do node --check "$f" || echo "FALHOU $f"; done`
Expected: nenhuma linha `FALHOU`.

- [ ] **Passo 4: Roteiro com a conta ativa (feito pelo dono, com o executor acompanhando os logs)**

Pré-requisitos: token da **conta** (Painel UzAPI > Meu Perfil > Token da API) e uma URL pública até o CRM local (o dono cria o túnel; o Claude Code bloqueia túnel). No `.env` local: `UZAPI_USERNAME`, `UZAPI_ACCOUNT_TOKEN`, `WA_ENC_KEY` (gerar), `PUBLIC_BASE_URL=<url do túnel>/crm` (ou sem `/crm`, conforme o túnel). Suba com `npm run dev:server`.

1. `GET /api/integrations/whatsapp/providers?account_id=<id>` → deve listar `uzapi`.
2. `POST /api/integrations/whatsapp?account_id=<id>` com `{"instance_name":"Teste UzAPI","provider":"uzapi"}`.
   - Se responder 502 `uzapi_create_incomplete`: o log `[UzAPI] /instance/add sem phone_number_id ou token; campos recebidos: …` mostra os **nomes** dos campos. Ajuste `extractInstanceCredentials` (`uzapiSession.js`) para os nomes reais, acrescente um caso no teste `extractInstanceCredentials aceita os nomes de campo provaveis` e rode `node --test test/uzapiSession.test.js`.
3. `POST /api/integrations/whatsapp/<id>/qrcode?account_id=<id>` algumas vezes nos primeiros 30 s:
   - veio `qr_code` → anote o formato (imagem ou texto `2@…`) para o plano do front;
   - veio `panel_url` → confira se abre o painel certo; se a URL não for essa, ajuste `UZAPI_PANEL_URL` no `.env.example` e em `DEFAULT_UZAPI_PANEL_URL` (`uzapiClient.js`).
   - Se o QR chegou pelo aviso `authentication` com outro nome de campo, acrescente o nome em `QR_KEYS` (`metaFormat.js`), troque a fixture `authentication-qr.synthetic.json` pelo aviso real mascarado (rode o script da Tarefa 1 adaptado) e rode `node --test test/metaFormat.test.js`.
4. Leia o QR com o celular de teste. Esperado: aviso `connection: connected` → número `connected`, `connected_at` preenchido, linha `connected` em `whatsapp_connection_log`, telefone preenchido pouco depois.
5. Mande do celular de outro número um texto, um áudio e uma foto → aparecem no Chat; o player baixa o áudio (rota de mídia) e a IA transcreve (se ligada).
6. Responda pelo Chat do CRM (texto, foto, PDF, áudio) → chegam no celular; o status muda para entregue/lido. Confira no log se a subida em `/media` devolveu `id` (spec 9.2); se não devolveu, o envio deve ter ido por `/api/media-temp/…`.
7. Responda **pelo celular** do número → em ~5 s a resposta aparece no Chat como enviada (eco). Confira se o formato real de `POST /chats` bate com `chats-get-echo.synthetic.json`; se não bater, ajuste `parseChatMessage` e a fixture.
8. Desconectar, reiniciar e excluir pelo CRM → confira no painel da UzAPI e em `whatsapp_connection_log` (`disconnected`, `removed`).
9. `GET /api/admin/uzapi-usage` (super_admin) → a conta aparece com os números.

- [ ] **Passo 5: Commit dos ajustes (só se houve)**

```bash
git add <apenas os arquivos ajustados no Passo 4>
git commit -m "fix: ajusta leitura da UzAPI ao formato real da conta ativa"
```

---

## Cobertura do spec (auto-revisão)

| Spec | Tarefa |
|---|---|
| 4.1 peças novas (`metaFormat`, `uzapi`, `uzapiClient`, `providerConfig`), registro na tomada, `'uzapi'` em `WHATSAPP_PROVIDERS` | 2, 3, 4, 5, 6 |
| 4.2 interface do adaptador (capabilities, sendText, sendMedia, fetchMedia, parseWebhook, fetchMessageById, createInstance, getQr, status, registerWebhook, disconnect/restart/remove); `fetchMedia` com a linha inteira no Deepgram | 5, 6, 9 |
| 4.3 recebimento (todos os entry, tipos, grupos descartados, statuses, played→read, leitura pelo próprio número ignorada, eco, connection, 200 em erro) | 4, 8, 11 |
| 4.4 QR (aviso authentication, campo na resposta, plano B `panel_url`) | 4, 6, 10, 12 |
| 4.5 envio (anti-ban mantido, delayTyping, URL temporária, retorno `{ok, wamsgId, reason}`, sem dependência nova) | 5, 7, 8 |
| 4.6 gestão pelo CRM (criar com credenciais da Dros, `provider_config`, aquecimento, rotas por provedor, DELETE com `removed`, lista sem `provider_config`, `/providers`) | 10, 12 |
| 4.7 rotinas (GhostDetect/diária/check-all só Evolution, checagem de hora em hora, QR UzAPI 5 min) | 13 |
| 6 dados (`.env`, `connected_at`, `whatsapp_connection_log`, `media_temp`) | 2, 3, 7 |
| 7 erros (provider_error, provider_auth + log, 400 claro, pnid diferente descartado, JSON inválido 200) | 5, 10, 11 |
| 8 testes com avisos reais mascarados em `test/fixtures/uzapi/` + regressão | 1–14 |
| 9 pendências da conta ativa | 14 (roteiro) |
| Decisão "registrar quantos números UzAPI cada conta tem e desde quando" | 2, 12 (`/api/admin/uzapi-usage`) |
| 5 telas | fora (plano do front); contrato no topo |

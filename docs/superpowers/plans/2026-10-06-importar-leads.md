# Importar leads (planilha .xlsx/.csv) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o gestor sobe um .xlsx/.csv, liga cada coluna a um campo do CRM (ou "Informação extra" / "Não importar"), confere a prévia e importa — sem nenhuma mensagem automática.

**Architecture:** o navegador lê o arquivo (`papaparse` / `read-excel-file`) e transforma as linhas em `Row[]` com uma função pura (`src/lib/leadImport.js`). O servidor tem um serviço puro (`server/services/leadImport/importer.js`) com `planImport` (prévia, não grava) e `applyImport` (grava numa transação), exposto por um router de fábrica (`createLeadImportRouter`). Janela de 4 passos na tela Leads; "Informações extras" (`leads.custom_fields`) passam a aparecer na ficha e no Chat.

**Tech Stack:** Node 20 local (produção Node 16), Express 4, better-sqlite3, React 19 + TS + Vite 4. Testes: `export PATH="/c/nvm4w/nodejs:$PATH"; node --test test/`.

**Spec:** `docs/superpowers/specs/2026-10-06-importar-leads-design.md`

## Global Constraints

- Só `gerente` e `super_admin` importam; atendente recebe 403.
- Limite: 5.000 linhas por importação (navegador e servidor).
- Telefone: `normalizePhone`; repetido = mesmo `phoneCompareKey` dentro da conta (inclui arquivados/bloqueados).
- Lead existente: só preenche coluna vazia (`NULL`/`''`); soma tags e chaves novas de `custom_fields`; nunca muda etapa, funil, vendedor, tipo de contato.
- Nada automático: não usar `getOrCreateLead`/`leadIntake`; sem handoff, boas-vindas, agente, CAPI, aviso de lead novo; `opted_in_at` fica `NULL`.
- Uma transação por importação; erro = nada gravado.
- `source = 'importacao'`; `stage_history.trigger_type = 'import'`.
- Tamanhos: nome 200, e-mail 200, cidade/estado/empresa/instagram/cpf_cnpj/origem 200, observações 5.000, informação extra até 50 chaves com valor até 500.
- Texto da tela sem jargão, com exemplo em cada "?". Commits em português, sem emojis no código. Nunca commitar `vite.config.ts`, `dist/`, `.env`, `server/data/crm.db` (depois do `npm run build`: `git checkout -- dist && git clean -fdq dist`).

## Review Focus

1. Planilha com o mesmo telefone em formatos diferentes ("(48) 99999-0000", "5548999990000", "48 9999-0000" sem o 9) → um lead só. Teste na Tarefa 2.
2. Lead que já existe com e-mail preenchido e planilha trazendo outro e-mail → o e-mail do CRM fica. Teste na Tarefa 2.
3. Erro no meio da gravação (ex.: etapa apagada entre a prévia e o Importar) → nada gravado. Teste na Tarefa 2.
4. CSV salvo pelo Excel em português (separador `;`, acentos em Latin-1) → nomes com acento corretos. Teste na Tarefa 1 (decodificação) e conferência no navegador (Tarefa 5).
5. Funil/etapa/vendedor de outra conta enviados à mão na API → 400, nada gravado. Teste na Tarefa 3.

---

## Estrutura de arquivos

- Create `src/lib/leadImport.js` + `src/lib/leadImport.d.ts` — sugestão de campo, cabeçalhos únicos, limpeza de valores, linhas → `Row[]`, decodificação de texto, CSV dos que não entraram, telefone mascarado.
- Create `src/lib/readSheet.ts` — lê `File` (.csv/.xlsx) → `{ sheets?: string[], headers: string[], rows: string[][] }`.
- Create `server/services/leadImport/importer.js` — `LeadImportError`, `planImport`, `applyImport`.
- Create `server/routes/leadImportRouter.js` — `POST /preview`, `POST /`.
- Modify `server/index.js` — montar `/api/leads/import` ANTES de `/api/leads`.
- Create `src/components/leads/ImportLeadsModal.tsx`; Modify `src/pages/Leads.tsx` (botão), `src/lib/api.ts` (chamadas).
- Create `src/components/leads/ExtraInfoCard.tsx`; Modify `src/pages/Chat.tsx` (aba Info), `src/pages/LeadDetail.tsx`.
- Tests: `test/leadImportLib.test.js`, `test/leadImport.test.js`, `test/leadImportHttp.test.js`, `test/helpers/leadImportDb.js`.

---

### Task 1: Regras puras do navegador (`leadImport.js`)

**Files:**
- Create: `src/lib/leadImport.js`, `src/lib/leadImport.d.ts`
- Test: `test/leadImportLib.test.js`

**Interfaces:**
- Produces:
  - `FIELDS: Array<{ key: string, label: string, unique: boolean }>` — keys: `name, phone, email, city, state, empresa, instagram, cpf_cnpj, notes, value_estimated, source_detail, tags, extra, skip`
  - `suggestField(header: string): string` (uma key de `FIELDS`)
  - `uniqueHeaders(headers: string[]): string[]` ("Telefone","Telefone" → "Telefone","Telefone (2)"; vazio → "Coluna N")
  - `autoMapping(headers: string[]): string[]` (sugestão por coluna, respeitando `unique`: o 2º `phone` vira `extra`)
  - `setMapping(mapping: string[], index: number, key: string): string[]` (campo `unique` sai da coluna anterior → `skip`)
  - `buildRows(headers: string[], data: string[][], mapping: string[]): Row[]` — `Row = { row: number, fields: {...}, extra: Record<string,string> }`; `row` = linha na planilha (cabeçalho = 1, 1º dado = 2)
  - `parseMoney(v): number|null`, `cleanInstagram(v): string`, `maskPhone(v): string`
  - `decodeText(bytes: Uint8Array): string` (UTF-8; se aparecer `�`, relê como `windows-1252`)
  - `skippedCsv(headers: string[], data: string[][], skipped: Array<{row:number, reason:string}>): string` (CSV `;` com BOM, colunas originais + "Motivo")
  - `MAX_ROWS = 5000`

- [ ] **Step 1: Testes que falham**

```js
// test/leadImportLib.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  suggestField, uniqueHeaders, autoMapping, setMapping, buildRows, parseMoney, cleanInstagram, maskPhone, decodeText, skippedCsv, MAX_ROWS,
} from '../src/lib/leadImport.js'

test('sugere o campo pelo nome da coluna (sem acento, minusculo)', () => {
  const pares = [['Nome Completo', 'name'], ['Celular', 'phone'], ['WhatsApp', 'phone'], ['E-mail', 'email'], ['Município', 'city'], ['UF', 'state'],
    ['Razão Social', 'empresa'], ['Insta', 'instagram'], ['CNPJ', 'cpf_cnpj'], ['Observações', 'notes'], ['Valor', 'value_estimated'],
    ['Fonte', 'source_detail'], ['Etiquetas', 'tags'], ['Tamanho da loja', 'extra'], ['', 'extra']]
  for (const [h, k] of pares) assert.equal(suggestField(h), k, h)
})

test('cabecalhos repetidos/vazios e mapeamento sem campo unico repetido', () => {
  assert.deepEqual(uniqueHeaders(['Telefone', 'Telefone', '', 'Nome']), ['Telefone', 'Telefone (2)', 'Coluna 3', 'Nome'])
  assert.deepEqual(autoMapping(['Celular', 'Telefone', 'Nome', 'Sobrenome']), ['phone', 'extra', 'name', 'name']) // Sobrenome junta no Nome
  const m = setMapping(['phone', 'extra', 'name'], 1, 'phone')
  assert.deepEqual(m, ['skip', 'phone', 'name'])
  assert.deepEqual(setMapping(['name', 'skip'], 1, 'name'), ['name', 'name']) // Nome pode repetir (junta)
})

test('linhas viram Row: junta nomes, observacoes, tags, extras; limpa valor e instagram; pula linha vazia', () => {
  const headers = ['Nome', 'Sobrenome', 'Fone', 'Insta', 'Valor', 'Tags', 'Tamanho', 'Obs', 'Obs 2', 'Lixo']
  const mapping = ['name', 'name', 'phone', 'instagram', 'value_estimated', 'tags', 'extra', 'notes', 'notes', 'skip']
  const data = [
    [' Ana ', 'Souza', '(48) 99999-0000', 'https://instagram.com/ana.loja/', 'R$ 1.234,56', 'vip; feira , ', '120 m²', 'liga cedo', 'tem 2 lojas', 'x'],
    ['', '', '', '', '', '', '', '', '', ''],
    ['João', '', '48 3333-2222', '@joao', '1500', '', '', '', '', ''],
  ]
  const rows = buildRows(headers, data, mapping)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    row: 2,
    fields: { name: 'Ana Souza', phone: '(48) 99999-0000', instagram: 'ana.loja', value_estimated: 1234.56, tags: ['vip', 'feira'], notes: 'liga cedo\ntem 2 lojas' },
    extra: { Tamanho: '120 m²' },
  })
  assert.equal(rows[1].row, 4)
  assert.equal(rows[1].fields.instagram, 'joao')
  assert.equal(rows[1].fields.value_estimated, 1500)
  assert.equal(parseMoney('abc'), null)
  assert.equal(parseMoney('1,5'), 1.5)
  assert.equal(cleanInstagram('@@x'), 'x')
})

test('telefone mascarado, texto Latin-1 e CSV dos que nao entraram', () => {
  assert.equal(maskPhone('5548999990000'), '(48) 9****-0000')
  assert.equal(maskPhone('123'), '***')
  const latin1 = Uint8Array.from([0x4a, 0x6f, 0xe3, 0x6f]) // "João" em Latin-1
  assert.equal(decodeText(latin1), 'João')
  assert.equal(decodeText(new TextEncoder().encode('São')), 'São')
  const csv = skippedCsv(['Nome', 'Fone'], [['Ana', ''], ['Bia', '1']], [{ row: 2, reason: 'sem telefone' }, { row: 3, reason: 'telefone inválido' }])
  assert.equal(csv, '﻿Nome;Fone;Motivo\r\nAna;;sem telefone\r\nBia;1;telefone inválido\r\n')
  assert.equal(MAX_ROWS, 5000)
})
```

Run: `node --test test/leadImportLib.test.js` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar `src/lib/leadImport.js`**

```js
// Importar leads: regras puras do navegador (spec 2026-10-06 importar leads §3-§4, §8).
// JS puro com .d.ts: roda no node --test e e importado pelo front.
export const MAX_ROWS = 5000

export const FIELDS = [
  { key: 'name', label: 'Nome', unique: false },
  { key: 'phone', label: 'Telefone', unique: true },
  { key: 'email', label: 'E-mail', unique: true },
  { key: 'city', label: 'Cidade', unique: true },
  { key: 'state', label: 'Estado (UF)', unique: true },
  { key: 'empresa', label: 'Empresa', unique: true },
  { key: 'instagram', label: 'Instagram', unique: true },
  { key: 'cpf_cnpj', label: 'CPF/CNPJ', unique: true },
  { key: 'notes', label: 'Observações', unique: false },
  { key: 'value_estimated', label: 'Valor estimado', unique: true },
  { key: 'source_detail', label: 'Origem', unique: true },
  { key: 'tags', label: 'Tags', unique: true },
  { key: 'extra', label: 'Informação extra', unique: false },
  { key: 'skip', label: 'Não importar', unique: false },
]
const UNIQUE = new Set(FIELDS.filter(f => f.unique).map(f => f.key))

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const HINTS = [
  ['phone', ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'phone', 'tel', 'contato']],
  ['email', ['email', 'e mail']],
  ['name', ['nome', 'nome completo', 'name', 'cliente', 'sobrenome']],
  ['city', ['cidade', 'municipio']],
  ['state', ['estado', 'uf']],
  ['empresa', ['empresa', 'razao social', 'loja', 'nome fantasia']],
  ['instagram', ['instagram', 'insta']],
  ['cpf_cnpj', ['cpf', 'cnpj', 'documento', 'cpf cnpj']],
  ['notes', ['obs', 'observacao', 'observacoes', 'nota', 'notas']],
  ['value_estimated', ['valor', 'ticket', 'valor estimado']],
  ['source_detail', ['origem', 'fonte', 'source', 'campanha']],
  ['tags', ['tag', 'tags', 'etiqueta', 'etiquetas']],
]

export function suggestField(header) {
  const h = norm(header)
  if (!h) return 'extra'
  for (const [key, words] of HINTS) if (words.includes(h)) return key
  // "telefone 2", "nome do cliente": comeca com a palavra
  for (const [key, words] of HINTS) if (words.some(w => h.startsWith(w + ' '))) return key
  return 'extra'
}

export function uniqueHeaders(headers) {
  const seen = new Map()
  return (headers || []).map((h, i) => {
    const base = String(h == null ? '' : h).trim() || `Coluna ${i + 1}`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} (${n})`
  })
}

export function autoMapping(headers) {
  const used = new Set()
  return (headers || []).map(h => {
    const k = suggestField(h)
    if (UNIQUE.has(k)) { if (used.has(k)) return 'extra'; used.add(k) }
    return k
  })
}

export function setMapping(mapping, index, key) {
  return mapping.map((k, i) => (i === index ? key : UNIQUE.has(key) && k === key ? 'skip' : k))
}

const str = v => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim()

export function parseMoney(v) {
  let s = str(v).replace(/[^\d.,-]/g, '')
  if (!s) return null
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function cleanInstagram(v) {
  let s = str(v).replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '')
  return s.replace(/^@+/, '').trim()
}

export function buildRows(headers, data, mapping) {
  const out = []
  ;(data || []).forEach((cells, i) => {
    const values = (cells || []).map(str)
    if (!values.some(Boolean)) return
    const fields = {}
    const extra = {}
    const names = []
    const notes = []
    mapping.forEach((key, c) => {
      const v = values[c] || ''
      if (!v || key === 'skip') return
      if (key === 'name') names.push(v)
      else if (key === 'notes') notes.push(v)
      else if (key === 'extra') extra[headers[c]] = v
      else if (key === 'tags') {
        const tags = v.split(/[,;]/).map(t => t.trim()).filter(Boolean)
        if (tags.length) fields.tags = tags
      } else if (key === 'value_estimated') {
        const n = parseMoney(v)
        if (n !== null) fields.value_estimated = n
      } else if (key === 'instagram') {
        const ig = cleanInstagram(v)
        if (ig) fields.instagram = ig
      } else fields[key] = v
    })
    if (names.length) fields.name = names.join(' ')
    if (notes.length) fields.notes = notes.join('\n')
    out.push({ row: i + 2, fields, extra })
  })
  return out
}

export function maskPhone(v) {
  let d = String(v || '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  if (d.length < 10) return '***'
  return `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(-4)}`
}

export function decodeText(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '')
  return new TextDecoder('windows-1252').decode(bytes)
}

const csvCell = v => {
  const s = String(v == null ? '' : v)
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function skippedCsv(headers, data, skipped) {
  const lines = [[...headers, 'Motivo'].map(csvCell).join(';')]
  for (const s of skipped) {
    const cells = data[s.row - 2] || []
    lines.push([...headers.map((_, c) => cells[c] ?? ''), s.reason].map(csvCell).join(';'))
  }
  return '﻿' + lines.map(l => l + '\r\n').join('')
}
```

E `src/lib/leadImport.d.ts`:

```ts
export const MAX_ROWS: number
export interface ImportField { key: string; label: string; unique: boolean }
export const FIELDS: ImportField[]
export interface ImportRow { row: number; fields: Record<string, string | number | string[]>; extra: Record<string, string> }
export function suggestField(header: string): string
export function uniqueHeaders(headers: string[]): string[]
export function autoMapping(headers: string[]): string[]
export function setMapping(mapping: string[], index: number, key: string): string[]
export function buildRows(headers: string[], data: unknown[][], mapping: string[]): ImportRow[]
export function parseMoney(v: unknown): number | null
export function cleanInstagram(v: unknown): string
export function maskPhone(v: unknown): string
export function decodeText(bytes: Uint8Array): string
export function skippedCsv(headers: string[], data: unknown[][], skipped: Array<{ row: number; reason: string }>): string
```

- [ ] **Step 3: Rodar e ver passar**

Run: `node --test test/leadImportLib.test.js` → PASS (4 testes).

- [ ] **Step 4: Commit**

```bash
git add src/lib/leadImport.js src/lib/leadImport.d.ts test/leadImportLib.test.js
git commit -m "feat(importar): regras puras de ligar colunas e limpar valores da planilha"
```

---

### Task 2: Serviço do servidor — prévia e gravação

**Files:**
- Create: `server/services/leadImport/importer.js`
- Create: `test/helpers/leadImportDb.js`
- Test: `test/leadImport.test.js`

**Interfaces:**
- Consumes: `normalizePhone`, `phoneCompareKey` (`server/services/whatsapp/normalize.js`); `resolveCity` (`server/services/city.js`); `ensureStageCadence(db, { leadId })` (`server/services/cadence/leadCadence.js`); `CONTACT_TYPES` (`server/services/contacts/scope.js`).
- Produces:
  - `class LeadImportError extends Error { code, status }`
  - `planImport(db, { accountId, rows, destination, fileName }) -> { new_count, existing_count, filled_fields, skipped: [{row, reason}], samples: { novos: [{name, phone}], existentes: [...], fora: [...] } }` (não grava)
  - `applyImport(db, { accountId, rows, destination, fileName, userId }) -> { created, updated, skipped, tag_id, lead_ids }`
  - `destination = { funnel_id, stage_id, attendant: { mode: 'none'|'one'|'split', user_id? }, contact_type, auto_tag }`
  - `autoTagName(fileName, now = new Date()) -> string` ("Importado 06/10 – lista-feira", até 60)

- [ ] **Step 1: Helper do banco de teste**

```js
// test/helpers/leadImportDb.js
import { createCadenceTestDb, seedCadenceBase } from './cadenceDb.js'
import { applyContactSchema } from '../../server/services/contacts/schema.js'
import { registerCityFunctions } from '../../server/services/city.js'

export function createImportTestDb() {
  const db = createCadenceTestDb()
  registerCityFunctions(db)
  applyContactSchema(db)
  const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name)
  for (const [c, t] of [['notes', 'TEXT'], ['source_detail', 'TEXT'], ['custom_fields', 'TEXT'], ['state', 'TEXT'], ['cpf_cnpj', 'TEXT'],
    ['value_estimated', 'REAL'], ['opted_in_at', 'TEXT'], ['is_blocked', 'INTEGER NOT NULL DEFAULT 0']]) {
    if (!cols.includes(c)) db.exec(`ALTER TABLE leads ADD COLUMN ${c} ${t}`)
  }
  db.exec(`CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#FFB300', UNIQUE(account_id, name));
           CREATE TABLE IF NOT EXISTS lead_tags (lead_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (lead_id, tag_id));`)
  return db
}

export function seedImport(db) {
  const s = seedCadenceBase(db)
  const bia = Number(db.prepare("INSERT INTO users (account_id, name, email, role, is_active) VALUES (?, 'Bia', 'bia@a.local', 'atendente', 1)").run(s.accountId).lastInsertRowid)
  const dest = { funnel_id: s.funnelId, stage_id: s.stages.novo, attendant: { mode: 'none' }, contact_type: 'lead', auto_tag: true }
  return { ...s, biaId: bia, dest }
}
```

Antes de escrever, abrir `test/helpers/cadenceDb.js` e `test/helpers/memoryDb.js`: se `tags`/`lead_tags`/`is_active` em `users` já existirem, o `IF NOT EXISTS`/checagem cuida; se `users` não tiver `is_active`, acrescentar com o mesmo padrão `ALTER TABLE`.

- [ ] **Step 2: Testes que falham**

```js
// test/leadImport.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImportTestDb, seedImport } from './helpers/leadImportDb.js'
import { addLead } from './helpers/roteiroDb.js'
import { planImport, applyImport, autoTagName } from '../server/services/leadImport/importer.js'

const R = (row, fields, extra = {}) => ({ row, fields, extra })

test('previa: novos, existentes (so completa), repetidos na planilha e invalidos; nao grava', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Velha', phone: '5548999990000', email: 'velha@x.com' })
  const rows = [
    R(2, { name: 'Ana', phone: '(48) 99999-0000', email: 'nova@x.com', city: 'Floripa' }), // ja existe (outro formato)
    R(3, { name: 'Caio', phone: '48 3333-2222' }),
    R(4, { name: 'Caio de novo', phone: '554833332222', email: 'caio@x.com' }),           // repetido na planilha
    R(5, { name: 'Sem fone' }),
    R(6, { name: 'Curto', phone: '1234' }),
  ]
  const before = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n
  const p = planImport(db, { accountId: s.accountId, rows, destination: s.dest, fileName: 'lista.xlsx' })
  assert.equal(p.new_count, 1)
  assert.equal(p.existing_count, 1)
  assert.equal(p.filled_fields, 1) // so a cidade; o e-mail do CRM fica
  assert.deepEqual(p.skipped, [{ row: 4, reason: 'repetido na planilha (junto com a linha 3)' }, { row: 5, reason: 'sem telefone' }, { row: 6, reason: 'telefone inválido' }])
  assert.equal(p.samples.novos[0].phone, '(48) 9****-2222')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, before)
})

test('importar: cria com destino, extras, tags e tag automatica; existente so completa; nada automatico', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const velho = addLead(db, { account_id: s.accountId, funnel_id: s.funnelId, stage_id: s.stages.qualificando, name: 'Velha', phone: '5548999990000', email: 'velha@x.com', custom_fields: JSON.stringify({ Loja: 'A' }) })
  const rows = [
    R(2, { name: 'Ana', phone: '(48) 99999-0000', email: 'nova@x.com', city: 'floripa', tags: ['vip'] }, { Loja: 'B', Porte: 'grande' }),
    R(3, { name: 'Caio', phone: '48 3333-2222', value_estimated: 1500, tags: ['vip', 'feira'] }, { 'Tamanho da loja': '120 m²' }),
    R(4, { name: 'Caio 2', phone: '554833332222', email: 'caio@x.com' }),
  ]
  const r = applyImport(db, { accountId: s.accountId, rows, destination: { ...s.dest, stage_id: s.stages.qualificando }, fileName: 'lista-feira.xlsx', userId: s.gerenteId })
  assert.deepEqual([r.created, r.updated, r.skipped.length], [1, 1, 1])
  const caio = db.prepare("SELECT * FROM leads WHERE name = 'Caio'").get()
  assert.deepEqual([caio.phone, caio.stage_id, caio.source, caio.email, caio.value_estimated, caio.opted_in_at, caio.attendant_id], ['5548933332222', s.stages.qualificando, 'importacao', 'caio@x.com', 1500, null, null])
  assert.deepEqual(JSON.parse(caio.custom_fields), { 'Tamanho da loja': '120 m²' })
  assert.equal(db.prepare('SELECT trigger_type FROM stage_history WHERE lead_id = ?').get(caio.id).trigger_type, 'import')
  const v = db.prepare('SELECT * FROM leads WHERE id = ?').get(velho)
  assert.deepEqual([v.name, v.email, v.stage_id], ['Velha', 'velha@x.com', s.stages.qualificando])
  assert.deepEqual(JSON.parse(v.custom_fields), { Loja: 'A', Porte: 'grande' })
  const tagsOf = id => db.prepare('SELECT t.name FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = ? ORDER BY t.name').all(id).map(x => x.name)
  const auto = autoTagName('lista-feira.xlsx')
  assert.deepEqual(tagsOf(caio.id), [auto, 'feira', 'vip'].sort())
  assert.ok(tagsOf(velho).includes(auto) && tagsOf(velho).includes('vip'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 0)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stage_history WHERE trigger_type <> 'import'").get().n, 0)
})

test('vendedor: um so ou rodizio entre atendentes ativos; tipo de contato com origem lista', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const rows = [R(2, { phone: '48911110001' }), R(3, { phone: '48911110002' }), R(4, { phone: '48911110003' })]
  applyImport(db, { accountId: s.accountId, rows, destination: { ...s.dest, attendant: { mode: 'split' }, contact_type: 'revendedor', auto_tag: false }, fileName: 'a.csv', userId: s.gerenteId })
  const got = db.prepare("SELECT attendant_id, contact_type, contact_type_origin FROM leads WHERE source = 'importacao' ORDER BY id").all()
  assert.deepEqual(got.map(x => x.attendant_id), [s.atendenteId, s.biaId, s.atendenteId])
  assert.ok(got.every(x => x.contact_type === 'revendedor' && x.contact_type_origin === 'lista'))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tags').get().n, 0)
})

test('destino invalido, outra conta, limite e erro no meio: nada gravado', () => {
  const db = createImportTestDb(); const s = seedImport(db)
  const rows = [R(2, { phone: '48911110001' })]
  const fail = d => { try { applyImport(db, { accountId: s.accountId, rows, destination: d, fileName: 'a.csv', userId: 1 }); return null } catch (e) { return e } }
  const outroFunil = Number(db.prepare("INSERT INTO funnels (account_id, name) VALUES (?, 'X')").run(s.otherAccountId).lastInsertRowid)
  assert.equal(fail({ ...s.dest, funnel_id: outroFunil }).status, 400)
  assert.equal(fail({ ...s.dest, stage_id: 99999 }).status, 400)
  assert.equal(fail({ ...s.dest, attendant: { mode: 'one', user_id: 99999 } }).status, 400)
  assert.equal(fail({ ...s.dest, contact_type: 'chefe' }).status, 400)
  const muitas = Array.from({ length: 5001 }, (_, i) => R(i + 2, { phone: `489${String(i).padStart(8, '0')}` }))
  assert.throws(() => planImport(db, { accountId: s.accountId, rows: muitas, destination: s.dest, fileName: 'a.csv' }), e => e.status === 400)
  // erro no meio: trigger que falha no 2o insert
  db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON leads WHEN NEW.phone = '5548911110002' BEGIN SELECT RAISE(ABORT, 'boom'); END;")
  const two = [R(2, { phone: '48911110001' }), R(3, { phone: '48911110002' })]
  assert.throws(() => applyImport(db, { accountId: s.accountId, rows: two, destination: s.dest, fileName: 'a.csv', userId: 1 }))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
})

test('nome da tag automatica', () => {
  assert.equal(autoTagName('lista-feira.xlsx', new Date(2026, 9, 6)), 'Importado 06/10 – lista-feira')
  assert.ok(autoTagName('x'.repeat(200) + '.csv', new Date(2026, 9, 6)).length <= 60)
})
```

Run: `node --test test/leadImport.test.js` → FAIL (módulo não existe).

- [ ] **Step 3: Implementar `importer.js`**

```js
// Importar leads (spec 2026-10-06 importar leads §6-§7): previa e gravacao. Nada automatico:
// nao usa leadIntake/getOrCreateLead (distribuem e avisam). Nao importa server/db.js: recebe db.
import { normalizePhone, phoneCompareKey } from '../whatsapp/normalize.js'
import { resolveCity } from '../city.js'
import { ensureStageCadence } from '../cadence/leadCadence.js'
import { CONTACT_TYPES } from '../contacts/scope.js'

export class LeadImportError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status }
}

export const MAX_ROWS = 5000
const TEXT_FIELDS = ['name', 'email', 'city', 'state', 'empresa', 'instagram', 'cpf_cnpj', 'notes', 'source_detail']
const LIMITS = { name: 200, email: 200, city: 200, state: 200, empresa: 200, instagram: 200, cpf_cnpj: 200, source_detail: 200, notes: 5000 }
const MAX_EXTRA_KEYS = 50
const MAX_EXTRA_VALUE = 500

const pad = n => String(n).padStart(2, '0')
export function autoTagName(fileName, now = new Date()) {
  const base = String(fileName || 'planilha').replace(/\.[^.]+$/, '').trim() || 'planilha'
  return `Importado ${pad(now.getDate())}/${pad(now.getMonth() + 1)} – ${base}`.slice(0, 60)
}

const empty = v => v === null || v === undefined || String(v).trim() === ''
const maskPhone = p => {
  let d = String(p || '').replace(/\D/g, '')
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2)
  return d.length < 10 ? '***' : `(${d.slice(0, 2)}) ${d[2]}****-${d.slice(-4)}`
}

function cleanRow(raw) {
  const f = raw?.fields || {}
  const fields = {}
  for (const k of TEXT_FIELDS) if (!empty(f[k])) fields[k] = String(f[k]).trim().slice(0, LIMITS[k])
  const n = Number(f.value_estimated)
  if (f.value_estimated !== undefined && f.value_estimated !== null && Number.isFinite(n)) fields.value_estimated = n
  const tags = Array.isArray(f.tags) ? [...new Set(f.tags.map(t => String(t).trim().slice(0, 60)).filter(Boolean))] : []
  const extra = {}
  for (const [k, v] of Object.entries(raw?.extra || {}).slice(0, MAX_EXTRA_KEYS)) {
    const key = String(k).trim().slice(0, 100)
    if (key && !empty(v)) extra[key] = String(v).trim().slice(0, MAX_EXTRA_VALUE)
  }
  return { row: Number(raw?.row) || 0, phoneRaw: f.phone, fields, tags, extra }
}

function checkDestination(db, accountId, d) {
  const funnel = db.prepare('SELECT * FROM funnels WHERE id = ? AND account_id = ?').get(d?.funnel_id, accountId)
  if (!funnel || (funnel.kind || 'vendas') !== 'vendas') throw new LeadImportError('invalid', 400, 'Escolha um funil de vendas desta conta.')
  const stage = db.prepare('SELECT * FROM funnel_stages WHERE id = ? AND funnel_id = ?').get(d?.stage_id, funnel.id)
  if (!stage) throw new LeadImportError('invalid', 400, 'Escolha uma etapa do funil.')
  const mode = d?.attendant?.mode || 'none'
  let attendants = []
  if (mode === 'one') {
    const u = db.prepare("SELECT id FROM users WHERE id = ? AND account_id = ? AND is_active = 1").get(d.attendant.user_id, accountId)
    if (!u) throw new LeadImportError('invalid', 400, 'Vendedor não encontrado nesta conta.')
    attendants = [u.id]
  } else if (mode === 'split') {
    attendants = db.prepare("SELECT id FROM users WHERE account_id = ? AND role = 'atendente' AND is_active = 1 ORDER BY id").all(accountId).map(u => u.id)
    if (!attendants.length) throw new LeadImportError('invalid', 400, 'A conta não tem vendedores ativos para dividir.')
  } else if (mode !== 'none') throw new LeadImportError('invalid', 400, 'Escolha quem atende.')
  const contactType = d?.contact_type || 'lead'
  if (!CONTACT_TYPES.includes(contactType)) throw new LeadImportError('invalid', 400, 'Tipo de contato inválido.')
  return { funnel, stage, attendants, contactType, autoTag: d?.auto_tag !== false }
}

function existingByKey(db, accountId) {
  const map = new Map()
  const rows = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone IS NOT NULL ORDER BY is_archived ASC, created_at DESC, id DESC').all(accountId)
  for (const l of rows) { const k = phoneCompareKey(l.phone); if (k && !map.has(k)) map.set(k, l) }
  return map
}

// Agrupa por telefone, separa invalidos e decide novo x existente. Nao grava.
function analyze(db, { accountId, rows, destination }) {
  if (!Array.isArray(rows)) throw new LeadImportError('invalid', 400, 'Nenhuma linha recebida.')
  if (rows.length > MAX_ROWS) throw new LeadImportError('too_many', 400, `Máximo de ${MAX_ROWS} linhas por importação. Divida o arquivo em partes.`)
  const dest = checkDestination(db, accountId, destination)
  const skipped = []
  const groups = new Map() // key -> { first, phone }
  for (const raw of rows) {
    const r = cleanRow(raw)
    if (empty(r.phoneRaw)) { skipped.push({ row: r.row, reason: 'sem telefone' }); continue }
    const digits = String(r.phoneRaw).replace(/\D/g, '')
    if (digits.length < 10) { skipped.push({ row: r.row, reason: 'telefone inválido' }); continue }
    const phone = normalizePhone(digits)
    const key = phoneCompareKey(phone)
    const g = groups.get(key)
    if (!g) { groups.set(key, { ...r, phone }); continue }
    // Repetido na planilha: a primeira manda; esta so completa o que faltou
    for (const [k, v] of Object.entries(r.fields)) if (g.fields[k] === undefined) g.fields[k] = v
    for (const [k, v] of Object.entries(r.extra)) if (g.extra[k] === undefined) g.extra[k] = v
    g.tags = [...new Set([...g.tags, ...r.tags])]
    skipped.push({ row: r.row, reason: `repetido na planilha (junto com a linha ${g.row})` })
  }
  const existing = existingByKey(db, accountId)
  const novos = []
  const existentes = []
  for (const [key, g] of groups) {
    const lead = existing.get(key)
    if (lead) existentes.push({ g, lead }); else novos.push(g)
  }
  skipped.sort((a, b) => a.row - b.row)
  return { dest, novos, existentes, skipped }
}

function fillsFor(lead, g) {
  const sets = {}
  for (const [k, v] of Object.entries(g.fields)) if (empty(lead[k])) sets[k] = v
  return sets
}
function parseExtra(lead) {
  try { const v = lead.custom_fields ? JSON.parse(lead.custom_fields) : {}; return v && typeof v === 'object' ? v : {} } catch { return {} }
}
// Chaves novas da planilha somadas as do lead (chave que ja existe nao e trocada); nada novo = null
function mergedExtra(lead, extra) {
  const cur = parseExtra(lead)
  const added = Object.entries(extra).filter(([k]) => cur[k] === undefined)
  return added.length ? { ...cur, ...Object.fromEntries(added) } : null
}

export function planImport(db, { accountId, rows, destination }) {
  const { novos, existentes, skipped } = analyze(db, { accountId, rows, destination })
  let filled = 0
  for (const { g, lead } of existentes) {
    const cur = parseExtra(lead)
    filled += Object.keys(fillsFor(lead, g)).length + Object.keys(g.extra).filter(k => cur[k] === undefined).length
  }
  const sample = list => list.slice(0, 5)
  return {
    new_count: novos.length,
    existing_count: existentes.length,
    filled_fields: filled,
    skipped,
    samples: {
      novos: sample(novos).map(g => ({ name: g.fields.name || '', phone: maskPhone(g.phone) })),
      existentes: sample(existentes).map(({ lead }) => ({ name: lead.name || '', phone: maskPhone(lead.phone) })),
    },
  }
}

function tagId(db, accountId, name) {
  db.prepare('INSERT OR IGNORE INTO tags (account_id, name) VALUES (?, ?)').run(accountId, name)
  return db.prepare('SELECT id FROM tags WHERE account_id = ? AND name = ?').get(accountId, name).id
}

export function applyImport(db, { accountId, rows, destination, fileName, userId = null }) {
  let out
  db.transaction(() => {
    const { dest, novos, existentes, skipped } = analyze(db, { accountId, rows, destination })
    const autoTag = dest.autoTag ? tagId(db, accountId, autoTagName(fileName)) : null
    const linkTag = db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)')
    const tagsOf = g => [...g.tags.map(t => tagId(db, accountId, t)), ...(autoTag ? [autoTag] : [])]
    const defInstance = db.prepare("SELECT id FROM whatsapp_instances WHERE account_id = ? AND status = 'connected' ORDER BY id DESC LIMIT 1").get(accountId)?.id || null
    const ids = []
    novos.forEach((g, i) => {
      const attendantId = dest.attendants.length ? dest.attendants[i % dest.attendants.length] : null
      const instanceId = (attendantId && db.prepare('SELECT primary_instance_id FROM users WHERE id = ?').get(attendantId)?.primary_instance_id) || defInstance
      const f = g.fields
      const id = Number(db.prepare(`
        INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, instance_id, name, phone, email, city, state, empresa, instagram, cpf_cnpj,
          notes, value_estimated, source, source_detail, custom_fields, contact_type, contact_type_origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'importacao', ?, ?, ?, ?)
      `).run(accountId, dest.funnel.id, dest.stage.id, attendantId, instanceId, f.name || null, g.phone, f.email || null,
        f.city ? resolveCity(db, accountId, f.city) : null, f.state || null, f.empresa || null, f.instagram || null, f.cpf_cnpj || null,
        f.notes || null, f.value_estimated ?? null, f.source_detail || String(fileName || '').slice(0, 200) || null,
        Object.keys(g.extra).length ? JSON.stringify(g.extra) : null, dest.contactType, dest.contactType === 'lead' ? null : 'lista').lastInsertRowid)
      db.prepare("INSERT INTO stage_history (lead_id, to_stage_id, trigger_type, triggered_by) VALUES (?, ?, 'import', ?)").run(id, dest.stage.id, userId)
      if (instanceId) {
        db.prepare('UPDATE leads SET last_instance_id = ? WHERE id = ?').run(instanceId, id)
        db.prepare('INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(id, instanceId, attendantId)
      }
      for (const t of tagsOf(g)) linkTag.run(id, t)
      try { ensureStageCadence(db, { leadId: id }) } catch (e) { console.error('[Importar] cadencia:', e.message) }
      ids.push(id)
    })
    for (const { g, lead } of existentes) {
      const sets = fillsFor(lead, g)
      if (sets.city) sets.city = resolveCity(db, accountId, sets.city)
      const ex = mergedExtra(lead, g.extra)
      if (ex) sets.custom_fields = JSON.stringify(ex)
      const cols = Object.keys(sets)
      if (cols.length) {
        db.prepare(`UPDATE leads SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...cols.map(c => sets[c]), lead.id)
      }
      for (const t of tagsOf(g)) linkTag.run(lead.id, t)
      ids.push(lead.id)
    }
    out = { created: novos.length, updated: existentes.length, skipped, tag_id: autoTag, lead_ids: ids }
  })()
  return out
}
```

Notas para quem implementa:
- `fillsFor` só usa chaves de `TEXT_FIELDS` e `value_estimated` (as únicas em `g.fields`), então o `UPDATE` monta colunas só dessa lista fixa (sem SQL vindo do usuário).
- `ensureStageCadence` roda dentro da transação; se falhar só loga (o lead fica sem cadência aberta, como no cadastro manual).
- O teste "erro no meio" depende de o `INSERT` estar dentro do `db.transaction`: o `throw` do trigger desfaz tudo.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/leadImport.test.js` → PASS (5 testes). `npm test` → verde.

- [ ] **Step 5: Commit**

```bash
git add server/services/leadImport/importer.js test/helpers/leadImportDb.js test/leadImport.test.js
git commit -m "feat(importar): previa e gravacao da importacao de leads (so completa existentes, nada automatico)"
```

---

### Task 3: Rotas

**Files:**
- Create: `server/routes/leadImportRouter.js`
- Modify: `server/index.js` (montar antes de `app.use('/api/leads', ...)`, linha ~98)
- Test: `test/leadImportHttp.test.js`

**Interfaces:**
- Consumes: `planImport`, `applyImport`, `LeadImportError` (Tarefa 2).
- Produces: `createLeadImportRouter(db, { broadcast })`; `POST /api/leads/import/preview` e `POST /api/leads/import` com body `{ rows, destination, fileName }`.

- [ ] **Step 1: Testes que falham**

```js
// test/leadImportHttp.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImportTestDb, seedImport } from './helpers/leadImportDb.js'
import { token, peca, withServer } from './helpers/http.js'
import { authenticate, scopeToAccount } from '../server/middleware/auth.js'
import { createLeadImportRouter } from '../server/routes/leadImportRouter.js'

async function comServidor(fn) {
  const db = createImportTestDb(); const s = seedImport(db); const sent = []
  await withServer(app => app.use('/api/leads/import', authenticate, scopeToAccount, createLeadImportRouter(db, { broadcast: (a, e, d) => sent.push([a, e, d]) })),
    ({ base }) => fn({ db, s, base, sent }))
}
const body = s => ({ rows: [{ row: 2, fields: { name: 'Ana', phone: '48999990000' }, extra: {} }], destination: s.dest, fileName: 'lista.csv' })

test('gestor: previa nao grava; importar grava e avisa as telas', async () => {
  await comServidor(async ({ db, s, base, sent }) => {
    const g = token({ id: s.gerenteId, role: 'gerente', accountId: s.accountId })
    const p = await peca(base, { method: 'POST', path: '/api/leads/import/preview', jwtToken: g, body: body(s) })
    assert.equal(p.status, 200); assert.equal(p.body.new_count, 1)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
    const r = await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: g, body: body(s) })
    assert.equal(r.status, 200); assert.equal(r.body.created, 1)
    assert.ok(sent.some(x => x[1] === 'lead:updated' && x[2].bulk === true))
  })
})

test('atendente 403; destino de outra conta 400 e nada gravado', async () => {
  await comServidor(async ({ db, s, base }) => {
    const a = token({ id: s.atendenteId, role: 'atendente', accountId: s.accountId })
    assert.equal((await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: a, body: body(s) })).status, 403)
    const intruso = Number(db.prepare("INSERT INTO users (account_id, name, email, role) VALUES (?, 'X', 'x@b.local', 'gerente')").run(s.otherAccountId).lastInsertRowid)
    const tx = token({ id: intruso, role: 'gerente', accountId: s.otherAccountId })
    const r = await peca(base, { method: 'POST', path: '/api/leads/import', jwtToken: tx, body: body(s) })
    assert.equal(r.status, 400)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM leads WHERE source = 'importacao'").get().n, 0)
  })
})
```

Run: `node --test test/leadImportHttp.test.js` → FAIL (router não existe).

- [ ] **Step 2: Implementar o router**

```js
// server/routes/leadImportRouter.js
// Importar leads por planilha (spec 2026-10-06): previa e gravacao. So gestor/admin.
import { Router, json } from 'express'
import { requireRole } from '../middleware/auth.js'
import { planImport, applyImport, LeadImportError } from '../services/leadImport/importer.js'

export function createLeadImportRouter(db, { broadcast = () => {} } = {}) {
  const router = Router()
  router.use(json({ limit: '10mb' }))
  const manager = requireRole('super_admin', 'gerente')
  const fail = (res, e) => {
    if (e instanceof LeadImportError) return res.status(e.status).json({ error: e.message, code: e.code })
    console.error('[Importar] erro:', e)
    return res.status(500).json({ error: 'Nada foi importado. Tente de novo.' })
  }
  const input = req => ({ accountId: req.accountId, rows: req.body?.rows, destination: req.body?.destination, fileName: String(req.body?.fileName || '').slice(0, 200) })

  router.post('/preview', manager, (req, res) => {
    try { res.json(planImport(db, input(req))) } catch (e) { fail(res, e) }
  })
  router.post('/', manager, (req, res) => {
    try {
      const r = applyImport(db, { ...input(req), userId: req.user.id })
      try { broadcast(req.accountId, 'lead:updated', { bulk: true }) } catch {}
      res.json({ created: r.created, updated: r.updated, skipped: r.skipped, tag_id: r.tag_id })
    } catch (e) { fail(res, e) }
  })
  return router
}
```

`server/index.js`, ANTES da linha `app.use('/api/leads', authenticate, scopeToAccount, leadRoutes)`:

```js
import { createLeadImportRouter } from './routes/leadImportRouter.js'
app.use('/api/leads/import', authenticate, scopeToAccount, createLeadImportRouter(db, { broadcast: broadcastSSE }))
```

(O `express.json` global já tem limite 150 MB; o `json` local não atrapalha.)

- [ ] **Step 3: Rodar e ver passar**

Run: `node --test test/leadImportHttp.test.js` → PASS. `npm test` → verde.

- [ ] **Step 4: Commit**

```bash
git add server/routes/leadImportRouter.js server/index.js test/leadImportHttp.test.js
git commit -m "feat(importar): rotas de previa e importacao de leads (so gestor)"
```

---

### Task 4: Janela "Importar leads" na tela Leads

**Files:**
- Modify: `package.json` / `package-lock.json` (dependências)
- Create: `src/lib/readSheet.ts`
- Create: `src/components/leads/ImportLeadsModal.tsx`
- Modify: `src/lib/api.ts` (chamadas), `src/pages/Leads.tsx` (botão + abrir filtrado pela tag)

**Interfaces:**
- Consumes: Tarefa 1 (`FIELDS`, `uniqueHeaders`, `autoMapping`, `setMapping`, `buildRows`, `decodeText`, `skippedCsv`, `maskPhone`, `MAX_ROWS`); rotas da Tarefa 3.
- Produces:
  - `readSheet(file: File, sheet?: string): Promise<{ sheets: string[]; headers: string[]; data: string[][] }>`
  - `api.ts`: `previewLeadImport(accountId, body)`, `importLeads(accountId, body)`
  - `ImportLeadsModal({ accountId, funnels, users, onClose, onDone(tagId: number|null) })`

- [ ] **Step 1: Dependências**

Run: `npm install papaparse@^5.4.1 read-excel-file@^5.8.0 && npm install -D @types/papaparse@^5.3.14`
Conferir em `package.json` que entraram só essas três. (Só o front usa; o servidor de produção não carrega.)

- [ ] **Step 2: `src/lib/readSheet.ts`**

```ts
import Papa from 'papaparse'
import readXlsxFile, { readSheetNames } from 'read-excel-file'
import { decodeText, uniqueHeaders } from './leadImport.js'

// Le .csv/.xlsx no navegador (spec §3). 1a linha = cabecalho; celulas viram texto.
export async function readSheet(file: File, sheet?: string): Promise<{ sheets: string[]; headers: string[]; data: string[][] }> {
  const name = file.name.toLowerCase()
  const cell = (v: unknown) => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v))
  let table: string[][]
  let sheets: string[] = []
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = decodeText(new Uint8Array(await file.arrayBuffer()))
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    table = parsed.data.map(r => r.map(cell))
  } else if (name.endsWith('.xlsx')) {
    sheets = await readSheetNames(file)
    const rows = await readXlsxFile(file, { sheet: sheet || sheets[0] })
    table = rows.map(r => r.map(cell))
  } else {
    throw new Error('Não consegui ler este arquivo. Salve como .xlsx ou .csv e tente de novo.')
  }
  if (!table.length) throw new Error('A planilha está vazia.')
  const width = Math.max(...table.map(r => r.length))
  const pad = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  return { sheets, headers: uniqueHeaders(pad(table[0])), data: table.slice(1).map(pad) }
}
```

Conferir a API instalada: em `read-excel-file` v5, `readXlsxFile(file, { sheet })` aceita nome ou número e `readSheetNames(file)` existe; se o nome do export mudar na versão instalada, ajustar pelo `node_modules/read-excel-file/index.d.ts`.

- [ ] **Step 3: `api.ts`** (mesmo padrão das outras chamadas do arquivo — copiar como `updateFunnelStages` monta URL com `account_id` e corpo)

```ts
export interface LeadImportBody {
  rows: import('./leadImport').ImportRow[]
  fileName: string
  destination: { funnel_id: number; stage_id: number; attendant: { mode: 'none' | 'one' | 'split'; user_id?: number }; contact_type: string; auto_tag: boolean }
}
export interface LeadImportPreview { new_count: number; existing_count: number; filled_fields: number; skipped: { row: number; reason: string }[]; samples: { novos: { name: string; phone: string }[]; existentes: { name: string; phone: string }[] } }
export const previewLeadImport = (accountId: number, body: LeadImportBody) =>
  apiFetch<LeadImportPreview>(`/api/leads/import/preview?account_id=${accountId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
export const importLeads = (accountId: number, body: LeadImportBody) =>
  apiFetch<{ created: number; updated: number; skipped: { row: number; reason: string }[]; tag_id: number | null }>(`/api/leads/import?account_id=${accountId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
```

- [ ] **Step 4: `ImportLeadsModal.tsx`**

Estado: `step: 1|2|3|4|5`, `file`, `sheets`, `sheet`, `headers`, `data`, `mapping`, `dest`, `preview`, `result`, `busy`, `error`.

- **Passo 1 (Arquivo):** `<input type="file" accept=".xlsx,.csv">` + área de soltar. Ao escolher: `readSheet(file)`; se `data.length > MAX_ROWS` → erro "Este arquivo tem N linhas. O máximo é 5.000 por vez: divida em partes."; senão `mapping = autoMapping(headers)` e vai ao passo 2. Com `sheets.length > 1`: seletor "Aba da planilha" que relê com `readSheet(file, sheet)`. Ajuda: "Primeira linha com o nome das colunas. Ex.: Nome | Celular | Cidade".
- **Passo 2 (Ligar campos):** tabela `Coluna | Exemplos | Vai para`: exemplos = até 3 valores não vazios de `data` naquela coluna (cortados em 30 caracteres); seletor com `FIELDS` (rótulos) usando `setMapping`. Texto em cima: "Diga para onde vai cada coluna. "Informação extra" guarda com o nome da coluna (ex.: Tamanho da loja: 120 m²). "Não importar" ignora." [Próximo] desligado sem `phone` no mapeamento, com aviso "Escolha a coluna do Telefone".
- **Passo 3 (Para onde vão):** Funil (só `funnels` com `kind !== 'recompra'`), Etapa (etapas do funil escolhido; padrão 1ª não final), "Quem atende" (Ninguém / cada vendedor ativo / "Dividir igual entre os vendedores"), Tipo de contato (Lead/Cliente/Revendedor/Interno), checkbox "Marcar todos com a tag "Importado DD/MM – arquivo"" (ligado). Aviso fixo: "Nenhuma mensagem é enviada sozinha. Para mandar em massa, use Disparos depois."
- **Passo 4 (Conferir):** `rows = buildRows(headers, data, mapping)`; `previewLeadImport`. Mostra 3 cartões: **Novos** (N + exemplos), **Já existem** (N, "vamos só completar M informações que estão vazias"), **Não entram** (N + lista "Linha 5: sem telefone", até 20, e [Baixar lista]). [Importar] desligado se `new_count + existing_count === 0`.
- **Passo 5 (Pronto):** `importLeads` → "**X criados**, **Y completados**, **Z não entraram**"; [Baixar os que não entraram] (`skippedCsv(headers, data, skipped)` → Blob `text/csv` → download `nao-importados.csv`); [Ver leads importados] → `onDone(tag_id)`; [Fechar].
- Erros da API aparecem em vermelho no passo atual; [Importar] fica "Importando…" e desligado durante o pedido.
- Classes de janela iguais às de `src/components/ConfirmDialog.tsx` (`modal-overlay`, `modal`, `modal-actions`), `maxWidth: 760`.

- [ ] **Step 5: Botão na tela Leads**

`src/pages/Leads.tsx`, ao lado de [Exportar] (~linha 193), só para gestor/admin:

```tsx
{(user?.role === 'gerente' || user?.role === 'super_admin') && (
  <button className="btn btn-secondary btn-sm" onClick={() => setShowImport(true)} title="Subir uma lista de leads (.xlsx ou .csv). Ex.: lista de contatos de uma feira.">
    <Upload size={14} /> Importar
  </button>
)}
```

Estado `const [showImport, setShowImport] = useState(false)`; render do modal com `funnels`/`users` que a tela já carrega (usar os mesmos estados da página); `onDone={tagId => { setShowImport(false); if (tagId) { setTagFilter(String(tagId)); setPage(1) } loadLeads() }}`. Se a lista de tags do filtro vem carregada uma vez, recarregar as tags também (procurar onde `tags` é buscado em `Leads.tsx` e chamar de novo).

- [ ] **Step 6: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS"` → 16 (os antigos). `npm run build` → ok; depois `git checkout -- dist && git clean -fdq dist`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/readSheet.ts src/components/leads/ImportLeadsModal.tsx src/lib/api.ts src/pages/Leads.tsx
git commit -m "feat(importar): janela de importar leads em 4 passos na tela Leads"
```

---

### Task 5: "Informações extras" na ficha e no Chat + conferência no navegador

**Files:**
- Create: `src/components/leads/ExtraInfoCard.tsx`
- Modify: `src/pages/Chat.tsx` (aba Info, depois do cartão de contato ~linha 2571), `src/pages/LeadDetail.tsx` (junto dos dados do contato)

**Interfaces:**
- Consumes: `PUT /api/leads/:id` com `{ custom_fields }` (já existe, `server/routes/leads.js:605`) — procurar em `src/lib/api.ts` a função que faz esse PUT (ex.: `updateLead`) e usar.
- Produces: `ExtraInfoCard({ lead: { id: number; custom_fields?: string | Record<string,string> | null }, accountId: number, canEdit: boolean, onSaved(fields) })`

- [ ] **Step 1: Componente**

- Lê `custom_fields` (string JSON ou objeto; inválido = `{}`); sem chaves → não renderiza nada.
- Cartão "Informações extras" (`PanelTitle` igual aos outros cartões do Chat, ajuda: "Informações que vieram de uma planilha importada ou de um formulário. Ex.: Tamanho da loja: 120 m².") com linhas `chave: valor`.
- Lápis (se `canEdit`): vira inputs por valor + [×] para tirar a linha + [Salvar]/[Cancelar]; salva com o PUT existente (`custom_fields: objeto`), chama `onSaved`.

- [ ] **Step 2: Montar**

- Chat, aba Info: `<ExtraInfoCard lead={lead} accountId={accountId} canEdit onSaved={f => setLead(p => (p && p.id === lead.id ? { ...p, custom_fields: JSON.stringify(f) } : p))} />` logo depois de `{renderContatoCard(lead)}`. Conferir se o tipo `Lead` em `src/lib/api.ts` tem `custom_fields`; se não, acrescentar `custom_fields?: string | null`.
- LeadDetail: mesmo componente junto do bloco de dados do contato (procurar o cartão com e-mail/telefone).

- [ ] **Step 3: Tipos, testes, build**

`npx tsc --noEmit` → 16; `npm test` → verde; `npm run build` ok; restaurar `dist`.

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/ExtraInfoCard.tsx src/pages/Chat.tsx src/pages/LeadDetail.tsx src/lib/api.ts
git commit -m "feat(leads): informacoes extras da planilha na ficha e no Chat"
```

- [ ] **Step 5: Conferência no navegador** (CRM local ligado, dono faz login)

1. Montar dois arquivos de teste no scratchpad (não commitar): `teste.xlsx` não é preciso montar à mão — usar um CSV `;` salvo em Latin-1 com `Nome;Celular;Cidade;Tamanho da loja;Lixo` e 6 linhas (1 telefone já existente na conta, 1 repetido, 1 sem telefone, 1 com acento "João"); e um `.xlsx` gerado com o próprio Excel do dono se ele quiser testar.
2. Leads → [Importar] → escolher o CSV → conferir sugestões (Celular→Telefone, Tamanho da loja→Informação extra), trocar "Lixo" para "Não importar".
3. Destino: etapa Novo Lead, Dividir entre vendedores. Prévia: números batem (novos/existentes/não entram), "João" com acento certo.
4. Importar → resumo → [Baixar os que não entraram] abre no Excel com a coluna Motivo → [Ver leads importados] mostra a lista filtrada pela tag.
5. Abrir um importado no Chat: aba Info mostra "Informações extras: Tamanho da loja"; nenhuma mensagem foi enviada; o "Próximo passo" mostra a cadência da etapa.
6. O lead que já existia: nome/e-mail antigos mantidos, cidade preenchida se estava vazia.
7. Atualizar a memória (`retomar-crm.md`).

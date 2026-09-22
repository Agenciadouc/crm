# Telas agrupadas (Integrações em 4 cards, agente em 4 abas, sem duplicidades) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a Fase 4 "Telas agrupadas" do spec de provedores: Integrações em 4 cards (WhatsApp com escolha de provedor por número UzAPI/Evolution e QR ou "Abrir painel da UzAPI"; Entrada de leads; Meta; IA), editor do agente de IA de 8 para 4 abas (Geral / Perfil / Atendimento / Resultados) e as três duplicidades resolvidas (follow-up do agente em 1 lugar, 1 "Primeira mensagem" por número, 1 horário de atendimento por número).

**Architecture:** Quase tudo é front (React 19 + Vite, `src/`). A página `src/pages/Integrations.tsx` (1.341 linhas) vira uma casca com 4 "cards" navegáveis (`?card=whatsapp|leads|meta|ia`), cada um num arquivo em `src/pages/integrations/`. As mensagens automáticas do número (primeira mensagem + horário + ausência) passam a ser um único modal, `src/components/NumberSettingsModal.tsx`. As regras de junção dos dados antigos (quatro textos, duas agendas, lista de provedores, formato do QR) ficam em módulos **JS puros** com `.d.ts` ao lado (`src/lib/numberSettings.js`, `src/lib/whatsappProviders.js`) para poderem ser testados no `node --test` sem compilar TypeScript. No servidor entram só três mudanças pequenas, cada uma com uma função pura testada: variáveis unificadas nos textos de primeira mensagem, gravação do horário único nas duas colunas e trava de edição do follow-up do agente fora do agente. **Nenhuma migration de banco**: os dados de hoje continuam onde estão e são lidos/gravados pelas telas novas.

**Tech Stack:** React 19, TypeScript 5.8, Vite 4.5 (base `/crm/`), react-router-dom 7, lucide-react; Node 20 local (produção Node 16), Express 4, better-sqlite3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-provedor-whatsapp-design.md` §5 (Telas agrupadas) e §9 (Fase 4). Contexto da UzAPI: `docs/superpowers/specs/2026-09-21-provedor-uzapi-design.md` §4.4, §4.6 e §5.

**Depende de:** o plano do servidor da UzAPI (`docs/superpowers/plans/2026-09-21-provedor-uzapi.md`) **já executado**. Este plano consome o contrato abaixo e não o implementa.

## Global Constraints

- Branch: `feat/provedor-uzapi`. **Não trocar de branch. Não dar push. Não fazer deploy.**
- Node local: Node 20 em `C:\nvm4w\nodejs`. No Git Bash, rodar antes de qualquer `npm`/`node`: `export PATH="/c/nvm4w/nodejs:$PATH"`.
- **Nunca** commitar `dist/`, `vite.config.ts`, `package-lock.json`, `migrate-to-routines.mjs`, `seed-demo.mjs`, `seed-social-demo.mjs` (estão modificados/soltos localmente e não são deste trabalho). Sempre `git add` com caminhos explícitos.
- Sem dependência nova no `package.json` (produção é Node 16 / CentOS 7).
- Commits em português, prefixo `feat:` / `fix:` / `refactor:` / `test:`, terminando com a linha `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Textos de tela em **PT-BR com acentuação correta**; código (nomes de variáveis, funções, arquivos) em inglês como o resto do repo. Sem emoji em código novo.
- Multi-tenant: toda chamada de API do front leva `account_id` quando a função existente já leva; nenhuma query nova de servidor sem filtro por conta.
- Contrato com o plano do servidor (usar exatamente; prefixo real das rotas: `/api/integrations`):
  - `GET /api/integrations/whatsapp` traz `provider` em cada instância (`'uzapi' | 'evolution'`).
  - `GET /api/integrations/whatsapp/providers` → lista de provedores disponíveis.
  - `POST /api/integrations/whatsapp` aceita `provider`.
  - `POST /api/integrations/whatsapp/:id/qrcode` → `{ qr_code, status, panel_url? }`.
- Testes: `npm test` (= `node --test test/`) tem de continuar 100% verde. Não existe teste de componente React no repo; telas são verificadas por `npx tsc --noEmit -p .` (sem erro **novo** — ver Task 0), `npm run build` e roteiro manual no navegador em `http://localhost:5175/crm/`.
- Login local de teste: `admin@drosagencia.com.br` / `dros2026` (banco local; nunca usar o de produção).

## Decisões deste plano (o dono precisa confirmar as marcadas com ⚑)

1. ⚑ **Follow-up do agente — fica no agente.** O follow-up de inatividade de um agente (linha de `follow_ups` com `agent_id`) passa a ser editado **só** no editor do agente, aba **Atendimento**. A página **Follow-ups** mostra essas linhas só para consulta, com o botão "Editar no agente"; o servidor recusa (409) editar/apagar por `/api/follow-ups/:id` uma linha que pertence a um agente existente. Os follow-ups **por etapa** (inatividade sem agente) e as **sequências manuais** continuam na página Follow-ups — contas sem agente de IA dependem deles. (O spec diz "a página Follow-ups segue só para sequências manuais"; tirar também a inatividade por etapa apagaria um recurso usado por quem não tem IA, por isso ela fica — ⚑ confirmar.)
2. ⚑ **Primeira mensagem — um campo por número.** O texto único fica em `whatsapp_instances.first_msg_template` (quando "lead de formulário/planilha entregue a um vendedor deste número" estiver marcado) **e** em `instance_auto_messages.greeting_text` (sempre, para não perder o texto; `greeting_enabled` = "lead novo que manda a primeira mensagem"). Se um número tinha os dois textos diferentes, a tela mostra os dois e o dono escolhe antes de salvar; nada é apagado sem ele clicar em Salvar.
   - `funnels.first_msg_template` (mensagem própria do funil, que hoje vale no lugar da do número e **não tem tela**) continua sendo lida; a tela do número lista os funis que têm mensagem própria e oferece "Usar a deste número" (apaga só a do funil, com confirmação). ⚑ Alternativa: apagar todas as mensagens de funil de uma vez — não recomendado sem ver as contas.
   - A "saudação por IA para leads de planilha" (`ai_agents.send_welcome_for_sheets_leads`) continua no agente (aba Geral), porque é texto gerado pela IA e não um campo; a tela do número avisa quando algum agente ativo a usa.
   - Para um mesmo texto funcionar nos dois caminhos, os dois "tradutores" de variáveis passam a aceitar as mesmas variáveis (Task 1). Sem isso, `{{vendedor}}` iria literal para o lead na saudação.
3. ⚑ **Horário de atendimento — um por número.** A tela grava o mesmo horário em `instance_auto_messages.away_schedule_json` (ausência) e, se a caixa "Segurar envios automáticos fora deste horário" estiver ligada, em `whatsapp_instances.business_hours_json` (trava anti-bloqueio, que hoje não tem tela). Desligada, `business_hours_json` volta a `NULL` (24 horas, que é o que quase todas as contas têm hoje). A caixa vem desligada para quem não tinha trava — nada muda no envio de ninguém sem ação do dono.
   - Diferença que continua valendo (⚑ decidir se muda depois): em dia **sem horário**, a trava segura os envios o dia todo, mas a **ausência não é enviada** (regra de `shouldSendAway`, colocada de propósito para evitar ausência disparando toda hora). A tela explica isso ao lado do horário.
4. ⚑ **Provedor padrão ao conectar número:** Evolution fica pré-selecionada (princípio 1 do spec: "Evolution continua sendo o padrão"). A escolha só aparece se o servidor disser que a UzAPI está disponível.
5. **Origem da chave da IA** (cliente / Dros, só super_admin) sai do editor do agente e vai para o card **IA** de Integrações, como o spec pede ("Chave de IA da conta e origem da chave").
6. **Não entram nesta fase (não existem no código hoje):** "Sugestões de melhoria" na aba Resultados (rotina semanal do Copiloto, spec do Copiloto §3.6, não construída) e "status da conexão do App Meta" no card Meta (depende da Fase 3, API Oficial). ⚑ Confirmar que ficam para depois.
7. **Sem migration.** Todas as colunas usadas já existem (`first_msg_template`, `greeting_text`, `greeting_enabled`, `away_schedule_json`, `business_hours_json`, `follow_ups.agent_id`, `funnels.first_msg_template`). As ~24 contas de produção continuam com a configuração que têm até alguém abrir a tela e salvar.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `server/services/messageTemplateVars.js` | Criar | Tradução de variáveis (`{{primeiro_nome}}` etc.) igual para saudação/ausência e primeira mensagem |
| `server/services/autoMessages.js` | Modificar | `applyVars` passa a usar `applyAutoMessageVars` |
| `server/services/leadHandoff.js` | Modificar | `renderTemplate` local sai; usa `renderHandoffTemplate` |
| `server/services/serviceHours.js` | Criar | Decide se/como gravar `business_hours_json` a partir do corpo do PUT |
| `server/routes/integrations.js` | Modificar | GET/PUT `/whatsapp/:id/auto-messages` leem/gravam o horário único |
| `server/services/followUpOwnership.js` | Criar | Trava de edição do follow-up que pertence a agente |
| `server/routes/follow-ups.js` | Modificar | PUT/DELETE `/:id` respeitam a trava |
| `src/lib/numberSettings.js` + `.d.ts` | Criar | Regras puras: primeira mensagem, horário, validação |
| `src/lib/whatsappProviders.js` + `.d.ts` | Criar | Regras puras: nomes/lista de provedores, imagem do QR |
| `src/lib/api.ts` | Modificar | `provider`, `fetchWhatsAppProviders`, `refreshWhatsAppQR` novo formato, `updateFunnelFirstMessage`, campos novos do auto-messages |
| `src/components/NumberSettingsModal.tsx` | Criar | Modal "Mensagens do número": Primeira mensagem / Horário de atendimento / Ausência |
| `src/components/InstanceAutoMessagesModal.tsx` | Apagar | Substituído pelo modal acima |
| `src/pages/integrations/LeadIntakeCard.tsx` | Criar | Roteamento de formulários + Google Planilhas |
| `src/pages/integrations/MetaCard.tsx` | Criar | Pixel / Conversions API |
| `src/pages/integrations/AiCard.tsx` | Criar | Chave Anthropic + limite + origem da chave |
| `src/pages/integrations/WhatsAppCard.tsx` | Criar | Números, escolha de provedor, QR/painel, credenciais Evolution recolhidas |
| `src/pages/Integrations.tsx` | Reescrever | Casca com os 4 cards |
| `src/components/AgentEditorModal.tsx` | Modificar | 8 → 4 abas; entrevista na aba Perfil; sai a origem da chave |
| `src/pages/Agents.tsx` | Modificar | Abre o editor por URL (`?editar=ID&aba=atendimento`); aviso aponta para Integrações → IA |
| `src/pages/FollowUps.tsx` | Modificar | Linhas de agente só para consulta, com "Editar no agente" |
| `test/messageTemplateVars.test.js`, `test/serviceHours.test.js`, `test/followUpOwnership.test.js`, `test/numberSettings.test.js`, `test/whatsappProviders.test.js` | Criar | Testes das funções puras |

---

### Task 0: Pré-checagem (sem commit)

**Files:** nenhum.

**Interfaces:**
- Consumes: o plano do servidor da UzAPI executado.
- Produces: o número de base de erros do `tsc` (usado em todas as tasks de front) e a confirmação do formato real das duas rotas do contrato.

- [ ] **Step 1: Conferir branch e estado**

Run:
```bash
cd /c/Users/RTX-2060/Documents/crm && git branch --show-current && git status --short
```
Expected: `feat/provedor-uzapi`; na lista, só os arquivos locais conhecidos (`dist/...`, `vite.config.ts`, `*.mjs`). Se houver outra coisa modificada, parar e perguntar.

- [ ] **Step 2: Conferir que o servidor da UzAPI está pronto**

Run:
```bash
cd /c/Users/RTX-2060/Documents/crm && grep -n "whatsapp/providers\|panel_url" server/routes/integrations.js
```
Expected: aparecem a rota `router.get('/whatsapp/providers'` e o `panel_url` na rota do QR. Se não aparecerem, **parar**: o plano do servidor ainda não foi executado.

- [ ] **Step 3: Anotar o formato real das duas rotas**

Abrir `server/routes/integrations.js` e ler o `res.json(...)` de `GET /whatsapp/providers` e de `POST /whatsapp/:id/qrcode`. A Task 4 aceita estes formatos para a lista de provedores: array de textos (`['evolution','uzapi']`), `{ providers: [...] }` com textos, ou com objetos que tenham `id`, `provider`, `key` ou `name`. Para o QR aceita `{ qr_code, status, panel_url }` e também o formato antigo `{ instance }`. Se o servidor usar outro formato, acrescentar um caso ao teste `normalizeProviders` da Task 4 antes de implementar.

- [ ] **Step 4: Registrar a base de testes e de tipos**

Run:
```bash
cd /c/Users/RTX-2060/Documents/crm && export PATH="/c/nvm4w/nodejs:$PATH" && npm test 2>&1 | tail -5 && npx tsc --noEmit -p . 2>&1 | grep -c "error TS"
```
Expected: `# fail 0` e um número de erros do `tsc` (em 22/09/2026, antes do plano do servidor, eram **15**, todos antigos: `import.meta.env`, `Funnels.tsx`, `Messages.tsx`, `TransferRequests.tsx`, `AgentEditorModal.tsx` linhas do `updateHandoffRule`). Anotar esse número como **BASE_TSC**. Em todas as tasks, "tsc sem erro novo" = a contagem continua igual a BASE_TSC.

---

### Task 1: Variáveis iguais na saudação e na primeira mensagem (servidor)

Hoje a saudação/ausência (`applyVars` em `server/services/autoMessages.js`) entende `{{name}} {{primeiro_nome}} {{empresa}} {{cidade}} {{instance}} {{atendente}} {{atendente_nome}}`, e a primeira mensagem de lead entregue a vendedor (`renderTemplate` em `server/services/leadHandoff.js`) entende `{{primeiro_nome}} {{nome}} {{vendedor}} {{vendedor_primeiro_nome}} {{cidade}} {{phone}} {{etapa}} {{funil}}`. Como a tela nova grava **um** texto nos dois lugares, os dois passam a entender a união. Comportamento de cada variável antiga não muda.

**Files:**
- Create: `server/services/messageTemplateVars.js`
- Modify: `server/services/autoMessages.js` (função `applyVars`, linhas 5-24 hoje)
- Modify: `server/services/leadHandoff.js` (função `renderTemplate`, linhas 25-36 hoje; objeto `vars` e a chamada em `notifyAndOpenLead`)
- Test: `test/messageTemplateVars.test.js`

**Interfaces:**
- Produces: `applyAutoMessageVars(text: string|null, lead: object, instance: object): string|null` e `renderHandoffTemplate(tpl: string|null, vars: object): string` (exportadas de `server/services/messageTemplateVars.js`). A Task 6 documenta na tela a lista de variáveis: `{{primeiro_nome}} {{nome}} {{empresa}} {{cidade}} {{atendente}} {{atendente_nome}}` (valem nos dois caminhos) e `{{etapa}} {{funil}}` (só para lead de formulário/planilha).

- [ ] **Step 1: Escrever o teste que falha**

Create `test/messageTemplateVars.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAutoMessageVars, renderHandoffTemplate } from '../server/services/messageTemplateVars.js'

const lead = { name: 'Maria Souza', phone: '5511999990000', empresa: 'ACME', city: 'Campinas', attendant_name: 'Hemily Vitoria' }
const inst = { instance_name: 'Comercial' }

test('saudacao continua entendendo as variaveis antigas dela', () => {
  const t = applyAutoMessageVars('Oi {{primeiro_nome}} ({{name}}) da {{empresa}} em {{cidade}} - {{instance}} - {{atendente}} / {{atendente_nome}} / {{first_name}} / {{attendant}} / {{phone}}', lead, inst)
  assert.equal(t, 'Oi Maria (Maria Souza) da ACME em Campinas - Comercial - Hemily Vitoria / Hemily / Maria / Hemily Vitoria / 5511999990000')
})

test('saudacao passa a entender as variaveis da primeira mensagem', () => {
  const t = applyAutoMessageVars('{{nome}} | {{vendedor}} | {{vendedor_primeiro_nome}} | [{{etapa}}{{funil}}]', lead, inst)
  assert.equal(t, 'Maria Souza | Hemily Vitoria | Hemily | []')
})

test('saudacao sem nome usa Cliente e sem atendente usa nosso time', () => {
  assert.equal(applyAutoMessageVars('{{primeiro_nome}} {{nome}} {{vendedor}} {{atendente_nome}}', {}, inst), 'Cliente Cliente nosso time nosso time')
})

test('saudacao vazia volta como veio', () => {
  assert.equal(applyAutoMessageVars('', lead, inst), '')
  assert.equal(applyAutoMessageVars(null, lead, inst), null)
})

const vars = {
  lead_name: 'Maria Souza', lead_first_name: 'Maria', user_name: 'Hemily Vitoria', user_first_name: 'Hemily',
  city: 'Campinas', phone: '5511', stage_name: 'Novo', funnel_name: 'Vendas', empresa: 'ACME', instance_name: 'Comercial',
}

test('primeira mensagem continua entendendo as variaveis antigas dela', () => {
  assert.equal(
    renderHandoffTemplate('{{primeiro_nome}} {{nome}} {{vendedor}} {{vendedor_primeiro_nome}} {{cidade}} {{phone}} {{etapa}} {{funil}}', vars),
    'Maria Maria Souza Hemily Vitoria Hemily Campinas 5511 Novo Vendas',
  )
})

test('primeira mensagem passa a entender as variaveis da saudacao', () => {
  assert.equal(
    renderHandoffTemplate('{{name}} {{atendente}} {{atendente_nome}} {{empresa}} {{instance}} {{first_name}}', vars),
    'Maria Souza Hemily Vitoria Hemily ACME Comercial Maria',
  )
})

test('primeira mensagem vazia volta texto vazio', () => {
  assert.equal(renderHandoffTemplate(null, vars), '')
  assert.equal(renderHandoffTemplate('', vars), '')
})

test('primeira mensagem sem dados deixa as variaveis em branco (como hoje)', () => {
  assert.equal(renderHandoffTemplate('Oi {{primeiro_nome}}!', {}), 'Oi !')
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `export PATH="/c/nvm4w/nodejs:$PATH" && node --test test/messageTemplateVars.test.js`
Expected: FAIL com `Cannot find module ... messageTemplateVars.js`.

- [ ] **Step 3: Implementar o módulo**

Create `server/services/messageTemplateVars.js`:
```js
// Traducao de variaveis dos textos automaticos do numero.
// Um mesmo texto ("Primeira mensagem" da tela de Integracoes) e gravado na saudacao
// (instance_auto_messages.greeting_text) e na primeira mensagem de lead entregue a vendedor
// (whatsapp_instances.first_msg_template). Por isso os dois caminhos entendem as mesmas variaveis.
// Modulo puro (sem db) para rodar no node --test.

function firstName(s) {
  if (!s) return ''
  return String(s).split(' ')[0] || String(s)
}

// Saudacao e ausencia (autoMessages.js). Sem etapa/funil neste caminho: ficam em branco.
export function applyAutoMessageVars(text, lead, instance) {
  if (!text) return text
  const leadName = lead?.name || 'Cliente'
  const leadFirst = firstName(lead?.name) || 'Cliente'
  const attendant = lead?.attendant_name || 'nosso time'
  const attendantFirst = firstName(lead?.attendant_name) || 'nosso time'
  return String(text)
    .replace(/\{\{name\}\}/g, leadName)
    .replace(/\{\{nome\}\}/g, leadName)
    .replace(/\{\{primeiro_nome\}\}/g, leadFirst)
    .replace(/\{\{first_name\}\}/g, leadFirst)
    .replace(/\{\{phone\}\}/g, lead?.phone || '')
    .replace(/\{\{empresa\}\}/g, lead?.empresa || '')
    .replace(/\{\{cidade\}\}/g, lead?.city || '')
    .replace(/\{\{instance\}\}/g, instance?.instance_name || '')
    .replace(/\{\{atendente\}\}/g, attendant)
    .replace(/\{\{attendant\}\}/g, attendant)
    .replace(/\{\{vendedor\}\}/g, attendant)
    .replace(/\{\{atendente_nome\}\}/g, attendantFirst)
    .replace(/\{\{vendedor_primeiro_nome\}\}/g, attendantFirst)
    .replace(/\{\{etapa\}\}/g, '')
    .replace(/\{\{funil\}\}/g, '')
}

// Primeira mensagem de lead entregue a vendedor (leadHandoff.js). Mantem o comportamento
// antigo: variavel sem dado vira texto vazio.
export function renderHandoffTemplate(tpl, vars = {}) {
  if (!tpl) return ''
  return String(tpl)
    .replace(/\{\{primeiro_nome\}\}/g, vars.lead_first_name || '')
    .replace(/\{\{first_name\}\}/g, vars.lead_first_name || '')
    .replace(/\{\{nome\}\}/g, vars.lead_name || '')
    .replace(/\{\{name\}\}/g, vars.lead_name || '')
    .replace(/\{\{vendedor\}\}/g, vars.user_name || '')
    .replace(/\{\{atendente\}\}/g, vars.user_name || '')
    .replace(/\{\{vendedor_primeiro_nome\}\}/g, vars.user_first_name || '')
    .replace(/\{\{atendente_nome\}\}/g, vars.user_first_name || '')
    .replace(/\{\{cidade\}\}/g, vars.city || '')
    .replace(/\{\{empresa\}\}/g, vars.empresa || '')
    .replace(/\{\{phone\}\}/g, vars.phone || '')
    .replace(/\{\{etapa\}\}/g, vars.stage_name || '')
    .replace(/\{\{funil\}\}/g, vars.funnel_name || '')
    .replace(/\{\{instance\}\}/g, vars.instance_name || '')
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/messageTemplateVars.test.js`
Expected: PASS (8 testes).

- [ ] **Step 5: Ligar em `autoMessages.js`**

Em `server/services/autoMessages.js`, trocar o bloco que vai de `// Aplica variaveis no texto da auto-mensagem` até o fim da função `applyVars` (a função `firstName` local e a `applyVars` inteira) por:
```js
import { applyAutoMessageVars } from './messageTemplateVars.js'

// Aplica variaveis no texto da auto-mensagem (mesma lista da "Primeira mensagem" do numero)
export function applyVars(text, lead, instance) {
  return applyAutoMessageVars(text, lead, instance)
}
```
(o `import` pode ficar junto dos outros `import` do topo; o `sendAutoMessage` continua chamando `applyVars(text, lead, instance)` sem mudança).

- [ ] **Step 6: Ligar em `leadHandoff.js`**

Em `server/services/leadHandoff.js`:
1. Apagar a função local `function renderTemplate(tpl, vars) { ... }` inteira (hoje linhas 25-36).
2. Acrescentar no topo, junto dos imports: `import { renderHandoffTemplate } from './messageTemplateVars.js'`
3. No objeto `const vars = { ... }` dentro de `notifyAndOpenLead`, acrescentar a linha `empresa: lead.empresa || '',` logo depois de `city: lead.city || '',`.
4. Trocar `const text = renderTemplate(tpl, vars)` por:
```js
          const text = renderHandoffTemplate(tpl, { ...vars, instance_name: vendInst.instance_name || '' })
```

Run: `grep -n "renderTemplate" server/services/leadHandoff.js`
Expected: nenhuma linha (a função local não é usada em mais nenhum lugar do arquivo).

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

- [ ] **Step 8: Commit**

```bash
git add server/services/messageTemplateVars.js server/services/autoMessages.js server/services/leadHandoff.js test/messageTemplateVars.test.js
git commit -m "feat: saudacao e primeira mensagem entendem as mesmas variaveis

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Horário de atendimento único por número (servidor)

A tela nova (Task 6) manda no PUT de auto-mensagens o horário em `away_schedule_json` e o campo novo `hold_sends_outside_hours` (booleano). Ligado → o mesmo horário vai para `whatsapp_instances.business_hours_json` (a trava anti-bloqueio do `sender.js`, que hoje não tem tela). Desligado → `business_hours_json = NULL` (24 horas). **Ausente no corpo → a trava não é tocada** (chamadas antigas continuam iguais). O GET passa a devolver `business_hours_json` para a tela montar o estado.

**Files:**
- Create: `server/services/serviceHours.js`
- Modify: `server/routes/integrations.js` (rotas `GET /whatsapp/:id/auto-messages` e `PUT /whatsapp/:id/auto-messages`)
- Test: `test/serviceHours.test.js`

**Interfaces:**
- Produces: `businessHoursUpdate(body: object|null, scheduleStr: string|null): { touch: boolean, value: string|null, error?: string }`.
- Produces (HTTP): `GET /api/integrations/whatsapp/:id/auto-messages` → `{ config: { ...colunas de instance_auto_messages, business_hours_json: string|null } }`; `PUT` aceita `hold_sends_outside_hours?: boolean` e devolve o mesmo formato do GET.

- [ ] **Step 1: Escrever o teste que falha**

Create `test/serviceHours.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { businessHoursUpdate } from '../server/services/serviceHours.js'

const H = '{"mon":[{"start":"09:00","end":"18:00"}],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}'

test('sem o campo no corpo, nao mexe na trava (chamadas antigas)', () => {
  assert.deepEqual(businessHoursUpdate({ away_text: 'x' }, H), { touch: false, value: null })
})

test('corpo nulo nao mexe na trava', () => {
  assert.deepEqual(businessHoursUpdate(null, null), { touch: false, value: null })
})

test('segurar envios grava o mesmo horario da ausencia', () => {
  assert.deepEqual(businessHoursUpdate({ hold_sends_outside_hours: true }, H), { touch: true, value: H })
})

test('desligado volta a trava para 24 horas (NULL)', () => {
  assert.deepEqual(businessHoursUpdate({ hold_sends_outside_hours: false }, H), { touch: true, value: null })
})

test('segurar sem horario e recusado', () => {
  const r = businessHoursUpdate({ hold_sends_outside_hours: true }, null)
  assert.equal(r.touch, false)
  assert.match(r.error, /horário de atendimento/)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/serviceHours.test.js`
Expected: FAIL com `Cannot find module ... serviceHours.js`.

- [ ] **Step 3: Implementar**

Create `server/services/serviceHours.js`:
```js
// Horario de atendimento unico por numero (tela Integracoes > WhatsApp > Mensagens do numero).
// A tela grava o horario na ausencia (instance_auto_messages.away_schedule_json) e, se pedido,
// tambem na trava anti-bloqueio (whatsapp_instances.business_hours_json, lida pelo sender.js).
// Sem hold_sends_outside_hours no corpo, a trava fica como esta (compatibilidade).
export function businessHoursUpdate(body, scheduleStr) {
  if (!body || body.hold_sends_outside_hours === undefined) return { touch: false, value: null }
  if (!body.hold_sends_outside_hours) return { touch: true, value: null }
  if (!scheduleStr) {
    return { touch: false, value: null, error: 'Para segurar os envios fora do horário, preencha o horário de atendimento.' }
  }
  return { touch: true, value: scheduleStr }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/serviceHours.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Ligar nas rotas**

Em `server/routes/integrations.js`:
1. Acrescentar junto dos imports do topo: `import { businessHoursUpdate } from '../services/serviceHours.js'`
2. Trocar o corpo da rota `router.get('/whatsapp/:id/auto-messages', ...)` por:
```js
router.get('/whatsapp/:id/auto-messages', (req, res) => {
  const instance = getOwnedInstance(req, res)
  if (!instance) return
  const cfg = db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  const base = cfg || { instance_id: instance.id, greeting_enabled: 0, away_enabled: 0, away_mode: 'manual' }
  res.json({ config: { ...base, business_hours_json: instance.business_hours_json || null } })
})
```
3. Na rota `router.put('/whatsapp/:id/auto-messages', ...)`, logo **depois** do bloco `// Valida JSON schedule` (onde `scheduleStr` é calculado) e **antes** de `const existing = ...`, inserir:
```js
  const bh = businessHoursUpdate(req.body, scheduleStr)
  if (bh.error) return res.status(400).json({ error: bh.error })
```
4. Na mesma rota, trocar as duas últimas linhas
```js
  const cfg = db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  res.json({ config: cfg })
```
por:
```js
  if (bh.touch) {
    db.prepare("UPDATE whatsapp_instances SET business_hours_json = ?, updated_at = datetime('now') WHERE id = ?").run(bh.value, instance.id)
  }
  const cfg = db.prepare('SELECT * FROM instance_auto_messages WHERE instance_id = ?').get(instance.id)
  const fresh = db.prepare('SELECT business_hours_json FROM whatsapp_instances WHERE id = ?').get(instance.id)
  res.json({ config: { ...cfg, business_hours_json: fresh?.business_hours_json || null } })
```

- [ ] **Step 6: Conferir o carregamento do módulo e a suíte**

Run: `node -e "import('./server/services/serviceHours.js').then(m => console.log(typeof m.businessHoursUpdate))" && npm test 2>&1 | tail -5`
Expected: `function` e `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add server/services/serviceHours.js server/routes/integrations.js test/serviceHours.test.js
git commit -m "feat: horario de atendimento unico grava ausencia e trava de envios

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Follow-up do agente só se edita no agente (servidor)

O follow-up de inatividade do agente mora em `follow_ups` com `agent_id` e é gravado por `PUT /api/agents/:id/inactivity-followup`. Hoje a página Follow-ups também deixa editar/apagar essa linha por `PUT/DELETE /api/follow-ups/:id` — o segundo lugar. A trava recusa isso enquanto o agente existir (se o agente sumiu, `ON DELETE CASCADE` já apaga a linha; a checagem de existência cobre bancos antigos).

**Files:**
- Create: `server/services/followUpOwnership.js`
- Modify: `server/routes/follow-ups.js` (rotas `router.put('/:id'` e `router.delete('/:id'`)
- Test: `test/followUpOwnership.test.js`

**Interfaces:**
- Produces: `agentFollowUpLock(fu: { agent_id?: number|null }, agentExists: boolean): null | { status: 409, error: string, agent_id: number }` e `AGENT_FOLLOWUP_LOCKED_MSG: string`.
- Produces (HTTP): `PUT/DELETE /api/follow-ups/:id` de linha com agente → `409 { error, agent_id }`. A Task 10 usa `agent_id` para o link "Editar no agente".

- [ ] **Step 1: Escrever o teste que falha**

Create `test/followUpOwnership.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFollowUpLock, AGENT_FOLLOWUP_LOCKED_MSG } from '../server/services/followUpOwnership.js'

test('follow-up comum (sem agente) nao trava', () => {
  assert.equal(agentFollowUpLock({ id: 1, agent_id: null }, false), null)
  assert.equal(agentFollowUpLock({ id: 1 }, false), null)
})

test('follow-up de agente existente trava com 409 e diz onde editar', () => {
  assert.deepEqual(agentFollowUpLock({ id: 1, agent_id: 7 }, true), { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: 7 })
  assert.match(AGENT_FOLLOWUP_LOCKED_MSG, /Atendimento/)
})

test('follow-up de agente que nao existe mais nao trava', () => {
  assert.equal(agentFollowUpLock({ id: 1, agent_id: 7 }, false), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/followUpOwnership.test.js`
Expected: FAIL com `Cannot find module ... followUpOwnership.js`.

- [ ] **Step 3: Implementar**

Create `server/services/followUpOwnership.js`:
```js
// Follow-up de inatividade de agente de IA (follow_ups.agent_id) so se edita no editor do agente
// (aba Atendimento, rota PUT /api/agents/:id/inactivity-followup). A pagina Follow-ups so mostra.
export const AGENT_FOLLOWUP_LOCKED_MSG = 'Este follow-up pertence a um agente de IA. Edite em Agentes de IA, no agente, aba Atendimento.'

export function agentFollowUpLock(fu, agentExists) {
  if (fu && fu.agent_id && agentExists) {
    return { status: 409, error: AGENT_FOLLOWUP_LOCKED_MSG, agent_id: fu.agent_id }
  }
  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test test/followUpOwnership.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Ligar nas rotas**

Em `server/routes/follow-ups.js`:
1. Acrescentar junto dos imports: `import { agentFollowUpLock } from '../services/followUpOwnership.js'`
2. Acrescentar, logo depois de `const router = Router()`:
```js
function lockIfAgentOwned(fu, res) {
  const agentExists = fu.agent_id ? !!db.prepare('SELECT 1 FROM ai_agents WHERE id = ?').get(fu.agent_id) : false
  const lock = agentFollowUpLock(fu, agentExists)
  if (lock) { res.status(lock.status).json({ error: lock.error, agent_id: lock.agent_id }); return true }
  return false
}
```
3. Em `router.put('/:id', ...)`, logo depois de `if (!fu) return res.status(404).json({ error: 'Follow-up nao encontrado' })`, inserir: `if (lockIfAgentOwned(fu, res)) return`
4. Em `router.delete('/:id', ...)`, no mesmo ponto (depois do 404), inserir: `if (lockIfAgentOwned(fu, res)) return`

Run: `grep -n "lockIfAgentOwned" server/routes/follow-ups.js`
Expected: 3 linhas (a função e as duas chamadas).

- [ ] **Step 6: Suíte inteira**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add server/services/followUpOwnership.js server/routes/follow-ups.js test/followUpOwnership.test.js
git commit -m "feat: follow-up do agente so pode ser editado no proprio agente

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Regras puras do front (primeira mensagem, horário, provedores, QR)

Toda decisão de "como juntar os dados antigos" fica aqui, testada. As telas só desenham.

**Files:**
- Create: `src/lib/numberSettings.js`, `src/lib/numberSettings.d.ts`
- Create: `src/lib/whatsappProviders.js`, `src/lib/whatsappProviders.d.ts`
- Test: `test/numberSettings.test.js`, `test/whatsappProviders.test.js`

**Interfaces:**
- Produces (`src/lib/numberSettings.js`): `DAY_KEYS: DayKey[]`, `DAY_LABELS: Record<DayKey,string>`, `defaultSchedule(): Schedule`, `resolveFirstMessage({ first_msg_template?, greeting_text?, greeting_enabled? }): FirstMessageState`, `buildFirstMessageSave({ text, onAssign, onInbound }): { first_msg_template: string|null, greeting_text: string|null, greeting_enabled: 0|1 }`, `resolveServiceHours({ away_schedule_json?, business_hours_json? }): ServiceHoursState`, `buildServiceHoursSave(schedule, holdSends): { away_schedule_json: string, hold_sends_outside_hours: boolean }`, `scheduleErrors(schedule): string[]`. Tipos: `DayKey = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'`, `TimeSlot = { start: string; end: string }`, `Schedule = Record<DayKey, TimeSlot[]>`, `FirstMessageState = { text: string; onAssign: boolean; onInbound: boolean; conflict: { otherText: string } | null }`, `ServiceHoursState = { schedule: Schedule; holdSends: boolean; conflict: boolean }`.
- Produces (`src/lib/whatsappProviders.js`): `WhatsAppProviderId = 'uzapi'|'evolution'`, `PROVIDER_LABELS`, `providerLabel(p?: string|null): string`, `normalizeProviders(raw: unknown): WhatsAppProviderId[]` (sempre com pelo menos `'evolution'`, na ordem Evolution, UzAPI), `qrImageSrc(qr?: string|null): string|null`.

- [ ] **Step 1: Escrever os testes que falham**

Create `test/numberSettings.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DAY_KEYS, defaultSchedule, resolveFirstMessage, buildFirstMessageSave,
  resolveServiceHours, buildServiceHoursSave, scheduleErrors,
} from '../src/lib/numberSettings.js'

// ---- Primeira mensagem ----

test('primeira mensagem: so a de formulario/planilha', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: ' Oi {{primeiro_nome}} ', greeting_text: null, greeting_enabled: 0 }),
    { text: 'Oi {{primeiro_nome}}', onAssign: true, onInbound: false, conflict: null },
  )
})

test('primeira mensagem: so a saudacao ligada', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: null, greeting_text: 'Olá!', greeting_enabled: 1 }),
    { text: 'Olá!', onAssign: false, onInbound: true, conflict: null },
  )
})

test('primeira mensagem: saudacao com texto mas desligada aparece desmarcada', () => {
  assert.deepEqual(
    resolveFirstMessage({ greeting_text: 'Olá!', greeting_enabled: 0 }),
    { text: 'Olá!', onAssign: false, onInbound: false, conflict: null },
  )
})

test('primeira mensagem: textos iguais nao sao conflito', () => {
  const r = resolveFirstMessage({ first_msg_template: 'Oi', greeting_text: ' Oi ', greeting_enabled: 1 })
  assert.equal(r.conflict, null)
  assert.equal(r.onAssign && r.onInbound, true)
})

test('primeira mensagem: textos diferentes mostram o outro sem perder nada', () => {
  assert.deepEqual(
    resolveFirstMessage({ first_msg_template: 'A', greeting_text: 'B', greeting_enabled: 1 }),
    { text: 'A', onAssign: true, onInbound: true, conflict: { otherText: 'B' } },
  )
})

test('primeira mensagem: nada configurado', () => {
  assert.deepEqual(resolveFirstMessage({}), { text: '', onAssign: false, onInbound: false, conflict: null })
})

test('salvar primeira mensagem: as duas situacoes', () => {
  assert.deepEqual(buildFirstMessageSave({ text: ' Oi ', onAssign: true, onInbound: true }),
    { first_msg_template: 'Oi', greeting_text: 'Oi', greeting_enabled: 1 })
})

test('salvar primeira mensagem: so formulario guarda o texto tambem na saudacao desligada', () => {
  assert.deepEqual(buildFirstMessageSave({ text: 'Oi', onAssign: true, onInbound: false }),
    { first_msg_template: 'Oi', greeting_text: 'Oi', greeting_enabled: 0 })
})

test('salvar primeira mensagem: nenhuma situacao marcada nao perde o texto', () => {
  assert.deepEqual(buildFirstMessageSave({ text: 'Oi', onAssign: false, onInbound: false }),
    { first_msg_template: null, greeting_text: 'Oi', greeting_enabled: 0 })
})

test('salvar primeira mensagem: texto vazio desliga tudo', () => {
  assert.deepEqual(buildFirstMessageSave({ text: '   ', onAssign: true, onInbound: true }),
    { first_msg_template: null, greeting_text: null, greeting_enabled: 0 })
})

// ---- Horario de atendimento ----

const soSegundaManha = { mon: [{ start: '08:00', end: '12:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }

test('horario: usa o da ausencia e completa os dias que faltam', () => {
  const r = resolveServiceHours({ away_schedule_json: JSON.stringify({ mon: [{ start: '08:00', end: '12:00' }] }), business_hours_json: null })
  assert.deepEqual(r, { schedule: soSegundaManha, holdSends: false, conflict: false })
})

test('horario: sem ausencia usa o da trava e marca segurar envios', () => {
  const r = resolveServiceHours({ away_schedule_json: null, business_hours_json: JSON.stringify(soSegundaManha) })
  assert.deepEqual(r, { schedule: soSegundaManha, holdSends: true, conflict: false })
})

test('horario: nenhum configurado usa o padrao seg-sex 9h-18h', () => {
  const r = resolveServiceHours({})
  assert.deepEqual(r.schedule, defaultSchedule())
  assert.equal(r.schedule.fri[0].end, '18:00')
  assert.deepEqual(r.schedule.sat, [])
  assert.equal(r.holdSends, false)
})

test('horario: iguais nao e conflito; diferentes e conflito', () => {
  const iguais = resolveServiceHours({ away_schedule_json: JSON.stringify(soSegundaManha), business_hours_json: JSON.stringify(soSegundaManha) })
  assert.equal(iguais.conflict, false)
  const outro = { ...soSegundaManha, tue: [{ start: '10:00', end: '11:00' }] }
  const diferentes = resolveServiceHours({ away_schedule_json: JSON.stringify(soSegundaManha), business_hours_json: JSON.stringify(outro) })
  assert.equal(diferentes.conflict, true)
  assert.deepEqual(diferentes.schedule, soSegundaManha)
  assert.equal(diferentes.holdSends, true)
})

test('horario: json invalido e ignorado', () => {
  const r = resolveServiceHours({ away_schedule_json: 'nao-json', business_hours_json: '[1,2]' })
  assert.deepEqual(r.schedule, defaultSchedule())
  assert.equal(r.holdSends, false)
})

test('horario: salvar normaliza os dias e manda a caixa', () => {
  const r = buildServiceHoursSave({ ...soSegundaManha, tue: [{ start: '', end: '' }] }, true)
  assert.deepEqual(JSON.parse(r.away_schedule_json), soSegundaManha)
  assert.equal(r.hold_sends_outside_hours, true)
  assert.deepEqual(Object.keys(JSON.parse(r.away_schedule_json)), DAY_KEYS)
})

test('horario: aponta horario invertido e horario vazio', () => {
  const errs = scheduleErrors({ ...soSegundaManha, wed: [{ start: '18:00', end: '09:00' }], sat: [{ start: '', end: '12:00' }] })
  assert.deepEqual(errs, [
    'Quarta: o horário 18:00–09:00 termina antes de começar.',
    'Sábado: preencha o início e o fim do horário.',
  ])
  assert.deepEqual(scheduleErrors(soSegundaManha), [])
})
```

Create `test/whatsappProviders.test.js`:
```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { providerLabel, normalizeProviders, qrImageSrc } from '../src/lib/whatsappProviders.js'

test('nome do provedor para a tela', () => {
  assert.equal(providerLabel('uzapi'), 'UzAPI (estável)')
  assert.equal(providerLabel('evolution'), 'Evolution')
  assert.equal(providerLabel(undefined), 'Evolution')
  assert.equal(providerLabel(null), 'Evolution')
  assert.equal(providerLabel('custom'), 'custom')
})

test('lista de provedores: array de textos', () => {
  assert.deepEqual(normalizeProviders(['uzapi', 'evolution']), ['evolution', 'uzapi'])
})

test('lista de provedores: { providers: [textos] }', () => {
  assert.deepEqual(normalizeProviders({ providers: ['evolution'] }), ['evolution'])
})

test('lista de provedores: { providers: [objetos] } com id, provider, key ou name', () => {
  assert.deepEqual(normalizeProviders({ providers: [{ id: 'uzapi', label: 'UzAPI' }, { provider: 'evolution' }] }), ['evolution', 'uzapi'])
  assert.deepEqual(normalizeProviders({ providers: [{ key: 'uzapi' }, { name: 'evolution' }] }), ['evolution', 'uzapi'])
})

test('lista de provedores: ignora desconhecidos e repetidos', () => {
  assert.deepEqual(normalizeProviders(['uzapi', 'uzapi', 'cloud_api', 'evolution']), ['evolution', 'uzapi'])
})

test('lista de provedores: resposta vazia ou estranha cai na Evolution', () => {
  assert.deepEqual(normalizeProviders(null), ['evolution'])
  assert.deepEqual(normalizeProviders({}), ['evolution'])
  assert.deepEqual(normalizeProviders({ providers: [] }), ['evolution'])
})

test('QR: data URL passa como veio', () => {
  assert.equal(qrImageSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
})

test('QR: base64 cru vira imagem png', () => {
  const b64 = 'iVBORw0KGgo' + 'A'.repeat(120) + '=='
  assert.equal(qrImageSrc(b64), `data:image/png;base64,${b64}`)
  assert.equal(qrImageSrc(`  ${b64}\n`), `data:image/png;base64,${b64}`)
})

test('QR: texto cru do WhatsApp (nao e imagem) nao vira imagem', () => {
  assert.equal(qrImageSrc('2@AbCdEf123,XyZ+/w==,QwErTy=='), null)
})

test('QR: vazio ou curto demais', () => {
  assert.equal(qrImageSrc(null), null)
  assert.equal(qrImageSrc(''), null)
  assert.equal(qrImageSrc('abcd'), null)
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test test/numberSettings.test.js test/whatsappProviders.test.js`
Expected: FAIL com `Cannot find module ... numberSettings.js` / `whatsappProviders.js`.

- [ ] **Step 3: Implementar `numberSettings.js` e o `.d.ts`**

Create `src/lib/numberSettings.js`:
```js
// Regras puras das "Mensagens do numero" (Integracoes > WhatsApp > Mensagens do numero).
// JS puro com .d.ts ao lado: roda no `node --test` sem compilar TypeScript e e importado pelo front.
//
// Primeira mensagem: um texto por numero. Fica em whatsapp_instances.first_msg_template (quando vale
// para lead de formulario/planilha entregue a vendedor deste numero) e SEMPRE em
// instance_auto_messages.greeting_text (greeting_enabled = lead novo que manda a primeira mensagem).
// Horario: um por numero. Vai para away_schedule_json e, com "segurar envios", para business_hours_json.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export const DAY_LABELS = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo',
}

export function defaultSchedule() {
  const weekday = () => [{ start: '09:00', end: '18:00' }]
  return { mon: weekday(), tue: weekday(), wed: weekday(), thu: weekday(), fri: weekday(), sat: [], sun: [] }
}

function clean(s) {
  return typeof s === 'string' ? s.trim() : ''
}

export function resolveFirstMessage(input = {}) {
  const assignText = clean(input.first_msg_template)
  const inboundText = clean(input.greeting_text)
  return {
    text: assignText || inboundText,
    onAssign: !!assignText,
    onInbound: !!input.greeting_enabled && !!inboundText,
    conflict: assignText && inboundText && assignText !== inboundText ? { otherText: inboundText } : null,
  }
}

export function buildFirstMessageSave(state) {
  const text = clean(state.text)
  return {
    first_msg_template: state.onAssign && text ? text : null,
    greeting_text: text || null,
    greeting_enabled: state.onInbound && text ? 1 : 0,
  }
}

function normalizeSchedule(raw) {
  const out = {}
  for (const day of DAY_KEYS) {
    const slots = raw && Array.isArray(raw[day]) ? raw[day] : []
    out[day] = slots
      .filter(s => s && typeof s.start === 'string' && typeof s.end === 'string' && s.start && s.end)
      .map(s => ({ start: s.start, end: s.end }))
  }
  return out
}

function parseSchedule(json) {
  if (!json || typeof json !== 'string') return null
  try {
    const raw = JSON.parse(json)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return normalizeSchedule(raw)
  } catch {
    return null
  }
}

export function resolveServiceHours(input = {}) {
  const away = parseSchedule(input.away_schedule_json)
  const business = parseSchedule(input.business_hours_json)
  return {
    schedule: away || business || defaultSchedule(),
    holdSends: !!business,
    conflict: !!(away && business && JSON.stringify(away) !== JSON.stringify(business)),
  }
}

export function buildServiceHoursSave(schedule, holdSends) {
  return {
    away_schedule_json: JSON.stringify(normalizeSchedule(schedule)),
    hold_sends_outside_hours: !!holdSends,
  }
}

export function scheduleErrors(schedule) {
  const errors = []
  for (const day of DAY_KEYS) {
    const slots = (schedule && schedule[day]) || []
    for (const s of slots) {
      if (!s.start || !s.end) errors.push(`${DAY_LABELS[day]}: preencha o início e o fim do horário.`)
      else if (s.start >= s.end) errors.push(`${DAY_LABELS[day]}: o horário ${s.start}–${s.end} termina antes de começar.`)
    }
  }
  return errors
}
```

Create `src/lib/numberSettings.d.ts`:
```ts
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export interface TimeSlot { start: string; end: string }
export type Schedule = Record<DayKey, TimeSlot[]>

export declare const DAY_KEYS: DayKey[]
export declare const DAY_LABELS: Record<DayKey, string>
export declare function defaultSchedule(): Schedule

export interface FirstMessageState {
  text: string
  onAssign: boolean
  onInbound: boolean
  conflict: { otherText: string } | null
}
export declare function resolveFirstMessage(input?: {
  first_msg_template?: string | null
  greeting_text?: string | null
  greeting_enabled?: number | boolean | null
}): FirstMessageState
export declare function buildFirstMessageSave(state: { text: string; onAssign: boolean; onInbound: boolean }): {
  first_msg_template: string | null
  greeting_text: string | null
  greeting_enabled: 0 | 1
}

export interface ServiceHoursState { schedule: Schedule; holdSends: boolean; conflict: boolean }
export declare function resolveServiceHours(input?: {
  away_schedule_json?: string | null
  business_hours_json?: string | null
}): ServiceHoursState
export declare function buildServiceHoursSave(schedule: Schedule, holdSends: boolean): {
  away_schedule_json: string
  hold_sends_outside_hours: boolean
}
export declare function scheduleErrors(schedule: Schedule): string[]
```

- [ ] **Step 4: Implementar `whatsappProviders.js` e o `.d.ts`**

Create `src/lib/whatsappProviders.js`:
```js
// Regras puras dos provedores de WhatsApp na tela (Integracoes > WhatsApp).
// JS puro com .d.ts ao lado para rodar no `node --test`.

export const PROVIDER_LABELS = { uzapi: 'UzAPI (estável)', evolution: 'Evolution' }

// Ordem de exibicao: Evolution (padrao) primeiro.
const KNOWN = ['evolution', 'uzapi']

export function providerLabel(p) {
  const id = p || 'evolution'
  return PROVIDER_LABELS[id] || String(id)
}

// Aceita a resposta de GET /api/integrations/whatsapp/providers em qualquer um destes formatos:
// ['evolution','uzapi'] | { providers: ['evolution'] } | { providers: [{ id|provider|key|name: 'uzapi', ... }] }
export function normalizeProviders(raw) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.providers) ? raw.providers : [])
  const ids = new Set()
  for (const item of list) {
    const id = typeof item === 'string' ? item : (item && (item.id || item.provider || item.key || item.name))
    if (KNOWN.includes(id)) ids.add(id)
  }
  const ordered = KNOWN.filter(k => ids.has(k))
  return ordered.length ? ordered : ['evolution']
}

// qr_code pode vir como data URL ou base64 cru de PNG. Texto cru do WhatsApp (ex.: "2@...,...")
// nao e imagem: devolve null e a tela mostra o botao do painel ou pede para atualizar.
export function qrImageSrc(qr) {
  const s = typeof qr === 'string' ? qr.trim() : ''
  if (!s) return null
  if (s.startsWith('data:image/')) return s
  const compact = s.replace(/\s+/g, '')
  if (compact.length >= 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return `data:image/png;base64,${compact}`
  return null
}
```

Create `src/lib/whatsappProviders.d.ts`:
```ts
export type WhatsAppProviderId = 'uzapi' | 'evolution'
export declare const PROVIDER_LABELS: Record<WhatsAppProviderId, string>
export declare function providerLabel(p?: string | null): string
export declare function normalizeProviders(raw: unknown): WhatsAppProviderId[]
export declare function qrImageSrc(qr?: string | null): string | null
```

- [ ] **Step 5: Rodar e ver passar**

Run: `node --test test/numberSettings.test.js test/whatsappProviders.test.js`
Expected: PASS (17 + 10 testes).

- [ ] **Step 6: Suíte inteira e tipos**

Run: `npm test 2>&1 | tail -5 && npx tsc --noEmit -p . 2>&1 | grep -c "error TS"`
Expected: `# fail 0` e a contagem = BASE_TSC (os `.d.ts` entram no `tsc`; os `.js` não).

- [ ] **Step 7: Commit**

```bash
git add src/lib/numberSettings.js src/lib/numberSettings.d.ts src/lib/whatsappProviders.js src/lib/whatsappProviders.d.ts test/numberSettings.test.js test/whatsappProviders.test.js
git commit -m "feat: regras puras da primeira mensagem, horario e provedores do numero

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Cliente de API (`src/lib/api.ts`)

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/pages/Integrations.tsx` (só a função `handleRefreshQR`, para acompanhar o formato novo do QR)

**Interfaces:**
- Consumes: `normalizeProviders`, `WhatsAppProviderId` (Task 4); contrato do servidor.
- Produces:
  - `WhatsAppInstance.provider?: WhatsAppProviderId | string`
  - `export type { WhatsAppProviderId }` (reexportado de `api.ts`)
  - `createWhatsAppInstance(accountId, { instance_name, lead_intake_mode?, provider? }): Promise<WhatsAppInstance>`
  - `fetchWhatsAppProviders(accountId: number): Promise<WhatsAppProviderId[]>` (nunca rejeita; em erro devolve `['evolution']`)
  - `interface QrCodeResult { qr_code: string | null; status: string; panel_url: string | null }`
  - `refreshWhatsAppQR(id, accountId): Promise<QrCodeResult>`
  - `InstanceAutoMessageConfig.business_hours_json?: string | null` e `.hold_sends_outside_hours?: boolean`
  - `updateFunnelFirstMessage(funnelId: number, accountId: number, template: string | null): Promise<unknown>`

- [ ] **Step 1: Conferir o que o plano do servidor já pôs em `api.ts`**

Run: `grep -n "provider" src/lib/api.ts`
Expected: talvez nada. Se já existir `provider` em `WhatsAppInstance` ou uma função de provedores, **não duplicar**: ajustar a existente para as assinaturas acima.

- [ ] **Step 2: Import e reexport no topo**

Na primeira linha de `src/lib/api.ts` (antes de `const getToken = ...`), acrescentar:
```ts
import { normalizeProviders, type WhatsAppProviderId } from './whatsappProviders.js'
export type { WhatsAppProviderId }
```

- [ ] **Step 3: `provider` na instância**

Na linha `export interface WhatsAppInstance { ... first_msg_template?: string | null }`, acrescentar antes do `}` final `; provider?: WhatsAppProviderId | string`. A linha fica:
```ts
export interface WhatsAppInstance { id: number; account_id: number; instance_name: string; api_url: string; api_key: string; status: string; phone_number: string | null; qr_code: string | null; default_attendant_id: number | null; lead_intake_mode?: 'open' | 'restricted'; first_msg_template?: string | null; provider?: WhatsAppProviderId | string }
```

- [ ] **Step 4: Criar número com provedor, lista de provedores e QR novo**

Trocar a linha de `createWhatsAppInstance` por:
```ts
export const createWhatsAppInstance = (accountId: number, data: { instance_name: string; lead_intake_mode?: 'open' | 'restricted'; provider?: WhatsAppProviderId }) => apiFetch<{ instance: WhatsAppInstance }>(`/api/integrations/whatsapp?account_id=${accountId}`, { method: 'POST', body: JSON.stringify(data) }).then(d => d.instance)
```
Trocar a linha de `refreshWhatsAppQR` por:
```ts
export interface QrCodeResult { qr_code: string | null; status: string; panel_url: string | null }
// Contrato: { qr_code, status, panel_url? }. Aceita tambem o formato antigo { instance } por seguranca.
export const refreshWhatsAppQR = (id: number, accountId: number) =>
  apiFetch<any>(`/api/integrations/whatsapp/${id}/qrcode?account_id=${accountId}`, { method: 'POST' })
    .then((d): QrCodeResult => ({
      qr_code: d?.qr_code ?? d?.instance?.qr_code ?? null,
      status: d?.status ?? d?.instance?.status ?? 'connecting',
      panel_url: d?.panel_url ?? null,
    }))
```
Logo depois da linha de `fetchPublicConfig`, acrescentar:
```ts
export const fetchWhatsAppProviders = (accountId: number): Promise<WhatsAppProviderId[]> =>
  apiFetch<unknown>(`/api/integrations/whatsapp/providers?account_id=${accountId}`)
    .then(normalizeProviders)
    .catch(() => ['evolution'] as WhatsAppProviderId[])
```

- [ ] **Step 5: Campos novos das auto-mensagens e mensagem do funil**

Em `export interface InstanceAutoMessageConfig { ... }`, acrescentar antes do `}`:
```ts
  business_hours_json?: string | null      // trava anti-bloqueio (whatsapp_instances); so leitura no GET
  hold_sends_outside_hours?: boolean       // PUT: grava o horario tambem na trava (true) ou libera 24h (false)
```
Logo depois da linha de `updateFunnelStages`, acrescentar:
```ts
export const updateFunnelFirstMessage = (funnelId: number, accountId: number, template: string | null) =>
  apiFetch(`/api/funnels/${funnelId}?account_id=${accountId}`, { method: 'PUT', body: JSON.stringify({ first_msg_template: template }) })
```

- [ ] **Step 6: Acompanhar o formato novo em `Integrations.tsx`**

Em `src/pages/Integrations.tsx`, trocar a função `handleRefreshQR` inteira por:
```tsx
  const handleRefreshQR = async (inst: WhatsAppInstance) => {
    if (!accountId) return
    try {
      const r = await refreshWhatsAppQR(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, qr_code: r.qr_code, status: r.status } : i))
    } catch (e: any) { alert('Erro: ' + e.message) }
  }
```

- [ ] **Step 7: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC; build termina com `✓ built in ...`. (O build reescreve `dist/`: **não** adicionar `dist/` ao commit.)

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/pages/Integrations.tsx
git commit -m "feat: cliente de API com provedor por numero, QR novo e mensagem do funil

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Modal "Mensagens do número" (primeira mensagem + horário + ausência)

Substitui o modal "💬 Msg inicial" (editor de `first_msg_template` dentro de `Integrations.tsx`) e o `InstanceAutoMessagesModal` (saudação/ausência). Um botão por número: **Mensagens do número**.

**Files:**
- Create: `src/components/NumberSettingsModal.tsx`
- Delete: `src/components/InstanceAutoMessagesModal.tsx`
- Modify: `src/pages/Integrations.tsx` (botões da linha do número, estados `tplModal`/`autoMsgInstance`, os dois modais antigos)

**Interfaces:**
- Consumes: Task 4 (`resolveFirstMessage`, `buildFirstMessageSave`, `resolveServiceHours`, `buildServiceHoursSave`, `scheduleErrors`, `DAY_KEYS`, `DAY_LABELS`), Task 5 (`updateFunnelFirstMessage`, `InstanceAutoMessageConfig.business_hours_json`, `hold_sends_outside_hours`), Task 2 (servidor aceita `hold_sends_outside_hours`), Task 1 (variáveis unificadas).
- Produces: `export default function NumberSettingsModal(props: { instance: WhatsAppInstance; accountId: number; canEditFirstMessage: boolean; canManageFunnels: boolean; onClose: () => void; onSaved: (instance: WhatsAppInstance) => void })`. A Task 8 usa exatamente essas props.

- [ ] **Step 1: Confirmar a lista de envios que a trava segura**

Run: `grep -rn "skipBusinessHours" server --include=*.js`
Expected: só `routes/messages.js` (Chat, texto e mídia), `services/autoMessages.js` (saudação/ausência) e `services/leadHandoff.js` (notificação ao vendedor) pulam a trava. Portanto a trava segura: primeira mensagem de lead de formulário/planilha, follow-ups, disparos, cadências e respostas do agente de IA. Se a lista for diferente, ajustar o texto `HOLD_HELP` do Step 2 para refletir o que o código faz.

- [ ] **Step 2: Criar o componente**

Create `src/components/NumberSettingsModal.tsx`:
```tsx
import { useEffect, useState, type CSSProperties } from 'react'
import {
  fetchInstanceAutoMessages, saveInstanceAutoMessages, updateInstanceFirstMsgTemplate,
  fetchFunnels, fetchAgents, updateFunnelFirstMessage,
  type WhatsAppInstance, type Funnel, type Agent,
} from '../lib/api'
import {
  DAY_KEYS, DAY_LABELS, resolveFirstMessage, buildFirstMessageSave,
  resolveServiceHours, buildServiceHoursSave, scheduleErrors,
  type FirstMessageState, type ServiceHoursState, type DayKey,
} from '../lib/numberSettings.js'
import { X, MessageSquare, Clock, Moon, Save, AlertTriangle, Smartphone, Info } from 'lucide-react'

type SettingsTab = 'primeira' | 'horario' | 'ausencia'

interface Props {
  instance: WhatsAppInstance
  accountId: number
  canEditFirstMessage: boolean
  canManageFunnels: boolean
  onClose: () => void
  onSaved: (instance: WhatsAppInstance) => void
}

const VARS_HELP = 'Variáveis: {{primeiro_nome}} · {{nome}} · {{empresa}} · {{cidade}} · {{atendente}} · {{atendente_nome}}. {{etapa}} e {{funil}} só são preenchidas para leads de formulário ou planilha.'
const HOLD_HELP = 'Ligado: fora do horário, este número não envia follow-ups, disparos, cadências, a primeira mensagem para leads de formulário/planilha nem respostas do agente de IA. Mensagens enviadas pelo Chat, a saudação e a ausência sempre saem.'

const hint: CSSProperties = { fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }
const infoBox: CSSProperties = { background: 'rgba(91,173,226,0.06)', border: '1px solid rgba(91,173,226,0.25)', borderRadius: 8, padding: '10px 12px', fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6, marginTop: 12 }
const warnBox: CSSProperties = { background: 'rgba(255,179,0,0.07)', border: '1px solid rgba(255,179,0,0.3)', borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, marginBottom: 12, display: 'flex', gap: 8 }

export default function NumberSettingsModal({ instance, accountId, canEditFirstMessage, canManageFunnels, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<SettingsTab>('primeira')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [first, setFirst] = useState<FirstMessageState>(() => resolveFirstMessage({ first_msg_template: instance.first_msg_template }))
  const [greetingCooldown, setGreetingCooldown] = useState(24)
  const [hours, setHours] = useState<ServiceHoursState>(() => resolveServiceHours({}))
  const [awayEnabled, setAwayEnabled] = useState(false)
  const [awayText, setAwayText] = useState('')
  const [awayCooldown, setAwayCooldown] = useState(4)
  const [funnelOverrides, setFunnelOverrides] = useState<Funnel[]>([])
  const [welcomeAgents, setWelcomeAgents] = useState<Agent[]>([])

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      fetchInstanceAutoMessages(instance.id, accountId).then(r => r.config),
      fetchFunnels(accountId).catch(() => [] as Funnel[]),
      fetchAgents(accountId).then(d => d.agents).catch(() => [] as Agent[]),
    ]).then(([cfg, funnels, agents]) => {
      if (!alive) return
      setFirst(resolveFirstMessage({
        first_msg_template: instance.first_msg_template,
        greeting_text: cfg.greeting_text,
        greeting_enabled: cfg.greeting_enabled,
      }))
      setGreetingCooldown(cfg.greeting_cooldown_hours || 24)
      setHours(resolveServiceHours({ away_schedule_json: cfg.away_schedule_json, business_hours_json: cfg.business_hours_json }))
      setAwayEnabled(!!cfg.away_enabled)
      setAwayText(cfg.away_text || '')
      setAwayCooldown(cfg.away_cooldown_hours || 4)
      setFunnelOverrides(funnels.filter(f => (f.first_msg_template || '').trim()))
      setWelcomeAgents(agents.filter(a => a.is_active === 1 && a.send_welcome_for_sheets_leads === 1))
    }).catch(e => {
      if (alive) setError(e?.message || 'Não foi possível carregar as mensagens deste número.')
    }).finally(() => {
      if (alive) setLoading(false)
    })
    return () => { alive = false }
  }, [instance.id, instance.first_msg_template, accountId])

  const setSlot = (day: DayKey, idx: number, field: 'start' | 'end', value: string) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: h.schedule[day].map((s, i) => i === idx ? { ...s, [field]: value } : s) } }))
  const addSlot = (day: DayKey) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: [...h.schedule[day], { start: '09:00', end: '18:00' }] } }))
  const removeSlot = (day: DayKey, idx: number) =>
    setHours(h => ({ ...h, schedule: { ...h.schedule, [day]: h.schedule[day].filter((_, i) => i !== idx) } }))

  const swapConflict = () =>
    setFirst(f => f.conflict ? { ...f, text: f.conflict.otherText, conflict: { otherText: f.text } } : f)

  const handleUseNumberMessage = async (f: Funnel) => {
    if (!confirm(`Parar de usar a mensagem própria do funil "${f.name}"?\n\nA partir de agora, os leads desse funil recebem a Primeira mensagem do número que os atende.`)) return
    try {
      await updateFunnelFirstMessage(f.id, accountId, null)
      setFunnelOverrides(prev => prev.filter(x => x.id !== f.id))
    } catch (e: any) {
      setError(e?.message || 'Não foi possível atualizar o funil.')
    }
  }

  const handleSave = async () => {
    const errs = scheduleErrors(hours.schedule)
    if (errs.length > 0) { setError(errs.join(' ')); setTab('horario'); return }
    setSaving(true); setError(null)
    try {
      const firstSave = buildFirstMessageSave(first)
      const hoursSave = buildServiceHoursSave(hours.schedule, hours.holdSends)
      await saveInstanceAutoMessages(instance.id, accountId, {
        greeting_enabled: firstSave.greeting_enabled,
        greeting_text: firstSave.greeting_text,
        greeting_cooldown_hours: greetingCooldown,
        away_enabled: awayEnabled ? 1 : 0,
        away_text: awayText.trim() || null,
        away_cooldown_hours: awayCooldown,
        away_schedule_json: hoursSave.away_schedule_json,
        hold_sends_outside_hours: hoursSave.hold_sends_outside_hours,
      })
      let updated = instance
      if (canEditFirstMessage && (instance.first_msg_template || null) !== firstSave.first_msg_template) {
        updated = await updateInstanceFirstMsgTemplate(instance.id, firstSave.first_msg_template)
      }
      onSaved(updated)
    } catch (e: any) {
      setError(e?.message || 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <Smartphone size={18} style={{ color: '#FFB300' }} /> Mensagens do número — {instance.instance_name}
          </h2>
          <button className="btn btn-secondary btn-sm btn-icon" onClick={onClose} disabled={saving}><X size={14} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'primeira' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('primeira')}><MessageSquare size={12} /> Primeira mensagem</button>
          <button className={`btn btn-sm ${tab === 'horario' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('horario')}><Clock size={12} /> Horário de atendimento</button>
          <button className={`btn btn-sm ${tab === 'ausencia' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('ausencia')}><Moon size={12} /> Ausência</button>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,107,107,0.1)', border: '1px solid rgba(255,107,107,0.3)', color: '#FF6B6B', padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12, display: 'flex', gap: 8 }}>
            <AlertTriangle size={14} style={{ flexShrink: 0 }} /> {error}
          </div>
        )}

        {loading ? (
          <div className="loading-container"><div className="spinner" /></div>
        ) : (
          <>
            {tab === 'primeira' && (
              <div>
                <p style={hint}>Uma mensagem só para este número, enviada uma vez para cada lead novo. Leads que já existem não recebem. Escolha abaixo em quais situações ela sai.</p>

                {first.conflict && (
                  <div style={warnBox}>
                    <AlertTriangle size={14} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
                    <div>
                      Este número tinha duas mensagens diferentes. Abaixo está a que vai para leads de formulário e planilha. A outra, que ia para quem manda a primeira mensagem, é:
                      <div style={{ margin: '6px 0', padding: '6px 10px', background: 'var(--bg-hover)', borderRadius: 6, fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{first.conflict.otherText}</div>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={swapConflict}>Trocar pela outra</button>
                      <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: 11 }}>Ao salvar, as duas situações passam a usar o texto que estiver na caixa.</div>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Mensagem</label>
                  <textarea
                    className="input"
                    rows={5}
                    value={first.text}
                    onChange={e => setFirst(f => ({ ...f, text: e.target.value }))}
                    placeholder="Ex.: Olá, {{primeiro_nome}}! Aqui é {{atendente_nome}}. Recebi seu contato e vou te ajudar."
                    style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}
                  />
                  <small style={{ ...hint, display: 'block', marginTop: 4 }}>{VARS_HELP}</small>
                </div>

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={first.onInbound} onChange={e => setFirst(f => ({ ...f, onInbound: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>Quando um lead novo mandar a primeira mensagem para este número</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginBottom: 8, cursor: canEditFirstMessage ? 'pointer' : 'default', opacity: canEditFirstMessage ? 1 : 0.5 }}>
                  <input type="checkbox" checked={first.onAssign} disabled={!canEditFirstMessage} onChange={e => setFirst(f => ({ ...f, onAssign: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span>Quando um lead de formulário ou planilha for entregue a um vendedor que usa este número</span>
                </label>

                <div className="form-group" style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 12 }}>Intervalo mínimo entre duas saudações para o mesmo lead (horas)</label>
                  <input className="input" type="number" min={1} max={720} style={{ width: 100 }} value={greetingCooldown} onChange={e => setGreetingCooldown(parseInt(e.target.value) || 24)} />
                </div>

                <div style={infoBox}>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}><Info size={12} /> Qual mensagem sai</div>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Lead de planilha atendido por agente de IA com saudação ligada: a IA escreve a primeira mensagem (esta não sai).</li>
                    <li>Lead de formulário ou planilha de um funil com mensagem própria: sai a do funil.</li>
                    <li>Nos outros casos, sai esta mensagem, nas situações marcadas acima.</li>
                    <li>A mensagem só sai com o número conectado, para lead com telefone válido e não bloqueado.</li>
                  </ol>
                </div>

                {welcomeAgents.length > 0 && (
                  <div style={{ ...infoBox, borderColor: 'rgba(255,179,0,0.3)', background: 'rgba(255,179,0,0.05)' }}>
                    Agentes com saudação por IA para leads de planilha: <strong>{welcomeAgents.map(a => a.name).join(', ')}</strong>. Para ligar ou desligar, abra o agente em Agentes de IA, aba Geral.
                  </div>
                )}

                {funnelOverrides.length > 0 && (
                  <div style={{ ...infoBox, borderColor: 'rgba(255,179,0,0.3)', background: 'rgba(255,179,0,0.05)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>Funis com mensagem própria (valem no lugar desta)</div>
                    {funnelOverrides.map(f => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border-subtle)' }}>
                        <div style={{ flex: 1 }}>
                          <strong>{f.name}</strong>
                          <div style={{ fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>{f.first_msg_template}</div>
                        </div>
                        {canManageFunnels && (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleUseNumberMessage(f)}>Usar a deste número</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'horario' && (
              <div>
                <p style={hint}>Um horário só para este número. A ausência usa este horário e, se você ligar a opção abaixo, os envios automáticos também.</p>

                {hours.conflict && (
                  <div style={warnBox}>
                    <AlertTriangle size={14} style={{ color: '#FFB300', flexShrink: 0, marginTop: 2 }} />
                    <div>Antes, a trava de envios usava um horário diferente do horário da ausência. Abaixo está o da ausência; ao salvar, os dois passam a usar este horário.</div>
                  </div>
                )}

                {DAY_KEYS.map(day => (
                  <div key={day} style={{ background: 'var(--bg-hover)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <strong style={{ fontSize: 12 }}>{DAY_LABELS[day]}</strong>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => addSlot(day)}>+ Adicionar horário</button>
                    </div>
                    {hours.schedule[day].length === 0 ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Fechado</span>
                    ) : hours.schedule[day].map((slot, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                        <input type="time" className="input" value={slot.start} onChange={e => setSlot(day, idx, 'start', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>até</span>
                        <input type="time" className="input" value={slot.end} onChange={e => setSlot(day, idx, 'end', e.target.value)} style={{ width: 110, fontSize: 11 }} />
                        <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => removeSlot(day, idx)} title="Remover horário"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                ))}

                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, marginTop: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={hours.holdSends} onChange={e => setHours(h => ({ ...h, holdSends: e.target.checked }))} style={{ marginTop: 3 }} />
                  <span><strong>Segurar envios automáticos fora deste horário</strong></span>
                </label>
                <p style={{ ...hint, marginLeft: 24 }}>{HOLD_HELP}</p>

                <div style={infoBox}>
                  Dia marcado como Fechado: com a opção acima ligada, os envios automáticos ficam parados o dia todo. A mensagem de ausência <strong>não</strong> é enviada em dia fechado; ela sai só fora das faixas de horário dos dias que têm horário.
                </div>
              </div>
            )}

            {tab === 'ausencia' && (
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={awayEnabled} onChange={e => setAwayEnabled(e.target.checked)} />
                  <strong>Responder automaticamente fora do horário de atendimento</strong>
                </label>
                <p style={hint}>Sai quando um lead manda mensagem fora das faixas definidas na aba Horário de atendimento.</p>
                <div className="form-group">
                  <label>Mensagem de ausência</label>
                  <textarea
                    className="input"
                    rows={4}
                    value={awayText}
                    onChange={e => setAwayText(e.target.value)}
                    placeholder="Ex.: Estamos fora do horário de atendimento. Respondemos a partir das 9h."
                  />
                  <small style={{ ...hint, display: 'block', marginTop: 4 }}>{VARS_HELP}</small>
                </div>
                <div className="form-group">
                  <label style={{ fontSize: 12 }}>Não repetir a ausência para o mesmo lead por (horas)</label>
                  <input className="input" type="number" min={1} max={48} style={{ width: 100 }} value={awayCooldown} onChange={e => setAwayCooldown(parseInt(e.target.value) || 4)} />
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                <Save size={14} /> {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Ligar em `Integrations.tsx` e tirar os dois modais antigos**

Em `src/pages/Integrations.tsx`:
1. Trocar `import InstanceAutoMessagesModal from '../components/InstanceAutoMessagesModal'` por `import NumberSettingsModal from '../components/NumberSettingsModal'`.
2. Na lista de imports de `../lib/api`, remover `updateInstanceFirstMsgTemplate,`.
3. Apagar as linhas de estado:
```tsx
  // First msg template editor
  const [tplModal, setTplModal] = useState<{ inst: WhatsAppInstance; value: string } | null>(null)
  const [tplSaving, setTplSaving] = useState(false)
```
4. Trocar `const [autoMsgInstance, setAutoMsgInstance] = useState<WhatsAppInstance | null>(null)` por `const [settingsInstance, setSettingsInstance] = useState<WhatsAppInstance | null>(null)`.
5. Na linha de cada número, apagar o botão que começa em `{/* Botao Msg Inicial: visivel pra todos` e termina no `)}` depois de `💬 Msg inicial`, e apagar o botão `Auto-mensagens` (o `<button ... onClick={() => setAutoMsgInstance(inst)} ...>` até `</button>`). Depois, trocar o bloco do botão de excluir, que hoje está embrulhado assim:
```tsx
                    {(
                      <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(inst)} title="Excluir"><Trash2 size={12} /></button>
                    )}
```
por (o botão novo vem antes e o de excluir fica sem o embrulho `{( )}`):
```tsx
                    {(isGerenteOuAdmin || user?.primary_instance_id === inst.id) && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setSettingsInstance(inst)}
                        title="Primeira mensagem, horário de atendimento e ausência deste número"
                      >
                        <MessageSquare size={12} /> Mensagens do número
                      </button>
                    )}
                    <button className="btn btn-danger btn-sm btn-icon" onClick={() => handleDelete(inst)} title="Excluir"><Trash2 size={12} /></button>
```
6. Trocar o bloco `{/* Auto-Messages Modal */}` (o `{autoMsgInstance && accountId && (<InstanceAutoMessagesModal ... />)}`) por:
```tsx
      {/* Mensagens do numero: primeira mensagem, horario de atendimento e ausencia */}
      {settingsInstance && accountId && (
        <NumberSettingsModal
          instance={settingsInstance}
          accountId={accountId}
          canEditFirstMessage={isGerenteOuAdmin || user?.primary_instance_id === settingsInstance.id}
          canManageFunnels={isGerenteOuAdmin}
          onClose={() => setSettingsInstance(null)}
          onSaved={updated => { setInstances(prev => prev.map(i => i.id === updated.id ? updated : i)); setSettingsInstance(null) }}
        />
      )}
```
7. Apagar o bloco inteiro `{/* Modal: editor de mensagem inicial automatica */}` (de `{tplModal && (` até o `)}` que fecha esse modal, logo antes de `{deleteTarget && (`).

- [ ] **Step 4: Apagar o modal antigo**

Run:
```bash
git rm src/components/InstanceAutoMessagesModal.tsx && grep -rn "InstanceAutoMessagesModal\|tplModal\|autoMsgInstance" src
```
Expected: o `git rm` confirma; o `grep` não encontra nada.

- [ ] **Step 5: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC; `✓ built`.

- [ ] **Step 6: Verificação no navegador**

1. `export PATH="/c/nvm4w/nodejs:$PATH" && npm run dev` (deixar rodando) e abrir `http://localhost:5175/crm/`; entrar com `admin@drosagencia.com.br` / `dros2026`; escolher a conta 1 no seletor de conta.
2. Menu **Integrações** → num número, clicar **Mensagens do número**. Esperado: modal com 3 abas; a aba Primeira mensagem mostra o texto que o número já tinha (o antigo "Msg inicial" ou a saudação) e as caixas marcadas conforme estava.
3. Escrever `Olá, {{primeiro_nome}}! Aqui é {{atendente_nome}}.`, marcar as duas situações, ir em **Horário de atendimento**, pôr segunda 18:00 até 09:00 e clicar **Salvar**. Esperado: erro "Segunda: o horário 18:00–09:00 termina antes de começar." e a aba Horário aberta.
4. Corrigir para 09:00–18:00, ligar **Segurar envios automáticos fora deste horário**, Salvar. Esperado: modal fecha.
5. Conferir no banco local:
```bash
node -e "const D=require('better-sqlite3');const d=new D('server/data/crm.db');console.log(d.prepare('SELECT id,first_msg_template,business_hours_json FROM whatsapp_instances').all());console.log(d.prepare('SELECT instance_id,greeting_enabled,greeting_text,away_schedule_json FROM instance_auto_messages').all())"
```
(se o arquivo do banco tiver outro nome, ver `ls server/data`). Esperado: o número editado com `first_msg_template` = o texto, `greeting_enabled` = 1, `greeting_text` = o texto, e `business_hours_json` igual a `away_schedule_json`.
6. Reabrir o modal, desligar **Segurar envios**, salvar e repetir o comando. Esperado: `business_hours_json` = `null`; `away_schedule_json` continua.

- [ ] **Step 7: Commit**

```bash
git add src/components/NumberSettingsModal.tsx src/pages/Integrations.tsx
git commit -m "feat: mensagens do numero juntam primeira mensagem, horario e ausencia

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
(o `git rm` do Step 4 já deixou a exclusão no índice; ela entra neste commit.)

---

### Task 7: Cards "Entrada de leads", "Meta" e "IA" em arquivos próprios

Esta task só **muda de lugar** blocos que já existem em `Integrations.tsx` (sem mudar comportamento, exceto os pontos listados) e leva a origem da chave da IA para o card IA. A página continua mostrando tudo empilhado; os 4 cards navegáveis entram na Task 8.

**Files:**
- Create: `src/pages/integrations/LeadIntakeCard.tsx`
- Create: `src/pages/integrations/MetaCard.tsx`
- Create: `src/pages/integrations/AiCard.tsx`
- Modify: `src/pages/Integrations.tsx`

**Interfaces:**
- Produces:
  - `LeadIntakeCard({ accountId: number; account: Account; instances: WhatsAppInstance[]; users: User[] })`
  - `MetaCard({ accountId: number; account: Account; onAccountUpdated: (patch: Partial<Account>) => void })`
  - `AiCard({ accountId: number; account: Account; isSuperAdmin: boolean; onAccountUpdated: (patch: Partial<Account>) => void })`
  - `onAccountUpdated` é chamado depois de salvar com sucesso, para a casca (Task 8) manter o `account` atualizado quando o card é desmontado e montado de novo.

- [ ] **Step 1: Criar `LeadIntakeCard.tsx` (estado e ações)**

Create `src/pages/integrations/LeadIntakeCard.tsx`:
```tsx
import { useState, useEffect, useCallback } from 'react'
import {
  fetchTags, fetchTagInstanceMappings, upsertTagInstanceMapping, deleteTagInstanceMapping,
  fetchDefaultFormInstance, setDefaultFormInstance, fetchSheetsStatus, setSheetsDefaultTag, fetchPublicConfig,
  type WhatsAppInstance, type User as UserType, type Account, type Tag, type TagInstanceMapping,
} from '../../lib/api'
import { Plus, Loader, Trash2, Smartphone, Save, Check, FileSpreadsheet, Copy, AlertTriangle, Link as LinkIcon, GitBranch } from 'lucide-react'
import { parseSqlDate } from '../../lib/dates'

function sheetsTimeAgo(s: string | null) {
  if (!s) return null
  const d = parseSqlDate(s)
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000))
  if (mins < 1) return 'agora'
  if (mins < 60) return `há ${mins}min`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `há ${hrs}h`
  return `há ${Math.floor(hrs / 24)}d`
}

interface Props {
  accountId: number
  account: Account
  instances: WhatsAppInstance[]
  users: UserType[]
}

// Card "Entrada de leads": roteamento de leads de formulario (numero padrao + regras por tag) e Google Planilhas.
export default function LeadIntakeCard({ accountId, account, instances, users }: Props) {
  const accountSlug = account.slug
  const [publicBaseUrl, setPublicBaseUrl] = useState('https://drosagencia.com.br/crm')
  const [sheetsCopied, setSheetsCopied] = useState(false)
  const [sheetsTabName, setSheetsTabName] = useState('')
  const [scriptCopied, setScriptCopied] = useState(false)
  const [sheetsLastAt, setSheetsLastAt] = useState<string | null>(null)
  const [sheetsDefaultTagId, setSheetsDefaultTagId] = useState<number | null>(null)
  const [sheetsTagSaving, setSheetsTagSaving] = useState(false)
  const [routingMappings, setRoutingMappings] = useState<TagInstanceMapping[]>([])
  const [routingDefaultId, setRoutingDefaultId] = useState<number | null>(null)
  const [routingTags, setRoutingTags] = useState<Tag[]>([])
  const [routingEdit, setRoutingEdit] = useState<{ tag_id: string; instance_id: string; attendant_id: string; isNew: boolean } | null>(null)
  const [routingSaving, setRoutingSaving] = useState(false)

  useEffect(() => {
    fetchPublicConfig()
      .then(c => { if (c?.public_base_url) setPublicBaseUrl(c.public_base_url) })
      .catch(() => {})
  }, [])

  const loadRouting = useCallback(async () => {
    try {
      const [m, def, ts] = await Promise.all([
        fetchTagInstanceMappings(accountId).then(r => r.mappings).catch(() => []),
        fetchDefaultFormInstance(accountId).then(r => r.instance_id).catch(() => null),
        fetchTags(accountId).catch(() => []),
      ])
      setRoutingMappings(m); setRoutingDefaultId(def); setRoutingTags(ts)
    } catch {}
  }, [accountId])

  useEffect(() => { loadRouting() }, [loadRouting])

  useEffect(() => {
    fetchSheetsStatus(accountId).then(r => {
      setSheetsLastAt(r.last_lead_at)
      setSheetsDefaultTagId(r.default_tag_id)
    }).catch(() => {})
  }, [accountId])

  const handleChangeSheetsDefaultTag = async (tagId: number | null) => {
    setSheetsTagSaving(true)
    try {
      await setSheetsDefaultTag(accountId, tagId)
      setSheetsDefaultTagId(tagId)
    } catch (e: any) {
      alert('Erro: ' + (e.message || 'falha ao salvar a tag automática'))
    }
    setSheetsTagSaving(false)
  }

  const handleChangeDefaultRouting = async (instanceId: number | null) => {
    try { await setDefaultFormInstance(accountId, instanceId); setRoutingDefaultId(instanceId) }
    catch (e: any) { alert(e.message || 'Erro') }
  }

  const startRoutingEdit = (existing?: TagInstanceMapping) => {
    if (existing) {
      setRoutingEdit({
        tag_id: String(existing.tag_id),
        instance_id: String(existing.instance_id),
        attendant_id: existing.attendant_id ? String(existing.attendant_id) : '',
        isNew: false,
      })
    } else {
      setRoutingEdit({ tag_id: '', instance_id: '', attendant_id: '', isNew: true })
    }
  }

  const handleSaveRouting = async () => {
    if (!routingEdit || !routingEdit.tag_id || !routingEdit.instance_id) return
    setRoutingSaving(true)
    try {
      await upsertTagInstanceMapping(accountId, {
        tag_id: Number(routingEdit.tag_id),
        instance_id: Number(routingEdit.instance_id),
        attendant_id: routingEdit.attendant_id ? Number(routingEdit.attendant_id) : null,
      })
      setRoutingEdit(null)
      await loadRouting()
    } catch (e: any) { alert(e.message || 'Erro ao salvar regra') }
    setRoutingSaving(false)
  }

  const handleDeleteRouting = async (tagId: number) => {
    if (!confirm('Remover essa regra?')) return
    try { await deleteTagInstanceMapping(accountId, tagId); await loadRouting() }
    catch (e: any) { alert(e.message || 'Erro') }
  }

  const connectedInsts = instances.filter(i => i.status === 'connected')

  return (
    <>
      {connectedInsts.length === 0 ? (
        <section className="dash-section">
          <div className="section-title"><GitBranch size={14} /> Roteamento de leads (formulários)</div>
          <div className="card" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Conecte um número no card WhatsApp para escolher para qual número vão os leads de formulário.
          </div>
        </section>
      ) : (
        ROUTING_SECTION
      )}
      ROUTING_MODAL
      SHEETS_SECTION
    </>
  )
}
```
Os três nomes em maiúsculas (`ROUTING_SECTION`, `ROUTING_MODAL`, `SHEETS_SECTION`) marcam onde o Step 2 cola o JSX movido; o arquivo só compila depois do Step 2.

- [ ] **Step 2: Mover o JSX de roteamento e planilhas para o card**

Em `src/pages/Integrations.tsx`, recortar e colar em `LeadIntakeCard.tsx`, **sem alterar o conteúdo**:
1. `ROUTING_SECTION` ← o `<section className="dash-section" style={{ marginTop: 24 }}>` que contém `<GitBranch size={14} /> Roteamento de leads (formulários)`, até o `</section>` correspondente (fica dentro do `return (` da função anônima que começa em `{isGerenteOuAdmin && evoConfigured && (() => {`, logo abaixo do comentário `{/* Roteamento de leads de formulario (tag → instancia) — gerente/admin only */}`).
2. `ROUTING_MODAL` ← o bloco inteiro de `{/* Modal de criar/editar regra de roteamento */}` até o `)}` que fecha `{routingEdit && (`.
3. `SHEETS_SECTION` ← o `<section className="dash-section" style={{ marginTop: 24 }}>` que contém `<FileSpreadsheet size={14} /> Integracao Google Sheets`, até o `</section>` correspondente (dentro de `{isGerenteOuAdmin && accountSlug && (`).

Em seguida, em `Integrations.tsx`, apagar o que sobrou desses três blocos (o comentário do roteamento, a função anônima inteira, o comentário e o `{isGerenteOuAdmin && accountSlug && ( ... )}` das planilhas) e colocar no lugar, uma vez só:
```tsx
      {isGerenteOuAdmin && accountId && account && (
        <LeadIntakeCard accountId={accountId} account={account} instances={instances} users={users} />
      )}
```

- [ ] **Step 3: Corrigir os acentos dos textos movidos (só texto visível; o script do Apps Script não muda)**

Em `LeadIntakeCard.tsx`, trocar:

| De | Para |
|---|---|
| `Integracao Google Sheets` | `Google Planilhas` |
| `Conecte uma planilha do Google Sheets ao CRM. Leads adicionados na planilha sao criados automaticamente no sistema.` | `Conecte uma planilha do Google Sheets ao CRM. Leads adicionados na planilha são criados automaticamente no sistema.` |
| `Nome da aba especifica` | `Nome da aba específica` |
| `Ex: Leads Formulario (deixe em branco se a planilha tem so 1 aba)` | `Ex.: Leads Formulário (deixe em branco se a planilha tem só 1 aba)` |
| `Use isso quando a planilha tem <strong>varias abas</strong> e voce quer que so uma seja monitorada.` | `Use isso quando a planilha tem <strong>várias abas</strong> e você quer que só uma seja monitorada.` |
| `Se deixar em branco, o script usa a aba ativa no momento da edicao (comportamento padrao).` | `Se deixar em branco, o script usa a aba ativa no momento da edição (comportamento padrão).` |
| `Perguntas personalizadas do formulario Meta sao salvas nas <strong>observacoes</strong> do lead` | `Perguntas personalizadas do formulário Meta são salvas nas <strong>observações</strong> do lead` |
| `Dados de campanha (campaign_name, ad_name) sao salvos como fonte` | `Dados de campanha (campaign_name, ad_name) são salvos como fonte` |
| `Script vai monitorar <strong style={{ color: '#FFB300' }}>so a aba` | `O script vai monitorar <strong style={{ color: '#FFB300' }}>só a aba` |
| `confira que o nome ta exato (acentos, maiusculas)` | `confira se o nome está exato (acentos, maiúsculas)` |
| `<strong>Extensoes → Apps Script</strong>` | `<strong>Extensões → Apps Script</strong>` |
| `<strong>relogio → adicionar gatilho → onChange → Da planilha</strong>` | `<strong>relógio → adicionar gatilho → onChange → Da planilha</strong>` |
| `Pronto! Cada nova linha cria um lead no CRM automaticamente` | `Pronto! Cada linha nova cria um lead no CRM automaticamente` |
| `Ver script do Apps Script (clique pra expandir)` | `Ver script do Apps Script (clique para abrir)` |

Run: `grep -n "sao \|voce\|especifica\|Extensoes\|relogio" src/pages/integrations/LeadIntakeCard.tsx`
Expected: só linhas **dentro** do texto do script (template string `const script = \`...\``), que não são texto de tela.

- [ ] **Step 4: Criar `MetaCard.tsx` e mover o JSX do Pixel**

Create `src/pages/integrations/MetaCard.tsx`:
```tsx
import { useState } from 'react'
import { updateMetaCapi, testMetaCapi, type Account } from '../../lib/api'
import { Loader, Check, Save, RefreshCw, Eye, EyeOff, Activity, AlertTriangle } from 'lucide-react'

interface Props {
  accountId: number
  account: Account
  onAccountUpdated: (patch: Partial<Account>) => void
}

// Card "Meta": Pixel / Conversions API da conta.
export default function MetaCard({ accountId, account, onAccountUpdated }: Props) {
  const [metaPixelId, setMetaPixelId] = useState(account.meta_pixel_id || '')
  const [metaCapiToken, setMetaCapiToken] = useState(account.meta_capi_token || '')
  const [metaPageId, setMetaPageId] = useState(account.meta_page_id || '')
  const [metaEnabled, setMetaEnabled] = useState(!!account.meta_capi_enabled)
  const [showMetaToken, setShowMetaToken] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [metaSaved, setMetaSaved] = useState(false)
  const [testingMeta, setTestingMeta] = useState(false)
  const [metaTestResult, setMetaTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [showTestMetaConfirm, setShowTestMetaConfirm] = useState(false)

  const metaPatch = (): Partial<Account> => ({
    meta_pixel_id: metaPixelId || null,
    meta_capi_token: metaCapiToken || null,
    meta_capi_enabled: metaEnabled ? 1 : 0,
    meta_page_id: metaPageId || null,
  })

  return (
    <>
      META_SECTION
      META_CONFIRM_MODAL
    </>
  )
}
```
Em `Integrations.tsx`, recortar e colar em `MetaCard.tsx`, sem alterar:
1. `META_SECTION` ← o `<section className="dash-section" style={{ marginTop: 24 }}>` que contém `<Activity size={14} /> Meta Pixel / Conversions API`, até o `</section>` correspondente (dentro de `{isGerenteOuAdmin && accountId && account && (`, abaixo de `{/* Meta Pixel / Conversions API — gerente/admin only */}`).
2. `META_CONFIRM_MODAL` ← o bloco `{showTestMetaConfirm && ( ... )}` inteiro (abaixo de `{/* Modal de confirmação — teste de conexão Meta CAPI */}`).

Depois, dentro de `MetaCard.tsx`, em **dois** lugares (o botão Salvar e o botão "Enviar evento Lead" do modal), logo depois de cada `await updateMetaCapi(accountId, { ... })`, acrescentar a linha:
```tsx
                    onAccountUpdated(metaPatch())
```
Em `Integrations.tsx`, apagar o comentário e o `{isGerenteOuAdmin && accountId && account && ( ... )}` do Meta e o comentário + bloco do modal, e colocar no lugar do primeiro:
```tsx
      {isGerenteOuAdmin && accountId && account && (
        <MetaCard accountId={accountId} account={account} onAccountUpdated={p => setAccount(a => a ? { ...a, ...p } : a)} />
      )}
```

- [ ] **Step 5: Criar `AiCard.tsx` com a origem da chave e mover o JSX da chave Anthropic**

Create `src/pages/integrations/AiCard.tsx`:
```tsx
import { useState } from 'react'
import { updateAiConfig, testAnthropic, updateAccount, type Account } from '../../lib/api'
import { Loader, Check, Save, RefreshCw, Eye, EyeOff, Activity, AlertTriangle, KeyRound } from 'lucide-react'

interface Props {
  accountId: number
  account: Account
  isSuperAdmin: boolean
  onAccountUpdated: (patch: Partial<Account>) => void
}

// Card "IA": chave Anthropic da conta, limite mensal e (so admin Dros) origem da chave, usada
// pelos agentes, pelo Copiloto e pelas analises.
export default function AiCard({ accountId, account, isSuperAdmin, onAccountUpdated }: Props) {
  const [anthropicKey, setAnthropicKey] = useState(account.anthropic_api_key || '')
  const [showAnthropicKey, setShowAnthropicKey] = useState(false)
  const [anthropicLimit, setAnthropicLimit] = useState<number>(account.analysis_token_limit || 200000)
  const [savingAnthropic, setSavingAnthropic] = useState(false)
  const [anthropicSaved, setAnthropicSaved] = useState(false)
  const [testingAnthropic, setTestingAnthropic] = useState(false)
  const [anthropicTestResult, setAnthropicTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [keySource, setKeySource] = useState<'client' | 'dros'>(account.ai_key_source === 'dros' ? 'dros' : 'client')
  const [savingKeySource, setSavingKeySource] = useState(false)

  const handleKeySourceChange = async (value: 'client' | 'dros') => {
    const previous = keySource
    setKeySource(value)
    setSavingKeySource(true)
    try {
      await updateAccount(accountId, { ai_key_source: value })
      onAccountUpdated({ ai_key_source: value })
    } catch (e: any) {
      setKeySource(previous)
      alert('Erro ao salvar a origem da chave da IA: ' + (e?.message || ''))
    }
    setSavingKeySource(false)
  }

  return (
    <>
      {isSuperAdmin && (
        <section className="dash-section">
          <div className="section-title"><KeyRound size={14} /> Origem da chave da IA (só admin Dros)</div>
          <div className="card">
            <select className="select" value={keySource} disabled={savingKeySource} onChange={e => handleKeySourceChange(e.target.value as 'client' | 'dros')} style={{ minWidth: 280 }}>
              <option value="client">Chave do cliente (cadastrada abaixo)</option>
              <option value="dros">Chave da Dros</option>
            </select>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
              Vale para todos os agentes de IA, o Copiloto e as análises desta conta. Salva na hora, sem precisar clicar em Salvar.
            </p>
          </div>
        </section>
      )}
      AI_SECTION
    </>
  )
}
```
Em `Integrations.tsx`, recortar e colar em `AiCard.tsx` no lugar de `AI_SECTION`: o `<section className="dash-section" style={{ marginTop: 24 }}>` que contém `<Activity size={14} /> Agentes de IA — API Anthropic`, até o `</section>` correspondente (dentro de `{isGerenteOuAdmin && accountId && account && !!account.ai_agents_enabled && (`).

Depois, dentro de `AiCard.tsx`:
1. Trocar `Agentes de IA — API Anthropic` por `Chave da API Anthropic`.
2. Trocar a condição do aviso `{!anthropicKey.trim() && (` por `{!anthropicKey.trim() && keySource !== 'dros' && (` (com a chave da Dros, não falta nada).
3. Logo depois de `await updateAiConfig(accountId, { anthropic_api_key: anthropicKey || null, analysis_token_limit: anthropicLimit || 200000 })`, acrescentar:
```tsx
                    onAccountUpdated({ anthropic_api_key: anthropicKey || null, analysis_token_limit: anthropicLimit || 200000 })
```
Em `Integrations.tsx`, trocar o comentário `{/* Agentes de IA — API Anthropic por conta ... */}` e o bloco `{isGerenteOuAdmin && accountId && account && !!account.ai_agents_enabled && ( ... )}` por:
```tsx
      {isGerenteOuAdmin && accountId && account && !!account.ai_agents_enabled && (
        <AiCard accountId={accountId} account={account} isSuperAdmin={user?.role === 'super_admin'} onAccountUpdated={p => setAccount(a => a ? { ...a, ...p } : a)} />
      )}
```

- [ ] **Step 6: Limpar o que ficou sem uso em `Integrations.tsx`**

1. Imports novos no topo:
```tsx
import LeadIntakeCard from './integrations/LeadIntakeCard'
import MetaCard from './integrations/MetaCard'
import AiCard from './integrations/AiCard'
```
2. Apagar a função `sheetsTimeAgo` e o `import { parseSqlDate } ...` (foram para o card).
3. Apagar os estados e funções que foram para os cards: `accountSlug`/`setAccountSlug`, `sheetsCopied`, `sheetsTabName`, `scriptCopied`, `publicBaseUrl` e o `useEffect` do `fetchPublicConfig`, `metaPixelId` … `showTestMetaConfirm` (10 estados do Meta), `anthropicKey` … `anthropicTestResult` (7 estados da IA), `sheetsLastAt`, `sheetsDefaultTagId`, `sheetsTagSaving`, `routingMappings`, `routingDefaultId`, `routingTags`, `routingEdit`, `routingSaving`, `loadRouting` e seu `useEffect`, o `useEffect` do `fetchSheetsStatus`, `handleChangeSheetsDefaultTag`, `handleChangeDefaultRouting`, `startRoutingEdit`, `handleSaveRouting`, `handleDeleteRouting`.
4. No `load`, trocar o `.then((d: any) => { ... })` do `apiFetch(\`/api/accounts/${accountId}\`)` por:
```tsx
    apiFetch(`/api/accounts/${accountId}`).then((d: any) => {
      setAccount(d.account || null)
    }).catch(() => {})
```
5. Na lista de imports de `../lib/api`, remover os que não são mais usados neste arquivo: `fetchPublicConfig`, `updateMetaCapi`, `testMetaCapi`, `updateAiConfig`, `testAnthropic`, `fetchTags`, `fetchTagInstanceMappings`, `upsertTagInstanceMapping`, `deleteTagInstanceMapping`, `fetchDefaultFormInstance`, `setDefaultFormInstance`, `fetchSheetsStatus`, `setSheetsDefaultTag`, `type Tag`, `type TagInstanceMapping`.

Run: `grep -n "routing\|sheets\|meta[A-Z]\|anthropic" src/pages/Integrations.tsx`
Expected: nenhuma linha.

- [ ] **Step 7: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC; `✓ built`.

- [ ] **Step 8: Verificação no navegador**

Com `npm run dev` rodando, em `http://localhost:5175/crm/` (admin, conta 1) → Integrações:
1. Roteamento: trocar o **Número padrão** e voltar. Esperado: salva sem erro (sem recarregar a página).
2. Google Planilhas: o link do webhook aparece com o slug da conta; **Copiar script** copia; os textos da tabela do Step 3 aparecem acentuados.
3. Meta: marcar/desmarcar "Ativar envio de eventos pro Meta", Salvar → "Salvo".
4. IA (conta com agentes habilitados): como super_admin, aparece "Origem da chave da IA"; trocar para "Chave da Dros" e voltar. Esperado: salva na hora; com "Chave da Dros" o aviso amarelo "falta cadastrar" some.

- [ ] **Step 9: Commit**

```bash
git add src/pages/integrations/LeadIntakeCard.tsx src/pages/integrations/MetaCard.tsx src/pages/integrations/AiCard.tsx src/pages/Integrations.tsx
git commit -m "refactor: cards de entrada de leads, meta e ia em arquivos proprios

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Card WhatsApp (provedor por número, QR ou painel) e a casca com 4 cards

**Files:**
- Create: `src/pages/integrations/WhatsAppCard.tsx`
- Rewrite: `src/pages/Integrations.tsx` (substituir o arquivo inteiro)

**Interfaces:**
- Consumes: Task 4 (`providerLabel`, `qrImageSrc`), Task 5 (`fetchWhatsAppProviders`, `refreshWhatsAppQR → QrCodeResult`, `createWhatsAppInstance` com `provider`, `WhatsAppProviderId`), Task 6 (`NumberSettingsModal`), Task 7 (os 3 cards).
- Produces: `WhatsAppCard({ accountId: number; instances: WhatsAppInstance[]; setInstances: Dispatch<SetStateAction<WhatsAppInstance[]>>; reload: () => Promise<void>; users: User[] })`; a página aceita `?card=whatsapp|leads|meta|ia` (a Task 9 usa `/integrations?card=ia`).

- [ ] **Step 1: Criar o card WhatsApp**

Create `src/pages/integrations/WhatsAppCard.tsx`:
```tsx
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useAuth } from '../../context/AuthContext'
import {
  createWhatsAppInstance, connectWhatsAppInstance, checkWhatsAppStatus, refreshWhatsAppQR,
  disconnectWhatsApp, deleteWhatsAppInstance, fetchEvolutionConfig, saveEvolutionConfig,
  setupWhatsAppWebhook, restartWhatsAppInstance, syncWhatsAppNow, setInstanceAttendant, setInstanceMode,
  fetchWhatsAppProviders,
  type WhatsAppInstance, type User as UserType, type WhatsAppProviderId,
} from '../../lib/api'
import { providerLabel, qrImageSrc } from '../../lib/whatsappProviders.js'
import {
  Plus, Wifi, WifiOff, Loader, Trash2, QrCode, Power, PowerOff, RefreshCw, Smartphone, Save, Check,
  Settings, Webhook, RotateCw, Download, User, MessageSquare, ExternalLink,
} from 'lucide-react'
import NumberSettingsModal from '../../components/NumberSettingsModal'

interface Props {
  accountId: number
  instances: WhatsAppInstance[]
  setInstances: Dispatch<SetStateAction<WhatsAppInstance[]>>
  reload: () => Promise<void>
  users: UserType[]
}

const isEvolution = (inst: WhatsAppInstance) => (inst.provider || 'evolution') === 'evolution'

const statusColor = (status: string) => status === 'connected' ? '#34C759' : status === 'connecting' ? '#FBBC04' : '#FF6B6B'
const statusLabel = (status: string) => status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Aguardando QR...' : 'Desconectado'
const statusIcon = (status: string) => {
  if (status === 'connected') return <Wifi size={14} />
  if (status === 'connecting') return <Loader size={14} className="spinning" />
  return <WifiOff size={14} />
}

// Card "WhatsApp": numeros da conta, provedor de cada numero (UzAPI ou Evolution), QR / painel,
// "leads novos vao para", modo de recebimento, mensagens do numero e credenciais da Evolution (recolhidas).
export default function WhatsAppCard({ accountId, instances, setInstances, reload, users }: Props) {
  const { user } = useAuth()
  const isGerenteOuAdmin = user?.role === 'gerente' || user?.role === 'super_admin'

  const [providers, setProviders] = useState<WhatsAppProviderId[]>(['evolution'])
  const [evoUrl, setEvoUrl] = useState('')
  const [evoKey, setEvoKey] = useState('')
  const [evoConfigured, setEvoConfigured] = useState(false)
  const [evoSaved, setEvoSaved] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'open' | 'restricted'>('open')
  const [newProvider, setNewProvider] = useState<WhatsAppProviderId>('evolution')
  const [creating, setCreating] = useState(false)

  const [activeQR, setActiveQR] = useState<number | null>(null)
  const [panelUrls, setPanelUrls] = useState<Record<number, string>>({})
  const [qrLoading, setQrLoading] = useState<number | null>(null)
  const pollRef = useRef<Record<number, ReturnType<typeof setInterval>>>({})

  const [settingsInstance, setSettingsInstance] = useState<WhatsAppInstance | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<WhatsAppInstance | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [reconfiguring, setReconfiguring] = useState<number | null>(null)
  const [restarting, setRestarting] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetchEvolutionConfig(accountId).then(c => {
      setEvoUrl(c.api_url || '')
      setEvoKey(c.api_key || '')
      setEvoConfigured(typeof c.configured === 'boolean' ? c.configured : !!(c.api_url && c.api_key))
    }).catch(() => {})
    fetchWhatsAppProviders(accountId).then(setProviders)
  }, [accountId])

  // Enquanto um numero esta "connecting", confere o status a cada 5s (o QR da UzAPI pode chegar depois, pelo aviso).
  useEffect(() => {
    Object.values(pollRef.current).forEach(clearInterval)
    pollRef.current = {}
    instances.forEach(inst => {
      if (inst.status !== 'connecting') return
      pollRef.current[inst.id] = setInterval(async () => {
        try {
          const { instance: updated } = await checkWhatsAppStatus(inst.id, accountId)
          setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
          if (updated.status === 'connected') {
            clearInterval(pollRef.current[updated.id])
            delete pollRef.current[updated.id]
            setActiveQR(cur => cur === updated.id ? null : cur)
          }
        } catch {}
      }, 5000)
    })
    return () => { Object.values(pollRef.current).forEach(clearInterval); pollRef.current = {} }
  }, [instances.map(i => `${i.id}:${i.status}`).join(','), accountId])

  const canCreate = evoConfigured || providers.includes('uzapi')
  const hasUzapi = providers.includes('uzapi')

  const handleSaveConfig = async () => {
    if (!evoUrl || !evoKey) return
    setSavingConfig(true)
    try {
      await saveEvolutionConfig(accountId, { api_url: evoUrl, api_key: evoKey })
      setEvoConfigured(true)
      setEvoSaved(true)
      setTimeout(() => setEvoSaved(false), 2000)
    } catch (e: any) { alert('Erro: ' + e.message) }
    setSavingConfig(false)
  }

  const openQr = async (inst: WhatsAppInstance) => {
    setActiveQR(inst.id)
    setQrLoading(inst.id)
    try {
      const r = await refreshWhatsAppQR(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === inst.id ? { ...i, qr_code: r.qr_code, status: r.status || 'connecting' } : i))
      setPanelUrls(prev => {
        const next = { ...prev }
        if (r.panel_url) next[inst.id] = r.panel_url
        else delete next[inst.id]
        return next
      })
    } catch (e: any) { alert('Erro ao gerar o QR code: ' + e.message) }
    setQrLoading(null)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const inst = await createWhatsAppInstance(accountId, { instance_name: newName.trim(), lead_intake_mode: newMode, provider: newProvider })
      const chosen = newProvider
      setShowNew(false); setNewName(''); setNewMode('open'); setNewProvider('evolution')
      await reload()
      if (inst.qr_code) setActiveQR(inst.id)
      else if ((inst.provider || chosen) !== 'evolution') await openQr(inst)
    } catch (e: any) { alert('Erro: ' + e.message) }
    setCreating(false)
  }

  const handleConnect = async (inst: WhatsAppInstance) => {
    if (!isEvolution(inst)) { await openQr(inst); return }
    try {
      const updated = await connectWhatsAppInstance(inst.id, accountId)
      setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
      if (updated.qr_code) setActiveQR(updated.id)
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleDisconnect = async (inst: WhatsAppInstance) => {
    try { await disconnectWhatsApp(inst.id, accountId) } catch (e: any) { alert('Erro: ' + e.message) }
    setActiveQR(null)
    await reload()
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteWhatsAppInstance(deleteTarget.id, accountId)
      setActiveQR(null)
      setDeleteTarget(null)
      await reload()
    } catch (e: any) { alert('Erro ao excluir: ' + e.message) }
    setDeleting(false)
  }

  const handleReconfigureWebhook = async (inst: WhatsAppInstance) => {
    setReconfiguring(inst.id)
    try {
      await setupWhatsAppWebhook(inst.id, accountId)
      alert('Webhook reconfigurado. Os leads voltam a entrar em tempo real.')
    } catch (e: any) { alert('Erro ao reconfigurar o webhook: ' + e.message) }
    setReconfiguring(null)
  }

  const handleRestart = async (inst: WhatsAppInstance) => {
    if (!confirm(`Reiniciar a sessão do WhatsApp "${inst.instance_name}"? Use quando o número parece conectado mas não recebe mensagens.`)) return
    setRestarting(inst.id)
    try {
      await restartWhatsAppInstance(inst.id, accountId)
      alert('Sessão reiniciada. Aguarde 10 segundos e teste enviando uma mensagem.')
      await reload()
    } catch (e: any) { alert('Erro ao reiniciar: ' + e.message) }
    setRestarting(null)
  }

  const handleSyncNow = async () => {
    setSyncing(true)
    try {
      await syncWhatsAppNow(accountId)
      alert('Sincronização feita. Confira o Chat: leads novos devem aparecer.')
    } catch (e: any) { alert('Erro ao sincronizar: ' + e.message) }
    setSyncing(false)
  }

  const handleAttendantChange = async (inst: WhatsAppInstance, attendantId: number | null) => {
    try {
      const { instance } = await setInstanceAttendant(inst.id, accountId, attendantId)
      setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, ...instance } : i))
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const handleModeChange = async (inst: WhatsAppInstance, mode: 'open' | 'restricted') => {
    if (mode === 'restricted') {
      const ok = confirm(
        'Trocar para o modo RESTRITO?\n\n' +
        'Mensagens de números desconhecidos serão IGNORADAS: só entram leads já cadastrados no CRM (formulário, planilha ou Novo chat).\n\n' +
        'As conversas atuais continuam normais. Para voltar, troque o modo de novo.'
      )
      if (!ok) return
    }
    try {
      const { instance } = await setInstanceMode(inst.id, accountId, mode)
      setInstances(prev => prev.map(i => i.id === instance.id ? { ...i, ...instance } : i))
    } catch (e: any) { alert('Erro: ' + e.message) }
  }

  const qrInstance = instances.find(i => i.id === activeQR)
  const qrSrc = qrImageSrc(qrInstance?.qr_code)
  const panelUrl = qrInstance ? panelUrls[qrInstance.id] : undefined
  const attendantOptions = users.filter(u => u.is_active && (u.role === 'atendente' || u.role === 'gerente'))

  return (
    <>
      <section className="dash-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="section-title" style={{ margin: 0 }}><Smartphone size={14} /> Números de WhatsApp</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {instances.some(i => i.status === 'connected' && isEvolution(i)) && (
              <button className="btn btn-secondary btn-sm" onClick={handleSyncNow} disabled={syncing} title="Busca agora mensagens perdidas nos números da Evolution conectados.">
                {syncing ? <Loader size={14} className="spinning" /> : <Download size={14} />} Sincronizar agora
              </button>
            )}
            {canCreate && (
              <button className="btn btn-primary btn-sm" onClick={() => setShowNew(true)}><Plus size={14} /> Conectar número</button>
            )}
          </div>
        </div>

        {qrInstance && qrInstance.status !== 'connected' && (
          <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
              <QrCode size={20} style={{ color: '#FFB300' }} />
              <h2 style={{ fontSize: 18, margin: 0 }}>Conectar {qrInstance.instance_name} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>({providerLabel(qrInstance.provider)})</span></h2>
            </div>
            {qrLoading === qrInstance.id ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}><Loader size={14} className="spinning" /> Gerando o QR code...</p>
            ) : qrSrc ? (
              <>
                <div style={{ background: '#fff', display: 'inline-block', padding: 16, borderRadius: 12, marginBottom: 12 }}>
                  <img src={qrSrc} alt="QR code do WhatsApp" style={{ width: 280, height: 280, display: 'block' }} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.6 }}>
                  <p><strong>1.</strong> Abra o WhatsApp no celular</p>
                  <p><strong>2.</strong> Toque em <strong>Configurações → Aparelhos conectados → Conectar aparelho</strong></p>
                  <p><strong>3.</strong> Aponte a câmera para este QR code</p>
                </div>
              </>
            ) : panelUrl ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                O QR deste número fica no painel da UzAPI. Abra o painel, escaneie o QR com o WhatsApp do celular e volte aqui: o status muda sozinho para Conectado.
              </p>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto', lineHeight: 1.6 }}>
                O QR ainda não chegou. Clique em Atualizar QR em alguns segundos.
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              {panelUrl && (
                <a className="btn btn-primary btn-sm" href={panelUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> Abrir painel da UzAPI</a>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => openQr(qrInstance)} disabled={qrLoading === qrInstance.id}><RefreshCw size={12} /> Atualizar QR</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setActiveQR(null)}>Fechar</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {instances.map(inst => (
            <div key={inst.id} className="card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: `${statusColor(inst.status)}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Smartphone size={18} style={{ color: statusColor(inst.status) }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {inst.instance_name}
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                        {providerLabel(inst.provider)}
                      </span>
                    </div>
                    {inst.phone_number && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{inst.phone_number}</div>}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <User size={11} /> Leads novos vão para:
                      <select
                        className="select"
                        value={inst.default_attendant_id ?? ''}
                        onChange={e => handleAttendantChange(inst, e.target.value ? parseInt(e.target.value) : null)}
                        style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180 }}
                        title="Quando uma mensagem chega neste número, o lead criado vai para este atendente. Em branco, usa a roleta do funil."
                      >
                        <option value="">Roleta do funil</option>
                        {attendantOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                      Modo:
                      <select
                        className="select"
                        value={inst.lead_intake_mode || 'open'}
                        onChange={e => handleModeChange(inst, e.target.value as 'open' | 'restricted')}
                        style={{ height: 26, fontSize: 11, padding: '2px 8px', minWidth: 180, color: inst.lead_intake_mode === 'restricted' ? '#FBBC04' : undefined }}
                        title={inst.lead_intake_mode === 'restricted' ? 'Restrito: só processa mensagens de leads já cadastrados. Números novos são ignorados.' : 'Aberto: qualquer mensagem cria lead novo.'}
                      >
                        <option value="open">Aberto (recebe todos)</option>
                        <option value="restricted">Restrito (só leads cadastrados)</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: statusColor(inst.status) }}>
                    {statusIcon(inst.status)} {statusLabel(inst.status)}
                  </span>
                  {inst.status === 'disconnected' && (
                    <button className="btn btn-primary btn-sm" onClick={() => handleConnect(inst)}><Power size={12} /> Conectar</button>
                  )}
                  {inst.status === 'connecting' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => activeQR === inst.id ? setActiveQR(null) : openQr(inst)}>
                      <QrCode size={12} /> {activeQR === inst.id ? 'Ocultar QR' : 'Ver QR'}
                    </button>
                  )}
                  {inst.status === 'connected' && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleReconfigureWebhook(inst)} disabled={reconfiguring === inst.id} title="Reenvia ao provedor o endereço de avisos deste número. Use se os leads pararem de entrar em tempo real.">
                        {reconfiguring === inst.id ? <Loader size={12} className="spinning" /> : <Webhook size={12} />} Webhook
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleRestart(inst)} disabled={restarting === inst.id} title="Reinicia a sessão do WhatsApp no provedor. Use quando aparece Conectado mas não recebe nem envia.">
                        {restarting === inst.id ? <Loader size={12} className="spinning" /> : <RotateCw size={12} />} Reiniciar sessão
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDisconnect(inst)}><PowerOff size={12} /> Desconectar</button>
                    </>
                  )}
                  {(isGerenteOuAdmin || user?.primary_instance_id === inst.id) && (
                    <button className="btn btn-secondary btn-sm" onClick={() => setSettingsInstance(inst)} title="Primeira mensagem, horário de atendimento e ausência deste número">
                      <MessageSquare size={12} /> Mensagens do número
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm btn-icon" onClick={() => setDeleteTarget(inst)} title="Excluir"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          ))}
          {instances.length === 0 && (
            <div className="empty-state" style={{ minHeight: 120 }}>
              <h3>Nenhum número conectado</h3>
              <p>{canCreate ? 'Clique em "Conectar número" para adicionar um número.' : 'Configure as credenciais da Evolution abaixo para começar.'}</p>
            </div>
          )}
        </div>
      </section>

      {isGerenteOuAdmin && (
        <details className="card" style={{ padding: '12px 16px', marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Settings size={14} /> Credenciais da Evolution desta conta
            {evoConfigured && <span style={{ color: '#34C759', fontSize: 11, fontWeight: 500 }}>· configurada</span>}
          </summary>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '12px 0' }}>URL e chave do servidor Evolution usadas pelos números desta conta que estão na Evolution. Números da UzAPI não usam estas credenciais.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>URL da API</label>
              <input className="input" value={evoUrl} onChange={e => setEvoUrl(e.target.value)} placeholder="https://evo.exemplo.com.br" />
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Key</label>
              <input className="input" type="password" value={evoKey} onChange={e => setEvoKey(e.target.value)} placeholder="sua-api-key" />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveConfig} disabled={savingConfig || !evoUrl || !evoKey} style={{ height: 38 }}>
                {evoSaved ? <><Check size={14} /> Salvo</> : <><Save size={14} /> Salvar</>}
              </button>
            </div>
          </div>
        </details>
      )}

      {showNew && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 560 }}>
            <h2>Conectar número de WhatsApp</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Dê um nome para identificar este número (ex.: Comercial, Suporte, Vendas).</p>

            {hasUzapi && (
              <div className="form-group">
                <label style={{ display: 'block', marginBottom: 8 }}>Provedor deste número</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {providers.map(p => (
                    <label key={p} style={{ flex: 1, minWidth: 180, padding: 10, borderRadius: 8, cursor: 'pointer', border: `1px solid ${newProvider === p ? 'var(--accent)' : 'var(--border-medium)'}`, background: newProvider === p ? 'rgba(255,179,0,0.06)' : 'transparent' }}>
                      <input type="radio" name="new-provider" checked={newProvider === p} onChange={() => setNewProvider(p)} style={{ marginRight: 6 }} />
                      <strong>{providerLabel(p)}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginLeft: 22 }}>
                        {p === 'uzapi' ? 'A conexão fica fora do servidor da Dros. O QR aparece aqui ou no painel da UzAPI.' : 'Servidor Evolution configurado nas credenciais desta conta.'}
                      </div>
                    </label>
                  ))}
                </div>
                {newProvider === 'evolution' && !evoConfigured && (
                  <p style={{ fontSize: 11, color: '#FBBC04', marginTop: 6 }}>Configure antes as credenciais da Evolution (no fim deste card) ou escolha a UzAPI.</p>
                )}
              </div>
            )}

            <div className="form-group">
              <label>Nome do número</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ex.: Comercial" autoFocus onKeyDown={e => e.key === 'Enter' && handleCreate()} />
            </div>

            <div className="form-group" style={{ marginTop: 16 }}>
              <label style={{ display: 'block', marginBottom: 8 }}>Modo de recebimento de leads</label>
              {(['open', 'restricted'] as const).map(m => (
                <div
                  key={m}
                  onClick={() => setNewMode(m)}
                  style={{ padding: 12, marginBottom: 8, borderRadius: 8, cursor: 'pointer', border: `1px solid ${newMode === m ? (m === 'open' ? '#FFB300' : '#FBBC04') : 'var(--border-medium)'}`, background: newMode === m ? 'rgba(255,179,0,0.06)' : 'transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <input type="radio" checked={newMode === m} onChange={() => setNewMode(m)} style={{ marginTop: 3 }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{m === 'open' ? 'Aberto (recomendado)' : 'Restrito'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {m === 'open'
                          ? 'Recebe leads de todo mundo que mandar mensagem para este WhatsApp. Atendimento comercial padrão.'
                          : 'Recebe apenas mensagens de leads já cadastrados no CRM (formulário, planilha ou "Novo chat"). Números desconhecidos são ignorados. Ideal para quem usa o WhatsApp pessoal também como comercial.'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNew(false)} disabled={creating}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newName.trim() || (newProvider === 'evolution' && !evoConfigured)}>
                {creating ? 'Criando...' : 'Conectar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {settingsInstance && (
        <NumberSettingsModal
          instance={settingsInstance}
          accountId={accountId}
          canEditFirstMessage={isGerenteOuAdmin || user?.primary_instance_id === settingsInstance.id}
          canManageFunnels={isGerenteOuAdmin}
          onClose={() => setSettingsInstance(null)}
          onSaved={updated => { setInstances(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i)); setSettingsInstance(null) }}
        />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Trash2 size={20} style={{ color: '#ef4444' }} /> Excluir número
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
              Tem certeza de que quer excluir o número <strong style={{ color: 'var(--text-primary)' }}>"{deleteTarget.instance_name}"</strong>?
              <br /><br />
              Ele sai do CRM e do provedor ({providerLabel(deleteTarget.provider)}). As mensagens antigas continuam no histórico dos leads, mas <strong>este número não vai mais receber nem enviar mensagens</strong>. Não dá para desfazer.
            </p>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancelar</button>
              <button className="btn" disabled={deleting} onClick={confirmDelete} style={{ background: '#ef4444', color: 'white', border: 'none' }}>
                {deleting ? 'Excluindo...' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Reescrever `Integrations.tsx` como casca dos 4 cards**

Substituir o conteúdo inteiro de `src/pages/Integrations.tsx` por:
```tsx
import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAccount } from '../context/AccountContext'
import { useAuth } from '../context/AuthContext'
import { fetchWhatsAppInstances, fetchUsers, fetchAccount, type WhatsAppInstance, type User as UserType, type Account } from '../lib/api'
import { Plug, Smartphone, GitBranch, Activity, Bot } from 'lucide-react'
import { BlockedBanner } from '../components/BlockedBanner'
import WhatsAppCard from './integrations/WhatsAppCard'
import LeadIntakeCard from './integrations/LeadIntakeCard'
import MetaCard from './integrations/MetaCard'
import AiCard from './integrations/AiCard'

type CardId = 'whatsapp' | 'leads' | 'meta' | 'ia'

interface CardTile { id: CardId; label: string; icon: ReactNode; status: string; visible: boolean }

// Integracoes em 4 cards (spec provedor-whatsapp §5.1): WhatsApp / Entrada de leads / Meta / IA.
// O card aberto fica na URL (?card=ia) para outras telas poderem apontar direto para ele.
export default function Integrations() {
  const { accountId } = useAccount()
  const { user } = useAuth()
  const isAtendente = user?.role === 'atendente'
  const isGerenteOuAdmin = user?.role === 'gerente' || user?.role === 'super_admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [users, setUsers] = useState<UserType[]>([])
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)

  const reloadInstances = useCallback(async () => {
    if (!accountId) return
    try { setInstances(await fetchWhatsAppInstances(accountId)) } catch {}
  }, [accountId])

  useEffect(() => {
    if (!accountId) return
    setLoading(true)
    Promise.all([
      reloadInstances(),
      fetchUsers(accountId).then(setUsers).catch(() => {}),
      fetchAccount(accountId).then(d => setAccount(d.account || null)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [accountId, reloadInstances])

  const updateAccountLocal = (patch: Partial<Account>) => setAccount(a => a ? { ...a, ...patch } : a)

  if (!accountId) return <div className="loading-container"><span>Selecione uma conta</span></div>
  if (loading) return <div className="loading-container"><div className="spinner" /></div>

  const connected = instances.filter(i => i.status === 'connected').length
  const hasAiKey = !!(account?.anthropic_api_key || account?.ai_key_source === 'dros')
  const tiles: CardTile[] = [
    { id: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} />, status: instances.length === 0 ? 'Nenhum número' : `${connected} de ${instances.length} conectado(s)`, visible: true },
    { id: 'leads', label: 'Entrada de leads', icon: <GitBranch size={16} />, status: 'Formulários e Google Planilhas', visible: isGerenteOuAdmin && !!account },
    { id: 'meta', label: 'Meta', icon: <Activity size={16} />, status: account?.meta_capi_enabled ? 'Pixel ativo' : 'Pixel desligado', visible: isGerenteOuAdmin && !!account },
    { id: 'ia', label: 'IA', icon: <Bot size={16} />, status: hasAiKey ? 'Chave configurada' : 'Falta a chave', visible: isGerenteOuAdmin && !!account && !!account.ai_agents_enabled },
  ]
  const visible = tiles.filter(t => t.visible)
  const requested = searchParams.get('card')
  const current: CardId = visible.find(t => t.id === requested)?.id || 'whatsapp'

  return (
    <div>
      <div className="page-header">
        <h1><Plug size={20} style={{ marginRight: 8 }} />Integrações</h1>
      </div>

      {isAtendente && !user?.primary_instance_id && (
        <BlockedBanner message="Você ainda não tem WhatsApp atribuído. Peça ao gerente para atribuir em Equipe > Editar, ou conecte um número abaixo (você vira o dono automaticamente)." />
      )}

      {visible.length > 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
          {visible.map(t => (
            <button
              key={t.id}
              type="button"
              className="card"
              onClick={() => setSearchParams({ card: t.id }, { replace: true })}
              style={{ textAlign: 'left', padding: '12px 14px', cursor: 'pointer', border: `1px solid ${current === t.id ? 'var(--accent)' : 'var(--border-subtle)'}`, background: current === t.id ? 'rgba(255,179,0,0.06)' : undefined }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14, color: current === t.id ? 'var(--accent)' : 'var(--text-primary)' }}>
                {t.icon} {t.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{t.status}</div>
            </button>
          ))}
        </div>
      )}

      {current === 'whatsapp' && (
        <WhatsAppCard accountId={accountId} instances={instances} setInstances={setInstances} reload={reloadInstances} users={users} />
      )}
      {current === 'leads' && account && (
        <LeadIntakeCard accountId={accountId} account={account} instances={instances} users={users} />
      )}
      {current === 'meta' && account && (
        <MetaCard accountId={accountId} account={account} onAccountUpdated={updateAccountLocal} />
      )}
      {current === 'ia' && account && (
        <AiCard accountId={accountId} account={account} isSuperAdmin={user?.role === 'super_admin'} onAccountUpdated={updateAccountLocal} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC; `✓ built`.

- [ ] **Step 4: Verificação no navegador — sem UzAPI configurada**

Com o `.env` local **sem** `UZAPI_USERNAME`/`UZAPI_ACCOUNT_TOKEN` (reiniciar `npm run dev` depois de mexer no `.env`), em `http://localhost:5175/crm/integrations` (admin, conta 1):
1. Aparecem 4 blocos no topo: WhatsApp / Entrada de leads / Meta / IA (IA só se a conta tem agentes habilitados). Clicar em cada um troca o conteúdo e a URL (`?card=leads` etc.). Recarregar a página com `?card=meta` abre o Meta.
2. Card WhatsApp: cada número mostra o selo **Evolution**; "Credenciais da Evolution desta conta" aparece **recolhido** no fim e abre ao clicar.
3. **Conectar número**: o modal **não** mostra a escolha de provedor (só Evolution disponível); criar um número de teste "Teste Evolution" leva ao QR como antes. Excluir o número de teste pelo ícone de lixeira: o texto diz "do provedor (Evolution)".
4. Salvar o Meta, ir para IA e voltar para Meta: os valores salvos continuam na tela (sem recarregar).
5. Entrar como um **atendente** (criar um em Equipe, se preciso): só aparece o card WhatsApp, sem os blocos do topo.

- [ ] **Step 5: Verificação no navegador — com UzAPI configurada**

Preencher no `.env` local as variáveis da UzAPI que o plano do servidor definiu (credenciais de teste em `Documents/uzapi-teste.env`) e reiniciar `npm run dev`:
1. `GET` da lista: no DevTools (aba Rede), a chamada `whatsapp/providers` responde com a UzAPI.
2. **Conectar número** mostra a escolha "Evolution" (marcada) / "UzAPI (estável)". Escolher UzAPI, nome "Teste UzAPI", Conectar. Esperado: o painel de conexão abre e mostra **ou** o QR (imagem) **ou** o texto do painel com o botão **Abrir painel da UzAPI** (quando o servidor devolve `panel_url`), que abre em outra aba.
3. O número aparece na lista com o selo **UzAPI (estável)** e status "Aguardando QR..."; escaneando o QR (ou pelo painel), o status passa para **Conectado** sozinho em até ~5 s e o painel do QR fecha.
4. Com o número UzAPI conectado, o botão "Sincronizar agora" só aparece se houver algum número **Evolution** conectado.
5. Excluir o número de teste: o texto diz "do provedor (UzAPI (estável))".

- [ ] **Step 6: Commit**

```bash
git add src/pages/integrations/WhatsAppCard.tsx src/pages/Integrations.tsx
git commit -m "feat: integracoes em 4 cards com escolha de provedor por numero

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Editor do agente de 8 para 4 abas

O estado do formulário continua todo no próprio `AgentEditorModal.tsx` (são ~40 campos; espalhar em arquivos exigiria dezenas de props). A mudança é de **agrupamento**: os blocos que já existem passam a aparecer em 4 abas, com títulos de seção. A ordem dos blocos no arquivo já é a ordem das abas novas (identidade, quando atuar | treinamento, qualificação | handoff, áudio, follow-up | custo + simulador), então quase tudo é troca de condição.

| Aba nova | Blocos (na ordem) |
|---|---|
| **Geral** | Identidade e modo (liga/desliga, "Como a IA atua", nome, identifica como IA) + Quando atuar (ativação, números, etapas, tag, saudação por IA para leads de planilha) |
| **Perfil** | Montar com entrevista (botão novo) + Treinamento (tom, conhecimento, nunca mencionar) + Qualificação (critério, campos obrigatórios) |
| **Atendimento** | Passagem para humano (limite de mensagens e palavras, que saem da Qualificação, + regras por motivo) + Áudio + Follow-up de inatividade |
| **Resultados** | Custo do mês (limite e uso) + Simulador |

**Files:**
- Modify: `src/components/AgentEditorModal.tsx`

**Interfaces:**
- Consumes: `briefingFromAgent(agentId, accountId): Promise<{ briefing_id: number }>` (já existe em `api.ts`).
- Produces: `export type AgentEditorTab = 'geral' | 'perfil' | 'atendimento' | 'resultados'` e a prop nova `initialTab?: AgentEditorTab` (Task 10 usa as duas).

- [ ] **Step 1: Imports, textos de ativação, tipo das abas e título de seção**

Trocar o bloco de imports do topo (linhas 1-12 hoje) por:
```tsx
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  fetchAgent, createAgent, updateAgent, testAgent, fetchAgentUsage,
  fetchWhatsAppInstances, fetchFunnels, fetchUsers, fetchTags,
  fetchAgentInactivityFollowUp, saveAgentInactivityFollowUp, briefingFromAgent,
  type AgentMode,
  type Agent, type AgentInput, type AgentHandoffReason, type AgentActivationMode,
  type AgentHandoffRule,
  type WhatsAppInstance, type Funnel, type User, type Tag,
} from '../lib/api'
import { Bot, X, Save, Send, BookOpen, ArrowRightLeft, DollarSign, Play, AlertCircle, Plus, Trash2, MessageSquare } from 'lucide-react'
```
Trocar a linha `{ key: 'max_messages', label: 'Estourou limite de msgs', desc: 'Passou do max sem qualificar' },` por:
```tsx
  { key: 'max_messages', label: 'Passou do limite de mensagens', desc: 'Chegou ao limite sem qualificar' },
```
Trocar a constante `ACTIVATION_MODES` inteira por:
```tsx
const ACTIVATION_MODES: { value: AgentActivationMode; label: string; desc: string }[] = [
  { value: 'default_attendant', label: 'Atendente padrão do número', desc: 'O agente vira o atendente padrão dos números marcados: todo lead novo cai nele.' },
  { value: 'roulette', label: 'Roleta', desc: 'O agente entra na roleta dos números marcados e divide os leads com as pessoas.' },
  { value: 'conditional', label: 'Por condição', desc: 'O agente atua quando a etapa e a tag abaixo baterem, sem ser o atendente designado.' },
  { value: 'manual', label: 'Manual', desc: 'Só atende quando o gerente atribuir o lead a ele.' },
]
```
Trocar a linha `type Tab = 'identity' | 'when' | 'training' | 'qualification' | 'handoff' | 'audio' | 'followup' | 'cost'` por:
```tsx
export type AgentEditorTab = 'geral' | 'perfil' | 'atendimento' | 'resultados'
type Tab = AgentEditorTab

function SectionHeading({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <h3 style={{ fontSize: 13, fontWeight: 700, margin: first ? '0 0 10px' : '20px 0 10px', paddingTop: first ? 0 : 14, borderTop: first ? 'none' : '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
      {children}
    </h3>
  )
}
```

- [ ] **Step 2: Prop `initialTab`, navegação e remoção da origem da chave**

1. Em `interface Props`, acrescentar `initialTab?: AgentEditorTab`.
2. Trocar a assinatura `export default function AgentEditorModal({ agentId, accountId, onClose, onSaved }: Props) {` por `export default function AgentEditorModal({ agentId, accountId, initialTab, onClose, onSaved }: Props) {`.
3. Trocar `const [tab, setTab] = useState<Tab>('identity')` por:
```tsx
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>(initialTab || 'geral')
  const [openingInterview, setOpeningInterview] = useState(false)
```
4. Apagar as linhas `const [keySource, setKeySource] = ...` e `const [savingKeySource, setSavingKeySource] = ...`, o `useEffect` inteiro com o comentário `// Fonte da chave da IA (so admin da Dros ve e troca)` e a função `handleKeySourceChange` inteira (a origem da chave foi para Integrações → IA na Task 7).
5. Logo depois da função `handleSandbox`, acrescentar:
```tsx
  const handleOpenInterview = async () => {
    if (isNew) return
    if (!confirm('Abrir a conversa com a IA para ajustar este agente?\n\nAlterações que você ainda não salvou neste editor serão perdidas.')) return
    setOpeningInterview(true)
    try {
      const r = await briefingFromAgent(agentId as number, accountId)
      navigate(`/agents/interview/${r.briefing_id}`)
    } catch (e: any) {
      alert('Erro: ' + (e?.message || 'Não consegui iniciar a conversa com a IA.'))
      setOpeningInterview(false)
    }
  }
```
6. Em `handleSave`, trocar os três textos: `'Aba Follow-up: escolha a instância antes de salvar.'` → `'Aba Atendimento (follow-up): escolha o número antes de salvar.'`; `'Aba Follow-up: todos os steps precisam de mensagem.'` → `'Aba Atendimento (follow-up): todos os passos precisam de mensagem.'`; `'Agente salvo, mas Follow-up falhou: '` → `'Agente salvo, mas o follow-up falhou: '`.

- [ ] **Step 3: Barra de abas**

Trocar o array das abas (de `{([` até `] as { id: Tab; label: string; icon: any }[]).map(t => (`) por:
```tsx
          {([
            { id: 'geral', label: 'Geral', icon: <Bot size={11} /> },
            { id: 'perfil', label: 'Perfil', icon: <BookOpen size={11} /> },
            { id: 'atendimento', label: 'Atendimento', icon: <ArrowRightLeft size={11} /> },
            { id: 'resultados', label: 'Resultados', icon: <DollarSign size={11} /> },
          ] as { id: Tab; label: string; icon: ReactNode }[]).map(t => (
```

- [ ] **Step 4: Aba Geral (Identidade + Quando atuar)**

1. Trocar `{tab === 'identity' && (` por `{tab === 'geral' && (` e, na linha seguinte (`<>`), acrescentar logo depois: `<SectionHeading first>Identidade e modo</SectionHeading>`.
2. Trocar o bloco `{user?.role === 'super_admin' && ( <div className="form-group"> <label>Chave da IA desta conta (só admin Dros)</label> ... </div> )}` inteiro por:
```tsx
            {user?.role === 'super_admin' && (
              <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block' }}>
                A origem da chave da IA (cliente ou Dros) agora fica em{' '}
                <button type="button" onClick={() => navigate('/integrations?card=ia')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>
                  Integrações → IA
                </button>.
              </small>
            )}
```
3. Trocar `{tab === 'when' && (` por `{tab === 'geral' && (` e acrescentar depois do `<>` seguinte: `<SectionHeading>Quando atuar</SectionHeading>`. Trocar o rótulo `Instâncias WhatsApp (multi-select)` por `Números de WhatsApp` e `Etapas do funil (multi-select)` por `Etapas do funil`. Trocar `Enviar primeira msg pra leads vindos da planilha` por `A IA escreve a primeira mensagem para leads vindos da planilha`.

- [ ] **Step 5: Aba Perfil (entrevista + Treinamento + Qualificação)**

1. Imediatamente **antes** do comentário `{/* ─── Tab: Treinamento ─── */}`, inserir:
```tsx
        {tab === 'perfil' && !isNew && (
          <div style={{ padding: 12, border: '1px solid var(--border-medium)', borderRadius: 8, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1, minWidth: 220 }}>
              <strong style={{ color: 'var(--text-primary)', display: 'block', marginBottom: 2 }}>Montar com entrevista</strong>
              Converse com a IA e ela reescreve o tom, o conhecimento e a qualificação deste agente para você revisar.
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleOpenInterview} disabled={openingInterview}>
              <MessageSquare size={12} /> {openingInterview ? 'Abrindo...' : 'Conversar com a IA'}
            </button>
          </div>
        )}
```
2. Trocar `{tab === 'training' && (` por `{tab === 'perfil' && (` e acrescentar depois do `<>`: `<SectionHeading first>Treinamento</SectionHeading>`. Trocar os rótulos `Persona (tom de voz)` → `Tom de voz`, `Knowledge base (conhecimento da empresa)` → `Conhecimento da empresa`, `NUNCA mencione (proibições)` → `Nunca mencionar`.
3. Trocar `{tab === 'qualification' && (` por `{tab === 'perfil' && (` e acrescentar depois do `<>`: `<SectionHeading>Qualificação</SectionHeading>`. Trocar `Campos obrigatórios (bot coleta antes de qualificar)` por `Campos obrigatórios (a IA coleta antes de qualificar)`.
4. Dentro desse bloco de Qualificação, **recortar** os dois `<div className="form-group">` do `Limite de mensagens antes de handoff automático` e das `Palavras de handoff (CSV)` (vão para a aba Atendimento no Step 6).

- [ ] **Step 6: Aba Atendimento (Passagem para humano + Áudio + Follow-up)**

1. Trocar `{tab === 'handoff' && (` por `{tab === 'atendimento' && (` e, depois do `<>`, inserir:
```tsx
            <SectionHeading first>Passagem para humano</SectionHeading>
            <div className="form-group">
              <label>Limite de mensagens antes de passar para uma pessoa</label>
              <input className="input" type="number" min={3} max={100} value={maxMessages} onChange={e => setMaxMessages(parseInt(e.target.value) || 15)} style={{ width: 100 }} />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Se passar disso sem qualificar, o agente passa o lead para uma pessoa (motivo: limite de mensagens).</small>
            </div>
            <div className="form-group">
              <label>Palavras que pedem uma pessoa (separadas por vírgula)</label>
              <input className="input" value={handoffKeywords} onChange={e => setHandoffKeywords(e.target.value)} />
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Quando o lead escrever uma dessas palavras, o agente passa a conversa na hora.</small>
            </div>
```
(estes dois campos substituem os recortados no Step 5; os dois originais **não** devem continuar em lugar nenhum.) Trocar o texto `Configure por motivo o que acontece quando o bot transfere o lead pra um humano. Cada linha é independente.` por `Escolha, para cada motivo, o que acontece quando o agente passa o lead para uma pessoa. Cada linha é independente.`
2. Trocar `{tab === 'audio' && (` por `{tab === 'atendimento' && (` e acrescentar depois do `<>`: `<SectionHeading>Áudio</SectionHeading>`.
3. Trocar `{tab === 'followup' && (` por `{tab === 'atendimento' && (` e acrescentar depois do `<>`: `<SectionHeading>Follow-up de inatividade</SectionHeading>`. Trocar `Crie o agente primeiro (salve), depois volte aqui pra configurar o follow-up de inatividade.` por `Salve o agente primeiro; depois volte aqui para configurar o follow-up de inatividade.` e `Instância WhatsApp pra envio` por `Número que envia o follow-up`.

- [ ] **Step 7: Aba Resultados (Custo + Simulador)**

1. Trocar `{tab === 'cost' && (` por `{tab === 'resultados' && (` e acrescentar depois do `<>`: `<SectionHeading first>Custo do mês</SectionHeading>`.
2. Imediatamente antes do comentário `{/* SANDBOX */}`, inserir `<SectionHeading>Simulador</SectionHeading>`.
3. Trocar `Sandbox — testa o agente sem disparar WhatsApp` por `Simulador — testa o agente sem enviar nada no WhatsApp` e `Salve o agente primeiro pra testar no sandbox.` por `Salve o agente primeiro para testar no simulador.`

- [ ] **Step 8: Conferir que nenhuma aba antiga sobrou**

Run:
```bash
grep -n "tab === '\(identity\|when\|training\|qualification\|handoff\|audio\|followup\|cost\)'\|keySource\|Palavras de handoff\|antes de handoff" src/components/AgentEditorModal.tsx
```
Expected: nenhuma linha.

Run: `grep -c "tab === 'geral'\|tab === 'perfil'\|tab === 'atendimento'\|tab === 'resultados'" src/components/AgentEditorModal.tsx`
Expected: `9` (2 Geral + 3 Perfil com a entrevista + 3 Atendimento + 1 Resultados).

- [ ] **Step 9: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC (os 6 erros antigos do `updateHandoffRule`, "specified more than once", continuam; só mudam de linha); `✓ built`.

- [ ] **Step 10: Verificação no navegador**

Com `npm run dev` rodando, admin, conta com agentes habilitados → **Agentes de IA** → ícone de editar de um agente:
1. Aparecem 4 abas: Geral / Perfil / Atendimento / Resultados.
2. **Geral**: liga/desliga, "Como a IA atua", nome, "Identifica como IA", depois o título "Quando atuar" com ativação, números, etapas, tag e "A IA escreve a primeira mensagem para leads vindos da planilha". Como super_admin, aparece o texto com o link "Integrações → IA" (clicar leva a `/integrations?card=ia`).
3. **Perfil**: caixa "Montar com entrevista" no topo; Treinamento; Qualificação **sem** os campos de limite e palavras.
4. **Atendimento**: "Passagem para humano" com limite e palavras no topo e as regras por motivo; "Áudio"; "Follow-up de inatividade".
5. **Resultados**: limite e uso do mês; "Simulador": mandar "oi" responde sem enviar nada no WhatsApp.
6. Mudar o tom de voz, **Salvar Alterações**, reabrir: a mudança ficou. Mudar o limite de mensagens na aba Atendimento, salvar, reabrir: ficou.
7. Perfil → **Conversar com a IA** → confirmar: abre `/agents/interview/<id>`.

- [ ] **Step 11: Commit**

```bash
git add src/components/AgentEditorModal.tsx
git commit -m "feat: editor do agente em 4 abas (geral, perfil, atendimento, resultados)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Follow-up do agente em um lugar só (telas)

**Files:**
- Modify: `src/pages/Agents.tsx`
- Modify: `src/pages/FollowUps.tsx`

**Interfaces:**
- Consumes: `AgentEditorTab` e `initialTab` (Task 9); trava 409 do servidor (Task 3); `fetchAgents` (já existe).
- Produces: link estável `/agents?editar=<agentId>&aba=atendimento`.

- [ ] **Step 1: Agentes abre o editor pela URL**

Em `src/pages/Agents.tsx`:
1. Trocar `import { useNavigate } from 'react-router-dom'` por `import { useNavigate, useSearchParams } from 'react-router-dom'` e `import AgentEditorModal from '../components/AgentEditorModal'` por `import AgentEditorModal, { type AgentEditorTab } from '../components/AgentEditorModal'`.
2. Logo depois de `const [editingId, setEditingId] = useState<number | null>(null)`, acrescentar:
```tsx
  const [searchParams, setSearchParams] = useSearchParams()
  const [editingTab, setEditingTab] = useState<AgentEditorTab | undefined>(undefined)

  // Abre o editor direto por link: /agents?editar=12&aba=atendimento (usado pela pagina Follow-ups)
  useEffect(() => {
    const id = Number(searchParams.get('editar'))
    if (!id) return
    const aba = searchParams.get('aba')
    setEditingTab(aba === 'geral' || aba === 'perfil' || aba === 'atendimento' || aba === 'resultados' ? aba : undefined)
    setEditingId(id)
  }, [searchParams])

  const closeEditor = () => {
    setEditingId(null)
    setEditingTab(undefined)
    if (searchParams.get('editar')) setSearchParams({}, { replace: true })
  }
```
3. No botão de editar do card do agente, trocar `onClick={() => setEditingId(a.id)}` por `onClick={() => { setEditingTab(undefined); setEditingId(a.id) }}`.
4. Trocar o uso do modal por:
```tsx
      {editingId !== null && featureEnabled && (
        <AgentEditorModal
          agentId={editingId}
          accountId={accountId}
          initialTab={editingTab}
          onClose={closeEditor}
          onSaved={() => { closeEditor(); load() }}
        />
      )}
```
5. No aviso de chave, trocar `<strong>Integrações → Agentes de IA — API Anthropic</strong>` por:
```tsx
<button type="button" onClick={() => navigate('/integrations?card=ia')} style={{ background: 'none', border: 'none', padding: 0, color: '#FFCB45', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>Integrações → IA</button>
```

- [ ] **Step 2: Follow-ups mostra os do agente só para consulta**

Em `src/pages/FollowUps.tsx`:
1. Acrescentar `fetchAgents,` na lista de imports de `../lib/api`; acrescentar `import { useNavigate } from 'react-router-dom'`; acrescentar `Bot` na lista de ícones do `lucide-react`.
2. Logo depois de `const { accountId } = useAccount()`, acrescentar:
```tsx
  const navigate = useNavigate()
  const [agentNames, setAgentNames] = useState<Record<number, string>>({})
```
3. No `load`, acrescentar como último item do `Promise.all([...])`: `fetchAgents(accountId).then(d => d.agents).catch(() => []),` e trocar o `.then(([fus, insts, fns, usrs, tgs, globs]) => {` por `.then(([fus, insts, fns, usrs, tgs, globs, agents]) => {`, acrescentando dentro dele:
```tsx
      setAgentNames(Object.fromEntries(agents.map(a => [a.id, a.name])))
```
4. Imediatamente antes de `{loading ? (` (a tabela), inserir:
```tsx
      {followUps.some(fu => fu.agent_id) && (
        <div className="card" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 12, marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
          <Bot size={16} style={{ color: '#FFB300', flexShrink: 0 }} />
          <span>Os follow-ups dos agentes de IA são configurados no próprio agente (Agentes de IA → editar o agente → aba Atendimento). Aqui eles aparecem só para consulta.</span>
        </div>
      )}
```
5. Na célula **Tipo** da tabela, trocar `{fu.type === 'inactivity' ? (` por:
```tsx
                    {fu.agent_id ? (
                      <span style={{ color: '#FFB300' }}><Bot size={10} style={{ verticalAlign: -1 }} /> Agente: {agentNames[fu.agent_id] || `#${fu.agent_id}`}</span>
                    ) : fu.type === 'inactivity' ? (
```
6. Na célula **Ações**, envolver os dois botões existentes (Editar e Apagar) assim:
```tsx
                  <td style={{ textAlign: 'right' }}>
                    {fu.agent_id ? (
                      <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/agents?editar=${fu.agent_id}&aba=atendimento`)} title="Este follow-up é configurado no agente">
                        <Bot size={12} /> Editar no agente
                      </button>
                    ) : (
                      <>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEdit(fu)} title="Editar" style={{ marginRight: 4 }}>
                          <Edit3 size={12} />
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(fu)} title="Apagar">
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </td>
```

- [ ] **Step 3: Tipos e build**

Run: `npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -3`
Expected: contagem = BASE_TSC; `✓ built`.

- [ ] **Step 4: Verificação no navegador e da trava**

1. Num agente, aba **Atendimento**, ligar "Enviar follow-up se lead parar de responder", escolher o número, um passo com texto, **Salvar follow-up**.
2. Menu **Follow-ups**: aparece o aviso azul e a linha com "Agente: <nome>" e o botão **Editar no agente** (sem lápis e sem lixeira). Clicar: abre Agentes com o editor daquele agente **já na aba Atendimento**. Fechar o editor: a URL volta para `/agents`.
3. Trava do servidor: no navegador, DevTools → Application → Local Storage → copiar `dros_crm_token`; anotar o `id` do follow-up do agente (DevTools → Rede → `follow-ups` → resposta). Rodar:
```bash
TOKEN='cole-o-token-aqui'; FU=ID_DO_FOLLOW_UP
curl -s -X PUT "http://localhost:3002/api/follow-ups/$FU?account_id=1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"x"}'
curl -s -X DELETE "http://localhost:3002/api/follow-ups/$FU?account_id=1" -H "Authorization: Bearer $TOKEN"
```
Expected: as duas respostas são `{"error":"Este follow-up pertence a um agente de IA. Edite em Agentes de IA, no agente, aba Atendimento.","agent_id":N}`.
4. Um follow-up comum (sequência) continua com lápis e lixeira e salva normalmente.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Agents.tsx src/pages/FollowUps.tsx
git commit -m "feat: follow-up do agente aparece na pagina follow-ups so para consulta

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Verificação final (sem commit, salvo correção)

**Files:** nenhum novo.

- [ ] **Step 1: Suíte, tipos e build**

Run:
```bash
cd /c/Users/RTX-2060/Documents/crm && export PATH="/c/nvm4w/nodejs:$PATH" && npm test 2>&1 | tail -6 && npx tsc --noEmit -p . 2>&1 | grep -c "error TS" && npm run build 2>&1 | tail -2
```
Expected: `# fail 0` (43 testes novos a mais que na Task 0); contagem = BASE_TSC; `✓ built`.

- [ ] **Step 2: Nada fora do escopo foi commitado**

Run: `git status --short && git log --oneline -12 --stat | grep -E "dist/|vite.config|package-lock|\.mjs" || echo "limpo"`
Expected: `git status` mostra só os arquivos locais que já estavam soltos na Task 0 (`dist/...`, `vite.config.ts`, `*.mjs`); o `grep` imprime `limpo`.

- [ ] **Step 3: Roteiro completo no navegador (conta 1, admin)**

1. **Integrações** → 4 blocos no topo; cada um abre o seu conteúdo; `?card=` na URL funciona ao recarregar.
2. **WhatsApp**: selo de provedor em cada número; "Conectar número" com escolha Evolution/UzAPI só quando a UzAPI está no `.env`; QR aparece, ou o botão "Abrir painel da UzAPI" quando vier `panel_url`; credenciais da Evolution recolhidas.
3. **Mensagens do número**: um texto de primeira mensagem com as duas situações; horário único com "Segurar envios"; ausência. Salvar e conferir no banco (comando da Task 6, Step 6.5).
4. Um número que tinha **duas** mensagens diferentes (preparar no banco local: `UPDATE instance_auto_messages SET greeting_text='Texto B', greeting_enabled=1 WHERE instance_id=<id>` e `UPDATE whatsapp_instances SET first_msg_template='Texto A' WHERE id=<id>`): o modal mostra o aviso com o "Texto B" e o botão "Trocar pela outra"; fechar sem salvar não muda nada no banco.
5. Um funil com mensagem própria (preparar: `UPDATE funnels SET first_msg_template='Texto do funil' WHERE id=<id>`): aparece em "Funis com mensagem própria"; "Usar a deste número" → confirma → `first_msg_template` do funil fica `NULL`.
6. **Entrada de leads**, **Meta**, **IA**: salvam como antes; a origem da chave (super_admin) está no card IA e não mais no agente.
7. **Agentes de IA** → editar: 4 abas com os blocos da tabela da Task 9.
8. **Follow-ups**: linha do agente só para consulta com "Editar no agente".
9. **Chat**: enviar uma mensagem manual por um número com "Segurar envios" ligado, fora do horário: a mensagem sai (o Chat não é segurado).

- [ ] **Step 4: Se algo falhar**

Corrigir na task correspondente (mesmos arquivos), rodar de novo o Step 1 e commitar a correção com `fix: ...` e a linha `Co-Authored-By`. Não dar push.

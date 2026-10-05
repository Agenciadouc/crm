# Pacote Rápido do CRM Simples — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir junto com o SPIN as partes pequenas da spec do CRM simples: telas sem jargão, Cadências mais limpas, funil visível, aviso de chave de IA e tipo de contato básico.

**Architecture:** Mudanças pontuais em telas existentes (texto, recolher avançado, selo de funil) + uma coluna `leads.contact_type` com um helper único (`server/services/contacts/scope.js`) usado pelas métricas, pelo quadro do Pipeline e pelas automações.

**Tech Stack:** Node 16 em produção (Express 4, better-sqlite3), React + TS (Vite 4), `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-05-crm-simples-design.md` (§1 regras de usabilidade, §2 tipo de contato — parte manual, §3 último parágrafo — funil visível, §5 — limpeza, §7 — aviso de chave, §10 — termos). Itens grandes da spec ficam para os próximos blocos.

## Global Constraints

- Banco: só `ADD COLUMN` idempotente; nada de DROP/RENAME.
- Tipos de contato: `lead` (padrão), `cliente`, `revendedor`, `interno`. Rótulos: Lead, Cliente, Revendedor/Representante, Interno (funcionário/empresa).
- Automações (agente de IA, follow-up, disparo, boas-vindas/ausência, primeira mensagem, recompra automática, extração do roteiro) só para `lead` e `cliente`.
- Números (Dashboard `/stats`, Funil mensal/Projeção, Pipeline quadro) contam só `lead` e `cliente`.
- Termos: "Fase SPIN" → "Tipo de pergunta" com opções "Como faz hoje" (situation), "O que incomoda" (problem), "O que isso custa" (implication), "O que ganha resolvendo" (need_payoff); "Perfil"/"Perfil de cliente ideal"/"Perfil do lead" → "Tipo de cliente"; "Obrigatória (trava a etapa)" → "Precisa de resposta para avançar"; "Negócio e clientes ideais" → "Sobre o seu negócio"; "Começar com modelo SPIN" sai.
- Sem emojis em código; textos com exemplo nos "?".

## Review Focus

- Lead de outra conta via `PUT /api/leads/:id` — tem que dar 404 (hoje não confere a conta) (Tarefa 4).
- Lead `interno` que manda mensagem — agente de IA, boas-vindas e extração não disparam (Tarefa 4).
- Conta sem nenhum lead com tipo (banco antigo) — tudo continua igual (`COALESCE(contact_type,'lead')`) (Tarefa 4).
- Gestor muda o tipo para `interno` com o lead no meio de um follow-up — o follow-up para de enviar (Tarefa 4).
- Atendente tenta ver o aviso de chave — não vê (só gestor/admin) (Tarefa 3).

---

### Task 1: Telas do SPIN sem jargão e Cadências mais limpas

**Files:** Modify `src/lib/stageCadence.js` (+ `.d.ts`), `src/pages/cadencias/StepPanel.tsx`, `src/pages/cadencias/StageEmpty.tsx`, `src/pages/cadencias/BusinessProfilesCard.tsx`, `src/components/roteiro/LeadProfileSelect.tsx`, `src/lib/roteiroManager.js`. Test: `test/stageCadence.test.js`, `test/roteiroManager.test.js`.

- [ ] Teste que falha: `SPIN_OPTIONS.map(o => o.label)` = `['Como faz hoje', 'O que incomoda', 'O que isso custa', 'O que ganha resolvendo']`; `suggestionWhy` de `new_question` usa esses rótulos ("(O que incomoda, tipo de cliente Loja)").
- [ ] Rodar e ver falhar; trocar rótulos em `SPIN_OPTIONS` e em `SPIN_NAMES` do `roteiroManager.js` (e "perfil" → "tipo de cliente" na frase); rodar e ver passar.
- [ ] `StepPanel.tsx`: "Obrigatória (trava a etapa)" → "Precisa de resposta para avançar"; mover **Tipo de pergunta** e **Tipo de cliente** para dentro de "Mais opções" (renomeado **Ajustes avançados**), junto com "Dica para a IA" e "Dia"; HelpTip do Tipo de pergunta: "Ajuda a IA a montar a conversa na ordem certa: primeiro como o cliente faz hoje, depois o que incomoda, o que isso custa e o que ele ganha resolvendo. Ex.: 'O que mais te incomoda hoje?' = O que incomoda."; seletor "define o perfil" das opções → title "Quem escolher esta resposta vira deste tipo de cliente. Ex.: 'Tenho loja' → Loja" e texto "Tipo: —".
- [ ] `StageEmpty.tsx` (`TemplateButtons`): remover o botão "Começar com modelo SPIN" (e o modo `spin` do componente); manter só "Montar com IA" com HelpTip "A IA monta as perguntas e mensagens desta etapa a partir do seu negócio e das conversas. Você confere depois."; aviso de etapa de contato continua.
- [ ] `BusinessProfilesCard.tsx`: título "Sobre o seu negócio"; "Perfis de cliente ideal" → "Tipos de cliente"; botões/placeholders iguais com "tipo de cliente"; HelpTip sem a palavra perfil ideal.
- [ ] `LeadProfileSelect.tsx`: rótulo "Tipo de cliente"; HelpTip "Que tipo de cliente ele é. As perguntas mudam conforme o tipo. Ex.: quem diz 'tenho um mercadinho' é Loja. A IA marca sozinha; se errar, troque aqui."
- [ ] `StepRow.tsx`: title do selo "Pergunta só para o tipo de cliente X".
- [ ] `npm test`, `npx tsc --noEmit` (16 antigos), commit `feat(telas): sem jargao e cadencias mais limpas`.

### Task 2: Funil visível (Vendas / Recompra)

**Files:** Create `src/lib/funnelBadge.js` (+ `.d.ts`); Modify `src/pages/Chat.tsx` (lista ~1707 e bloco etapa ~2175), `src/pages/LeadDetail.tsx` (~306). Test: `test/funnelBadge.test.js`.

**Interfaces:** Produces `funnelLabel(funnel) → 'Vendas' | 'Recompra' | null` (`kind === 'recompra'` → 'Recompra'; senão 'Vendas'; sem funil → null) e `funnelBadgeStyle(label) → { color, background }` (Recompra roxo `#7C3AED`, Vendas azul `#2563EB`, fundo com 20 de alfa).

- [ ] Teste que falha (as duas funções, incluindo `null`/sem `kind`).
- [ ] Implementar; rodar.
- [ ] Chat: na lista, selo pequeno do funil antes do selo da etapa (só quando a conta tem mais de 1 funil ativo); no bloco "Etapa do funil", título vira "Funil e etapa" e mostra o selo do funil acima do seletor. Ficha: selo ao lado do seletor de etapa.
- [ ] `npx tsc --noEmit`, `npm test`, commit `feat(telas): mostra o funil do lead (Vendas/Recompra)`.

### Task 3: Aviso "Conecte sua chave de IA"

**Files:** Create `server/services/aiKeyStatus.js`, `src/components/AiKeyBanner.tsx`; Modify `server/routes/roteiroRouter.js` (rota), `src/lib/roteiroApi.ts`, `src/App.tsx`. Test: `test/aiKeyStatus.test.js`, `test/roteiroHttp.test.js`.

**Interfaces:** `aiKeyStatus(account, env) → { needs_key: boolean }` — `true` quando `ai_key_source` é `client`/vazio e não há `anthropic_api_key` própria (conta com `auto`/`dros` = IA global ligada → `false`). Rota `GET /api/roteiro/ai-key-status` (gestor/admin) → `{ needs_key }`.

- [ ] Teste que falha: client sem chave → true; client com chave → false; auto sem chave → false; dros → false; rota: atendente 403, gerente 200.
- [ ] Implementar serviço + rota; rodar.
- [ ] `AiKeyBanner.tsx`: para `gerente`/`super_admin` com conta selecionada, busca o status e, se `needs_key`, mostra faixa amarela no topo: "Conecte sua chave de IA para a IA continuar trabalhando (ler conversas, identificar o tipo de cliente, sugerir melhorias). Ex.: Integrações > IA." com link "Conectar" para `/integrations`; [Fechar] esconde por 24 h (localStorage com try/catch). Montar em `App.tsx` ao lado de `SystemNoticeBanner`.
- [ ] `npx tsc --noEmit`, `npm test`, commit `feat: aviso para conectar a chave de IA`.

### Task 4: Tipo de contato — servidor

**Files:** Create `server/services/contacts/scope.js`, `server/services/contacts/schema.js`; Modify `server/db.js` (aplicar schema), `server/routes/leads.js` (`PUT /:id`, `GET /` com `only_leads=1`), `server/routes/dashboard.js` (`/stats`, `computeFunnelCascade`), `server/services/aiAgent.js` (~85), `server/services/followUpSender.js` (~66-75), `server/routes/broadcasts.js` (~76), `server/services/autoMessages.js` (~56), `server/services/leadHandoff.js` (~55), `server/services/ltv/autoSend.js` (~27), `server/services/roteiro/runtime.js` (`enqueueAiExtract`). Test: `test/contactType.test.js`.

**Interfaces:**
- `CONTACT_TYPES = ['lead','cliente','revendedor','interno']`
- `contactTypeOf(lead) → string` (`lead.contact_type || 'lead'`)
- `canAutomate(lead) → boolean` (`lead` ou `cliente`)
- `countsInMetrics(alias = 'l') → string` SQL: `COALESCE(<alias>.contact_type,'lead') IN ('lead','cliente')`
- `applyContactSchema(db)`: `leads.contact_type TEXT`, `leads.contact_type_origin TEXT`; índice `(account_id, contact_type)`.
- `PUT /api/leads/:id` aceita `contact_type` (inválido → 400 "Tipo de contato inválido."), grava `contact_type_origin = 'manual'`, e passa a conferir a conta (lead de outra conta → 404).

- [ ] Testes que falham:
  - `canAutomate`/`contactTypeOf`/`countsInMetrics` (banco sem a coluna preenchida conta como lead).
  - `PUT /:id` com `contact_type` válido grava + origem manual; inválido 400; lead de outra conta 404 (servidor de teste com `createTestDb`/rotas reais — seguir o padrão de `test/leadAccess.test.js` ou montar a rota com o db em memória).
  - `followUpSender`: lead interno não recebe (função de seleção/checagem retorna "pula").
  - `aiAgent.findAgentForLead`: lead interno → nenhum agente.
  - Dashboard `/stats`: revendedor/interno fora das contagens.
- [ ] Rodar e ver falhar; implementar cada ponto com `canAutomate(lead)` (pula e loga uma vez `[Contato] interno/revendedor: automação pulada`) ou `countsInMetrics()` nas consultas; `GET /leads?only_leads=1` filtra por `countsInMetrics`.
- [ ] Rodar; `npm test` inteiro; commit `feat(contatos): tipo de contato; internos e revendedores fora dos numeros e das automacoes`.

### Task 5: Tipo de contato — telas

**Files:** Create `src/components/roteiro/ContactTypeSelect.tsx`; Modify `src/lib/api.ts` (`Lead.contact_type`, `updateLead` aceita), `src/pages/Chat.tsx` (bloco Funil e etapa), `src/pages/LeadDetail.tsx`, `src/pages/Pipeline.tsx` (passa `only_leads=1` no carregamento do quadro).

- [ ] `ContactTypeSelect` (props `lead`, `onChanged`): seletor "Tipo de contato" com Lead / Cliente / Revendedor ou representante / Interno (funcionário, empresa); HelpTip "Quem não é cliente em potencial sai do funil e dos números. Ex.: o celular de um funcionário = Interno; um representante = Revendedor."; ao trocar, `updateLead(lead.id, { contact_type })`, e quando vira Revendedor/Interno mostra "Este contato saiu do funil e dos números. [Desfazer]".
- [ ] Encaixar no Chat (bloco "Funil e etapa", abaixo do Tipo de cliente) e na ficha (abaixo do Tipo de cliente); selo cinza "Interno"/"Revendedor" na lista do Chat no lugar do selo de etapa.
- [ ] Pipeline: carregar com `only_leads=1`.
- [ ] `npx tsc --noEmit` (16 antigos), `npm run build`, `npm test`, commit `feat(contatos): seletor de tipo de contato no Chat, ficha e Pipeline`.

### Task 6: Conferência e subida

- [ ] Suíte inteira, tsc, build; revisão final da branch (revisor novo); corrigir críticos/importantes com TDD.
- [ ] Conferir no navegador: Cadências (sem jargão, Ajustes avançados), Chat (funil, tipo de cliente, tipo de contato), ficha, aviso de chave (conta sem chave), Pipeline sem internos.
- [ ] Com o ok do dono: push `feat/spin-selling` + este ramo para `origin/main` (fast-forward) e passo a passo do João.

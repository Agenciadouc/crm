# Sinais de Venda por Palavra-chave em Tempo Real (design)

Data: 02/10/2026 · Base: branch `feat/sinais-palavra-chave-tempo-real` (ponta = origin/main = produção, já com LTV+Recompra)

## 1. Por que

Replante da ideia original de 20/06/2026 ("Fase 1 · Peça 1"), redesenhada pra se encaixar no que foi construído depois (Termômetro/Lead Score, Cadência da Etapa, `moveLeadToStage`), que não existiam quando a ideia foi concebida.

Motivo de negócio (gatilho: time via print no Slack): o vendedor via um lead marcado como "Qualificado" e vê a nota do Termômetro **caindo** mesmo com a conversa indo bem. Causa raiz (ver [[crm-copiloto-ia]]... na verdade ver memória `retomar-crm`): hoje o único sinal de "interesse na conversa" do Termômetro é `buyingTermLast7d` — um flag raso que vale +5 se o lead mencionou qualquer termo de compra (preço, prazo, pagamento) em até 7 dias, **sem olhar o que aconteceu depois**. Isso gera dois erros de leitura:
- Lead pergunta preço e some → ainda conta como sinal positivo (falso positivo).
- Lead confirma "quero comprar" → tem o mesmo peso (+5) que só perguntar o preço (sinal fraco subestimado quando na verdade é forte).

**Objetivo:** motor de detecção de sinais por palavra-chave, em tempo real, **sem custo de IA** (zero chamadas de modelo, disponível pra 100% das contas inclusive as sem IA ligada), que substitui o `buyingTermLast7d` por uma leitura em níveis — e que also permite avançar a etapa do funil sozinho quando o sinal for forte o bastante.

## 2. Decisões do dono (02/10/2026)

1. **Sem nota própria.** O sinal alimenta o Termômetro que já existe (`server/services/leadScore/`), substituindo o `buyingTermLast7d` atual. Não cria `leads.lead_score` nem badge separado (evita duas notas de lead concorrendo na tela — essa ideia já foi descartada quando replantamos a Rotina de Atendimento antiga, que duplicava a Cadência da Etapa já em produção).
2. **3 níveis de sinal**, pra reduzir o erro de leitura a praticamente zero:
   - **Fraco** (ex.: "quanto custa", "qual o valor", "tem desconto") — só é avaliado em resposta a um **gatilho do vendedor** armado na etapa (pergunta específica, ex.: "posso te mandar uma proposta?"), e só vira ponto se o lead **continuar engajando depois** (não sumir).
   - **Forte** (ex.: "quero comprar", "pode fechar", "fechado", "vou fechar") — vale sozinho, em **qualquer mensagem** do lead, não depende de gatilho armado. Pode avançar a etapa automaticamente.
   - **Negativo** (ex.: "não quero", "não tenho interesse", "caro demais", "desisto") — também vale em qualquer mensagem, derruba a pontuação.
3. **"Sumiu" = silêncio por N horas** depois do sinal fraco. Padrão **24h**, mas configurável **por conta** (`accounts.keyword_signal_ghost_hours`) — clientes diferentes, ritmos de resposta diferentes.
4. **IA continua em lote, sem rodar por mensagem.** Não vale a pena rodar IA em tempo real a cada troca (custo + nem toda conta tem IA ligada). O ajuste de IA que já existe no Termômetro (±15, baseado na análise periódica do `conversationAnalyzer`) continua funcionando como uma segunda camada de conferência **sem custo novo** pra quem já tem IA — se a palavra-chave disser "forte" mas a última análise de IA (recente) disser "frio"/"chance baixa", o ajuste de IA já existente puxa a nota pra baixo.
5. **Avanço automático de etapa** no sinal forte confirmado (ou gatilho+fraco confirmado) reaproveita `moveLeadToStage` (`server/services/stageMove.js`) — que já recalcula o Termômetro e dispara o CAPI do Meta sozinho, igual o `roteiro/autoAdvance.js` já faz pro Roteiro.
6. **Itens descartados do plano original** (ver memória `retomar-crm`, replante de 02/10): "Rotina de Atendimento" (duplicava a Cadência da Etapa já em produção) e "badge térmico" simples no Pipeline (duplicava o Termômetro). Essas duas peças da branch antiga **não são portadas**.

## 3. Conceitos e fórmulas

### 3.1 Classificação de uma mensagem inbound

Pra cada mensagem inbound, depois de salva:
- Bate com `negative_keywords` da etapa atual → `signal_type = 'negative'` (sempre avaliado, qualquer mensagem).
- Senão, bate com `strong_keywords` da etapa atual → `signal_type = 'strong'` (sempre avaliado, qualquer mensagem).
- Senão, se existe um gatilho armado (`leads.pending_trigger_stage_id` == etapa atual e `pending_trigger_at` dentro da janela de `keyword_signal_ghost_hours`) e a mensagem bate com `weak_keywords` da etapa → `signal_type = 'weak'`, consumindo o gatilho (`pending_trigger_*` voltam a `NULL`).
- Nenhum dos três bate → nada (mensagem neutra pro motor; o gatilho armado continua valendo até expirar).

Pra cada mensagem **outbound** do vendedor: bate com `trigger_keywords` da etapa atual → arma `leads.pending_trigger_stage_id = <etapa atual>`, `pending_trigger_at = agora`. Um novo gatilho **substitui** o anterior (não empilha).

Toda detecção (`negative`/`strong`/`weak`/`trigger`) grava uma linha em `lead_signals` (auditoria — nunca apagada).

### 3.2 "Fraco confirmado" vs "fraco fantasma" (o core do pedido)

Dado o sinal `weak` mais recente nos últimos 7 dias, com timestamp `t`:
- Existe mensagem inbound do lead com timestamp `> t`? → **confirmado** (o lead seguiu engajando depois de perguntar) — conta ponto.
- Não existe, e já se passaram `>= keyword_signal_ghost_hours` desde `t`? → **fantasma** (perguntou e sumiu) — **zero**, não conta nada (nem positivo nem negativo; a recência do Termômetro já vai refletir o silêncio sozinha).
- Não existe, e ainda não se passaram `keyword_signal_ghost_hours`? → **pendente** (cedo demais pra saber) — zero por enquanto, reavaliado no próximo recálculo.

Isso é tudo calculado **na hora do cálculo da nota** (função pura, sem job agendado novo), olhando `lead_signals` + `messages` — mesmo padrão do `buildEngagement` atual em `server/services/leadScore/inputs.js`.

### 3.3 Pontuação (substitui `buyingTermLast7d` em `computeLeadScore`)

Hoje (`server/services/leadScore/compute.js`):
```js
let intensity = 0
if (e.advancedLast7d) { intensity = 10 }
else if (e.buyingTermLast7d) { intensity = 5 }
```

Novo:
```js
let intensity = 0
if (e.advancedLast7d) intensity = 10
else if (e.strongSignalLast7d) intensity = 10
else if (e.weakSignalConfirmedLast7d) intensity = 5
if (e.negativeSignalLast7d) intensity -= 10
```

E o `engagement` final passa a ser **clampado nos dois lados** (hoje só tem teto):
```js
const engagement = clamp(recency + speed + reciprocity + intensity, 0, 50)
```//antes era `Math.min(50, ...)`, sem piso — com intensity podendo ficar negativa agora, precisa do piso 0.

`buyingTermLast7d` e `hasBuyingTerm`/`BUYING_TERMS` de `inputs.js` são **removidos** (substituídos pelos sinais novos). `advancedLast7d` continua existindo do jeito que está (sinal de avanço de etapa, de qualquer origem — Roteiro, sinal forte, ou manual).

### 3.4 Avanço automático de etapa

Quando um sinal `strong` é confirmado, ou um `weak` é confirmado (ver 3.2), igual ao `roteiro/autoAdvance.js`: pega a próxima etapa do funil por `position` (ignorando etapas terminais) e chama `moveLeadToStage(db, { lead, toStageId: nextStage.id, trigger: 'keyword_signal', gate: false })`. Se não houver próxima etapa, ou a etapa atual já é a última não-terminal, não faz nada (só fica registrado em `lead_signals`).

Um sinal `negative` **nunca** avança etapa.

## 4. Modelo de dados

### 4.1 `funnel_stages` (colunas novas, `addColumnIfNotExists`)
- `trigger_keywords TEXT` — JSON array de perguntas-gatilho do vendedor.
- `weak_keywords TEXT` — JSON array (sinal fraco, só conta com gatilho armado).
- `strong_keywords TEXT` — JSON array (sinal forte, vale sozinho).
- `negative_keywords TEXT` — JSON array (sinal negativo, vale sozinho).

Defaults semeados (iguais aos do plano original) no primeiro acesso à tela de edição da etapa, que o dono pode editar/apagar.

### 4.2 `leads` (colunas novas)
- `pending_trigger_stage_id INTEGER` — etapa onde o gatilho foi armado.
- `pending_trigger_at TEXT` — timestamp ISO de quando armou.

### 4.3 `accounts` (coluna nova)
- `keyword_signal_ghost_hours INTEGER NOT NULL DEFAULT 24` — janela de silêncio que define "sumiu", editável em Configurações (mesmo padrão do `score_half_life_days` que já existe lá pro Termômetro).

### 4.4 `lead_signals` (nova, auditoria — nunca apagada)
`id, account_id, lead_id, stage_id, signal_type ('trigger'|'weak'|'strong'|'negative'), keyword, message_id, created_at`.

## 5. Onde entra no código

- **Detecção:** hook dentro de `server/services/inboundHandler.js` (mensagem inbound) e no envio outbound (`server/services/whatsapp/sender.js` ou onde a mensagem outbound é gravada) — função pura de matching isolada em `server/services/keywordSignals.js` (igual ao plano original: `normalizeText`, `matchKeyword`, mais a lógica dos 3 níveis), chamada por um motor `server/services/signalEngine.js` que recebe `db` por injeção (testável em SQLite em memória, sem importar o singleton `server/db.js` — mesma regra de sempre, ver CLAUDE.md/constraints).
- **Pontuação:** `server/services/leadScore/inputs.js` (`buildEngagement`) ganha os 3 novos campos (`strongSignalLast7d`, `weakSignalConfirmedLast7d`, `negativeSignalLast7d`) lendo de `lead_signals`+`messages`; `compute.js` muda conforme 3.3.
- **Avanço de etapa:** reaproveita `moveLeadToStage` (`server/services/stageMove.js`), chamado pelo motor de sinais igual o `roteiro/autoAdvance.js` faz.
- **UI:** editor de etapa do funil (`src/pages/Funnels.tsx`) ganha os 4 campos de listas de palavra-chave da etapa (igual ao plano original previa). Configurações da conta ganha o campo "Janela de silêncio" (horas) perto de onde já fica o `score_half_life_days` do Termômetro.
- **Recalcular a nota:** o motor chama `scheduleScore(leadId)` (já existe, `server/services/leadScore/recalc.js`) depois de gravar qualquer sinal — mesmo padrão usado hoje por venda/roteiro/IA.

## 6. Testes

Segue o padrão já usado no projeto (TDD, `node --test test/`, funções puras testáveis sem banco + banco em memória pros testes de integração):
- `keywordSignals.test.js` — matching puro, classificação de nível, normalização (acentos/caixa).
- `signalEngine.test.js` — arma gatilho, consome gatilho, ignora fraco sem gatilho, forte/negativo sem gatilho, expiração do gatilho pela janela da conta.
- `leadScore` (ajustes em `inputs.test.js`/`compute.test.js` existentes) — fraco confirmado/fantasma/pendente, forte, negativo, clamp do piso 0 no engagement.
- Integração: sinal forte confirmado avança etapa via `moveLeadToStage` e recalcula a nota.

## 7. Fora de escopo (não entra nesse replante)

- Rotina de Atendimento (superada pela Cadência da Etapa já em produção).
- Badge térmico simples no Pipeline (superado pelo Termômetro já em produção).
- IA rodando por mensagem em tempo real (mantém o lote periódico existente).
- Motor de Custo WhatsApp Oficial / Fase 4 (produto futuro, VPS separada — ver memória `motor-custo-whatsapp`).

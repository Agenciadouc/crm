# LTV, Recompra e Venda Cruzada (design)

Data: 29/09/2026 · Base: branch `merge/github-2026-09-24` (ponta 0cd1a86 = origin/main = produção)

## 1. Por que

O dono quer que o CRM controle o **valor do cliente ao longo do tempo (LTV)** e traga o cliente de volta:
- o mesmo cliente compra várias vezes (recompra) ou compra coisas relacionadas (venda cruzada);
- o CRM lembra o vendedor na hora certa (ou envia sozinho, se configurado);
- existe um **funil de recompra** com métricas e **motivos de não comprar**;
- o gestor vê ritmo de compra (curva A/B/C/D), valor do cliente (selos) e quem está parado.

O que já existe e é reaproveitado: `lead_sales` (várias vendas por lead, valor/data/observação), funis múltiplos por conta (`funnels`/`funnel_stages`), `standalone_tasks`, Cadência da Etapa (funciona em qualquer funil), `moveLeadToStage`, `scheduler.js` (laço de 1 min), `sender.js` + regras anti-ban, orçamento de IA (`aiBudget.js`), "Mais filtros..." (Leads/Pipeline), janela "Conferir mensagem".

## 2. Decisões do dono

1. **Sem cadastro de produtos.** A venda ganha "Produto/serviço vendido" (texto livre).
2. Toda venda nova tem **tipo**: **Pode recomprar** (lembrar em 7/15/30/45/60 dias) ou **Compra única** (opcional: "Oferecer relacionados depois" em 7/15/30/45/60 dias + "O que oferecer", texto opcional).
3. "O que oferecer" vazio + IA ligada na conta → **IA sugere** produtos relacionados e uma mensagem pronta.
4. **Funil "Recompra"** próprio por conta (jeito 1: o lead muda de funil). Venda "pode recomprar" ou "compra única com oferta" → lead vai **na hora** para o funil Recompra, etapa "Aguardando".
5. **Não comprou agora** não encerra: pede motivo + próxima tentativa (padrão = prazo anterior; vendedor troca). Só **Não quer mais** encerra (pede motivo; desfazível).
6. **Limite de tentativas** (gestor define, padrão 5). Depois, para de lembrar sozinho; cliente segue em "Parados".
7. **Comprou de novo** → registra venda → recomeça o ciclo (contador de tentativas zera).
8. **Envio automático opcional** ("Lembretes automáticos", desligado por padrão): só com número de disparo (UzAPI/Oficial) conectado **e** IA ligada. Evolution nunca envia automático.
9. **Curva A/B/C/D = ritmo de compra** (frequência), faixas padrão 30/45/60 dias, gestor muda. Cliente que parou **cai de letra**.
10. **Selos de valor** (ex.: 💎 Diamante, ⭐ Premium): **o próprio dono da conta cria** (nome, cor/ícone, valor mínimo de LTV). Sem regra = sem selo.
11. Onde aparece: **tela nova "Clientes"** + cartão no painel do lead + quadro no Dashboard + filtros em Leads/Pipeline.
12. "Parado" = os dois: **atrasado na recompra** e **faixas de tempo sem comprar** (30–60, 60–90, 90–180, 180+).

## 3. Conceitos e fórmulas

- **Cliente** = lead com pelo menos 1 venda em `lead_sales` (da conta, lead não apagado).
- **LTV do cliente** = soma de `lead_sales.value` do lead (desde sempre).
- **Nº de compras** = contagem de vendas. **Ticket médio** = LTV ÷ nº de compras.
- **Intervalo médio** do cliente = média dos dias entre vendas consecutivas (ordenadas por `sale_date`; vendas no mesmo dia contam como uma para intervalo). Só existe com ≥2 dias de compra distintos.
- **Ritmo atual** = `max(intervalo médio, dias desde a última compra)`. É isso que faz o cliente parado cair de letra.
- **Curva** (faixas da conta `curve_a_days`=30, `curve_b_days`=45, `curve_c_days`=60):
  - 1 compra só → **"1ª compra"** (sem letra);
  - ritmo atual ≤ A → **A**; ≤ B → **B**; ≤ C → **C**; acima → **D**.
- **Selo** = o de maior `min_ltv` que o LTV alcança (`LTV >= min_ltv`). Nenhum alcançado ou nenhum cadastrado → sem selo.
- **Tempo real de recompra** (conta) = **mediana** dos dias entre uma venda "pode recomprar" e a próxima venda do mesmo cliente. Comparado com o prazo marcado; se a mediana passar do prazo em mais de 20% com ≥10 casos, mostra sugestão ("considere lembrar em 45 dias" — o prazo da lista mais próximo da mediana).
- **Atrasado na recompra** = ciclo ativo em "A contatar" ou "Em conversa" com `remind_at` vencido há mais de 3 dias, **ou** em "Aguardando" com tentativa esgotada (limite atingido).
- **Faixas sem comprar** = dias desde a última venda: 30–60, 61–90, 91–180, 181+ (menos de 30 não aparece). Vale para todos os clientes, menos "Não quer mais" (mostrados à parte).

Todos os cálculos ficam em funções puras em `server/services/ltv/` (testáveis sem banco), e as consultas em um repositório separado.

## 4. Modelo de dados

### 4.1 `lead_sales` (colunas novas, `addColumnIfNotExists`)
- `product TEXT NULL` — produto/serviço vendido.
- `sale_kind TEXT NULL` — `'recompra' | 'unica'`; `NULL` = venda antiga (tipo não informado).
- `remind_days INTEGER NULL` — 7/15/30/45/60 (recompra, ou venda cruzada se marcada).
- `cross_sell INTEGER NOT NULL DEFAULT 0` — 1 quando compra única com "oferecer relacionados".
- `cross_sell_offer TEXT NULL` — o que oferecer (texto do vendedor).

Vendas antigas: contam em LTV/curva/selo; não geram ciclo. A ficha mostra "Tipo não informado — [Marcar tipo]" (marcar depois pode iniciar ciclo, calculado a partir da data da venda; se a data já passou, entra direto em "A contatar").

### 4.2 `repurchase_cycles` (nova) — um ciclo por venda que gera lembrete
| coluna | uso |
|---|---|
| id, account_id, lead_id | |
| sale_id | venda que abriu o ciclo (`lead_sales.id`, ON DELETE CASCADE) |
| kind | `'recompra' \| 'cruzada'` |
| status | `'aguardando' \| 'a_contatar' \| 'em_conversa' \| 'comprou' \| 'nao_agora' \| 'nao_quer' \| 'encerrado'` |
| remind_at | data do próximo lembrete (TEXT, data local da conta) |
| attempt | nº da tentativa atual (começa em 1) |
| offer_text | o que oferecer (vendedor) |
| ai_suggestion | JSON `{ products: [...], message }` gerado pela IA (cache; nulo sem IA) |
| task_id | `standalone_tasks.id` da tarefa aberta desta tentativa |
| auto_sent_at | quando o envio automático saiu (nulo se manual) |
| closed_reason_id, closed_at, closed_by | motivo final (`nao_quer`) |
| created_at, updated_at | |

Regra: **no máximo 1 ciclo aberto por lead** (índice único parcial em `lead_id WHERE status IN ('aguardando','a_contatar','em_conversa')`). Venda nova com lembrete **encerra** o ciclo aberto anterior (`status='comprou'` se estava em a_contatar/em_conversa/aguardando por recompra; registra resultado) e abre outro.

### 4.3 `repurchase_attempts` (nova) — histórico de cada tentativa (para métricas)
`id, account_id, cycle_id, lead_id, attempt, kind, outcome ('comprou'|'nao_agora'|'nao_quer'|'sem_desfecho'), reason_id NULL, next_remind_days NULL, auto INTEGER (1 = contato automático), contacted_at, decided_at, decided_by`.

### 4.4 `repurchase_reasons` (nova)
`id, account_id, group ('nao_agora'|'nao_quer'), label, position, is_active`. Semeada por conta na primeira vez que o funil Recompra é criado:
- nao_agora: Achou caro · Não precisa agora · Sem dinheiro no momento · Sem resposta · Outro
- nao_quer: Comprou do concorrente · Insatisfeito com a compra · Não usa mais o produto · Pediu para não ser chamado · Outro

Motivo desativado continua nas métricas antigas.

### 4.5 `customer_tiers` (nova) — selos de valor
`id, account_id, name, icon (emoji, opcional), color, min_ltv REAL, position`. Sem linhas = sem selo.

### 4.6 `accounts` (colunas novas)
- `repurchase_funnel_id INTEGER NULL` — o funil Recompra da conta.
- `repurchase_max_attempts INTEGER NOT NULL DEFAULT 5`.
- `repurchase_auto_send INTEGER NOT NULL DEFAULT 0`.
- `curve_a_days INTEGER NOT NULL DEFAULT 30`, `curve_b_days … 45`, `curve_c_days … 60` (validação: A < B < C, entre 1 e 365).

### 4.7 `funnel_stages` (coluna nova)
- `system_key TEXT NULL` — marca as etapas-chave do funil Recompra: `aguardando`, `a_contatar`, `em_conversa`, `comprou`, `nao_agora`, `nao_quer`. Etapas com `system_key` **não podem ser apagadas** (podem ser renomeadas/recoloridas/reordenadas). O gestor pode acrescentar etapas extras (sem chave), que funcionam como "em conversa" para as métricas.

### 4.8 `funnels` (coluna nova)
- `kind TEXT NOT NULL DEFAULT 'vendas'` — `'vendas' | 'recompra'`. Métricas de funil de vendas existentes **filtram `kind='vendas'`** para não misturar.

### 4.9 `leads` (colunas novas, cache para filtros rápidos)
- `ltv REAL NOT NULL DEFAULT 0`, `purchases INTEGER NOT NULL DEFAULT 0`, `last_purchase_at TEXT NULL`, `avg_interval_days REAL NULL`, `curve TEXT NULL` (`'A'|'B'|'C'|'D'|'1a'`), `tier_id INTEGER NULL`, `repurchase_opt_out INTEGER NOT NULL DEFAULT 0`.
- Recalculadas por `recalcCustomer(db, leadId)` a cada venda criada/apagada/editada e na rotina diária (a curva muda com o tempo). Backfill no boot para todos os leads com vendas (idempotente).
- `leads.value_estimated` continua = soma das vendas (compatibilidade com o Dashboard).

## 5. Registrar venda (painel do lead / ficha / "Comprou de novo")

Janela "Registrar venda" ganha:
- **Produto/serviço vendido** (texto, opcional, até 200 caracteres).
- **Tipo**: ◉ Pode recomprar · ○ Compra única (obrigatório em venda nova).
- Pode recomprar → "Lembrar em": [7] [15] [30] [45] [60] dias (padrão: o último usado pelo lead; senão 30).
- Compra única → ☐ Oferecer relacionados depois → "em" [7…60] + "O que oferecer" (opcional; dica: "vazio = IA sugere", só se a conta tem IA).
- Explicação com exemplo (regra "explica com exemplo"): "Ex.: vendeu uma churrasqueira → ofereça espetos e tábuas em 15 dias."

Ao salvar (`POST /leads/:id/sales`, transação):
1. grava a venda com os campos novos;
2. `recalcCustomer`;
3. se `recompra` ou `unica + cross_sell`: encerra ciclo aberto anterior (outcome `comprou` se já estava em contato; `sem_desfecho` se ainda aguardando) e **abre ciclo** com `remind_at = sale_date + remind_days`, attempt 1;
4. **move o lead para o funil Recompra, etapa `aguardando`** (garantindo o funil; ver §6.1). `remind_at` no passado (venda retroativa) → entra direto em `a_contatar` e gera tarefa;
5. `unica` sem oferta → nada muda no funil (fica no "Ganho").
6. `repurchase_opt_out = 1` → a venda é registrada e soma no LTV, mas **não abre ciclo** (aviso na janela: "Cliente marcou que não quer mais ser chamado — [Reativar]").

Apagar venda (`DELETE`, gestor): recalcula; se a venda tinha ciclo **aberto**, o ciclo é encerrado (`encerrado`) e a tarefa aberta é concluída com nota "venda apagada"; o lead fica onde está.

## 6. Funil Recompra

### 6.1 Criação
`ensureRepurchaseFunnel(db, accountId)` (idempotente): cria o funil `kind='recompra'`, nome "Recompra", com as 6 etapas-chave nesta ordem — Aguardando · A contatar · Em conversa · Comprou de novo (`is_conversion=1`) · Não comprou agora · Não quer mais (`is_terminal=1`) — e semeia os motivos. Roda no boot para todas as contas e ao salvar a primeira venda com ciclo.

### 6.2 Troca de funil
Nova função `moveLeadToFunnel(db, { lead, toFunnelId, toStageId, trigger, userId })` em `stageMove.js`: grava histórico (mesmo formato da troca de etapa, com origem/destino de funil), atualiza `funnel_id`+`stage_id`, fecha a cadência de etapa do funil antigo e dispara o hook de "entrou na etapa" (cadência da etapa do novo funil começa sozinha, se existir). Sem trava de roteiro. Sem evento CAPI de conversão (a CAPI de venda já saiu quando o lead ganhou no funil de vendas; a venda nova registra CAPI só se a conta já manda CAPI por venda hoje — manter o comportamento atual de `POST /sales`).

### 6.3 Movimentos e o que cada etapa faz
| Evento | Efeito |
|---|---|
| Rotina diária: `remind_at <= hoje` e ciclo `aguardando` e `attempt <= max` | lead → `a_contatar`; cria tarefa (§7); se automático ligado → envia (§8) |
| `attempt > max` | não move nem cria tarefa; ciclo fica `aguardando` marcado "tentativas esgotadas"; aparece em Parados/Atrasados |
| Vendedor responde / cliente responde (mensagem trocada) com lead em `a_contatar` | lead → `em_conversa` (automático, sem trava) |
| Arrastar para **Comprou de novo** | abre "Registrar venda" (obrigatório concluir; cancelar desfaz o arraste). A venda nova recomeça o ciclo → lead volta para `aguardando` (ou fica em "Comprou de novo" se a venda nova for compra única sem oferta) |
| Arrastar para **Não comprou agora** | janela: motivo (obrigatório) + "Tentar de novo em" [7…60] (padrão = prazo anterior). Grava tentativa; `attempt+1`; `remind_at = hoje + dias`; lead → `aguardando`; conclui a tarefa aberta |
| Arrastar para **Não quer mais** | janela: motivo (obrigatório) + aviso "não receberá mais lembretes nem ofertas". Ciclo `nao_quer`; `leads.repurchase_opt_out=1`; conclui tarefa. [Desfazer] na ficha → `opt_out=0`, lead volta para `aguardando` com lembrete em 7 dias |
| Arrastar para `aguardando`/`a_contatar`/`em_conversa`/etapa extra | só move (sem janela) |
| Lead manda SAIR | `opt_out` do WhatsApp já existente bloqueia envio automático; ciclo segue com tarefa manual (o vendedor decide) |

Os botões [Não comprou agora] / [Não quer mais] / [Comprou de novo] também aparecem no cartão de recompra do painel do lead (sem precisar do Pipeline).

### 6.4 Cadências
A Cadência da Etapa já funciona em qualquer funil; o gestor pode montar cadência para "A contatar" / "Em conversa" do funil Recompra. Sem cadência nova específica.

## 7. Tarefa do lembrete
Criada em `standalone_tasks` (tarefa manual, aparece em Tarefas e no Chat):
- responsável = `leads.attendant_id`, senão `lead_sales.created_by`, senão sem responsável (aparece para o gestor);
- `due_datetime` = dia do lembrete, 09:00 (ou início do horário de atendimento da conta);
- título: recompra → "Lembrar {nome} da recompra ({produto}, {N} dias)"; cruzada → "Oferecer relacionados a {nome} (comprou {produto})";
- descrição: tentativa X de Y, o que oferecer (vendedor ou sugestão da IA), última compra e valor, e a mensagem pronta (IA) quando houver;
- a tarefa tem **[Revisar e enviar]** que abre "Conferir mensagem" com a mensagem pronta (ou vazia sem IA).
- Nunca duplica: `repurchase_cycles.task_id` + checagem por (ciclo, tentativa).

### 7.1 Sugestão da IA (venda cruzada sem "o que oferecer", e mensagem de recompra)
- Só se a conta tem IA ligada e orçamento (`aiBudget`, fonte nova `repurchase`, dentro do orçamento geral da conta).
- Entrada: produto, valor, data, notas da venda, nome do cliente, tom do agente da conta (se houver). Saída JSON `{ products: string[3..5], message: string }`.
- Gerada **na hora de criar a tarefa** (não na venda) e guardada em `ai_suggestion`. Erro/sem orçamento → tarefa sai sem sugestão (nunca bloqueia).

## 8. Envio automático
- Chave **"Lembretes automáticos"** em Configurações do funil Recompra. Só habilita se: IA ligada **e** existe número de disparo conectado (`resolveSendInstance` automático). Senão, a chave fica cinza com o motivo.
- Quando o lead entra em `a_contatar` pela rotina: gera mensagem (IA), envia por `sender.js` como **automático** (passa por todas as travas: número de disparo, SAIR, pacing/catraca, horário de atendimento, rodapé "Digite SAIR", taxa de resposta). Envio fora do horário espera o próximo horário.
- Sucesso → `auto_sent_at`, tentativa `auto=1`, lead → `em_conversa`, tarefa vira "Acompanhar resposta de {nome}" com vencimento +2 dias.
- Falha (sem número, SAIR, erro) → fica a tarefa manual normal, com a mensagem pronta; nada de reenvio em laço.
- `repurchase_opt_out=1` ou lead apagado/arquivado → nunca envia.

## 9. Rotina diária (`server/services/ltv/daily.js`)
Chamada pelo `scheduler.js` (checa a cada hora; roda 1x por dia por conta, dentro do horário de atendimento; guarda `last_run` por conta):
1. ciclos `aguardando` com `remind_at <= hoje` → §6.3 (recupera atrasados se o servidor ficou desligado);
2. recalcula curva de todos os clientes da conta (ritmo muda com o tempo) e selo;
3. emite SSE `customers:updated`.
Idempotente: rodar duas vezes no mesmo dia não duplica tarefa nem envio.

## 10. Telas

### 10.1 Configurações → "Clientes" (gestor)
- **Curva por ritmo:** A até [30] dias · B até [45] · C até [60] · acima = D. Exemplo ao lado: "Cliente que compra a cada 20 dias = A. Se parar por 50 dias, vira C até comprar de novo."
- **Selos de valor:** lista (nome, ícone, cor, "a partir de R$"), [+ Novo selo]. Vazio: "Crie selos como 💎 Diamante (a partir de R$ 5.000) para destacar quem mais compra."
- **Recompra:** limite de tentativas [5]; "Lembretes automáticos" (com as condições); motivos (dois grupos, editar/ordenar/desativar).
- Salvar automático com "Salvo ✓" (padrão das telas recentes).

### 10.2 Tela "Clientes" (menu; gestor vê todos, vendedor vê os seus — mesma regra de acesso de Leads)
Filtros no topo: período (para métricas de vendas/recompra), atendente, "Mais filtros..." (Estado/Cidade).
1. **Visão geral:** LTV médio · ticket médio · compras por cliente · % clientes com 2+ compras · tempo real de recompra × prazo marcado (+ sugestão) · distribuição por curva e por selo.
2. **Clientes:** tabela — nome, curva, selo, LTV, nº compras, última compra, próxima recompra (ou status do ciclo), atendente. Filtros: curva, selo, atrasado, "não quer mais". Ordenar por LTV/última compra. Clique abre o lead (Chat).
3. **Recompra:** funil com números (lembretes → em conversa → comprou / não agora / não quer), taxa de cada passo; gráfico de motivos (dois grupos); "voltou a comprar em qual tentativa" (1ª, 2ª, 3ª, 4ª+); recompra × venda cruzada; automático × manual (quando houver). Período filtra por `contacted_at`.
4. **Parados:** (a) Atrasados na recompra — lista + valor parado (soma do ticket médio de cada um); (b) faixas sem comprar × curva × selo (tabela cruzada com contagem e LTV somado). Selecionar/“todos da faixa” → **[Criar tarefas]** (tarefa manual "Reativar {nome}" para o atendente; não abre ciclo; limite 200 por clique).
Estados vazios com exemplo (ex.: "Nenhuma venda com recompra ainda. Ao registrar uma venda, marque 'Pode recomprar'…").

### 10.3 Painel do lead (aba Atendimento do Chat e ficha)
Bloco novo **"Cliente"** (entra no "Arrumar"; padrão: visível abaixo de Vendas, só aparece se o lead tem venda): "💎 Diamante · Curva A · LTV R$ 6.200 · 8 compras · última há 12 dias" + status do ciclo ("Próxima recompra em 18 dias" / "A contatar — tentativa 2 de 5" / "Não quer mais [Desfazer]") + botões do §6.3.
Lista de vendas mostra produto e tipo; venda antiga mostra [Marcar tipo].

### 10.4 Dashboard
Quadro **"Recompra"**: atrasados (nº e valor parado) · taxa de recompra no período · clientes com 2+ compras · link "Ver clientes".

### 10.5 Leads e Pipeline
"Mais filtros...": Curva (A/B/C/D/1ª compra), Selo, "Atrasado na recompra". Parâmetros `?curve=&tier_id=&repurchase_late=1` nas rotas de lista. Pipeline já troca de funil; o funil Recompra aparece na lista de funis com ícone próprio.

## 11. API (novas/alteradas)
- `POST /leads/:id/sales` (campos novos, §5) · `PATCH /leads/:id/sales/:saleId` (marcar tipo de venda antiga / produto) · `DELETE` (§5).
- `POST /leads/:id/repurchase/outcome` `{ outcome: 'nao_agora'|'nao_quer', reason_id, next_days? }` · `POST /leads/:id/repurchase/undo-optout`.
- `GET /customers/overview|list|repurchase|stale` (filtros de período/atendente/geo/curva/selo).
- `POST /customers/stale/tasks` `{ lead_ids[] | band, curve?, tier_id? }`.
- `GET/PUT /customers/settings` (curva, tentativas, automático) · CRUD `/customers/tiers` · CRUD `/customers/reasons`.
Todas com trava de conta (`scopeToAccount`) e regra de acesso de vendedor igual a Leads; configurações só gestor/admin.

## 12. Erros e segurança
- Nada muda para quem não usa: funil criado vazio, automático desligado, vendas antigas intactas.
- Migrações idempotentes (`addColumnIfNotExists`, `CREATE TABLE IF NOT EXISTS`); backfill do cache de cliente em lote, sem travar o boot (conta a conta).
- Métricas existentes de funil/Dashboard/Projeção filtram `funnels.kind='vendas'` para não contar o funil Recompra como vendas novas.
- Etapa-chave não pode ser apagada (409 com mensagem). Funil Recompra não pode ser apagado nem virar padrão de entrada de leads.
- Lead que chega por mensagem nova já estando no funil Recompra **continua lá** (não volta para o funil de entrada).
- Nenhuma tarefa/envio duplicado (chaves por ciclo+tentativa; rotina idempotente).
- IA: erro ou sem orçamento nunca bloqueia tarefa; fonte `repurchase` contabilizada no orçamento geral.

## 13. Testes
- Funções puras: LTV, ticket, intervalo médio (vendas no mesmo dia), ritmo atual e curva (limites 30/45/60, "1ª compra", parado caindo de letra), selo (limites, sem selos), mediana de recompra e sugestão, faixas sem comprar, atrasado.
- Venda: abre/encerra ciclo, move de funil, retroativa, compra única sem oferta, opt-out, apagar venda.
- Funil: outcomes (motivo obrigatório, próxima tentativa, limite de tentativas), comprou de novo recomeça e zera tentativa, desfazer "não quer".
- Rotina diária: idempotência, recuperação de atraso, tarefa única, responsável, horário.
- Automático: só com IA + número de disparo; bloqueia SAIR/opt-out/Evolution; falha vira tarefa manual.
- Métricas das abas e filtros (curva/selo/atrasado) com trava de conta.
- Métricas antigas não contam o funil Recompra.
- Conferência no navegador: registrar venda (3 tipos), Pipeline Recompra (arrastar com janelas), tela Clientes (4 abas), Configurações, cartão do lead, Dashboard, filtros.

## 14. Fora do escopo (versões futuras)
Cadastro de produtos/catálogo; recomendação de produtos por histórico de outros clientes; campanhas em massa automáticas para "Parados" (hoje: criar tarefas); vários funis de recompra por conta; RFM completo.

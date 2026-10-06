# Filtro de Funil (Vendas novas x Recompra) no Chat e nos Relatórios — Desenho

Data: 05/10/2026 · Status: desenho aprovado na conversa; aguardando revisão da spec escrita

## 1. Objetivo

Hoje os números de quem já é cliente (funil Recompra) se misturam com os de venda nova
(total de leads, faturamento, atendimentos) e as listas do Chat/Leads misturam as etapas dos
dois funis. O gestor e o vendedor passam a escolher **Vendas novas · Recompra · Todos** num
seletor único, e cada número conta certo.

Decisões do dono:
- Opções **Vendas novas · Recompra · Todos**, padrão **Vendas novas**.
- Números classificados **pela história**, não pelo funil atual (§3).
- Telas com o filtro: **Chat, Leads, Dashboard, Projeção, Atendimentos**. Ficam como estão:
  Pipeline (já tem seletor próprio de funil), Clientes (já é só recompra), Tarefas.
- Seletor sempre visível ao lado do título (fora do "Mais filtros").

## 2. Como o CRM identifica cada funil (já existe)

- `funnels.kind`: `'vendas'` (padrão) ou `'recompra'` (criado por `ensureAllRepurchaseFunnels`,
  `server/services/ltv/funnel.js`). Uma conta pode ter vários funis `vendas`; tem no máximo um
  `recompra`.
- `stage_history(lead_id, from_stage_id, to_stage_id, created_at)` registra cada troca de etapa.
- `lead_sales(lead_id, value, sale_date)` registra cada venda.

Nenhuma coluna ou tabela nova.

## 3. Regras de classificação

Valor do filtro: `funnel=vendas | recompra | todos` (ausente = `todos` no servidor, para não
quebrar quem chama sem o parâmetro; o padrão `vendas` é do front).

| Item | `vendas` | `recompra` | `todos` |
|---|---|---|---|
| **Listas** (Chat, Leads, export) | lead cujo funil **atual** tem `kind='vendas'` | funil atual `kind='recompra'` | sem filtro (igual hoje) |
| **Leads no período** | leads **criados** no período, exceto os que nasceram direto no funil recompra (1ª linha de `stage_history` do lead em etapa de funil recompra; sem histórico, vale o funil atual) | leads que **entraram** no funil recompra no período (alguma entrada em etapa de funil recompra vinda de etapa de outro funil ou sem origem, com `created_at` no período), cada lead contado uma vez | igual hoje |
| **Vendas e faturamento** | venda que é a **1ª do lead** (menor `sale_date`, desempate por `id`) | vendas da **2ª em diante** | todas |
| **Taxa de conversão** | 1ªs vendas ÷ leads no período (coluna vendas) | recompras ÷ leads que entraram na recompra no período | igual hoje |
| **Funil por etapa** | etapas do funil de vendas padrão (`is_default=1`) | etapas do funil recompra | igual hoje (funil padrão) |
| **Investimento, CPL, CAC, ROAS, meta, projeção futura** | calculados normalmente | **"—"** com aviso "Investimento é para venda nova" | igual hoje |
| **Atendimentos** (conversas, respondidos, SLA, ranking, críticas, coaching) | mensagens/insights de quando o lead estava em vendas (antes de entrar na recompra, ou lead que nunca entrou) | mensagens/insights depois que o lead entrou na recompra | tudo |

"Entrou na recompra em" = `MIN(stage_history.created_at)` em etapa de funil `kind='recompra'`;
lead que voltou para vendas depois continua com esse marco (conta onde estava em cada momento:
mensagens entre a ida à recompra e a volta contam como recompra; após a volta, como vendas —
implementado pela janela de cada estadia, ver §4).

Interação com outros filtros: soma com Estado/Cidade e com o tipo de contato (interno/revendedor
continuam fora dos números, como hoje).

## 4. Servidor

Módulo novo `server/services/funnelScope.js` (único lugar com a regra):
- `parseFunnelFilter(query)` → `'vendas' | 'recompra' | 'todos'`.
- `currentFunnelWhere(alias, filter)` → trecho SQL para listas (funil atual do lead).
- `leadsInPeriodSql(filter)` / `salesWhere(alias, filter)` → trechos para contagem de leads e
  vendas pela história (vendas: `NOT EXISTS (venda anterior do mesmo lead)` para `vendas`,
  `EXISTS` para `recompra`).
- `recompraStaysSql()` → CTE com as estadias de cada lead no funil recompra
  (`entrou_em`, `saiu_em` nulo se ainda está), a partir de `stage_history`; usado para
  classificar mensagens/insights por data.
- `hasRepurchaseFunnel(db, accountId)`.

Rotas que passam a aceitar `?funnel=`:
- `GET /api/leads` e `/api/leads/export` (`server/routes/leads.js`) — listas; o `funnel_id`
  atual continua funcionando e tem prioridade quando enviado (Pipeline).
- `server/routes/dashboard.js`: `/stats`, `/funil-mensal/:month`, `/projecao` (via
  `computeFunnelCascade`), overview-v2, ranking-v2 e as demais rotas da análise de
  atendimentos; `server/services/attendantMetrics.js`.
- Troca dos `kind='vendas'` e `is_default=1` fixos dessas consultas pela regra do filtro
  (com `todos` dando exatamente o resultado de hoje).

## 5. Front

- `src/lib/funnelFilter.js` (+ `.d.ts`): valores, rótulos, `funnelParams(value)`,
  `funnelQuery(value)`, `leadMatchesFunnel(lead, value, funnels)` (para leads que chegam por SSE
  no Chat).
- Hook `useFunnelFilter(accountId)` (mesmo padrão de `useCityFilter`), localStorage
  `dros_funnel_filter_${accountId}`, padrão `vendas`.
- Componente `FunnelFilter` (três botões, ao lado do título). Não aparece se a conta não tem
  funil recompra.
- Telas: Chat (lista + seletor de etapas só do funil escolhido; em `todos`, etapas agrupadas por
  funil), Leads (idem + Exportar), Dashboard, Projeção, AttendantAnalytics (todas as abas).
  Cartões de custo em `recompra` mostram "—" com o aviso.

## 5b. Atendimentos: agregado noturno por funil (decisão do dono, opção A)

Os cartões de SLA/1ª resposta/respondidos/ociosos vêm do agregado noturno
`attendant_metrics_daily` (por vendedor e dia, sem funil). Tabela nova
`attendant_metrics_daily_funnel` (mesmas colunas + `funnel_kind` 'vendas'|'recompra',
`UNIQUE(account_id, user_id, date, funnel_kind)`); a tabela antiga fica intocada e continua sendo a
fonte do modo `todos`. O agregador noturno grava também as duas linhas por funil: cada lead conta
no funil em que estava **no início do dia** (lead novo: funil em que nasceu). Na primeira subida, um
preenchimento único (marcado em `app_settings`) recalcula os últimos 90 dias em segundo plano.
Insights da IA (análise, críticas, alertas, inteligência de mercado, erros/fortes do ranking)
são filtrados pelo funil do lead na data da análise/criação. O **coaching semanal** (texto gerado
por vendedor) não é separado por funil.

## 6. Erros e limites

- Parâmetro inválido → tratado como `todos`.
- Conta sem funil recompra → seletor escondido; servidor responde como `todos`.
- Venda retroativa: a ordem das compras segue `sale_date`.
- Lead sem histórico de etapas: classificado pelo funil atual.

## 7. Testes

Conta montada com o exemplo da Maria (chegou dia 2, 1ª venda dia 10 → entrou na recompra,
2ª venda dia 25, mensagens antes e depois) e um lead que volta da recompra para vendas:
- cada número de `/stats`, funil mensal, projeção e atendimentos nos três modos;
- `todos` idêntico ao resultado anterior (testes atuais continuam passando sem mudança);
- listas por funil atual; `funnel_id` com prioridade; export;
- isolamento por conta; conta sem funil recompra;
- `funnelFilter.js` (parse, query, match).
Suíte inteira + `tsc` (sem erros novos) + build + conferência no navegador (Chat, Leads,
Dashboard, Projeção, Atendimentos).

## 8. Fora do escopo

Filtro em Tarefas, Pipeline e Clientes; separar investimento por funil; metas separadas para
recompra.

# Performance do Vendedor — Diário de Atividades, Indicadores e "O que gera venda" — Desenho

Data: 05/10/2026 · Status: direção aprovada na conversa; aguardando revisão da spec escrita

## 1. Objetivo

O gestor vê, por vendedor e por dia, **quanto** ele trabalhou (ligações, mensagens, propostas,
vendas, leads novos atendidos, leads em atendimento), **quão bem** (respostas, avanço, velocidade),
comparado com a **média dele e a do time**, e entende **quais ações levam a conversa e a venda**.
Tudo calculado pelo CRM; o vendedor continua trabalhando igual (o único passo novo é um clique
opcional para registrar o resultado de uma ligação).

Uso decidido pelo dono: **C** = cobrar ritmo diário **e** ensinar (copiar o jeito de quem vende).
Regras do dono: não engessar o fluxo; cálculos e KPIs são internos, só para o gestor; muitos
vendedores usam o WhatsApp **só no celular** — o que sai do celular tem que contar; a IA aproveita
as leituras de conversa que já faz; ligações por API ficam para um próximo ciclo.

## 2. Entregas

- **Parte 1 (sobe primeiro):** diário de atividades (§3-§5), botão "Registrar ligação" (§6),
  tela Performance com Hoje e Período (§8).
- **Parte 2 (mesma subida, se couber no plano):** atividades lidas pela IA (§7) e aba
  "O que gera venda" (§9).
- **Próximo ciclo (fora):** chamadas de voz do WhatsApp por webhook (Evolution/UzAPI), metas por
  vendedor, vendedor ver o próprio painel.

## 3. Princípio: um diário só, por quem fez

Tabela nova `seller_activities` — cada linha é uma ação de uma pessoa num lead:

| coluna | o que é |
|---|---|
| `id`, `account_id`, `lead_id` | |
| `user_id` | quem fez (pode ser `NULL` quando não dá para saber — não entra em ranking) |
| `type` | `message`, `call`, `first_response`, `proposal`, `sale`, `stage_advance`, `cadence_step`, `qualification`, `appointment`, `objection` |
| `source` | `crm` (feito na tela), `celular` (saiu do WhatsApp do celular), `ia` (lido pela IA), `cadencia` (passo marcado) |
| `result` | ligação: `atendeu`, `nao_atendeu`, `caixa_postal`, `numero_errado`, `nao_informado`; objeção: `preco`, `prazo`, `concorrente`, `outra`; passo: `visita`, `reuniao`, `email`, `outro` |
| `value` | R$ da venda |
| `minutes` | `first_response`: minutos até a 1ª resposta humana |
| `stage_id` | etapa do lead na hora |
| `ref_kind`, `ref_id` | origem (`message`, `cadence_step`, `stage_history`, `sale`, `proposal`, `answer`, `call`, `insight`) — `UNIQUE(ref_kind, ref_id, type)` evita contar duas vezes |
| `evidence` | trecho da conversa (atividades da IA) |
| `note` | nota do vendedor (ligação) |
| `occurred_at`, `created_at`, `removed_at`, `removed_by` | `removed_*` = gestor marcou "não aconteceu" (só para `source = 'ia'`) |

Índices: `(account_id, occurred_at)`, `(account_id, user_id, occurred_at)`, `(lead_id, occurred_at)`.
Tudo `CREATE TABLE IF NOT EXISTS` (SQLite antigo do servidor).

## 4. Como o diário se enche (sem mexer no trabalho do vendedor)

Serviço `server/services/performance/sync.js` — **sincronização incremental** a partir das
tabelas que já existem (não espalha gancho por todo o código). Roda a cada 5 minutos no agendador
e também antes de abrir a tela Performance (só o que falta, por conta). Guarda o último id lido
por fonte em `performance_sync_state(account_id, source, last_id)`.

| Fonte | Vira | Quem fez |
|---|---|---|
| `messages` outbound com `sent_by_user_id` | `message`, source `crm` | `sent_by_user_id` |
| `messages` outbound vindas do celular: `sent_by_user_id IS NULL`, `ai_agent_id IS NULL`, `follow_up_id IS NULL`, `sender_name = ''` | `message`, source `celular` | vendedor dono do número (`users.primary_instance_id = messages.instance_id`, se só 1); senão o atendente do lead na hora (`leads.attendant_id`); senão `NULL` |
| 1ª mensagem humana (crm ou celular) do lead | `first_response` (+ `minutes` desde o 1º inbound ou a criação do lead) | quem respondeu |
| `lead_cadence_steps` (how ≠ `pulado`) | `call` (passo `ligacao`, result `nao_informado`) ou `cadence_step` (visita/reunião/e-mail/outro); passo `mensagem`/`pergunta` não conta (a mensagem já conta) | `done_by` |
| `stage_history` com destino de `position` maior e não final | `stage_advance` | `triggered_by` (automático = `NULL`) |
| `lead_sales` | `sale` + `value` | `created_by` |
| `proposals` (tabela de propostas) e `leads.proposal_sent_at` | `proposal` | `created_by` / atendente do lead |
| `lead_answers` com `origin = 'manual'` | `qualification` | `answered_by` |

Não contam: mensagens automáticas (robô, follow-up, disparos, boas-vindas, recompra automática,
descadastro), mensagens recebidas.

Antes de contar "celular", o plano confere se ecos de disparos/UzAPI chegam pelo webhook como
`fromMe` sem marca (se chegarem, a regra ganha o filtro que os separa).

## 5. "Leads em atendimento" e "novos atendidos"

- **Novos leads atendidos** no período = `first_response` do vendedor no período.
- **Leads em atendimento** = leads diferentes com `message` (crm/celular) ou `call` do vendedor no
  período, **menos** os novos atendidos no mesmo período.
- **Conversas** = leads diferentes com qualquer atividade do vendedor.

## 6. Botão "Registrar ligação"

No Chat (aba Atendimento, bloco do lead) e na ficha do lead: botão **📞 Ligação** abre uma janela
com o resultado (Atendeu / Não atendeu / Caixa postal / Número errado) e nota opcional (até 500).
Grava `call` source `crm`. Passo "Ligação" da cadência marcado como feito pelo mesmo vendedor no
mesmo lead até 30 min antes/depois de uma ligação registrada **não conta de novo** (fica só a
registrada, que tem o resultado). Rota `POST /api/performance/leads/:leadId/calls`
(vendedor com acesso ao lead).

## 7. Atividades lidas pela IA

A análise noturna de conversas (`conversationAnalyzer`, que já lê a conversa do dia e já tem
orçamento próprio) ganha, **na mesma chamada**, a lista `activities` na ferramenta
`save_insights_v2`: `{ type: proposal | call | sale | appointment | objection, result?, evidence,
said_by: cliente | vendedor, message_ref? }`. Regras do prompt: só com prova na conversa; evidence
= trecho exato. Grava com `source = 'ia'`, `user_id` = vendedor da mensagem mais próxima (dono do
número/atendente), `ref_kind = 'insight'`.

Sem duplicar: atividade da IA do mesmo tipo, lead e dia que já exista por outra fonte
(`crm`/`cadencia`/`sale`) não entra. **Venda provável** (cliente mandou comprovante, "fechado")
sem venda registrada: além do diário, aviso ao vendedor do lead ("Parece que o João fechou.
Registrar a venda?") pelo SSE existente; não registra venda sozinha.

Conta sem IA: segue só com as fontes do §4 e o botão; nada quebra.

## 8. Tela "Performance" (só gestor: gerente e super_admin)

Menu novo **Performance** (não depende da chave `attendant_analytics_enabled`). Filtros: período
(Hoje, Ontem, 7 dias, 30 dias, mês) e vendedor (todos).

**Aba Hoje (contador):** um cartão por vendedor com: mensagens (e conversas), ligações (atendidas),
novos atendidos, em atendimento, propostas, vendas (qtd e R$), avanços de etapa, passos feitos,
perguntas registradas, 1ª resposta média. Cada número com seta/cor em relação à **média diária
do próprio vendedor nos últimos 30 dias** (verde ≥ 110%, amarelo 70-110%, vermelho < 70%;
dia útil = dia com pelo menos 1 atividade). Selo "pelo celular X%" (quanto saiu do celular).

**Aba Período (indicadores):** tabela por vendedor com 5 grupos:
- **Esforço:** mensagens, ligações, conversas, novos atendidos.
- **Qualidade:** % de leads que responderam depois do contato (resposta em até 24h), % ligações
  atendidas, % conversas que avançaram de etapa.
- **Velocidade:** 1ª resposta média e mediana, % respondidos em até 5 min, leads novos sem
  resposta humana, leads do vendedor parados há mais de 3 dias.
- **Resultado:** propostas, vendas, R$, taxa proposta → venda.
- **Eficiência:** ações por venda, ações por conversa que avançou.
Linha "Média do time" no fim; célula colorida vs média do time (mesmas faixas). Clicar no vendedor
abre a lista das atividades dele (com marca CRM / Celular / IA / Cadência; atividade da IA tem
[Não aconteceu] para o gestor).

Cada indicador com "?" explicando com exemplo (regra do CRM: explica com exemplo).

## 9. Aba "O que gera venda"

Calculado sem IA, no período escolhido (mínimo 30 dias; com menos de 5 vendas mostra "Ainda há
poucas vendas para comparar"):
- **Caminho médio da venda:** para leads com venda no período, ações do 1º contato até a venda
  (mensagens, ligações atendidas, propostas), dias, 1ª resposta. Ex.: "Vendas tiveram em média 14
  mensagens, 1 ligação atendida e 1 proposta em 3 dias."
- **Velocidade × venda:** taxa de venda de leads com 1ª resposta ≤ 5 min vs > 1 h.
- **Ligação × venda:** taxa de venda de leads com ligação atendida vs sem ligação.
- **Comparação por vendedor:** mesma conta por vendedor, frase do maior contraste. Ex.: "A Ana
  liga em 60% das conversas e fecha 2x mais que a média."
- **Perguntas que mais levam a proposta/venda:** reaproveita `questionMetrics` (roteiro).
- **Objeções mais comuns** (da IA) e quanto viraram venda.

## 10. Erros e limites

- Sincronização falhou numa fonte: registra no log e segue as outras; a tela mostra os dados até o
  último sucesso.
- Vendedor desconhecido (`user_id NULL`): conta no total da conta, não em vendedor.
- Atendente (vendedor) não acessa a tela nem as rotas de relatório (403); a rota de ligação respeita
  o acesso ao lead.
- Período máximo de consulta: 180 dias.

## 11. Testes

Sync por fonte (crm, celular com atribuição pelo número/atendente, automáticas fora, passo de
ligação, avanço, venda, proposta, pergunta manual), idempotência (rodar 2x não duplica),
first_response com minutos, deduplicação ligação registrada × passo da cadência, novos × em
atendimento, médias e cores, isolamento por conta, IA (grava com prova, não duplica fonte certa,
venda provável avisa sem registrar, [Não aconteceu]), "O que gera venda" com dados montados,
rotas (gestor vê, atendente 403). Suíte inteira + build + conferência no navegador.

## 12. Fora do escopo

Metas por vendedor; painel do próprio vendedor; chamadas por webhook/telefonia; comissão;
exportação CSV (pode vir depois a partir do diário).

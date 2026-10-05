# CRM Simples que Trabalha Sozinho — Desenho

Data: 05/10/2026 · Status: visão aprovada pelo dono na conversa ("pode escrever"); aguardando revisão da spec escrita

Esta spec junta tudo numa entrega só: **tipo de contato**, **funil padrão automático**,
**telas simples** (Meu dia, Cadências, Chat), **IA que monta e aprende entre contas**, **regra de
chaves de IA** e **Performance do vendedor** (a spec `2026-10-05-performance-vendedor-design.md`
entra aqui inteira, com os ajustes do §9). O SPIN por perfil (ramo `feat/spin-selling`) continua
por baixo e sobe junto.

## 1. Objetivo e princípios

O vendedor abre o CRM e sabe na hora o que fazer; o gestor abre e sabe como está o time; a IA
monta e aprende por trás. Ninguém precisa entender de método de vendas.

Regras de usabilidade (valem para toda tela desta entrega):
1. Uma tela, um objetivo (Meu dia = agir; Performance = acompanhar; Cadências = ajustar).
2. A próxima ação sempre visível, com um botão grande; nunca tela vazia sem dizer o que fazer.
3. Língua do cliente: sem "SPIN", "BANT", "modelo", "obrigatória", "fase", "desvio" na tela
   principal (só em "Ajustes avançados").
4. Exemplo dentro de cada campo e de cada "?".
5. Nada obrigatório de configurar: a IA monta; o gestor confere.
6. Avançado escondido ("Ajustes avançados", "ver mais").
7. Quando o CRM muda algo sozinho, mostra "Desfazer" em vez de travar.
8. Cores: verde = ok, amarelo = atenção, vermelho = agir agora.

## 2. Tipo de contato

Coluna `leads.contact_type` (`lead` padrão | `cliente` | `revendedor` | `interno`) e
`leads.contact_type_origin` (`auto` | `lista` | `ia` | `manual`).

**Detecção automática (nesta ordem; manual nunca é sobrescrito):**
1. **Interno:** telefone igual ao de um usuário da conta (`users.phone`, normalizado) ou de um
   número conectado da conta (`whatsapp_instances`). Roda ao criar o lead e no boot (uma vez).
2. **Lista:** telefone numa lista do gestor — tabela `contact_lists(account_id, phone, type,
   label, created_at)`; tela em Configurações → "Contatos que não são leads" para colar números
   (um por linha) ou importar CSV (coluna telefone, opcional nome), escolhendo o tipo
   (Revendedor/Representante ou Interno). Ao salvar, marca os leads existentes com esses números.
3. **Cliente:** ao registrar a primeira venda (`lead_sales`) o contato vira `cliente`.
4. **IA:** a análise de conversa (a mesma chamada do §8.4) pode sugerir `revendedor` ("revendo,
   tenho representação") — vira **sugestão** no Chat ("Parece revendedor. [Confirmar] [Não]"),
   não muda sozinho.

**Efeito de cada tipo:**

| Tipo | Funil | Números (dashboard, funil/ROI, projeção, atendimentos, termômetro, performance, roteiro) | Automações |
|---|---|---|---|
| lead | Vendas | entra | todas |
| cliente | Recompra | só nos números de recompra/clientes | as de recompra |
| revendedor | nenhum (some do quadro do funil; fica numa lista "Revendedores" em Leads) | não entra | só envio manual |
| interno | nenhum | não entra | nenhuma (agente de IA, follow-up, cadência, disparo, boas-vindas pulam) |

Implementação dos números: helper único `server/services/contacts/scope.js` com o trecho SQL
`COALESCE(l.contact_type,'lead') = 'lead'` (e variante clientes) aplicado nas consultas de
métricas listadas na tabela. Trocar o tipo à mão: seletor "Tipo" no Chat (painel) e na ficha.

## 3. Funil padrão de 6 etapas que anda sozinho

Coluna nova `funnel_stages.stage_role`: `novo` | `contato` | `atendimento` | `qualificado` |
`proposta` | `venda` | `perdido` (`NULL` = etapa extra sem regra). A regra é do papel; o nome é
livre (renomear não muda a regra). Funil de Vendas novo nasce com:

| Papel | Nome padrão | Entra quando (automático) |
|---|---|---|
| novo | Novo Lead | o lead chega |
| contato | Contato Feito | o vendedor (ou a cadência/agente) manda a 1ª mensagem humana ou registra ligação |
| atendimento | Atendimento | o lead responde depois de um contato |
| qualificado | Qualificado | as perguntas obrigatórias da etapa Atendimento foram respondidas (IA ou vendedor) **ou** o vendedor marca "É cliente ideal" |
| proposta | Orçamento/Proposta | proposta criada/marcada como enviada, ou a IA vê proposta/orçamento enviado (§8.4) |
| venda | Venda | venda registrada |
| perdido | Perdido | manual (com motivo) |

Regras gerais: só **avança** — se o lead já está na etapa do gatilho ou depois dela, nada muda
(ex.: lead em Qualificado que responde não volta para Atendimento); o gatilho leva direto à etapa
do papel, mesmo que pule etapas no meio (ex.: proposta enviada em Contato Feito vai para
Orçamento/Proposta); toda mudança automática
passa pela porta única `moveLeadToStage` com `trigger = 'auto_<papel>'`, entra no histórico, e o
Chat mostra "Movido para Contato Feito · [Desfazer]". Respeita a trava de perguntas obrigatórias
só para Atendimento → Qualificado (é a própria regra). Conta com etapas extras (ex.: "Visita
Agendada" com papel `NULL`) mantém a etapa; o automático pula por cima dela só se o lead estiver
antes dela.

**Contas existentes — "de-para":** tela única em Funis → [Usar o funil padrão]: para cada papel o
CRM sugere a etapa atual mais parecida (pelo nome e pelas marcas `is_conversion`,
`is_terminal`, `is_qualified`); o gestor confere/troca e confirma. Papéis sem etapa equivalente
são criados; etapas antigas sem papel ficam como extras. Nenhum lead muda de etapa no de-para.
Contas sem de-para continuam como hoje (sem automático) e veem um aviso no Funis.

**Venda → Recompra:** mantém a regra do LTV (venda "pode recomprar" vai para Recompra/Aguardando;
"compra única" cria a oferta) e garante `contact_type = 'cliente'`. Todo lead mostra o funil:
selo "Vendas" / "Recompra" ao lado da etapa no Chat (lista e painel), na ficha e no Pipeline.

## 4. Tela "Meu dia" (vendedor)

Rota `/meu-dia`, primeira tela do atendente ao entrar (gestor continua no Dashboard/Performance).
Lista única, em ordem de prioridade, só de contatos tipo lead/cliente do vendedor (gestor pode
trocar o vendedor no topo para ver o dia de alguém):

1. **Responderam e esperam você** — última mensagem é do cliente, sem resposta humana (mais antigo
   primeiro; vermelho > 1 h).
2. **Leads novos sem contato** — papel `novo`, sem mensagem humana (vermelho > 15 min).
3. **Quentes** — termômetro Quente/Pronto sem contato nas últimas 24 h.
4. **Passos de hoje** — passo da cadência vencendo hoje ou atrasado (ligar, mandar mensagem…).
5. **Propostas sem retorno** — papel `proposta` sem mensagem do cliente há 2+ dias.
6. **Recompra a contatar** — itens do LTV vencidos.

Cada item: nome, motivo em uma frase ("respondeu há 40 min: 'qual o valor?'"), botão grande
**Abrir conversa** (vai ao Chat já no lead) e, quando couber, ação direta (Ligar → registrar
ligação; Enviar passo). No topo, contador do dia do próprio vendedor (mensagens, ligações, novos
atendidos) — sem comparação com o time. Tudo feito: "Tudo em dia! Ex.: aproveite para retomar
leads de Atendimento parados." Atualiza por SSE.

## 5. Cadências em linguagem simples

A aba "Cadências (o vendedor faz)" vira **uma linha por etapa** do funil de Vendas:

> **Atendimento** · entra quando o cliente responde · **o vendedor faz:** 3 perguntas, 1 mensagem
> com catálogo, 1 ligação no dia 2 · **sai quando:** responde as perguntas → Qualificado ·
> [Ver e ajustar]

[Ver e ajustar] abre a lista de passos atual, sem os termos técnicos: "Pergunta" mostra só o
texto e as respostas; "Fase SPIN", "Perfil", "obrigatória", dia, dica da IA e "Se o cliente
perguntar…" ficam em **Ajustes avançados** (recolhido). Botões "Começar com modelo SPIN" e
"Montar com IA" saem; no lugar, **[Refazer com IA]** (pede confirmação; usa a regra de chaves
§7). O cartão "Negócio e clientes ideais" vira "Sobre o seu negócio" (objetivo + tipos de
cliente), recolhido depois de preenchido. Avulsas e Automáticas continuam como estão.

## 6. Painel do Chat enxuto

Aba Atendimento, padrão novo (o "Arrumar" continua para quem quiser mudar):
1. Linha do lead: **funil + etapa** (seletor), **tipo de contato**, **tipo de cliente** (perfil).
2. **Próximo passo** (cartão atual, sem jargão).
3. Termômetro em uma linha.
4. Recolhidos por padrão: tarefas, vendas, cadência avulsa, dados do contato, observações.
Botão **Ligação** (do §9) no topo do painel.

## 7. Regra das chaves de IA

| Uso | Chave |
|---|---|
| Montagem inicial da conta (§8.1) | **sempre a central Dros** (ignora `ai_key_source`) — uma vez por conta (`accounts.ai_onboarded_at`) |
| Tudo do dia a dia (extração, revisão semanal, análise, atividades da IA, [Refazer com IA]) | `pickAnthropicKey(account)` como hoje (`client` = só a do cliente; `auto`/`dros` = "IA global" ligada) |
| Conta `client` sem chave própria | nada de IA roda; faixa no topo para o gestor: "Conecte sua chave de IA para a IA continuar trabalhando. Ex.: Integrações > IA" |

O "padrão global" (§8.2) é calculado sem IA (só SQL), então não gasta chave nenhuma.

## 8. IA monta e aprende entre contas

### 8.1 Montagem na primeira entrada
Quando a conta salva "Sobre o seu negócio" pela primeira vez (ou o admin clica [Montar conta] em
Clientes), roda **em segundo plano** com a chave Dros: (a) classifica o **ramo**
(`accounts.business_segment`: imobiliária, clínica/saúde, estética, revenda/distribuição, loja
física, e-commerce, serviços, educação, eventos, automotivo, outro); (b) monta, para cada etapa
de papel `contato`, `atendimento`, `qualificado`, `proposta`: os **passos da cadência** (mensagens,
ligação, perguntas SPIN por perfil — reaproveita `buildAiDraft` estendido para devolver também
passos de mensagem/ligação com dia) usando o padrão global do ramo (§8.2) e as conversas reais
(se houver); (c) grava como cadências publicadas e avisa o gestor: "Montamos o atendimento da sua
conta. Confira em Cadências." Falhou: o gestor vê [Tentar de novo]; sem chave Dros configurada no
servidor: usa o roteiro padrão sem IA (modelo SPIN + 2 mensagens + 1 ligação por etapa).

### 8.2 Padrão global por ramo (só estrutura e números)
Job noturno (SQL, sem IA) `server/services/globalPatterns.js` calcula por **ramo × papel da
etapa**, juntando todas as contas do ramo com dados suficientes (≥ 20 envios por item):
- melhor **ordem** de tipos de passo (ex.: pergunta de situação → mensagem → ligação no dia 1);
- **fases SPIN** com maior taxa de resposta/avanço/venda e em que posição;
- **dia** da ligação com mais atendimento/avanço;
- 1ª resposta × venda.
Grava `global_patterns(segment, stage_role, pattern_json, accounts_count, computed_at)` com
**apenas números e estrutura** — nenhum texto de pergunta, mensagem, nome, preço ou marca de
cliente. A IA recebe isso no prompt da montagem ("No ramo imobiliária, o que funciona: …") e
escreve o texto do zero para o cliente. Conta com menos de 3 contas no ramo: usa o padrão
"geral" (todas as contas).

### 8.3 Revisão semanal (Entrega 2 do SPIN)
Continua como está (chave do cliente/IA global) e passa a receber também o padrão do ramo.

### 8.4 Atividades lidas pela IA
Como no §7 da spec de Performance (proposta, ligação, venda provável, agendamento, objeção), mais:
sugestão de tipo `revendedor` (§2) e sinal de **proposta enviada** que move para o papel
`proposta` (§3). Só com prova (trecho) e só na chamada de análise que já existe.

## 9. Performance do vendedor

A spec `2026-10-05-performance-vendedor-design.md` vale inteira, com ajustes:
- Tudo conta só contato tipo `lead` (e `cliente` nas vendas de recompra, marcado à parte).
- "Novos atendidos" e "em atendimento" usam os papéis (`novo` → `contato`; `atendimento`+).
- Botão **Ligação** registra a ligação e, se o lead estiver em `novo`, move para `contato`.
- A tela Performance é a primeira tela do **gestor** (aba Hoje).

## 10. Termos técnicos fora da tela

Trocar em todas as telas desta entrega: "SPIN"/"Fase SPIN" → "Tipo de pergunta" (Situação =
"Como faz hoje", Problema = "O que incomoda", Implicação = "O que isso custa", Necessidade =
"O que ganha resolvendo") e só em Ajustes avançados; "Perfil de cliente ideal" → "Tipo de
cliente"; "obrigatória" → "precisa de resposta para avançar"; "Cadência" na tela do vendedor →
"Próximos passos"; "Desvio" → "Se o cliente perguntar…".

## 11. Dados (resumo)

`leads.contact_type`, `leads.contact_type_origin`, `contact_lists`, `funnel_stages.stage_role`,
`accounts.business_segment`, `accounts.ai_onboarded_at`, `global_patterns`, mais as tabelas da
spec de Performance (`seller_activities`, `performance_sync_state`). Tudo `CREATE TABLE IF NOT
EXISTS` / `ADD COLUMN`; migrações idempotentes no boot. Funis existentes não ganham papel sozinhos
(só pelo de-para), exceto: etapa `is_conversion`+`is_terminal` → `venda`; `is_terminal` sem
conversão → `perdido`.

## 12. Erros e limites

- Movimento automático falhou (etapa apagada, trava): não move, registra no log, nada quebra.
- Lista de contatos: telefone inválido é ignorado e listado no resultado ("3 números inválidos").
- Montagem da conta roda uma vez; [Refazer com IA] substitui só passos criados pela IA que ninguém
  editou, e pede confirmação mostrando o que muda.
- Vendedor não vê Performance nem números do time; vê o próprio contador no Meu dia.

## 13. Testes

Tipo de contato (detecção interno/lista/cliente/manual não sobrescreve; exclusão em cada métrica
listada; interno sem automações); papéis e movimentos automáticos (cada gatilho; nunca volta; não
pula etapa à frente; desfazer; trava só Atendimento→Qualificado; etapa extra); de-para (sugestão,
criação de papéis faltantes, nenhum lead muda); Meu dia (cada grupo, ordem, só do vendedor,
gestor troca); cadência simples (resumo por etapa); regra de chaves (montagem usa Dros; dia a dia
segue `ai_key_source`; sem chave não roda + faixa); padrão global (só números/estrutura, mínimo
de contas, ramo × papel, nenhum texto de cliente no JSON); montagem (passos por etapa, sem IA cai
no padrão); tudo da spec de Performance. Suíte inteira + build + conferência no navegador
(Meu dia, Chat, Cadências, Funis de-para, Performance).

## 14. Fora do escopo

Chamadas de voz por webhook/telefonia; metas por vendedor; painel completo do vendedor (além do
contador do Meu dia); exportação CSV; app mobile.

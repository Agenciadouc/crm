# Roteiro de Qualificação evolutivo + Termômetro do lead — desenho

Data: 25/09/2026 · Ramo: `merge/github-2026-09-24` · Decisões tomadas com o dono em conversa (brainstorm de 24–25/09).

## 1. Objetivo

Fazer o CRM **conduzir a rotina comercial** de quem não sabe vender:
- dizer **o que perguntar** em cada etapa do funil, travar o avanço sem as respostas obrigatórias e **avançar sozinho** quando elas estão completas;
- **medir** cada pergunta (o cliente continua respondendo depois dela?) e **sugerir melhorias**, testadas em A/B;
- dar a cada lead um **termômetro** (nota 0–100 com dois eixos, Perfil × Engajamento) que ordena, filtra e avisa.

### Regra transversal: "explica com exemplo"
Toda tela nova deste projeto segue:
1. **Tela vazia ensina o próximo passo com exemplo** (ex.: "Esta etapa ainda não tem perguntas. Exemplo: *Qual o prazo do seu evento?* — [Adicionar pergunta] [Começar com modelo BANT]").
2. **Todo número tem o porquê** (tooltip/popover com a conta: "+30 Orçamento acima de R$20 mil · −10 sem resposta há 5 dias").
3. **Todo campo de cadastro tem placeholder de exemplo** (pergunta, opções com pontos, desvio, dica para a IA).
4. **Ícone "?"** ao lado de cada título de seção abre um texto curto em linguagem simples + 1 exemplo.
5. Linguagem de vendedor, sem jargão ("taxa de resposta", não "continuity rate"; "Perfil", não "fit").

Fora do escopo (próximo projeto): "Rotina do dia" do vendedor e revisão de usabilidade do CRM inteiro. Ações automáticas por nota (follow-up/mudar etapa pela nota) ficam para versão futura.

## 2. Conceitos

| Termo | Significado |
|---|---|
| Roteiro | Conjunto de perguntas por **etapa** de um **funil**, com versão publicada e rascunho |
| Pergunta obrigatória 🔴 | Trava o avanço da etapa enquanto não respondida |
| Pergunta recomendada 🟡 | Aparece no roteiro, não trava |
| Tipo "texto" / "opções" | Texto: guarda a resposta. Opções: cada opção tem **pontos** (podem ser negativos) que alimentam o Perfil |
| BANT | Orçamento, Quem decide, Necessidade, Prazo — as 4 perguntas-base do Perfil |
| Desvio | "Se o cliente perguntar X → responda Y → volte para a pergunta Z" |
| Pergunta enviada (ask) | Registro de que o vendedor fez a pergunta (botão, texto reconhecido ou IA) |
| Taxa de resposta | Das perguntas enviadas, quantas tiveram mensagem do cliente em até 24h (sem IA) |
| Pergunta fraca | Taxa de resposta < mínimo (padrão 70%) com ≥ 20 envios nos últimos 90 dias |
| Termômetro | Nota 0–100 = Perfil (0–50) + Engajamento (0–50) + ajuste IA (−15..+15) |

## 3. Roteiro — tela do gestor (Menu → Qualificação)

Substitui a tela atual `src/pages/Qualifications.tsx`. Visível para `gerente` e `super_admin`. Três abas.

### 3.1 Aba "Roteiro"
- Seletor de **funil** no topo. Etapas em colunas (ordem de `funnel_stages.position`); etapas finais (`is_terminal`) aparecem esmaecidas com o texto "Etapa final — não tem perguntas".
- Cada **cartão de pergunta**: texto (aceita `{nome}`), obrigatória/recomendada, tipo, opções com pontos (tipo opções), marca BANT (opcional), dica para a IA (opcional).
- **Desvios** ficam numa lista abaixo das colunas: gatilho (palavras separadas por vírgula, ex.: `preço, valor, quanto custa`), resposta sugerida, "volte para" (pergunta).
- Arrastar cartões muda ordem e etapa.
- **Rascunho × publicado:** toda edição mexe no rascunho; botão **Publicar** cria nova versão publicada; lista "Versões anteriores" com **Restaurar** (vira rascunho). Barra no topo: "Você tem mudanças não publicadas".
- **Começar**: tela vazia oferece **[Começar com modelo BANT]** (cria as 4 perguntas BANT de opções na 1ª etapa não final, com pontos-exemplo) e, se a conta tem IA, **[Montar com IA]** (§6.4).
- Rodapé de ajuda: "Perfil máximo deste roteiro: 60 pontos. Cada lead vai de 0 a 50 no Perfil conforme as opções respondidas."

### 3.2 Aba "Desempenho"
- Tabela por pergunta (versão publicada): envios, **taxa de resposta** (verde ≥ mínimo, vermelho "fraca", cinza "amostra pequena" se < 20), % que avançou em 7 dias, % que comprou em 30 dias.
- Abrir pergunta → mesma taxa **por vendedor** + até 3 exemplos reais do jeito que o melhor vendedor perguntou (textos enviados).
- Quadro **"Taxa de venda por faixa do termômetro"**: dos leads que estavam em cada faixa há 30 dias, quantos compraram depois. Se Pronto ≤ Morno, aviso: "O termômetro não está separando bem quem compra. Revise os pontos das opções."
- Configurações: mínimo (padrão 70%), prazo de resposta (padrão 24h), aviso de lead quente sem resposta (padrão 60 min).

### 3.3 Aba "Sugestões e testes"
- Cartões de sugestão com o número que justifica. Tipos: `rewrite` (reescrever pergunta fraca), `seller_phrasing` (jeito do melhor vendedor), `new_option` (agrupar textos livres), `new_deviation` (pergunta fora da ordem recorrente), `reorder`.
- Botões: **[Testar A/B]** (só para `rewrite`/`seller_phrasing`), **[Aplicar]** (mexe no rascunho; publicar continua manual), **[Recusar]**.
- Testes em andamento: A × B, envios e taxa de cada, dias restantes; ao terminar: **[Confirmar vencedora]** / **[Manter a atual]**.

## 4. Roteiro — telas do vendedor

### 4.1 Cartão "Roteiro" no painel do lead do Chat
Componente novo `RoteiroCard`, no topo da aba Info do painel direito do Chat (`src/pages/Chat.tsx`), abaixo do termômetro:
- Cabeçalho: etapa atual + progresso ("3 de 5 ✓").
- **▶ Pergunte agora**: próxima pergunta não respondida (obrigatórias primeiro, depois ordem). **[Perguntar]** coloca o texto (com `{nome}` resolvido e a versão A/B do lead) na caixa de mensagem; ao enviar, a mensagem leva `roteiro_question_key` e vira *ask* (`source='button'`).
- **Pendentes** (🔴/🟡, com "⏳ aguardando resposta" se já enviada) e **Respondidas** (resposta, origem 🤖 IA com trecho / 👤 nome + data, lápis para corrigir).
- Responder: clicar na pergunta abre campo (texto) ou botões (opções).
- **Desvio detectado**: aviso no cartão com a resposta sugerida e **[Usar]** (vai para a caixa de mensagem) + "volta para: …".
- **Reconhecimento**: ao enviar mensagem sem `roteiro_question_key`, a resposta do servidor pode trazer `recognized_question`; aparece acima da caixa: "Você perguntou 'Prazo do evento'? [✓ Sim] [Não]". Sim cria o *ask* (`source='recognized'`).
- Tela vazia: "Este funil ainda não tem roteiro. Peça ao gestor para montar em Qualificação." (gestor vê o botão direto).

### 4.2 Ficha do lead (`LeadDetail`)
A aba "Qualificação" passa a mostrar o `RoteiroCard` em modo completo: todas as etapas, com o respondido em cada uma.

### 4.3 Janela "Falta saber" (trava de etapa)
Ao mover o lead (Chat, Pipeline, ficha, em massa) para uma etapa **depois** da atual, se houver obrigatórias pendentes nas etapas entre a atual (inclusive) e a de destino (exclusive):
- Lista cada pendente com **[Escrever a resposta]** (salva e, se ficar tudo completo, move) e **[Perguntar agora]** (fecha a janela, põe a pergunta no Chat, lead fica na etapa).
- Se a IA tiver sugestão pendente para a pergunta: mostra trecho e **[Confirmar] [Corrigir]**.
- **Gestor/admin**: botão **[Avançar mesmo assim]** exige motivo (texto), gravado em `stage_history.notes` com `trigger_type='forced'`.
- Mover para etapa final (`is_terminal`: venda/perdido) **nunca é travado**.
- Em massa (`/bulk/stage`): leads travados não são movidos; o retorno diz quantos e quais, com link para cada um.

### 4.4 Avanço automático
Quando uma resposta é salva (vendedor ou IA) e **todas as obrigatórias da etapa atual** estão respondidas, e a etapa atual tem ≥ 1 obrigatória, e a próxima etapa (por `position`) não é final: o lead vai para a próxima etapa (`trigger_type='roteiro_auto'`). O Chat mostra "✅ Avançou para 'Proposta' — todas as perguntas de 'Qualificando' respondidas. [Desfazer]". Desfazer volta (`trigger_type='roteiro_undo'`) e marca o lead para **não avançar de novo automaticamente a partir dessa etapa** até uma resposta nova ser salva. Nunca volta sozinho; correção de resposta não retrocede.

## 5. Termômetro

### 5.1 Fórmula (função pura `computeLeadScore(input)`)
**Perfil (0–50)** — opções respondidas nas perguntas do tipo opções do roteiro publicado do funil do lead:
- `obtido = Σ pontos da opção escolhida`; `máximo = Σ max(0, maior pontuação de cada pergunta de opções)`.
- `perfil = máximo > 0 ? clamp(round(50 × obtido / máximo), 0, 50) : 0`.
- Letra: **A** ≥ 38 · **B** 25–37 · **C** 13–24 · **D** ≤ 12. Sem respostas: "D — perfil ainda desconhecido (0 de 4 respondidas)".

**Engajamento (0–50)** — sem IA, só mensagens e etapas:

| Sinal | Pontos |
|---|---|
| Recência: `20 × 0,5^(dias desde a última mensagem do cliente ÷ meia-vida)` | 0–20 |
| Rapidez: mediana do tempo de resposta do cliente nas últimas 5 respostas (resposta = inbound após outbound): < 10 min 10 · < 1h 7 · < 6h 4 · senão 1 · sem dado 0 | 0–10 |
| Reciprocidade: das últimas 5 mensagens enviadas ao cliente (sequências outbound), quantas tiveram resposta em 24h × 2 | 0–10 |
| Intensidade: avançou de etapa nos últimos 7 dias → 10; senão, cliente usou termo de compra nos últimos 7 dias (`preço, valor, quanto custa, orçamento, prazo, pagamento, pix, boleto, parcel, contrato, fechar, comprar`) → 5 | 0–10 |

`engajamento = min(50, soma)`. **Alto** = ≥ 25.

**Meia-vida** (esfriamento): `clamp(0,3 × ciclo_mediano_dias, 2, 30)`, onde `ciclo_mediano_dias` = mediana, nos últimos 180 dias, de dias entre `leads.created_at` e a primeira venda (`lead_sales.sale_date`, ou entrada em etapa `is_conversion` em `stage_history`). Com < 5 vendas no período: **7 dias**. Calculada por conta 1×/dia e guardada em `accounts.score_half_life_days`.

**Ajuste da IA (−15..+15)** — só se existir `conversation_insights` do lead com `analyzed_at` nos últimos 7 dias: `temperatura_lead` quente +10 / frio −10; `chance_conversao` ≥ 70 +5 / ≤ 20 −5.

**Nota** = `clamp(perfil + engajamento + ajusteIA, 0, 100)`. Faixas: 🧊 **Frio** 0–30 · 🌤 **Morno** 31–60 · 🔥 **Quente** 61–85 · 🚀 **Pronto p/ fechar** 86–100.

**Matriz (ação)**: Perfil A/B + engajamento alto → **Atender agora**; A/B + baixo → **Reaquecer**; C/D + alto → **Qualificar melhor**; C/D + baixo → **Baixa prioridade**.

**Porquê** (`reasons`): lista ordenada `{grupo:'perfil'|'engajamento'|'ia', texto, pontos}`, ex.: `+30 Orçamento: acima de R$20 mil`, `+14 Última mensagem há 1 dia`, `−10 IA: conversa fria`.

Leads em etapa final (`is_terminal`) mantêm a última nota e não geram avisos nem entram no recálculo noturno.

### 5.2 Quando recalcula
Recalcula um lead (com coalescência: no máximo 1 cálculo por lead a cada 5 s via `setImmediate` + mapa de pendentes) após: mensagem recebida (`handleInboundMessage`), mensagem enviada pelo Chat (`POST /api/messages/:leadId` e mídia), resposta do roteiro salva/corrigida, mudança de etapa (função central, §7.2), insight da IA gravado (`analyzeConversation`). Recálculo noturno de todos os leads ativos não arquivados, em lotes de 200, após a análise noturna; grava snapshot diário (`lead_score_daily`).

### 5.3 Onde aparece
- `ScoreBadge` (ex.: `🔥 72 ↑`): lista do Chat, cartões do Pipeline (desktop e mobile), coluna "Termômetro" em Leads (ordenável).
- `ScoreThermometer` (completo): topo do painel do lead no Chat e na ficha — nota, faixa, barras Perfil (letra) e Engajamento, ação da matriz, lista do porquê, "calculado há X min".
- Seta ↑/↓ compara com `score_prev` (nota do cálculo anterior).

### 5.4 Filtros e ordem
- Dentro de **"Mais filtros..."** (componente `CityFilter`, que vira `MoreFilters` com as seções Local e Termômetro): faixas (múltipla escolha), nota mínima, Perfil A/B, Engajamento alto. Parâmetros de API: `score_bands=quente,pronto`, `score_min=70`, `fit=AB`, `engagement=high`.
- Valem em: Leads (lista e CSV), Pipeline, Chat. Server-side em `GET /api/leads` e `GET /api/leads/export`.
- Chat: seletor **Ordenar: Mais recentes | Termômetro** (`sort=score` → `ORDER BY score DESC, COALESCE(last_inbound_at, updated_at) DESC`). Leads: clique na coluna.

### 5.5 Avisos
- **Vendedor**: quando o recálculo muda a faixa para **Quente** ou **Pronto** (subindo), e `score_alerted_at` não é de hoje, envia SSE `lead:score_up` `{lead_id, name, score, band, attendant_id}`; o front (componente `ScoreToasts` no layout) mostra toast só para o atendente do lead (ou gestor/admin se sem atendente) com [Abrir conversa]. Grava `score_alerted_at`.
- **Gestor**: job a cada minuto (no `tick` do scheduler) procura leads Quente/Pronto cuja última mensagem é do cliente há ≥ `score_alert_minutes` (padrão 60) **contando só horário de atendimento** da instância do lead (`serviceHours`) e sem mensagem enviada depois; cria `analyst_alerts` `type='lead_quente_sem_resposta'`, severity `alta`, um aberto por lead (não duplica). Resolve sozinho quando sai mensagem para o lead.

## 6. Aprendizado

### 6.1 Registro (sem IA)
- *Ask* criado no envio (botão/reconhecido/IA sugerida e enviada). Guarda variante A/B vigente para o lead.
- Mensagem do cliente: todo *ask* aberto do lead com `asked_at` dentro do prazo recebe `replied_at`.
- Resposta salva para a pergunta: `answered_at` no *ask* mais recente dela.
- Mudança de etapa: *asks* do lead dos últimos 7 dias sem `advanced_at` recebem.
- Venda (`POST /leads/:id/sales` ou entrada em `is_conversion`): *asks* dos últimos 30 dias sem `bought_at` recebem.

### 6.2 Reconhecimento de pergunta digitada (sem IA)
Normaliza (minúsculas, sem acento, sem pontuação, remove palavras vazias pt-BR e palavras < 3 letras). Similaridade = |interseção| / |palavras da pergunta|. Se ≥ 0,6 com alguma pergunta pendente da etapa atual (pega a maior), devolve `recognized_question {question_key, text}`.

### 6.3 Análise noturna (após o recálculo de notas)
Por conta e por `question_key`, últimos 90 dias: envios, taxa de resposta, % avançou, % comprou, por vendedor. Marca fraca. Gera sugestões (sem duplicar uma sugestão aberta do mesmo tipo/pergunta):
- **Sem IA**: `seller_phrasing` para pergunta fraca quando há vendedor com ≥ 10 envios e taxa ≥ mínimo — payload com o texto mais usado por ele.
- **Com IA** (limite: mesmo orçamento de `canAnalyze`, `source='roteiro_learning'`, até 5 chamadas por conta/noite): `rewrite` (2 versões para cada fraca), `new_option` (agrupa ≥ 5 respostas de texto parecidas de uma pergunta de texto ou opção "Outro"), `new_deviation` (perguntas fora da ordem registradas ≥ 3 vezes em `roteiro_offscript`), `reorder` (quando uma pergunta posterior tem taxa ≥ 15 pts maior quando feita antes).
- Avalia testes A/B (§6.5).

### 6.4 IA no dia a dia (só conta com IA)
- **Extração de respostas**: após mensagem do cliente, com coalescência de 2 min por lead, se há perguntas pendentes na etapa atual: chama `callHaiku` com as perguntas pendentes (texto, opções) + últimas 20 mensagens; ferramenta `record_answers` devolve `{question_key, option_key|text, evidence}` e opcional `off_script {question, suggested_reply}`. Grava respostas com `origin='ia'` (nunca sobrescreve `origin='manual'`), dispara avanço automático. Off-script: se casar um desvio cadastrado, mostra o desvio; senão, mostra a sugestão da IA e grava em `roteiro_offscript`. Loga tokens `source='roteiro_extraction'`; respeita `canAnalyze`.
- **Montar com IA**: usa `agent_briefings.compiled_json` (resumo.o_que_descubro, qualification_criteria, required_fields), resumos (`conversation_insights.summary`) de até 20 leads que compraram e as etapas do funil; devolve perguntas por etapa (sempre incluindo BANT de opções com pontos), desvios comuns. Vira **rascunho**; nada é publicado sozinho.
- **Desvio sem IA**: mensagem do cliente com alguma palavra-gatilho de desvio cadastrado → aviso no cartão.

### 6.5 Teste A/B
- Uma variante B por pergunta de cada vez. Sorteio fixo por lead: `hash(lead_id + question_key) % 2`.
- Termina com ≥ 30 envios em cada variante ou 30 dias. Vencedora = maior taxa de resposta com diferença ≥ 5 pts; senão empate (mantém A).
- Resultado vira `analyst_alerts type='roteiro_ab_resultado'` + cartão na aba Sugestões; **[Confirmar vencedora]** troca o texto no rascunho e publica nova versão.
- Apagar a pergunta em teste cancela o teste.

## 7. Dados e servidor

### 7.1 Tabelas novas (schema em `server/services/roteiro/schema.js`, `applyRoteiroSchema(db)`, chamado em `server/db.js`)
- `roteiro_versions(id, account_id, funnel_id, version, status 'draft'|'published'|'archived', published_at, published_by, created_at)` — no máximo 1 draft e 1 published por funil.
- `roteiro_questions(id, version_id, account_id, question_key, stage_id, position, text, kind 'text'|'options', required, bant, ai_hint)` — `question_key` estável entre versões.
- `roteiro_options(id, question_id, option_key, label, points, position)` — `option_key` estável.
- `roteiro_deviations(id, version_id, account_id, triggers, reply_text, return_question_key, position)`.
- `roteiro_variants(id, account_id, question_key, text, status 'testing'|'won'|'lost'|'cancelled', started_at, ended_at, suggestion_id)`.
- `roteiro_asks(id, account_id, lead_id, question_key, variant, text_sent, message_id, user_id, source 'button'|'recognized'|'ia', asked_at, replied_at, answered_at, advanced_at, bought_at)`.
- `lead_answers(id, account_id, lead_id, question_key, option_key, answer_text, origin 'ia'|'manual', evidence, answered_by, answered_at, updated_at, UNIQUE(lead_id, question_key))`.
- `roteiro_suggestions(id, account_id, funnel_id, question_key, type, payload_json, evidence_json, status 'new'|'testing'|'applied'|'rejected', created_at, decided_by, decided_at)`.
- `roteiro_offscript(id, account_id, lead_id, text, detected_at)`.
- `lead_score_daily(lead_id, account_id, day, score, band, PRIMARY KEY(lead_id, day))` — guarda 120 dias.
- Colunas novas em `leads`: `score, score_band, score_fit, score_fit_grade, score_engagement, score_quadrant, score_reasons_json, score_prev, score_at, score_alerted_at, roteiro_no_auto_from_stage`. Índice `(account_id, score)`.
- Colunas novas em `accounts`: `roteiro_min_reply_rate` (70), `roteiro_reply_window_h` (24), `score_alert_minutes` (60), `score_half_life_days` (7).

### 7.2 Função central de mudança de etapa
`server/services/stageMove.js`: `moveLeadToStage(db, {lead, toStageId, trigger, userId, notes, force})` faz UPDATE `leads.stage_id/updated_at` + INSERT `stage_history` + CAPI (`triggerCapiForStageChange`) + hooks (asks `advanced_at`/`bought_at`, recálculo de nota, SSE `lead:updated`). `checkRoteiroGate(db, lead, toStageId)` → `{ok, pending:[...]}`. Adotam a função e a trava: `PUT /api/leads/:id/stage`, `POST /api/leads/bulk/stage`, avanço automático, `autoDetectStage` (palavra-chave), `follow-up on_reply_move`, e as duas saídas do agente de IA (a trava do roteiro soma-se à trava que o agente já tem). Criação de lead e webhooks de formulário só gravam etapa inicial (sem trava). Trava ignorada quando destino é `is_terminal` ou quando `force` com motivo (só gerente/admin).

### 7.3 Rotas
Router fábrica `server/routes/roteiroRouter.js` `createRoteiroRouter(db, deps)`, montado em `/api/roteiro` (casca `server/routes/roteiro.js`). Toda consulta filtra `account_id = req.accountId`.
- Gestor: `GET /funnels/:funnelId` (draft + published + versões), `PUT /funnels/:funnelId/draft` (salva rascunho inteiro), `POST /funnels/:funnelId/publish`, `POST /versions/:id/restore`, `POST /funnels/:funnelId/bant-template`, `POST /funnels/:funnelId/ai-draft`, `GET /performance?funnel_id`, `GET|PUT /settings`, `GET /suggestions`, `POST /suggestions/:id/(test|apply|reject)`, `POST /variants/:id/(confirm|keep)`.
- Vendedor: `GET /leads/:leadId` (roteiro do lead: etapa atual, perguntas com estado, respostas, desvio ativo, variante), `PUT /leads/:leadId/answers/:questionKey`, `POST /leads/:leadId/asks` (confirmar reconhecida), `POST /leads/:leadId/undo-advance`, `GET /leads/:leadId/gate?to_stage_id`.
- Termômetro: `GET /api/leads/:id/score` (nota + porquê); filtros e `sort=score` em `GET /api/leads` e export.
- `POST /api/messages/:leadId` aceita `roteiro_question_key` e devolve `recognized_question`.
- `PUT /api/leads/:id/stage` devolve `409 {code:'roteiro_gate', pending}` quando travado; aceita `force_reason`.

### 7.4 Migração da qualificação antiga
Por conta com `qualification_sequences` ativas: cria versão publicada do funil padrão com essas perguntas (tipo texto, recomendadas, na 1ª etapa não final); `lead_qualifications` com resposta → `lead_answers` (`origin='manual'`). Idempotente (marca em `app_settings`). Tabelas antigas ficam. Rotas antigas `/api/qualifications/lead/*` passam a responder a partir de `lead_answers` só para compatibilidade; a tela antiga sai.

### 7.5 Serviços (cada um testável isolado, recebe `db`)
`server/services/roteiro/`: `schema.js`, `repo.js` (versões, perguntas, publicar), `leadRoteiro.js` (estado do roteiro do lead, próxima pergunta, gate, respostas, avanço automático), `recognize.js` (§6.2), `asks.js` (§6.1), `metrics.js` (taxas), `learning.js` (sugestões noturnas), `abTest.js`, `aiExtract.js`, `aiDraft.js`, `bantTemplate.js`, `migrateLegacy.js`.
`server/services/leadScore/`: `compute.js` (pura), `inputs.js` (coleta do banco), `recalc.js` (coalescência, grava, avisos), `nightly.js`, `halfLife.js`, `hotLeadAlerts.js`.

## 8. Erros
- IA indisponível/sem orçamento: roteiro e nota seguem sem IA; ajuste IA = 0; "Montar com IA" mostra "A IA não respondeu agora. Monte à mão ou tente de novo."
- Resposta da IA nunca sobrescreve manual; sempre traz trecho.
- Pergunta apagada: resposta fica no histórico do lead (aparece em "Respondidas — perguntas antigas").
- Recálculo noturno em lotes; erro num lead não para os outros (loga e segue).
- Rotas recusam acesso a lead/funil de outra conta (404).
- Rascunho salvo inteiro com validação: pergunta sem texto, opções vazias em tipo opções, pontos fora de −50..50, etapa de outro funil → 400 com mensagem em português.

## 9. Testes (`node --test`)
- `leadScore/compute`: cada sinal, perfil com pontos negativos, sem perguntas, meia-vida, ajuste IA vencido, faixas, matriz, porquê.
- `halfLife`: < 5 vendas = 7; mediana; limites 2–30.
- `leadRoteiro`: próxima pergunta, gate entre várias etapas, destino final livre, avanço automático, desfazer + trava de não-avançar, IA não sobrescreve manual.
- `stageMove`: histórico, trigger, force só com motivo.
- `recognize`, `asks` (replied/advanced/bought), `metrics` (fraca com amostra mínima), `abTest` (sorteio fixo, vencedora ≥ 5 pts, empate), `learning` sem IA (seller_phrasing), `migrateLegacy` idempotente.
- Rotas via fábrica + `http` (padrão de `test/agentBriefingHttp.test.js`), incluindo isolamento entre contas.
- Conferência no navegador de todas as telas antes de declarar pronto.

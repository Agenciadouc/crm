# Copiloto no Agente de IA — Desenho

Data: 15/09/2026 · Base: produção (`origin/main` de 13/09/2026) · Primeiro teste: conta **Dros (id 2)**

## 1. Objetivo

Transformar o Agente de IA que já existe num **gestor de vendas**: ele entende o momento do lead, conduz a qualificação, contorna objeções, move o lead de etapa quando a qualificação está completa, sugere follow-up por etapa e aprende com as conversas. Tudo isso **sem tela nova**: o usuário continua usando **Agentes de IA**, **Mensagens Prontas** e o **Chat**, e **gastando o mínimo de IA possível**.

## 2. Princípios (decididos pelo CEO)

1. **Aproveitar o que existe.** Nada de módulo novo. O cérebro continua sendo o `aiAgent.js`, e a base de respostas é a tabela de Mensagens Prontas.
2. **O mínimo de botões e campos.** Uma opção liga/desliga do envio automático, um botão de entrevista e um bloco de follow-up por etapa.
3. **Didático.** A sugestão aparece onde o vendedor já escreve: a caixa de mensagem do Chat.
4. **Base primeiro, IA depois.** Se a resposta já está na base, não chama a IA. Se não está, usa a IA e anota a resposta na base. A base guarda sempre a versão que dá mais resultado.
5. **Nunca passar orçamento sem qualificar**, com envio automático ligado ou desligado.
6. **Mudar de etapa só com a qualificação completa.**
7. **Sem cobrança por disparo.** O cliente usa a chave própria ou a chave da Dros; o custo só é acompanhado internamente.

## 3. As peças

### 3.1 Opção "Envio automático da IA" (liga/desliga, tela Agentes de IA)

| Envio automático | Resposta ao lead | Follow-up por inatividade |
|---|---|---|
| **Ligado** | A resposta (da base ou da IA) é enviada sozinha | Envia sozinho (comportamento atual) |
| **Desligado (Copiloto)** | A resposta aparece **pronta na caixa de mensagem do Chat**; o vendedor envia | A mensagem personalizada aparece para o vendedor **aprovar e enviar** |

Onde muda no código: `processInboundMessage` (`server/services/aiAgent.js`). Antes de chamar a IA, consulta a base (3.9). O passo 13 (envio, `sendViaInstance`) se divide:
- `auto`: envia como hoje.
- `copilot`: grava a sugestão em `ai_suggestions` e avisa o Chat por SSE (`broadcastSSE(accountId, 'lead:ai_suggestion', { lead_id })`).

Ferramentas no Copiloto:
- `update_lead_info`: executa normalmente (só grava dados).
- **Mover etapa: executa sozinha, desde que passe pela trava de qualificação (3.4).** Vale nos dois modos.
- Adicionar tag: executa normalmente.
- `transfer_to_human`: não se aplica, porque o humano já está atendendo. É ignorada.
- As regras de "máximo de mensagens do robô" e "recusar áudio" não se aplicam: quem conversa é o vendedor.

**Agrupamento:** no Copiloto, a análise espera **40 segundos sem nova mensagem do lead** (um timer em memória por lead; a produção roda 1 processo pm2) e analisa o bloco inteiro de uma vez.

### 3.2 Sugestão na caixa de mensagem (Chat)

- Ao receber `lead:ai_suggestion`, se a conversa estiver aberta e a caixa **vazia**, o texto entra na caixa com uma etiqueta discreta: **"da base"** ou **"sugestão da IA"**. Se o vendedor já estiver digitando, a sugestão **não sobrescreve**: aparece uma linha fina acima da caixa, "Há uma sugestão — ver".
- **Enter** envia normalmente. **Apagar** descarta.
- Ao abrir uma conversa com sugestão pendente, ela é carregada do banco.
- No cabeçalho da conversa, um selo pequeno: **Chance de fechar 60% · trava: preço**.
- Quando a IA mover o lead de etapa, aparece no histórico do lead "Movido pela IA — qualificação completa".

### 3.3 Entrevista de mapeamento comercial (botão "Montar com entrevista")

Um chat dentro da tela do agente, em que a IA (Claude Opus 5) entrevista o dono ou gestor, **uma pergunta por vez**, cobrindo:

1. **Empresa e oferta:** o que vende, faixas de preço, diferenciais, região de atendimento.
2. **Lead ideal:** quem compra e quem não vale a pena (porte, região, volume, perfil).
3. **Momento ideal:** que sinais mostram que o lead está pronto para receber orçamento ou proposta.
4. **Qualificação:** as perguntas obrigatórias e em que ordem fazer; quais respostas são **critérios obrigatórios** para mudar de etapa.
5. **Preço e política:** quando pode falar preço, descontos, prazos e o que nunca prometer.
6. **Objeções:** as mais comuns, **principalmente pedir preço antes da hora**, e o contorno certo de cada uma.
7. **Perguntas frequentes:** o que os leads mais perguntam (frete, prazo, forma de pagamento, endereço, horário, garantia…) e a resposta de cada uma.
8. **Etapas do funil:** o que acontece em cada etapa, quanto tempo de inatividade é aceitável e quantas ações de follow-up fazer em cada uma.
9. **Concorrência:** com quem o lead compara e como se diferenciar.

**Resultado:** a IA preenche **os campos que já existem** no agente, e o gestor revisa antes de salvar:
- `persona` → tom de voz;
- `knowledge_base` → empresa, oferta, momento ideal, concorrência (em seções com título);
- `never_mention` → o que nunca prometer ou falar;
- `qualification_criteria` → definição de lead ideal + momento ideal + lista dos critérios obrigatórios;
- `required_fields` → dados obrigatórios.

Os blocos 6 (objeções) e 7 (perguntas frequentes) viram **entradas da base de respostas** (3.9), já como oficiais. A entrevista também **propõe o follow-up por etapa** (3.5). A transcrição fica guardada (`ai_agents.interview_json`, sem aparecer na tela) para refazer ou continuar depois.

### 3.4 Regras de venda e trava de qualificação (nos dois modos)

Acrescentadas ao prompt do agente:
- **Nunca passar orçamento, preço ou proposta antes de o lead cumprir todos os critérios de qualificação E o momento ideal.**
- Se o lead **insistir no preço**, usar o **contorno de objeção** da base e seguir com a **próxima pergunta de qualificação**. Nunca recusar seco.
- A cada chamada da IA, ela devolve (numa ferramenta obrigatória, com formato fixo):
  - `momento`: etapa real da conversa;
  - `chance_fechar`: 0 a 100;
  - `trava_principal`: a objeção ou bloqueio atual (ou vazio);
  - `criterios`: cada critério obrigatório com status `atendido` / `pendente` e a evidência (trecho da conversa).

**Trava de mudança de etapa (no código, não só no prompt):** a ferramenta de mover etapa só executa se:
1. **todos** os `required_fields` estiverem preenchidos no lead; e
2. **todos** os critérios da última análise estiverem `atendido`.

Se faltar algo, a mudança é recusada, nada muda no funil, e a IA recebe de volta a lista do que falta para seguir perguntando. A mudança aprovada grava `stage_history` com `trigger_type = 'ai_qualified'`. A regra que já existe (Novo Lead → Em Atendimento quando o lead responde) continua como está.

### 3.5 Follow-up por etapa, criado pela IA (bloco na tela do agente)

Uma lista com as etapas do funil. Para cada etapa:

| Etapa | Tempo de inatividade | Nº de ações | |
|---|---|---|---|
| Em Atendimento | [12 horas ▾] | [3 ▾] | **Criar com IA** |
| Proposta | [1 dia ▾] | [4 ▾] | **Criar com IA** |

- **Criar com IA** gera os passos (mensagens e intervalos) usando o perfil da empresa e a etapa, respeitando a regra de não passar preço sem qualificação. O gestor revisa os textos e salva.
- **Por baixo, reaproveita o que existe:** grava em `follow_ups` (tipo inatividade, `inactivity_stage_id`, `inactivity_minutes`, `agent_id`) + `follow_up_steps`, processados por `inactivityScanner.js` + `followUpSender.js`.
- **Personalização barata:** o passo do follow-up tem campos variáveis (nome, produto de interesse, última dúvida) preenchidos com o que a IA já anotou no lead (3.4). A IA só é chamada para reescrever o passo quando o lead tem algo fora do comum (ex.: uma objeção específica registrada).
- **Envio automático ligado:** envia como hoje. **Desligado (Copiloto):** grava em `ai_suggestions` (tipo `follow_up`) e **pausa até o vendedor aprovar** no Chat.
- Se o lead responder, o follow-up para (regra `stop_on_reply` que já existe).
- Cada passo de follow-up também entra na medição de resultado da base (3.9): o passo que mais faz o lead voltar a responder é o que fica.

### 3.6 Aprendizado e sugestões de melhoria (semanal)

Uma rotina semanal (no `scheduler.js` que já existe) calcula:
- **as objeções que mais travaram o fechamento**;
- **em que etapa e depois de quanto tempo parado** os leads se perdem;
- **qual passo de follow-up mais recupera** leads;
- **quais critérios de qualificação mais ficam pendentes**;
- **quais respostas da base dão mais resultado** e quais estão fracas.

Com isso gera **sugestões de melhoria** (ex.: "acrescentar contorno para a objeção 'já tenho fornecedor'", "na etapa Proposta, reduzir a inatividade de 2 dias para 1 dia", "juntar 4 respostas parecidas sobre frete em uma"). Elas aparecem na tela do agente como **"Sugestões de melhoria (3)"**, com **Aprovar** / **Recusar**. Essa rotina usa a IA **uma vez por semana por conta**, em lote.

### 3.7 Medição

Tudo sai de `ai_suggestions`, `ready_messages` e `stage_history`: % de respostas vindas da base × da IA, % usada sem editar, % editada, % descartada, tempo até o vendedor agir, leads recuperados por follow-up e em que passo, leads movidos pela IA. Mostrado num resumo curto dentro da tela do agente.

### 3.8 Acesso à IA e custo

- `accounts.ai_key_source`: `client` (usa a chave do cliente, `accounts.anthropic_api_key`, como hoje) ou `dros` (usa a chave central `ANTHROPIC_API_KEY_DROS` do `/root/.env`). Só o admin da Dros escolhe. `resolveAnthropicKey` (`anthropicClient.js`) passa a respeitar essa escolha.
- **Sem cobrança por disparo.** O limite de gasto continua o que já existe: `monthly_token_limit` do agente.
- **Custo do mês** (visível só para o admin da Dros, na tela do agente): custo real da IA (do `ai_agent_token_log`), quantas respostas saíram da base sem gastar IA e a economia estimada.

### 3.9 Base de respostas (Mensagens Prontas que aprendem)

A tela **Mensagens Prontas** que já existe vira a base. Cada mensagem ganha, **por baixo**, os dados para ser encontrada e medida. Na tela aparecem só três coisas novas por mensagem: **as perguntas que ela responde**, **de onde veio** (entrevista, IA, vendedor) e **o resultado** (ex.: "usada 42× · 71% responderam").

**Como a resposta é escolhida (a cada bloco de mensagens do lead):**

1. **Procura na base, sem IA.** O texto do lead é normalizado (minúsculas, sem acento, sem palavras vazias) e comparado com as perguntas de exemplo de cada mensagem da base (sobreposição de palavras + sinônimos anotados na entrevista). Tem que dar uma **correspondência forte** (nota ≥ 0,6), numa mensagem curta, com um assunto só.
2. **Encontrou:** usa a resposta da base. **Não chama a IA.** Se a mensagem da base estiver marcada como "exige qualificação" (ex.: preço) e o lead ainda não estiver qualificado, usa no lugar o **contorno de objeção** correspondente.
3. **Não encontrou, ou a mensagem é longa/tem vários assuntos:** chama a IA (fluxo normal, com a análise de 3.4). As mensagens da base mais parecidas vão no prompt como referência, para a IA seguir o mesmo padrão.
4. **Pelo menos 1 análise da IA a cada 5 mensagens do lead**, mesmo que a base tenha respondido tudo, para manter chance de fechar e critérios atualizados.

**Como a base aprende:**

- **Anota:** quando uma resposta da IA é enviada (pelo vendedor no Copiloto ou sozinha no automático) para uma pergunta que não estava na base, ela entra na base como **candidata**, com a pergunta do lead como exemplo. No Copiloto, o que se guarda é **o texto que o vendedor realmente enviou** (já corrigido por ele).
- **Oficializa:** a candidata vira **oficial** quando for enviada **3 vezes sem edição** ou quando o gestor aprovar. **Com envio automático ligado, só respostas oficiais saem da base**; candidatas só aparecem como sugestão no Copiloto.
- **Mede:** cada uso guarda o resultado depois de 24h: o lead **respondeu**? **avançou de etapa**? o vendedor **editou**?
- **Fica com a melhor:** quando uma mesma pergunta tem mais de uma resposta (variações), elas se revezam; depois de **20 usos** cada, a de melhor resultado (lead respondeu + avançou) vira a principal, e as piores são desativadas (fica ao menos uma). A rotina semanal (3.6) sugere juntar respostas repetidas.
- **Nunca apaga sozinha:** respostas criadas na entrevista ou pelo gestor só são desativadas com aprovação.

**Economia esperada:** perguntas repetidas (preço, frete, prazo, endereço, horário, forma de pagamento) respondidas pela base, sem custo de IA. A estimativa é de **30% a 50% menos chamadas** depois de algumas semanas, medida pelo "Custo do mês" (3.8). Além disso, o prompt do agente já usa cache (`cache_control` em `anthropicClient.js`), o que barateia cada chamada.

### 3.10 SDR de qualificação (terceira opção do mesmo seletor)

O seletor "Como a IA atua" (3.1) passa a ter **três opções**, e continua sendo um campo só:

| Opção | O que acontece |
|---|---|
| **Automático** | A IA atende e responde sozinha o tempo todo (comportamento atual). |
| **Copiloto** | A IA só sugere; o vendedor envia. |
| **SDR** | A IA atende o lead **sozinha até ele estar qualificado**. Quando a trava de qualificação (3.4) libera, ela move o lead para a etapa de qualificado, **passa para o vendedor** e, a partir daí, **continua no mesmo lead como Copiloto**. |

Como o SDR trabalha:
- Faz as perguntas de qualificação na ordem definida na entrevista, **uma por mensagem**, respondendo dúvidas pela base (3.9) e **contornando objeções** (principalmente preço antes da hora).
- **Passa para o vendedor só pela trava do código** (todos os `required_fields` + todos os critérios `atendido`), e não mais pelo julgamento livre da IA (`transfer_to_human(reason="qualified")` passa pela mesma trava).
- A passagem reaproveita o que já existe: `ai_agent_handoff_rules` (motivo `qualified`: vendedor de destino, roleta, etapa, tag) e `executeHandoff` / `notifyAndOpenLead`. O vendedor recebe o aviso com um **resumo da qualificação** (os critérios e as evidências).
- Os outros motivos de passagem que já existem continuam valendo (palavra-chave "humano", limite de mensagens, áudio sem transcrição, fora do escopo); nesses casos o lead também segue para o vendedor com o Copiloto ligado.
- Depois da passagem, a IA **nunca mais envia sozinha naquele lead**, só sugere.

Dados: `ai_agents.mode` aceita `auto` / `copilot` / `sdr`; `leads.ai_handed_off_at` (já existe) marca a passagem, e a partir dela `processInboundMessage` trata o lead como `copilot`.

## 4. Dados (mudanças mínimas)

| Onde | Mudança |
|---|---|
| `ai_agents` | `mode TEXT NOT NULL DEFAULT 'auto'` (`auto` = envio automático ligado, `copilot` = desligado); `interview_json TEXT` |
| `accounts` | `ai_key_source TEXT NOT NULL DEFAULT 'client'` |
| `leads` | `ai_close_chance INTEGER`; `ai_main_blocker TEXT`; `ai_criteria_json TEXT`; `ai_moment TEXT`; `ai_msgs_since_analysis INTEGER DEFAULT 0` |
| `ready_messages` | `questions_json TEXT` (perguntas de exemplo + sinônimos); `kind TEXT DEFAULT 'manual'` (`manual`/`faq`/`objection`); `requires_qualification INTEGER DEFAULT 0`; `origin TEXT DEFAULT 'manual'` (`manual`/`interview`/`ai`/`seller`); `status TEXT DEFAULT 'official'` (`official`/`candidate`); `group_key TEXT` (variações da mesma pergunta); `uses INTEGER DEFAULT 0`; `sent_unedited INTEGER DEFAULT 0`; `replies INTEGER DEFAULT 0`; `advances INTEGER DEFAULT 0`; `agent_id INTEGER` |
| **nova** `ai_suggestions` | `id, account_id, lead_id, agent_id, kind ('reply'\|'follow_up'\|'improvement'), source ('base'\|'ai'), ready_message_id, content, payload_json, status ('pending'\|'sent'\|'edited'\|'discarded'\|'expired'\|'approved'\|'rejected'), final_content, lead_follow_up_id, outcome_replied INTEGER, outcome_advanced INTEGER, outcome_checked_at, created_at, resolved_at, resolved_by` |

Tudo com `addColumnIfNotExists` / `CREATE TABLE IF NOT EXISTS` em `server/db.js`, seguindo o padrão atual. **Default = `auto`, `client` e mensagens atuais como `official`/`manual`**: nenhum cliente muda de comportamento no deploy, e as Mensagens Prontas continuam funcionando igual no Chat.

## 5. Fluxos

**Mensagem do lead (Copiloto):** webhook grava a mensagem → timer de 40s por lead → **procura na base** → (achou) monta a resposta da base, respeitando "exige qualificação" → (não achou, ou já são 5 mensagens sem análise) `processInboundMessage` com IA → grava a análise no lead → se pediu para mudar de etapa, passa pela trava (3.4) → grava `ai_suggestions` → SSE → caixa do Chat → o vendedor envia (`sent`/`edited`) ou descarta → se veio da IA e foi enviada, anota na base como candidata → após 24h, grava o resultado (respondeu/avançou) na sugestão e nos contadores da mensagem.

**Lead parado (Copiloto):** `inactivityScanner` acha o lead na etapa com o tempo vencido → `followUpSender` preenche as variáveis do passo (e só chama a IA se houver algo fora do comum) → `ai_suggestions` (`follow_up`, pendente) → o vendedor aprova no Chat → envia → o follow-up avança para o próximo passo.

## 6. Erros e limites

- **Sem chave ou limite de tokens estourado:** a base continua respondendo (não gasta IA). No Copiloto, sem IA, só aparecem sugestões da base; com envio automático ligado, se a base não tiver a resposta, o lead segue para o atendente (handoff silencioso que já existe). Aviso na tela do agente.
- **Falha da IA ou do Deepgram:** sem sugestão; registrado no log.
- **Base respondeu errado:** no Copiloto, o vendedor descarta ou edita, e isso conta contra a mensagem (derruba o resultado e ela perde espaço para variações melhores). Com envio automático, só oficiais são usadas, com nota de correspondência alta.
- **Mudança de etapa recusada pela trava:** nada muda, sem erro para o usuário; fica registrado o que faltava.
- **Sugestão velha:** se chegar nova mensagem do lead, a pendente vira `expired` e sai uma nova.
- **Follow-up pendente sem aprovação:** fica pendente até a próxima mensagem do lead (aí expira) ou por no máximo 24h (aí expira e o follow-up segue para o próximo passo na próxima janela).
- **Liga/desliga do envio automático:** vale para as próximas mensagens; sugestões pendentes expiram.

## 7. Testes

- Testes `node:test` para: **busca na base** (normalização, sinônimos, nota mínima, mensagem com vários assuntos vai para a IA); "exige qualificação" troca pelo contorno de objeção; candidata → oficial (3 envios sem edição / aprovação); escolha da melhor variação após 20 usos; decisão do passo 13 por modo; agrupamento de 40s; análise obrigatória a cada 5 mensagens; **trava de mudança de etapa** (campos faltando, critério pendente, tudo atendido); `resolveAnthropicKey` com `ai_key_source`; transições de status de `ai_suggestions`; follow-up no Copiloto (pausa em vez de envio); parser da ferramenta de análise.
- Teste manual na conta Dros, com o envio automático desligado (Copiloto), usando o WhatsApp da Dros.

## 8. Implantação

1. Deploy com tudo em `auto` + `client` (ninguém muda de comportamento).
2. Conta Dros: entrevista → revisar perfil (substitui a base da OXI que está hoje no agente da Dros) e a base de respostas inicial (perguntas frequentes + objeções) → follow-up por etapa com IA → acesso `dros` → **envio automático desligado (Copiloto)**.
3. 2 semanas de validação na Dros olhando a medição (3.7) e o custo do mês (3.8).
4. Liberar para os clientes ativos: QUIMIPROL, Mazin, Solclor, USTULIMP, Texas Química, TELHABRAS.

## 9. Riscos

- **O agente da conta Dros está ativo** com a base da OXI; liberar o acesso antes de desligar o envio automático faria ele responder sozinho. A ordem da seção 8 evita isso.
- **Base respondendo fora de contexto** (ex.: pergunta parecida, assunto diferente): mitigada pela nota mínima alta, mensagem de assunto único, oficialização só depois de uso real e, no automático, uso só de oficiais.
- **Mudança de etapa automática errada:** mitigada pela trava no código (3.4); tudo fica no `stage_history` com `ai_qualified` para auditar e desfazer.
- **Produção em Node 16 / CentOS 7:** nada de dependência nova; a busca na base é código próprio (sem biblioteca de busca); chamadas à IA seguem o cliente HTTP que já existe (`anthropicClient.js`), ganhando só a opção de escolher o modelo (Opus 5 na entrevista).
- **WhatsApp não oficial (Evolution):** o Copiloto reduz o risco de banimento, porque o envio é humano.
- **Áudio:** a transcrição depende de `DEEPGRAM_API_KEY` no `/root/.env` (a confirmar). O áudio transcrito também passa pela busca na base.

## 10. Fora desta versão

Painel de medição separado; análise do histórico antigo; cobrança por disparo; busca semântica com embeddings (a busca por palavras + sinônimos vem primeiro; embeddings só se a taxa de acerto da base ficar baixa); IA mudando campos do perfil sem aprovação; canais além do WhatsApp.

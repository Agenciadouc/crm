# Copiloto no Agente de IA — Desenho

Data: 15/09/2026 · Base: produção (`origin/main` de 13/09/2026) · Primeiro teste: conta **Dros (id 2)**

## 1. Objetivo

Transformar o Agente de IA que já existe num **gestor de vendas**: ele entende o momento do lead, conduz a qualificação, contorna objeções, move o lead de etapa quando a qualificação está completa, sugere follow-up por etapa e aprende com as conversas. Tudo isso **sem tela nova**: o usuário continua usando a tela **Agentes de IA** e o **Chat**.

## 2. Princípios (decididos pelo CEO)

1. **Aproveitar o que existe.** Nada de módulo novo. O cérebro continua sendo o `aiAgent.js`.
2. **O mínimo de botões e campos.** Uma opção liga/desliga do envio automático, um botão de entrevista e um bloco de follow-up por etapa.
3. **Didático.** A sugestão aparece onde o vendedor já escreve: a caixa de mensagem do Chat.
4. **Nunca passar orçamento sem qualificar**, com envio automático ligado ou desligado.
5. **Mudar de etapa só com a qualificação completa.**
6. **A IA aprende, mas quem aprova é gente.** Toda melhoria sugerida pela IA passa por aprovação do gestor.
7. **Usar a IA exige chave própria do cliente ou pagamento por disparo da IA da Dros.**

## 3. As peças

### 3.1 Opção "Envio automático da IA" (liga/desliga, tela Agentes de IA)

| Envio automático | Resposta ao lead | Follow-up por inatividade |
|---|---|---|
| **Ligado** | A IA envia sozinha (comportamento atual) | Envia sozinho (comportamento atual) |
| **Desligado (Copiloto)** | A IA escreve a resposta, que aparece **pronta na caixa de mensagem do Chat**; o vendedor envia | A IA personaliza a mensagem e ela aparece para o vendedor **aprovar e enviar** |

A opção só pode ser usada se a conta tiver **acesso à IA** liberado (seção 3.8). Sem acesso, o agente fica desligado e a tela explica como liberar.

Onde muda no código: `processInboundMessage` (`server/services/aiAgent.js`). O fluxo inteiro continua igual (agente, limite, transcrição de áudio, prompt, histórico, ferramentas, chamada da IA). Só o **passo 13 (envio, `sendViaInstance`)** se divide:
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

- Ao receber `lead:ai_suggestion`, se a conversa estiver aberta e a caixa **vazia**, o texto entra na caixa com a etiqueta discreta **"sugestão da IA"**. Se o vendedor já estiver digitando, a sugestão **não sobrescreve**: aparece uma linha fina acima da caixa, "A IA tem uma sugestão — ver".
- **Enter** envia normalmente. **Apagar** descarta.
- Ao abrir uma conversa com sugestão pendente, ela é carregada do banco.
- No cabeçalho da conversa, um selo pequeno: **Chance de fechar 60% · trava: preço**.
- Quando a IA mover o lead de etapa, aparece no histórico do lead "Movido pela IA — qualificação completa", como já acontece com as mudanças automáticas.

### 3.3 Entrevista de mapeamento comercial (botão "Montar com entrevista")

Um chat dentro da tela do agente, em que a IA (Claude Opus 5) entrevista o dono ou gestor, **uma pergunta por vez**, cobrindo:

1. **Empresa e oferta:** o que vende, faixas de preço, diferenciais, região de atendimento.
2. **Lead ideal:** quem compra e quem não vale a pena (porte, região, volume, perfil).
3. **Momento ideal:** que sinais mostram que o lead está pronto para receber orçamento ou proposta.
4. **Qualificação:** as perguntas obrigatórias e em que ordem fazer; quais respostas são **critérios obrigatórios** para mudar de etapa.
5. **Preço e política:** quando pode falar preço, descontos, prazos e o que nunca prometer.
6. **Objeções:** as mais comuns, **principalmente pedir preço antes da hora**, e o contorno certo de cada uma.
7. **Etapas do funil:** o que acontece em cada etapa, quanto tempo de inatividade é aceitável e quantas ações de follow-up fazer em cada uma.
8. **Concorrência:** com quem o lead compara e como se diferenciar.

**Resultado:** a IA preenche **os campos que já existem** no agente, e o gestor revisa antes de salvar:
- `persona` → tom de voz;
- `knowledge_base` → empresa, oferta, momento ideal, objeções e contornos, concorrência (em seções com título);
- `never_mention` → o que nunca prometer ou falar;
- `qualification_criteria` → definição de lead ideal + momento ideal + lista dos critérios obrigatórios;
- `required_fields` → dados obrigatórios.

Ela também **propõe o follow-up por etapa** (seção 3.5). A transcrição fica guardada (`ai_agents.interview_json`, sem aparecer na tela) para refazer ou continuar depois. A entrevista e as sugestões semanais **não contam como disparo**.

### 3.4 Regras de venda e trava de qualificação (nos dois modos)

Acrescentadas ao prompt do agente:
- **Nunca passar orçamento, preço ou proposta antes de o lead cumprir todos os critérios de qualificação E o momento ideal.**
- Se o lead **insistir no preço**, usar o **contorno de objeção** da base de conhecimento e seguir com a **próxima pergunta de qualificação**. Nunca recusar seco.
- A cada análise, a IA devolve (numa ferramenta obrigatória, com formato fixo):
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
- **Por baixo, reaproveita o que existe:** grava em `follow_ups` (tipo inatividade, `inactivity_stage_id`, `inactivity_minutes`, `agent_id`) + `follow_up_steps`, processados por `inactivityScanner.js` + `followUpSender.js`. O botão só preenche essas tabelas.
- **Envio automático ligado:** envia como hoje.
- **Envio automático desligado (Copiloto):** no momento de enviar, `followUpSender.js` pede à IA para **personalizar o passo** com a conversa, grava em `ai_suggestions` (tipo `follow_up`) e **pausa até o vendedor aprovar**. A sugestão aparece na caixa do Chat daquele lead e na lista do Chat com o selo "follow-up para aprovar".
- Se o lead responder, o follow-up para (regra `stop_on_reply` que já existe).

### 3.6 Aprendizado e sugestões de melhoria (semanal)

Uma rotina semanal (no `scheduler.js` que já existe) lê as conversas da semana do agente e os dados de 3.4 e calcula:
- **as objeções que mais travaram o fechamento**;
- **em que etapa e depois de quanto tempo parado** os leads se perdem;
- **qual passo de follow-up mais recupera** leads;
- **quais critérios de qualificação mais ficam pendentes**;
- **quais sugestões os vendedores mais usaram, editaram ou ignoraram**.

Com isso a IA gera **sugestões de melhoria**. Exemplos: "acrescentar contorno para a objeção 'já tenho fornecedor'", "na etapa Proposta, reduzir a inatividade de 2 dias para 1 dia", "o passo 3 nunca recupera; trocar a mensagem". Elas aparecem na tela do agente como **"Sugestões de melhoria (3)"**, com **Aprovar** / **Recusar**. Aprovar aplica a mudança no campo ou follow-up correspondente.

### 3.7 Medição

Tudo sai de `ai_suggestions` e `stage_history`: % usada sem editar, % editada, % descartada, tempo até o vendedor agir, leads recuperados por follow-up e em que passo, leads movidos pela IA. Mostrado num resumo curto dentro da tela do agente (sem painel novo nesta versão).

### 3.8 Acesso à IA: chave própria ou pagamento por disparo

Para ligar a IA num cliente, o admin da Dros escolhe **uma** forma:

| Forma | Como funciona |
|---|---|
| **Chave própria** | O cliente informa a chave dele (`accounts.anthropic_api_key`, que já existe). O custo da IA é dele. |
| **IA da Dros, paga por disparo** | Usa a chave central da Dros (`ANTHROPIC_API_KEY_DROS` no `/root/.env`). Cada disparo é contado e cobrado pelo preço definido pelo admin para aquele cliente. |

- `accounts.ai_key_source`: `client` / `dros`. `resolveAnthropicKey` (`anthropicClient.js`) passa a respeitar essa escolha.
- **O que é 1 disparo:** cada resposta enviada pela IA (envio automático ligado), cada sugestão gerada ao vendedor (Copiloto) e cada follow-up personalizado. Chamadas internas repetidas da mesma resposta contam como **um** disparo.
- `accounts.ai_price_per_action_brl`: preço por disparo (só para `dros`).
- `accounts.ai_monthly_action_limit`: limite de disparos por mês (opcional). Ao bater o limite, a IA pausa naquela conta até virar o mês ou o admin aumentar, com aviso na tela do agente.
- **Extrato do mês** na tela do agente: disparos × preço = valor a cobrar, e o custo real da IA para a Dros (tokens × preço, do `ai_agent_token_log`), para acompanhar a margem.
- Sem chave própria válida e sem a forma `dros` escolhida, a IA não liga.

## 4. Dados (mudanças mínimas)

| Onde | Mudança |
|---|---|
| `ai_agents` | `mode TEXT NOT NULL DEFAULT 'auto'` (`auto` = envio automático ligado, `copilot` = desligado); `interview_json TEXT` |
| `accounts` | `ai_key_source TEXT NOT NULL DEFAULT 'client'`; `ai_price_per_action_brl REAL`; `ai_monthly_action_limit INTEGER` |
| `leads` | `ai_close_chance INTEGER`; `ai_main_blocker TEXT`; `ai_criteria_json TEXT`; `ai_moment TEXT` |
| `ai_agent_token_log` | `action_id TEXT` (agrupa as chamadas de um mesmo disparo) |
| **nova** `ai_actions` | `id, account_id, agent_id, lead_id, kind ('reply_sent'\|'suggestion'\|'follow_up'), key_source, price_brl, created_at` — um registro por disparo, base do extrato e do limite |
| **nova** `ai_suggestions` | `id, account_id, lead_id, agent_id, kind ('reply'\|'follow_up'\|'improvement'), content, payload_json, status ('pending'\|'sent'\|'edited'\|'discarded'\|'expired'\|'approved'\|'rejected'), final_content, lead_follow_up_id, created_at, resolved_at, resolved_by` |

Tudo com `addColumnIfNotExists` / `CREATE TABLE IF NOT EXISTS` em `server/db.js`, seguindo o padrão atual. **Default = `auto` e `client`**: nenhum cliente muda de comportamento nem de cobrança no deploy.

## 5. Fluxos

**Mensagem do lead (Copiloto):** webhook grava a mensagem → timer de 40s por lead → checa acesso e limite (3.8) → `processInboundMessage` → IA (resposta + momento/chance/trava/critérios) → grava lead → se pediu para mudar de etapa, passa pela trava (3.4) → grava `ai_suggestions` + `ai_actions` → SSE → caixa do Chat → o vendedor envia (status `sent` ou `edited`, comparando o texto enviado com o sugerido) ou descarta.

**Lead parado (Copiloto):** `inactivityScanner` acha o lead na etapa com o tempo vencido → checa acesso e limite → `followUpSender` pede a personalização do passo → `ai_suggestions` (`follow_up`, pendente) + `ai_actions` → o vendedor aprova no Chat → envia → o follow-up avança para o próximo passo.

## 6. Erros e limites

- **Sem acesso à IA ou limite de disparos estourado:** no Copiloto, nada acontece (o vendedor atende normal); com envio automático ligado, a IA para de responder e o lead segue para o atendente (handoff silencioso que já existe). Aviso na tela do agente nos dois casos.
- **Falha da IA ou do Deepgram:** sem sugestão e sem disparo cobrado; registrado no log.
- **Mudança de etapa recusada pela trava:** nada muda, sem erro para o usuário; fica registrado o que faltava.
- **Sugestão velha:** se chegar nova mensagem do lead, a pendente vira `expired` e sai uma nova.
- **Follow-up pendente sem aprovação:** fica pendente até a próxima mensagem do lead (aí expira) ou por no máximo 24h (aí expira e o follow-up segue para o próximo passo na próxima janela).
- **Liga/desliga do envio automático:** vale para as próximas mensagens; sugestões pendentes expiram.

## 7. Testes

- Testes `node:test` para: decisão do passo 13 por modo; agrupamento de 40s; **trava de mudança de etapa** (campos faltando, critério pendente, tudo atendido); contagem de disparo (várias chamadas = 1 disparo; falha = 0); limite mensal de disparos; `resolveAnthropicKey` com `ai_key_source`; transições de status de `ai_suggestions`; personalização do follow-up no Copiloto (pausa em vez de envio); parser da ferramenta de análise.
- Teste manual na conta Dros, com o envio automático desligado (Copiloto), usando o WhatsApp da Dros.

## 8. Implantação

1. Deploy com tudo em `auto` + `client` (ninguém muda de comportamento nem de cobrança).
2. Conta Dros: entrevista → revisar perfil (substitui a base da OXI que está hoje no agente da Dros) → follow-up por etapa com IA → acesso `dros` → **envio automático desligado (Copiloto)**.
3. 2 semanas de validação na Dros olhando a medição (3.7) e o extrato (3.8).
4. Liberar para os clientes ativos: QUIMIPROL, Mazin, Solclor, USTULIMP, Texas Química, TELHABRAS.

## 9. Riscos

- **O agente da conta Dros está ativo** com a base da OXI; liberar o acesso antes de desligar o envio automático faria ele responder sozinho. A ordem da seção 8 evita isso.
- **Mudança de etapa automática errada:** mitigada pela trava no código (3.4); tudo fica no `stage_history` com `ai_qualified` para auditar e desfazer.
- **Produção em Node 16 / CentOS 7:** nada de dependência nova; chamadas à IA seguem o cliente HTTP que já existe (`anthropicClient.js`), ganhando só a opção de escolher o modelo (Opus 5 na entrevista).
- **WhatsApp não oficial (Evolution):** o Copiloto reduz o risco de banimento, porque o envio é humano.
- **Áudio:** a transcrição depende de `DEEPGRAM_API_KEY` no `/root/.env` (a confirmar).

## 10. Fora desta versão

Painel de medição separado; análise do histórico antigo; cobrança automática (boleto/cartão) dos disparos — nesta versão o extrato mostra o valor e a cobrança é feita por fora; IA mudando campos do perfil sem aprovação; canais além do WhatsApp.

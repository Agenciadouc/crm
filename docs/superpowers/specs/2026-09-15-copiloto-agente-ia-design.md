# Copiloto no Agente de IA — Desenho

Data: 15/09/2026 · Base: produção (`origin/main` de 13/09/2026) · Primeiro teste: conta **Dros (id 2)**

## 1. Objetivo

Transformar o Agente de IA que já existe num **gestor de vendas**: ele entende o momento do lead, conduz a qualificação, contorna objeções, sugere follow-up por etapa e aprende com as conversas. Tudo isso **sem tela nova**: o usuário continua usando a tela **Agentes de IA** e o **Chat**.

## 2. Princípios (decididos pelo CEO)

1. **Aproveitar o que existe.** Nada de módulo novo. O cérebro continua sendo o `aiAgent.js`.
2. **O mínimo de botões e campos.** Um seletor de modo, um botão de entrevista e um bloco de follow-up por etapa.
3. **Didático.** A sugestão aparece onde o vendedor já escreve: a caixa de mensagem do Chat.
4. **Nunca passar orçamento sem qualificar**, nos dois modos.
5. **A IA aprende, mas quem aprova é gente.** Toda melhoria sugerida pela IA passa por aprovação do gestor.
6. **No modo Copiloto, nada sai sem o vendedor.** Nem resposta, nem follow-up.

## 3. As peças

### 3.1 Seletor "Como a IA atua" (tela Agentes de IA)

| Modo | Resposta ao lead | Follow-up por inatividade |
|---|---|---|
| **Automático** | A IA envia sozinha (comportamento atual, sem mudança) | Envia sozinho (comportamento atual) |
| **Copiloto** | A IA escreve a resposta, que aparece **pronta na caixa de mensagem do Chat**; o vendedor envia | A IA personaliza a mensagem e ela aparece para o vendedor **aprovar e enviar** |

Onde muda no código: `processInboundMessage` (`server/services/aiAgent.js`). O fluxo inteiro continua igual (agente, limite de tokens, transcrição de áudio, prompt, histórico, ferramentas, chamada da IA). Só o **passo 13 (envio, `sendViaInstance`)** se divide:
- `auto`: envia como hoje.
- `copilot`: grava a sugestão em `ai_suggestions` e avisa o Chat por SSE (`broadcastSSE(accountId, 'lead:ai_suggestion', { lead_id })`).

Ferramentas no modo Copiloto:
- `update_lead_info`: executa normalmente (só grava dados).
- Mover etapa / adicionar tag: vira **sugestão de um clique** junto do rascunho ("Mover para Qualificado?").
- `transfer_to_human`: não se aplica, porque o humano já está atendendo. É ignorada.
- As regras de "máximo de mensagens do robô" e "recusar áudio" não se aplicam: quem conversa é o vendedor.

**Agrupamento:** no modo Copiloto, a análise espera **40 segundos sem nova mensagem do lead** (um timer em memória por lead; a produção roda 1 processo pm2) e analisa o bloco inteiro de uma vez.

### 3.2 Sugestão na caixa de mensagem (Chat)

- Ao receber `lead:ai_suggestion`, se a conversa estiver aberta e a caixa **vazia**, o texto entra na caixa com a etiqueta discreta **"sugestão da IA"**. Se o vendedor já estiver digitando, a sugestão **não sobrescreve**: aparece uma linha fina acima da caixa, "A IA tem uma sugestão — ver".
- **Enter** envia normalmente. **Apagar** descarta.
- Ao abrir uma conversa com sugestão pendente, ela é carregada do banco.
- No cabeçalho da conversa, um selo pequeno: **Chance de fechar 60% · trava: preço**.

### 3.3 Entrevista de mapeamento comercial (botão "Montar com entrevista")

Um chat dentro da tela do agente, em que a IA (Claude Opus 5) entrevista o dono ou gestor, **uma pergunta por vez**, cobrindo:

1. **Empresa e oferta:** o que vende, faixas de preço, diferenciais, região de atendimento.
2. **Lead ideal:** quem compra e quem não vale a pena (porte, região, volume, perfil).
3. **Momento ideal:** que sinais mostram que o lead está pronto para receber orçamento ou proposta.
4. **Qualificação:** as perguntas obrigatórias e em que ordem fazer.
5. **Preço e política:** quando pode falar preço, descontos, prazos e o que nunca prometer.
6. **Objeções:** as mais comuns, **principalmente pedir preço antes da hora**, e o contorno certo de cada uma.
7. **Etapas do funil:** o que acontece em cada etapa, e quanto tempo de inatividade é aceitável em cada uma.
8. **Concorrência:** com quem o lead compara e como se diferenciar.

**Resultado:** a IA preenche **os campos que já existem** no agente, e o gestor revisa antes de salvar:
- `persona` → tom de voz;
- `knowledge_base` → empresa, oferta, momento ideal, objeções e contornos, concorrência (em seções com título);
- `never_mention` → o que nunca prometer ou falar;
- `qualification_criteria` → definição de lead ideal + momento ideal;
- `required_fields` → dados obrigatórios.

Ela também **propõe o follow-up por etapa** (seção 3.5). A transcrição da entrevista fica guardada (`ai_agents.interview_json`, sem aparecer na tela) para refazer ou continuar depois.

### 3.4 Regras de venda (acrescentadas ao prompt do agente, nos dois modos)

- **Nunca passar orçamento, preço ou proposta antes de o lead cumprir o critério de qualificação E o momento ideal.**
- Se o lead **insistir no preço**, usar o **contorno de objeção** da base de conhecimento e seguir com a **próxima pergunta de qualificação**. Nunca recusar seco.
- A cada análise, a IA devolve (numa ferramenta obrigatória, com formato fixo):
  - `momento`: etapa real da conversa;
  - `chance_fechar`: 0 a 100;
  - `trava_principal`: a objeção ou bloqueio atual (ou vazio);
  - `falta_qualificar`: lista do que ainda falta descobrir.
  Esses dados vão para o lead e alimentam o selo do Chat e o aprendizado.

### 3.5 Follow-up por etapa, criado pela IA (bloco na tela do agente)

Uma lista com as etapas do funil. Para cada etapa:

| Etapa | Tempo de inatividade | Nº de ações | |
|---|---|---|---|
| Em Atendimento | [12 horas ▾] | [3 ▾] | **Criar com IA** |
| Proposta | [1 dia ▾] | [4 ▾] | **Criar com IA** |

- **Criar com IA** gera os passos (mensagens e intervalos) usando o perfil da empresa e a etapa, respeitando a regra de não passar preço sem qualificação. O gestor revisa os textos e salva.
- **Por baixo, reaproveita o que existe:** grava em `follow_ups` (tipo inatividade, `inactivity_stage_id`, `inactivity_minutes`, `agent_id`) + `follow_up_steps`, processados por `inactivityScanner.js` + `followUpSender.js`. O botão só preenche essas tabelas.
- **Modo Automático:** envia como hoje.
- **Modo Copiloto:** no momento de enviar, `followUpSender.js` pede à IA para **personalizar o passo** com a conversa, grava em `ai_suggestions` (tipo `follow_up`) e **pausa até o vendedor aprovar**. A sugestão aparece na caixa do Chat daquele lead e na lista do Chat com o selo "follow-up para aprovar".
- Se o lead responder, o follow-up para (regra `stop_on_reply` que já existe).

### 3.6 Aprendizado e sugestões de melhoria (semanal)

Uma rotina semanal (no `scheduler.js` que já existe) lê as conversas da semana do agente e os dados de 3.4 e calcula:
- **as objeções que mais travaram o fechamento**;
- **em que etapa e depois de quanto tempo parado** os leads se perdem;
- **qual passo de follow-up mais recupera** leads;
- **quais sugestões os vendedores mais usaram, editaram ou ignoraram**.

Com isso a IA gera **sugestões de melhoria**. Exemplos: "acrescentar contorno para a objeção 'já tenho fornecedor'", "na etapa Proposta, reduzir a inatividade de 2 dias para 1 dia", "o passo 3 nunca recupera; trocar a mensagem". Elas aparecem na tela do agente como **"Sugestões de melhoria (3)"**, com **Aprovar** / **Recusar**. Aprovar aplica a mudança no campo ou follow-up correspondente.

### 3.7 Medição

Tudo sai de `ai_suggestions`: % usada sem editar, % editada, % descartada, tempo até o vendedor agir, leads recuperados por follow-up e em que passo. Mostrado num resumo curto dentro da tela do agente (sem painel novo nesta versão).

### 3.8 Chave de IA por cliente

- `accounts.ai_key_source`: `client` (usa `accounts.anthropic_api_key`, como hoje) ou `dros` (usa a chave central `ANTHROPIC_API_KEY_DROS` do `/root/.env`).
- Só o admin da Dros escolhe. `resolveAnthropicKey` (`anthropicClient.js`) passa a respeitar essa escolha.
- Gasto por cliente: continua o limite mensal de tokens do agente (`monthly_token_limit`) e o log `ai_agent_token_log`.

## 4. Dados (mudanças mínimas)

| Onde | Mudança |
|---|---|
| `ai_agents` | `mode TEXT NOT NULL DEFAULT 'auto'` (`auto`/`copilot`); `interview_json TEXT` |
| `accounts` | `ai_key_source TEXT NOT NULL DEFAULT 'client'` |
| `leads` | `ai_close_chance INTEGER`; `ai_main_blocker TEXT`; `ai_missing_qualification TEXT` (JSON); `ai_moment TEXT` |
| **nova** `ai_suggestions` | `id, account_id, lead_id, agent_id, kind ('reply'\|'follow_up'\|'stage_move'\|'improvement'), content, payload_json, status ('pending'\|'sent'\|'edited'\|'discarded'\|'expired'\|'approved'\|'rejected'), final_content, lead_follow_up_id, created_at, resolved_at, resolved_by` |

Tudo com `addColumnIfNotExists` / `CREATE TABLE IF NOT EXISTS` em `server/db.js`, seguindo o padrão atual. **Default = `auto`**: nenhum cliente muda de comportamento no deploy.

## 5. Fluxos

**Mensagem do lead (Copiloto):** webhook grava a mensagem → timer de 40s por lead → `processInboundMessage` → IA (resposta + momento/chance/trava/falta) → grava lead + `ai_suggestions` → SSE → caixa do Chat → o vendedor envia (status `sent` ou `edited`, comparando o texto enviado com o sugerido) ou descarta.

**Lead parado (Copiloto):** `inactivityScanner` acha o lead na etapa com o tempo vencido → `followUpSender` pede a personalização do passo → `ai_suggestions` (`follow_up`, pendente) → o vendedor aprova no Chat → envia → o follow-up avança para o próximo passo.

## 6. Erros e limites

- **Sem chave ou limite de tokens estourado:** no Copiloto, nada acontece (o vendedor atende normal), com um aviso discreto na tela do agente. Nunca faz handoff nem envia nada.
- **Falha da IA ou do Deepgram:** sem sugestão; registrado no log.
- **Sugestão velha:** se chegar nova mensagem do lead, a pendente vira `expired` e sai uma nova.
- **Follow-up pendente sem aprovação:** fica pendente até a próxima mensagem do lead (aí expira) ou por no máximo 24h (aí expira e o follow-up segue para o próximo passo na próxima janela).
- **Troca de modo** Automático ⇄ Copiloto: vale para as próximas mensagens; sugestões pendentes expiram.

## 7. Testes

- Testes `node:test` para: decisão do passo 13 por modo; agrupamento de 40s; transições de status de `ai_suggestions`; personalização do follow-up no Copiloto (pausa em vez de envio); `resolveAnthropicKey` com `ai_key_source`; parser da ferramenta de análise (momento/chance/trava/falta).
- Teste manual na conta Dros, em modo Copiloto, com o WhatsApp da Dros.

## 8. Implantação

1. Deploy com tudo em `auto` (ninguém muda).
2. Conta Dros: entrevista → revisar perfil (substitui a base da OXI que está hoje no agente da Dros) → follow-up por etapa com IA → chave com `ai_key_source` → **modo Copiloto**.
3. 2 semanas de validação na Dros olhando a medição (3.7).
4. Liberar para os clientes ativos: QUIMIPROL, Mazin, Solclor, USTULIMP, Texas Química, TELHABRAS.

## 9. Riscos

- **O agente da conta Dros está ativo** com a base da OXI; colocar a chave antes de trocar o modo faria ele responder sozinho. A ordem da seção 8 evita isso.
- **Produção em Node 16 / CentOS 7:** nada de dependência nova; chamadas à IA seguem o cliente HTTP que já existe (`anthropicClient.js`), ganhando só a opção de escolher o modelo (Opus 5 na entrevista).
- **WhatsApp não oficial (Evolution):** o Copiloto reduz o risco de banimento, porque o envio é humano.
- **Áudio:** a transcrição depende de `DEEPGRAM_API_KEY` no `/root/.env` (a confirmar).

## 10. Fora desta versão

Painel de medição separado; análise do histórico antigo; IA mudando campos sem aprovação; canais além do WhatsApp.

# Papéis dos números + regras anti-banimento — design

Data: 23/09/2026 · Branch: `feat/provedor-uzapi` · Status: aguardando revisão do dono

## 1. Objetivo

Separar o que cada número de WhatsApp faz no CRM, pelo provedor escolhido na conexão:

| Provedor (escolhido ao conectar) | Papel | O que faz |
|---|---|---|
| Evolution própria | **Leitura** | Lê as conversas do vendedor; só sai por ele o que um humano digitou no chat do CRM |
| UzAPI | **Disparo** | Disparos, follow-ups, agente de IA, mensagens automáticas |
| API Oficial (futuro) | **Disparo** | Idem (o conector da Oficial é projeto separado — ver seção 9) |

E aplicar, em todo envio automático, as 4 regras de boas práticas da UzAPI (apresentação "Automação de WhatsApp sem Banimentos"): consentimento com saída fácil, engajamento, mensagens não repetidas e intervalo variável.

**Sucesso =** nenhum envio automático sai por número da Evolution; todo automático sai pelo número padrão de disparos; sem esse número, nada automático sai e o CRM avisa; follow-ups e disparos respeitam descadastro, intervalo e variação.

### Conta com um número só (caso mais comum)

Muitos clientes têm um celular só e nenhum outro vendedor. O papel continua vindo do provedor:

| A conta tem | Resultado |
|---|---|
| Só Evolution própria | Lê e o humano responde pelo chat. **Envios automáticos desligados** por padrão (estado normal, não erro): as telas mostram "Envios automáticos desligados — conecte UzAPI ou Oficial para liberar". |
| Só UzAPI ou só Oficial | O mesmo número faz **tudo**: leitura, resposta manual e automáticos. Ao conectar, ele vira o número padrão e os automáticos ficam **habilitados na hora da integração**. |
| Evolution + UzAPI/Oficial | Evolution = leitura + manual; o número de disparo faz os automáticos. |

## 2. Decisões do dono (23/09/2026)

1. Resposta **manual** digitada no chat do CRM sai pela Evolution (número da conversa).
2. **Todo automático** sai pelo número de disparo: disparos, follow-ups, agente de IA, mensagens de ausência/boas-vindas.
3. Sem número de disparo conectado → **segura na fila e avisa**. Nunca cai para a Evolution.
4. Papel **fixo pelo provedor** (sem campo de configuração).
5. A conta escolhe na conexão inicial qual número de disparo usa (UzAPI ou Oficial) e ele fica como **padrão**.
6. Agente de IA **só atende** quem escreve no número de disparo e responde por ele. Na Evolution quem responde é o vendedor.
7. A "1ª mensagem" da passagem para o vendedor **vira tarefa** do vendedor (não é enviada sozinha).
8. Os 7 itens anti-ban entram neste mesmo projeto.
9. Cliente com um celular só: na Evolution própria não há disparos; com UzAPI ou Oficial os automáticos ficam habilitados já na integração.

## 3. Papel do número

Função pura `numberRole(instance)` em `server/services/whatsapp/numberRole.js`:
- `provider` vazio ou `evolution` → `'leitura'`
- `uzapi` ou `cloud_api` (API Oficial) → `'disparo'`
- qualquer outro → `'leitura'` (lado seguro)

## 4. Número padrão de disparos

- Nova coluna `accounts.default_send_instance_id` (INTEGER, pode ser NULL).
- Quando um número de disparo **conecta** e a conta não tem padrão (ou o padrão foi removido), ele vira o padrão automaticamente.
- Ao **remover** o número padrão: se houver outro número de disparo na conta, o de menor id vira padrão; senão fica NULL.
- Em Integrações, o card do número padrão mostra o selo **"Padrão de disparos"**. Outros números de disparo mostram o botão **"Tornar padrão"** (rota `PUT /api/integrations/whatsapp/default-send-instance`, só admin/gerente).

## 5. Escolhedor de número de saída

`resolveSendInstance(db, { accountId, kind, conversationInstanceId })` em `server/services/whatsapp/resolveSendInstance.js`:
- `kind: 'manual'` → o número da conversa (comportamento de hoje em `routes/messages.js`).
- `kind: 'automatico'` → o número padrão da conta, **se** estiver `connected` e for papel `disparo`.
- Sem padrão válido → `{ ok: false, reason: 'no_send_number' }`.

Quem passa a usar o escolhedor com `kind: 'automatico'`:

| Caminho | Arquivo | Hoje | Depois |
|---|---|---|---|
| Disparos em massa | `routes/broadcasts.js` | `broadcasts.instance_id` escolhido na tela | número padrão (a coluna fica só como histórico de por onde saiu) |
| Follow-ups | `services/followUpSender.js` | `follow_ups.instance_id` | número padrão |
| Agente de IA | `services/aiAgent.js` | número onde o lead escreveu | só roda se esse número for de disparo (ver seção 6) |
| Ausência/boas-vindas | `services/autoMessages.js` | número onde o lead escreveu | só roda se esse número for de disparo (ver seção 6) |
| 1ª msg da passagem ao vendedor | `services/leadHandoff.js` | enviada pelo número do vendedor | **vira tarefa** (seção 7) |
| Aviso interno ao vendedor | `services/leadHandoff.js` | número "notificador" da Dros | **não muda** — é mensagem para a equipe, não para lead |

## 6. Agente de IA e mensagens automáticas só no número de disparo

- Mensagem recebida em número de **leitura**: o agente não roda e as mensagens de ausência/boas-vindas não são enviadas. A mensagem é gravada normalmente e aparece no chat.
- Tela do agente: a lista de números que o agente atende (`ai_agent_instances`) mostra só números de disparo. Ligações antigas com números de leitura ficam no banco, mas são ignoradas; a tela avisa "Este agente estava ligado a um número de leitura; agora ele só atende números de disparo".
- Tela de mensagens automáticas do número: em número de leitura, o bloco fica desabilitado com a explicação "Mensagens automáticas só saem pelo número de disparos".

## 7. "1ª mensagem" vira tarefa

Se o número do vendedor (`users.primary_instance_id`) for de **disparo** (UzAPI/Oficial), nada muda: a 1ª mensagem sai sozinha como hoje. Se for de **leitura** (Evolution), em `leadHandoff.js`, quando hoje o CRM enviaria a 1ª mensagem:
- Cria uma `standalone_tasks` para o vendedor: título "Mandar 1ª mensagem para {lead}", descrição com o texto já montado (mesmo modelo de hoje: funil > número), vencimento agora.
- Não envia nada. `first_msg_sent_at` só é marcado quando a tarefa for criada (evita tarefa repetida).
- O aviso interno ao vendedor (etapa 2) continua igual.

## 8. Trava de segurança

Em `sender.js`, `sendViaInstance`/`sendMediaViaInstance` ganham a opção `origin: 'manual' | 'auto'`, com padrão `'auto'`:
- Se `origin === 'auto'`, há `leadId` e `numberRole(instance) === 'leitura'` → recusa com `reason: 'auto_on_read_number'` e registra no log.
- `routes/messages.js` (chat) passa `origin: 'manual'`.
- Envios sem `leadId` (aviso interno ao vendedor) não são afetados.

Assim, qualquer caminho esquecido falha de forma segura em vez de sair pela Evolution.

## 9. Fila e aviso quando não há número de disparo

- **Follow-ups:** pausam com `paused_reason = 'no_send_number'`. Quando um número vira padrão ou reconecta, retomam (estende `resumeFollowUpsIfPaused` para buscar por conta, não mais por `follow_ups.instance_id`).
- **Disparos:** não iniciam e ficam pausados com `paused_reason = 'no_send_number'`; retomam do mesmo jeito (`resumeBroadcastIfPaused`).
- **Aviso na tela** (Disparos, Cadências e Follow-ups, Integrações). Rota `GET /api/integrations/whatsapp/send-number-status` devolve `{ ok, instance, reason }`, e o texto depende do caso:
  - conta **nunca teve** número de disparo (`reason: 'no_send_number'`): aviso neutro "Envios automáticos desligados — conecte UzAPI ou Oficial para liberar";
  - número padrão **caiu** (`reason: 'send_number_offline'`): alerta "O número de disparos está desconectado — os envios automáticos estão parados".

**API Oficial:** `numberRole` já trata `cloud_api` (Oficial) como disparo. Conector, templates aprovados pela Meta (criação e acompanhamento pelo CRM, sem abrir telas da Meta), Embedded Signup, Tech Provider e coexistência ficam no projeto da Oficial, junto com o Motor de Custo.

## 10. Regras anti-banimento

### ① Follow-ups respeitam descadastro
`followUpSender.js`: lead com `opted_out_at` mais recente que `opted_in_at` → pausa com `paused_reason = 'lead_opted_out'` (mesma regra que `broadcasts.js:75` já usa; extrair para `isOptedOut(lead)` compartilhada).

### ② Descadastro automático pela palavra "SAIR"
No fluxo de mensagem recebida (`inboundRuntime.js`), se o texto inteiro, sem acentos, sem pontuação e em minúsculas for uma destas palavras: `sair`, `parar`, `pare`, `cancelar`, `descadastrar`, `stop`:
- marca `opted_out_at = agora`;
- cancela os follow-ups ativos do lead (`cancelled`, motivo `lead_opted_out`);
- se chegou num número de **disparo**, responde uma vez: "Pronto! Você não vai mais receber nossas mensagens automáticas." (texto editável por conta);
- o agente de IA não responde a essa mensagem.

Só vale para mensagem que é **só** a palavra, para evitar falso positivo ("vou sair agora").

### ③ Rodapé "Digite SAIR"
Disparos em massa ganham no fim da mensagem: "\n\nDigite SAIR para não receber mais mensagens." Ligado por padrão; texto e liga/desliga por conta (`accounts.optout_footer_enabled`, `accounts.optout_footer_text`). Follow-ups: opção por follow-up, desligada por padrão.

### ④ Taxa de resposta por número de disparo
- Por número de disparo, janela móvel de 7 dias: **leads que responderam em até 24h** ÷ **leads que receberam envio automático**. Mínimo de 20 leads para calcular.
- Abaixo de 10% (valor editável por conta) → alerta em `analyst_alerts` ("Pouca gente está respondendo o número X — risco de bloqueio") e selo amarelo no card do número em Integrações.
- Só avisa; não pausa sozinho.

### ⑤ Dica "termine com uma pergunta"
Nos editores de disparo e de passo de follow-up: se o texto não tem `?`, aparece a dica "Mensagens que terminam com uma pergunta recebem mais respostas — e isso protege o número". Não bloqueia.

### ⑥ Follow-ups sem mensagem repetida
Ao salvar um passo de follow-up: exige **2 ou mais variações** ou uma variável do lead (`{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{cidade}}`). Passos antigos que não cumprem continuam enviando, mas aparecem com o aviso "Mensagem igual para todos — adicione uma variação ou {{nome}}".

### ⑦ Intervalo variável entre envios automáticos
- "Catraca" por número de disparo (`server/services/whatsapp/sendPacer.js`): entre dois follow-ups enviados pelo mesmo número, espera um tempo sorteado entre **5 e 20 segundos**.
- `processFollowUps` (scheduler) deixa de disparar os até 50 follow-ups em paralelo: passam pela catraca, um de cada vez por número.
- Disparos em massa mantêm o intervalo próprio (mínimo de 8s + sorteio de até 30%), que já cumpre a regra.
- Respostas do agente de IA e mensagens de ausência não passam pela catraca: são respostas a quem escreveu e já têm o "digitando".

## 11. Telas que mudam

- **Disparos:** some o seletor "Número de saída"; aparece "Sai por: {número padrão}" ou a faixa de aviso. Rodapé SAIR visível na prévia. Dica ⑤.
- **Cadências e Follow-ups (aba Automáticas):** some o seletor de número; faixa de aviso; validação ⑥; dica ⑤; opção do rodapé.
- **Integrações:** selo "Leitura" ou "Disparo" em cada número; selo "Padrão de disparos" e botão "Tornar padrão"; selo de engajamento ④.
- **Agente de IA:** lista de números só com os de disparo (seção 6).
- **Mensagens automáticas do número:** desabilitado em número de leitura.
- **Configurações da conta:** texto do rodapé SAIR, texto da confirmação de descadastro, limite da taxa de resposta.

## 12. Testes

Com `better-sqlite3 :memory:`, no padrão dos testes de hoje:
- `numberRole`: evolution/vazio/desconhecido → leitura; uzapi/cloud_api → disparo.
- `resolveSendInstance`: manual → número da conversa; automático → padrão; padrão desconectado ou de leitura → `no_send_number`.
- Número padrão: primeiro número de disparo conectado vira padrão; remover o padrão promove outro ou deixa NULL.
- Trava: automático com lead em número de leitura é recusado; manual passa; sem lead passa.
- Cada caminho da tabela da seção 5 usa o escolhedor; follow-up e disparo pausam com `no_send_number` e retomam ao conectar.
- Agente e ausência não rodam em número de leitura.
- Passagem ao vendedor: número do vendedor na Evolution → cria tarefa e não envia; número do vendedor de disparo → envia como hoje.
- Conta com um número só: só Evolution → automáticos desligados (`no_send_number`); só UzAPI → o número é padrão e faz manual + automático.
- ① ② ③ ④ ⑥ ⑦: um teste por regra (palavras de saída e falsos positivos; cálculo da taxa com e sem mínimo; catraca com sorteio injetado).

## 13. Riscos e implantação

- **Contas só com Evolution param de mandar automático.** Ao implantar num servidor com clientes que só têm Evolution (hoje: 24 números), follow-ups, disparos, agente e ausência param até a conta conectar um número de disparo. Por isso este projeto vai para o **servidor novo** (que nasce com a UzAPI). Implantar no servidor atual só depois que cada conta tiver número de disparo, ou com decisão explícita do dono.
- **Agente de IA sai do número do vendedor.** Clientes que hoje usam o agente no número Evolution precisam ligar o agente a um número de disparo.
- A taxa de resposta ④ é uma aproximação (o WhatsApp não publica a métrica real); o limite de 10% é ponto de partida e fica editável.

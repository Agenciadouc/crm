# Provedor UzAPI — Desenho

Data: 21/09/2026 · Branch: `feat/provedor-uzapi` (a partir de `feat/copiloto-agente-ia`, `beaf7ea`)
Base: spec `2026-09-15-provedor-whatsapp-design.md` (a "tomada" `server/services/whatsapp/`, Fase 1 já pronta) e os achados do teste real em `uzapi-achados-etapa0.md`.

## 1. Objetivo

Permitir que um número de WhatsApp do CRM use a **UzAPI** como provedor, com **tudo feito pelo CRM**: criar o número, mostrar o QR, receber e enviar mensagens, desconectar, reiniciar e excluir. A UzAPI é oferecida como "UzAPI (estável)" ao lado da Evolution, **escolhida por número**. Os números atuais continuam na Evolution.

## 2. Decisões do dono (21/09/2026)

1. **Tudo pelo CRM.** O cliente não entra no painel da UzAPI.
2. **Conta única da Dros na UzAPI.** O CRM cria os números de todos os clientes nessa conta. A cobrança por número conectado virá depois; agora é teste, mas o CRM **já registra** provedor, data de conexão e data de exclusão de cada número.
3. **Escolha por número.** Nada muda para os números da Evolution.
4. Caminho aprovado: a UzAPI entra pela **mesma tomada**, com uma peça de leitura **"formato Meta"** reaproveitável pela API Oficial (Fase 3 do spec de provedores).

## 3. O que a UzAPI é (resumo dos achados)

- Imita o formato da **Cloud API da Meta** (envio `/{versão}/{phone_number_id}/messages`, avisos `object/entry/changes/value`), mas por baixo é WhatsApp Web não oficial (whatsmeow). **Não** tem nada em comum com a Evolution.
- URL base: `https://api.uzapi.com.br/{username}/v1/...`. Autenticação `Authorization: Bearer`:
  - **token da conta** ("Token da API", em Meu Perfil) → `POST /instance/add`;
  - **token da instância** (JWT) → rotas do número. O `exp` do JWT é de 60 s, mas a UzAPI **não o verifica** (continua aceito).
- Confirmado com número real (21/09): recebidas vêm com o telefone real em `from`; o envio responde `201 {status:"success", queueId, messageId:"3EB…"}` e o aviso de status chega com `statuses[].id = messageId`; mídia recebida vem só com `id`; o áudio enviado por link chega **como mensagem de voz**.
- **Falhas de segurança da UzAPI** (tratadas no desenho): `GET /{user}/v1/{pnid}/instance` responde **sem autenticação** e devolve o token da instância; o `url` da mídia baixa **sem autenticação**; os avisos **não têm assinatura**.

## 4. Arquitetura

### 4.1 Peças novas em `server/services/whatsapp/`

```
metaFormat.js        → leitura do aviso no formato Meta (puro, sem rede): mensagens, statuses, connection
uzapi.js             → adaptador UzAPI (createUzapiAdapter({ fetch })): envio, mídia, sessão
uzapiClient.js       → chamadas HTTP à UzAPI (URL base, Bearer, tempo limite, erros)
providerConfig.js    → ler/gravar provider_config com segredos criptografados (WA_ENC_KEY, crypto nativo, AES-256-GCM)
```

`index.js` registra `['uzapi', uzapiAdapter]`. `schema.js` passa a listar `'uzapi'` em `WHATSAPP_PROVIDERS`.

### 4.2 Interface do adaptador UzAPI

Segue a interface existente (`evolution.js`). Métodos e comportamento:

| Método | Comportamento |
|---|---|
| `capabilities` | `{ qr:true, presence:false, readReceipts:false, numberCheck:false, templates:false, window24h:false, polling:false, typingDelay:true }` |
| `sendText(instance, phone, text, opts?)` | `POST …/messages {to, type:'text', text:{body}, delayTyping?}` → `{ok, messageId, raw}`; nunca lança |
| `sendMedia(instance, phone, {type, base64, url, mimetype, fileName, caption})` | sobe o arquivo em `POST …/media` (multipart) e envia por `{id}`; se a subida falhar ou não devolver `id`, envia por `{link}` de uma URL temporária assinada do próprio CRM (ver 4.5). Áudio: `type:'audio'` (chega como voz) |
| `fetchMedia(instance, message)` | `GET /{user}/v1/{mediaId}` → `{url, mime_type}` → baixa `url` → `{buffer, mimetype}`. O `mediaId` sai de `message.media_url` (o `mediaRef` gravado na chegada); lança `code='media_not_found'` |
| `parseWebhook(instance, body, headers)` | usa `metaFormat.parse(body)`; confere `metadata.phone_number_id` = o do número; devolve `{messages, statuses, connection?, echoes?}` |
| `fetchMessageById(instance, messageId)` | `POST …/chats {type:'chats', action:'get', chats:{message_id}}` → mensagem normalizada com `fromMe:true` (usado para as respostas dadas pelo celular) |
| `createInstance({name, webhookUrl})` | `POST /{user}/v1/instance/add` com o **token da conta**, `authenticationMethod:'QRCode'`, `webhook`, `webhookEvents {authentication, connection, message_status: true; group_messages, group_events, history: false}` |
| `getQr(instance)` | ver 4.4 |
| `status(instance)` | `GET …/instance` → `deploymentStatus`/`isAuthenticated` → `connected`/`connecting`/`disconnected`; também devolve `phoneNumber` |
| `registerWebhook(instance, url)` | `PUT …/instance/update` mantendo os demais campos lidos em `status` |
| `disconnect / restart / remove` | `POST …/instance/logout`, `POST …/instance/restart`, `DELETE …/instance/delete` |

`fetchMedia` também é chamado pelo `deepgramClient.js` só com `{wa_msg_id}`: essa chamada passa a mandar a linha inteira da mensagem (com `media_url`), sem mudar o comportamento da Evolution.

### 4.3 Recebimento (`metaFormat.js` + fluxo existente)

- Percorre **todos** os `entry[] → changes[] → value`.
- `field:'messages'` com `messages[]` → `NormalizedMessage`:
  - `phone` = `from` (dígitos, normalizado por `normalize.js`); `remoteId` = `from@s.whatsapp.net`; `fromMe:false`; `messageId` = `id`; `pushName` = `contacts[].profile.name` do mesmo `wa_id`; `timestamp` = `timestamp` (segundos em texto) → ISO.
  - `type`/`text`/`mediaRef`: text → `text.body`; image/video/document → `caption`, `mediaRef = <tipo>.id`, `fileName` do documento; audio → `mediaRef = audio.id`; sticker; location (texto com lat/long/nome); contacts; reaction → `type:'reaction'`; `button_reply`/`list_reply` → `type:'text'` com o `title`. O resto → `unknown`.
  - `isGroup:true` ou `from` com `@g.us`/`broadcast` → descartado (como na Evolution).
- `statuses[]` → `NormalizedStatus {messageId:id, status, timestamp}`; `played` vira `read`; `deleted` e `failed` passam como estão, se o `handleStatusUpdate` já os aceitar, senão são ignorados.
  - Status com `recipient_id` preenchido e `id` igual a uma mensagem **recebida** é a leitura feita pelo próprio número → ignorado (o `handleStatusUpdate` só casa com mensagens que o CRM enviou; conferir e cobrir por teste).
- **Resposta dada pelo celular (eco):** se um status chega com um `id` que **não existe** em `messages` da conta e `recipient_id` vazio, o fluxo chama `fetchMessageById` e grava a mensagem como `fromMe:true` no lead de telefone `contacts[0].wa_id` (a busca devolve o chat como `@lid`, por isso o telefone vem do status). Deduplicado pelo `wa_msg_id`. Falha na busca → log, sem erro para a UzAPI.
- `field:'connection'` → `value.status[0].connection`: `connected` → `status='connected'`, limpa `qr_code`, grava `connected_at` se vazio; `desconnected` (grafia da UzAPI) → `status='disconnected'`.
- A rota continua `POST /api/webhooks/whatsapp/:instanceToken` (já por provedor). Responde **200** mesmo em erro interno, para a UzAPI não reenviar em laço.

### 4.4 QR code

A documentação não mostra como o QR chega. Ordem de tentativa, a confirmar com a conta ativa (ver 9):
1. Aviso `authentication` no webhook (evento ligado na criação) → o `metaFormat` reconhece o campo do QR e grava em `qr_code` com `status='connecting'`.
2. Campo de QR na resposta de `GET …/instance` ou de `POST /instance/add`.
3. **Plano B:** sem QR pela API, a tela mostra o botão **"Abrir QR no painel da UzAPI"**, e o status continua sendo atualizado pelo aviso `connection`.

A tela já mostra `qr_code` como imagem base64 ou data URL (`Integrations.tsx`); se a UzAPI mandar o QR como texto, o CRM gera a imagem com a biblioteca de QR já usada no front, ou com uma nova, se não houver.

### 4.5 Envio

- `sendViaInstance` / `sendMediaViaInstance` continuam com **todas** as checagens anti-bloqueio. Pré-checagem de número e "digitando" separados são pulados porque `numberCheck`/`presence` são `false`.
- **Digitando:** com `capabilities.typingDelay`, o agente de IA (modos Automático e SDR) manda `delayTyping` = 1 s a cada 20 caracteres, entre 1 e 15 s.
- **URL temporária de mídia (reserva de 4.2):** rota pública `GET /api/media-temp/:token` que serve o arquivo por no máximo 10 minutos e depois o apaga; o token é aleatório (32 hex). Só é usada se a subida para a UzAPI falhar.
- O retorno para os chamadores continua `{ok, wamsgId, reason}`.
- Produção roda Node 16: a subida multipart usa o que já existe no projeto (`node-fetch` + `form-data`, se já for dependência); se exigir dependência nova, a subida fica de fora e vale só a URL temporária.

### 4.6 Gestão do número (rotas de `integrations.js`)

As rotas passam a perguntar o provedor do número:
- `POST /whatsapp` recebe `provider` (`'evolution'` padrão | `'uzapi'`). Para `uzapi`: exige as credenciais da Dros no `.env`; gera o `webhook_token`; chama `createInstance` com a URL do webhook do número; grava a linha com `provider='uzapi'`, `instance_name` = nome dado pelo cliente, `api_url=''`, `api_key=''` e `provider_config` = `{ phoneNumberId, instanceToken (criptografado), uzapiInstanceId }`; aquecimento de 3 dias como hoje.
- `connect`, `qrcode`, `status`, `disconnect`, `restart`, `test` e `DELETE` chamam o método do adaptador quando `provider='uzapi'`; o código da Evolution fica como está.
- `DELETE` de um número UzAPI chama `remove` na UzAPI (best-effort, 8 s) e grava `removed_at` antes de apagar a linha, em `whatsapp_connection_log` (ver 6).
- A lista de números (`GET /whatsapp`) **nunca** devolve `provider_config`; devolve só `provider`.
- `GET /whatsapp/providers` → lista dos provedores disponíveis (UzAPI só aparece se `UZAPI_USERNAME` e `UZAPI_ACCOUNT_TOKEN` estiverem no `.env`).

### 4.7 Rotinas automáticas

- `detectGhostInstancesAndRestart`, `dailyInstanceHealthCheck` e `admin.js /instances/check-all` passam a filtrar `provider='evolution'`.
- Nova checagem de hora em hora para `provider='uzapi'`: `status()` e, se diferente, corrige só `status`/`phone_number` (sem reiniciar, sem QR).
- `cleanupStaleQRCodes` não limpa QR de número UzAPI em estado `connecting` antes de 5 minutos.

## 5. Telas

- **Integrações > WhatsApp > Conectar número:** escolha "UzAPI (estável)" / "Evolution" (só aparece a escolha se a UzAPI estiver configurada), nome do número, **Conectar**. O QR aparece no mesmo painel de hoje; o plano B troca o QR pelo botão "Abrir QR no painel da UzAPI".
- Card de cada número: selo com o provedor. O card "Configuração Evolution API" e o estado vazio "Configure a Evolution API acima" só aparecem quando o provedor escolhido for Evolution.
- `WhatsAppInstance` (`api.ts`) ganha `provider`.
- Todos os textos em PT-BR com acentos.

## 6. Dados

| Onde | Mudança |
|---|---|
| `.env` | `UZAPI_BASE_URL` (padrão `https://api.uzapi.com.br`), `UZAPI_USERNAME`, `UZAPI_ACCOUNT_TOKEN`, `WA_ENC_KEY` (32 bytes em hex; sem ela, não dá para criar número UzAPI) |
| `whatsapp_instances` | usa `provider='uzapi'` e `provider_config`; nova coluna `connected_at TEXT` |
| `whatsapp_connection_log` (nova) | `id, account_id, instance_id, provider, event ('created'\|'connected'\|'disconnected'\|'removed'), created_at` — base da cobrança futura |
| `media_temp` (nova) | `token, file_path, mimetype, expires_at` — só para a reserva do envio de mídia |

## 7. Erros

- UzAPI fora do ar ou 5xx no envio → `{ok:false, reason:'provider_error'}`, igual ao tratamento atual de falha da Evolution.
- 401 da UzAPI → `reason:'provider_auth'` e log de alerta (token revogado).
- Criação de número sem as credenciais ou sem `WA_ENC_KEY` → 400 com mensagem clara em PT-BR.
- Aviso com `phone_number_id` diferente do número do token → descartado com log.
- Aviso com JSON inválido → 200 e log.

## 8. Testes

`node --test` com os avisos **reais** capturados em 21/09 (números mascarados), guardados em `test/fixtures/uzapi/`:
- `metaFormat`: texto, áudio, foto, documento, status delivered/read (dos dois tipos), connection connected/desconnected, lote com vários `entry`, grupo descartado, tipos desconhecidos.
- Adaptador: montagem das requisições de envio (texto, mídia por id, mídia por link, `delayTyping`), resposta 201 → `messageId`, erros 401/5xx, `fetchMedia` em duas etapas, `fetchMessageById` (eco), `createInstance`.
- Eco: status desconhecido gera mensagem `fromMe` no lead certo, sem duplicar.
- Rotas: criação com e sem credenciais, `provider_config` nunca exposto, token de webhook de outro número recusado.
- Rotinas: GhostDetect/checagem diária ignoram UzAPI.
- `providerConfig`: cifra e decifra; sem chave → erro.
- **Regressão:** os 356 testes atuais continuam passando.

## 9. Pendências a confirmar com a conta UzAPI ativa

1. Como o QR chega (4.4). Precisa do **token da conta** (Meu Perfil > Token da API); o teste grátis termina em 22/09/2026.
2. Se `POST …/media` devolve um `id` usável no envio (senão fica a URL temporária).
3. O formato do aviso `authentication`.

A construção começa pelas partes já confirmadas (4.2 a 4.3, envio); o QR fica atrás de uma verificação na hora da execução.

## 10. Fases da construção

1. `metaFormat` + adaptador UzAPI (receber e enviar) + eco das respostas pelo celular.
2. Criar/conectar/desconectar/excluir pelo CRM + registro de conexões + `providerConfig` criptografado.
3. Tela de Integrações com a escolha do provedor.
4. Proteções das rotinas automáticas + checagem de hora em hora.

Sem push nem deploy; commits locais em português; nunca commitar `dist/` nem `package-lock.json`.

## 11. Fora desta versão

Cobrança por número; grupos; botões e listas enviados pelo CRM; marcar como lida (a UzAPI não tem); migração de números da Evolution; API Oficial da Meta (o `metaFormat` fica pronto para ela).

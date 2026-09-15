# Provedor de WhatsApp por número — Desenho

Data: 15/09/2026 · Base: produção (`origin/main` de 13/09/2026) · Projeto em paralelo com o Copiloto (`2026-09-15-copiloto-agente-ia-design.md`)

## 1. Objetivo

Permitir que **cada número de WhatsApp** do CRM use o provedor que o cliente escolher: **Evolution** (atual), **API Oficial da Meta (Cloud API)** ou **qualquer API de terceiros**, configurada sem programar. Com isso:
- melhorar a entrega dos disparos;
- tirar a conexão do WhatsApp do servidor da Dros, protegendo o IP;
- oferecer a API Oficial para disparo em massa sem ban.

De quebra, corrigir as falhas de segurança do webhook atual e deixar as telas de configuração mais simples.

## 2. Princípios

1. **Evolution continua sendo o padrão.** No deploy, nada muda para nenhum cliente.
2. **Uma "tomada" só.** Todo envio, recebimento, mídia e checagem de número passa por uma interface única; cada provedor é um adaptador.
3. **Regras de negócio e anti-ban valem para todos os provedores.** Elas ficam antes da tomada.
4. **API de terceiros sem código:** configurada na tela, com captura de exemplo e clique para mapear campos.
5. **Menos campos, agrupados por assunto.**

## 3. Situação atual (mapeamento de 15/09/2026)

- Não existe abstração: cada chamada monta `${inst.api_url}/<rota>/${inst.instance_name}` com o header `apikey`.
- **Envio de texto:** `sendViaInstance` (`server/services/leadHandoff.js:381`), com anti-ban em sequência: pausa → horário comercial → cap por lead → saúde → pre-flight do número → quota/warm-up → digitando → `sendText`. Chamado pelo Chat, broadcasts, follow-ups, auto-mensagens, IA e handoff.
- **Envio de mídia:** direto em `server/routes/messages.js:200` (`sendWhatsAppAudio` / `sendMedia`), **sem anti-ban**.
- **Recebimento:** `POST /api/webhooks/evolution/:accountSlug` (`server/routes/webhooks.js:171`). O parse (`:227-416`) é formato Baileys; **a regra de negócio depois do parse (`:422-708`) não depende do provedor**.
- **Polling duplicado:** `pollMissedMessages` (`server/scheduler.js:151`), com lógica diferente do webhook.
- **Mídia/transcrição:** `getBase64FromMediaMessage` (`server/routes/messages.js:181`, `server/services/deepgramClient.js:78`).
- **Gestão de instância:** criar/QR/status/logout/delete/restart em `server/routes/integrations.js`; health, auto-reconnect, reregistro de webhook e GhostDetect em `server/scheduler.js`.

**Falhas encontradas:**
1. 🔴 `webhook_secret` nunca é gravado, então **não há validação de origem** do webhook; e, se o nome da instância não bate, a mensagem cai na **primeira instância da conta** (`webhooks.js:182-188`).
2. Domínio `https://drosagencia.com.br/crm` fixo (`integrations.js:68,394`, `scheduler.js:319`, `Integrations.tsx:790,838`).
3. Download de mídia usa `lead.instance_id` em vez de `message.instance_id` (`messages.js:175-178`).
4. `markMessageAsRead` lê `wa_remote_jid` de `messages`, coluna que não existe (`leadHandoff.js:137`); nunca funcionou.
5. Só `MESSAGES_UPSERT` é assinado no webhook; status de entrega (base do GhostDetect e da auto-pausa) depende de configuração global da Evolution.
6. Cap por lead: fallback 5 no código × default 50 no banco (`leadHandoff.js:84`, `db.js:353`).
7. Health global usa `process.env.EVOLUTION_API_URL` em vez da URL da instância (`scheduler.js:21`).

## 4. Arquitetura

### 4.1 A tomada: `server/services/whatsapp/`

```
whatsapp/
  index.js        → getProvider(instance): escolhe o adaptador por instance.provider
  evolution.js    → adaptador Evolution (move o código atual, sem mudar comportamento)
  cloudApi.js     → adaptador API Oficial da Meta
  customHttp.js   → adaptador genérico configurável
  normalize.js    → normalização de telefone BR (hoje duplicada em 5 lugares)
```

Interface que todo adaptador implementa (métodos opcionais marcados com `?`):

| Método | Retorno |
|---|---|
| `sendText(instance, phone, text)` | `{ ok, messageId, reason?, raw? }` |
| `sendMedia(instance, phone, { type, base64 \| url, mimetype, fileName, caption })` | idem |
| `checkNumber?(instance, phones[])` | `{ [phone]: true \| false \| null }` |
| `markRead?(instance, lead, messageId)` | `{ ok }` |
| `sendPresence?(instance, phone, state)` | `{ ok }` |
| `fetchMedia(instance, message)` | `{ buffer, mimetype }` |
| `parseWebhook(instance, body, headers)` | `{ messages: NormalizedMessage[], statuses: NormalizedStatus[] }` |
| `connect? / status? / disconnect? / restart? / remove?` | gestão de sessão (só Evolution) |
| `capabilities` | `{ qr, presence, readReceipts, numberCheck, templates, window24h, polling }` |

`NormalizedMessage`: `{ phone, remoteId, fromMe, messageId, pushName, timestamp, type ('text'|'image'|'audio'|'video'|'document'|'sticker'|'location'|'contact'|'reaction'|'unknown'), text, mediaRef, adReferral? }`

`NormalizedStatus`: `{ messageId, status ('sent'|'delivered'|'read'|'failed'), timestamp }`

### 4.2 Envio

- `sendViaInstance` mantém **todas as checagens de anti-ban** e troca só o último passo (`sendText` da Evolution) por `getProvider(instance).sendText(...)`. Pre-flight e "digitando" só rodam se o provedor tiver `numberCheck` / `presence`.
- Novo `sendMediaViaInstance` com as **mesmas checagens**; `messages.js:200` passa a usá-lo (corrige o envio de mídia sem anti-ban).
- O retorno continua `{ ok, wamsgId, reason }` para os chamadores atuais não mudarem.

### 4.3 Recebimento

- **Nova rota por número:** `POST /api/webhooks/whatsapp/:instanceToken`.
  - `instanceToken` = token aleatório de 32 caracteres por instância (`whatsapp_instances.webhook_token`), que identifica a instância **sem cair em fallback**.
  - Validação por provedor: API Oficial = assinatura `X-Hub-Signature-256` com o App Secret + `GET` de verificação (`hub.challenge`); API de terceiros = header ou campo secreto opcional configurado; Evolution = token na URL.
- Fluxo: `parseWebhook` → para cada mensagem, **`handleInboundMessage(account, instance, normalized)`** (a regra de negócio de `webhooks.js:422-708`, extraída para `server/services/inboundHandler.js`) → para cada status, `handleStatusUpdate` (lógica de `webhooks.js:197-225`).
- A rota antiga `/evolution/:accountSlug` continua funcionando (instâncias existentes), mas passa a usar o mesmo `parseWebhook` + `handleInboundMessage`, **sem o fallback para a primeira instância**. Instâncias existentes são migradas para a URL nova no reregistro automático do webhook.
- O polling (`pollMissedMessages`) só roda para provedores com `capabilities.polling` (Evolution) e passa a usar o mesmo `handleInboundMessage` (corrige a divergência).

### 4.4 Adaptador "API de terceiros" (genérico)

Configuração guardada em `whatsapp_instances.provider_config` (JSON, com segredos criptografados):

**Envio**
- Método e URL (aceita `{{phone}}`), headers (aceita a chave), corpo em JSON com campos variáveis: `{{phone}}`, `{{text}}`, `{{media_url}}`, `{{media_base64}}`, `{{mimetype}}`, `{{file_name}}`, `{{caption}}`.
- Um modelo de corpo para texto e outro para mídia (opcional).
- Onde está o ID da mensagem na resposta (caminho, ex.: `data.messageId`) e como saber que deu certo (status HTTP 2xx + caminho opcional).
- Formato do telefone: `5511999999999`, `+5511999999999` ou `5511999999999@s.whatsapp.net`.

**Recebimento — "Capturar exemplo"**
1. O CRM mostra o link do webhook exclusivo do número; o usuário cola no painel do provedor.
2. Clica em **Capturar exemplo** e manda uma mensagem de teste para o número.
3. O CRM mostra o conteúdo recebido em árvore e o usuário **clica** no campo de cada item: telefone, texto, ID da mensagem, "enviada por mim", nome, tipo, link/ID da mídia, e (opcional) o campo e os valores de status de entrega.
4. O CRM grava os caminhos e mostra a mensagem de teste já interpretada para confirmar.

**Mídia recebida:** se o provedor manda link público, o CRM baixa pelo link; se manda só ID, configura-se uma URL de download com `{{media_id}}`.

**Botão Testar:** envia uma mensagem para um número informado e mostra a resposta.

### 4.5 Adaptador "API Oficial da Meta"

- Usa o **App Meta único da Dros** (decisão de 24/06/2026). Configuração por número: `phone_number_id`, `waba_id`, token de acesso (criptografado); `App Secret` e `verify token` ficam no `/root/.env`.
- Envio: `POST https://graph.facebook.com/<versão>/<phone_number_id>/messages` (texto, mídia por upload ou link, template).
- Recebimento: webhook da Meta (`messages` e `statuses`) no mesmo `POST /api/webhooks/whatsapp/:instanceToken`.
- **Janela de 24h:** `leads.last_inbound_at` (já existe) define se a janela está aberta. Fora da janela, texto livre é **bloqueado antes de enviar**:
  - Chat: a caixa avisa "janela fechada — use um template" e lista os templates aprovados.
  - Follow-up, broadcast, auto-mensagem e IA: só enviam se o passo tiver template associado; senão, o envio é segurado e o motivo aparece (`reason = 'window_closed'`).
- **Templates:** tabela `wa_templates` sincronizada da Meta (nome, idioma, categoria, status, variáveis). Criação e aprovação dos templates são feitas no Gerenciador da Meta nesta versão.
- Sem QR, sem "digitando", sem pre-flight de número, sem polling. Recibo de leitura via `markRead` oficial.
- Mídia recebida: baixada pelo `media_id` com o token.

### 4.6 Evolution

O adaptador `evolution.js` recebe o código atual **sem mudar comportamento**, com as correções:
- webhook com token por instância e eventos `MESSAGES_UPSERT` + `MESSAGES_UPDATE` assinados;
- `markRead` usando `leads.wa_remote_jid`;
- health por instância usando `instance.api_url`;
- QR, conectar, status, logout, delete, restart e GhostDetect continuam iguais, só chamados pela interface.

### 4.7 Correções gerais

- Domínio público em env: `PUBLIC_BASE_URL` (default `https://drosagencia.com.br/crm`), usado no backend e exposto ao front por `/api/integrations/public-config`.
- Download de mídia pela `message.instance_id` (com fallback para `lead.instance_id` em mensagens antigas sem instância).
- Cap por lead: um único default (50) no código e no banco.

## 5. Telas (agrupadas)

### 5.1 Integrações — 4 cards

| Card | Conteúdo |
|---|---|
| **WhatsApp** | Lista de números. Cada número: nome, telefone, status, **provedor**, "leads novos vão para", modo de recebimento, mensagens automáticas (saudação/ausência), e **Configurar** (abre a configuração do provedor: QR para Evolution; campos Meta para Oficial; envio + captura de exemplo para terceiros). Credenciais da Evolution da conta ficam dentro deste card, recolhidas. |
| **Entrada de leads** | Roteamento de formulários (número padrão + regras por tag) e Google Planilhas. |
| **Meta** | Pixel / Conversions API e status da conexão do App Meta (usado pela API Oficial). |
| **IA** | Chave de IA da conta e origem da chave (cliente / Dros), ligada ao Copiloto. |

### 5.2 Editor do Agente de IA — de 8 abas para 4

| Aba | Junta |
|---|---|
| **Geral** | Identidade + Quando atuar + "Como a IA atua" (Automático / Copiloto / SDR) + liga/desliga |
| **Perfil** | Montar com entrevista + Treinamento (tom, base, nunca mencionar) + Qualificação (critérios, campos obrigatórios) |
| **Atendimento** | Passagem para humano + Áudio + Follow-up por etapa |
| **Resultados** | Custo do mês + Sugestões de melhoria + Simulador |

### 5.3 Duplicidades removidas

- **Follow-up de inatividade:** existe na página Follow-ups e na aba do agente, sobre a mesma tabela. Fica **um lugar**: a aba Atendimento do agente para follow-up do agente; a página Follow-ups segue só para sequências manuais.
- **"Primeira mensagem":** hoje há 4 (`first_msg_template` da instância, `funnels.first_msg_template`, saudação da auto-mensagem e boas-vindas do agente). Na tela passam a ser **um campo por número** ("Primeira mensagem"), com a regra de prioridade explicada ao lado; os campos antigos continuam lidos para não quebrar nada.
- **Agendas:** `business_hours_json` (anti-ban, sem tela) e `away_schedule_json` (ausência) viram **um horário de atendimento por número**, usado pelos dois.

## 6. Dados

| Onde | Mudança |
|---|---|
| `whatsapp_instances` | `provider TEXT NOT NULL DEFAULT 'evolution'` (`evolution`/`cloud_api`/`custom`); `provider_config TEXT` (JSON, segredos criptografados com `WA_ENC_KEY` do `.env`); `webhook_token TEXT` (preenchido para todas no boot); `api_url`/`api_key` continuam obrigatórios no schema e recebem `''` para provedores que não usam |
| **nova** `wa_templates` | `id, account_id, instance_id, name, language, category, status, components_json, synced_at` |
| `messages` | sem mudança (`wa_msg_id` guarda o ID do provedor; `instance_id` já existe) |

Tudo com `addColumnIfNotExists` / `CREATE TABLE IF NOT EXISTS`, seguindo o padrão atual.

## 7. Erros

- **Provedor fora do ar ou erro HTTP:** `reason` com o código; conta para a auto-pausa por taxa de entrega, como hoje.
- **Webhook com token inválido ou assinatura errada:** 401, nada gravado, registrado no log.
- **Mapeamento incompleto (terceiros):** o número não pode ser ativado até telefone, texto, ID e "enviada por mim" estarem mapeados.
- **Janela de 24h fechada (Oficial):** envio segurado com `window_closed`, visível no Chat e nos relatórios de follow-up/broadcast.
- **Troca de provedor num número:** exige confirmação; pausa o número, reconfigura, testa e só então reativa.

## 8. Testes

- `node:test` para: `parseWebhook` de cada adaptador com payloads reais (Evolution: texto, áudio, imagem, reação, anúncio CTWA, `@lid`; Meta: mensagem, status, mídia; terceiros: mapeamento por caminho); `sendText`/`sendMedia` montando a requisição certa; template de corpo do adaptador genérico; validação de assinatura da Meta; token por instância; `handleInboundMessage` com mensagem normalizada (regressão do fluxo atual); regra da janela de 24h; `sendViaInstance` com checagens por `capabilities`.
- **Regressão da Evolution:** os mesmos payloads gravados antes e depois precisam gerar os mesmos registros em `leads`/`messages`.

## 9. Fases

| Fase | Entrega | Risco em produção |
|---|---|---|
| **1. Tomada + correções** | `whatsapp/` com adaptador Evolution, `inboundHandler`, webhook por token, validação de origem, domínio em env, mídia pela instância certa, markRead, cap único | Médio (mexe no caminho de todas as mensagens) → regressão com payloads reais e deploy fora do horário comercial |
| **2. API de terceiros** | Adaptador genérico + tela de configuração + Capturar exemplo + Testar | Baixo (opt-in por número) |
| **3. API Oficial** | Adaptador Cloud API + templates + janela de 24h no Chat e nos envios automáticos | Baixo (opt-in por número); depende da verificação do App Meta |
| **4. Telas agrupadas** | Integrações em 4 cards, editor do agente em 4 abas, duplicidades removidas | Baixo (só front, mesmos dados) |

As fases 2, 3 e 4 podem ser feitas em qualquer ordem depois da 1. A aba "Geral" do editor do agente (fase 4) é compartilhada com o Copiloto e deve ser construída uma vez só.

## 10. Riscos

- **Fase 1 mexe no fluxo de todas as mensagens.** Mitigação: extração sem mudar comportamento, testes de regressão com payloads reais, deploy fora do horário comercial e plano de volta (`git checkout` do commit anterior + `pm2 restart`).
- **Node 16 / CentOS 7:** sem dependência nova; criptografia com `crypto` nativo; HTTP com `node-fetch` já usado.
- **API Oficial:** depende de Business Verification + App Review da Meta (gargalo externo, em paralelo).
- **Banimento com API de terceiros:** a conexão sai do servidor da Dros, mas o risco do número continua ligado a volume e denúncias; o anti-ban atual continua valendo.

## 11. Fora desta versão

Criar e aprovar templates dentro do CRM; migrar a Evolution para outro servidor; Instagram/Messenger; cobrança da API Oficial por conversa (ver `motor-custo-whatsapp`).

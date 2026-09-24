# Checklist WhatsApp — Evolution + uzapi + Switch

Rode antes de expor pra novos clientes. Cada seção leva ~5min.

## Antes de começar

- Ter 1 celular disponível com WhatsApp pra escanear QR.
- Ter 1 número de destino diferente pra receber mensagem de teste.
- Terminal SSH na VPS aberto com log rolando:
  ```
  pm2 logs dros-crm --lines 0 | grep -iE "UZAPI-WEBHOOK|Provider|Webhook|flapping"
  ```

## Parte 1 — Evolution (regressão)

Use uma inst existente que já está no Evolution (não precisa criar nova).

- [ ] **Envio de texto**: abrir Chat, escolher um lead, mandar "teste evolution 1". Chega no WhatsApp em <5s?
- [ ] **Recebimento**: responder do WhatsApp. Aparece no CRM em <10s?
- [ ] **Status ✓/✓✓/✓✓azul**: no CRM, esses ícones mudam conforme o destinatário lê?
- [ ] **Mídia**: mandar imagem + PDF do CRM. Chega e abre no WhatsApp?
- [ ] **Áudio**: gravar áudio no CRM. Chega e reproduz?
- [ ] **Reiniciar sessão**: clicar "Reiniciar sessão" na Integrações. Diz "reiniciada"? Depois de 10s a msg ainda vai?

Se **qualquer** item falhar → problema no adapter Evolution. Rollback e diagnóstico antes de continuar.

## Parte 2 — uzapi

Use a inst do "Comercial DROS" (ou outra que já foi migrada pra uzapi).

- [ ] **Status na UI**: mostra "Conectado" (verde) na Integrações?
  - Se mostra "Desconectado" mas o telefone parece conectado, clicar **Verificar**.
  - `Verificar` chama `GET /instance` da uzapi e sincroniza. Deve virar Conectado.
- [ ] **Envio de texto**: mesmo teste da Evolution mas por essa inst uzapi.
- [ ] **Recebimento**: responder. Aparece no CRM?
- [ ] **Status ✓/✓✓/✓✓azul**: bate com o que o destinatário fez?
- [ ] **Mídia + Áudio**: mesmo teste da Evolution.
- [ ] **Reiniciar sessão**: funciona sem quebrar a conexão?

Se envio funciona mas recebimento não → webhook uzapi não está configurado. Rodar:
```
sqlite3 /root/crm/server/data/crm.db "SELECT id, uzapi_session FROM whatsapp_instances WHERE provider='uzapi';"
```
Pegar o `uzapi_session` (phoneNumberId) e conferir na uzapi (painel web) que o webhook está setado pra `https://drosagencia.com.br/crm/api/webhooks/uzapi/{account_slug}`.

## Parte 3 — Switch de provider

Use uma inst de teste (não do cliente ativo!). Se necessário, criar uma nova só pro teste.

- [ ] **Evolution → uzapi**:
  1. Inst está em Evolution + Conectado.
  2. Clicar **⇄ Mudar pra uzapi**. Modal aparece nativo (não confirm do browser).
  3. Confirmar. UI mostra "Conectando..." e depois QR uzapi.
  4. Escanear com celular. Vira Conectado?
  5. Enviar texto de teste. Chega?
- [ ] **uzapi → Evolution** (mesma inst):
  1. Clicar **⇄ Voltar pra Evolution**.
  2. Confirmar. QR Evolution aparece?
  3. Escanear. Vira Conectado?
  4. Enviar texto. Chega?
- [ ] **Histórico do lead preservado**: abrir um lead que teve mensagens antes do switch. Todas as mensagens antigas aparecem?

## Parte 4 — Flags anti-ban

Estas rodam automaticamente, só validar que o comportamento não regrediu:

- [ ] **Warmup**: inst nova (0-3 dias) tem `warmup_until` no BD e envia limitado. Query:
  ```
  sqlite3 /root/crm/server/data/crm.db "SELECT instance_name, provider, warmup_until, hourly_send_limit FROM whatsapp_instances;"
  ```
- [ ] **Quota horária/diária**: leadHandoff respeita cap por inst.
- [ ] **GhostDetect**: se 3+ msgs sem delivered em 15min, dispara restart. (Não force, só valide log de eventos passados.)

## Se algo falhar

**Erro comum 1 — "Access Token inválido" ou 401**  
Token uzapi expirou ou está errado. Chamar `/switch-provider` de novo (recria a inst na uzapi com token novo).

**Erro comum 2 — CRM diz "Desconectado" mas uzapi diz que está conectada**  
Webhook `connection.update` do open não chegou. Clicar botão **Verificar** na UI. Deve sincronizar.

**Erro comum 3 — QR aparece e some**  
Corrigido pela proteção anti-flapping. Se acontecer de novo, ver log `[flapping close ignorado]`. Se não aparecer, webhook está mandando shape que o tradutor não reconhece — checar log `[UZAPI-WEBHOOK IN]` e ajustar `translateUzapiToBaileys` em [server/routes/webhooks.js](server/routes/webhooks.js).

**Erro comum 4 — Switch trava em "conectando"**  
Verificar se `[SwitchProvider uzapi] restart pos-create ok=true` apareceu no log. Se não, o restart falhou — provavelmente token de conta uzapi errado em `UZAPI_ADMIN_TOKEN` no `/root/.env`.

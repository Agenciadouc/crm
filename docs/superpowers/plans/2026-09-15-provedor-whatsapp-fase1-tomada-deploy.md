# Provedor de WhatsApp — Fase 1: Roteiro de homologação e deploy

Data do documento: 16/09/2026 · Plano: `2026-09-15-provedor-whatsapp-fase1-tomada.md` · Spec: `2026-09-15-provedor-whatsapp-design.md`

Este roteiro é para o dono do produto rodar pelo **Terminal do WHM** (`https://drosagencia.com.br:2087`, root, porta 22 fechada). O terminal do WHM corrompe colagem grande e heredoc, então **todo comando abaixo cabe em uma linha só** — copie e cole a linha inteira, sem quebrar.

Servidor: CentOS 7, Node 16.20.2, repo em `/root/crm`, processo PM2 `dros-crm`.

## 0. Verificação local já feita (neste worktree, não no servidor)

Rodada em 16/09/2026 antes de escrever este documento, com `git log --oneline 57f55d9..036326f` mostrando os 13 commits da fase em sequência (não conta o próprio `57f55d9`, que é o primeiro commit da fase), sem arquivos de `dist/` misturados:

- `npm test` → **118/118 passando, 0 falha** (`# tests 118 / # pass 118 / # fail 0`), cobrindo `normalize`, `whatsappSchema`, `publicUrl`, `evolutionParse`, `evolutionTransport`, `sender`, `mediaResolve`, `leadIntake`, `inboundHandler`, `webhookFlow`, `inboundPolling`, `webhookRegistration`.
- `npm run build` → build do Vite concluído sem erro (`✓ built in ~20s`), só o aviso padrão de chunk grande (pré-existente, não é regressão desta fase).
- Varredura de código: nenhuma rota antiga da Evolution (`/message/sendText/`, `/message/sendMedia/`, `/chat/getBase64FromMediaMessage/`, `/chat/markMessageAsRead/`, `/chat/whatsappNumbers/`, `/chat/sendPresence/`, `/chat/findMessages/`, `/webhook/set/`) fora de `server/services/whatsapp/evolution.js`. Domínio fixo só em `server/services/publicUrl.js` (default); o único outro resultado do grep sugerido pelo plano é `server/db.js:385` (`DEFAULT_EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || '...'`), que é a credencial padrão por conta, já existia antes desta fase e não é o bug do fallback de webhook — não precisa de ação.

Isso cobre o Step 1 do plano. Os Steps 2 (regressão manual com Evolution real) e 4-6 (deploy e volta) só fazem sentido no servidor e estão detalhados abaixo.

## 1. Antes de subir

Rodar tudo isto **antes** de mexer no servidor.

**1.1 Confirmar horário fora do comercial** (depois das 21h ou antes das 7h, horário de Brasília). Se não estiver nessa janela, não continue.

**1.2 Ver se o servidor está limpo** (sem mudança manual esquecida que o `git pull` for sobrescrever):

```bash
cd /root/crm && git status --short
```
Esperado: nada impresso (árvore limpa). Se aparecer alguma linha, parar e decidir o que fazer com ela antes de continuar (não descartar sem olhar).

**1.3 Guardar o commit atual do servidor, para o plano de volta:**

```bash
cd /root/crm && git rev-parse HEAD | tee /root/crm-antes-provedor-fase1.txt
```
Esperado: imprime um hash de 40 caracteres, igual ao salvo no arquivo. Se o arquivo já existir de uma tentativa anterior e o hash for diferente do que você espera, confirme manualmente qual é o commit bom antes de seguir — não sobrescreva sem olhar.

**1.4 Checar `PUBLIC_BASE_URL`** — é dela que sai a URL nova do webhook (`<PUBLIC_BASE_URL>/api/webhooks/whatsapp/<token>`); se estiver errada, a Evolution é reconfigurada com uma URL que não bate com o domínio real e para de conseguir entregar:

```bash
grep -n PUBLIC_BASE_URL /root/.env
```
Esperado: ou não aparece nada (nesse caso o código usa o default `https://drosagencia.com.br/crm`, que é o domínio real de produção — está correto e não precisa fazer nada), ou aparece `PUBLIC_BASE_URL=https://drosagencia.com.br/crm` (mesmo valor). Só mexer se o domínio de produção for outro; nesse caso, uma linha:

```bash
echo "PUBLIC_BASE_URL=https://SEU-DOMINIO-REAL/crm" >> /root/.env
```

**1.5 Ver quantas instâncias estão conectadas agora**, para saber quantas checar depois: abra a tela **Integrações** do CRM (no navegador, não no terminal) e anote os números que aparecem como conectados. São esses que você vai conferir no passo 3.

## 2. Subir

Tem mudança de front (o front chama `/api/integrations/public-config` e mostra o botão "Webhook" por instância), então é o **comando 3** do CLAUDE.md — inclui `npm install` e `npm run build`. Adicionei `npm test` antes do build, como trava: se a suíte falhar no Node 16 do servidor, não seguir para build/restart.

```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git pull && npm install && npm test && npm run build && pm2 restart dros-crm
```

**Resultado esperado:** `git pull` traz os 14 commits novos; `npm install` sem erro de compilação nativa (better-sqlite3); `npm test` termina com `# fail 0` (mesmo total de antes, 118, ou mais caso hajam outros testes fora desta fase); `npm run build` termina com `✓ built`; `pm2 restart dros-crm` mostra o processo `online`.

**Como saber que falhou:** qualquer uma dessas etapas encerra a cadeia (por causa do `&&`) e as seguintes não rodam — `pm2 restart` não vai executar. Rode `pm2 status dros-crm` para confirmar se reiniciou ou não. Se `npm test` for a etapa que falhou, o comando já parou sozinho **antes do build e do restart** — o processo em produção continua rodando o código antigo. Vá direto para a seção 4 (plano de volta) só para reverter o `git pull` (o `pm2 restart` nem chegou a rodar, então tecnicamente não precisa reiniciar nada, mas rode o checkout mesmo assim para não deixar o working tree do servidor num commit que não passou nos testes) e avise que o deploy não foi feito.

## 3. Primeiros minutos (acompanhar por ~15 minutos)

O `pm2 restart` já dispara, na subida, a criação das colunas novas e a geração dos tokens de webhook, e a primeira tentativa de reregistro do webhook roda imediatamente no boot (não espera o próximo ciclo — o ciclo principal do scheduler, que faz o reregistro, roda a cada 1 minuto; `server/scheduler.js:16-17` `INTERVAL_MS = 60 * 1000`, chamado por `tick()` em `scheduler.js:512`).

```bash
pm2 logs dros-crm --lines 300 --nostream | grep -E "Added column whatsapp_instances|webhook_token gerado|Evolution Webhook\] Set|Webhook re-register|Webhook WhatsApp\]|Webhook Evolution\]|Polling.*error|Tipo de mensagem nao tratado"
```

**O que é esperado ver:**
- `[DB] Added column whatsapp_instances.provider`, `.provider_config`, `.webhook_token` — uma vez só, na primeira subida (migração de schema).
- `[db] migration: webhook_token gerado para N instancias` — uma vez só, N = quantidade de instâncias existentes.
- Nenhuma linha `[Webhook re-register] <nome>: <motivo>` — se aparecer, é falha ao reconfigurar o webhook daquela instância no provedor (rede, credencial); ela continua com o webhook antigo e vai depender do polling até ser corrigida.
- **Atenção com o silêncio**: o reregistro automático (o que roda no boot e depois a cada 1 minuto) **não loga sucesso**, só erro. Ou seja, não esperar ver `[Evolution Webhook] Set for ...` sozinho — essa linha só aparece quando alguém clica no botão **"Webhook"** ao lado do número, na tela Integrações (tooltip "Reenvia o webhook pra Evolution..."), ou quando uma instância é conectada/reconectada manualmente. Para ter certeza visível de que uma instância específica já está na URL nova, clique nesse botão para 1-2 números e confira a linha `[Evolution Webhook] Set for <nome> → .../api/webhooks/whatsapp/<token>` no log.
- `[Webhook WhatsApp] 401 Invalid webhook token ip=...` **repetido** para uma instância real → sinal de token errado ou instância não migrada; isolado e não repetindo, ignorar.
- `[Webhook Evolution] 401 Unknown instance account=<slug> instance=<nome>` **isolado**, logo após o deploy, é esperado: é a Evolution ainda mandando pela URL antiga por conta até o reregistro (item acima) trocar para a URL por token daquele número. **Se persistir para a mesma instância depois de 10 minutos, é o sinal real do risco descrito no plano** — a rota antiga não tem mais fallback (antes caía na primeira instância da conta; agora responde 401 e a Evolution **não reentrega**). Nesse caso: abrir Integrações, achar o número, clicar em **"Webhook"** para forçar o reregistro na URL nova; se o problema for o nome da instância não bater mesmo com a tolerância de caixa/espaço, o `instance_name` cadastrado no CRM precisa ser corrigido para bater com o nome real da instância na Evolution.
- Mensagens novas chegando no Chat de **pelo menos 2 contas diferentes** dentro da janela de 15 minutos, com contador de não lidas e ✓✓ atualizando em envios recentes.

**Como saber que falhou de verdade (não só ruído esperado):** `[Webhook Evolution] 401` persistente na mesma instância depois de 10 minutos e sem mensagem nova chegando por ela; ou `[Webhook re-register]` aparecendo em loop a cada 1 minuto para o mesmo número.

## 4. Plano de volta

Use se: `npm test` falhou no servidor (aí é só desfazer o `git pull`, sem precisar reiniciar nada — ver seção 2), ou se depois do restart os leads pararem de entrar, ou 401 persistente sem solução rápida pelo botão "Webhook".

```bash
source /opt/rh/devtoolset-11/enable && cd /root/crm && git checkout $(cat /root/crm-antes-provedor-fase1.txt) && npm install && npm run build && pm2 restart dros-crm
```

**Resultado esperado:** volta para o commit salvo no passo 1.3, reinstala, builda o front antigo e reinicia. `pm2 status dros-crm` mostra `online`.

**Como saber que falhou:** mesma lógica da seção 2 — é uma cadeia de `&&`, então qualquer etapa que falhe (`git checkout`, `npm install`, `npm run build`) interrompe as seguintes e o `pm2 restart` não roda. Rode `pm2 status dros-crm` para confirmar: se o processo não reiniciou (uptime não zerou), **o processo antigo continua rodando o código de antes deste rollback** — ou seja, nem o código novo (que você estava tentando reverter) nem o commit de volta estão de fato no ar. Não tente rodar o comando de novo sozinho: pare e peça ajuda, porque a essa altura já são dois deploys seguidos com problema.

**Depois da volta (quando o `pm2 restart` deu certo):**
- As colunas novas (`provider`, `provider_config`, `webhook_token`) ficam no banco, mas o código antigo não as lê nem as usa — não fazem diferença.
- O reregistro de webhook do código antigo (mesmo ciclo de 1 em 1 minuto do scheduler, que já existia antes desta fase) recoloca a URL antiga (`/api/webhooks/evolution/<slug>`) sozinho; para acelerar, clicar em "Webhook" em cada número.
- Mensagens recebidas durante o intervalo sem webhook certo não se perdem: o polling (a cada 30s) as recupera quando reconecta com a URL/lógica certa.
- **Não precisa reverter o banco.** Nenhuma coluna ou dado desta fase quebra o código antigo.

## 5. Só dá para confirmar com WhatsApp real (não dá para testar sem tráfego de produção)

Local (`npm test`/`npm run dev`) já cobre parsing, regras de negócio e regressão com payloads reais gravados — mas só o tráfego de verdade confirma isto na prática, contra pelo menos 2 contas diferentes:

1. Mensagem de texto de número novo cria lead no funil padrão, aparece no Chat com contador, e dispara a IA quando a conta tem agente configurado.
2. Áudio recebido: o player carrega no Chat; se a IA transcreve, a transcrição aparece no log `[AI Agent] STT`.
3. Imagem com legenda e PDF chegam com a legenda/nome do arquivo certos.
4. Mensagem enviada pelo Chat recebe ✓, e depois ✓✓/lido chega pelo webhook (`MESSAGES_UPDATE`) — é o teste real do `markMessageAsRead` corrigido nesta fase.
5. Envio de imagem pelo Chat para um número sem WhatsApp grava a falha com o aviso (em vez de sumir).
6. Lead de anúncio (mensagem que começa com o padrão de campanha, ex. "P9 ...") fica com a fonte "Facebook Pago"/"Instagram Pago".
7. Integrações → "Sincronizar agora" roda o polling sem erro (log `[Polling] ... all synced`).
8. Integrações → Google Planilhas mostra a URL do webhook com o domínio de `PUBLIC_BASE_URL` (confirma o item 1.4 acima na prática).
9. Um `POST` simulado para `/api/webhooks/evolution/<slug>` com `instance` inexistente responde 401 e não grava nada — só é seguro tentar isso em homologação, não em produção (para não gerar um 401 real que a Evolution não reentrega).
10. **Diferenças de comportamento aceitas nesta fase, para não confundir com bug** ao olhar o Chat/logs nos primeiros dias:
    - Mensagens **editadas**, respostas de **botão/lista** e mensagens **temporárias**, vindas do **polling** (recuperação de mensagens perdidas), agora aparecem — antes eram descartadas silenciosamente.
    - Legenda de **foto/vídeo** recebida pelo polling agora grava a legenda como texto da mensagem, em vez do texto fixo `[Imagem]`.
    - Um log pontual `Tipo de mensagem nao tratado` para um tipo raro (enquete, mensagem de sistema, visualização única) é esperado e não é falha — é o mesmo comportamento de antes para esses tipos.

## Observação sobre um bug pré-existente (não desta fase, não bloqueia este deploy)

Em `server/db.js`, as colunas de `instance_auto_messages` (linhas 543 e a de `greeting_cooldown_hours`) e de `proposals` (linhas 545-546) são adicionadas com `addColumnIfNotExists` **antes** das respectivas `CREATE TABLE IF NOT EXISTS` (linhas 1237 e 1289). Em produção isso não afeta nada porque o banco já existe com essas tabelas — `addColumnIfNotExists` só falha se a tabela ainda não existir (o `ALTER TABLE` dá erro em tabela inexistente; `PRAGMA table_info` numa tabela inexistente não avisa, só devolve vazio). O efeito só aparece **numa restauração do zero** (banco novo, vazio): o boot quebra nessas linhas antes de chegar nos `CREATE TABLE`. Registrando aqui para não se perder — não é para corrigir nesta tarefa, é para entrar na lista de pendências técnicas (junto com as já listadas no plano para as fases 2/3).

## Registro do resultado (preencher depois do deploy)

- Horário do deploy:
- Commit anterior (plano de volta):
- Commit novo:
- Contas/números verificados e status:
- 401 observados (instância, se persistiu, ação tomada):
- Rollback foi necessário? Se sim, por quê:

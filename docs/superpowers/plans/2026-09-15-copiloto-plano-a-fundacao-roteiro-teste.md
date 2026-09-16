# Roteiro de teste do Copiloto — conta Dros (depois do deploy)

> Referente à Task 14 do plano `docs/superpowers/plans/2026-09-15-copiloto-plano-a-fundacao.md`.
> Este roteiro é para você (dono/CEO) executar no CRM real, DEPOIS de subir o deploy (comando 3 do `CLAUDE.md`, porque mudou frontend). Ele não mexe em código — é só um passo a passo de clique.
>
> Ordem: começamos pelo que não tem risco nenhum (só olhar logs e telas), depois testamos o Copiloto (que por definição nunca manda nada sozinho) e só nos últimos passos chegamos perto de algo que manda mensagem sozinha (Automático/SDR). Não pule a ordem.

---

## Avisos importantes — leia antes de mexer em qualquer coisa

### Aviso 1 — o agente que já existe na conta acorda quando a chave for configurada

A conta Dros já tem um agente chamado **"AGENTE IA — OXI QUÍMICA"**, ativo, mas com a base de conhecimento **de outro cliente** (errada para a Dros) e **sem chave Anthropic própria** — por isso hoje ele não responde nada (fica bloqueado).

**O perigo:** assim que uma chave Anthropic for configurada para a conta Dros (a do cliente ou a da Dros), esse robô "acorda". Se nesse momento ele ainda estiver no modo **Automático** (que é o padrão), ele passa a responder sozinho, no WhatsApp real da Dros, com o conteúdo errado (da OXI QUÍMICA) — para qualquer pessoa que mandar mensagem naquele número, inclusive um lead de verdade.

**Regra de ouro deste roteiro:** decida e salve o modo (Copiloto, para este teste) **antes** de configurar qualquer chave. Nunca inverta essa ordem. Os passos abaixo já seguem essa ordem — não pule a Parte 2.

Se em algum momento você perceber que o robô respondeu algo errado sozinho para um número real: veja a seção **"Se algo der errado"** no fim deste documento AGORA.

### Aviso 2 — no Copiloto o lead PODE mudar de etapa sozinho (é esperado)

No modo Copiloto a IA **nunca manda mensagem** sem o vendedor — mas ela **continua analisando a conversa** a cada bloco de mensagens (aproximadamente a cada 40 segundos) e, quando a qualificação fecha, **move o lead de etapa no funil sozinha**.

Entenda o que isso significa na prática, para não levar susto no dia 1:

- Você vai ver leads andando no funil **sem ninguém clicar em nada**. O CRM não está com defeito: isso é a IA lendo a conversa.
- A mudança de etapa reflete o que o **LEAD** disse na conversa — não a sugestão que a IA escreveu para o vendedor. Ou seja: a etapa pode mudar mesmo que a sugestão nunca tenha sido enviada.
- **O vendedor que descarta a sugestão não fica sabendo** que a etapa mudou. Não existe aviso para ele; quem vê o movimento é quem olha o funil.
- A etapa só muda com a qualificação completa (todos os campos obrigatórios preenchidos e todos os critérios atendidos). Se faltar alguma coisa, a IA tenta e o sistema recusa — veja a Parte 7.

Isso é **comportamento decidido e correto** (é assim que o funil fica confiável sem depender do vendedor lembrar de arrastar o card). Mas é a primeira coisa que assusta. Se você não quiser esse movimento automático em algum agente, a saída é não configurar critério de qualificação/campos obrigatórios nele — não existe botão "desligar só a mudança de etapa".

### Aviso 3 — se áudio e texto chegarem colados (mesmo bloco de ~40s), só o ÚLTIMO é levado em conta

O agrupamento de ~40s do Aviso 2 processa o bloco inteiro, mas o tipo da mensagem que decide se rola transcrição de áudio é sempre o da ÚLTIMA mensagem do bloco.

- Se o lead manda um **ÁUDIO** e, ainda dentro da mesma janela de ~40s, manda um **TEXTO** em seguida: o áudio **NÃO é transcrito**. Ele fica registrado na conversa só como `[Audio]` (sem o conteúdo), e é isso que a IA vai considerar dali pra frente nesse ponto da conversa — o que foi dito no áudio se perde para a análise.
- Se for o contrário (texto primeiro, áudio por último no bloco): o áudio é transcrito normalmente e entra na análise junto com o texto anterior.

Na prática: se o lead manda um áudio explicando o que quer e, alguns segundos depois (ainda dentro da janela), manda um "oi, tudo bem?" de texto, a sugestão da IA vai ignorar o que foi dito no áudio — porque o texto "atropelou" o áudio no agrupamento. Isso é um comportamento conhecido e documentado do projeto (não é bug a corrigir agora); se acontecer no teste do Passo 4.3, não estranhe.

---

## O que você precisa separado antes de começar

- Login como `super_admin` no CRM.
- Um celular de teste (o seu, ou um chip separado) que **não é** um cliente real — vai ser o "lead" nos testes.
- O número de WhatsApp Business que está conectado à conta Dros no CRM (veja em Configurações → WhatsApp qual instância está conectada, e mande as mensagens de teste para esse número).
- Acesso ao terminal da VPS (o mesmo que você já usa para rodar o deploy) só para o Passo 1 (ver os logs) e, se quiser, para a checagem opcional do banco no Passo 6.

---

## Parte 1 — Checagem sem risco (só olhar, não manda nada)

### Passo 1.1 — Conferir se o deploy subiu limpo

No terminal da VPS, depois do deploy:

```
pm2 logs dros-crm --lines 50
```

**Esperado (só na primeira subida depois do deploy):** linhas como
`[DB] Added column ai_agents.mode`, `[DB] Added column accounts.ai_key_source` e várias `[DB] Added column leads.ai_...` — e nenhuma linha de erro (nada de `Error`, `TypeError`, `EADDRINUSE` etc.).

**Como saber que deu errado:** aparece `Error` ou o processo reinicia em loop (rode `pm2 status` — se `dros-crm` estiver piscando "errored" ou reiniciando toda hora, pare aqui e chame quem fez o deploy antes de continuar).

### Passo 1.2 — Conferir que nenhum agente virou Copiloto/SDR sozinho

No CRM, entre na conta Dros → menu **Agentes**. Abra o agente "AGENTE IA — OXI QUÍMICA".

**Esperado:** na aba "Identidade", o seletor **"Como a IA atua"** está em **Automático** (é o padrão do deploy) e o botão **"Atendimento ligado/desligado"** está do jeito que já estava antes do deploy — nada mudou sozinho.

**Como saber que deu errado:** se o modo aparecer como Copiloto ou SDR sem você ter mexido, o deploy alterou dado que não devia — pare e avise quem fez o deploy.

### Passo 1.3 — Conferir se falta a chave Anthropic

Ainda na tela **Agentes**, olhe o topo da página.

**Esperado:** se aparecer o aviso amarelo **"Falta cadastrar a API Anthropic"**, é porque a conta Dros hoje não tem chave nenhuma configurada — isso é o motivo do "AGENTE IA — OXI QUÍMICA" estar inofensivo agora (bloqueado). Anote isso: você vai decidir a chave só na Parte 3.

### Passo 1.4 — Conferir se a transcrição de áudio (Deepgram) está configurada

No terminal da VPS, sem mostrar o valor da chave (só confirma que ela existe):

```
grep -q '^DEEPGRAM_API_KEY=' /root/.env && echo 'OK: DEEPGRAM_API_KEY configurada' || echo 'FALTA: DEEPGRAM_API_KEY nao esta no .env'
```

**Esperado:** aparece `OK: DEEPGRAM_API_KEY configurada`.

**Como saber que deu errado:** aparece `FALTA: DEEPGRAM_API_KEY nao esta no .env` — sem essa chave, a IA nunca transcreve áudio (a transcrição falha em silêncio, sem travar o resto do sistema) e o Passo 4.3 (teste de áudio) não vai funcionar. Peça pra quem cuida do servidor configurar a chave antes de continuar.

---

## Parte 2 — Preparar o agente de teste (Copiloto) ANTES de qualquer chave

Ainda sem nenhuma chave configurada — continue usando o "AGENTE IA — OXI QUÍMICA" mesmo (é o único que a conta tem; a base de conhecimento errada não atrapalha testar o mecanismo do Copiloto, porque no Copiloto nada é enviado sozinho).

### Passo 2.1 — Trocar o modo para Copiloto

Abra o agente → aba **Identidade** → em **"Como a IA atua"**, marque **Copiloto** ("A IA só sugere a resposta na caixa do Chat; o vendedor revisa e envia.").

**Não feche o modal ainda** — vá para o passo seguinte antes de salvar, para fazer tudo em um único Salvar.

### Passo 2.2 — Preencher o critério de qualificação

Na mesma tela, vá para a aba **Qualificação** e escreva algo simples no campo **"Critério de qualificação"**, por exemplo: `Qualificado quando souber nome e cidade`. Isso é só para o teste — pode trocar depois.

### Passo 2.3 — Salvar e confirmar

Clique em **"Salvar Alterações"** (botão no rodapé do modal).

**Esperado:** o modal fecha sem erro. Reabra o mesmo agente e confira: a aba Identidade mostra **Copiloto** marcado. Só depois de ver isso confirmado, siga para a Parte 3.

**Como saber que deu errado:** se ao reabrir o agente o modo voltou para Automático ou deu erro ao salvar, PARE — não configure a chave enquanto isso não estiver corrigido.

### Passo 2.4 — Ligar "Responde áudio" (senão a IA nunca vai ouvir os áudios de teste)

Abra de novo o agente → aba **Áudio** → marque a caixa **"Responde áudio"**. O texto de recusa logo abaixo pode ficar como está (só é usado quando a transcrição falhar ou quando esta caixa estiver desmarcada). Clique em **"Salvar Alterações"**.

**Esperado:** ao reabrir o agente, aba Áudio, a caixa "Responde áudio" continua marcada.

**Como saber que deu errado:** se ao reabrir a caixa aparecer desmarcada de novo, o Passo 4.3 (teste de áudio) não vai funcionar — a IA vai tratar qualquer áudio como se a função estivesse desligada (sem transcrever, sem sugestão).

---

## Parte 3 — Só agora: configurar a chave da IA

Com o modo já confirmado como **Copiloto** (Parte 2), abra de novo o agente, aba **Identidade**. Como `super_admin`, você vê o campo **"Chave da IA desta conta (só admin Dros)"**.

- Se a conta Dros já tem uma chave Anthropic própria cadastrada em **Integrações** (ou seja, o aviso amarelo do Passo 1.3 NÃO apareceu): pode deixar a opção **"Chave do cliente (Integrações)"**.
- Se não tem (apareceu o aviso amarelo): pergunte a quem cuida do servidor se a variável `ANTHROPIC_API_KEY_DROS` está configurada em `/root/.env`. Se estiver, escolha **"Chave da Dros"** no seletor.
- Se nenhuma das duas existir, você não vai conseguir gerar sugestões de IA — cadastre uma chave em Integrações antes de continuar.

**Importante:** essa escolha vale **na hora**, sem precisar clicar em Salvar, e vale para **todos os agentes da conta** Dros (não só este). Como confirmamos na Parte 2 que este agente está em Copiloto, nada será enviado sozinho mesmo que a chave já esteja ativa — mas se a conta Dros tiver outro agente em Automático ou SDR, ele também "acorda" ao ligar a chave. Confira a lista de Agentes antes de prosseguir: se houver outro agente ativo em Automático/SDR que você não quer testar agora, desligue o atendimento dele antes (botão "Atendimento ligado" no card, vira "Atendimento desligado").

**Esperado:** o aviso amarelo "Falta cadastrar a API Anthropic" some da tela de Agentes.

**Como saber que deu errado:** o aviso continua aparecendo — a chave escolhida está vazia; revise Integrações ou o `.env` do servidor.

---

## Parte 4 — O teste mais importante: nada é enviado ao lead sem o vendedor

Este é o ponto central do Copiloto — verifique com atenção.

### Passo 4.1 — Mandar mensagens de teste

Do celular de teste, mande **duas mensagens seguidas** para o WhatsApp da Dros (ex: "oi" e depois, uns segundos depois, "quanto custa?").

**Esperado imediatamente:** **nenhuma resposta chega no celular de teste.** Fique de olho no WhatsApp por pelo menos 1 minuto — nada deve chegar sozinho.

**Como saber que deu errado (CRÍTICO):** se uma resposta chegar automaticamente no celular de teste, o Copiloto está enviando sozinho — isso quebra a regra mais importante do sistema. Pare os testes e vá direto para "Se algo der errado".

### Passo 4.2 — Conferir a sugestão no Chat

Espere cerca de **40 segundos** depois da ÚLTIMA mensagem que você mandou. Abra o CRM → **Chat** → a conversa desse lead de teste.

**Esperado:**
- Na caixa de digitar mensagem aparece o texto sugerido pela IA, com a etiqueta **"sugestão da IA"** logo abaixo da caixa (e "Enter envia · apagar descarta").
- No cabeçalho da conversa aparece o selo **"Chance de fechar X% · trava: Y"**.
- No log da VPS (`pm2 logs dros-crm --lines 80`) aparecem as linhas `[AI Agent] record_analysis lead=...` e `[AI Agent] Processed (copiloto) ... suggestion=true`.

**Como saber que deu errado:** se depois de 1-2 minutos nada aparece na caixa nem no selo, confira o log — se não aparecer `record_analysis` nem `Processed`, confira se a IA está pausada nesse lead (Parte 8) ou se falta chave (Parte 3).

Neste momento você confirmou o mais importante: **a IA participa da conversa, mas quem manda a mensagem é você.**

### Passo 4.3 — Testar o fluxo de áudio (a IA ouve e qualifica pelo áudio)

Do celular de teste, mande um **ÁUDIO** de WhatsApp para o número da conta (por exemplo, gravando "oi, meu nome é Fulano e sou de São Paulo" — ou algo que bata com o critério de qualificação que você escreveu no Passo 2.2). Espere os mesmos ~40 segundos do Passo 4.2.

**Esperado:**
- Na caixa do Chat aparece uma sugestão nova que leva em conta o que foi dito no áudio (não uma pergunta genérica ignorando o que você falou).
- No log da VPS (`pm2 logs dros-crm --lines 80`) aparece uma linha no formato `[AI Agent] STT lead=<id> dur=<segundos>s cost=$<valor> txt="<começo da transcrição>"`.

**Como saber que deu errado — três causas possíveis, veja qual bate:**
1. **"Responde áudio" está desligado no agente** (confira o Passo 2.4).
2. **A transcrição veio vazia** (áudio incompreensível, ruído, mudo).
3. **Falta a chave Deepgram no servidor, ou a Deepgram caiu** (confira o Passo 1.4).

Nos três casos, o sintoma no Copiloto é **sempre o mesmo: não aparece nada na caixa** — sem linha de STT no log, sem sugestão nova, sem aviso de erro em lugar nenhum. É fácil confundir isso com "a IA não funcionou" quando na verdade é um desses três motivos específicos do áudio. Se não aparecer nada, confira nesta ordem: Passo 1.4 (chave existe?) → Passo 2.4 (flag ligada?) → grave um áudio mais claro e tente de novo.

---

## Parte 5 — Nova mensagem expira a sugestão antiga

Sem enviar nem apagar a sugestão que está na caixa, mande **mais uma mensagem** do celular de teste.

**Esperado:** a sugestão antiga some da caixa (se você não tinha editado o texto) e, uns 40 segundos depois, chega uma sugestão nova.

**Como saber que deu errado:** a sugestão antiga continua na caixa e nunca chega uma nova — confira o log por `Processed (copiloto)` de novo; se não aparecer, repita o Passo 4.2 primeiro.

---

## Parte 6 — Enviar, editar e descartar a sugestão

Faça os três, em qualquer conversa de teste com sugestão pendente:

1. **Enviar sem mexer:** clique enviar (ou Enter) com o texto exatamente como a IA sugeriu. **Esperado:** a mensagem sai normalmente no WhatsApp do celular de teste.
2. **Editar e enviar:** na próxima sugestão, mude uma palavra do texto e envie. **Esperado:** sai a versão editada.
3. **Descartar:** na sugestão seguinte, apague todo o texto da caixa (deixe vazia) sem enviar. **Esperado:** a sugestão desaparece; nada é enviado.

**Checagem opcional (mais técnica, precisa do terminal da VPS):** se quiser confirmar no banco que cada uma virou o status certo (`sent`, `edited`, `discarded`), rode na VPS, dentro de `/root/crm`, trocando `<lead_id>` pelo id do lead de teste (aparece na URL do Chat):

```
node -e "const db=require('better-sqlite3')('server/data/crm.db'); console.log(db.prepare('SELECT id, status, final_content FROM ai_suggestions WHERE lead_id = ? ORDER BY id DESC LIMIT 5').all(<lead_id>))"
```

**Esperado:** três linhas recentes com `status` = `sent`, `edited` e `discarded`, na ordem que você fez.

**Como saber que deu errado:** o texto enviado no WhatsApp não bate com o que estava na caixa, ou o status no banco não corresponde à ação — nesse caso o registro de enviada/editada/descartada não está confiável (importante para medir custo/qualidade depois).

---

## Parte 7 — Trava de qualificação (não deixa a IA "vender" antes da hora)

### Passo 7.1 — Pedir preço antes de responder as perguntas de qualificação

Do celular de teste, pergunte o preço logo de cara, sem responder nome/cidade (ou o que você configurou no critério).

**Esperado:** a sugestão que aparece contorna o preço com uma resposta educada e faz a PRÓXIMA pergunta de qualificação (não entrega valor).

### Passo 7.2 — Conferir que a etapa não muda ANTES DA HORA

> Lembre do **Aviso 2** lá em cima: depois que a qualificação fecha, a etapa **vai** mudar sozinha, e isso é o certo. O que este passo testa é o contrário: que ela **não** muda **enquanto** falta qualificação.

Se, nessa troca, a IA tentar mudar a etapa do lead antes da hora, o log mostra `[AI Agent] move_stage RECUSADO lead=...` (ou `[AI Agent] handoff move_to_stage RECUSADO lead=...`, quando a tentativa veio de uma regra de transferência) e a etapa do lead **não muda** no CRM.

**Como saber que deu errado:** a etapa do lead mudou mesmo sem os critérios preenchidos — a trava não está funcionando; não confie na qualificação automática até isso ser corrigido.

### Passo 7.3 — Completar a qualificação

Responda (do celular de teste) tudo que falta (nome, cidade etc., conforme o critério). Se a IA decidir mover a etapa agora, confira no histórico do lead a entrada **"Movido pela IA — qualificação completa"**.

---

## Parte 8 — Pausar a IA numa conversa e desligar o atendimento

### Passo 8.1 — Pausar só esta conversa

No Chat, na conversa de teste, clique **"Pausar IA"** (canto superior). Mande mais uma mensagem do celular de teste.

**Esperado:** nenhuma sugestão nova aparece; no log NÃO aparece `Processed` para esse lead nesses minutos seguintes.

Clique **"Retomar IA"** e mande outra mensagem — a sugestão volta a aparecer depois dos 40s de costume.

### Passo 8.2 — Desligar o atendimento com uma sugestão pendente

Deixe uma sugestão pendente na caixa desse lead de teste. Abra o agente, desmarque **"Atendimento ligado"** e clique Salvar (ou use o botão do card em Agentes e confirme o aviso).

**Esperado:** a sugestão some da caixa do Chat; se checar no banco (comando da Parte 6), o status dela virou `expired`.

### Passo 8.3 — Religar em Automático e desligar de novo (mede quantos leads foram avisados)

Religue o agente e mude o modo para **Automático** só para este passo. Deixe a IA conversar normalmente com um lead novo de teste (sem vendedor atribuído — pode ser o próprio celular de teste como um "lead" novo, criando uma conversa nova).

Depois, na lista de **Agentes**, clique no botão do card ("Atendimento ligado") e confirme o aviso de desligar.

**Esperado:**
- O botão vira **"Atendimento desligado"**.
- Aparece um aviso do tipo *"Atendimento de [nome] desligado. N lead(s) foram para o vendedor com o aviso 'IA desligada — assuma a conversa'."* — confira se o número bate com a quantidade de leads que a IA estava atendendo.
- Abra o lead de teste: ele agora tem um atendente humano (o da conversa, o padrão da instância, ou quem a roleta pegou), tem uma nota **"IA desligada — assuma a conversa"**, e o vendedor recebeu a notificação de WhatsApp de sempre.
- Mande mais uma mensagem desse lead pelo celular de teste: **a IA não responde mais sozinha.**

**Como saber que deu errado:** o lead continua "preso" no agente mesmo desligado (nenhum atendente humano, e a IA some sem ninguém assumir) — isso seria pior do que o esperado; veja a seção seguinte.

### Passo 8.4 (opcional, mais arriscado — cuidado) — Conta sem vendedor humano ativo

Este passo mexe na disponibilidade real do time, então só faça em horário de baixo movimento e reative tudo imediatamente depois.

Temporariamente, marque **todos** os usuários vendedores da conta Dros como inativos (ou use uma conta de teste separada, se tiver uma, em vez da Dros — mais seguro). Com o agente desligado (ou desligando agora), confira o que acontece com um lead que estava com a IA.

**Esperado:** o lead fica **sem atendente** (nenhum atendente atribuído) — ele NÃO deve continuar apontando para o robô desligado, e sim ficar como um lead novo esperando a roleta pegar assim que houver vendedor ativo de novo.

**Como saber que deu errado:** o lead continua com o robô desligado como "atendente" — isso trava o lead sem ninguém cuidando dele.

**Depois deste passo, reative todos os vendedores imediatamente.**

---

## Parte 9 — SDR (o mais parecido com "a IA falando sozinha até qualificar")

Este é o modo mais arriscado de testar porque, enquanto ativo, a IA responde sozinha a QUALQUER lead novo que se enquadre no modo de ativação do agente — não só ao seu celular de teste. Antes de ativar, confira na aba **"Quando atuar"** quais instâncias de WhatsApp e qual modo de ativação esse agente usa, e se possível restrinja a uma instância de teste isolada. Faça este teste rápido e volte para Copiloto (ou desligue o atendimento) assim que terminar.

### Passo 9.1 — Configurar

No agente, mude **"Como a IA atua"** para **SDR**. Na aba **Handoff**, ative a regra **"Qualificado"**: escolha o vendedor de destino (ou roleta) e, se quiser, a etapa para mover o lead. Salve.

### Passo 9.2 — Testar com um lead novo, sem atendente humano

Do celular de teste, mande uma mensagem como se fosse um lead novo (uma conversa nova, sem atendente humano atribuído).

**Esperado:** a IA responde sozinha, uma pergunta de qualificação por vez (nunca várias juntas). Quando todos os campos obrigatórios e critérios estiverem atendidos, o lead vai para o vendedor da regra configurada, aparece a nota **"Resumo da qualificacao (IA)"** nas notas do lead.

### Passo 9.3 — Confirmar a passagem para Copiloto

Mande mais uma mensagem desse mesmo lead de teste (já qualificado e passado).

**Esperado:** a IA não responde mais sozinha nesse lead — agora ela só sugere (vira Copiloto automaticamente para esse lead específico), do mesmo jeito testado na Parte 4.

**Como saber que deu errado:** a IA continua respondendo sozinha depois da qualificação (não virou Copiloto), ou nunca chega a passar o lead mesmo depois de responder tudo — confira o log por `SDR qualificou lead=...` e as regras de Handoff "Qualificado" salvas.

**Ao terminar este teste, volte o modo do agente para Copiloto (ou Automático, decisão sua) e confira de novo a base de conhecimento antes de deixar rodando de verdade.**

---

## O que ficou de fora deste roteiro

- Testar o modo Automático "de verdade" num agente com base de conhecimento correta não foi incluído aqui, porque a conta Dros só tem o agente da OXI QUÍMICA (base errada) — fazer esse teste aqui exigiria corrigir a base de conhecimento primeiro, o que é decisão de negócio, não desta tarefa.
- O caso de borda "conta sem nenhum vendedor" (Parte 8.4) foi marcado como opcional porque mexe na disponibilidade real da equipe; o ideal é testá-lo numa conta separada, se houver uma disponível.
- Este documento não cria nem apaga nada no banco de produção — os comandos SQL/`node -e` são só leitura (`SELECT`), para conferência.

---

## Se algo der errado (ação rápida)

Existem dois controles de emergência no agente — use o que fizer sentido para o problema:

- **O seletor "Como a IA atua" volta para Automático:** desfaz o comportamento específico de Copiloto/SDR (sugestão, trava, handoff) e volta para o jeito simples de sempre. Use se o problema for algo estranho no mecanismo de sugestão/trava em si, mas lembre que em Automático a IA continua respondendo sozinha.
- **O interruptor "Atendimento ligado/desligado":** para TUDO na hora — a IA para de responder e de sugerir, não importa o modo. É o botão certo se o problema é "a IA mandou algo errado para um lead real" ou "eu quero parar agora e pensar depois".

Se em qualquer momento um lead real receber uma mensagem que não devia (ou você simplesmente quiser parar tudo agora), use o interruptor:

1. **Desligue o atendimento deste agente:** abra o agente → aba Identidade → desmarque **"Atendimento ligado"** (vira "Atendimento desligado") e clique Salvar. Isso corta qualquer envio ou sugestão nova imediatamente, não importa em qual modo o agente estava.
2. Alternativa mais rápida, sem abrir o agente: na tela **Agentes**, clique direto no botão do card ("Atendimento ligado") e confirme — mesmo efeito.
3. Se o problema for só numa conversa específica (não no agente inteiro): abra essa conversa no Chat e clique **"Pausar IA"**.
4. Depois de conter o problema, revise a conversa afetada no Chat, entre em contato com o lead se necessário, e só reative o agente depois de corrigir a causa (base de conhecimento, modo, ou chave).

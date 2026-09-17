# Agente de IA por entrevista — Desenho

Data: 17/09/2026 · Base: branch `feat/copiloto-agente-ia` (merge dos planos Copiloto + Provedor de WhatsApp) · Bloco 6 de 6

## 1. Objetivo

Hoje, criar um agente de IA exige preencher **8 abas e cerca de 25 campos** (`src/components/AgentEditorModal.tsx`), e os que mais pesam — persona, base de conhecimento, "nunca mencione", critério de qualificação — pedem que a pessoa escreva um texto do zero. Ninguém sabe o que escrever numa caixa em branco chamada "Knowledge base".

Diagnóstico do CEO (17/09/2026): *"desse jeito que está o usuário nunca vai conseguir fazer um agente atender"*.

Este desenho substitui o formulário por uma **entrevista conversacional**: a IA pergunta, a pessoa responde em linguagem natural, e a própria IA escreve os campos do agente. As 8 abas continuam existindo como ajustes avançados.

## 2. Princípios (decididos pelo CEO, 17/09/2026)

1. **Uma superfície só: a conversa.** Nada de formulário antes da entrevista. Se a IA precisa de alguma coisa (o site, um material, o número de WhatsApp), ela pede dentro da conversa.
2. **Nenhum ramo de negócio embutido no código.** O código tem os *temas*; a IA escreve a *pergunta*, adaptada ao ramo que descobrir na primeira resposta. Vale para imobiliária, clínica, curso, software B2B ou qualquer outro.
3. **Cada agente pertence a uma empresa só.** Sem clonagem entre clientes, sem template global de agente. O conhecimento de um cliente nunca entra no agente de outro.
4. **A pessoa aprova em linguagem humana**, não em campo de formulário. O resumo diz "o que eu sei, o que vou descobrir, o que nunca falo" e a correção é feita conversando.
5. **As 8 abas não são apagadas.** Viram "ajustes avançados". Já existe agente configurado em produção, e quem sabe o que quer precisa poder mexer no detalhe.
6. **A Dros paga a entrevista.** Entrevista e compilação rodam sempre na chave da Dros; o atendimento do dia a dia continua na chave do cliente.

## 3. Arquitetura

A ideia central é separar **o que a pessoa disse** do **que a IA escreveu**. Hoje os dois são a mesma coisa (o texto no campo). Guardando só o resultado compilado, "corrigir algo" voltaria a ser reescrever campo na mão — exatamente o que este bloco elimina.

```
  ENTREVISTA (conversa)          ENRIQUECEDORES (opcionais)
  pergunta -> resposta           site · conversas do CRM · texto colado
         |                                    |
         +--------------+---------------------+
                        v
                  BRIEFING DO NEGOCIO
              (transcricao + o que veio das fontes)
                        |
                        v
                   COMPILADOR
         (uma chamada de IA: briefing -> campos do agente)
                        |
                        v
      persona · knowledge_base · never_mention ·
      qualification_criteria · required_fields · ...
```

### 3.1 O entrevistador — `server/services/agentInterview.js`

Conduz a conversa. Uma pergunta por vez; decide se cava mais fundo numa resposta vaga ou se segue para o próximo tema. Recebe o cliente de IA **injetado** (padrão já usado em `agentShutdown.test.js:65`).

Roteiro-base de temas, universais e sem ramo:

| # | Tema | Alimenta |
|---|---|---|
| 1 | O que a empresa vende | `knowledge_base`, e define o ramo para adaptar o resto |
| 2 | Quem é o cliente ideal | `knowledge_base`, `qualification_criteria` |
| 3 | O que a IA precisa descobrir do lead antes de passar para o vendedor | `qualification_criteria`, `required_fields` |
| 4 | O que a IA nunca pode falar | `never_mention` |
| 5 | Como a empresa fala com o cliente (tom) | `persona` |
| 6 | Onde a IA atende (número de WhatsApp) | vínculo com `whatsapp_instances` |

Ao longo da conversa, a IA também oferece as fontes opcionais quando fazem sentido: o site, um material pronto para colar, e as conversas que já existem no CRM.

O roteiro é um **piso, não um teto**: a IA pode fazer perguntas de aprofundamento dentro de um tema, respeitando os tetos da seção 6.

### 3.2 Os enriquecedores — `server/services/briefingSources/`

Cada fonte é um módulo com a mesma interface: recebe a conta, devolve um pedaço de texto para o briefing.

| Módulo | Origem | Obrigatório |
|---|---|---|
| `interview.js` | a própria conversa | sim |
| `website.js` | o site da empresa (campo `accounts.website` ou URL dada na conversa) | não |
| `crmHistory.js` | conversas reais já existentes na conta | não |
| `pastedText.js` | texto/material colado pela pessoa | não |

O compilador não sabe de onde o texto veio. É isso que torna barato entregar dois agora e dois depois — acrescentar fonte é inserir linha em `agent_briefing_sources`.

**Ordem de construção:** `interview.js` e `pastedText.js` primeiro (baratos, sem dependência externa); `website.js` e `crmHistory.js` depois.

### 3.3 O compilador — `server/services/agentCompiler.js`

Uma chamada de IA. Recebe o briefing inteiro, devolve os campos do agente. É o **único** lugar que conhece o formato do `ai_agents`. Valida a saída antes de gravar (seção 6).

### 3.4 Por que o briefing fica salvo

1. **"Corrigir algo" funciona conversando.** A pessoa fala *"não, preço a IA pode falar sim"*; isso entra no briefing e o compilador roda de novo.
2. **O bloco 3 (validar/desvalidar a sugestão da IA) reaproveita tudo.** O feedback entra no mesmo briefing e recompila — sem código novo.

### 3.5 Chave de IA

Entrevista e compilação usam sempre `ANTHROPIC_API_KEY_DROS`, **ignorando** o `ai_key_source` da conta. Motivo: a conta do cliente normalmente ainda não tem chave Anthropic quando o primeiro agente é criado (é o aviso amarelo "Falta cadastrar a API Anthropic"), então exigir a chave travaria a pessoa logo na primeira tela — que é a dor que este bloco resolve.

O atendimento do dia a dia continua obedecendo `ai_key_source` (`server/services/anthropicClient.js:22`), sem alteração.

## 4. Fluxo de telas

```
  Agentes  ->  [ + Novo Agente ]
                     |
                     v
  +---------------------------------------------+
  |  TELA CHEIA - conversa com a IA             |
  |                                             |
  |  IA  O que sua empresa vende?               |
  |  IA  Voces tem site? Me passa o link        |
  |      que eu leio sozinha.        <-- site   |
  |  IA  Tem alguma apresentacao ou tabela      |
  |      de precos? Pode colar aqui. <-- texto  |
  |  IA  Vi que voces ja tem 340 conversas      |
  |      no CRM. Posso ler pra aprender como    |
  |      seus vendedores falam?      <-- CRM    |
  |  IA  O que eu preciso descobrir do lead?    |
  |  IA  O que eu nunca posso falar?            |
  |  IA  Em qual numero eu atendo?   <-- ligacao|
  +---------------------------------------------+
                     |  compila
                     v
  +---------------------------------------------+
  |  RESUMO                                     |
  |  quem sou · o que sei · o que descubro ·    |
  |  o que nunca falo · onde atendo             |
  |                                             |
  |  [ Ta certo, ativar ]   [ Corrigir algo ]   |
  |  ajustes avancados >                        |
  +---------------------------------------------+
```

**Tela cheia, não modal.** O modal de hoje é apertado e é justamente a tela que assusta.

**"Corrigir algo"** volta para a conversa, não para um campo. Quantas vezes a pessoa quiser.

**"Ajustes avançados"** abre exatamente o modal de hoje (`AgentEditorModal.tsx`), com tudo preenchido pela IA. Nenhuma aba é removida.

**Agente que já existe** ganha dois botões no card: `Conversar com a IA` e `Ajustes avançados`.

**Ligação com o WhatsApp:** a IA não adivinha o número. Uma instância na conta -> usa e informa no resumo. Várias -> pergunta na entrevista. Modo de ativação e etapas entram no padrão mais aberto e aparecem como uma linha do resumo, corrigível — em vez de três campos numa aba.

## 5. Dados

```
agent_briefings          o briefing de um agente
  id, account_id*, agent_id (NULO enquanto rascunho),
  status ('entrevistando' | 'compilado' | 'ativo'),
  compiled_json, created_by, created_at*, updated_at

agent_briefing_turns     a conversa, turno a turno
  id, briefing_id*, position*, role ('ia' | 'user'), content*, created_at*

agent_briefing_sources   o que cada fonte trouxe
  id, briefing_id*, kind ('entrevista'|'site'|'conversas'|'colado'),
  ref (url, quando houver), content, status ('ok'|'falhou'),
  error, created_at*
```

Índices: `(account_id, status)` em `agent_briefings`; índice único em `agent_id` onde não nulo; `(briefing_id, position)` em `agent_briefing_turns`.

Separar `turns` de `sources` é o que deixa o resto barato: a conversa é uma fonte entre quatro, e o compilador lê só `sources`.

### 5.1 Regra de segurança: nenhuma linha em `ai_agents` até "Ativar"

O briefing vive sozinho enquanto é rascunho — por isso `agent_id` é nulo.

O motivo é de segurança, não de organização: **qualquer linha em `ai_agents` com `is_active = 1` é varrida pelo `processInboundMessage` e começa a responder lead de verdade.** Uma entrevista pela metade, ou abandonada porque a pessoa fechou o navegador, nunca pode conseguir falar com ninguém. É a mesma classe de acidente que a review final pegou antes do deploy, quando desligar o atendimento dispararia a mensagem de primeira abordagem para centenas de leads.

Enquanto o briefing está em `'compilado'`, os campos que a IA escreveu ficam em `compiled_json` — **não** em `ai_agents`. O "Ativar" é a única transição que cria o agente: grava `compiled_json` na linha nova de `ai_agents`, com o modo explícito, preenche `agent_briefings.agent_id` e passa o status para `'ativo'`.

A tela **Agentes** lista os briefings com status diferente de `'ativo'` como cartões de rascunho ("rascunho — continuar"), ao lado dos agentes de verdade, visualmente distintos.

### 5.2 Agente legado

Agente que já existe ganha um briefing com `agent_id` preenchido e uma linha em `sources` (`kind = 'entrevista'`) contendo os campos atuais como texto. A partir daí ele se comporta como qualquer outro. Custa uma chamada de IA e faz o recurso valer para o que já está no ar — inclusive o "AGENTE IA — OXI QUÍMICA" da conta Dros.

### 5.3 Isolamento

`account_id` nas três tabelas; toda consulta filtra por conta, como no resto do sistema (convenção do `CLAUDE.md`). O briefing de um cliente nunca entra no compilador de outro.

### 5.4 Custo

Sem infraestrutura nova: `ai_agent_token_log` já aceita `agent_id` nulo e tem coluna `source`. A entrevista e a compilação gravam ali com `agent_id = NULL` e `source = 'entrevista'` / `'compilacao'`. O gasto aparece no painel de custo que já existe.

## 6. Erros, tetos e pré-requisitos

| Situação | Comportamento |
|---|---|
| IA cai / internet cai / navegador fecha no meio | A conversa é salva turno a turno. A pessoa reabre e continua de onde parou. A transcrição nunca se perde — é o que não dá para pedir de novo. |
| Site fora do ar, bloqueando robô, ou lento | Vira `status = 'falhou'` em `sources` e **a entrevista continua**: *"não consegui abrir seu site, então me conta você mesmo…"*. Site é enfeite; a entrevista é a espinha. Mesma regra para conversas do CRM e texto colado. |
| Teto de tokens do briefing atingido | A IA **encerra e compila com o que tem**. Não para em silêncio. Padrão: **60.000 tokens por briefing** (entrevista + fontes + compilação somadas). |
| Teto de perguntas atingido | Idem. A entrevista não pode ser infinita. Padrão: **20 perguntas da IA**, o que dá folga sobre os 6 temas para aprofundar onde precisar. |
| Conta com muitas conversas no CRM | `crmHistory.js` entra com limite: as **30 conversas mais recentes que avançaram de etapa**, cada uma truncada nas **40 primeiras mensagens**. Sem isso, uma conta com 5.000 atendimentos torra a chave da Dros numa entrevista só. |
| Compilador devolve saída fora do formato | Valida antes de gravar; tenta uma vez; falhando de novo, a pessoa vê o erro e o caminho dos ajustes avançados. **Nunca grava agente meio montado.** |
| Rascunho abandonado | Aparece em Agentes como "rascunho — continuar", e pode ser apagado. Não conta como agente. |

**Pré-requisito de deploy:** `ANTHROPIC_API_KEY_DROS` no `.env` da VPS. Sem ela o recurso inteiro não existe. Checado na entrada, com mensagem clara em vez de erro feio. Entra na mesma lista de conferência onde já está o `DEEPGRAM_API_KEY`.

## 7. Testes

Convenção do projeto: `node --test`, banco em memória (`test/helpers/memoryDb.js`), dependências injetadas e fakes (`agentShutdown.test.js:65`). O entrevistador e o compilador recebem o cliente de IA injetado — nenhuma chamada real de IA nos testes.

Cobertura mínima, toda sem IA de verdade:

1. Rascunho **não** cria linha em `ai_agents` (a regra da 5.1, testada explicitamente).
2. Só o "Ativar" cria o agente, e com o modo correto.
3. Fonte opcional que falha não interrompe o fluxo e fica registrada como falha.
4. Teto de tokens encerra a entrevista compilando.
5. Teto de perguntas encerra a entrevista compilando.
6. Saída inválida do compilador não grava nada.
7. Agente legado vira briefing a partir dos campos atuais.
8. Isolamento por conta nas três tabelas.
9. A conversa é retomável: turnos salvos sobrevivem à interrupção.

## 8. Fora do escopo

- Template global de agente e clonagem entre contas (decidido: não).
- Formulário fixo de perguntas (descartado: obrigaria a escolher um ramo).
- Os outros 5 blocos pedidos em 17/09/2026: filtros, condução do lead, copiloto sob demanda, cadência unificada e integrações separadas. Cada um terá seu próprio desenho.

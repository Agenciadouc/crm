# SPIN Selling por Perfil de Cliente Ideal no Roteiro — Desenho

Data: 02/10/2026 · Status: desenho aprovado na conversa, aguardando revisão da spec escrita

## 1. Objetivo

As perguntas de qualificação do CRM deixam de ser BANT genérico e passam a ser **SPIN Selling
feito sob medida para cada conta**: a conta registra o objetivo do negócio e os perfis de cliente
ideal; a IA lê as conversas reais da conta e escreve perguntas SPIN por perfil, com opções de
resposta tiradas do jeito que os leads falam; no atendimento, o perfil do lead é identificado
pelas mensagens e só as perguntas daquele perfil valem; toda semana a IA revisa as conversas novas
e sugere melhorias.

Exemplo guia — **Ustulimp**: objetivo "revender produtos de limpeza"; perfis **Loja** (mercadinho,
comércio, compra pra prateleira) e **Vendedor porta a porta** (renda extra, vende de casa em casa).
Lead escreve "tenho um mercadinho" → perfil Loja → segue o SPIN da Loja.

### SPIN

| Chave interna  | Rótulo na tela         | Pra que serve                                        |
|----------------|------------------------|------------------------------------------------------|
| `situation`    | Situação               | Fatos do cliente hoje (como faz, quem decide, prazo) |
| `problem`      | Problema               | Onde dói, o que não funciona                         |
| `implication`  | Implicação             | O que o problema custa / causa se continuar          |
| `need_payoff`  | Necessidade de Solução | Quanto vale resolver; o cliente fala o ganho         |

## 2. Entregas

- **Entrega 1** (sobe primeiro): seções 3 a 9 — SPIN, perfis, identificação do perfil, roteiro
  por perfil, "Montar com IA" lendo conversas reais, telas.
- **Entrega 2** (logo depois, plano próprio): seção 10 — revisão semanal automática.

## 3. Decisões fechadas com o dono

1. Acaba o limite de 1 pergunta por categoria. Ordem dentro da etapa: Situação → Problema →
   Implicação → Necessidade de Solução. Poucas de Situação, mais de Problema, mais de Implicação,
   1-2 de Necessidade de Solução.
2. Perguntas geradas são de múltipla escolha com pontos (pontuam no Termômetro). Texto livre
   continua possível manualmente.
3. Etapas de tentativa de contato ("Novo Lead", "Contato Feito") não recebem pergunta; só a
   cadência de contato. O SPIN vale da etapa em que o lead já respondeu ("Atendimento") em diante.
4. "Respondeu → vira Atendimento" já existe no follow-up (`on_reply_move_to_stage_id`). Não muda.
5. Etiquetas antigas migram: `need`→`problem`, `timeline`→`situation`, `authority`→`situation`,
   `budget`→`need_payoff`. Texto, opções, pontos e respostas ficam iguais.
6. Perguntas por perfil (opção escolhida pelo dono): cada perfil tem seu próprio jogo SPIN; uma
   pergunta de Situação para "Todos" serve para descobrir o perfil.
7. Perfil do lead: IA identifica pelas mensagens; vendedor escolhe/corrige; escolha manual vale
   mais e a IA não sobrescreve. Sem IA, só manual.
8. "Montar com IA" lê as conversas reais da própria conta (nunca de outra conta).
9. Nada muda sozinho no roteiro: sugestões semanais vão para a aba Sugestões; gestor aplica; A/B
   como hoje.
10. Treinador Global e mudança de critério do A/B ficam fora.

## 4. Dados (Entrega 1)

Tudo com `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` (SQLite antigo do servidor:
nada de DROP/RENAME COLUMN).

- `accounts.business_objective TEXT` — objetivo do negócio (até 300 caracteres).
- Tabela nova `roteiro_profiles`:
  `id, account_id, profile_key TEXT (estável, gerado), name TEXT (até 60), description TEXT
  (como reconhecer, até 500), position INTEGER, created_at, updated_at`;
  único `(account_id, profile_key)`; máximo 6 perfis por conta.
- `roteiro_questions.spin TEXT` — `situation | problem | implication | need_payoff | NULL`.
- `roteiro_questions.profile_key TEXT` — `NULL` = vale para todos.
- `leads.roteiro_profile_key TEXT`, `leads.roteiro_profile_origin TEXT` (`ia` | `manual`).
- Migração no boot, idempotente, em todas as versões do roteiro:
  `UPDATE roteiro_questions SET spin = CASE bant WHEN 'need' THEN 'problem' WHEN 'timeline' THEN
  'situation' WHEN 'authority' THEN 'situation' WHEN 'budget' THEN 'need_payoff' END
  WHERE spin IS NULL AND bant IS NOT NULL`. A coluna `bant` fica morta.
- API: campo `bant` some e vira `spin`; perguntas ganham `profile_key` (servidor e front sobem
  juntos).
- Apagar perfil: recusado (400 "Este perfil tem perguntas. Mude ou apague as perguntas antes.")
  se alguma pergunta publicada ou de rascunho usar o perfil; leads com esse perfil voltam a `NULL`.

## 5. Regra central: pergunta vale para o lead?

`server/services/roteiro/profiles.js` (novo) exporta `appliesToLead(question, leadProfileKey)`:
verdadeiro quando `question.profile_key` é `NULL` ou igual ao perfil do lead. Lead sem perfil →
só perguntas `NULL`.

Aplicada em todo lugar que trata perguntas **de um lead**:
- `leadRoteiro.getLeadRoteiro` (próxima pergunta, progresso, perguntas da etapa).
- `leadRoteiro.pendingRequired` / trava de etapa.
- `autoAdvance` (avanço automático quando as obrigatórias respondidas).
- `aiExtract.extractAnswers` (só pendentes aplicáveis).
- `leadCadence` (passo de pergunta de outro perfil fica "não se aplica": não vira próximo passo,
  não trava, não conta no total).
- `leadScore/inputs.buildFit` (máximo e pontos só das aplicáveis).
- `runtime.js` (agente pergunta só as aplicáveis — vem via `getLeadRoteiro`).

Não muda: métricas, aprendizado diário e A/B (são por `question_key`).

Mudar o perfil do lead → recalcula Termômetro e cadência da etapa (mesmo gatilho de quando salva
resposta). Respostas já dadas a perguntas do perfil antigo ficam guardadas, só não contam.

Conta com 0 ou 1 perfil: tudo funciona como hoje (com 1 perfil, o lead recebe esse perfil
automaticamente ao entrar numa etapa de conversa — sem pergunta de descoberta).

## 6. Identificação do perfil do lead

- **IA:** `aiExtract.extractAnswers` passa a rodar também quando o lead não tem perfil e a conta
  tem 2+ perfis. Na mesma chamada (sem custo extra) a ferramenta `record_answers` ganha
  `profile_key` + `profile_evidence`; a IA recebe nome e descrição de cada perfil e só marca com
  evidência clara nas mensagens. Grava com origem `ia`. Nunca troca perfil de origem `manual`.
- **Resposta da pergunta de descoberta:** pergunta de opções "Todos" pode ter, em cada opção, um
  `sets_profile_key` (ex.: opção "Tenho loja" → Loja). Ao salvar a resposta (vendedor ou IA), o
  perfil é gravado se o lead ainda não tiver perfil manual. Coluna nova
  `roteiro_options.sets_profile_key TEXT`.
- **Manual:** rota `PUT /leads/:id/roteiro-profile` `{ profile_key | null }` (vendedor do lead ou
  gestor) grava origem `manual`.

## 7. SPIN e etapas

### 7.1 Modelo pronto — `server/services/roteiro/spinTemplate.js` (substitui `bantTemplate.js`)

6 perguntas de opções, obrigatórias, perfil "Todos":

| Fase | Pergunta | Opções (pontos) |
|---|---|---|
| situation | Como você resolve isso hoje, {nome}? | Já uso algo e não estou satisfeito(a) (10) · Faço de um jeito improvisado (8) · Ainda não faço nada (3) |
| problem | O que mais te incomoda na forma como está hoje? | Atrapalha o dia a dia, é urgente (15) · Incomoda, mas dá pra levar (8) · Nada em especial, só pesquisando (0) |
| problem | Isso já aconteceu outras vezes ou foi algo pontual? | Acontece sempre (12) · Às vezes (6) · Foi só uma vez (0) |
| implication | E se continuar assim pelos próximos meses, o que isso te causa? | Perco dinheiro/clientes/tempo (15) · Fica chato, mas não muda muito (5) · Nada (0) |
| implication | Isso afeta mais alguém além de você (família, equipe, sócio)? | Sim, afeta outras pessoas (10) · Um pouco (5) · Só a mim (2) |
| need_payoff | Se isso estivesse resolvido, o que mudaria pra você? Quanto valeria resolver agora? | Mudaria muito, quero resolver já (15) · Seria bom, mas sem pressa (6) · Não mudaria muito (0) |

Usado por "Começar com modelo SPIN" (funil: `createSpinDraft`, rota `/spin-template`; etapa:
`spinStepQuestions`, modo `'spin'`) e para completar fase que a IA esquecer. Soma só as fases que
o funil ainda não tem.

### 7.2 Etapa de contato × conversa — `server/services/roteiro/stageKind.js` (novo)

`isContactStage(stage)`: nome normalizado (minúsculo, sem acento) contém `novo`, `nova`,
`contato`, `tentativa`, `prospec` ou `entrada`, e a etapa não é final.
`conversationStages(stages)`: não finais e não de contato, em ordem; se não sobrar nenhuma,
devolve todas as não finais.

## 8. "Montar com IA" lendo as conversas reais — `aiDraft.js`

### 8.1 Amostra de conversas — `server/services/roteiro/conversationSample.js` (novo)

Só da própria conta, últimos 90 dias, leads com pelo menos 1 mensagem recebida e 3 mensagens no
total, mensagens com texto (`content` não vazio; áudio entra pelo `messages.transcription` quando já transcrito).
Prioridade: até 20 que compraram (venda registrada ou etapa de conversão), até 10 que avançaram de
etapa, até 10 das demais (incluindo perdidas). Por conversa: últimas 30 mensagens, cada uma
cortada em 300 caracteres, formato `Cliente:` / `Vendedor:`, cabeçalho com resultado
(comprou / avançou / não avançou) e etapa atual. Teto total: 60.000 caracteres (corta as de
menor prioridade primeiro). Sem nome/telefone do lead no texto enviado.

### 8.2 Entrada da IA

Etapas marcadas `(tentativa de contato — sem perguntas)` / `(em conversa — perguntas SPIN)`;
objetivo do negócio; perfis (nome + descrição); briefing do agente (o que descobrir, critério,
base de conhecimento cortada em 4.000 caracteres); a amostra de conversas.

### 8.3 Regras do prompt

SPIN por perfil em cada etapa de conversa (quantidade da decisão 1); 1 pergunta de descoberta de
perfil "Todos" no início da 1ª etapa de conversa quando houver 2+ perfis, com `sets_profile_key`
nas opções; opções e palavras tiradas das falas reais dos leads; perguntas objetivas, uma coisa
por vez; nada em etapa de contato; marcar `spin` e `profile_key`. Sem conversas: usa briefing; sem
briefing: roteiro SPIN geral.

### 8.4 Saneamento

`spin` só em pergunta de opções e pode repetir; `profile_key` inexistente vira `NULL`;
`sets_profile_key` inexistente é descartado; pergunta em etapa de contato/inválida vai para a 1ª
etapa de conversa; fase faltando (considerando o roteiro todo) é completada pelo modelo; ordem
final por etapa: descoberta de perfil primeiro, depois por perfil (Todos, depois cada perfil na
ordem cadastrada) e dentro dele pela ordem SPIN. `maxTokens` sobe para 8.000.

### 8.5 "Sugerir com IA" do cadastro do negócio

Botão no cartão "Negócio e clientes ideais": mesma amostra de conversas + briefing → IA propõe
objetivo e até 6 perfis (nome + como reconhecer). Preenche o formulário; só grava quando o gestor
clicar Salvar.

## 9. Telas (Entrega 1)

- **Cadências — cartão "Negócio e clientes ideais"** (topo, só gestor): objetivo, lista de perfis
  (nome, "como reconhecer"), [Sugerir com IA], [Salvar]. Ajuda com o exemplo da Ustulimp.
- **Painel do passo de pergunta (`StepPanel`)**: campo "Fase SPIN" (4 opções + ajuda com exemplo)
  e campo "Perfil" (Todos + perfis); em opções, "esta resposta define o perfil" (opcional).
- **Etapa vazia (`StageEmpty`)**: "Começar com modelo SPIN"; em etapa de contato, aviso "Etapa de
  tentativa de contato: normalmente sem perguntas".
- **Lista de passos da etapa**: selo do perfil em cada pergunta.
- **Chat, aba Atendimento**: seletor "Perfil do lead" (mostra "identificado pela IA" quando
  origem `ia`).
- **Ficha do lead**: perfil ao lado do Termômetro; motivo do Termômetro com rótulo SPIN.

## 10. Revisão semanal (Entrega 2)

Roda junto do job noturno (`leadScore/nightly.js`), 1x por semana por conta (guarda
`roteiro_weekly_runs(account_id, ran_at)`; roda se passou 7 dias), só conta com IA ligada e
roteiro publicado, dentro do orçamento de IA do roteiro. Lê a amostra de conversas dos últimos 7
dias (mesmo formato de 8.1) + roteiro publicado + perfis e grava em `roteiro_suggestions` tipos
novos: `new_question` (pergunta SPIN nova para um perfil/etapa), `new_profile` (perfil não
cadastrado que aparece nas conversas), além dos existentes `new_option` e `rewrite` (que segue
para A/B como hoje). O CHECK de `type` em `roteiro_suggestions` não aceita tipos novos: a tabela é reconstruída (cria nova, copia, troca o nome, mesmo padrão já usado na reconstrução de `cadence_attempts`). Não duplica sugestão ainda sem decisão. Aplicar `new_question` soma a
pergunta à cadência da etapa e publica (mesmo caminho de `applySuggestionLive`); aplicar
`new_profile` cria o perfil. Aparece na aba Sugestões existente com texto "da revisão semanal".

## 11. Erros

- IA falha → "A IA não respondeu agora. Monte à mão ou tente de novo."
- Fase inválida → 400 "Fase SPIN inválida."; perfil inválido → 400 "Perfil inválido.";
  mais de 6 perfis → 400 "Máximo de 6 perfis."
- Funil sem etapa de conversa → usa as não finais.
- Conta sem conversas → monta pelo briefing/modelo, sem erro.

## 12. Testes

Atualizar os testes de BANT para SPIN. Novos: migração (4 mapeamentos, idempotente); perfis
(CRUD, limite, apagar com perguntas); `appliesToLead` em próxima pergunta, trava, avanço
automático, cadência e Termômetro; perfil por IA (não sobrescreve manual), por opção
`sets_profile_key` e manual; `stageKind`; amostra de conversas (prioridade, cortes, teto, só da
conta, sem nome/telefone); IA com perfis, descoberta, realocação e completar fase. Suíte inteira +
`npm run build` + conferência no navegador. Entrega 2: escolha da semana, tipos novos de
sugestão, aplicar.

## 13. Fora do escopo

Treinador Global; critério do A/B; filtro da lista de leads por perfil; mudança no follow-up
"ao responder, mover para etapa".

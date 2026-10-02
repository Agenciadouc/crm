# Troca BANT → SPIN Selling no Roteiro de Qualificação — Desenho

Data: 02/10/2026 · Status: aprovado na conversa, aguardando revisão da spec escrita

## 1. Objetivo

Todas as perguntas de qualificação do CRM (modelo pronto, "Montar com IA", marcação manual,
rótulos do Termômetro) passam a seguir a metodologia **SPIN Selling** no lugar do BANT.

SPIN é uma sequência consultiva, não 4 checagens soltas:

| Chave interna  | Rótulo na tela           | Pra que serve                                         |
|----------------|--------------------------|-------------------------------------------------------|
| `situation`    | Situação                 | Fatos do cliente hoje (como faz, quem decide, prazo)  |
| `problem`      | Problema                 | Onde dói, o que não funciona                          |
| `implication`  | Implicação               | O que esse problema custa / causa se continuar        |
| `need_payoff`  | Necessidade de Solução   | Quanto vale resolver; cliente fala o ganho            |

Sucesso = gestor que clica "Começar com modelo" ou "Montar com IA" recebe perguntas SPIN na
ordem certa, só nas etapas em que o lead já está conversando; perguntas antigas BANT continuam
funcionando (respostas e pontos preservados), só com a etiqueta nova.

## 2. Decisões fechadas com o dono

1. **Redesenho de verdade:** acaba o limite de 1 pergunta por categoria. Ordem dentro da etapa:
   Situação → Problema → Implicação → Necessidade de Solução. Poucas de Situação, mais de
   Problema, mais ainda de Implicação, 1-2 de Necessidade de Solução.
2. **Todas continuam múltipla escolha com pontos** (inclusive Necessidade de Solução), porque só
   pergunta de opções pontua no Termômetro. Texto livre continua possível manualmente.
3. **Etapas de tentativa de contato não recebem pergunta de qualificação.** Ex.: "Novo Lead" e
   "Contato Feito" ficam só com a cadência de contato (que já existe). A qualificação SPIN começa
   na etapa em que o lead já respondeu (ex.: "Atendimento") em diante.
4. **"Respondeu → vira Atendimento" não é construído de novo:** já existe no follow-up
   (`on_reply_action` = mover para etapa, `on_reply_move_to_stage_id`). Fica como está.
5. **Migração das etiquetas antigas** (só troca a etiqueta; texto, opções, pontos e respostas
   dos leads ficam iguais):
   - `need` → `problem`
   - `timeline` → `situation`
   - `authority` → `situation`
   - `budget` → `need_payoff`
6. **Roteiro continua escrito uma vez** (por IA ou gestor); o atendimento segue a ordem escrita.
   Sem motor novo em tempo real.
7. **Treinador Global de IA fica para depois.** Este projeto só garante o rastro que ele vai
   precisar: cada pergunta continua com `question_key` estável + versão do roteiro (já existe) e
   agora com a fase SPIN, o que permite medir desempenho por fase entre contas no futuro.

## 3. Dados

- Nova coluna `roteiro_questions.spin TEXT` (valores: `situation`, `problem`, `implication`,
  `need_payoff` ou `NULL`). Adicionada com `ALTER TABLE ... ADD COLUMN` (compatível com o SQLite
  antigo do servidor; nada de DROP/RENAME COLUMN).
- Migração no boot, idempotente, em todas as versões (rascunho, publicada e históricas):
  `UPDATE roteiro_questions SET spin = CASE bant WHEN 'need' THEN 'problem' WHEN 'timeline' THEN
  'situation' WHEN 'authority' THEN 'situation' WHEN 'budget' THEN 'need_payoff' END
  WHERE spin IS NULL AND bant IS NOT NULL`.
- A coluna `bant` fica no banco (morta, sem leitura nem escrita no código novo) para não precisar
  recriar tabela.
- API: o campo `bant` some de requisições e respostas e vira `spin` (servidor e front sobem
  juntos, então não há cliente antigo para manter).

## 4. Peças

### 4.1 Modelo pronto SPIN — `server/services/roteiro/spinTemplate.js` (substitui `bantTemplate.js`)

`SPIN_QUESTIONS`, 6 perguntas de opções, obrigatórias, nesta ordem:

| Fase | Pergunta | Opções (pontos) |
|---|---|---|
| situation | Como você resolve isso hoje, {nome}? | Já uso algo e não estou satisfeito(a) (10) · Faço de um jeito improvisado (8) · Ainda não faço nada (3) |
| problem | O que mais te incomoda na forma como está hoje? | Atrapalha o dia a dia, é urgente (15) · Incomoda, mas dá pra levar (8) · Nada em especial, só pesquisando (0) |
| problem | Isso já aconteceu outras vezes ou foi algo pontual? | Acontece sempre (12) · Às vezes (6) · Foi só uma vez (0) |
| implication | E se continuar assim pelos próximos meses, o que isso te causa? | Perco dinheiro/clientes/tempo (15) · Fica chato, mas não muda muito (5) · Nada (0) |
| implication | Isso afeta mais alguém além de você (família, equipe, sócio)? | Sim, afeta outras pessoas (10) · Um pouco (5) · Só a mim (2) |
| need_payoff | Se isso estivesse resolvido, o que mudaria pra você? Quanto valeria resolver agora? | Mudaria muito, quero resolver já (15) · Seria bom, mas sem pressa (6) · Não mudaria muito (0) |

### 4.2 Etapa de contato × etapa de conversa — `server/services/roteiro/stageKind.js` (novo)

`isContactStage(stage)`: verdadeiro quando o nome normalizado (minúsculo, sem acento) contém
`novo`, `nova`, `contato`, `tentativa`, `prospec` ou `entrada`, e a etapa não é final.
`conversationStages(stages)`: etapas não finais que não são de contato, em ordem. Se todas forem
de contato (funil esquisito), devolve todas as não finais (não trava o gestor).

### 4.3 "Montar com IA" — `server/services/roteiro/aiDraft.js`

- Prompt troca a regra BANT pela SPIN: fases, ordem, quantidade (1-2 Situação, 2-3 Problema,
  2-3 Implicação, 1-2 Necessidade de Solução por etapa de conversa), "marque o campo spin",
  "etapas marcadas como tentativa de contato não recebem perguntas".
- A lista de etapas enviada à IA marca cada uma: `(tentativa de contato — sem perguntas)` ou
  `(em conversa — perguntas SPIN)`.
- Schema da ferramenta: `spin` com enum das 4 fases (sai `bant`).
- Saneamento: `spin` só vale em pergunta de opções; pode repetir fase (acaba o `usedBant`).
  Pergunta colocada em etapa de contato ou etapa inválida vai para a 1ª etapa de conversa.
- Garantia: se faltar alguma das 4 fases no resultado, entram as perguntas do modelo daquela fase
  na 1ª etapa de conversa.
- Ordenação final dentro de cada etapa: pela ordem SPIN (situation, problem, implication,
  need_payoff, sem fase por último), mantendo a ordem da IA dentro da mesma fase.

### 4.4 Modelo no funil inteiro — `repo.js` (`createBantDraft` → `createSpinDraft`)

Rota `POST /funnels/:funnelId/bant-template` → `/spin-template`. Soma ao rascunho as perguntas
do modelo das fases que ainda não aparecem no roteiro, na 1ª etapa de conversa. Validação aceita
só as 4 chaves SPIN ("Fase SPIN inválida.").

### 4.5 Modelo por etapa — `cadence/repo.js` + `cadencesRouter.js`

`bantStepQuestions` → `spinStepQuestions`: devolve as perguntas do modelo das fases que o funil
ainda não tem. Modo da rota `stages/:stageId/template` muda de `'bant'` para `'spin'`. Mensagens:
"O funil já tem perguntas das 4 fases do SPIN." e "A IA não sugeriu perguntas para esta etapa.
Tente o modelo SPIN." O gestor ainda pode aplicar o modelo em qualquer etapa que escolher
(decisão dele); o botão só aparece onde já aparece hoje.

### 4.6 Termômetro — `leadScore/inputs.js`

Rótulos do motivo: `situation` Situação, `problem` Problema, `implication` Implicação,
`need_payoff` Necessidade de Solução. Cálculo inalterado (proporção do máximo).

### 4.7 Front

- `roteiroApi.ts`: `BantKey` → `SpinKey`; `bant` → `spin`; `bantTemplate` → `spinTemplate`.
- `cadenceApi.ts`, `stageCadence.js/.d.ts`, `roteiroManager.js/.d.ts`: campo `spin`.
- `StepPanel.tsx`: campo "Fase SPIN" com as 4 opções e ajuda com exemplo:
  "Situação = como é hoje ('Como você faz isso hoje?'). Problema = onde dói. Implicação = o que
  isso causa se continuar. Necessidade de Solução = quanto vale resolver."
- `StageEmpty.tsx`: modo `'spin'`, botão "Começar com modelo SPIN".

### 4.8 Atendimento ao vivo — `leadRoteiro.js`

Expõe `spin` no lugar de `bant`. Sem outra mudança de comportamento.

## 5. Erros

- IA falha → mesma mensagem de hoje ("A IA não respondeu agora…").
- Fase inválida no salvamento → 400 "Fase SPIN inválida."
- Funil sem etapa de conversa → usa as não finais (4.2), nunca erro novo.

## 6. Testes

- Atualizar os testes que hoje cobrem BANT (repo, IA, rotas HTTP, cadência, termômetro,
  roteiroManager, stageCadence) para SPIN.
- Novos: migração (4 mapeamentos, idempotente, não mexe em quem já tem `spin`);
  `isContactStage`/`conversationStages`; IA com fases repetidas, pergunta em etapa de contato
  realocada, fase faltando completada, ordem SPIN dentro da etapa; modelo SPIN por funil e por
  etapa.
- Suíte inteira verde + `npm run build` + conferência no navegador (Cadências: modelo SPIN,
  Montar com IA, campo Fase SPIN; ficha do lead: motivo do Termômetro com rótulo SPIN).

## 7. Fora do escopo

Treinador Global de IA; mudança no critério do teste A/B; motor de pergunta em tempo real;
mudança no follow-up "ao responder, mover para etapa".

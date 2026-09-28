# Cadência da etapa — perguntas de qualificação dentro das cadências (design)

Data: 27/09/2026 · Base: branch `merge/github-2026-09-24` (ponta 210c30b, Roteiro + Termômetro já construídos)
Spec anterior (motor que continua valendo): `2026-09-25-roteiro-qualificacao-e-termometro-design.md`

## 1. Por que

O dono testou o Roteiro + Termômetro no navegador e achou:
- Tela "Qualificação" difícil: cheia de campos, não mostra que salvou, separada das cadências.
- Painel do Chat pesado: termômetro grande, aba Histórico repetida, roteiro longe.

Pedido: **por etapa, ver cadência e perguntas de qualificação juntas**, tudo ligado ao termômetro e às métricas, **unificando o que é parecido** e reaproveitando o que já existe.

## 2. Decisões do dono

1. Cada etapa tem **uma cadência** ("cadência da etapa"). **Pergunta** vira um tipo de passo da cadência. A tela "Qualificação" separada some.
2. **Follow-ups ficam à parte** (rede de segurança automática). A tela da etapa só mostra um link para o follow-up da etapa.
3. **Métricas e sugestões aparecem no próprio passo** (selo "respondem X% · fraca", sugestão com [Testar A/B] [Aplicar] [Ignorar]).
4. Chat: abas **Atendimento | Notas | Info**. Sai "Histórico". Termômetro numa linha (expande ao clicar). "Próximo passo" em destaque.
5. Lead entra na etapa → **cadência da etapa começa sozinha** (a anterior fecha). Cadências atuais viram **avulsas** (aplicadas à mão como hoje).
6. Construção pelo **caminho 1**: a cadência é a tela; o roteiro continua sendo o motor (trava, avanço automático, IA, termômetro, A/B, métricas).
7. **Salvar automático** com "Salvo ✓". Sem Rascunho/Publicar visíveis.
8. Jev (use-jev) fica para depois (teste separado de custo).

## 3. Modelo de dados

### 3.1 `cadences`
- `+ funnel_id INTEGER NULL`, `+ stage_id INTEGER NULL REFERENCES funnel_stages(id) ON DELETE SET NULL`.
- `stage_id` preenchido = cadência da etapa; nulo = avulsa.
- No máximo **uma cadência ativa por etapa** (índice único parcial `(stage_id) WHERE stage_id IS NOT NULL AND is_active = 1`).

### 3.2 `cadence_attempts`
- `action_type` passa a aceitar `'pergunta'`. A restrição CHECK atual exige **reconstruir a tabela** (criar nova, copiar tudo com os mesmos ids, conferir contagem, trocar), dentro de transação, idempotente.
- `+ question_key TEXT NULL`. Obrigatório quando `action_type='pergunta'` e aponta para a pergunta do roteiro da etapa.
- Passos passam a ser **atualizados por id** (não mais "apaga tudo e recria"), para não quebrar `lead_cadences.current_attempt_id`, asks e métricas.

### 3.3 `lead_cadences`
- `+ kind TEXT NOT NULL DEFAULT 'avulsa'` (`'etapa' | 'avulsa'`), `+ stage_id INTEGER NULL`.
- Um lead pode ter **uma de etapa ativa + uma avulsa ativa** ao mesmo tempo. Aplicar avulsa pausa só a avulsa anterior (como hoje), nunca a de etapa.

### 3.4 Roteiro (continua o motor)
- As perguntas continuam em `roteiro_versions/roteiro_questions` (texto, obrigatória, tipo, opções com pontos, BANT, dica IA).
- **Sincronização**: a lista de passos `pergunta` da cadência da etapa, na ordem, **é** a lista de perguntas daquela etapa no roteiro. Salvar a cadência grava o rascunho do roteiro e **publica em seguida** (versão nova só quando o conteúdo das perguntas muda). Versões continuam existindo por baixo (A/B, histórico), sem botão para o gestor.
- Desvios continuam no roteiro, editados na tela da etapa ("Se o cliente perguntar…").

### 3.5 Registro de envios (métrica de mensagem)
- `roteiro_asks` ganha `+ attempt_id INTEGER NULL`. Envio pelo botão [Enviar] de um passo **mensagem** grava um ask com `question_key = 'step-<attempt_id>'`, `source='button'`. Assim a mensagem ganha "respondem X%" pelo mesmo cálculo das perguntas (resposta em 24h, avançou, comprou).
- Ligação/visita/reunião/e-mail: métrica = "feitas X de Y leads" (contagem de passos concluídos em `lead_cadences`/histórico de execução).

## 4. Regras de funcionamento

### 4.1 Início e fim da cadência da etapa
- Hook único de troca de etapa (`stageMove` → `onMoved`): fecha a `lead_cadences` de `kind='etapa'` ativa (status `completed`) e, se a nova etapa tem cadência ativa, cria a nova (`kind='etapa'`, `current_attempt_id` = primeiro passo não concluído).
- Etapas finais (ganho/perdido): só fecham, não abrem.
- Nunca envia mensagem sozinho (cadências continuam manuais; o agendador só marca a tarefa como "para hoje").

### 4.2 Próximo passo
- = primeiro passo, na ordem, ainda não concluído.
- **Pergunta** concluída = existe resposta em `lead_answers` (vendedor ou IA). Pergunta enviada e sem resposta = "aguardando resposta" (continua sendo o próximo, com o botão trocado para [Já sei a resposta]).
- **Mensagem** concluída = enviada pelo botão do passo **ou** [Feito].
- **Ligação/visita/reunião/e-mail** concluída = [Feito].
- Concluir o último passo marca a cadência `completed`.
- Continua valendo: trava por obrigatórias pendentes, avanço automático com [Desfazer], janela "falta saber", gestor força com motivo.

### 4.3 Salvamento automático
- Editor manda a mudança 500 ms após a última digitação (por passo). Mostra "Salvando…" → "Salvo ✓"; erro → "Não salvou. [Tentar de novo]" e mantém o texto na tela.
- Mudança só de ordem/tipo/texto de mensagem não gera versão nova do roteiro; mudança em pergunta gera.

## 5. Telas

### 5.1 Gestor — "Cadências e Follow-ups"
- Topo: seletor de funil + chips das etapas (`Novo Lead · 4 passos · 2 perguntas`). Seção "Avulsas" abaixo.
- Etapa aberta: lista compacta, 1 linha por passo: número, tipo (ícone + nome), texto curto, "obrigatória" (se pergunta), dia, selo de métrica.
- Clicar no passo abre painel pequeno:
  - Pergunta: texto (placeholder "ex.: Para quando é o seu evento, {nome}?"), chave "Obrigatória (trava a etapa)", Respostas: "Livre" ou "Opções" (cada opção: nome + pontos, placeholder "ex.: Até 30 dias" / "ex.: 15"). "Mais opções" recolhido: dica para a IA, BANT.
  - Mensagem: texto + dia. Ligação/visita/reunião/e-mail: descrição + roteiro de ligação + dia (campos atuais).
- Reordenar: arrastar ou ↑↓. [+ Passo] com escolha do tipo.
- Sugestões no próprio passo (seller_phrasing, rewrite, new_option, reorder, new_deviation vira aviso na seção de desvios).
- Abaixo: "Se o cliente perguntar…" (desvios, recolhido) e "Follow-up automático desta etapa: <nome> [ver]" (ou "nenhum [criar]").
- Etapa vazia: exemplo + [Começar com modelo] (BANT) + [Montar com IA].
- ⚙ no canto: mínimo de resposta %, prazo de resposta (h), aviso de lead quente (min), com HelpTip e exemplo.
- Regra "explica com exemplo" mantida: todo número com o porquê, placeholders "ex.:", "?" nos títulos.

### 5.2 Dashboard
- Quadro "Taxa de venda por faixa do termômetro" sai da Qualificação e vai para o Dashboard.

### 5.3 Chat — painel direito
- Abas: **Atendimento** (padrão) | **Notas** | **Info**. Aba Histórico removida (histórico continua na ficha do lead).
- Atendimento:
  - Termômetro em 1 linha (ícone da faixa, nota, faixa, "▸ porquê"); clique expande o termômetro completo ali mesmo.
  - Etapa com [mudar].
  - PRÓXIMO PASSO: pergunta → [Perguntar] [Já sei a resposta]; mensagem → [Enviar] [Feito]; ligação/visita → [Feito].
  - "Depois:" próximos 2 passos em uma linha.
  - "✓ Feitos (N)" recolhido, com resposta salva, origem (IA/vendedor) e lápis para corrigir.
  - Resposta da IA: "IA respondeu: <resposta> [corrigir]". Avanço: faixa "Avançou para X [Desfazer]".
  - Desvio: caixinha "Ele perguntou de <assunto> → sugestão: … [Usar]".
  - Reconhecimento "Você perguntou …? [Sim] [Não]" continua.
- Info: Vendas, Observações, Tags, cadência avulsa, Follow-ups (como hoje).

### 5.4 Ficha do lead
- Termômetro completo + cadência da etapa inteira + respostas de todas as etapas (componente `RoteiroCard mode='full'` adaptado).

### 5.5 Menu
- Item "Qualificação" sai. Rota `/qualifications` redireciona para Cadências (aba da etapa).

## 6. Migração (1 vez, idempotente, sem apagar nada)
1. Reconstruir `cadence_attempts` com o novo CHECK (se ainda não aceita 'pergunta').
2. Para cada etapa com perguntas publicadas no roteiro e sem cadência de etapa: criar cadência `"<Etapa>"` com `stage_id`, passos `pergunta` na ordem do roteiro.
3. Leads ativos em etapas com cadência (não finais): criar `lead_cadences kind='etapa'` apontando para o primeiro passo não concluído. Nenhuma mensagem sai.
4. Cadências existentes ficam avulsas; `lead_cadences` existentes ficam `kind='avulsa'`.
5. Flag em `app_settings` (`cadencia_etapa_migrada`). Falha isolada por conta, com log.

## 7. Segurança e correções junto
- Rotas de cadências passam a checar `account_id` em **todas** as operações por id (`/:id`, `/:id/attempts`, `/:id/assign`, `/lead-cadence/:lcId/*`, `/lead/:leadId`). Hoje várias não checam (buraco entre contas) → 404 para cadência/lead de outra conta.
- Atendente só mexe em lead que acessa (`canAtendenteAccessLead`).

## 8. O que NÃO muda
- Follow-ups (automáticos, anti-ban, números de disparo).
- Motor do roteiro/termômetro: cálculo da nota, esfriamento, avisos, IA (extração, montar, sugestões), A/B, trava, avanço automático, CAPI.
- Cadências nunca enviam mensagem sozinhas.

## 9. Erros
- Salvar passo falhou → aviso no passo, texto preservado, [Tentar de novo].
- Pergunta sem `question_key` válido → 400 "Esta pergunta não está no roteiro da etapa."
- Mudança de etapa com cadência sem passos → só fecha a anterior.
- Migração: erro por conta registrado; flag marcada ao fim para não travar o boot.

## 10. Testes
- Unidade/serviço: sincronização passo pergunta ↔ roteiro (criar, editar, reordenar, apagar — apagar cancela A/B da pergunta); início/fechamento na troca de etapa (inclui final e desfazer); próximo passo (pergunta respondida pela IA conta); coexistência etapa + avulsa; métrica de mensagem por `step-<id>`; migração 2x sem duplicar; reconstrução da tabela preserva ids e contagem.
- HTTP: rotas de cadências com checagem de conta (404) e atendente (403); salvar passo por id.
- Front: lógica pura em `.js` testável (próximo passo, resumo da etapa, ordem); `tsc` sem erros novos; `vite build`.
- Conferência final no navegador com o dono.

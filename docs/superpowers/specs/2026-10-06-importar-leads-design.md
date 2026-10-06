# Importar leads (planilha .xlsx / .csv) — Desenho

Data: 06/10/2026. Aprovado em conversa pelo dono. Ramo: `feat/funil-automatico` (worktree `spin`).

## 1. Objetivo

O gestor sobe uma lista de leads de fora (Excel ou CSV), escolhe para qual campo do CRM vai cada coluna — ou se não quer aquela informação — confere o resultado e importa. Nada sai automático para o cliente.

Decisões do dono:
- Origem: arquivo **.xlsx** e **.csv** (não colar, não CRM específico).
- Telefone que já existe no CRM: **completar só o que está vazio** (nunca apagar nem trocar).
- Automático: **nada sozinho** (sem boas-vindas, agente, distribuição com aviso, evento Meta). A cadência da etapa aparece no "Próximo passo" normalmente.
- Coluna sem campo igual no CRM: **"Informação extra"** (guardada no lead com o nome da coluna e mostrada na ficha/Chat) ou **"Não importar"**.

## 2. Onde fica e quem usa

- Botão **[Importar]** na tela Leads, ao lado de [Exportar]. Só `gerente` e `super_admin`.
- Janela com 4 passos: **Arquivo → Ligar campos → Para onde vão → Conferir e importar**, e um resumo no fim.

## 3. Leitura do arquivo (no navegador)

- O arquivo é lido no navegador; o servidor recebe só as linhas já ligadas (JSON). O arquivo não é guardado.
- `.csv`: biblioteca `papaparse` (detecta separador `,` ou `;`, UTF-8; arquivo em Latin-1 é relido como Latin-1 quando aparecem caracteres inválidos).
- `.xlsx`: biblioteca `read-excel-file`. Planilha com várias abas: o gestor escolhe a aba (padrão a 1ª).
- 1ª linha = cabeçalho. Linhas totalmente vazias são ignoradas.
- Limite: **5.000 linhas** por importação (acima disso: "Divida o arquivo em partes de até 5.000 linhas").
- Arquivo de outro tipo, vazio ou ilegível: mensagem clara ("Não consegui ler este arquivo. Salve como .xlsx ou .csv e tente de novo.").

## 4. Ligar campos

Uma linha por coluna: nome da coluna, até 3 valores de exemplo, e um seletor "Vai para":

| Opção | Coluna do lead |
|---|---|
| Nome | `name` (duas colunas em Nome = juntadas com espaço, na ordem da planilha) |
| Telefone (obrigatório) | `phone` |
| E-mail | `email` |
| Cidade | `city` (padronizada por `resolveCity`) |
| Estado (UF) | `state` |
| Empresa | `empresa` |
| Instagram | `instagram` (sem `@` e sem URL) |
| CPF/CNPJ | `cpf_cnpj` |
| Observações | `notes` (duas colunas = juntadas em linhas separadas) |
| Valor estimado | `value_estimated` (aceita `1.234,56`, `R$ 1234`) |
| Origem | `source_detail` |
| Tags | tags (valores separados por vírgula ou `;`) |
| Informação extra | `custom_fields[<nome da coluna>]` |
| Não importar | — |

- **Sugestão automática** pelo nome da coluna (sem acento, minúsculo): nome/nome completo/name/cliente → Nome; telefone/celular/whatsapp/fone/phone/tel → Telefone; email/e-mail → E-mail; cidade/municipio → Cidade; estado/uf → Estado; empresa/razao social/loja → Empresa; instagram/insta → Instagram; cpf/cnpj/documento → CPF/CNPJ; obs/observacao/observacoes/nota → Observações; valor/ticket → Valor estimado; origem/fonte/source → Origem; tag/tags/etiqueta → Tags; qualquer outra → Informação extra.
- Cada campo do CRM (exceto Nome, Observações e Informação extra) só pode ser escolhido por uma coluna; escolher de novo tira da coluna anterior.
- [Próximo] só libera com uma coluna em Telefone.

## 5. Para onde vão

- **Funil e etapa**: funis de Vendas da conta (Recompra fora); padrão = funil padrão, 1ª etapa não final.
- **Vendedor**: "Ninguém" (padrão) / um vendedor / "Dividir igual entre os vendedores" (rodízio na ordem da lista, só usuários `atendente` ativos da conta).
- **Tipo de contato**: Lead (padrão) / Cliente / Revendedor / Interno (`contact_type_origin = 'lista'`).
- **Tag automática**: "Importado DD/MM – <nome do arquivo sem extensão>" (até 60 caracteres), aplicada em todos os leads da importação (novos e completados). Desligável.

## 6. Conferir (prévia, sem gravar)

O servidor recebe as linhas ligadas + destino em modo **prévia** e devolve:
- **Novos**: quantos serão criados.
- **Já existem**: telefone já é de um lead da conta → serão completados (quantos campos serão preenchidos no total).
- **Não entram**, com motivo por linha: "sem telefone", "telefone inválido" (menos de 10 dígitos depois de limpar), "repetido na planilha" (as linhas com o mesmo telefone viram uma só: a primeira manda, as outras só completam o que faltou).
- Até 5 exemplos de cada grupo (nome + telefone mascarado `(48) 9****-0000`).

[Importar] grava exatamente o que a prévia mostrou (mesmas regras, recalculadas no servidor na hora).

## 7. Regras da gravação

- **Conta**: tudo filtrado por `req.accountId`; funil, etapa, vendedor e tags conferidos como da conta (senão 400).
- **Telefone**: `normalizePhone` (55 + DDD + 9); comparação com os existentes por `phoneCompareKey` (mesma regra de dedup do WhatsApp) dentro da conta, incluindo leads arquivados/inativos e bloqueados.
- **Novo lead**: insere em `leads` com funil/etapa/vendedor/tipo escolhidos, `source = 'importacao'`, `source_detail` (coluna Origem ou nome do arquivo), campos ligados, `custom_fields` (JSON `{ "Tamanho da loja": "120 m²" }`); `stage_history` com `trigger_type = 'import'`.
- **Lead existente**: só preenche coluna vazia (`NULL` ou `''`); `custom_fields` = soma das chaves novas (não troca chave existente); tags somadas; **não muda** etapa, funil, vendedor nem tipo de contato.
- **Nada automático**: a gravação NÃO usa `getOrCreateLead`/`leadIntake` (que distribuem e avisam); NÃO chama handoff, boas-vindas, agente, CAPI, roleta com aviso. Não move etapa por regra. A cadência da etapa do lead novo é aberta como num lead criado à mão (mesma função usada no cadastro manual).
- **Uma transação** por importação: erro no meio = nada gravado, mensagem "Nada foi importado. Tente de novo." + log.
- Textos cortados em tamanhos seguros (nome 200, e-mail 200, observações 5.000, informação extra: 50 chaves, valor 500 caracteres).
- Fim: SSE `lead:updated { bulk: true }` para as telas abertas recarregarem.

## 8. Resumo

"**230 criados**, **12 completados**, **5 não entraram**" + [Ver leads importados] (abre Leads filtrado pela tag automática) + [Baixar os que não entraram] (CSV gerado no navegador com as colunas originais + coluna "Motivo").

## 9. Informação extra na tela

- Ficha do lead (`LeadDetail`) e aba Info do Chat: bloco "Informações extras" com `chave: valor` (só aparece se houver), editável como os outros dados do contato (o `PUT /leads/:id` já aceita `custom_fields`).

## 10. API

- `POST /api/leads/import/preview` body `{ rows: Row[], destination, fileName }` → `{ new_count, existing_count, filled_fields, skipped: [{ row, reason }], samples }`
- `POST /api/leads/import` mesmo body → `{ created, updated, skipped: [{ row, reason }], tag_id }`
- `Row` = `{ row: number (linha na planilha), fields: { name?, phone?, email?, city?, state?, empresa?, instagram?, cpf_cnpj?, notes?, value_estimated?, source_detail?, tags?: string[] }, extra: Record<string,string> }`
- `destination` = `{ funnel_id, stage_id, attendant: { mode: 'none'|'one'|'split', user_id? }, contact_type, auto_tag: boolean }`
- Router de fábrica `createLeadImportRouter(db, { broadcast })` (testável, padrão de `cadencesRouter`), serviço `server/services/leadImport/` puro (recebe `db`).
- Corpo até 5.000 linhas: limite do `express.json` desta rota = 10 MB.

## 11. Erros e limites

- Mais de 5.000 linhas: recusado no navegador e no servidor (400).
- Atendente chamando a rota: 403. Destino de outra conta: 400.
- Nenhuma linha válida: [Importar] desligado, com o motivo.
- Planilha com cabeçalho repetido ("Telefone", "Telefone"): o segundo vira "Telefone (2)".

## 12. Testes

- Serviço: sugestão de campos pelo cabeçalho; limpeza de telefone/valor/instagram; dedup na planilha; existente só completa (não troca, soma tags e extras); destino de outra conta recusa; rodízio de vendedor; transação desfaz tudo em erro; nada automático (nenhuma mensagem, nenhum `stage_history` além do `import`, nenhum CAPI).
- HTTP: permissões (atendente 403, outra conta), prévia não grava, limite de linhas.
- Front: leitura de CSV (`,`/`;`, Latin-1) e XLSX com função pura de "linhas → Row[]" testada no `node --test`.
- Navegador: importar um .xlsx e um .csv reais de teste, conferir prévia, resumo, ficha com Informações extras.

## 13. Fora desta versão

- Desfazer uma importação inteira (a tag automática permite achar e mover/arquivar em massa).
- Colar da planilha; modelos prontos por CRM de origem; importar vendas/histórico.
- Dependências novas só no front: `papaparse`, `read-excel-file` (compatíveis com Vite 4 / Node 16 no build).

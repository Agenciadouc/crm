# CRM

Sistema completo de CRM para captação, qualificação e conversão de leads, com atendimento multicanal via WhatsApp e automação de relacionamento. Multi-tenant, com isolamento estrito entre contas e suporte a equipes comerciais com papéis distintos.

---

## Funcionalidades

### Captação e Gestão de Leads
- Cadastro manual ou automático via webhooks de origens externas (Meta Lead Ads, formulários, integrações HTTP)
- Importação em lote a partir de planilhas
- Atribuição automática ou manual a vendedores, com balanceamento configurável por conta
- Histórico completo de interações por lead — mensagens, mudanças de estágio, anotações internas, transferências
- Sistema de tags personalizáveis e campos customizados por conta
- Filtros avançados combináveis por origem, estágio, vendedor responsável, período, tags e campos custom
- Busca textual por telefone, nome, e-mail e conteúdo de mensagens

### Pipeline de Vendas
- Visualização em colunas Kanban com drag-and-drop entre estágios
- Estágios totalmente customizáveis por conta — nome, ordem, cor, regras de transição
- Métricas de conversão por etapa (taxa de conversão entre estágios, tempo médio, gargalos)
- Alertas configuráveis para leads parados há mais tempo que o limite definido por estágio
- Histórico de transições com timestamp e usuário responsável

### Atendimento Multicanal via WhatsApp
- Integração nativa com **Evolution API** para WhatsApp Business
- Inbox unificado com todas as conversas em tempo real, ordenado por última atividade
- Suporte completo a tipos de mensagem: texto, áudio, imagem, vídeo, documento, localização, contato
- Marcação como lido/não lido, transferência entre vendedores, atribuição de conversas
- Templates reutilizáveis com variáveis dinâmicas (nome do lead, dados customizados)
- Indicadores de digitação e status de leitura quando suportado pelo provider
- Histórico persistido com paginação eficiente

### Broadcasts Segmentados
- Disparos em massa para listas dinâmicas baseadas em critérios combinados
- Segmentação por estágio, tags, origem, período de cadastro, campos customizados
- Personalização por variáveis (substituição de placeholders no momento do envio)
- Agendamento futuro com worker de scheduler interno
- Throttling automático para respeitar rate limits do WhatsApp Business
- Relatório completo de entrega: enviadas, entregues, lidas, com erro, respostas
- Re-envio automático para falhas transitórias

### Cadências Automáticas
- Sequências configuráveis de mensagens com delays customizáveis entre cada passo
- Disparo automático ao entrar em estágio específico do pipeline
- Pausa automática quando o lead responde, evitando interrupção de conversa em andamento
- Editor visual para criação e ajuste de fluxos
- Métricas de engajamento por etapa da cadência (taxa de abertura, resposta, conversão)
- Suporte a múltiplas cadências simultâneas por lead com priorização

### Gestão de Equipe
- Sistema de papéis hierárquico — admin, gerente, vendedor — com permissões granulares
- Atribuição de contas e leads por vendedor com filtragem automática de visibilidade
- Métricas individuais de desempenho: leads atribuídos, taxa de conversão, tempo médio de atendimento, volume de mensagens
- Auditoria de ações sensíveis (exclusão, alteração de estágio, transferência)

### Dashboard e Métricas
- Visão geral em tempo real: leads ativos no funil, conversões do período, atendimentos em aberto, mensagens não lidas
- Gráficos de evolução temporal por origem, estágio e vendedor
- Funil de conversão visual com taxas calculadas entre cada etapa
- Relatórios filtráveis por vendedor, origem, período e tags
- Exportação de dados em CSV para análise externa

### Integrações
- **Meta (Facebook/Instagram)** — webhook verificado para captura automática de Lead Ads, com mapeamento configurável de campos
- **Evolution API** — gateway WhatsApp Business com webhook bidirecional
- Webhooks de saída configuráveis para integração com ferramentas externas em eventos relevantes (lead criado, estágio mudado, conversão)
- API REST interna documentada para extensões customizadas

### Tempo Real
- Server-Sent Events (SSE) com canais segmentados por conta e usuário, garantindo isolamento multi-tenant no nível de conexão
- Atualização instantânea de novos leads, mensagens recebidas e mudanças de estágio sem necessidade de refresh
- Notificações in-app para eventos relevantes ao usuário logado

---

## Arquitetura

Aplicação full-stack monolítica com separação clara entre camadas e padrões consistentes em todo o backend:

- **API REST** organizada por domínio (`leads`, `accounts`, `messages`, `broadcasts`, `integrations`, `webhooks`, `users`, `dashboard`)
- **Camada de dados** sobre SQLite via `better-sqlite3` com schema versionado e migrations idempotentes na inicialização
- **Realtime** via canal SSE roteado por conta e usuário, com cleanup automático de conexões inativas
- **Scheduler interno** baseado em cron para execução de cadências, broadcasts agendados, atualizações periódicas de status e renovação de credenciais
- **Webhooks de entrada** com endpoints públicos verificados por token secreto antes de processar payload
- **Autenticação JWT stateless** com middleware unificado para validação em rotas protegidas
- **Frontend SPA** servido como estático pela própria API, com base path `/crm/`

### Multi-tenancy

Isolamento entre contas é enforced no nível de SQL, não no nível de aplicação. Toda query de domínio inclui filtro obrigatório por `client_id` derivado do JWT do usuário logado. Esta abordagem elimina classes inteiras de bugs de vazamento de dados entre tenants e simplifica auditoria.

## Stack

**Backend**
- Node.js + Express 4
- better-sqlite3 (SQLite embarcado)
- jsonwebtoken (autenticação JWT)
- bcryptjs (hash de senhas)
- node-fetch (chamadas HTTP de saída)

**Frontend**
- React 19
- TypeScript 5
- Vite 4
- React Router 7
- Recharts (visualizações)
- Lucide React (ícones)

**Infraestrutura**
- SQLite como banco primário — zero overhead de configuração, performance superior em workloads de leitura intensa
- PM2 para gerenciamento de processo em produção com logs estruturados e restart automático
- Proxy reverso com TLS termination

## Segurança

- Senhas armazenadas com bcrypt (salt + hash, custo configurável)
- Tokens JWT assinados com secret rotacionável e expiração configurável
- Webhooks de entrada verificados por token secreto antes de qualquer processamento
- Multi-tenancy enforced em SQL via filtro por `client_id` em toda query de domínio
- Validação de input em todas as rotas que aceitam payload externo
- CORS configurado por ambiente com whitelist explícita em produção
- Logs estruturados sem exposição de credenciais ou conteúdo sensível de mensagens

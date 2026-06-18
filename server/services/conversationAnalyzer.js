// Conversation Intelligence V2 — analisador via Claude Haiku.
// Salva insights estruturados + erros + acertos + análise por participante + alertas operacionais.
// Tool use forçada pra garantir retorno em JSON validável.
// Idempotente: UPSERT em conversation_insights por lead_id.
// Insights V1 antigos (insights_version=1) ficam intactos; após re-análise viram version=2.

import db from '../db.js'
import { callHaiku } from './anthropicClient.js'

// ─── System prompt V2 (cacheável — Anthropic cache_control ephemeral em anthropicClient) ───
const SYSTEM_PROMPT_V2 = `Voce e um analista de qualidade de atendimento comercial via WhatsApp.

Vou te passar uma conversa entre lead, atendente humano, gerente e/ou bot. Analise SEMANTICAMENTE a qualidade comercial dessa conversa. NAO calcule metricas matematicas (tempo, contagem etc — ja vem pre-computado em precomputed_metrics).

ESCOPO: identificar erros, acertos, riscos, oportunidades de venda e proxima acao recomendada — com evidencia direta (message_id).

═══ SCORE ═══

Atribua nota 0-100 (conversation_score) e tambem sub-scores:
- velocidade_sla (0-15): SLA de resposta foi respeitado?
- abertura (0-10): primeira mensagem cordial, personalizada, identificacao clara?
- diagnostico (0-20): fez boas perguntas pra entender necessidade, dor, contexto, decisor?
- qualificacao (0-15): identificou se e ICP, urgencia, orcamento, autoridade?
- conducao_comercial (0-15): explicou valor, conectou produto com dor, manteve dominio?
- objecoes (0-10): tratou objecoes (preco/duvida/prazo) com tecnica?
- proximo_passo (0-10): toda mensagem encaminhou pra acao concreta?
- organizacao_crm (0-5): mudou stage, registrou info?

Soma dos sub-scores DEVE ser conversation_score (0-100). Confira a aritmetica.

Faixas:
- 80-100: excelente, fechou ou avancou muito a venda
- 60-79: bom, conversa fluindo, sem erros graves
- 40-59: mediano, varios pontos de melhora
- 20-39: ruim, perdeu oportunidades obvias
- 0-19: pessimo, perdeu venda ou foi grosseiro

═══ TEMPERATURA E POTENCIAL ═══

- temperatura_lead: 'frio' | 'morno' | 'quente'
  - quente: pediu preco, prazo, urgencia, quer comprar
  - morno: interesse, explorando, faz perguntas
  - frio: pouco engajado, respostas curtas, nao demonstra interesse real

- fit_icp: 0-100 (quanto este lead se parece com cliente ideal — empresa, setor, porte, sinais)
- chance_conversao: 0-100 (probabilidade subjetiva de virar venda)

═══ ACERTOS E ERROS ═══

Cada erro/acerto DEVE ter evidence_message_ids — array com 1-3 message.id de evidencia. SEM EVIDENCIA, NAO REGISTRE.

Cada erro tem:
- actor_type: 'bot' | 'atendente' | 'gerente' | 'processo'
- code: tente usar codigos do catalogo padrao:
  - velocidade.demorou_resposta_inicial, velocidade.abandonou_meio_conversa, velocidade.demorou_apos_interesse
  - diagnostico.nao_perguntou_necessidade, diagnostico.pulou_para_preco, diagnostico.nao_identificou_decisor
  - conducao.nao_pediu_proximo_passo, conducao.mensagem_robotica, conducao.nao_explicou_valor, conducao.nao_ofereceu_proposta
  - objecao.ignorou_objecao_preco, objecao.aceitou_vou_pensar, objecao.defensivo
  - crm.nao_mudou_etapa, crm.nao_registrou_motivo_perda
  - bot.nao_transferiu, bot.entendeu_errado, handoff.sem_contexto
  - Se nao houver code adequado, deixe null e descreva no campo description.
- gravity: 'baixa' | 'media' | 'alta' | 'critica'
- description, impact, how_to_fix (concretos)

Regra de atribuicao: quem estava responsavel pela conversa no momento do erro recebe o erro. Bot errou antes do handoff = erro do bot. Atendente recebeu lead e nao continuou = erro do atendente. Handoff sem contexto = erro 'processo'.

═══ ANALISE POR PARTICIPANTE ═══

participants_analysis: array com 1 entrada por ator que aparece na conversa (bot, atendente principal, gerente se interveio). Para cada um:
- actor_type, actor_id (se houver — sent_by_user_id ou ai_agent_id), actor_name
- score 0-100
- acertos_summary, erros_summary (1-2 frases cada)
- recomendacao (1 frase)

═══ ANALISE DO BOT ═══

bot_analysis: SO se houve bot na conversa. Avalie:
- score 0-100
- respondeu_corretamente (bool)
- coletou_dados (bool — coletou nome, intencao, etc)
- deveria_transferir (bool — tinha sinal claro de quente que pedia humano)
- erro_entendimento (bool)
- summary (1 frase)
Se nao houve bot, retorne null.

═══ ANALISE DE HANDOFF ═══

handoff_analysis: SO se houve transferencia bot→humano OU atendente→outro atendente. Avalie:
- houve_handoff (bool)
- com_contexto (bool — quem recebeu tinha info suficiente?)
- info_perdida (bool)
- responsavel_no_momento_critico
- summary (1 frase)
Se nao houve handoff, retorne null.

═══ OUTROS CAMPOS ═══

- resumo: 1-2 frases sobre estado atual.
- status_recomendado: 'follow_up_urgente' | 'agendar_reuniao' | 'enviar_proposta' | 'manter_morno' | 'arquivar' | 'esperar_lead'
- proxima_melhor_acao: frase de acao concreta
- mensagem_retomada: DRAFT de mensagem pra reabordar o lead. Texto pronto pra atendente copiar/colar. Mantenha tom da conversa. SE nao precisar retomada, string vazia.
- objecoes: array de strings (objecoes que o lead levantou — 'preco', 'prazo', 'confianca'...)
- motivos_perda: array de strings (SO se chance_conversao baixa: 'preco muito alto', 'fora do ICP', 'concorrente fechou'...)
- riscos: array de strings ('lead esfriando', 'gerente precisa intervir', 'bot loop')
- coaching_recomendado: 1-2 frases pro vendedor melhorar — generico mas acionavel
- prioridade_revisao: 'baixa' | 'media' | 'alta' | 'critica' — urgencia pro gerente revisar
- confidence_score: 0..1 — sua confianca na analise. Baixe se conversa for muito curta, ambigua ou sem contexto.

Use a tool save_insights_v2. NAO retorne texto livre.`

const TOOL_SAVE_INSIGHTS_V2 = {
  name: 'save_insights_v2',
  description: 'Salva analise estruturada V2 da conversa (score, erros com evidencia, participantes, bot, handoff).',
  input_schema: {
    type: 'object',
    properties: {
      conversation_score: { type: 'integer', minimum: 0, maximum: 100 },
      scores: {
        type: 'object',
        properties: {
          velocidade_sla: { type: 'integer', minimum: 0, maximum: 15 },
          abertura: { type: 'integer', minimum: 0, maximum: 10 },
          diagnostico: { type: 'integer', minimum: 0, maximum: 20 },
          qualificacao: { type: 'integer', minimum: 0, maximum: 15 },
          conducao_comercial: { type: 'integer', minimum: 0, maximum: 15 },
          objecoes: { type: 'integer', minimum: 0, maximum: 10 },
          proximo_passo: { type: 'integer', minimum: 0, maximum: 10 },
          organizacao_crm: { type: 'integer', minimum: 0, maximum: 5 },
        },
        required: ['velocidade_sla', 'abertura', 'diagnostico', 'qualificacao', 'conducao_comercial', 'objecoes', 'proximo_passo', 'organizacao_crm'],
      },
      resumo: { type: 'string' },
      temperatura_lead: { type: 'string', enum: ['frio', 'morno', 'quente'] },
      fit_icp: { type: 'integer', minimum: 0, maximum: 100 },
      chance_conversao: { type: 'integer', minimum: 0, maximum: 100 },
      status_recomendado: { type: 'string', enum: ['follow_up_urgente', 'agendar_reuniao', 'enviar_proposta', 'manter_morno', 'arquivar', 'esperar_lead'] },
      proxima_melhor_acao: { type: 'string' },
      mensagem_retomada: { type: 'string' },
      acertos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            actor_type: { type: 'string', enum: ['bot', 'atendente', 'gerente', 'processo'] },
            code: { type: ['string', 'null'] },
            description: { type: 'string' },
            impact: { type: 'string' },
            evidence_message_ids: { type: 'array', items: { type: 'integer' } },
          },
          required: ['actor_type', 'description', 'evidence_message_ids'],
        },
      },
      erros: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            actor_type: { type: 'string', enum: ['bot', 'atendente', 'gerente', 'processo'] },
            code: { type: ['string', 'null'] },
            category: { type: 'string' },
            gravity: { type: 'string', enum: ['baixa', 'media', 'alta', 'critica'] },
            description: { type: 'string' },
            impact: { type: 'string' },
            how_to_fix: { type: 'string' },
            evidence_message_ids: { type: 'array', items: { type: 'integer' } },
          },
          required: ['actor_type', 'gravity', 'description', 'evidence_message_ids'],
        },
      },
      objecoes: { type: 'array', items: { type: 'string' } },
      motivos_perda: { type: 'array', items: { type: 'string' } },
      riscos: { type: 'array', items: { type: 'string' } },
      participants_analysis: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            actor_type: { type: 'string', enum: ['bot', 'atendente', 'gerente'] },
            actor_id: { type: ['integer', 'null'] },
            actor_name: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            acertos_summary: { type: 'string' },
            erros_summary: { type: 'string' },
            recomendacao: { type: 'string' },
          },
          required: ['actor_type', 'actor_name', 'score'],
        },
      },
      bot_analysis: {
        type: ['object', 'null'],
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
          respondeu_corretamente: { type: 'boolean' },
          coletou_dados: { type: 'boolean' },
          deveria_transferir: { type: 'boolean' },
          erro_entendimento: { type: 'boolean' },
          summary: { type: 'string' },
        },
      },
      handoff_analysis: {
        type: ['object', 'null'],
        properties: {
          houve_handoff: { type: 'boolean' },
          com_contexto: { type: 'boolean' },
          info_perdida: { type: 'boolean' },
          responsavel_no_momento_critico: { type: 'string' },
          summary: { type: 'string' },
        },
      },
      coaching_recomendado: { type: 'string' },
      prioridade_revisao: { type: 'string', enum: ['baixa', 'media', 'alta', 'critica'] },
      confidence_score: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['conversation_score', 'scores', 'resumo', 'temperatura_lead', 'fit_icp', 'chance_conversao', 'status_recomendado', 'proxima_melhor_acao', 'erros', 'acertos', 'prioridade_revisao', 'confidence_score'],
  },
}

const MAX_MSGS_IN_CONTEXT = 30
const MAX_CONTENT_LEN_PER_MSG = 500

// ─── Incremental analysis ───
// Anti-drift triggers: forca FULL re-analise mesmo tendo insight v2 valido.
const INCR_MAX_COUNT = 5            // apos 5 incrementais consecutivos, proxima e FULL
const INCR_MAX_DAYS = 7             // FULL pelo menos a cada 7 dias
const INCR_MAX_NEW_MSGS_SINCE_FULL = 50  // >50 msgs novas desde ultimo FULL => FULL
const INCR_TAIL_CONTEXT_MSGS = 3    // qts msgs anteriores ao corte mando como contexto (read-only)
const INCR_COST_PER_LEAD_USD = 0.003  // estimativa pra modal; calibrar com logs reais
const FULL_COST_PER_LEAD_USD = 0.012  // estimativa pra modal; igual atual

/**
 * Decide o modo de analise pra um lead: 'skip' | 'incremental' | 'full'.
 * Centraliza a logica de checkpoint + anti-drift. Usado tanto no batch
 * (filtro de candidates) quanto no proprio analyzeConversation (defesa em profundidade).
 */
export function decideAnalysisMode(leadId) {
  const ci = db.prepare(`
    SELECT id, insights_version, last_message_id, incremental_count,
           last_full_analysis_at, last_full_message_id
    FROM conversation_insights WHERE lead_id = ?
  `).get(leadId)

  const maxRow = db.prepare('SELECT MAX(id) as m FROM messages WHERE lead_id = ?').get(leadId)
  const maxMsgId = maxRow?.m || 0

  if (!ci) return { mode: 'full', reason: 'first_analysis', maxMsgId, prev: null }
  if ((ci.insights_version || 1) < 2) return { mode: 'full', reason: 'v1_rebaseline', maxMsgId, prev: ci }
  if ((ci.last_message_id || 0) >= maxMsgId) return { mode: 'skip', reason: 'no_new_messages', maxMsgId, prev: ci }
  if ((ci.incremental_count || 0) >= INCR_MAX_COUNT) return { mode: 'full', reason: 'anti_drift_count', maxMsgId, prev: ci }
  if (ci.last_full_analysis_at) {
    const ageDays = (Date.now() - new Date(ci.last_full_analysis_at.replace(' ', 'T') + 'Z').getTime()) / 86400000
    if (ageDays > INCR_MAX_DAYS) return { mode: 'full', reason: 'anti_drift_days', maxMsgId, prev: ci }
  }
  if ((maxMsgId - (ci.last_full_message_id || 0)) > INCR_MAX_NEW_MSGS_SINCE_FULL) {
    return { mode: 'full', reason: 'anti_drift_volume', maxMsgId, prev: ci }
  }
  return { mode: 'incremental', reason: 'has_new_messages', maxMsgId, prev: ci }
}

// ─── System prompt INCREMENTAL ───
// Reusa todas as regras do FULL e ADICIONA instrucoes de incremental no topo.
const SYSTEM_PROMPT_V2_INCREMENTAL = `═══ MODO INCREMENTAL ═══

Esta e uma ATUALIZACAO de analise. Voce ja analisou esta conversa antes — o veredito anterior esta em "previous_insight" no payload. Trate-o como verdade. "new_messages" e o que aconteceu depois do ultimo ponto de analise. "tail_context_messages" sao 3 msgs anteriores ao corte, marcadas is_context: true — sao SO contexto, NAO gere erros/acertos sobre elas.

Sua tarefa: re-emitir o insight COMPLETO refletindo o estado atual, mantendo continuidade.

REGRAS DO INCREMENTAL:
- Score e EVOLUTIVO: parta de previous_insight.conversation_score e ajuste delta baseado nas msgs novas. Mudanca >15 pontos exige justificativa concreta nas msgs novas.
- NAO regrida score por falta de contexto historico — o resumo previo (previous_insight.resumo) e sua ancora.
- erros e acertos: retorne SO os identificados nas new_messages. evidence_message_ids DEVE referenciar um message_id presente em new_messages (NUNCA em tail_context_messages, nem em previous_insight).
- Arrays acumulativos (objecoes, motivos_perda, riscos): reemita a lista COMPLETA (anterior + novos sem duplicar).
- participants_analysis: reemita pra cada actor que aparece em new_messages OU que ja constava no previous_insight.
- bot_analysis e handoff_analysis: atualize considerando se houve bot/handoff nas msgs novas. Se nao houve mudanca, voce pode espelhar o previous_insight.
- temperatura_lead, fit_icp, chance_conversao, status_recomendado, prioridade_revisao: atualize se as msgs novas mudarem o quadro.

DEMAIS REGRAS abaixo permanecem identicas ao modo FULL.

═══ REGRAS DE ANALISE (identicas ao FULL) ═══

${SYSTEM_PROMPT_V2.replace(/^Voce e um analista[\s\S]*?ESCOPO:/, 'ESCOPO:')}`


// Map temperatura PT (V2) → lead_intent EN (V1 compat)
const TEMP_TO_INTENT = { quente: 'hot', morno: 'warm', frio: 'cold' }

function canAnalyze(accountId) {
  const account = db.prepare('SELECT analysis_token_limit, anthropic_api_key FROM accounts WHERE id = ?').get(accountId)
  // Sem chave Anthropic propria, a conta nao roda IA (sem fallback pra agencia)
  if (!account?.anthropic_api_key?.trim()) return { ok: false, reason: 'no_api_key', used: 0, limit: 0 }
  const limit = account?.analysis_token_limit || 200000
  const monthStart = new Date().toISOString().slice(0, 7) + '-01 00:00:00'
  const used = db.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as n
    FROM ai_agent_token_log
    WHERE account_id = ? AND source IN ('conversation_analysis', 'coaching_analysis') AND created_at >= ?
  `).get(accountId, monthStart)?.n || 0
  return { ok: used < limit, used, limit }
}

// Classifica actor de cada msg pra payload estruturado
function classifyActor(m, userRoleById) {
  if (m.direction === 'inbound') return 'lead'
  if (m.ai_agent_id != null) return 'bot'
  if (m.sent_by_user_id != null) {
    const role = userRoleById.get(m.sent_by_user_id)
    if (role === 'gerente') return 'gerente'
    return 'atendente'
  }
  return 'atendente' // fallback
}

/**
 * Analisa UMA conversa via Haiku V2.
 * Persistência em transação: insights + errors + strengths + participants + alerts.
 */
export async function analyzeConversation(leadId) {
  const lead = db.prepare(`
    SELECT l.*, u.name as attendant_name, u.id as attendant_id_lookup, u.role as attendant_role,
           fs.name as stage_name
    FROM leads l
    LEFT JOIN users u ON u.id = l.attendant_id
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    WHERE l.id = ?
  `).get(leadId)
  if (!lead) return { ok: false, reason: 'lead_not_found' }

  const budget = canAnalyze(lead.account_id)
  if (!budget.ok) return { ok: false, reason: 'monthly_limit_reached', used: budget.used, limit: budget.limit }

  // Decide modo: 'skip' | 'incremental' | 'full' (centraliza checkpoint + anti-drift)
  const decision = decideAnalysisMode(leadId)
  if (decision.mode === 'skip') {
    return { ok: true, skipped: true, reason: decision.reason }
  }
  const isIncremental = decision.mode === 'incremental'
  const prevInsight = decision.prev

  // Carrega msgs conforme modo:
  // - FULL: ultimas 30 (igual hoje)
  // - INCREMENTAL: msgs com id > prev.last_message_id (limit 30) + tail context (3 anteriores ao corte)
  let msgs
  let tailContextMsgs = []
  if (isIncremental) {
    const newOnes = db.prepare(`
      SELECT id, direction, content, sender_name, sent_by_user_id, ai_agent_id, follow_up_id,
             media_type, created_at
      FROM messages
      WHERE lead_id = ? AND id > ?
      ORDER BY id ASC LIMIT ?
    `).all(leadId, prevInsight.last_message_id || 0, MAX_MSGS_IN_CONTEXT)
    if (newOnes.length < 1) {
      // Defesa em profundidade: contagem zero apos decideAnalysisMode -> skip
      return { ok: true, skipped: true, reason: 'no_new_messages_recheck' }
    }
    tailContextMsgs = db.prepare(`
      SELECT id, direction, content, sender_name, sent_by_user_id, ai_agent_id, follow_up_id,
             media_type, created_at
      FROM messages
      WHERE lead_id = ? AND id <= ?
      ORDER BY id DESC LIMIT ?
    `).all(leadId, prevInsight.last_message_id || 0, INCR_TAIL_CONTEXT_MSGS).reverse()
    msgs = [...tailContextMsgs, ...newOnes]  // ordem cronologica
  } else {
    msgs = db.prepare(`
      SELECT id, direction, content, sender_name, sent_by_user_id, ai_agent_id, follow_up_id,
             media_type, created_at
      FROM messages
      WHERE lead_id = ?
      ORDER BY id DESC LIMIT ?
    `).all(leadId, MAX_MSGS_IN_CONTEXT).reverse()
  }

  if (msgs.length < 2) return { ok: false, reason: 'too_few_messages' }

  const lastMsgId = msgs[msgs.length - 1].id
  // Set de ids "novos" pra validar evidence_message_ids no modo incremental
  const newMsgIdSet = isIncremental
    ? new Set(msgs.filter(m => m.id > (prevInsight.last_message_id || 0)).map(m => m.id))
    : null

  // Lookup users (id → role/name) pra classificar actors
  const userIds = [...new Set(msgs.map(m => m.sent_by_user_id).filter(Boolean))]
  const usersMap = new Map()
  const userRoleById = new Map()
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, name, role FROM users WHERE id IN (${placeholders})`).all(...userIds)
    for (const r of rows) {
      usersMap.set(r.id, r)
      userRoleById.set(r.id, r.role)
    }
  }
  // Lookup bots
  const aiAgentIds = [...new Set(msgs.map(m => m.ai_agent_id).filter(Boolean))]
  const aiAgentsMap = new Map()
  if (aiAgentIds.length) {
    const placeholders = aiAgentIds.map(() => '?').join(',')
    const rows = db.prepare(`SELECT id, name FROM ai_agents WHERE id IN (${placeholders})`).all(...aiAgentIds)
    for (const r of rows) aiAgentsMap.set(r.id, r)
  }

  // Stage history pra eventos comerciais
  const stageEvents = db.prepare(`
    SELECT sh.from_stage_id, sh.to_stage_id, sh.triggered_by, sh.created_at,
           fs_from.name as from_name, fs_to.name as to_name,
           u.name as triggered_by_name
    FROM stage_history sh
    LEFT JOIN funnel_stages fs_from ON fs_from.id = sh.from_stage_id
    LEFT JOIN funnel_stages fs_to ON fs_to.id = sh.to_stage_id
    LEFT JOIN users u ON u.id = sh.triggered_by
    WHERE sh.lead_id = ?
    ORDER BY sh.created_at ASC
  `).all(leadId)

  // Tags
  const tags = db.prepare(`
    SELECT t.name FROM tags t JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?
  `).all(leadId).map(r => r.name)

  // Pré-computação determinística (não pede pra IA)
  const firstInbound = msgs.find(m => m.direction === 'inbound')
  const firstHumanOutbound = msgs.find(m => m.direction === 'outbound' && m.ai_agent_id == null)
  const firstBotOutbound = msgs.find(m => m.direction === 'outbound' && m.ai_agent_id != null)
  const lastHumanOutbound = [...msgs].reverse().find(m => m.direction === 'outbound' && m.ai_agent_id == null)
  const lastInboundMsg = [...msgs].reverse().find(m => m.direction === 'inbound')

  const leadCreatedMs = new Date(lead.created_at).getTime()
  const nowMs = Date.now()
  const ttfrHumanSec = firstHumanOutbound
    ? Math.max(0, (new Date(firstHumanOutbound.created_at).getTime() - leadCreatedMs) / 1000)
    : null
  const ttfrBotSec = firstBotOutbound
    ? Math.max(0, (new Date(firstBotOutbound.created_at).getTime() - leadCreatedMs) / 1000)
    : null
  const timeSinceLastHumanSec = lastHumanOutbound
    ? Math.max(0, (nowMs - new Date(lastHumanOutbound.created_at).getTime()) / 1000)
    : null
  const timeSinceLastInboundSec = lastInboundMsg
    ? Math.max(0, (nowMs - new Date(lastInboundMsg.created_at).getTime()) / 1000)
    : null

  // Tem mensagens inbound sem resposta?
  let hasUnansweredInbound = false
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].direction === 'inbound') { hasUnansweredInbound = true; break }
    if (msgs[i].direction === 'outbound') break
  }

  // Monta payload estruturado em JSON
  const payload = {
    conversation: {
      lead_id: lead.id,
      lead_name: lead.name || null,
      lead_phone: lead.phone || null,
      empresa: lead.empresa || null,
      cidade: lead.city || null,
      fonte: lead.source || null,
      tags: tags,
      stage_atual: lead.stage_name || null,
      valor_estimado: lead.value_estimated || null,
      proposal_sent_at: lead.proposal_sent_at || null,
      qualified_at: lead.qualified_at || null,
      data_entrada: lead.created_at,
      attendant_atual: lead.attendant_id_lookup
        ? { user_id: lead.attendant_id_lookup, name: lead.attendant_name, role: lead.attendant_role }
        : null,
    },
    messages: msgs.map(m => {
      const actor = classifyActor(m, userRoleById)
      const senderInfo = m.sent_by_user_id ? usersMap.get(m.sent_by_user_id) : null
      const botInfo = m.ai_agent_id ? aiAgentsMap.get(m.ai_agent_id) : null
      let text = String(m.content || '').slice(0, MAX_CONTENT_LEN_PER_MSG)
      if (!text.trim()) text = `(${m.media_type || 'midia'})`
      const obj = {
        message_id: m.id,
        timestamp: m.created_at,
        sender_type: actor,
        sender_id: m.sent_by_user_id || m.ai_agent_id || null,
        sender_name: senderInfo?.name || botInfo?.name || m.sender_name || null,
        role: senderInfo?.role || (botInfo ? 'bot' : null),
        direction: m.direction,
        text,
        is_automated: m.ai_agent_id != null || m.follow_up_id != null,
        cadence_step_id: m.follow_up_id || null,
        message_type: m.media_type || 'text',
      }
      // Modo incremental: marca msgs de contexto (anteriores ao corte) como is_context
      if (isIncremental && newMsgIdSet && !newMsgIdSet.has(m.id)) obj.is_context = true
      return obj
    }),
    events: stageEvents.map(s => ({
      type: 'stage_changed',
      from: s.from_name,
      to: s.to_name,
      by: s.triggered_by_name,
      timestamp: s.created_at,
    })),
    precomputed_metrics: {
      ttfr_seconds_human: ttfrHumanSec,
      ttfr_seconds_bot: ttfrBotSec,
      time_since_last_human_msg_seconds: timeSinceLastHumanSec,
      time_since_last_inbound_seconds: timeSinceLastInboundSec,
      total_messages: msgs.length,
      has_unanswered_inbound: hasUnansweredInbound,
    },
  }

  // Modo incremental: anexa previous_insight resumido pra Haiku usar como base
  if (isIncremental && prevInsight) {
    const prev = db.prepare(`
      SELECT conversation_score, score_velocidade_sla, score_abertura, score_diagnostico,
             score_qualificacao, score_conducao, score_objecoes, score_proximo_passo, score_organizacao_crm,
             summary, temperatura_lead, fit_icp, chance_conversao,
             status_recomendado, prioridade_revisao, confidence_score,
             objecoes_detectadas, motivos_perda, riscos_detectados,
             bot_analysis_json, handoff_analysis_json, analyzed_at, last_message_id
      FROM conversation_insights WHERE id = ?
    `).get(prevInsight.id)
    const errCount = db.prepare('SELECT COUNT(*) as n, SUM(CASE WHEN gravity IN (?, ?) THEN 1 ELSE 0 END) as graves FROM conversation_errors WHERE insight_id = ?').get('alta', 'critica', prevInsight.id)
    const strCount = db.prepare('SELECT COUNT(*) as n FROM conversation_strengths WHERE insight_id = ?').get(prevInsight.id)
    const tryParseArr = (s) => { try { return JSON.parse(s || '[]') } catch { return [] } }
    payload.previous_insight = {
      analyzed_at: prev?.analyzed_at || null,
      last_message_id_analyzed: prev?.last_message_id || null,
      conversation_score: prev?.conversation_score ?? null,
      scores: {
        velocidade_sla: prev?.score_velocidade_sla ?? null,
        abertura: prev?.score_abertura ?? null,
        diagnostico: prev?.score_diagnostico ?? null,
        qualificacao: prev?.score_qualificacao ?? null,
        conducao_comercial: prev?.score_conducao ?? null,
        objecoes: prev?.score_objecoes ?? null,
        proximo_passo: prev?.score_proximo_passo ?? null,
        organizacao_crm: prev?.score_organizacao_crm ?? null,
      },
      resumo: prev?.summary || '',
      temperatura_lead: prev?.temperatura_lead || null,
      fit_icp: prev?.fit_icp ?? null,
      chance_conversao: prev?.chance_conversao ?? null,
      status_recomendado: prev?.status_recomendado || null,
      prioridade_revisao: prev?.prioridade_revisao || null,
      confidence_score: prev?.confidence_score ?? null,
      objecoes: tryParseArr(prev?.objecoes_detectadas),
      motivos_perda: tryParseArr(prev?.motivos_perda),
      riscos: tryParseArr(prev?.riscos_detectados),
      bot_analysis: prev?.bot_analysis_json ? JSON.parse(prev.bot_analysis_json) : null,
      handoff_analysis: prev?.handoff_analysis_json ? JSON.parse(prev.handoff_analysis_json) : null,
      erros_summary: `${errCount?.n || 0} erros previos registrados (graves: ${errCount?.graves || 0})`,
      acertos_summary: `${strCount?.n || 0} acertos previos registrados`,
    }
  }

  // Chamada Haiku — system prompt cacheado, output ~1.5k tokens
  let result
  try {
    result = await callHaiku({
      systemPrompt: isIncremental ? SYSTEM_PROMPT_V2_INCREMENTAL : SYSTEM_PROMPT_V2,
      messages: [
        {
          role: 'user',
          content: `Conversa para analisar (JSON estruturado, modo=${isIncremental ? 'incremental' : 'full'}):\n\n${JSON.stringify(payload, null, 2)}\n\nUse a tool save_insights_v2.`,
        },
      ],
      tools: [TOOL_SAVE_INSIGHTS_V2],
      maxTokens: 2000,
      toolChoice: { type: 'tool', name: 'save_insights_v2' },
      accountId: lead.account_id,
    })
  } catch (e) {
    console.error(`[Analyzer V2] Haiku err lead=${leadId}:`, e.message)
    return { ok: false, reason: 'haiku_error', error: e.message }
  }

  const toolUse = result.toolUses?.[0]
  if (!toolUse || toolUse.name !== 'save_insights_v2' || !toolUse.input) {
    console.warn(`[Analyzer V2] sem tool_use lead=${leadId}`)
    return { ok: false, reason: 'no_tool_use' }
  }

  const ins = toolUse.input
  const scores = ins.scores || {}
  // Guards: Haiku as vezes retorna campo como null/objeto em vez de array.
  const safeArr = (v) => Array.isArray(v) ? v : []
  ins.erros = safeArr(ins.erros)
  ins.acertos = safeArr(ins.acertos)
  ins.objecoes = safeArr(ins.objecoes)
  ins.motivos_perda = safeArr(ins.motivos_perda)
  ins.riscos = safeArr(ins.riscos)
  ins.participants_analysis = safeArr(ins.participants_analysis)

  // Modo incremental: defesas extras
  if (isIncremental && newMsgIdSet) {
    // 1. Filtra evidence_message_ids pra remover ids que Haiku alucinou ou que sao de tail context
    const filterEvidence = (arr) => arr.map(e => ({
      ...e,
      evidence_message_ids: safeArr(e.evidence_message_ids).filter(id => newMsgIdSet.has(Number(id))),
    })).filter(e => e.evidence_message_ids.length > 0)  // sem evidencia valida -> descarta
    ins.erros = filterEvidence(ins.erros)
    ins.acertos = filterEvidence(ins.acertos)
    // 2. Merge defensivo de arrays acumulativos (Haiku deveria reemitir tudo, mas se esquecer item antigo, app preserva)
    const uniqStr = (arr) => [...new Set(arr.filter(x => typeof x === 'string' && x.trim()))]
    ins.objecoes = uniqStr([...(payload.previous_insight?.objecoes || []), ...ins.objecoes])
    ins.motivos_perda = uniqStr([...(payload.previous_insight?.motivos_perda || []), ...ins.motivos_perda])
    ins.riscos = uniqStr([...(payload.previous_insight?.riscos || []), ...ins.riscos])
    // 3. Anti-drift de score: log delta pra observabilidade
    const prevScore = payload.previous_insight?.conversation_score
    if (prevScore != null && ins.conversation_score != null) {
      const delta = ins.conversation_score - prevScore
      if (Math.abs(delta) > 15) {
        console.warn(`[Analyzer V2] lead=${leadId} score_delta=${delta} (prev=${prevScore} new=${ins.conversation_score}) — possivel drift`)
      }
    }
  }

  // Map V2 → V1 backcompat
  const lead_intent_v1 = TEMP_TO_INTENT[ins.temperatura_lead] || 'cold'
  const attendant_score_v1 = ins.conversation_score != null ? Math.max(1, Math.min(10, Math.round(ins.conversation_score / 10))) : null
  const last_message_quality_v1 = (() => {
    const cs = ins.conversation_score || 0
    if (cs >= 80) return 'excellent'
    if (cs >= 60) return 'good'
    if (cs >= 40) return 'mediocre'
    return 'poor'
  })()
  const errors_v1_summary = JSON.stringify((ins.erros || []).map(e => e.description).filter(Boolean))

  // Persistência em transação
  const tx = db.transaction(() => {
    // 1. UPSERT conversation_insights V2
    // Modo FULL: passa last_full_analysis_at=now, last_full_message_id=lastMsgId, incremental_count=0
    // Modo INCREMENTAL: passa NULL nos last_full_* (COALESCE preserva) e o CASE incrementa count
    const fullAnalysisAt = isIncremental ? null : null  // sempre passa NULL no INSERT; CASE no UPDATE decide
    const fullMessageId = isIncremental ? null : null
    db.prepare(`
      INSERT INTO conversation_insights (
        lead_id, account_id, analyzed_at, last_message_id,
        summary, lead_intent, lost_sale_signals, attendant_errors,
        attendant_score, score_reasoning, suggested_next_step, last_message_quality,
        attendant_user_id, tokens_used, cost_usd,
        insights_version, conversation_score,
        score_velocidade_sla, score_abertura, score_diagnostico, score_qualificacao,
        score_conducao, score_objecoes, score_proximo_passo, score_organizacao_crm,
        temperatura_lead, fit_icp, chance_conversao,
        status_recomendado, mensagem_retomada,
        objecoes_detectadas, motivos_perda, riscos_detectados,
        prioridade_revisao, confidence_score,
        bot_analysis_json, handoff_analysis_json, coaching_recomendado,
        incremental_count, last_full_analysis_at, last_full_message_id
      ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                2, ?,
                ?, ?, ?, ?, ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?, ?,
                ?, ?, ?)
      ON CONFLICT(lead_id) DO UPDATE SET
        analyzed_at = datetime('now'),
        last_message_id = excluded.last_message_id,
        summary = excluded.summary,
        lead_intent = excluded.lead_intent,
        lost_sale_signals = excluded.lost_sale_signals,
        attendant_errors = excluded.attendant_errors,
        attendant_score = excluded.attendant_score,
        score_reasoning = excluded.score_reasoning,
        suggested_next_step = excluded.suggested_next_step,
        last_message_quality = excluded.last_message_quality,
        attendant_user_id = excluded.attendant_user_id,
        tokens_used = excluded.tokens_used,
        cost_usd = excluded.cost_usd,
        insights_version = 2,
        conversation_score = excluded.conversation_score,
        score_velocidade_sla = excluded.score_velocidade_sla,
        score_abertura = excluded.score_abertura,
        score_diagnostico = excluded.score_diagnostico,
        score_qualificacao = excluded.score_qualificacao,
        score_conducao = excluded.score_conducao,
        score_objecoes = excluded.score_objecoes,
        score_proximo_passo = excluded.score_proximo_passo,
        score_organizacao_crm = excluded.score_organizacao_crm,
        temperatura_lead = excluded.temperatura_lead,
        fit_icp = excluded.fit_icp,
        chance_conversao = excluded.chance_conversao,
        status_recomendado = excluded.status_recomendado,
        mensagem_retomada = excluded.mensagem_retomada,
        objecoes_detectadas = excluded.objecoes_detectadas,
        motivos_perda = excluded.motivos_perda,
        riscos_detectados = excluded.riscos_detectados,
        prioridade_revisao = excluded.prioridade_revisao,
        confidence_score = excluded.confidence_score,
        bot_analysis_json = excluded.bot_analysis_json,
        handoff_analysis_json = excluded.handoff_analysis_json,
        coaching_recomendado = excluded.coaching_recomendado,
        -- Incremental: count+1, last_full_* preservados. FULL: count=0, last_full_*=excluded.
        incremental_count = CASE WHEN excluded.last_full_analysis_at IS NOT NULL THEN 0 ELSE conversation_insights.incremental_count + 1 END,
        last_full_analysis_at = COALESCE(excluded.last_full_analysis_at, conversation_insights.last_full_analysis_at),
        last_full_message_id = COALESCE(excluded.last_full_message_id, conversation_insights.last_full_message_id)
    `).run(
      lead.id, lead.account_id, lastMsgId,
      ins.resumo || '', lead_intent_v1, /* lost_sale_signals derivado de motivos_perda */
      (ins.motivos_perda && ins.motivos_perda.length) ? ins.motivos_perda.join('; ') : null,
      errors_v1_summary,
      attendant_score_v1, /* score_reasoning derivado */
      (ins.scores ? `Vel:${scores.velocidade_sla} Diag:${scores.diagnostico} Cond:${scores.conducao_comercial} Obj:${scores.objecoes} Prox:${scores.proximo_passo}` : ''),
      ins.proxima_melhor_acao || '', last_message_quality_v1,
      lead.attendant_id_lookup || null, result.usage.total, result.costUsd,
      ins.conversation_score ?? null,
      scores.velocidade_sla ?? null, scores.abertura ?? null, scores.diagnostico ?? null, scores.qualificacao ?? null,
      scores.conducao_comercial ?? null, scores.objecoes ?? null, scores.proximo_passo ?? null, scores.organizacao_crm ?? null,
      ins.temperatura_lead || null, ins.fit_icp ?? null, ins.chance_conversao ?? null,
      ins.status_recomendado || null, ins.mensagem_retomada || null,
      JSON.stringify(ins.objecoes || []), JSON.stringify(ins.motivos_perda || []), JSON.stringify(ins.riscos || []),
      ins.prioridade_revisao || 'media', ins.confidence_score ?? null,
      ins.bot_analysis ? JSON.stringify(ins.bot_analysis) : null,
      ins.handoff_analysis ? JSON.stringify(ins.handoff_analysis) : null,
      ins.coaching_recomendado || null,
      // Incremental marker: NULL em last_full_* sinaliza pro CASE no ON CONFLICT que e incremental
      isIncremental ? 0 : 0,                                              // incremental_count no INSERT (zero pq lead novo nunca eh incremental)
      isIncremental ? null : new Date().toISOString().slice(0, 19).replace('T', ' '),  // last_full_analysis_at
      isIncremental ? null : lastMsgId                                    // last_full_message_id
    )

    // Pega o insight_id pra FK
    const insightId = db.prepare('SELECT id FROM conversation_insights WHERE lead_id = ?').get(lead.id).id

    // 2. FULL: limpa errors/strengths antigos (re-baseline). INCREMENTAL: preserva (cumulativo).
    //    participants_analysis sempre re-cria (nao acumula — uma linha por actor sempre).
    if (!isIncremental) {
      db.prepare('DELETE FROM conversation_errors WHERE insight_id = ?').run(insightId)
      db.prepare('DELETE FROM conversation_strengths WHERE insight_id = ?').run(insightId)
    }
    db.prepare('DELETE FROM conversation_participant_analysis WHERE insight_id = ?').run(insightId)

    const createdVia = isIncremental ? 'incremental' : 'full'

    // 3. Insere erros
    const insertErr = db.prepare(`
      INSERT INTO conversation_errors (
        insight_id, lead_id, account_id, attendant_user_id, actor_type,
        code, category, gravity, description, impact, how_to_fix, evidence_message_ids, created_via
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const e of (ins.erros || [])) {
      insertErr.run(
        insightId, lead.id, lead.account_id,
        e.actor_type === 'atendente' || e.actor_type === 'gerente' ? lead.attendant_id_lookup : null,
        e.actor_type || 'atendente',
        e.code || null, e.category || null, e.gravity || 'media',
        e.description || '', e.impact || null, e.how_to_fix || null,
        JSON.stringify(e.evidence_message_ids || []),
        createdVia
      )
    }

    // 4. Insere acertos
    const insertStr = db.prepare(`
      INSERT INTO conversation_strengths (
        insight_id, lead_id, account_id, attendant_user_id, actor_type,
        code, description, impact, evidence_message_ids, created_via
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const a of (ins.acertos || [])) {
      insertStr.run(
        insightId, lead.id, lead.account_id,
        a.actor_type === 'atendente' || a.actor_type === 'gerente' ? lead.attendant_id_lookup : null,
        a.actor_type || 'atendente',
        a.code || null, a.description || '', a.impact || null,
        JSON.stringify(a.evidence_message_ids || []),
        createdVia
      )
    }

    // 5. Análise por participante
    const insertPart = db.prepare(`
      INSERT INTO conversation_participant_analysis (
        insight_id, lead_id, account_id,
        actor_type, actor_user_id, actor_ai_agent_id, actor_name,
        score, acertos_summary, erros_summary, recomendacao
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const p of (ins.participants_analysis || [])) {
      const userId = (p.actor_type === 'atendente' || p.actor_type === 'gerente') ? (p.actor_id || null) : null
      const agentId = p.actor_type === 'bot' ? (p.actor_id || null) : null
      insertPart.run(
        insightId, lead.id, lead.account_id,
        p.actor_type, userId, agentId, p.actor_name || '',
        p.score ?? null, p.acertos_summary || null, p.erros_summary || null, p.recomendacao || null
      )
    }

    // 6. Alertas operacionais (dedup por lead_id + type + status='open')
    const alertCheck = db.prepare(`
      SELECT id FROM analyst_alerts WHERE lead_id = ? AND type = ? AND status = 'open'
    `)
    const insertAlert = db.prepare(`
      INSERT INTO analyst_alerts (
        account_id, lead_id, insight_id, type, severity, title, description, suggested_action
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    function maybeAlert(type, severity, title, description, suggested) {
      if (alertCheck.get(lead.id, type)) return
      insertAlert.run(lead.account_id, lead.id, insightId, type, severity, title, description, suggested)
    }

    // 6a. Lead quente abandonado
    if (ins.temperatura_lead === 'quente' && timeSinceLastHumanSec != null && timeSinceLastHumanSec > 86400) {
      maybeAlert(
        'lead_quente_abandonado', 'alta',
        `Lead quente sem resposta humana há ${Math.floor(timeSinceLastHumanSec / 3600)}h`,
        ins.resumo || '',
        ins.mensagem_retomada || ins.proxima_melhor_acao || null
      )
    }
    // 6b. Proposta enviada sem retorno >72h
    if (lead.proposal_sent_at && timeSinceLastInboundSec != null && timeSinceLastInboundSec > 72 * 3600) {
      maybeAlert(
        'proposta_sem_retorno', 'alta',
        `Proposta enviada sem retorno há ${Math.floor(timeSinceLastInboundSec / 3600)}h`,
        ins.resumo || '',
        ins.mensagem_retomada || null
      )
    }
    // 6c. Erro crítico OU prioridade_revisao crítica
    const hasCriticalErr = (ins.erros || []).some(e => e.gravity === 'critica')
    if (hasCriticalErr || ins.prioridade_revisao === 'critica') {
      maybeAlert(
        'erro_critico', 'critica',
        'Erro crítico detectado na conversa',
        ins.coaching_recomendado || ins.resumo || '',
        ins.proxima_melhor_acao || null
      )
    }
    // 6d. Bot falhou (deveria transferir e não fez)
    if (ins.bot_analysis && ins.bot_analysis.deveria_transferir && !ins.bot_analysis.respondeu_corretamente) {
      maybeAlert(
        'bot_falhou', 'media',
        'Bot não transferiu lead que deveria ir para humano',
        ins.bot_analysis.summary || '',
        'Revisar configuração de handoff do bot'
      )
    }

    // 7. Log custo
    db.prepare(`
      INSERT INTO ai_agent_token_log (
        account_id, lead_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'conversation_analysis')
    `).run(
      lead.account_id, lead.id,
      result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheCreation,
      result.costUsd
    )
  })
  tx()

  console.log(`[Analyzer V2] mode=${decision.mode} lead=${leadId} new_msgs=${isIncremental ? (newMsgIdSet?.size || 0) : msgs.length} cost=$${(result.costUsd || 0).toFixed(4)} score=${ins.conversation_score}`)
  return {
    ok: true,
    mode: decision.mode,
    reason: decision.reason,
    costUsd: result.costUsd,
    tokens: result.usage.total,
    score: ins.conversation_score,
    temperatura: ins.temperatura_lead,
    confidence: ins.confidence_score,
  }
}

/**
 * Roda análise em batch pros leads da conta que mudaram nas últimas 24h
 * e ainda não foram analisados (ou cujo insight está desatualizado).
 */
export async function analyzeConversationsBatch(accountId, opts = {}) {
  const maxLeads = opts.maxLeads || 50
  const sinceHours = opts.sinceHours || 24

  const budget = canAnalyze(accountId)
  if (!budget.ok) {
    console.warn(`[Analyzer V2] account=${accountId} limite mensal (used=${budget.used} limit=${budget.limit})`)
    return { ok: false, reason: 'monthly_limit_reached' }
  }

  // Dual-query: prioriza candidatos INCREMENTAL (mais baratos) e depois FULL.
  // Filtros centralizados em decideAnalysisMode (defesa em profundidade na execucao).
  const candidates = getCandidatesFor(accountId, sinceHours, maxLeads)

  console.log(`[Analyzer V2] account=${accountId} candidates=${candidates.length} (incremental=${candidates.filter(c => c.mode === 'incremental').length} full=${candidates.filter(c => c.mode === 'full').length}) max=${maxLeads}`)

  let okFull = 0, okIncr = 0, skipCount = 0, errCount = 0, totalCost = 0
  for (const c of candidates) {
    try {
      const r = await analyzeConversation(c.id)
      if (r.ok && !r.skipped) {
        if (r.mode === 'incremental') okIncr++
        else okFull++
        totalCost += r.costUsd || 0
      } else {
        skipCount++
      }
      if ((okFull + okIncr + skipCount + errCount) % 10 === 0) {
        const b = canAnalyze(accountId)
        if (!b.ok) {
          console.warn(`[Analyzer V2] account=${accountId} budget atingido durante batch`)
          break
        }
      }
    } catch (e) {
      errCount++
      console.error(`[Analyzer V2] err lead=${c.id}:`, e.message)
    }
  }

  const okCount = okFull + okIncr
  console.log(`[Analyzer V2] account=${accountId} done full=${okFull} incremental=${okIncr} skip=${skipCount} err=${errCount} cost=$${totalCost.toFixed(4)}`)
  return { ok: true, okCount, okFull, okIncr, skipCount, errCount, totalCost }
}

/**
 * Helper de filtro de candidates. Retorna [{id, mode}] priorizando INCREMENTAL (mais barato).
 * Mode 'incremental' so se NAO atende nenhum trigger anti-drift. Mode 'full' caso contrario.
 */
function getCandidatesFor(accountId, sinceHours, maxLeads) {
  // A) Incrementais: insight v2 valido + msg nova + nenhum trigger anti-drift
  const incrementals = db.prepare(`
    SELECT l.id, 'incremental' as mode
    FROM leads l
    JOIN conversation_insights ci ON ci.lead_id = l.id
    WHERE l.account_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(l.is_blocked, 0) = 0
      AND ci.insights_version >= 2
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.lead_id = l.id AND m.created_at >= datetime('now', '-' || ? || ' hours')
      )
      AND COALESCE(ci.last_message_id, 0) < (SELECT MAX(id) FROM messages WHERE lead_id = l.id)
      AND COALESCE(ci.incremental_count, 0) < ${INCR_MAX_COUNT}
      AND (ci.last_full_analysis_at IS NULL OR julianday('now') - julianday(ci.last_full_analysis_at) <= ${INCR_MAX_DAYS})
      AND ((SELECT MAX(id) FROM messages WHERE lead_id = l.id) - COALESCE(ci.last_full_message_id, 0)) <= ${INCR_MAX_NEW_MSGS_SINCE_FULL}
    ORDER BY (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id) DESC
    LIMIT ?
  `).all(accountId, sinceHours, maxLeads)

  // B) Fulls: sem insight, OU v1, OU qualquer trigger anti-drift
  const remaining = Math.max(0, maxLeads - incrementals.length)
  if (remaining === 0) return incrementals
  const fulls = db.prepare(`
    SELECT l.id, 'full' as mode
    FROM leads l
    WHERE l.account_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(l.is_blocked, 0) = 0
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.lead_id = l.id AND m.created_at >= datetime('now', '-' || ? || ' hours')
      )
      AND (
        NOT EXISTS (SELECT 1 FROM conversation_insights ci WHERE ci.lead_id = l.id)
        OR EXISTS (
          SELECT 1 FROM conversation_insights ci
          WHERE ci.lead_id = l.id AND (
            ci.insights_version < 2
            OR COALESCE(ci.incremental_count, 0) >= ${INCR_MAX_COUNT}
            OR (ci.last_full_analysis_at IS NOT NULL AND julianday('now') - julianday(ci.last_full_analysis_at) > ${INCR_MAX_DAYS})
            OR ((SELECT MAX(id) FROM messages WHERE lead_id = l.id) - COALESCE(ci.last_full_message_id, 0)) > ${INCR_MAX_NEW_MSGS_SINCE_FULL}
          )
        )
      )
    ORDER BY (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id) DESC
    LIMIT ?
  `).all(accountId, sinceHours, remaining)

  return [...incrementals, ...fulls]
}

/**
 * Wrapper pra rodar em todas as contas com analytics_enabled=1.
 * Chamado pelo cron noturno. Contas sem flag são puladas.
 */
export async function analyzeAllAccounts() {
  const accounts = db.prepare("SELECT id FROM accounts WHERE is_active = 1 AND attendant_analytics_enabled = 1").all()
  let totalOk = 0, totalSkip = 0, totalErr = 0
  for (const acc of accounts) {
    try {
      const r = await analyzeConversationsBatch(acc.id, { maxLeads: 50, sinceHours: 24 })
      if (r.ok) { totalOk += r.okCount; totalSkip += r.skipCount; totalErr += r.errCount }
    } catch (e) {
      console.error(`[Analyzer V2] account=${acc.id} batch falhou:`, e.message)
      totalErr++
    }
  }
  return { totalOk, totalSkip, totalErr }
}

/**
 * Estimativa de custo pra modal de confirmação no "Analisar agora".
 * Retorna: leads_pending_total (sem cap), leads_to_analyze (capeado pelo maxLeads), custo estimado.
 */
export function getAnalyzeEstimate(accountId, sinceHours = 24 * 7, maxLeads = 50) {
  const account = db.prepare(`
    SELECT attendant_analytics_enabled, analysis_token_limit FROM accounts WHERE id = ?
  `).get(accountId)
  const monthStart = new Date().toISOString().slice(0, 7) + '-01 00:00:00'
  const spent = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as cost FROM ai_agent_token_log
    WHERE account_id = ? AND source IN ('conversation_analysis', 'coaching_analysis')
      AND created_at >= ?
  `).get(accountId, monthStart)?.cost || 0

  // Breakdown por modo: conta incrementais e fulls separadamente (mesma logica dos candidates do batch)
  const incrCount = db.prepare(`
    SELECT COUNT(*) as n
    FROM leads l
    JOIN conversation_insights ci ON ci.lead_id = l.id
    WHERE l.account_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(l.is_blocked, 0) = 0
      AND ci.insights_version >= 2
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.lead_id = l.id AND m.created_at >= datetime('now', '-' || ? || ' hours')
      )
      AND COALESCE(ci.last_message_id, 0) < (SELECT MAX(id) FROM messages WHERE lead_id = l.id)
      AND COALESCE(ci.incremental_count, 0) < ${INCR_MAX_COUNT}
      AND (ci.last_full_analysis_at IS NULL OR julianday('now') - julianday(ci.last_full_analysis_at) <= ${INCR_MAX_DAYS})
      AND ((SELECT MAX(id) FROM messages WHERE lead_id = l.id) - COALESCE(ci.last_full_message_id, 0)) <= ${INCR_MAX_NEW_MSGS_SINCE_FULL}
  `).get(accountId, sinceHours)?.n || 0

  const fullCount = db.prepare(`
    SELECT COUNT(*) as n
    FROM leads l
    WHERE l.account_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(l.is_blocked, 0) = 0
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.lead_id = l.id AND m.created_at >= datetime('now', '-' || ? || ' hours')
      )
      AND (
        NOT EXISTS (SELECT 1 FROM conversation_insights ci WHERE ci.lead_id = l.id)
        OR EXISTS (
          SELECT 1 FROM conversation_insights ci
          WHERE ci.lead_id = l.id AND (
            ci.insights_version < 2
            OR COALESCE(ci.incremental_count, 0) >= ${INCR_MAX_COUNT}
            OR (ci.last_full_analysis_at IS NOT NULL AND julianday('now') - julianday(ci.last_full_analysis_at) > ${INCR_MAX_DAYS})
            OR ((SELECT MAX(id) FROM messages WHERE lead_id = l.id) - COALESCE(ci.last_full_message_id, 0)) > ${INCR_MAX_NEW_MSGS_SINCE_FULL}
          )
        )
      )
  `).get(accountId, sinceHours)?.n || 0

  // Skipped: total de leads com insight v2 onde last_message_id >= MAX(msg.id) (ja em dia)
  const skippedCount = db.prepare(`
    SELECT COUNT(*) as n
    FROM leads l
    JOIN conversation_insights ci ON ci.lead_id = l.id AND ci.insights_version >= 2
    WHERE l.account_id = ?
      AND l.is_active = 1 AND COALESCE(l.is_archived, 0) = 0 AND COALESCE(l.is_blocked, 0) = 0
      AND COALESCE(ci.last_message_id, 0) >= COALESCE((SELECT MAX(id) FROM messages WHERE lead_id = l.id), 0)
  `).get(accountId)?.n || 0

  const leadsPendingTotal = incrCount + fullCount
  const leadsToAnalyze = Math.min(maxLeads, leadsPendingTotal)

  // Custo: prioriza incrementais ate maxLeads (mesma logica do batch)
  const incrToAnalyze = Math.min(incrCount, maxLeads)
  const fullToAnalyze = Math.min(fullCount, Math.max(0, maxLeads - incrToAnalyze))
  const estimatedCostIncr = incrToAnalyze * INCR_COST_PER_LEAD_USD
  const estimatedCostFull = fullToAnalyze * FULL_COST_PER_LEAD_USD
  const estimatedCost = estimatedCostIncr + estimatedCostFull
  const estimatedCostAll = (incrCount * INCR_COST_PER_LEAD_USD) + (fullCount * FULL_COST_PER_LEAD_USD)

  // Aprox 200k tokens ≈ $3 USD (mix input+output médio)
  const monthLimitUsd = (account?.analysis_token_limit || 200000) * 3 / 200000

  return {
    leads_pending_total: leadsPendingTotal,
    leads_to_analyze: leadsToAnalyze,
    leads_skipped: skippedCount,                                          // ja em dia (puladas)
    leads_incremental: incrCount,                                          // total de incrementais pendentes
    leads_full: fullCount,                                                 // total de fulls pendentes
    leads_incremental_to_analyze: incrToAnalyze,                           // qts incrementais entram no batch (capeado por maxLeads)
    leads_full_to_analyze: fullToAnalyze,                                  // qts fulls entram no batch
    estimated_cost_incremental_usd: Number(estimatedCostIncr.toFixed(4)),
    estimated_cost_full_usd: Number(estimatedCostFull.toFixed(4)),
    estimated_cost_usd: Number(estimatedCost.toFixed(4)),
    estimated_cost_all_usd: Number(estimatedCostAll.toFixed(4)),
    month_spent_usd: Number(spent.toFixed(4)),
    month_limit_usd: Number(monthLimitUsd.toFixed(2)),
    account_has_flag: account?.attendant_analytics_enabled === 1,
  }
}

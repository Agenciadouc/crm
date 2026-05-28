// Analisador de conversa via Haiku — extrai insights qualitativos de atendimento.
// Tool use forçada pra garantir retorno estruturado.
// Idempotente: UPSERT em conversation_insights por lead_id.
// Protegido por limite mensal de tokens por conta (accounts.analysis_token_limit).

import db from '../db.js'
import { callHaiku } from './anthropicClient.js'

const SYSTEM_PROMPT = `Voce e um analista de qualidade de atendimento comercial via WhatsApp.

Vou te passar uma conversa entre vendedor e lead. Sua tarefa: ler a conversa e extrair insights estruturados.

Avalie criterios objetivos:

LEAD_INTENT (intencao de compra):
- hot: pediu preco, quer comprar, tem urgencia, faz perguntas concretas sobre produto/prazo
- warm: demonstra interesse mas ainda explorando, faz perguntas gerais
- cold: pouco engajado, respostas curtas, nao demonstra real interesse
- not_qualified: nao e o perfil (curioso, errado, fora do nicho)

LOST_SALE_SIGNALS (sinais de venda perdida): preencher SO se houver clara oportunidade nao convertida.
Exemplos: "lead disse 'ta caro' e vendedor nao tratou objecao", "lead pediu desconto e vendedor recusou sem alternativa", "lead pediu pra ligar amanha mas nao houve follow-up", "lead demonstrou compra iminente mas conversa parou".
Se nao houver sinal claro, retorne null.

ATTENDANT_ERRORS (erros do atendente): array de strings com erros ESPECIFICOS observados.
Exemplos: "nao respondeu pergunta direta sobre prazo", "demorou >2h pra responder sem justificativa", "tom rude/impaciente", "informacao incorreta sobre produto", "nao seguiu protocolo de qualificacao".
Se nao houver erros, array vazio [].

ATTENDANT_SCORE (1-10): nota geral do atendimento do vendedor nesta conversa.
- 9-10: rapido, cordial, vendeu ou avancou qualificacao significativamente
- 7-8: bom, sem erros graves, conversa fluindo
- 5-6: mediano, alguns problemas (lentidao, erros pequenos)
- 3-4: ruim, varios erros visiveis
- 1-2: pessimo, perdeu venda obvia ou foi grosseiro

SCORE_REASONING: 1-2 frases explicando o score.

SUGGESTED_NEXT_STEP: 1 frase com o que o vendedor deveria fazer agora pra avancar essa conversa.

LAST_MESSAGE_QUALITY: avaliacao da ULTIMA mensagem do vendedor (excellent/good/mediocre/poor).

SUMMARY: 1-2 frases resumindo o estado atual da conversa.

Use a tool save_insights pra retornar os dados. NAO retorne texto livre.`

const TOOL_SAVE_INSIGHTS = {
  name: 'save_insights',
  description: 'Salva os insights extraidos da analise da conversa.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Resumo de 1-2 frases do estado da conversa.' },
      lead_intent: { type: 'string', enum: ['hot', 'warm', 'cold', 'not_qualified'] },
      lost_sale_signals: { type: ['string', 'null'], description: 'Descricao do sinal de venda perdida ou null se nao houver.' },
      attendant_errors: { type: 'array', items: { type: 'string' }, description: 'Lista de erros especificos do atendente. [] se nenhum.' },
      attendant_score: { type: 'integer', minimum: 1, maximum: 10 },
      score_reasoning: { type: 'string' },
      suggested_next_step: { type: 'string' },
      last_message_quality: { type: 'string', enum: ['excellent', 'good', 'mediocre', 'poor'] },
    },
    required: ['summary', 'lead_intent', 'attendant_errors', 'attendant_score', 'score_reasoning', 'suggested_next_step', 'last_message_quality'],
  },
}

const MAX_MSGS_IN_CONTEXT = 30
const MAX_CONTENT_LEN_PER_MSG = 500

/**
 * Verifica se a conta atingiu limite mensal de tokens de analise.
 * Retorna true se ainda pode rodar.
 */
function canAnalyze(accountId) {
  const account = db.prepare('SELECT analysis_token_limit FROM accounts WHERE id = ?').get(accountId)
  const limit = account?.analysis_token_limit || 200000
  const monthStart = new Date().toISOString().slice(0, 7) + '-01 00:00:00'
  const used = db.prepare(`
    SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as n
    FROM ai_agent_token_log
    WHERE account_id = ? AND source = 'conversation_analysis' AND created_at >= ?
  `).get(accountId, monthStart)?.n || 0
  return { ok: used < limit, used, limit }
}

/**
 * Analisa UMA conversa via Haiku. Salva em conversation_insights.
 * Retorna { ok, costUsd, tokens, reason? }
 */
export async function analyzeConversation(leadId) {
  const lead = db.prepare(`
    SELECT l.*, u.name as attendant_name, u.id as attendant_id
    FROM leads l LEFT JOIN users u ON u.id = l.attendant_id
    WHERE l.id = ?
  `).get(leadId)
  if (!lead) return { ok: false, reason: 'lead_not_found' }

  // Check de limite ANTES de chamar API
  const budget = canAnalyze(lead.account_id)
  if (!budget.ok) return { ok: false, reason: 'monthly_limit_reached', used: budget.used, limit: budget.limit }

  // Carrega ultimas N msgs
  const msgs = db.prepare(`
    SELECT direction, content, sender_name, created_at, id
    FROM messages
    WHERE lead_id = ?
    ORDER BY id DESC LIMIT ?
  `).all(leadId, MAX_MSGS_IN_CONTEXT).reverse()

  if (msgs.length < 2) return { ok: false, reason: 'too_few_messages' }

  const lastMsgId = msgs[msgs.length - 1].id

  // Formata conversa pra Haiku
  const conversationText = msgs.map(m => {
    const role = m.direction === 'inbound' ? '[lead]' : '[atendente]'
    const author = m.sender_name ? ` (${m.sender_name})` : ''
    let content = String(m.content || '').slice(0, MAX_CONTENT_LEN_PER_MSG)
    if (!content.trim()) content = '(midia ou conteudo vazio)'
    return `${role}${author}: ${content}`
  }).join('\n')

  const tags = db.prepare(`
    SELECT t.name FROM tags t JOIN lead_tags lt ON lt.tag_id = t.id WHERE lt.lead_id = ?
  `).all(leadId).map(r => r.name).join(', ') || '(sem tags)'

  const userPrompt = `Dados do lead:
- Nome: ${lead.name || '(sem nome)'}
- Telefone: ${lead.phone}
- Cidade: ${lead.city || '(desconhecida)'}
- Empresa: ${lead.empresa || '(desconhecida)'}
- Fonte: ${lead.source || '(desconhecida)'}
- Tags: ${tags}
- Atendente atual: ${lead.attendant_name || '(nenhum)'}

Conversa (cronologica, ${msgs.length} mensagens):
${conversationText}

Analise essa conversa e use a tool save_insights pra retornar os resultados.`

  let result
  try {
    result = await callHaiku({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      tools: [TOOL_SAVE_INSIGHTS],
      maxTokens: 800,
      toolChoice: { type: 'tool', name: 'save_insights' },
    })
  } catch (e) {
    console.error(`[Analyzer] Haiku err lead=${leadId}:`, e.message)
    return { ok: false, reason: 'haiku_error', error: e.message }
  }

  const toolUse = result.toolUses?.[0]
  if (!toolUse || toolUse.name !== 'save_insights' || !toolUse.input) {
    console.warn(`[Analyzer] Haiku nao retornou tool_use lead=${leadId}`)
    return { ok: false, reason: 'no_tool_use' }
  }

  const ins = toolUse.input
  const errorsJson = JSON.stringify(Array.isArray(ins.attendant_errors) ? ins.attendant_errors : [])

  // UPSERT
  db.prepare(`
    INSERT INTO conversation_insights (
      lead_id, account_id, analyzed_at, last_message_id,
      summary, lead_intent, lost_sale_signals, attendant_errors,
      attendant_score, score_reasoning, suggested_next_step, last_message_quality,
      attendant_user_id, tokens_used, cost_usd
    ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      cost_usd = excluded.cost_usd
  `).run(
    lead.id, lead.account_id, lastMsgId,
    ins.summary || '', ins.lead_intent || 'cold', ins.lost_sale_signals || null, errorsJson,
    parseInt(ins.attendant_score) || null,
    ins.score_reasoning || '', ins.suggested_next_step || '', ins.last_message_quality || 'mediocre',
    lead.attendant_id, result.usage.total, result.costUsd
  )

  // Loga custo no ai_agent_token_log
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

  return { ok: true, costUsd: result.costUsd, tokens: result.usage.total, score: ins.attendant_score }
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
    console.warn(`[Analyzer] account=${accountId} limite mensal atingido (used=${budget.used} limit=${budget.limit})`)
    return { ok: false, reason: 'monthly_limit_reached' }
  }

  // Seleciona leads com atividade recente que precisam de análise nova
  const candidates = db.prepare(`
    SELECT l.id
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
          WHERE ci.lead_id = l.id AND ci.analyzed_at < (
            SELECT MAX(created_at) FROM messages WHERE lead_id = l.id
          )
        )
      )
    ORDER BY (SELECT MAX(created_at) FROM messages WHERE lead_id = l.id) DESC
    LIMIT ?
  `).all(accountId, sinceHours, maxLeads)

  console.log(`[Analyzer] account=${accountId} candidates=${candidates.length} max=${maxLeads}`)

  let okCount = 0, skipCount = 0, errCount = 0, totalCost = 0
  for (const c of candidates) {
    try {
      const r = await analyzeConversation(c.id)
      if (r.ok) { okCount++; totalCost += r.costUsd || 0 }
      else { skipCount++ }
      // checagem de budget a cada 10 leads
      if ((okCount + skipCount + errCount) % 10 === 0) {
        const b = canAnalyze(accountId)
        if (!b.ok) {
          console.warn(`[Analyzer] account=${accountId} budget atingido durante batch`)
          break
        }
      }
    } catch (e) {
      errCount++
      console.error(`[Analyzer] err lead=${c.id}:`, e.message)
    }
  }

  console.log(`[Analyzer] account=${accountId} done ok=${okCount} skip=${skipCount} err=${errCount} cost=$${totalCost.toFixed(4)}`)
  return { ok: true, okCount, skipCount, errCount, totalCost }
}

/**
 * Wrapper pra rodar em todas as contas com agentes habilitados.
 * Chamado pelo cron noturno.
 */
export async function analyzeAllAccounts() {
  const accounts = db.prepare("SELECT id FROM accounts WHERE is_active = 1").all()
  let totalOk = 0, totalSkip = 0, totalErr = 0
  for (const acc of accounts) {
    try {
      const r = await analyzeConversationsBatch(acc.id, { maxLeads: 50, sinceHours: 24 })
      if (r.ok) { totalOk += r.okCount; totalSkip += r.skipCount; totalErr += r.errCount }
    } catch (e) {
      console.error(`[Analyzer] account=${acc.id} batch falhou:`, e.message)
      totalErr++
    }
  }
  return { totalOk, totalSkip, totalErr }
}

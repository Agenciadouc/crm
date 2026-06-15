// Coaching weekly analyzer — Haiku gera resumo semanal por atendente.
// Lê insights V2 dos últimos 7 dias + erros/acertos/scores e retorna plano de melhoria.
// Cron: segunda 3h05 UTC (1x por semana por user). Idempotente por (account_id, user_id, week_start).

import db from '../db.js'
import { callHaiku } from './anthropicClient.js'

const SYSTEM_PROMPT_COACHING = `Voce e um coach comercial. Vou te passar metricas e padroes da semana de um vendedor (atendente ou gerente que tambem atende).

Sua tarefa: gerar UM plano de coaching curto, especifico e acionavel pra essa semana.

Avalie:
- Score medio das conversas (0-100)
- Top 3 erros mais cometidos (codigo + frequencia)
- Top 3 acertos mais frequentes
- Conversas com score baixo (lead_ids — pra revisao)
- Padroes de comportamento (rapidez, diagnostico, fechamento)

Retorne via tool save_weekly_coaching:
- summary: 2-3 frases sobre a semana do vendedor
- strengths: array com 3 pontos fortes concretos
- improvements: array com 3 areas de melhoria concretas (NAO genericas — usar codigos de erro reais)
- conversations_to_review: array de lead_ids (3-5 lead_ids com score mais baixo pra rever)
- training_recommended: 1-2 frases — qual treino especifico ele precisa
- suggested_script: trecho de script/mensagem que ele pode usar pra resolver o erro mais comum
- goal_next_week: meta SMART e clara da proxima semana

Seja objetivo. Evite generalidades como "melhorar comunicacao". Cite o codigo do erro, o tipo de conversa, a tecnica concreta.`

const TOOL_SAVE_WEEKLY_COACHING = {
  name: 'save_weekly_coaching',
  description: 'Salva resumo semanal de coaching pro vendedor.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' } },
      improvements: { type: 'array', items: { type: 'string' } },
      conversations_to_review: { type: 'array', items: { type: 'integer' } },
      training_recommended: { type: 'string' },
      suggested_script: { type: 'string' },
      goal_next_week: { type: 'string' },
    },
    required: ['summary', 'strengths', 'improvements', 'training_recommended', 'goal_next_week'],
  },
}

function isoMonday(date) {
  const d = new Date(date)
  const day = d.getUTCDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setUTCDate(d.getUTCDate() + diff)
  return d.toISOString().slice(0, 10)
}

function canCoach(accountId) {
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

/**
 * Gera coaching pra UM atendente pra UMA semana.
 * Idempotente: re-roda sobrescreve a row existente da semana.
 */
export async function generateCoachingForUser(accountId, userId, weekStartStr) {
  const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId)
  if (!user) return { ok: false, reason: 'user_not_found' }

  const budget = canCoach(accountId)
  if (!budget.ok) return { ok: false, reason: 'monthly_limit_reached' }

  // Janela: weekStart (segunda) → weekStart + 7d
  const weekStart = `${weekStartStr} 00:00:00`
  const weekEnd = `${weekStartStr} 23:59:59`
  const weekStartPlus6 = new Date(new Date(weekStart).getTime() + 6 * 86400 * 1000).toISOString().slice(0, 10) + ' 23:59:59'

  // Insights V2 do atendente na semana
  const insights = db.prepare(`
    SELECT ci.lead_id, ci.conversation_score, ci.summary, ci.lead_intent, ci.temperatura_lead,
           ci.attendant_score, ci.prioridade_revisao
    FROM conversation_insights ci
    WHERE ci.account_id = ? AND ci.attendant_user_id = ?
      AND ci.insights_version >= 2
      AND ci.analyzed_at BETWEEN ? AND ?
    ORDER BY ci.conversation_score ASC
  `).all(accountId, userId, weekStart, weekStartPlus6)

  if (insights.length === 0) {
    return { ok: false, reason: 'no_insights_for_week' }
  }

  // Top erros por codigo
  const topErrors = db.prepare(`
    SELECT code, COUNT(*) as n, MAX(description) as sample_desc
    FROM conversation_errors ce
    WHERE ce.account_id = ? AND ce.attendant_user_id = ?
      AND ce.created_at BETWEEN ? AND ?
    GROUP BY code
    ORDER BY n DESC
    LIMIT 5
  `).all(accountId, userId, weekStart, weekStartPlus6)

  // Top acertos
  const topStrengths = db.prepare(`
    SELECT code, COUNT(*) as n, MAX(description) as sample_desc
    FROM conversation_strengths cs
    WHERE cs.account_id = ? AND cs.attendant_user_id = ?
      AND cs.created_at BETWEEN ? AND ?
    GROUP BY code
    ORDER BY n DESC
    LIMIT 5
  `).all(accountId, userId, weekStart, weekStartPlus6)

  const scoreAvg = insights.length
    ? insights.filter(i => i.conversation_score != null).reduce((s, x) => s + x.conversation_score, 0) / Math.max(1, insights.filter(i => i.conversation_score != null).length)
    : null

  const lowestConversations = insights.slice(0, 5).map(i => ({
    lead_id: i.lead_id, score: i.conversation_score, summary: i.summary,
  }))

  const payload = {
    vendedor: { name: user.name, role: user.role },
    semana_inicio: weekStartStr,
    total_conversas: insights.length,
    score_medio: scoreAvg != null ? Math.round(scoreAvg) : null,
    top_erros: topErrors,
    top_acertos: topStrengths,
    conversas_score_mais_baixo: lowestConversations,
  }

  let result
  try {
    result = await callHaiku({
      systemPrompt: SYSTEM_PROMPT_COACHING,
      messages: [{ role: 'user', content: `Dados da semana:\n\n${JSON.stringify(payload, null, 2)}\n\nUse save_weekly_coaching.` }],
      tools: [TOOL_SAVE_WEEKLY_COACHING],
      maxTokens: 1200,
      toolChoice: { type: 'tool', name: 'save_weekly_coaching' },
      accountId,
    })
  } catch (e) {
    console.error(`[Coaching] err user=${userId} week=${weekStartStr}:`, e.message)
    return { ok: false, reason: 'haiku_error' }
  }

  const tu = result.toolUses?.[0]
  if (!tu || tu.name !== 'save_weekly_coaching' || !tu.input) {
    return { ok: false, reason: 'no_tool_use' }
  }

  const c = tu.input
  db.prepare(`
    INSERT INTO attendant_coaching_weekly (
      account_id, user_id, week_start, summary, strengths, improvements,
      conversations_to_review, training_recommended, suggested_script, goal_next_week,
      ai_score_avg_week, tokens_used, cost_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, user_id, week_start) DO UPDATE SET
      summary = excluded.summary,
      strengths = excluded.strengths,
      improvements = excluded.improvements,
      conversations_to_review = excluded.conversations_to_review,
      training_recommended = excluded.training_recommended,
      suggested_script = excluded.suggested_script,
      goal_next_week = excluded.goal_next_week,
      ai_score_avg_week = excluded.ai_score_avg_week,
      tokens_used = excluded.tokens_used,
      cost_usd = excluded.cost_usd
  `).run(
    accountId, userId, weekStartStr,
    c.summary || '', JSON.stringify(c.strengths || []), JSON.stringify(c.improvements || []),
    JSON.stringify(c.conversations_to_review || []),
    c.training_recommended || '', c.suggested_script || '', c.goal_next_week || '',
    scoreAvg, result.usage.total, result.costUsd
  )

  // Log custo
  db.prepare(`
    INSERT INTO ai_agent_token_log (
      account_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, source
    ) VALUES (?, ?, ?, ?, ?, ?, 'coaching_analysis')
  `).run(
    accountId, result.usage.input, result.usage.output,
    result.usage.cacheRead, result.usage.cacheCreation, result.costUsd
  )

  return { ok: true, costUsd: result.costUsd, score_avg: scoreAvg }
}

/**
 * Roda coaching pra todos os atendentes ativos de todas as contas com flag.
 * Chamado pelo scheduler weekly (segunda 3h05 UTC).
 */
export async function generateAllCoachings(weekStartStr) {
  if (!weekStartStr) {
    // Última segunda completa
    const lastMonday = new Date()
    lastMonday.setUTCDate(lastMonday.getUTCDate() - 7)
    weekStartStr = isoMonday(lastMonday)
  }

  const accounts = db.prepare(`
    SELECT id FROM accounts WHERE is_active = 1 AND attendant_analytics_enabled = 1
  `).all()

  let totalOk = 0, totalSkip = 0, totalErr = 0
  for (const acc of accounts) {
    const users = db.prepare(`
      SELECT id, name FROM users
      WHERE account_id = ? AND role IN ('atendente', 'gerente')
        AND is_active = 1 AND COALESCE(is_bot, 0) = 0
    `).all(acc.id)
    for (const u of users) {
      try {
        const r = await generateCoachingForUser(acc.id, u.id, weekStartStr)
        if (r.ok) totalOk++
        else totalSkip++
      } catch (e) {
        totalErr++
        console.error(`[Coaching] err account=${acc.id} user=${u.id}:`, e.message)
      }
    }
  }
  console.log(`[Coaching] week=${weekStartStr} ok=${totalOk} skip=${totalSkip} err=${totalErr}`)
  return { weekStart: weekStartStr, totalOk, totalSkip, totalErr }
}

export { isoMonday }

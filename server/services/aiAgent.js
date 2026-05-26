// Servico do Agente de IA: orquestra recebimento de msg -> Haiku -> tool calls -> envio.
// Chamado fire-and-forget pelo webhook depois do lead ser identificado.

import fetch from 'node-fetch'
import db from '../db.js'
import { callHaiku } from './anthropicClient.js'
import { broadcastSSE } from '../sse.js'
import { pickFromRoulette as rouletteUtil } from './roulette.js'
import { notifyAndOpenLead } from './leadHandoff.js'

// ─── Helpers ──────────────────────────────────────────────────────────

function getAccount(accountId) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId)
}

function getLead(leadId) {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
}

function getUser(userId) {
  if (!userId) return null
  return db.prepare('SELECT id, name, is_bot, is_active FROM users WHERE id = ?').get(userId)
}

function leadHasTag(leadId, tagId) {
  return !!db.prepare('SELECT 1 FROM lead_tags WHERE lead_id = ? AND tag_id = ?').get(leadId, tagId)
}

function resetMonthlyTokensIfNeeded(agent) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  if (agent.current_month !== currentMonth) {
    db.prepare("UPDATE ai_agents SET tokens_used_this_month = 0, current_month = ? WHERE id = ?").run(currentMonth, agent.id)
    agent.tokens_used_this_month = 0
    agent.current_month = currentMonth
  }
}

// ─── findAgentForLead ─────────────────────────────────────────────────

export function findAgentForLead(lead, instanceId) {
  if (!lead) return null

  // 0. Account tem feature gate?
  const account = getAccount(lead.account_id)
  if (!account || !account.ai_agents_enabled) return null

  // 1. Lead pode receber bot?
  if (lead.is_blocked || lead.is_archived || !lead.is_active) return null

  // 2. Lead ja foi handoff'ed por bot? Nao volta a atender.
  if (lead.ai_handed_off_at) return null

  // 3. Lead ja tem atendente HUMANO definido? Bot nao interfere.
  if (lead.attendant_id) {
    const att = getUser(lead.attendant_id)
    if (att && !att.is_bot) return null
  }

  // 4. Busca agentes ativos
  const agents = db.prepare("SELECT * FROM ai_agents WHERE account_id = ? AND is_active = 1 ORDER BY id ASC").all(lead.account_id)

  for (const agent of agents) {
    // Filtro etapa
    const hasStage = db.prepare('SELECT 1 FROM ai_agent_stages WHERE agent_id = ? AND stage_id = ?').get(agent.id, lead.stage_id)
    if (!hasStage) continue
    // Filtro instancia (se instanceId presente)
    if (instanceId) {
      const hasInstance = db.prepare('SELECT 1 FROM ai_agent_instances WHERE agent_id = ? AND instance_id = ?').get(agent.id, instanceId)
      if (!hasInstance) continue
    }
    // Filtro tag obrigatoria
    if (agent.required_tag_id && !leadHasTag(lead.id, agent.required_tag_id)) continue

    // Modo de ativacao
    switch (agent.activation_mode) {
      case 'default_attendant':
        if (lead.attendant_id === agent.user_id || !lead.attendant_id) return agent
        break
      case 'roulette':
        if (lead.attendant_id === agent.user_id) return agent
        break
      case 'conditional':
        return agent
      case 'manual':
        if (lead.attendant_id === agent.user_id) return agent
        break
    }
  }
  return null
}

// ─── buildSystemPrompt ────────────────────────────────────────────────

function buildSystemPrompt(agent, lead, availableTags, availableStages) {
  const parts = []
  parts.push(`Voce e ${agent.name}, assistente atendendo leads no WhatsApp.`)
  if (agent.persona) parts.push(`Tom de voz: ${agent.persona}`)
  if (agent.identifies_as_bot) parts.push('Voce e uma IA assistente. Pode mencionar isso se perguntado.')
  parts.push('')

  if (agent.knowledge_base) {
    parts.push('CONTEXTO DA EMPRESA:')
    parts.push(agent.knowledge_base)
    parts.push('')
  }

  parts.push('REGRAS RIGIDAS:')
  parts.push('- Responda em PT-BR, MAXIMO 2 frases curtas.')
  parts.push('- Use linguagem natural, evite parecer robotico.')
  parts.push('- UMA pergunta por mensagem. NUNCA dispare 2+ perguntas no mesmo turno.')
  parts.push('- SEMPRE QUE coletar um dado (chamar update_lead_info ou outra tool), a SUA mensagem de texto DEVE conter (a) breve confirmacao + (b) a PROXIMA pergunta. NUNCA encerre com "anotei" ou "ok" sem fazer a proxima pergunta — voce e quem conduz a conversa.')
  parts.push('- Quando o lead informar info pessoal (nome, cidade, empresa, cargo, etc), chame update_lead_info ANTES de responder. Para "cargo" use field="empresa" com valor formatado "Cargo: X - Setor".')
  parts.push('- Se o lead mandar uma mensagem vazia, "ola" ou similar sem contexto novo, NAO encerre — retome de onde parou e pergunte o proximo dado faltante.')
  if (agent.never_mention) parts.push(`- NUNCA mencione: ${agent.never_mention}`)
  if (agent.handoff_keywords) {
    parts.push(`- Se o lead disser uma das palavras "${agent.handoff_keywords}" -> chame transfer_to_human(reason="keyword").`)
  }
  parts.push('- So chame transfer_to_human(reason="unknown") se REALMENTE nao tiver como continuar (ex: lead pergunta algo completamente fora do escopo da empresa). NAO use "unknown" so porque precisa de mais info — pergunte!')
  parts.push('')

  if (agent.qualification_criteria) {
    parts.push('QUALIFICACAO:')
    parts.push(`Considere o lead qualificado quando: ${agent.qualification_criteria}`)
    let requiredFields = []
    try { requiredFields = JSON.parse(agent.required_fields || '[]') } catch {}
    if (requiredFields.length > 0) {
      parts.push(`Campos obrigatorios pra qualificar: ${requiredFields.join(', ')}.`)
      const collected = []
      if (requiredFields.includes('name') && lead.name) collected.push(`nome=${lead.name}`)
      if (requiredFields.includes('email') && lead.email) collected.push(`email=${lead.email}`)
      if (requiredFields.includes('phone') && lead.phone) collected.push(`phone=${lead.phone}`)
      if (requiredFields.includes('city') && lead.city) collected.push(`cidade=${lead.city}`)
      if (requiredFields.includes('empresa') && lead.empresa) collected.push(`empresa=${lead.empresa}`)
      if (requiredFields.includes('instagram') && lead.instagram) collected.push(`instagram=${lead.instagram}`)
      if (collected.length > 0) parts.push(`Ja coletados: ${collected.join('; ')}.`)
    }
    parts.push('Quando qualificar, chame transfer_to_human(reason="qualified") imediatamente.')
    parts.push('')
  }

  if (availableStages && availableStages.length > 0) {
    parts.push('ETAPAS DO FUNIL DISPONIVEIS: ' + availableStages.map(s => `"${s.name}"`).join(', '))
  }
  if (availableTags && availableTags.length > 0) {
    parts.push('TAGS DISPONIVEIS: ' + availableTags.map(t => `"${t.name}"`).join(', '))
  }

  return parts.filter(Boolean).join('\n')
}

// ─── buildConversationHistory ────────────────────────────────────────

function buildConversationHistory(leadId, limit = 10) {
  // Pega ultimas N msgs (excluindo as do bot pra historico mais limpo? Nao, inclui ambas)
  const msgs = db.prepare(`
    SELECT direction, content, ai_agent_id
    FROM messages
    WHERE lead_id = ? AND content IS NOT NULL AND content != ''
    ORDER BY id DESC LIMIT ?
  `).all(leadId, limit).reverse()

  return msgs.map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content,
  }))
}

// ─── countBotMessagesInThread ─────────────────────────────────────────

function countBotMessagesInThread(agent, leadId) {
  return db.prepare(`
    SELECT COUNT(*) as c FROM messages WHERE lead_id = ? AND ai_agent_id = ?
  `).get(leadId, agent.id).c
}

// ─── pickFromRoulette (wrapper do util — handoff sempre exclui bots) ─────

function pickFromRoulette(accountId, instanceId, excludeUserId) {
  return rouletteUtil(accountId, instanceId, { excludeUserId, excludeBots: true })
}

// ─── executeHandoff ───────────────────────────────────────────────────

function executeHandoff(agent, lead, reason, instanceId) {
  const rule = db.prepare('SELECT * FROM ai_agent_handoff_rules WHERE agent_id = ? AND reason = ?').get(agent.id, reason)

  // Resolve target user
  let targetUserId = null
  if (rule?.target_type === 'specific_user' && rule.target_user_id) {
    const u = getUser(rule.target_user_id)
    if (u && u.is_active) targetUserId = u.id
    else if (rule.fallback_to_roulette) targetUserId = pickFromRoulette(lead.account_id, instanceId, agent.user_id)
  } else {
    // Default: roleta humana
    targetUserId = pickFromRoulette(lead.account_id, instanceId, agent.user_id)
  }

  // Atribui (se conseguiu pegar atendente)
  if (targetUserId) {
    db.prepare("UPDATE leads SET attendant_id = ?, updated_at = datetime('now') WHERE id = ?").run(targetUserId, lead.id)
  }

  // Marca como handoff'ed pra bot nao voltar
  db.prepare("UPDATE leads SET ai_handed_off_at = datetime('now') WHERE id = ?").run(lead.id)

  // Move etapa (se configurado)
  if (rule?.move_to_stage_id) {
    const prev = lead.stage_id
    db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(rule.move_to_stage_id, lead.id)
    db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(lead.id, prev, rule.move_to_stage_id, 'ai_handoff')
  }

  // Add tag (se configurado)
  if (rule?.add_tag_id) {
    db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, rule.add_tag_id)
  }

  console.log(`[AI Agent] Handoff lead=${lead.id} reason=${reason} target_user=${targetUserId}`)
  try { broadcastSSE(lead.account_id, 'lead:updated', { id: lead.id }) } catch {}

  // Dispara handoff de primeira msg + notif (se target eh humano valido)
  if (targetUserId) {
    setImmediate(() => {
      notifyAndOpenLead(lead.id, targetUserId, { source: 'bot_handoff' })
        .catch(e => console.error('[Handoff bot]', e.message))
    })
  }
}

// ─── Tools (function calling) ─────────────────────────────────────────

function getToolsForAgent(availableTags, availableStages) {
  return [
    {
      name: 'update_lead_info',
      description: 'Salva informacao que o lead informou (nome, email, cidade, empresa, instagram). Use SEMPRE que o lead disser esses dados.',
      input_schema: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['name', 'email', 'city', 'empresa', 'instagram'] },
          value: { type: 'string', description: 'Valor informado pelo lead' },
        },
        required: ['field', 'value'],
      },
    },
    {
      name: 'add_tag',
      description: 'Marca o lead com uma tag (use apenas tags listadas no system).',
      input_schema: {
        type: 'object',
        properties: {
          tag_name: { type: 'string', enum: availableTags.map(t => t.name) },
        },
        required: ['tag_name'],
      },
    },
    {
      name: 'move_stage',
      description: 'Move o lead pra outra etapa do funil (use apenas etapas listadas).',
      input_schema: {
        type: 'object',
        properties: {
          stage_name: { type: 'string', enum: availableStages.map(s => s.name) },
        },
        required: ['stage_name'],
      },
    },
    {
      name: 'transfer_to_human',
      description: 'Transfere o lead pra atendente humano. Use quando: lead pediu humano (reason=keyword), lead esta qualificado (reason=qualified), voce nao soube responder (reason=unknown), ou conversou demais sem qualificar (reason=max_messages).',
      input_schema: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: ['qualified', 'keyword', 'unknown', 'max_messages', 'audio_received', 'other'] },
        },
        required: ['reason'],
      },
    },
  ]
}

// ─── executeTool ──────────────────────────────────────────────────────

async function executeTool(toolUse, agent, lead, instanceId, availableTags, availableStages) {
  const { name, input } = toolUse
  try {
    if (name === 'update_lead_info') {
      const allowed = ['name', 'email', 'city', 'empresa', 'instagram']
      if (allowed.includes(input.field) && input.value) {
        db.prepare(`UPDATE leads SET ${input.field} = ? WHERE id = ?`).run(String(input.value).substring(0, 200), lead.id)
        console.log(`[AI Agent] update_lead_info lead=${lead.id} ${input.field}="${input.value}"`)
      }
    } else if (name === 'add_tag') {
      const tag = availableTags.find(t => t.name === input.tag_name)
      if (tag) {
        db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, tag.id)
        console.log(`[AI Agent] add_tag lead=${lead.id} tag="${input.tag_name}"`)
      }
    } else if (name === 'move_stage') {
      const stage = availableStages.find(s => s.name === input.stage_name)
      if (stage && stage.id !== lead.stage_id) {
        const prev = lead.stage_id
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
        db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(lead.id, prev, stage.id, 'ai_agent')
        console.log(`[AI Agent] move_stage lead=${lead.id} -> "${input.stage_name}"`)
      }
    } else if (name === 'transfer_to_human') {
      const reason = input.reason || 'other'
      executeHandoff(agent, lead, reason, instanceId)
      return { handoff: true, reason }
    }
  } catch (e) {
    console.error(`[AI Agent] Erro tool ${name}:`, e.message)
  }
  return { handoff: false }
}

// ─── sendEvolutionText ────────────────────────────────────────────────

async function sendEvolutionText(instance, phone, text) {
  const number = (phone || '').replace(/[^\d]/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')
  const res = await fetch(`${instance.api_url}/message/sendText/${instance.instance_name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': instance.api_key },
    body: JSON.stringify({ number, text, delay: 10000 }),
  })
  const data = await res.json()
  return { ok: !!data.key?.id, wamsgId: data.key?.id || null, raw: data }
}

// ─── processInboundMessage ────────────────────────────────────────────

export async function processInboundMessage(lead, msgContent, mediaType, instanceId) {
  try {
    console.log(`[AI Agent DEBUG] processInboundMessage chamado lead=${lead?.id} instance=${instanceId} mediaType=${mediaType} content="${(msgContent||'').substring(0,30)}"`)
    // 1. Encontra agente
    const agent = findAgentForLead(lead, instanceId)
    if (!agent) return
    console.log(`[AI Agent DEBUG] agente encontrado: id=${agent.id} name=${agent.name}`)

    // 2. Reset mensal de tokens se mes virou
    resetMonthlyTokensIfNeeded(agent)

    // 3. Checa limite de tokens
    if (agent.tokens_used_this_month >= agent.monthly_token_limit) {
      console.log(`[AI Agent] Limite mensal estourado agent=${agent.id}, fazendo handoff silencioso`)
      executeHandoff(agent, lead, 'unknown', instanceId)
      return
    }

    // 4. Audio sem suporte?
    if (mediaType === 'audio' && !agent.responds_to_audio) {
      const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (inst && inst.status === 'connected') {
        const declineMsg = agent.audio_decline_message || 'Oi! Por enquanto so leio mensagens de texto. Pode digitar pra mim?'
        const sendRes = await sendEvolutionText(inst, lead.phone, declineMsg)
        if (sendRes.ok) {
          db.prepare(`
            INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, ai_agent_id)
            VALUES (?, ?, 'outbound', ?, 'text', 'AI', ?, datetime('now'), ?, ?)
          `).run(lead.id, lead.account_id, declineMsg, sendRes.wamsgId, instanceId, agent.id)
          try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
        }
      }
      executeHandoff(agent, lead, 'audio_received', instanceId)
      return
    }

    // 5. Checa max_messages
    const botMsgCount = countBotMessagesInThread(agent, lead.id)
    if (botMsgCount >= agent.max_messages_before_handoff) {
      console.log(`[AI Agent] Max messages atingido agent=${agent.id} lead=${lead.id}`)
      executeHandoff(agent, lead, 'max_messages', instanceId)
      return
    }

    // 6. Carrega tags e etapas disponiveis (pra tools enum)
    const availableTags = db.prepare('SELECT id, name FROM tags WHERE account_id = ?').all(lead.account_id)
    const availableStages = db.prepare(`
      SELECT s.id, s.name FROM funnel_stages s
      JOIN funnels f ON f.id = s.funnel_id
      WHERE f.account_id = ? AND f.is_default = 1
      ORDER BY s.position
    `).all(lead.account_id)

    // 7. Monta system prompt
    const systemPrompt = buildSystemPrompt(agent, lead, availableTags, availableStages)

    // 8. Monta history (ultimas 10 msgs)
    const history = buildConversationHistory(lead.id, 10)
    // Garante que a ultima msg eh do lead (user)
    if (history.length === 0 || history[history.length - 1].role !== 'user') {
      history.push({ role: 'user', content: msgContent || '(mensagem vazia)' })
    }

    // 9. Define tools
    const tools = getToolsForAgent(availableTags, availableStages)

    // 10-12. Multi-turn loop: chama Haiku, executa tools, se nao houver texto e teve tool, chama de novo com tool_results
    const MAX_ITERATIONS = 4
    let workingMessages = [...history]
    let finalText = ''
    let totalToolsExecuted = 0
    let totalTokens = 0
    let totalCost = 0
    let handoffTriggered = false
    let iterationsRun = 0

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      iterationsRun++
      let result
      try {
        result = await callHaiku({
          systemPrompt,
          messages: workingMessages,
          tools,
          maxTokens: 400,
          toolChoice: 'auto',
        })
      } catch (e) {
        console.error(`[AI Agent] Erro chamando Haiku agent=${agent.id} iter=${i}:`, e.message)
        break
      }

      // Log de uso (cada chamada)
      db.prepare(`
        INSERT INTO ai_agent_token_log (agent_id, account_id, lead_id, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(agent.id, agent.account_id, lead.id, result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheCreation, result.costUsd)
      const iterTokens = result.usage.input + result.usage.output + result.usage.cacheRead + result.usage.cacheCreation
      totalTokens += iterTokens
      totalCost += result.costUsd
      db.prepare("UPDATE ai_agents SET tokens_used_this_month = tokens_used_this_month + ? WHERE id = ?").run(iterTokens, agent.id)

      // Acumula texto
      if (result.content && result.content.trim()) finalText += (finalText ? ' ' : '') + result.content.trim()

      // Sem tool_uses -> termina
      if (!result.toolUses || result.toolUses.length === 0) break

      // Executa tools e monta tool_results pra proxima iteracao
      const toolResults = []
      for (const tu of result.toolUses) {
        totalToolsExecuted++
        const tr = await executeTool(tu, agent, lead, instanceId, availableTags, availableStages)
        if (tr.handoff) handoffTriggered = true
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: tr.handoff ? `Handoff executado (reason=${tr.reason}). Termine a conversa.` : 'OK',
        })
      }

      // Se handoff foi disparado, nao precisa continuar pedindo mais output
      if (handoffTriggered) break

      // Monta a proxima rodada: adiciona resposta do assistant (text + tool_uses) e o tool_result
      const assistantContent = []
      if (result.content && result.content.trim()) assistantContent.push({ type: 'text', text: result.content })
      for (const tu of result.toolUses) assistantContent.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
      workingMessages = [
        ...workingMessages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults },
      ]
    }

    // 13. Envia resposta texto (se houver)
    if (finalText && finalText.trim()) {
      const inst = db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(instanceId)
      if (inst && inst.status === 'connected') {
        const sendRes = await sendEvolutionText(inst, lead.phone, finalText.trim())
        if (sendRes.ok) {
          db.prepare(`
            INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id, ai_agent_id)
            VALUES (?, ?, 'outbound', ?, 'text', 'AI', ?, datetime('now'), ?, ?)
          `).run(lead.id, lead.account_id, finalText.trim(), sendRes.wamsgId, instanceId, agent.id)
          try { broadcastSSE(lead.account_id, 'lead:message', { lead_id: lead.id }) } catch {}
        } else {
          console.error(`[AI Agent] Falha envio agent=${agent.id} lead=${lead.id}:`, JSON.stringify(sendRes.raw).substring(0, 200))
        }
      }
    }

    console.log(`[AI Agent] Processed lead=${lead.id} agent=${agent.id} iters=${iterationsRun} tokens=${totalTokens} cost_usd=${totalCost.toFixed(6)} tools=${totalToolsExecuted} handoff=${handoffTriggered} text_len=${finalText.length}`)
  } catch (err) {
    console.error('[AI Agent] processInboundMessage erro:', err.message)
  }
}

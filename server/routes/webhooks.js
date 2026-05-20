import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { triggerCapiForStageChange } from '../services/metaCapi.js'
import { getInstanceConfig, wasAutoMsgSentRecently, sendAutoMessage, shouldSendAway } from '../services/autoMessages.js'

const router = Router()

// Helper: fetch profile picture URL from Evolution (async, fire-and-forget)
async function fetchAndSaveProfilePic(instance, phone, leadId) {
  if (!instance || !phone || !leadId) return
  try {
    const r = await fetch(`${instance.api_url}/chat/fetchProfilePictureUrl/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ number: phone }),
    })
    const data = await r.json()
    if (data?.profilePictureUrl) {
      db.prepare("UPDATE leads SET profile_pic_url = ?, profile_pic_updated_at = datetime('now') WHERE id = ?").run(data.profilePictureUrl, leadId)
    }
  } catch {}
}

// Helper: get or create lead from phone
function normalizePhone(p) {
  if (!p) return p
  p = p.replace(/[^\d]/g, '')
  if (p.startsWith('55') && p.length === 13) return p
  if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
  if (!p.startsWith('55') && p.length === 11) return '55' + p
  if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
  return p // can't normalize safely — return as-is
}

// Gera chave canonica de comparacao: DDD + 8 digitos finais (sem 55, sem 9 inicial de celular)
// Cobre todos formatos: "5547991351835", "47991351835", "4791351835" -> "4791351835"
function phoneCompareKey(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d.length === 10 ? d : d.slice(-10) // fallback: ultimos 10 se formato desconhecido
}

function getOrCreateLead(accountId, phone, name, source, waJid, instanceId) {
  phone = normalizePhone(phone)

  // ─── GATE: phone bloqueado nesta conta? Ignora silenciosamente. ───
  // Match por phone exato OU sufixo 8d (mesma logica de dedup). Se houver QUALQUER lead bloqueado
  // pra esse numero, retorna blocked=true e nao processa msg.
  if (phone) {
    const blockedExact = db.prepare("SELECT id FROM leads WHERE account_id = ? AND phone = ? AND is_blocked = 1 LIMIT 1").get(accountId, phone)
    if (blockedExact) return { lead: null, isNew: false, blocked: true }
    const key = phoneCompareKey(phone)
    if (key) {
      const last8 = key.slice(-8)
      const candidates = db.prepare("SELECT phone FROM leads WHERE account_id = ? AND is_blocked = 1 AND phone LIKE ?").all(accountId, '%' + last8)
      if (candidates.some(c => phoneCompareKey(c.phone) === key)) {
        return { lead: null, isNew: false, blocked: true }
      }
    }
  }

  let lead = null
  if (waJid) lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, waJid)
  if (!lead && phone) {
    // 1) match exato (rapido, usa index)
    lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND phone = ? ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(accountId, phone)
    // 2) fallback: busca candidatos por sufixo 8d e compara via phoneCompareKey
    if (!lead) {
      const key = phoneCompareKey(phone)
      if (key) {
        const last8 = key.slice(-8)
        const candidates = db.prepare(`SELECT * FROM leads WHERE account_id = ? AND phone LIKE ? ORDER BY is_archived ASC, created_at DESC`).all(accountId, '%' + last8)
        lead = candidates.find(c => phoneCompareKey(c.phone) === key) || null
      }
    }
  }

  if (lead) {
    // Update instance_id if not set
    if (instanceId && !lead.instance_id) {
      db.prepare('UPDATE leads SET instance_id = ? WHERE id = ?').run(instanceId, lead.id)
    }
    // Se esta arquivado: NAO desarquiva (so manual). Apenas marca has_new_after_archive
    // pra atendente saber que tem msg nova no lead arquivado (badge no /archived)
    if (lead.is_archived) {
      db.prepare("UPDATE leads SET has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
    }
    return { lead, isNew: false }
  }

  // ─── GATE: instancia em modo RESTRITO so processa leads ja cadastrados (form/sheets/Novo chat).
  // Se chegou aqui (lead nao existe ainda) E veio do Evolution webhook (instanceId presente) E instancia eh restrita,
  // ignora silenciosamente. Form/site/sheets passam instanceId=null entao bypassam esse gate.
  if (instanceId) {
    const inst = db.prepare('SELECT lead_intake_mode FROM whatsapp_instances WHERE id = ?').get(instanceId)
    if (inst?.lead_intake_mode === 'restricted') {
      return { lead: null, isNew: false, restricted: true }
    }
  }

  // Get default funnel + first stage
  const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(accountId)
  if (!funnel) return { lead: null, isNew: false }
  const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
  if (!firstStage) return { lead: null, isNew: false }

  // Distribution: prefer instance.default_attendant_id, fallback to round-robin/manual
  let attendantId = null
  if (instanceId) {
    const inst = db.prepare('SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?').get(instanceId)
    if (inst?.default_attendant_id) attendantId = inst.default_attendant_id
  }
  if (!attendantId) {
    const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(accountId, funnel.id)
    if (rule && rule.type === 'round_robin' && rule.active_attendants) {
      try {
        const attendants = JSON.parse(rule.active_attendants)
        if (attendants.length > 0) {
          const idx = rule.last_assigned_index % attendants.length
          attendantId = attendants[idx]
          db.prepare("UPDATE distribution_rules SET last_assigned_index = ?, updated_at = datetime('now') WHERE id = ?").run(rule.last_assigned_index + 1, rule.id)
        }
      } catch {}
    }
  }

  const result = db.prepare(`
    INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(accountId, funnel.id, firstStage.id, attendantId, name || phone || 'Sem nome', phone || null, source, waJid || null, instanceId || null)

  // Log stage history
  db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(result.lastInsertRowid, firstStage.id, 'webhook')

  lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
  return { lead, isNew: true }
}

// Helper: auto-detect stage from message keywords
function autoDetectStage(lead, messageText) {
  if (!messageText) return
  const text = messageText.toLowerCase()

  // Get all stages ahead of current
  const currentStage = db.prepare('SELECT position FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!currentStage) return

  const aheadStages = db.prepare('SELECT * FROM funnel_stages WHERE funnel_id = ? AND position > ? ORDER BY position').all(lead.funnel_id, currentStage.position)

  for (const stage of aheadStages) {
    if (!stage.auto_keywords) continue
    let keywords
    try { keywords = JSON.parse(stage.auto_keywords) } catch { continue }
    if (!Array.isArray(keywords)) continue

    const matched = keywords.some(kw => text.includes(kw.toLowerCase()))
    if (matched) {
      const oldStageId = lead.stage_id
      db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(stage.id, lead.id)
      const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
        lead.id, oldStageId, stage.id, 'auto_keyword'
      )
      // Dispara CAPI se a etapa tem evento Meta mapeado
      triggerCapiForStageChange(lead.id, stage.id, histRes.lastInsertRowid)
      break // Only advance to first match
    }
  }
}

// Evolution API webhook
router.post('/evolution/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    // Identify which instance sent this webhook (by instance name in body or match account)
    const webhookInstance = req.body.instance || req.body.instanceName || null
    let waInstance = null
    if (webhookInstance) {
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND instance_name = ?').get(account.id, webhookInstance)
    }
    if (!waInstance) {
      // Fallback: get first instance for this account
      waInstance = db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? ORDER BY id LIMIT 1').get(account.id)
    }

    // Verify webhook secret if configured
    if (waInstance?.webhook_secret && req.headers['x-webhook-secret'] !== waInstance.webhook_secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' })
    }

    const { event, data } = req.body
    if (event !== 'messages.upsert' || !data) return res.json({ ok: true })

    const remoteJid = data.key?.remoteJid || ''
    const senderPn = data.key?.senderPn || data.senderPn || ''
    const fromMe = data.key?.fromMe || false
    const msgId = data.key?.id || ''
    const pushName = data.pushName || ''
    const timestamp = data.messageTimestamp ? new Date(parseInt(data.messageTimestamp) * 1000).toISOString() : new Date().toISOString()

    // Detect message type + extract content/media info
    const msg = data.message || {}
    let content = ''
    let mediaType = 'text'
    let mediaUrl = null
    let mediaCaption = ''
    if (msg.conversation) {
      content = msg.conversation
    } else if (msg.extendedTextMessage?.text) {
      content = msg.extendedTextMessage.text
    } else if (msg.imageMessage) {
      mediaType = 'image'; mediaUrl = msg.imageMessage.url || null; mediaCaption = msg.imageMessage.caption || ''; content = mediaCaption || '[Imagem]'
    } else if (msg.videoMessage) {
      mediaType = 'video'; mediaUrl = msg.videoMessage.url || null; mediaCaption = msg.videoMessage.caption || ''; content = mediaCaption || '[Video]'
    } else if (msg.audioMessage) {
      mediaType = 'audio'; mediaUrl = msg.audioMessage.url || null; content = '[Audio]'
    } else if (msg.documentMessage) {
      mediaType = 'document'; mediaUrl = msg.documentMessage.url || null; content = msg.documentMessage.fileName || '[Documento]'
    } else if (msg.stickerMessage) {
      mediaType = 'sticker'; mediaUrl = msg.stickerMessage.url || null; content = '[Sticker]'
    } else if (msg.reactionMessage) {
      // Lead reagiu a uma mensagem com emoji
      const emoji = msg.reactionMessage.text || '❤️'
      content = `${emoji} (reacao)`
      mediaType = 'reaction'
    } else if (msg.locationMessage || msg.liveLocationMessage) {
      const loc = msg.locationMessage || msg.liveLocationMessage
      const lat = loc.degreesLatitude
      const lng = loc.degreesLongitude
      const name = loc.name || ''
      content = name ? `📍 ${name}` : (lat && lng ? `📍 Localizacao: ${lat}, ${lng}` : '📍 Localizacao compartilhada')
      mediaType = 'location'
    } else if (msg.contactMessage || msg.contactsArrayMessage) {
      const contact = msg.contactMessage?.displayName || msg.contactsArrayMessage?.contacts?.[0]?.displayName || ''
      content = contact ? `👤 Contato: ${contact}` : '👤 Contato compartilhado'
      mediaType = 'contact'
    } else if (msg.protocolMessage?.type === 0 || msg.protocolMessage?.type === 'REVOKE') {
      // type 0 = REVOKE (mensagem apagada pelo remetente)
      content = '🚫 Mensagem apagada'
      mediaType = 'system'
    } else if (msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3) {
      const poll = msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3
      content = poll?.name ? `📊 Enquete: ${poll.name}` : '📊 Enquete'
      mediaType = 'poll'
    } else if (msg.pollUpdateMessage) {
      content = '📊 Voto em enquete'
      mediaType = 'poll'
    } else if (msg.editedMessage || msg.protocolMessage?.editedMessage) {
      // Mensagem editada — tenta pegar o novo texto
      const edited = msg.editedMessage || msg.protocolMessage?.editedMessage
      const newText = edited?.message?.conversation || edited?.message?.extendedTextMessage?.text || ''
      content = newText ? `✏️ ${newText}` : '✏️ Mensagem editada'
    } else if (msg.buttonsResponseMessage) {
      content = msg.buttonsResponseMessage.selectedDisplayText || msg.buttonsResponseMessage.selectedButtonId || '[Botao clicado]'
    } else if (msg.listResponseMessage) {
      content = msg.listResponseMessage.title || msg.listResponseMessage.singleSelectReply?.selectedRowId || '[Opcao selecionada]'
    } else if (msg.templateButtonReplyMessage) {
      content = msg.templateButtonReplyMessage.selectedDisplayText || '[Botao de template]'
    } else if (msg.viewOnceMessage || msg.viewOnceMessageV2 || msg.viewOnceMessageV2Extension) {
      content = '👁️ Mensagem de visualizacao unica'
      mediaType = 'view_once'
    } else if (msg.ephemeralMessage) {
      // Mensagem temporaria — desempacota a mensagem interna
      const inner = msg.ephemeralMessage.message || {}
      if (inner.conversation) content = inner.conversation
      else if (inner.extendedTextMessage?.text) content = inner.extendedTextMessage.text
      else content = '⏱️ Mensagem temporaria'
    }
    // Log de tipos nao mapeados pra ajudar a expandir a lista futuramente
    if (!content && Object.keys(msg).length > 0) {
      const tipo = Object.keys(msg).filter(k => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage')[0] || 'desconhecido'
      console.log(`[Webhook] Tipo de mensagem nao tratado: ${tipo}`, JSON.stringify(msg).substring(0, 200))
      content = `[${tipo}]`
      mediaType = 'unknown'
    }

    // ─── Detecta click-to-WhatsApp Ad (CTWA) — lead veio de campanha de mensagem
    // Evolution v2+ coloca contextInfo.externalAdReply no NIVEL ROOT do payload (data.contextInfo)
    // Evolution antiga colocava dentro de message.<tipo>.contextInfo
    // Cobrimos os 2 formatos
    function getCtwaInfo(message, dataRoot) {
      const ctxs = [
        dataRoot?.contextInfo,                       // Evolution v2+: nivel root
        message.extendedTextMessage?.contextInfo,
        message.imageMessage?.contextInfo,
        message.videoMessage?.contextInfo,
        message.audioMessage?.contextInfo,
        message.documentMessage?.contextInfo,
        message.stickerMessage?.contextInfo,
        message.contextInfo,
      ].filter(Boolean)
      for (const ctx of ctxs) {
        const ad = ctx.externalAdReply
        if (ad) return ad
      }
      return null
    }
    function detectAdSource(ad) {
      if (!ad) return null
      const src = String(ad.sourceType || '').toLowerCase()
      const url = String(ad.sourceUrl || '').toLowerCase()
      const isPaid = src === 'ad' || src === 'cta_url' || !!ad.ctwaClid
      // Plataforma pelo URL ou outras dicas
      let platform = ''
      if (url.includes('instagram')) platform = 'Instagram'
      else if (url.includes('facebook') || url.includes('fb.') || url.includes('fb.me')) platform = 'Facebook'
      // Se nao deu pra detectar e tem ctwaClid (vem de Meta sempre), deixa generico
      if (!platform && ad.ctwaClid) platform = 'Meta'
      if (!platform) return null
      return isPaid ? `${platform} Pago` : platform
    }
    const adInfo = getCtwaInfo(msg, data)
    const adSourceLabel = detectAdSource(adInfo) // ex: "Facebook Pago", "Instagram", null

    // DEBUG TEMPORARIO: loga payload bruto quando inbound de potencial CTWA (P9 padrao, ou ja tem adInfo)
    // Remover apos confirmar funcionamento
    if (!fromMe && (adInfo || (content && content.startsWith('P9')))) {
      console.log(`[CTWA DEBUG] account=${req.params.accountSlug} content="${(content||'').substring(0,60)}" adInfo=${JSON.stringify(adInfo)} dataContextInfo=${JSON.stringify(data.contextInfo || null)} msgKeys=${Object.keys(msg).slice(0,8).join(',')}`)
    }

    // Skip groups, status, broadcasts
    if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('@broadcast') || remoteJid.includes('status@')) {
      return res.json({ ok: true })
    }

    // Prefer senderPn (real phone) over remoteJid (might be @lid = legacy ID)
    const realJid = senderPn || remoteJid
    let phone = ''
    let dedupJid = ''
    let isLid = false

    if (senderPn) {
      phone = normalizePhone(senderPn.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
      dedupJid = `${phone}@s.whatsapp.net`
    } else if (realJid.endsWith('@lid')) {
      if (!pushName) return res.json({ ok: true })
      isLid = true
      phone = realJid.replace('@lid', '')
      dedupJid = realJid
    } else {
      phone = normalizePhone(realJid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace(/[^\d]/g, ''))
      dedupJid = `${phone}@s.whatsapp.net`
    }
    if (!phone) return res.json({ ok: true })

    // Quando fromMe=true, o pushName e o nome de quem ENVIOU (atendente/operador da conta WhatsApp),
    // nao do lead. Nao podemos usar como nome do lead — fallback pra telefone.
    const leadName = fromMe ? '' : pushName

    // Get or create lead
    let lead, isNew
    if (isLid) {
      // @lid: first try by LID jid, then by pushName in same account (so quando NAO e fromMe)
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND wa_remote_jid = ?').get(account.id, dedupJid)
      if (!lead && leadName) {
        lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ?').get(account.id, leadName)
        if (lead) {
          // Link LID to existing lead for future lookups
          db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
        }
      }
      if (!lead && fromMe) {
        // fromMe pra @lid sem lead existente: nao temos info real, ignora
        return res.json({ ok: true })
      }
      if (!lead) {
        // Create new lead with LID (no real phone)
        const sourceForNew = adSourceLabel || 'whatsapp'
        const r = getOrCreateLead(account.id, null, leadName, sourceForNew, dedupJid, waInstance?.id || null)
        if (r.blocked) {
          console.log(`[Webhook] Msg ignorada — phone bloqueado na conta ${account.slug}`)
          return res.json({ ok: true, blocked: true })
        }
        if (r.restricted) {
          console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (lead novo nao processado)`)
          return res.json({ ok: true, restricted: true })
        }
        lead = r.lead; isNew = r.isNew
      } else {
        // Se lead ja existe e esta bloqueado, ignora silenciosamente
        if (lead.is_blocked) {
          console.log(`[Webhook] Msg ignorada — lead ${lead.id} bloqueado na conta ${account.slug}`)
          return res.json({ ok: true, blocked: true })
        }
        // Se arquivado, marca has_new_after_archive mas NAO desarquiva (so manual)
        if (lead.is_archived && !fromMe) {
          db.prepare("UPDATE leads SET has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
        }
        isNew = false
      }
    } else {
      const sourceForNew = adSourceLabel || 'whatsapp'
      const r = getOrCreateLead(account.id, phone, leadName, sourceForNew, dedupJid, waInstance?.id || null)
      if (r.blocked) {
        console.log(`[Webhook] Msg ignorada — phone ${phone} bloqueado na conta ${account.slug}`)
        return res.json({ ok: true, blocked: true })
      }
      if (r.restricted) {
        console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (phone ${phone} nao cadastrado)`)
        return res.json({ ok: true, restricted: true })
      }
      lead = r.lead; isNew = r.isNew
    }
    if (!lead) return res.json({ ok: true })

    // Se identificamos uma fonte de Ad e o lead ainda esta com source=whatsapp, atualiza pra fonte real
    if (adSourceLabel && lead.source === 'whatsapp') {
      db.prepare("UPDATE leads SET source = ? WHERE id = ?").run(adSourceLabel, lead.id)
      // Tambem grava source_detail com info da campanha (titulo do anuncio)
      if (adInfo?.title || adInfo?.body) {
        const detail = [adInfo.title, adInfo.body].filter(Boolean).join(' — ').substring(0, 250)
        db.prepare("UPDATE leads SET source_detail = COALESCE(source_detail, ?) WHERE id = ?").run(detail, lead.id)
      }
    }

    // Salva o ctwa_clid do CTWA na primeira vez que detectamos — vai ser usado pra montar fbc no CAPI
    if (adInfo?.ctwaClid && !lead.ctwa_clid) {
      db.prepare("UPDATE leads SET ctwa_clid = ? WHERE id = ?").run(adInfo.ctwaClid, lead.id)
      lead.ctwa_clid = adInfo.ctwaClid
    }

    // Auto-marca trabalha_anuncio=1 se veio de click-to-WhatsApp (Facebook/Instagram/Google ads)
    // Sinais: ctwaClid presente, sourceType=ad/cta_url, ou URL contem facebook/instagram/google/meta
    if (adInfo) {
      const adSrcType = String(adInfo.sourceType || '').toLowerCase()
      const adSrcUrl = String(adInfo.sourceUrl || '').toLowerCase()
      const isFromAd = !!(
        adInfo.ctwaClid ||
        adSrcType === 'ad' || adSrcType === 'cta_url' ||
        /facebook|instagram|fb\.|fb\.me|google|meta/.test(adSrcUrl)
      )
      if (isFromAd) {
        db.prepare('UPDATE leads SET trabalha_anuncio = 1 WHERE id = ? AND (trabalha_anuncio IS NULL OR trabalha_anuncio = 0)').run(lead.id)
      }
    }

    // Captura IP do request (1a vez) — usado pelo CAPI pra elevar EMQ
    // NOTA: webhook do Evolution vem da MESMA VPS (127.0.0.1) — IP do lead NAO esta no request.
    // So serve pra forms web (/site, /sheets) onde o lead conecta direto.
    if (isNew || !lead.client_ip_address) {
      const reqIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip
      if (isNew) console.log(`[IP DEBUG] lead=${lead.id} xff=${req.headers['x-forwarded-for'] || 'none'} xri=${req.headers['x-real-ip'] || 'none'} req.ip=${req.ip}`)
      if (reqIp && reqIp !== '::1' && reqIp !== '127.0.0.1' && !reqIp.startsWith('::ffff:127.')) {
        db.prepare("UPDATE leads SET client_ip_address = COALESCE(client_ip_address, ?) WHERE id = ?").run(reqIp, lead.id)
        lead.client_ip_address = reqIp
      }
    }

    // CAPI: lead novo → dispara evento da primeira etapa (se mapeada)
    if (isNew) {
      triggerCapiForStageChange(lead.id, lead.stage_id, null)
    }

    // Auto-mensagens: SAUDACAO (so lead novo) + AUSENCIA (toda msg inbound)
    // Se nada configurado, NAO altera o fluxo
    if (!fromMe && waInstance) {
      try {
        const autoCfg = getInstanceConfig(waInstance.id)
        if (autoCfg) {
          // 1) SAUDACAO (so lead novo, anti-flood configuravel via greeting_cooldown_hours)
          if (isNew && autoCfg.greeting_enabled && autoCfg.greeting_text) {
            const greetCooldown = autoCfg.greeting_cooldown_hours || 24
            if (!wasAutoMsgSentRecently(lead.id, 'greeting', greetCooldown)) {
              setTimeout(() => {
                sendAutoMessage({
                  leadId: lead.id,
                  instanceId: waInstance.id,
                  type: 'greeting',
                  text: autoCfg.greeting_text,
                  accountId: account.id,
                }).catch(e => console.error('[AutoMsg greeting] async:', e?.message))
              }, 2000)
            }
          }
          // 2) AUSENCIA (manual ou horario, anti-flood configuravel)
          if (autoCfg.away_text && shouldSendAway(autoCfg, new Date())) {
            const cooldown = autoCfg.away_cooldown_hours || 4
            if (!wasAutoMsgSentRecently(lead.id, 'away', cooldown)) {
              // Delay menor (1s) pra ausencia parecer responsiva
              setTimeout(() => {
                sendAutoMessage({
                  leadId: lead.id,
                  instanceId: waInstance.id,
                  type: 'away',
                  text: autoCfg.away_text,
                  accountId: account.id,
                }).catch(e => console.error('[AutoMsg away] async:', e?.message))
              }, 1000)
            }
          }
        }
      } catch (e) {
        console.error('[AutoMsg] erro no hook:', e?.message)
      }
    }

    // Fetch profile picture in background (no await)
    if (waInstance && (isNew || !lead.profile_pic_url)) {
      fetchAndSaveProfilePic(waInstance, phone, lead.id)
    }

    // Quando o LEAD responde (nao fromMe) e ja existia (nao eh a 1a msg dele), avanca de "Novo Lead" pra "Em Atendimento"
    // Logica: lead chega -> Novo Lead. Atendente manda quantas msgs quiser -> continua Novo Lead.
    // Lead responde pela 1a vez -> Em Atendimento (engajamento real)
    if (!isNew && !fromMe) {
      const firstStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(lead.funnel_id)
      const secondStage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1 OFFSET 1').get(lead.funnel_id)
      if (firstStage && secondStage && lead.stage_id === firstStage.id) {
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(secondStage.id, lead.id)
        const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(
          lead.id, firstStage.id, secondStage.id, 'webhook'
        )
        triggerCapiForStageChange(lead.id, secondStage.id, histRes.lastInsertRowid)
      }
    }

    // Store message (dedup by wa_msg_id) + track instance
    const existing = msgId ? db.prepare('SELECT id FROM messages WHERE wa_msg_id = ?').get(msgId) : null
    if (!existing) {
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, media_type, media_url, sender_name, wa_msg_id, wa_timestamp, instance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, mediaUrl, fromMe ? '' : pushName, msgId || null, timestamp, waInstance?.id || null)
      // Update lead's last_instance_id (next message from CRM will use this instance)
      if (waInstance?.id) {
        db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(waInstance.id, lead.id)
        // Ensure assignment exists for (lead, instance). Default attendant = instance.default_attendant_id
        db.prepare(`
          INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
          VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
        `).run(lead.id, waInstance.id, waInstance.id)
      }
    }

    // Auto stage detection: keywords in outbound messages advance stages
    // Inbound messages from client don't auto-advance (attendant controls flow)
    if (fromMe && content) autoDetectStage(lead, content)

    // Update lead name if we have pushName REAL (nao fromMe) e lead nao tem nome
    // OU lead tem nome igual ao telefone (placeholder), trocar pelo pushName real
    if (leadName && (!lead.name || lead.name === lead.phone || lead.name === 'Sem nome')) {
      db.prepare('UPDATE leads SET name = ? WHERE id = ?').run(leadName, lead.id)
    }

    // Broadcast SSE — archived leads mark activity silently, don't show up in pipeline/chat
    if (isNew) {
      broadcastSSE(account.id, 'lead:created', db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id))
    } else {
      const current = db.prepare('SELECT is_archived FROM leads WHERE id = ?').get(lead.id)
      if (current?.is_archived) {
        if (!fromMe) {
          db.prepare('UPDATE leads SET has_new_after_archive = 1 WHERE id = ?').run(lead.id)
          try { broadcastSSE(account.id, 'lead:archived-activity', { id: lead.id }) } catch {}
        }
      } else {
        broadcastSSE(account.id, 'lead:message', { leadId: lead.id, message: content, direction: fromMe ? 'outbound' : 'inbound' })
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Evolution]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta Lead Form webhook
router.post('/meta-leads/:accountSlug', async (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const entries = req.body.entry || []
    for (const entry of entries) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue
        const v = change.value || {}
        const leadgenId = v.leadgen_id
        if (!leadgenId) continue

        // IDs do webhook leadgen (todos plaintext, obrigatorios pra Conversion Leads no Meta)
        const formId = v.form_id || null
        const adId = v.ad_id || null
        const adsetId = v.adset_id || null
        const campaignId = v.campaign_id || null
        const pageId = v.page_id || null

        // Fetch full lead data from Meta (needs META_ACCESS_TOKEN)
        const metaToken = process.env.META_ACCESS_TOKEN
        if (!metaToken) continue

        const r = await fetch(`https://graph.facebook.com/v21.0/${leadgenId}?access_token=${metaToken}`)
        const data = await r.json()
        if (data.error) { console.error('[Webhook Meta Lead] graph error:', data.error.message); continue }

        // Extract fields padrao
        let name = '', phone = '', email = '', city = '', state = '', zip = ''
        for (const field of (data.field_data || [])) {
          const val = field.values?.[0] || ''
          if (field.name === 'full_name') name = val
          else if (field.name === 'phone_number') { phone = val.replace(/[^\d]/g, ''); if (!phone.startsWith('55') && phone.length >= 10 && phone.length <= 11) phone = '55' + phone }
          else if (field.name === 'email') email = val
          else if (field.name === 'city') city = val
          else if (field.name === 'state') state = val
          else if (field.name === 'zip_code' || field.name === 'post_code') zip = val
        }

        const { lead, isNew, blocked } = getOrCreateLead(account.id, phone, name, 'meta_form', null)
        if (blocked) { console.log(`[Webhook Meta Lead] phone ${phone} bloqueado, ignorando`); continue }
        if (!lead) continue

        // Salva todos IDs Meta + dados de contato (COALESCE pra nao sobrescrever)
        db.prepare(`
          UPDATE leads SET
            lead_form_lead_id = COALESCE(lead_form_lead_id, ?),
            meta_form_id = COALESCE(meta_form_id, ?),
            meta_ad_id = COALESCE(meta_ad_id, ?),
            meta_campaign_id = COALESCE(meta_campaign_id, ?),
            email = COALESCE(email, NULLIF(?, '')),
            city = COALESCE(city, NULLIF(?, '')),
            state = COALESCE(state, NULLIF(?, '')),
            zip = COALESCE(zip, NULLIF(?, ''))
          WHERE id = ?
        `).run(leadgenId, formId, adId, campaignId, email, city, state, zip, lead.id)

        console.log(`[Meta Lead Form] lead=${lead.id} leadgen_id=${leadgenId} form=${formId} ad=${adId} campaign=${campaignId} isNew=${isNew}`)

        // CAPI: dispara evento Lead pra nova entrada
        if (isNew) {
          triggerCapiForStageChange(lead.id, lead.stage_id, null, req)
        }
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[Webhook Meta]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Meta webhook verification
router.get('/meta-leads/:accountSlug', (req, res) => {
  const verifyToken = process.env.META_VERIFY_TOKEN || 'dros-crm-verify'
  if (req.query['hub.verify_token'] === verifyToken && req.query['hub.mode'] === 'subscribe') {
    return res.send(req.query['hub.challenge'])
  }
  res.status(403).send('Forbidden')
})

// Website form webhook — captura tudo pra elevar EMQ no CAPI
router.post('/site/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const { name, phone, email, city, state, zip, message } = req.body
    // Tracking Meta: site pode mandar esses no body (capturados via JS no front)
    const { fbp, fbc, fbclid, ctwa_clid, ad_id, campaign_id, form_id, source: src } = req.body
    const { lead, isNew, blocked } = getOrCreateLead(account.id, phone, name, src || 'website', null)
    if (blocked) { console.log(`[Webhook Site] phone ${phone} bloqueado, ignorando`); return res.json({ ok: true, blocked: true }) }
    if (!lead) return res.status(500).json({ error: 'Falha ao criar lead' })

    // IP/UA do request
    const reqIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip
    const ua = req.headers['user-agent']

    // fbc: se nao veio do cookie mas tem fbclid, monta
    let fbcFinal = fbc || null
    if (!fbcFinal && fbclid) fbcFinal = `fb.1.${Date.now()}.${fbclid}`

    db.prepare(`
      UPDATE leads SET
        email = COALESCE(email, NULLIF(?, '')),
        city = COALESCE(city, NULLIF(?, '')),
        state = COALESCE(state, NULLIF(?, '')),
        zip = COALESCE(zip, NULLIF(?, '')),
        fbp = COALESCE(fbp, NULLIF(?, '')),
        fbc = COALESCE(fbc, NULLIF(?, '')),
        ctwa_clid = COALESCE(ctwa_clid, NULLIF(?, '')),
        meta_ad_id = COALESCE(meta_ad_id, NULLIF(?, '')),
        meta_campaign_id = COALESCE(meta_campaign_id, NULLIF(?, '')),
        meta_form_id = COALESCE(meta_form_id, NULLIF(?, '')),
        client_ip_address = COALESCE(client_ip_address, NULLIF(?, '')),
        client_user_agent = COALESCE(client_user_agent, NULLIF(?, ''))
      WHERE id = ?
    `).run(
      email || '', city || '', state || '', zip || '',
      fbp || '', fbcFinal || '', ctwa_clid || '',
      ad_id || '', campaign_id || '', form_id || '',
      (reqIp && reqIp !== '::1' && reqIp !== '127.0.0.1') ? reqIp : '',
      ua || '',
      lead.id
    )

    console.log(`[Site Form] lead=${lead.id} account=${account.slug} isNew=${isNew} fbp=${!!fbp} fbc=${!!fbcFinal} ctwa=${!!ctwa_clid}`)

    if (isNew) {
      triggerCapiForStageChange(lead.id, lead.stage_id, null, req)
    }

    res.json({ ok: true, leadId: lead.id })
  } catch (err) {
    console.error('[Webhook Site]', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Google Sheets webhook ──────────────────────────────────────
router.post('/sheets/:accountSlug', (req, res) => {
  try {
    const account = db.prepare('SELECT * FROM accounts WHERE slug = ? AND is_active = 1').get(req.params.accountSlug)
    if (!account) return res.status(404).json({ error: 'Account not found' })

    const body = req.body
    // Extract known fields (supports both PT-BR and Facebook format)
    const name = body.name || body.first_name || body.nome || body.full_name || ''
    // Phone: remove prefixos comuns dos forms Meta (p:, p:+, +) — deixa so digitos com 55 prefix se for BR
    const phoneRaw = body.phone || body.phone_number || body.telefone || body.whatsapp || body.celular || ''
    let phone = String(phoneRaw).replace(/^\s*p\s*:\s*/i, '').replace(/[^\d+]/g, '').replace(/^\+/, '')
    const email = body.email || ''
    const city = body.city || body.cidade || ''
    const empresa = body.empresa || ''
    const cpf_cnpj = body.cpf_cnpj || body.cpf || body.cnpj || ''
    const instagram = body.instagram || ''
    const source = body.source || body.fonte || body.form_name || 'google_sheets'
    const source_detail = body.source_detail || [body.campaign_name, body.adset_name, body.ad_name].filter(Boolean).join(' > ') || ''

    if (!name && !phone) return res.status(400).json({ error: 'name ou phone obrigatorio' })

    const { lead, isNew, blocked } = getOrCreateLead(account.id, phone, name, source, null)
    if (blocked) { console.log(`[Webhook Sheets] phone ${phone} bloqueado, ignorando`); return res.json({ ok: true, blocked: true }) }
    if (!lead) return res.status(400).json({ error: 'Falha ao criar lead (sem funil configurado?)' })

    // Atualiza nome se vier mais completo (lead antigo pode estar so com telefone, ou nome incompleto)
    // Substitui se nome novo eh nao-vazio E (nome atual eh vazio OU eh igual ao phone OU eh mais curto)
    if (!isNew && name && name.trim()) {
      const currentName = (lead.name || '').trim()
      const newName = name.trim()
      const isPhoneAsName = currentName === lead.phone || /^\d+$/.test(currentName)
      if (!currentName || isPhoneAsName || (newName.length > currentName.length && newName.toLowerCase() !== currentName.toLowerCase())) {
        db.prepare('UPDATE leads SET name = ? WHERE id = ?').run(newName, lead.id)
      }
    }

    // Update optional fields
    if (email) db.prepare('UPDATE leads SET email = COALESCE(email, ?) WHERE id = ?').run(email, lead.id)
    if (city) db.prepare('UPDATE leads SET city = COALESCE(city, ?) WHERE id = ?').run(city, lead.id)
    if (empresa) db.prepare('UPDATE leads SET empresa = COALESCE(empresa, ?) WHERE id = ?').run(empresa, lead.id)
    if (cpf_cnpj) db.prepare('UPDATE leads SET cpf_cnpj = COALESCE(cpf_cnpj, ?) WHERE id = ?').run(cpf_cnpj, lead.id)
    if (instagram) db.prepare('UPDATE leads SET instagram = COALESCE(instagram, ?) WHERE id = ?').run(instagram, lead.id)

    // Auto-detect: lead veio de anuncio? Marca trabalha_anuncio=1 se houver sinal claro
    // (fbclid, ad_id, campaign_id, gclid, ou source/utm indicam paid)
    const sourceStr = String(source || '').toLowerCase()
    const utmMedStr = String(body.utm_medium || '').toLowerCase()
    const utmSrcStr = String(body.utm_source || '').toLowerCase()
    const isFromAd = !!(
      body.fbclid || body.gclid || body.ad_id || body.campaign_id ||
      sourceStr.includes('form') || sourceStr.includes('fb') || sourceStr.includes('meta') || sourceStr.includes('ad') ||
      utmMedStr.includes('paid') || utmMedStr.includes('cpc') ||
      utmSrcStr.includes('fb') || utmSrcStr.includes('google') || utmSrcStr.includes('meta')
    )
    if (isFromAd) {
      db.prepare('UPDATE leads SET trabalha_anuncio = 1 WHERE id = ? AND (trabalha_anuncio IS NULL OR trabalha_anuncio = 0)').run(lead.id)
    }

    // source_detail: combina o source_detail explicito + utms + page_url quando vierem
    const detailExtras = []
    if (source_detail) detailExtras.push(source_detail)
    if (body.utm_source) detailExtras.push(`utm_source=${body.utm_source}`)
    if (body.utm_medium) detailExtras.push(`utm_medium=${body.utm_medium}`)
    if (body.utm_campaign) detailExtras.push(`utm_campaign=${body.utm_campaign}`)
    if (body.utm_content) detailExtras.push(`utm_content=${body.utm_content}`)
    if (body.utm_term) detailExtras.push(`utm_term=${body.utm_term}`)
    if (body.page_url) detailExtras.push(`url=${body.page_url}`)
    if (body.interesse || body.busca || body.objetivo) detailExtras.push(`interesse=${body.interesse || body.busca || body.objetivo}`)
    if (body.gclid) detailExtras.push(`gclid=${body.gclid}`)
    const finalDetail = detailExtras.join(' | ').substring(0, 500)
    if (finalDetail) db.prepare('UPDATE leads SET source_detail = COALESCE(source_detail, ?) WHERE id = ?').run(finalDetail, lead.id)

    // Marcadores Meta — guarda ids da campanha/anuncio/form pra usar no CAPI depois
    if (body.ad_id) db.prepare('UPDATE leads SET meta_ad_id = COALESCE(meta_ad_id, ?) WHERE id = ?').run(String(body.ad_id), lead.id)
    if (body.campaign_id) db.prepare('UPDATE leads SET meta_campaign_id = COALESCE(meta_campaign_id, ?) WHERE id = ?').run(String(body.campaign_id), lead.id)
    if (body.form_id) db.prepare('UPDATE leads SET meta_form_id = COALESCE(meta_form_id, ?) WHERE id = ?').run(String(body.form_id), lead.id)
    if (body.leadgen_id) db.prepare('UPDATE leads SET lead_form_lead_id = COALESCE(lead_form_lead_id, ?) WHERE id = ?').run(String(body.leadgen_id), lead.id)

    // Tracking pixel — vem da LP (browser-side) via cookies
    if (body.fbp) db.prepare('UPDATE leads SET fbp = COALESCE(fbp, ?) WHERE id = ?').run(String(body.fbp), lead.id)
    let fbcVal = body.fbc || null
    if (!fbcVal && body.fbclid) fbcVal = `fb.1.${Date.now()}.${body.fbclid}`
    if (fbcVal) db.prepare('UPDATE leads SET fbc = COALESCE(fbc, ?) WHERE id = ?').run(String(fbcVal), lead.id)
    if (body.ctwa_clid) db.prepare('UPDATE leads SET ctwa_clid = COALESCE(ctwa_clid, ?) WHERE id = ?').run(String(body.ctwa_clid), lead.id)
    if (body.user_agent) db.prepare('UPDATE leads SET client_user_agent = COALESCE(client_user_agent, ?) WHERE id = ?').run(String(body.user_agent), lead.id)
    // IP do request (Apps Script geralmente sobrescreve com o IP do GAE, mas vale tentar)
    const reqIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.headers['x-real-ip'] || req.ip
    if (reqIp && reqIp !== '::1' && reqIp !== '127.0.0.1') {
      db.prepare('UPDATE leads SET client_ip_address = COALESCE(client_ip_address, ?) WHERE id = ?').run(reqIp, lead.id)
    }
    if (body.state || body.estado) db.prepare('UPDATE leads SET state = COALESCE(state, ?) WHERE id = ?').run(String(body.state || body.estado), lead.id)
    if (body.zip || body.cep) db.prepare('UPDATE leads SET zip = COALESCE(zip, ?) WHERE id = ?').run(String(body.zip || body.cep), lead.id)

    // Movimentacao opcional pra etapa especifica do funil (case-insensitive, ignora acentos)
    const stageName = body.stage_name || body.stage || body.etapa || ''
    const norm = (s) => String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (stageName && lead.funnel_id) {
      const target = norm(stageName)
      const stages = db.prepare('SELECT id, name FROM funnel_stages WHERE funnel_id = ?').all(lead.funnel_id)
      const match = stages.find(s => norm(s.name) === target)
      if (match && match.id !== lead.stage_id) {
        const prevStage = lead.stage_id
        db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(match.id, lead.id)
        const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(lead.id, prevStage, match.id, 'webhook')
        triggerCapiForStageChange(lead.id, match.id, histRes.lastInsertRowid)
      }
    }

    // Notes — append (nao sobrescreve se ja tinha algo). Usado por importacoes pra preservar feedbacks, perguntas do form, etc.
    if (body.notes && String(body.notes).trim()) {
      const newPart = String(body.notes).trim()
      const cur = (lead.notes || '').trim()
      const merged = cur ? `${cur}\n\n${newPart}` : newPart
      db.prepare('UPDATE leads SET notes = ? WHERE id = ?').run(merged, lead.id)
    }

    // Atendente (corretor): busca user da conta pelo nome (case-insensitive, ignora acentos)
    const attendantName = body.attendant_name || body.corretor || body.atendente || ''
    if (attendantName) {
      const targetA = norm(attendantName)
      const users = db.prepare("SELECT id, name FROM users WHERE (account_id = ? OR account_id IS NULL) AND role IN ('atendente','gerente','super_admin') AND is_active = 1").all(account.id)
      const matchUser = users.find(u => norm(u.name) === targetA || norm(u.name).startsWith(targetA))
      if (matchUser && matchUser.id !== lead.attendant_id) {
        db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(matchUser.id, lead.id)
        // Atualiza assignment se existir
        db.prepare('UPDATE lead_instance_assignments SET attendant_id = ? WHERE lead_id = ? AND attendant_id IS NULL').run(matchUser.id, lead.id)
      }
    }

    // Tags: aceita array ou string separada por virgula. Cria a tag se nao existir.
    const tagsRaw = body.tags || body.tag || ''
    const tagList = Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw).split(',').map(t => t.trim()).filter(Boolean)
    const appliedTagIds = []
    for (const tagName of tagList) {
      let tag = db.prepare('SELECT id FROM tags WHERE account_id = ? AND LOWER(name) = LOWER(?)').get(account.id, tagName)
      if (!tag) {
        const r = db.prepare('INSERT INTO tags (account_id, name, color) VALUES (?, ?, ?)').run(account.id, tagName, '#FFB300')
        tag = { id: r.lastInsertRowid }
      }
      db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, tag.id)
      appliedTagIds.push(tag.id)
    }

    // Mapeamento tag → instancia (so se lead nao tem instance_id ainda)
    // Primeira tag que tem mapping vence. Fallback: account.default_form_instance_id
    // SO ATIVA se a conta cadastrou mapping ou default_form_instance_id — caso contrario nao mexe em nada (fluxo antigo intacto)
    if (!lead.instance_id && appliedTagIds.length > 0) {
      for (const tagId of appliedTagIds) {
        const mapping = db.prepare('SELECT instance_id, attendant_id FROM tag_instance_mapping WHERE account_id = ? AND tag_id = ?').get(account.id, tagId)
        if (mapping) {
          db.prepare("UPDATE leads SET instance_id = ?, last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(mapping.instance_id, mapping.instance_id, lead.id)
          lead.instance_id = mapping.instance_id
          lead.last_instance_id = mapping.instance_id
          if (mapping.attendant_id && !lead.attendant_id) {
            db.prepare('UPDATE leads SET attendant_id = ? WHERE id = ?').run(mapping.attendant_id, lead.id)
            lead.attendant_id = mapping.attendant_id
          }
          db.prepare('INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(lead.id, mapping.instance_id, mapping.attendant_id || null)
          break
        }
      }
    }
    // Fallback: instancia padrao da conta pra leads de form
    if (!lead.instance_id && account.default_form_instance_id) {
      db.prepare("UPDATE leads SET instance_id = ?, last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(account.default_form_instance_id, account.default_form_instance_id, lead.id)
      lead.instance_id = account.default_form_instance_id
      lead.last_instance_id = account.default_form_instance_id
      db.prepare('INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(lead.id, account.default_form_instance_id, lead.attendant_id || null)
    }

    // Remove tags: aceita array ou string. Util pra correcao em massa.
    const removeTagsRaw = body.remove_tags || ''
    const removeTagList = Array.isArray(removeTagsRaw) ? removeTagsRaw : String(removeTagsRaw).split(',').map(t => t.trim()).filter(Boolean)
    for (const tagName of removeTagList) {
      const tag = db.prepare('SELECT id FROM tags WHERE account_id = ? AND LOWER(name) = LOWER(?)').get(account.id, tagName)
      if (tag) db.prepare('DELETE FROM lead_tags WHERE lead_id = ? AND tag_id = ?').run(lead.id, tag.id)
    }

    // Collect custom/dynamic fields (Facebook form questions, etc)
    const knownKeys = new Set(['name','first_name','last_name','full_name','nome','phone','phone_number','telefone','whatsapp','celular','email','city','cidade','empresa','cpf_cnpj','cpf','cnpj','instagram','source','fonte','form_name','source_detail','campaign_name','campaign_id','adset_name','adset_id','ad_name','ad_id','form_id','id','created_time','is_organic','platform','lead_status','crm_enviado','stage_name','stage','etapa','status','attendant_name','corretor','atendente','tags','tag','remove_tags','fbp','fbc','fbclid','ctwa_clid','user_agent','event_id','leadgen_id','state','estado','zip','cep','utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','page_url','interesse','busca','objetivo','data_hora','data','hora'])
    const customFields = Object.entries(body)
      .filter(([k, v]) => !knownKeys.has(k) && v && String(v).trim())
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n')

    if (customFields) {
      const existing = db.prepare('SELECT notes FROM leads WHERE id = ?').get(lead.id)
      const newNotes = existing?.notes ? existing.notes + '\n' + customFields : customFields
      db.prepare('UPDATE leads SET notes = ? WHERE id = ?').run(newNotes, lead.id)
    }

    if (isNew) {
      try { broadcastSSE(account.id, 'lead:created', lead) } catch {}
      // CAPI: dispara evento da etapa inicial (lead recarregado com todos campos via service)
      triggerCapiForStageChange(lead.id, lead.stage_id, null, req)
    }

    // Marca timestamp do ultimo lead recebido (pra UI mostrar status de integração)
    try { db.prepare("UPDATE accounts SET last_sheets_lead_at = datetime('now') WHERE id = ?").run(account.id) } catch {}
    console.log(`[Webhook Sheets] ${isNew ? 'New' : 'Existing'} lead: ${name || phone} → account ${account.name} fbp=${!!body.fbp} fbc=${!!fbcVal} event_id=${body.event_id || 'none'}`)
    res.json({ ok: true, leadId: lead.id, isNew })
  } catch (err) {
    console.error('[Webhook Sheets]', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router

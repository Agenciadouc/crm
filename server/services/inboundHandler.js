// Regra de negocio do recebimento de mensagens de WhatsApp, independente do provedor.
// Movida de routes/webhooks.js (bloco do messages.upsert e o callback de status do messages.update)
// sem alterar a logica. Dependencias injetadas para teste.

const STATUS_RANK = { sent: 1, delivered: 2, read: 3 }

// Tipos que o polling ja importava (scheduler.js:213-222). Demais tipos continuam so pelo webhook.
const POLLING_IMPORTED_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker'])

// Copia de webhooks.js (detectAdSource do handler do Evolution)
export function detectAdSource(ad) {
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

export function createInboundHandler(deps) {
  const {
    db,
    broadcastSSE,
    triggerCapiForStageChange,
    getInstanceConfig,
    wasAutoMsgSentRecently,
    sendAutoMessage,
    shouldSendAway,
    processInboundMessage,
    pickFromRoulette,
    notifyAndOpenLead,
    getOrCreateLead,
    autoDetectStage,
    fetchAndSaveProfilePic,
  } = deps

  // Callback de status (delivered/read) do provedor. Idempotente: nunca regride (read > delivered > sent).
  // Filtra por conta: um wa_msg_id so atualiza mensagem da conta que recebeu o webhook.
  function handleStatusUpdate(account, waInstance, statuses) {
    let changed = 0
    // try/catch do bloco original (webhooks.js): erro no loop e logado e engolido para a rota
    // seguir respondendo 200 ao provedor (um 500 faria a Evolution re-tentar o webhook).
    try {
      for (const s of statuses || []) {
        const newStatus = s.status
        let timestampCol = null
        if (newStatus === 'delivered') timestampCol = 'delivered_at'
        else if (newStatus === 'read') timestampCol = 'read_at'
        else if (newStatus !== 'sent') continue
        const msg = db.prepare('SELECT id, lead_id, account_id, delivery_status, direction FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(s.messageId, account.id)
        if (!msg) continue
        // UzAPI manda tambem a leitura que o proprio numero faz das recebidas: so vale para mensagem enviada.
        if (s.outboundOnly && msg.direction !== 'outbound') continue
        if ((STATUS_RANK[newStatus] || 0) <= (STATUS_RANK[msg.delivery_status] || 0)) continue
        const sets = ['delivery_status = ?']
        const params = [newStatus]
        if (timestampCol) sets.push(`${timestampCol} = COALESCE(${timestampCol}, datetime('now'))`)
        params.push(msg.id)
        db.prepare(`UPDATE messages SET ${sets.join(', ')} WHERE id = ?`).run(...params)
        changed++
        try { broadcastSSE(msg.account_id, 'message:status', { message_id: msg.id, lead_id: msg.lead_id, status: newStatus }) } catch {}
      }
    } catch (e) {
      console.error('[Webhook messages.update]', e.message)
    }
    return changed
  }

  // Logica do polling movida de scheduler.js:180-303, preservada de proposito:
  // nao dispara IA, auto-mensagem, parada de follow-up, handoff, foto, avanco de etapa nem unread_count;
  // desarquiva o lead; distribui por default_attendant_id ou round-robin.
  function handlePolledMessage(account, inst, normalized) {
    const msgId = normalized.messageId
    if (!msgId) return { ok: true, skipped: 'no_id' }
    if (!POLLING_IMPORTED_TYPES.has(normalized.type)) return { ok: true, skipped: `type_${normalized.type}` }
    // Filtra por conta: o mesmo numero fisico em duas contas nao pode fazer a segunda perder a mensagem.
    const exists = db.prepare('SELECT id FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(msgId, account.id)
    if (exists) return { ok: true, skipped: 'exists' }

    const phone = normalized.phone
    const dedupJid = normalized.remoteId
    const isLid = String(dedupJid || '').endsWith('@lid')
    const fromMe = !!normalized.fromMe
    const pushName = normalized.pushName || ''
    const timestamp = normalized.timestamp || null
    const content = normalized.text || ''
    const mediaType = normalized.type
    if (!content && mediaType === 'text') return { ok: true, skipped: 'empty' }

    let lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND (wa_remote_jid = ? OR phone = ?) ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(account.id, dedupJid, phone)

    if (lead && lead.is_blocked) {
      console.log(`[Polling] Msg ignorada — lead ${lead.id} bloqueado`)
      return { ok: true, blocked: true }
    }

    if (!lead && isLid && pushName) {
      lead = db.prepare('SELECT * FROM leads WHERE account_id = ? AND name = ? AND is_blocked = 0 ORDER BY is_archived ASC, created_at DESC LIMIT 1').get(account.id, pushName)
      if (lead) {
        db.prepare("UPDATE leads SET wa_remote_jid = ?, updated_at = datetime('now') WHERE id = ?").run(dedupJid, lead.id)
      }
    }

    if (lead && lead.is_archived) {
      db.prepare("UPDATE leads SET is_archived = 0, archived_at = NULL, has_new_after_archive = 1, updated_at = datetime('now') WHERE id = ?").run(lead.id)
      lead.is_archived = 0
      console.log(`[Polling] Desarquivado lead ${lead.id} (${lead.name}) — recebeu mensagem nova`)
    }

    if (!lead) {
      if (inst.lead_intake_mode === 'restricted') {
        console.log(`[Polling] Msg ignorada — instancia ${inst.instance_name} em modo restrito (lead novo nao criado)`)
        return { ok: true, restricted: true }
      }
      const funnel = db.prepare('SELECT id FROM funnels WHERE account_id = ? AND is_default = 1 AND is_active = 1').get(account.id)
      if (!funnel) return { ok: true, skipped: 'no_funnel' }
      const stage = db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? ORDER BY position LIMIT 1').get(funnel.id)
      if (!stage) return { ok: true, skipped: 'no_stage' }
      const leadPhone = isLid ? null : phone

      let attendantId = inst.default_attendant_id || null
      if (!attendantId) {
        const rule = db.prepare('SELECT * FROM distribution_rules WHERE account_id = ? AND funnel_id = ?').get(account.id, funnel.id)
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

      const result = db.prepare("INSERT INTO leads (account_id, funnel_id, stage_id, attendant_id, name, phone, source, wa_remote_jid, instance_id, opted_in_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").run(
        account.id, funnel.id, stage.id, attendantId, pushName || phone || 'Sem nome', leadPhone, 'whatsapp', dedupJid, inst.id
      )
      lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid)
      const histRes = db.prepare('INSERT INTO stage_history (lead_id, to_stage_id, trigger_type) VALUES (?, ?, ?)').run(lead.id, stage.id, 'polling')
      broadcastSSE(account.id, 'lead:created', lead)
      triggerCapiForStageChange(lead.id, stage.id, histRes.lastInsertRowid)
    }

    db.prepare('INSERT INTO messages (lead_id, account_id, direction, content, media_type, sender_name, wa_msg_id, wa_timestamp, instance_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, fromMe ? '' : pushName, msgId, timestamp, inst.id
    )
    db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(inst.id, lead.id)
    db.prepare(`
      INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
      VALUES (?, ?, (SELECT default_attendant_id FROM whatsapp_instances WHERE id = ?))
    `).run(lead.id, inst.id, inst.id)

    broadcastSSE(account.id, 'lead:message', { lead_id: lead.id })
    return { ok: true, imported: true }
  }

  // Uma NormalizedMessage -> efeitos no banco (lead, mensagem, etapas, follow-up, SSE, IA).
  // Sincrono, como o handler original do webhook.
  function handleInboundMessage(account, waInstance, normalized, opts = {}) {
    if (opts.source === 'polling') return handlePolledMessage(account, waInstance, normalized)
    // Variaveis com os mesmos nomes usados pelo bloco movido
    const req = opts.req || { headers: {}, ip: undefined }
    const fromMe = !!normalized.fromMe
    const msgId = normalized.messageId || ''
    const pushName = normalized.pushName || ''
    const timestamp = normalized.timestamp
    const content = normalized.text || ''
    const mediaType = normalized.type
    const mediaUrl = normalized.mediaRef == null ? null : normalized.mediaRef
    const phone = normalized.phone
    const dedupJid = normalized.remoteId
    const isLid = String(dedupJid || '').endsWith('@lid')
    const adInfo = normalized.adReferral || null
    const adSourceLabel = detectAdSource(adInfo) // ex: "Facebook Pago", "Instagram", null
    // Quando fromMe=true, o pushName e o nome de quem ENVIOU (atendente/operador da conta WhatsApp),
    // nao do lead. Nao podemos usar como nome do lead — fallback pra telefone.
    const leadName = fromMe ? '' : pushName

    // ───────── INICIO DO BLOCO MOVIDO (routes/webhooks.js) ─────────
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
        return { ok: true }
      }
      if (!lead) {
        // Create new lead with LID (no real phone)
        const sourceForNew = adSourceLabel || 'whatsapp'
        const r = getOrCreateLead(account.id, null, leadName, sourceForNew, dedupJid, waInstance?.id || null)
        if (r.blocked) {
          console.log(`[Webhook] Msg ignorada — phone bloqueado na conta ${account.slug}`)
          return { ok: true, blocked: true }
        }
        if (r.restricted) {
          console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (lead novo nao processado)`)
          return { ok: true, restricted: true }
        }
        lead = r.lead; isNew = r.isNew
      } else {
        // Se lead ja existe e esta bloqueado, ignora silenciosamente
        if (lead.is_blocked) {
          console.log(`[Webhook] Msg ignorada — lead ${lead.id} bloqueado na conta ${account.slug}`)
          return { ok: true, blocked: true }
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
        return { ok: true, blocked: true }
      }
      if (r.restricted) {
        console.log(`[Webhook] Msg ignorada — instancia ${waInstance?.instance_name} em modo restrito (phone ${phone} nao cadastrado)`)
        return { ok: true, restricted: true }
      }
      lead = r.lead; isNew = r.isNew
    }
    if (!lead) return { ok: true }

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
    // Filtra por conta: o mesmo numero fisico em duas contas nao pode fazer a segunda perder a mensagem.
    const existing = msgId ? db.prepare('SELECT id FROM messages WHERE wa_msg_id = ? AND account_id = ?').get(msgId, account.id) : null
    if (!existing) {
      db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, media_type, media_url, sender_name, wa_msg_id, wa_timestamp, instance_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead.id, account.id, fromMe ? 'outbound' : 'inbound', content, mediaType, mediaUrl, fromMe ? '' : pushName, msgId || null, timestamp, waInstance?.id || null)
      // Incrementa unread_count se msg eh inbound e lead nao arquivado (arquivados usam has_new_after_archive).
      // Tambem seta last_inbound_at pra qualquer inbound (arquivado ou nao) — usado no sort do chat pra
      // subir contato pro topo so quando ELE manda msg (msg outbound do atendente nao move).
      if (!fromMe) {
        if (!lead.is_archived) {
          db.prepare("UPDATE leads SET unread_count = unread_count + 1, last_inbound_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(lead.id)
        } else {
          db.prepare("UPDATE leads SET last_inbound_at = datetime('now') WHERE id = ?").run(lead.id)
        }
      }
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

    // Auto-pausa follow-up se lead respondeu (stop_on_reply=1) + executa on_reply_action + move etapa + add tag
    if (!fromMe && lead) {
      const activeFu = db.prepare(`
        SELECT lfu.id, fu.on_reply_action, fu.on_reply_user_id, fu.on_reply_move_to_stage_id, fu.on_reply_add_tag_id, fu.instance_id
        FROM lead_follow_ups lfu
        JOIN follow_ups fu ON fu.id = lfu.follow_up_id
        WHERE lfu.lead_id = ? AND lfu.status = 'active' AND fu.stop_on_reply = 1
        LIMIT 1
      `).get(lead.id)
      if (activeFu) {
        // 1. Cancela cadência (status='cancelled' = lead saiu desse FU permanentemente; volta só se sair+voltar da etapa)
        db.prepare("UPDATE lead_follow_ups SET status='cancelled', paused_at=datetime('now'), paused_reason='lead_replied', current_step_id=NULL, next_run_at=NULL, updated_at=datetime('now') WHERE id=?").run(activeFu.id)
        console.log(`[FollowUp] Cancelado lead=${lead.id} (respondeu)`)

        // 2. Reatribui conforme on_reply_action
        const action = activeFu.on_reply_action || 'pause'
        let newAttendantId = null
        if (action === 'assign_user' && activeFu.on_reply_user_id) {
          const u = db.prepare('SELECT id FROM users WHERE id = ? AND is_active = 1').get(activeFu.on_reply_user_id)
          if (u) newAttendantId = u.id
        } else if (action === 'roulette') {
          newAttendantId = pickFromRoulette(account.id, activeFu.instance_id)
        }
        if (newAttendantId) {
          const newUser = db.prepare('SELECT is_bot FROM users WHERE id = ?').get(newAttendantId)
          const clearAi = newUser?.is_bot === 1 ? ", ai_handed_off_at = NULL" : ""
          db.prepare(`UPDATE leads SET attendant_id = ?${clearAi}, updated_at = datetime('now') WHERE id = ?`).run(newAttendantId, lead.id)
          try { broadcastSSE(account.id, 'lead:updated', { id: lead.id }) } catch {}
          console.log(`[FollowUp] Reatribuido lead=${lead.id} -> user=${newAttendantId} (action=${action})`)
          // Handoff: dispara 1a msg + notif pro novo atendente (se humano)
          if (newUser?.is_bot !== 1) {
            setImmediate(() => {
              notifyAndOpenLead(lead.id, newAttendantId, { source: 'followup_reply' })
                .catch(e => console.error('[Handoff followup]', e.message))
            })
          }
        }

        // 3. Move etapa (opcional)
        if (activeFu.on_reply_move_to_stage_id) {
          const freshLead = db.prepare('SELECT stage_id FROM leads WHERE id = ?').get(lead.id)
          if (freshLead && freshLead.stage_id !== activeFu.on_reply_move_to_stage_id) {
            const prev = freshLead.stage_id
            db.prepare("UPDATE leads SET stage_id = ?, updated_at = datetime('now') WHERE id = ?").run(activeFu.on_reply_move_to_stage_id, lead.id)
            const histRes = db.prepare('INSERT INTO stage_history (lead_id, from_stage_id, to_stage_id, trigger_type) VALUES (?, ?, ?, ?)').run(lead.id, prev, activeFu.on_reply_move_to_stage_id, 'followup_reply')
            try { triggerCapiForStageChange(lead.id, activeFu.on_reply_move_to_stage_id, histRes.lastInsertRowid) } catch (e) { console.error('[FollowUp CAPI]', e.message) }
            console.log(`[FollowUp] Stage lead=${lead.id} ${prev} -> ${activeFu.on_reply_move_to_stage_id}`)
          }
        }

        // 4. Adiciona tag (opcional)
        if (activeFu.on_reply_add_tag_id) {
          db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, activeFu.on_reply_add_tag_id)
          console.log(`[FollowUp] Tag adicionada lead=${lead.id} tag=${activeFu.on_reply_add_tag_id}`)
        }
      }
    }

    // Update lead name if we have pushName REAL (nao fromMe) e lead nao tem nome
    // OU lead tem nome igual ao telefone (placeholder), trocar pelo pushName real
    if (leadName && (!lead.name || lead.name === lead.phone || lead.name === 'Sem nome')) {
      db.prepare('UPDATE leads SET name = ? WHERE id = ?').run(leadName, lead.id)
    }

    // AI Agent: plug fire-and-forget pra bot responder leads inbound (se conta tiver feature)
    // Skip outbound, sem content, sem lead, ou se ja teve handoff pra humano
    if (!fromMe && lead && (content || mediaType === 'audio')) {
      const freshLead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id)
      setImmediate(() => {
        processInboundMessage(freshLead, content || '', mediaType, waInstance?.id || null)
          .catch(e => console.error('[AI Agent] webhook plug error:', e.message))
      })
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
    // ───────── FIM DO BLOCO MOVIDO ─────────

    return { ok: true }
  }

  return { handleInboundMessage, handleStatusUpdate }
}

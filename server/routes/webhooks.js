import { Router } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { broadcastSSE } from '../sse.js'
import { triggerCapiForStageChange } from '../services/metaCapi.js'
import { sendBotWelcomeForSheetsLead } from '../services/aiAgent.js'
import { notifyAndOpenLead } from '../services/leadHandoff.js'
import { getProvider } from '../services/whatsapp/index.js'
import { resolveInstanceByToken, resolveLegacyEvolutionInstance, processWebhook, webhookErrorStatus } from '../services/whatsapp/webhookFlow.js'
import { createInstanceManager } from '../services/whatsapp/instanceManager.js'
import { createEchoResolver } from '../services/whatsapp/uzapiEcho.js'
import { leadIntake, handleInboundMessage, handleStatusUpdate } from '../services/inboundRuntime.js'

const router = Router()

const { getOrCreateLead } = leadIntake

const instanceManager = createInstanceManager({ db, getProvider })
const echoResolver = createEchoResolver({ db, getProvider, handleInboundMessage })

// Aviso de conexao/QR (UzAPI). Conectou sem telefone conhecido: busca o status para preencher phone_number.
function handleConnection(instance, info) {
  const updated = instanceManager.applyConnection(instance, info)
  if (info.connection === 'connected' && updated && !updated.phone_number) {
    instanceManager.checkStatus(updated).catch(e => console.error('[UzAPI status]', e.message))
  }
  return updated
}

const webhookDeps = { getProvider, handleInboundMessage, handleStatusUpdate, handleConnection, resolveEchoes: echoResolver.resolveEchoes }

// WhatsApp webhook por numero (qualquer provedor). O token identifica a instancia; sem fallback.
router.post('/whatsapp/:instanceToken', (req, res) => {
  let instance = null
  try {
    const r = resolveInstanceByToken(db, req.params.instanceToken)
    if (r.error) {
      console.warn(`[Webhook WhatsApp] ${r.status} ${r.error} ip=${req.ip}`)
      return res.status(r.status).json({ error: r.error })
    }
    instance = r.instance
    return res.json(processWebhook(webhookDeps, r.account, r.instance, req))
  } catch (err) {
    console.error('[Webhook WhatsApp]', err.message)
    const status = webhookErrorStatus(instance)
    res.status(status).json(status === 200 ? { ok: false } : { error: err.message })
  }
})

// Evolution API webhook (URL antiga por conta). Mantida para instancias ainda nao reregistradas.
router.post('/evolution/:accountSlug', (req, res) => {
  try {
    const r = resolveLegacyEvolutionInstance(db, req.params.accountSlug, req.body || {}, req.headers || {})
    if (r.error) {
      console.warn(`[Webhook Evolution] ${r.status} ${r.error} account=${req.params.accountSlug} instance=${req.body?.instance || req.body?.instanceName || '-'}`)
      return res.status(r.status).json({ error: r.error })
    }
    return res.json(processWebhook(webhookDeps, r.account, r.instance, req))
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

    // noAutoHandoff: webhook /sheets aplica tags+mapping DEPOIS de criar lead, entao centraliza
    // o handoff no final (evita race entre setImmediate do getOrCreateLead e o do mapping).
    const { lead, isNew, blocked } = getOrCreateLead(account.id, phone, name, source, null, null, { noAutoHandoff: true })
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

    // Tags — fonte 1: tag default configurada na conta (account.sheets_default_tag_id)
    // Fonte 2: body.tag/tags vindo do Apps Script (string, CSV ou array)
    // Aplica ambas (cumulativo). INSERT OR IGNORE garante idempotencia.
    const tagIdsToApply = []
    if (account.sheets_default_tag_id) tagIdsToApply.push(account.sheets_default_tag_id)
    const rawTags = body.tags != null ? body.tags : body.tag
    if (rawTags) {
      const tagNames = Array.isArray(rawTags)
        ? rawTags.map(s => String(s).trim()).filter(Boolean)
        : String(rawTags).split(',').map(s => s.trim()).filter(Boolean)
      for (const tagName of tagNames) {
        try {
          db.prepare("INSERT OR IGNORE INTO tags (account_id, name, color) VALUES (?, ?, '#FFB300')").run(account.id, tagName)
          const tagRow = db.prepare('SELECT id FROM tags WHERE account_id = ? AND name = ?').get(account.id, tagName)
          if (tagRow) tagIdsToApply.push(tagRow.id)
        } catch (e) {
          console.error(`[Sheets] Erro resolvendo tag "${tagName}" no lead ${lead.id}:`, e.message)
        }
      }
    }
    for (const tagId of tagIdsToApply) {
      try {
        db.prepare('INSERT OR IGNORE INTO lead_tags (lead_id, tag_id) VALUES (?, ?)').run(lead.id, tagId)
      } catch (e) {
        console.error(`[Sheets] Erro aplicando tag id=${tagId} lead=${lead.id}:`, e.message)
      }
    }
    if (tagIdsToApply.length > 0) {
      console.log(`[Sheets] ${tagIdsToApply.length} tag(s) aplicada(s) lead=${lead.id} ids=[${tagIdsToApply.join(',')}]`)
    }

    // Lookup de regra de roteamento por tag (tag_instance_mapping) — SOBRESCREVE attendant
    // mesmo se ja tinha vindo da roleta (porque a regra de tag tem prioridade).
    // So se aplica em lead NOVO (isNew) — evita re-rotear lead existente que volta pela planilha.
    let mappingHandoffDispatched = false
    if (isNew && tagIdsToApply.length > 0) {
      for (const tagId of tagIdsToApply) {
        const mapping = db.prepare('SELECT instance_id, attendant_id FROM tag_instance_mapping WHERE account_id = ? AND tag_id = ?').get(account.id, tagId)
        if (mapping) {
          const updates = []
          const updateParams = []
          if (mapping.instance_id) {
            updates.push('instance_id = ?', 'last_instance_id = ?')
            updateParams.push(mapping.instance_id, mapping.instance_id)
          }
          if (mapping.attendant_id) {
            updates.push('attendant_id = ?')
            updateParams.push(mapping.attendant_id)
          }
          if (updates.length > 0) {
            updates.push("updated_at = datetime('now')")
            updateParams.push(lead.id)
            db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...updateParams)
            // Atualiza o objeto em memoria pra logs/respostas subsequentes
            if (mapping.instance_id) { lead.instance_id = mapping.instance_id; lead.last_instance_id = mapping.instance_id }
            if (mapping.attendant_id) lead.attendant_id = mapping.attendant_id
            db.prepare('INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)').run(lead.id, mapping.instance_id, mapping.attendant_id || null)
            console.log(`[Sheets] Roteamento por tag aplicado lead=${lead.id} tag=${tagId} inst=${mapping.instance_id} atend=${mapping.attendant_id}`)

            // Re-dispara welcome com o atendente CORRETO do mapping (o getOrCreateLead pode ter
            // atribuido outro user via roleta antes do mapping sobrescrever).
            // 1) Tenta bot (se mapping.attendant_id eh user-bot com agente IA + flag welcome)
            // 2) Se bot nao enviou, dispara notifyAndOpenLead que envia first_msg_template
            //    configurado em /instances -> "Mensagem inicial". Idempotencia via lead.first_msg_sent_at.
            setImmediate(async () => {
              try {
                await sendBotWelcomeForSheetsLead(lead.id, mapping.instance_id)
              } catch (e) {
                console.error('[Bot Welcome re-trigger]', e.message)
              }
              const updated = db.prepare('SELECT ai_first_msg_sent_at, first_msg_sent_at FROM leads WHERE id = ?').get(lead.id)
              if (updated?.ai_first_msg_sent_at || updated?.first_msg_sent_at) return
              if (mapping.attendant_id) {
                notifyAndOpenLead(lead.id, mapping.attendant_id, { source: 'sheets_mapping' })
                  .catch(e => console.error('[Handoff sheets mapping]', e.message))
              }
            })
            mappingHandoffDispatched = true
            break // primeira tag com mapping vence
          }
        }
      }
    }

    // Fallback: nenhum mapping de tag aplicado, mas lead novo com atendente da roleta.
    // Dispara handoff (bot welcome + first_msg) na inst do attendant default.
    if (isNew && !mappingHandoffDispatched && lead.attendant_id) {
      setImmediate(async () => {
        try {
          await sendBotWelcomeForSheetsLead(lead.id, lead.instance_id || null)
        } catch (e) {
          console.error('[Bot Welcome sheets fallback]', e.message)
        }
        const updated = db.prepare('SELECT ai_first_msg_sent_at, first_msg_sent_at FROM leads WHERE id = ?').get(lead.id)
        if (updated?.ai_first_msg_sent_at || updated?.first_msg_sent_at) return
        notifyAndOpenLead(lead.id, lead.attendant_id, { source: 'sheets_default' })
          .catch(e => console.error('[Handoff sheets default]', e.message))
      })
    }

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

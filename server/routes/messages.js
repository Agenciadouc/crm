import { Router, json as jsonBodyParser } from 'express'
import fetch from 'node-fetch'
import db from '../db.js'
import { sendViaInstance, checkWhatsAppNumber } from '../services/leadHandoff.js'

const router = Router()

const MEDIA_LIMITS = {
  image:    5  * 1024 * 1024,
  audio:    16 * 1024 * 1024,
  video:    64 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

function detectMediaType(mime = '') {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

// Resolve which WhatsApp instance to use when sending a message.
// Priority:
//   1. Override (explicit user choice — dropdown ou filtro de instancia ativo)
//   2. Se user e atendente DO LEAD (atendente principal): usa last_instance_id (continuidade)
//   3. Se user tem assignment em alguma instancia desse lead: usa essa instancia
//   4. user.primary_instance_id (gerente/admin entrando "por fora")
//   5. lead.last_instance_id (fallback continuidade)
//   6. lead.instance_id (original)
//   7. Most recently created connected instance on the account
function resolveInstanceForSend({ lead, user, override }) {
  const tryGet = (id) => id ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ? AND status = ?').get(id, 'connected') : null

  // 1. Override sempre vence
  const ovr = tryGet(override)
  if (ovr) return ovr

  // 2. Se for o atendente principal do lead → continuidade
  if (user?.id && lead.attendant_id === user.id) {
    const cont = tryGet(lead.last_instance_id) || tryGet(lead.instance_id)
    if (cont) return cont
  }

  // 3. Se user tem assignment em alguma instancia desse lead → usa essa
  if (user?.id) {
    const assignment = db.prepare(
      'SELECT instance_id FROM lead_instance_assignments WHERE lead_id = ? AND attendant_id = ? LIMIT 1'
    ).get(lead.id, user.id)
    const inst = tryGet(assignment?.instance_id)
    if (inst) return inst
  }

  // 4-7. Gerente/admin "por fora" ou fallbacks
  return tryGet(user?.primary_instance_id)
    || tryGet(lead.last_instance_id)
    || tryGet(lead.instance_id)
    || db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(lead.account_id, 'connected')
}

// Get conversation messages for a lead
router.get('/:leadId', (req, res) => {
  // Verify lead belongs to user's account
  const lead = db.prepare('SELECT account_id, attendant_id FROM leads WHERE id = ?').get(req.params.leadId)
  if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
  if (req.accountId && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem permissao' })
  if (req.user.role === 'atendente' && lead.attendant_id !== req.user.id && !db.prepare('SELECT 1 FROM lead_instance_assignments WHERE lead_id = ? AND attendant_id = ?').get(lead.id, req.user.id)) return res.status(403).json({ error: 'Sem permissao' })

  const { page = '1', limit = '50' } = req.query
  const offset = (parseInt(page) - 1) * parseInt(limit)
  const messages = db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?').all(req.params.leadId, parseInt(limit), offset)
  const total = db.prepare('SELECT COUNT(*) as total FROM messages WHERE lead_id = ?').get(req.params.leadId).total
  res.json({ messages, total })
})

// Send message via Evolution API
router.post('/:leadId', async (req, res) => {
  try {
    const { content, instance_id: overrideInstanceId } = req.body
    if (!content) return res.status(400).json({ error: 'content required' })

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId)
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })

    // Anti-duplicate: check if same message was sent to this lead in last 5 minutes
    const duplicate = db.prepare(`
      SELECT id FROM messages WHERE lead_id = ? AND direction = 'outbound' AND content = ? AND created_at > datetime('now', '-5 minutes')
    `).get(req.params.leadId, content)
    if (duplicate) return res.status(409).json({ error: 'Mensagem identica ja enviada nos ultimos 5 minutos' })

    // Resolve instance using priority chain (override → lead.last → lead.original → user.primary → fallback)
    const instance = resolveInstanceForSend({ lead, user: req.user, override: overrideInstanceId })
    if (!instance) return res.status(400).json({ error: 'Nenhuma instancia WhatsApp conectada' })

    // Prefere telefone real (s.whatsapp.net) sobre LID (@lid eh identificador interno do WhatsApp, nao eh telefone valido pra envio)
    const isLidJid = lead.wa_remote_jid && lead.wa_remote_jid.endsWith('@lid')
    let jid = (isLidJid && lead.phone) ? lead.phone : (lead.wa_remote_jid || lead.phone)
    if (!jid) return res.status(400).json({ error: 'Lead sem telefone' })
    // Check if it's a @lid without real phone
    if (jid.endsWith('@lid') && !lead.phone) return res.status(400).json({ error: 'Lead sem telefone real (ID temporario do WhatsApp). Edite o lead e adicione o telefone manualmente.' })

    // Normalize number for Evolution API
    let number = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '').replace(/[^\d]/g, '')
    if (number.startsWith('55') && number.length === 12) number = number.slice(0, 4) + '9' + number.slice(4)
    else if (!number.startsWith('55') && number.length === 11) number = '55' + number
    else if (!number.startsWith('55') && number.length === 10) number = '55' + number.slice(0, 2) + '9' + number.slice(2)

    // Envia via sendViaInstance (com pre-flight + helper centralizado).
    // Chat manual humano: skip TODAS as protecoes anti-ban (atendente controla volume real e digita de verdade).
    // 2 tentativas se primeira falha por timeout/erro (mas nao retenta se foi 'number_not_on_whatsapp').
    let sendRes = null
    for (let attempt = 0; attempt < 2; attempt++) {
      sendRes = await sendViaInstance(instance, number, content, {
        skipTyping: true, skipQuota: true,
        skipBusinessHours: true, skipLeadCap: true, skipHealthCheck: true,
      })
      if (sendRes.ok) break // success
      if (sendRes.validationFailed) break // numero invalido, nao adianta retentar
      if (attempt === 0) {
        console.log(`[Messages] Send attempt 1 failed (${sendRes.reason}) for ${instance.instance_name}, retrying in 2s...`)
        await new Promise(r => setTimeout(r, 2000))
      }
    }

    if (!sendRes.ok) {
      console.error(`[Messages] Failed to send to ${jid} via ${instance.instance_name}: ${sendRes.reason}`)
    }

    const delivered = !!sendRes.ok
    const deliveryStatus = delivered ? 'sent' : 'failed'

    // Store message — delivery_status reflete o resultado real do envio.
    // sent_by_user_id: V2 analytics — atribui mensagem ao humano que digitou (atendente/gerente).
    const result = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, instance_id, sent_by_user_id, delivery_status)
      VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?)
    `).run(lead.id, lead.account_id, content, req.user.name, sendRes.wamsgId || null, instance.id, req.user.id, deliveryStatus)

    // Update lead's last_instance_id (so future messages remember which number to use)
    if (delivered) {
      db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(instance.id, lead.id)
      // Ensure assignment exists for (lead, instance). Sender becomes attendant if no one assigned yet.
      db.prepare(`
        INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id)
        VALUES (?, ?, ?)
      `).run(lead.id, instance.id, req.user.id)
    }

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
    const errorMsg = delivered ? undefined : (sendRes.reason === 'number_not_on_whatsapp'
      ? 'Numero nao tem WhatsApp. Mensagem nao foi enviada.'
      : 'Falha ao enviar pelo WhatsApp. Verifique a conexao.')
    res.json({ message, delivered, instance: { id: instance.id, name: instance.instance_name }, error: errorMsg })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Fetch media on-demand from Evolution API (returns base64 data URL)
router.get('/:leadId/media/:msgId', async (req, res) => {
  try {
    const message = db.prepare('SELECT * FROM messages WHERE id = ? AND lead_id = ?').get(req.params.msgId, req.params.leadId)
    if (!message || !message.wa_msg_id) return res.status(404).json({ error: 'Mensagem nao encontrada' })
    if (message.media_type === 'text') return res.status(400).json({ error: 'Sem midia' })

    const lead = db.prepare('SELECT account_id, instance_id FROM leads WHERE id = ?').get(message.lead_id)
    const instance = lead?.instance_id
      ? db.prepare('SELECT * FROM whatsapp_instances WHERE id = ?').get(lead.instance_id)
      : db.prepare('SELECT * FROM whatsapp_instances WHERE account_id = ? AND status = ? LIMIT 1').get(lead?.account_id, 'connected')
    if (!instance) return res.status(400).json({ error: 'Sem instancia WhatsApp' })

    const r = await fetch(`${instance.api_url}/chat/getBase64FromMediaMessage/${instance.instance_name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify({ message: { key: { id: message.wa_msg_id } }, convertToMp4: false }),
    })
    const data = await r.json()
    if (!data.base64) return res.status(404).json({ error: 'Midia nao encontrada na Evolution' })

    const mimeMap = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg', document: 'application/pdf', sticker: 'image/webp' }
    const mime = data.mimetype || mimeMap[message.media_type] || 'application/octet-stream'
    res.json({ dataUrl: `data:${mime};base64,${data.base64}`, mime, type: message.media_type })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Send media (image/audio/video/document) via Evolution API.
// Body: { base64, mime, file_name, caption?, instance_id? }
// Server doesn't store the binary — just streams to Evolution and saves metadata.
router.post('/:leadId/media', jsonBodyParser({ limit: '150mb' }), async (req, res) => {
  try {
    const { base64, mime, file_name, caption, instance_id: overrideInstanceId } = req.body
    if (!base64 || !mime) return res.status(400).json({ error: 'base64 e mime obrigatorios' })

    const mediaType = detectMediaType(mime)
    const approxBytes = Math.floor(base64.length * 0.75)
    if (approxBytes > MEDIA_LIMITS[mediaType]) {
      return res.status(413).json({ error: `Arquivo excede o limite de ${Math.floor(MEDIA_LIMITS[mediaType] / 1024 / 1024)}MB para ${mediaType}` })
    }

    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.leadId)
    if (!lead) return res.status(404).json({ error: 'Lead nao encontrado' })
    if (req.accountId && lead.account_id !== req.accountId) return res.status(403).json({ error: 'Sem permissao' })

    const instance = resolveInstanceForSend({ lead, user: req.user, override: overrideInstanceId })
    if (!instance) return res.status(400).json({ error: 'Nenhuma instancia WhatsApp conectada' })

    // Prefere telefone real (s.whatsapp.net) sobre LID (@lid eh identificador interno do WhatsApp, nao eh telefone valido pra envio)
    const isLidJid = lead.wa_remote_jid && lead.wa_remote_jid.endsWith('@lid')
    let jid = (isLidJid && lead.phone) ? lead.phone : (lead.wa_remote_jid || lead.phone)
    if (!jid) return res.status(400).json({ error: 'Lead sem telefone' })
    if (jid.endsWith('@lid') && !lead.phone) return res.status(400).json({ error: 'Lead sem telefone real' })

    let number = jid.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '').replace(/[^\d]/g, '')
    if (number.startsWith('55') && number.length === 12) number = number.slice(0, 4) + '9' + number.slice(4)
    else if (!number.startsWith('55') && number.length === 11) number = '55' + number
    else if (!number.startsWith('55') && number.length === 10) number = '55' + number.slice(0, 2) + '9' + number.slice(2)

    // Pre-flight: valida numero antes de upload da midia (evita transferir base64 inutil)
    const exists = await checkWhatsAppNumber(instance, number)
    if (exists === false) {
      console.log(`[Messages/Media] phone=${number} inst=${instance.instance_name} exists=false — bloqueando envio`)
      const content = caption || file_name || `[${mediaType}]`
      const result = db.prepare(`
        INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, media_type, instance_id, sent_by_user_id, delivery_status)
        VALUES (?, ?, 'outbound', ?, ?, NULL, ?, ?, ?, 'failed')
      `).run(lead.id, lead.account_id, content, req.user.name, mediaType, instance.id, req.user.id)
      const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
      return res.status(200).json({ message, delivered: false, instance: { id: instance.id, name: instance.instance_name }, error: 'Numero nao tem WhatsApp. Midia nao foi enviada.' })
    }

    let endpoint, payload
    if (mediaType === 'audio') {
      endpoint = `${instance.api_url}/message/sendWhatsAppAudio/${encodeURIComponent(instance.instance_name)}`
      payload = { number, audio: base64, encoding: true }
    } else {
      endpoint = `${instance.api_url}/message/sendMedia/${encodeURIComponent(instance.instance_name)}`
      payload = {
        number,
        mediatype: mediaType,
        media: base64,
        mimetype: mime,
        fileName: file_name || `arquivo.${mime.split('/')[1] || 'bin'}`,
        caption: caption || undefined,
      }
    }

    const sendRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: instance.api_key },
      body: JSON.stringify(payload),
    })
    const sendData = await sendRes.json()
    const delivered = !!sendData?.key?.id

    if (!delivered) {
      console.error(`[Messages/Media] Failed for ${jid} via ${instance.instance_name}:`, JSON.stringify(sendData)?.substring(0, 300))
    }

    const content = caption || file_name || `[${mediaType}]`
    const deliveryStatus = delivered ? 'sent' : 'failed'
    // sent_by_user_id: V2 analytics — atribui mídia ao humano específico.
    const result = db.prepare(`
      INSERT INTO messages (lead_id, account_id, direction, content, sender_name, wa_msg_id, media_type, instance_id, sent_by_user_id, delivery_status)
      VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?)
    `).run(lead.id, lead.account_id, content, req.user.name, sendData?.key?.id || null, mediaType, instance.id, req.user.id, deliveryStatus)

    if (delivered) {
      db.prepare("UPDATE leads SET last_instance_id = ?, updated_at = datetime('now') WHERE id = ?").run(instance.id, lead.id)
      db.prepare(`INSERT OR IGNORE INTO lead_instance_assignments (lead_id, instance_id, attendant_id) VALUES (?, ?, ?)`).run(lead.id, instance.id, req.user.id)
    }

    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid)
    res.json({ message, delivered, instance: { id: instance.id, name: instance.instance_name }, error: delivered ? undefined : 'Falha ao enviar pelo WhatsApp.' })
  } catch (err) {
    console.error('[Messages/Media] Exception:', err.message)
    res.status(500).json({ error: err.message })
  }
})

export default router

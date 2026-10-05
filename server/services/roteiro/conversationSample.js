// Amostra de conversas reais da PROPRIA conta para a IA do roteiro (spec 2026-10-02 §8.1):
// quem comprou primeiro, depois quem avancou de etapa, depois o resto. Nome e telefone do
// lead saem trocados por [cliente]/[telefone]. Nao importa server/db.js: recebe db.
import { toSqliteDate } from './time.js'

const PER_CONVERSATION = 30
const PER_MESSAGE = 300
const LABEL = { bought: 'comprou', advanced: 'avançou', other: 'não avançou' }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function hasTranscription(db) {
  try { return db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'transcription') } catch { return false }
}

function redactor(lead) {
  const names = String(lead.name || '').split(/\s+/).filter(w => w.length >= 3)
  const tail = String(lead.phone || '').replace(/\D/g, '').slice(-8)
  const nameRe = names.length ? new RegExp(`(^|[^\\p{L}])(${names.map(escapeRe).join('|')})(?![\\p{L}])`, 'giu') : null
  const phoneRe = tail.length === 8 ? new RegExp(`[+\\d()\\s.-]*${tail.split('').join('[\\s.-]?')}`, 'g') : null
  return text => {
    let t = text
    if (phoneRe) t = t.replace(phoneRe, ' [telefone]')
    if (nameRe) t = t.replace(nameRe, '$1[cliente]')
    return t.replace(/\s+/g, ' ').trim()
  }
}

export function sampleConversations(db, { accountId, now = new Date(), days = 90, caps = { bought: 20, advanced: 10, other: 10 }, maxChars = 60000 } = {}) {
  const since = toSqliteDate(new Date(now.getTime() - days * 86400000))
  // Audio ja transcrito entra pelo texto da transcricao.
  const content = hasTranscription(db) ? "COALESCE(NULLIF(TRIM(m.transcription), ''), m.content)" : 'm.content'
  const leads = db.prepare(`
    SELECT l.id, l.name, l.phone, fs.name AS stage_name, MAX(m.created_at) AS last_at,
      (EXISTS (SELECT 1 FROM lead_sales s WHERE s.lead_id = l.id AND s.account_id = l.account_id)
        OR EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages c ON c.id = h.to_stage_id WHERE h.lead_id = l.id AND c.is_conversion = 1)) AS bought,
      EXISTS (SELECT 1 FROM stage_history h JOIN funnel_stages a ON a.id = h.from_stage_id JOIN funnel_stages b ON b.id = h.to_stage_id
        WHERE h.lead_id = l.id AND b.position > a.position) AS advanced
    FROM leads l
    JOIN messages m ON m.lead_id = l.id AND m.account_id = l.account_id
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    WHERE l.account_id = ? AND m.created_at >= ? AND TRIM(COALESCE(${content}, '')) <> ''
    GROUP BY l.id
    HAVING COUNT(*) >= 3 AND SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END) >= 1
    ORDER BY last_at DESC, l.id DESC
  `).all(accountId, since)

  const groups = { bought: [], advanced: [], other: [] }
  for (const l of leads) {
    const g = l.bought ? 'bought' : l.advanced ? 'advanced' : 'other'
    if (groups[g].length < (caps[g] ?? 0)) groups[g].push(l)
  }

  const msgStmt = db.prepare(`
    SELECT m.direction, ${content} AS text FROM messages m
    WHERE m.lead_id = ? AND m.account_id = ? AND m.created_at >= ? AND TRIM(COALESCE(${content}, '')) <> ''
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?
  `)
  const blocks = []
  for (const g of ['bought', 'advanced', 'other']) {
    for (const l of groups[g]) {
      const clean = redactor(l)
      const lines = msgStmt.all(l.id, accountId, since, PER_CONVERSATION).reverse()
        .map(m => `${m.direction === 'inbound' ? 'Cliente' : 'Vendedor'}: ${clean(String(m.text)).slice(0, PER_MESSAGE)}`)
      blocks.push({ g, text: `### Conversa — resultado: ${LABEL[g]} | etapa atual: ${l.stage_name || '—'}\n${lines.join('\n')}` })
    }
  }
  // Teto: corta as de menor prioridade (fim da lista) primeiro.
  let total = blocks.reduce((n, b) => n + b.text.length, 0) + Math.max(0, blocks.length - 1) * 2
  while (blocks.length && total > maxChars) {
    const b = blocks.pop()
    total -= b.text.length + (blocks.length ? 2 : 0)
  }
  const counts = { bought: 0, advanced: 0, other: 0 }
  for (const b of blocks) counts[b.g]++
  return { text: blocks.map(b => b.text).join('\n\n'), count: blocks.length, counts }
}

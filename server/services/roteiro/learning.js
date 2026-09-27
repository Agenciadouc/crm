// Aprendizado do roteiro (spec 3.3, 6.3, 6.5): sugestoes sem IA, teste A/B e decisoes do gestor.
// Nao importa server/db.js: recebe db (testavel com banco em memoria).
import { getRoteiro, saveDraft, publish, RoteiroError } from './repo.js'
import { activeVariant, resolveLeadName } from './variants.js'
import { questionMetrics, accountMinReplyRate, pct } from './metrics.js'
import { resolveNow, shiftFromNow } from './time.js'
import { runAiLearning } from './aiLearning.js'

export const SELLER_MIN_SENT = 10
export const AB_MIN_SENT = 30
export const AB_MAX_DAYS = 30
export const AB_MIN_GAIN = 5
const AB_TYPES = ['rewrite', 'seller_phrasing']

const normText = t => String(t ?? '').trim().toLowerCase()
const fmtPct = n => (n == null ? '—' : `${String(n).replace('.', ',')}%`)

function getSuggestion(db, accountId, suggestionId) {
  const row = db.prepare('SELECT * FROM roteiro_suggestions WHERE id = ? AND account_id = ?').get(suggestionId, accountId)
  if (!row) throw new RoteiroError('not_found', 404, 'Sugestão não encontrada.')
  let payload = {}
  try { payload = JSON.parse(row.payload_json) || {} } catch {}
  return { ...row, payload }
}

function getVariant(db, accountId, variantId) {
  const row = db.prepare('SELECT * FROM roteiro_variants WHERE id = ? AND account_id = ?').get(variantId, accountId)
  if (!row) throw new RoteiroError('not_found', 404, 'Teste não encontrado.')
  return row
}

function decideSuggestion(db, suggestionId, status, userId, now) {
  db.prepare('UPDATE roteiro_suggestions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
    .run(status, userId ?? null, resolveNow(db, now), suggestionId)
}

// Funil da pergunta (prefere a versao publicada).
function funnelForQuestion(db, accountId, questionKey) {
  const row = db.prepare(`
    SELECT v.funnel_id FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id
    WHERE q.account_id = ? AND q.question_key = ?
    ORDER BY CASE v.status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, v.id DESC LIMIT 1
  `).get(accountId, questionKey)
  return row ? row.funnel_id : null
}

function publishedQuestionText(db, accountId, questionKey) {
  const row = db.prepare(`
    SELECT q.text FROM roteiro_questions q JOIN roteiro_versions v ON v.id = q.version_id
    WHERE q.account_id = ? AND q.question_key = ? AND v.status = 'published' LIMIT 1
  `).get(accountId, questionKey)
  return row ? row.text : null
}

// Edita o rascunho (ou parte do publicado se nao houver rascunho) e salva.
function editDraft(db, accountId, funnelId, mutate) {
  const rot = getRoteiro(db, accountId, funnelId)
  const base = rot.draft || rot.published
  if (!base) throw new RoteiroError('no_roteiro', 409, 'Este funil ainda não tem roteiro.')
  const content = {
    questions: base.questions.map(q => ({ ...q, options: q.options.map(o => ({ ...o })) })),
    deviations: base.deviations.map(d => ({ ...d })),
  }
  mutate(content)
  return saveDraft(db, accountId, funnelId, content)
}

function findQuestion(content, questionKey) {
  const q = content.questions.find(x => x.question_key === questionKey)
  if (!q) throw new RoteiroError('question_gone', 409, 'Essa pergunta não existe mais no roteiro.')
  return q
}

function suggestionFunnel(db, accountId, s) {
  const funnelId = s.funnel_id ?? (s.question_key ? funnelForQuestion(db, accountId, s.question_key) : null)
  if (!funnelId) throw new RoteiroError('question_gone', 409, 'Essa pergunta não existe mais no roteiro.')
  return funnelId
}

function suggestionText(s, versionIndex) {
  const p = s.payload || {}
  const text = typeof p.text === 'string' && p.text.trim()
    ? p.text
    : (Array.isArray(p.versions) ? p.versions[Number.isInteger(versionIndex) ? versionIndex : 0] : null)
  if (typeof text !== 'string' || !text.trim()) throw new RoteiroError('invalid', 400, 'A sugestão não tem texto.')
  return text.trim()
}

// --- Analise noturna ---------------------------------------------------------------

// Sugestoes sem IA + avaliacao dos testes A/B. Devolve { created }.
// Com `ai`, soma as sugestoes com IA (runAiLearning) e devolve uma Promise de { created }.
export function runLearning(db, { accountId, now, ai = null } = {}) {
  const min = accountMinReplyRate(db, accountId)
  const funnels = db.prepare("SELECT DISTINCT funnel_id FROM roteiro_versions WHERE account_id = ? AND status = 'published'").all(accountId)
  const exists = db.prepare(`
    SELECT 1 FROM roteiro_suggestions WHERE account_id = ? AND type = 'seller_phrasing' AND question_key = ? AND status IN ('new','testing') LIMIT 1
  `)
  const decided = db.prepare(`
    SELECT payload_json FROM roteiro_suggestions WHERE account_id = ? AND type = 'seller_phrasing' AND question_key = ? AND status IN ('rejected','applied')
  `)
  const insert = db.prepare(`
    INSERT INTO roteiro_suggestions (account_id, funnel_id, question_key, type, payload_json, evidence_json, created_at)
    VALUES (?, ?, ?, 'seller_phrasing', ?, ?, ?)
  `)
  const nowStr = resolveNow(db, now)
  const metricsByFunnel = {}
  let created = 0

  for (const { funnel_id: funnelId } of funnels) {
    let metrics
    try {
      metrics = questionMetrics(db, { accountId, funnelId, now })
    } catch (e) {
      console.error('[Roteiro] aprendizado do funil', funnelId, e.message)
      continue
    }
    metricsByFunnel[funnelId] = metrics
    for (const q of metrics) {
      if (q.status !== 'fraca') continue
      const best = q.by_seller.find(v => v.sent >= SELLER_MIN_SENT && v.reply_rate != null && v.reply_rate >= min && v.examples.length)
      if (!best) continue
      if (exists.get(accountId, q.question_key)) continue
      // Pula exemplo igual ao texto atual e jeito ja recusado/aplicado antes (nao volta toda noite).
      const skip = new Set([normText(q.text), normText(resolveLeadName(String(q.text), null))])
      for (const row of decided.all(accountId, q.question_key)) {
        try { const t = JSON.parse(row.payload_json)?.text; if (t) skip.add(normText(t)) } catch {}
      }
      const text = best.examples.find(e => !skip.has(normText(e)))
      if (!text) continue
      insert.run(accountId, funnelId, q.question_key,
        JSON.stringify({ text, seller_name: best.name, seller_rate: best.reply_rate, current_rate: q.reply_rate }),
        JSON.stringify({ sent: q.sent, seller_sent: best.sent, seller_id: best.user_id }),
        nowStr)
      created++
    }
  }

  evaluateAbTests(db, { accountId, now })
  if (!ai) return { created }
  return runAiLearning(db, { accountId, metricsByFunnel, ai, now })
    .then(r => ({ created: created + r.created }))
    .catch(e => {
      console.error('[Roteiro] aprendizado com IA:', e && e.message)
      return { created }
    })
}

// --- Teste A/B ---------------------------------------------------------------------

// Liga o teste A/B com o texto da sugestao como versao B.
export function startAbTest(db, { accountId, suggestionId, userId = null, versionIndex = null, now } = {}) {
  const s = getSuggestion(db, accountId, suggestionId)
  if (!AB_TYPES.includes(s.type) || !s.question_key) throw new RoteiroError('invalid', 400, 'Só dá para testar sugestões de texto de pergunta.')
  if (s.status !== 'new') throw new RoteiroError('decided', 409, 'Essa sugestão já foi decidida.')
  const text = suggestionText(s, versionIndex)
  if (!publishedQuestionText(db, accountId, s.question_key)) throw new RoteiroError('question_gone', 409, 'Essa pergunta não está no roteiro publicado.')
  if (activeVariant(db, accountId, s.question_key)) throw new RoteiroError('in_test', 409, 'Esta pergunta já está em teste.')

  let variantId
  db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO roteiro_variants (account_id, question_key, text, status, started_at, suggestion_id) VALUES (?, ?, ?, 'testing', ?, ?)
    `).run(accountId, s.question_key, text, resolveNow(db, now), s.id)
    variantId = Number(info.lastInsertRowid)
    db.prepare("UPDATE roteiro_suggestions SET status = 'testing', decided_by = ?, decided_at = ? WHERE id = ?")
      .run(userId ?? null, resolveNow(db, now), s.id)
  })()
  return db.prepare('SELECT * FROM roteiro_variants WHERE id = ?').get(variantId)
}

// Encerra testes com >= 30 envios em A e B ou 30 dias; vencedora com diferenca >= 5 pontos.
export function evaluateAbTests(db, { accountId, now } = {}) {
  const nowStr = resolveNow(db, now)
  const limit = shiftFromNow(db, nowStr, `-${AB_MAX_DAYS} days`)
  const variants = db.prepare("SELECT * FROM roteiro_variants WHERE account_id = ? AND status = 'testing'").all(accountId)
  const countStmt = db.prepare(`
    SELECT COUNT(*) AS sent, SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
    FROM roteiro_asks WHERE account_id = ? AND question_key = ? AND variant = ? AND asked_at >= ? AND asked_at <= ?
  `)
  const insertAlert = db.prepare(`
    INSERT INTO analyst_alerts (account_id, lead_id, type, severity, title, description, suggested_action, status, created_at)
    VALUES (?, NULL, 'roteiro_ab_resultado', 'media', 'Teste A/B terminou', ?, ?, 'open', ?)
  `)
  let ended = 0

  for (const v of variants) {
    const a = countStmt.get(accountId, v.question_key, 'A', v.started_at, nowStr)
    const b = countStmt.get(accountId, v.question_key, 'B', v.started_at, nowStr)
    const sentA = a.sent || 0
    const sentB = b.sent || 0
    const enough = sentA >= AB_MIN_SENT && sentB >= AB_MIN_SENT
    if (!enough && v.started_at > limit) continue

    const rateA = pct(a.replied || 0, sentA)
    const rateB = pct(b.replied || 0, sentB)
    let winner = 'empate'
    if (sentA > 0 && sentB > 0) {
      const diff = Math.round((rateB - rateA) * 10) / 10
      if (diff >= AB_MIN_GAIN) winner = 'B'
      else if (-diff >= AB_MIN_GAIN) winner = 'A'
    }
    const status = winner === 'B' ? 'won' : 'lost'
    const questionText = publishedQuestionText(db, accountId, v.question_key) || 'pergunta do roteiro'
    const result = winner === 'B'
      ? 'A nova versão venceu.'
      : winner === 'A' ? 'A versão atual venceu.' : 'Empate: diferença menor que 5 pontos, continua a versão atual.'
    const description = `Pergunta "${questionText}": versão atual ${fmtPct(rateA)} de resposta (${sentA} envios) × nova versão "${v.text}" ${fmtPct(rateB)} (${sentB} envios). ${result}`
    const action = winner === 'B'
      ? 'Abra Qualificação > Sugestões e testes e confirme a vencedora para usar no roteiro.'
      : 'Abra Qualificação > Sugestões e testes e mantenha a versão atual.'

    db.transaction(() => {
      db.prepare('UPDATE roteiro_variants SET status = ?, ended_at = ? WHERE id = ?').run(status, nowStr, v.id)
      insertAlert.run(accountId, description, action, nowStr)
    })()
    ended++
  }
  return { ended }
}

// [Confirmar vencedora]: B venceu -> troca o texto no rascunho e publica. A venceu/empate -> mantem a atual.
export function confirmVariant(db, { accountId, variantId, userId = null, now } = {}) {
  const v = getVariant(db, accountId, variantId)
  if (v.status === 'testing') throw new RoteiroError('running', 409, 'O teste ainda não terminou.')
  if (v.status === 'cancelled') throw new RoteiroError('cancelled', 409, 'Esse teste foi cancelado.')
  const s = v.suggestion_id ? db.prepare('SELECT * FROM roteiro_suggestions WHERE id = ? AND account_id = ?').get(v.suggestion_id, accountId) : null
  if (s && (s.status === 'applied' || s.status === 'rejected')) throw new RoteiroError('decided', 409, 'Esse teste já foi decidido.')
  if (v.status !== 'won') {
    keepCurrent(db, { accountId, variantId, userId, now })
    return { published: false }
  }

  const funnelId = funnelForQuestion(db, accountId, v.question_key)
  if (!funnelId) throw new RoteiroError('question_gone', 409, 'Essa pergunta não existe mais no roteiro.')
  let version
  db.transaction(() => {
    editDraft(db, accountId, funnelId, content => { findQuestion(content, v.question_key).text = v.text })
    version = publish(db, accountId, funnelId, userId)
    if (s) decideSuggestion(db, s.id, 'applied', userId, now)
  })()
  return { published: true, version }
}

// [Manter a atual]: sugestao ligada ao teste fica recusada.
export function keepCurrent(db, { accountId, variantId, userId = null, now } = {}) {
  const v = getVariant(db, accountId, variantId)
  if (v.status === 'testing') throw new RoteiroError('running', 409, 'O teste ainda não terminou.')
  if (v.suggestion_id) {
    db.prepare(`
      UPDATE roteiro_suggestions SET status = 'rejected', decided_by = ?, decided_at = ?
      WHERE id = ? AND account_id = ? AND status IN ('new','testing')
    `).run(userId ?? null, resolveNow(db, now), v.suggestion_id, accountId)
  }
  return { ok: true }
}

// --- Aplicar / recusar sugestoes -----------------------------------------------------

// [Aplicar]: mexe so no rascunho (publicar continua manual).
export function applySuggestion(db, { accountId, suggestionId, userId = null, now } = {}) {
  const s = getSuggestion(db, accountId, suggestionId)
  if (s.status !== 'new') throw new RoteiroError('decided', 409, 'Essa sugestão já foi decidida.')
  const funnelId = suggestionFunnel(db, accountId, s)
  const p = s.payload

  let draft
  db.transaction(() => {
    draft = editDraft(db, accountId, funnelId, content => {
      if (s.type === 'rewrite' || s.type === 'seller_phrasing') {
        findQuestion(content, s.question_key).text = suggestionText(s)
      } else if (s.type === 'new_option') {
        const q = findQuestion(content, p.question_key || s.question_key)
        if (q.kind !== 'options') throw new RoteiroError('invalid', 409, 'Essa pergunta é de texto livre. Mude para opções no rascunho e adicione a opção à mão.')
        const label = typeof p.label === 'string' ? p.label.trim() : ''
        if (!label) throw new RoteiroError('invalid', 400, 'A sugestão não tem o texto da opção.')
        const nextPos = q.options.length ? Math.max(...q.options.map(o => o.position)) + 1 : 0
        q.options.push({ label, points: 0, position: nextPos })
      } else if (s.type === 'new_deviation') {
        content.deviations.push({
          triggers: p.triggers, reply_text: p.reply_text, return_question_key: p.return_question_key || null, position: content.deviations.length,
        })
      } else if (s.type === 'reorder') {
        const order = Array.isArray(p.order) ? p.order : []
        const inStage = content.questions.filter(q => q.stage_id === p.stage_id)
          .sort((a, b) => a.position - b.position)
        const rank = q => { const i = order.indexOf(q.question_key); return i === -1 ? order.length : i }
        inStage.sort((a, b) => rank(a) - rank(b) || a.position - b.position)
          .forEach((q, idx) => { q.position = idx })
      }
    })
    decideSuggestion(db, s.id, 'applied', userId, now)
  })()
  return { draft }
}

// [Recusar]
export function rejectSuggestion(db, { accountId, suggestionId, userId = null, now } = {}) {
  const s = getSuggestion(db, accountId, suggestionId)
  if (s.status !== 'new') throw new RoteiroError('decided', 409, 'Essa sugestão já foi decidida.')
  decideSuggestion(db, s.id, 'rejected', userId, now)
  return { ok: true }
}

// Resumo de um teste A/B para a tela (aba Sugestoes e testes): funil, texto atual (A),
// envios e taxa de A e B desde o inicio (ate o fim, se ja terminou), dias restantes
// e se o gestor ja decidiu (sugestao aplicada/recusada).
export function abTestSummary(db, { accountId, variant, now } = {}) {
  const v = variant
  const until = v.ended_at || resolveNow(db, now)
  const stmt = db.prepare(`
    SELECT COUNT(*) AS sent, SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) AS replied
    FROM roteiro_asks WHERE account_id = ? AND question_key = ? AND variant = ? AND asked_at >= ? AND asked_at <= ?
  `)
  const side = letter => {
    const r = stmt.get(accountId, v.question_key, letter, v.started_at, until)
    const sent = r.sent || 0
    return { sent, rate: pct(r.replied || 0, sent) }
  }
  let daysLeft = 0
  if (v.status === 'testing') {
    const elapsed = db.prepare('SELECT julianday(?) - julianday(?) AS d').get(until, v.started_at).d || 0
    daysLeft = Math.max(0, Math.ceil(AB_MAX_DAYS - elapsed))
  }
  const s = v.suggestion_id
    ? db.prepare('SELECT status FROM roteiro_suggestions WHERE id = ? AND account_id = ?').get(v.suggestion_id, accountId)
    : null
  return {
    funnel_id: funnelForQuestion(db, accountId, v.question_key),
    current_text: publishedQuestionText(db, accountId, v.question_key),
    a: side('A'),
    b: side('B'),
    days_left: daysLeft,
    decided: !!s && (s.status === 'applied' || s.status === 'rejected'),
  }
}

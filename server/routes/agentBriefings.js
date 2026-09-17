// API da entrevista que monta o agente. Entrevista e compilacao rodam sempre na
// chave da Dros (drosAi), nao na chave da conta.

import { Router } from 'express'
import db from '../db.js'
import { requireRole } from '../middleware/auth.js'
import { createDrosAi } from '../services/drosAi.js'
import { createBriefing, getBriefing, listDrafts, setCompiled, deleteBriefing } from '../services/briefingStore.js'
import { nextQuestion, answer } from '../services/agentInterview.js'
import { collectPastedText } from '../services/briefingSources/pastedText.js'
import { compileBriefing } from '../services/agentCompiler.js'
import { activateBriefing } from '../services/briefingActivate.js'
import { briefingFromAgent } from '../services/briefingFromAgent.js'

const router = Router()

export function statusForError(error) {
  if (error === 'briefing_nao_encontrado' || error === 'agente_nao_encontrado') return 404
  if (error === 'dros_key_missing') return 503
  if (error === 'briefing_nao_compilado' || error === 'compilado_invalido') return 409
  return 400
}

function fail(res, error) {
  const status = statusForError(error)
  const msg = error === 'dros_key_missing'
    ? 'A chave de IA da Dros nao esta configurada no servidor (ANTHROPIC_API_KEY_DROS).'
    : error
  return res.status(status).json({ error: msg })
}

function aiFor(req) {
  return createDrosAi(db, { accountId: req.accountId })
}

router.post('/', requireRole('super_admin', 'gerente'), async (req, res) => {
  if (!req.accountId) return res.status(400).json({ error: 'account_id required' })
  const briefingId = createBriefing(db, { accountId: req.accountId, userId: req.user.id })
  const r = await nextQuestion(db, { accountId: req.accountId, briefingId, ai: aiFor(req) })
  if (!r.ok) {
    deleteBriefing(db, req.accountId, briefingId) // nao deixa rascunho morto se a IA nem respondeu
    return fail(res, r.error)
  }
  res.status(201).json({ briefing_id: briefingId, question: r.question, done: r.done })
})

router.get('/', requireRole('super_admin', 'gerente'), (req, res) => {
  res.json({ drafts: listDrafts(db, req.accountId) })
})

router.get('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = getBriefing(db, req.accountId, req.params.id)
  if (!b) return fail(res, 'briefing_nao_encontrado')
  res.json({ briefing: b })
})

router.post('/:id/answer', requireRole('super_admin', 'gerente'), async (req, res) => {
  const gravou = answer(db, { accountId: req.accountId, briefingId: req.params.id, text: (req.body || {}).text })
  if (!gravou.ok) return fail(res, gravou.error)
  const r = await nextQuestion(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req) })
  if (!r.ok) return fail(res, r.error)
  res.json({ done: r.done, question: r.question || null, reason: r.reason || null })
})

router.post('/:id/paste', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = getBriefing(db, req.accountId, req.params.id)
  if (!b) return fail(res, 'briefing_nao_encontrado')
  const r = collectPastedText(db, { accountId: req.accountId, briefingId: b.id, text: (req.body || {}).text })
  if (!r.ok) return fail(res, r.error)
  res.json({ ok: true })
})

router.post('/:id/compile', requireRole('super_admin', 'gerente'), async (req, res) => {
  const r = await compileBriefing(db, { accountId: req.accountId, briefingId: req.params.id, ai: aiFor(req) })
  if (!r.ok) return fail(res, r.error)
  setCompiled(db, { accountId: req.accountId, briefingId: req.params.id, compiled: r.compiled })
  res.json({ compiled: r.compiled })
})

router.post('/:id/activate', requireRole('super_admin', 'gerente'), (req, res) => {
  const b = req.body || {}
  const r = activateBriefing(db, {
    accountId: req.accountId,
    briefingId: req.params.id,
    mode: b.mode || 'copilot',
    instanceIds: Array.isArray(b.instance_ids) ? b.instance_ids : [],
  })
  if (!r.ok) return fail(res, r.error)
  res.status(201).json({ agent_id: r.agentId })
})

router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  if (!deleteBriefing(db, req.accountId, req.params.id)) return fail(res, 'briefing_nao_encontrado')
  res.json({ ok: true })
})

router.post('/from-agent/:agentId', requireRole('super_admin', 'gerente'), (req, res) => {
  const r = briefingFromAgent(db, { accountId: req.accountId, agentId: req.params.agentId, userId: req.user.id })
  if (!r.ok) return fail(res, r.error)
  res.json({ briefing_id: r.briefingId })
})

export default router

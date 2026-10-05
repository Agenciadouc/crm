// Cadencia da etapa no lead (spec 2026-09-27 §3.3, §4.1, §4.2): abre ao entrar na etapa,
// fecha ao sair, calcula o proximo passo e registra "feito". Avulsas seguem o jeito antigo
// (passo a passo pela posicao). Recebe db (nao importa server/db.js nem stageMove.js).
import { CadenceError } from './errors.js'
import { computeNext } from './nextStep.js'
import { getLeadRoteiro, safeGetPublishedQuestions } from '../roteiro/leadRoteiro.js'
import { activeDeviationForLead } from '../roteiro/deviations.js'
import { appliesToLead, effectiveProfileKey } from '../roteiro/profiles.js'

const MANAGER_ROLES = ['gerente', 'super_admin']
const DONE_HOWS = ['enviado', 'feito', 'pulado']

function loadLead(db, accountId, leadId) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND account_id = ?').get(leadId, accountId)
  if (!lead) throw new CadenceError('not_found', 404, 'Lead não encontrado.')
  return lead
}

function activeEtapa(db, leadId) {
  return db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' AND status = 'active' ORDER BY id DESC LIMIT 1").get(leadId) || null
}

// Passos na ordem; pergunta que saiu do roteiro publicado vem com orphan: true (nao trava).
// `cache` (Map cadence_id -> passos): recalculo em lote le o roteiro publicado uma vez so.
function stepsOf(db, cadenceId, cache = null) {
  if (cache && cache.has(cadenceId)) return cache.get(cadenceId)
  const steps = loadSteps(db, cadenceId)
  if (cache) cache.set(cadenceId, steps)
  return steps
}

function loadSteps(db, cadenceId) {
  const steps = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? ORDER BY position ASC, id ASC').all(cadenceId)
  if (!steps.some(s => s.action_type === 'pergunta')) return steps.map(s => ({ ...s, orphan: false }))
  const cad = db.prepare('SELECT account_id, funnel_id FROM cadences WHERE id = ?').get(cadenceId)
  const profileByKey = new Map(cad ? safeGetPublishedQuestions(db, cad.account_id, cad.funnel_id).map(q => [q.question_key, q.profile_key ?? null]) : [])
  return steps.map(s => ({
    ...s,
    orphan: s.action_type === 'pergunta' && !profileByKey.has(s.question_key),
    question_profile_key: profileByKey.get(s.question_key) ?? null,
  }))
}

// Pergunta de outro perfil fica "nao se aplica" para este lead (spec 2026-10-02 §5): os passos
// em cache valem para todos os leads; a marca e calculada por lead.
function forLead(db, leadId, steps) {
  if (!steps.some(s => s.action_type === 'pergunta' && s.question_profile_key)) return steps
  const p = effectiveProfileKey(db, db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId))
  return steps.map(s => ({
    ...s,
    not_applicable: s.action_type === 'pergunta' && !s.orphan && !appliesToLead({ profile_key: s.question_profile_key }, p),
  }))
}

// Entrada atual do lead na etapa = ultimo stage_history para ela (0 quando nao ha historico).
function stageEntryId(db, lead) {
  const row = db.prepare('SELECT MAX(id) AS id FROM stage_history WHERE lead_id = ? AND to_stage_id = ?').get(lead.id, lead.stage_id)
  return row && row.id ? row.id : 0
}

function inList(keys) {
  return keys.map(() => '?').join(',')
}

function ctxFor(db, lc, steps) {
  const keys = steps.filter(s => s.question_key).map(s => s.question_key)
  const answeredKeys = new Set(keys.length
    ? db.prepare(`SELECT question_key FROM lead_answers WHERE lead_id = ? AND question_key IN (${inList(keys)})`).all(lc.lead_id, ...keys).map(r => r.question_key)
    : [])
  const askedKeys = new Set(keys.length
    ? db.prepare(`SELECT DISTINCT question_key FROM roteiro_asks WHERE lead_id = ? AND asked_at >= ? AND question_key IN (${inList(keys)})`).all(lc.lead_id, lc.started_at, ...keys).map(r => r.question_key)
    : [])
  const doneRows = db.prepare('SELECT attempt_id, how, done_at, done_by FROM lead_cadence_steps WHERE lead_cadence_id = ?').all(lc.id)
  return { answeredKeys, askedKeys, doneByAttempt: new Map(doneRows.map(r => [r.attempt_id, r])) }
}

function close(db, leadCadenceId) {
  db.prepare("UPDATE lead_cadences SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(leadCadenceId)
}

export function refreshLeadCadence(db, { leadCadenceId, stepsCache = null }) {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(leadCadenceId)
  if (!lc || lc.status !== 'active' || lc.kind !== 'etapa') return lc || null
  const steps = forLead(db, lc.lead_id, stepsOf(db, lc.cadence_id, stepsCache))
  if (!steps.length) return lc // sem passos: fica aberta, sem passo atual (spec 9)
  const { nextAttemptId } = computeNext(steps, ctxFor(db, lc, steps))
  if (nextAttemptId === null) {
    db.prepare(`UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'),
      last_executed_attempt_id = COALESCE(current_attempt_id, last_executed_attempt_id), updated_at = datetime('now') WHERE id = ?`).run(lc.id)
  } else if (nextAttemptId !== lc.current_attempt_id) {
    if (lc.current_attempt_id) {
      // ancora do prazo do proximo passo = agora (mesma regra de tasks.js/scheduler)
      db.prepare(`UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?,
        updated_at = datetime('now') WHERE id = ?`).run(nextAttemptId, lc.current_attempt_id, lc.id)
    } else {
      db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, updated_at = datetime('now') WHERE id = ?").run(nextAttemptId, lc.id)
    }
  }
  return db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(lc.id)
}

export function refreshLeadStageCadence(db, { leadId }) {
  const lc = activeEtapa(db, leadId)
  return lc ? refreshLeadCadence(db, { leadCadenceId: lc.id }) : null
}

export function refreshLeadsOfCadence(db, cadenceId) {
  const rows = db.prepare("SELECT id FROM lead_cadences WHERE cadence_id = ? AND kind = 'etapa' AND status = 'active'").all(cadenceId)
  const stepsCache = new Map() // passos + perguntas orfas calculados uma vez para todos os leads
  for (const r of rows) refreshLeadCadence(db, { leadCadenceId: r.id, stepsCache })
  return rows.length
}

// Abre a cadencia da etapa atual do lead, uma vez por entrada na etapa (decisao D3).
export function ensureStageCadence(db, { leadId, stepsCache = null }) {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
  if (!lead || !lead.stage_id || lead.is_active === 0) return null
  const stage = db.prepare('SELECT id, is_terminal FROM funnel_stages WHERE id = ?').get(lead.stage_id)
  if (!stage || stage.is_terminal) return null
  const cad = db.prepare('SELECT * FROM cadences WHERE stage_id = ? AND is_active = 1 AND account_id = ?').get(stage.id, lead.account_id)
  const active = activeEtapa(db, lead.id)
  if (active && cad && active.cadence_id === cad.id) return refreshLeadCadence(db, { leadCadenceId: active.id, stepsCache })
  if (active) close(db, active.id)
  if (!cad || !db.prepare('SELECT 1 FROM cadence_attempts WHERE cadence_id = ? LIMIT 1').get(cad.id)) return null
  const entry = stageEntryId(db, lead)
  if (db.prepare("SELECT 1 FROM lead_cadences WHERE lead_id = ? AND cadence_id = ? AND kind = 'etapa' AND COALESCE(stage_entry_id, 0) = ?").get(lead.id, cad.id, entry)) return null
  const id = Number(db.prepare("INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, kind, stage_id, stage_entry_id) VALUES (?, ?, NULL, 'etapa', ?, ?)")
    .run(lead.id, cad.id, stage.id, entry).lastInsertRowid)
  return refreshLeadCadence(db, { leadCadenceId: id, stepsCache })
}

// Porta unica da troca de etapa (stageMove) chama aqui: fecha a de etapa e abre a da nova.
// Desfazer o avanco automatico reabre a da etapa de onde o lead saiu (decisao D7).
export function onStageMoved(db, { leadId, trigger }) {
  const active = activeEtapa(db, leadId)
  if (active) close(db, active.id)
  if (trigger === 'roteiro_undo') {
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId)
    // So reabre se a cadencia ainda e a ativa da etapa (gestor pode ter trocado nesse meio tempo).
    const back = lead && db.prepare(`SELECT lc.* FROM lead_cadences lc JOIN cadences c ON c.id = lc.cadence_id
      WHERE lc.lead_id = ? AND lc.kind = 'etapa' AND lc.stage_id = ? AND lc.id <> ? AND c.is_active = 1 AND c.stage_id = lc.stage_id
      ORDER BY lc.id DESC LIMIT 1`).get(leadId, lead.stage_id, active ? active.id : 0)
    if (back) {
      db.prepare("UPDATE lead_cadences SET status = 'active', stage_entry_id = ?, updated_at = datetime('now') WHERE id = ?").run(stageEntryId(db, lead), back.id)
      refreshLeadCadence(db, { leadCadenceId: back.id })
      return
    }
  }
  ensureStageCadence(db, { leadId })
}

export function attachLeadsInStage(db, { accountId, cadenceId }) {
  const cad = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ? AND stage_id IS NOT NULL AND is_active = 1').get(cadenceId, accountId)
  if (!cad) return 0
  const leads = db.prepare('SELECT id FROM leads WHERE account_id = ? AND stage_id = ? AND COALESCE(is_active, 1) = 1 AND COALESCE(is_archived, 0) = 0').all(accountId, cad.stage_id)
  let n = 0
  const stepsCache = new Map() // roteiro publicado lido uma vez, nao uma por lead
  for (const l of leads) {
    ensureStageCadence(db, { leadId: l.id, stepsCache })
    if (db.prepare("SELECT 1 FROM lead_cadences WHERE lead_id = ? AND cadence_id = ? AND kind = 'etapa' AND status = 'active'").get(l.id, cad.id)) n++
  }
  return n
}

export function advanceAvulsa(db, leadCadenceId) {
  const lc = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(leadCadenceId)
  const cur = lc.current_attempt_id ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(lc.current_attempt_id) : null
  const pos = cur ? cur.position : -1
  const next = db.prepare('SELECT * FROM cadence_attempts WHERE cadence_id = ? AND position > ? ORDER BY position LIMIT 1').get(lc.cadence_id, pos) || null
  if (next) {
    db.prepare("UPDATE lead_cadences SET current_attempt_id = ?, last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(next.id, lc.current_attempt_id, lc.id)
  } else {
    db.prepare("UPDATE lead_cadences SET status = 'completed', last_executed_at = datetime('now'), last_executed_attempt_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(lc.current_attempt_id, lc.id)
  }
  return { completed: !next, nextAttempt: next }
}

export function markStepDone(db, { accountId, leadId, attemptId, how = 'feito', userId = null }) {
  if (!DONE_HOWS.includes(how)) throw new CadenceError('invalid', 400, 'Ação inválida.')
  const lead = loadLead(db, accountId, leadId)
  const row = db.prepare(`
    SELECT ca.*, lc.id AS lc_id, lc.kind AS lc_kind, lc.current_attempt_id AS lc_current
    FROM cadence_attempts ca JOIN lead_cadences lc ON lc.cadence_id = ca.cadence_id
    WHERE ca.id = ? AND lc.lead_id = ? AND lc.status = 'active' ORDER BY lc.id DESC LIMIT 1
  `).get(attemptId, lead.id)
  if (!row) throw new CadenceError('step_changed', 409, 'Esse passo mudou. A tela foi atualizada.')
  // Avulsa anda pela posicao: passo que nao e o da vez gravaria sem avancar (tela errada).
  if (row.lc_kind === 'avulsa' && row.lc_current !== row.id) throw new CadenceError('step_changed', 409, 'Esse passo mudou. A tela foi atualizada.')
  if (row.action_type === 'pergunta' && how !== 'pulado') {
    throw new CadenceError('invalid', 400, 'A pergunta fica feita quando tem resposta. Use [Já sei a resposta].')
  }
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO lead_cadence_steps (account_id, lead_cadence_id, lead_id, attempt_id, how, done_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, row.lc_id, lead.id, row.id, how, userId)
    if (row.lc_kind === 'etapa') refreshLeadCadence(db, { leadCadenceId: row.lc_id })
    else if (row.lc_current === row.id) advanceAvulsa(db, row.lc_id)
  })()
  return { lead_cadence_id: row.lc_id, kind: row.lc_kind }
}

// Concluir/Pular pela tela de Tarefas: mesma regra do Chat, com conta conferida.
export function completeCurrentStep(db, { accountId, leadCadenceId, how, userId = null }) {
  const lc = db.prepare('SELECT lc.*, l.account_id, l.attendant_id FROM lead_cadences lc JOIN leads l ON l.id = lc.lead_id WHERE lc.id = ? AND l.account_id = ?')
    .get(leadCadenceId, accountId)
  if (!lc) throw new CadenceError('not_found', 404, 'Tarefa não encontrada.')
  if (lc.status !== 'active') throw new CadenceError('invalid', 400, 'Cadência não está ativa.')
  if (!lc.current_attempt_id) throw new CadenceError('step_changed', 409, 'Esse passo mudou. A tela foi atualizada.')
  markStepDone(db, { accountId, leadId: lc.lead_id, attemptId: lc.current_attempt_id, how, userId })
  const after = db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(lc.id)
  const completed = after.status === 'completed'
  const nextAttempt = !completed && after.current_attempt_id ? db.prepare('SELECT * FROM cadence_attempts WHERE id = ?').get(after.current_attempt_id) : null
  return { completed, nextAttempt, lead: { account_id: lc.account_id, attendant_id: lc.attendant_id } }
}

export function assignAvulsa(db, { accountId, cadenceId, leadId }) {
  const cad = db.prepare('SELECT * FROM cadences WHERE id = ? AND account_id = ? AND is_active = 1').get(cadenceId, accountId)
  if (!cad) throw new CadenceError('not_found', 404, 'Cadência não encontrada.')
  if (cad.stage_id) throw new CadenceError('invalid', 400, 'A cadência da etapa começa sozinha quando o lead entra na etapa.')
  const lead = loadLead(db, accountId, leadId)
  const first = db.prepare('SELECT id FROM cadence_attempts WHERE cadence_id = ? ORDER BY position LIMIT 1').get(cad.id)
  let id
  db.transaction(() => {
    db.prepare("UPDATE lead_cadences SET status = 'paused', updated_at = datetime('now') WHERE lead_id = ? AND status = 'active' AND kind = 'avulsa'").run(lead.id)
    id = Number(db.prepare("INSERT INTO lead_cadences (lead_id, cadence_id, current_attempt_id, kind) VALUES (?, ?, ?, 'avulsa')")
      .run(lead.id, cad.id, first ? first.id : null).lastInsertRowid)
  })()
  return db.prepare('SELECT * FROM lead_cadences WHERE id = ?').get(id)
}

// Formato antigo de GET /cadences/lead/:leadId (Chat, aba Info): passo atual com os dados dele.
export function leadCadenceView(db, leadCadenceId) {
  return db.prepare(`
    SELECT lc.*, c.name as cadence_name, ca.action_type, ca.description as attempt_description, ca.instructions as attempt_instructions,
      ca.auto_message as attempt_message, ca.call_script as attempt_script, ca.position as attempt_position, ca.delay_days,
      ca.scheduled_time, ca.schedule_mode, ca.delay_minutes,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    LEFT JOIN cadences c ON c.id = lc.cadence_id
    LEFT JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    WHERE lc.id = ?
  `).get(leadCadenceId) || null
}

export function getLeadStageCadence(db, { accountId, leadId, role = null }) {
  const lead = loadLead(db, accountId, leadId)
  ensureStageCadence(db, { leadId: lead.id }) // lead novo ou cadencia criada depois
  const stage = lead.stage_id ? db.prepare('SELECT id, name FROM funnel_stages WHERE id = ?').get(lead.stage_id) : null
  const base = {
    lead_id: lead.id,
    stage: stage ? { id: stage.id, name: stage.name } : null,
    deviation: activeDeviationForLead(db, { accountId, lead }),
    can_force: MANAGER_ROLES.includes(role),
  }
  let lc = activeEtapa(db, lead.id)
  if (!lc && lead.stage_id) {
    lc = db.prepare("SELECT * FROM lead_cadences WHERE lead_id = ? AND kind = 'etapa' AND stage_id = ? ORDER BY id DESC LIMIT 1").get(lead.id, lead.stage_id) || null
  }
  if (!lc) return { ...base, lead_cadence: null, steps: [], next_attempt_id: null, done_count: 0, total: 0 }
  const cad = db.prepare('SELECT id, name FROM cadences WHERE id = ?').get(lc.cadence_id)
  const steps = forLead(db, lead.id, stepsOf(db, lc.cadence_id))
  const ctx = ctxFor(db, lc, steps)
  const { states, nextAttemptId, doneCount, total } = computeNext(steps, ctx)
  const roteiro = getLeadRoteiro(db, { accountId, leadId: lead.id })
  const qByKey = new Map(roteiro.stages.flatMap(st => st.questions).map(q => [q.question_key, q]))
  const nameOf = db.prepare('SELECT name FROM users WHERE id = ?')
  return {
    ...base,
    lead_cadence: { id: lc.id, cadence_id: lc.cadence_id, cadence_name: cad ? cad.name : null, status: lc.status, started_at: lc.started_at },
    steps: steps.map((st, i) => {
      const done = ctx.doneByAttempt.get(st.id) || null
      const by = done && done.done_by ? nameOf.get(done.done_by) : null
      return {
        attempt_id: st.id, position: st.position, action_type: st.action_type, description: st.description, instructions: st.instructions,
        auto_message: st.auto_message, call_script: st.call_script, delay_days: st.delay_days, question_key: st.question_key,
        state: states[i].state, how: states[i].how, done_at: done ? done.done_at : null, done_by_name: by ? by.name : null,
        orphan: st.orphan, not_applicable: !!st.not_applicable, question: st.question_key ? (qByKey.get(st.question_key) || null) : null,
      }
    }),
    next_attempt_id: lc.status === 'active' ? nextAttemptId : null,
    done_count: doneCount,
    total,
  }
}

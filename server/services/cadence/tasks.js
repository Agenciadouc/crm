// Tarefas de cadencia (tela de Tarefas, contador do menu e aviso task:due do agendador).
// Avulsa: todo passo e tarefa (jeito antigo). Etapa: so passo COM DATA que nao e pergunta
// (ex.: "Ligação dia 2"); pergunta e passo imediato ficam so no "Próximo passo" do Chat.
// Recebe db (nao importa server/db.js).

// Calculate due datetime for a cadence attempt.
// Anchor: last_executed_at (when previous step was completed) OR started_at (for step 1).
// Mode 'duration': anchor + delay_minutes
// Mode 'date': anchor + delay_days at scheduled_time (clock time)
export function computeDueDatetime({ startedAt, lastExecutedAt, delay_days, scheduled_time, schedule_mode, delay_minutes }) {
  const anchorIso = lastExecutedAt || startedAt
  const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')

  if (schedule_mode === 'duration') {
    return new Date(anchor.getTime() + (delay_minutes || 0) * 60000)
  }

  // Date mode (default)
  const due = new Date(anchor)
  due.setDate(due.getDate() + (delay_days || 0))
  if (scheduled_time) {
    const [h, m] = scheduled_time.split(':').map(Number)
    due.setHours(h || 0, m || 0, 0, 0)
  } else if ((delay_days || 0) > 0) {
    due.setHours(0, 0, 0, 0)
  }
  return due
}

// Mesma regra de isTaskStep, em SQL (lc = lead_cadences, ca = cadence_attempts)
export const TASK_STEP_SQL = `(COALESCE(lc.kind, 'avulsa') <> 'etapa' OR (ca.action_type <> 'pergunta' AND (
  COALESCE(ca.delay_days, 0) > 0
  OR (ca.schedule_mode = 'duration' AND COALESCE(ca.delay_minutes, 0) > 0)
  OR COALESCE(ca.scheduled_time, '') <> '')))`

export function isTaskStep(kind, step) {
  if ((kind || 'avulsa') !== 'etapa') return true
  if (!step || step.action_type === 'pergunta') return false
  return (step.delay_days || 0) > 0
    || (step.schedule_mode === 'duration' && (step.delay_minutes || 0) > 0)
    || !!step.scheduled_time
}

function bucketOf(due, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const dayAfterTomorrow = new Date(today); dayAfterTomorrow.setDate(today.getDate() + 2)
  const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7)
  if (due < today) return 'overdue'
  if (due < tomorrow) return 'today'
  if (due < dayAfterTomorrow) return 'tomorrow'
  if (due < weekEnd) return 'week'
  return 'later'
}

// Passos ativos com o prazo calculado (lc.started_at/last_executed_at + dia/horario).
// Atendente ve so os leads dele; gestor ve a conta toda.
export function listCadenceTasks(db, { accountId, userId, role, now = new Date() }) {
  let attendantFilter = ''
  const params = [accountId]
  if (role === 'atendente') {
    attendantFilter = 'AND l.attendant_id = ?'
    params.push(userId)
  }
  const rows = db.prepare(`
    SELECT
      lc.id as lead_cadence_id, lc.lead_id, lc.cadence_id, lc.current_attempt_id, lc.status, lc.kind,
      lc.last_executed_at, lc.started_at,
      l.name as lead_name, l.phone as lead_phone, l.empresa as lead_empresa, l.city as lead_city, l.profile_pic_url,
      l.created_at as lead_created_at, l.stage_id, l.attendant_id,
      u.name as attendant_name, fs.name as stage_name, fs.color as stage_color, c.name as cadence_name,
      ca.position as attempt_position, ca.action_type, ca.description as attempt_description, ca.instructions as attempt_instructions,
      ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes, ca.auto_message, ca.call_script,
      (SELECT COUNT(*) FROM cadence_attempts WHERE cadence_id = lc.cadence_id) as total_attempts
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    LEFT JOIN users u ON u.id = l.attendant_id
    LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
    JOIN cadences c ON c.id = lc.cadence_id
    WHERE lc.status = 'active' AND l.is_active = 1 AND l.account_id = ? AND ${TASK_STEP_SQL}
    ${attendantFilter}
    ORDER BY l.created_at ASC
  `).all(...params)

  return rows.map(r => {
    const due = computeDueDatetime({
      startedAt: r.started_at, lastExecutedAt: r.last_executed_at, delay_days: r.delay_days,
      scheduled_time: r.scheduled_time, schedule_mode: r.schedule_mode, delay_minutes: r.delay_minutes,
    })
    return { ...r, due_datetime: due.toISOString(), bucket: bucketOf(due, now) }
  })
}

// Agendador (1x por minuto): passos que venceram e ainda nao foram avisados. Grava o passo
// avisado em notified_attempt_id: cada (cadencia do lead, passo) avisa task:due UMA vez.
export function collectDueCadenceTasks(db, now = new Date()) {
  const active = db.prepare(`
    SELECT lc.id, lc.lead_id, lc.current_attempt_id, lc.last_executed_attempt_id, lc.last_executed_at, lc.started_at,
      lc.notified_attempt_id, ca.delay_days, ca.scheduled_time, ca.schedule_mode, ca.delay_minutes, ca.action_type, l.account_id
    FROM lead_cadences lc
    JOIN cadence_attempts ca ON ca.id = lc.current_attempt_id
    JOIN leads l ON l.id = lc.lead_id
    WHERE lc.status = 'active' AND l.is_active = 1 AND ${TASK_STEP_SQL}
      AND (lc.notified_attempt_id IS NULL OR lc.notified_attempt_id <> lc.current_attempt_id)
  `).all()

  const mark = db.prepare('UPDATE lead_cadences SET notified_attempt_id = ? WHERE id = ?')
  const due = []
  for (const row of active) {
    // Ancora do passo atual: fim do passo anterior (last_executed_at) ou inicio (1o passo)
    const anchorIso = row.last_executed_attempt_id && row.last_executed_at ? row.last_executed_at : row.started_at
    const anchor = new Date(anchorIso.replace(' ', 'T') + 'Z')
    let target
    if (row.schedule_mode === 'duration') {
      target = new Date(anchor.getTime() + (row.delay_minutes || 0) * 60000)
    } else {
      target = new Date(anchor)
      target.setDate(target.getDate() + (row.delay_days || 0))
      if (row.scheduled_time) {
        const [h, m] = row.scheduled_time.split(':').map(Number)
        target.setUTCHours((h || 0) + 3, m || 0, 0, 0) // America/Sao_Paulo UTC-3
      } else if ((row.delay_days || 0) > 0) {
        target.setUTCHours(3, 0, 0, 0) // meia-noite local = 03:00 UTC
      }
    }
    if (now < target) continue
    if (row.last_executed_attempt_id === row.current_attempt_id) continue
    mark.run(row.current_attempt_id, row.id)
    due.push({ lead_cadence_id: row.id, lead_id: row.lead_id, account_id: row.account_id, attempt_id: row.current_attempt_id, action_type: row.action_type })
  }
  return due
}

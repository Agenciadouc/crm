// Logica pura da tela "Cadencia da etapa" (spec 2026-09-27 §5.1). JS puro com .d.ts ao lado:
// roda no node --test e e importado pelo front.

export const STEP_TYPES = [
  { value: 'pergunta', label: 'Pergunta' }, { value: 'mensagem', label: 'Mensagem' }, { value: 'ligacao', label: 'Ligação' },
  { value: 'visita', label: 'Visita' }, { value: 'reuniao', label: 'Reunião' }, { value: 'email', label: 'E-mail' },
  { value: 'whatsapp', label: 'WhatsApp' },
]
const LABELS = Object.fromEntries(STEP_TYPES.map(t => [t.value, t.label]))
export const stepLabel = type => LABELS[type] || type

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export function stageChipLabel(stage) {
  const { steps, questions } = stage.summary || { steps: 0, questions: 0 }
  if (!steps) return `${stage.name} · sem passos`
  return [stage.name, plural(steps, 'passo', 'passos'), questions ? plural(questions, 'pergunta', 'perguntas') : null].filter(Boolean).join(' · ')
}

// Porque dos numeros do chip (regra "todo numero com o porque")
export function stageChipTitle(stage) {
  const { steps, questions } = stage.summary || { steps: 0, questions: 0 }
  if (!steps) return 'Nenhum passo ainda. Clique para montar a cadência desta etapa.'
  const q = !questions ? 'nenhum é pergunta do roteiro' : questions === 1 ? '1 é pergunta do roteiro' : `${questions} são perguntas do roteiro`
  return `${plural(steps, 'passo que o vendedor segue', 'passos que o vendedor segue')} nesta etapa, na ordem; ${q}.`
}

// Resumo do chip depois de salvar um passo (sem recarregar a tela toda)
export function stageSummary(cadence) {
  const attempts = (cadence && cadence.attempts) || []
  return { steps: attempts.length, questions: attempts.filter(a => a.action_type === 'pergunta').length }
}

function cut(text, max) {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

export function stepShortText(step, max = 60) {
  let text = ''
  if (step.action_type === 'pergunta') text = (step.question && step.question.text) || step.description
  else if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') text = step.auto_message || step.description
  else text = step.description || step.instructions
  return cut(text || stepLabel(step.action_type), max)
}

export function stepDayText(step) {
  if (step.schedule_mode === 'duration') {
    const m = step.delay_minutes || 0
    if (m < 60) return `+${m} min`
    const h = Math.floor(m / 60)
    const rest = m % 60
    return rest ? `+${h}h${String(rest).padStart(2, '0')}` : `+${h}h`
  }
  const d = step.delay_days || 0
  if (!d) return 'mesmo dia'
  return d === 1 ? '+1 dia' : `+${d} dias`
}

export function metricBadge(m) {
  if (!m) return null
  if (m.kind === 'feitas') return { text: `feitas ${m.done} de ${m.reached} leads`, tone: 'muted' }
  if (!m.sent) return { text: 'sem envios ainda', tone: 'muted' }
  const rate = `respondem ${Math.round(m.reply_rate || 0)}%`
  if (m.status === 'amostra_pequena') return { text: `${rate} · poucos envios`, tone: 'muted' }
  if (m.status === 'fraca') return { text: `${rate} · fraca`, tone: 'bad' }
  return { text: rate, tone: 'good' }
}

export function metricWhy(m, { windowH, minRate }) {
  if (!m) return ''
  if (m.kind === 'feitas') return `Dos ${m.reached} leads que entraram nesta cadência nos últimos 90 dias, ${m.done} tiveram este passo marcado como feito.`
  if (!m.sent) return 'Ainda ninguém enviou este passo pelo botão do Chat nos últimos 90 dias.'
  const base = `De ${m.sent} envios nos últimos 90 dias, ${Math.round(m.reply_rate || 0)}% tiveram resposta em até ${windowH}h.`
  if (m.status === 'amostra_pequena') return `${base} Com menos de 20 envios ainda é cedo para julgar.`
  return `${base} Abaixo de ${minRate}% conta como fraca.`
}

export function moveStep(ids, id, dir) {
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids.slice()
  const out = ids.slice()
  out[i] = ids[j]
  out[j] = id
  return out
}

export function dropStep(ids, dragId, overId) {
  if (dragId === overId) return ids.slice()
  const from = ids.indexOf(dragId)
  const to = ids.indexOf(overId)
  if (from < 0 || to < 0) return ids.slice()
  const out = ids.filter(x => x !== dragId)
  const at = out.indexOf(overId)
  out.splice(from < to ? at + 1 : at, 0, dragId)
  return out
}

// Fases SPIN da pergunta (spec 2026-10-02 §1): valor da API + rotulo da tela.
export const SPIN_OPTIONS = [
  { value: 'situation', label: 'Como faz hoje' },
  { value: 'problem', label: 'O que incomoda' },
  { value: 'implication', label: 'O que isso custa' },
  { value: 'need_payoff', label: 'O que ganha resolvendo' },
]

export function formFromStep(step) {
  const q = step.question || null
  return {
    text: q ? q.text : '',
    required: q ? !!q.required : false,
    kind: q ? q.kind : 'text',
    options: q ? (q.options || []).map(o => ({ option_key: o.option_key, label: o.label, points: String(o.points), sets_profile_key: o.sets_profile_key ?? null })) : [],
    spin: q ? (q.spin ?? null) : null,
    profile_key: q ? (q.profile_key ?? null) : null,
    ai_hint: q && q.ai_hint ? q.ai_hint : '',
    auto_message: step.auto_message || '',
    description: step.description || '',
    instructions: step.instructions || '',
    call_script: step.call_script || '',
    delay_days: step.delay_days || 0,
  }
}

const orNull = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// Monta o PATCH do passo; pergunta so vai quando esta valida (senao o servidor recusaria
// e o gestor veria "Nao salvou" a cada tecla). option_key das opcoes que ja existiam vai
// sempre junto, para as respostas antigas continuarem casando.
const DAY_REASON = 'Coloque o dia: 0 ou mais (ex.: 0 = no mesmo dia).'

export function stepPatchFor(type, form) {
  // Dia vazio nao vira 0 escondido: so salva quando o campo tem um numero inteiro >= 0
  const dayText = String(form.delay_days == null ? '' : form.delay_days).trim()
  if (!/^\d+$/.test(dayText)) return { ok: false, reason: DAY_REASON }
  const delay = parseInt(dayText, 10)
  if (type === 'pergunta') {
    const text = String(form.text || '').trim()
    if (!text) return { ok: false, reason: 'Escreva a pergunta.' }
    let options = []
    if (form.kind === 'options') {
      const filled = (form.options || []).filter(o => String(o.label || '').trim())
      if (filled.length < 2) return { ok: false, reason: 'Coloque pelo menos 2 opções (ex.: "Até 30 dias" e "Mais de 30 dias").' }
      if (filled.length > 10) return { ok: false, reason: 'No máximo 10 opções.' }
      options = []
      for (let i = 0; i < filled.length; i++) {
        const o = filled[i]
        const points = Number(String(o.points).trim() === '' ? 0 : o.points)
        if (!Number.isInteger(points) || points < -50 || points > 50) return { ok: false, reason: 'Os pontos vão de -50 a 50 (ex.: 15).' }
        options.push({ ...(o.option_key ? { option_key: o.option_key } : {}), label: o.label.trim(), points, position: i, ...(o.sets_profile_key ? { sets_profile_key: o.sets_profile_key } : {}) })
      }
    }
    return {
      ok: true,
      patch: { delay_days: delay, question: { text, kind: form.kind, required: !!form.required, spin: form.spin || null, profile_key: form.profile_key || null, ai_hint: orNull(form.ai_hint), options } },
    }
  }
  if (type === 'mensagem' || type === 'whatsapp') return { ok: true, patch: { auto_message: orNull(form.auto_message), delay_days: delay } }
  return { ok: true, patch: { description: orNull(form.description), instructions: orNull(form.instructions), call_script: orNull(form.call_script), delay_days: delay } }
}

// Salvar automatico (spec 4.3): manda 500 ms depois da ultima mudanca; nunca dois envios ao
// mesmo tempo; o ultimo texto vence; erro guarda o texto para [Tentar de novo].
export function createSaveQueue({ save, delayMs = 500, onStatus = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let latest
  let hasLatest = false
  let inFlight = false
  let lastFailed
  let hasFailed = false
  const status = s => { try { onStatus(s) } catch { /* tela ja saiu */ } }

  function run() {
    timer = null
    if (!hasLatest || inFlight) return Promise.resolve()
    const payload = latest
    hasLatest = false
    inFlight = true
    status('salvando')
    // save chamado na hora (sincrono): o proximo push ja ve o envio no ar
    let pending
    try { pending = Promise.resolve(save(payload)) } catch (e) { pending = Promise.reject(e) }
    return pending.then(
      () => { inFlight = false; hasFailed = false; if (hasLatest) return run(); status('salvo') },
      () => { inFlight = false; if (hasLatest) return run(); lastFailed = payload; hasFailed = true; status('erro') },
    )
  }
  function push(payload) {
    latest = payload
    hasLatest = true
    hasFailed = false
    status('pendente')
    if (timer) clearTimer(timer)
    timer = setTimer(run, delayMs)
  }
  function flush() {
    if (timer) { clearTimer(timer); timer = null }
    return run()
  }
  function retry() {
    if (hasFailed && !hasLatest) { latest = lastFailed; hasLatest = true; hasFailed = false }
    return flush()
  }
  const busy = () => inFlight || hasLatest
  return { push, flush, retry, busy }
}

export function saveStatusLabel(status) {
  if (status === 'salvando') return 'Salvando…'
  if (status === 'salvo') return 'Salvo'
  if (status === 'erro') return 'Não salvou.'
  return ''
}

export const readyDeviations = list => (list || []).filter(d => String(d.triggers || '').trim() && String(d.reply_text || '').trim())

export function suggestionsForStep(suggestions, step) {
  if (!step || !step.question_key) return []
  return (suggestions || []).filter(s => s.question_key === step.question_key && s.type !== 'reorder' && s.type !== 'new_deviation')
}
export const stageSuggestions = (suggestions, stageId) => (suggestions || []).filter(s => s.type === 'reorder' && s.payload && Number(s.payload.stage_id) === Number(stageId))
export const deviationSuggestions = (suggestions, funnelId) => (suggestions || []).filter(s => s.type === 'new_deviation' && (s.funnel_id == null || Number(s.funnel_id) === Number(funnelId)))
export function testForStep(tests, step) {
  if (!step || !step.question_key) return null
  return (tests || []).find(t => t.question_key === step.question_key && (t.status === 'testing' || !t.decided)) || null
}

export function stageFromSearch(search, stages) {
  const want = Number(new URLSearchParams(search || '').get('etapa'))
  const open = (stages || []).filter(s => !s.is_terminal)
  const hit = open.find(s => s.id === want)
  return hit ? hit.id : (open[0] ? open[0].id : null)
}

// SSE cadence:updated tem 2 formatos: { cadence_id, stage_id } (passos) e { funnel_id } (desvios).
// So recarrega quando o aviso e do funil aberto ou de uma etapa dele.
export function sseTouchesView(data, funnelId, stageIds) {
  if (!data) return false
  if (data.funnel_id != null) return Number(data.funnel_id) === Number(funnelId)
  if (data.stage_id != null) return (stageIds || []).some(id => Number(id) === Number(data.stage_id))
  return false
}

// Sugestoes da revisao semanal (spec 2026-10-02 §10)
export const newQuestionSuggestions = (suggestions, stageId) => (suggestions || []).filter(s => s.type === 'new_question' && s.payload && Number(s.payload.stage_id) === Number(stageId))
export const newProfileSuggestions = suggestions => (suggestions || []).filter(s => s.type === 'new_profile')

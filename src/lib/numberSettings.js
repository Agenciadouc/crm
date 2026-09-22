// Regras puras das "Mensagens do numero" (Integracoes > WhatsApp > Mensagens do numero).
// JS puro com .d.ts ao lado: roda no `node --test` sem compilar TypeScript e e importado pelo front.
//
// Primeira mensagem: um texto por numero. Fica em whatsapp_instances.first_msg_template (quando vale
// para lead de formulario/planilha entregue a vendedor deste numero) e SEMPRE em
// instance_auto_messages.greeting_text (greeting_enabled = lead novo que manda a primeira mensagem).
// Horario: um por numero. Vai para away_schedule_json e, com "segurar envios", para business_hours_json.

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export const DAY_LABELS = {
  mon: 'Segunda', tue: 'Terça', wed: 'Quarta', thu: 'Quinta', fri: 'Sexta', sat: 'Sábado', sun: 'Domingo',
}

export function defaultSchedule() {
  const weekday = () => [{ start: '09:00', end: '18:00' }]
  return { mon: weekday(), tue: weekday(), wed: weekday(), thu: weekday(), fri: weekday(), sat: [], sun: [] }
}

function clean(s) {
  return typeof s === 'string' ? s.trim() : ''
}

export function resolveFirstMessage(input = {}) {
  const assignText = clean(input.first_msg_template)
  const inboundText = clean(input.greeting_text)
  return {
    text: assignText || inboundText,
    onAssign: !!assignText,
    onInbound: !!input.greeting_enabled && !!inboundText,
    conflict: assignText && inboundText && assignText !== inboundText ? { otherText: inboundText } : null,
  }
}

export function buildFirstMessageSave(state) {
  const text = clean(state.text)
  return {
    first_msg_template: state.onAssign && text ? text : null,
    greeting_text: text || null,
    greeting_enabled: state.onInbound && text ? 1 : 0,
  }
}

function normalizeSchedule(raw) {
  const out = {}
  for (const day of DAY_KEYS) {
    const slots = raw && Array.isArray(raw[day]) ? raw[day] : []
    out[day] = slots
      .filter(s => s && typeof s.start === 'string' && typeof s.end === 'string' && s.start && s.end)
      .map(s => ({ start: s.start, end: s.end }))
  }
  return out
}

function parseSchedule(json) {
  if (!json || typeof json !== 'string') return null
  try {
    const raw = JSON.parse(json)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return normalizeSchedule(raw)
  } catch {
    return null
  }
}

export function resolveServiceHours(input = {}) {
  const away = parseSchedule(input.away_schedule_json)
  const business = parseSchedule(input.business_hours_json)
  return {
    schedule: away || business || defaultSchedule(),
    holdSends: !!business,
    conflict: !!(away && business && JSON.stringify(away) !== JSON.stringify(business)),
  }
}

export function buildServiceHoursSave(schedule, holdSends) {
  return {
    away_schedule_json: JSON.stringify(normalizeSchedule(schedule)),
    hold_sends_outside_hours: !!holdSends,
  }
}

// Segurar envios com a semana toda "Fechado" gravaria business_hours_json vazio e pararia,
// em silencio, follow-ups, disparos, cadencias, a primeira mensagem do handoff e as respostas
// do agente de IA. A tela barra antes de salvar (o servidor recusa igual, por seguranca).
export const HOLD_WITHOUT_HOURS_MSG = 'Para segurar os envios fora do horário, preencha pelo menos uma faixa de horário: a semana inteira está como Fechado.'

export function holdSendsError(schedule, holdSends) {
  if (!holdSends) return null
  const normalized = normalizeSchedule(schedule)
  const hasSlot = DAY_KEYS.some(day => normalized[day].length > 0)
  return hasSlot ? null : HOLD_WITHOUT_HOURS_MSG
}

export function scheduleErrors(schedule) {
  const errors = []
  for (const day of DAY_KEYS) {
    const slots = (schedule && schedule[day]) || []
    for (const s of slots) {
      if (!s.start || !s.end) errors.push(`${DAY_LABELS[day]}: preencha o início e o fim do horário.`)
      else if (s.start >= s.end) errors.push(`${DAY_LABELS[day]}: o horário ${s.start}–${s.end} termina antes de começar.`)
    }
  }
  return errors
}

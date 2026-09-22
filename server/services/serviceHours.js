// Horario de atendimento unico por numero (tela Integracoes > WhatsApp > Mensagens do numero).
// A tela grava o horario na ausencia (instance_auto_messages.away_schedule_json) e, se pedido,
// tambem na trava anti-bloqueio (whatsapp_instances.business_hours_json, lida pelo sender.js).
// Sem hold_sends_outside_hours no corpo, a trava fica como esta (compatibilidade).

// A trava so pode ser ligada com pelo menos UMA faixa de horario na semana: um
// business_hours_json com a semana toda vazia faz isInBusinessHours (sender.js) dar
// sempre false e para, em silencio, follow-ups, disparos, cadencias, a primeira
// mensagem do handoff e as respostas do agente de IA.
function hasAnySlot(scheduleStr) {
  let raw
  try {
    raw = JSON.parse(scheduleStr)
  } catch {
    return false
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  return Object.values(raw).some(slots =>
    Array.isArray(slots) && slots.some(s => s && s.start && s.end)
  )
}

export function businessHoursUpdate(body, scheduleStr) {
  if (!body || body.hold_sends_outside_hours === undefined) return { touch: false, value: null }
  if (!body.hold_sends_outside_hours) return { touch: true, value: null }
  if (!scheduleStr || !hasAnySlot(scheduleStr)) {
    return { touch: false, value: null, error: 'Para segurar os envios fora do horário, preencha o horário de atendimento.' }
  }
  return { touch: true, value: scheduleStr }
}

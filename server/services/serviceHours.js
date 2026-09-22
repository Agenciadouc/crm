// Horario de atendimento unico por numero (tela Integracoes > WhatsApp > Mensagens do numero).
// A tela grava o horario na ausencia (instance_auto_messages.away_schedule_json) e, se pedido,
// tambem na trava anti-bloqueio (whatsapp_instances.business_hours_json, lida pelo sender.js).
// Sem hold_sends_outside_hours no corpo, a trava fica como esta (compatibilidade).
export function businessHoursUpdate(body, scheduleStr) {
  if (!body || body.hold_sends_outside_hours === undefined) return { touch: false, value: null }
  if (!body.hold_sends_outside_hours) return { touch: true, value: null }
  if (!scheduleStr) {
    return { touch: false, value: null, error: 'Para segurar os envios fora do horário, preencha o horário de atendimento.' }
  }
  return { touch: true, value: scheduleStr }
}

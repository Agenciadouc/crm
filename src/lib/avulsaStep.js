import { stepTypeLabel } from './nextStep.js'

// Logica pura do bloco "Cadencia avulsa" da aba Atendimento (ajuste 28/09). JS puro com .d.ts.

const MESSAGE_TYPES = ['mensagem', 'whatsapp']
const str = v => String(v == null ? '' : v).trim()

// "Passo 1 de 2 · Mensagem"
export function avulsaStepLabel(lc) {
  if (!lc) return ''
  const base = `Passo ${(lc.attempt_position ?? 0) + 1} de ${lc.total_attempts ?? 0}`
  return lc.action_type ? `${base} · ${stepTypeLabel(lc.action_type)}` : base
}

// O que o bloco mostra e quais botoes aparecem no passo da vez.
// fill = troca das variaveis (a mesma do envio da cadencia da etapa).
export function avulsaStepView(lc, fill = t => t) {
  if (!lc) return null
  const t = lc.action_type
  if (MESSAGE_TYPES.includes(t)) {
    const text = str(lc.attempt_message) ? str(fill(String(lc.attempt_message))) : ''
    if (text) return { kind: 'mensagem', text, actions: ['enviar', 'pular'] }
    // Passo sem texto: nada para enviar; o vendedor marca como feito
    return { kind: 'mensagem', text: str(lc.attempt_description) || str(lc.attempt_instructions), actions: ['feito', 'pular'] }
  }
  if (t === 'ligacao') {
    return { kind: 'ligacao', text: str(lc.attempt_script) || str(lc.attempt_description) || str(lc.attempt_instructions), actions: ['roteiro', 'pular'] }
  }
  const text = str(lc.attempt_description) || str(lc.attempt_instructions)
  // Pergunta so fica feita com resposta: na avulsa o servidor so aceita pular
  if (t === 'pergunta') return { kind: 'outro', text, actions: ['pular'] }
  return { kind: 'outro', text, actions: ['feito', 'pular'] }
}

// "N de M" do titulo da janela Conferir mensagem
export function avulsaReviewPos(lc) {
  if (!lc || !lc.total_attempts) return null
  return { n: (lc.attempt_position ?? 0) + 1, m: lc.total_attempts }
}

// Link de ligar: so os digitos (mantem o + do DDI)
export function telHref(phone) {
  const raw = str(phone)
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`
}

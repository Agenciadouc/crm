// Logica pura do cartao "Proximo passo" do Chat (spec 2026-09-27 §5.3). JS puro com .d.ts.
const LABELS = { pergunta: 'Pergunta', mensagem: 'Mensagem', whatsapp: 'WhatsApp', ligacao: 'Ligação', email: 'E-mail', reuniao: 'Reunião', visita: 'Visita' }
export const stepTypeLabel = t => LABELS[t] || t

function cut(text, max) {
  const t = String(text || '').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

// Pergunta orfa (saiu do roteiro) ou de outro perfil de cliente (not_applicable) sem resposta
// nao trava: fica fora do proximo e do "Depois"
const skipped = s => !!(s.orphan || s.not_applicable) && s.state !== 'feito'

export function splitSteps(data) {
  const steps = (data && data.steps) || []
  const found = steps.find(s => s.attempt_id === (data && data.next_attempt_id)) || null
  const next = found && !skipped(found) ? found : null
  const idx = next ? steps.indexOf(next) : -1
  const after = idx >= 0 ? steps.slice(idx + 1).filter(s => s.state !== 'feito' && !skipped(s)).slice(0, 2) : []
  const done = steps.filter(s => s.state === 'feito')
  return { next, after, done }
}

export function stepTitle(step) {
  if (step.action_type === 'pergunta') return (step.question && step.question.text_for_lead) || step.description || 'Pergunta'
  if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') return step.auto_message || step.description || stepTypeLabel(step.action_type)
  return step.description || step.instructions || stepTypeLabel(step.action_type)
}

export function afterLine(after) {
  if (!after || !after.length) return ''
  return `Depois: ${after.map(s => `${stepTypeLabel(s.action_type)}: ${cut(stepTitle(s), 40)}`).join(' · ')}`
}

export function nextActions(step) {
  if (!step) return []
  if (step.action_type === 'pergunta') return step.state === 'aguardando' ? ['ja_sei'] : ['perguntar', 'ja_sei']
  if (step.action_type === 'mensagem' || step.action_type === 'whatsapp') return stepSendText(step) ? ['enviar', 'feito'] : ['feito']
  return ['feito']
}

export function doneText(step) {
  if (step.how === 'pulado') return 'Pulado'
  if (step.action_type === 'pergunta') {
    const a = step.question && step.question.answer
    return a ? (a.option_label || a.answer_text || '') : ''
  }
  if (step.how === 'enviado') return 'Enviada'
  return 'Feito'
}

export function doneOrigin(step) {
  const a = step.action_type === 'pergunta' && step.question && step.question.answer
  if (!a || step.how === 'pulado') return null
  return a.origin === 'ia' ? 'ia' : 'vendedor'
}

export function deviationLine(deviation) {
  const subject = String((deviation && deviation.triggers) || '').split(',')[0].trim()
  return subject ? `Ele perguntou de ${subject}` : 'Ele saiu do roteiro'
}

// Texto que o [Enviar] do passo mensagem poe na caixa (vazio = passo sem texto: sem [Enviar])
export function stepSendText(step) {
  if (!step) return ''
  const msg = String(step.auto_message || '').trim()
  return msg || String(step.description || '').trim()
}

// cadence:updated leva account_id; tela de admin recebe o aviso de todas as contas.
// Aviso sem conta (formato antigo) recarrega.
export function cadenceEventForAccount(data, accountId) {
  if (!data || data.account_id == null) return true
  return Number(data.account_id) === Number(accountId)
}

// Uma recarga silenciosa para varios avisos seguidos (um timer so para todos os eventos).
// doneBefore: retrato dos passos feitos ANTES do 1o aviso da IA (fica o primeiro).
export function createReloadDebouncer({ delayMs = 600, run, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  let pendingDone
  return {
    schedule(doneBefore) {
      if (doneBefore && !pendingDone) pendingDone = doneBefore
      if (timer) clearTimer(timer)
      timer = setTimer(() => {
        timer = null
        const d = pendingDone
        pendingDone = undefined
        run(d)
      }, delayMs)
    },
    cancel() {
      if (timer) clearTimer(timer)
      timer = null
      pendingDone = undefined
    },
  }
}

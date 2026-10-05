import { parseSqlDate } from './sqlDate.js'

// Logica pura da aba Atendimento do Chat e da janela "Conferir mensagem" (ajuste 28/09). JS puro com .d.ts.

// Mesma conta do servidor (services/cadence/nextStep.js): pergunta orfa ou de outro perfil
// (not_applicable) sem resposta nao entra no total
const counted = s => !((s.orphan || s.not_applicable) && s.state !== 'feito')

// "N de M" do passo na cadencia da etapa (por attempt_id ou, na pergunta, pela question_key)
export function reviewPosition(data, { attemptId, questionKey } = {}) {
  const steps = ((data && data.steps) || []).filter(counted)
  if (attemptId == null && !questionKey) return null
  const idx = steps.findIndex(s => (attemptId != null ? s.attempt_id === attemptId : s.question_key === questionKey))
  return idx >= 0 ? { n: idx + 1, m: steps.length } : null
}

export function reviewTitle(kind, pos) {
  const label = kind === 'pergunta' ? 'Pergunta' : 'Mensagem'
  return `Conferir mensagem — ${label}${pos ? ` ${pos.n} de ${pos.m}` : ''}`
}

// Passo vindo da ficha/Pipeline: pergunta (question_key) ou mensagem (attempt_id) abre a janela.
// Texto sem passo (ex.: [Usar] de um desvio) volta null: continua indo para a caixa.
export function reviewFromPendingAsk(p) {
  if (!p || !String(p.text || '').trim()) return null
  if (p.questionKey) return { leadId: p.leadId, kind: 'pergunta', text: p.text, questionKey: p.questionKey, attemptId: p.attemptId ?? null }
  if (p.attemptId) return { leadId: p.leadId, kind: 'mensagem', text: p.text, questionKey: null, attemptId: p.attemptId }
  return null
}

// Pergunta vai como roteiro_question_key; mensagem vai como cadence_attempt_id
export function reviewSendKeys(review) {
  return review.kind === 'pergunta'
    ? { askKey: review.questionKey || null, stepKey: null }
    : { askKey: null, stepKey: review.attemptId ?? null }
}

// Uma troca de variaveis so: o texto da mensagem ja abre trocado; no envio so troca se o vendedor
// mexeu/escreveu na janela (ex.: digitou {{primeiro_nome}}). Pergunta vai como esta.
export function reviewTextToSend(review, text, fill) {
  if (!review || review.kind !== 'mensagem' || text === review.text) return text
  return fill(text)
}

export function canSendReview({ text, hasInstance, sending }) {
  return !!String(text || '').trim() && !!hasInstance && !sending
}

// A janela ja enviou com a chave: se a caixa tinha a mesma chave, ela sai (senao contaria duas vezes)
export function boxKeysAfterReviewSend(box, sent) {
  return {
    askKey: box.askKey && box.askKey === sent.askKey ? null : box.askKey,
    stepKey: box.stepKey != null && box.stepKey === sent.stepKey ? null : box.stepKey,
  }
}

// Barra "Voce perguntou X?": so quando o envio nao levou a pergunta do roteiro
export function offerRecognition(askKey, result) {
  return !askKey && !!(result && result.recognized_question) && !!(result && result.message && result.message.id)
}

// Tarefas pendentes do lead aberto (avulsas + passo de cadencia que virou tarefa), por prazo
export function leadTaskRows(tasks, leadId, nowMs = Date.now()) {
  return (tasks || [])
    .filter(t => t.lead_id == null || Number(t.lead_id) === Number(leadId))
    .map(t => {
      const isCadence = t.type === 'cadence'
      const due = parseSqlDate(t.due_datetime)
      const rawDesc = isCadence ? (t.attempt_description || t.auto_message) : t.description
      const desc = rawDesc ? (rawDesc.length > 100 ? `${rawDesc.substring(0, 100)}...` : rawDesc) : ''
      return {
        key: isCadence ? `c-${t.lead_cadence_id}` : `s-${t.id}`,
        isCadence,
        title: isCadence ? `${t.cadence_name} · Etapa ${(t.attempt_position || 0) + 1}/${t.total_attempts}` : t.title,
        desc,
        due,
        overdue: due.getTime() < nowMs,
        task: t,
      }
    })
    .sort((a, b) => (a.due.getTime() || 0) - (b.due.getTime() || 0))
}

// Tarefas do Chat: so as manuais. O passo de cadencia (etapa ou avulsa) ja aparece no bloco Cadencia.
export function manualTaskRows(tasks, leadId, nowMs = Date.now()) {
  return leadTaskRows((tasks || []).filter(t => t.type !== 'cadence'), leadId, nowMs)
}

// Quem atende o lead: vendedor so ve o nome; gerente/admin troca (mesma permissao da aba Info de antes)
export function attendantView({ role, attendantId, attendants, fallbackName }) {
  const found = attendantId != null ? (attendants || []).find(a => a.id === attendantId) : null
  const name = found ? found.name : attendantId != null ? (fallbackName || 'Atendente') : 'Sem atendente'
  return { canChange: role !== 'atendente', name }
}

export function sectionTitle(label, n) {
  return `${label} (${n || 0})`
}

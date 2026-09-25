// Teste A/B de perguntas do roteiro (spec 6.5). Nao importa server/db.js: recebe db.
import crypto from 'node:crypto'

// Sorteio fixo por lead+pergunta: sempre o mesmo resultado para o mesmo par.
export function variantFor(leadId, questionKey) {
  const hash = crypto.createHash('sha1').update(`${leadId}:${questionKey}`).digest()
  return hash[0] % 2 ? 'B' : 'A'
}

// Teste ativo (status 'testing') para a pergunta, ou null se nao ha teste rodando.
export function activeVariant(db, accountId, questionKey) {
  return db.prepare("SELECT * FROM roteiro_variants WHERE account_id = ? AND question_key = ? AND status = 'testing'")
    .get(accountId, questionKey) || null
}

function capitalizeFirst(text) {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text
}

// Troca {nome} pelo primeiro nome do lead; sem nome, remove "{nome}, " no inicio,
// ", {nome}" no fim e "{nome}" solto, recapitalizando a frase resultante.
function resolveLeadName(text, leadName) {
  const name = typeof leadName === 'string' ? leadName.trim() : ''
  if (name) {
    const first = name.split(/\s+/)[0]
    return text.replace(/\{nome\}/g, first)
  }
  if (!text.includes('{nome}')) return text
  const cleaned = text
    .replace(/\{nome\}\s*,\s*/g, '')
    .replace(/,\s*\{nome\}/g, '')
    .replace(/\{nome\}/g, '')
    .trim()
  return capitalizeFirst(cleaned)
}

// Texto final da pergunta para o lead: aplica variante B (se houver teste ativo e o
// sorteio do lead cair em B) e resolve {nome}.
export function questionTextForLead(db, { accountId, leadId, question, leadName }) {
  const active = activeVariant(db, accountId, question.question_key)
  let variant = 'A'
  let baseText = question.text
  if (active && variantFor(leadId, question.question_key) === 'B') {
    variant = 'B'
    baseText = active.text
  }
  return { text: resolveLeadName(baseText, leadName), variant }
}

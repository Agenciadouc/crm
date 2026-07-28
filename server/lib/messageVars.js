// Substituicao de placeholders em templates de mensagem — versao BACKEND (Node runtime).
// Espelha src/lib/messageVars.ts pra garantir mesma logica entre frontend e backend.
// Se atualizar tokens aqui, atualiza no TS tambem (single source of truth logica; arquivos duplicados por runtime).

const TOKENS = ['{{name}}', '{{nome}}', '{{primeiro_nome}}', '{{first_name}}', '{{empresa}}', '{{cidade}}', '{{atendente}}', '{{atendente_nome}}']

function firstName(full) {
  if (!full) return ''
  return String(full).split(' ')[0] || String(full)
}

// ctx: { leadName, leadEmpresa, leadCity, attendantName }
export function applyMessageVars(template, ctx = {}) {
  if (!template) return template
  const leadName = ctx.leadName || 'Cliente'
  return String(template)
    .replace(/\{\{name\}\}/g, leadName)
    .replace(/\{\{nome\}\}/g, leadName)
    .replace(/\{\{primeiro_nome\}\}/g, firstName(ctx.leadName) || 'Cliente')
    .replace(/\{\{first_name\}\}/g, firstName(ctx.leadName) || 'Cliente')
    .replace(/\{\{empresa\}\}/g, ctx.leadEmpresa || '')
    .replace(/\{\{cidade\}\}/g, ctx.leadCity || '')
    .replace(/\{\{atendente\}\}/g, ctx.attendantName || '')
    .replace(/\{\{atendente_nome\}\}/g, firstName(ctx.attendantName))
}

// Retorna true se o template usa placeholder de atendente (util pra decidir se precisa de attendant_id).
export function templateNeedsAttendant(template) {
  if (!template) return false
  const s = String(template)
  return s.includes('{{atendente}}') || s.includes('{{atendente_nome}}')
}

// Helper: constroi VarContext a partir do lead + attendant (rows do DB).
export function buildVarContext(lead, attendant) {
  return {
    leadName: lead?.name || null,
    leadEmpresa: lead?.empresa || null,
    leadCity: lead?.city || null,
    attendantName: attendant?.name || null,
  }
}

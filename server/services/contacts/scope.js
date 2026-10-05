// Tipo de contato (spec 2026-10-05 crm simples §2). lead = cliente em potencial (padrao);
// cliente = ja comprou; revendedor e interno (funcionario, numero da empresa) ficam fora dos
// numeros e das automacoes. Sem tipo gravado = lead (bancos antigos continuam iguais).
export const CONTACT_TYPES = ['lead', 'cliente', 'revendedor', 'interno']
const AUTOMATED = new Set(['lead', 'cliente'])

export function contactTypeOf(lead) {
  return (lead && lead.contact_type) || 'lead'
}

// Agente de IA, follow-up, disparo, boas-vindas, primeira mensagem, recompra automatica, extracao.
export function canAutomate(lead) {
  return !!lead && AUTOMATED.has(contactTypeOf(lead))
}

// Trecho SQL para as consultas de numeros (Dashboard, funil, projecao, quadro do Pipeline).
export function countsInMetrics(alias = '') {
  const col = alias ? `${alias}.contact_type` : 'contact_type'
  return `COALESCE(${col}, 'lead') IN ('lead','cliente')`
}

export function parseContactType(value) {
  if (!CONTACT_TYPES.includes(value)) {
    const err = new Error('Tipo de contato inválido.')
    err.status = 400
    throw err
  }
  return value
}

// Loga uma vez por lead e motivo que a automacao foi pulada (evita log a cada mensagem).
const logged = new Set()
export function logSkipped(lead, what) {
  const k = `${lead && lead.id}|${what}`
  if (logged.has(k)) return
  logged.add(k)
  console.log(`[Contato] ${contactTypeOf(lead)} lead=${lead && lead.id}: ${what} pulado`)
}

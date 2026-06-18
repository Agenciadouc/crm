// Single source of truth for message template variables.
// Used by Chat.tsx (cadence message preview), Tasks.tsx (auto-send), and Cadences.tsx (help modal).

export interface VarContext {
  leadName?: string | null
  leadEmpresa?: string | null
  leadCity?: string | null
  attendantName?: string | null
}

export interface VarDoc {
  token: string
  label: string
  example: string
}

export const MESSAGE_VARIABLES: VarDoc[] = [
  { token: '{{name}}', label: 'Nome completo do lead', example: 'Daniel Paulo' },
  { token: '{{primeiro_nome}}', label: 'Primeiro nome do lead', example: 'Daniel' },
  { token: '{{empresa}}', label: 'Empresa do lead (se preenchida)', example: 'ACME Ltda' },
  { token: '{{cidade}}', label: 'Cidade do lead (se preenchida)', example: 'Porto Alegre' },
  { token: '{{atendente}}', label: 'Nome completo do atendente que enviar', example: 'Hemily Vitoria' },
  { token: '{{atendente_nome}}', label: 'Primeiro nome do atendente', example: 'Hemily' },
]

function firstName(full?: string | null) {
  if (!full) return ''
  return full.split(' ')[0] || full
}

export function applyMessageVars(template: string, ctx: VarContext): string {
  if (!template) return template
  const leadName = ctx.leadName || 'Cliente'
  return template
    .replace(/\{\{name\}\}/g, leadName)
    .replace(/\{\{primeiro_nome\}\}/g, firstName(ctx.leadName) || 'Cliente')
    .replace(/\{\{empresa\}\}/g, ctx.leadEmpresa || '')
    .replace(/\{\{cidade\}\}/g, ctx.leadCity || '')
    .replace(/\{\{atendente\}\}/g, ctx.attendantName || '')
    .replace(/\{\{atendente_nome\}\}/g, firstName(ctx.attendantName))
}

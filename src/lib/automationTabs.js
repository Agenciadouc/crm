// Tela unica "Cadencias e Follow-ups": duas abas guardadas em ?aba=.
// manuais = cadencias (roteiro que o vendedor executa); automaticas = follow-ups (WhatsApp envia sozinho).
// JS puro com .d.ts ao lado: roda no `node --test` e e importado pelo front.

export const AUTOMATION_PATH = '/cadencias-e-follow-ups'
export const ABAS = ['manuais', 'automaticas']

const LEGACY = { '/cadences': 'manuais', '/follow-ups': 'automaticas', '/qualifications': 'manuais' }

export function parseAba(search) {
  const aba = new URLSearchParams(search || '').get('aba')
  return aba === 'automaticas' ? 'automaticas' : 'manuais'
}

export function automationUrl(aba, search) {
  const params = new URLSearchParams(search || '')
  params.delete('aba')
  params.append('aba', aba === 'automaticas' ? 'automaticas' : 'manuais')
  return `${AUTOMATION_PATH}?${params.toString()}`
}

export function legacyAutomationRedirect(pathname, search) {
  return automationUrl(LEGACY[pathname] || 'manuais', search)
}

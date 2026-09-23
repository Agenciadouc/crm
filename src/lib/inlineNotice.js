// Regras puras dos avisos dentro dos cards (substituem o alert() do navegador).
// JS puro com .d.ts ao lado para rodar no `node --test`.

export const NOTICE_AUTO_HIDE_MS = 4000

export function errorNotice(prefix, err) {
  const msg = err && typeof err.message === 'string' ? err.message.trim() : ''
  if (!prefix) return { kind: 'error', text: msg || 'Algo deu errado.' }
  return { kind: 'error', text: msg ? `${prefix}: ${msg}` : `${prefix}.` }
}

export function successNotice(text) {
  return { kind: 'success', text }
}

// Sucesso some sozinho; erro fica ate o usuario fechar.
export function noticeAutoHideMs(notice) {
  return notice && notice.kind === 'success' ? NOTICE_AUTO_HIDE_MS : null
}

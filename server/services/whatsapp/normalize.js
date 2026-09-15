// Normalizacao de telefone BR usada por todo o fluxo de WhatsApp.
// Antes duplicada em leadHandoff.js:60, webhooks.js:30, scheduler.js:156 e messages.js:111/224.

// Forma canonica de recebimento/dedup: 55 + DDD + 9 digitos (insere o 9 quando falta).
export function normalizePhone(p) {
  if (!p) return p
  p = String(p).replace(/[^\d]/g, '')
  if (p.startsWith('55') && p.length === 13) return p
  if (p.startsWith('55') && p.length === 12) return p.slice(0, 4) + '9' + p.slice(4)
  if (!p.startsWith('55') && p.length === 11) return '55' + p
  if (!p.startsWith('55') && p.length === 10) return '55' + p.slice(0, 2) + '9' + p.slice(2)
  return p // formato desconhecido: devolve so os digitos
}

// Forma usada no envio (igual ao antigo _normalizePhone de leadHandoff.js):
// so acrescenta 55 em numeros de 10-11 digitos, NAO insere o 9.
export function normalizeForSend(phone) {
  return String(phone || '').replace(/[^\d]/g, '').replace(/^(?!55)(\d{10,11})$/, '55$1')
}

// Chave canonica de comparacao: DDD + 8 digitos finais (sem 55, sem 9 inicial de celular).
export function phoneCompareKey(p) {
  let d = String(p || '').replace(/[^\d]/g, '')
  if (!d) return ''
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3)
  return d.length === 10 ? d : d.slice(-10)
}

export function stripJid(jid) {
  return String(jid || '').replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@lid', '')
}

// JID ou telefone do lead -> numero para envio pelo Chat (messages.js).
export function jidToSendNumber(jid) {
  return normalizePhone(stripJid(jid).replace(/[^\d]/g, ''))
}

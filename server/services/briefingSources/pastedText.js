// Fonte "texto colado": material que a pessoa cola na entrevista (apresentacao,
// tabela de precos, FAQ). Fonte NUNCA lanca: devolve { ok:false } para que uma
// fonte quebrada nao derrube a entrevista.

import { addSource } from '../briefingStore.js'

export const MAX_PASTED_CHARS = 20000

export function collectPastedText(db, { accountId, briefingId, text }) {
  try {
    const clean = String(text == null ? '' : text).trim()
    if (!clean) return { ok: false, error: 'texto_vazio' }

    const id = addSource(db, {
      accountId,
      briefingId,
      kind: 'colado',
      content: clean.slice(0, MAX_PASTED_CHARS),
    })
    if (id === null) return { ok: false, error: 'briefing_nao_encontrado' }
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  }
}

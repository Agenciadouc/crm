// Fonte "texto colado": material que a pessoa cola na entrevista (apresentacao,
// tabela de precos, FAQ). Fonte NUNCA lanca: devolve { ok:false } para que uma
// fonte quebrada nao derrube a entrevista.

import { addSource } from '../briefingStore.js'

export const MAX_PASTED_CHARS = 20000
// Teto de colagens por briefing. Sem ele, POST /:id/paste podia ser repetido
// sem limite e o compilador concatenava tudo num prompt gigante.
export const MAX_COLAGENS_POR_BRIEFING = 10

export function collectPastedText(db, { accountId, briefingId, text }) {
  try {
    const clean = String(text == null ? '' : text).trim()
    if (!clean) return { ok: false, error: 'texto_vazio' }

    const dono = db.prepare('SELECT 1 FROM agent_briefings WHERE id = ? AND account_id = ?').get(briefingId, accountId)
    if (!dono) return { ok: false, error: 'briefing_nao_encontrado' }
    const ja = db.prepare(
      "SELECT COUNT(*) AS c FROM agent_briefing_sources WHERE briefing_id = ? AND kind = 'colado'"
    ).get(briefingId)
    if (ja && ja.c >= MAX_COLAGENS_POR_BRIEFING) return { ok: false, error: 'limite_de_materiais' }

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

// Funil "Recompra" da conta (spec §6.1) e guardas de funil/etapas (spec §12).
// Nao importa server/db.js: recebe db.
export const RECOMPRA_STAGES = [
  { key: 'aguardando', name: 'Aguardando', color: '#90A4AE' },
  { key: 'a_contatar', name: 'A contatar', color: '#FFB300' },
  { key: 'em_conversa', name: 'Em conversa', color: '#42A5F5' },
  { key: 'comprou', name: 'Comprou de novo', color: '#66BB6A', is_conversion: 1 },
  { key: 'nao_agora', name: 'Não comprou agora', color: '#FF7043' },
  { key: 'nao_quer', name: 'Não quer mais', color: '#8D6E63', is_terminal: 1 },
]

export const DEFAULT_REASONS = {
  nao_agora: ['Achou caro', 'Não precisa agora', 'Sem dinheiro no momento', 'Sem resposta', 'Outro'],
  nao_quer: ['Comprou do concorrente', 'Insatisfeito com a compra', 'Não usa mais o produto', 'Pediu para não ser chamado', 'Outro'],
}

function seedReasons(db, accountId) {
  const has = db.prepare('SELECT 1 FROM repurchase_reasons WHERE account_id = ? LIMIT 1').get(accountId)
  if (has) return
  const ins = db.prepare('INSERT INTO repurchase_reasons (account_id, grp, label, position) VALUES (?, ?, ?, ?)')
  for (const grp of ['nao_agora', 'nao_quer']) DEFAULT_REASONS[grp].forEach((label, i) => ins.run(accountId, grp, label, i))
}

export function ensureRepurchaseFunnel(db, accountId) {
  return db.transaction(() => {
    const acc = db.prepare('SELECT repurchase_funnel_id FROM accounts WHERE id = ?').get(accountId)
    let id = acc?.repurchase_funnel_id
    if (id && !db.prepare("SELECT 1 FROM funnels WHERE id = ? AND account_id = ? AND kind = 'recompra'").get(id, accountId)) id = null
    if (!id) id = db.prepare("SELECT id FROM funnels WHERE account_id = ? AND kind = 'recompra' ORDER BY id LIMIT 1").get(accountId)?.id
    if (!id) {
      id = Number(db.prepare("INSERT INTO funnels (account_id, name, is_default, is_active, kind) VALUES (?, 'Recompra', 0, 1, 'recompra')").run(accountId).lastInsertRowid)
      const ins = db.prepare('INSERT INTO funnel_stages (funnel_id, name, position, color, is_conversion, is_terminal, system_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      RECOMPRA_STAGES.forEach((st, i) => ins.run(id, st.name, i, st.color, st.is_conversion || 0, st.is_terminal || 0, st.key))
    }
    db.prepare('UPDATE accounts SET repurchase_funnel_id = ? WHERE id = ?').run(id, accountId)
    seedReasons(db, accountId)
    return id
  })()
}

export function ensureAllRepurchaseFunnels(db) {
  const ids = db.prepare('SELECT id FROM accounts').all()
  for (const { id } of ids) ensureRepurchaseFunnel(db, id)
  return ids.length
}

export function stageIdByKey(db, accountId, key) {
  const funnelId = ensureRepurchaseFunnel(db, accountId)
  return db.prepare('SELECT id FROM funnel_stages WHERE funnel_id = ? AND system_key = ?').get(funnelId, key)?.id ?? null
}

export function stageKey(db, stageId) {
  try { return db.prepare('SELECT system_key FROM funnel_stages WHERE id = ?').get(stageId)?.system_key ?? null } catch { return null }
}

export function isRepurchaseFunnel(db, funnelId) {
  try { return db.prepare('SELECT kind FROM funnels WHERE id = ?').get(funnelId)?.kind === 'recompra' } catch { return false }
}

export function checkStagesUpdate(db, funnelId, payloadStages) {
  if (!isRepurchaseFunnel(db, funnelId)) return { ok: true }
  const keep = new Set((payloadStages || []).map(s => Number(s.id)).filter(Boolean))
  const system = db.prepare('SELECT id, name FROM funnel_stages WHERE funnel_id = ? AND system_key IS NOT NULL').all(funnelId)
  const missing = system.filter(s => !keep.has(s.id))
  if (missing.length) return { ok: false, error: `A etapa "${missing[0].name}" é usada pela recompra e não pode ser apagada. Você pode renomear ou mudar a cor.` }
  return { ok: true }
}

export function canDeactivateFunnel(db, funnelId) {
  return !isRepurchaseFunnel(db, funnelId)
}

// "Arrumar" paineis (hoje so a aba Atendimento do Chat): ordem e o que aparece.
// Uma linha por (conta, usuario, painel); user_id NULL = padrao da conta.
// Recebe db; nao importa server/db.js. A lista de blocos espelha src/lib/panelLayout.js
// (test/panelLayout.test.js confere que sao iguais).

export const PANEL_BLOCKS = {
  atendimento: ['score', 'atendente', 'etapa', 'contato', 'tags', 'proximo_passo', 'avulsa', 'tarefas', 'vendas', 'observacoes'],
}

export class PanelLayoutError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

export function applyPanelLayoutSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS panel_layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      user_id INTEGER,
      panel TEXT NOT NULL DEFAULT 'atendimento',
      layout_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_panel_layouts_owner ON panel_layouts(account_id, COALESCE(user_id, 0), panel);
  `)
}

export function isKnownPanel(panel) {
  return Object.prototype.hasOwnProperty.call(PANEL_BLOCKS, panel)
}

// Mesmas regras de validateLayout (src/lib/panelLayout.js). Devolve a lista limpa (so id e visible).
export function validatePanelLayout(panel, layout) {
  const known = PANEL_BLOCKS[panel] || []
  if (!Array.isArray(layout)) throw new PanelLayoutError(400, 'O layout precisa ser uma lista de blocos.')
  if (layout.length === 0) throw new PanelLayoutError(400, 'Escolha pelo menos um bloco.')
  if (layout.length > known.length) throw new PanelLayoutError(400, 'Tem blocos demais no layout.')
  const seen = new Set()
  return layout.map(b => {
    if (!b || typeof b !== 'object' || typeof b.id !== 'string') throw new PanelLayoutError(400, 'Cada bloco precisa ter um id.')
    if (!known.includes(b.id)) throw new PanelLayoutError(400, `Bloco desconhecido: "${b.id}".`)
    if (seen.has(b.id)) throw new PanelLayoutError(400, `Bloco repetido: "${b.id}".`)
    seen.add(b.id)
    if (typeof b.visible !== 'boolean') throw new PanelLayoutError(400, `Diga se o bloco "${b.id}" fica visível (sim ou não).`)
    return { id: b.id, visible: b.visible }
  })
}

function parse(row) {
  if (!row) return null
  try { const v = JSON.parse(row.layout_json); return Array.isArray(v) ? v : null } catch { return null }
}

export function getPanelLayouts(db, { accountId, userId, panel }) {
  const acc = db.prepare('SELECT layout_json FROM panel_layouts WHERE account_id = ? AND user_id IS NULL AND panel = ?').get(accountId, panel)
  const mine = db.prepare('SELECT layout_json FROM panel_layouts WHERE account_id = ? AND user_id = ? AND panel = ?').get(accountId, userId, panel)
  return { account: parse(acc), user: parse(mine) }
}

// userId null = padrao da conta.
export function savePanelLayout(db, { accountId, userId = null, panel, layout }) {
  const clean = validatePanelLayout(panel, layout)
  const json = JSON.stringify(clean)
  db.transaction(() => {
    const where = userId == null ? 'user_id IS NULL' : 'user_id = ?'
    const args = userId == null ? [accountId, panel] : [accountId, userId, panel]
    const row = db.prepare(`SELECT id FROM panel_layouts WHERE account_id = ? AND ${where} AND panel = ?`).get(...args)
    if (row) db.prepare("UPDATE panel_layouts SET layout_json = ?, updated_at = datetime('now') WHERE id = ?").run(json, row.id)
    else db.prepare('INSERT INTO panel_layouts (account_id, user_id, panel, layout_json) VALUES (?, ?, ?, ?)').run(accountId, userId, panel, json)
  })()
  return clean
}

export function deletePanelLayout(db, { accountId, userId = null, panel }) {
  if (userId == null) db.prepare('DELETE FROM panel_layouts WHERE account_id = ? AND user_id IS NULL AND panel = ?').run(accountId, panel)
  else db.prepare('DELETE FROM panel_layouts WHERE account_id = ? AND user_id = ? AND panel = ?').run(accountId, userId, panel)
}

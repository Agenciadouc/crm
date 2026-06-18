import { Router } from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { requireRole, scopeToAccount } from '../middleware/auth.js'

const router = Router()

// List users (admin sees all, gerente sees own account)
// Includes account_name via JOIN — frontend usa pra exibir/ocultar permissoes restritas a conta da agencia
router.get('/', scopeToAccount, (req, res) => {
  const baseSelect = `SELECT u.id, u.account_id, u.name, u.email, u.role, u.is_active, u.is_bot, u.primary_instance_id, u.notification_instance_id, u.can_manage_proposals, u.can_manage_contracts, u.can_grab_leads, u.created_at, a.name as account_name FROM users u LEFT JOIN accounts a ON a.id = u.account_id`
  if (req.user.role === 'super_admin') {
    const accountId = req.query.account_id
    const users = accountId
      ? db.prepare(`${baseSelect} WHERE u.account_id = ? ORDER BY u.name`).all(accountId)
      : db.prepare(`${baseSelect} ORDER BY u.name`).all()
    return res.json({ users })
  }
  const users = db.prepare(`${baseSelect} WHERE u.account_id = ? ORDER BY u.name`).all(req.user.account_id)
  res.json({ users })
})

// Create user
router.post('/', (req, res) => {
  const { name, email, password, role, account_id } = req.body
  if (!name || !email || !password) return res.status(400).json({ error: 'Nome, email e senha obrigatorios' })

  // Permission checks
  if (req.user.role === 'gerente') {
    if (role !== 'atendente') return res.status(403).json({ error: 'Gerente so pode criar atendentes' })
    if (account_id && account_id !== req.user.account_id) return res.status(403).json({ error: 'Sem permissao' })
  }
  if (req.user.role === 'atendente') return res.status(403).json({ error: 'Sem permissao' })

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) return res.status(400).json({ error: 'Email ja cadastrado' })

  const acctId = req.user.role === 'gerente' ? req.user.account_id : (account_id || null)
  const userRole = role || 'atendente'

  const result = db.prepare('INSERT INTO users (account_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)').run(
    acctId, name, email, bcrypt.hashSync(password, 10), userRole
  )

  const user = db.prepare('SELECT id, account_id, name, email, role, is_active FROM users WHERE id = ?').get(result.lastInsertRowid)
  res.json({ user })
})

// Update user
router.put('/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' })

  // Scope check
  if (req.user.role === 'gerente' && user.account_id !== req.user.account_id) return res.status(403).json({ error: 'Sem permissao' })
  if (req.user.role === 'atendente' && user.id !== req.user.id) return res.status(403).json({ error: 'Sem permissao' })

  const { name, email, role, is_active, password, primary_instance_id, notification_instance_id, can_manage_proposals, can_manage_contracts, can_grab_leads } = req.body
  const sets = []
  const params = []
  if (name !== undefined) { sets.push('name = ?'); params.push(name) }
  if (email !== undefined && email !== user.email) {
    // Check if email is already used by another user
    const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.params.id)
    if (exists) return res.status(400).json({ error: 'Email ja cadastrado' })
    sets.push('email = ?'); params.push(email)
  }
  if (role !== undefined && role !== user.role) {
    // Only super_admin can change roles; gerente cannot promote
    if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'Apenas admin pode alterar role' })
    if (!['super_admin', 'gerente', 'atendente'].includes(role)) return res.status(400).json({ error: 'Role invalido' })
    sets.push('role = ?'); params.push(role)
  }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0) }
  if (password) { sets.push('password = ?'); params.push(bcrypt.hashSync(password, 10)) }
  if (primary_instance_id !== undefined) { sets.push('primary_instance_id = ?'); params.push(primary_instance_id || null) }
  if (notification_instance_id !== undefined) { sets.push('notification_instance_id = ?'); params.push(notification_instance_id || null) }
  // Permissoes comerciais (proposals/contracts) so se aplicam a users da conta da AGENCIA (Dros | Deivid).
  // Equivalente a "tools internas da Dros" — outras contas nao tem acesso a esse modulo.
  const targetAcct = db.prepare('SELECT name FROM accounts WHERE id = ?').get(user.account_id)
  const isAgencyUser = targetAcct?.name === 'Dros | Deivid'

  if (can_manage_proposals !== undefined) {
    const newVal = can_manage_proposals ? 1 : 0
    if (newVal !== (user.can_manage_proposals || 0)) {
      if (!isAgencyUser) return res.status(403).json({ error: 'Permissao de Propostas disponivel apenas pra equipe da Dros' })
      if (!['super_admin', 'gerente'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissao pra alterar can_manage_proposals' })
      sets.push('can_manage_proposals = ?'); params.push(newVal)
    }
  }
  if (can_manage_contracts !== undefined) {
    const newVal = can_manage_contracts ? 1 : 0
    if (newVal !== (user.can_manage_contracts || 0)) {
      if (!isAgencyUser) return res.status(403).json({ error: 'Permissao de Contratos disponivel apenas pra equipe da Dros' })
      if (!['super_admin', 'gerente'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissao pra alterar can_manage_contracts' })
      sets.push('can_manage_contracts = ?'); params.push(newVal)
    }
  }
  // can_grab_leads gerente/admin pode, ignora se nao mudou
  if (can_grab_leads !== undefined) {
    const newVal = can_grab_leads ? 1 : 0
    if (newVal !== (user.can_grab_leads || 0)) {
      if (!['super_admin','gerente'].includes(req.user.role)) return res.status(403).json({ error: 'Sem permissao pra alterar can_grab_leads' })
      sets.push('can_grab_leads = ?'); params.push(newVal)
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nada pra atualizar' })
  sets.push("updated_at = datetime('now')")
  params.push(req.params.id)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  const updated = db.prepare('SELECT id, account_id, name, email, role, is_active, primary_instance_id, notification_instance_id, can_manage_proposals, can_manage_contracts, can_grab_leads FROM users WHERE id = ?').get(req.params.id)
  res.json({ user: updated })
})

// Delete user (hard delete) — super_admin pode tudo, gerente so atendentes da propria conta
router.delete('/:id', requireRole('super_admin', 'gerente'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id)
  if (!user) return res.status(404).json({ error: 'Usuario nao encontrado' })
  if (user.id === req.user.id) return res.status(400).json({ error: 'Nao pode excluir voce mesmo' })
  if (req.user.role === 'gerente') {
    if (user.account_id !== req.user.account_id) return res.status(403).json({ error: 'Sem permissao' })
    if (user.role !== 'atendente') return res.status(403).json({ error: 'Gerente so pode excluir atendentes' })
  }
  // Limpa refs em standalone_tasks (FK sem ON DELETE SET NULL)
  db.prepare('UPDATE standalone_tasks SET assigned_to = NULL WHERE assigned_to = ?').run(req.params.id)
  db.prepare('UPDATE standalone_tasks SET created_by = NULL WHERE created_by = ?').run(req.params.id)
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

export default router

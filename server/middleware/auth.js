import jwt from 'jsonwebtoken'
import db from '../db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dros-crm-secret-2026'

// Cache leve pro check de account.is_active — evita 1 SELECT por request.
// TTL curto (30s) pra reagir rapido quando super_admin desativa/reativa uma conta.
const ACCOUNT_ACTIVE_CACHE = new Map() // account_id → { active: boolean, at: ms }
const ACCOUNT_CACHE_TTL = 30_000

function isAccountActive(accountId) {
  if (!accountId) return true // super_admin sem account_id passa
  const cached = ACCOUNT_ACTIVE_CACHE.get(accountId)
  const now = Date.now()
  if (cached && now - cached.at < ACCOUNT_CACHE_TTL) return cached.active
  const row = db.prepare('SELECT is_active FROM accounts WHERE id = ?').get(accountId)
  const active = !!row && row.is_active === 1
  ACCOUNT_ACTIVE_CACHE.set(accountId, { active, at: now })
  return active
}

// Verify JWT and attach user to request. Bloqueia tambem quem ja tinha
// sessao ativa antes da conta ser desativada — proxima request retorna
// 403 { error:'account_inactive' } e o frontend faz logout automatico.
export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
    if (req.user.account_id && !isAccountActive(req.user.account_id)) {
      return res.status(403).json({
        error: 'account_inactive',
        message: 'Sua conta esta desativada. Fale com a Dros pra reativar.',
      })
    }
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Require specific roles
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

// Auto-scope queries to user's account (gerente/atendente)
// Super admin can pass ?account_id=X to scope themselves
export function scopeToAccount(req, res, next) {
  if (req.user.role === 'super_admin') {
    req.accountId = req.query.account_id ? parseInt(req.query.account_id) : null
  } else {
    req.accountId = req.user.account_id
  }
  next()
}

export { JWT_SECRET }

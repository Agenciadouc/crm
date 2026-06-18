import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'dros-crm-secret-2026'

// Verify JWT and attach user to request
export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' })
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET)
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

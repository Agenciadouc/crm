import { Router } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { authenticate, JWT_SECRET } from '../middleware/auth.js'

const router = Router()

// Simple rate limiter for login (max 10 attempts per minute per IP)
const loginAttempts = new Map()
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()
  const attempts = loginAttempts.get(ip) || []
  const recent = attempts.filter(t => now - t < 60000)
  if (recent.length >= 10) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 1 minuto.' })
  recent.push(now)
  loginAttempts.set(ip, recent)
  next()
}

router.post('/login', rateLimit, (req, res) => {
  const { email, password } = req.body
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatorios' })

  const user = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email)
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Credenciais invalidas' })
  }

  // Bloqueia login se a conta do user estiver desativada (super_admin sem
  // account_id continua entrando sempre).
  if (user.account_id) {
    const acc = db.prepare('SELECT is_active, name FROM accounts WHERE id = ?').get(user.account_id)
    if (!acc || acc.is_active !== 1) {
      return res.status(403).json({
        error: 'account_inactive',
        message: 'Sua conta esta desativada. Fale com a Dros pra reativar.',
      })
    }
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role, account_id: user.account_id },
    JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, account_id: user.account_id, can_manage_proposals: user.can_manage_proposals || 0, can_manage_contracts: user.can_manage_contracts || 0, can_grab_leads: user.can_grab_leads || 0 },
  })
})

router.get('/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, account_id, avatar_url, primary_instance_id, notification_instance_id, can_manage_proposals, can_manage_contracts, can_grab_leads FROM users WHERE id = ?').get(req.user.id)
  if (!user) return res.status(401).json({ error: 'User not found' })
  // Adiciona feature gate da conta (ai_agents_enabled) pro frontend mostrar/esconder aba
  if (user.account_id) {
    const acc = db.prepare('SELECT ai_agents_enabled FROM accounts WHERE id = ?').get(user.account_id)
    user.account_ai_agents_enabled = acc?.ai_agents_enabled || 0
  } else {
    user.account_ai_agents_enabled = 0
  }
  res.json({ user })
})

router.post('/logout', (_req, res) => {
  res.json({ ok: true })
})

export default router

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

export interface User {
  id: number
  email: string
  name: string
  role: 'super_admin' | 'gerente' | 'atendente'
  account_id: number | null
  primary_instance_id?: number | null
  notification_instance_id?: number | null
  can_manage_proposals?: number
  can_grab_leads?: number
}

interface AuthCtx {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  loading: boolean
}

const AuthContext = createContext<AuthCtx>({} as AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem('dros_crm_token'))
  const [loading, setLoading] = useState(true)

  const base = import.meta.env.BASE_URL.replace(/\/$/, '')

  useEffect(() => {
    if (!token) { setLoading(false); return }
    fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => { localStorage.removeItem('dros_crm_token'); setToken(null); setUser(null) })
      .finally(() => setLoading(false))
  }, [token])

  const login = async (email: string, password: string) => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Erro') }
    const data = await res.json()
    localStorage.removeItem('dros_crm_active_account')
    localStorage.setItem('dros_crm_token', data.token)
    setToken(data.token)
    setUser(data.user)
  }

  const logout = () => {
    localStorage.removeItem('dros_crm_token')
    localStorage.removeItem('dros_crm_active_account')
    setToken(null)
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, token, login, logout, loading }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import { fetchAccounts, apiFetch, type Account } from '../lib/api'

interface AccountCtx {
  accountId: number | null
  accounts: Account[]
  setAccountId: (id: number) => void
  loading: boolean
}

const AccountContext = createContext<AccountCtx>({} as AccountCtx)

const STORAGE_KEY = 'dros_crm_active_account'
const SESSION_FLAG = 'dros_crm_session_started'

export function AccountProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedId, setSelectedIdState] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const setSelectedId = (id: number) => {
    setSelectedIdState(id)
    try { localStorage.setItem(STORAGE_KEY, String(id)) } catch {}
  }

  useEffect(() => {
    if (!user) return
    if (user.role === 'super_admin') {
      setLoading(true)
      fetchAccounts()
        .then(accs => {
          setAccounts(accs)
          if (accs.length > 0 && !selectedId) {
            // sessionStorage zera ao fechar a aba: detecta "login fresco" vs F5 na mesma sessao
            const isFreshSession = !sessionStorage.getItem(SESSION_FLAG)
            const drosDeivid = accs.find(a => a.name === 'Dros | Deivid')?.id

            if (isFreshSession && drosDeivid) {
              // Login novo (super_admin) — comeca SEMPRE em Dros | Deivid
              setSelectedIdState(drosDeivid)
              try { localStorage.setItem(STORAGE_KEY, String(drosDeivid)) } catch {}
            } else {
              // F5 ou mesma sessao — respeita ultima conta escolhida
              const stored = Number(localStorage.getItem(STORAGE_KEY))
              const fromStorage = stored && accs.find(a => a.id === stored) ? stored : null
              const ownById = user.account_id ? accs.find(a => a.id === user.account_id)?.id : null
              setSelectedIdState(fromStorage || ownById || drosDeivid || accs[0].id)
            }
            try { sessionStorage.setItem(SESSION_FLAG, '1') } catch {}
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      // Gerente/atendente/cliente — carrega só a própria conta (pra Sidebar checar flags).
      setSelectedIdState(user.account_id)
      if (user.account_id) {
        apiFetch<{ account: Account }>(`/api/accounts/${user.account_id}`)
          .then(d => { if (d?.account) setAccounts([d.account]) })
          .catch(() => {})
      }
    }
  }, [user])

  const accountId = user?.role === 'super_admin' ? selectedId : user?.account_id || null

  return (
    <AccountContext.Provider value={{ accountId, accounts, setAccountId: setSelectedId, loading }}>
      {children}
    </AccountContext.Provider>
  )
}

export const useAccount = () => useContext(AccountContext)

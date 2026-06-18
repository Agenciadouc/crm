import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { Building2 } from 'lucide-react'

export default function AccountSelector() {
  const { user } = useAuth()
  const { accountId, accounts, setAccountId } = useAccount()

  if (user?.role !== 'super_admin' || accounts.length === 0) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Building2 size={14} style={{ color: '#FFB300' }} />
      <select
        className="select"
        style={{ width: 200, padding: '6px 10px' }}
        value={accountId || ''}
        onChange={e => setAccountId(+e.target.value)}
      >
        {accounts.map(a => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
    </div>
  )
}

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAccount } from '../context/AccountContext'
import { fetchWhatsAppInstances, fetchInstanceAutoMessages, toggleInstanceAwayManual, type WhatsAppInstance, type InstanceAutoMessageConfig } from '../lib/api'
import { Moon, Sun, ChevronDown, Loader } from 'lucide-react'

type InstanceWithCfg = WhatsAppInstance & { _cfg?: InstanceAutoMessageConfig | null }

export default function QuickAwayToggle() {
  const { user } = useAuth()
  const { accountId } = useAccount()
  const [instances, setInstances] = useState<InstanceWithCfg[]>([])
  const [loading, setLoading] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [toggling, setToggling] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!accountId || !user) return
    setLoading(true)
    try {
      const insts = await fetchWhatsAppInstances(accountId)
      const connected = insts.filter(i => i.status === 'connected')
      // Todos os roles veem todas as instâncias conectadas da conta — cada um pode marcar/desmarcar
      const withCfg: InstanceWithCfg[] = await Promise.all(
        connected.map(async i => {
          try { const r = await fetchInstanceAutoMessages(i.id, accountId); return { ...i, _cfg: r.config } }
          catch { return { ...i, _cfg: null } }
        })
      )
      setInstances(withCfg)
    } catch {}
    setLoading(false)
  }, [accountId, user])

  useEffect(() => { load() }, [load])

  const handleToggle = async (inst: InstanceWithCfg) => {
    if (!accountId) return
    setToggling(inst.id)
    try {
      const r = await toggleInstanceAwayManual(inst.id, accountId)
      setInstances(prev => prev.map(p => p.id === inst.id ? { ...p, _cfg: r.config } : p))
    } catch (e: any) { alert(e?.message || 'Erro') }
    setToggling(null)
  }

  if (!user) return null
  if (instances.length === 0 && !loading) return null

  // Calcula status agregado: qualquer aceso AWAY = mostra "Ausente"
  const someAway = instances.some(i => i._cfg?.away_manual_active === 1 && i._cfg?.away_mode === 'manual')

  return (
    <div style={{ position: 'relative', padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        onClick={() => setShowMenu(s => !s)}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px',
          background: someAway ? 'rgba(251,188,4,0.1)' : 'rgba(52,199,89,0.08)',
          border: `1px solid ${someAway ? 'rgba(251,188,4,0.3)' : 'rgba(52,199,89,0.3)'}`,
          borderRadius: 6, cursor: 'pointer', fontSize: 12,
          color: someAway ? '#FBBC04' : '#34C759',
        }}
        title="Marcar/desmarcar como ausente"
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {someAway ? <Moon size={12} /> : <Sun size={12} />}
          <strong>{someAway ? 'Ausente' : 'Disponível'}</strong>
        </span>
        <ChevronDown size={11} />
      </button>

      {showMenu && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 4,
          background: '#16102A', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          padding: 4, zIndex: 50, boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ padding: '6px 10px', fontSize: 10, color: '#6B6580', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            WhatsApp — status manual
          </div>
          {loading && <div style={{ padding: 10, fontSize: 11, color: '#9B96B0', textAlign: 'center' }}><Loader size={12} className="spinning" /></div>}
          {instances.map(i => {
            const isAway = i._cfg?.away_manual_active === 1
            const hasConfig = !!i._cfg?.away_text
            return (
              <button
                key={i.id}
                onClick={() => handleToggle(i)}
                disabled={toggling === i.id || !hasConfig}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 10px', background: 'transparent', border: 'none', borderRadius: 4,
                  color: hasConfig ? '#fff' : '#6B6580', fontSize: 12, cursor: hasConfig ? 'pointer' : 'not-allowed',
                  textAlign: 'left',
                }}
                title={hasConfig ? '' : 'Configure o texto de ausência em Integrações → Auto-mensagens'}
              >
                <span>{i.instance_name}</span>
                <span style={{ fontSize: 10, color: isAway ? '#FBBC04' : '#34C759', fontWeight: 600 }}>
                  {toggling === i.id ? '...' : (isAway ? '🌙 Ausente' : '🟢 Online')}
                </span>
              </button>
            )
          })}
          {instances.some(i => !i._cfg?.away_text) && (
            <div style={{ padding: '6px 10px', fontSize: 10, color: '#6B6580', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              Sem texto de ausência? Configure em <strong>Integrações → Auto-mensagens</strong>.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

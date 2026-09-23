import { useLocation, useNavigate } from 'react-router-dom'
import { ListOrdered, Zap } from 'lucide-react'
import Cadences from './Cadences'
import FollowUps from './FollowUps'
import { parseAba, automationUrl, type Aba } from '../lib/automationTabs'

// Tela unica: cadencias (manuais, o vendedor executa) e follow-ups (automaticos, WhatsApp envia).
// A aba fica em ?aba= para o link poder abrir direto na aba certa.
const TABS: { key: Aba; label: string; icon: typeof Zap }[] = [
  { key: 'manuais', label: 'Manuais (o vendedor faz)', icon: ListOrdered },
  { key: 'automaticas', label: 'Automáticas (WhatsApp envia)', icon: Zap },
]

export default function CadencesAndFollowUps() {
  const location = useLocation()
  const navigate = useNavigate()
  const aba = parseAba(location.search)

  return (
    <div>
      <div className="page-header">
        <h1><ListOrdered size={20} style={{ verticalAlign: -4, marginRight: 6 }} />Cadências e Follow-ups</h1>
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => {
          const active = aba === t.key
          const Icon = t.icon
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              className="btn btn-sm"
              style={{ background: active ? '#FFB300' : 'transparent', color: active ? '#000' : '#9B96B0', border: 'none', borderBottom: active ? '2px solid #FFB300' : 'none', borderRadius: 0 }}
              onClick={() => { if (!active) navigate(automationUrl(t.key, location.search), { replace: true }) }}
            >
              <Icon size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> {t.label}
            </button>
          )
        })}
      </div>

      {aba === 'manuais' ? <Cadences embedded /> : <FollowUps embedded />}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { MapPin } from 'lucide-react'
import { fetchLeadCities, type CityOption } from '../lib/api'

// Cidade escolhida vale para todos os relatorios da conta (Leads, Pipeline, Dashboard, Projecao,
// Atendimentos): fica guardada no navegador por conta. Vazio = todas as cidades.
const storageKey = (accountId: number) => `dros_city_filter_${accountId}`

export function useCityFilter(accountId: number | null | undefined): [string, (city: string) => void] {
  const [city, setCityState] = useState('')
  useEffect(() => {
    if (!accountId) { setCityState(''); return }
    try { setCityState(localStorage.getItem(storageKey(accountId)) || '') } catch { setCityState('') }
  }, [accountId])
  const setCity = (value: string) => {
    setCityState(value)
    if (!accountId) return
    try {
      if (value) localStorage.setItem(storageKey(accountId), value)
      else localStorage.removeItem(storageKey(accountId))
    } catch {}
  }
  return [city, setCity]
}

interface Props {
  accountId: number | null | undefined
  value: string
  onChange: (city: string) => void
}

export default function CityFilter({ accountId, value, onChange }: Props) {
  const [options, setOptions] = useState<CityOption[]>([])

  useEffect(() => {
    if (!accountId) { setOptions([]); return }
    fetchLeadCities(accountId).then(setOptions).catch(() => setOptions([]))
  }, [accountId])

  const total = options.reduce((s, o) => s + o.count, 0)
  // Cidade guardada que nao existe mais na lista continua selecionavel (mostra sem contagem)
  const missing = value && !options.some(o => o.value === value)

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Filtrar por cidade do lead">
      <MapPin size={14} style={{ color: value ? 'var(--accent)' : 'var(--text-muted)' }} />
      <select className="select" value={value} onChange={e => onChange(e.target.value)} aria-label="Cidade">
        <option value="">Todas as cidades ({total})</option>
        {missing && <option value={value}>{value}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.value} ({o.count})</option>
        ))}
      </select>
    </label>
  )
}

// Aviso curto para numeros que nao se separam por cidade
export function CityNotice({ city, children }: { city: string; children: React.ReactNode }) {
  if (!city) return null
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', margin: '8px 0' }}>
      <MapPin size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
      Filtrando por <strong>{city}</strong>. {children}
    </div>
  )
}

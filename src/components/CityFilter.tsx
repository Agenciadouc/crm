import { useEffect, useState } from 'react'
import { MapPin, X, ChevronUp } from 'lucide-react'
import { fetchLeadCities, fetchLeadStates, type CityOption, type StateOption } from '../lib/api'
import { parseGeo, encodeGeo, geoLabel } from '../lib/geoFilter.js'

// Filtro de estado e cidade dos relatorios e do Chat. O valor e o texto "UF|Cidade" (lib/geoFilter.js):
// "SC|" = so o estado; "RS|Porto Alegre" = a cidade (com o estado dela); "" = tudo.
// A escolha vale para todas as telas da conta: fica guardada no navegador por conta.
const storageKey = (accountId: number) => `dros_city_filter_${accountId}`

export function useCityFilter(accountId: number | null | undefined): [string, (geo: string) => void] {
  const [geo, setGeoState] = useState('')
  useEffect(() => {
    if (!accountId) { setGeoState(''); return }
    try { setGeoState(localStorage.getItem(storageKey(accountId)) || '') } catch { setGeoState('') }
  }, [accountId])
  const setGeo = (value: string) => {
    setGeoState(value)
    if (!accountId) return
    try {
      if (value) localStorage.setItem(storageKey(accountId), value)
      else localStorage.removeItem(storageKey(accountId))
    } catch {}
  }
  return [geo, setGeo]
}

interface Props {
  accountId: number | null | undefined
  value: string
  onChange: (geo: string) => void
}

const cityOptionValue = (c: CityOption) => encodeGeo(c.uf || '', c.value)

// Campos Estado + Cidade (sem o botao). Reusado dentro do "Mais filtros..." (MoreFilters, secao Local).
// As listas so carregam quando `active` (painel aberto).
export function CityFilterFields({ accountId, value, onChange, active = true }: Props & { active?: boolean }) {
  const [states, setStates] = useState<StateOption[]>([])
  const [semEstado, setSemEstado] = useState(0)
  const [cities, setCities] = useState<CityOption[]>([])
  const { uf, city } = parseGeo(value)

  useEffect(() => {
    if (!accountId || !active) return
    fetchLeadStates(accountId).then(d => { setStates(d.states || []); setSemEstado(d.sem_estado || 0) }).catch(() => setStates([]))
  }, [accountId, active])

  // Com estado escolhido, a lista de cidades mostra so as dele
  useEffect(() => {
    if (!accountId || !active) return
    fetchLeadCities(accountId, uf || null).then(setCities).catch(() => setCities([]))
  }, [accountId, uf, active])

  const totalStates = states.reduce((s, o) => s + o.count, 0) + semEstado
  const totalCities = cities.reduce((s, o) => s + o.count, 0)
  const cityValue = city ? value : ''
  // Escolha guardada que nao aparece mais na lista continua selecionavel
  const missingCity = city && !cities.some(c => cityOptionValue(c) === value)
  const missingState = uf && !states.some(s => s.value === uf)
  // Sem estado escolhido, cidades com o mesmo nome em estados diferentes mostram o estado
  const showUf = !uf

  return (
    <>
      <select className="select" style={{ width: 150 }} value={uf} onChange={e => onChange(encodeGeo(e.target.value, ''))} aria-label="Estado">
        <option value="">Todos os estados ({totalStates})</option>
        {missingState && <option value={uf}>{uf}</option>}
        {states.map(s => <option key={s.value} value={s.value}>{s.value} - {s.name} ({s.count})</option>)}
      </select>
      <select className="select" style={{ width: 170 }} value={cityValue} onChange={e => onChange(e.target.value || encodeGeo(uf, ''))} aria-label="Cidade">
        <option value="">{uf ? `Todas as cidades de ${uf}` : 'Todas as cidades'} ({totalCities})</option>
        {missingCity && <option value={value}>{geoLabel(value)}</option>}
        {cities.map(c => (
          <option key={cityOptionValue(c)} value={cityOptionValue(c)}>
            {c.value}{showUf && c.uf ? ` - ${c.uf}` : ''} ({c.count})
          </option>
        ))}
      </select>
    </>
  )
}

export default function CityFilter({ accountId, value, onChange }: Props) {
  // Fechado: so o botao "Mais filtros..." (pedido do dono, 24/09/2026); aberto: Estado + Cidade
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className={`btn btn-sm ${value ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setOpen(true)}
          title="Filtrar por estado ou cidade do lead"
          style={{ whiteSpace: 'nowrap' }}
        >
          <MapPin size={12} /> {value ? geoLabel(value) : 'Mais filtros...'}
        </button>
        {value && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange('')} title="Limpar estado/cidade" aria-label="Limpar estado/cidade" style={{ padding: '4px 6px' }}>
            <X size={12} />
          </button>
        )}
      </span>
    )
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Filtrar por estado ou cidade do lead">
      <MapPin size={14} style={{ color: value ? 'var(--accent)' : 'var(--text-muted)' }} />
      <CityFilterFields accountId={accountId} value={value} onChange={onChange} active={open} />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)} title="Fechar filtros" aria-label="Fechar filtros" style={{ padding: '4px 6px' }}>
        <ChevronUp size={12} />
      </button>
    </span>
  )
}

// Aviso curto para numeros que nao se separam por cidade/estado
export function CityNotice({ city, children }: { city: string; children: React.ReactNode }) {
  if (!city) return null
  return (
    <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 10px', margin: '8px 0' }}>
      <MapPin size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: '-2px' }} />
      Filtrando por <strong>{geoLabel(city)}</strong>. {children}
    </div>
  )
}

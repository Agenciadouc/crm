import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal, MapPin, Thermometer, X } from 'lucide-react'
import { CityFilterFields } from './CityFilter'
import HelpTip from './HelpTip'
import { geoLabel } from '../lib/geoFilter.js'
import { BAND_META, SCORE_BANDS, type ScoreBand } from '../lib/score'
import {
  EMPTY_SCORE_FILTER, parseScoreFilter, encodeScoreFilter, countScoreFilters, scoreFilterLabel,
  type ScoreFilter,
} from '../lib/scoreFilter.js'

// Botao unico "Mais filtros..." das telas de leads (Leads, Pipeline, Chat): secao Local (estado/cidade,
// mesmo filtro e mesma chave do CityFilter) + secao Termometro (faixas, nota minima, perfil A/B, engajamento alto).

const scoreKey = (accountId: number) => `scoreFilter:${accountId}`
const emptyFilter = (): ScoreFilter => ({ ...EMPTY_SCORE_FILTER, bands: [] })

// Filtro do termometro guardado no navegador por conta
export function useScoreFilter(accountId: number | null | undefined): [ScoreFilter, (f: ScoreFilter) => void] {
  const [filter, setFilterState] = useState<ScoreFilter>(emptyFilter)
  useEffect(() => {
    if (!accountId) { setFilterState(emptyFilter()); return }
    try { setFilterState(parseScoreFilter(localStorage.getItem(scoreKey(accountId)))) } catch { setFilterState(emptyFilter()) }
  }, [accountId])
  const setFilter = (f: ScoreFilter) => {
    setFilterState(f)
    if (!accountId) return
    try {
      const enc = encodeScoreFilter(f)
      if (enc) localStorage.setItem(scoreKey(accountId), enc)
      else localStorage.removeItem(scoreKey(accountId))
    } catch {}
  }
  return [filter, setFilter]
}

interface Props {
  accountId: number | null | undefined
  city: string
  onCityChange: (geo: string) => void
  score: ScoreFilter
  onScoreChange: (f: ScoreFilter) => void
}

const PANEL_W = 360

export default function MoreFilters({ accountId, city, onCityChange, score, onScoreChange }: Props) {
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Nota minima: texto local, aplica meio segundo depois de parar de digitar
  const [minText, setMinText] = useState(score.min != null ? String(score.min) : '')
  // Filtro mais recente (o timer da nota minima nao pode desfazer uma faixa marcada nesse meio tempo)
  const scoreRef = useRef(score)
  scoreRef.current = score

  useEffect(() => { setMinText(score.min != null ? String(score.min) : '') }, [score.min])

  useEffect(() => {
    const t = minText.trim()
    const n = t === '' ? null : Number(t)
    const valid = n === null || (Number.isFinite(n) && n >= 0 && n <= 100)
    if (!valid) return
    const next = n === null ? null : Math.round(n)
    if (next === scoreRef.current.min) return
    const timer = setTimeout(() => onScoreChange({ ...scoreRef.current, min: next }), 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minText])

  useEffect(() => {
    if (!open) return
    const onDown = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const toggleOpen = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect()
      setAlignRight(!!r && r.left + PANEL_W > window.innerWidth - 8)
    }
    setOpen(o => !o)
  }

  const count = (city ? 1 : 0) + countScoreFilters(score)
  const scoreLabel = scoreFilterLabel(score)
  const summary = [city ? geoLabel(city) : '', scoreLabel].filter(Boolean).join(' · ')
  const minInvalid = minText.trim() !== '' && !(Number.isFinite(Number(minText)) && Number(minText) >= 0 && Number(minText) <= 100)

  const toggleBand = (b: ScoreBand) => {
    const bands = score.bands.includes(b) ? score.bands.filter(x => x !== b) : [...score.bands, b]
    onScoreChange({ ...score, bands: SCORE_BANDS.filter(x => bands.includes(x)) })
  }
  const clearAll = () => { onCityChange(''); onScoreChange(emptyFilter()); setMinText('') }

  const sectionTitle = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' as const, letterSpacing: 0.3, marginBottom: 8 }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        ref={btnRef}
        type="button"
        className={`btn btn-sm ${count > 0 ? 'btn-primary' : 'btn-secondary'}`}
        onClick={toggleOpen}
        aria-expanded={open}
        title={summary ? `Filtrando: ${summary}` : 'Filtrar por estado, cidade ou termômetro do lead'}
        style={{ whiteSpace: 'nowrap' }}
      >
        <SlidersHorizontal size={12} /> Mais filtros...
        {count > 0 && (
          <span style={{ marginLeft: 4, background: 'rgba(0,0,0,0.25)', fontSize: 10, fontWeight: 700, padding: '0 6px', borderRadius: 10, lineHeight: '16px' }}>{count}</span>
        )}
      </button>
      {count > 0 && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll} title="Limpar local e termômetro" aria-label="Limpar mais filtros" style={{ padding: '4px 6px' }}>
          <X size={12} />
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="Mais filtros"
          style={{
            position: 'absolute', top: '100%', marginTop: 6, [alignRight ? 'right' : 'left']: 0, zIndex: 60,
            width: `min(${PANEL_W}px, calc(100vw - 32px))`, background: 'var(--bg-card)', border: '1px solid var(--border-medium)',
            borderRadius: 10, boxShadow: 'var(--shadow-lg)', padding: 14, color: 'var(--text-primary)',
          }}
        >
          {/* Local */}
          <div style={sectionTitle}><MapPin size={12} /> Local</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            <CityFilterFields accountId={accountId} value={city} onChange={onCityChange} active={open} />
          </div>

          {/* Termometro */}
          <div style={sectionTitle}>
            <Thermometer size={12} /> Termômetro
            <HelpTip title="Filtrar pelo termômetro">
              Ex.: marque Quente e Pronto para ver quem está mais perto de comprar
            </HelpTip>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {SCORE_BANDS.map(b => {
              const meta = BAND_META[b]
              const Icon = meta.icon
              const on = score.bands.includes(b)
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleBand(b)}
                  aria-pressed={on}
                  title={`${meta.label}: nota ${meta.range}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    padding: '4px 10px', borderRadius: 14, transition: 'all var(--transition)',
                    border: `1px solid ${on ? meta.color : 'var(--border-medium)'}`,
                    background: on ? `${meta.color}26` : 'transparent',
                    color: on ? meta.color : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={12} /> {meta.label}
                  <span style={{ fontSize: 10, fontWeight: 400, opacity: 0.75 }}>{meta.range}</span>
                </button>
              )
            })}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            Nota mínima
            <input
              className="input"
              type="number"
              min={0}
              max={100}
              inputMode="numeric"
              placeholder="ex.: 70"
              value={minText}
              onChange={e => setMinText(e.target.value)}
              style={{ width: 90, borderColor: minInvalid ? 'var(--negative)' : undefined }}
              aria-invalid={minInvalid}
            />
            {minInvalid && <span style={{ fontSize: 11, color: 'var(--negative)' }}>de 0 a 100</span>}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 6 }}>
            <input type="checkbox" checked={score.fit} onChange={e => onScoreChange({ ...score, fit: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Só perfil A/B
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={score.engagement} onChange={e => onScoreChange({ ...score, engagement: e.target.checked })} style={{ accentColor: 'var(--accent)' }} />
            Só engajamento alto
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearAll} disabled={count === 0}>Limpar</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}

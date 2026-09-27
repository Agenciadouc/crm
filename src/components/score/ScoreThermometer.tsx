import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, Thermometer } from 'lucide-react'
import { fetchLeadScore, type LeadScore, type ScoreReason } from '../../lib/api'
import { BAND_META, QUADRANT_META, SCORE_HELP_TEXT, isScoreBand, scoreAgo } from '../../lib/score'
import { useSSE } from '../../context/SSEContext'
import HelpTip from '../HelpTip'

// Termometro completo do lead (spec 5.3): nota, faixa, barras Perfil/Engajamento, acao da matriz e o porque.
interface Props {
  leadId: number
  accountId: number
}

// A nota e recalculada uns segundos depois da mensagem (coalescencia de 5 s no servidor)
const RELOAD_AFTER_MESSAGE_MS = 6000

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>{label}</div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border-subtle)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width var(--transition-slow)' }} />
      </div>
    </div>
  )
}

function ReasonLine({ r }: { r: ScoreReason }) {
  const color = r.pontos > 0 ? 'var(--positive)' : r.pontos < 0 ? 'var(--negative)' : 'var(--text-muted)'
  const sign = r.pontos > 0 ? `+${r.pontos}` : r.pontos < 0 ? `−${Math.abs(r.pontos)}` : '0'
  return (
    <li style={{ display: 'flex', gap: 8, fontSize: 11, lineHeight: 1.45, padding: '2px 0' }}>
      <span style={{ color, fontWeight: 700, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{sign}</span>
      <span style={{ color: 'var(--text-secondary)' }}>{r.texto}</span>
    </li>
  )
}

export default function ScoreThermometer({ leadId, accountId }: Props) {
  const [data, setData] = useState<LeadScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const tokenRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback((silent = false) => {
    const my = ++tokenRef.current
    if (!silent) { setLoading(true); setData(null) }
    fetchLeadScore(leadId, accountId)
      .then(d => { if (my === tokenRef.current) { setData(d); setError(false) } })
      .catch(() => { if (my === tokenRef.current && !silent) setError(true) })
      .finally(() => { if (my === tokenRef.current) setLoading(false) })
  }, [leadId, accountId])

  useEffect(() => { load() }, [load])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const reloadIfMine = useCallback((id: unknown) => { if (Number(id) === leadId) load(true) }, [leadId, load])
  useSSE('lead:updated', useCallback((d: any) => reloadIfMine(d?.id ?? d?.lead_id), [reloadIfMine]))
  useSSE('lead:score_up', useCallback((d: any) => reloadIfMine(d?.lead_id), [reloadIfMine]))
  useSSE('lead:roteiro', useCallback((d: any) => reloadIfMine(d?.lead_id), [reloadIfMine]))
  useSSE('lead:message', useCallback((d: any) => {
    if (Number(d?.leadId ?? d?.lead_id) !== leadId) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => load(true), RELOAD_AFTER_MESSAGE_MS)
  }, [leadId, load]))

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#9B96B0', textTransform: 'uppercase', marginBottom: 6 }}>
      <Thermometer size={11} /> Termômetro
      <HelpTip title="Termômetro">
        {SCORE_HELP_TEXT}
      </HelpTip>
    </div>
  )

  const box = (children: React.ReactNode) => (
    <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'var(--bg-hover)', border: '1px solid var(--border-subtle)' }}>
      {header}
      {children}
    </div>
  )

  if (loading && !data) return box(<div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Calculando...</div>)
  if (error && !data) {
    return box(
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Não deu para carregar a nota agora. <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 8px', marginLeft: 4 }} onClick={() => load()}>Tentar de novo</button>
      </div>
    )
  }
  if (!data || data.score == null) {
    return box(
      <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Ainda sem termômetro. A nota aparece assim que houver conversa — ex.: quando o cliente responder e contar o orçamento, ela já sobe.
      </div>
    )
  }

  const band = isScoreBand(data.band) ? data.band : null
  const meta = band ? BAND_META[band] : null
  const Icon = meta?.icon
  const color = meta?.color || 'var(--text-secondary)'
  const up = data.score_prev != null && data.score > data.score_prev
  const down = data.score_prev != null && data.score < data.score_prev
  const fit = data.fit ?? 0
  const eng = data.engagement ?? 0
  const ago = scoreAgo(data.score_at)

  return box(
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 2, color }}>
          <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, fontFamily: 'var(--font-heading)', fontVariantNumeric: 'tabular-nums' }}>{data.score}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/100</span>
        </div>
        <div style={{ minWidth: 0 }}>
          {meta && Icon && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color, background: `${meta.color}1F`, padding: '2px 8px', borderRadius: 10 }}>
              <Icon size={12} /> {meta.label}
            </div>
          )}
          {(up || down) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: up ? 'var(--positive)' : 'var(--negative)', marginTop: 3 }}>
              {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
              {up ? 'subiu' : 'caiu'} de {data.score_prev}
            </div>
          )}
        </div>
      </div>

      <Bar label={`Perfil ${data.fit_grade || '—'} · ${fit}/50 — tem cara de comprador?`} value={fit} max={50} color="var(--accent)" />
      <Bar label={`Engajamento ${eng}/50 — está interessado agora?`} value={eng} max={50} color="var(--info)" />

      {data.quadrant && QUADRANT_META[data.quadrant] && (
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 8px', margin: '4px 0 8px' }}>
          {QUADRANT_META[data.quadrant]}
        </div>
      )}

      {data.reasons.length > 0 && (
        <>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Por que essa nota:</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.reasons.map((r, i) => <ReasonLine key={i} r={r} />)}
          </ul>
        </>
      )}

      {ago && <div style={{ fontSize: 10, color: 'var(--text-subtle)', marginTop: 6 }}>calculado {ago}</div>}
    </>
  )
}

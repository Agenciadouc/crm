import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Thermometer } from 'lucide-react'
import { fetchLeadScore, type LeadScore } from '../../lib/api'
import { BAND_META, SCORE_HELP_TEXT, isScoreBand } from '../../lib/score'
import { useSSE } from '../../context/SSEContext'
import ScoreThermometer from './ScoreThermometer'

// Termometro em 1 linha (spec 2026-09-27 §5.3): icone da faixa, nota, faixa e "porque";
// clique abre o termometro completo ali mesmo.
export default function ScoreLine({ leadId, accountId }: { leadId: number; accountId: number }) {
  const [score, setScore] = useState<LeadScore | null>(null)
  const [open, setOpen] = useState(false)
  const tokenRef = useRef(0)
  // Lead aberto agora: resposta atrasada de outro lead e descartada
  const leadRef = useRef(leadId)
  leadRef.current = leadId
  const load = useCallback(() => {
    const my = ++tokenRef.current
    const req = leadId
    fetchLeadScore(req, accountId)
      .then(s => { if (my === tokenRef.current && leadRef.current === req) setScore(s) })
      .catch(() => {})
  }, [leadId, accountId])
  useEffect(() => { setScore(null); setOpen(false); load() }, [load])
  useSSE('lead:score', useCallback((d: any) => { if (Number(d?.lead_id) === leadId) load() }, [leadId, load]))

  const band = score && isScoreBand(score.band) ? score.band : null
  const meta = band ? BAND_META[band] : null
  const Icon = meta ? meta.icon : Thermometer
  // O porque da nota no title (regra "todo numero com o porque")
  const why = score && score.reasons && score.reasons.length
    ? score.reasons.slice(0, 3).map(r => `${r.pontos > 0 ? '+' : ''}${r.pontos} ${r.texto}`).join(' · ')
    : SCORE_HELP_TEXT
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Ver o porquê da nota" title={why}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '6px 8px', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 12 }}
      >
        <Icon size={14} style={{ color: meta ? meta.color : 'var(--text-muted)' }} />
        {score && score.score != null ? (
          <><b style={{ fontVariantNumeric: 'tabular-nums' }}>{score.score}</b><span style={{ color: meta ? meta.color : 'var(--text-secondary)' }}>{meta ? meta.label : ''}</span></>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>Termômetro: ainda sem nota</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--text-muted)', fontSize: 11 }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} porquê
        </span>
      </button>
      {open && <div style={{ marginTop: 6 }}><ScoreThermometer key={leadId} leadId={leadId} accountId={accountId} /></div>}
    </div>
  )
}
